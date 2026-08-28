/**
 * The read side of the planner's diagnostic record.
 *
 * `itineraries.ts` writes a finished plan; this reads one back for a person
 * asking why it looks the way it does. They are separate modules because they
 * have opposite shapes — the writer takes one `PlanResult` and fans it into
 * three tables, the reader takes an id and gathers five tables into one object
 * — and because nothing in the write path should ever import a query that only
 * a debug page needs.
 *
 * Three things this module is deliberately not:
 *
 * - **Not a port.** There is no interface and no in-memory double. Everything
 *   here is a `select` with no decisions in it, so a fake would only prove that
 *   the fake works. The page that consumes it is the test.
 * - **Not authenticated.** Auth was removed from this app; anyone who can reach
 *   localhost can read this. Do not extend it to return anything you would not
 *   put on a public page without thinking about that first.
 * - **Not tolerant of a missing row.** An id that names nothing returns
 *   `undefined`, and the page turns that into a 404. An itinerary planned
 *   before `planner_debug` existed returns a row with `debug: null`, which is a
 *   different thing and says so.
 */

import { desc, eq, inArray } from "drizzle-orm";

import type { FunnelStats } from "@/lib/planner/funnel";
import type { PlannerDebug } from "@/lib/planner/debug";
import type { PreferenceProfile } from "@/lib/planner/types";

import type { Database } from "./client";
import {
  itineraries,
  itinerary_activities,
  itinerary_days,
  jobs,
  locations,
  type ActivityContent,
  type TravelToNext,
} from "./schema";

/** One stop on the stored timeline, with the columns a person debugging reads. */
export interface DiagnosticStop {
  position: number;
  role: string;
  startMin: number;
  endMin: number;
  /** Null when the activity has no `locations` row — the join is decoration,
   *  and the timeline is true without it. See `itineraries.ts`. */
  placeId: string | null;
  name: string;
  types: string[];
  score: number | null;
  matchReasons: string[];
  /** Pass C's prose, or null if the stop shipped on the narration fallback. */
  content: ActivityContent | null;
  travelToNext: TravelToNext | null;
  /** `locations.stay_duration` — rung 1 of the duration ladder, if it is set. */
  stayDuration: number | null;
}

export interface DiagnosticDay {
  dayIndex: number;
  date: string;
  areaName: string | null;
  stops: DiagnosticStop[];
}

export interface PlanDiagnostics {
  itinerary: {
    id: string;
    name: string;
    city: string;
    country: string | null;
    startDate: string;
    totalDays: number;
    profile: PreferenceProfile;
    createdAt: Date;
  };
  days: DiagnosticDay[];
  /** Null for an itinerary planned before the column existed. */
  debug: PlannerDebug | null;
  funnelStats: FunnelStats | null;
  /** The job that produced it, if its row is still around. Per-stage counters
   *  live on `jobs.result.stats` and deliberately not in `planner_debug`. */
  job: { id: string; status: string; error: string | null; stats: unknown } | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Everything known about one plan, in one object.
 *
 * Five queries rather than one join: the days-to-activities fan-out would
 * multiply the itinerary row by every stop, and the enrichment failures do not
 * join to any of it — they are keyed by `place_id` on a table that knows
 * nothing about itineraries.
 */
export async function readPlanDiagnostics(
  db: Database,
  itineraryId: string,
): Promise<PlanDiagnostics | undefined> {
  // A non-uuid reaches Postgres as a cast error, not an empty result, and
  // "not a uuid" is a 404 rather than a 500. Same rule as `getJob`.
  if (!UUID.test(itineraryId)) return undefined;

  const [itinerary] = await db
    .select()
    .from(itineraries)
    .where(eq(itineraries.id, itineraryId))
    .limit(1);
  if (!itinerary) return undefined;

  const dayRows = await db
    .select()
    .from(itinerary_days)
    .where(eq(itinerary_days.itinerary_id, itineraryId))
    .orderBy(itinerary_days.day_index);

  const stopsByDay = await readStops(db, dayRows.map((row) => row.id));

  const [job] = await db
    .select({
      id: jobs.id,
      status: jobs.status,
      error: jobs.error,
      result: jobs.result,
    })
    .from(jobs)
    .where(eq(jobs.itinerary_id, itineraryId))
    .orderBy(desc(jobs.created_at))
    .limit(1);

  return {
    itinerary: {
      id: itinerary.id,
      name: itinerary.name,
      city: itinerary.city,
      country: itinerary.country,
      startDate: itinerary.start_date,
      totalDays: itinerary.total_days,
      profile: itinerary.profile,
      createdAt: itinerary.created_at,
    },
    days: dayRows.map((row) => ({
      dayIndex: row.day_index,
      date: row.date,
      areaName: row.area_name,
      stops: stopsByDay[row.id] ?? [],
    })),
    debug: itinerary.planner_debug ?? null,
    funnelStats: itinerary.funnel_stats ?? null,
    job: job
      ? {
          id: job.id,
          status: job.status,
          error: job.error,
          stats: (job.result as { stats?: unknown } | null)?.stats ?? null,
        }
      : null,
  };
}

async function readStops(
  db: Database,
  dayIds: readonly string[],
): Promise<Record<string, DiagnosticStop[]>> {
  if (dayIds.length === 0) return {};

  // Left join: `location_id` is null for a survivor retrieval never persisted,
  // and losing that stop from the view would hide the very gap worth seeing.
  const rows = await db
    .select({
      dayId: itinerary_activities.day_id,
      position: itinerary_activities.position,
      role: itinerary_activities.slot_role,
      startMin: itinerary_activities.start_min,
      endMin: itinerary_activities.end_min,
      score: itinerary_activities.score,
      matchReasons: itinerary_activities.match_reasons,
      content: itinerary_activities.content,
      travelToNext: itinerary_activities.travel_to_next,
      placeId: locations.place_id,
      name: locations.name,
      types: locations.types,
      stayDuration: locations.stay_duration,
    })
    .from(itinerary_activities)
    .leftJoin(locations, eq(itinerary_activities.location_id, locations.id))
    .where(inArray(itinerary_activities.day_id, [...dayIds]))
    .orderBy(itinerary_activities.position);

  const byDay: Record<string, DiagnosticStop[]> = {};
  for (const row of rows) {
    (byDay[row.dayId] ??= []).push({
      position: row.position,
      role: row.role,
      startMin: row.startMin,
      endMin: row.endMin,
      placeId: row.placeId,
      name: row.name ?? "(no locations row)",
      types: row.types ?? [],
      score: row.score,
      matchReasons: row.matchReasons ?? [],
      content: row.content,
      travelToNext: row.travelToNext,
      stayDuration: row.stayDuration,
    });
  }
  return byDay;
}
