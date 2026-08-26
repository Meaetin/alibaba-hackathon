import { describe, expect, it } from "vitest";

import { ARCHETYPES, matchArchetype } from "@/lib/persona/quiz";
import type { DimensionScores, PersonaResult } from "@/lib/persona/types";

import {
  BAND_WORDS,
  DEFAULT_KNOBS,
  NEUTRAL_BANDS,
  bandsOf,
  resolvePlannerKnobs,
  toPersonaAxes,
  type PersonaAxisKey,
} from "./knobs";
import { PACE_PLANS } from "./pack";
import type { Pace, PreferenceProfile } from "./types";

const PACES: readonly Pace[] = ["relaxed", "balanced", "packed"];

const PROFILE: PreferenceProfile = {
  interests: ["temples", "food"],
  dietary: [],
  pace: "balanced",
  budget: 2,
};

/** A persona sitting on one exact coordinate, for table-driven assertions. */
function personaAt(dimensions: DimensionScores): PersonaResult {
  return matchArchetype(dimensions);
}

const MIDDLING: DimensionScores = { structure: 50, comfort: 50, focus: 50, social: 50 };

describe("toPersonaAxes", () => {
  it("renames without reordering — every archetype centre survives the round trip", () => {
    // The whole reason this function exists: `structure: 90` means the *least*
    // structure and `comfort: 90` means tolerating the most discomfort, so a
    // future edit that swapped two lines here would invert an axis and nothing
    // downstream could tell. Twelve fixed points make that impossible.
    for (const archetype of ARCHETYPES) {
      const axes = toPersonaAxes(archetype.center);
      expect(axes.spontaneity, archetype.id).toBe(archetype.center.structure);
      expect(axes.comfortTolerance, archetype.id).toBe(archetype.center.comfort);
      expect(axes.immersion, archetype.id).toBe(archetype.center.focus);
      expect(axes.solitude, archetype.id).toBe(archetype.center.social);
    }
  });
});

describe("bandsOf", () => {
  it("cuts at 33 and 66 inclusive", () => {
    const at = (value: number) =>
      bandsOf({
        spontaneity: value,
        comfortTolerance: value,
        immersion: value,
        solitude: value,
      });

    expect(at(0).spontaneity).toBe("planned");
    expect(at(33).spontaneity).toBe("planned");
    expect(at(34).spontaneity).toBe("flexible");
    expect(at(66).spontaneity).toBe("flexible");
    expect(at(67).spontaneity).toBe("improvised");
    expect(at(100).spontaneity).toBe("improvised");
  });

  it("gives every axis its own vocabulary — a band word names one axis only", () => {
    const keys = Object.keys(BAND_WORDS) as PersonaAxisKey[];
    const words = keys.flatMap((key) => [...BAND_WORDS[key]]);
    expect(new Set(words).size).toBe(words.length);
  });

  it("reads a middling persona as the neutral row", () => {
    expect(bandsOf(toPersonaAxes(MIDDLING))).toEqual(NEUTRAL_BANDS);
  });
});

describe("resolvePlannerKnobs without a persona", () => {
  it("returns exactly what this planner did before personas existed", () => {
    // The requirement that lets the Gate A snapshots stay still. Field for
    // field, not "roughly the same".
    for (const pace of PACES) {
      const knobs = resolvePlannerKnobs({ ...PROFILE, pace }, undefined, pace);
      expect(knobs.weights, pace).toEqual(DEFAULT_KNOBS.weights);
      expect(knobs.touristTrapPenalty, pace).toBe(0);
      expect(knobs.serendipityPerTrip, pace).toBe(0);
      expect(knobs.serendipityMaxReviews, pace).toBe(500);
      expect(knobs.flexPerDay, pace).toBe(1);
      expect(knobs.priceFitPenalisesBelow, pace).toBe(false);
      expect(knobs.cheapTypeExemptions, pace).toEqual([]);
      expect(knobs.walkMaxMeters, pace).toBe(1200);
      expect(knobs.mealMinutes, pace).toBe(75);
      expect(knobs.crowdPreference, pace).toBeUndefined();
      expect(knobs.minSocialVenuesPerDay, pace).toBe(0);
      // Pace alone still decides visit length, exactly as `PACE_PLANS` says.
      expect(knobs.visitDurationBias, pace).toBe(PACE_PLANS[pace].durationBias);
    }
  });

  it("has nothing to widen when the traveller stated no budget", () => {
    const { budget: _budget, ...noBudget } = PROFILE;
    expect(resolvePlannerKnobs(noBudget, undefined, "balanced").budgetWidenSteps).toBe(0);
    expect(resolvePlannerKnobs(PROFILE, undefined, "balanced").budgetWidenSteps).toBe(3);
  });

  it("resolves a middling persona to the same knobs as no persona at all", () => {
    // One table, one rule. If these ever diverge there are two definitions of
    // "unopinionated" and only one of them is tested.
    for (const pace of PACES) {
      expect(resolvePlannerKnobs(PROFILE, personaAt(MIDDLING), pace)).toEqual(
        resolvePlannerKnobs(PROFILE, undefined, pace),
      );
    }
  });
});

