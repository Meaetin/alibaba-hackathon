/**
 * Step 15 — the whole pipeline, composed once, in one place.
 *
 *   retrieve → cluster → funnel → hydrate → enrich → assign → schedule →
 *   photos → narrate
 *
 * This module exists so the route handler can be thin. A handler that contained
 * the pipeline could only be tested through HTTP; here the stages are ordinary
 * functions over injected ports, so `pipeline.test.ts` drives the real thing
 * against fakes and `route.test.ts` drives the real thing again through the
 * handler. Nothing below reaches for `Math.random`, `Date.now`, `fetch` or an
 * SDK constructor — every one of those arrives in `PipelineDeps`.
 *
 * Three orderings here are load-bearing and easy to get wrong:
 *
 * **Hydration feeds the schedule, not just the store.** `hydrateShortlist`
 * returns rows carrying `servesVegetarianFood`, and the dietary rule in
 * `validate.ts` reads it. So the clusters handed to Pass B and to the validator
 * are rebuilt from the *hydrated* rows. The funnel is deliberately NOT re-run:
 * hydration only adds fields, and re-filtering would silently change a
 * shortlist that has already been reported.
 *
 * **Photos are resolved from the finished timeline.** `survivorIdsFromDays`
 * over the packed days, never the pool and never the shortlist — that is the
 * only per-stop billed call in the pipeline.
 *
 * **The weekday is derived here and nowhere else.** `hours.ts`, `assign.ts` and
 * `validate.ts` all take an injected `Weekday`; `docs/implementation-plan.md`
 * records that `start_date` "stops at the API seam until Step 15". This is that
 * seam. The date is parsed as a calendar date, never as a local instant — see
 * `weekdayOf`.
 *
 * ## Where travel times come from
 *
 * Two paths, chosen by `PipelineDeps.routing`, and the default is the free one.
 * `travel-estimate.ts` models a leg from the map and bills nothing; `routes.ts`
 * measures it against Google's Compute Route Matrix and bills per element. A
 * caller may also inject `getTravelLeg` and bypass both, which is every test.
 * `stats.travel.source` records which of the three answered.
 */

import { createHash } from "node:crypto";

import type { TravelPersona } from "@/lib/persona/types";

import {
  DEFAULT_MEALS_PER_DAY,
  assignDays,
  dayCapacity,
  type AssignDayRequest,
  type AssignResult,
} from "./assign";
import { clusterPlaces } from "./cluster";
import { addUsage, emptyStageUsage, type StageUsage } from "./pricing";
import { pathMeters, sequenceDay } from "./sequence";
import { buildTravelMatrix, type TravelMatrixStats } from "./routes";
import { createTravelEstimate, type TravelEstimateStats } from "./travel-estimate";
import {
  PLANNER_DEBUG_VERSION,
  type PlannerDebug,
  type SchedulingRecord,
  type SequencingRecord,
} from "./debug";
import {
  enrichPlaces,
  readEnrichments,
  type EnrichPlacesResult,
  type EnrichmentStore,
  type EnrichmentReadStats,
} from "./enrich";
import {
  FUNNEL_DEFAULTS,
  pickSerendipitySlots,
  runFunnel,
  type FunnelStats,
  type ScoredCluster,
} from "./funnel";
import {
  repairFeasibility,
  type FeasibilityAttempt,
  type FeasibilityRepair,
} from "./feasibility";
import { metersBetween } from "./geo";
import { MEMBER_RADIUS_SLACK, groupByTheme, type ThemedCluster } from "./group";
import { bandsFor, resolvePlannerKnobs, type PlannerKnobs } from "./knobs";
import { personaBriefFor, type PersonaBrief } from "./persona-brief";
import { type Weekday } from "./hours";
import type { FetchLike } from "./http";
import {
  narrateStops,
  stopsFromDays,
  type DayPremise,
  type NarrateStats,
  type StopContent,
} from "./narrate";
import { MODELS, type ResponsesClient, type ResponsesUsage } from "./openai";
import {
  type FlexPick,
  type PackDayInput,
  type PackKnobs,
  type PackedDay,
  type TravelLegProvider,
  type TravelMode,
} from "./pack";
import {
  resolvePhotos,
  survivorIdsFromDays,
  type PhotoBlobStore,
  type PhotoStats,
} from "./photos";
import {
  buildSearchPlan,
  hydrateShortlist,
  textNearRequest,
  mergeRetrievalStats,
  nearbyRequest,
  retrievePlaces,
  type LocationStore,
  type RetrievalStats,
  type RetrievedPlace,
  type SearchCache,
  type ShortlistHydrationStats,
} from "./retrieval";
import { scorePlace, type ScoredPlace } from "./score";
import { dietaryBridgeFor, mealSearchTypes } from "./taxonomy";
import { surveyCity } from "./survey";
import {
  planThemes,
  radiusFor,
  type DayTheme,
  type ThemeRejection,
} from "./theme";
import { resolveVisitDuration } from "./duration";
import type {
  CandidatePlace,
  PlaceEnrichment,
  PreferenceProfile,
  SchedulerOptions,
} from "./types";
import {
  mealSlotReason,
  validateDay,
  type Alternate,
  type Repair,
  type ValidationFailure,
} from "./validate";

// ── the request ──────────────────────────────────────────────────────────────

export interface PlanRequest {
  city: string;
  country?: string;
  /** ISO date, "YYYY-MM-DD". The first planned day. */
  startDate: string;
  totalDays: number;
  name?: string;
  profile: PreferenceProfile;
  options?: SchedulerOptions;
  /**
   * The traveller's quiz answers and the archetype derived from them, already
   * resolved from the `personaId` on the wire — the pipeline never reads a
   * table. **Optional, and absent must plan exactly as this pipeline planned
   * before personas existed**; that is what lets the Gate A snapshots stay
   * still for a traveller who never took the quiz.
   */
  persona?: TravelPersona;
  /**
   * How a day is decided.
   *
   * `"geographic"` — the default and everything this planner has ever shipped:
   * k-means over coordinates, `k = totalDays`, one neighbourhood per day.
   *
   * `"themed"` — a day is a premise anchored on a real place, and its
   * candidates are searched *around* that anchor rather than partitioned out of
   * a pool. Costs one model call and roughly eight to twelve extra Nearby
   * Searches; buys days that are about something. Every rung of it falls back
   * to `"geographic"`, so the worst case is the default.
   */
  mode?: PlanMode;
}

export type PlanMode = "geographic" | "themed";

// ── progress ─────────────────────────────────────────────────────────────────

/**
 * Every stage a plan passes through, in order. `save` and `done` belong to the
 * caller — `runPlan` does not persist anything — but they are named here so the
 * percentages of the whole run come from one table instead of two.
 */
export type PlanStage =
  | "retrieve"
  | "theme"
  | "explore"
  | "cluster"
  | "hydrate"
  | "enrich"
  | "assign"
  | "schedule"
  | "photos"
  | "narrate"
  | "save"
  | "done";

export interface PlanProgress {
  stage: PlanStage;
  label: string;
  percent: number;
  done: number;
  total: number;
}

interface StagePlan {
  stage: Exclude<PlanStage, "done">;
  label: string;
  /**
   * Rough wall-clock cost, in milliseconds. These are weights, not promises:
   * they set how much of the bar a stage owns and what the countdown says.
   * The two model calls and the two Google calls dominate; the pure functions
   * between them are noise, and a bar that gave them equal thirds would sit
   * still for forty seconds and then jump.
   */
  ms: number;
}

/** The bar's arithmetic, in one table. */
export const PLAN_STAGES: readonly StagePlan[] = [
  { stage: "retrieve", label: "Searching for places", ms: 12_000 },
  // Both only fire in themed mode; a geographic run skips straight past them,
  // which moves the bar forward and never backward. The theme call is on the
  // critical path — nothing can be explored until the anchors are known.
  { stage: "theme", label: "Deciding what each day is about", ms: 7_000 },
  { stage: "explore", label: "Looking around each day's anchor", ms: 6_000 },
  { stage: "cluster", label: "Grouping them by neighbourhood", ms: 400 },
  { stage: "hydrate", label: "Reading reviews and details", ms: 8_000 },
  // Not 600ms, which is what the cache read alone costs. On a city nobody has
  // planned before this stage also uploads a JSONL and creates the durable
  // batch, and the bar parking on one label for four seconds reads as a hang.
  { stage: "enrich", label: "Recalling what we know about each place", ms: 4_000 },
  { stage: "assign", label: "Choosing what goes on which day", ms: 20_000 },
  { stage: "schedule", label: "Building each day's timeline", ms: 600 },
  { stage: "photos", label: "Fetching photos for your stops", ms: 6_000 },
  { stage: "narrate", label: "Writing up your trip", ms: 15_000 },
  { stage: "save", label: "Saving your itinerary", ms: 2_000 },
];

