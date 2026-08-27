import { describe, expect, it } from "vitest";

import { ARCHETYPES, QUESTIONS, calculatePersona } from "./quiz";
import { ARCHETYPE_PRESETS } from "./presets";
import {
  ANSWER_SIGNALS,
  buildProfile,
  deriveBudget,
  deriveInterests,
  derivePace,
  deriveTypeAffinities,
  type TripInputs,
} from "./profile";
import type { DimensionScores, PersonaResult, TravelArchetypeId } from "./types";

/**
 * An answer set written the way a person would describe it — by question label
 * and option title, the same pins `ANSWER_SIGNALS` uses. Everything unnamed
 * takes the middle option, which is the least opinionated thing available.
 */
function answersFor(picks: Array<[question: string, option: string]>): number[] {
  const answers: number[] = QUESTIONS.map(() => 1);
  for (const [label, title] of picks) {
    const index = QUESTIONS.findIndex((question) => question.label === label);
    if (index < 0) throw new Error(`no question labelled "${label}"`);
    const option = QUESTIONS[index].options.findIndex((o) => o.title === title);
    if (option < 0) throw new Error(`no option "${title}" on "${label}"`);
    answers[index] = option;
  }
  return answers;
}

/** The types this profile feels most strongly about, strongest first. */
function loudestTypes(affinities: Record<string, number>, count: number): string[] {
  return Object.entries(affinities)
    .sort((a, b) => Math.abs(b[1] - 1) - Math.abs(a[1] - 1))
    .slice(0, count)
    .map(([type]) => type);
}

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

  it("form pace wins over the persona fallback", () => {
    // The quiz's pace question feeds the spontaneity axis, so a wanderer who
    // wants full days reads as relaxed. When the modal asked, the modal wins.
    const wanderer = persona("spontaneous_wanderer", { structure: 90 });
    expect(buildProfile(wanderer, trip).pace).toBe("relaxed");
    expect(buildProfile(wanderer, { ...trip, pace: "packed" }).pace).toBe("packed");
  });

  it("interest overrides replace the persona-derived set", () => {
    const profile = buildProfile(persona("culinary_nomad"), {
      ...trip,
      interestOverrides: ["nightlife"],
    });
    expect(profile.interests).toEqual(["nightlife"]);
  });
});

