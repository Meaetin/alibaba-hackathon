/**
 * Reads `scripts/output/persona-trips.json` and answers one question: did the
 * persona change the trip?
 *
 * Separate from the runner so it can be re-read, re-shaped and argued with
 * without re-planning seven itineraries at full price. The runner writes
 * everything it saw; this file decides what is worth looking at.
 *
 * ## The number that matters is the overlap matrix
 *
 * Everything else here is context. If two travellers who answered the quiz
 * completely differently come back sharing most of their stops, then the
 * persona is decorative — it changed the prose and not the trip. The matrix
 * prints shared-stop percentages for every pair, so that is visible at a
 * glance rather than inferred from reading fourteen day plans.
 *
 * ## Why knobs are diffed against the default rather than printed whole
 *
 * `resolvePlannerKnobs` returns today's constants for a neutral persona, so a
 * knob table printed in full is mostly noise that is identical down every
 * column. Printing only what moved is the same information with the answer
 * already extracted.
 *
 * Usage:  npm run personas:report
 */

import { readFile } from "node:fs/promises";

import { DEFAULT_KNOBS } from "@/lib/planner/knobs";

interface Stop {
  name: string | null;
  role: string;
  placeId: string | null;
  locationId: string | null;
  startMin: number;
  endMin: number;
  score: number | null;
  primaryType: string | null;
  types: string[] | null;
  rating: number | null;
  userRatingCount: number | null;
  priceLevel: number | null;
  whyForYou: string | null;
  travelToNext: { meters?: number; mode?: string } | null;
}

interface Entry {
  traveller: { key: string; name: string; note: string; form: { dietary: string[]; pace: string } };
  itineraryId?: string;
  archetype?: string;
  confidence?: number;
  bands?: string;
  profile?: { interests: string[]; budget?: number; pace: string; typeAffinities?: Record<string, number> };
  /** `itineraries.profile` — what the pipeline planned from. Beats `profile`. */
  storedProfile?: { interests: string[]; budget?: number; pace: string };
  knobs?: Record<string, unknown>;
  brief?: Record<string, string>;
  stats?: Record<string, unknown>;
  days?: Array<{ dayIndex: number; areaName: string | null; stops: Stop[] }>;
  failed?: string;
  error?: string;
}

const mean = (values: number[]): number | null =>
  values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;

const show = (value: number | null, digits = 1) => (value === null ? "  —  " : value.toFixed(digits));

/** Every stop across every day, in order. */
const stopsOf = (entry: Entry): Stop[] => (entry.days ?? []).flatMap((day) => day.stops);

/** Google types that make a stop a place you eat at. Matches `isRestaurant`'s
 *  intent without importing it — this is a report, not a scoring decision. */
const EATING = /restaurant|cafe|coffee_shop|food_court|bakery|bar|meal_/;
const isEating = (stop: Stop) =>
  (stop.types ?? []).some((type) => EATING.test(type)) || EATING.test(stop.primaryType ?? "");

function knobDiff(knobs: Record<string, unknown> | undefined): string[] {
  if (!knobs) return [];
  const moved: string[] = [];
  for (const [key, value] of Object.entries(knobs)) {
    const base = (DEFAULT_KNOBS as Record<string, unknown>)[key];
    if (JSON.stringify(base) !== JSON.stringify(value)) {
      moved.push(`${key}: ${JSON.stringify(base)} → ${JSON.stringify(value)}`);
    }
  }
  return moved;
}

