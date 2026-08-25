import { describe, expect, it, vi } from "vitest";

import { createFakeResponses } from "./__tests__/fakes";
import { mulberry32 } from "./__tests__/rng";
import { RADIUS_METERS, planThemes, radiusFor, validateThemes } from "./theme";
import { surveyCity } from "./survey";
import type { CandidatePlace, PreferenceProfile } from "./types";

const PROFILE: PreferenceProfile = {
  interests: ["temples", "food"],
  dietary: ["vegetarian"],
  pace: "balanced",
};

function place(placeId: string, overrides: Partial<CandidatePlace> = {}): CandidatePlace {
  return {
    placeId,
    name: placeId,
    types: ["tourist_attraction"],
    latitude: 35.0,
    longitude: 135.7,
    userRatingCount: 1000,
    ...overrides,
  };
}

const POOL = [
  ...Array.from({ length: 6 }, (_, i) =>
    place(`north-${i}`, { latitude: 35.05 + i * 0.001, longitude: 135.75, userRatingCount: 9000 - i }),
  ),
  ...Array.from({ length: 6 }, (_, i) =>
    place(`south-${i}`, { latitude: 34.9 + i * 0.001, longitude: 135.6, userRatingCount: 8000 - i }),
  ),
];

const SURVEY = surveyCity(POOL, { city: "Kyoto", totalDays: 2, rng: mulberry32(1337) });
const POOL_IDS = new Set(POOL.map((p) => p.placeId));
const DAYS = [
  { dayIndex: 0, weekday: 1 as const },
  { dayIndex: 1, weekday: 2 as const },
];

function input(overrides: Partial<Parameters<typeof planThemes>[0]> = {}) {
  return { survey: SURVEY, profile: PROFILE, days: DAYS, ...overrides };
}

describe("radiusFor", () => {
  it("keeps 'walkable' aligned with what the packer calls walking", () => {
    // A theme described as walkable must produce a day the packer also thinks
    // is walkable, or the two disagree about the same word.
    expect(radiusFor("walkable", 1200)).toBe(RADIUS_METERS.walkable);
  });

  it("scales with the axis that owns distance", () => {
    // `comfortTolerance` sets `walkMaxMeters`; the radius follows it rather
    // than being a second table that can drift away from it.
    expect(radiusFor("walkable", 800)).toBeLessThan(radiusFor("walkable", 1200));
    expect(radiusFor("walkable", 2000)).toBeGreaterThan(radiusFor("walkable", 1200));
    expect(radiusFor("tight", 2000)).toBeLessThan(radiusFor("wide", 800));
  });
});

describe("planThemes", () => {
  it("names one day at a time, each anchored on a place we actually have", () => {
    // Handled below by the validator test; here the whole call is exercised.
    return planThemes(input(), POOL_IDS, {
      client: createFakeResponses(),
      promptCacheKey: "test",
    }).then((result) => {
      expect(result.unavailable).toBe(false);
      expect(result.themes).toHaveLength(2);
      expect(result.rejected).toEqual([]);
      for (const theme of result.themes) {
        expect(POOL_IDS.has(theme.anchorPlaceId), theme.anchorPlaceId).toBe(true);
        expect(theme.premise.length).toBeGreaterThan(0);
      }
      expect(result.themes.map((t) => t.dayIndex)).toEqual([0, 1]);
    });
  });

  it("falls back to geography rather than throwing when the call dies", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await planThemes(input(), POOL_IDS, {
      client: createFakeResponses({ fail: "theme" }),
      promptCacheKey: "test",
    });

    // A dead theme pass costs the premises, never the trip.
    expect(result.unavailable).toBe(true);
    expect(result.themes).toEqual([]);
    expect(result.rejected.map((r) => r.dayIndex)).toEqual([0, 1]);
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("refuses an anchor the model invented, and says so", async () => {
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await planThemes(input(), POOL_IDS, {
      client: createFakeResponses({ hallucinateAnchors: ["a-glassblowing-quarter"] }),
      promptCacheKey: "test",
    });

    // The one rule the whole pass turns on. Day one loses its theme; day two
    // is unaffected, because a rejection is per day and never per trip.
    expect(result.themes.map((t) => t.dayIndex)).toEqual([1]);
    expect(result.rejected).toEqual([
      {
        dayIndex: 0,
        anchorPlaceId: "a-glassblowing-quarter",
        reason: "the anchor names a place that is not in the pool",
      },
    ]);
    expect(warnings).toHaveBeenCalled();
    warnings.mockRestore();
  });

  it("does not call the model for a trip with no days", async () => {
    const client = createFakeResponses();
    const result = await planThemes(input({ days: [] }), POOL_IDS, {
      client,
      promptCacheKey: "test",
    });
    expect(result.themes).toEqual([]);
    expect(client.requests).toHaveLength(0);
  });

  it("never asks the model to enforce a hard constraint", async () => {
    const client = createFakeResponses();
    await planThemes(input(), POOL_IDS, { client, promptCacheKey: "test" });

    // Dietary rides along as context for wording. `hardFilterReason` is the
    // law and it runs after; a prompt that asked the model to enforce it would
    // turn a rule into a suggestion.
    const system = client.requests[0].input[0].content as string;
    expect(system).not.toMatch(/dietary|vegetarian|budget/i);
  });
});

describe("validateThemes", () => {
  const answer = (themes: unknown[]) => ({ themes }) as never;

  it("refuses two days anchored on the same place", () => {
    const { themes, rejected } = validateThemes(
      answer([
        theme(1, "north-0"),
        theme(2, "north-0"),
      ]),
      input(),
      POOL_IDS,
    );
    // Two days built on one place is one day twice.
    expect(themes.map((t) => t.dayIndex)).toEqual([0]);
    expect(rejected[0].reason).toMatch(/already anchored/);
  });

  it("refuses a day the model simply skipped", () => {
    const { themes, rejected } = validateThemes(answer([theme(2, "south-0")]), input(), POOL_IDS);
    expect(themes.map((t) => t.dayIndex)).toEqual([1]);
    expect(rejected).toEqual([
      { dayIndex: 0, reason: "no theme was proposed for this day" },
    ]);
  });

  it("keeps themes in day order however the model ordered them", () => {
    const { themes } = validateThemes(
      answer([theme(2, "south-0"), theme(1, "north-0")]),
      input(),
      POOL_IDS,
    );
    expect(themes.map((t) => t.dayIndex)).toEqual([0, 1]);
  });

  it("deduplicates the types it was handed", () => {
    const { themes } = validateThemes(
      answer([{ ...theme(1, "north-0"), included_types: ["cafe", "cafe", " cafe ", "museum"] }]),
      input(),
      POOL_IDS,
    );
    expect(themes[0].includedTypes).toEqual(["cafe", "museum"]);
  });
});

function theme(day: number, anchor: string) {
  return {
    day,
    title: `Day ${day}`,
    premise: "A day around one thing.",
    anchor_place_id: anchor,
    included_types: ["cafe"],
    radius_hint: "walkable" as const,
  };
}
