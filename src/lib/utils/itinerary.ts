import type { ItineraryActivityDetail } from "@/lib/supabase/queries/home";
import type { CalendarActivity } from "@/components/ui/calendar/ActivityTimeslot";
import { weekdayDescriptionsFrom } from "@/lib/utils/location-detail";

export function timeToHour(time: string | null, timezone?: string): number {
  if (!time) return 0;
  if (time.includes("T")) {
    const d = new Date(time);
    if (!isNaN(d.getTime())) {
      if (timezone) {
        const parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: timezone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).formatToParts(d);
        const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
        const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
        return (h % 24) + m / 60;
      }
      return d.getUTCHours() + d.getUTCMinutes() / 60;
    }
  }
  const parts = time.split(":");
  return parseInt(parts[0], 10) + (parseInt(parts[1], 10) || 0) / 60;
}

export function hourToISO(hour: number, date: Date, timezone: string): string {
  if (!isFinite(hour) || isNaN(date.getTime())) {
    return new Date(0).toISOString();
  }
  const totalMins = Math.round(hour * 60);
  const extraDays = Math.floor(totalMins / 1440);
  const dayMins = ((totalMins % 1440) + 1440) % 1440;
  const h = Math.floor(dayMins / 60);
  const m = dayMins % 60;

  const adjusted = new Date(date);
  adjusted.setDate(adjusted.getDate() + extraDays);
  const yr = adjusted.getFullYear();
  const mo = String(adjusted.getMonth() + 1).padStart(2, "0");
  const d = String(adjusted.getDate()).padStart(2, "0");
  const hStr = String(h).padStart(2, "0");
  const mStr = String(m).padStart(2, "0");

  const candidate = new Date(`${yr}-${mo}-${d}T${hStr}:${mStr}:00Z`);

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(candidate);
  const gotYear = parseInt(parts.find((p) => p.type === "year")!.value);
  const gotMonth = parseInt(parts.find((p) => p.type === "month")!.value);
  const gotDay = parseInt(parts.find((p) => p.type === "day")!.value);
  const gotH = parseInt(parts.find((p) => p.type === "hour")!.value);
  const gotM = parseInt(parts.find((p) => p.type === "minute")!.value);

  // Include the formatted calendar date in the offset calculation. Comparing
  // only clock fields turns UTC evenings in positive-offset zones into a -17h
  // offset instead of +7h, which persisted reordered activities one day late.
  const displayedAsUTC = Date.UTC(gotYear, gotMonth - 1, gotDay, gotH % 24, gotM);
  const offsetMs = displayedAsUTC - candidate.getTime();
  return new Date(candidate.getTime() - offsetMs).toISOString();
}

export function toCalendarActivity(a: ItineraryActivityDetail, timezone?: string): CalendarActivity {
  const photoUrls = a.location?.photo_urls ?? undefined;
  return {
    id: a.id,
    dayId: a.day_id,
    dayIndex: a.day_index,
    name: a.name,
    startHour: timeToHour(a.start_time, timezone),
    endHour: timeToHour(a.end_time, timezone),
    locationId: a.location?.id ?? undefined,
    address: a.location?.formatted_address ?? undefined,
    // Only two categories survive: flights and lodging were removed along with
    // the backend that supplied them.
    category: a.category,
    photoUrl: a.photo_url ?? photoUrls?.[0] ?? undefined,
    photoUrls: photoUrls ?? undefined,
    placeId: a.place_id ?? undefined,
    latitude: a.location?.latitude ?? undefined,
    longitude: a.location?.longitude ?? undefined,
    openingHours: formatOpeningHours(a.location?.regular_opening_hours ?? undefined) || undefined,
    travelDistanceMeters: a.travel_distance_meters ?? undefined,
    travelDurationSeconds: a.travel_duration_seconds ?? undefined,
  };
}

export function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toLocalDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatDateRangeLabel(startDate: string, endDate: string): string {
  const fmt = (d: Date) => d.toLocaleDateString("en-US", { day: "numeric", month: "long" });
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  if (start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear()) {
    return `${start.toLocaleDateString("en-US", { month: "long" })} ${start.getDate()} – ${end.getDate()}`;
  }
  return `${fmt(start)} – ${fmt(end)}`;
}

export function formatOpeningHours(hours?: unknown): string {
  return weekdayDescriptionsFrom(hours).join("\n");
}

export function formatStayDuration(minutes?: number): string | undefined {
  if (!minutes) return undefined;
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}
