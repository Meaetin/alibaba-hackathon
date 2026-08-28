"use client";

/**
 * Records that the traveller opened something, for the recently-viewed list.
 *
 * **There is no backend for this.** It wrote a Supabase `recently_viewed` table
 * that this database does not have, so nothing was ever recorded. It is the
 * write half of `useRecentlyViewedQuery`, and wiring either without the other
 * buys nothing.
 *
 * Kept rather than deleted because three pages call it on mount, and a no-op
 * hook is a smaller change than removing three call sites for a feature that
 * may come back.
 */
export function useRecordView(
  _entityType: "link" | "collection" | "itinerary",
  _entityId: string | undefined,
): void {}
