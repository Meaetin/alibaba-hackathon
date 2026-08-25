/**
 * Step 14 — Pass C, the narration seam. See "What Pass C receives", "Pass C
 * response" and "Model & SDK Choices" in `docs/personalization-pipeline.md`.
 *
 * One short prose call per stop, ~15 per itinerary, fanned out in parallel. The
 * model writes two sentences about a place it has been handed; it never picks a
 * place, never picks a time, and never invents a dish. Everything it is allowed
 * to say is in the payload we send it.
 *
 * Three things this module exists to guarantee, and each of them is a test:
 *
 * **A failed call degrades one stop, never the itinerary.** Every per-stop task
 * catches its own errors and returns a fallback built from cached enrichment, so
 * the fan-out has nothing left to reject. `Promise.all` over tasks that cannot
 * reject is `Promise.allSettled` with the result already unwrapped. Fifteen
 * failures still return fifteen stops.
 *
 * **The shared prefix comes first and is byte-identical.** OpenAI's prompt
 * caching is automatic — unlike Anthropic's there is no `cache_control`
 * breakpoint to place — but it routes on a *prefix hash*. So the system prompt
 * and the profile slice are the first two blocks of every request and are built
 * once per run; the per-stop payload is strictly after them. Interpolating one
 * per-stop field above the instructions turns fifteen cache reads into fifteen
 * cache misses, and nothing in the output would look wrong. Two more conditions
 * come with it: the prefix must clear **1024 tokens** or nothing caches at all
 * (see `SHARED_PREFIX_MIN_CHARS`), and `prompt_cache_key` must be one
 * per-itinerary constant so all fifteen calls route to the same cache. Verify
 * with `usage.input_tokens_details.cached_tokens` — `stats.cachedTokens` sums it.
 *
 * **A dish the enrichment pass never saw does not reach the user.** Meal slots
 * are sent `signature_dishes` as grounding input and any returned dish outside
 * that list is dropped on arrival. A meal stop with no enrichment therefore
 * ships with no food recommendations at all, which is the intended trade: the
 * design doc's "do not cut enrichment and keep meal narration" is this rule.
 *
 * Correlation is by echoed `place_id`, not by array position. Fifteen in-flight
 * responses and one silently transposed pair is the kind of bug that reads as a
 * quality problem for a week.
 */

import { z } from "zod";

import { mapWithConcurrency } from "./http";
import {
  MODELS,
  jsonSchemaFormat,
  withRetry,
  type ReasoningEffort,
  type ResponseInputBlock,
  type ResponsesClient,
  type ResponsesRequest,
  type ResponsesResult,
} from "./openai";
import { isMealRole, type PackedDay, type SlotRole, type TravelMode } from "./pack";
import type { CandidatePlace, PlaceEnrichment, PreferenceProfile } from "./types";

// ── what a stop is, on the way in ────────────────────────────────────────────

/** One leg of the timeline, flattened for the prompt: "a 6-minute walk from …". */
export interface NarrateLeg {
  name: string;
  travelMode: TravelMode;
  travelMin: number;
}

/**
 * A single scheduled stop, which is what Pass C narrates — the *packed*
 * timeline, never Pass B's raw assignment. Times are stamped, travel is
 * measured, and the model is told both rather than asked for either.
 */
export interface NarrateStop {
  placeId: string;
  name: string;
  types: string[];
  rating?: number;
  dayIndex: number;
  role: SlotRole;
  startMin: number;
  endMin: number;
  enrichment?: PlaceEnrichment;
  /**
   * Why the funnel kept this place for *this* traveller (`ScoredPlace.reasons`).
   * Not sent to the model — it is the fallback's second half, per the degradation
   * ladder: a degraded card built from profile-specific reasons still says
   * something about this user, which the editorial summary it replaced never did.
   */
  matchReasons?: string[];
  previous?: NarrateLeg;
  next?: NarrateLeg;
}

