/**
 * Enumerate every possible answer set and report what the quiz can actually
 * produce: which archetypes are reachable, how the answer sets divide between
 * them, the range each axis covers, and how many travellers read neutral on
 * all four planner bands.
 *
 * 3 options x 12 questions = 531,441 answer sets, so this is exhaustive rather
 * than sampled. It is a script and not a test because a full sweep takes about
 * a minute; the cheap version that runs on every commit is
 * `src/lib/persona/reachability.test.ts`.
 *
 *   npm run personas:reach
 */

import { ARCHETYPES, QUESTIONS, calculatePersona } from "../src/lib/persona/quiz.ts";
import type { DimensionKey, TravelArchetypeId } from "../src/lib/persona/types.ts";

const AXES: DimensionKey[] = ["structure", "comfort", "focus", "social"];
const LOW_MAX = 33;
const MID_MAX = 66;

function band(value: number): 0 | 1 | 2 {
  if (value <= LOW_MAX) return 0;
  if (value <= MID_MAX) return 1;
  return 2;
}

function main() {
  const questionCount = QUESTIONS.length;
  const total = 3 ** questionCount;

  const counts = new Map<TravelArchetypeId, number>();
  const witness = new Map<TravelArchetypeId, number[]>();
  const range = new Map<DimensionKey, { min: number; max: number }>(
    AXES.map((axis) => [axis, { min: Infinity, max: -Infinity }]),
  );
  const bandCombos = new Map<string, number>();
  let allNeutral = 0;

  const answers = new Array<number>(questionCount).fill(0);
  for (let n = 0; n < total; n += 1) {
    let rest = n;
    for (let q = 0; q < questionCount; q += 1) {
      answers[q] = rest % 3;
      rest = Math.floor(rest / 3);
    }

    const result = calculatePersona(answers);
    const id = result.archetype.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!witness.has(id)) witness.set(id, [...answers]);

    for (const axis of AXES) {
      const seen = range.get(axis)!;
      const value = result.dimensions[axis];
      if (value < seen.min) seen.min = value;
      if (value > seen.max) seen.max = value;
    }

    const combo = AXES.map((axis) => band(result.dimensions[axis])).join("");
    bandCombos.set(combo, (bandCombos.get(combo) ?? 0) + 1);
    if (combo === "1111") allNeutral += 1;
  }

  const pct = (n: number) => `${((n / total) * 100).toFixed(2)}%`;

  console.log(`answer sets: ${total.toLocaleString()}`);
  console.log(`\nreachable archetypes: ${counts.size} of ${ARCHETYPES.length}`);
  for (const archetype of [...ARCHETYPES].sort(
    (a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0),
  )) {
    const n = counts.get(archetype.id) ?? 0;
    const flag = n === 0 ? "  UNREACHABLE" : "";
    console.log(
      `  ${archetype.id.padEnd(22)} ${String(n).padStart(7)}  ${pct(n).padStart(7)}${flag}`,
    );
  }

  console.log("\nper-axis reachable range:");
  for (const axis of AXES) {
    const seen = range.get(axis)!;
    console.log(`  ${axis.padEnd(10)} ${seen.min}..${seen.max}`);
  }

  console.log(`\nband combinations reached: ${bandCombos.size} of 81`);
  for (const [combo, n] of [...bandCombos].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${combo}  ${String(n).padStart(7)}  ${pct(n).padStart(7)}`);
  }
  console.log(`\nall four bands neutral: ${allNeutral.toLocaleString()} (${pct(allNeutral)})`);

  console.log("\nwitness answer sets (first found, question order):");
  for (const archetype of ARCHETYPES) {
    const found = witness.get(archetype.id);
    console.log(`  ${archetype.id.padEnd(22)} ${found ? JSON.stringify(found) : "none"}`);
  }
}

main();