describe("resolvePlannerKnobs collisions", () => {
  const slowImmersionist = personaAt({ structure: 85, comfort: 55, focus: 70, social: 60 });

  it("lets immersion own fame while spontaneity moves only the threshold", () => {
    // Collision 1. Both axes are high on this persona. Applied independently
    // they stack and the trip becomes fifteen places with forty reviews each.
    const knobs = resolvePlannerKnobs(PROFILE, slowImmersionist, "balanced");
    expect(knobs.touristTrapPenalty).toBe(0.15);
    expect(knobs.serendipityMaxReviews).toBe(1500);

    // Spontaneity alone must not reach the fame term at all.
    const spontaneousOnly = personaAt({ structure: 85, comfort: 50, focus: 50, social: 50 });
    expect(resolvePlannerKnobs(PROFILE, spontaneousOnly, "balanced").touristTrapPenalty).toBe(0);
  });

  it("lets comfort own the price curve and immersion only exempt types", () => {
    // Collision 2. Polished says don't send me to the hawker stall; deep says
    // the hawker stall is the point. Both are heard, neither overwrites.
    const polishedAndDeep = personaAt({ structure: 50, comfort: 15, focus: 90, social: 50 });
    const knobs = resolvePlannerKnobs(PROFILE, polishedAndDeep, "balanced");
    expect(knobs.priceFitPenalisesBelow).toBe(true);
    expect(knobs.cheapTypeExemptions).toContain("market");

    // And immersion never reshapes the curve on its own.
    const deepOnly = personaAt({ structure: 50, comfort: 50, focus: 90, social: 50 });
    expect(resolvePlannerKnobs(PROFILE, deepOnly, "balanced").priceFitPenalisesBelow).toBe(false);
  });

  it("lets pace beat spontaneity on minutes and spontaneity own openness", () => {
    // Collision 3. Someone who typed `packed` and scored 90 on spontaneity.
    const wanderer = personaAt({ structure: 90, comfort: 50, focus: 50, social: 50 });
    const knobs = resolvePlannerKnobs({ ...PROFILE, pace: "packed" }, wanderer, "packed");
    expect(knobs.visitDurationBias).toBe(PACE_PLANS.packed.durationBias);
    expect(knobs.flexPerDay).toBe(2);
  });

  it("lets immersion raise the visit bias one step, never lower it", () => {
    const deep = personaAt({ structure: 50, comfort: 50, focus: 90, social: 50 });
    const highlights = personaAt({ structure: 50, comfort: 50, focus: 10, social: 50 });

    // Raised: a packed day stays brisk, but the temple it was built around is
    // not visited at its floor.
    expect(resolvePlannerKnobs(PROFILE, deep, "packed").visitDurationBias).toBe("preferred");
    expect(resolvePlannerKnobs(PROFILE, deep, "balanced").visitDurationBias).toBe("max");
    // Never past the top of the scale.
    expect(resolvePlannerKnobs(PROFILE, deep, "relaxed").visitDurationBias).toBe("max");
    // And never lowered — a relaxed traveller who likes the famous things is
    // still relaxed.
    expect(resolvePlannerKnobs(PROFILE, highlights, "relaxed").visitDurationBias).toBe("max");
  });
});

describe("resolvePlannerKnobs weights", () => {
  it("always sums to one, whatever the table asks for", () => {
    // Table entries are intents, not fractions: `deep` asks for quality half
    // again as heavy and the resolver divides through. Without that the score
    // stops being comparable between two travellers.
    for (const archetype of ARCHETYPES) {
      const { weights } = resolvePlannerKnobs(PROFILE, personaAt(archetype.center), "balanced");
      const total =
        weights.affinity + weights.quality + weights.priceFit + weights.popularity;
      expect(total, archetype.id).toBeCloseTo(1, 10);
    }
  });

  it("gives the highlights traveller a real popularity term and the deep one none", () => {
    const highlights = personaAt({ structure: 50, comfort: 50, focus: 10, social: 50 });
    const deep = personaAt({ structure: 50, comfort: 50, focus: 90, social: 50 });

    expect(resolvePlannerKnobs(PROFILE, highlights, "balanced").weights.popularity).toBeGreaterThan(
      0,
    );
    expect(resolvePlannerKnobs(PROFILE, deep, "balanced").weights.popularity).toBe(0);
    // And quality carries more of the deep traveller's score than the
    // highlights traveller's, which is the point of the axis.
    expect(resolvePlannerKnobs(PROFILE, deep, "balanced").weights.quality).toBeGreaterThan(
      resolvePlannerKnobs(PROFILE, highlights, "balanced").weights.quality,
    );
  });
});

describe("the twelve archetypes are actually distinguishable", () => {
  it("does not resolve two archetypes to the same knobs", () => {
    // Not a strict requirement — two archetypes may legitimately share a band
    // row — but a *count* worth watching. If this collapses to two or three
    // distinct results, the quiz is collecting information the planner throws
    // away, and that is worth knowing before a demo rather than after. Ten of
    // the twelve resolve differently today; the floor is set one below so a
    // single table edit can move it without a red test, and a collapse cannot.
    const resolved = ARCHETYPES.map((archetype) =>
      JSON.stringify(resolvePlannerKnobs(PROFILE, personaAt(archetype.center), "balanced")),
    );
    expect(new Set(resolved).size).toBeGreaterThanOrEqual(9);
  });
});
