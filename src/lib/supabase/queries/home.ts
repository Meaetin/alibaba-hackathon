import type { SupabaseClient } from "@supabase/supabase-js";
import tzlookup from "tz-lookup";
import { getCollectionPreviewImages } from "../queries";
import type { TransportMode } from "@/components/ui/itinerary/ItineraryDayColumn/constants";
import type { PriceRange } from "@/lib/maps/price-range";

// ───── Types ─────────────────────────────────────────────────────────────────

export type FilterType =
  | "recent"
  | "itinerary"
  | "collection"
  | "links"
  | "location"
  | "favorites"
  | "archived";

export type RecentContentItem = {
  id: string;
  type: "itinerary" | "collection" | "link" | "location";
  name: string;
  thumbnail_url?: string | null;
  preview_images?: string[];
  updated_at: string;
  is_bookmarked?: boolean;
  is_archived?: boolean;
  metadata?: Record<string, unknown>;
};

async function attachCollectionPreviewImages(
  supabase: SupabaseClient,
  items: RecentContentItem[],
): Promise<RecentContentItem[]> {
  const ids = items.map((i) => i.id);
  if (ids.length === 0) return items;

  const map = await getCollectionPreviewImages(supabase, ids);

  return items.map((item) => ({
    ...item,
    preview_images: map.get(item.id) ?? [],
  }));
}

// ───── Single Itinerary Detail ─────────────────────────────────────────────

export type ItineraryDetail = {
  id: string;
  name: string;
  country: string;
  region?: string | null;
  latitude: number | null;
  longitude: number | null;
  start_date: string;
  end_date: string;
  total_days: number;
  total_activities: number;
  overview?: string | null;
  owner_id: string;
  collection_id: string;
  is_public: boolean;
  public_token?: string | null;
  invite_token?: string | null;
  invite_token_expires_at?: string | null;
  thumbnail_url?: string | null;
  updated_at?: string | null;
  collaborators: Array<{ user_id: string; role: string }>;
  days: ItineraryDayDetail[];
  timezone?: string | null;
};

export type ItineraryDayDetail = {
  id: string;
  date: string;
  day_index: number;
  area_name?: string | null;
  timezone?: string | null;
  activities: ItineraryActivityDetail[];
};

export type ItineraryActivityDetail = {
  id: string;
  day_id: string;
  day_index: number;
  name: string;
  start_time: string | null;
  end_time: string | null;
  category: string;
  meal_type?: string | null;
  place_id?: string | null;
  /** Client-generated token set on an optimistic add and echoed back on the
   *  realtime INSERT, so a temp card can be matched to its server row even when
   *  name/start_time changed (custom adds have no place_id/location_id to match on). */
  correlation_id?: string | null;
  /** FK to `locations`. Kept on the type so the side panel can lazy-hydrate
   *  when the eager join returns null (e.g. realtime INSERT echo). */
  location_id?: string | null;
  photo_url?: string | null;
  source_flight_id?: string | null;
  source_lodging_id?: string | null;
  /** Flight-card subtitle source on departure cards (title "Check in - …").
   *  Persisted on the activity row at insert time; mutually exclusive with
   *  `flight_arrive_time` per card. */
  flight_depart_time?: string | null;
  /** Flight-card subtitle source on arrival cards (title "Landing in - …").
   *  Persisted on the activity row at insert time; mutually exclusive with
   *  `flight_depart_time` per card. */
  flight_arrive_time?: string | null;
  travel_polyline?: string | null;
  travel_distance_meters?: number | null;
  travel_duration_seconds?: number | null;
  /** Transport mode the three `travel_*` values above were computed in. The leg
   *  departs THIS activity, so this row owns the mode for the leg to the next stop. */
  travel_mode?: TransportMode | null;
  /** Dense 0-based ordinal within the day, authoritative for display order
   *  (migration 122, ADR 0007). Render order is derived from this, never from
   *  array position — arrays here are rebuilt constantly by refetches, realtime
   *  row echoes, and the `itinerary.days` → `editLocalDays` sync, and any of
   *  those silently loses an order that only exists as array identity. */
  position?: number | null;
  location?: ActivityLocation | null;
};

