/**
 * The itinerary page's read path, against Neon.
 *
 * `getItineraryDetail` in `src/lib/supabase/queries/home.ts` is the shape this
 * produces, and it is the shape the ported Argo page consumes. That page was
 * written for a richer schema than the planner writes, so this module is a
 * mapping as much as a query: minutes from midnight become clock times, a
 * `slot_role` becomes a display category, and the fields whose features no
 * longer exist have been removed from the type rather than filled with lies.
 *
 * Three things this module is deliberately not, following `diagnostics.ts`:
 *
 * - **Not a port.** No interface, no in-memory double. The queries are plain
 *   selects; the decisions worth testing are the mappings, and those are pure
 *   functions exported below.
 * - **Not authenticated.** Auth is removed. Anyone who can reach the server can
 *   read any itinerary by id.
 * - **Not a write path.** The page's thirty mutations still point at the old
 *   REST backend. This makes the page render; it does not make it editable.
 */

import { eq, inArray } from "drizzle-orm";

import type { StopContent } from "@/lib/planner/narrate";
import type { PlannerDebug } from "@/lib/planner/debug";
import type { PriceRange } from "@/lib/maps/price-range";
import type { OpeningPeriod } from "@/lib/planner/types";

import type { Database } from "./client";
import { itineraries, itinerary_activities, itinerary_days, locations } from "./schema";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minutes in a day. `start_min` may exceed it; the clock rolls over. */
const MINUTES_PER_DAY = 1_440;

/**
 * What the card shows. The page only ever distinguishes these two — everything
 * else it once had (`accommodation`, `lodging_checkin`, …) belonged to flights
 * and lodging, which this build does not have.
 */
export type ActivityCategory = "poi" | "meal";

/**
 * What a leg between two stops is travelled by.
 *
 * The planner produces `walk` and `transit` only — `createTravelEstimate`
 * decides between them, or the Route Matrix measures both and picks. `drive` is
 * here because the page
 * builds its own optimistic rows with it, and because the mode buttons in
 * `TransportDetailRow` offer it. `TransportMode` in the day-column constants is
 * this type, re-exported, so the two cannot drift apart.
 */
export type ActivityTravelMode = "walk" | "transit" | "drive";

/** Roles that put you at a table. `cafe_break` counts: the page's own place
 *  heuristic treats `cafe` and `coffee_shop` as a meal, and so does this. */
const MEAL_ROLES = new Set(["lunch", "dinner", "cafe_break"]);

export function categoryFor(slotRole: string): ActivityCategory {
  return MEAL_ROLES.has(slotRole) ? "meal" : "poi";
}

/**
 * Minutes from midnight on `date`, as the ISO string the page parses.
 *
 * Always UTC. The planner has no timezone — `hours.ts` takes an injected
 * weekday and nothing derives one — and every reader on the page already
 * defaults to `"UTC"`, so stamping a zone here would invent precision the
 * data does not have. A day that runs past midnight rolls the date forward
 * rather than wrapping to the same morning.
 */
export function minutesToISO(date: string, minutes: number): string {
  const dayOffset = Math.floor(minutes / MINUTES_PER_DAY);
  const within = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const stamped = new Date(`${date}T00:00:00Z`);
  stamped.setUTCDate(stamped.getUTCDate() + dayOffset);
  stamped.setUTCMinutes(within);
  return stamped.toISOString();
}

/** `start_date` plus the trip's length. Inclusive, so a 3-day trip starting on
 *  the 27th ends on the 29th. */
