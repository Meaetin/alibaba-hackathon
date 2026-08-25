import { describe, expect, it } from "vitest";

import { ARCHETYPES, QUESTIONS, matchArchetype } from "@/lib/persona/quiz";
import type { DimensionScores, QuizAnswers } from "@/lib/persona/types";

import {
  SIGNAL_QUESTIONS,
  buildPersonaBrief,
  renderPersonaBrief,
  type PersonaBrief,
} from "./persona-brief";

const MIDDLING: DimensionScores = { structure: 50, comfort: 50, focus: 50, social: 50 };

function briefFor(dimensions: DimensionScores, answers?: QuizAnswers): PersonaBrief {
  return buildPersonaBrief(matchArchetype(dimensions), answers);
}

describe("SIGNAL_QUESTIONS", () => {
  it("still points at the questions it was written for", () => {
    // A question inserted above one of these would shift every signal onto the
    // wrong axis and still read perfectly well — the accommodation fragment
    // under the culture axis is a sentence, not an error. The label is the pin.
    for (const [axis, signal] of Object.entries(SIGNAL_QUESTIONS)) {
      expect(QUESTIONS[signal.index]?.label, axis).toBe(signal.label);
    }
  });

  it("has one fragment per option of its question", () => {
    for (const [axis, signal] of Object.entries(SIGNAL_QUESTIONS)) {
      expect(signal.fragments.length, axis).toBe(QUESTIONS[signal.index].options.length);
    }
  });
});

describe("buildPersonaBrief", () => {
  it("always says four things about how to build a day", () => {
    for (const archetype of ARCHETYPES) {
      expect(buildPersonaBrief(matchArchetype(archetype.center)).traits, archetype.id).toHaveLength(
        4,
      );
    }
  });

  it("says one thing per axis about what they answered, and nothing without answers", () => {
    const answers: QuizAnswers = Array(QUESTIONS.length).fill(0);
    expect(briefFor(MIDDLING, answers).signals).toHaveLength(4);
    expect(briefFor(MIDDLING).signals).toEqual([]);
  });

  it("stays silent on an unanswered diagnostic question", () => {
    // The middle option is itself a position; skipping the question is not.
    const answers: QuizAnswers = Array(QUESTIONS.length).fill(0);
    answers[SIGNAL_QUESTIONS.immersion.index] = null;
    expect(briefFor(MIDDLING, answers).signals).toHaveLength(3);
  });

  it("writes instructions to the planner, never descriptions of the person", () => {
    // The rule the whole module turns on. A clause opening "This traveller"
    // is a character sketch, and a model handed adjectives returns adjectives.
    const answers: QuizAnswers = Array(QUESTIONS.length).fill(1);
    for (const archetype of ARCHETYPES) {
      const brief = buildPersonaBrief(matchArchetype(archetype.center), answers);
      for (const clause of [...brief.traits, ...brief.avoid]) {
        expect(clause, `${archetype.id}: ${clause}`).not.toMatch(
          /^(This traveller|They are|The traveller is)/i,
        );
        expect(clause.trim().length, clause).toBeGreaterThan(0);
      }
    }
  });

  it("keeps negatives to three at most, and only from low bands", () => {
    const everythingLow: DimensionScores = { structure: 5, comfort: 5, focus: 5, social: 5 };
    const everythingHigh: DimensionScores = {
      structure: 95,
      comfort: 95,
      focus: 95,
      social: 95,
    };
    expect(briefFor(everythingLow).avoid).toHaveLength(3);
    expect(briefFor(everythingHigh).avoid).toEqual([]);
    expect(briefFor(MIDDLING).avoid).toEqual([]);
  });

  it("never carries a hard constraint", () => {
    // `avoid` is preferences. Dietary and budget are law, they live in
    // `hardFilterReason`, and they run after any model has spoken. A negative
    // here that mentioned one would turn a rule into a suggestion.
    const answers: QuizAnswers = Array(QUESTIONS.length).fill(0);
    for (const archetype of ARCHETYPES) {
      const brief = buildPersonaBrief(matchArchetype(archetype.center), answers);
      const everything = [...brief.traits, ...brief.signals, ...brief.avoid].join(" ");
      expect(everything, archetype.id).not.toMatch(/vegan|vegetarian|halal|budget|price level/i);
    }
  });
});

describe("the twelve archetypes, rendered", () => {
  it("matches the golden briefs", () => {
    // Read this snapshot by eye when it moves. It is the only place the twelve
    // personalities are visible side by side as the words a model will act on.
    const golden = Object.fromEntries(
      ARCHETYPES.map((archetype) => [
        archetype.id,
        buildPersonaBrief(matchArchetype(archetype.center)),
      ]),
    );
    expect(golden).toMatchSnapshot();
  });

  it("does not collapse two archetypes into the same day-building instructions", () => {
    // If two archetypes produce identical traits, the brief is discarding
    // information the quiz collected — twelve questions spent to say one of a
    // smaller number of things. Ten of the twelve differ today.
    const traits = ARCHETYPES.map((archetype) =>
      buildPersonaBrief(matchArchetype(archetype.center)).traits.join("|"),
    );
    expect(new Set(traits).size).toBeGreaterThanOrEqual(9);
  });
});

describe("renderPersonaBrief", () => {
  const answers: QuizAnswers = Array(QUESTIONS.length).fill(0);
  const brief = briefFor({ structure: 10, comfort: 10, focus: 10, social: 10 }, answers);

  it("gives the theme pass everything, because it is inventing the premise", () => {
    const text = renderPersonaBrief(brief, "theme");
    expect(text).toContain("traveller_archetype:");
    expect(text).toContain("how_to_build_their_days:");
    expect(text).toContain("what_they_told_us:");
    expect(text).toContain("avoid:");
  });

  it("gives the slot chooser instructions and negatives, not voice", () => {
    const text = renderPersonaBrief(brief, "assign");
    expect(text).toContain("how_to_build_their_days:");
    expect(text).toContain("avoid:");
    expect(text).not.toContain("what_they_told_us:");
    expect(text).not.toContain("traveller_archetype:");
  });

  it("gives the narrator voice, not negatives", () => {
    const text = renderPersonaBrief(brief, "narrate");
    expect(text).toContain("traveller_archetype:");
    expect(text).toContain("what_they_told_us:");
    expect(text).not.toContain("avoid:");
  });

  it("labels overall position and stated answers separately", () => {
    // They are allowed to disagree — "spreadsheet time" while landing
    // `flexible` means "generally easy, but wants day one pinned down" — and a
    // model can only hold both if they arrive under different headings.
    const disagreeing = briefFor(MIDDLING, answers);
    const text = renderPersonaBrief(disagreeing, "theme");
    expect(text.indexOf("how_to_build_their_days:")).toBeLessThan(
      text.indexOf("what_they_told_us:"),
    );
  });

  it("renders nothing at all for a traveller with no persona", () => {
    // Byte-identical to the prompt this planner sent before personas existed,
    // which is what keeps the prompt cache and the Gate A snapshots still.
    expect(renderPersonaBrief(undefined, "narrate")).toBe("");
    expect(renderPersonaBrief(undefined, "theme")).toBe("");
  });
});