/** Shape of the embedded `locations` row when joined onto an itinerary activity.
 *  Kept in sync with the `locations(...)` projection in `getItineraryDetail()`
 *  below and with the realtime hydration in `useItineraryRealtime`. */
export type ActivityLocation = {
  id: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
  photo_urls?: string[] | null;
  formatted_address?: string | null;
  google_maps_uri?: string | null;
  google_maps_links?: Record<string, unknown> | null;
  location_context?: string | null;
  regular_opening_hours?: Record<string, unknown> | null;
  stay_duration?: number | null;
  rating?: number | null;
  user_rating_count?: number | null;
  /** Parsed Google Places price range (per-person), e.g. { startPrice: 1, endPrice: 100000, currency: "VND" }. */
  price_range?: PriceRange | null;
  primary_type?: string | null;
  categories?: string[] | null;
  business_status?: string | null;
  website_uri?: string | null;
  international_phone_number?: string | null;
  national_phone_number?: string | null;
  photos?: Array<{
    name?: string;
    widthPx?: number;
    heightPx?: number;
    authorAttributions?: Array<{ displayName?: string; uri?: string; photoUri?: string }>;
  }> | null;
};

/**
 * Get full itinerary detail including days, activities, and locations.
 */
export async function getItineraryDetail(
  supabase: SupabaseClient,
  itineraryId: string,
): Promise<ItineraryDetail | null> {
  // Fetch itinerary base data
  const { data: itinerary, error: itError } = await supabase
    .from("itineraries")
    .select("id, name, country, region, latitude, longitude, start_date, end_date, total_days, total_activities, overview, owner_id, collection_id, is_public, public_token, invite_token, invite_token_expires_at, thumbnail_url, updated_at")
    .eq("id", itineraryId)
    .maybeSingle();

  if (itError) {
    console.error("Error fetching itinerary:", itError.code, itError.message, itError.details);
    return null;
  }
  if (!itinerary) return null;

  // Fetch collaborators (exclude owner — rendered separately)
  const { data: collabData } = await supabase
    .from("user_itinerary")
    .select("user_id, role")
    .eq("itinerary_id", itineraryId)
    .eq("role", "collaborator");

  // Fetch days (constrained to itinerary date range to exclude any orphaned rows)
  const { data: daysData } = await supabase
    .from("itinerary_days")
    .select("id, date, day_index, area_name, timezone")
    .eq("itinerary_id", itineraryId)
    .gte("date", itinerary.start_date)
    .lte("date", itinerary.end_date)
    .order("day_index", { ascending: true });

  // Fetch activities with locations
  const { data: activitiesData } = await supabase
    .from("itinerary_activities")
    .select(`
      id, day_id, name, start_time, end_time, category, meal_type,
      place_id, location_id, photo_url, source_flight_id, source_lodging_id,
      flight_depart_time, flight_arrive_time,
      travel_polyline, travel_distance_meters, travel_duration_seconds, travel_mode, position,
      locations(
        id, name, latitude, longitude, photo_urls, formatted_address,
        google_maps_uri, google_maps_links, location_context, regular_opening_hours,
        stay_duration, rating, user_rating_count, price_range, primary_type,
        categories, business_status, website_uri,
        international_phone_number, national_phone_number, photos
      )
    `)
    .eq("itinerary_id", itineraryId)
    // `position` is authoritative for order within a day (migration 122).
    // start_time only breaks ties for rows predating the backfill.
    .order("position", { ascending: true, nullsFirst: false })
    .order("start_time", { ascending: true });

  const days: ItineraryDayDetail[] = (daysData ?? []).map((day: { id: string; date: string; day_index: number; area_name: string | null; timezone: string | null }) => {
    const activities = ((activitiesData ?? []) as unknown as Array<{
      id: string;
      day_id: string;
      name: string;
      start_time: string | null;
      end_time: string | null;
      category: string;
      meal_type: string | null;
      place_id: string | null;
      location_id: string | null;
      photo_url: string | null;
      source_flight_id: string | null;
      source_lodging_id: string | null;
      flight_depart_time: string | null;
      flight_arrive_time: string | null;
      travel_polyline: string | null;
      travel_mode: TransportMode | null;
      position: number | null;
      travel_distance_meters: number | null;
      travel_duration_seconds: number | null;
      locations: ActivityLocation | ActivityLocation[] | null;
    }>)
      .filter((a) => a.day_id === day.id)
      .map((a) => {
        const loc = Array.isArray(a.locations) ? a.locations[0] ?? null : a.locations;
        return {
          id: a.id,
          day_id: a.day_id,
          day_index: day.day_index,
          name: a.name,
          start_time: a.start_time,
          end_time: a.end_time,
          category: a.category,
          meal_type: a.meal_type,
          place_id: a.place_id,
          location_id: a.location_id,
          photo_url: a.photo_url,
          source_flight_id: a.source_flight_id,
          source_lodging_id: a.source_lodging_id,
          flight_depart_time: a.flight_depart_time,
          flight_arrive_time: a.flight_arrive_time,
          travel_polyline: a.travel_polyline,
          travel_distance_meters: a.travel_distance_meters,
          travel_duration_seconds: a.travel_duration_seconds,
          travel_mode: a.travel_mode,
          position: a.position,
          location: loc,
        };
      });

    return {
      id: day.id,
      date: day.date,
      day_index: day.day_index,
      area_name: day.area_name,
      timezone: day.timezone,
      activities,
    };
  });

  return {
    id: itinerary.id,
    name: itinerary.name,
    country: itinerary.country,
    region: itinerary.region ?? null,
    latitude: itinerary.latitude ?? null,
    longitude: itinerary.longitude ?? null,
    start_date: itinerary.start_date,
    end_date: itinerary.end_date,
    total_days: itinerary.total_days,
    total_activities: itinerary.total_activities,
    overview: itinerary.overview,
    owner_id: itinerary.owner_id,
    collection_id: itinerary.collection_id as string,
    is_public: (itinerary as { is_public?: boolean }).is_public ?? false,
    public_token: (itinerary as { public_token?: string | null }).public_token ?? null,
    invite_token: (itinerary as { invite_token?: string | null }).invite_token ?? null,
    invite_token_expires_at: (itinerary as { invite_token_expires_at?: string | null }).invite_token_expires_at ?? null,
    thumbnail_url: (itinerary as { thumbnail_url?: string | null }).thumbnail_url ?? null,
    updated_at: (itinerary as { updated_at?: string | null }).updated_at ?? null,
    collaborators: (collabData ?? []) as Array<{ user_id: string; role: string }>,
    days,
    timezone: days[0]?.timezone ?? (
      itinerary.latitude != null && itinerary.longitude != null
        ? tzlookup(itinerary.latitude, itinerary.longitude)
        : null
    ),
  };
}

