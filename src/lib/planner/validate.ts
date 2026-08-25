/**
 * Step 8 — validate the packed day, and repair it from the ranked list.
 *
 * The last thing between Pass B's opinion and a stored itinerary. Pass B picks
 * which place holds which slot; it can hand back a temple that is shut during
 * its slot, a museum sitting in the lunch slot, or a day whose travel legs cost
 * it a meal. Nothing else catches any of that: `pack.ts` owns the clock and will
 * faithfully stamp times onto a nonsense assignment, and the funnel's hard
 * filters ran before the day existed.
 *
 * **Repairs come from the ranked candidate list, never from the LLM.** That is
 * the rule this module exists to keep — Step 10 of
 * `docs/personalization-pipeline.md`, "not by asking the AI to try again".
 * Re-asking is slow, costs money, and buys a differently-wrong answer; the
 * funnel already produced a ranked fallback queue for exactly this, and a swap
 * out of it is free, instant and auditable. `ValidateDeps.assign` exists solely
 * so that rule is testable — see the note on it.
 *
 * ## The repair ladder
 *
 *   1. swap in the next-best candidate **from the same bucket** — a restaurant
 *      may hold a meal slot, never a plain activity, which is what the design
 *      doc's "same bucket" means and what the funnel's restaurant quota exists
 *      to protect. A temple that shut at 17:00 is not repaired with the only
 *      thing open at 20:15, which is always a ramen shop.
 *   2. nothing in the list fits, and the stop is not a meal → **drop it**, with
 *      the validation reason, into the same `dropped` list the packer uses. A
 *      day that ends after dinner is a real day; a day with a locked temple in
 *      it is not, and neither is one that refuses to ship over a sixth stop.
 *   3. nothing fits and the stop **is** a meal → validation failure. Lunch is
 *      not something to quietly delete, so this is the one case that comes back
 *      `ok: false` for the caller to decide about.
 *
 * ## Why a repair means re-packing
 *
 * A swap changes the day's shape: a nearer restaurant shortens two travel legs,
 * which moves every segment after it. So this module owns a small loop — pack,
 * inspect, swap, pack again — rather than editing a finished timeline in place.
 * A day with nothing wrong never enters the loop: it comes back exactly as the
 * packer produced it, carrying the caller's own input object, because "the
 * validator rewrote a day it had no complaint about" is indistinguishable from
 * a bug and would churn the stored itinerary on every replan.
 *
 * ## Three rules, and why there are only three
 *
 * `closed` and `meal_slot` are invariants 3 and 2 of the suite, checked here
 * because this is the first point at which both the place and its stamped
 * window exist.
 *
 * The third is subtler. The design doc calls it "travel time overruns the
 * window", but `pack.ts` cannot *return* an overrunning day — it shrinks, then
 * drops, until the day fits. An overrun is therefore only ever observable as
 * its consequence, and the consequence that matters is a **lost meal**: the
 * packer surrenders meals last of all, so a day that lost one is a day travel
 * ate whole. A dropped *activity* is not a failure — that is pace working as
 * designed, and `pack.ts` already names it in `dropped`.
 *
 * ## Hours we don't have are not hours we checked
 *
 * `hours.ts` reads a place with no periods as always open, which is right for a
 * trail and wrong for a museum whose payload came back thin. Both look the same
 * from here, so a stop waved through on that assumption is reported in
 * `assumed` rather than presented as verified.
 */

import type { CandidatePlace, Pace, PreferenceProfile } from "./types";
import type { VisitDuration } from "./duration";
import type {
  DaySlot,
  DroppedPlace,
  PackDayInput,
  PackedDay,
  SlotAssignment,
  SlotRole,
  TimelineSegment,
  TravelLegProvider,
} from "./pack";
import { isMealRole, packDay, slotWindow } from "./pack";
import { type Weekday, hasKnownHours, isOpenDuring } from "./hours";
import { hardFilterReason } from "./score";
import { isRestaurant } from "./taxonomy";

// ── what can be wrong with a day ─────────────────────────────────────────────

export type ValidationRule = "closed" | "meal_slot" | "lost_meal";

export interface ValidationFailure {
  rule: ValidationRule;
  placeId: string;
  name: string;
  /** The slot the place was holding, or was assigned to and never reached. */
  role: SlotRole;
  /** Plain enough to show a user who asks what went wrong. */
  reason: string;
}

