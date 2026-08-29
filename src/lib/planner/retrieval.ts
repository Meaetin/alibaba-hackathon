/**
 * Server-side Places retrieval — cache first, Google second. See "Stage 2 —
 * Retrieval" in `docs/personalization-pipeline.md`.
 *
 *   search plan → cache lookup → (misses only) Places REST → normalize → store
 *
 * This is the most expensive stage in the pipeline, so the module is built
 * around one rule: **a request that the cache can answer must not reach the
 * network.** Everything else here exists to make that rule testable — `fetch`,
 * the clock, the cache and the location store are all injected, and there is a
 * stat for every place a candidate can be lost.
 *
 * Two things this module deliberately does NOT do:
 *
 * - **It never resolves a photo.** The `places.photos` mask returns resource
 *   *names*, which are free; turning one into an image bills the Places Photos
 *   SKU per fetch. Names are stored, `photo_urls` / `photos_resolved_at` stay
 *   null, and Step 11 resolves media for the ~15 stops that survive.
 * - **It never asks for an Atmosphere field during bulk search.** `reviews`,
 *   `editorialSummary` and the `serves*` booleans all lift a Text Search call
 *   from Enterprise to Enterprise + Atmosphere, and bulk search runs 15–30 of
 *   them for a pool the funnel cuts to ~60. They are fetched once, per
 *   shortlisted place, by `hydrateShortlist` below.
 *
 * It also cannot reuse `src/lib/maps/place-search.ts`: that module is built on
 * the Maps JS `Place` class and needs a live `google.maps.Map`, which does not
 * exist in a route handler.
 */

import { createHash } from "node:crypto";

import { toPriceLevelOrdinal } from "@/lib/maps/price-level";
import { toPriceRange, type PriceRange } from "@/lib/maps/price-range";

import { mapWithConcurrency, type FetchLike } from "./http";
import { dietaryBridgeFor, queriesFor } from "./taxonomy";
import type { CandidatePlace, OpeningPeriod, PreferenceProfile } from "./types";

// ── the wire ─────────────────────────────────────────────────────────────────

const PLACES_SEARCH_TEXT_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACES_SEARCH_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby";
const PLACES_DETAILS_BASE_URL = "https://places.googleapis.com/v1/places";

/**
 * The field mask, and the whole cost argument in one constant. Adding a line
 * here can change the SKU tier of every retrieval call — check
 * `place-details.md` before you do.
 *
 * `places.formattedAddress` is an addition to the mask printed in the design
 * doc: `locations.formatted_address` needs it and it bills at the Essentials
 * tier, which `places.location` and `places.types` already trigger. It is free
 * given the rest of this list.
 */
export const SEARCH_FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.types",
  "places.primaryType",
  "places.rating",
  "places.userRatingCount",
  "places.priceLevel",
  "places.priceRange",
  "places.regularOpeningHours",
  "places.businessStatus",
  "places.googleMapsUri", // Pro — the mask is already Enterprise, so this is free
  "places.photos", // resource NAMES only — resolving to an image is a separate SKU
].join(",");

/**
 * Enterprise + Atmosphere, requested only for shortlisted places.
 *
 * The SKU tier is set **per request** by the highest-tier field in the mask, so
 * every line below rides free on the call `reviews` already pays for. Adding an
 * Atmosphere field here costs nothing; adding one to `SEARCH_FIELD_MASK` costs
 * a tier bump on every bulk query. That asymmetry is the whole design.
 */
export const SHORTLIST_FIELD_MASK = [
  "reviews",
  "editorialSummary",
  "reviewSummary",
  "servesVegetarianFood",
].join(",");

/** Google's per-page maximum for `places:searchText`. */
const DEFAULT_PAGE_SIZE = 20;

/** Google's Places terms allow indefinite `place_id` retention but restrict
 *  other content. 30 days sits clearly inside that line. */
const DEFAULT_TTL_DAYS = 30;

const DEFAULT_CONCURRENCY = 4;

export type { FetchLike } from "./http";

// ── what a search is ─────────────────────────────────────────────────────────

/** Google's hard ceiling on a Nearby Search circle. */
export const NEARBY_MAX_RADIUS_METERS = 50_000;

/**
 * Places types Google **returns** but will not **filter** on.
 *
 * The API splits its types into two tables: Table A is searchable, Table B is
 * only ever descriptive. Both arrive in `places.types`, which makes this trap
 * invisible from the data — a live Singapore run saw `food` and
 * `place_of_worship` on real places, proposed them as `includedTypes`, and
 * Google answered **400 for the whole request**. Not "ignored that type": the
 * entire circle was lost, twice out of three searches.
 *
 * So "this city has places of that type" is necessary and not sufficient, and
 * this list is the rest of it. Google owns the list, so it can grow; anything
 * missed still costs only its own circle, which the feasibility ladder can
 * widen around.
 */