/** Matches `ActivityContent` in `src/lib/db/schema.ts`. */
export interface StopContent {
  whyForYou: string;
  highlights: string[];
  foodRecommendations?: { dish: string; note: string }[];
  tips?: string[];
}

// ── the prompt ───────────────────────────────────────────────────────────────

/**
 * The 1024-token cache floor, in characters. OpenAI caches nothing below it, and
 * documents behaviour just above it as inconsistent — so this is a floor to clear,
 * not a target to hit. Four characters per token is the conservative English
 * estimate: a prefix over this length is over 1024 tokens for any realistic
 * tokenization, while one under it may not be.
 */
export const SHARED_PREFIX_MIN_CHARS = 4096;

/** How many leading blocks are shared. Everything at or after this index is
 *  per-stop and must never influence the cache prefix. */
export const SHARED_PREFIX_BLOCK_COUNT = 2;

/** The model gets three at most; anything past that is padding it invented. */
export const MAX_HIGHLIGHTS = 3;

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_MAX_OUTPUT_TOKENS = 600;

/**
 * Block one of two. Constant for the whole process, so it is the same bytes in
 * every request of every run — nothing about the traveller, the city or the
 * stop is interpolated here.
 *
 * It is long on purpose. The cache floor is 1024 tokens and a terse prompt
 * silently buys nothing, so the length is spent on the things that actually
 * reduce failures: the banned-phrase list, the grounding rule stated twice, and
 * two worked examples showing the exact shape of a good and a bad answer.
 */
