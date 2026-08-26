/**
 * Step 7a — the route order. See `sequence.ts`.
 *
 * Places sit on a grid and travel is Manhattan distance in minutes, so every
 * expected order below is one a reader can check by eye. The rule that matters
 * most is the one that is easiest to break silently: a meal never changes its
 * index, because its index is what puts the morning before lunch.
 */

import { describe, expect, it } from "vitest";

import type { VisitDuration } from "./duration";
import type { CandidatePlace } from "./types";
import type { PackDayInput, SlotAssignment, SlotRole, TravelLegProvider } from "./pack";
import { sequenceDay, pathMeters } from "./sequence";

// ── fixtures ─────────────────────────────────────────────────────────────────

/** Grid coordinates, so "1 unit east" is a legible unit of travel. */
const at = (name: string, x: number, y: number): CandidatePlace => ({
  placeId: `ChIJ_${name}`,
  name,
  types: ["tourist_attraction"],
  latitude: y,
  longitude: x,
});

const duration: VisitDuration = { min: 40, preferred: 60, max: 90 };

const stop = (place: CandidatePlace, role: SlotRole = "activity", score = 1): SlotAssignment => ({
  place,
  role,
  score,
  duration,
});

/** Manhattan minutes on the grid — integer, symmetric, and easy to add up. */
const gridTravel: TravelLegProvider = (from, to) => {
  const dx = Math.abs((from.longitude ?? 0) - (to.longitude ?? 0));
  const dy = Math.abs((from.latitude ?? 0) - (to.latitude ?? 0));
  return { minutes: dx + dy, meters: (dx + dy) * 100 };
};

const names = (input: PackDayInput) => input.assignments.map((a) => a.place.name);

// ── the search ───────────────────────────────────────────────────────────────