/** One rung of the ladder applied, and the failure that forced it. */
export interface Repair {
  rule: ValidationRule;
  role: SlotRole;
  removed: { placeId: string; name: string };
  /** The swap-in, or `null` when rung 2 dropped the stop instead. */
  inserted: { placeId: string; name: string } | null;
  /** Why `removed` had to go — the failure's reason, carried through. */
  reason: string;
}

/** A stop passed on the missing-hours assumption rather than a real check. */
export interface AssumedStop {
  placeId: string;
  name: string;
}

/**
 * An entry in the fallback queue: the funnel's ranked shortlist for this day's
 * cluster, minus whatever Pass B already spent. Shaped like `FlexPick` and
 * deliberately not the same type — a flex pick is offered to the packer and may
 * be scheduled, an alternate is only ever swapped in for something that failed.
 */
export interface Alternate {
  place: CandidatePlace;
  score: number;
  duration: VisitDuration;
}

/**
 * Whatever Pass B's client turns out to be (Step 13). Typed loosely because
 * **this module never calls it** — it is a tripwire, not a dependency. It is
 * here so `validate.test.ts` can hold a fake and assert zero calls, pinning the
 * one rule that makes repair cheap. If a future edit wants it, the answer is
 * the ranked list.
 */
export interface AssignClient {
  assign: (...args: unknown[]) => unknown;
}

export interface ValidateDeps {
  pace: Pace;
  /** 0 = Sunday … 6 = Saturday, matching the Places API. The day being planned. */
  weekday: Weekday;
  /** Read only for the meal-slot dietary rule; nothing here re-scores. */
  profile: PreferenceProfile;
  /** The same memoized provider the packer gets — this loop packs several times. */
  getTravelLeg: TravelLegProvider;
  /** The ranked fallback queue, best-first. Empty means no repair is possible. */
  alternates: readonly Alternate[];
  /** Never called. See `AssignClient`. */
  assign?: AssignClient;
}

export interface DayValidation {
  /** `failures.length === 0`. False means: do not store this day as it stands. */
  ok: boolean;
  day: PackedDay;
  /**
   * The assignment `day` was built from — the caller's own object, by
   * reference, when nothing needed repairing.
   */
  input: PackDayInput;
  /** Swaps made, in the order they were made. Empty on a clean day. */
  repairs: Repair[];
  /**
   * What is still wrong with `day`. The first entry is the one repair ran out
   * of candidates for; the rest are what it never got to.
   */
  failures: ValidationFailure[];
  assumed: AssumedStop[];
}

/**
 * Swaps are bounded so a pathological day terminates. Each repair also spends
 * an alternate, so the queue bounds it too — this is the cheaper backstop, and
 * the number is "more rounds than a real day has stops".
 */
export const MAX_REPAIR_ROUNDS = 8;

/** Granularity of the seating probe below. Meal windows are two hours wide. */
const SEATING_PROBE_MIN = 15;

// ── the loop ─────────────────────────────────────────────────────────────────

/**
 * Packs the day, checks it, and swaps failures out of the ranked list until it
 * is valid or the list is spent.
 *
 * Pure and offline: no network, no clock, no LLM. `weekday` is injected the way
 * `rng` and `now` are elsewhere in this pipeline, so the same input validates
 * the same way whenever it runs.
 */
