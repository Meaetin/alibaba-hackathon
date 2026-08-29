/**
 * Reads and writes for collections — the shelves a traveller puts places on.
 *
 * It follows `content.ts` deliberately: a `CollectionStore` port with a
 * Postgres implementation and an in-memory double, so the route handlers stay
 * drivable with no database. Same ownership rule too — **somebody else's
 * collection is a 404, never a 403**, because a 403 confirms the id names a
 * real thing, which is the one fact an outsider wants.
 *
 * The place rows themselves are never copied in here. `collection_locations`
 * points at `locations`, the shared Places cache, so a place saved from a link
 * and the same place scheduled in an itinerary are one row with one photo bill.
 * That is the whole reason this table is a junction rather than a copy.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import type { InferSelectModel } from "drizzle-orm";

import {
  collection_locations,
  collections,
  itineraries,
  itinerary_activities,
  itinerary_days,
  locations,
} from "./schema";
import type { Database } from "./client";

export type CollectionRow = InferSelectModel<typeof collections>;
export type LocationRow = InferSelectModel<typeof locations>;

/** One card in the `/collections` grid. Exactly the ported `CollectionWithRole`. */
export interface CollectionListItem {
  id: string;
  name: string;
  description?: string;
  country?: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  tags: string[];
  thumbnail_url?: string;
  owner_id: string;
  is_bookmarked: boolean;
  is_archived: boolean;
  /**
   * Pinned to their off values, the way `readItineraryList` pins the same kind
   * of field. Sharing left with the old REST backend — there is no
   * `collection_collaborators` table and no token routes — and the ported cards
   * still require these props.
   */
  is_public: boolean;
  fork_count: number;
  user_role: "owner" | "collaborator";
  location_count: number;
  /** Up to four photos for the card's 2×2 grid, oldest-added first. */
  preview_images: string[];
  created_at: string;
  updated_at: string;
}

/** A collection and every place on it. The ported `CollectionWithLocations`. */
export interface CollectionDetail extends CollectionListItem {
  locations: CollectionLocation[];
}

/** One place on a collection, and when it was put there. */
export interface CollectionLocation {
  location: LocationRow;
  added_at: string;
}

export interface CollectionToCreate {
  name: string;
  description?: string | null;
  country?: string | null;
  region?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  tags?: string[];
}

/** Every field `PATCH /api/collections/[id]` may set. Absent means unchanged;
 *  `null` means cleared, which is why these are not merely optional. */
export interface CollectionPatch {
  name?: string;
  description?: string | null;
  country?: string | null;
  region?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  is_bookmarked?: boolean;
  is_archived?: boolean;
}

/** What `addLocations` actually did. `added` and `skipped` are counted from the
 *  rows that landed, never from the ids that were offered — the two differ
 *  whenever a place is already on the shelf or its `locations` row is gone, and
 *  "added 8" over a grid showing 6 is the kind of lie nobody reports. */
export interface AddLocationsResult {
  added: number;
  /** Already on this collection. Not an error: adding twice is idempotent. */
  duplicates: number;
  /** Ids with no `locations` row. Skipped rather than invented. */
  unknown: number;
}

export interface CollectionStore {
  listCollections(userId: string): Promise<CollectionListItem[]>;
  /** Undefined for an id that does not exist **and** for one owned by somebody
   *  else. The caller cannot tell the two apart, which is the point. */
  readCollection(id: string, userId: string): Promise<CollectionDetail | undefined>;
  createCollection(
    input: CollectionToCreate,
    ownerId: string,
    now: Date,
  ): Promise<CollectionListItem>;
  /** Undefined when the row was not this person's to change. */
  updateCollection(
    id: string,
    patch: CollectionPatch,
    userId: string,
    now: Date,
  ): Promise<CollectionListItem | undefined>;
  /** False when the row was not this person's to delete. */
  deleteCollection(id: string, userId: string): Promise<boolean>;
  /** Undefined when the collection is not this person's. */
  addLocations(
    id: string,
    locationIds: string[],
    userId: string,
    now: Date,
  ): Promise<AddLocationsResult | undefined>;
  /** False when the collection is not this person's, or the place was not on
   *  it. The caller renders both as "we couldn't remove this location". */
  removeLocation(id: string, locationId: string, userId: string): Promise<boolean>;
  /**
   * The companion collection a finished plan gets, filled from the trip's own
   * stops. Returns undefined when the trip has no located stops — an empty
   * shelf beside a trip is worse than no shelf, because it reads as "this trip
   * saved nothing" rather than "nothing was saved yet".
   */
  createItineraryCollection(
    itineraryId: string,
    ownerId: string,
    now: Date,
  ): Promise<{ collectionId: string } | undefined>;
}

