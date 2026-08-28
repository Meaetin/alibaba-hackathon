/**
 * Step 7a — the day's route order, between Pass B and the packer.
 *
 * Pass B decides *what* a day contains; nothing decided what order to walk it
 * in. The model that picks the stops is sent no coordinates on purpose — every
 * field not sent is hallucination surface removed — so it orders a day by
 * reading names, and `pack.ts` refuses to reorder because the sequence is Pass
 * B's. The gap between those two correct rules is a day that crosses the city
 * three times. On the first live Singapore trip it cost 4.4 km of the 9.0 km
 * walked on day one, and the model could not have known.
 *
 * So the ordering happens here instead, with the coordinates, before the clock
 * is stamped. Both of the rules above stay true: the model still gets no map,
 * and the packer still receives a sequence it must not touch.
 *
 * **Meals never move.** `stampDay` seats `lunch` and `dinner` in hard windows
 * and reports the day infeasible when it cannot. Their index in the day is what
 * puts the morning before lunch and the afternoon after it, so a reorder that
 * relocated one would not be shortening a route — it would be rewriting the
 * shape of the day. They are the fixed points this module optimises between.
 *
 * **Opening hours are not consulted, and that is a decision.** Rearranging can
 * move a morning-only stop into the afternoon. `validate.ts` already packs,
 * inspects against `hours.ts`, and swaps or drops what it finds shut — it is
 * the pass that exists for exactly this, and it runs after us. Teaching this
 * module about hours would mean predicting each stop's clock time, which needs
 * the packer, which needs the order: the circularity is why the repair pass
 * owns the question and this one does not. What the caller gets instead is
 * `SequencedDay.savedMinutes`, so a reorder that buys nothing is visible.
 */

import { metersBetween } from "./geo";
import { isMealRole, type PackDayInput, type SlotAssignment, type TravelLegProvider } from "./pack";

/** What `sequenceDay` did, for `planner_debug` and for the tests. */
export interface SequencedDay {
  input: PackDayInput;
  /** Travel minutes the incoming order would have spent. */
  beforeMinutes: number;
  /** Travel minutes the returned order spends. */
  afterMinutes: number;
  /** `beforeMinutes - afterMinutes`. Zero when the order was already best. */
  savedMinutes: number;
  /** True when the returned order differs from the one handed in. */
  reordered: boolean;
}

/**
 * Above this many movable stops in one stretch, stop enumerating permutations
 * and hill-climb instead. 7 stops is 5040 orders and a memoized leg lookup, so
 * the exact answer is microseconds; 8 would be 40320 and the gain over 2-opt on
 * a list that short is nil.
 */
const EXACT_MAX = 7;

/**
 * Reorders one day's stops to spend less time travelling, holding the meals in
 * place. Returns the same `PackDayInput` shape the packer already takes, so it
 * drops into the pipeline as one line and can be skipped by not calling it.
 *
 * `flex` is passed through untouched. Flex picks are spares the packer seats
 * itself — `selectStops` drops them in just before the last meal — so they have
 * no position here to optimise.
 */
export function sequenceDay(
  input: PackDayInput,
  getTravelLeg: TravelLegProvider,
): SequencedDay {
  const original = [...input.assignments];
  const cost = legCost(getTravelLeg);
  const beforeMinutes = pathMinutes(original, cost);

  const ordered: SlotAssignment[] = [];
  // Each stretch runs between two meals (or a meal and the end of the day).
  // The meal itself is appended after the stretch that precedes it, which is
  // what keeps every meal at the index Pass B gave it.
  let stretch: SlotAssignment[] = [];
  for (const assignment of original) {
    if (isMealRole(assignment.role)) {
      ordered.push(...orderStretch(stretch, ordered.at(-1) ?? null, assignment, cost));
      ordered.push(assignment);
      stretch = [];
      continue;
    }
    stretch.push(assignment);
  }
  ordered.push(...orderStretch(stretch, ordered.at(-1) ?? null, null, cost));

  const afterMinutes = pathMinutes(ordered, cost);
  // Never hand back a longer day. The stretch search is exact or monotonic, so
  // this cannot fire — but it is one comparison standing between a future
  // change to either and a pipeline that silently made trips worse.
  if (afterMinutes > beforeMinutes) {
    return {
      input,
      beforeMinutes,
      afterMinutes: beforeMinutes,
      savedMinutes: 0,
      reordered: false,
    };
  }

  const reordered = ordered.some((a, i) => a.place.placeId !== original[i].place.placeId);
  return {
    input: reordered ? { ...input, assignments: ordered } : input,
    beforeMinutes,
    afterMinutes,
    savedMinutes: beforeMinutes - afterMinutes,
    reordered,
  };
}

// ── the search ───────────────────────────────────────────────────────────────

/** Travel minutes between two stops. Memoized by the caller's provider — this
 *  runs it thousands of times per stretch. */