export const NARRATE_SYSTEM_PROMPT = `You are the narration pass of a trip planner. A deterministic scheduler has
already chosen every place in this traveller's itinerary, ordered the stops,
measured the travel between them and stamped the clock times. None of those
decisions are yours to revisit. Your only job is to write the short, specific
prose that sits on one stop's card.

You will receive exactly one stop per request, as JSON, together with the
traveller's interests and dietary needs. Write about that stop and nothing else.

WHAT YOU ARE GIVEN
- place: its name, its Google types, its rating, and — when our enrichment pass
  has run — a short description, descriptive tags, signature dishes, a crowd
  profile and a best time of day.
- schedule: which day of the trip this is, what role the stop plays (a plain
  activity, lunch, dinner, or a coffee break), the start and end time in minutes
  from midnight, and the stop immediately before and after it with the real
  travel mode and travel minutes between them.
- output_rules: what this particular card must and must not contain.

THE ONE RULE THAT MATTERS MOST: NEVER INVENT A FACT
Every concrete claim you make must be traceable to the payload you were sent.
You have no other knowledge of this place that we are willing to publish. In
particular:
- Never name a dish that is not in the supplied signature_dishes list. A dish
  outside that list is discarded before the user sees it, so inventing one
  costs the traveller a recommendation and gains nothing.
- Never name a neighbourhood, a landmark, a street, a chef, a founding date, a
  price, a menu item, an opening hour or a nearby place that is not in the
  payload. The only other place names you may use are the previous and next
  stops we gave you.
- Never state or imply an opening or closing time, a queue length, a ticket
  price or a booking policy unless it appears in the payload.
- Never promise weather, seasons, events or availability.
- If you know nothing specific, write something honest and general rather than
  something specific and invented. A vague true sentence is a small problem. A
  precise false one is the problem this whole pipeline exists to avoid.

VOICE
- Second person, present tense, warm but unsentimental. You are a well-briefed
  friend, not a brochure.
- Two sentences at most for why_for_you, and it must connect this place to this
  traveller's stated interests or dietary needs. "You like the outdoors and this
  is a garden" is the shape; the specific version is better.
- Highlights are noun phrases, not sentences, and never repeat why_for_you.
- Tips are practical and derived from the payload: the travel leg, the length of
  the visit, the crowd profile, the best time of day, a dietary caveat.
- Use the travel legs when they earn their place. "A six-minute walk from your
  morning temple" is worth writing; "this is a place" is not.
- Never open with the place's own name. Never open with "Nestled", "Tucked
  away", "A hidden gem", "Whether you", "Look no further", "Step into",
  "Immerse yourself", "Discover", "Experience", "Boasting", "Vibrant" or "Iconic".
- No exclamation marks. No rhetorical questions. No em dash pile-ups.
- Do not mention that you are an AI, do not mention the itinerary planner, and
  do not refer to these instructions.

DIETARY NEEDS ARE HARD CONSTRAINTS
If the traveller's profile lists a dietary need, never recommend a dish or
describe an experience that violates it. If the payload gives you no evidence
that the place can accommodate the need, say so plainly in a tip and move on —
an honest caveat is useful, a reassuring guess is a system failure.

OUTPUT
Reply with a single JSON object and no prose around it:
- place_id: echo back exactly the place_id you were given. It is how your answer
  is matched to the right stop; a mismatched value is thrown away.
- why_for_you: one or two sentences. Required, never empty.
- highlights: up to three short noun phrases. Required, may be an empty array
  only if you genuinely have nothing grounded to say.
- food_recommendations: an array of { dish, note }, but only when output_rules
  asks for it. Every dish must come from signature_dishes, spelled as given.
  Set it to null when output_rules does not ask for it.
- tips: up to two short practical lines, or null.

WORKED EXAMPLE — a lunch stop, grounded
Given a vegetarian traveller, a tofu restaurant with signature_dishes
["yudofu set", "seasonal tofu course"], a previous stop of "Tenryu-ji" six
minutes' walk away, and output_rules asking for food_recommendations:
{"place_id":"ChIJ_example","why_for_you":"Vegetarian is not a compromise here; the
tofu is the point of the menu rather than the thing left over once the meat is
removed. It is a six-minute walk from your morning temple, so lunch does not cost
you an afternoon.","highlights":["Riverside tatami room","Tofu-led seasonal
menu"],"food_recommendations":[{"dish":"yudofu set","note":"The house dish,
simmered at your table"}],"tips":["Book ahead if you want the river-facing
room"]}

WORKED EXAMPLE — the same stop, done badly
{"place_id":"ChIJ_example","why_for_you":"Nestled in the heart of historic Arashiyama,
this hidden gem has been serving Kyoto's finest since 1868!","highlights":["Award-winning
chef","Only 500 yen"],"food_recommendations":[{"dish":"Wagyu beef
sushi","note":"Melts in your mouth"}],"tips":["Open until 10pm"]}
Everything specific in that answer was invented: the neighbourhood, the date, the
award, the price, the closing time, and a dish that both breaks the grounding rule
and contradicts the traveller's dietary need. It would be rejected.`;

/**
 * Block two of two. Per-itinerary, not per-stop — which is exactly why it can
 * live in the cached prefix.
 *
 * Only interests and dietary. `pace` and `budget` shape the *schedule*, and the
 * schedule is already decided by the time this runs; handing them to a writer
 * invites it to editorialise about a decision it did not make. `typeAffinities`
 * is a learned weight vector and means nothing in prose.
 */
export function profileSlice(profile: PreferenceProfile): {
  interests: string[];
  dietary: string[];
} {
  return { interests: [...profile.interests], dietary: [...profile.dietary] };
}

/**
 * The cached prefix, built once per run. Callers do not assemble this per stop:
 * building it once is what makes byte-identity a property of the code rather
 * than a thing to hope for.
 */
export function buildSharedPrefix(profile: PreferenceProfile): ResponseInputBlock[] {
  return [
    { role: "system", content: NARRATE_SYSTEM_PROMPT },
    {
      role: "developer",
      content: [{
        type: "input_text",
        text: `traveller_profile_slice: ${JSON.stringify(profileSlice(profile))}
Apply this to every stop you are sent in this conversation. Interests set what
you emphasise. Dietary needs are hard constraints, not preferences.`,
        prompt_cache_breakpoint: { mode: "explicit" },
      }],
    },
  ];
}

