import type { ItineraryActivityDetail } from "@/lib/supabase/queries/home";
import { parseLocalDate } from "@/lib/utils/itinerary";
import type { LodgingInfo } from "./ItineraryDayColumn/sequence";

/**
 * Minutes past midnight for a stored time, read in the itinerary's timezone.
 *
 * The default is UTC and it is load-bearing, not a shrug. `minutesToISO` builds
 * every stored timestamp by adding minutes-past-midnight to a UTC midnight, so
 * reading it back in UTC is that function's exact inverse. Reading it in the
 * browser's zone is not: a viewer at UTC+8 turns a 17:15 stop into 01:15 the
 * next morning, which sorts it to the top of the day. The page renders its
 * labels in UTC, so the times looked right while the order was rotated by the
 * viewer's offset — visible only to somebody east of Greenwich.
 */
export function parseTimeMins(t: string, timezone = "UTC"): number {
  if (t.includes("T")) {
    const d = new Date(t);
    if (!isNaN(d.getTime())) {
      const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(d);
      const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
      const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
      return (h % 24) * 60 + m;
    }
  }
  const [h, m] = t.split(":");
  return parseInt(h, 10) * 60 + (parseInt(m, 10) || 0);
}

export function formatDayDate(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  return d.toLocaleDateString("en-US", { day: "numeric", month: "long" });
}

export function formatTimeRange(start: string | null, end: string | null, timezone: string | null = "UTC", use24h = false): string {
  if (!start && !end) return "";
  const fmt = (t: string) => {
    if (t.includes("T")) {
      const d = new Date(t);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString("en-US", {
          hour: use24h ? "2-digit" : "numeric",
          minute: "2-digit",
          hour12: !use24h,
          ...(timezone ? { timeZone: timezone } : {}),
        }).toLowerCase();
      }
    }
    const [h, m] = t.split(":");
    const hour = parseInt(h, 10);
    const displayHour = hour >= 24 ? hour - 24 : hour;
    if (use24h) return `${displayHour.toString().padStart(2, "0")}:${m || "00"}`;
    const ampm = displayHour >= 12 ? "pm" : "am";
    const h12 = displayHour % 12 || 12;
    return `${h12}:${m || "00"} ${ampm}`;
  };
  if (start && end) return `${fmt(start)} – ${fmt(end)}`;
  if (start) return fmt(start);
  return "";
}

export function minsToHHMM(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/**
 * True when two time fields represent the same wall-clock minute regardless of
 * format (ISO timestamp vs "HH:MM"). Diffing original DB times (ISO) against
 * resolver output ("HH:MM") with `===` always reports a change even when the
 * time is identical; compare parsed minutes instead.
 */
export function sameWallTime(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == b;
  return parseTimeMins(a) === parseTimeMins(b);
}

export function isRealActivity(activity: ItineraryActivityDetail): boolean {
  const cat = activity.category?.toLowerCase() ?? "";
  return !["transportation", "transport", "travel"].includes(cat);
}

/**
 * Builds a map of day ID → LodgingInfo from a list of lodging records.
 *
 * Each lodging covers a date range (check_in_date → check_out_date). For every
 * day that falls within that range, an LodgingInfo entry is emitted:
 *   - check-in day  → includes checkInTime  (defaults to "15:00")
 *   - check-out day → includes checkOutTime (defaults to "11:00")
 *   - middle days   → neither time field is set
 */
export function buildLodgingMap(
  lodgings: Array<{
    name?: string;
    check_in_date?: string;
    check_in_time?: string;
    check_out_date?: string;
    check_out_time?: string;
  }>,
  days: Array<{ id: string; date: string }>,
): Record<string, LodgingInfo> {
  const result: Record<string, LodgingInfo> = {};

  for (const accom of lodgings) {
    if (!accom.check_in_date || !accom.check_out_date) continue;

    const checkInDate = accom.check_in_date;
    const checkOutDate = accom.check_out_date;
    const name = accom.name ?? "Lodging";

    for (const day of days) {
      if (day.date < checkInDate || day.date > checkOutDate) continue;

      const info: LodgingInfo = { name };

      if (day.date === checkInDate) {
        info.checkInTime = accom.check_in_time ?? "15:00";
      }
      if (day.date === checkOutDate) {
        info.checkOutTime = accom.check_out_time ?? "11:00";
      }

      // Last writer wins if multiple lodgings cover the same day
      result[day.id] = info;
    }
  }

  return result;
}
