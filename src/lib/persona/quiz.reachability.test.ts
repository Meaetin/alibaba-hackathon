/**
 * The property this quiz lost once and nothing noticed: **every archetype has
 * to be something a person can actually get.**
 *
 * Seven of the twelve were unreachable — no combination of twelve answers
 * matched them — while 99% of answer sets landed on two. Every test in the
 * suite was green, because each one asserted a *specific* answer set produced a
 * *specific* archetype, and there is no such assertion for an archetype nobody
 * can reach. The same silence hid the planner half: 94% of answer sets read
 * `mid` on all four of the bands `knobs.ts` cuts at 33 and 66, which is the row
 * that returns this planner's plain defaults.
 *
 * ## Why witnesses rather than enumeration
 *
 * The honest check is all 3^12 = 531,441 answer sets, and that takes about a
 * minute — too slow for `npm test`. It lives in `scripts/persona-reachability.ts`
 * (`npm run personas:reach`) and prints the full picture. What runs here is the
 * cheap half: one **witness** answer set per archetype, taken from that sweep
 * and frozen, asserted to still match. Twelve calls instead of half a million.
 *
 * A witness is weaker than enumeration in one specific way and it is worth
 * being clear about it: a change that made an archetype reachable by *only*
 * this witness would still pass. It is strong on the failure that actually
 * happened, which is an archetype's cell emptying out entirely. When a witness
 * goes red, re-run the sweep rather than editing the array — a witness that no
 * longer matches is either a scoring change worth re-measuring or an archetype
 * that has just gone dark.
 *
 * The distribution half is checked on a **stride sample** of the same
 * enumeration: every 101st answer set, which is deterministic, needs no seeded
 * rng, and takes milliseconds. 101 is coprime with 3, so the stride does not
 * lock onto any question's option.
 */

import { describe, expect, it } from "vitest";

import { ARCHETYPES, QUESTIONS, calculatePersona, scoreAnswers } from "./quiz";
import type { DimensionKey, QuizAnswers, TravelArchetypeId } from "./types";

/**
 * One answer set per archetype, in question order, from the first hit of a full
 * sweep. Regenerate with `npm run personas:reach`, which prints this list.
 */
const WITNESSES: Record<TravelArchetypeId, number[]> = {
  master_planner: [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0],
  spontaneous_wanderer: [2, 1, 2, 2, 0, 1, 0, 0, 1, 0, 0, 0],
  cultural_diver: [2, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0],
  thrill_seeker: [0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  comfort_cruiser: [2, 0, 0, 0, 2, 2, 0, 0, 0, 0, 0, 0],
  culinary_nomad: [0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  soulful_soloist: [2, 1, 0, 1, 1, 2, 0, 0, 0, 0, 0, 0],
  social_explorer: [2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  nature_pilgrim: [2, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0, 0],
  bucket_list_chaser: [2, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0],
  slow_immersionist: [2, 1, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0],
  weekend_warrior: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

const AXES: DimensionKey[] = ["structure", "comfort", "focus", "social"];

/** The same cuts `bandsOf` in `src/lib/planner/knobs.ts` applies. */
function band(value: number): 0 | 1 | 2 {
  if (value <= 33) return 0;
  if (value <= 66) return 1;
  return 2;
}

/** Every 101st answer set of the full enumeration, in base-3 question order. */
function strideSample(stride: number): QuizAnswers[] {
  const total = 3 ** QUESTIONS.length;
  const sample: QuizAnswers[] = [];
  for (let n = 0; n < total; n += stride) {
    const answers: number[] = [];
    let rest = n;
    for (let q = 0; q < QUESTIONS.length; q += 1) {
      answers.push(rest % 3);
      rest = Math.floor(rest / 3);
    }
    sample.push(answers);
  }
  return sample;
}

describe("archetype reachability", () => {
  it("has a witness answer set for every archetype", () => {
    expect(Object.keys(WITNESSES).sort()).toEqual(ARCHETYPES.map((a) => a.id).sort());
  });

  it.each(ARCHETYPES.map((a) => a.id))("%s is still reachable", (id) => {
    expect(calculatePersona(WITNESSES[id]).archetype.id).toBe(id);
  });

  it("every witness is a valid, complete answer set", () => {
    for (const [id, answers] of Object.entries(WITNESSES)) {
      expect(answers, id).toHaveLength(QUESTIONS.length);
      answers.forEach((option, index) => {
        expect(option, `${id} question ${index + 1}`).toBeLessThan(
          QUESTIONS[index].options.length,
        );
      });
    }
  });
});

describe("axis and band coverage", () => {
  const sample = strideSample(101);

  it("samples enough of the space to say anything", () => {
    expect(sample.length).toBeGreaterThan(4000);
  });

  it.each(AXES)("%s reaches all three bands", (axis) => {
    const seen = new Set(sample.map((answers) => band(scoreAnswers(answers)[axis])));
    expect([...seen].sort()).toEqual([0, 1, 2]);
  });

  it("does not collapse most travellers onto the neutral band row", () => {
    // The neutral row is the one `resolvePlannerKnobs` answers with today's
    // constants, so a traveller who lands there got nothing from the quiz.
    // Measured over the full 531,441 by `npm run personas:reach`: 1.48%.
    const neutral = sample.filter((answers) => {
      const scores = scoreAnswers(answers);
      return AXES.every((axis) => band(scores[axis]) === 1);
    }).length;
    expect(neutral / sample.length).toBeLessThan(0.05);
  });

  it("spreads across archetypes rather than piling onto two", () => {
    const counts = new Map<TravelArchetypeId, number>();
    for (const answers of sample) {
      const id = calculatePersona(answers).archetype.id;
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.size).toBe(ARCHETYPES.length);
    // Before: two archetypes held 99.1% between them.
    const biggest = Math.max(...counts.values()) / sample.length;
    expect(biggest).toBeLessThan(0.25);
  });
});
