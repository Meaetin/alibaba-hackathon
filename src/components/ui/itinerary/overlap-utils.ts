import { parseTimeMins, minsToHHMM } from "./activity-utils";
import type { ItineraryActivityDetail, ItineraryDayDetail } from "@/lib/supabase/queries/home";

export interface ResolveOverlapsInput {
  day: ItineraryDayDetail;
  /** Activities that must never move — flights auto-lock; users lock others. */
  lockedIds: Set<string>;
}

export interface ProposedOrder {
  /** Non-transport, timed activities in the proposed (possibly reordered) order. */
  ordered: ItineraryActivityDetail[];
  /**
   * Index in `ordered` where re-timing begins. Activities before it keep their
   * exact times. `-1` means there is no conflict to resolve.
   */
  firstConflictIndex: number;
  /**
   * Consecutive pairs whose adjacency differs from the current stored order, so
   * their leg has no stored Google travel time and must be priced by the backend
   * before the preview can show exact times.
   */
  newAdjacencies: { from: string; to: string }[];
}

/**
 * Resolved start times snap up to this grid so deconfliction never produces ugly
 * times like 11:37pm. Travel itself is exact (whole minutes); only the resulting
 * start is ceil-snapped — travel ending 15:11 → next start 15:20.
 */
const GRID_MIN = 10;
const ceilTo10 = (mins: number): number => Math.ceil(mins / GRID_MIN) * GRID_MIN;
const floorTo10 = (mins: number): number => Math.floor(mins / GRID_MIN) * GRID_MIN;

/** Activities pushed past 02:00 next day (1440 + 120) mark the day as overpacked. */
const PUSH_CAP_MIN = 1560;

function isTransportCategory(a: ItineraryActivityDetail): boolean {
  const cat = a.category?.toLowerCase() ?? "";
  return cat === "transportation" || cat === "transport" || cat === "travel";
}

const startMinOf = (a: ItineraryActivityDetail): number => parseTimeMins(a.start_time!);
const endMinOf = (a: ItineraryActivityDetail): number =>
  a.end_time ? parseTimeMins(a.end_time) : parseTimeMins(a.start_time!);

/**
 * Target visit window (minutes) for an activity. The user's current start→end
 * window is the source of truth — they placed it. Only fall back to the
 * AI-estimated stay_duration when no window exists, then a 60-minute default.
 * Single-time activities (start set, no end) are points and reserve no window.
 */
function getStayDurationMins(a: ItineraryActivityDetail): number {
  if (a.start_time && a.end_time) {
    const d = parseTimeMins(a.end_time) - parseTimeMins(a.start_time);
    if (d > 0) return d;
  }
  if (a.start_time && !a.end_time) return 0;
  const stay = a.location?.stay_duration;
  if (typeof stay === "number" && stay > 0) return stay;
  return 60;
}

/**
 * Phase 1 (pure): determine the proposed visit order for a day.
 *
 * Starts at the first conflicting activity (earlier activities are frozen) and
 * cascades forward. Locked activities are immovable anchors: an unlocked
 * activity that would overlap a locked anchor is deferred to after it, which —
 * because the timeline is ordered solely by start_time — surfaces as a reorder
 * (e.g. 1,2,3,4 with 3 locked becomes 1,3,2,4). Travel is ignored here (order
 * decisions hinge on whether a window fits before a lock); exact travel is
 * applied later in `cascadeTimes`.
 */
