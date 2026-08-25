/**
 * Step 13 — Pass B, the assignment call. See "Pass Architecture — The LLM
 * Writes Content, Code Owns the Clock" and "Pass B ↔ Pass C JSON Contract" in
 * `docs/personalization-pipeline.md`.
 *
 *   funnel clusters → one prompt → an ordered day of place ids per day
 *
 * The model's whole job is putting ids in buckets. It never emits a time, a
 * duration or an order it has to compute — `pack.ts` stamps the clock and
 * `validate.ts` repairs it, so nothing the model says here can be arithmetically
 * wrong. What it *can* be is untrue: a perfectly-shaped response may name a
 * place that was never retrieved, so membership is checked against the
 * candidate set on the way back in and every rejection lands in `dropped`.
 *
 * Three rules this module exists to enforce.
 *
 * **The budget is a hint, not a gate.** `capacity.activity_minutes` is stated so
 * the model does three-number addition rather than counting slots, but a day
 * that comes back over budget is passed to the packer unchanged. Code owns the
 * clock; truncating here would be a scheduling decision made without one.
 *
 * **Every field not sent is hallucination surface removed.** The payload carries
 * no coordinates, no address, no photos and no opening-hours periods. Hours
 * reach the model only as `open_windows`, a coarse morning/midday/evening array
 * — enough to keep a 9am-only shrine out of an evening slot, not enough to
 * invent a schedule from. `assign.test.ts` walks the serialized request and
 * asserts those keys are absent, by key and recursively.
 *
 * **A bad call degrades, it never throws.** A malformed response is retried
 * once and then the ranked shortlist fills the day deterministically, marked
 * `fallback: true`. An exception here kills a job that had a perfectly good
 * itinerary available to it.
 *
 * It also names each day's area, in the same call, from the member names it was
 * already sent. Nothing in the deterministic core knows that a centroid at
 * (35.017, 135.671) is "Arashiyama" — `ScoredCluster.label` is `undefined` all
 * the way through — and a reverse-geocode to learn it is an extra Google SKU
 * for a string the model can read off the list for free.
 */

import { z } from "zod";

import type { AssignmentDrop, AssignmentRationale } from "./debug";
import { resolveVisitDuration } from "./duration";
import type { ScoredCluster } from "./funnel";
import { isOpenDuring, type Weekday } from "./hours";
import {
  MODELS,
  jsonSchemaFormat,
  withRetry,
  type ReasoningEffort,
  type ResponsesClient,
  type ResponsesRequest,
  type ResponsesUsage,
} from "./openai";
import {
  DAY_END_MIN,
  DAY_START_MIN,
  PACE_PLANS,
  type FlexPick,
  type PackDayInput,
  type SlotAssignment,
  type SlotRole,
} from "./pack";
import { isRestaurant } from "./taxonomy";
import type { CandidatePlace, Pace, PlaceEnrichment, PreferenceProfile } from "./types";

// ── open windows ─────────────────────────────────────────────────────────────

/** The only shape opening hours are allowed to reach the model in. */
export type OpenWindow = "morning" | "midday" | "evening";

/**
 * Where each coarse window sits on the clock. The boundaries are the day
 * skeleton's, not round numbers: morning ends where lunch may start (11:30),
 * midday ends where the cafe window closes (17:00), and evening runs to the
 * latest any pace may finish.
 */
export const OPEN_WINDOW_SPANS = {
  morning: [DAY_START_MIN, 690],
  midday: [690, 1020],
  evening: [1020, DAY_END_MIN],
} as const satisfies Record<OpenWindow, readonly [number, number]>;

/**
 * A window counts as open if a visit of this length fits somewhere inside it.
 * An hour is `DEFAULT_VISIT_MINUTES` — what a stop costs when nothing knows
 * better — so the question the probe asks is "could a stop go here", not "is
 * the door ever unlocked".
 *
 * Probing the whole window instead would call a restaurant that shuts between
 * services closed all afternoon. Probing a single instant would hand a place
 * that opens at 11:00 the whole morning.
 */
const WINDOW_PROBE_MIN = 60;
const WINDOW_PROBE_STEP = 30;

