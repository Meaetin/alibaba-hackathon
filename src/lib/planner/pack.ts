/**
 * Step 7 — the elastic-slot packer. See "Elastic Slots" and "Pass Architecture —
 * The LLM Writes Content, Code Owns the Clock" in
 * `docs/personalization-pipeline.md`.
 *
 * Pass B hands us an ordered day: place IDs, each tagged with the role it plays
 * (a stop, a meal, a coffee). This module stamps the times, and it is the only
 * thing in the pipeline allowed to — the LLM never emits a clock value, so a day
 * is always arithmetic we can check and repair.
 *
 * Everything is minutes-from-midnight integers. Travel is an **injected**
 * provider, never a call to the Routes API from in here — which also means the
 * provider must be memoized: the fit search below calls it hundreds of times
 * per day while it hunts for the largest set of durations that still fits.
 *
 * What "fits" means is wall clock, not a minute total. The day runs 9:00 to a
 * pace-dependent end, but meals are anchored inside fixed windows, so idle time
 * waiting for an anchor is spent just as surely as time inside a museum. A day
 * can be well under 720 minutes of content and still run past its end.
 *
 * `dropped` is the point of the module as much as `segments` are. A packer that
 * silently shortens the list is the bug that produces "why isn't teamLab in my
 * trip?" with no way to answer it.
 *
 * Two things this module deliberately does NOT do. It does not reorder the day:
 * the sequence is Pass B's, and a caller who hands it dinner before lunch gets a
 * dropped lunch with a reason, not a silent reshuffle. And it does not label
 * time — a stop's `role` says what kind of stop it is, never when it happens.
 * `startMin` is the only thing in here that makes a claim about the clock, which
 * is why nothing in a packed day can contradict anything else in it.
 */

import type { CandidatePlace, Pace } from "./types";
import type { VisitDuration } from "./duration";

// ── the day's shape ──────────────────────────────────────────────────────────

export type TravelMode = "walk" | "transit";

/**
 * What a stop *is*, never when it happens. An earlier version of this type had
 * `morning_activity` / `afternoon_activity` / `evening_activity`, which folded
 * three separate things — the kind of stop, its position in the day, and a claim
 * about the clock — into one field. Only the clock claim could ever be wrong,
 * and it duplicated `startMin`, so it's gone: position is the array index and
 * the time is the timestamp.
 */
export type SlotRole = "activity" | "lunch" | "dinner" | "cafe_break";

/** 9:00. Nothing is scheduled earlier. */
export const DAY_START_MIN = 540;
/** 21:00 — the latest any pace may run. Each pace sets its own end at or below this. */
export const DAY_END_MIN = 1260;

export interface DaySlot {
  role: Exclude<SlotRole, "activity">;
  /** `[opens, latest acceptable start]`. */
  window: readonly [number, number];
}

/**
 * The fixed points of a day. Meals are hard anchors — lunch really does have to
 * happen at lunchtime — and `cafe_break` is the window in which idle time is
 * allowed to call itself a coffee.
 *
 * Plain activities are deliberately absent: they are the elastic filler between
 * anchors, they flow in the order Pass B gave them, and they claim no window at
 * all. That absence is the fix for a real bug — activities used to wait, idle,
 * for a nominal window to open, which on a thin day meant three hours of dead
 * time to make a label true.
 */
export const DAY_SKELETON = [
  { role: "lunch", window: [690, 810] }, // 11:30–13:30
  { role: "cafe_break", window: [930, 1020] }, // 15:30–17:00, soft
  { role: "dinner", window: [1080, 1200] }, // 18:00–20:00
] as const satisfies readonly DaySlot[];

const SLOT_WINDOWS = Object.fromEntries(
  DAY_SKELETON.map((slot) => [slot.role, slot.window]),
) as Record<DaySlot["role"], readonly [number, number]>;

/** Meals are the semi-fixed anchors: their window is a constraint, not a hint. */
export function isMealRole(role: SlotRole): role is "lunch" | "dinner" {
  return role === "lunch" || role === "dinner";
}