export function validateDay(input: PackDayInput, deps: ValidateDeps): DayValidation {
  const spent = new Set<string>(placeIds(input));
  const repairs: Repair[] = [];
  const cut: DroppedPlace[] = [];
  let current = input;

  /** The packer's cuts and ours, in one list — a caller asking "why isn't X in
   *  my day" must not have to know which module removed it. */
  const settle = (day: PackedDay): PackedDay =>
    cut.length === 0 ? day : { ...day, dropped: [...day.dropped, ...cut] };

  for (let round = 0; ; round++) {
    const day = packDay(current, deps.pace, deps.getTravelLeg);
    const failures = inspect(current, day, deps);
    const assumed = assumedStops(current, day);

    if (failures.length === 0) {
      return { ok: true, day: settle(day), input: current, repairs, failures: [], assumed };
    }

    const failure = failures[0];
    const spendable = round < MAX_REPAIR_ROUNDS;
    const replacement = spendable
      ? deps.alternates.find(
          (alternate) =>
            !spent.has(alternate.place.placeId) && admits(failure, alternate, current, day, deps),
        )
      : undefined;

    // Rung 3: a meal is never dropped to make a day validate. Losing lunch is
    // the caller's decision to make, so it comes back as a failure.
    if (!replacement && (!spendable || isMealRole(failure.role))) {
      return { ok: false, day: settle(day), input: current, repairs, failures, assumed };
    }

    const removed = { placeId: failure.placeId, name: failure.name };
    if (replacement) {
      spent.add(replacement.place.placeId);
      current = swap(current, failure, replacement);
    } else {
      current = withoutPlace(current, failure.placeId);
      cut.push({ ...removed, reason: failure.reason });
    }

    repairs.push({
      rule: failure.rule,
      role: failure.role,
      removed,
      inserted: replacement
        ? { placeId: replacement.place.placeId, name: replacement.place.name }
        : null,
      reason: failure.reason,
    });
  }
}

// ── the three checks ─────────────────────────────────────────────────────────

/**
 * Everything wrong with `day`, in day order, with the lost meals last — a slot
 * that is filled badly is a more specific complaint than one that is empty.
 */
function inspect(
  input: PackDayInput,
  day: PackedDay,
  deps: ValidateDeps,
): ValidationFailure[] {
  const places = placeIndex(input);
  const failures: ValidationFailure[] = [];

  for (const segment of day.segments) {
    if (segment.kind !== "activity") continue;
    const place = places.get(segment.placeId);
    // Every scheduled id came from the input — `assertValidItinerary` proves it.
    if (!place) continue;

    // A museum in the lunch slot is a worse fact about the slot than its hours,
    // and swapping for the meal rule fixes both at once.
    if (isMealRole(segment.role)) {
      const reason = mealSlotReason(place, deps.profile);
      if (reason) {
        failures.push({ rule: "meal_slot", placeId: place.placeId, name: place.name, role: segment.role, reason });
        continue;
      }
    }

    if (!isOpenDuring(place, deps.weekday, segment.startMin, segment.endMin)) {
      failures.push({
        rule: "closed",
        placeId: place.placeId,
        name: place.name,
        role: segment.role,
        reason: `closed during its ${hhmm(segment.startMin)}–${hhmm(segment.endMin)} slot`,
      });
    }
  }

  for (const assignment of input.assignments) {
    if (!isMealRole(assignment.role)) continue;
    if (isScheduled(day, assignment)) continue;
    const cut = day.dropped.find((record) => record.placeId === assignment.place.placeId);
    failures.push({
      rule: "lost_meal",
      placeId: assignment.place.placeId,
      name: assignment.place.name,
      role: assignment.role,
      reason: cut
        ? `${assignment.role} lost to the clock — ${cut.reason}`
        : `${assignment.role} could not be seated in its ${windowLabel(assignment.role)} window`,
    });
  }

  return failures;
}

/** Why this place may not hold a meal slot, or `undefined` if it may. */
function mealSlotReason(place: CandidatePlace, profile: PreferenceProfile): string | undefined {
  if (!isRestaurant(place)) return "not somewhere you can eat a meal";
  return hardFilterReason(place, profile, { mealSlot: true });
}

function assumedStops(input: PackDayInput, day: PackedDay): AssumedStop[] {
  const places = placeIndex(input);
  const assumed: AssumedStop[] = [];
  for (const segment of day.segments) {
    if (segment.kind !== "activity") continue;
    const place = places.get(segment.placeId);
    if (place && !hasKnownHours(place)) assumed.push({ placeId: place.placeId, name: place.name });
  }
  return assumed;
}

// ── choosing a replacement ───────────────────────────────────────────────────

/**
 * May this alternate take the failed slot? A pre-filter, not the verdict: the
 * swap moves every segment after it, so the authoritative answer is the next
 * pass round the loop. What this stops is spending a candidate on a place that
 * cannot possibly work — the queue is short and each entry is used once.
 */