// ───── Recent Content ────────────────────────────────────────────────────────

/**
 * Get recent content by filter type.
 * @param cursor - ISO updated_at of the last loaded item (exclusive upper bound for pagination)
 */
export async function getRecentContent(
  supabase: SupabaseClient,
  userId: string,
  filter: FilterType,
  limit: number = 12,
  cursor?: string,
): Promise<RecentContentItem[]> {
  switch (filter) {
    case "itinerary":
      return getRecentItineraries(supabase, userId, limit, cursor);
    case "collection":
      return getRecentCollections(supabase, userId, limit, cursor);
    case "links":
      return getRecentLinks(supabase, userId, limit, cursor);
    case "location":
      return getRecentLocations(supabase, userId, limit, cursor);
    case "favorites":
      return getFavoriteContent(supabase, userId, limit);
    case "archived":
      return getArchivedContent(supabase, userId, limit);
    case "recent":
    default:
      return getAllRecentContent(supabase, userId, limit, cursor);
  }
}

async function getRecentItineraries(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<RecentContentItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("itineraries")
    .select("id, name, country, thumbnail_url, updated_at, user_itinerary!inner(is_bookmarked, is_archived)")
    .eq("user_itinerary.user_id", userId)
    .eq("user_itinerary.is_archived", false)
    .order("updated_at", { ascending: false });

  if (cursor) query = query.lt("updated_at", cursor);

  const { data, error } = await query.limit(limit);

  if (error || !data) return [];

  return (data as Array<{ id: string; name: string; country: string; thumbnail_url: string | null; updated_at: string; user_itinerary: Array<{ is_bookmarked: boolean; is_archived: boolean }> }>).map((item) => ({
    id: item.id,
    type: "itinerary" as const,
    name: item.name,
    thumbnail_url: item.thumbnail_url,
    updated_at: item.updated_at,
    is_bookmarked: item.user_itinerary[0]?.is_bookmarked ?? false,
    is_archived: false,
    metadata: { country: item.country },
  }));
}

