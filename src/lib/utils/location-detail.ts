/** Shared display helpers for the location-detail surfaces (itinerary side
 *  panel + the standalone collections/links detail view). Keeps the stay-duration
 *  phrasing, price-range formatting, and opening-hours parsing identical across
 *  both so the two views never drift. */

import type { PriceRange } from "@/lib/maps/price-range";

/** Re-exported so the card surfaces keep importing their types from one place,
 *  while `price-range.ts` stays the single definition both write paths flatten to. */
export type { PriceRange };

/** Google `weekdayDescriptions` (Monday-first) from a `regular_opening_hours` blob. */
export function weekdayDescriptionsFrom(hours?: unknown): string[] {
  if (!hours || typeof hours !== "object") return [];
  const descriptions = (hours as Record<string, unknown>).weekdayDescriptions;
  return Array.isArray(descriptions) ? (descriptions as string[]) : [];
}

/** Index into Monday-first `weekdayDescriptions` for today.
 *  JS getDay(): 0=Sun…6=Sat, so shift Sunday to the end. */
export function todayWeekdayIndex(): number {
  return (new Date().getDay() + 6) % 7;
}

/** "People usually spend around 2h 30mins here" from a stay duration in minutes. */
export function formatStaySentence(minutes?: number | null): string | null {
  if (!minutes || minutes <= 0) return null;
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  const parts = [
    hours > 0 ? `${hours}h` : "",
    mins > 0 ? `${mins}min${mins === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `People usually spend around ${parts.join(" ")} here`;
}

/** Strip the scheme + leading `www.` from a URL for display ("argo.so/about"). */
export function formatDisplayUrl(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?/, "");
}

/** "VND 1 - 100,000 per person" from the parsed `price_range` column. */
export function formatPriceRange(range?: PriceRange | null): string | null {
  if (!range) return null;
  const { startPrice, endPrice, currency } = range;
  if (startPrice == null && endPrice == null) return null;
  const prefix = currency ? `${currency} ` : "";
  const fmt = (n: number) => n.toLocaleString("en-US");
  let amount: string;
  if (startPrice != null && endPrice != null) amount = `${fmt(startPrice)} - ${fmt(endPrice)}`;
  else if (endPrice != null) amount = `Up to ${fmt(endPrice)}`;
  else amount = `From ${fmt(startPrice!)}`;
  return `${prefix}${amount} per person`;
}
