"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getItineraries } from "@/lib/api/itineraries";
import { type FilterType, type RecentContentItem } from "@/lib/domain-types";

type SortOption = "modified" | "alphabetical";

interface UseDashboardRecentOptions {
  userId: string | null;
  filter: FilterType;
  sortOption: SortOption;
}

interface UseDashboardRecentReturn {
  items: RecentContentItem[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  removeItem: (id: string) => void;
  updateItem: (id: string, patch: Partial<RecentContentItem>) => void;
  prependItem: (item: RecentContentItem) => void;
  refresh: () => void;
}

/**
 * The dashboard grid on `/home` and `/profile`.
 *
 * ## It shows itineraries and nothing else, and that is the honest shape
 *
 * It used to merge five kinds of thing — links, collections, locations,
 * favourites, archived — out of Supabase tables this build does not have, so it
 * resolved to an empty array on every call. Itineraries are the one kind that
 * has a backend, so that is what it returns.
 *
 * `filter` therefore selects between "itineraries" and "nothing". The parameter
 * stays because the filter chips are still on the page and still work; the
 * other filters simply have nothing to list.
 *
 * ## Pagination is a no-op, deliberately
 *
 * `GET /api/itineraries` returns the traveller's whole list — a person has
 * tens of trips, not thousands. `hasMore` is always false and `loadMore` does
 * nothing, rather than the hook pretending to a cursor the endpoint has no
 * concept of. The infinite-scroll sentinel on the page reads `hasMore` and
 * simply never fires.
 */
function sortItems(data: RecentContentItem[], sortOption: SortOption): RecentContentItem[] {
  const copy = [...data];
  if (sortOption === "alphabetical") {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    copy.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }
  return copy;
}

/** Only these two list itineraries. The rest name backends that are gone. */
const ITINERARY_FILTERS: ReadonlySet<FilterType> = new Set<FilterType>(["recent", "itinerary"]);

export function useDashboardRecent({
  userId,
  filter,
  sortOption,
}: UseDashboardRecentOptions): UseDashboardRecentReturn {
  const [rawItems, setRawItems] = useState<RecentContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = useCallback(async () => {
    if (!userId || !ITINERARY_FILTERS.has(filterRef.current)) {
      setRawItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const itineraries = await getItineraries();
      setRawItems(
        itineraries.map((itinerary) => ({
          id: itinerary.id,
          type: "itinerary" as const,
          name: itinerary.name,
          thumbnail_url: itinerary.thumbnail_url ?? null,
          updated_at: itinerary.updated_at,
        })),
      );
    } catch (error) {
      // The grid's empty state is the right answer to a failed read; a thrown
      // error here would take the whole dashboard down with it.
      console.error("[dashboard] the recent list could not be loaded", error);
      setRawItems([]);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, filter]);

  const removeItem = useCallback((id: string) => {
    setRawItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<RecentContentItem>) => {
    setRawItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const prependItem = useCallback((item: RecentContentItem) => {
    setRawItems((prev) =>
      prev.some((existing) => existing.id === item.id) ? prev : [item, ...prev],
    );
  }, []);

  const refresh = useCallback(() => {
    void load();
  }, [load]);

  // Memoized so the identity only changes when the data does. Consumers put
  // `items` in effect dependency arrays; a fresh array every render made those
  // effects re-run on their own setState and blow the update depth.
  const items = useMemo(() => sortItems(rawItems, sortOption), [rawItems, sortOption]);

  return {
    items,
    isLoading,
    isLoadingMore: false,
    hasMore: false,
    loadMore: () => {},
    removeItem,
    updateItem,
    prependItem,
    refresh,
  };
}