async function main() {
  const path = new URL("./output/persona-trips.json", import.meta.url);
  const entries = JSON.parse(await readFile(path, "utf8")) as Entry[];

  console.log("=".repeat(78));
  console.log("PER TRAVELLER");
  console.log("=".repeat(78));

  for (const entry of entries) {
    const { traveller } = entry;
    console.log(`\n${traveller.name}  (${traveller.key})`);
    console.log(`  ${traveller.note}`);
    if (entry.failed || entry.error) {
      console.log(`  DID NOT PLAN: ${entry.failed ?? entry.error}`);
      continue;
    }
    console.log(`  archetype ${entry.archetype} (confidence ${entry.confidence})`);
    console.log(`  bands     ${entry.bands}`);
    // The stored row, never the recomputed one: `itineraries.profile` is what
    // the pipeline actually planned from, and a profile rebuilt here can differ
    // if the rebuild is missing an argument. It was, once.
    const used = entry.storedProfile ?? entry.profile;
    console.log(
      `  profile   interests [${used?.interests.join(", ")}]` +
        `  budget ${used?.budget ?? "—"}  pace ${used?.pace}   (from the stored row)`,
    );

    const moved = knobDiff(entry.knobs);
    if (moved.length === 0) {
      console.log("  knobs     none — identical to a traveller who never took the quiz");
    } else {
      console.log(`  knobs     ${moved.length} moved:`);
      for (const line of moved) console.log(`              ${line}`);
    }

    const stops = stopsOf(entry);
    const eating = stops.filter(isEating);
    console.log(
      `  trip      ${stops.length} stops over ${entry.days?.length} days` +
        `, ${eating.length} of them somewhere to eat`,
    );
    console.log(
      `            avg rating ${show(mean(stops.map((s) => s.rating).filter((r): r is number => r !== null)), 2)}` +
        `  avg reviews ${show(mean(stops.map((s) => s.userRatingCount).filter((n): n is number => n !== null)), 0)}` +
        `  avg price level ${show(mean(stops.map((s) => s.priceLevel).filter((p): p is number => p !== null)), 2)}`,
    );
    const meters = stops.reduce((sum, s) => sum + (s.travelToNext?.meters ?? 0), 0);
    console.log(`            ${(meters / 1000).toFixed(1)} km of travel between stops`);

    const missingLocation = stops.filter((s) => s.locationId === null).length;
    if (missingLocation > 0) {
      console.log(`            ${missingLocation} stops have no location row — that is a bug, not a preference`);
    }

    for (const day of entry.days ?? []) {
      console.log(`  day ${day.dayIndex}  ${day.areaName ?? "(no area)"}`);
      for (const stop of day.stops) {
        console.log(`            ${stop.role.padEnd(9)} ${stop.name ?? "(unnamed)"}`);
      }
    }
  }

  // ── the overlap matrix ─────────────────────────────────────────────────────

  const planned = entries.filter((e) => !e.failed && !e.error && (e.days?.length ?? 0) > 0);
  const ids = planned.map((e) => new Set(stopsOf(e).map((s) => s.placeId).filter(Boolean)));

  console.log(`\n${"=".repeat(78)}`);
  console.log("SHARED STOPS — what fraction of the smaller trip the two have in common");
  console.log("=".repeat(78));
  const width = 16;
  console.log(
    "".padEnd(width) + planned.map((e) => e.traveller.key.slice(0, 8).padStart(9)).join(""),
  );
  for (let row = 0; row < planned.length; row += 1) {
    const cells = planned.map((_, col) => {
      if (row === col) return "        —";
      const shared = [...ids[row]].filter((id) => ids[col].has(id)).length;
      const smaller = Math.min(ids[row].size, ids[col].size) || 1;
      return `${((shared / smaller) * 100).toFixed(0)}%`.padStart(9);
    });
    console.log(planned[row].traveller.key.slice(0, width).padEnd(width) + cells.join(""));
  }

  const everyone = [...ids.reduce((acc, set) => new Set([...acc].filter((id) => set.has(id))))];
  const union = new Set(ids.flatMap((set) => [...set]));
  console.log(`\n  ${union.size} distinct places across all ${planned.length} trips.`);
  console.log(`  ${everyone.length} of them appear in every single trip.`);
}

main().catch((error) => {
  console.error("could not build the report", error);
  process.exitCode = 1;
});
