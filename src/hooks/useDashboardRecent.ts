"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getContent } from "@/lib/api/content";
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
 * ## It shows itineraries and analyzed links
 *
 * It used to merge five kinds of thing — links, collections, locations,
 * favourites, archived — out of Supabase tables this build does not have, so it
 * resolved to an empty array on every call. Two of the five have a backend now:
 * `GET /api/itineraries` and `GET /api/content`.
 *
 * `recent` shows both, interleaved by date, which is what a dashboard called
 * "recent" should mean. `itinerary` and `links` narrow to one kind each. The
 * remaining chips — collections, locations, favourites, archived — still name
 * backends that are gone and still list nothing.
 *
 * **The two reads are independent.** One failing must not empty the grid of
 * the other kind: a link library that cannot be read is not a reason to hide
 * somebody's trips.
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

/** Which filters list which kind. Everything else lists nothing. */
const ITINERARY_FILTERS: ReadonlySet<FilterType> = new Set<FilterType>(["recent", "itinerary"]);
const LINK_FILTERS: ReadonlySet<FilterType> = new Set<FilterType>(["recent", "links"]);

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
    const filter = filterRef.current;
    const wantsItineraries = ITINERARY_FILTERS.has(filter);
    const wantsLinks = LINK_FILTERS.has(filter);

    if (!userId || (!wantsItineraries && !wantsLinks)) {
      setRawItems([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    // `allSettled`, not `all`: the grid's empty state is the right answer to a
    // failed read, but only for the kind that failed. One broken endpoint
    // emptying the other kind's cards would look like data loss.
    const [trips, links] = await Promise.allSettled([
      wantsItineraries ? getItineraries() : Promise.resolve([]),
      wantsLinks ? getContent() : Promise.resolve([]),
    ]);

    if (trips.status === "rejected") {
      console.error("[dashboard] the itinerary list could not be loaded", trips.reason);
    }
    if (links.status === "rejected") {
      console.error("[dashboard] the link library could not be loaded", links.reason);
    }

    const items: RecentContentItem[] = [
      ...(trips.status === "fulfilled" ? trips.value : []).map((itinerary) => ({
        id: itinerary.id,
        type: "itinerary" as const,
        name: itinerary.name,
        thumbnail_url: itinerary.thumbnail_url ?? null,
        updated_at: itinerary.updated_at,
      })),
      ...(links.status === "fulfilled" ? links.value : []).map((item) => ({
        id: item.id,
        type: "link" as const,
        // A link with no title still needs a name on its card; the URL is the
        // most useful thing left to call it.
        name: item.content_title ?? item.content_url,
        thumbnail_url: item.content_thumbnail,
        updated_at: item.updated_at,
        metadata: {
          platform: item.platform,
          location_count: item.location_count,
          content_url: item.content_url,
        },
      })),
    ];

    setRawItems(items);
    setIsLoading(false);
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