/**
 * The window a non-activity role must be seated in. Exported so the validator
 * and the invariant suite read the skeleton rather than each keeping a private
 * copy of it — a second lunch window is a bug nothing would catch.
 */
export function slotWindow(role: DaySlot["role"]): readonly [number, number] {
  return SLOT_WINDOWS[role];
}

/** Under this, you walk. At exactly 1.2 km and beyond, you take transit. */
export const WALK_MAX_METERS = 1200;

/**
 * A visit whose *floor* is this long owns its block — teamLab, a full hike.
 * Keyed on `min` rather than `preferred` deliberately: `duration.ts` scales
 * `preferred` by pace, so keying on it would let a relaxed traveller promote a
 * place to an anchor that a packed traveller does not. Anchor status is a
 * property of the place, not of who is visiting it.
 */
export const ANCHOR_MIN_MINUTES = 180;

/** Shorter idle than this is a wait, not a cafe break. Don't dress it up. */
export const CAFE_BREAK_MIN_MINUTES = 30;

export type DurationBias = "min" | "preferred" | "max";

export interface PacePlan {
  /** Wall clock this pace's day must end by. Relaxed simply stops earlier. */
  dayEndMin: number;
  /** Added to every travel leg — the "getting out the door" minutes. */
  bufferMin: number;
  /**
   * How far a visit may be compressed to make the day fit before the packer
   * gives up and drops a stop instead. This is what makes a relaxed day relaxed:
   * at `preferred` it will lose the sixth stop rather than rush the other five,
   * where `min` crams everything in.
   *
   * Without it `durationBias` is self-defeating — a relaxed day is built at
   * `max`, then squeezed straight back to `min` to fit the same stops a packed
   * day would take, and the two paces produce identical itineraries.
   */
  shrinkFloor: "min" | "preferred";
  /**
   * Which bound a visit is built at, and — via `GROW_CEILING` — how far it may
   * grow once the day fits: one bound up, never past `max`. So a packed day is
   * built at `min` and grows to `preferred`, a relaxed one sits at `max`
   * throughout.
   *
   * Deliberately not a multiplier. `resolveVisitDuration` already scaled
   * `preferred` by pace; a second factor here would count it twice. Naming
   * bounds instead is also what makes the knob do anything on a day with room
   * to spare, where a multiplier would just be overwritten by the growth pass.
   */
  durationBias: DurationBias;
}

/**
 * How far growth may lift a visit above the bound it was built at. A brisk
 * traveller who happens to have a spare hour wants another stop or a coffee,
 * not ninety minutes in the tofu restaurant — so `max`, which `duration.ts`
 * calls the relaxed-pace ceiling, stays out of reach at a packed pace.
 */
const GROW_CEILING: Record<DurationBias, "preferred" | "max"> = {
  min: "preferred",
  preferred: "max",
  max: "max",
};

/**
 * The three levers pace actually pulls. Note what is absent: there is no cap on
 * stops, in minutes or in count. An earlier version had `activitiesPerDay`, and
 * it cut days the clock had room for — three 68-minute temples, done by 13:28,
 * with a fourth dropped for "pace cap".
 *
 * Converting it to minutes doesn't help, because the wall clock is *already* a
 * minute budget: after two meals and travel, a balanced day physically cannot
 * exceed ~415–465 activity minutes. Any cap above that is unreachable; any cap
 * below it re-creates the thin day. So the clock does the arithmetic, and pace
 * confines itself to the three things a clock can't infer — how long you linger
 * between stops, how late you stay out, and which end of a visit's range you
 * plan for.
 *
 * That is also what makes a relaxed day relaxed: at `max` durations with 25-minute
 * transitions and an 8pm finish, fewer stops fit. Fewer stops is the *consequence*
 * of a relaxed pace, never the input to it.
 */