const TOTAL_STAGE_MS = PLAN_STAGES.reduce((sum, entry) => sum + entry.ms, 0);

/**
 * Where a stage sits on the bar, and what the loading screen needs to animate
 * across it: the percentage it starts at, the percentage it ends at, its own
 * expected duration, and the seconds left in the whole run.
 *
 * Exported because two callers need identical numbers — this module emits the
 * progress and `src/lib/db/itineraries.ts` turns it into a `jobs.progress` row.
 * A second copy of this arithmetic is a countdown nothing keeps honest.
 */
export function stageOutlook(stage: PlanStage): {
  index: number;
  percent: number;
  nextPercent: number;
  stageMs: number;
  etaSeconds: number;
} {
  if (stage === "done") {
    return {
      index: PLAN_STAGES.length,
      percent: 100,
      nextPercent: 100,
      stageMs: 0,
      etaSeconds: 0,
    };
  }
  const index = PLAN_STAGES.findIndex((entry) => entry.stage === stage);
  const before = PLAN_STAGES.slice(0, index).reduce((sum, entry) => sum + entry.ms, 0);
  const own = PLAN_STAGES[index].ms;
  return {
    index,
    percent: Math.round((before / TOTAL_STAGE_MS) * 100),
    nextPercent: Math.round(((before + own) / TOTAL_STAGE_MS) * 100),
    stageMs: own,
    etaSeconds: Math.round((TOTAL_STAGE_MS - before) / 1000),
  };
}

function progressFor(stage: Exclude<PlanStage, "done">): PlanProgress {
  const outlook = stageOutlook(stage);
  return {
    stage,
    label: PLAN_STAGES[outlook.index].label,
    percent: outlook.percent,
    done: outlook.index,
    total: PLAN_STAGES.length,
  };
}

/** The terminal progress: the whole bar, every stage accounted for. */
export function completedProgress(): PlanProgress {
  return {
    stage: "done",
    label: "Your trip is ready",
    percent: 100,
    done: PLAN_STAGES.length,
    total: PLAN_STAGES.length,
  };
}

// ── dates and weekdays ───────────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `"2026-09-14"` → the UTC-midnight instant for that calendar date.
 *
 * A bare `new Date("2026-09-14")` is already UTC midnight, which is the trap:
 * reading `getDay()` off it gives the *host's* weekday, and west of Greenwich
 * that is the day before. So the date is parsed into its three numbers and
 * every reading is a `getUTC*` — nothing in here can be moved by the machine's
 * timezone.
 */
export function parseIsoDate(iso: string): Date {
  const match = ISO_DATE.exec(iso.trim());
  if (!match) throw new Error(`start date must be "YYYY-MM-DD", got "${iso}"`);
  const [, year, month, day] = match;
  const utc = Date.UTC(Number(year), Number(month) - 1, Number(day));
  const date = new Date(utc);
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() !== Number(month) - 1 ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new Error(`"${iso}" is not a real calendar date`);
  }
  return date;
}

/** 0 = Sunday … 6 = Saturday — the Places API's numbering, which `hours.ts` shares. */
export function weekdayOf(iso: string): Weekday {
  return parseIsoDate(iso).getUTCDay() as Weekday;
}

