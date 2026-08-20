"use client";

import Link from "next/link";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/primitives/Tooltip";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { CollectionImageGrid } from "@/components/ui/cards/CollectionCard";

type RecentCardType = "link" | "collection" | "itinerary";

const TYPE_HREFS: Record<RecentCardType, (id: string) => string> = {
  link: (id) => `/links/${id}`,
  collection: (id) => `/collections/${id}`,
  itinerary: (id) => `/itineraries/${id}`,
};

interface RecentCardProps {
  id: string;
  type: RecentCardType;
  label: string;
  imageUrl?: string;
  previewImages?: string[];
  className?: string;
  onClick?: () => void;
}

function RecentCard({ id, type, label, imageUrl, previewImages, className, onClick }: RecentCardProps) {
  const href = TYPE_HREFS[type](id);
  const hasPreviewImages = previewImages && previewImages.length > 0;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Link
            href={href}
            onClick={onClick}
            className={cn(
              "recent-card h-[112px] w-[88px] shrink-0 overflow-hidden rounded-lg border border-edge bg-surface-alt",
              "transition-opacity hover:opacity-80",
              className,
            )}
          />
        }
      >
        {hasPreviewImages ? (
          <CollectionImageGrid images={previewImages} />
        ) : imageUrl ? (
          <img src={imageUrl} alt="" aria-hidden="true" className="size-full object-cover" />
        ) : (
          <div className="flex size-full items-center justify-center">
            <CategoryBadge category={type} />
          </div>
        )}
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

RecentCard.displayName = "RecentCard";

export { RecentCard };
export type { RecentCardProps, RecentCardType };
