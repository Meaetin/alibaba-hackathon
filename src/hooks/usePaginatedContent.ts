"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

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

// Content-level filter types (excludes "location" which uses a separate hook)
export type ContentFilterType = "links" | "favorites" | "archived";
type SortOption = "modified" | "alphabetical";

const PAGE_SIZE = 24;

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

function buildQuery(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  filter: ContentFilterType,
  sortOption: SortOption,
  offset: number,
  limit: number,
) {
  // Query content directly — ordering works natively without referencedTable
  let query = supabase
    .from("content")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select("*, user_content!inner(user_id, is_bookmarked, is_archived)" as any)
    .eq("user_content.user_id", userId)
    .eq("processing_status", "completed");

  // Filter
  switch (filter) {
    case "favorites":
      query = query
        .eq("user_content.is_bookmarked", true)
        .eq("user_content.is_archived", false);
      break;
    case "archived":
      query = query.eq("user_content.is_archived", true);
      break;
    case "links":
    default:
      break;
  }

  // Sort — directly on content columns
  switch (sortOption) {
    case "modified":
      query = query.order("updated_at", { ascending: false });
      break;
    case "alphabetical":
      query = query.order("content_title", { ascending: true, nullsFirst: false });
      break;
  }

  return query.range(offset, offset + limit - 1);
}

/**
 * Checks whether a content item matches the given filter.
 * Used by the realtime handler to decide whether to prepend new items.
 */
function matchesFilter(item: CompletedContent, filter: ContentFilterType): boolean {
  switch (filter) {
    case "favorites":
      return item.is_bookmarked && !item.is_archived;
    case "archived":
      return item.is_archived;
    case "links":
    default:
      return true;
  }
}

/** Strip the user_content join field from query results */
function extractContent(data: unknown): CompletedContent[] {
  if (!Array.isArray(data)) return [];
  return data.map((row: Record<string, unknown>) => {
    const { user_content: uc, ...rest } = row;
    const ucFields = (uc ?? {}) as Record<string, unknown>;
    return {
      ...rest,
      is_bookmarked: (ucFields.is_bookmarked as boolean) ?? false,
      is_archived: (ucFields.is_archived as boolean) ?? false,
    } as unknown as CompletedContent;
  });
}

export function usePaginatedContent({
  userId,
  filter,
  sortOption,
  pageSize = PAGE_SIZE,
}: UsePaginatedContentOptions): UsePaginatedContentReturn {
  const [content, setContent] = useState<CompletedContent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(0);

  const filterRef = useRef(filter);
  const sortOptionRef = useRef(sortOption);
  filterRef.current = filter;
  sortOptionRef.current = sortOption;
  // Unique per hook instance — realtime-js dedupes channels by topic, so two
  // mounts with the same userId would otherwise share one already-subscribed
  // channel and the second .on('postgres_changes') would throw.
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "");

  const refresh = useCallback(() => {
    if (!userId) return;

    setPage(0);

    const supabase = createClient();
    buildQuery(supabase, userId, filterRef.current, sortOptionRef.current, 0, pageSize).then(
      ({ data }) => {
        const items = extractContent(data);

        setContent(items);
        setHasMore(items.length === pageSize);
      },
    );
  }, [userId, pageSize]);

  // Fetch initial page when user/filter/sort changes
  useEffect(() => {
    if (!userId) {
      setContent([]);
      setIsLoading(false);
      setHasMore(true);
      setPage(0);
      return;
    }

    setIsLoading(true);
    setPage(0);

    const supabase = createClient();
    buildQuery(supabase, userId, filter, sortOption, 0, pageSize).then(
      ({ data }) => {
        const items = extractContent(data);

        setContent(items);
        setHasMore(items.length === pageSize);
        setIsLoading(false);
      },
    );
  }, [userId, filter, sortOption, pageSize]);

  // Load next page
  const loadMore = useCallback(() => {
    if (!userId || isLoadingMore || !hasMore) return;

    const nextPage = page + 1;
    const offset = nextPage * pageSize;

    setIsLoadingMore(true);

    const supabase = createClient();
    buildQuery(supabase, userId, filterRef.current, sortOptionRef.current, offset, pageSize).then(
      ({ data }) => {
        const items = extractContent(data);

        setContent((prev) => {
          // Deduplicate: items may have arrived via realtime already
          const existingIds = new Set(prev.map((c) => c.id));
          const newItems = items.filter((c) => !existingIds.has(c.id));
          return [...prev, ...newItems];
        });

        setHasMore(items.length === pageSize);
        setPage(nextPage);
        setIsLoadingMore(false);
      },
    );
  }, [userId, isLoadingMore, hasMore, page, pageSize]);

  // Realtime: listen for content changes
  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const handleChange = (payload: { eventType: string; new?: Record<string, unknown>; old?: Record<string, unknown> }) => {
      const { eventType } = payload;
      const currentFilter = filterRef.current;

      if (eventType === "DELETE") {
        const id = (payload.old as { id: string })?.id;
        if (id) {
          setContent((prev) => prev.filter((c) => c.id !== id));
        }
        return;
      }

      const item = payload.new as unknown as CompletedContent;
      if (!item || item.processing_status !== "completed") return;

      setContent((prev) => {
        const existingIndex = prev.findIndex((c) => c.id === item.id);

        if (existingIndex !== -1) {
          const next = [...prev];
          next[existingIndex] = item;
          return next;
        }

        if (matchesFilter(item, currentFilter)) {
          return [item, ...prev];
        }

        return prev;
      });
    };

    const subscribe = () => {
      if (disposed) return;

      activeChannel = supabase
        .channel(`completed_content_${userId}_${instanceId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "content",
            filter: "processing_status=eq.completed",
          },
          handleChange,
        )
        .subscribe((status) => {
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
            console.warn(`[usePaginatedContent] subscription ${status}, reconnecting…`);
            if (activeChannel) {
              supabase.removeChannel(activeChannel);
              activeChannel = null;
            }
            reconnectTimer = setTimeout(subscribe, 3000);
          }
        });
    };

    subscribe();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (activeChannel) supabase.removeChannel(activeChannel);
    };
  }, [userId, instanceId]);

  return { content, isLoading, isLoadingMore, hasMore, loadMore, refresh };
}