/** `("2026-09-14", 1)` → `"2026-09-15"`. Calendar arithmetic, not clock arithmetic. */
export function addDays(iso: string, days: number): string {
  const date = new Date(parseIsoDate(iso).getTime() + days * 24 * 60 * 60 * 1000);
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Day `n` of a trip that starts on `weekday`. */
export function advanceWeekday(weekday: Weekday, days: number): Weekday {
  return (((weekday + days) % 7) + 7) % 7 as Weekday;
}

// ── the search locality ──────────────────────────────────────────────────────

/**
 * The place name that goes into every Text Search query.
 *
 * `PlanRequest` has always carried a `country`, and until now nothing did
 * anything with it: `buildSearchPlan` takes a single string and interpolates it
 * into "specialty coffee {city}". So a request for Springfield searched the
 * planet for Springfields, and there was no way to say which one.
 *
 * The country is appended only when it adds something. That qualifier matters
 * for the demo: Singapore is a city-state, so the create flow sends
 * `city: "Singapore", country: "Singapore"`, the two compare equal, and the
 * query stays the literal string `"Singapore"` — byte-identical to what shipped
 * before, which means the same `searchCacheKey` and the same cached rows.
 * `pipeline.test.ts` pins that. Kyoto with a country becomes "Kyoto, Japan".
 */
export function searchLocality(city: string, country?: string): string {
  const place = city.trim();
  const nation = country?.trim();
  if (!nation) return place;
  return nation.toLowerCase() === place.toLowerCase() ? place : `${place}, ${nation}`;
}

// ── travel legs ──────────────────────────────────────────────────────────────

/**
 * How many of a day's replacements go into the travel matrix.
 *
 * `alternatesFor` hands back the whole rest of the cluster — forty-odd places —
 * and routing all of them would multiply the day's elements for pairs a repair
 * will almost never reach. Six is well past what `MAX_REPAIR_ROUNDS` can spend.
 * Anything beyond it that does get swapped in is served by the estimator and
 * shows up in `stats.travel.estimated`, rather than being hidden.
 */
const MATRIX_ALTERNATES = 6;

/**
 * Where a leg's minutes come from.
 *
 * `"estimate"` is `travel-estimate.ts`: no network, no key, no bill, and a
 * model fitted against the legs Google did route. `"matrix"` is `routes.ts`,
 * which measures and charges per element.
 *
 * The default is `"estimate"`, and that is a deliberate reversal of this
 * repo's usual rule. "A product default lives at the caller, not in the
 * library" is about choices that change what a traveller gets. This one
 * changes what a run *spends*, and a library whose default is to spend money
 * bills whoever forgets it is there. Opting in should be the visible act;
 * opting out should not have to be.
 */
export type TravelRouting = "estimate" | "matrix";

/**
 * The one travel row on `jobs.result.stats`, whichever path produced it.
 *
 * The estimator's counters are trip-wide because the estimator itself is, so
 * they are read straight off it rather than summed — summing a single object
 * once per day is how "kept 8 of 7" bugs get written.
 */
function travelStatsFor(
  routing: TravelRouting,
  injected: boolean,
  perDay: readonly TravelMatrixStats[],
  estimate: TravelEstimateStats,
): { travel?: PlanStats["travel"] } {
  if (injected) return {};
  if (routing === "estimate") {
    return { travel: { source: "estimate", walk: estimate.walk, transit: estimate.transit } };
  }
  return perDay.length > 0 ? { travel: sumTravelStats(perDay) } : {};
}

/**
 * Adds the per-day matrices into one set of counters for `jobs.result.stats`.
 *
 * `errors` is deduplicated because a key without the Routes API enabled fails
 * identically on every request, and twelve copies of one sentence reads like
 * twelve faults.
 */
function sumTravelStats(perDay: readonly TravelMatrixStats[]): PlanStats["travel"] {
  return {
    source: "matrix",
    requests: perDay.reduce((total, day) => total + day.requests, 0),
    walkLegs: perDay.reduce((total, day) => total + day.walkLegs, 0),
    transitLegs: perDay.reduce((total, day) => total + day.transitLegs, 0),
    chosenTransit: perDay.reduce((total, day) => total + day.chosenTransit, 0),
    estimated: perDay.reduce((total, day) => total + day.estimated, 0),
    errors: [...new Set(perDay.flatMap((day) => day.errors))],
  };
}

// ── the result ───────────────────────────────────────────────────────────────

/**
 * The leg leaving one stop — `itinerary_activities.travel_to_next`.
 *
 * Declared here rather than imported from `src/lib/db/schema.ts` because the
 * dependency runs the other way: the schema imports planner types, and the
 * planner knows nothing about Postgres. `src/lib/db/itineraries.ts` pins the
 * two shapes together at compile time so they cannot drift apart.
 */
export interface TravelToNext {
  mode: TravelMode;
  minutes: number;
  meters: number;
}

export interface PlannedDay {
  dayIndex: number;
  /** ISO date for this day, derived from `startDate`. */
  date: string;
  areaName?: string;
  weekday: Weekday;
  day: PackedDay;
  input: PackDayInput;
  repairs: Repair[];
  failures: ValidationFailure[];
  /**
   * The leg leaving each stop, by `place_id`. Built here because the timeline's
   * `travel` segments carry names and minutes but not metres, and the leg
   * provider — which knows the metres — lives in this module.
   */
  travelToNext: Map<string, TravelToNext>;
}

/** Per-stage counters — the "why isn't X in my trip" answer, in numbers. */
export interface PlanStats {
  retrieval: RetrievalStats;
  /**
   * The Nearby Searches the themed path added. A different SKU from the bulk
   * Text Search above and counted apart from it, because "what did themes
   * cost" is a question somebody will ask. Absent on a geographic run.
   */
  explore?: RetrievalStats;
  /** Themed runs only. How many days got a premise, how many fell back, and
   *  how many needed the feasibility ladder to be able to seat a meal. */
  theming?: {
    themed: number;
    fellBack: number;
    repaired: number;
    /**
     * Days that walked the whole ladder and still cannot seat their meals.
     * Distinct from `repaired`, which counts only the rungs that *worked* — a
     * live Bali day tried all three, fixed nothing, and was invisible in every
     * counter here.
     */
    unfixed: number;
    /** Places that sat outside every theme's reach and joined no day. */
    unclaimed: number;
  };
  clustering: {
    /** Candidates with coordinates, which is all clustering can place. */
    located: number;
    unlocated: number;
    clusters: number;
    /** Clusters that cannot seat a day's meals. See `ScoredCluster.shortfall`. */
    shortfalls: number;
    /** Days with no cluster at all — a thin city, reported not hidden. */
    daysWithoutCluster: number;
  };
  funnel: FunnelStats;
  hydration: ShortlistHydrationStats;
  enrichment: EnrichmentReadStats;
  /**
   * The live fetch for what the cache missed. Absent when nothing missed.
   *
   * `failed` is the one to read: each one is a place that shipped on the type
   * heuristic, which is a complete-looking itinerary built on a table of round
   * numbers — the exact failure this stage exists to prevent.
   */
  enrichedNow?: {
    requested: number;
    enriched: number;
    failed: number;
    /** Answers used by this plan but not cached for the next one. */
    storeError?: string;
  };
  assignment: {
    days: number;
    /** Days Pass B could not fill, served by the ranked fallback instead. */
    fallbackDays: number;
    droppedIds: number;
  };
  scheduling: {
    scheduled: number;
    dropped: number;
    repairs: number;
    /** Days that came back `ok: false` — a meal nothing could replace. */
    failedDays: number;
  };
  /**
   * How this trip's travel times were arrived at. Absent when a caller injected
   * its own `getTravelLeg`, which is every test and the offline harness.
   *
   * A union rather than one shape with a flag, because the two paths have
   * genuinely different things to report and sharing a field name between them
   * would mean one of the two names is a lie. `source` is the discriminant, and
   * it exists because a trip built on the model and a trip built on measurement
   * look identical from the outside — the stops, the clock and the modes all
   * render the same way, and only this says which one you are looking at.
   */
  travel?:
    | {
        source: "matrix";
        requests: number;
        walkLegs: number;
        transitLegs: number;
        /** Legs served as transit because it genuinely beat walking. */
        chosenTransit: number;
        /**
         * Lookups answered by crow-flight instead of by Google. Every leg
         * degrades rather than failing, so a run where routing never worked
         * produces exactly the itinerary it produced before and says nothing —
         * unless this counter is looked at. `errors` carries the reason, once
         * per distinct message.
         */
        estimated: number;
        errors: string[];
      }
    | {
        source: "estimate";
        /** Distinct pairs the model answered, by the mode it chose. */
        walk: number;
        transit: number;
      };
  photos: PhotoStats;
  narration: NarrateStats;
  /**
   * Model spend for this plan, per stage, in **tokens**.
   *
   * Not dollars: list prices move, and a stored figure quietly becomes a wrong
   * number about a run nobody can re-measure. `summarizeCost` in `pricing.ts`
   * turns these into money at render time, so correcting a rate re-prices every
   * historical run.
   *
   * Enrichment is here, because it is fetched inside the run that pays for it.
   * Its answers do outlive the trip — the next plan touching those places reads
   * them from `place_enrichments` for nothing — but the tokens were spent
   * building this one.
   */
  cost: StageUsage[];
}

export interface PlanResult {
  request: PlanRequest;
  days: PlannedDay[];
  /** Every place that appears in a timeline, by place_id. */
  places: Map<string, RetrievedPlace>;
  content: Map<string, StopContent>;
  /**
   * The funnel's score and match reasons per shortlisted place. Persistence
   * needs both (`itinerary_activities.score` / `.match_reasons`) and nothing
   * downstream of the funnel recomputes them.
   */
  scored: Map<string, ScoredPlace>;
  funnelStats: FunnelStats;
  /** Per-stage counters, for the "why isn't X in my trip" answer. */
  stats: PlanStats;
  /**
   * What the models said and what we refused — Pass B's per-stop reasoning,
   * every id it named that never became a stop, and the stops that shipped on
   * a narration fallback. Stored on `itineraries.planner_debug`, rendered by
   * nothing. See `debug.ts`.
   */
  debug: PlannerDebug;
}

// ── dependencies ─────────────────────────────────────────────────────────────

export interface PipelineDeps {
  googleApiKey: string;
  cache: SearchCache;
  store: LocationStore;
  enrichments: EnrichmentStore;
  responses: ResponsesClient;
  fetch?: FetchLike;
  blobs?: PhotoBlobStore;
  /** Injected. Nothing in the planner reads the ambient clock or Math.random. */
  now: Date;
  rng: () => number;
  /**
   * Overrides both routing paths outright — no matrix is fetched and no model
   * is consulted. This is every test and the Gate A harness.
   */
  getTravelLeg?: TravelLegProvider;
  /** Defaults to `"estimate"`. `"matrix"` is the one that costs money. */
  routing?: TravelRouting;
  onProgress?: (progress: PlanProgress) => void | Promise<void>;
}

// ── the run ──────────────────────────────────────────────────────────────────

/**
 * Runs the whole plan and returns everything a caller needs to store it.
 *
 * It does not persist, and it does not know what a job is. What it does own is
 * the order of the stages and the progress emitted before each one — a caller
 * that wants a different order wants a different pipeline.
 */
export async function runPlan(request: PlanRequest, deps: PipelineDeps): Promise<PlanResult> {
  const { profile } = request;
  // The traveller's persona becomes constants here, once, and travels as
  // parameters from this line down. No stage below reads a `PersonaResult`, and
  // with no persona every one of these is what it was before personas existed.
  const knobs = resolvePlannerKnobs(profile, request.persona?.result, profile.pace);
  // The persona as prompt words, built once. Undefined without a persona, which
  // is what keeps every prompt in this run byte-identical to what it was.
  const brief = personaBriefFor(request.persona);
  const packKnobs: PackKnobs = {
    visitDurationBias: knobs.visitDurationBias,
    walkMaxMeters: knobs.walkMaxMeters,
    // Read by nothing before this: `mealMinutes` sized Pass B's budget and
    // never the meal it is named for. See `MEAL_MAX_MINUTES` in `pack.ts`.
    mealMinutes: knobs.mealMinutes,
  };
  const routing = deps.routing ?? "estimate";
  // Built once for the whole trip, not per day: the model has no departure time
  // in it, so a leg is the same on Tuesday as on Sunday and the memo is worth
  // more the longer it lives. Its counters are therefore trip-wide already, and
  // must not be summed per day the way the matrices are.
  const estimate = createTravelEstimate(knobs.walkMaxMeters);
  const getTravelLeg = deps.getTravelLeg ?? estimate.getTravelLeg;

  /**
   * One day's travel provider.
   *
   * An injected `getTravelLeg` wins outright and neither path runs — that is
   * every test and the Gate A harness. Otherwise `routing` decides, and the
   * model is the default: see `TravelRouting`.
   *
   * On the matrix path, `departureDate` is the day's own date, so a Sunday leg
   * is not priced on a Tuesday service. `departureTimeFor` turns it into
   * mid-morning local, with the offset estimated from the places' longitude
   * because the planner has no timezone. The estimator is kept underneath it
   * for pairs Google cannot answer.
   */
  const travelFor = async (
    places: readonly CandidatePlace[],
    date: string,
  ): Promise<{ getTravelLeg: TravelLegProvider; stats?: TravelMatrixStats }> => {
    if (deps.getTravelLeg) return { getTravelLeg: deps.getTravelLeg };
    if (routing === "estimate") return { getTravelLeg };
    const matrix = await buildTravelMatrix(places, getTravelLeg, {
      apiKey: deps.googleApiKey,
      fetch: deps.fetch,
      departureDate: date,
      now: deps.now,
    });
    return matrix;
  };

  const report = async (stage: Exclude<PlanStage, "done">) => {
    await deps.onProgress?.(progressFor(stage));
  };

  // 1 — retrieval. Cache first; only misses reach Google.
  await report("retrieve");
  const searchPlan = buildSearchPlan(profile, searchLocality(request.city, request.country));
  const retrieval = await retrievePlaces(searchPlan, {
    apiKey: deps.googleApiKey,
    cache: deps.cache,
    store: deps.store,
    fetch: deps.fetch,
    now: deps.now,
  });
  const pool = retrieval.places;

  // 2 — what each day is about, and where to look for it. Themed mode only;
  //     every rung of it falls through to the geographic path below.
  const baseWeekday = weekdayOf(request.startDate);
  const dayIndices = Array.from({ length: Math.max(0, request.totalDays) }, (_, i) => i);
  let themed: ThemedPlan | undefined;
  if (request.mode === "themed") {
    themed = await planThemedDays(request, pool, {
      deps,
      knobs,
      brief,
      baseWeekday,
      dayIndices,
      report,
    });
  }
  const poolWithExplored = themed?.pool ?? pool;

  // 3 — clustering, then the funnel. k is the trip's length: one area per day.
  //     Themed mode has already grouped; this is the geographic path.
  await report("cluster");
  const located = poolWithExplored.filter((place) => place.latitude !== undefined);
  const unlocated = poolWithExplored.filter((place) => place.latitude === undefined);
  const clusters =
    themed?.clusters ??
    clusterPlaces(located, {
      k: Math.max(1, Math.min(request.totalDays, request.options?.maxK ?? request.totalDays)),
      rng: deps.rng,
      maxIterations: request.options?.maxIterations,
    });
  const funnel = runFunnel(clusters, profile, {
    unlocated,
    knobs,
    // A themed cluster carries its own day. Ranking them would move a premise
    // onto a different day and dropping an empty one would renumber the rest.
    dayAligned: themed !== undefined,
  });
  const shortlistIds = funnel.shortlist.map((scored) => scored.placeId);
  const scored = new Map(funnel.shortlist.map((entry) => [entry.placeId, entry]));

  // 3 — Atmosphere fields, shortlist only. This is the expensive Details call.
  await report("hydrate");
  const hydration = await hydrateShortlist(poolWithExplored, shortlistIds, {
    apiKey: deps.googleApiKey,
    store: deps.store,
    fetch: deps.fetch,
    now: deps.now,
  });
  // Everything after this point reads the hydrated row, never the pre-hydration
  // snapshot: `servesVegetarianFood` arrives here and the dietary rule in
  // `validate.ts` reads it. The funnel is NOT re-run — hydration only adds
  // fields, and re-filtering would change a shortlist already reported.
  // `poolWithExplored`, never `pool`: in themed mode every place a Nearby
  // Search found lives only in the wider pool. Reading `pool` here drops them
  // from `rows`, and `rows` is what becomes `result.places` — so those stops
  // reach the database with no `location_id`, no photo and no Atmosphere
  // fields, while the itinerary still looks complete. The `notInPool` counters
  // on hydration, enrichment and photos are what this line moves.
  const rows = new Map(poolWithExplored.map((place) => [place.placeId, place]));
  for (const place of hydration.places) rows.set(place.placeId, place);
  const hydratedClusters = funnel.clusters.map((cluster) => rehydrate(cluster, rows));

  // 4 — cached enrichment. A miss is the ordinary cold-city case and blocks
  //     nothing: duration falls to the type heuristic and the card ships plain.
  await report("enrich");
  const enrichment = await readEnrichments(shortlistIds, {
    store: deps.enrichments,
    pool: [...rows.values()],
    now: deps.now,
  });
  const missing = enrichment.misses.flatMap((placeId) => {
    const place = rows.get(placeId);
    return place ? [place] : [];
  });

  /**
   * A cache miss used to mean "queue an OpenAI batch and plan without it". That
   * batch was half price and up to 24 hours, so its answers reached the *next*
   * plan touching these places — which meant every first trip to a city sized
   * its visits from the type table in `duration.ts` and looked complete doing
   * it.
   *
   * So the misses are fetched here, before Pass B, which is where the
   * enrichment stage always claimed to be. It costs about a cent and ~11
   * seconds, and nothing here throws: a place that fails falls to the type
   * heuristic, exactly as a cache miss already did.
   */
  let liveEnrichment: EnrichPlacesResult | undefined;
  if (missing.length > 0) {
    liveEnrichment = await enrichPlaces(missing, {
      client: deps.responses,
      store: deps.enrichments,
      now: deps.now,
    });
    for (const [placeId, value] of liveEnrichment.enrichments) {
      enrichment.enrichments.set(placeId, value);
    }
  }

  // 5 — Pass B. One call for the trip; never throws, degrades to the ranked list.
  await report("assign");
  const dayRequests: AssignDayRequest[] = dayIndices.map((index) => ({
      dayIndex: index,
      weekday: advanceWeekday(baseWeekday, index),
      areaName: hydratedClusters[index]?.label,
      capacity: dayCapacity(profile.pace, DEFAULT_MEALS_PER_DAY, knobs),
  }));
  const assignment: AssignResult = await assignDays(
    {
      profile,
      clusters: hydratedClusters,
      days: dayRequests,
      enrichments: enrichment.enrichments,
      brief,
    },
    { client: deps.responses, effort: "low", promptCacheKey: promptCacheKeyFor(request) },
  );

  // 6 — pack, check, repair, re-pack. Pure: no clock, no network, no model.
  //
  // The wildcards are chosen here rather than inside the funnel because a
  // wildcard must not already be in the trip, and what is in the trip is only
  // known once Pass B has spent its picks. They are added as flex, which means
  // the packer surrenders them first when a day runs long — a surprise that
  // costs you a temple is not a nice surprise.
  await report("schedule");
  const serendipity = assignSerendipity(
    pickSerendipitySlots(funnel.stages.afterGlobalCap, profile, knobs),
    hydratedClusters,
    assignment,
    profile,
    enrichment.enrichments,
  );
  const sequencing: SequencingRecord[] = [];
  const scheduling: SchedulingRecord[] = [];
  const travelStats: TravelMatrixStats[] = [];
  const days: PlannedDay[] = await Promise.all(
    assignment.days.map(async (assigned, index): Promise<PlannedDay> => {
      const cluster = hydratedClusters[index];
      const wildcards = serendipity.get(assigned.dayIndex) ?? [];
      const withFlex: PackDayInput =
        wildcards.length === 0
          ? assigned.input
          : { ...assigned.input, flex: [...(assigned.input.flex ?? []), ...wildcards] };

      // Computed before the matrix rather than after, because the validator's
      // replacements have to be *in* the matrix. A swap whose legs are the only
      // crow-flight ones in an otherwise routed day is worse than either.
      // The reserve is the places `groupByTheme` refused — over half the pool
      // on both the Kyoto fixture and a live Bali run, every one already
      // billed for. It is offered only to a day that cannot feed itself, and
      // only for meal slots; see `mealReserveFor`.
      const alternates = alternatesFor(cluster, withFlex, profile, enrichment.enrichments, {
        places: themed?.unclaimed ?? [],
        walkMaxMeters: knobs.walkMaxMeters,
      });

      // Real travel times for this day's stops, its spares and the handful of
      // replacements a repair might reach for. One pair of matrices, then every
      // lookup below is a map hit — which is what lets `sequenceDay` enumerate
      // orders and `packDay` hunt for a fit without touching the network.
      const dayTravel = await travelFor(
        [
          ...withFlex.assignments.map((assignment) => assignment.place),
          ...(withFlex.flex ?? []).map((pick) => pick.place),
          ...alternates.slice(0, MATRIX_ALTERNATES).map((alternate) => alternate.place),
        ],
        addDays(request.startDate, assigned.dayIndex),
      );
      if (dayTravel.stats) travelStats.push(dayTravel.stats);

      // Route order, before the clock is stamped. Pass B chose these stops
      // without ever seeing a coordinate; this is the only step that has them.
      const sequenced = sequenceDay(withFlex, dayTravel.getTravelLeg);

      const validation = validateDay(sequenced.input, {
        pace: profile.pace,
        weekday: dayRequests[index].weekday,
        profile,
        getTravelLeg: dayTravel.getTravelLeg,
        packKnobs,
        alternates,
      });

      sequencing[index] = {
        dayIndex: assigned.dayIndex,
        beforeMinutes: sequenced.beforeMinutes,
        afterMinutes: sequenced.afterMinutes,
        savedMinutes: sequenced.savedMinutes,
        reordered: sequenced.reordered,
        meters: Math.round(pathMeters(sequenced.input.assignments)),
      };

      // Everything below was already computed and then dropped when the request
      // ended. `stats.scheduling.failedDays` counted these days and could never
      // say which one, or why — which is exactly the question asked the morning
      // after a trip came back with an empty day in it.
      const scheduledStops = validation.day.segments.filter(
        (segment) => segment.kind === "activity",
      ).length;
      scheduling[index] = {
        dayIndex: assigned.dayIndex,
        areaName: assigned.areaName ?? null,
        offered:
          sequenced.input.assignments.length + (sequenced.input.flex?.length ?? 0),
        scheduled: scheduledStops,
        repairs: validation.repairs.map((repair) => ({
          rule: repair.rule,
          role: repair.role,
          removed: repair.removed.name,
          inserted: repair.inserted?.name ?? null,
          reason: repair.reason,
        })),
        failures: validation.failures.map((failure) => ({
          rule: failure.rule,
          role: failure.role,
          placeId: failure.placeId,
          name: failure.name,
          reason: failure.reason,
        })),
        // Most stops that go missing are not repairs. `packDay` cuts for time
        // and there is no swap-in to record, so a day reading "kept 4 of 7"
        // with one repair line left three stops unaccounted for on the page.
        // `validateDay` has already merged its own cuts into this list.
        dropped: validation.day.dropped.map((record) => ({
          placeId: record.placeId,
          name: record.name,
          reason: record.reason,
        })),
      };

      // Warned as it happens as well as stored, following the same rule the
      // assignment drops follow: the dev terminal is where somebody is actually
      // looking while a plan runs. An empty day is warned about separately
      // because it is the one outcome no traveller can use.
      if (scheduledStops === 0) {
        console.warn(
          `[plan] day ${assigned.dayIndex} (${assigned.areaName ?? "no area"}) ` +
            `shipped EMPTY — ${sequenced.input.assignments.length} stops assigned, ` +
            `${validation.repairs.length} repairs, none survived. ` +
            `Failures: ${validation.failures.map((f) => `${f.rule} ${f.name} (${f.reason})`).join("; ") || "none recorded"}`,
        );
      } else if (validation.failures.length > 0) {
        console.warn(
          `[plan] day ${assigned.dayIndex} (${assigned.areaName ?? "no area"}) ` +
            `kept ${scheduledStops} of ${sequenced.input.assignments.length} assigned stops with ` +
            `${validation.failures.length} unfixed: ` +
            validation.failures.map((f) => `${f.rule} ${f.name} (${f.reason})`).join("; "),
        );
      }

      return {
        dayIndex: assigned.dayIndex,
        date: addDays(request.startDate, assigned.dayIndex),
        areaName: assigned.areaName,
        weekday: dayRequests[index].weekday,
        day: validation.day,
        input: validation.input,
        repairs: validation.repairs,
        failures: validation.failures,
        travelToNext: legsOf(validation, dayTravel.getTravelLeg),
      };
    }),
  );

  // 7 — photos, for the survivors of scheduling only. The signature makes
  //     "resolve everything retrieval found" inexpressible; this call must not
  //     make it expressible again by passing the shortlist.
  await report("photos");
  const survivorIds = survivorIdsFromDays(days.map((planned) => planned.day));
  // The *hydrated* pool, not `retrieval.places`: a photo-resolved row is built
  // by patching the row it was handed, so passing the pre-hydration snapshot
  // here would quietly throw away every Atmosphere field on the way past.
  const photos = await resolvePhotos([...rows.values()], survivorIds, {
    apiKey: deps.googleApiKey,
    store: deps.store,
    fetch: deps.fetch,
    now: deps.now,
    blobs: deps.blobs,
  });
  for (const place of photos.places) rows.set(place.placeId, place);

  // 8 — Pass C. One short call per stop, in parallel, never throws.
  await report("narrate");
  const places = new Map(
    survivorIds.flatMap((placeId) => {
      const row = rows.get(placeId);
      return row ? ([[placeId, row]] as [string, RetrievedPlace][]) : [];
    }),
  );
  const matchReasons = new Map(
    [...scored.entries()].map(([placeId, entry]) => [placeId, entry.reasons]),
  );
  const narration = await narrateStops(
    stopsFromDays(
      days.map((planned) => ({ dayIndex: planned.dayIndex, day: planned.day })),
      places,
      enrichment.enrichments,
      matchReasons,
    ),
    profile,
    {
      client: deps.responses,
      effort: "none",
      promptCacheKey: promptCacheKeyFor(request),
      brief,
      premises: premisesFor(hydratedClusters),
    },
  );

  return {
    request,
    days,
    places,
    content: narration.content,
    scored,
    funnelStats: funnel.stats,
    debug: {
      version: PLANNER_DEBUG_VERSION,
      recordedAt: deps.now.toISOString(),
      assignment: {
        fallbackDays: assignment.days
          .filter((day) => day.fallback)
          .map((day) => day.dayIndex),
        rationale: assignment.rationale,
        dropped: assignment.dropped,
      },
      narration: {
        fallbacks: narration.failures,
        truncated: narration.stats.truncated,
        rejectedDishes: narration.stats.rejectedDishes,
      },
      enrichment: { misses: enrichment.misses },
      sequencing,
      scheduling,
      ...(themed
        ? {
            themes: {
              titles: themed.clusters.flatMap((cluster) =>
                cluster.theme
                  ? [
                      {
                        dayIndex: cluster.theme.dayIndex,
                        title: cluster.theme.title,
                        anchorPlaceId: cluster.theme.anchorPlaceId,
                      },
                    ]
                  : [],
              ),
              fallbacks: themed.rejected,
              repairs: themed.repairs,
              attempts: themed.attempts,
              unclaimed: themed.unclaimedCount,
            },
          }
        : {}),
    },
    stats: {
      retrieval: retrieval.stats,
      // Kept apart from `retrieval` deliberately: they are different SKUs and
      // "how much did the theme path cost" is the question this answers.
      ...(themed?.exploreStats ? { explore: themed.exploreStats } : {}),
      ...(themed
        ? {
            theming: {
              themed: themed.clusters.filter((cluster) => cluster.theme).length,
              fellBack: themed.rejected.length,
              repaired: themed.repairs.length,
              unfixed: themed.attempts.filter((attempt) => attempt.unfixed).length,
              unclaimed: themed.unclaimedCount,
            },
          }
        : {}),
      // Nothing at all when a caller injected its own provider: neither path
      // ran, so there is no honest answer to "where did these minutes come
      // from" and a zeroed row would read as one.
      ...travelStatsFor(routing, deps.getTravelLeg !== undefined, travelStats, estimate.stats),
      clustering: {
        located: located.length,
        unlocated: unlocated.length,
        clusters: funnel.clusters.length,
        shortfalls: funnel.clusters.filter((cluster) => cluster.shortfall !== undefined).length,
        daysWithoutCluster: Math.max(0, request.totalDays - funnel.clusters.length),
      },
      funnel: funnel.stats,
      hydration: hydration.stats,
      enrichment: enrichment.stats,
      ...(liveEnrichment
        ? {
            enrichedNow: {
              requested: liveEnrichment.stats.requested,
              enriched: liveEnrichment.stats.enriched,
              failed: liveEnrichment.stats.failed,
              ...(liveEnrichment.stats.storeError
                ? { storeError: liveEnrichment.stats.storeError }
                : {}),
            },
          }
        : {}),
      assignment: {
        days: assignment.days.length,
        fallbackDays: assignment.days.filter((day) => day.fallback).length,
        droppedIds: assignment.dropped.length,
      },
      scheduling: {
        scheduled: survivorIds.length,
        dropped: days.reduce((sum, planned) => sum + planned.day.dropped.length, 0),
        repairs: days.reduce((sum, planned) => sum + planned.repairs.length, 0),
        failedDays: days.filter((planned) => planned.failures.length > 0).length,
      },
      photos: photos.stats,
      narration: narration.stats,
      cost: [
        // One entry per stage that actually ran. A stage with no calls is
        // omitted rather than shown as a zero: "Pass B was never reached" and
        // "Pass B was free" are different things.
        ...(assignment.usage
          ? [addUsage(emptyStageUsage("assign", MODELS.assign), assignment.usage)]
          : []),
        ...(themed?.usage
          ? [addUsage(emptyStageUsage("theme", MODELS.assign), themed.usage)]
          : []),
        ...(narration.stats.usage.calls > 0 ? [narration.stats.usage] : []),
        // Unlike the batch, a live enrichment belongs to the plan that made it:
        // it was spent to build *this* trip, even though the cached answers go
        // on to serve every later trip that touches the same places.
        ...(liveEnrichment && liveEnrichment.stats.usage.calls > 0
          ? [liveEnrichment.stats.usage]
          : []),
      ],
    },
  };
}

/**
 * OpenAI rejects a `prompt_cache_key` longer than this. A 400, on every call in
 * the run — Pass B, the theme pass and all fifteen narrations — which then
 * degrade to their fallbacks and produce a trip nobody can tell was broken.
 */
export const MAX_PROMPT_CACHE_KEY = 64;

/** How much of the city name survives into the readable half of the key. */
const CACHE_KEY_CITY_CHARS = 16;

/**
 * One cache key for the whole itinerary. OpenAI's prompt caching routes on a
 * prefix hash, so this must be a per-run constant — a per-stop key turns
 * fifteen cache reads into fifteen misses. Keyed on city, profile and persona
 * rather than on a random id, so two travellers with the same taste in the same
 * city share the cache instead of each paying to warm their own.
 *
 * **It is hashed because it has a hard 64-character ceiling and the inputs do
 * not.** Spelled out, "Singapore + four interests + four persona bands" is 84
 * characters, and the provider answers that with a 400 on *every* model call in
 * the run. Each one then degrades to its documented fallback, so the plan still
 * completes and the itinerary still looks like an itinerary — which is why no
 * test caught it and a single real run did. A short readable prefix survives so
 * a key in a log still says which city it belongs to.
 */
export function promptCacheKeyFor(request: PlanRequest): string {
  const { profile } = request;
  const bands = bandsFor(request.persona?.result);
  const city = request.city
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, CACHE_KEY_CITY_CHARS)
    .replace(/^-|-$/g, "");
  const identity = [
    profile.pace,
    [...profile.interests].sort().join("+"),
    [...profile.dietary].sort().join("+"),
    // The four bands, because the persona brief is in the cached prefix now.
    // Without them two personas thrash one key instead of each keeping a warm
    // one. A traveller with no persona reads as the neutral row, so their key
    // is unchanged from run to run.
    bands.spontaneity,
    bands.comfortTolerance,
    bands.immersion,
    bands.solitude,
  ].join(":");
  const digest = createHash("sha256")
    .update(`${request.city.trim().toLowerCase()}:${identity}`)
    .digest("hex")
    .slice(0, 32);
  return `plan:${city}:${digest}`;
}