export function computeProposedOrder(input: ResolveOverlapsInput): ProposedOrder {
  const { day, lockedIds } = input;

  const sorted = day.activities
    .filter((a) => !isTransportCategory(a) && a.start_time)
    .sort((a, b) => startMinOf(a) - startMinOf(b));

  const noop: ProposedOrder = { ordered: sorted, firstConflictIndex: -1, newAdjacencies: [] };

  const conflictIds = detectConflicts(day.activities);
  if (conflictIds.size === 0) return noop;

  const firstConflictIndex = sorted.findIndex((a) => conflictIds.has(a.id));
  if (firstConflictIndex < 0) return noop;

  // Frozen prefix keeps its exact order and times.
  const prefix = sorted.slice(0, firstConflictIndex);

  // Tail is re-timed/reordered. Unlocked activities keep their relative order
  // and flow AFTER any locked anchor they would overlap.
  const tail = sorted.slice(firstConflictIndex);
  const unlocked = tail.filter((a) => !lockedIds.has(a.id));
  const locked = tail
    .filter((a) => lockedIds.has(a.id))
    .sort((a, b) => startMinOf(a) - startMinOf(b));

  const mergedTail: ItineraryActivityDetail[] = [];
  let cursor: number | null =
    firstConflictIndex > 0 ? endMinOf(sorted[firstConflictIndex - 1]) : null;
  let ui = 0;
  let li = 0;
  while (ui < unlocked.length || li < locked.length) {
    const u = unlocked[ui];
    const l = locked[li];

    if (!u) {
      mergedTail.push(l);
      cursor = endMinOf(l);
      li++;
      continue;
    }
    if (!l) {
      mergedTail.push(u);
      const base = cursor == null ? startMinOf(u) : cursor;
      cursor = ceilTo10(base) + getStayDurationMins(u);
      ui++;
      continue;
    }

    // Does the unlocked activity's window fit entirely before the locked anchor?
    const base = cursor == null ? startMinOf(u) : cursor;
    const uEnd = ceilTo10(base) + getStayDurationMins(u);
    if (uEnd <= floorTo10(startMinOf(l))) {
      mergedTail.push(u);
      cursor = uEnd;
      ui++;
    } else {
      mergedTail.push(l);
      cursor = endMinOf(l);
      li++;
    }
  }

  const ordered = [...prefix, ...mergedTail];

  // A pair is "new" when its predecessor differs from the stored order — that
  // leg has no stored travel time and must be priced exactly by the backend.
  const origSuccessor = new Map<string, string | undefined>();
  for (let i = 0; i < sorted.length; i++) origSuccessor.set(sorted[i].id, sorted[i + 1]?.id);

  const newAdjacencies: { from: string; to: string }[] = [];
  for (let i = 1; i < ordered.length; i++) {
    const from = ordered[i - 1];
    const to = ordered[i];
    if (origSuccessor.get(from.id) !== to.id) newAdjacencies.push({ from: from.id, to: to.id });
  }

  return { ordered, firstConflictIndex, newAdjacencies };
}

/**
 * Phase 2 (pure): cascade start times over the proposed order.
 *
 * From the first conflict forward, each unlocked activity starts at
 * `previous end + travel`, ceil-snapped to the 10-minute grid; its existing
 * duration is preserved (only the start is recomputed). Locked anchors keep
 * their exact times and only advance the cursor. `legDurations` (keyed
 * `"fromId:toId"`) carries the backend's exact travel seconds for reorder-created
 * legs; unchanged legs fall back to the stored value on the predecessor row.
 * Returns the day's activities with the cascaded rows re-timed.
 */