export const NON_SEARCHABLE_TYPES: ReadonlySet<string> = new Set([
  "administrative_area_level_1",
  "administrative_area_level_2",
  "country",
  "establishment",
  "finance",
  "floor",
  "food",
  "general_contractor",
  "geocode",
  "health",
  "intersection",
  "landmark",
  "natural_feature",
  "neighborhood",
  "place_of_worship",
  "plus_code",
  "point_of_interest",
  "political",
  "post_box",
  "postal_code",
  "premise",
  "room",
  "route",
  "street_address",
  "street_number",
  "sublocality",
  "sublocality_level_1",
  "subpremise",
  "town_square",
]);

/**
 * A circle to search inside, for `places:searchNearby`.
 *
 * The coordinates come from a place that is already in the pool, never from a
 * model and never from a geocoder — which is what makes an anchor cost nothing
 * and be impossible to hallucinate.
 */
export interface NearbySearch {
  latitude: number;
  longitude: number;
  radiusMeters: number;
  /** Places types to return. Empty means "whatever is there". */
  includedTypes: readonly string[];
  /**
   * How Google orders the twenty places it will return.
   *
   * It is on the request rather than a constant because it is part of what was
   * asked, and `searchCacheKey` has to say so — a circle ranked by popularity
   * and the same circle ranked by distance are different searches with the same
   * centre, and one must not serve the other out of the cache.
   */
  rankPreference: NearbyRankPreference;
}

export type NearbyRankPreference = "DISTANCE" | "POPULARITY";

/**
 * Distance, and not Google's default.
 *
 * Every circle we search is centred on a theme's anchor, and the question being
 * asked is always "what is near this place". Google defaults to `POPULARITY`,
 * which answers a different question: the twenty most prominent places
 * *anywhere in the circle*. On a 4 km circle round a museum in Nusa Dua that is
 * twenty places in Kuta, 8 km away — the anchor's own neighbourhood never
 * appears, and widening the circle makes it worse rather than better. It is
 * also why `feasibility.ts`'s widen rung could not fix a day with nothing to
 * eat: a bigger circle ranked by popularity walks further from the anchor.
 */
export const NEARBY_RANK_PREFERENCE: NearbyRankPreference = "DISTANCE";

/**
 * One billable search. Cache identity also includes the page size supplied to
 * `searchCacheKey`; a five-result pre-warm must not satisfy a twenty-result run.
 *
 * Two endpoints, one type, on purpose. A nearby search wants exactly the same
 * cache, the same location persistence, the same dedupe and the same stats as a
 * text search, and a second copy of `retrievePlaces` to get them would be a
 * second place for the "publish the cache entry only after the rows land" rule
 * to be forgotten.
 */
export interface SearchRequest {
  city: string;
  /** Text query with `{city}` already interpolated. Ignored when `nearby` is set. */
  query: string;
  /** Optional single Places type filter. Narrows the long tail Text Search
   *  catches; most plan rows leave it unset. */
  includedType?: string;
  /** Present ⇒ this is a Nearby Search around a circle, not a Text Search. */
  nearby?: NearbySearch;
  /**
   * A circle a **Text Search** leans toward. Ignored when `nearby` is set —
   * they are different endpoints and a nearby circle is already a restriction.
   *
   * Bias, not restriction: Google may still return something outside it. That
   * is safe here and not sloppiness — `MEMBER_RADIUS_SLACK` refuses a place too
   * far from an anchor to join its day, and the meal reserve caps its own
   * reach, so a stray distant result is dropped downstream rather than seated.
   */
  locationBias?: { latitude: number; longitude: number; radiusMeters: number };
}

/**
 * A Text Search leaning on a circle — how a *phrase* gets asked near a place.
 *
 * `includedTypes` is coarse by design: Google types a great vegetarian-friendly
 * izakaya `izakaya_restaurant`, never `vegetarian_restaurant`, so a meal circle
 * asking for types finds the places that *label* themselves and misses the long
 * tail. `dietaryBridgeFor` already carries the phrases that catch it — they were
 * only ever fired city-wide, which for a three-day trip means the results
 * cluster wherever the city is busiest and not where the traveller will be.
 *
 * A negative never belongs in one of these. "no seafood" matches seafood
 * restaurants; refusals are `DIETARY_CONFLICT_TYPES`' job, after the search.
 */