/**
 * The same cluster, with every member replaced by its hydrated row. `scored` is
 * index-aligned with `places` and is carried across untouched: the score was
 * computed before hydration and re-scoring here would mean the funnel's own
 * output no longer described the shortlist it produced.
 */
function rehydrate(
  cluster: ScoredCluster,
  rows: ReadonlyMap<string, RetrievedPlace>,
): ScoredCluster {
  return {
    ...cluster,
    places: cluster.places.map((place) => rows.get(place.placeId) ?? place),
  };
}

// ── the themed path ──────────────────────────────────────────────────────────

/**
 * Each day's premise, for Pass C's cached prefix.
 *
 * `day` is 1-based to match `schedule.day` in the per-stop payload, which is
 * how a stop finds its own premise without the premise being repeated fifteen
 * times. Empty on a geographic run, and an empty list leaves that prefix
 * byte-identical to the one this pass has always sent.
 */
function premisesFor(clusters: readonly ScoredCluster[]): DayPremise[] {
  return clusters.flatMap((cluster) =>
    cluster.theme
      ? [
          {
            day: cluster.theme.dayIndex + 1,
            title: cluster.theme.title,
            premise: cluster.theme.premise,
          },
        ]
      : [],
  );
}

interface ThemedPlan {
  /** The retrieved pool plus everything the nearby searches found. */
  pool: RetrievedPlace[];
  /** One per day, in day order, empties kept. Handed to the funnel as-is. */
  clusters: ThemedCluster[];
  /** For the diagnostic record: days that fell back, and why. */
  rejected: ThemeRejection[];
  /** Which rung of the feasibility ladder each thin day ended on. */
  repairs: FeasibilityRepair[];
  /** Every day that needed the ladder, including the ones it could not fix. */
  attempts: FeasibilityAttempt[];
  /**
   * Places no theme's circle would claim — the places, because a day with
   * nothing to eat is offered the meal-capable ones as a last resort.
   */
  unclaimed: CandidatePlace[];
  /** `unclaimed.length`, for the counters that only ever wanted the number. */
  unclaimedCount: number;
  /** Nearby-search counters, folded into the run's retrieval stats. */
  exploreStats?: RetrievalStats;
  /** The theme call's token usage. It runs on `MODELS.assign`, the expensive
   *  model, so a themed plan costs two calls on it rather than one. */
  usage?: ResponsesUsage;
}

