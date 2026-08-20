import type { SupabaseClient } from "@supabase/supabase-js";

interface MapClusterRow {
  id: string;
  region: string | null;
  country: string | null;
  latitude: string;
  longitude: string;
}

export interface RawMapLocation {
  entityId: string;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
}

export async function getMapClustersForCollections(
  supabase: SupabaseClient,
  userId: string,
): Promise<RawMapLocation[]> {
  const { data, error } = await supabase
    .from("collections")
    .select("id, region, country, latitude, longitude, user_collection!inner(user_id)")
    .eq("user_collection.user_id", userId)
    .not("country", "is", null)
    .not("latitude", "is", null);

  if (error || !data) return [];

  return (data as MapClusterRow[]).map((item) => ({
    entityId: item.id,
    region: item.region,
    country: item.country,
    latitude: parseFloat(item.latitude),
    longitude: parseFloat(item.longitude),
  }));
}

export async function getMapClustersForContent(
  supabase: SupabaseClient,
  userId: string,
): Promise<RawMapLocation[]> {
  const { data, error } = await supabase
    .from("content")
    .select("id, region, country, latitude, longitude, user_content!inner(user_id)")
    .eq("user_content.user_id", userId)
    .not("country", "is", null)
    .not("latitude", "is", null);

  if (error || !data) return [];

  return (data as Array<{ id: string; region: string | null; country: string | null; latitude: string; longitude: string }>).map((item) => ({
    entityId: item.id,
    region: item.region,
    country: item.country,
    latitude: parseFloat(item.latitude),
    longitude: parseFloat(item.longitude),
  }));
}

export async function getMapClustersForItineraries(
  supabase: SupabaseClient,
  userId: string,
): Promise<RawMapLocation[]> {
  const { data, error } = await supabase
    .from("itineraries")
    .select("id, region, country, latitude, longitude")
    .eq("owner_id", userId)
    .not("latitude", "is", null);

  if (error || !data) return [];

  return (data as MapClusterRow[]).map((item) => ({
    entityId: item.id,
    region: item.region,
    country: item.country,
    latitude: parseFloat(item.latitude),
    longitude: parseFloat(item.longitude),
  }));
}

export async function getMapClustersForDashboard(
  supabase: SupabaseClient,
  userId: string,
): Promise<RawMapLocation[]> {
  const [collections, content, itineraries] = await Promise.all([
    getMapClustersForCollections(supabase, userId),
    getMapClustersForContent(supabase, userId),
    getMapClustersForItineraries(supabase, userId),
  ]);

  return [...collections, ...content, ...itineraries];
}
