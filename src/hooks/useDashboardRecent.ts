"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getRecentContent, type FilterType, type RecentContentItem } from "@/lib/supabase/queries/home";

type SortOption = "modified" | "alphabetical";

const PAGE_SIZE = 12;

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

function sortItems(data: RecentContentItem[], sortOption: SortOption): RecentContentItem[] {
  const copy = [...data];
  if (sortOption === "alphabetical") {
    copy.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    copy.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }
  return copy;
}

export function useDashboardRecent({
  userId,
  filter,
  sortOption,
}: UseDashboardRecentOptions): UseDashboardRecentReturn {
  const [rawItems, setRawItems] = useState<RecentContentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  // Cursor = updated_at of the last fetched item (for multi-table merge, this is the
  // last item in the sorted merge). Using a ref avoids stale closure issues in loadMore.
  const cursorRef = useRef<string | undefined>(undefined);

  // Keep filter/sortOption refs current for use in loadMore without causing re-renders
  const filterRef = useRef(filter);
  const sortOptionRef = useRef(sortOption);
  filterRef.current = filter;
  sortOptionRef.current = sortOption;

  // Initial fetch — reset on userId or filter change
  useEffect(() => {
    if (!userId) {
      setRawItems([]);
      setIsLoading(false);
      setHasMore(false);
      cursorRef.current = undefined;
      return;
    }

    setIsLoading(true);
    cursorRef.current = undefined;

    const supabase = createClient();
    getRecentContent(supabase, userId, filter, PAGE_SIZE).then((data) => {
      setRawItems(data);
      setHasMore(data.length === PAGE_SIZE);
      cursorRef.current = data[data.length - 1]?.updated_at;
      setIsLoading(false);
    });
  }, [userId, filter]);

  const loadMore = useCallback(() => {
    if (!userId || isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    const supabase = createClient();

    getRecentContent(supabase, userId, filterRef.current, PAGE_SIZE, cursorRef.current).then((data) => {
      setRawItems((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        const newItems = data.filter((item) => !existingIds.has(item.id));
        return [...prev, ...newItems];
      });
      setHasMore(data.length === PAGE_SIZE);
      cursorRef.current = data[data.length - 1]?.updated_at ?? cursorRef.current;
      setIsLoadingMore(false);
    });
  }, [userId, isLoadingMore, hasMore]);

  const removeItem = useCallback((id: string) => {
    setRawItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<RecentContentItem>) => {
    setRawItems((prev) => prev.map((item) => item.id === id ? { ...item, ...patch } : item));
  }, []);

  const prependItem = useCallback((item: RecentContentItem) => {
    setRawItems((prev) => {
      if (prev.some((existing) => existing.id === item.id)) return prev;
      return [item, ...prev];
    });
  }, []);

  const refresh = useCallback(() => {
    if (!userId) return;
    cursorRef.current = undefined;
    const supabase = createClient();
    getRecentContent(supabase, userId, filterRef.current, PAGE_SIZE).then((data) => {
      setRawItems(data);
      setHasMore(data.length === PAGE_SIZE);
      cursorRef.current = data[data.length - 1]?.updated_at;
    });
  }, [userId]);

  // Memoized so the identity only changes when the data does. Consumers put
  // `items` in effect dependency arrays; a fresh array every render made those
  // effects re-run on their own setState and blow the update depth.
  const items = useMemo(() => sortItems(rawItems, sortOption), [rawItems, sortOption]);

  return { items, isLoading, isLoadingMore, hasMore, loadMore, removeItem, updateItem, prependItem, refresh };
}
