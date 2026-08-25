import { describe, expect, it } from "vitest";

import { ARCHETYPES } from "./quiz";
import { ARCHETYPE_PRESETS } from "./presets";
import {
  buildProfile,
  deriveBudget,
  deriveInterests,
  derivePace,
  getFocusScoringAdjustments,
  getSocialSchedulingRules,
  type TripInputs,
} from "./profile";
import type { DimensionScores, PersonaResult, TravelArchetypeId } from "./types";

function persona(
  id: TravelArchetypeId,
  dims: Partial<DimensionScores> = {},
): PersonaResult {
  const archetype = ARCHETYPES.find((a) => a.id === id)!;
  return {
    dimensions: { structure: 50, comfort: 50, focus: 50, social: 50, ...dims },
    archetype,
    secondaryArchetype: ARCHETYPES.find((a) => a.id !== id)!,
    confidence: 0.9,
  };
}

const trip: TripInputs = { city: "Kyoto", totalDays: 4, dietary: ["vegetarian"] };

describe("presets", () => {
  it("covers all 12 archetypes with non-empty tags, affinities and prompts", () => {
    for (const archetype of ARCHETYPES) {
      const preset = ARCHETYPE_PRESETS[archetype.id];
      expect(preset.tags.length).toBeGreaterThan(0);
      expect(Object.keys(preset.typeAffinities).length).toBeGreaterThan(0);
      expect(Object.values(preset.typeAffinities).every((w) => w > 0)).toBe(true);
      expect(preset.passBPromptInject.length).toBeGreaterThan(0);
      expect(preset.passCNarrationNote.length).toBeGreaterThan(0);
    }
  });
});

describe("derivePace", () => {
  it("maps d1 thresholds", () => {
    expect(derivePace(persona("master_planner", { structure: 10 }))).toBe("packed");
    expect(derivePace(persona("cultural_diver", { structure: 50 }))).toBe("balanced");
    expect(derivePace(persona("spontaneous_wanderer", { structure: 90 }))).toBe("relaxed");
  });

  it("forces packed for identity archetypes regardless of d1", () => {
    expect(derivePace(persona("weekend_warrior", { structure: 90 }))).toBe("packed");
    expect(derivePace(persona("bucket_list_chaser", { structure: 90 }))).toBe("packed");
  });
});

describe("deriveBudget", () => {
  it("maps d2 thresholds (luxury-first → higher tier)", () => {
    expect(deriveBudget(persona("comfort_cruiser", { comfort: 10 }))).toBe(4);
    expect(deriveBudget(persona("master_planner", { comfort: 30 }))).toBe(3);
    expect(deriveBudget(persona("cultural_diver", { comfort: 50 }))).toBe(2);
    expect(deriveBudget(persona("thrill_seeker", { comfort: 80 }))).toBe(1);
  });
});

describe("focus adjustments", () => {
  it("high d3 boosts quality and penalizes traps", () => {
    const adj = getFocusScoringAdjustments(persona("cultural_diver", { focus: 90 }));
    expect(adj.qualityWeight).toBe(0.45);
    expect(adj.touristTrapPenalty).toBe(0.15);
    expect(adj.visitDurationBias).toBe("max");
  });

  it("low d3 boosts popularity and shortens stays", () => {
    const adj = getFocusScoringAdjustments(persona("bucket_list_chaser", { focus: 20 }));
    expect(adj.popularityWeight).toBe(0.25);
    expect(adj.touristTrapPenalty).toBe(0);
    expect(adj.visitDurationBias).toBe("min");
  });
});

describe("social rules", () => {
  it("low d4 requires evenings and packed crowds", () => {
    const rules = getSocialSchedulingRules(persona("social_explorer", { social: 10 }));
    expect(rules.eveningActivityRequired).toBe(true);
    expect(rules.minSocialVenuesPerDay).toBe(2);
    expect(rules.crowdPreference).toBe("packed");
  });

  it("high d4 allows solitude and prefers quiet", () => {
    const rules = getSocialSchedulingRules(persona("soulful_soloist", { social: 90 }));
    expect(rules.allowSolitudeSlots).toBe(true);
    expect(rules.preferQuietPlaces).toBe(true);
    expect(rules.crowdPreference).toBe("quiet");
  });
});

describe("buildProfile", () => {
  it("keeps dietary from the form and copies preset affinities", () => {
    const profile = buildProfile(persona("culinary_nomad"), trip);
    expect(profile.dietary).toEqual(["vegetarian"]);
    expect(profile.typeAffinities).toEqual(ARCHETYPE_PRESETS.culinary_nomad.typeAffinities);
    // Copy, not reference — mutating the profile must not leak into the preset.
    profile.typeAffinities!.restaurant = 9;
    expect(ARCHETYPE_PRESETS.culinary_nomad.typeAffinities.restaurant).toBe(1.5);
  });

  it("derives interests from preset tags within the planner union", () => {
    const profile = buildProfile(persona("culinary_nomad"), trip);
    expect(profile.interests).toContain("food");
    expect(profile.interests).toContain("cafes");
    const nature = buildProfile(persona("nature_pilgrim"), trip);
    expect(nature.interests).toEqual(["outdoors"]);
  });

  it("form budget wins over the persona fallback", () => {
    const fallback = buildProfile(persona("thrill_seeker", { comfort: 80 }), trip);
    expect(fallback.budget).toBe(1);
    const override = buildProfile(persona("thrill_seeker", { comfort: 80 }), {
      ...trip,
      budget: 4,
    });
    expect(override.budget).toBe(4);
  });

  it("interest overrides replace the persona-derived set", () => {
    const profile = buildProfile(persona("culinary_nomad"), {
      ...trip,
      interestOverrides: ["nightlife"],
    });
    expect(profile.interests).toEqual(["nightlife"]);
  });
});
