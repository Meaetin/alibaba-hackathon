interface FilterToolbarSkeletonProps {
  /** Number of filter-pill placeholders to render on the left. */
  pillCount?: number;
  className?: string;
}

/**
 * Loading placeholder for the filter-pill row + search/sort actions toolbar
 * shared across the list and detail loading screens.
 */
export function FilterToolbarSkeleton({
  pillCount = 4,
  className,
}: FilterToolbarSkeletonProps) {
  return (
    <div
      className={`filter-toolbar-skeleton flex items-center justify-between ${className ?? ""}`}
    >
      <div className="filter-toolbar-skeleton-pills flex gap-1">
        {Array.from({ length: pillCount }).map((_, i) => (
          <div key={i} className="size-8 rounded-lg bg-surface-muted animate-pulse" />
        ))}
      </div>
      <div className="filter-toolbar-skeleton-actions flex gap-2 items-center">
        <div className="h-9 w-48 rounded-lg bg-surface-muted animate-pulse" />
        <div className="h-9 w-16 rounded-lg bg-surface-muted animate-pulse" />
      </div>
    </div>
  );
}
