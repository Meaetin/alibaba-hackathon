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
  it("scores an answer set as its percentile on each axis", () => {
    // Every first option: spreadsheet time, landmarks, a great hotel, packed
    // days, group all the way. Near the bottom of spontaneity and of solitude,
    // above the middle on focus because "dive in completely" and "the food IS
    // the trip" are both first options.
    const allFirst = Array(12).fill(0);
    expect(scoreAnswers(allFirst)).toEqual({
      structure: 1,
      comfort: 28,
      focus: 57,
      social: 2,
    });
  });

  it("puts the extremes at the ends of each axis", () => {
    // The lowest and highest option per question per axis, which by definition
    // is the 0th and 100th percentile. Under the old averaging the widest any
    // axis ever got was social's 40..61.
    const lowest = QUESTIONS.map(
      (question) =>
        question.options.reduce(
          (best, option, index) =>
            option.scores.structure < question.options[best].scores.structure ? index : best,
          0,
        ),
    );
    expect(scoreAnswers(lowest).structure).toBe(0);

    const highest = QUESTIONS.map((question) =>
      question.options.reduce(
        (best, option, index) =>
          option.scores.structure > question.options[best].scores.structure ? index : best,
        0,
      ),
    );
    expect(scoreAnswers(highest).structure).toBe(100);
  });

  it("lets go of the axis as questions go unanswered", () => {
    // The most planner-leaning answer set there is, scoring 0 on structure.
    const lowest = QUESTIONS.map((question) =>
      question.options.reduce(
        (best, option, index) =>
          option.scores.structure < question.options[best].scores.structure ? index : best,
        0,
      ),
    );
    expect(scoreAnswers(lowest).structure).toBe(0);

    // An unanswered question contributes the middle of its *own* three options,
    // so each one blanked out stops pulling and the score drifts back inward.
    const halfBlank: (number | null)[] = [...lowest];
    for (let i = 0; i < 6; i += 1) halfBlank[i] = null;
    expect(scoreAnswers(halfBlank).structure).toBeGreaterThan(0);
    expect(scoreAnswers(halfBlank).structure).toBeLessThan(50);

    // Nothing answered at all is the middle of every axis — which is what the
    // absent-persona path in `knobs.ts` already assumes about a blank quiz.
    const blank = scoreAnswers(Array(12).fill(null));
    for (const value of Object.values(blank)) {
      expect(value).toBeGreaterThan(40);
      expect(value).toBeLessThan(60);
    }
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
    expect(["weekend_warrior", "master_planner", "bucket_list_chaser"]).toContain(
      result.archetype.id,
    );
  });

  it("maps a fully spontaneous answer sheet away from planner types", () => {
    const result = calculatePersona(Array(12).fill(2));
    expect(["spontaneous_wanderer", "slow_immersionist", "soulful_soloist", "nature_pilgrim"])
      .toContain(result.archetype.id);
  });
});
