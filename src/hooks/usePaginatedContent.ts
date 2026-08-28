"use client";

/**
 * The analyzed-links grid on `/links`.
 *
 * **There is no backend for this.** It paginated a Supabase `content` table and
 * subscribed to a realtime channel for rows finishing analysis — the whole
 * link-analysis pipeline, which was a separate service this repo does not
 * contain. Nothing has ever come back from it in this build.
 *
 * The types stay because `/links` and its card components are typed against
 * them, and the hook keeps its shape so the page compiles unchanged. It reports
 * `isLoading: false` and an empty list immediately, which renders the page's
 * "no links yet" state instead of a spinner that never resolves — the old
 * version's real behaviour, since the failed query left `isLoading` true.
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

export function usePaginatedContent(
  _options: UsePaginatedContentOptions,
): UsePaginatedContentReturn {
  return {
    content: EMPTY,
    isLoading: false,
    isLoadingMore: false,
    hasMore: false,
    loadMore: () => {},
    refresh: () => {},
  };
}
