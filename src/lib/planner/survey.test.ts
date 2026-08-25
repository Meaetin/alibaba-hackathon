import { describe, expect, it } from "vitest";

import { mulberry32 } from "./__tests__/rng";
import { AREAS_PER_DAY, LANDMARKS_PER_AREA, MAX_AREAS, MIN_AREAS, surveyCity } from "./survey";
import type { CandidatePlace } from "./types";

function place(placeId: string, overrides: Partial<CandidatePlace> = {}): CandidatePlace {
  return {
    placeId,
    name: placeId,
    types: ["tourist_attraction"],
    latitude: 35.0,
    longitude: 135.7,
    ...overrides,
  };
}

/** Two tight knots of places, far apart — a shape k-means must split. */
function twoNeighbourhoods(): CandidatePlace[] {
  return [
    ...Array.from({ length: 8 }, (_, i) =>
      place(`north-${i}`, { latitude: 35.05 + i * 0.001, longitude: 135.75 }),
    ),
    ...Array.from({ length: 8 }, (_, i) =>
      place(`south-${i}`, { latitude: 34.9 + i * 0.001, longitude: 135.6 }),
    ),
  ];
}

const params = { city: "Kyoto", totalDays: 3, rng: mulberry32(1337) };

describe("surveyCity", () => {
  it("counts everything retrieved, including what it cannot place", () => {
    const pool = [...twoNeighbourhoods(), place("nowhere", { latitude: undefined, longitude: undefined })];
    const survey = surveyCity(pool, { ...params, rng: mulberry32(1337) });
    expect(survey.totalPlaces).toBe(17);
    // A place with no coordinates is in the pool and in no area. Saying so is
    // the difference between a thin survey and a wrong one.
    expect(survey.unlocated).toBe(1);
    expect(survey.areas.reduce((sum, area) => sum + area.placeCount, 0)).toBe(16);
  });

  it("asks for finer areas than there are days", () => {
    // A theme may span two adjacent areas; it cannot un-merge one cut too
    // coarse. So the survey is deliberately not one-area-per-day.
    const survey = surveyCity(twoNeighbourhoods(), { ...params, rng: mulberry32(1337) });
    expect(survey.areas.length).toBe(Math.max(MIN_AREAS, params.totalDays * AREAS_PER_DAY));
  });

  it("stays inside its bounds on a very long or very short trip", () => {
    const pool = Array.from({ length: 40 }, (_, i) =>
      place(`p-${i}`, { latitude: 35 + i * 0.01, longitude: 135 + i * 0.01 }),
    );
    expect(
      surveyCity(pool, { city: "Kyoto", totalDays: 1, rng: mulberry32(1) }).areas.length,
    ).toBe(MIN_AREAS);
    expect(
      surveyCity(pool, { city: "Kyoto", totalDays: 14, rng: mulberry32(1) }).areas.length,
    ).toBe(MAX_AREAS);
  });

  it("names each area by its best-known places, not its best-scoring ones", () => {
    // This list is how the model works out *where* an area is, and the answer
    // to "where is this" is the place everyone has heard of.
    const pool = [
      place("famous", { latitude: 35.05, longitude: 135.75, userRatingCount: 40_000 }),
      place("quiet-gem", { latitude: 35.051, longitude: 135.75, userRatingCount: 30 }),
    ];
    // One area, so the ordering inside it is the only thing under test.
    const survey = surveyCity(pool, {
      city: "Kyoto",
      totalDays: 1,
      rng: mulberry32(7),
      areaCount: 1,
    });
    expect(survey.areas[0].landmarks.map((l) => l.placeId)).toEqual(["famous", "quiet-gem"]);
  });

  it("names a thinly-covered area rather than leaving it blank", () => {
    // No review counts anywhere. Excluding the unknowns would leave the model
    // an area it cannot place, which is worse than an obscure name.
    const pool = [place("a", { latitude: 35.05, longitude: 135.75 })];
    const survey = surveyCity(pool, { city: "Kyoto", totalDays: 1, rng: mulberry32(7) });
    expect(survey.areas[0].landmarks).toHaveLength(1);
  });

  it("caps how much of an area it describes", () => {
    const pool = Array.from({ length: 20 }, (_, i) =>
      place(`p-${i}`, { latitude: 35.05, longitude: 135.75, userRatingCount: i }),
    );
    const survey = surveyCity(pool, { city: "Kyoto", totalDays: 1, rng: mulberry32(7) });
    for (const area of survey.areas) {
      expect(area.landmarks.length).toBeLessThanOrEqual(LANDMARKS_PER_AREA);
    }
  });

  it("counts what can seat a meal, per area", () => {
    const pool = [
      place("temple", { latitude: 35.05, longitude: 135.75 }),
      place("ramen", { latitude: 35.051, longitude: 135.75, types: ["ramen_restaurant", "restaurant"] }),
    ];
    const survey = surveyCity(pool, { city: "Kyoto", totalDays: 1, rng: mulberry32(7) });
    const total = survey.areas.reduce((sum, area) => sum + area.mealCapableCount, 0);
    expect(total).toBe(1);
  });

  it("does not read an absent price as a free place", () => {
    const pool = [
      place("free", { priceLevel: 0 }),
      place("unknown"),
      place("dear", { priceLevel: 3 }),
    ];
    const survey = surveyCity(pool, { city: "Kyoto", totalDays: 1, rng: mulberry32(7) });
    expect(survey.priceSpread[0]).toBe(1);
    expect(survey.priceSpread[3]).toBe(1);
    expect(survey.unknownPrice).toBe(1);
  });

  it("is deterministic given the same rng", () => {
    const a = surveyCity(twoNeighbourhoods(), { ...params, rng: mulberry32(99) });
    const b = surveyCity(twoNeighbourhoods(), { ...params, rng: mulberry32(99) });
    expect(a).toEqual(b);
  });

  it("survives an empty pool without inventing an area", () => {
    const survey = surveyCity([], { ...params, rng: mulberry32(1) });
    expect(survey.areas).toEqual([]);
    expect(survey.totalPlaces).toBe(0);
  });
});