interface ThemedContext {
  deps: PipelineDeps;
  knobs: PlannerKnobs;
  brief?: PersonaBrief;
  baseWeekday: Weekday;
  dayIndices: readonly number[];
  report: (stage: Exclude<PlanStage, "done">) => Promise<void>;
}

/**
 * Survey, theme, explore, group — the four stages that turn a pool of places
 * into days that are about something.
 *
 * **Nothing here throws.** Every failure is a day, or a whole trip, quietly
 * falling back to geography: `planThemes` returns an empty list rather than
 * raising, a failed nearby search lands in `stats.failures` and leaves the pool
 * as it was, and `groupByTheme` clusters whatever no theme claimed. The worst
 * case for a themed run is exactly the default run, one model call poorer.
 */
async function planThemedDays(
  request: PlanRequest,
  pool: readonly RetrievedPlace[],
  context: ThemedContext,
): Promise<ThemedPlan> {
  const { deps, knobs, brief, baseWeekday, dayIndices, report } = context;
  await report("theme");

  // Deterministic, free, and the reason the model is labelling rather than
  // inventing: it can only name places this survey already found.
  const survey = surveyCity(pool, {
    city: request.city,
    totalDays: request.totalDays,
    rng: deps.rng,
  });

  // Both halves of what a theme may name are evidence from the pool: the ids an
  // anchor may be, and the Places types this city demonstrably has. The second
  // is not pedantry — Google 400s the *entire* Nearby Search if one type is not
  // searchable, and a live Singapore run lost two whole circles to `food`.
  const vocabulary = {
    placeIds: new Set(pool.map((place) => place.placeId)),
    types: new Set(pool.flatMap((place) => place.types)),
  };
  const themes = await planThemes(
    {
      survey,
      profile: request.profile,
      brief,
      days: dayIndices.map((dayIndex) => ({
        dayIndex,
        weekday: advanceWeekday(baseWeekday, dayIndex),
      })),
    },
    vocabulary,
    {
      client: deps.responses,
      effort: "low",
      promptCacheKey: promptCacheKeyFor(request),
    },
  );

  await report("explore");
  const explored = await explorePlaces(request, pool, themes.themes, knobs, deps);
  let exploreStats = explored.stats;

  const merged = new Map(pool.map((place) => [place.placeId, place]));
  for (const place of explored.places) merged.set(place.placeId, place);
  const mergedPool = [...merged.values()];

  const grouped = groupByTheme({
    places: mergedPool,
    themes: themes.themes,
    pool: merged,
    totalDays: request.totalDays,
    rng: deps.rng,
  });
  if (grouped.unclaimed.length > 0) {
    console.warn(
      `[group] ${grouped.unclaimed.length} place${grouped.unclaimed.length === 1 ? "" : "s"} sat outside every theme's reach and joined no day`,
    );
  }

  // A theme that cannot seat two meals, repaired without a second model call.
  // Rung 1 costs one more Nearby Search on a thin day only; rungs 2 and 3 are
  // free. Every rung is recorded — a repair that silently shrinks a list is the
  // bug this project already knows about.
  const repaired = await repairFeasibility(grouped.clusters, {
    mealsPerDay: FUNNEL_DEFAULTS.mealsPerCluster,
    // Asked about *this* traveller. A vegetarian's day of five steakhouses used
    // to count as fed, so the ladder never ran on the days that needed it most.
    dietary: request.profile.dietary,
    widen: async (cluster) => {
      if (!cluster.theme) return [];
      const wider = await explorePlaces(
        request,
        mergedPool,
        [{ ...cluster.theme, radiusHint: widenHint(cluster.theme.radiusHint) }],
        knobs,
        deps,
      );
      for (const place of wider.places) merged.set(place.placeId, place);
      // Folded in rather than dropped. Each widen is three more billed circles
      // now, and they are spent on the days going worst — reporting only the
      // opening searches made those days read as the cheapest in the trip. A
      // widen that 400s lands in `failures` here for the same reason: "found
      // nothing" and "was rejected" need different fixes.
      exploreStats = exploreStats
        ? wider.stats
          ? mergeRetrievalStats(exploreStats, wider.stats)
          : exploreStats
        : wider.stats;
      return wider.places;
    },
    // The geographic cluster for a day only exists once themes have claimed
    // what they wanted, so it is computed from the leftovers the same way
    // `groupByTheme` does — one k-means over what no theme is using.
    geographicFor: (dayIndex) => geographicFallbackFor(grouped.clusters, dayIndex, deps.rng),
  });

  return {
    pool: [...merged.values()],
    clusters: repaired.clusters,
    repairs: repaired.repairs,
    attempts: repaired.attempts,
    unclaimed: grouped.unclaimed,
    unclaimedCount: grouped.unclaimed.length,
    rejected: [
      ...themes.rejected,
      // A day that had a theme and lost it during grouping — an anchor Google
      // gave no coordinates for — is the same outcome and belongs in the same
      // list, or the debug page says a day fell back for no reason.
      ...grouped.geographicDays
        .filter((day) => !themes.rejected.some((entry) => entry.dayIndex === day))
        .map((dayIndex) => ({
          dayIndex,
          reason: "the anchor has no coordinates to search around",
        })),
    ],
    exploreStats,
    usage: themes.usage,
  };
}