/**
 * The coarse hours hint for one place on one weekday. A place with no known
 * hours gets all three — `isOpenDuring` reads missing periods as always open,
 * and the caveat on that lives in `hours.ts`.
 *
 * Exported because this derivation is the whole of what the model learns about
 * time, and it deserves a test of its own rather than one buried in a payload
 * assertion.
 */
export function openWindowsFor(
  place: Pick<CandidatePlace, "openingPeriods">,
  weekday: Weekday,
): OpenWindow[] {
  const windows = Object.keys(OPEN_WINDOW_SPANS) as OpenWindow[];
  return windows.filter((window) => {
    const [from, to] = OPEN_WINDOW_SPANS[window];
    for (let start = from; start + WINDOW_PROBE_MIN <= to; start += WINDOW_PROBE_STEP) {
      if (isOpenDuring(place, weekday, start, start + WINDOW_PROBE_MIN)) return true;
    }
    return false;
  });
}

// ── capacity ─────────────────────────────────────────────────────────────────

export interface DayCapacity {
  /** Minutes of *visiting* the day can hold, after meals and travel. */
  activityMinutes: number;
  meals: number;
  flex: number;
}

/** What a sit-down meal occupies — the `restaurant` row of the type heuristic
 *  table in `duration.ts`, so the two agree on what eating costs. */
export const MEAL_MINUTES = 75;

/**
 * The share of a day spent getting between stops.
 *
 * Charged as a fraction of the day rather than per leg on purpose: the number
 * of legs is the number of stops minus one, and deciding a stop count is
 * exactly what this module must not do — see the long comment above
 * `PACE_PLANS` in `pack.ts` for the day that cost. Pace moves the share for the
 * same reason it moves `bufferMin`: a relaxed traveller spends longer on every
 * transition, a packed one hurries them.
 */
export const TRAVEL_SHARE: Record<Pace, number> = {
  relaxed: 0.3,
  balanced: 0.25,
  packed: 0.2,
};

/** Lunch and dinner. */
export const DEFAULT_MEALS_PER_DAY = 2;
/** One spare pick per day. The packer surrenders it first when the day runs long. */
export const DEFAULT_FLEX_PER_DAY = 1;

/**
 * The two capacity numbers a persona may move: how long a meal runs
 * (`solitude` — shared tables run long, a counter for one does not) and how
 * many slots are left loose rather than named (`spontaneity` owns openness).
 *
 * Named as its own type rather than taking a whole `PlannerKnobs` so a change
 * to the scoring weights cannot invalidate a capacity test.
 */
export interface CapacityKnobs {
  mealMinutes: number;
  flexPerDay: number;
}

/** Today's capacity, for every caller with no persona to hand. */
export const DEFAULT_CAPACITY_KNOBS: CapacityKnobs = {
  mealMinutes: MEAL_MINUTES,
  flexPerDay: DEFAULT_FLEX_PER_DAY,
};

/**
 * The minute budget stated to the model, derived from the clock rather than
 * picked. For a balanced day:
 *
 *   day length   1260 − 540 = 720   (`PACE_PLANS.balanced.dayEndMin` − `DAY_START_MIN`)
 *   − meals      2 × 75     = 150
 *   − travel     720 × 0.25 = 180
 *   = activity                390
 *
 * This is a hint, not a cap. `packDay` recomputes everything against the real
 * wall clock with real travel legs, and a day that comes back over budget is
 * handed to it unchanged.
 *
 * Exported so the route handler and the tests derive capacity the same way; a
 * second copy of this arithmetic is a budget nothing keeps honest.
 */
export function dayCapacity(
  pace: Pace,
  meals = DEFAULT_MEALS_PER_DAY,
  knobs: CapacityKnobs = DEFAULT_CAPACITY_KNOBS,
): DayCapacity {
  const dayMinutes = PACE_PLANS[pace].dayEndMin - DAY_START_MIN;
  const travelMinutes = Math.round(dayMinutes * TRAVEL_SHARE[pace]);
  const activityMinutes = Math.max(0, dayMinutes - meals * knobs.mealMinutes - travelMinutes);
  return { activityMinutes, meals, flex: knobs.flexPerDay };
}

