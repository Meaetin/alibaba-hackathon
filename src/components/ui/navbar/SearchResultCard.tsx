"use client";

import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/primitives/Tooltip";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { CollectionImageGrid } from "@/components/ui/cards/CollectionCard";

interface SearchResultCardProps {
  id: string;
  type: "link" | "collection" | "itinerary" | "location";
  name: string;
  imageUrl?: string;
  previewImages?: string[];
  className?: string;
  onClick?: () => void;
}

function SearchResultCard({
  type,
  name,
  imageUrl,
  previewImages,
  className,
  onClick,
}: SearchResultCardProps) {
  const hasPreviewImages = previewImages && previewImages.length > 0;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            className={cn(
              "search-result-card h-[112px] w-[88px] shrink-0 overflow-hidden rounded-lg border border-edge bg-surface-alt",
              "transition-opacity hover:opacity-80 cursor-pointer",
              className,
            )}
          />
        }
      >
        {hasPreviewImages ? (
          <CollectionImageGrid images={previewImages} />
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            aria-hidden="true"
            className="size-full object-cover"
          />
        ) : (
          <div className="flex size-full items-center justify-center">
            <CategoryBadge category={type === "location" ? "location" : type} />
          </div>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{name}</TooltipContent>
    </Tooltip>
  );
}

SearchResultCard.displayName = "SearchResultCard";

export { SearchResultCard };
export type { SearchResultCardProps };
