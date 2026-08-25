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
 * ## What is missing, stated rather than hidden
 *
 * There is no Routes API module in this repo, so travel legs default to
 * memoized crow-flight distance (`createStraightLineTravel`). It is injectable
 * precisely so a real provider can replace it without touching this file.
 */

import type { TravelPersona } from "@/lib/persona/types";

import { assignDays, dayCapacity, type AssignDayRequest, type AssignResult } from "./assign";
import { clusterPlaces } from "./cluster";
import { PLANNER_DEBUG_VERSION, type PlannerDebug } from "./debug";
import {
  readEnrichments,
  type EnrichmentStore,
  type EnrichmentReadStats,
  type EnrichmentSubject,
} from "./enrich";
import {
  runFunnel,
  type FunnelStats,
  type ScoredCluster,
} from "./funnel";
import { type Weekday } from "./hours";
import type { FetchLike } from "./http";
import { narrateStops, stopsFromDays, type NarrateStats, type StopContent } from "./narrate";
import type { ResponsesClient } from "./openai";
import {
  type PackDayInput,
  type PackedDay,
  type TravelLeg,
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
  retrievePlaces,
  type LocationStore,
  type RetrievalStats,
  type RetrievedPlace,
  type SearchCache,
  type ShortlistHydrationStats,
} from "./retrieval";
import type { ScoredPlace } from "./score";
import { resolveVisitDuration } from "./duration";
import type {
  CandidatePlace,
  PlaceEnrichment,
  PreferenceProfile,
  SchedulerOptions,
} from "./types";
import {
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
}

// ── progress ─────────────────────────────────────────────────────────────────

/**
 * Every stage a plan passes through, in order. `save` and `done` belong to the
 * caller — `runPlan` does not persist anything — but they are named here so the
 * percentages of the whole run come from one table instead of two.
 */
export type PlanStage =
  | "retrieve"
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

const EARTH_RADIUS_M = 6_371_000;
/** Walking pace, metres per minute. */
const WALK_M_PER_MIN = 80;
/** Transit: a fixed wait plus a faster metre. */
const TRANSIT_WAIT_MIN = 8;
const TRANSIT_M_PER_MIN = 400;

/**
 * Crow-flight legs, memoized per pair.
 *
 * Memoized because `packDay` calls the provider hundreds of times per day while
 * it searches for a set of durations that fits — that is the packer's documented
 * requirement of any provider, and it is the reason a network call must never
 * sit behind this signature.
 *
 * This is a stand-in, and it is the one place the pipeline knowingly guesses.
 * A place with no coordinates yields a zero leg rather than `NaN`; clustering
 * already dropped those, so it can only be reached by a hand-built input.
 */