// ── input and output ─────────────────────────────────────────────────────────

export interface AssignDayRequest {
  /** 0-based. Goes on the wire as `day: dayIndex + 1`, which is what the
   *  contract in the design doc shows and what a person reads back. */
  dayIndex: number;
  /** 0 = Sunday … 6 = Saturday, this day's own weekday. Never derived here. */
  weekday: Weekday;
  /** `ScoredCluster.label` — usually undefined, which is why Pass B names it. */
  areaName?: string;
  capacity: DayCapacity;
}

export interface AssignInput {
  profile: PreferenceProfile;
  /** One cluster per day, index-aligned with `days`. From `runFunnel().clusters`. */
  clusters: readonly ScoredCluster[];
  days: readonly AssignDayRequest[];
  /** Rung 2 of the duration ladder and the source of `enrichment_tags`. Misses are normal. */
  enrichments: ReadonlyMap<string, PlaceEnrichment>;
}

export interface AssignDeps {
  client: ResponsesClient;
  model?: string;
  /** Default `"low"`. Set explicitly at every call site — the API default is
   *  `medium`, so an unset effort silently buys reasoning tokens. */
  effort?: ReasoningEffort;
  promptCacheKey?: string;
  retries?: number;
}

export interface AssignedDay {
  dayIndex: number;
  /** Named by Pass B from the cluster's members, or the best place's name. */
  areaName?: string;
  input: PackDayInput;
  /** True when the model's response was unusable and the ranked fallback filled the day. */
  fallback: boolean;
}

export interface AssignResult {
  days: AssignedDay[];
  /** Ids the model named that were never in the candidate set, plus why. */
  dropped: AssignmentDrop[];
  /**
   * The one sentence Pass B wrote per stop, kept rather than discarded.
   *
   * It rides along on the assignment call, so it is already paid for; nothing
   * downstream renders it and nothing should start. It exists so that a day
   * that comes back strange can be read back — `itineraries.planner_debug`.
   */
  rationale: AssignmentRationale[];
  usage?: ResponsesUsage;
}

/** Why an id the model named didn't become a stop. Worded for a person. */
const DROP_REASONS = {
  unknown: "not in the candidate set — nothing with this id was retrieved",
  otherArea: "belongs to another day's area",
  duplicate: "already assigned earlier in this day",
} as const;

// ── the wire ─────────────────────────────────────────────────────────────────

/**
 * The request payload, written out as a type so that adding a field is a
 * deliberate edit rather than a spread that quietly ships coordinates. Nothing
 * in here is built by spreading a `CandidatePlace`.
 */
interface CandidatePayload {
  place_id: string;
  name: string;
  types: string[];
  rating?: number;
  user_rating_count?: number;
  price_level?: number;
  enrichment_tags?: string[];
  visit_minutes: { min: number; preferred: number; max: number };
  open_windows: OpenWindow[];
  score: number;
  match_reasons: string[];
}

interface ClusterPayload {
  cluster_id: string;
  cluster_score: number;
  place_count: number;
  /** What this cluster cannot furnish — today, a restaurant to seat a meal in. */
  shortfall?: string;
  candidates: CandidatePayload[];
}

interface DayPayload {
  day: number;
  cluster_id: string;
  area_name?: string;
  capacity: { activity_minutes: number; meals: number; flex: number };
}

interface AssignPayload {
  profile: {
    interests: string[];
    dietary: string[];
    pace: Pace;
    budget?: number;
  };
  days: DayPayload[];
  clusters: ClusterPayload[];
}

const clusterIdFor = (dayIndex: number) => `cluster-${dayIndex + 1}`;

/**
 * The response schema. It constrains shape, never truth — see `jsonSchemaFormat`.
 * Optional fields are `.nullable()` rather than `.optional()` because structured
 * output requires every property present.
 */
