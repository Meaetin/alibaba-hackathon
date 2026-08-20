"use client";

import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";

interface FilterChipProps {
  id: string;
  type: "link" | "collection" | "itinerary";
  label: string;
  thumbnailUrl?: string;
  className?: string;
  onClick?: () => void;
}

function FilterChip({
  type,
  label,
  thumbnailUrl,
  className,
  onClick,
}: FilterChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "filter-chip flex shrink-0 items-center gap-1.5 rounded-full border border-edge bg-action-secondary px-2 py-1.5",
        "type-body-3 font-medium text-content",
        "transition-colors hover:bg-action-secondary-hover cursor-pointer",
        className,
      )}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt=""
          aria-hidden="true"
          className="size-5 rounded-full object-cover"
        />
      ) : (
        <CategoryBadge category={type} />
      )}
      <span className="max-w-[100px] truncate">{label}</span>
    </button>
  );
}

FilterChip.displayName = "FilterChip";

export { FilterChip };
export type { FilterChipProps };
