"use client";

import { useState } from "react";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";

type FilterType = "link" | "collection" | "itinerary" | "location";

interface FilterPillProps {
  className?: string;
  type: FilterType;
  label: string;
  thumbnailUrl?: string;
  count?: number;
  onDismiss?: () => void;
}

function FilterPill({
  className,
  type,
  label,
  thumbnailUrl,
  count,
  onDismiss,
}: FilterPillProps) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <button
      type="button"
      aria-label={`Clear ${label} filter`}
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-full border border-edge p-0",
        "lg:h-9 lg:w-auto lg:max-w-[140px] lg:justify-start lg:gap-1 lg:pl-2 lg:pr-3",
        "bg-action-secondary transition-colors",
        "hover:bg-action-secondary-hover",
        className,
      )}
      onClick={onDismiss}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span
        className={cn(
          "flex size-full shrink-0 items-center justify-center rounded-full lg:size-5",
          isHovered && "border border-edge",
        )}
      >
        {isHovered ? (
          <X className="size-3 text-content" />
        ) : thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt=""
            className="size-full rounded-full object-cover"
          />
        ) : (
          <CategoryBadge category={type} />
        )}
      </span>
      <span className="type-body-2 hidden truncate font-medium text-content lg:inline">
        {count != null && <span className="mr-0.5">{count}</span>}
        {label}
      </span>
    </button>
  );
}

export { FilterPill };
export type { FilterPillProps };
