import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A collection or itinerary (other than the current one) that also contains a
 * given location — powers the location panel's "Also found in" section and the
 * "Show more" modal. RLS on `collections` / `itineraries` scopes results to what
 * the current user can access (owned, collaborator, public).
 */
export interface LocationReference {
  /** Collection or itinerary id. */
  id: string;
  /** Kind label rendered first in the row meta. */
  type: "Collection" | "Itinerary";
  /** Display name. */
  name: string;
  /** Number of locations in this collection/itinerary. */
  locationCount: number;
  /** Cover image; falls back to a placeholder in the UI when null. */
  thumbnailUrl: string | null;
}

/**
 * The container the user is currently viewing, dropped from the results so a
 * location's "Also found in" never lists the collection/itinerary it's already
 * shown inside.
 */
export interface LocationReferenceExclude {
  itineraryId?: string;
  collectionId?: string;
}

interface CollectionRow {
  id: string;
  name: string;
  thumbnail_url: string | null;
  is_itinerary_collection: boolean;
  collection_locations: Array<{ count: number }> | null;
}

/** A reference tagged with when this location was added to it, for sorting. */
interface TaggedReference {
  ref: LocationReference;
  /** `collection_locations.created_at` for this location's membership (ISO). */
  addedAt: string;
}

/**
 * Fetch every collection and itinerary the current user can see that also
 * contains `locationId`, minus the container they're currently viewing
 * (`exclude`), newest membership first — so a just-added destination sits on
 * top and the optimistic card never jumps when the query reconciles.
 *
 * `collection_locations` is the single source of truth for membership: scheduling
 * a location as an activity mirrors it into that itinerary's linked collection via
 * the `trg_mirror_activity_location` database trigger (transactional with the
 * activity insert), so every collection and itinerary a location belongs to is
 * reachable through the `collection_locations` junction alone, and its `created_at`
 * dates the add.
 * Itinerary-linked collections (`is_itinerary_collection`) are surfaced as their
 * itinerary, not as a collection.
 */
export async function getLocationReferences(
  supabase: SupabaseClient,
  locationId: string,
  exclude: LocationReferenceExclude = {},
): Promise<LocationReference[]> {
  // Every collection (RLS-scoped) the location belongs to, with the timestamp it
  // was added — newest first.
  const { data: junction } = await supabase
    .from("collection_locations")
    .select("collection_id, created_at")
    .eq("location_id", locationId)
    .order("created_at", { ascending: false });

  const addedAtByCollection = new Map<string, string>();
  for (const r of (junction ?? []) as Array<{ collection_id: string; created_at: string }>) {
    if (!addedAtByCollection.has(r.collection_id)) {
      addedAtByCollection.set(r.collection_id, r.created_at);
    }
  }
  const collectionIds = [...addedAtByCollection.keys()];
  if (collectionIds.length === 0) return [];

  // Name + thumbnail + total location count per collection. RLS on `collections`
  // re-scopes to accessible rows, so inaccessible collections drop out here.
  const { data } = await supabase
    .from("collections")
    .select("id, name, thumbnail_url, is_itinerary_collection, collection_locations(count)")
    .in("id", collectionIds);

  if (!data) return [];

  const rows = data as CollectionRow[];
  const countFor = (c: CollectionRow) => c.collection_locations?.[0]?.count ?? 0;

  // Regular collections → "Collection" references (minus the one being viewed).
  const collections: TaggedReference[] = rows
    .filter((c) => !c.is_itinerary_collection && c.id !== exclude.collectionId)
    .map((c) => ({
      ref: {
        id: c.id,
        type: "Collection" as const,
        name: c.name,
        locationCount: countFor(c),
        thumbnailUrl: c.thumbnail_url,
      },
      addedAt: addedAtByCollection.get(c.id) ?? "",
    }));

  // Itinerary-linked collections → resolve to their itinerary and present those
  // as "Itinerary" references, counting locations from the same collection.
  const itineraryCollections = rows.filter((c) => c.is_itinerary_collection);
  const itineraries = await getItineraryReferences(
    supabase,
    itineraryCollections,
    addedAtByCollection,
    exclude.itineraryId,
  );

  // Newest add on top, across both kinds (ISO timestamps sort lexically).
  return [...collections, ...itineraries]
    .sort((a, b) => (a.addedAt < b.addedAt ? 1 : a.addedAt > b.addedAt ? -1 : 0))
    .map((t) => t.ref);
}

async function getItineraryReferences(
  supabase: SupabaseClient,
  itineraryCollections: CollectionRow[],
  addedAtByCollection: Map<string, string>,
  excludeItineraryId?: string,
): Promise<TaggedReference[]> {
  if (itineraryCollections.length === 0) return [];

  const countByCollection = new Map<string, number>(
    itineraryCollections.map((c) => [c.id, c.collection_locations?.[0]?.count ?? 0]),
  );

  // Each itinerary collection backs exactly one itinerary. RLS on `itineraries`
  // scopes to accessible rows.
  const { data: itineraries } = await supabase
    .from("itineraries")
    .select("id, name, thumbnail_url, collection_id")
    .in("collection_id", [...countByCollection.keys()]);

  if (!itineraries) return [];

  return (
    itineraries as Array<{
      id: string;
      name: string;
      thumbnail_url: string | null;
      collection_id: string;
    }>
  )
    .filter((i) => i.id !== excludeItineraryId)
    .map((i) => ({
      ref: {
        id: i.id,
        type: "Itinerary" as const,
        name: i.name,
        locationCount: countByCollection.get(i.collection_id) ?? 0,
        thumbnailUrl: i.thumbnail_url,
      },
      addedAt: addedAtByCollection.get(i.collection_id) ?? "",
    }));
}