/**
 * The dietary phrases to ask near an anchor, with `{city}` interpolated.
 *
 * Empty for a traveller with no needs, which is what keeps this free for
 * everybody else — and empty for a need `dietaryBridgeFor` has no phrases for,
 * rather than inventing one. An invented query is a billed call that returns
 * whatever Google makes of a word we chose.
 */
function dietaryQueriesFor(dietary: readonly string[], city: string): string[] {
  const queries = dietary.flatMap(
    (need) => dietaryBridgeFor(need)?.queries.map((q) => q.replaceAll("{city}", city)) ?? [],
  );
  return [...new Set(queries)];
}

/** One step wider. `wide` is already the top of the scale. */
function widenHint(hint: DayTheme["radiusHint"]): DayTheme["radiusHint"] {
  return hint === "tight" ? "walkable" : "wide";
}

/**
 * A day's plain geographic cluster, for the last rung of the ladder.
 *
 * Built over the places every *other* day is not using, so a day that gives up
 * its premise does not simply take a copy of the day beside it. One cluster is
 * asked for, because one day is being replaced.
 */
function geographicFallbackFor(
  clusters: readonly ThemedCluster[],
  dayIndex: number,
  rng: () => number,
): ThemedCluster | undefined {
  const claimedElsewhere = new Set(
    clusters
      .filter((cluster) => cluster.theme?.dayIndex !== dayIndex)
      .flatMap((cluster) => cluster.places.map((place) => place.placeId)),
  );
  const own = clusters.find((cluster) => cluster.theme?.dayIndex === dayIndex);
  const available = clusters
    .flatMap((cluster) => cluster.places)
    .filter((place) => !claimedElsewhere.has(place.placeId) && place.latitude !== undefined);
  if (available.length === 0) return undefined;
  const [cluster] = clusterPlaces([...available], { k: 1, rng });
  return cluster ? { ...cluster, label: own?.label } : undefined;
}

