import type { SupabaseClient } from "@supabase/supabase-js";
import { getCollectionPreviewImages } from "../queries";

export interface RecentlyViewedItem {
  id: string;
  type: "link" | "collection" | "itinerary";
  name: string;
  thumbnail_url: string | null;
  preview_images?: string[];
  viewed_at: string;
}

export async function getRecentlyViewed(
  supabase: SupabaseClient,
  userId: string,
  limit = 8,
): Promise<RecentlyViewedItem[]> {
  const { data: rows, error } = await supabase
    .from("recently_viewed")
    .select("entity_type, entity_id, viewed_at")
    .eq("user_id", userId)
    .order("viewed_at", { ascending: false })
    .limit(limit);

  if (error || !rows || rows.length === 0) return [];

  const grouped = {
    link: [] as string[],
    collection: [] as string[],
    itinerary: [] as string[],
  };

  for (const row of rows) {
    const type = row.entity_type as keyof typeof grouped;
    grouped[type].push(row.entity_id);
  }

  const [collections, itineraries, links] = await Promise.all([
    grouped.collection.length > 0
      ? supabase
          .from("collections")
          .select("id, name, thumbnail_url")
          .in("id", grouped.collection)
      : { data: [] },
    grouped.itinerary.length > 0
      ? supabase
          .from("itineraries")
          .select("id, name, thumbnail_url")
          .in("id", grouped.itinerary)
      : { data: [] },
    grouped.link.length > 0
      ? supabase
          .from("content")
          .select("id, content_title, content_thumbnail")
          .in("id", grouped.link)
      : { data: [] },
  ]);

  type EntityMap = Record<string, { name: string; thumbnail_url: string | null }>;

  const entityMap: EntityMap = {};

  for (const c of (collections.data ?? []) as Array<{ id: string; name: string; thumbnail_url: string | null }>) {
    entityMap[c.id] = { name: c.name, thumbnail_url: c.thumbnail_url };
  }
  for (const i of (itineraries.data ?? []) as Array<{ id: string; name: string; thumbnail_url: string | null }>) {
    entityMap[i.id] = { name: i.name, thumbnail_url: i.thumbnail_url };
  }
  for (const l of (links.data ?? []) as Array<{ id: string; content_title: string | null; content_thumbnail: string | null }>) {
    entityMap[l.id] = { name: l.content_title ?? "Untitled", thumbnail_url: l.content_thumbnail };
  }

  const items = rows
    .filter((row) => entityMap[row.entity_id])
    .map((row) => ({
      id: row.entity_id,
      type: row.entity_type as RecentlyViewedItem["type"],
      name: entityMap[row.entity_id].name,
      thumbnail_url: entityMap[row.entity_id].thumbnail_url,
      viewed_at: row.viewed_at,
    }));

  const collectionIds = items.filter((i) => i.type === "collection").map((i) => i.id);
  if (collectionIds.length === 0) return items;

  const previewMap = await getCollectionPreviewImages(supabase, collectionIds);

  return items.map((item) =>
    item.type === "collection"
      ? { ...item, preview_images: previewMap.get(item.id) ?? [] }
      : item,
  );
}
