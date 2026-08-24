/**
 * Drizzle-backed implementations of the two ports `retrieval.ts` declares.
 * Nothing at a call site changes when you swap these in for
 * `createInMemorySearchCache` / `createInMemoryLocationStore` — that's the whole
 * point of the ports, and it's why Step 10 didn't have to wait for Step 9.
 *
 * Location upserts return the merged stored rows. Enrichment is preserved, and
 * resolved media is preserved only while its photo resource-name set matches.
 * Narrow patch methods stop later stages from overwriting fresher retrieval data.
 *
 * Expiry is NOT enforced here. `retrievePlaces` compares `expiresAt` against an
 * injected `now`; a store that also filtered would put a second, ambient clock
 * in the path and make the TTL untestable.
 */

import { and, eq, inArray, sql } from "drizzle-orm";

import type {
  CachedSearch,
  LocationStore,
  RetrievedPlace,
  SearchCache,
} from "@/lib/planner/retrieval";
import type { PriceLevelOrdinal } from "@/lib/maps/price-level";

import type { Database } from "./client";
import { locations, place_search_cache } from "./schema";

type LocationRow = typeof locations.$inferSelect;
type LocationInsert = typeof locations.$inferInsert;

/** `place_search_cache`. */
export function createSearchCache(db: Database): SearchCache {
  return {
    async get(queryHash: string): Promise<CachedSearch | undefined> {
      const [row] = await db
        .select({
          placeIds: place_search_cache.place_ids,
          expiresAt: place_search_cache.expires_at,
        })
        .from(place_search_cache)
        .where(sql`${place_search_cache.query_hash} = ${queryHash}`)
        .limit(1);
      return row ? { placeIds: row.placeIds, expiresAt: row.expiresAt } : undefined;
    },

    async put({ queryHash, placeIds, expiresAt }) {
      await db
        .insert(place_search_cache)
        .values({ query_hash: queryHash, place_ids: placeIds, expires_at: expiresAt })
        .onConflictDoUpdate({
          target: place_search_cache.query_hash,
          set: { place_ids: placeIds, expires_at: expiresAt },
        });
    },
  };
}

/** `locations`. A cache hit replays `place_id`s and hydrates them from here. */
export function createLocationStore(db: Database): LocationStore {
  const getMany: LocationStore["getMany"] = async (placeIds) => {
    if (placeIds.length === 0) return [];
    const rows = await db
      .select()
      .from(locations)
      .where(inArray(locations.place_id, [...placeIds]));
    // Returned in the order asked for, matching the in-memory store. Two
    // implementations of one port that differ in ordering is a trap.
    const byPlaceId = new Map(rows.map((row) => [row.place_id, row]));
    return placeIds.flatMap((id) => {
      const row = byPlaceId.get(id);
      return row ? [toRetrievedPlace(row)] : [];
    });
  };

  return {
    getMany,

    async upsertMany(places) {
      if (places.length === 0) return [];
      const rows = await db
        .insert(locations)
        .values(places.map(toInsert))
        .onConflictDoUpdate({
          target: locations.place_id,
          set: {
            name: sql`excluded.name`,
            latitude: sql`excluded.latitude`,
            longitude: sql`excluded.longitude`,
            types: sql`excluded.types`,
            primary_type: sql`excluded.primary_type`,
            rating: sql`excluded.rating`,
            user_rating_count: sql`excluded.user_rating_count`,
            price_level: sql`excluded.price_level`,
            price_range: sql`excluded.price_range`,
            formatted_address: sql`excluded.formatted_address`,
            city: sql`excluded.city`,
            opening_periods: sql`excluded.opening_periods`,
            // Bulk search no longer requests reviews. Null means "not
            // hydrated", so a refetch must not wipe shortlist enrichment.
            review_snippets: sql`coalesce(excluded.review_snippets, ${locations.review_snippets})`,
            editorial_summary: sql`coalesce(excluded.editorial_summary, ${locations.editorial_summary})`,
            review_summary: sql`coalesce(excluded.review_summary, ${locations.review_summary})`,
            serves_vegetarian_food: sql`coalesce(excluded.serves_vegetarian_food, ${locations.serves_vegetarian_food})`,
            shortlist_hydrated_at: sql`coalesce(excluded.shortlist_hydrated_at, ${locations.shortlist_hydrated_at})`,
            photo_names: sql`excluded.photo_names`,
            business_status: sql`excluded.business_status`,
            fetched_at: sql`excluded.fetched_at`,
            // Retrieval never learns these — enrichment (Step 12) backfills
            // stay_duration and Step 11 resolves the photo media. A refetch
            // that overwrote them with null would re-bill both.
            stay_duration: sql`coalesce(excluded.stay_duration, ${locations.stay_duration})`,
            // Resolved media is reusable only while the resource-name set is
            // unchanged. New names invalidate both the URLs and the stamp.
            photo_urls: sql`case
              when ${locations.photo_names} is not distinct from excluded.photo_names
                then coalesce(excluded.photo_urls, ${locations.photo_urls})
              else excluded.photo_urls
            end`,
            photos_resolved_at: sql`case
              when ${locations.photo_names} is not distinct from excluded.photo_names
                then coalesce(excluded.photos_resolved_at, ${locations.photos_resolved_at})
              else excluded.photos_resolved_at
            end`,
          },
        })
        .returning();
      const byPlaceId = new Map(rows.map((row) => [row.place_id, row]));
      return places.flatMap((place) => {
        const row = byPlaceId.get(place.placeId);
        return row ? [toRetrievedPlace(row)] : [];
      });
    },

    async updateShortlistHydration(updates) {
      await Promise.all(
        updates.map((update) =>
          db
            .update(locations)
            .set({
              review_snippets: update.reviewSnippets,
              editorial_summary: update.editorialSummary ?? null,
              review_summary: update.reviewSummary ?? null,
              serves_vegetarian_food: update.servesVegetarianFood ?? null,
              shortlist_hydrated_at: update.shortlistHydratedAt,
            })
            .where(eq(locations.place_id, update.placeId)),
        ),
      );
      return getMany(updates.map((update) => update.placeId));
    },

    async updatePhotoResolution(updates) {
      await Promise.all(
        updates.map((update) =>
          db
            .update(locations)
            .set({
              photo_urls: update.photoUrls,
              photos_resolved_at: update.photosResolvedAt,
            })
            .where(
              and(
                eq(locations.place_id, update.placeId),
                eq(locations.photo_names, [...update.photoNames]),
              ),
            ),
        ),
      );
      return getMany(updates.map((update) => update.placeId));
    },
  };
}

