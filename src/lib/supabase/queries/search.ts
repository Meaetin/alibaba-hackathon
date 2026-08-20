import type { SupabaseClient } from "@supabase/supabase-js";
import { getCollectionPreviewImages } from "../queries";

export interface SearchResultItem {
  id: string;
  entity_type: "link" | "collection" | "itinerary";
  name: string;
  thumbnail_url: string | null;
  preview_images?: string[];
  region: string | null;
  country: string | null;
  updated_at: string;
  relevance: number;
}

export interface SearchResponse {
  results: SearchResultItem[];
  hasMore: boolean;
}

export async function searchViaRpc(
  supabase: SupabaseClient,
  userId: string,
  query: string,
  filterType: string | null = null,
  offset = 0,
  limit = 10,
): Promise<SearchResponse> {
  const q = query.trim();
  if (!q) return { results: [], hasMore: false };

  const { data, error } = await supabase.rpc("search_all", {
    p_user_id: userId,
    p_query: q,
    p_filter_type: filterType,
    p_limit: limit + 1,
    p_offset: offset,
  });

  if (error || !data) return { results: [], hasMore: false };

  const rows = data as Array<{
    id: string;
    entity_type: string;
    name: string;
    thumbnail_url: string | null;
    region: string | null;
    country: string | null;
    updated_at: string;
    relevance: number;
  }>;

  const hasMore = rows.length > limit;
  const results = rows.slice(0, limit).map((row) => ({
    id: row.id,
    entity_type: row.entity_type as SearchResultItem["entity_type"],
    name: row.name,
    thumbnail_url: row.thumbnail_url,
    region: row.region,
    country: row.country,
    updated_at: row.updated_at,
    relevance: row.relevance,
  }));

  const enriched = await attachSearchCollectionPreviews(supabase, results);
  return { results: enriched, hasMore };
}

async function attachSearchCollectionPreviews(
  supabase: SupabaseClient,
  items: SearchResultItem[],
): Promise<SearchResultItem[]> {
  const collectionIds = items
    .filter((i) => i.entity_type === "collection")
    .map((i) => i.id);
  if (collectionIds.length === 0) return items;

  const map = await getCollectionPreviewImages(supabase, collectionIds);

  return items.map((item) =>
    item.entity_type === "collection"
      ? { ...item, preview_images: map.get(item.id) ?? [] }
      : item,
  );
}

export interface EntityLocationItem {
  id: string;
  name: string;
  thumbnail_url: string | null;
}

export async function getEntityLocations(
  supabase: SupabaseClient,
  entityType: "link" | "collection" | "itinerary",
  entityId: string,
): Promise<EntityLocationItem[]> {
  if (entityType === "collection") {
    const { data } = await supabase
      .from("collection_locations")
      .select("location_id, locations(id, name, photo_urls)")
      .eq("collection_id", entityId);

    if (!data) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (data as any[]).map((row) => ({
      id: row.locations.id as string,
      name: row.locations.name as string,
      thumbnail_url: (row.locations.photo_urls as string[] | null)?.[0] ?? null,
    }));
  }

  if (entityType === "itinerary") {
    const { data: days } = await supabase
      .from("itinerary_days")
      .select("id")
      .eq("itinerary_id", entityId);

    if (!days || days.length === 0) return [];

    const dayIds = days.map((d: { id: string }) => d.id);
    const { data: activities } = await supabase
      .from("itinerary_activities")
      .select("location_id, locations(id, name, photo_urls)")
      .in("day_id", dayIds)
      .not("location_id", "is", null);

    if (!activities) return [];

    const seen = new Set<string>();
    const results: EntityLocationItem[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const act of activities as any[]) {
      const locId = act.locations.id as string;
      if (!seen.has(locId)) {
        seen.add(locId);
        results.push({
          id: locId,
          name: act.locations.name as string,
          thumbnail_url: (act.locations.photo_urls as string[] | null)?.[0] ?? null,
        });
      }
    }
    return results;
  }

  // entityType === "link"
  const { data } = await supabase
    .from("content_locations")
    .select("location_id, locations(id, name, photo_urls)")
    .eq("content_id", entityId);

  if (!data) return [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data as any[]).map((row) => ({
    id: row.locations.id as string,
    name: row.locations.name as string,
    thumbnail_url: (row.locations.photo_urls as string[] | null)?.[0] ?? null,
  }));
}