async function getRecentCollections(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<RecentContentItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("collections")
    .select("id, name, thumbnail_url, updated_at, user_collection!inner(user_id, is_bookmarked, is_archived)")
    .eq("user_collection.user_id", userId)
    .eq("user_collection.is_archived", false)
    .neq("is_itinerary_collection", true)
    .order("updated_at", { ascending: false });

  if (cursor) query = query.lt("updated_at", cursor);

  const { data, error } = await query.limit(limit);

  if (error || !data) return [];

  const items = (data as Array<{ id: string; name: string; thumbnail_url: string | null; updated_at: string; user_collection: Array<{ is_bookmarked: boolean; is_archived: boolean }> }>).map((item) => ({
    id: item.id,
    type: "collection" as const,
    name: item.name,
    thumbnail_url: item.thumbnail_url,
    updated_at: item.updated_at,
    is_bookmarked: item.user_collection[0]?.is_bookmarked ?? false,
    is_archived: false,
  }));
  return attachCollectionPreviewImages(supabase, items);
}

async function getRecentLinks(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<RecentContentItem[]> {
  // Query from content directly so we can order by content.updated_at
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("content")
    .select("id, content_title, content_thumbnail, updated_at, user_content!inner(user_id, is_bookmarked, is_archived)")
    .eq("user_content.user_id", userId)
    .eq("user_content.is_archived", false)
    .eq("processing_status", "completed")
    .order("updated_at", { ascending: false });

  if (cursor) query = query.lt("updated_at", cursor);

  const { data, error } = await query.limit(limit);

  if (error || !data) return [];

  return (data as Array<{ id: string; content_title: string | null; content_thumbnail: string | null; updated_at: string; user_content: { is_bookmarked: boolean; is_archived: boolean } }>).map((item) => ({
    id: item.id,
    type: "link" as const,
    name: item.content_title ?? "Untitled",
    thumbnail_url: item.content_thumbnail,
    updated_at: item.updated_at,
    is_bookmarked: item.user_content?.is_bookmarked ?? false,
    is_archived: item.user_content?.is_archived ?? false,
  }));
}

type LocationRow = {
  created_at: string;
  location_id: string;
  locations: { id: string; name: string; photo_urls: string[] | null } | null;
};

async function getCollectionLocations(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<RecentContentItem[]> {
  const { data: ucData } = await supabase
    .from("user_collection")
    .select("collection_id")
    .eq("user_id", userId);

  if (!ucData || ucData.length === 0) return [];

  const collectionIds = ucData.map((uc: { collection_id: string }) => uc.collection_id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("collection_locations")
    .select("created_at, location_id, locations(id, name, photo_urls)")
    .in("collection_id", collectionIds)
    .order("created_at", { ascending: false });

  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query.limit(limit);

  if (error || !data) return [];

  const seen = new Set<string>();
  const result: RecentContentItem[] = [];

  for (const row of data as LocationRow[]) {
    const loc = row.locations;
    if (loc && !seen.has(loc.id)) {
      seen.add(loc.id);
      result.push({
        id: loc.id,
        type: "location" as const,
        name: loc.name,
        thumbnail_url: loc.photo_urls?.[0] ?? null,
        updated_at: row.created_at,
      });
    }
  }

  return result;
}

async function getContentLocations(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<RecentContentItem[]> {
  const { data: ucData } = await supabase
    .from("user_content")
    .select("content_id")
    .eq("user_id", userId);

  if (!ucData || ucData.length === 0) return [];

  const contentIds = ucData.map((uc: { content_id: string }) => uc.content_id);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from("content_locations")
    .select("created_at, location_id, locations(id, name, photo_urls)")
    .in("content_id", contentIds)
    .order("created_at", { ascending: false });

  if (cursor) query = query.lt("created_at", cursor);

  const { data, error } = await query.limit(limit);

  if (error || !data) return [];

  const seen = new Set<string>();
  const result: RecentContentItem[] = [];

  for (const row of data as LocationRow[]) {
    const loc = row.locations;
    if (loc && !seen.has(loc.id)) {
      seen.add(loc.id);
      result.push({
        id: loc.id,
        type: "location" as const,
        name: loc.name,
        thumbnail_url: loc.photo_urls?.[0] ?? null,
        updated_at: row.created_at,
      });
    }
  }

  return result;
}

async function getRecentLocations(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<RecentContentItem[]> {
  const [collectionLocs, contentLocs] = await Promise.all([
    getCollectionLocations(supabase, userId, limit * 3, cursor),
    getContentLocations(supabase, userId, limit * 3, cursor),
  ]);

  const all = [...collectionLocs, ...contentLocs];
  all.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  const seen = new Set<string>();
  const merged: RecentContentItem[] = [];

  for (const item of all) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      merged.push(item);
      if (merged.length === limit) break;
    }
  }

  return merged;
}

async function getFavoriteLinks(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
): Promise<RecentContentItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("content")
    .select("id, content_title, content_thumbnail, updated_at, user_content!inner(user_id, is_bookmarked, is_archived)")
    .eq("user_content.user_id", userId)
    .eq("user_content.is_bookmarked", true)
    .eq("user_content.is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Array<{ id: string; content_title: string | null; content_thumbnail: string | null; updated_at: string }>).map((item) => ({
    id: item.id,
    type: "link" as const,
    name: item.content_title ?? "Untitled",
    thumbnail_url: item.content_thumbnail,
    updated_at: item.updated_at,
    is_bookmarked: true,
    is_archived: false,
  }));
}