export const PACE_PLANS: Record<Pace, PacePlan> = {
  relaxed: { dayEndMin: 1200, bufferMin: 25, shrinkFloor: "preferred", durationBias: "max" },
  balanced: { dayEndMin: 1260, bufferMin: 15, shrinkFloor: "min", durationBias: "preferred" },
  packed: { dayEndMin: 1260, bufferMin: 10, shrinkFloor: "min", durationBias: "min" },
};

// ── input and output ─────────────────────────────────────────────────────────

export interface TravelLeg {
  minutes: number;
  meters: number;
}

/**
 * Distance Matrix / Routes, or a cached matrix, or a fake. Called many times
 * per packed day — memoize it, and never let it reach the network per call.
 */
export type TravelLegProvider = (from: CandidatePlace, to: CandidatePlace) => TravelLeg;

/** One of Pass B's stops. Order in `assignments` is the order of the day. */
export interface SlotAssignment {
  place: CandidatePlace;
  role: SlotRole;
  /** The funnel's score. Decides what survives when the day won't fit. */
  score: number;
  duration: VisitDuration;
}

/**
 * Pass B's spare picks. They are part of the day from the start — that's what
 * `capacity.flex` buys — and they are the first thing surrendered when it
 * doesn't fit.
 */
export interface FlexPick {
  place: CandidatePlace;
  score: number;
  duration: VisitDuration;
}

export interface PackDayInput {
  /** In day order. The packer stamps times onto this sequence; it never sorts it. */
  assignments: readonly SlotAssignment[];
  flex?: readonly FlexPick[];
}

/**
 * The stamped day. `activity` segments get their content layer bolted on by
 * Pass C afterwards; nothing in here knows or cares about prose.
 */
export type TimelineSegment =
  | {
      kind: "activity";
      placeId: string;
      name: string;
      role: SlotRole;
      /** 1-based position in the day. The ordering `role` used to imply. */
      position: number;
      startMin: number;
      endMin: number;
    }
  | {
      kind: "travel";
      mode: TravelMode;
      startMin: number;
      endMin: number;
      fromName: string;
      toName: string;
    }
  | { kind: "break"; reason: "cafe" | "free"; startMin: number; endMin: number };

export interface DroppedPlace {
  placeId: string;
  name: string;
  /** Plain enough to show a user who asks why their pick isn't in the day. */
  reason: string;
}

export interface PackedDay {
  /** Contiguous: `segments[i].endMin === segments[i + 1].startMin`, always. */
  segments: TimelineSegment[];
  /** Every input place that isn't in `segments`, with the reason it isn't. */
  dropped: DroppedPlace[];
}

export function travelModeForMeters(meters: number, walkMaxMeters = WALK_MAX_METERS): TravelMode {
  return meters < walkMaxMeters ? "walk" : "transit";
}

// ── the packer ───────────────────────────────────────────────────────────────

interface Stop {
  place: CandidatePlace;
  role: SlotRole;
  score: number;
  duration: VisitDuration;
  /** Owns its block: sized at `preferred`, and only shrinks as a concession. */
  isAnchor: boolean;
  isFlex: boolean;
  /** Size this attempt starts from, before any shrinking. */
  base: number;
  /** Current size in minutes. */
  size: number;
}

/**
 * The two settings that belong to the *traveller* rather than to the pace, and
 * that the packer nonetheless needs at every level: how long a visit is built
 * at, and how far a person will walk before it becomes a transit leg.
 *
 * `visitDurationBias` overrides `PacePlan.durationBias` — **pace sets the floor
 * and `immersion` may raise it one step, never lower it**, and that arithmetic
 * has already happened in `resolvePlannerKnobs`. By the time it arrives here it
 * is simply the answer.
 *
 * There is deliberately **no** default constant for this type: the no-persona
 * default for `visitDurationBias` is `PACE_PLANS[pace].durationBias`, which
 * depends on the pace and so cannot be written down as one value. A caller with
 * no persona passes nothing and `packDay` reads the pace, exactly as before.
 */
export interface PackKnobs {
  visitDurationBias: DurationBias;
  walkMaxMeters: number;
}

