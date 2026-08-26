import type { SupabaseClient } from "@supabase/supabase-js";
import { getCollectionPreviewImages } from "../queries";

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

/**
 * The itinerary page's types now live with the data they describe, in
 * `src/lib/db/itinerary-detail.ts`, and are re-exported here so the twenty-odd
 * components that import them from this module keep working.
 *
 * The Supabase `getItineraryDetail` that used to sit here is gone. It queried a
 * schema this build does not have, against a project that was never configured,
 * and its only symptom was a "Failed to fetch" in the console while the page
 * rendered empty. The read is `GET /api/itineraries/[id]` over Neon.
 */
export type {
  ItineraryDetail,
  ItineraryDayDetail,
  ItineraryActivityDetail,
  ActivityCategory,
  ActivityLocationDetail as ActivityLocation,
} from "@/lib/db/itinerary-detail";

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