export function textNearRequest(
  city: string,
  query: string,
  centre: { latitude: number; longitude: number },
  radiusMeters: number,
): SearchRequest {
  return {
    city,
    query,
    locationBias: {
      latitude: centre.latitude,
      longitude: centre.longitude,
      radiusMeters: Math.max(1, Math.min(NEARBY_MAX_RADIUS_METERS, Math.round(radiusMeters))),
    },
  };
}

/**
 * A nearby search as a `SearchRequest`. The radius is clamped to Google's
 * ceiling here rather than at the call site, because the call site is deriving
 * it from a persona knob and a model's word for "wide".
 */
export function nearbyRequest(
  city: string,
  /** A place already in the pool. Its coordinates are the circle's centre. */
  centre: { latitude: number; longitude: number },
  radiusMeters: number,
  includedTypes: readonly string[],
  rankPreference: NearbyRankPreference = NEARBY_RANK_PREFERENCE,
): SearchRequest {
  return {
    city,
    // Not a query, and deliberately not empty: this string is what a failure in
    // `stats.failures` is identified by, and "" tells nobody anything. The rank
    // is in it because two circles now differ by nothing else, and a failure
    // reading `nearby:museum` twice names neither of them.
    query: `nearby:${includedTypes.join("+") || "any"}@${rankPreference.toLowerCase()}`,
    nearby: {
      latitude: centre.latitude,
      longitude: centre.longitude,
      radiusMeters: Math.max(1, Math.min(NEARBY_MAX_RADIUS_METERS, Math.round(radiusMeters))),
      includedTypes: [...includedTypes].sort(),
      rankPreference,
    },
  };
}

/**
 * `sha256(city | query | includedType | pageSize)`.
 *
 * City and query are lowercased and whitespace-collapsed first: "Kyoto" and
 * "kyoto" are the same city and paying Google twice to learn that is waste.
 * Nothing else is normalized — a different `includedType` is a different search.
 */