/**
 * One Nearby Search per theme, around its verified anchor.
 *
 * It goes through `retrievePlaces` rather than calling Google directly, which
 * is what gives it the cache, the location persistence, the dedupe and the
 * stats for free — and, more to the point, the rule that a cache entry is
 * published only after its rows land. A second path to Google would be a
 * second place for that to be forgotten.
 */
async function explorePlaces(
  request: PlanRequest,
  pool: readonly RetrievedPlace[],
  themes: readonly DayTheme[],
  knobs: PlannerKnobs,
  deps: PipelineDeps,
): Promise<{ places: RetrievedPlace[]; stats?: RetrievalStats }> {
  const byPlaceId = new Map(pool.map((place) => [place.placeId, place]));
  const requests = themes.flatMap((theme) => {
    const anchor = byPlaceId.get(theme.anchorPlaceId);
    if (anchor?.latitude === undefined || anchor.longitude === undefined) return [];
    const centre = { latitude: anchor.latitude, longitude: anchor.longitude };
    // The hint alone. How far this traveller will walk between two stops is
    // a different question from how much city to search — see `radiusFor`.
    const radius = radiusFor(theme.radiusHint);
    return [
      // The premise, twice, ranked both ways.
      //
      // `rankPreference` is one enum per request, so "near AND notable" is two
      // circles or it is neither. Distance alone never returns the famous
      // museum three kilometres out; popularity alone returned twenty places in
      // Kuta for a circle centred in Nusa Dua. Neither is wrong — they answer
      // different questions, and *which one this traveller wants is already a
      // persona decision*: `weights.popularity` is signed and
      // `touristTrapPenalty` sets its direction, so a deep-immersion traveller
      // wants the obscure place and a highlights traveller wants the famous
      // one. Letting Google rank by popularity alone throws away the
      // low-popularity tail twenty places before `scorePlace` ever sees it, and
      // no knob downstream can get it back. Union first, decide after.
      //
      // Overlap is free: `retrievePlaces` dedupes and counts
      // `duplicatesDropped`.
      nearbyRequest(request.city, centre, radius, theme.includedTypes, "DISTANCE"),
      nearbyRequest(request.city, centre, radius, theme.includedTypes, "POPULARITY"),
      // Somewhere to eat, near. One circle and not two: lunch has to be
      // walkable from the rest of the day, and among the near ones `scorePlace`
      // can still prefer the popular one. Two circles rather than one merged
      // type list because a request returns at most twenty places — shared
      // between museums and restaurants that is ten of each, and the day needs
      // both.
      //
      // The radius is deliberately identical to the premise circle's. The Bali
      // day that prompted this failed on *types*, not distance — the two
      // nearest food places were 1.1 km inside a circle that was never asked
      // about food — and a wider meal circle would return restaurants beyond
      // `MEMBER_RADIUS_SLACK`, which `groupByTheme` then refuses to seat on the
      // day anyway. One variable moves, which is what makes it measurable.
      nearbyRequest(
        request.city,
        centre,
        radius,
        mealSearchTypes(request.profile.dietary),
        "DISTANCE",
      ),
      // And the phrases, for a traveller with a dietary need.
      //
      // The meal circle asks Google for *types*, and `includedTypes` is coarse
      // on exactly this question: a great vegetarian-friendly izakaya is typed
      // `izakaya_restaurant`, never `vegetarian_restaurant`, so a type search
      // finds the places that label themselves and misses everywhere that
      // simply has good vegetarian food. `dietaryBridgeFor` already carries the
      // phrases that catch that tail — they were only ever fired **city-wide**,
      // where results cluster wherever the city is busiest rather than where
      // this day actually is.
      //
      // Only for a traveller who has a need, so nobody else pays for it.
      ...dietaryQueriesFor(request.profile.dietary, searchLocality(request.city, request.country)).map(
        (query) => textNearRequest(request.city, query, centre, radius),
      ),
    ];
  });
  if (requests.length === 0) return { places: [] };

  const result = await retrievePlaces(requests, {
    apiKey: deps.googleApiKey,
    cache: deps.cache,
    store: deps.store,
    fetch: deps.fetch,
    now: deps.now,
  });
  return { places: result.places, stats: result.stats };
}

/**
 * Puts each wildcard on the day whose cluster already holds it, as a flex pick.
 *
 * A wildcard on the wrong side of the city is not serendipity, it is a
 * two-hour bus ride — so a pick whose cluster produced no day, or that Pass B
 * already spent, is dropped rather than forced somewhere. Zero picks is the
 * ordinary case: `serendipityPerTrip` is 0 without a persona and 0 for every
 * band except `improvised`.
 *
 * Exported for its own test. Whether a wildcard landed on the right day is not
 * observable from a finished itinerary — a flex pick and an assigned stop look
 * identical once the timeline is stamped.
 */
export function assignSerendipity(
  picks: readonly CandidatePlace[],
  clusters: readonly ScoredCluster[],
  assignment: AssignResult,
  profile: PreferenceProfile,
  enrichments: ReadonlyMap<string, PlaceEnrichment>,
): Map<number, FlexPick[]> {
  const byDay = new Map<number, FlexPick[]>();
  if (picks.length === 0) return byDay;

  const alreadyPlanned = new Set(
    assignment.days.flatMap((day) => [
      ...day.input.assignments.map((slot) => slot.place.placeId),
      ...(day.input.flex ?? []).map((flex) => flex.place.placeId),
    ]),
  );

  for (const pick of picks) {
    if (alreadyPlanned.has(pick.placeId)) continue;
    const clusterIndex = clusters.findIndex((cluster) =>
      cluster.places.some((place) => place.placeId === pick.placeId),
    );
    const day = assignment.days[clusterIndex];
    if (clusterIndex < 0 || !day) continue;
    const entry: FlexPick = {
      place: pick,
      // Scored the same way every other candidate on this day was, so the
      // packer's "drop the worst flex pick first" rule stays comparable.
      score: scorePlace(pick, profile).score,
      duration: resolveVisitDuration(pick, enrichments.get(pick.placeId), profile.pace),
    };
    byDay.set(day.dayIndex, [...(byDay.get(day.dayIndex) ?? []), entry]);
  }
  return byDay;
}