/**
 * A `PacePlan` with the traveller's two settings folded in, so every helper
 * below keeps taking exactly one object. Internal — the public input is
 * `PackKnobs`, which says only what a persona may move.
 */
interface EffectivePlan extends PacePlan {
  walkMaxMeters: number;
}

const OVER_BUDGET_REASON = "over budget — no room left in the day";

/**
 * Stamps one day. The degradation ladder, in order, because the order is the
 * whole point:
 *
 *   1. shrink ordinary visits toward `min`, everything at once and in
 *      proportion — a global squeeze, not a hunt for the weakest link
 *   2. shrink the anchors too, rather than lose a stop
 *   3. drop flex picks, worst first
 *   4. drop the lowest-scored activity; meals go last of all
 *
 * Step 4 of the design doc — "shorten the lowest-scored activity to its floor,
 * *then* drop it" — falls out of 1–3 rather than needing its own rung: by the
 * time anything is dropped the squeeze has already put it on its floor.
 *
 * Once a day fits, visits grow back toward `max` best-scored-first, which is
 * also what undoes any collateral damage from the proportional squeeze.
 */
export function packDay(
  input: PackDayInput,
  pace: Pace,
  getTravelLeg: TravelLegProvider,
  knobs?: PackKnobs,
): PackedDay {
  const plan: EffectivePlan = {
    ...PACE_PLANS[pace],
    ...(knobs ? { durationBias: knobs.visitDurationBias } : {}),
    walkMaxMeters: knobs?.walkMaxMeters ?? WALK_MAX_METERS,
  };
  const dropped: DroppedPlace[] = [];
  let stops = selectStops(input, plan);

  while (stops.length > 0) {
    const segments = fitDay(stops, plan, getTravelLeg);
    if (segments) return { segments, dropped };

    const victim = pickVictim(stops);
    dropped.push(drop(victim, OVER_BUDGET_REASON));
    stops = stops.filter((stop) => stop !== victim);
  }

  return { segments: [], dropped };
}

function drop(stop: Stop, reason: string): DroppedPlace {
  return { placeId: stop.place.placeId, name: stop.place.name, reason };
}

/**
 * Builds the day's stop list. Everything Pass B offered goes in — including flex
 * picks, which is what makes "shrink before you drop a flex pick" observable —
 * and the fit ladder below decides what actually survives. Nothing is cut here.
 *
 * The returned sequence is the caller's, because the order of a day is Pass B's
 * decision and not ours. The one placement this function does make is flex: it
 * lands just before the last meal, in the elastic afternoon, rather than after
 * it where it would read as a second dinner.
 */
function selectStops(input: PackDayInput, plan: EffectivePlan): Stop[] {
  const assignments = input.assignments.map((a) =>
    toStop(a.place, a.role, a.score, a.duration, false, plan),
  );
  const flex = [...(input.flex ?? [])]
    .sort((a, b) => b.score - a.score)
    .map((f) => toStop(f.place, "activity", f.score, f.duration, true, plan));

  if (flex.length === 0) return assignments;

  const lastMeal = assignments.map((s) => isMealRole(s.role)).lastIndexOf(true);
  if (lastMeal < 0) return [...assignments, ...flex];
  return [...assignments.slice(0, lastMeal), ...flex, ...assignments.slice(lastMeal)];
}

function toStop(
  place: CandidatePlace,
  role: SlotRole,
  score: number,
  duration: VisitDuration,
  isFlex: boolean,
  plan: EffectivePlan,
): Stop {
  const isAnchor = duration.min >= ANCHOR_MIN_MINUTES;
  const base = baseSize(duration, isAnchor, plan);
  return { place, role, score, duration, isAnchor, isFlex, base, size: base };
}

/** Flex first, then lowest score, then meals — whatever else goes, lunch stays. */
function pickVictim(stops: Stop[]): Stop {
  const rank = (stop: Stop) => (stop.isFlex ? 0 : isMealRole(stop.role) ? 2 : 1);
  return [...stops].sort((a, b) => rank(a) - rank(b) || a.score - b.score)[0];
}

