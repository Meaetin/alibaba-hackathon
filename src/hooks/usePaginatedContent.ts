"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { getContent } from "@/lib/api/content";

/**
 * The analyzed-links grid on `/links`.
 *
 * It reads `GET /api/content`, which returns the traveller's whole library
 * newest-first. There is **no pagination**: a person saves tens of links, so
 * `hasMore` is always false and `loadMore` does nothing rather than the hook
 * pretending to a cursor the endpoint has no concept of. The page's
 * infinite-scroll sentinel reads `hasMore` and simply never fires. Same shape,
 * and the same reasoning, as `useDashboardRecent`.
 *
 * `filter` selects between "links" and "nothing". `favorites` and `archived`
 * are still on the page as chips and still work, but `is_bookmarked` and
 * `is_archived` are pinned false server-side — they belong to features whose
 * backend left with the old REST API — so those two chips list nothing.
 */

export interface CompletedContent {
  id: string;
  content_type: "video" | "webpage";
  content_url: string;
  content_title: string | null;
  content_thumbnail: string | null;
  content_author: string | null;
  platform: string | null;
  generated_summary: string | null;
  location_count: number;
  processing_status: string;
  created_at: string;
  updated_at: string;
  is_bookmarked: boolean;
  is_archived: boolean;
}

/** Content-level filters. "location" has its own hook. */
export type ContentFilterType = "links" | "favorites" | "archived";
type SortOption = "modified" | "alphabetical";

interface UsePaginatedContentOptions {
  userId: string | null;
  filter: ContentFilterType;
  sortOption: SortOption;
  pageSize?: number;
}

interface UsePaginatedContentReturn {
  content: CompletedContent[];
  isLoading: boolean;
  isLoadingMore: boolean;
  hasMore: boolean;
  loadMore: () => void;
  refresh: () => void;
}

const EMPTY: CompletedContent[] = [];

/** Only this one lists links. The other two name flags that are pinned false
 *  server-side, so they would list nothing whatever the query said. */
const LINK_FILTERS: ReadonlySet<ContentFilterType> = new Set<ContentFilterType>(["links"]);

function sortContent(items: CompletedContent[], sortOption: SortOption): CompletedContent[] {
  const copy = [...items];
  if (sortOption === "alphabetical") {
    copy.sort((a, b) => (a.content_title ?? "").localeCompare(b.content_title ?? ""));
  } else {
    copy.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }
  return copy;
}

export function usePaginatedContent({
  userId,
  filter,
  sortOption,
}: UsePaginatedContentOptions): UsePaginatedContentReturn {
  const [rawContent, setRawContent] = useState<CompletedContent[]>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);

  // Read through a ref so `load` keeps a stable identity: the page passes
  // `refresh` into effects, and a new function every render would re-fire them.
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const load = useCallback(async () => {
    if (!userId || !LINK_FILTERS.has(filterRef.current)) {
      setRawContent(EMPTY);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      setRawContent(await getContent());
    } catch (error) {
      // An empty grid, not a broken page. The list is not the only thing on
      // `/links` and a failed read should not take the rest of it down.
      console.error("[usePaginatedContent] the link library could not be read", error);
      setRawContent(EMPTY);
    } finally {
      setIsLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void load();
  }, [load, filter]);

  const content = useMemo(() => sortContent(rawContent, sortOption), [rawContent, sortOption]);

  return {
    content,
    isLoading,
    isLoadingMore: false,
    hasMore: false,
    loadMore: () => {},
    refresh: () => {
      void load();
    },
  };
}