const AssignmentSchema = z.object({
  days: z.array(
    z.object({
      day: z.number(),
      /** The neighborhood name, read off the member list. */
      area_name: z.string().nullable(),
      assignments: z.array(
        z.object({
          slot_role: z.enum(["activity", "lunch", "dinner", "cafe_break"]),
          place_id: z.string(),
          why: z.string().nullable(),
        }),
      ),
      flex: z.array(z.object({ place_id: z.string(), why: z.string().nullable() })),
    }),
  ),
});

type Assignment = z.infer<typeof AssignmentSchema>;

const SYSTEM_PROMPT = [
  "You lay out a traveller's days from a shortlist of places that has already been",
  "filtered, scored and grouped into one area per day.",
  "",
  "For each day, return an ordered list of stops. Order is the order of the day.",
  "Tag every stop with the role it plays: `lunch`, `dinner`, `cafe_break`, or",
  "`activity` for everything else. A role says what a stop is, never when it is —",
  "a scheduler stamps the times afterwards, so never emit a time, a duration, or",
  "anything resembling a clock value.",
  "",
  "Rules:",
  "- Use only `place_id` values from that day's own cluster. Do not invent ids and",
  "  do not borrow from another day's cluster.",
  "- Offer a full day's worth of stops. The scheduler decides what actually fits,",
  "  so a short list only makes the day thin.",
  "- Add up `visit_minutes.preferred` for the non-meal stops and aim near the day's",
  "  `capacity.activity_minutes`. Seat `capacity.meals` meals in restaurants.",
  "- Respect `open_windows`: do not seat a place in a part of the day it is shut.",
  "- Put `capacity.flex` extra picks in `flex` — places worth visiting that the",
  "  budget did not fit. They are spares, not stops.",
  "- Set `area_name` to the neighborhood the day's places share, read from their",
  "  names. Use the name a local would use. Never say 'Cluster 1'.",
  "- `why` is one short sentence for the traveller.",
].join("\n");

function candidatePayload(
  place: CandidatePlace,
  score: number,
  reasons: string[],
  weekday: Weekday,
  enrichment: PlaceEnrichment | undefined,
  pace: Pace,
): CandidatePayload {
  const duration = resolveVisitDuration(place, enrichment, pace);
  return {
    place_id: place.placeId,
    name: place.name,
    types: place.types,
    rating: place.rating,
    user_rating_count: place.userRatingCount,
    price_level: place.priceLevel,
    enrichment_tags: enrichment?.tags,
    visit_minutes: { min: duration.min, preferred: duration.preferred, max: duration.max },
    open_windows: openWindowsFor(place, weekday),
    score: Math.round(score * 1000) / 1000,
    match_reasons: reasons,
  };
}

function buildPayload(input: AssignInput): AssignPayload {
  const { profile } = input;
  const clusters: ClusterPayload[] = [];
  const days: DayPayload[] = [];

  input.days.forEach((day, index) => {
    const cluster = input.clusters[index];
    const clusterId = clusterIdFor(index);
    days.push({
      day: day.dayIndex + 1,
      cluster_id: clusterId,
      area_name: day.areaName ?? cluster?.label,
      capacity: {
        activity_minutes: day.capacity.activityMinutes,
        meals: day.capacity.meals,
        flex: day.capacity.flex,
      },
    });
    if (!cluster) return;
    clusters.push({
      cluster_id: clusterId,
      cluster_score: Math.round(cluster.score * 1000) / 1000,
      place_count: cluster.places.length,
      shortfall: cluster.shortfall,
      candidates: cluster.places.map((place, i) =>
        candidatePayload(
          place,
          cluster.scored[i]?.score ?? 0,
          cluster.scored[i]?.reasons ?? [],
          day.weekday,
          input.enrichments.get(place.placeId),
          profile.pace,
        ),
      ),
    });
  });

  return {
    profile: {
      interests: profile.interests,
      dietary: profile.dietary,
      pace: profile.pace,
      budget: profile.budget,
    },
    days,
    clusters,
  };
}

/**
 * The request, assembled prefix-first: the system block is byte-identical
 * across every itinerary, so it is the part OpenAI's automatic prompt caching
 * can route on. Anything per-itinerary interpolated above it would produce a
 * distinct prefix and zero cache reads.
 */
