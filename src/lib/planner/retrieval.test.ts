import { describe, expect, it, vi } from "vitest";

import {
  SHORTLIST_FIELD_MASK,
  SEARCH_FIELD_MASK,
  buildSearchPlan,
  createInMemoryLocationStore,
  createInMemorySearchCache,
  hydrateShortlist,
  NEARBY_MAX_RADIUS_METERS,
  nearbyRequest,
  textNearRequest,
  retrievePlaces,
  searchCacheKey,
  type CachedSearch,
  type FetchLike,
  type LocationStore,
  type RetrievedPlace,
  type SearchRequest,
} from "./retrieval";

// Time is an injected parameter everywhere in the planner; retrieval is where
// that rule pays for itself, since "is this cache entry stale" is the whole
// cost question.
const NOW = new Date("2026-08-22T09:00:00Z");
const API_KEY = "test-key";

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A `places:searchText` result, as Google returns it. */
function rawPlace(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    displayName: { text: id },
    formattedAddress: `${id}, Kyoto`,
    location: { latitude: 35.0116, longitude: 135.7681 },
    types: ["cafe", "food"],
    primaryType: "cafe",
    rating: 4.5,
    userRatingCount: 812,
    priceLevel: "PRICE_LEVEL_MODERATE",
    photos: [{ name: `places/${id}/photos/AeJb1` }, { name: `places/${id}/photos/AeJb2` }],
    ...overrides,
  };
}

/**
 * A fake `fetch` that answers by `textQuery` and records every call. Nothing in
 * this file touches the network; the recorded URLs are themselves an assertion
 * target (see "never resolves a photo" below).
 */
/** Retrieval always POSTs a body; a missing one is a bug, not a shrug. */
function parseBody<T = Record<string, unknown>>(init: { body?: string }): T {
  if (!init.body) throw new Error("expected a JSON body on the Places request");
  return JSON.parse(init.body) as T;
}

function fakeFetch(byQuery: Record<string, unknown[]>) {
  return vi.fn<FetchLike>(async (url, init) => {
    const body = parseBody<{ textQuery: string }>(init);
    return {
      ok: true,
      status: 200,
      async text() {
        return "";
      },
      async json() {
        return { places: byQuery[body.textQuery] ?? [] };
      },
    };
  });
}

function bodiesOf(fetchMock: ReturnType<typeof fakeFetch>) {
  return fetchMock.mock.calls.map((call) => parseBody(call[1]));
}

function headersOf(fetchMock: ReturnType<typeof fakeFetch>) {
  return fetchMock.mock.calls.map((call) => call[1].headers);
}

function storedPlace(placeId: string): RetrievedPlace {
  return {
    placeId,
    name: placeId,
    city: "Kyoto",
    types: ["cafe"],
    reviewSnippets: [],
    shortlistHydratedAt: new Date("2026-08-01T00:00:00Z"),
    photoNames: [],
    photoUrls: null,
    photosResolvedAt: null,
    fetchedAt: new Date("2026-08-01T00:00:00Z"),
  };
}

function fresh(placeIds: string[]): CachedSearch {
  return { placeIds, expiresAt: new Date("2026-09-15T00:00:00Z") };
}

const KYOTO_CAFE: SearchRequest = { city: "Kyoto", query: "specialty coffee Kyoto" };

// ── caching — this is where the money is ─────────────────────────────────────