export function cascadeTimes(
  input: ResolveOverlapsInput,
  proposed: ProposedOrder,
  legDurations: Map<string, number>,
): ItineraryActivityDetail[] {
  const { day, lockedIds } = input;
  const { ordered, firstConflictIndex } = proposed;
  if (firstConflictIndex < 0) return day.activities;

  const byId = new Map(ordered.map((a) => [a.id, a]));
  const retimed = new Map<string, { start: string; end: string | null }>();

  let cursor: number | null =
    firstConflictIndex > 0 ? endMinOf(ordered[firstConflictIndex - 1]) : null;
  let prevId: string | null =
    firstConflictIndex > 0 ? ordered[firstConflictIndex - 1].id : null;

  for (let i = firstConflictIndex; i < ordered.length; i++) {
    const a = ordered[i];

    // Locked anchors are immovable: keep their time, advance the cursor.
    if (lockedIds.has(a.id)) {
      cursor = endMinOf(a);
      prevId = a.id;
      continue;
    }

    const legSec = prevId ? legDurations.get(`${prevId}:${a.id}`) : undefined;
    const travelSec = legSec ?? (prevId ? byId.get(prevId)?.travel_duration_seconds ?? 0 : 0);
    const travelMin = travelSec > 0 ? Math.round(travelSec / 60) : 0;

    const base = cursor == null ? startMinOf(a) : cursor + travelMin;
    const newStart = ceilTo10(base);
    const isPoint = !a.end_time;
    const newEnd = isPoint ? null : newStart + getStayDurationMins(a);

    // Overpacked: stop re-timing and leave the remaining tail at its old times.
    if ((newEnd ?? newStart) > PUSH_CAP_MIN) break;

    retimed.set(a.id, {
      start: minsToHHMM(newStart),
      end: newEnd == null ? null : minsToHHMM(newEnd),
    });
    cursor = newEnd ?? newStart;
    prevId = a.id;
  }

  if (retimed.size === 0) return day.activities;
  return day.activities.map((a) => {
    const t = retimed.get(a.id);
    return t ? { ...a, start_time: t.start, end_time: t.end } : a;
  });
}

/**
 * Detects activities with time conflicts in a day.
 *
 * Checks pairwise activity time overlaps AND transport time overflow (where
 * the prev row's travel_duration_seconds exceeds the gap to the next row).
 * Activities with null end_time contribute a point range [start, start] —
 * they never "overlap" surrounding activities, only their leg into/out of
 * the next/prev row counts.
 */
export function detectConflicts(
  activities: ItineraryActivityDetail[],
): Set<string> {
  function isTransport(a: ItineraryActivityDetail) {
    const cat = a.category?.toLowerCase() ?? "";
    return cat === "transportation" || cat === "transport" || cat === "travel";
  }

  const sorted = activities
    .filter((a) => !isTransport(a) && a.start_time)
    .sort((a, b) => parseTimeMins(a.start_time!) - parseTimeMins(b.start_time!));

  const ranges = sorted.map((a) => {
    const startMin = parseTimeMins(a.start_time!);
    // User-set single-time activities (null end_time) are points — no
    // synthesized window.
    const endMin = !a.end_time
      ? startMin
      : parseTimeMins(a.end_time);
    return { id: a.id, startMin, endMin };
  });

  const result = new Set<string>();

  // Activity-vs-activity time overlaps
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      if (ranges[i].startMin < ranges[j].endMin && ranges[i].endMin > ranges[j].startMin) {
        result.add(ranges[i].id);
        result.add(ranges[j].id);
      }
    }
  }

  // Transport time overflow between consecutive activities. travel_duration_seconds
  // on a row describes the leg LEAVING it (prev -> curr), matching how the backend
  // (route-calculation.ts) populates the column. For zero-duration anchors we use
  // start_time in place of the missing end_time so a leg leaving a lodging row is
  // checked against the gap to its next neighbour.
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    if (!curr.start_time) continue;
    const prevEndMin = prev.end_time
      ? parseTimeMins(prev.end_time)
      : prev.start_time
        ? parseTimeMins(prev.start_time)
        : null;
    if (prevEndMin == null) continue;
    const currStartMin = parseTimeMins(curr.start_time);
    const gap = currStartMin - prevEndMin;
    const rawTravelSecs = prev.travel_duration_seconds ?? 0;
    const adjustedTravelMins = Math.round(rawTravelSecs / 60);
    if (adjustedTravelMins > gap) {
      result.add(prev.id);
      result.add(curr.id);
    }
  }

  return result;
}

/**
 * Returns true if any activities in the day have conflicts
 * (time overlaps or transport time overflow).
 */
export function dayHasConflicts(activities: ItineraryActivityDetail[]): boolean {
  return detectConflicts(activities).size > 0;
}

export interface OptimizeRouteResult {
  optimizedActivities: ItineraryActivityDetail[];
  changes: { activity: ItineraryActivityDetail; newStart: string; newEnd: string; newIndex: number }[];
}
