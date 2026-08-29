/**
 * Drizzle-backed implementations of the ports the planner declares — two in
 * `retrieval.ts`, one in `enrich.ts`. Nothing at a call site changes when you
 * swap these in for the `createInMemory*` factories — that's the whole point of
 * the ports, and it's why Step 10 didn't have to wait for Step 9.
 *
 * Location upserts return the merged stored rows. Enrichment and resolved media
 * are preserved across a refetch — a photo we have already paid for outlives
 * the search that found it. Narrow patch methods stop later stages from
 * overwriting fresher retrieval data.
 *
 * Expiry is NOT enforced here. `retrievePlaces` compares `expiresAt` against an
 * injected `now`; a store that also filtered would put a second, ambient clock
 * in the path and make the TTL untestable.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { clampVisitMinutes } from "@/lib/planner/enrich";
import type { EnrichmentStore, StoredEnrichment } from "@/lib/planner/enrich";
import type {
  CachedSearch,
  LocationStore,
  RetrievedPlace,
  SearchCache,
} from "@/lib/planner/retrieval";
import type { PriceLevelOrdinal } from "@/lib/maps/price-level";

import type { Database } from "./client";
import { locations, place_enrichments, place_search_cache } from "./schema";

type LocationRow = typeof locations.$inferSelect;
type LocationInsert = typeof locations.$inferInsert;

/**
 * `locations.id` to `place_id`, in the order the ids were given.
 *
 * The seam between the browser and the planner. Every card in this app carries
 * a `locations.id` — that is what a collection, a link and an itinerary
 * activity all point at — while the planner speaks `place_id` from retrieval
 * through to the funnel. `POST /api/plan` translates once, here, rather than
 * teaching either side the other's identifier.
 *
 * An unknown id is **dropped**, not raised. It means a client held a row this
 * database no longer has, which is a stale selection rather than a bad request
 * — and failing the whole plan over one stale tick would lose the other eleven
 * places the traveller picked. The caller counts the gap: `stats.seeds.missing`
 * is where it surfaces.
 *
 * Not a `LocationStore` method: nothing in the planner knows a location has a
 * row id, and putting it on the port would be adding a seam for a caller that
 * is not the planner. Same call `PersonaStore` makes about living outside
 * `stores.ts`.
 */
export async function placeIdsForLocationIds(
  db: Database,
  locationIds: readonly string[],
): Promise<string[]> {
  const wanted = [...new Set(locationIds)];
  if (wanted.length === 0) return [];

  const rows = await db
    .select({ id: locations.id, place_id: locations.place_id })
    .from(locations)
    .where(inArray(locations.id, wanted));

  const byId = new Map(rows.map((row) => [row.id, row.place_id]));
  // Input order, deduped — the traveller picked them in some order and the
  // funnel's pinned sort is stable within the picked group.
  return wanted.flatMap((id) => {
    const placeId = byId.get(id);
    return placeId ? [placeId] : [];
  });
}

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
            // A nearby-search refetch can legitimately answer with no URI where
            // an earlier text search had one. Keeping the stored value is the
            // same rule the editorial fields already follow.
            google_maps_uri: sql`coalesce(excluded.google_maps_uri, ${locations.google_maps_uri})`,
            fetched_at: sql`excluded.fetched_at`,
            // Retrieval never learns these — enrichment (Step 12) backfills
            // stay_duration and Step 11 resolves the photo media. A refetch
            // that overwrote them with null would re-bill both.
            stay_duration: sql`coalesce(excluded.stay_duration, ${locations.stay_duration})`,
            // A photo resource name is a per-response token, not an identifier:
            // two identical searches seconds apart return a different name for
            // every photo of every place. So the name set says nothing about
            // whether the media we resolved is still the media Google has, and
            // comparing it only threw away photos we had already paid for.
            // Same rule as `stay_duration` — retrieval never learns these.
            photo_urls: sql`coalesce(excluded.photo_urls, ${locations.photo_urls})`,
            photos_resolved_at: sql`coalesce(excluded.photos_resolved_at, ${locations.photos_resolved_at})`,
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
            // Narrowed by place alone. The old `photo_names` term compared a
            // token that differs on every search, so it could only ever refuse
            // a write for a photo we had just paid Google for.
            .where(eq(locations.place_id, update.placeId)),
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
    googleMapsUri: row.google_maps_uri ?? undefined,
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
    google_maps_uri: place.googleMapsUri ?? null,
    stay_duration: place.stayDuration ?? null,
    fetched_at: place.fetchedAt,
  };
}