// ── the per-stop payload ─────────────────────────────────────────────────────

interface OutputRules {
  /** Present only for meal slots. */
  food_recommendations?: "required";
  max_highlights: number;
  reference_only_provided_names: true;
}

function outputRulesFor(role: SlotRole): OutputRules {
  const rules: OutputRules = {
    max_highlights: MAX_HIGHLIGHTS,
    reference_only_provided_names: true,
  };
  // Locked decision: narration is always generated for meal slots, and always
  // asks for dishes. Non-meal roles omit the key entirely rather than sending
  // "optional" — an absent field is not a field the model can misread.
  if (isMealRole(role)) rules.food_recommendations = "required";
  return rules;
}

/**
 * The one block that differs between calls, and therefore the one block that
 * must come last. Deliberately absent: latitude, longitude, formatted address,
 * opening-hours periods, photos. Every omitted field is hallucination surface
 * removed, and none of them helps write two sentences.
 */
export function buildStopPayload(stop: NarrateStop): Record<string, unknown> {
  const enrichment = stop.enrichment;
  return {
    place: {
      place_id: stop.placeId,
      name: stop.name,
      types: stop.types,
      ...(stop.rating === undefined ? {} : { rating: stop.rating }),
      ...(enrichment
        ? {
            description: enrichment.description,
            enrichment: {
              tags: enrichment.tags,
              ...(enrichment.signatureDishes
                ? { signature_dishes: enrichment.signatureDishes }
                : {}),
              ...(enrichment.crowdProfile ? { crowd_profile: enrichment.crowdProfile } : {}),
              ...(enrichment.bestTimeOfDay ? { best_time_of_day: enrichment.bestTimeOfDay } : {}),
            },
          }
        : {}),
    },
    schedule: {
      day: stop.dayIndex + 1,
      role: stop.role,
      start_min: stop.startMin,
      end_min: stop.endMin,
      ...(stop.previous
        ? {
            previous: {
              name: stop.previous.name,
              travel_mode: stop.previous.travelMode,
              travel_min: stop.previous.travelMin,
            },
          }
        : {}),
      ...(stop.next
        ? {
            next: {
              name: stop.next.name,
              travel_mode: stop.next.travelMode,
              travel_min: stop.next.travelMin,
            },
          }
        : {}),
    },
    output_rules: outputRulesFor(stop.role),
  };
}

// ── the response ─────────────────────────────────────────────────────────────

/**
 * `.nullable()` rather than `.optional()` throughout: OpenAI structured outputs
 * require every property to be in `required`, so an optional field is expressed
 * as one that may be null. Shape is enforced at the API layer — membership and
 * grounding are still ours to check below.
 */
const StopContentSchema = z.object({
  place_id: z.string(),
  why_for_you: z.string(),
  highlights: z.array(z.string()),
  food_recommendations: z
    .array(z.object({ dish: z.string(), note: z.string() }))
    .nullable(),
  tips: z.array(z.string()).nullable(),
});

type RawStopContent = z.infer<typeof StopContentSchema>;

/** Loose enough to survive "Yudofu Set." against "yudofu set", strict enough
 *  that a dish nobody recorded has nowhere to hide. */