// ── the Postgres implementation ──────────────────────────────────────────────

export function createCollectionStore(db: Database): CollectionStore {
  /** The two aggregates every card needs, for a set of collections at once.
   *  One query for the grid rather than one per card — the same shape
   *  `listContent` uses for its first-located-place lookup. */
  async function previewsFor(
    collectionIds: string[],
  ): Promise<Map<string, { count: number; images: string[] }>> {
    const out = new Map<string, { count: number; images: string[] }>();
    if (collectionIds.length === 0) return out;

    const rows = await db
      .select({
        collection_id: collection_locations.collection_id,
        photo_urls: locations.photo_urls,
      })
      .from(collection_locations)
      .innerJoin(locations, eq(collection_locations.location_id, locations.id))
      .where(inArray(collection_locations.collection_id, collectionIds))
      .orderBy(collection_locations.added_at);

    for (const row of rows) {
      const entry = out.get(row.collection_id) ?? { count: 0, images: [] };
      entry.count += 1;
      const photo = row.photo_urls?.[0];
      if (photo && entry.images.length < PREVIEW_IMAGE_COUNT) entry.images.push(photo);
      out.set(row.collection_id, entry);
    }
    return out;
  }

  return {
    async listCollections(userId) {
      const rows = await db
        .select()
        .from(collections)
        .where(eq(collections.user_id, userId))
        .orderBy(desc(collections.updated_at));
      if (rows.length === 0) return [];

      const previews = await previewsFor(rows.map((row) => row.id));
      return rows.map((row) => toListItem(row, previews.get(row.id)));
    },

    async readCollection(id, userId) {
      if (!isUuid(id)) return undefined;

      // The owner check is in the `where`, not a comparison afterwards: a row
      // read and then rejected is a row that was still read.
      const [row] = await db
        .select()
        .from(collections)
        .where(and(eq(collections.id, id), eq(collections.user_id, userId)))
        .limit(1);
      if (!row) return undefined;

      const places = await db
        .select({ location: locations, added_at: collection_locations.added_at })
        .from(collection_locations)
        .innerJoin(locations, eq(collection_locations.location_id, locations.id))
        .where(eq(collection_locations.collection_id, row.id))
        .orderBy(collection_locations.added_at);

      return {
        ...toListItem(row, {
          count: places.length,
          images: previewImagesFrom(places.map((entry) => entry.location)),
        }),
        locations: places.map((entry) => ({
          location: entry.location,
          added_at: ISO(entry.added_at),
        })),
      };
    },

    async createCollection(input, ownerId, now) {
      const [row] = await db
        .insert(collections)
        .values({
          user_id: ownerId,
          name: input.name,
          description: input.description ?? null,
          country: input.country ?? null,
          region: input.region ?? null,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          tags: input.tags ?? [],
          created_at: now,
          updated_at: now,
        })
        .returning();
      return toListItem(row);
    },

    async updateCollection(id, patch, userId, now) {
      if (!isUuid(id)) return undefined;
      const [row] = await db
        .update(collections)
        .set({ ...patch, updated_at: now })
        .where(and(eq(collections.id, id), eq(collections.user_id, userId)))
        .returning();
      if (!row) return undefined;

      const previews = await previewsFor([row.id]);
      return toListItem(row, previews.get(row.id));
    },

    async deleteCollection(id, userId) {
      if (!isUuid(id)) return false;
      const deleted = await db
        .delete(collections)
        .where(and(eq(collections.id, id), eq(collections.user_id, userId)))
        .returning({ id: collections.id });
      return deleted.length > 0;
    },

    async addLocations(id, locationIds, userId, now) {
      if (!isUuid(id)) return undefined;
      const [owned] = await db
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.id, id), eq(collections.user_id, userId)))
        .limit(1);
      if (!owned) return undefined;

      const wanted = [...new Set(locationIds.filter(isUuid))];
      if (wanted.length === 0) return { added: 0, duplicates: 0, unknown: locationIds.length };

      // A place with no `locations` row is skipped rather than invented — the
      // same rule `saveContent` applies to a resolved place whose row is gone.
      const known = await db
        .select({ id: locations.id })
        .from(locations)
        .where(inArray(locations.id, wanted));
      const knownIds = new Set(known.map((row) => row.id));

      const inserted =
        knownIds.size === 0
          ? []
          : await db
              .insert(collection_locations)
              .values(
                [...knownIds].map((locationId) => ({
                  collection_id: owned.id,
                  location_id: locationId,
                  added_at: now,
                })),
              )
              // Adding a place already on the shelf is idempotent, not an
              // error. The unique index is what makes that true.
              .onConflictDoNothing()
              .returning({ id: collection_locations.id });

      // Only a change to the contents moves the clock. A no-op add that
      // reordered the grid would be a write the traveller did not make.
      if (inserted.length > 0) {
        await db
          .update(collections)
          .set({ updated_at: now })
          .where(eq(collections.id, owned.id));
      }

      return {
        added: inserted.length,
        duplicates: knownIds.size - inserted.length,
        unknown: locationIds.length - knownIds.size,
      };
    },

    async removeLocation(id, locationId, userId) {
      if (!isUuid(id) || !isUuid(locationId)) return false;
      const [owned] = await db
        .select({ id: collections.id })
        .from(collections)
        .where(and(eq(collections.id, id), eq(collections.user_id, userId)))
        .limit(1);
      if (!owned) return false;

      const deleted = await db
        .delete(collection_locations)
        .where(
          and(
            eq(collection_locations.collection_id, owned.id),
            eq(collection_locations.location_id, locationId),
          ),
        )
        .returning({ id: collection_locations.id });
      return deleted.length > 0;
    },

    async createItineraryCollection(itineraryId, ownerId, now) {
      if (!isUuid(itineraryId)) return undefined;

      const [trip] = await db
        .select({ id: itineraries.id, name: itineraries.name })
        .from(itineraries)
        .where(eq(itineraries.id, itineraryId))
        .limit(1);
      if (!trip) return undefined;

      // The trip's own stops, in day-then-position order, deduped: a place
      // visited on two days is one entry on the shelf.
      const stops = await db
        .select({ location_id: itinerary_activities.location_id })
        .from(itinerary_activities)
        .innerJoin(itinerary_days, eq(itinerary_activities.day_id, itinerary_days.id))
        .where(eq(itinerary_days.itinerary_id, trip.id))
        .orderBy(itinerary_days.day_index, itinerary_activities.position);

      const locationIds = [
        ...new Set(stops.map((row) => row.location_id).filter((id): id is string => id !== null)),
      ];
      if (locationIds.length === 0) return undefined;

      const [row] = await db
        .insert(collections)
        .values({
          user_id: ownerId,
          name: trip.name,
          itinerary_id: trip.id,
          created_at: now,
          updated_at: now,
        })
        // A replan of the same trip must not fail the save over a shelf that
        // already exists. The unique `itinerary_id` is what catches it.
        .onConflictDoNothing({ target: collections.itinerary_id })
        .returning({ id: collections.id });
      if (!row) return undefined;

      await db
        .insert(collection_locations)
        .values(
          locationIds.map((locationId) => ({
            collection_id: row.id,
            location_id: locationId,
            added_at: now,
          })),
        )
        .onConflictDoNothing();

      return { collectionId: row.id };
    },
  };
}

