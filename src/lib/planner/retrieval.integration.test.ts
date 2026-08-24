/**
 * Runs only when `GOOGLE_PLACES_API_KEY` is set in `.env.local`.
 *
 *   npm run test:places
 *
 * Every call here bills the Enterprise + Atmosphere Place Details SKU, so this
 * is a pre-demo check, not a per-commit gate. What it covers is the one seam
 * the offline tests cannot: whether Google still returns the shapes
 * `fetchShortlistDetails` unwraps. `editorialSummary` is `{text}` but
 * `reviewSummary` is `{text:{text}}`, and a silent change to either would leave
 * every summary undefined with all 300+ offline tests still green.
 */

import { describe, expect, it } from "vitest";

import { applyHardFilters } from "./score";
import {
  createInMemoryLocationStore,
  hydrateShortlist,
  type RetrievedPlace,
} from "./retrieval";
import type { PreferenceProfile } from "./types";

const apiKey = process.env.GOOGLE_PLACES_API_KEY;
const NOW = new Date("2026-08-24T00:00:00Z");

/** Two long-lived chains, chosen because Google answers the dietary field for
 *  both and answers it *differently* — a pure-vegetarian kitchen and a burger
 *  joint. `reviewSummary` is US/UK/TW-populated and blank in Singapore, so the
 *  summary assertion rides on the New York one. */
const ANNAPOORNA = "ChIJ00jOSwAZ2jER7_Z3_D_lAPg"; // pure vegetarian, Singapore
const SHAKE_SHACK_QUERY = "Shake Shack Madison Square Park New York";

const row = (placeId: string, name: string, types: string[]): RetrievedPlace => ({
  placeId,
  name,
  city: "test",
  types,
  reviewSnippets: null,
  shortlistHydratedAt: null,
  photoNames: [],
  photoUrls: null,
  photosResolvedAt: null,
  fetchedAt: NOW,
});

/** Cheapest possible lookup: an id-only mask is the Essentials "IDs Only" SKU. */
async function findPlaceId(query: string): Promise<string> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey!,
      "X-Goog-FieldMask": "places.id",
    },
    body: JSON.stringify({ textQuery: query, pageSize: 1 }),
  });
  const data = (await response.json()) as { places?: { id: string }[] };
  const id = data.places?.[0]?.id;
  if (!id) throw new Error(`no place found for ${query}`);
  return id;
}

describe.skipIf(!apiKey)("shortlist hydration against live Google", () => {
  it("unwraps every field on the mask, and the dietary booleans disagree", async () => {
    const shackId = await findPlaceId(SHAKE_SHACK_QUERY);
    const pool = [
      row(ANNAPOORNA, "Annapoorna", ["indian_restaurant", "restaurant"]),
      row(shackId, "Shake Shack", ["hamburger_restaurant", "restaurant"]),
    ];
    const store = createInMemoryLocationStore(pool);

    const { places, stats } = await hydrateShortlist(pool, [ANNAPOORNA, shackId], {
      apiKey: apiKey!,
      store,
      now: NOW,
    });

    expect(stats.failures).toEqual([]);
    expect(stats.billedCalls).toBe(2);

    const [veg, burger] = places;
    expect(veg.servesVegetarianFood).toBe(true);
    expect(burger.servesVegetarianFood).toBe(false);

    // Reviews are the enrichment pass's free text — five, with actual prose.
    expect(veg.reviewSnippets?.length).toBeGreaterThan(0);
    expect(veg.reviewSnippets?.[0].text.length).toBeGreaterThan(10);

    // The two summaries nest differently. Both are unwrapped to plain strings.
    expect(typeof burger.editorialSummary).toBe("string");
    expect(burger.editorialSummary).not.toContain("{");
    expect(typeof burger.reviewSummary).toBe("string");
    expect(burger.reviewSummary!.length).toBeGreaterThan(20);

    expect(veg.shortlistHydratedAt).toEqual(NOW);
  }, 30_000);

  it("feeds the dietary hard filter, which now drops the burger joint", async () => {
    const shackId = await findPlaceId(SHAKE_SHACK_QUERY);
    const pool = [
      row(ANNAPOORNA, "Annapoorna", ["indian_restaurant", "restaurant"]),
      // No steak_house/hamburger type conflict is needed — Google's boolean is
      // what convicts here, which the offline type list could never do.
      row(shackId, "Shake Shack", ["restaurant"]),
    ];
    const { places } = await hydrateShortlist(pool, [ANNAPOORNA, shackId], {
      apiKey: apiKey!,
      store: createInMemoryLocationStore(pool),
      now: NOW,
    });

    const profile: PreferenceProfile = {
      interests: ["food"],
      dietary: ["vegetarian"],
      pace: "balanced",
    };
    const kept = applyHardFilters(places, profile, { mealSlot: true });
    expect(kept.map((p) => p.name)).toEqual(["Annapoorna"]);
  }, 30_000);
});
