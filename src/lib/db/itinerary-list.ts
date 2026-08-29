/**
 * The read behind `GET /api/itineraries` — every trip a traveller owns, in the
 * shape the cards on `/itineraries` and `/home` already render.
 *
 * ## Why this is not `readItineraryDetail` in a loop
 *
 * The detail read pulls every stop, every location and every opening period for
 * one trip. A grid of twenty cards needs a name, a date, a photo and a count.
 * Looping the detail read would fetch a few thousand rows to render twenty
 * thumbnails, so this is three aggregate queries instead.
 *
 * ## Three fields are decisions, not translations
 *
 * The rest is column-to-column. These three are the same decisions
 * `itinerary-detail.ts` already made, and they call *into* that module rather
 * than restating them — a card and the page it opens disagreeing about a trip's
 * end date is the kind of bug nobody reports and everybody notices.
 *
 * - **`end_date`** is derived. There is no such column; `endDateFor` owns the
 *   inclusive-day arithmetic.
 * - **`overview`** comes from `planner_debug.themes.titles`, the sentences the
 *   theme pass already paid an expensive model for. A geographic plan has no
 *   premises and gets no overview rather than a generated-sounding one.
 * - **`thumbnail_url`** is the first stop with a resolved photo, because there
 *   is no such column either.
 *
 * ## What is a constant, and why
 *
 * `is_public`, `is_bookmarked`, `is_archived` and `public_token` are on the
 * card type and have no column here — they belonged to the sharing and
 * bookmarking features that left with the old REST backend. They are pinned to
 * their "off" value rather than made optional, so the card components keep
 * compiling without a rename layer. `user_role` is always `"owner"`: this
 * query is scoped to the owner, and collaborators went with the same backend.
 *
 * **`collection_id` is real now, and it is empty for older trips.** A plan
 * saved since companion collections shipped has one; the thirty-odd planned
 * before do not, and nothing backfills them. The empty string is what the "Save
 * to itinerary" menus filter on — posting places to a collection id of `""` is
 * a write that quietly does nothing, which is the failure this repo keeps
 * documenting from the other end.
 */

import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { Database } from "./client";
import { itineraryCollectionIds } from "./collections";
import { endDateFor, overviewFrom } from "./itinerary-detail";
import { isUuid } from "./itineraries";
import { itineraries, itinerary_activities, itinerary_days, locations } from "./schema";

/** The card shape. Matches `ItineraryWithRole` in `src/lib/api/itineraries.ts`. */
export interface ItineraryListItem {
  id: string;
  name: string;
  overview?: string;
  country: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  start_date: string;
  end_date: string;
  total_days: number;
  total_activities: number;
  collection_id: string;
  user_role: "owner";
  is_bookmarked: boolean;
  is_archived: boolean;
  is_public: boolean;
  thumbnail_url: string | null;
  created_at: string;
  updated_at: string;
}

export async function readItineraryList(
  db: Database,
  userId: string,
): Promise<ItineraryListItem[]> {
  if (!isUuid(userId)) return [];

  const rows = await db
    .select({
      id: itineraries.id,
      name: itineraries.name,
      city: itineraries.city,
      country: itineraries.country,
      latitude: itineraries.latitude,
      longitude: itineraries.longitude,
      start_date: itineraries.start_date,
      total_days: itineraries.total_days,
      planner_debug: itineraries.planner_debug,
      created_at: itineraries.created_at,
    })
    .from(itineraries)
    .where(eq(itineraries.user_id, userId))
    .orderBy(desc(itineraries.created_at));

  if (rows.length === 0) return [];

  const ids = rows.map((row) => row.id);
  const [counts, thumbnails, companions] = await Promise.all([
    activityCounts(db, ids),
    firstPhotos(db, ids),
    itineraryCollectionIds(db, ids),
  ]);

  return rows.map((row) => {
    const overview = overviewFrom(row.planner_debug);
    return {
      id: row.id,
      name: row.name,
      ...(overview ? { overview } : {}),
      // The card labels a trip by country and the planner stores a city, which for
      // a city-state is the same string. `country` is nullable on the row and not
      // on the card, so the city stands in — never an empty label.
      country: row.country ?? row.city,
      region: row.city,
      ...(row.latitude !== null ? { latitude: row.latitude } : {}),
      ...(row.longitude !== null ? { longitude: row.longitude } : {}),
      start_date: row.start_date,
      end_date: endDateFor(row.start_date, row.total_days),
      total_days: row.total_days,
      total_activities: counts.get(row.id) ?? 0,
      collection_id: companions.get(row.id) ?? "",
      user_role: "owner" as const,
      is_bookmarked: false,
      is_archived: false,
      is_public: false,
      thumbnail_url: thumbnails.get(row.id) ?? null,
      created_at: row.created_at.toISOString(),
      // There is no `updated_at` on `itineraries` — the page is read-only, so
      // nothing has ever updated one. Reporting the creation time is honest;
      // inventing `now()` would make every card look freshly edited on reload.
      updated_at: row.created_at.toISOString(),
    };
  });
}

/** Stops per trip, counted in Postgres rather than by fetching them. */
async function activityCounts(
  db: Database,
  itineraryIds: readonly string[],
): Promise<Map<string, number>> {
  const rows = await db
    .select({
      itineraryId: itinerary_days.itinerary_id,
      total: count(itinerary_activities.id),
    })
    .from(itinerary_days)
    .leftJoin(itinerary_activities, eq(itinerary_activities.day_id, itinerary_days.id))
    .where(inArray(itinerary_days.itinerary_id, [...itineraryIds]))
    .groupBy(itinerary_days.itinerary_id);
  return new Map(rows.map((row) => [row.itineraryId, Number(row.total)]));
}

/**
 * One photo per trip: the earliest stop that has a resolved one.
 *
 * "Earliest" is day then position, which is the order the timeline runs in, so
 * the card shows the first thing the traveller will actually see. Ordering by
 * anything else — highest rated, most photos — would be a second opinion about
 * what a trip looks like, and the timeline already has one.
 *
 * `photo_urls` is null until Step 11 resolves it and `[]` when a place has no
 * photos, so the filter has to be "non-empty array", not "not null".
 */
async function firstPhotos(
  db: Database,
  itineraryIds: readonly string[],
): Promise<Map<string, string>> {
  const rows = await db
    .select({
      itineraryId: itinerary_days.itinerary_id,
      dayIndex: itinerary_days.day_index,
      position: itinerary_activities.position,
      photoUrls: locations.photo_urls,
    })
    .from(itinerary_days)
    .innerJoin(itinerary_activities, eq(itinerary_activities.day_id, itinerary_days.id))
    .innerJoin(locations, eq(locations.id, itinerary_activities.location_id))
    .where(
      and(
        inArray(itinerary_days.itinerary_id, [...itineraryIds]),
        isNotNull(locations.photo_urls),
        sql`jsonb_array_length(${locations.photo_urls}) > 0`,
      ),
    )
    .orderBy(itinerary_days.day_index, itinerary_activities.position);

  const first = new Map<string, string>();
  for (const row of rows) {
    if (first.has(row.itineraryId)) continue;
    const url = row.photoUrls?.[0];
    if (url) first.set(row.itineraryId, url);
  }
  return first;
}