/**
 * Rungs 1 and 2 of the ladder. Returns the stamped day, or `null` if it can't
 * be made to fit without losing a stop.
 *
 * The squeeze is a linear search on total minutes surrendered rather than a
 * binary search on a ratio: the day is at most a few hundred minutes over, the
 * stamp is a dozen operations, and "smallest cut that works" is exact this way
 * instead of approximately right.
 */
function fitDay(
  stops: Stop[],
  plan: EffectivePlan,
  getTravelLeg: TravelLegProvider,
): TimelineSegment[] | null {
  for (const stop of stops) stop.base = baseSize(stop.duration, stop.isAnchor, plan);

  const ordinary = stops.filter((stop) => !stop.isAnchor);
  const anchors = stops.filter((stop) => stop.isAnchor);
  const fits = () => stampDay(stops, plan, getTravelLeg).feasible;

  applyCut(ordinary, 0, plan);
  applyCut(anchors, 0, plan);
  if (fits()) return growDay(stops, plan, getTravelLeg);

  const ordinarySlack = totalSlack(ordinary, plan);
  for (let cut = 1; cut <= ordinarySlack; cut++) {
    applyCut(ordinary, cut, plan);
    if (fits()) return growDay(stops, plan, getTravelLeg);
  }

  // Ordinary visits are on their floors. An anchor giving up minutes is still
  // better than losing a stop entirely.
  applyCut(ordinary, ordinarySlack, plan);
  const anchorSlack = totalSlack(anchors, plan);
  for (let cut = 1; cut <= anchorSlack; cut++) {
    applyCut(anchors, cut, plan);
    if (fits()) return growDay(stops, plan, getTravelLeg);
  }

  return null;
}

function baseSize(duration: VisitDuration, isAnchor: boolean, plan: EffectivePlan): number {
  const { min, preferred, max } = duration;
  const biased = isAnchor
    ? preferred
    : plan.durationBias === "min"
      ? min
      : plan.durationBias === "max"
        ? max
        : preferred;
  return Math.min(max, Math.max(min, biased));
}

function floorFor(stop: Stop, plan: EffectivePlan): number {
  return stop.isAnchor ? stop.duration.min : stop.duration[plan.shrinkFloor];
}

function totalSlack(stops: Stop[], plan: EffectivePlan): number {
  return stops.reduce((sum, stop) => sum + Math.max(0, stop.base - floorFor(stop, plan)), 0);
}

/**
 * Surrender `cut` minutes across `stops`, in proportion to how much slack each
 * has. Proportional and not worst-first on purpose: "shrink durations toward
 * min" is one global move, and a squeeze that spared the best-scored place
 * would just push the day onto the next rung, where things get dropped.
 */
function applyCut(stops: Stop[], cut: number, plan: EffectivePlan): void {
  const slack = stops.map((stop) => Math.max(0, stop.base - floorFor(stop, plan)));
  const available = slack.reduce((sum, value) => sum + value, 0);
  if (available === 0) {
    for (const stop of stops) stop.size = stop.base;
    return;
  }

  const wanted = Math.min(cut, available);
  const exact = slack.map((value) => (value * wanted) / available);
  const taken = exact.map((value, index) => Math.min(slack[index], Math.floor(value)));
  let remainder = wanted - taken.reduce((sum, value) => sum + value, 0);

  // Largest fractional part first, so rounding lands where it was most owed.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || slack[b.index] - slack[a.index] || a.index - b.index);

  while (remainder > 0) {
    const before = remainder;
    for (const { index } of order) {
      if (remainder === 0) break;
      if (taken[index] < slack[index]) {
        taken[index]++;
        remainder--;
      }
    }
    if (remainder === before) break;
  }

  stops.forEach((stop, index) => {
    stop.size = Math.max(1, stop.base - taken[index]);
  });
}