export function searchCacheKey(
  request: SearchRequest,
  pageSize: number = DEFAULT_PAGE_SIZE,
): string {
  const parts = [
    normalizeKeyPart(request.city),
    normalizeKeyPart(request.query),
    request.includedType ?? "",
    String(pageSize),
    // A circle is part of what was asked. Two themes anchored on different
    // places produce different searches and must not share one cache entry.
    request.nearby
      ? [
          request.nearby.latitude.toFixed(5),
          request.nearby.longitude.toFixed(5),
          String(request.nearby.radiusMeters),
          [...request.nearby.includedTypes].sort().join("+"),
          request.nearby.rankPreference,
        ].join(",")
      : "",
    // The same phrase asked in two neighbourhoods is two different answers.
    request.locationBias
      ? [
          request.locationBias.latitude.toFixed(5),
          request.locationBias.longitude.toFixed(5),
          String(request.locationBias.radiusMeters),
        ].join(",")
      : "",
  ];
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

function normalizeKeyPart(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The taxonomy bridge, applied: ~2 text queries per interest plus a row per
 * known dietary need. Deduped by cache key, because a query shared by two
 * interests must be billed once.
 *
 * `near` is where the traveller is actually staying. Without it every query is
 * the city's name and nothing else, and Google answers with whatever is most
 * prominent *anywhere under that name* — which for "Bali" is an island 150 km
 * across, and for "specialty coffee Bali" is Kuta and Seminyak whether or not
 * the traveller is going anywhere near them.
 *
 * A bias, not a restriction: Google may still answer with something outside the
 * circle, and that is fine because `withinReach` in `pipeline.ts` drops it
 * before it can become a day. Same division of labour the anchored dietary
 * phrases already keep — the circle shapes the answer, a later stage enforces
 * it.
 *
 * **Omitting `near` must produce exactly what this function produced before it
 * existed**, request for request and cache key for cache key. A pre-warmed
 * city's rows are worth real money and a stray `locationBias` on every text
 * search would orphan all of them. `retrieval.test.ts` pins it.
 */
export function buildSearchPlan(
  profile: Pick<PreferenceProfile, "interests" | "dietary">,
  city: string,
  near?: { latitude: number; longitude: number; radiusMeters: number },
): SearchRequest[] {
  const queries = [
    ...profile.interests.flatMap((interest) => queriesFor(interest, city)),
    ...profile.dietary.flatMap(
      (need) =>
        dietaryBridgeFor(need)?.queries.map((q) => q.replaceAll("{city}", city)) ?? [],
    ),
  ];
  return dedupeRequests(
    queries.map((query) =>
      near ? textNearRequest(city, query, near, near.radiusMeters) : { city, query },
    ),
  );
}

function dedupeRequests(requests: readonly SearchRequest[]): SearchRequest[] {
  const seen = new Set<string>();
  const unique: SearchRequest[] = [];
  for (const request of requests) {
    const key = searchCacheKey(request);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(request);
  }
  return unique;
}

// ── what a search returns ────────────────────────────────────────────────────

export interface ReviewSnippet {
  rating?: number;
  text: string;
}

/** One place's worth of shortlist-mask answers, as written to the store. */
export interface ShortlistHydration {
  placeId: string;
  reviewSnippets: ReviewSnippet[];
  editorialSummary?: string;
  reviewSummary?: string;
  servesVegetarianFood?: boolean;
  shortlistHydratedAt: Date;
}

/** Re-exported for the callers that persist a `RetrievedPlace`. The nested
 *  money range Google actually sends is flattened by `toPriceRange` before it
 *  reaches this type — `locations.price_range` holds one shape, and the browser
 *  add-a-place path in `maps/place-search.ts` writes the same one. */
export type { PriceRange };

/**
 * A `locations` row as retrieval produces it: everything `CandidatePlace` needs
 * for the deterministic core, plus the columns only later stages read.
 */
export interface RetrievedPlace extends CandidatePlace {
  /** The city the search was made for — `locations.city`, not Google's. */
  city: string;
  formattedAddress?: string;
  priceRange?: PriceRange;
  /** Google's canonical link for the place. Undefined for anything retrieved
   *  before the field joined `SEARCH_FIELD_MASK`. */
  googleMapsUri?: string;
  /** Up to 5. Null means the shortlist hydration has not run; `[]` means it
   *  ran and Google returned no reviews. */
  reviewSnippets: ReviewSnippet[] | null;
  /** Google's own blurb. Undefined after hydration means Google has none —
   *  check `shortlistHydratedAt` to tell that from "never asked". */
  editorialSummary?: string;
  /** Google's AI review digest. Same undefined-vs-unasked rule as above. */
  reviewSummary?: string;
  /** Null distinguishes "shortlist hydration never ran" from "it ran and
   *  Google had no summary and no reviews". Without it every place Google is
   *  quiet about would be refetched on every replan, at Atmosphere prices. */
  shortlistHydratedAt: Date | null;
  /** Google photo resource names. Free, always populated — but a **per-response
   *  token**, not an identifier: two identical searches seconds apart return a
   *  different name for every photo. Use it to fetch media, never to decide
   *  whether media we already hold is still current. */
  photoNames: string[];
  /** Filled at Step 11 only. Null here, always. */
  photoUrls: string[] | null;
  /** Null distinguishes "names stored, media never fetched" from "this place
   *  genuinely has no photos". Step 11 stamps it. */
  photosResolvedAt: Date | null;
  fetchedAt: Date;
}

// ── the two ports Step 9 fills in ────────────────────────────────────────────

export interface CachedSearch {
  placeIds: string[];
  expiresAt: Date;
}

/** `place_search_cache`. */
export interface SearchCache {
  get(queryHash: string): Promise<CachedSearch | undefined>;
  put(entry: { queryHash: string; placeIds: string[]; expiresAt: Date }): Promise<void>;
}

/** `locations`. A cache hit replays `place_id`s and hydrates them from here. */
export interface LocationStore {
  getMany(placeIds: readonly string[]): Promise<RetrievedPlace[]>;
  /** Returns the merged stored rows in input order. Later stages must see
   *  preserved enrichment/photo state, not the pre-upsert network snapshots. */
  upsertMany(places: readonly RetrievedPlace[]): Promise<RetrievedPlace[]>;
  /** Writes every field the shortlist mask returns, in one patch per place. */
  updateShortlistHydration(
    updates: readonly ShortlistHydration[],
  ): Promise<RetrievedPlace[]>;
  /** Narrowed by place. `photoNames` rides along for the caller's own record;
   *  it is not a precondition, because the names always differ. */
  updatePhotoResolution(
    updates: readonly {
      placeId: string;
      photoNames: readonly string[];
      photoUrls: string[];
      photosResolvedAt: Date;
    }[],
  ): Promise<RetrievedPlace[]>;
}

export function createInMemorySearchCache(seed?: Record<string, CachedSearch>): SearchCache {
  const entries = new Map<string, CachedSearch>(Object.entries(seed ?? {}));
  return {
    async get(queryHash) {
      return entries.get(queryHash);
    },
    async put({ queryHash, placeIds, expiresAt }) {
      entries.set(queryHash, { placeIds, expiresAt });
    },
  };
}

export function createInMemoryLocationStore(seed?: readonly RetrievedPlace[]): LocationStore {
  const rows = new Map<string, RetrievedPlace>((seed ?? []).map((p) => [p.placeId, p]));
  return {
    async getMany(placeIds) {
      return placeIds.flatMap((id) => {
        const row = rows.get(id);
        return row ? [row] : [];
      });
    },
    async upsertMany(places) {
      return places.map((place) => {
        const existing = rows.get(place.placeId);
        const merged: RetrievedPlace = existing
          ? {
              ...place,
              stayDuration: place.stayDuration ?? existing.stayDuration,
              reviewSnippets: place.reviewSnippets ?? existing.reviewSnippets,
              editorialSummary: place.editorialSummary ?? existing.editorialSummary,
              reviewSummary: place.reviewSummary ?? existing.reviewSummary,
              servesVegetarianFood:
                place.servesVegetarianFood ?? existing.servesVegetarianFood,
              shortlistHydratedAt: place.shortlistHydratedAt ?? existing.shortlistHydratedAt,
              photoUrls: place.photoUrls ?? existing.photoUrls,
              photosResolvedAt: place.photosResolvedAt ?? existing.photosResolvedAt,
            }
          : place;
        rows.set(place.placeId, merged);
        return merged;
      });
    },
    async updateShortlistHydration(updates) {
      for (const update of updates) {
        const existing = rows.get(update.placeId);
        if (existing) rows.set(update.placeId, { ...existing, ...update });
      }
      return updates.flatMap((update) => {
        const row = rows.get(update.placeId);
        return row ? [row] : [];
      });
    },
    async updatePhotoResolution(updates) {
      for (const update of updates) {
        const existing = rows.get(update.placeId);
        if (!existing) continue;
        rows.set(update.placeId, {
          ...existing,
          photoUrls: update.photoUrls,
          photosResolvedAt: update.photosResolvedAt,
        });
      }
      return updates.flatMap((update) => {
        const row = rows.get(update.placeId);
        return row ? [row] : [];
      });
    },
  };
}

// ── retrieval ────────────────────────────────────────────────────────────────

export interface RetrievalDeps {
  apiKey: string;
  cache: SearchCache;
  store: LocationStore;
  /** Injected so every test runs with zero network. */
  fetch?: FetchLike;
  /** Injected so cache expiry is decidable. Never `new Date()` inside. */
  now?: Date;
  ttlDays?: number;
  pageSize?: number;
  concurrency?: number;
}

export interface SearchFailure {
  request: SearchRequest;
  message: string;
}

/**
 * Where every candidate went. Retrieval can lose a place three ways — a query
 * failed, a cached id is no longer in `locations`, or another query already
 * returned it — and each one gets a counter rather than a shrinking list.
 */
export interface RetrievalStats {
  /** Requests passed in, before same-run dedupe. */
  requested: number;
  /** Distinct cache keys — the most calls this run could possibly bill. */
  unique: number;
  cacheHits: number;
  cacheMisses: number;
  /** Searches Google answered. A failed call is in `failures` instead — a 4xx
   *  generally isn't billed, and counting it here would overstate the spend. */
  billedCalls: number;
  /** Places seen across all queries, before dedupe. */
  seen: number;
  duplicatesDropped: number;
  /** Cached ids whose `locations` row has since gone. Re-billed next run. */
  missingFromStore: number;
  failures: SearchFailure[];
}

export interface RetrievalResult {
  places: RetrievedPlace[];
  stats: RetrievalStats;
}

/**
 * Adds a second run's counters to a first's.
 *
 * Exists because a themed plan searches Google **twice**: once for every
 * theme's circles, and again inside the feasibility ladder's `widen` rung for
 * each day that cannot feed itself. The second call's stats used to be dropped
 * on the floor, so `stats.explore.billedCalls` reported the opening circles and
 * none of the extra searches bought for the days that went worst — the days
 * that cost the most read as the cheapest. Measured on the Kyoto themed
 * fixture: 12 real `searchNearby` calls, 9 reported.
 *
 * `failures` matters more than the money. A widening search that 400s — and a
 * live Singapore run lost two of three circles to an unsearchable type — was
 * discarded with everything else, so "the ladder tried and found nothing" and
 * "the request was rejected" looked identical. They need different fixes.
 */
export function mergeRetrievalStats(
  first: RetrievalStats,
  second: RetrievalStats,
): RetrievalStats {
  return {
    requested: first.requested + second.requested,
    unique: first.unique + second.unique,
    cacheHits: first.cacheHits + second.cacheHits,
    cacheMisses: first.cacheMisses + second.cacheMisses,
    billedCalls: first.billedCalls + second.billedCalls,
    seen: first.seen + second.seen,
    duplicatesDropped: first.duplicatesDropped + second.duplicatesDropped,
    missingFromStore: first.missingFromStore + second.missingFromStore,
    failures: [...first.failures, ...second.failures],
  };
}

/**
 * Runs a search plan. Requests sharing a cache key are collapsed first, so an
 * identical (city, query, includedType) triple is billed at most once per run
 * even before the cache is consulted.
 *
 * A failing query is recorded in `stats.failures` and does not abort the run or
 * poison the cache — a thin result set is recoverable, a thrown route handler
 * is not.
 */
export async function retrievePlaces(
  requests: readonly SearchRequest[],
  deps: RetrievalDeps,
): Promise<RetrievalResult> {
  const now = deps.now ?? new Date();
  const doFetch = deps.fetch ?? (globalThis.fetch as FetchLike);
  const ttlDays = deps.ttlDays ?? DEFAULT_TTL_DAYS;
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;

  const unique = dedupeRequests(requests);
  const stats: RetrievalStats = {
    requested: requests.length,
    unique: unique.length,
    cacheHits: 0,
    cacheMisses: 0,
    billedCalls: 0,
    seen: 0,
    duplicatesDropped: 0,
    missingFromStore: 0,
    failures: [],
  };

  const keys = unique.map((request) => searchCacheKey(request, pageSize));
  const cached = await Promise.all(keys.map((key) => deps.cache.get(key)));
  const freshHits = cached.map((entry) => (entry && entry.expiresAt > now ? entry : undefined));

  // One batched read for every cache-hit id, in first-seen order.
  const hitIds = dedupeStrings(freshHits.flatMap((entry) => entry?.placeIds ?? []));
  const hydrated = hitIds.length > 0 ? await deps.store.getMany(hitIds) : [];
  const byPlaceId = new Map(hydrated.map((place) => [place.placeId, place]));

  // A cache entry is only a hit when every id can be hydrated. Counting a
  // missing row without invalidating the hit makes the result thin for the
  // entire TTL, and a cache written before a failed location upsert never heals.
  for (const entry of freshHits) {
    for (const placeId of entry?.placeIds ?? []) {
      if (!byPlaceId.has(placeId)) stats.missingFromStore += 1;
    }
  }
  const hits = freshHits.map((entry) =>
    entry?.placeIds.every((placeId) => byPlaceId.has(placeId)) ? entry : undefined,
  );
  stats.cacheHits = hits.filter(Boolean).length;
  stats.cacheMisses = hits.length - stats.cacheHits;

  const misses = unique.flatMap((request, i) => (hits[i] ? [] : [{ request, index: i, key: keys[i] }]));
  const fetched = await mapWithConcurrency(
    misses,
    deps.concurrency ?? DEFAULT_CONCURRENCY,
    async ({ request }): Promise<{ places?: RetrievedPlace[]; failure?: SearchFailure }> => {
      try {
        const raw = await runSearch(request, { doFetch, apiKey: deps.apiKey, pageSize });
        return { places: raw.map((place) => normalizePlace(place, request.city, now)) };
      } catch (error) {
        return { failure: { request, message: messageOf(error) } };
      }
    },
  );

  const freshByIndex = new Map<number, RetrievedPlace[]>();
  const toPersist: RetrievedPlace[] = [];
  const cacheWrites: { queryHash: string; placeIds: string[]; expiresAt: Date }[] = [];
  misses.forEach(({ index, key }, i) => {
    const outcome = fetched[i];
    if (outcome.failure) {
      stats.failures.push(outcome.failure);
      return;
    }
    const places = outcome.places ?? [];
    stats.billedCalls += 1;
    freshByIndex.set(index, places);
    toPersist.push(...places);
    // An empty result is a real answer; cache it or the query is re-billed on
    // every replan. The writes happen only after locations persist below.
    cacheWrites.push({
      queryHash: key,
      placeIds: places.map((place) => place.placeId),
      expiresAt: new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000),
    });
  });

  if (toPersist.length > 0) {
    const stored = await deps.store.upsertMany(dedupeByPlaceId(toPersist));
    const storedByPlaceId = new Map(stored.map((place) => [place.placeId, place]));
    for (const [index, places] of freshByIndex) {
      freshByIndex.set(
        index,
        places.map((place) => storedByPlaceId.get(place.placeId) ?? place),
      );
    }
  }
  await Promise.all(cacheWrites.map((entry) => deps.cache.put(entry)));

  // Walk in request order so the output is stable across runs.
  const places: RetrievedPlace[] = [];
  const emitted = new Set<string>();
  unique.forEach((_request, i) => {
    const entry = hits[i];
    const batch = entry
      ? entry.placeIds.flatMap((id) => {
          const row = byPlaceId.get(id);
          if (!row) return [];
          return [row];
        })
      : (freshByIndex.get(i) ?? []);
    for (const place of batch) {
      stats.seen += 1;
      if (emitted.has(place.placeId)) {
        stats.duplicatesDropped += 1;
        continue;
      }
      emitted.add(place.placeId);
      places.push(place);
    }
  });

  return { places, stats };
}

// ── shortlist-only Atmosphere hydration ──────────────────────────────────────

export interface ShortlistHydrationDeps {
  apiKey: string;
  store: LocationStore;
  fetch?: FetchLike;
  concurrency?: number;
  /** Injected clock — nothing in the planner reads the ambient one. */
  now?: Date;
}

export interface ShortlistHydrationStats {
  requested: number;
  notInPool: number;
  skippedAlreadyHydrated: number;
  billedCalls: number;
  failures: { placeId: string; message: string }[];
}

export interface ShortlistHydrationResult {
  places: RetrievedPlace[];
  stats: ShortlistHydrationStats;
}

/**
 * Fetches every Enterprise + Atmosphere field we want, for shortlisted ids only.
 *
 * One Place Details call per place carries the whole `SHORTLIST_FIELD_MASK` —
 * reviews, both summaries and `servesVegetarianFood` — because the SKU is priced
 * per request, not per field. Asking for reviews alone, as this did originally,
 * paid Atmosphere prices for a third of the goods.
 *
 * `shortlistHydratedAt` is the "we asked" marker, and it is stamped only when
 * the answer is *known*. A place Google has no summary and no reviews for is
 * still hydrated; a place whose fetch **failed** stays null so a replan retries.
 * Same rule as `photos_resolved_at`, for the same reason.
 */
export async function hydrateShortlist(
  pool: readonly RetrievedPlace[],
  shortlistIds: readonly string[],
  deps: ShortlistHydrationDeps,
): Promise<ShortlistHydrationResult> {
  const doFetch = deps.fetch ?? (globalThis.fetch as FetchLike);
  const now = deps.now ?? new Date();
  const byPlaceId = new Map(pool.map((place) => [place.placeId, place]));
  const wanted = [...new Set(shortlistIds)];
  const stats: ShortlistHydrationStats = {
    requested: wanted.length,
    notInPool: 0,
    skippedAlreadyHydrated: 0,
    billedCalls: 0,
    failures: [],
  };

  const targets = wanted.flatMap((placeId) => {
    const place = byPlaceId.get(placeId);
    if (!place) {
      stats.notInPool += 1;
      return [];
    }
    return [place];
  });

  const places = await mapWithConcurrency(
    targets,
    deps.concurrency ?? DEFAULT_CONCURRENCY,
    async (place): Promise<RetrievedPlace> => {
      if (place.shortlistHydratedAt !== null) {
        stats.skippedAlreadyHydrated += 1;
        return place;
      }
      try {
        const details = await fetchShortlistDetails(place.placeId, doFetch, deps.apiKey);
        stats.billedCalls += 1;
        return { ...place, ...details, shortlistHydratedAt: now };
      } catch (error) {
        stats.failures.push({ placeId: place.placeId, message: messageOf(error) });
        return place;
      }
    },
  );

  // Identity, not a flag: a skipped or failed place is the very object that
  // went in, so only genuinely new answers reach the store.
  const changed = places.filter((place, index) => place !== targets[index]);
  if (changed.length > 0) {
    await deps.store.updateShortlistHydration(
      changed.map((place) => ({
        placeId: place.placeId,
        reviewSnippets: place.reviewSnippets ?? [],
        editorialSummary: place.editorialSummary,
        reviewSummary: place.reviewSummary,
        servesVegetarianFood: place.servesVegetarianFood,
        shortlistHydratedAt: place.shortlistHydratedAt ?? now,
      })),
    );
  }
  return { places, stats };
}

/** What `SHORTLIST_FIELD_MASK` asks for, and nothing else. */
interface RawShortlistDetails {
  reviews?: RawReview[];
  editorialSummary?: { text?: string };
  reviewSummary?: { text?: { text?: string } };
  servesVegetarianFood?: boolean;
}

type ShortlistFields = Pick<
  RetrievedPlace,
  "reviewSnippets" | "editorialSummary" | "reviewSummary" | "servesVegetarianFood"
>;

async function fetchShortlistDetails(
  placeId: string,
  doFetch: FetchLike,
  apiKey: string,
): Promise<ShortlistFields> {
  const response = await doFetch(`${PLACES_DETAILS_BASE_URL}/${encodeURIComponent(placeId)}`, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SHORTLIST_FIELD_MASK,
    },
  });
  if (!response.ok) {
    throw new Error(`Places Details ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as RawShortlistDetails;
  return {
    reviewSnippets: normalizeReviews(data.reviews),
    editorialSummary: data.editorialSummary?.text,
    reviewSummary: data.reviewSummary?.text?.text,
    servesVegetarianFood: data.servesVegetarianFood,
  };
}

/**
 * One search, either endpoint.
 *
 * **`SEARCH_FIELD_MASK` for both, and that is the cost argument.** Google sets
 * the SKU tier from the highest-tier field in the mask, per call — so a single
 * Atmosphere field added for a nearby search would bump the tier on every
 * nearby call in every plan. The Atmosphere tier is bought once, later, on the
 * ~60-place shortlist. Never here.
 */
async function runSearch(
  request: SearchRequest,
  ctx: { doFetch: FetchLike; apiKey: string; pageSize: number },
): Promise<RawPlace[]> {
  const nearby = request.nearby;
  const url = nearby ? PLACES_SEARCH_NEARBY_URL : PLACES_SEARCH_TEXT_URL;
  const body: Record<string, unknown> = nearby
    ? {
        maxResultCount: ctx.pageSize,
        rankPreference: nearby.rankPreference,
        ...(nearby.includedTypes.length > 0
          ? { includedTypes: [...nearby.includedTypes] }
          : {}),
        locationRestriction: {
          circle: {
            center: { latitude: nearby.latitude, longitude: nearby.longitude },
            radius: nearby.radiusMeters,
          },
        },
      }
    : {
        textQuery: request.query,
        pageSize: ctx.pageSize,
        ...(request.includedType ? { includedType: request.includedType } : {}),
        ...(request.locationBias
          ? {
              locationBias: {
                circle: {
                  center: {
                    latitude: request.locationBias.latitude,
                    longitude: request.locationBias.longitude,
                  },
                  radius: request.locationBias.radiusMeters,
                },
              },
            }
          : {}),
      };

  const response = await ctx.doFetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": ctx.apiKey,
      "X-Goog-FieldMask": SEARCH_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Places API ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as { places?: RawPlace[] };
  return data.places ?? [];
}

// ── normalization ────────────────────────────────────────────────────────────

/** Loose shape of a `places:searchText` result; only what the mask asks for. */
interface RawPlace {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  priceLevel?: string;
  /** Google's nested money range — `toPriceRange` flattens it. */
  priceRange?: unknown;
  regularOpeningHours?: { periods?: OpeningPeriod[] };
  businessStatus?: string;
  googleMapsUri?: string;
  photos?: { name?: string }[];
}

const MAX_REVIEW_SNIPPETS = 5;

interface RawReview {
  rating?: number;
  text?: { text?: string };
}

function normalizeReviews(reviews: readonly RawReview[] | undefined): ReviewSnippet[] {
  return (reviews ?? [])
    .slice(0, MAX_REVIEW_SNIPPETS)
    .map((review) => ({ rating: review.rating, text: review.text?.text ?? "" }));
}

function normalizePlace(raw: RawPlace, city: string, now: Date): RetrievedPlace {
  return {
    placeId: raw.id ?? "",
    name: raw.displayName?.text ?? "",
    city,
    formattedAddress: raw.formattedAddress,
    latitude: raw.location?.latitude,
    longitude: raw.location?.longitude,
    types: raw.types ?? [],
    primaryType: raw.primaryType,
    rating: raw.rating,
    userRatingCount: raw.userRatingCount,
    priceLevel: toPriceLevelOrdinal(raw.priceLevel),
    priceRange: toPriceRange(raw.priceRange),
    businessStatus: raw.businessStatus,
    googleMapsUri: raw.googleMapsUri,
    openingPeriods: raw.regularOpeningHours?.periods,
    reviewSnippets: null,
    shortlistHydratedAt: null,
    photoNames: (raw.photos ?? []).flatMap((photo) => (photo.name ? [photo.name] : [])),
    photoUrls: null,
    photosResolvedAt: null,
    fetchedAt: now,
  };
}

// ── plumbing ─────────────────────────────────────────────────────────────────

function dedupeStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function dedupeByPlaceId(places: readonly RetrievedPlace[]): RetrievedPlace[] {
  const seen = new Set<string>();
  const kept: RetrievedPlace[] = [];
  for (const place of places) {
    if (seen.has(place.placeId)) continue;
    seen.add(place.placeId);
    kept.push(place);
  }
  return kept;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
