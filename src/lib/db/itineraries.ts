/**
 * Persistence for a finished plan, and for the job that produced it.
 *
 * Two things live here because both are the planner's own storage and neither
 * belongs in a route handler: a `PlanResult` becomes rows in `itineraries`,
 * `itinerary_days` and `itinerary_activities`, and the `jobs` row the client
 * polls is created and patched through the same port.
 *
 * The row-shaping is deliberately split out as pure functions —
 * `itineraryRow`, `dayRow`, `activityRows`, `toJobProgress`. They are where the
 * decisions live (what a stored day *is*), they need no database to test, and
 * `saveItinerary` below is then only the insert order.
 *
 * Two rules the shapers keep:
 *
 * - **Minutes, never timestamps.** `start_min` / `end_min` are minutes from
 *   midnight, matching `pack.ts`. Code owns the clock; a timestamp here would
 *   invite a timezone into a schedule that has none.
 * - **`location_id` is resolved, not invented.** Activities point at
 *   `locations.id`, which only exists because retrieval already persisted the
 *   row. A survivor with no row stores `null` rather than failing the save —
 *   the timeline is still true, and the join is the decoration.
 */

import { inArray, eq } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import type {
  PlanProgress,
  PlanResult,
  PlannedDay,
  TravelToNext as PlannerTravelToNext,
} from "@/lib/planner/pipeline";
import { stageOutlook } from "@/lib/planner/pipeline";
import type { StopContent } from "@/lib/planner/narrate";
import type { ScoredPlace } from "@/lib/planner/score";

import type { Database } from "./client";
import {
  itineraries,
  itinerary_activities,
  itinerary_days,
  jobs,
  locations,
  type ActivityContent,
  type JobProgress,
  type TravelToNext,
} from "./schema";

/**
 * Compile-time proof that the planner's travel leg and the column's are one
 * shape. The planner may not import from `src/lib/db` — `schema.ts` already
 * imports from the planner — so the two declarations are pinned here instead.
 * Widen either one and this line stops compiling.
 */
type _LegShapesAgree = PlannerTravelToNext extends TravelToNext
  ? TravelToNext extends PlannerTravelToNext
    ? true
    : never
  : never;

type ItineraryInsert = typeof itineraries.$inferInsert;
type DayInsert = typeof itinerary_days.$inferInsert;
type ActivityInsert = typeof itinerary_activities.$inferInsert;

// ── the itinerary rows ───────────────────────────────────────────────────────

/**
 * The `itineraries` row. `funnel_stats` rides along because it is the only
 * answer to "why isn't teamLab in my trip" that survives the request — every
 * cut the funnel made, replayable, in four numbers.
 */
export function itineraryRow(result: PlanResult): ItineraryInsert {
  const { request } = result;
  const centre = centreOf(result);
  return {
    name: request.name?.trim() || `${request.city} trip`,
    city: request.city,
    country: request.country ?? null,
    latitude: centre?.latitude ?? null,
    longitude: centre?.longitude ?? null,
    start_date: request.startDate,
    total_days: request.totalDays,
    profile: request.profile,
    funnel_stats: result.funnelStats,
    // Diagnostics, not content. Kept because both halves of it — what Pass B
    // said, and what we refused to take from it — otherwise exist only for the
    // length of one request.
    planner_debug: result.debug,
  };
}

/**
 * The map centre for the itinerary: the mean coordinate of the places that
 * actually made the timeline. Not the city's coordinate — nothing in this
 * pipeline geocodes a city name, and a mean over the real stops is both free
 * and a better frame for the map anyway.
 */
function centreOf(result: PlanResult): { latitude: number; longitude: number } | undefined {
  const located = [...result.places.values()].filter(
    (place) => place.latitude !== undefined && place.longitude !== undefined,
  );
  if (located.length === 0) return undefined;
  return {
    latitude: located.reduce((sum, place) => sum + place.latitude!, 0) / located.length,
    longitude: located.reduce((sum, place) => sum + place.longitude!, 0) / located.length,
  };
}

export function dayRow(itineraryId: string, planned: PlannedDay): DayInsert {
  return {
    itinerary_id: itineraryId,
    day_index: planned.dayIndex,
    date: planned.date,
    area_name: planned.areaName ?? null,
  };
}

export interface ActivityRowContext {
  /** `locations.id` by `place_id`. Missing means the row isn't stored yet. */
  locationIds: ReadonlyMap<string, string>;
  /** Pass C's prose, by place id. Missing means the stop ships without it. */
  content: ReadonlyMap<string, StopContent>;
  /** The funnel's score and reasons, by place id. */
  scored: ReadonlyMap<string, ScoredPlace>;
}