async function getFavoriteCollections(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
): Promise<RecentContentItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("collections")
    .select("id, name, thumbnail_url, updated_at, user_collection!inner(user_id, is_bookmarked, is_archived)")
    .eq("user_collection.user_id", userId)
    .eq("user_collection.is_bookmarked", true)
    .eq("user_collection.is_archived", false)
    .neq("is_itinerary_collection", true)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  const items = (data as Array<{ id: string; name: string; thumbnail_url: string | null; updated_at: string }>).map((item) => ({
    id: item.id,
    type: "collection" as const,
    name: item.name,
    thumbnail_url: item.thumbnail_url,
    updated_at: item.updated_at,
    is_bookmarked: true,
    is_archived: false,
  }));
  return attachCollectionPreviewImages(supabase, items);
}

async function getFavoriteItineraries(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
): Promise<RecentContentItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("itineraries")
    .select("id, name, country, thumbnail_url, updated_at, user_itinerary!inner(is_bookmarked, is_archived)")
    .eq("user_itinerary.user_id", userId)
    .eq("user_itinerary.is_bookmarked", true)
    .eq("user_itinerary.is_archived", false)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Array<{ id: string; name: string; country: string; thumbnail_url: string | null; updated_at: string }>).map((item) => ({
    id: item.id,
    type: "itinerary" as const,
    name: item.name,
    thumbnail_url: item.thumbnail_url,
    updated_at: item.updated_at,
    is_bookmarked: true,
    is_archived: false,
  }));
}

