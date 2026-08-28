"use client";

import { useQuery } from "@tanstack/react-query";

import type { SearchResponse } from "@/lib/domain-types";
import { queryKeys } from "@/lib/query/queryKeys";

/**
 * The navbar's search results.
 *
 * **There is no backend for this.** It called a Supabase RPC in a project this
 * build was never pointed at, so it has always resolved to nothing — the
 * difference now is that the emptiness is written down instead of arriving as a
 * failed request. Wiring it means a Neon read and a route under `src/app/api/`.
 *
 * Kept rather than deleted because the search field, its dropdown and its
 * keyboard handling are all still on the page and typed against this shape.
 */
export function useSearchQuery(
  userId: string | null,
  query: string,
  filterType: string | null,
  offset: number,
) {
  return useQuery<SearchResponse>({
    queryKey: queryKeys.search(query, filterType, offset),
    queryFn: async () => ({ results: [], hasMore: false }),
    enabled: !!userId && query.trim().length > 0,
    staleTime: 30 * 1000,
  });
}