/**
 * One day's `itinerary_activities` rows, read off the packed timeline.
 *
 * Only `activity` segments become rows. Travel is folded into the stop it
 * leaves — `travel_to_next` — and a `break` is the absence of a stop, which a
 * row would turn into a thing the user has to look at. Both are reconstructible
 * from the stored times, which is why neither needs a row of its own.
 */
export function activityRows(
  dayId: string,
  planned: PlannedDay,
  context: ActivityRowContext,
): ActivityInsert[] {
  return planned.day.segments.flatMap((segment) => {
    if (segment.kind !== "activity") return [];
    const scored = context.scored.get(segment.placeId);
    return [
      {
        day_id: dayId,
        location_id: context.locationIds.get(segment.placeId) ?? null,
        position: segment.position,
        slot_role: segment.role,
        start_min: segment.startMin,
        end_min: segment.endMin,
        score: scored?.score ?? null,
        match_reasons: scored?.reasons ?? [],
        content: toActivityContent(context.content.get(segment.placeId)),
        travel_to_next: planned.travelToNext.get(segment.placeId) ?? null,
      } satisfies ActivityInsert,
    ];
  });
}

/**
 * Pass C's content, named field by field rather than spread. `ActivityContent`
 * is an open `Record`, so a spread would let any future field on `StopContent`
 * into the column unreviewed — and the column is what the card renders.
 */
function toActivityContent(content: StopContent | undefined): ActivityContent | null {
  if (!content) return null;
  return {
    whyForYou: content.whyForYou,
    highlights: content.highlights,
    ...(content.foodRecommendations ? { foodRecommendations: content.foodRecommendations } : {}),
    ...(content.tips ? { tips: content.tips } : {}),
  };
}

// ── the job row ──────────────────────────────────────────────────────────────

export type JobRow = InferSelectModel<typeof jobs>;

/** The four statuses the client's poll loop knows. `queued` is the initial one;
 *  `completed` and `failed` are terminal and stop the polling. */
export type JobStatus = "queued" | "processing" | "completed" | "failed";

export interface JobPatch {
  status?: JobStatus;
  progress?: JobProgress;
  /** Already phrased for a person — see `getFriendlyApiError`. */
  error?: string | null;
  itinerary_id?: string | null;
  result?: Record<string, unknown> | null;
}

/**
 * A `PlanProgress` as the loading screen wants it.
 *
 * The extra fields are what let the bar move between reports: `fired_at` and
 * `stage_ms` give `useProgressAnimation` a span to walk across, and
 * `eta_seconds` gives `useProgressEta` something to count down. All of them
 * come from the stage table in `pipeline.ts` — the clock is injected, so a
 * stored progress row is as reproducible as the plan that produced it.
 */
export function toJobProgress(progress: PlanProgress, now: Date): JobProgress {
  const outlook = stageOutlook(progress.stage);
  return {
    percent: progress.percent,
    label: progress.label,
    stage: progress.stage,
    done: progress.done,
    total: progress.total,
    fired_at: now.toISOString(),
    eta_seconds: outlook.etaSeconds,
    next_percent: outlook.nextPercent,
    stage_ms: outlook.stageMs,
  };
}

// ── the port ─────────────────────────────────────────────────────────────────

/**
 * Everything the route handlers do to the database, in four methods.
 *
 * A port rather than direct Drizzle calls for the same reason the planner has
 * `SearchCache` and `LocationStore`: the handler test runs the real handler,
 * the real pipeline and the real row shapers with no Postgres anywhere.
 */
export interface PlanStore {
  createJob(input: {
    type?: string;
    payload: Record<string, unknown>;
    now: Date;
  }): Promise<JobRow>;
  getJob(id: string): Promise<JobRow | undefined>;
  updateJob(id: string, patch: JobPatch, now: Date): Promise<JobRow | undefined>;
  saveItinerary(result: PlanResult): Promise<{ itineraryId: string }>;
}

export const ITINERARY_JOB_TYPE = "itinerary-planning";