async function getFavoriteContent(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
): Promise<RecentContentItem[]> {
  const [links, collections, itineraries] = await Promise.all([
    getFavoriteLinks(supabase, userId, limit),
    getFavoriteCollections(supabase, userId, limit),
    getFavoriteItineraries(supabase, userId, limit),
  ]);
  const all = [...links, ...collections, ...itineraries];
  all.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  return all.slice(0, limit);
}

async function getArchivedLinks(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
): Promise<RecentContentItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("content")
    .select("id, content_title, content_thumbnail, updated_at, user_content!inner(user_id, is_archived)")
    .eq("user_content.user_id", userId)
    .eq("user_content.is_archived", true)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Array<{ id: string; content_title: string | null; content_thumbnail: string | null; updated_at: string }>).map((item) => ({
    id: item.id,
    type: "link" as const,
    name: item.content_title ?? "Untitled",
    thumbnail_url: item.content_thumbnail,
    updated_at: item.updated_at,
    is_bookmarked: false,
    is_archived: true,
  }));
}

async function getArchivedCollections(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
): Promise<RecentContentItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("collections")
    .select("id, name, thumbnail_url, updated_at, user_collection!inner(user_id, is_archived)")
    .eq("user_collection.user_id", userId)
    .eq("user_collection.is_archived", true)
    .neq("is_itinerary_collection", true)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  const items = (data as Array<{ id: string; name: string; thumbnail_url: string | null; updated_at: string }>).map((item) => ({
    id: item.id,
    type: "collection" as const,
    name: item.name,
    thumbnail_url: item.thumbnail_url,
    updated_at: item.updated_at,
    is_bookmarked: false,
    is_archived: true,
  }));
  return attachCollectionPreviewImages(supabase, items);
}

async function getArchivedItineraries(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
): Promise<RecentContentItem[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any)
    .from("itineraries")
    .select("id, name, country, thumbnail_url, updated_at, user_itinerary!inner(is_archived)")
    .eq("user_itinerary.user_id", userId)
    .eq("user_itinerary.is_archived", true)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return (data as Array<{ id: string; name: string; country: string; thumbnail_url: string | null; updated_at: string }>).map((item) => ({
    id: item.id,
    type: "itinerary" as const,
    name: item.name,
    thumbnail_url: item.thumbnail_url,
    updated_at: item.updated_at,
    is_bookmarked: false,
    is_archived: true,
  }));
}

async function getArchivedContent(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
): Promise<RecentContentItem[]> {
  const [links, collections, itineraries] = await Promise.all([
    getArchivedLinks(supabase, userId, limit),
    getArchivedCollections(supabase, userId, limit),
    getArchivedItineraries(supabase, userId, limit),
  ]);
  const all = [...links, ...collections, ...itineraries];
  all.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  return all.slice(0, limit);
}

async function getAllRecentContent(
  supabase: SupabaseClient,
  userId: string,
  limit: number,
  cursor?: string,
): Promise<RecentContentItem[]> {
  const [itineraries, collections, links] = await Promise.all([
    getRecentItineraries(supabase, userId, limit, cursor),
    getRecentCollections(supabase, userId, limit, cursor),
    getRecentLinks(supabase, userId, limit, cursor),
  ]);

  const allItems = [...itineraries, ...collections, ...links];
  allItems.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());

  return allItems.slice(0, limit);
}

export async function getContentLocationIds(
  supabase: SupabaseClient,
  contentIds: string[],
): Promise<string[]> {
  if (contentIds.length === 0) return [];
  const { data, error } = await supabase
    .from("content_locations")
    .select("location_id")
    .in("content_id", contentIds);
  if (error || !data) return [];
  return [...new Set(data.map((r: { location_id: string }) => r.location_id))];
}
