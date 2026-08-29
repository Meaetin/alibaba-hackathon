import { describe, expect, it, vi } from "vitest";

import {
  createInMemoryLocationStore,
  createInMemorySearchCache,
  type FetchLike,
} from "@/lib/planner/retrieval";

import { resolveLocations } from "./resolve";
import type { LinkAnalysis } from "./types";

const NOW = new Date("2026-08-29T09:00:00Z");
const API_KEY = "test-key";

function analysis(overrides: Partial<LinkAnalysis> = {}): LinkAnalysis {
  return {
    isLocationRelated: true,
    generatedTitle: "Three Hawker Centres in Singapore",
    summary: "A guide.",
    primaryCountry: "Singapore",
    primaryRegion: "Singapore",
    locations: ["Lau Pa Sat, Singapore, Singapore", "Maxwell Food Centre, Singapore, Singapore"],
    ...overrides,
  };
}

function rawPlace(id: string) {
  return {
    id,
    displayName: { text: id },
    formattedAddress: `${id}, Singapore`,
    location: { latitude: 1.28, longitude: 103.85 },
    types: ["restaurant", "food"],
    primaryType: "restaurant",
    rating: 4.4,
    userRatingCount: 900,
  };
}

/** Answers by `textQuery`; anything unlisted comes back with no places, which
 *  is Google's honest answer for a venue that does not exist. */
function fakeFetch(byQuery: Record<string, unknown[]>, failOn: string[] = []) {
  return vi.fn<FetchLike>(async (_url, init) => {
    const body = JSON.parse(init.body as string) as { textQuery: string };
    if (failOn.includes(body.textQuery)) {
      return { ok: false, status: 500, async text() { return "upstream"; }, async json() { return {}; } };
    }
    return {
      ok: true,
      status: 200,
      async text() { return ""; },
      async json() { return { places: byQuery[body.textQuery] ?? [] }; },
    };
  });
}

function deps(fetchMock: ReturnType<typeof fakeFetch>) {
  return {
    apiKey: API_KEY,
    cache: createInMemorySearchCache(),
    store: createInMemoryLocationStore(),
    fetch: fetchMock,
    now: NOW,
  };
}