export function buildAssignRequest(input: AssignInput, deps: AssignDeps): ResponsesRequest {
  return {
    model: deps.model ?? MODELS.assign,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(buildPayload(input)) },
    ],
    reasoning: { effort: deps.effort ?? "low" },
    text: { format: jsonSchemaFormat("assignment", AssignmentSchema) },
    prompt_cache_key: deps.promptCacheKey,
  };
}

function parseAssignment(text: string): Assignment {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Pass B returned text that is not JSON");
  }
  const parsed = AssignmentSchema.safeParse(json);
  if (!parsed.success) throw new Error("Pass B response did not match the assignment schema");
  return parsed.data;
}

// ── the deterministic fallback ───────────────────────────────────────────────

interface RankedPlace {
  place: CandidatePlace;
  score: number;
}

function ranked(cluster: ScoredCluster | undefined): RankedPlace[] {
  if (!cluster) return [];
  return cluster.places.map((place, index) => ({
    place,
    score: cluster.scored[index]?.score ?? 0,
  }));
}

/**
 * The day Pass B would have written if it were a sort. Meals from the best
 * restaurants, sights around them, the next sight held back as flex.
 *
 * It offers a full day's worth and lets the packer's clock decide what
 * survives. A fallback that handed over exactly as many stops as it expected to
 * fit would be making a scheduling decision it has no clock to make — which is
 * the same reason `assignDay` in the Gate A harness is shaped this way.
 *
 * A cluster with nothing in it yields an empty day rather than an exception:
 * `packDay` handles an empty assignment list, and a thrown error here loses the
 * other four days too.
 */
function fallbackDay(
  cluster: ScoredCluster | undefined,
  request: AssignDayRequest,
  input: AssignInput,
): PackDayInput {
  const pool = ranked(cluster);
  const eats = pool.filter((entry) => isRestaurant(entry.place));
  const sights = pool.filter((entry) => !isRestaurant(entry.place));
  const sized = (entry: RankedPlace) =>
    resolveVisitDuration(entry.place, input.enrichments.get(entry.place.placeId), input.profile.pace);

  const layout: Array<[RankedPlace | undefined, SlotRole]> = [
    [sights[0], "activity"],
    [eats[0], "lunch"],
    [sights[1], "activity"],
    [sights[2], "activity"],
    [sights[3], "activity"],
    [eats[1], "dinner"],
    [sights[4], "activity"],
  ];

  return {
    assignments: layout.flatMap(([entry, role]) =>
      entry ? [{ place: entry.place, role, score: entry.score, duration: sized(entry) }] : [],
    ),
    flex: sights
      .slice(5, 5 + Math.max(0, request.capacity.flex))
      .map((entry) => ({ place: entry.place, score: entry.score, duration: sized(entry) })),
  };
}

/** The area name, most authoritative source first. A name we were given beats
 *  one the model read off a list; both beat "the best place here". */
function areaNameFor(
  request: AssignDayRequest,
  cluster: ScoredCluster | undefined,
  modelName: string | null | undefined,
): string | undefined {
  const named = modelName?.trim();
  return request.areaName ?? cluster?.label ?? (named || undefined) ?? cluster?.places[0]?.name;
}

// ── the call ─────────────────────────────────────────────────────────────────

/**
 * One call for the whole trip. Returns a `PackDayInput` per requested day,
 * always — a day is either the model's, or the ranked shortlist's with
 * `fallback: true`. Nothing in here throws.
 */
