/**
 * Opening hours, in the planner's clock. This is what answers invariant 3 —
 * "every place is open during its assigned window" — for Step 8's validator.
 *
 * Google gives hours as `{ day, hour, minute }` pairs; everything downstream of
 * here counts in integers. So periods are flattened onto a **weekly** clock:
 * minutes since Sunday 00:00, `0 … 10079`. That one choice removes the two
 * awkward cases by construction — a Friday-night bar closing at 02:00 Saturday
 * is an ordinary interval on a weekly clock, and a Saturday-night one closing
 * Sunday is the same interval shifted a week. Neither needs a special branch,
 * and neither needs a `Date`.
 *
 * No timezone handling and no `Date` anywhere: `weekday` is supplied by the
 * caller, the same way `rng` and `now` are injected elsewhere in this pipeline.
 * Google's periods are already local to the place, so comparing them against a
 * local wall clock is the correct arithmetic — converting either side to UTC
 * would be the bug.
 *
 * ## Missing hours are treated as always open
 *
 * A place with no periods is reported open at any time. This is a deliberate
 * decision and it is not free: in the 20-place Singapore probe one place
 * (MacRitchie Nature Trail) had no periods at all, and for a trail "no hours"
 * really does mean "always open". But "always open" and "Google returned
 * nothing" are indistinguishable in the payload, so a museum whose hours failed
 * to come back is also waved through, and invariant 3 silently checks nothing
 * for it.
 *
 * `hasKnownHours` exists so that stays visible: Step 8 can pass a stop on the
 * assumption and still say it was an assumption, rather than presenting an
 * unverified stop as a verified one.
 */

import type { CandidatePlace, OpeningPeriod, OpeningPeriodPoint } from "./types";

/** 0 = Sunday … 6 = Saturday, matching the Places API. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export const MINUTES_PER_DAY = 1440;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

/** A half-open `[start, end)` span in minutes since Sunday 00:00. */
interface WeekSpan {
  start: number;
  end: number;
}

/**
 * Periods arrive from an external API, so they're validated rather than
 * trusted — this is a system boundary, and a `day: 9` would otherwise land as a
 * plausible-looking span in the middle of next week.
 */
function isValidPoint(point: OpeningPeriodPoint | undefined | null): point is OpeningPeriodPoint {
  return (
    point != null &&
    Number.isInteger(point.day) &&
    point.day >= 0 &&
    point.day <= 6 &&
    Number.isInteger(point.hour) &&
    point.hour >= 0 &&
    point.hour <= 24 &&
    Number.isInteger(point.minute) &&
    point.minute >= 0 &&
    point.minute <= 59
  );
}

function weekMinute(point: OpeningPeriodPoint): number {
  return point.day * MINUTES_PER_DAY + point.hour * 60 + point.minute;
}

function weekSpans(periods: readonly OpeningPeriod[]): WeekSpan[] {
  const spans: WeekSpan[] = [];
  for (const period of periods) {
    if (!isValidPoint(period.open) || !isValidPoint(period.close)) continue;
    const start = weekMinute(period.open);
    let end = weekMinute(period.close);
    // A close that lands earlier in the week than its open has wrapped past
    // Saturday midnight. An *equal* close is a zero-length period — bad data,
    // not a hundred and sixty-eight hours of opening — so it stays dropped.
    if (end < start) end += MINUTES_PER_WEEK;
    if (end > start) spans.push({ start, end });
  }
  return spans;
}

/**
 * Can this place's hours actually be reasoned about? False means any
 * `isOpenDuring` answer is an assumption rather than a check — see the module
 * note.
 *
 * Deliberately stricter than "the array is non-empty": periods that survive
 * neither validation nor the zero-length check leave us knowing exactly as much
 * as no periods at all, and a flag whose job is to separate verified from
 * assumed must not report those as verified.
 */
export function hasKnownHours(place: Pick<CandidatePlace, "openingPeriods">): boolean {
  const periods = place.openingPeriods;
  if (!periods || periods.length === 0) return false;
  return periods.some((period) => period.close == null) || weekSpans(periods).length > 0;
}

/**
 * True when the place never closes. Covers both Google's explicit 24/7 encoding
 * (a period with no `close`) and our missing-hours assumption.
 */
export function isAlwaysOpen(place: Pick<CandidatePlace, "openingPeriods">): boolean {
  const periods = place.openingPeriods;
  if (!periods || periods.length === 0) return true;
  return periods.some((period) => period.close == null);
}

/**
 * Is `place` open for the **whole** of `[startMin, endMin]` on `weekday`?
 *
 * The whole visit, not the start of it — a museum that shuts at 17:00 is not a
 * legal home for a 16:30–18:00 stop, and answering on the start time alone is
 * how you end up scheduling an hour inside a locked building.
 *
 * `startMin` / `endMin` are minutes from midnight on that weekday, the same
 * units `pack.ts` stamps onto a segment.
 */
export function isOpenDuring(
  place: Pick<CandidatePlace, "openingPeriods">,
  weekday: Weekday,
  startMin: number,
  endMin: number,
): boolean {
  if (isAlwaysOpen(place)) return true;

  const spans = weekSpans(place.openingPeriods!);
  // Every period was malformed, which leaves us knowing nothing about this
  // place — the same position as having no periods at all, so the same answer.
  if (spans.length === 0) return true;

  const dayStart = weekday * MINUTES_PER_DAY;
  const start = dayStart + startMin;
  const end = dayStart + Math.max(startMin, endMin);

  // The second test catches spans that wrapped past Saturday midnight: a
  // Sunday-morning query sits at the *bottom* of the weekly clock while the
  // span covering it sits at the top, so it's the query that shifts a week.
  return spans.some(
    (span) =>
      (start >= span.start && end <= span.end) ||
      (start + MINUTES_PER_WEEK >= span.start && end + MINUTES_PER_WEEK <= span.end),
  );
}