describe("resolveLocations", () => {
  it("matches each mention to its own place and keeps the pairing", async () => {
    const fetchMock = fakeFetch({
      "Lau Pa Sat, Singapore, Singapore": [rawPlace("lau-pa-sat")],
      "Maxwell Food Centre, Singapore, Singapore": [rawPlace("maxwell")],
    });
    const result = await resolveLocations(analysis(), deps(fetchMock));

    expect(result.resolved).toHaveLength(2);
    expect(result.resolved[0]).toMatchObject({
      mention: "Lau Pa Sat, Singapore, Singapore",
      place: { placeId: "lau-pa-sat" },
    });
    expect(result.resolved[1].place?.placeId).toBe("maxwell");
  });

  /**
   * The whole reason this stage calls `retrievePlaces` once per mention. One
   * batched call returns a flat, deduplicated list — so if two mentions are one
   * venue, or one matched nothing, there is no way to say which mention lost.
   */
  it("gives each mention its own answer even when two of them are the same place", async () => {
    const fetchMock = fakeFetch({
      "Lau Pa Sat, Singapore, Singapore": [rawPlace("lau-pa-sat")],
      "Telok Ayer Market, Singapore, Singapore": [rawPlace("lau-pa-sat")],
    });
    const result = await resolveLocations(
      analysis({
        locations: ["Lau Pa Sat, Singapore, Singapore", "Telok Ayer Market, Singapore, Singapore"],
      }),
      deps(fetchMock),
    );

    expect(result.resolved).toHaveLength(2);
    expect(result.resolved.every((entry) => entry.place?.placeId === "lau-pa-sat")).toBe(true);
  });

  it("asks Google for exactly one result per mention", async () => {
    const fetchMock = fakeFetch({ "Lau Pa Sat, Singapore, Singapore": [rawPlace("lau-pa-sat")] });
    await resolveLocations(analysis({ locations: ["Lau Pa Sat, Singapore, Singapore"] }), deps(fetchMock));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { pageSize: number };
    expect(body.pageSize).toBe(1);
  });

  it("tells a venue Google has never heard of apart from a search that broke", async () => {
    const fetchMock = fakeFetch(
      { "Real Place, Singapore, Singapore": [rawPlace("real")] },
      ["Broken Search, Singapore, Singapore"],
    );
    const result = await resolveLocations(
      analysis({
        locations: [
          "Real Place, Singapore, Singapore",
          "Invented Cafe, Singapore, Singapore",
          "Broken Search, Singapore, Singapore",
        ],
      }),
      deps(fetchMock),
    );

    expect(result.resolved[0].place?.placeId).toBe("real");
    expect(result.resolved[1]).toMatchObject({ place: null, reason: "no_match" });
    expect(result.resolved[2]).toMatchObject({ place: null, reason: "search_failed" });
    expect(result.stats?.failures).toHaveLength(1);
  });

  /**
   * Mutation-checked: deleting the `isLocationRelated` guard turns this red.
   * It is the only stage that spends money at Google, so a gaming video whose
   * output happens to carry a stray string must not cost a Text Search.
   */
  it("buys nothing at all when the video is not about places", async () => {
    const fetchMock = fakeFetch({ "Somewhere, Nowhere, Nowhere": [rawPlace("somewhere")] });
    const result = await resolveLocations(
      analysis({ isLocationRelated: false, locations: ["Somewhere, Nowhere, Nowhere"] }),
      deps(fetchMock),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.resolved).toEqual([]);
    // Omitted, not zeroed: "we never asked" is not "we asked and found nothing".
    expect(result.stats).toBeUndefined();
  });

  it("reports zeroed stats, not absent ones, when it was willing to ask and had nothing to", async () => {
    const fetchMock = fakeFetch({});
    const result = await resolveLocations(analysis({ locations: [] }), deps(fetchMock));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.stats).toMatchObject({ billedCalls: 0, requested: 0 });
  });

  it("searches once for a venue the model named twice", async () => {
    const fetchMock = fakeFetch({ "Lau Pa Sat, Singapore, Singapore": [rawPlace("lau-pa-sat")] });
    const result = await resolveLocations(
      analysis({
        locations: [
          "Lau Pa Sat, Singapore, Singapore",
          "  lau pa sat, singapore, singapore  ",
          "Lau Pa Sat, Singapore, Singapore",
        ],
      }),
      deps(fetchMock),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.resolved).toHaveLength(1);
  });

  it("uses the region as the city, falling back to the country and then to nothing", async () => {
    const fetchMock = fakeFetch({ "A Place, X, Y": [rawPlace("a")] });
    const store = createInMemoryLocationStore();
    await resolveLocations(
      analysis({ primaryRegion: "Bali", primaryCountry: "Indonesia", locations: ["A Place, X, Y"] }),
      { apiKey: API_KEY, cache: createInMemorySearchCache(), store, fetch: fetchMock, now: NOW },
    );

    // `city` never reaches Google — the mention carries its own locality — but
    // it lands on the stored row, and "Bali" groups better than "Indonesia".
    const stored = await store.getMany(["a"]);
    expect(stored[0].city).toBe("Bali");
  });

  it("serves a second run of the same video from the cache", async () => {
    const fetchMock = fakeFetch({
      "Lau Pa Sat, Singapore, Singapore": [rawPlace("lau-pa-sat")],
      "Maxwell Food Centre, Singapore, Singapore": [rawPlace("maxwell")],
    });
    const shared = deps(fetchMock);

    const first = await resolveLocations(analysis(), shared);
    const second = await resolveLocations(analysis(), shared);

    expect(first.stats?.billedCalls).toBe(2);
    expect(second.stats?.billedCalls).toBe(0);
    expect(second.stats?.cacheHits).toBe(2);
    expect(second.resolved[0].place?.placeId).toBe("lau-pa-sat");
  });
});