export function createStraightLineTravel(): TravelLegProvider {
  const cache = new Map<string, TravelLeg>();
  return (from, to) => {
    // `\u0000`, escaped rather than typed. A literal NUL byte in the source
    // makes grep and ripgrep classify this whole file as binary and skip it
    // silently — the file stops appearing in code search and nothing warns you.
    const key = `${from.placeId}\u0000${to.placeId}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const meters = metersBetween(from, to);
    const minutes =
      meters < 1200
        ? Math.ceil(meters / WALK_M_PER_MIN)
        : TRANSIT_WAIT_MIN + Math.ceil(meters / TRANSIT_M_PER_MIN);
    const leg: TravelLeg = { minutes, meters };
    cache.set(key, leg);
    return leg;
  };
}

function metersBetween(from: CandidatePlace, to: CandidatePlace): number {
  if (
    from.latitude === undefined ||
    from.longitude === undefined ||
    to.latitude === undefined ||
    to.longitude === undefined
  ) {
    return 0;
  }
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(to.latitude - from.latitude);
  const dLng = rad(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(from.latitude)) * Math.cos(rad(to.latitude)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a)));
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
  photos: PhotoStats;
  narration: NarrateStats;
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
  /** Durable Batch submission for cold enrichment rows. This waits for the
   * handle, never for the model's up-to-24-hour completion. */
  enqueueEnrichments?: (
    subjects: readonly EnrichmentSubject[],
    now: Date,
  ) => Promise<void>;
  responses: ResponsesClient;
  fetch?: FetchLike;
  blobs?: PhotoBlobStore;
  /** Injected. Nothing in the planner reads the ambient clock or Math.random. */
  now: Date;
  rng: () => number;
  /** Defaults to memoized crow-flight. There is no Routes module in this repo. */
  getTravelLeg?: TravelLegProvider;
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
  const getTravelLeg = deps.getTravelLeg ?? createStraightLineTravel();
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

  // 2 — clustering, then the funnel. k is the trip's length: one area per day.
  await report("cluster");
  const located = pool.filter((place) => place.latitude !== undefined);
  const unlocated = pool.filter((place) => place.latitude === undefined);
  const clusters = clusterPlaces(located, {
    k: Math.max(1, Math.min(request.totalDays, request.options?.maxK ?? request.totalDays)),
    rng: deps.rng,
    maxIterations: request.options?.maxIterations,
  });
  const funnel = runFunnel(clusters, profile, { unlocated });
  const shortlistIds = funnel.shortlist.map((scored) => scored.placeId);
  const scored = new Map(funnel.shortlist.map((entry) => [entry.placeId, entry]));

  // 3 — Atmosphere fields, shortlist only. This is the expensive Details call.
  await report("hydrate");
  const hydration = await hydrateShortlist(pool, shortlistIds, {
    apiKey: deps.googleApiKey,
    store: deps.store,
    fetch: deps.fetch,
    now: deps.now,
  });
  // Everything after this point reads the hydrated row, never the pre-hydration
  // snapshot: `servesVegetarianFood` arrives here and the dietary rule in
  // `validate.ts` reads it. The funnel is NOT re-run — hydration only adds
  // fields, and re-filtering would change a shortlist already reported.
  const rows = new Map(pool.map((place) => [place.placeId, place]));
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
  if (enrichment.misses.length > 0 && deps.enqueueEnrichments) {
    const missing = enrichment.misses.flatMap((placeId) => {
      const place = rows.get(placeId);
      return place ? [place] : [];
    });
    await deps.enqueueEnrichments(missing, deps.now);
  }

  // 5 — Pass B. One call for the trip; never throws, degrades to the ranked list.
  await report("assign");
  const baseWeekday = weekdayOf(request.startDate);
  const dayRequests: AssignDayRequest[] = Array.from(
    { length: Math.max(0, request.totalDays) },
    (_, index) => ({
      dayIndex: index,
      weekday: advanceWeekday(baseWeekday, index),
      areaName: hydratedClusters[index]?.label,
      capacity: dayCapacity(profile.pace),
    }),
  );
  const assignment: AssignResult = await assignDays(
    {
      profile,
      clusters: hydratedClusters,
      days: dayRequests,
      enrichments: enrichment.enrichments,
    },
    { client: deps.responses, effort: "low", promptCacheKey: promptCacheKeyFor(request) },
  );

  // 6 — pack, check, repair, re-pack. Pure: no clock, no network, no model.
  await report("schedule");
  const days: PlannedDay[] = assignment.days.map((assigned, index) => {
    const cluster = hydratedClusters[index];
    const validation = validateDay(assigned.input, {
      pace: profile.pace,
      weekday: dayRequests[index].weekday,
      profile,
      getTravelLeg,
      alternates: alternatesFor(cluster, assigned.input, profile, enrichment.enrichments),
    });
    return {
      dayIndex: assigned.dayIndex,
      date: addDays(request.startDate, assigned.dayIndex),
      areaName: assigned.areaName,
      weekday: dayRequests[index].weekday,
      day: validation.day,
      input: validation.input,
      repairs: validation.repairs,
      failures: validation.failures,
      travelToNext: legsOf(validation, getTravelLeg),
    };
  });

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
    { client: deps.responses, effort: "none", promptCacheKey: promptCacheKeyFor(request) },
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
    },
    stats: {
      retrieval: retrieval.stats,
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
    },
  };
}

/**
 * One cache key for the whole itinerary. OpenAI's prompt caching routes on a
 * prefix hash, so this must be a per-run constant — a per-stop key turns
 * fifteen cache reads into fifteen misses. Keyed on city and profile rather
 * than on a random id, so two travellers with the same taste in the same city
 * share the cache instead of each paying to warm their own.
 */
function promptCacheKeyFor(request: PlanRequest): string {
  const { profile } = request;
  return [
    "plan",
    request.city.trim().toLowerCase(),
    profile.pace,
    [...profile.interests].sort().join("+"),
    [...profile.dietary].sort().join("+"),
  ].join(":");
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
): Alternate[] {
  if (!cluster) return [];
  const used = new Set([
    ...input.assignments.map((assignment) => assignment.place.placeId),
    ...(input.flex ?? []).map((pick) => pick.place.placeId),
  ]);
  return cluster.places.flatMap((place, index) =>
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