export function endDateFor(startDate: string, totalDays: number): string {
  const end = new Date(`${startDate}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + Math.max(0, totalDays - 1));
  return end.toISOString().slice(0, 10);
}

/**
 * The trip's blurb, built from the premises the theme pass already wrote.
 *
 * Those sentences are paid for on the expensive model and, until now, only the
 * debug page rendered them. A geographic plan has no premises and gets no
 * overview rather than a generated-sounding one.
 */
export function overviewFrom(debug: PlannerDebug | null): string | null {
  const titles = debug?.themes?.titles;
  if (!titles || titles.length === 0) return null;
  const ordered = [...titles].sort((a, b) => a.dayIndex - b.dayIndex);
  return ordered.map((theme, index) => `Day ${index + 1}: ${theme.title}.`).join(" ");
}

/** Monday-first, matching `todayWeekdayIndex` in `utils/location-detail.ts`.
 *  Google numbers days 0 = Sunday, so Sunday moves to the end. */
const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;

const clock = (hour: number, minute: number) =>
  `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

/**
 * `opening_periods` rendered as the `weekdayDescriptions` strings the panel
 * already knows how to display.
 *
 * Google sends periods, not sentences — the sentences are an Atmosphere-tier
 * field we do not buy — so this builds them. Rebuilding is also what lets the
 * result stay Monday-first regardless of how the periods arrived.
 *
 * A place with no periods gets no descriptions rather than seven "Closed"
 * lines: `hasKnownHours` distinguishes "always open" from "we never got hours",
 * and flattening that distinction here would tell the traveller a park is shut.
 */
export function weekdayDescriptionsFrom(
  periods: readonly OpeningPeriod[] | null | undefined,
): string[] {
  if (!periods || periods.length === 0) return [];

  const byDay = new Map<number, string[]>();
  for (const period of periods) {
    // Google's "always open": one period at Sunday 00:00 with no close.
    if (!period.close) {
      return WEEKDAY_NAMES.map((name) => `${name}: Open 24 hours`);
    }
    const day = period.open.day;
    const span = `${clock(period.open.hour, period.open.minute)} – ${clock(period.close.hour, period.close.minute)}`;
    byDay.set(day, [...(byDay.get(day) ?? []), span]);
  }

  return WEEKDAY_NAMES.map((name, index) => {
    // Monday-first display over Google's Sunday-first numbering.
    const googleDay = (index + 1) % 7;
    const spans = byDay.get(googleDay);
    return `${name}: ${spans && spans.length > 0 ? spans.join(", ") : "Closed"}`;
  });
}

export interface ItineraryActivityDetail {
  id: string;
  day_id: string;
  day_index: number;
  name: string;
  /** Nullable because the page builds synthetic cards with no times while an
   *  edit is in flight. Every stored row has both. */
  start_time: string | null;
  end_time: string | null;
  category: ActivityCategory;
  place_id?: string | null;
  location_id?: string | null;
  photo_url?: string | null;
  /** Pass C's prose. Null when narration fell back. */
  content?: StopContent | null;
  /** Why the scorer kept this place. */
  match_reasons?: string[];
  travel_distance_meters?: number | null;
  travel_duration_seconds?: number | null;
  travel_mode?: ActivityTravelMode | null;
  position?: number;
  location: ActivityLocationDetail | null;
}

/** The subset of `locations` the side panel can actually show. Website and
 *  phone numbers are not columns here and are gone from the panel rather than
 *  rendered blank. */
export interface ActivityLocationDetail {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  photo_urls?: string[] | null;
  formatted_address?: string | null;
  stay_duration?: number | null;
  rating?: number | null;
  user_rating_count?: number | null;
  price_range?: PriceRange | null;
  primary_type?: string | null;
  categories?: string[] | null;
  business_status?: string | null;
  /** Google's canonical link. Null for anything retrieved before the field
   *  joined the search mask — `googleMapsPlaceUrl` falls back to `place_id`. */
  google_maps_uri?: string | null;
  /** Google's own one-line description, from the shortlist Details call. */
  editorial_summary?: string | null;
  /** Built from `opening_periods`, in the shape `weekdayDescriptionsFrom` in
   *  `utils/location-detail.ts` reads. */
  regular_opening_hours?: { weekdayDescriptions: string[] } | null;
}

export interface ItineraryDayDetail {
  id: string;
  date: string;
  day_index: number;
  area_name: string | null;
  activities: ItineraryActivityDetail[];
}

export interface ItineraryDetail {
  id: string;
  name: string;
  city: string;
  country: string | null;
  region: string | null;
  latitude: number | null;
  longitude: number | null;
  start_date: string;
  end_date: string;
  total_days: number;
  total_activities: number;
  overview: string | null;
  thumbnail_url: string | null;
  days: ItineraryDayDetail[];
}

/**
 * One itinerary, with its days, stops and the cached Google row behind each.
 *
 * Returns `undefined` for an id that names nothing — and for an id that is not
 * a uuid, which reaches Postgres as a cast error rather than an empty result.
 * The route turns both into a 404.
 */
export async function readItineraryDetail(
  db: Database,
  itineraryId: string,
): Promise<ItineraryDetail | undefined> {
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

  const dayIndexById = new Map(dayRows.map((row) => [row.id, row.day_index]));
  const dateById = new Map(dayRows.map((row) => [row.id, row.date]));
  const activityRows =
    dayRows.length === 0
      ? []
      : // Left join: `location_id` is null for a stop whose row never persisted,
        // and dropping it here would hide a gap worth seeing on the page.
        await db
          .select({
            id: itinerary_activities.id,
            dayId: itinerary_activities.day_id,
            position: itinerary_activities.position,
            slotRole: itinerary_activities.slot_role,
            startMin: itinerary_activities.start_min,
            endMin: itinerary_activities.end_min,
            matchReasons: itinerary_activities.match_reasons,
            content: itinerary_activities.content,
            travelToNext: itinerary_activities.travel_to_next,
            locationId: locations.id,
            placeId: locations.place_id,
            locationName: locations.name,
            latitude: locations.latitude,
            longitude: locations.longitude,
            photoUrls: locations.photo_urls,
            formattedAddress: locations.formatted_address,
            stayDuration: locations.stay_duration,
            rating: locations.rating,
            userRatingCount: locations.user_rating_count,
            priceRange: locations.price_range,
            primaryType: locations.primary_type,
            types: locations.types,
            businessStatus: locations.business_status,
            googleMapsUri: locations.google_maps_uri,
            editorialSummary: locations.editorial_summary,
            openingPeriods: locations.opening_periods,
          })
          .from(itinerary_activities)
          .leftJoin(locations, eq(itinerary_activities.location_id, locations.id))
          .where(inArray(itinerary_activities.day_id, [...dayIndexById.keys()]))
          .orderBy(itinerary_activities.position);

  const byDay = new Map<string, ItineraryActivityDetail[]>();
  for (const row of activityRows) {
    const date = dateById.get(row.dayId)!;
    const travel = row.travelToNext;
    const activity: ItineraryActivityDetail = {
      id: row.id,
      day_id: row.dayId,
      day_index: dayIndexById.get(row.dayId)!,
      // A stop whose location row is missing still has a slot on the day; the
      // page shows the role rather than an empty card.
      name: row.locationName ?? row.slotRole,
      start_time: minutesToISO(date, row.startMin),
      end_time: minutesToISO(date, row.endMin),
      category: categoryFor(row.slotRole),
      place_id: row.placeId ?? null,
      location_id: row.locationId ?? null,
      photo_url: row.photoUrls?.[0] ?? null,
      content: (row.content as StopContent | null) ?? null,
      match_reasons: row.matchReasons ?? [],
      travel_distance_meters: travel?.meters ?? null,
      travel_duration_seconds: travel ? Math.round(travel.minutes * 60) : null,
      travel_mode: travel?.mode ?? null,
      position: row.position,
      location: row.locationId
        ? {
            id: row.locationId,
            name: row.locationName!,
            latitude: row.latitude,
            longitude: row.longitude,
            photo_urls: row.photoUrls ?? null,
            formatted_address: row.formattedAddress,
            stay_duration: row.stayDuration,
            rating: row.rating,
            user_rating_count: row.userRatingCount,
            price_range: row.priceRange ?? null,
            primary_type: row.primaryType,
            categories: row.types ?? [],
            business_status: row.businessStatus,
            google_maps_uri: row.googleMapsUri,
            editorial_summary: row.editorialSummary,
            regular_opening_hours: (() => {
              const descriptions = weekdayDescriptionsFrom(row.openingPeriods);
              return descriptions.length > 0 ? { weekdayDescriptions: descriptions } : null;
            })(),
          }
        : null,
    };
    byDay.set(row.dayId, [...(byDay.get(row.dayId) ?? []), activity]);
  }

  const days = dayRows.map((row) => ({
    id: row.id,
    date: row.date,
    day_index: row.day_index,
    area_name: row.area_name,
    activities: byDay.get(row.id) ?? [],
  }));

  return {
    id: itinerary.id,
    name: itinerary.name,
    city: itinerary.city,
    country: itinerary.country,
    // The create flow writes the region into `city` — see `searchLocality` in
    // `AGENTS.md` — so this is the same string, under the name the page uses.
    region: itinerary.city,
    latitude: itinerary.latitude,
    longitude: itinerary.longitude,
    start_date: itinerary.start_date,
    end_date: endDateFor(itinerary.start_date, itinerary.total_days),
    total_days: itinerary.total_days,
    total_activities: activityRows.length,
    overview: overviewFrom(itinerary.planner_debug ?? null),
    // The first stop that resolved a photo. There is no thumbnail column, and
    // a trip's first photograph is the honest stand-in for one.
    thumbnail_url:
      days.flatMap((day) => day.activities).find((a) => a.photo_url)?.photo_url ?? null,
    days,
  };
}