/**
 * The companion collection id for each of a set of itineraries.
 *
 * A plain function rather than a store method because `readItineraryList`
 * already reads the database directly — it is aggregate queries with no
 * decisions in them, and a port there would only prove the double works.
 * Trips planned before companions existed are simply absent from the map.
 */
export async function itineraryCollectionIds(
  db: Database,
  itineraryIds: string[],
): Promise<Map<string, string>> {
  if (itineraryIds.length === 0) return new Map();
  const rows = await db
    .select({ id: collections.id, itinerary_id: collections.itinerary_id })
    .from(collections)
    .where(inArray(collections.itinerary_id, itineraryIds));
  return new Map(
    rows.flatMap((row) => (row.itinerary_id ? [[row.itinerary_id, row.id] as const] : [])),
  );
}

// ── shaping ──────────────────────────────────────────────────────────────────

/** The card's 2×2 image grid. Four, because that is what the grid holds. */
const PREVIEW_IMAGE_COUNT = 4;

function previewImagesFrom(rows: readonly LocationRow[]): string[] {
  const images: string[] = [];
  for (const row of rows) {
    const photo = row.photo_urls?.[0];
    if (photo) images.push(photo);
    if (images.length === PREVIEW_IMAGE_COUNT) break;
  }
  return images;
}