export function createPlanStore(db: Database): PlanStore {
  return {
    async createJob({ type, payload, now }) {
      const [row] = await db
        .insert(jobs)
        .values({
          type: type ?? ITINERARY_JOB_TYPE,
          status: "queued",
          payload,
          created_at: now,
          updated_at: now,
        })
        .returning();
      return row;
    },

    async getJob(id) {
      // An id that isn't a uuid reaches Postgres as a cast error, not as an
      // empty result — and "not a uuid" is a 404, not a 500.
      if (!isUuid(id)) return undefined;
      const [row] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
      return row;
    },

    async updateJob(id, patch, now) {
      if (!isUuid(id)) return undefined;
      const [row] = await db
        .update(jobs)
        .set({ ...patch, updated_at: now })
        .where(eq(jobs.id, id))
        .returning();
      return row;
    },

    async saveItinerary(result) {
      return saveItinerary(db, result);
    },
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** What an in-memory save recorded: the very rows Postgres would have taken. */
export interface SavedItinerary {
  id: string;
  itinerary: ItineraryInsert;
  days: DayInsert[];
  activities: ActivityInsert[];
  /** The plan the rows were shaped from, for assertions that need the source. */
  result: PlanResult;
}

/**
 * Test double and offline path, following `createInMemorySearchCache`. Keeps
 * the same "returns the stored row" contract, including `updated_at` moving
 * only when the caller's clock says so.
 *
 * `saveItinerary` runs the **real** row shapers rather than stashing the
 * `PlanResult` whole. A double that skipped them would let a route test claim
 * "funnel_stats is persisted" while proving nothing about the row.
 */
export function createInMemoryPlanStore(seed?: {
  itineraryId?: string;
  /** One deterministic seam for every generated row id. */
  idFactory?: () => string;
  /** `locations.id` by `place_id`, if a test wants the join populated. */
  locationIds?: ReadonlyMap<string, string>;
}): PlanStore & { rows: Map<string, JobRow>; saved: SavedItinerary[] } {
  const rows = new Map<string, JobRow>();
  const saved: SavedItinerary[] = [];
  let idSequence = 0;
  const nextId = seed?.idFactory ?? (() => {
    idSequence += 1;
    return `00000000-0000-4000-8000-${String(idSequence).padStart(12, "0")}`;
  });

  return {
    rows,
    saved,

    async createJob({ type, payload, now }) {
      const row: JobRow = {
        id: nextId(),
        type: type ?? ITINERARY_JOB_TYPE,
        status: "queued",
        itinerary_id: null,
        payload,
        result: null,
        error: null,
        progress: null,
        created_at: now,
        updated_at: now,
      };
      rows.set(row.id, row);
      return row;
    },

    async getJob(id) {
      return rows.get(id);
    },

    async updateJob(id, patch, now) {
      const existing = rows.get(id);
      if (!existing) return undefined;
      const next: JobRow = { ...existing, ...patch, updated_at: now };
      rows.set(id, next);
      return next;
    },

    async saveItinerary(result) {
      const id = seed?.itineraryId ?? nextId();
      const days = result.days.map((planned) => dayRow(id, planned));
      const activities = result.days.flatMap((planned) =>
        activityRows(`${id}:${planned.dayIndex}`, planned, {
          locationIds: seed?.locationIds ?? new Map(),
          content: result.content,
          scored: result.scored,
        }),
      );
      saved.push({ id, itinerary: itineraryRow(result), days, activities, result });
      return { itineraryId: id };
    },
  };
}

// ── the write ────────────────────────────────────────────────────────────────

/**
 * Writes a finished plan: one itinerary, one row per day, one row per stop.
 *
 * Not a transaction, deliberately — the Neon HTTP driver has no interactive
 * transaction, and the failure this would protect against (a half-written
 * itinerary) is already visible as an itinerary with missing days rather than
 * as corruption. If that stops being acceptable, the answer is the WebSocket
 * driver, not a rewrite of this function.
 */
export async function saveItinerary(
  db: Database,
  result: PlanResult,
): Promise<{ itineraryId: string }> {
  const locationIds = await locationIdsFor(db, [...result.places.keys()]);

  const [itinerary] = await db
    .insert(itineraries)
    .values(itineraryRow(result))
    .returning({ id: itineraries.id });

  if (result.days.length > 0) {
    const inserted = await db
      .insert(itinerary_days)
      .values(result.days.map((planned) => dayRow(itinerary.id, planned)))
      .returning({ id: itinerary_days.id, day_index: itinerary_days.day_index });
    const dayIds = new Map(inserted.map((row) => [row.day_index, row.id]));

    const activities = result.days.flatMap((planned) => {
      const dayId = dayIds.get(planned.dayIndex);
      if (!dayId) return [];
      return activityRows(dayId, planned, {
        locationIds,
        content: result.content,
        scored: result.scored,
      });
    });
    if (activities.length > 0) await db.insert(itinerary_activities).values(activities);
  }

  return { itineraryId: itinerary.id };
}

async function locationIdsFor(
  db: Database,
  placeIds: readonly string[],
): Promise<Map<string, string>> {
  if (placeIds.length === 0) return new Map();
  const rows = await db
    .select({ id: locations.id, place_id: locations.place_id })
    .from(locations)
    .where(inArray(locations.place_id, [...placeIds]));
  return new Map(rows.map((row) => [row.place_id, row.id]));
}
