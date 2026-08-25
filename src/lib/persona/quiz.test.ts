import { describe, expect, it } from "vitest";

import {
  ARCHETYPES,
  QUESTIONS,
  calculatePersona,
  matchArchetype,
  scoreAnswers,
} from "./quiz";

describe("quiz data", () => {
  it("has 12 questions with 3 options each", () => {
    expect(QUESTIONS).toHaveLength(12);
    for (const question of QUESTIONS) {
      expect(question.options).toHaveLength(3);
    }
  });

  it("has 12 archetypes with unique ids and 0–100 centers", () => {
    expect(ARCHETYPES).toHaveLength(12);
    const ids = new Set(ARCHETYPES.map((a) => a.id));
    expect(ids.size).toBe(12);
    for (const archetype of ARCHETYPES) {
      for (const value of Object.values(archetype.center)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
      }
    }
  });
});

describe("scoreAnswers", () => {
  it("averages option vectors across questions", () => {
    const allFirst = Array(12).fill(0);
    expect(scoreAnswers(allFirst)).toEqual({
      structure: 28,
      comfort: 39,
      focus: 47,
      social: 43,
    });
  });
});

describe("matchArchetype", () => {
  it("matches the methodology doc's worked example", () => {
    // docs/travel-persona-quiz-methodology.md §4: {68,40,83,63} ≈ Slow Immersionist.
    const result = matchArchetype({
      structure: 68,
      comfort: 40,
      focus: 83,
      social: 63,
    });
    expect(result.archetype.id).toBe("slow_immersionist");
    expect(result.secondaryArchetype.id).not.toBe(result.archetype.id);
  });

  it("reports confidence in (0.5, 1]", () => {
    const result = matchArchetype({
      structure: 50,
      comfort: 50,
      focus: 50,
      social: 50,
    });
    expect(result.confidence).toBeGreaterThan(0.5);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });
});

describe("calculatePersona", () => {
  it("maps a fully planner-leaning answer sheet to a planner-family archetype", () => {
    const result = calculatePersona(Array(12).fill(0));
    expect(result.archetype.id).toBe("bucket_list_chaser");
  });

  it("maps a fully spontaneous answer sheet away from planner types", () => {
    const result = calculatePersona(Array(12).fill(2));
    expect(["spontaneous_wanderer", "slow_immersionist", "soulful_soloist", "nature_pilgrim"])
      .toContain(result.archetype.id);
  });
});