/**
 * A row plus its two aggregates, as a card.
 *
 * `is_public`, `fork_count` and `user_role` are constants: this build has no
 * sharing and no collaborators, so every collection anybody can read is one
 * they own. Same call `readItineraryList` makes about the same three fields.
 */
export function toListItem(
  row: CollectionRow,
  preview?: { count: number; images: string[] },
): CollectionListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? undefined,
    country: row.country ?? undefined,
    region: row.region ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    tags: row.tags,
    thumbnail_url: preview?.images[0],
    owner_id: row.user_id,
    is_bookmarked: row.is_bookmarked,
    is_archived: row.is_archived,
    is_public: false,
    fork_count: 0,
    user_role: "owner",
    location_count: preview?.count ?? 0,
    preview_images: preview?.images ?? [],
    created_at: ISO(row.created_at),
    updated_at: ISO(row.updated_at),
  };
}

/** Same guard `itineraries.ts` and `content.ts` use: a non-uuid reaches
 *  Postgres as a cast error, not an empty result, and "not a uuid" is a 404
 *  rather than a 500. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID.test(value);
}

const ISO = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

// ── the in-memory double ─────────────────────────────────────────────────────

/**
 * Backs the route tests. It holds the same rules the SQL does — the owner check
 * inside the read, the unique `(collection, location)` pair, an unknown
 * location id skipped rather than inserted, the clock moving only on a real
 * change — because a double that is more permissive than the database turns a
 * route test into a test of the double.
 */