/**
 * Give minutes back, best-scored first, one stop at a time — the day only has
 * to stay feasible, and a stop whose growth is swallowed by idle time before
 * the next anchor costs nothing at all. This is also the repair for the
 * proportional squeeze, which cuts places that weren't the reason the day
 * didn't fit; here they get it back.
 *
 * Anchors stop at `preferred`. An anchor already owns a block; the point of
 * promoting it was never to make it longer.
 */
function growDay(
  stops: Stop[],
  plan: EffectivePlan,
  getTravelLeg: TravelLegProvider,
): TimelineSegment[] {
  for (const stop of [...stops].sort((a, b) => b.score - a.score)) {
    const ceiling = stop.isAnchor
      ? stop.duration.preferred
      : stop.duration[GROW_CEILING[plan.durationBias]];
    const current = stop.size;
    for (let size = ceiling; size > current; size--) {
      stop.size = size;
      if (stampDay(stops, plan, getTravelLeg).feasible) break;
      stop.size = current;
    }
  }
  return stampDay(stops, plan, getTravelLeg).segments;
}

/**
 * Walks the day front to back and lays down every minute between the first
 * activity's start and the last one's end. Idle time is emitted as a break
 * rather than left as a hole: a gap in the timeline is indistinguishable from
 * a scheduling bug, and it's time the traveller has to spend somewhere.
 *
 * Only meals wait. An activity starts when you arrive, because an activity has
 * no opinion about the clock.
 */
function stampDay(
  stops: Stop[],
  plan: EffectivePlan,
  getTravelLeg: TravelLegProvider,
): { segments: TimelineSegment[]; feasible: boolean } {
  const segments: TimelineSegment[] = [];
  const [cafeOpen, cafeClose] = SLOT_WINDOWS.cafe_break;
  // An assigned cafe already occupies that role; don't invent a second one.
  let cafeTaken = stops.some((stop) => stop.role === "cafe_break");
  let cursor = DAY_START_MIN;
  let position = 0;

  const fillIdle = (from: number, to: number) => {
    if (to <= from) return;
    const start = Math.max(from, cafeOpen);
    const end = Math.min(to, cafeClose);
    if (!cafeTaken && end - start >= CAFE_BREAK_MIN_MINUTES) {
      if (start > from) segments.push({ kind: "break", reason: "free", startMin: from, endMin: start });
      segments.push({ kind: "break", reason: "cafe", startMin: start, endMin: end });
      if (to > end) segments.push({ kind: "break", reason: "free", startMin: end, endMin: to });
      cafeTaken = true;
      return;
    }
    segments.push({ kind: "break", reason: "free", startMin: from, endMin: to });
  };

  for (let index = 0; index < stops.length; index++) {
    const stop = stops[index];

    let arrival = DAY_START_MIN;
    if (index > 0) {
      const previous = stops[index - 1];
      const leg = getTravelLeg(previous.place, stop.place);
      const length = Math.max(0, Math.round(leg.minutes)) + plan.bufferMin;
      segments.push({
        kind: "travel",
        mode: travelModeForMeters(leg.meters, plan.walkMaxMeters),
        startMin: cursor,
        endMin: cursor + length,
        fromName: previous.place.name,
        toName: stop.place.name,
      });
      arrival = cursor + length;
    }

    let start = arrival;
    if (stop.role !== "activity") {
      const [opens, latestStart] = SLOT_WINDOWS[stop.role];
      start = Math.max(arrival, opens);
      // Meal windows are hard; the cafe window is a preference that yields.
      if (isMealRole(stop.role) && start > latestStart) return { segments, feasible: false };
      if (!isMealRole(stop.role) && start > latestStart) start = arrival;
    }
    if (index > 0) fillIdle(arrival, start);

    segments.push({
      kind: "activity",
      placeId: stop.place.placeId,
      name: stop.place.name,
      role: stop.role,
      position: ++position,
      startMin: start,
      endMin: start + stop.size,
    });
    cursor = start + stop.size;
  }

  return { segments, feasible: cursor <= plan.dayEndMin };
}
