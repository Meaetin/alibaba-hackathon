import { parseTimeMins } from "./activity-utils";

/**
 * Closure check for a scheduled activity against its location's opening hours.
 *
 * Derived (computed during render) rather than triggered after each move — the
 * activity's start/end times live in React state, so re-evaluating here covers
 * every change (drag, manual edit, resolve-conflicts, optimize-route, first
 * render) with no handler wiring.
 *
 * Works in minutes-of-day against the weekday of the day's calendar date.
 * Mirrors the weekday/overnight logic of the backend
 * `opening-hours-parser.ts#getTimeWindowsForDate`, but without UTC conversion
 * since the card already shows trip-local times.
 */
export type OpeningHoursStatus =
  | { kind: "ok" } // open, incl. missing/empty hours (treated as 24h) → render nothing
  | { kind: "closed-today"; label: string } // "Closed Sat"
  | { kind: "closed-during"; label: string } // "Closed at this time"
  | { kind: "opens-late"; label: string } // "Opens 9:00 am"
  | { kind: "closes-early"; label: string }; // "Closes 5:00 pm"

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MINUTES_PER_DAY = 1440;

/** Format minutes-of-day as "9:00 AM", matching CompactActivityCard's own `formatTime`. */
function fmtMin(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = Math.round(min % 60);
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const OK: OpeningHoursStatus = { kind: "ok" };

type Endpoint = { day?: number; hour?: number; minute?: number; time?: string };
type Period = { open?: Endpoint; close?: Endpoint };

/** Minutes-of-day for an open/close endpoint in either v1 ({hour,minute}) or ({time:"HHMM"}) shape. */
function endpointToMin(ep: Endpoint | undefined): number | null {
  if (!ep) return null;
  if (typeof ep.hour === "number") return ep.hour * 60 + (ep.minute ?? 0);
  if (typeof ep.time === "string" && ep.time.length >= 3) {
    return parseInt(ep.time.slice(0, 2), 10) * 60 + parseInt(ep.time.slice(2, 4), 10);
  }
  return null;
}

/** Weekday (0=Sun..6=Sat) of a "YYYY-MM-DD" date, free of local-timezone drift. */
function weekdayOf(dayDate: string): number | null {
  const parts = dayDate.split("-").map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [y, m, d] = parts;
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Open windows (minutes-of-day) that apply to `weekday`, including overnight spillover. */
function windowsForWeekday(periods: Period[], weekday: number): Array<[number, number]> {
  const windows: Array<[number, number]> = [];
  const prevDay = (weekday + 6) % 7;

  for (const period of periods) {
    const openMin = endpointToMin(period.open);
    if (openMin == null) continue;
    const openDay = period.open?.day ?? weekday;
    const closeMin = period.close ? endpointToMin(period.close) : MINUTES_PER_DAY;
    const closeDay = period.close?.day ?? openDay;

    // Period that starts on this weekday (extend past midnight if it closes the next day).
    if (openDay === weekday) {
      const end = closeMin == null ? MINUTES_PER_DAY : closeDay !== openDay ? closeMin + MINUTES_PER_DAY : closeMin;
      windows.push([openMin, end]);
    }
    // Overnight period opened the previous day that spills into this morning.
    else if (period.close && closeDay === weekday && openDay === prevDay) {
      windows.push([0, closeMin ?? 0]);
    }
  }

  return windows;
}

export function getOpeningHoursStatus(
  openingHours: Record<string, unknown> | null | undefined,
  dayDate: string,
  startTime: string | null,
  endTime: string | null,
  timezone?: string,
): OpeningHoursStatus {
  if (!openingHours || typeof openingHours !== "object") return OK;
  const periods = (openingHours as { periods?: Period[] }).periods;
  if (!Array.isArray(periods) || periods.length === 0) return OK; // no data = treat as 24h

  // Google encodes 24/7 as a single period: { open: { day: 0, ... } } with no close.
  if (periods.length === 1 && periods[0].open?.day === 0 && !periods[0].close) return OK;

  if (!startTime) return OK; // nothing scheduled to evaluate

  const weekday = weekdayOf(dayDate);
  if (weekday == null) return OK;

  const startMin = parseTimeMins(startTime, timezone);
  let endMin = endTime ? parseTimeMins(endTime, timezone) : startMin;
  // Visit wraps past midnight (e.g. 23:50 → 00:00); align with the day's
  // overnight open windows, which also extend past 1440. (Cf. overlap-utils.ts.)
  if (endMin < startMin) endMin += MINUTES_PER_DAY;

  const windows = windowsForWeekday(periods, weekday);
  if (windows.length === 0) {
    return { kind: "closed-today", label: `Closed ${WEEKDAY_SHORT[weekday]}` };
  }

  // Among windows the visit touches (inclusive, so a zero-duration point inside
  // a window still counts as open), pick the one it overlaps most.
  let best: [number, number] | null = null;
  let bestOverlap = -Infinity;
  for (const [o, c] of windows) {
    if (endMin < o || startMin > c) continue; // no contact with this window
    const overlap = Math.min(endMin, c) - Math.max(startMin, o);
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = [o, c];
    }
  }

  if (!best) {
    return { kind: "closed-during", label: "Closed at this time" };
  }

  const [o, c] = best;
  if (startMin < o) return { kind: "opens-late", label: `Opens ${fmtMin(o)}` };
  if (endMin > c) return { kind: "closes-early", label: `Closes ${fmtMin(c)}` };
  return OK;
}