export async function assignDays(input: AssignInput, deps: AssignDeps): Promise<AssignResult> {
  const dropped: AssignmentDrop[] = [];
  const rationale: AssignmentRationale[] = [];
  const request = buildAssignRequest(input, deps);

  const outcome = await withRetry(async () => {
    const response = await deps.client.create(request);
    return { assignment: parseAssignment(response.output_text), usage: response.usage };
  }, deps.retries ?? 1);

  if ("error" in outcome) {
    console.error("[assign] Pass B unusable, falling back to the ranked shortlist", outcome.error);
    return {
      days: input.days.map((day, index) => ({
        dayIndex: day.dayIndex,
        areaName: areaNameFor(day, input.clusters[index], undefined),
        input: fallbackDay(input.clusters[index], day, input),
        fallback: true,
      })),
      dropped,
      rationale,
    };
  }

  const byDay = new Map(outcome.value.assignment.days.map((day) => [day.day, day]));
  const days = input.days.map((dayRequest, index) => {
    const cluster = input.clusters[index];
    const answer = byDay.get(dayRequest.dayIndex + 1);
    const areaName = areaNameFor(dayRequest, cluster, answer?.area_name);
    const packInput: PackDayInput = answer
      ? resolveDay(answer, cluster, dayRequest, input, dropped, rationale)
      : { assignments: [], flex: [] };

    if (packInput.assignments.length === 0) {
      return {
        dayIndex: dayRequest.dayIndex,
        areaName,
        input: fallbackDay(cluster, dayRequest, input),
        fallback: true,
      };
    }
    return { dayIndex: dayRequest.dayIndex, areaName, input: packInput, fallback: false };
  });

  // Every rejection carries a sentence that is worded for a person, and until
  // now none of them was ever said out loud. `pipeline.ts` also files them on
  // the itinerary row; this is the half you see while the demo is running.
  for (const drop of dropped) {
    console.warn(`[assign] day ${drop.dayIndex + 1}: dropped ${drop.placeId} — ${drop.reason}`);
  }

  return { days, dropped, rationale, usage: outcome.value.usage };
}

/**
 * Turns one day of the model's answer into a `PackDayInput`, checking every id
 * against the day's own cluster on the way through.
 *
 * The minute budget is deliberately not enforced here. A day assigning more
 * than `capacity.activity_minutes` is passed to the packer exactly as given:
 * the packer knows the real travel legs and the real wall clock, and truncating
 * on an estimate would drop a stop that fits.
 */
function resolveDay(
  answer: Assignment["days"][number],
  cluster: ScoredCluster | undefined,
  request: AssignDayRequest,
  input: AssignInput,
  dropped: AssignmentDrop[],
  rationale: AssignmentRationale[],
): PackDayInput {
  const pool = new Map(ranked(cluster).map((entry) => [entry.place.placeId, entry]));
  const elsewhere = new Set(
    input.clusters.flatMap((other) => (other === cluster ? [] : other.places.map((p) => p.placeId))),
  );
  const seen = new Set<string>();

  const take = (placeId: string): RankedPlace | undefined => {
    const entry = pool.get(placeId);
    if (!entry) {
      dropped.push({
        dayIndex: request.dayIndex,
        placeId,
        reason: elsewhere.has(placeId) ? DROP_REASONS.otherArea : DROP_REASONS.unknown,
      });
      return undefined;
    }
    if (seen.has(placeId)) {
      dropped.push({ dayIndex: request.dayIndex, placeId, reason: DROP_REASONS.duplicate });
      return undefined;
    }
    seen.add(placeId);
    return entry;
  };

  const durationOf = (place: CandidatePlace) =>
    resolveVisitDuration(place, input.enrichments.get(place.placeId), input.profile.pace);

  // `why` never enters `SlotAssignment`. The packer is arithmetic over minutes
  // and prose in its input would be prose it has to carry past every swap; the
  // sentence goes to the diagnostic record instead, keyed by the same id.
  const keep = (placeId: string, kind: AssignmentRationale["kind"], why: string | null) => {
    const text = why?.trim();
    if (text) rationale.push({ dayIndex: request.dayIndex, placeId, kind, why: text });
  };

  const assignments: SlotAssignment[] = answer.assignments.flatMap((slot) => {
    const entry = take(slot.place_id);
    if (!entry) return [];
    keep(slot.place_id, "assignment", slot.why);
    return [
      {
        place: entry.place,
        role: slot.slot_role,
        score: entry.score,
        duration: durationOf(entry.place),
      },
    ];
  });

  const flex: FlexPick[] = answer.flex.flatMap((pick) => {
    const entry = take(pick.place_id);
    if (!entry) return [];
    keep(pick.place_id, "flex", pick.why);
    return [{ place: entry.place, score: entry.score, duration: durationOf(entry.place) }];
  });

  return { assignments, flex };
}