export function createInMemoryCollectionStore(seed?: {
  rows?: CollectionRow[];
  /** `locations.id` to the row it names. Anything not in here is "unknown". */
  locations?: Record<string, LocationRow>;
  /** Places already on a collection, by collection id. */
  members?: Record<string, { locationId: string; addedAt: Date }[]>;
  /** `itinerary_activities.location_id` per itinerary, in day-then-position
   *  order, so `createItineraryCollection` has stops to read. */
  itineraryStops?: Record<string, { name: string; locationIds: (string | null)[] }>;
}): CollectionStore & {
  rows: Map<string, CollectionRow>;
  members: Map<string, { locationId: string; addedAt: Date }[]>;
} {
  const rows = new Map<string, CollectionRow>((seed?.rows ?? []).map((row) => [row.id, row]));
  const members = new Map<string, { locationId: string; addedAt: Date }[]>(
    Object.entries(seed?.members ?? {}),
  );
  const known = seed?.locations ?? {};
  const trips = seed?.itineraryStops ?? {};
  let sequence = 0;
  const nextId = () => `00000000-0000-4000-a000-${String(++sequence).padStart(12, "0")}`;

  const placesOf = (id: string) =>
    (members.get(id) ?? [])
      .slice()
      .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())
      .flatMap((entry) => {
        const location = known[entry.locationId];
        return location ? [{ location, added_at: ISO(entry.addedAt) }] : [];
      });

  const cardFor = (row: CollectionRow) => {
    const places = placesOf(row.id);
    return toListItem(row, {
      count: places.length,
      images: previewImagesFrom(places.map((entry) => entry.location)),
    });
  };

  const owned = (id: string, userId: string) => {
    const row = rows.get(id);
    return row && row.user_id === userId ? row : undefined;
  };

  return {
    rows,
    members,

    async listCollections(userId) {
      return [...rows.values()]
        .filter((row) => row.user_id === userId)
        .sort(
          (a, b) =>
            new Date(ISO(b.updated_at)).getTime() - new Date(ISO(a.updated_at)).getTime(),
        )
        .map(cardFor);
    },

    async readCollection(id, userId) {
      const row = owned(id, userId);
      if (!row) return undefined;
      return { ...cardFor(row), locations: placesOf(row.id) };
    },

    async createCollection(input, ownerId, now) {
      const row: CollectionRow = {
        id: nextId(),
        user_id: ownerId,
        name: input.name,
        description: input.description ?? null,
        country: input.country ?? null,
        region: input.region ?? null,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        tags: input.tags ?? [],
        is_bookmarked: false,
        is_archived: false,
        itinerary_id: null,
        created_at: now,
        updated_at: now,
      };
      rows.set(row.id, row);
      return cardFor(row);
    },

    async updateCollection(id, patch, userId, now) {
      const row = owned(id, userId);
      if (!row) return undefined;
      const next: CollectionRow = { ...row, ...patch, updated_at: now };
      rows.set(next.id, next);
      return cardFor(next);
    },

    async deleteCollection(id, userId) {
      if (!owned(id, userId)) return false;
      rows.delete(id);
      members.delete(id);
      return true;
    },

    async addLocations(id, locationIds, userId, now) {
      const row = owned(id, userId);
      if (!row) return undefined;

      const wanted = [...new Set(locationIds)];
      const existing = members.get(id) ?? [];
      const seated = new Set(existing.map((entry) => entry.locationId));

      let added = 0;
      let duplicates = 0;
      let unknown = locationIds.length - wanted.length;
      for (const locationId of wanted) {
        if (!known[locationId]) {
          unknown += 1;
          continue;
        }
        if (seated.has(locationId)) {
          duplicates += 1;
          continue;
        }
        existing.push({ locationId, addedAt: now });
        seated.add(locationId);
        added += 1;
      }
      members.set(id, existing);
      if (added > 0) rows.set(row.id, { ...row, updated_at: now });

      return { added, duplicates, unknown };
    },

    async removeLocation(id, locationId, userId) {
      if (!owned(id, userId)) return false;
      const existing = members.get(id) ?? [];
      const next = existing.filter((entry) => entry.locationId !== locationId);
      members.set(id, next);
      return next.length < existing.length;
    },

    async createItineraryCollection(itineraryId, ownerId, now) {
      const trip = trips[itineraryId];
      if (!trip) return undefined;
      if ([...rows.values()].some((row) => row.itinerary_id === itineraryId)) return undefined;

      const locationIds = [
        ...new Set(trip.locationIds.filter((id): id is string => id !== null)),
      ];
      if (locationIds.length === 0) return undefined;

      const row: CollectionRow = {
        id: nextId(),
        user_id: ownerId,
        name: trip.name,
        description: null,
        country: null,
        region: null,
        latitude: null,
        longitude: null,
        tags: [],
        is_bookmarked: false,
        is_archived: false,
        itinerary_id: itineraryId,
        created_at: now,
        updated_at: now,
      };
      rows.set(row.id, row);
      members.set(
        row.id,
        locationIds.map((locationId) => ({ locationId, addedAt: now })),
      );
      return { collectionId: row.id };
    },
  };
}