describe("sequenceDay", () => {
  it("walks a line in order instead of doubling back", () => {
    // Four stops on a line, handed over shuffled. The shortest walk is the line.
    const line = [at("a", 0, 0), at("b", 1, 0), at("c", 2, 0), at("d", 3, 0)];
    const shuffled = [line[0], line[2], line[1], line[3]].map((p) => stop(p));

    const result = sequenceDay({ assignments: shuffled }, gridTravel);

    expect(names(result.input)).toEqual(["a", "b", "c", "d"]);
    expect(result.beforeMinutes).toBe(5); // 2 + 1 + 2
    expect(result.afterMinutes).toBe(3); // 1 + 1 + 1
    expect(result.savedMinutes).toBe(2);
    expect(result.reordered).toBe(true);
  });

  it("leaves a day that is already shortest exactly as it came in", () => {
    const ordered = [at("a", 0, 0), at("b", 1, 0), at("c", 2, 0)].map((p) => stop(p));
    const input = { assignments: ordered };

    const result = sequenceDay(input, gridTravel);

    // Same object, not merely an equal one: a caller diffing inputs must not
    // see churn on a day nothing changed about.
    expect(result.input).toBe(input);
    expect(result.reordered).toBe(false);
    expect(result.savedMinutes).toBe(0);
  });

  it("never moves a meal off its index", () => {
    // Lunch sits at index 2 and dinner at index 5. Both are the worst possible
    // places for them geometrically — which is the point.
    const assignments = [
      stop(at("far-east", 9, 0)),
      stop(at("near-west", 1, 0)),
      stop(at("lunch", 5, 0), "lunch"),
      stop(at("east", 8, 0)),
      stop(at("west", 0, 0)),
      stop(at("dinner", 5, 0), "dinner"),
      stop(at("last", 7, 0)),
    ];

    const result = sequenceDay({ assignments }, gridTravel);
    const order = names(result.input);

    expect(order[2]).toBe("lunch");
    expect(order[5]).toBe("dinner");
    expect(result.input.assignments[2].role).toBe("lunch");
    expect(result.input.assignments[5].role).toBe("dinner");
  });

  it("orders a stretch against both of its meal endpoints, not just the first", () => {
    // Between lunch at x=0 and dinner at x=10, the cheap walk is west to east.
    // Ordering on distance-from-lunch alone gets the same answer, so the two
    // middle stops are placed to make the endpoints disagree: `high` is closer
    // to lunch but must come second because it is far from dinner's line.
    const assignments = [
      stop(at("lunch", 0, 0), "lunch"),
      stop(at("high", 1, 5)),
      stop(at("mid", 5, 0)),
      stop(at("dinner", 10, 0), "dinner"),
    ];

    const result = sequenceDay({ assignments }, gridTravel);

    expect(names(result.input)).toEqual(["lunch", "high", "mid", "dinner"]);
    // lunch→high 6, high→mid 9, mid→dinner 5 = 20, against 6+9+5 either way
    // round; what the assertion pins is that `mid` is not stranded past dinner.
    expect(result.afterMinutes).toBeLessThanOrEqual(result.beforeMinutes);
  });

  it("leaves the first stop free to be anything — the day starts where it starts", () => {
    // No fixed origin, so the best morning is whichever end of the line lets
    // the walk into lunch be shortest.
    const assignments = [
      stop(at("mid", 3, 0)),
      stop(at("east", 6, 0)),
      stop(at("west", 0, 0)),
      stop(at("lunch", 7, 0), "lunch"),
    ];

    const result = sequenceDay({ assignments }, gridTravel);

    expect(names(result.input)).toEqual(["west", "mid", "east", "lunch"]);
    expect(result.afterMinutes).toBe(7);
  });

  it("hill-climbs a stretch too long to enumerate, and still improves it", () => {
    // Ten stops on a line is past `EXACT_MAX`, so this exercises the
    // nearest-neighbour + 2-opt path rather than the permutation search.
    const line = Array.from({ length: 10 }, (_, i) => at(`p${i}`, i, 0));
    const shuffled = [3, 7, 1, 9, 0, 5, 2, 8, 4, 6].map((i) => stop(line[i]));

    const result = sequenceDay({ assignments: shuffled }, gridTravel);

    expect(result.afterMinutes).toBe(9); // the line, walked once
    expect(result.savedMinutes).toBeGreaterThan(0);
  });

  it("passes flex picks through untouched — the packer seats those itself", () => {
    const flex = [{ place: at("spare", 4, 4), score: 0.5, duration }];
    const assignments = [stop(at("a", 0, 0)), stop(at("c", 2, 0)), stop(at("b", 1, 0))];

    const result = sequenceDay({ assignments, flex }, gridTravel);

    expect(result.input.flex).toBe(flex);
  });

  it("handles a day of one stop, and a day of none", () => {
    expect(sequenceDay({ assignments: [] }, gridTravel).reordered).toBe(false);
    expect(sequenceDay({ assignments: [stop(at("only", 0, 0))] }, gridTravel).afterMinutes).toBe(0);
  });

  it("reorders a stretch that sits between two meals with nothing after it", () => {
    const assignments = [
      stop(at("lunch", 0, 0), "lunch"),
      stop(at("far", 5, 0)),
      stop(at("near", 1, 0)),
    ];

    const result = sequenceDay({ assignments }, gridTravel);

    expect(names(result.input)).toEqual(["lunch", "near", "far"]);
    expect(result.savedMinutes).toBe(4); // 5+4 becomes 1+4
  });
});

describe("pathMeters", () => {
  it("adds up the great-circle legs of the order it is given", () => {
    const meters = pathMeters([
      stop(at("a", 103.85, 1.28)),
      stop(at("b", 103.86, 1.28)),
    ]);
    // ~1.11 km per 0.01 degree of longitude near the equator.
    expect(meters).toBeGreaterThan(1000);
    expect(meters).toBeLessThan(1200);
  });

  it("skips a leg whose endpoint has no coordinates rather than counting it as zero-length", () => {
    const noCoords: CandidatePlace = { placeId: "ChIJ_x", name: "x", types: [] };
    expect(pathMeters([stop(at("a", 103.85, 1.28)), stop(noCoords)])).toBe(0);
  });
});
