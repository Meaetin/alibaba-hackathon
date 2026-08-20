"use client";

import { Clock, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { RecentCard } from "@/components/ui/cards/RecentCard";
import { SearchResultCard } from "./SearchResultCard";
import { FilterChip } from "./FilterChip";
import { Button } from "@/components/ui/primitives/Button";

type SearchItemType = "link" | "collection" | "itinerary";

interface RecentItem {
  id: string;
  type: SearchItemType;
  label: string;
  imageUrl?: string;
  previewImages?: string[];
}

interface SearchResult {
  id: string;
  entity_type: SearchItemType | "location";
  name: string;
  thumbnail_url: string | null;
  preview_images?: string[];
}

interface SearchDropdownProps {
  className?: string;
  isVisible?: boolean;
  query?: string;
  filter?: { type: SearchItemType; entityId?: string } | null;
  recentItems?: RecentItem[];
  searchResults?: SearchResult[];
  isLoading?: boolean;
  hasMore?: boolean;
  onLoadMore?: () => void;
  onClearRecents?: () => void;
  onSelectItem?: (item: SearchResult) => void;
  onSelectRecentItem?: (item: RecentItem) => void;
  onFilterByType?: (type: SearchItemType) => void;
  onFilterByItem?: (item: RecentItem) => void;
}

const TYPE_LABELS: Record<SearchItemType, string> = {
  link: "Links",
  collection: "Collections",
  itinerary: "Itineraries",
};

function SearchDropdown({
  className,
  isVisible = false,
  query,
  filter,
  recentItems = [],
  searchResults = [],
  isLoading = false,
  hasMore = false,
  onLoadMore,
  onClearRecents,
  onSelectItem,
  onSelectRecentItem,
  onFilterByType,
  onFilterByItem,
}: SearchDropdownProps) {
  const hasQuery = query && query.trim().length > 0;
  const hasResults = searchResults.length > 0;

  return (
    <div
      data-slot="search-dropdown"
      className={cn(
        "search-dropdown rounded-xl border border-edge bg-surface p-3",
        "shadow-default overflow-hidden",
        "flex flex-col gap-6",
        "w-full max-w-[520px]",
        !isVisible && "hidden",
        className,
      )}
    >
      <div className="search-dropdown-content flex flex-col gap-6">
        {/* Search In Section — only when no filter is set and not searching */}
        {!filter && !hasQuery && (
          <div className="search-in-section flex flex-col gap-2.5">
            <span className="type-body-3 text-content-secondary">Search in</span>
            <div className="search-in-filters flex items-center gap-2 overflow-x-auto scrollbar-none">
              {(["link", "collection", "itinerary"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => onFilterByType?.(type)}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-1 rounded-full border border-edge pl-2 pr-3",
                    "bg-action-secondary type-body-2 font-medium text-content",
                    "transition-colors hover:bg-action-secondary-hover",
                  )}
                >
                  <CategoryBadge category={type} />
                  <span>{TYPE_LABELS[type]}</span>
                </button>
              ))}
              {recentItems.map((item) => (
                <FilterChip
                  key={`filter-${item.id}`}
                  id={item.id}
                  type={item.type}
                  label={item.label}
                  thumbnailUrl={item.previewImages?.[0] ?? item.imageUrl}
                  onClick={() => onFilterByItem?.(item)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Recently Viewed Section — hidden when searching */}
        {!hasQuery && (
          <>
            {recentItems.length > 0 ? (
              <div className="recently-viewed-section flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <span className="type-body-3 text-content-secondary">
                    Recently viewed
                  </span>
                  {onClearRecents && (
                    <button
                      type="button"
                      onClick={onClearRecents}
                      className="type-body-3 text-content-secondary transition-colors hover:text-content"
                    >
                      Clear
                    </button>
                  )}
                </div>
                <div className="recently-viewed-grid flex gap-2 overflow-x-auto pb-0.5 scrollbar-none">
                  {recentItems.slice(0, 8).map((item) => (
                    <RecentCard
                      key={item.id}
                      id={item.id}
                      type={item.type}
                      label={item.label}
                      imageUrl={item.imageUrl}
                      previewImages={item.previewImages}
                      onClick={() => onSelectRecentItem?.(item)}
                    />
                  ))}
                </div>
              </div>
            ) : (
              <div className="empty-recent flex flex-col items-center gap-2 py-3">
                <Clock className="size-5 text-content-secondary" />
                <span className="type-body-2 text-content-secondary">
                  No recently viewed
                </span>
              </div>
            )}
          </>
        )}

        {/* Search Results — only when query is active */}
        {hasQuery && (
          <div className="search-results-section flex flex-col gap-2.5">
            {isLoading && !hasResults && (
              <div className="search-loading flex items-center justify-center py-6">
                <Loader2 className="size-5 text-content-secondary animate-spin" />
              </div>
            )}

            {hasResults && (
              <div className="search-results-grid max-h-[400px] overflow-y-auto scrollbar-none">
                <div className="flex flex-wrap gap-2">
                  {searchResults.map((item) => (
                    <SearchResultCard
                      key={item.id}
                      id={item.id}
                      type={item.entity_type}
                      name={item.name}
                      imageUrl={item.thumbnail_url ?? undefined}
                      previewImages={item.preview_images}
                      onClick={() => onSelectItem?.(item)}
                    />
                  ))}
                </div>

                {hasMore && (
                  <div className="load-more-container flex justify-center pt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={onLoadMore}
                      disabled={isLoading}
                    >
                      {isLoading ? "Loading..." : "Load more"}
                    </Button>
                  </div>
                )}
              </div>
            )}

            {!isLoading && !hasResults && hasQuery && (
              <div className="no-results flex flex-col items-center gap-2 py-6">
                <span className="type-body-2 text-content-secondary">
                  No results found
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

SearchDropdown.displayName = "SearchDropdown";

export { SearchDropdown };
export type { SearchDropdownProps, RecentItem, SearchItemType, SearchResult };