type LegCost = (from: SlotAssignment, to: SlotAssignment) => number;

function legCost(getTravelLeg: TravelLegProvider): LegCost {
  return (from, to) => Math.max(0, getTravelLeg(from.place, to.place).minutes);
}

/** Total travel of a whole day, in order. */
function pathMinutes(stops: readonly SlotAssignment[], cost: LegCost): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) total += cost(stops[i - 1], stops[i]);
  return total;
}

/**
 * The cost of walking `members` in the given order, arriving from `from` and
 * leaving for `to`. A null endpoint is genuinely free: the day may begin
 * anywhere, and nothing follows the last stop.
 */
function stretchCost(
  members: readonly SlotAssignment[],
  from: SlotAssignment | null,
  to: SlotAssignment | null,
  cost: LegCost,
): number {
  if (members.length === 0) return from && to ? cost(from, to) : 0;
  let total = pathMinutes(members, cost);
  if (from) total += cost(from, members[0]);
  if (to) total += cost(members[members.length - 1], to);
  return total;
}

/** The best order for one run of non-meal stops between two fixed points. */
function orderStretch(
  members: readonly SlotAssignment[],
  from: SlotAssignment | null,
  to: SlotAssignment | null,
  cost: LegCost,
): SlotAssignment[] {
  if (members.length < 2) return [...members];
  const seed =
    members.length <= EXACT_MAX
      ? bestPermutation(members, from, to, cost)
      : twoOpt(nearestNeighbour(members, from, cost), from, to, cost);
  // The incoming order is a candidate like any other, and it wins ties. A day
  // whose route is already shortest must come back byte-identical, or every
  // reorder counter reports churn that changed nothing.
  return stretchCost(seed, from, to, cost) < stretchCost(members, from, to, cost)
    ? seed
    : [...members];
}

/** Exhaustive, for the short stretches that are almost every stretch. */
function bestPermutation(
  members: readonly SlotAssignment[],
  from: SlotAssignment | null,
  to: SlotAssignment | null,
  cost: LegCost,
): SlotAssignment[] {
  let best: SlotAssignment[] = [...members];
  let bestCost = Infinity;

  const walk = (chosen: SlotAssignment[], remaining: readonly SlotAssignment[]) => {
    if (remaining.length === 0) {
      const total = stretchCost(chosen, from, to, cost);
      if (total < bestCost) {
        bestCost = total;
        best = [...chosen];
      }
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      chosen.push(remaining[i]);
      walk(chosen, [...remaining.slice(0, i), ...remaining.slice(i + 1)]);
      chosen.pop();
    }
  };

  walk([], members);
  return best;
}

/** A starting order for the long stretches: always go to the closest thing left. */
function nearestNeighbour(
  members: readonly SlotAssignment[],
  from: SlotAssignment | null,
  cost: LegCost,
): SlotAssignment[] {
  const remaining = [...members];
  const path: SlotAssignment[] = [];
  let cursor = from;

  while (remaining.length > 0) {
    let pick = 0;
    if (cursor) {
      let best = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = cost(cursor, remaining[i]);
        if (d < best) {
          best = d;
          pick = i;
        }
      }
    }
    cursor = remaining.splice(pick, 1)[0];
    path.push(cursor);
  }
  return path;
}

/** Reverse any sub-path that shortens the stretch, until none does. */
function twoOpt(
  start: readonly SlotAssignment[],
  from: SlotAssignment | null,
  to: SlotAssignment | null,
  cost: LegCost,
): SlotAssignment[] {
  let path = [...start];
  let best = stretchCost(path, from, to, cost);

  for (let improved = true; improved; ) {
    improved = false;
    for (let i = 0; i < path.length - 1; i++) {
      for (let j = i + 1; j < path.length; j++) {
        const candidate = [
          ...path.slice(0, i),
          ...path.slice(i, j + 1).reverse(),
          ...path.slice(j + 1),
        ];
        const total = stretchCost(candidate, from, to, cost);
        if (total < best) {
          path = candidate;
          best = total;
          improved = true;
        }
      }
    }
  }
  return path;
}

/**
 * How far a day walks, end to end. Not used by the search — the search costs in
 * minutes, because minutes are what the packer spends — but metres are what a
 * reader recognises, so this is what the debug record reports.
 */
export function pathMeters(stops: readonly SlotAssignment[]): number {
  let total = 0;
  for (let i = 1; i < stops.length; i++) {
    const from = stops[i - 1].place;
    const to = stops[i].place;
    if (
      from.latitude == null ||
      from.longitude == null ||
      to.latitude == null ||
      to.longitude == null
    ) {
      continue;
    }
    total += metersBetween(
      { latitude: from.latitude, longitude: from.longitude },
      { latitude: to.latitude, longitude: to.longitude },
    );
  }
  return total;
}