describe("retrieval cache", () => {
  it("issues zero fetch calls for a fresh cache hit", async () => {
    const fetchMock = fakeFetch({});
    const cache = createInMemorySearchCache({
      [searchCacheKey(KYOTO_CAFE)]: fresh(["place-a", "place-b"]),
    });
    const store = createInMemoryLocationStore([storedPlace("place-a"), storedPlace("place-b")]);

    const result = await retrievePlaces([KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: fetchMock,
      cache,
      store,
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(result.places.map((p) => p.placeId)).toEqual(["place-a", "place-b"]);
    expect(result.stats.cacheHits).toBe(1);
    expect(result.stats.billedCalls).toBe(0);
  });

  it("refetches an entry past expires_at, judged against the injected now", async () => {
    const fetchMock = fakeFetch({ "specialty coffee Kyoto": [rawPlace("place-a")] });
    const cache = createInMemorySearchCache({
      [searchCacheKey(KYOTO_CAFE)]: {
        placeIds: ["stale"],
        expiresAt: new Date("2026-08-22T08:59:59Z"), // one second before NOW
      },
    });

    const result = await retrievePlaces([KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: fetchMock,
      cache,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.stats.cacheHits).toBe(0);
    expect(result.places.map((p) => p.placeId)).toEqual(["place-a"]);
  });

  it("bills exactly the misses when 3 of 5 queries are cached, and unions both paths", async () => {
    const requests: SearchRequest[] = [
      { city: "Kyoto", query: "q1" },
      { city: "Kyoto", query: "q2" },
      { city: "Kyoto", query: "q3" },
      { city: "Kyoto", query: "q4" },
      { city: "Kyoto", query: "q5" },
    ];
    const fetchMock = fakeFetch({ q4: [rawPlace("d4")], q5: [rawPlace("d5")] });
    const cache = createInMemorySearchCache({
      [searchCacheKey(requests[0])]: fresh(["c1"]),
      [searchCacheKey(requests[1])]: fresh(["c2"]),
      [searchCacheKey(requests[2])]: fresh(["c3"]),
    });
    const store = createInMemoryLocationStore(["c1", "c2", "c3"].map(storedPlace));

    const result = await retrievePlaces(requests, {
      apiKey: API_KEY,
      fetch: fetchMock,
      cache,
      store,
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bodiesOf(fetchMock).map((b) => b.textQuery).sort()).toEqual(["q4", "q5"]);
    expect(result.places.map((p) => p.placeId)).toEqual(["c1", "c2", "c3", "d4", "d5"]);
  });

  it("writes a 30-day entry for every query it bills, including an empty result", async () => {
    const fetchMock = fakeFetch({}); // every query comes back with no places
    const cache = createInMemorySearchCache();

    await retrievePlaces([KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: fetchMock,
      cache,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    const entry = await cache.get(searchCacheKey(KYOTO_CAFE));
    expect(entry).toEqual({
      placeIds: [],
      expiresAt: new Date("2026-09-21T09:00:00Z"), // NOW + 30 days
    });
  });

  it("does not cache a failed query, and does not abort the run", async () => {
    const fetchMock = vi.fn<FetchLike>(async (_url, init) => {
      const { textQuery } = parseBody<{ textQuery: string }>(init);
      if (textQuery === "boom") {
        return {
          ok: false,
          status: 429,
          async text() {
            return "RESOURCE_EXHAUSTED";
          },
          async json() {
            return {};
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async text() {
          return "";
        },
        async json() {
          return { places: [rawPlace("survivor")] };
        },
      };
    });
    const cache = createInMemorySearchCache();

    const result = await retrievePlaces(
      [
        { city: "Kyoto", query: "boom" },
        { city: "Kyoto", query: "fine" },
      ],
      { apiKey: API_KEY, fetch: fetchMock, cache, store: createInMemoryLocationStore(), now: NOW },
    );

    expect(result.places.map((p) => p.placeId)).toEqual(["survivor"]);
    expect(result.stats.failures).toHaveLength(1);
    expect(result.stats.failures[0].request.query).toBe("boom");
    expect(result.stats.billedCalls).toBe(1);
    await expect(cache.get(searchCacheKey({ city: "Kyoto", query: "boom" }))).resolves.toBeUndefined();
  });

  it("refetches a cache entry when any referenced location row has gone", async () => {
    const cache = createInMemorySearchCache({
      [searchCacheKey(KYOTO_CAFE)]: fresh(["present", "evicted"]),
    });
    const store = createInMemoryLocationStore([storedPlace("present")]);
    const fetchMock = fakeFetch({ "specialty coffee Kyoto": [rawPlace("replacement")] });

    const result = await retrievePlaces([KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: fetchMock,
      cache,
      store,
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.places.map((p) => p.placeId)).toEqual(["replacement"]);
    expect(result.stats.missingFromStore).toBe(1);
    expect(result.stats.cacheHits).toBe(0);
    expect(result.stats.cacheMisses).toBe(1);

    const secondFetch = fakeFetch({});
    const second = await retrievePlaces([KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: secondFetch,
      cache,
      store,
      now: NOW,
    });
    expect(secondFetch).toHaveBeenCalledTimes(0);
    expect(second.places.map((p) => p.placeId)).toEqual(["replacement"]);
  });

  it("does not publish a cache entry before its location rows persist", async () => {
    const cache = createInMemorySearchCache();
    const put = vi.spyOn(cache, "put");
    const backing = createInMemoryLocationStore();
    const store: LocationStore = {
      ...backing,
      async upsertMany() {
        throw new Error("location write failed");
      },
    };

    await expect(
      retrievePlaces([KYOTO_CAFE], {
        apiKey: API_KEY,
        fetch: fakeFetch({ "specialty coffee Kyoto": [rawPlace("a")] }),
        cache,
        store,
        now: NOW,
      }),
    ).rejects.toThrow("location write failed");

    expect(put).not.toHaveBeenCalled();
  });
});

describe("searchCacheKey", () => {
  it("is stable across calls for the same triple", () => {
    expect(searchCacheKey(KYOTO_CAFE)).toBe(searchCacheKey({ ...KYOTO_CAFE }));
  });

  it("changes with the city", () => {
    expect(searchCacheKey({ ...KYOTO_CAFE, city: "Osaka" })).not.toBe(searchCacheKey(KYOTO_CAFE));
  });

  it("changes with the query and with includedType", () => {
    expect(searchCacheKey({ ...KYOTO_CAFE, query: "kissaten Kyoto" })).not.toBe(
      searchCacheKey(KYOTO_CAFE),
    );
    expect(searchCacheKey({ ...KYOTO_CAFE, includedType: "cafe" })).not.toBe(
      searchCacheKey(KYOTO_CAFE),
    );
  });

  it("changes with pageSize, because pageSize changes the result set", () => {
    expect(searchCacheKey(KYOTO_CAFE, 5)).not.toBe(searchCacheKey(KYOTO_CAFE, 20));
  });

  it("treats case and stray whitespace as the same search — paying twice for that is waste", () => {
    expect(searchCacheKey({ city: "  kyoto ", query: "Specialty  Coffee Kyoto" })).toBe(
      searchCacheKey(KYOTO_CAFE),
    );
  });

  it("changes with the rank preference — the same circle, ordered differently, is a different answer", () => {
    const distance = nearbyRequest("Kyoto", CENTRE, 1_200, ["museum"]);
    const popularity: SearchRequest = {
      ...distance,
      nearby: { ...distance.nearby!, rankPreference: "POPULARITY" },
    };
    expect(searchCacheKey(popularity)).not.toBe(searchCacheKey(distance));
  });
});

// ── nearby circles ───────────────────────────────────────────────────────────

const CENTRE = { latitude: 35.0116, longitude: 135.7681 };

describe("nearbyRequest", () => {
  /**
   * Google defaults to `POPULARITY`, which answers a different question from
   * the one every circle in this planner asks. A 4 km circle round a museum in
   * Nusa Dua returned twenty places in Kuta, 8 km away, and the anchor's own
   * neighbourhood never appeared — which is also why the feasibility ladder's
   * "widen" rung could not fix a day with nothing to eat. A bigger circle
   * ranked by popularity walks further from the anchor, not closer.
   */
  it("asks for the nearest places, not the most popular ones", () => {
    expect(nearbyRequest("Kyoto", CENTRE, 1_200, ["museum"]).nearby?.rankPreference).toBe(
      "DISTANCE",
    );
  });

  it("changes with the location bias — the same phrase in two neighbourhoods is two answers", () => {
    const here = textNearRequest("Kyoto", "vegetarian restaurants Kyoto", CENTRE, 1_200);
    const there = textNearRequest(
      "Kyoto",
      "vegetarian restaurants Kyoto",
      { latitude: 35.03, longitude: 135.72 },
      1_200,
    );
    expect(searchCacheKey(here)).not.toBe(searchCacheKey(there));
    // And a biased search is not the same call as the city-wide one it shares
    // a phrase with — that one was already fired by `buildSearchPlan`.
    expect(searchCacheKey(here)).not.toBe(
      searchCacheKey({ city: "Kyoto", query: "vegetarian restaurants Kyoto" }),
    );
  });

  it("sends the bias as a circle Google understands, on the text endpoint", async () => {
    const bodies: string[] = [];
    const doFetch: FetchLike = async (_url, init) => {
      bodies.push(init.body ?? "");
      return { ok: true, status: 200, async text() { return "{}"; }, async json() { return { places: [] }; } };
    };
    await retrievePlaces([textNearRequest("Kyoto", "vegetarian restaurants Kyoto", CENTRE, 1_200)], {
      apiKey: "k",
      cache: createInMemorySearchCache(),
      store: createInMemoryLocationStore(),
      fetch: doFetch,
      now: NOW,
    });
    const body = JSON.parse(bodies[0]);
    expect(body.textQuery).toBe("vegetarian restaurants Kyoto");
    expect(body.locationBias).toEqual({
      circle: { center: { latitude: CENTRE.latitude, longitude: CENTRE.longitude }, radius: 1_200 },
    });
    // Bias, never `nearby` — they are different endpoints and mixing them would
    // silently send a text query to the circle API.
    expect(body.locationRestriction).toBeUndefined();
  });

  it("clamps the radius to Google's ceiling rather than 400ing", () => {
    expect(nearbyRequest("Kyoto", CENTRE, 9_000_000, []).nearby?.radiusMeters).toBe(
      NEARBY_MAX_RADIUS_METERS,
    );
  });
});

// ── the field mask ───────────────────────────────────────────────────────────

describe("field mask", () => {
  it("keeps every Atmosphere field off bulk Text Search", () => {
    const bulk = SEARCH_FIELD_MASK.split(",");
    for (const field of SHORTLIST_FIELD_MASK.split(",")) {
      expect(bulk).not.toContain(`places.${field}`);
    }
  });

  it("puts the whole Atmosphere set on the one call reviews already pays for", () => {
    const fields = SHORTLIST_FIELD_MASK.split(",");
    expect(fields).toContain("reviews");
    expect(fields).toContain("editorialSummary");
    expect(fields).toContain("reviewSummary");
    expect(fields).toContain("servesVegetarianFood");
  });

  it("asks for photos and priceLevel", () => {
    const fields = SEARCH_FIELD_MASK.split(",");
    expect(fields).toContain("places.photos");
    expect(fields).toContain("places.priceLevel");
  });

  it("does not ask for editorialSummary in bulk — that moved to the shortlist call", () => {
    expect(SEARCH_FIELD_MASK).not.toContain("editorialSummary");
    expect(SHORTLIST_FIELD_MASK).toContain("editorialSummary");
  });

  it("sends the mask and the key as headers on the wire", async () => {
    const fetchMock = fakeFetch({ "specialty coffee Kyoto": [rawPlace("a")] });
    await retrievePlaces([KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: fetchMock,
      cache: createInMemorySearchCache(),
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(headersOf(fetchMock)[0]["X-Goog-FieldMask"]).toBe(SEARCH_FIELD_MASK);
    expect(headersOf(fetchMock)[0]["X-Goog-Api-Key"]).toBe(API_KEY);
  });

  it("passes includedType through to the request body only when set", async () => {
    const fetchMock = fakeFetch({ q: [] });
    await retrievePlaces(
      [
        { city: "Kyoto", query: "q" },
        { city: "Kyoto", query: "q", includedType: "cafe" },
      ],
      {
        apiKey: API_KEY,
        fetch: fetchMock,
        cache: createInMemorySearchCache(),
        store: createInMemoryLocationStore(),
        now: NOW,
      },
    );

    expect(bodiesOf(fetchMock)[0]).not.toHaveProperty("includedType");
    expect(bodiesOf(fetchMock)[1].includedType).toBe("cafe");
  });
});

// ── normalization ────────────────────────────────────────────────────────────

describe("normalization", () => {
  async function retrieveOne(raw: Record<string, unknown>) {
    const result = await retrievePlaces([KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: fakeFetch({ "specialty coffee Kyoto": [raw] }),
      cache: createInMemorySearchCache(),
      store: createInMemoryLocationStore(),
      now: NOW,
    });
    return result.places[0];
  }

  it("maps PRICE_LEVEL_MODERATE to the shared ordinal 2", async () => {
    const place = await retrieveOne(rawPlace("a", { priceLevel: "PRICE_LEVEL_MODERATE" }));
    expect(place.priceLevel).toBe(2);
  });

  it("leaves priceLevel undefined when Google didn't say — never 0", async () => {
    const place = await retrieveOne(rawPlace("a", { priceLevel: "PRICE_LEVEL_UNSPECIFIED" }));
    expect(place.priceLevel).toBeUndefined();
  });

  it("stores photo resource names, with photo_urls and photos_resolved_at null", async () => {
    const place = await retrieveOne(rawPlace("a"));
    expect(place.photoNames).toEqual(["places/a/photos/AeJb1", "places/a/photos/AeJb2"]);
    expect(place.photoUrls).toBeNull();
    expect(place.photosResolvedAt).toBeNull();
  });

  it("never requests a /media endpoint — resolving a photo is a separate SKU", async () => {
    const fetchMock = fakeFetch({ "specialty coffee Kyoto": [rawPlace("a")] });
    await retrievePlaces([KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: fetchMock,
      cache: createInMemorySearchCache(),
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    const urls = fetchMock.mock.calls.map((call) => call[0]);
    expect(urls).toHaveLength(1);
    expect(urls.every((url) => !url.includes("/media"))).toBe(true);
  });

  it("stores null until shortlist review hydration runs", async () => {
    const place = await retrieveOne(rawPlace("a"));
    expect(place.reviewSnippets).toBeNull();
  });

  it("carries businessStatus and opening periods through, and flattens priceRange", async () => {
    const periods = [
      { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 18, minute: 0 } },
    ];
    const place = await retrieveOne(
      rawPlace("a", {
        businessStatus: "CLOSED_PERMANENTLY",
        regularOpeningHours: { periods },
        priceRange: {
          startPrice: { currencyCode: "JPY", units: "1000" },
          endPrice: { currencyCode: "JPY", units: "2000" },
        },
      }),
    );

    expect(place.businessStatus).toBe("CLOSED_PERMANENTLY");
    expect(place.openingPeriods).toEqual(periods);
    // `locations.price_range` holds one shape. The browser add-a-place path in
    // `maps/place-search.ts` writes the same flattened one — see `toPriceRange`.
    expect(place.priceRange).toEqual({ startPrice: 1000, endPrice: 2000, currency: "JPY" });
  });

  it("stamps the search city and the injected fetch time", async () => {
    const place = await retrieveOne(rawPlace("a"));
    expect(place.city).toBe("Kyoto");
    expect(place.fetchedAt).toEqual(NOW);
  });

  it("persists what it fetched, so the next run's cache hit can hydrate", async () => {
    const store = createInMemoryLocationStore();
    await retrievePlaces([KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: fakeFetch({ "specialty coffee Kyoto": [rawPlace("a")] }),
      cache: createInMemorySearchCache(),
      store,
      now: NOW,
    });

    await expect(store.getMany(["a"])).resolves.toHaveLength(1);
  });
});

// ── shortlist-only Atmosphere hydration ─────────────────────────────────────

describe("shortlist hydration", () => {
  interface FakeDetails {
    reviews?: unknown[];
    editorialSummary?: { text?: string };
    reviewSummary?: { text?: { text?: string } };
    servesVegetarianFood?: boolean;
  }

  function fakeDetailsFetch(byPlaceId: Record<string, FakeDetails>) {
    return vi.fn<FetchLike>(async (url) => {
      const placeId = decodeURIComponent(url.slice(url.lastIndexOf("/") + 1));
      return {
        ok: true,
        status: 200,
        async text() {
          return "";
        },
        async json() {
          return byPlaceId[placeId] ?? {};
        },
      };
    });
  }

  const unhydrated = (placeId: string): RetrievedPlace => ({
    ...storedPlace(placeId),
    reviewSnippets: null,
    shortlistHydratedAt: null,
  });

  it("fetches only for shortlisted places and caps reviews at five", async () => {
    const pool = Array.from({ length: 100 }, (_, i) => unhydrated(`p-${i}`));
    const reviews = Array.from({ length: 8 }, (_, i) => ({
      rating: 5,
      text: { text: `review ${i}` },
    }));
    const fetchMock = fakeDetailsFetch({ "p-2": { reviews }, "p-7": { reviews: [] } });
    const store = createInMemoryLocationStore(pool);

    const result = await hydrateShortlist(pool, ["p-2", "p-7"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store,
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.stats.billedCalls).toBe(2);
    expect(result.places[0].reviewSnippets).toHaveLength(5);
    expect(result.places[0].reviewSnippets?.[0]).toEqual({ rating: 5, text: "review 0" });
    expect(result.places[1].reviewSnippets).toEqual([]);
    await expect(store.getMany(["p-2", "p-7"])).resolves.toEqual(result.places);
  });

  it("carries every Atmosphere field off the one billed call", async () => {
    const place = unhydrated("a");
    const fetchMock = fakeDetailsFetch({
      a: {
        reviews: [{ rating: 4, text: { text: "great tofu" } }],
        editorialSummary: { text: "A quiet vegetarian kitchen." },
        reviewSummary: { text: { text: "Diners praise the tofu." } },
        servesVegetarianFood: true,
      },
    });

    const result = await hydrateShortlist([place], ["a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore([place]),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.places[0]).toMatchObject({
      reviewSnippets: [{ rating: 4, text: "great tofu" }],
      editorialSummary: "A quiet vegetarian kitchen.",
      reviewSummary: "Diners praise the tofu.",
      servesVegetarianFood: true,
      shortlistHydratedAt: NOW,
    });
  });

  it("keeps servesVegetarianFood false rather than dropping it to undefined", async () => {
    const place = unhydrated("steak");
    const fetchMock = fakeDetailsFetch({ steak: { servesVegetarianFood: false } });

    const store = createInMemoryLocationStore([place]);
    const result = await hydrateShortlist([place], ["steak"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store,
      now: NOW,
    });

    expect(result.places[0].servesVegetarianFood).toBe(false);
    const [stored] = await store.getMany(["steak"]);
    expect(stored.servesVegetarianFood).toBe(false);
  });

  it("stamps shortlistHydratedAt even when Google returns nothing at all", async () => {
    const place = unhydrated("quiet");
    const fetchMock = fakeDetailsFetch({ quiet: {} });

    const result = await hydrateShortlist([place], ["quiet"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore([place]),
      now: NOW,
    });

    expect(result.places[0].shortlistHydratedAt).toEqual(NOW);
    expect(result.places[0].reviewSnippets).toEqual([]);
    expect(result.places[0].editorialSummary).toBeUndefined();
    expect(result.places[0].servesVegetarianFood).toBeUndefined();
  });

  it("leaves shortlistHydratedAt null after a failed fetch so a replan retries", async () => {
    const place = unhydrated("boom");
    const fetchMock = vi.fn<FetchLike>(async () => ({
      ok: false,
      status: 500,
      async text() {
        return "upstream exploded";
      },
      async json() {
        return {};
      },
    }));
    const store = createInMemoryLocationStore([place]);

    const result = await hydrateShortlist([place], ["boom"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store,
      now: NOW,
    });

    expect(result.stats.failures).toHaveLength(1);
    expect(result.stats.billedCalls).toBe(0);
    expect(result.places[0].shortlistHydratedAt).toBeNull();
    const [stored] = await store.getMany(["boom"]);
    expect(stored.shortlistHydratedAt).toBeNull();
  });

  it("skips rows already hydrated, including ones Google had no reviews for", async () => {
    const hydrated = { ...storedPlace("done"), shortlistHydratedAt: NOW };
    const pending = unhydrated("pending");
    const fetchMock = fakeDetailsFetch({ pending: {} });

    const result = await hydrateShortlist([hydrated, pending], ["done", "pending"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore([hydrated, pending]),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.stats.skippedAlreadyHydrated).toBe(1);
  });

  it("uses the shortlist field mask on a GET Place Details call", async () => {
    const place = unhydrated("a");
    const fetchMock = fakeDetailsFetch({ a: {} });

    await hydrateShortlist([place], ["a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore([place]),
      now: NOW,
    });

    expect(fetchMock.mock.calls[0][1].headers["X-Goog-FieldMask"]).toBe(SHORTLIST_FIELD_MASK);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });
});

describe("location merge state", () => {
  const resolvedAt = new Date("2026-08-20T00:00:00Z");

  function resolved(placeId: string): RetrievedPlace {
    return {
      ...storedPlace(placeId),
      photoNames: [`places/${placeId}/photos/one`],
      photoUrls: ["https://images.example.test/one.jpg"],
      photosResolvedAt: resolvedAt,
    };
  }

  it("returns preserved photo state when a refetch carries the same resource names", async () => {
    const existing = resolved("a");
    const store = createInMemoryLocationStore([existing]);

    const [merged] = await store.upsertMany([
      {
        ...existing,
        name: "Refetched",
        photoUrls: null,
        photosResolvedAt: null,
      },
    ]);

    expect(merged.name).toBe("Refetched");
    expect(merged.photoUrls).toEqual(existing.photoUrls);
    expect(merged.photosResolvedAt).toEqual(resolvedAt);
  });

  // The whole point of caching the pool: a second trip to the same city must
  // not re-buy Atmosphere data for places we already hydrated.
  it("preserves shortlist hydration across a retrieval refetch", async () => {
    const hydratedAt = new Date("2026-08-21T00:00:00Z");
    const existing: RetrievedPlace = {
      ...storedPlace("a"),
      reviewSnippets: [{ rating: 5, text: "Go at dawn." }],
      editorialSummary: "A vermilion torii path.",
      reviewSummary: "Long hike, worth it.",
      servesVegetarianFood: false,
      shortlistHydratedAt: hydratedAt,
    };
    const store = createInMemoryLocationStore([existing]);

    // Retrieval always produces a row that has never been hydrated.
    const [merged] = await store.upsertMany([
      {
        ...existing,
        name: "Refetched",
        reviewSnippets: null,
        editorialSummary: undefined,
        reviewSummary: undefined,
        servesVegetarianFood: undefined,
        shortlistHydratedAt: null,
      },
    ]);

    expect(merged.name).toBe("Refetched");
    expect(merged.reviewSnippets).toEqual(existing.reviewSnippets);
    expect(merged.editorialSummary).toBe("A vermilion torii path.");
    expect(merged.reviewSummary).toBe("Long hike, worth it.");
    // A stored `false` is an answer and must survive, same as a `true`.
    // (This does not pin `??` over `||`: the boolean is not in the bulk mask,
    // so a refetch never carries one in and the two behave alike here.)
    expect(merged.servesVegetarianFood).toBe(false);
    expect(merged.shortlistHydratedAt).toEqual(hydratedAt);
  });

  it("keeps resolved photo state when a refetch changes the resource names", async () => {
    // A resource name is a per-response token: the same search run twice
    // returns a different one for every photo. Treating that as "the photo
    // changed" threw away media we had already paid the Photos SKU for, on
    // every replan, for every place in the pool.
    const existing = resolved("a");
    const store = createInMemoryLocationStore([existing]);

    const [merged] = await store.upsertMany([
      {
        ...existing,
        photoNames: ["places/a/photos/two"],
        photoUrls: null,
        photosResolvedAt: null,
      },
    ]);

    expect(merged.photoNames).toEqual(["places/a/photos/two"]);
    expect(merged.photoUrls).toEqual(existing.photoUrls);
    expect(merged.photosResolvedAt).toEqual(resolvedAt);
  });

  it("applies a photo write whose resource-name set no longer matches the row", async () => {
    // The double and the Postgres store have to answer this the same way: every
    // planner test runs against the double, so a disagreement here means the
    // offline suite proves nothing about what actually gets written.
    const existing = resolved("a");
    const store = createInMemoryLocationStore([
      { ...existing, photoUrls: null, photosResolvedAt: null },
    ]);

    await store.updatePhotoResolution([
      {
        placeId: "a",
        photoNames: ["places/a/photos/a-name-from-an-earlier-search"],
        photoUrls: ["https://images.example.test/resolved.jpg"],
        photosResolvedAt: resolvedAt,
      },
    ]);

    const [read] = await store.getMany(["a"]);
    expect(read.photoUrls).toEqual(["https://images.example.test/resolved.jpg"]);
    expect(read.photosResolvedAt).toEqual(resolvedAt);
  });

  it("returns merged store state from a cache miss so photo resolution does not re-bill", async () => {
    const existing = resolved("a");
    const store = createInMemoryLocationStore([existing]);
    const result = await retrievePlaces([KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: fakeFetch({
        "specialty coffee Kyoto": [
          rawPlace("a", { photos: [{ name: "places/a/photos/one" }] }),
        ],
      }),
      cache: createInMemorySearchCache(),
      store,
      now: NOW,
    });

    expect(result.places[0].photoUrls).toEqual(existing.photoUrls);
    expect(result.places[0].photosResolvedAt).toEqual(resolvedAt);
  });
});

// ── dedupe ───────────────────────────────────────────────────────────────────

describe("dedupe", () => {
  it("emits a place_id once when two queries both return it", async () => {
    const fetchMock = fakeFetch({
      q1: [rawPlace("shared"), rawPlace("only-1")],
      q2: [rawPlace("shared"), rawPlace("only-2")],
    });

    const result = await retrievePlaces(
      [
        { city: "Kyoto", query: "q1" },
        { city: "Kyoto", query: "q2" },
      ],
      {
        apiKey: API_KEY,
        fetch: fetchMock,
        cache: createInMemorySearchCache(),
        store: createInMemoryLocationStore(),
        now: NOW,
      },
    );

    expect(result.places.map((p) => p.placeId)).toEqual(["shared", "only-1", "only-2"]);
    expect(result.stats.seen).toBe(4);
    expect(result.stats.duplicatesDropped).toBe(1);
  });

  it("bills an identical triple once inside a single run, before the cache is consulted", async () => {
    const fetchMock = fakeFetch({ "specialty coffee Kyoto": [rawPlace("a")] });

    const result = await retrievePlaces([KYOTO_CAFE, { ...KYOTO_CAFE }, KYOTO_CAFE], {
      apiKey: API_KEY,
      fetch: fetchMock,
      cache: createInMemorySearchCache(),
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.stats.requested).toBe(3);
    expect(result.stats.unique).toBe(1);
  });

  it("oversamples a multi-interest profile without duplicate billed calls", async () => {
    const plan = buildSearchPlan(
      { interests: ["cafes", "outdoors", "food"], dietary: ["vegetarian"] },
      "Kyoto",
    );
    // 20 distinct places per query, with every query overlapping the previous
    // one by 5 — the shape real retrieval produces.
    const byQuery = Object.fromEntries(
      plan.map((request, q) =>
        [
          request.query,
          Array.from({ length: 20 }, (_, i) => rawPlace(`p-${q * 15 + i}`)),
        ] as const,
      ),
    );
    const fetchMock = fakeFetch(byQuery);

    const result = await retrievePlaces(plan, {
      apiKey: API_KEY,
      fetch: fetchMock,
      cache: createInMemorySearchCache(),
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(plan.length);
    expect(new Set(bodiesOf(fetchMock).map((b) => b.textQuery)).size).toBe(plan.length);
    expect(result.places).toHaveLength(new Set(result.places.map((p) => p.placeId)).size);
    expect(result.places.length).toBeGreaterThanOrEqual(100);
  });
});

// ── the search plan ──────────────────────────────────────────────────────────

describe("buildSearchPlan", () => {
  it("interpolates the city into every query, interest and dietary alike", () => {
    const plan = buildSearchPlan({ interests: ["cafes"], dietary: ["vegetarian"] }, "Kyoto");
    expect(plan.every((r) => r.query.includes("Kyoto"))).toBe(true);
    expect(plan.some((r) => r.query.includes("{city}"))).toBe(false);
    expect(plan.map((r) => r.query)).toContain("vegetarian restaurants Kyoto");
  });

  it("emits two queries per interest", () => {
    expect(buildSearchPlan({ interests: ["cafes", "museums"], dietary: [] }, "Kyoto")).toHaveLength(
      4,
    );
  });

  it("drops a dietary need with no bridge row rather than inventing a query", () => {
    const plan = buildSearchPlan({ interests: [], dietary: ["low-fodmap"] }, "Kyoto");
    expect(plan).toEqual([]);
  });

  it("collapses a repeated row, so the same query is never billed twice", () => {
    const plan = buildSearchPlan(
      { interests: ["cafes", "cafes"], dietary: ["vegetarian", "vegetarian"] },
      "Kyoto",
    );
    expect(new Set(plan.map(searchCacheKey)).size).toBe(plan.length);
    expect(plan).toHaveLength(4); // 2 cafe + 2 vegetarian, each duplicate collapsed
  });

  // The circle is what stops "specialty coffee Bali" answering for an island
  // 150 km across. It is a bias and not a restriction, which is the point: the
  // pool filter enforces, this only shapes what Google offers first.
  it("leans every query on the base's circle when one is given", () => {
    const near = { latitude: -8.5069, longitude: 115.2625, radiusMeters: 25_000 };
    const plan = buildSearchPlan({ interests: ["cafes"], dietary: ["vegetarian"] }, "Bali", near);
    expect(plan.length).toBeGreaterThan(0);
    for (const request of plan) {
      expect(request.locationBias).toEqual(near);
      // A text bias, never a nearby circle — different endpoint, different SKU.
      expect(request.nearby).toBeUndefined();
    }
  });

  // A pre-warmed city's rows cost real money. A stray `locationBias` on every
  // text search changes every cache key and orphans all of them at once, and
  // nothing in the pipeline would report it — the run would simply be slower
  // and more expensive. So "no base" has to mean byte-identical, not similar.
  it("is byte-identical to the unbiased plan when no base is given", () => {
    const profile = { interests: ["cafes" as const, "museums" as const], dietary: ["vegetarian"] };
    const plain = buildSearchPlan(profile, "Kyoto");
    expect(buildSearchPlan(profile, "Kyoto", undefined)).toEqual(plain);
    for (const request of plain) expect(request.locationBias).toBeUndefined();

    const biased = buildSearchPlan(profile, "Kyoto", {
      latitude: 35.0116,
      longitude: 135.7681,
      radiusMeters: 25_000,
    });
    expect(biased.map((r) => r.query)).toEqual(plain.map((r) => r.query));
    // Same questions, different answers — so they must not share a cache entry.
    expect(biased.map((r) => searchCacheKey(r))).not.toEqual(plain.map((r) => searchCacheKey(r)));
  });
});
