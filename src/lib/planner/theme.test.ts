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
const VOCABULARY = {
  placeIds: new Set(POOL.map((p) => p.placeId)),
  types: new Set(POOL.flatMap((p) => p.types)),
};
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
    expect(radiusFor("walkable")).toBe(RADIUS_METERS.walkable);
  });

  it("orders the three hints, and depends on nothing else", () => {
    // It used to scale with `knobs.walkMaxMeters`, which meant a polished
    // traveller silently searched two-thirds of the city — three Nearby
    // Searches for three unique places on a live run. How far you will walk
    // between two stops is not how much map to look at.
    expect(radiusFor("tight")).toBeLessThan(radiusFor("walkable"));
    expect(radiusFor("walkable")).toBeLessThan(radiusFor("wide"));
  });
});

describe("planThemes", () => {
  it("names one day at a time, each anchored on a place we actually have", () => {
    // Handled below by the validator test; here the whole call is exercised.
    return planThemes(input(), VOCABULARY, {
      client: createFakeResponses(),
      promptCacheKey: "test",
    }).then((result) => {
      expect(result.unavailable).toBe(false);
      expect(result.themes).toHaveLength(2);
      expect(result.rejected).toEqual([]);
      for (const theme of result.themes) {
        expect(VOCABULARY.placeIds.has(theme.anchorPlaceId), theme.anchorPlaceId).toBe(true);
        expect(theme.premise.length).toBeGreaterThan(0);
      }
      expect(result.themes.map((t) => t.dayIndex)).toEqual([0, 1]);
    });
  });

  it("falls back to geography rather than throwing when the call dies", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await planThemes(input(), VOCABULARY, {
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
    const result = await planThemes(input(), VOCABULARY, {
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
    const result = await planThemes(input({ days: [] }), VOCABULARY, {
      client,
      promptCacheKey: "test",
    });
    expect(result.themes).toEqual([]);
    expect(client.requests).toHaveLength(0);
  });

  it("never asks the model to enforce a hard constraint", async () => {
    const client = createFakeResponses();
    await planThemes(input(), VOCABULARY, { client, promptCacheKey: "test" });

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
      VOCABULARY,
    );
    // Two days built on one place is one day twice.
    expect(themes.map((t) => t.dayIndex)).toEqual([0]);
    expect(rejected[0].reason).toMatch(/already anchored/);
  });

  it("refuses a day the model simply skipped", () => {
    const { themes, rejected } = validateThemes(answer([theme(2, "south-0")]), input(), VOCABULARY);
    expect(themes.map((t) => t.dayIndex)).toEqual([1]);
    expect(rejected).toEqual([
      { dayIndex: 0, reason: "no theme was proposed for this day" },
    ]);
  });

  it("keeps themes in day order however the model ordered them", () => {
    const { themes } = validateThemes(
      answer([theme(2, "south-0"), theme(1, "north-0")]),
      input(),
      VOCABULARY,
    );
    expect(themes.map((t) => t.dayIndex)).toEqual([0, 1]);
  });

  it("deduplicates the types it was handed", () => {
    const { themes } = validateThemes(
      answer([
        {
          ...theme(1, "north-0"),
          included_types: ["tourist_attraction", "tourist_attraction", " tourist_attraction "],
        },
      ]),
      input(),
      VOCABULARY,
    );
    expect(themes[0].includedTypes).toEqual(["tourist_attraction"]);
  });

  it("drops a type this city has no evidence of, rather than sending it", () => {
    const { themes, unknownTypes } = validateThemes(
      answer([
        { ...theme(1, "north-0"), included_types: ["tourist_attraction", "glassblowing_studio"] },
      ]),
      input(),
      VOCABULARY,
    );
    expect(themes[0].includedTypes).toEqual(["tourist_attraction"]);
    expect(unknownTypes).toEqual(["glassblowing_studio"]);
  });

  it("drops a type Google returns but will not search for", () => {
    // The bug two live Singapore runs found, and the reason "the pool has such
    // places" is necessary but not sufficient. `food` and `place_of_worship`
    // come back on real places; asking Google to filter on either is a 400 for
    // the *whole* circle, not a warning about one type.
    const withTableB = {
      placeIds: VOCABULARY.placeIds,
      types: new Set([...VOCABULARY.types, "food", "place_of_worship"]),
    };
    const { themes, unknownTypes } = validateThemes(
      answer([
        {
          ...theme(1, "north-0"),
          included_types: ["tourist_attraction", "food", "place_of_worship"],
        },
      ]),
      input(),
      withTableB,
    );
    expect(themes[0].includedTypes).toEqual(["tourist_attraction"]);
    expect(unknownTypes.sort()).toEqual(["food", "place_of_worship"]);
  });

  it("keeps the theme when every type it proposed was unknown", () => {
    // An empty list is a legal, weaker query — "whatever is around the anchor".
    // A 400 is not a weaker query, it is no query.
    const { themes, rejected } = validateThemes(
      answer([{ ...theme(1, "north-0"), included_types: ["food"] }]),
      input(),
      VOCABULARY,
    );
    // Day one keeps its premise; day two is missing because the answer never
    // named it, which is a different rejection and not what this pins.
    expect(themes.map((t) => t.dayIndex)).toEqual([0]);
    expect(rejected.map((r) => r.dayIndex)).toEqual([1]);
    expect(themes[0].includedTypes).toEqual([]);
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