function admits(
  failure: ValidationFailure,
  alternate: Alternate,
  input: PackDayInput,
  day: PackedDay,
  deps: ValidateDeps,
): boolean {
  if (isMealRole(failure.role)) {
    if (mealSlotReason(alternate.place, deps.profile)) return false;
    return canSeat(alternate, slotWindow(failure.role), deps);
  }

  // A restaurant belongs in a slot where you eat. Spending one on a plain
  // activity is how a temple that shut at 17:00 becomes the only thing open at
  // 20:15 — a ramen shop, twenty minutes after dinner — and it quietly undoes
  // the funnel's restaurant quota. `cafe_break` stays open to them: a kissaten
  // is routinely typed `restaurant` and it is exactly what that slot wants.
  if (failure.role === "activity" && isRestaurant(alternate.place)) return false;

  const segment = activityFor(day, failure.placeId);
  // No segment means the stop never reached the timeline, so there is no window
  // to test against — let the re-pack decide.
  if (!segment) return true;
  return isOpenDuring(alternate.place, deps.weekday, segment.startMin, segment.endMin);
}

/**
 * Is there any moment inside this window at which the place could seat the
 * meal? Probed rather than solved: the window is two hours, the check is
 * integer comparison, and asking "open for the whole window" would reject a
 * restaurant that opens at noon from a lunch slot it fits perfectly well.
 */
function canSeat(alternate: Alternate, window: readonly [number, number], deps: ValidateDeps): boolean {
  const [opens, latest] = window;
  const minutes = alternate.duration.min;
  for (let start = opens; start <= latest; start += SEATING_PROBE_MIN) {
    if (isOpenDuring(alternate.place, deps.weekday, start, start + minutes)) return true;
  }
  return isOpenDuring(alternate.place, deps.weekday, latest, latest + minutes);
}

/**
 * The failed place out, the alternate in — same slot, same position in the day.
 * The order of a day is Pass B's decision, and a repair is not a licence to
 * re-order it.
 */
function swap(input: PackDayInput, failure: ValidationFailure, alternate: Alternate): PackDayInput {
  const replaced = (assignment: SlotAssignment): SlotAssignment => ({
    place: alternate.place,
    role: assignment.role,
    score: alternate.score,
    duration: alternate.duration,
  });

  return {
    assignments: input.assignments.map((assignment) =>
      assignment.place.placeId === failure.placeId ? replaced(assignment) : assignment,
    ),
    flex: input.flex?.map((pick) =>
      pick.place.placeId === failure.placeId
        ? { place: alternate.place, score: alternate.score, duration: alternate.duration }
        : pick,
    ),
  };
}

/** Rung 2: the stop leaves the day entirely. */
function withoutPlace(input: PackDayInput, placeId: string): PackDayInput {
  return {
    assignments: input.assignments.filter((a) => a.place.placeId !== placeId),
    flex: input.flex?.filter((pick) => pick.place.placeId !== placeId),
  };
}

// ── small shared readings of the day ─────────────────────────────────────────

function placeIndex(input: PackDayInput): Map<string, CandidatePlace> {
  const places = new Map<string, CandidatePlace>();
  for (const assignment of input.assignments) places.set(assignment.place.placeId, assignment.place);
  for (const pick of input.flex ?? []) places.set(pick.place.placeId, pick.place);
  return places;
}

function placeIds(input: PackDayInput): string[] {
  return [...placeIndex(input).keys()];
}

function activityFor(
  day: PackedDay,
  placeId: string,
): Extract<TimelineSegment, { kind: "activity" }> | undefined {
  return day.segments.find(
    (segment): segment is Extract<TimelineSegment, { kind: "activity" }> =>
      segment.kind === "activity" && segment.placeId === placeId,
  );
}

function isScheduled(day: PackedDay, assignment: SlotAssignment): boolean {
  return day.segments.some(
    (segment) =>
      segment.kind === "activity" &&
      segment.placeId === assignment.place.placeId &&
      segment.role === assignment.role,
  );
}

function windowLabel(role: DaySlot["role"]): string {
  const [opens, latest] = slotWindow(role);
  return `${hhmm(opens)}–${hhmm(latest)}`;
}

/**
 * Minutes from midnight as a 24-hour clock face. Exported because the debug
 * view renders the same unit, and a fourth copy of this three-line function is
 * a fourth place for it to drift.
 */
export function hhmm(minutes: number): string {
  const clamped = ((minutes % 1440) + 1440) % 1440;
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(clamped % 60).padStart(2, "0")}`;
}