// ─── place_enrichments ───────────────────────────────────────────────────────

type EnrichmentRow = typeof place_enrichments.$inferSelect;
type EnrichmentInsert = typeof place_enrichments.$inferInsert;

/**
 * `place_enrichments`, plus the one narrow patch enrichment makes to
 * `locations`.
 *
 * `updateStayDuration` carries its "only where null" rule in the WHERE clause
 * rather than in a read-then-write, so two concurrent pre-warm runs can't race
 * each other into overwriting a value someone set by hand.
 */
export function createEnrichmentStore(db: Database): EnrichmentStore {
  return {
    async getMany(placeIds) {
      if (placeIds.length === 0) return [];
      const rows = await db
        .select()
        .from(place_enrichments)
        .where(inArray(place_enrichments.place_id, [...placeIds]));
      // Returned in the order asked for, matching the in-memory store.
      const byPlaceId = new Map(rows.map((row) => [row.place_id, row]));
      return placeIds.flatMap((id) => {
        const row = byPlaceId.get(id);
        return row ? [toStoredEnrichment(row)] : [];
      });
    },

    async putMany(rows) {
      if (rows.length === 0) return;
      await db
        .insert(place_enrichments)
        .values(rows.map(toEnrichmentInsert))
        .onConflictDoUpdate({
          target: place_enrichments.place_id,
          set: {
            description: sql`excluded.description`,
            tags: sql`excluded.tags`,
            confidence: sql`excluded.confidence`,
            visit_min: sql`excluded.visit_min`,
            visit_max: sql`excluded.visit_max`,
            signature_dishes: sql`excluded.signature_dishes`,
            best_time_of_day: sql`excluded.best_time_of_day`,
            crowd_profile: sql`excluded.crowd_profile`,
            model: sql`excluded.model`,
            prompt_version: sql`excluded.prompt_version`,
            source_hash: sql`excluded.source_hash`,
            expires_at: sql`excluded.expires_at`,
          },
        });
    },

    async updateStayDuration(updates) {
      await Promise.all(
        updates.map((update) =>
          db
            .update(locations)
            .set({ stay_duration: update.minutes })
            .where(and(eq(locations.place_id, update.placeId), isNull(locations.stay_duration))),
        ),
      );
    },
  };
}

/**
 * Row → domain. The nullable minute columns collapse through
 * `clampVisitMinutes`, which is also the guard against a row written by hand or
 * by a script that predates the clamp.
 */
export function toStoredEnrichment(row: EnrichmentRow): StoredEnrichment {
  return {
    placeId: row.place_id,
    description: row.description,
    tags: row.tags,
    confidence: row.confidence,
    avgVisitMinutes: clampVisitMinutes([
      row.visit_min ?? Number.NaN,
      row.visit_max ?? Number.NaN,
    ]),
    signatureDishes: row.signature_dishes ?? undefined,
    bestTimeOfDay: row.best_time_of_day ?? undefined,
    crowdProfile: row.crowd_profile ?? undefined,
    model: row.model,
    promptVersion: row.prompt_version,
    sourceHash: row.source_hash,
    expiresAt: row.expires_at,
  };
}

/** Domain → row. */
export function toEnrichmentInsert(enrichment: StoredEnrichment): EnrichmentInsert {
  return {
    place_id: enrichment.placeId,
    description: enrichment.description,
    tags: enrichment.tags,
    confidence: enrichment.confidence,
    visit_min: enrichment.avgVisitMinutes[0],
    visit_max: enrichment.avgVisitMinutes[1],
    signature_dishes: enrichment.signatureDishes ?? null,
    best_time_of_day: enrichment.bestTimeOfDay ?? null,
    crowd_profile: enrichment.crowdProfile ?? null,
    model: enrichment.model,
    prompt_version: enrichment.promptVersion,
    source_hash: enrichment.sourceHash,
    expires_at: enrichment.expiresAt,
  };
}
