"use client";

import { useQuery } from "@tanstack/react-query";

import type { RecentlyViewedItem } from "@/lib/domain-types";
import { queryKeys } from "@/lib/query/queryKeys";

/**
 * What this traveller looked at last, for the navbar dropdown.
 *
 * **There is no backend for this.** It read a `recently_viewed` table that does
 * not exist in this database. Recording a view needs a table as well as a read,
 * so this is two jobs rather than one; see `useRecordView`, which is the write
 * half and is equally empty.
 *
 * Kept rather than deleted because the dropdown renders an empty state
 * perfectly well and would otherwise have to be taken off the navbar.
 */
export function useRecentlyViewedQuery(userId: string | null, enabled = true) {
  return useQuery<RecentlyViewedItem[]>({
    queryKey: queryKeys.recentlyViewed(userId ?? ""),
    queryFn: async () => [],
    enabled: !!userId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}