describe("ANSWER_SIGNALS", () => {
  it("pins every signal to a question label and option title that exist", () => {
    for (const signal of ANSWER_SIGNALS) {
      const question = QUESTIONS.find((q) => q.label === signal.question);
      expect(question, `question "${signal.question}"`).toBeDefined();
      const option = question!.options.find((o) => o.title === signal.option);
      expect(option, `option "${signal.option}" on "${signal.question}"`).toBeDefined();
    }
  });

  it("names no answer twice", () => {
    const keys = ANSWER_SIGNALS.map((s) => `${s.question} ${s.option}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps type weights inside the range a preset uses", () => {
    for (const signal of ANSWER_SIGNALS) {
      for (const [type, weight] of Object.entries(signal.types ?? {})) {
        expect(weight, `${signal.option} / ${type}`).toBeGreaterThan(1);
        expect(weight, `${signal.option} / ${type}`).toBeLessThanOrEqual(1.5);
      }
    }
  });
});

describe("deriveInterests from the answers", () => {
  it("gives the outdoors traveller outdoors — the failure this fixes", () => {
    // The real answer set that came back as Orchard Road malls and art
    // galleries: an unmistakably outdoors person whose archetype's tag list
    // (cafes, street art, local markets, walking tours) contained no outdoors.
    const answers = answersFor([
      ["Trip Prep", "Just pack and go"],
      ["First Morning", "Find the wild side"],
      ["Accommodation", "Hostel, camp, or wherever"],
      ["Food", "Street food adventures"],
      ["Risk & Comfort", "Go immediately"],
      ["Memories", "An epic adventure"],
    ]);
    const result = calculatePersona(answers);

    // The archetype-only path still has the bug, which is what makes the
    // answers-first path worth having rather than a restatement of it.
    expect(deriveInterests(result)).not.toContain("outdoors");

    const interests = deriveInterests(result, answers);
    expect(interests[0]).toBe("outdoors");
    expect(interests).toContain("food");

    const types = loudestTypes(deriveTypeAffinities(result, answers), 5);
    expect(types).toContain("hiking_area");
    expect(types).toContain("park");
  });

  it("puts food first for a traveller who said food is the trip", () => {
    const answers = answersFor([
      ["Food", "The food IS the trip"],
      ["Culture", "Dive in completely"],
      ["First Morning", "Wander to a café"],
    ]);
    const result = calculatePersona(answers);
    const interests = deriveInterests(result, answers);
    expect(interests[0]).toBe("food");
    expect(interests).toContain("cafes");
    expect(loudestTypes(deriveTypeAffinities(result, answers), 6)).toContain("restaurant");
  });

  it("puts museums first for a traveller who chose landmarks and highlights", () => {
    const answers = answersFor([
      ["First Morning", "Hit the landmarks"],
      ["Culture", "Sample the highlights"],
      ["Food", "Fuel for the journey"],
    ]);
    const result = calculatePersona(answers);
    const interests = deriveInterests(result, answers);
    expect(interests[0]).toBe("museums");
    // Only one interest cleared the floor, so the archetype topped the list up
    // — but not with `food`, which this traveller turned down.
    expect(interests.length).toBeGreaterThanOrEqual(3);
    expect(interests).not.toContain("food");
  });

  it("reaches nightlife through the one answer that names it", () => {
    // The quiz never asks about evenings. Saying yes to the village festival is
    // the only answer that names anything nightlife-shaped, which is a gap in
    // the questions rather than in this derivation.
    const yes = answersFor([["Risk & Comfort", "Go immediately"]]);
    expect(deriveInterests(calculatePersona(yes), yes)).toContain("nightlife");

    const no = answersFor([["Risk & Comfort", "Politely decline"]]);
    expect(deriveInterests(calculatePersona(no), no)).not.toContain("nightlife");
  });

  it("falls back to the archetype's tags when there are no answers", () => {
    const result = calculatePersona(answersFor([["First Morning", "Find the wild side"]]));
    const preset = ARCHETYPE_PRESETS[result.archetype.id];
    expect(deriveInterests(result).length).toBeGreaterThan(0);
    expect(deriveTypeAffinities(result)).toEqual(preset.typeAffinities);
  });

  it("never returns more than the retrieval budget allows", () => {
    // Every interest bills its own text search and dilutes `affinity`, so the
    // list is capped however loudly the traveller answered.
    const answers = answersFor([
      ["First Morning", "Find the wild side"],
      ["Culture", "Dive in completely"],
      ["Food", "The food IS the trip"],
      ["Risk & Comfort", "Go immediately"],
      ["Memories", "An epic adventure"],
      ["Detours", "Chill about it"],
    ]);
    expect(deriveInterests(calculatePersona(answers), answers).length).toBeLessThanOrEqual(5);
  });
});

describe("buildProfile with answers", () => {
  it("layers the answers over the preset's type map, strongest opinion winning", () => {
    const answers = answersFor([["First Morning", "Find the wild side"]]);
    const result = calculatePersona(answers);
    const preset = ARCHETYPE_PRESETS[result.archetype.id];
    const profile = buildProfile(result, trip, answers);

    // Nothing the preset said is lost…
    for (const type of Object.keys(preset.typeAffinities)) {
      expect(profile.typeAffinities).toHaveProperty(type);
    }
    // …and the answer's own types are there at the answer's strength.
    expect(profile.typeAffinities!.hiking_area).toBe(1.45);
    expect(profile.typeAffinities).not.toBe(preset.typeAffinities);
  });

  it("still lets manual interest overrides replace everything", () => {
    const answers = answersFor([["First Morning", "Find the wild side"]]);
    const profile = buildProfile(
      calculatePersona(answers),
      { ...trip, interestOverrides: ["nightlife"] },
      answers,
    );
    expect(profile.interests).toEqual(["nightlife"]);
  });
});