/**
 * The fallback queue for one day: everything the funnel put in this cluster
 * that Pass B did not spend. This is the whole of what repair may draw on —
 * `validate.ts` never re-asks the model.
 *
 * Exported for its own test. Which rung of the duration ladder a repair lands
 * on is not observable from a finished itinerary without building a fixture
 * that forces a swap, and it is exactly the thing that was wrong here.
 */
export function alternatesFor(
  cluster: ScoredCluster | undefined,
  input: PackDayInput,
  profile: PreferenceProfile,
  enrichments: ReadonlyMap<string, PlaceEnrichment>,
  /**
   * Required, not optional. Forgetting to pass it is the one failure mode a
   * test cannot catch — an empty reserve behaves exactly like no reserve, so a
   * caller that silently stopped wiring it would keep every assertion green.
   * Making it a parameter makes that a compile error instead. A caller with
   * genuinely nothing to offer passes `NO_MEAL_RESERVE` and says so.
   */
  reserve: MealReserve,
): Alternate[] {
  if (!cluster) return [];
  const used = new Set([
    ...input.assignments.map((assignment) => assignment.place.placeId),
    ...(input.flex ?? []).map((pick) => pick.place.placeId),
  ]);
  const alternates = cluster.places.flatMap((place, index) =>
    used.has(place.placeId)
      ? []
      : [
          {
            place,
            score: cluster.scored[index]?.score ?? 0,
            // The same rung of the ladder Pass B used. Passing `undefined` here
            // would drop every repair to the type heuristic, so one museum
            // would be 90 minutes when the model picked it and 60 when the
            // validator swapped it in — the same place, two lengths.
            duration: resolveVisitDuration(place, enrichments.get(place.placeId), profile.pace),
          },
        ],
  );

  // On the themed path this cluster *is* the theme's members, so a repair
  // already draws from theme-mates. What it does not do by default is prefer
  // one that keeps the day's premise — and a swap that quietly turns the food
  // day into an aquarium is the premise breaking with nothing to show for it.
  // Stable within each group, so the funnel's ranking still orders the queue.
  const wanted = cluster.theme?.includedTypes;
  const ordered =
    !wanted || wanted.length === 0
      ? alternates
      : (() => {
          const onTheme = (alternate: Alternate) =>
            wanted.some((type) => alternate.place.types.includes(type));
          return [...alternates.filter(onTheme), ...alternates.filter((a) => !onTheme(a))];
        })();

  return [...ordered, ...mealReserveFor(cluster, used, profile, enrichments, reserve)];
}

/**
 * The pool `alternatesFor` may reach into when a day has nothing to eat, plus
 * the one knob that bounds how far it may reach.
 */
export interface MealReserve {
  places: readonly CandidatePlace[];
  /** `PlannerKnobs.walkMaxMeters` — how far this traveller goes between stops. */
  walkMaxMeters: number;
}

/** For a caller with nothing to offer — a geographic run, or a test about
 *  something else. Explicit, so "no reserve" is a decision on the page. */
export const NO_MEAL_RESERVE: MealReserve = { places: [], walkMaxMeters: 0 };

/**
 * Places no theme claimed, offered to a day that would otherwise go hungry.
 *
 * `groupByTheme` refuses a place further from an anchor than
 * `MEMBER_RADIUS_SLACK` allows, which is the right rule and leaves over half
 * the pool on the floor — 45 of 84 on the Kyoto fixture, 87 of 151 on a live
 * Bali run. Every one is already retrieved and already billed for. Meanwhile
 * `validate.ts` could only ever repair from the day's own cluster, so a themed
 * day whose circle contained nothing edible shipped with `lost_meal` while the
 * restaurants that would have fixed it sat unused.
 *
 * Three rules keep this from becoming the "5.7 km cafe" bug over again:
 *
 * 1. **Meal-capable only.** Not a general-purpose top-up. `admits` refuses a
 *    restaurant for a plain activity and `withFill` excludes them outright, so
 *    a list of restaurants can reach a meal slot or a cafe break and nothing
 *    else. The containment is structural rather than a promise made here.
 * 2. **This traveller's meals.** `mealSlotReason` is the same predicate the
 *    validator enforces, so a vegetarian is never offered a steakhouse.
 * 3. **A hard distance cap, and it is wider than membership on purpose.** These
 *    places are outside the membership reach *by definition*, so reusing that
 *    bound would return nothing. `MEAL_RESERVE_REACH` is the day's own circle
 *    plus one hop as far as this traveller travels between stops. A transit
 *    ride to lunch beats no lunch; a transit ride across the city does not.
 *
 * Sorted nearest-first and appended **last**, so the cluster's own ranked
 * candidates are always spent before anything from outside it.
 */
function mealReserveFor(
  cluster: ScoredCluster,
  used: ReadonlySet<string>,
  profile: PreferenceProfile,
  enrichments: ReadonlyMap<string, PlaceEnrichment>,
  reserve: MealReserve,
): Alternate[] {
  if (reserve.places.length === 0 || !cluster.theme) return [];
  const centre = cluster.centroid;
  if (centre.latitude === undefined || centre.longitude === undefined) return [];
  const reach = radiusFor(cluster.theme.radiusHint) * MEMBER_RADIUS_SLACK + reserve.walkMaxMeters;

  return reserve.places
    .flatMap((place) =>
      used.has(place.placeId) ||
      place.latitude === undefined ||
      place.longitude === undefined ||
      mealSlotReason(place, profile) !== undefined
        ? []
        : [
            {
              place,
              metres: metersBetween(
                { latitude: place.latitude, longitude: place.longitude },
                { latitude: centre.latitude, longitude: centre.longitude },
              ),
            },
          ],
    )
    .filter((entry) => entry.metres <= reach)
    .sort((a, b) => a.metres - b.metres)
    .map(({ place }) => ({
      place,
      // Zero: these never competed in the funnel, so they hold no score of
      // their own, and a borrowed number would order them against places that
      // earned theirs. The queue position is the ranking — last, nearest first.
      score: 0,
      duration: resolveVisitDuration(place, enrichments.get(place.placeId), profile.pace),
    }));
}

/**
 * The leg leaving each stop, read off the finished timeline and priced with the
 * same provider the packer used. Metres are the reason this exists: a `travel`
 * segment carries the mode and the minutes but not the distance, and
 * `itinerary_activities.travel_to_next` stores all three.
 */
function legsOf(
  validation: { day: PackedDay; input: PackDayInput },
  getTravelLeg: TravelLegProvider,
): Map<string, TravelToNext> {
  const places = new Map<string, CandidatePlace>();
  for (const assignment of validation.input.assignments) {
    places.set(assignment.place.placeId, assignment.place);
  }
  for (const pick of validation.input.flex ?? []) places.set(pick.place.placeId, pick.place);

  const stops = validation.day.segments.flatMap((segment) =>
    segment.kind === "activity" ? [segment] : [],
  );
  const travelAfter = (from: number): { mode: TravelMode; minutes: number } | undefined => {
    const start = validation.day.segments.indexOf(stops[from]);
    for (let i = start + 1; i < validation.day.segments.length; i++) {
      const segment = validation.day.segments[i];
      if (segment.kind === "activity") return undefined;
      if (segment.kind === "travel") {
        return { mode: segment.mode, minutes: segment.endMin - segment.startMin };
      }
    }
    return undefined;
  };

  const legs = new Map<string, TravelToNext>();
  for (let i = 0; i + 1 < stops.length; i++) {
    const leg = travelAfter(i);
    const from = places.get(stops[i].placeId);
    const to = places.get(stops[i + 1].placeId);
    if (!leg || !from || !to) continue;
    legs.set(stops[i].placeId, {
      mode: leg.mode,
      minutes: leg.minutes,
      meters: getTravelLeg(from, to).meters,
    });
  }
  return legs;
}

/** Re-exported so a caller can hold the photo survivor rule without importing
 *  `photos.ts` just to name it. */
export { survivorIdsFromDays };