function normalizeDish(dish: string): string {
  return dish
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isGroundedDish(dish: string, signatureDishes: readonly string[]): boolean {
  const candidate = normalizeDish(dish);
  if (candidate.length === 0) return false;
  return signatureDishes.some((known) => {
    const grounded = normalizeDish(known);
    if (grounded.length === 0) return false;
    return candidate === grounded || candidate.includes(grounded) || grounded.includes(candidate);
  });
}

// ── failure and the fallback ─────────────────────────────────────────────────

export interface NarrationFailure {
  placeId: string;
  message: string;
}

const ROLE_SENTENCE: Record<SlotRole, (name: string, day: number) => string> = {
  activity: (name, day) => `A stop at ${name} on day ${day} of your trip.`,
  lunch: (name, day) => `Lunch at ${name} on day ${day} of your trip.`,
  dinner: (name, day) => `Dinner at ${name} on day ${day} of your trip.`,
  cafe_break: (name, day) => `A coffee break at ${name} on day ${day} of your trip.`,
};

/**
 * What a stop ships with when its call failed. Per the degradation ladder:
 * cached `enrichment.description` plus the stop's match reasons, which are
 * profile-specific, so even the degraded card says something about *this* user.
 *
 * `whyForYou` is never empty. An empty one renders as a bare name and a time,
 * which is precisely the card the enrichment `description` exists to prevent —
 * so with no enrichment we still write a plain, true sentence from the name,
 * the role and the day.
 */
export function fallbackContent(stop: NarrateStop): StopContent {
  const description = stop.enrichment?.description?.trim();
  const whyForYou =
    description && description.length > 0
      ? description
      : ROLE_SENTENCE[stop.role](stop.name, stop.dayIndex + 1);

  const reasons = (stop.matchReasons ?? []).filter((reason) => reason.trim().length > 0);
  const highlights = reasons.length > 0 ? reasons : (stop.enrichment?.tags ?? []);

  return { whyForYou, highlights: highlights.slice(0, MAX_HIGHLIGHTS) };
}

// ── the seam ─────────────────────────────────────────────────────────────────

export interface NarrateDeps {
  client: ResponsesClient;
  /** Defaults to `MODELS.narrate`. */
  model?: string;
  /** Defaults to `"none"`. Set explicitly at every call site: the API default
   *  is `medium`, so leaving it unset silently buys reasoning tokens for a
   *  two-sentence writing task. */
  effort?: ReasoningEffort;
  /** Per-itinerary constant. Every call in one run shares it, which is what
   *  routes all fifteen to the same prompt cache. */
  promptCacheKey: string;
  concurrency?: number;
  /** Defaults to 1. Not a backoff policy — the fallback is always available,
   *  so a job that keeps retrying is strictly worse than one that degrades. */
  retries?: number;
}

export interface NarrateStats {
  requested: number;
  /** Stops whose content came from the model. */
  narrated: number;
  /** Stops that shipped `fallbackContent`. Always equals `failures.length`. */
  fallback: number;
  /** Sum of `usage.input_tokens_details.cached_tokens`. Zero across a whole run
   *  means the prefix is not actually shared — diff two rendered requests
   *  before touching anything else. */
  cachedTokens: number;
  /** Dishes the model named that were not in `signature_dishes`, dropped on
   *  arrival. A non-zero number here is the grounding rule doing its job, not
   *  a failure — the stop still ships its prose. */
  rejectedDishes: number;
  /** Stops whose response was cut off at `max_output_tokens`. Part of
   *  `fallback`, split out because the fix is a number, not a prompt. */
  truncated: number;
}

export interface NarrateResult {
  content: Map<string, StopContent>;
  /** Every stop that fell back, with why. One entry per degraded stop. */
  failures: NarrationFailure[];
  stats: NarrateStats;
}

/**
 * Narrates every stop, in parallel, and always returns a complete result.
 *
 * There is no path out of here that throws: a stop whose call fails, whose JSON
 * is unparseable, or whose echoed `place_id` names a different stop gets
 * `fallbackContent` and an entry in `failures`. Fifteen failures return fifteen
 * stops, and the itinerary ships.
 */
export async function narrateStops(
  stops: readonly NarrateStop[],
  profile: PreferenceProfile,
  deps: NarrateDeps,
): Promise<NarrateResult> {
  const sharedPrefix = buildSharedPrefix(profile);
  const format = jsonSchemaFormat("stop_content", StopContentSchema);
  const model = deps.model ?? MODELS.narrate;
  const effort: ReasoningEffort = deps.effort ?? "none";

  const content = new Map<string, StopContent>();
  const failures: NarrationFailure[] = [];
  const stats: NarrateStats = {
    requested: stops.length,
    narrated: 0,
    fallback: 0,
    cachedTokens: 0,
    rejectedDishes: 0,
    truncated: 0,
  };

  await mapWithConcurrency(stops, deps.concurrency ?? DEFAULT_CONCURRENCY, async (stop) => {
    let parsed: RawStopContent | undefined;
    let message: string | undefined;

    try {
      const request: ResponsesRequest = {
        model,
        // Shared prefix first, byte-identical, per-stop payload strictly after.
        // Reverse these two and the run costs 15x with nothing else to notice.
        input: [
          ...sharedPrefix,
          { role: "user", content: JSON.stringify(buildStopPayload(stop)) },
        ],
        reasoning: { effort },
        text: { format },
        prompt_cache_key: deps.promptCacheKey,
        prompt_cache_options: { mode: "explicit" },
        max_output_tokens: DEFAULT_MAX_OUTPUT_TOKENS,
      };

      const outcome = await withRetry(() => deps.client.create(request), deps.retries ?? 1);
      if ("error" in outcome) {
        message = outcome.error.message;
      } else {
        stats.cachedTokens += outcome.value.usage?.input_tokens_details?.cached_tokens ?? 0;
        // A response cut off at `max_output_tokens` arrives with a 200 and half
        // a JSON object, so the parser below would call it malformed and the
        // real cause — a cap that is too low — would never be named. Counted
        // and reported separately for exactly that reason.
        const truncation = truncationOf(outcome.value);
        if (truncation) {
          stats.truncated += 1;
          message = truncation;
        } else {
          const result = readResponse(outcome.value.output_text, stop);
          if ("error" in result) message = result.error;
          else parsed = result.value;
        }
      }
    } catch (error) {
      // Nothing above should throw — `withRetry` already swallows the call —
      // but a task that can reject would take the whole fan-out with it.
      message = error instanceof Error ? error.message : String(error);
    }

    if (parsed === undefined) {
      content.set(stop.placeId, fallbackContent(stop));
      failures.push({ placeId: stop.placeId, message: message ?? "narration unavailable" });
      stats.fallback += 1;
      return;
    }

    content.set(stop.placeId, toStopContent(parsed, stop, stats));
    stats.narrated += 1;
  });

  return { content, failures, stats };
}

/**
 * The message for a response the model never finished, or `undefined` when it
 * did. `status: "incomplete"` is the only signal there is: the body is a 200
 * carrying a partial `output_text`.
 */
function truncationOf(result: ResponsesResult): string | undefined {
  if (result.status !== "incomplete") return undefined;
  const reason = result.incompleteReason ?? "unknown";
  return reason === "max_output_tokens"
    ? `narration was cut off at max_output_tokens (${DEFAULT_MAX_OUTPUT_TOKENS}) — raise the cap`
    : `narration stopped before it finished (${reason})`;
}

function readResponse(
  outputText: string,
  stop: NarrateStop,
): { value: RawStopContent } | { error: string } {
  let json: unknown;
  try {
    json = JSON.parse(outputText);
  } catch {
    return { error: "narration response was not JSON" };
  }

  const parsed = StopContentSchema.safeParse(json);
  if (!parsed.success) return { error: "narration response did not match the schema" };

  // Correlation is by echoed id, never by position. Applying a mismatched
  // response to the stop it happened to arrive for is worse than losing it:
  // it reads as a quality problem rather than an error.
  if (parsed.data.place_id !== stop.placeId) {
    return { error: `place_id mismatch: got ${parsed.data.place_id}` };
  }

  if (parsed.data.why_for_you.trim().length === 0) {
    return { error: "narration returned an empty why_for_you" };
  }

  return { value: parsed.data };
}

function toStopContent(raw: RawStopContent, stop: NarrateStop, stats: NarrateStats): StopContent {
  const content: StopContent = {
    whyForYou: raw.why_for_you.trim(),
    highlights: raw.highlights
      .map((highlight) => highlight.trim())
      .filter((highlight) => highlight.length > 0)
      .slice(0, MAX_HIGHLIGHTS),
  };

  const tips = (raw.tips ?? []).map((tip) => tip.trim()).filter((tip) => tip.length > 0);
  if (tips.length > 0) content.tips = tips;

  // A non-meal stop was never asked for dishes; one that returns them anyway is
  // answering a question we did not ask, so the answer goes in the bin rather
  // than onto the card.
  if (!isMealRole(stop.role)) return content;

  const signatureDishes = stop.enrichment?.signatureDishes ?? [];
  const grounded = (raw.food_recommendations ?? []).filter((recommendation) => {
    if (isGroundedDish(recommendation.dish, signatureDishes)) return true;
    stats.rejectedDishes += 1;
    return false;
  });
  if (grounded.length > 0) {
    content.foodRecommendations = grounded.map(({ dish, note }) => ({
      dish: dish.trim(),
      note: note.trim(),
    }));
  }
  return content;
}

// ── deriving the stop list from the packed timeline ──────────────────────────

/**
 * Builds the stop list from packed days. Exported so the route handler and the
 * tests derive it the same way — and so travel legs come off the *timeline*
 * rather than being recomputed, which is the only place the real mode and the
 * real minutes exist.
 *
 * `break` segments are skipped: a gap is not a stop, and a card for one would be
 * a card about nothing. But scanning for a travel leg looks *through* them, so a
 * stop with a coffee break sitting between it and its walk still knows about the
 * walk.
 */
export function stopsFromDays(
  days: readonly { dayIndex: number; day: PackedDay }[],
  places: ReadonlyMap<string, CandidatePlace>,
  enrichments: ReadonlyMap<string, PlaceEnrichment>,
  /** `ScoredPlace.reasons` by place id, for the fallback. Optional: without it
   *  a degraded card falls back to enrichment tags. */
  matchReasons?: ReadonlyMap<string, string[]>,
): NarrateStop[] {
  return days.flatMap(({ dayIndex, day }) =>
    day.segments.flatMap((segment, index): NarrateStop[] => {
      if (segment.kind !== "activity") return [];
      const place = places.get(segment.placeId);
      const previous = legBefore(day, index);
      const next = legAfter(day, index);

      return [
        {
          placeId: segment.placeId,
          name: segment.name,
          types: place?.types ?? [],
          ...(place?.rating === undefined ? {} : { rating: place.rating }),
          dayIndex,
          role: segment.role,
          startMin: segment.startMin,
          endMin: segment.endMin,
          ...(enrichments.get(segment.placeId)
            ? { enrichment: enrichments.get(segment.placeId) }
            : {}),
          ...(matchReasons?.get(segment.placeId)
            ? { matchReasons: matchReasons.get(segment.placeId) }
            : {}),
          ...(previous ? { previous } : {}),
          ...(next ? { next } : {}),
        },
      ];
    }),
  );
}

function legBefore(day: PackedDay, index: number): NarrateLeg | undefined {
  for (let i = index - 1; i >= 0; i--) {
    const segment = day.segments[i];
    if (segment.kind === "activity") return undefined;
    if (segment.kind === "travel") {
      return {
        name: segment.fromName,
        travelMode: segment.mode,
        travelMin: segment.endMin - segment.startMin,
      };
    }
  }
  return undefined;
}

function legAfter(day: PackedDay, index: number): NarrateLeg | undefined {
  for (let i = index + 1; i < day.segments.length; i++) {
    const segment = day.segments[i];
    if (segment.kind === "activity") return undefined;
    if (segment.kind === "travel") {
      return {
        name: segment.toName,
        travelMode: segment.mode,
        travelMin: segment.endMin - segment.startMin,
      };
    }
  }
  return undefined;
}