/**
 * Row → domain. The two vocabularies differ on purpose: `CandidatePlace` follows
 * the Places REST response, the row follows the column names.
 */
export function toRetrievedPlace(row: LocationRow): RetrievedPlace {
  return {
    placeId: row.place_id,
    name: row.name,
    types: row.types,
    primaryType: row.primary_type ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    rating: row.rating ?? undefined,
    userRatingCount: row.user_rating_count ?? undefined,
    priceLevel: (row.price_level ?? undefined) as PriceLevelOrdinal | undefined,
    businessStatus: row.business_status ?? undefined,
    stayDuration: row.stay_duration ?? undefined,
    openingPeriods: row.opening_periods ?? undefined,
    city: row.city ?? "",
    formattedAddress: row.formatted_address ?? undefined,
    priceRange: row.price_range ?? undefined,
    reviewSnippets: row.review_snippets,
    editorialSummary: row.editorial_summary ?? undefined,
    reviewSummary: row.review_summary ?? undefined,
    servesVegetarianFood: row.serves_vegetarian_food ?? undefined,
    shortlistHydratedAt: row.shortlist_hydrated_at ?? null,
    photoNames: row.photo_names ?? [],
    photoUrls: row.photo_urls ?? null,
    photosResolvedAt: row.photos_resolved_at ?? null,
    fetchedAt: row.fetched_at,
  };
}

/** Domain → row. */
export function toInsert(place: RetrievedPlace): LocationInsert {
  return {
    place_id: place.placeId,
    name: place.name,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
    types: place.types,
    primary_type: place.primaryType ?? null,
    rating: place.rating ?? null,
    user_rating_count: place.userRatingCount ?? null,
    price_level: place.priceLevel ?? null,
    price_range: place.priceRange ?? null,
    formatted_address: place.formattedAddress ?? null,
    city: place.city,
    opening_periods: place.openingPeriods ?? null,
    review_snippets: place.reviewSnippets,
    editorial_summary: place.editorialSummary ?? null,
    review_summary: place.reviewSummary ?? null,
    serves_vegetarian_food: place.servesVegetarianFood ?? null,
    shortlist_hydrated_at: place.shortlistHydratedAt,
    photo_names: place.photoNames,
    photo_urls: place.photoUrls,
    photos_resolved_at: place.photosResolvedAt,
    business_status: place.businessStatus ?? null,
    stay_duration: place.stayDuration ?? null,
    fetched_at: place.fetchedAt,
  };
}
