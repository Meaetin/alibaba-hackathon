import type { ItineraryActivityDetail } from "@/lib/supabase/queries/home";
import { timeToHour } from "@/lib/utils/itinerary";

/** Activity and transport times are aligned to this many minutes. */
const TIME_STEP_MIN = 10;

/** Rounds a minutes value up to the next TIME_STEP_MIN mark. */
function ceilToStep(mins: number): number {
  return Math.ceil(mins / TIME_STEP_MIN) * TIME_STEP_MIN;
}

/**
 * Recalculates start/end times for all activities in a day after a reorder.
 * Each activity (after the first) departs at: previous activity's end + the leg
 * leaving the previous activity (travel_* is stored on the origin row). All starts,
 * ends, and travel durations are rounded UP to TIME_STEP_MIN marks so the schedule
 * stays on clean boundaries and rounded travel always fits the gap.
 */
/**
 * Nulls the stored travel leg on the given activities (by id). A leg is stored on
 * its origin row and points at that row's successor, so when a drop changes who
 * follows a card, that card's leg is stale. Clearing it optimistically stops the
 * map from drawing the old leg until the server cascade returns the recomputed one.
 */
export function clearLegs(
  activities: ItineraryActivityDetail[],
  staleIds: Set<string>,
): ItineraryActivityDetail[] {
  if (staleIds.size === 0) return activities;
  return activities.map((a) =>
    staleIds.has(a.id)
      ? { ...a, travel_polyline: null, travel_distance_meters: null, travel_duration_seconds: null }
      : a,
  );
}

export function cascadeDayTimes(
  activities: ItineraryActivityDetail[],
  timezone: string,
): ItineraryActivityDetail[] {
  // Walk the array as given — it is already in `position` order, which is
  // authoritative (migration 122). This used to re-sort by start_time, which
  // silently undid a reorder whenever the times tied, wrapped past midnight, or
  // overlapped; the server cascade orders by position for the same reason.
  const sorted = activities;

  const toMin = (t: string) => Math.round(timeToHour(t, timezone) * 60);
  const fmt = (mins: number) => {
    const hrs = Math.floor(mins / 60);
    const m = mins % 60;
    return `${String(hrs).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };

  const result: ItineraryActivityDetail[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const act = sorted[i];
    if (!act.start_time || !act.end_time) {
      result.push(act);
      continue;
    }

    const origStart = toMin(act.start_time);
    let duration = toMin(act.end_time) - origStart;
    while (duration < 0) duration += 24 * 60;
    duration = Math.max(duration, TIME_STEP_MIN);

    const prev = i > 0 ? result[i - 1] : null;
    let startMin: number;
    if (!prev || !prev.end_time) {
      // First (or post-untimed) activity: just align its own start to a 10-min mark.
      startMin = ceilToStep(origStart);
    } else {
      // The leg INTO this activity is the leg LEAVING prev — stored on prev's row.
      const prevEndMin = toMin(prev.end_time);
      const travelMin =
        prev.travel_duration_seconds && prev.travel_duration_seconds > 0
          ? ceilToStep(prev.travel_duration_seconds / 60)
          : 0;
      const earliestStart = prevEndMin + travelMin;
      // Keep a user-set later start if it already clears travel; otherwise depart on time.
      startMin = Math.max(ceilToStep(origStart), earliestStart);
    }

    const endMin = ceilToStep(startMin + duration);
    result.push({ ...act, start_time: fmt(startMin), end_time: fmt(endMin) });
  }
  return result;
}
