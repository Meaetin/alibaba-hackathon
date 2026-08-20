"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { Dot } from "lucide-react";

import { cn } from "@/lib/utils";

interface AlsoInCardProps extends ComponentPropsWithoutRef<"div"> {
  /** Collection or itinerary name, e.g. "KL with the boys". */
  title: string;
  /** Kind label shown first in the meta row, e.g. "Collection" or "Itinerary". */
  type?: string;
  /** Count rendered after the separator dot, e.g. 16. */
  count?: number;
  /** Noun paired with the count, e.g. "Locations". */
  countLabel?: string;
  /** Cover image URL; falls back to a muted placeholder when absent. */
  thumbnailUrl?: string;
  /** Dims the card and disables pointer interaction. */
  disabled?: boolean;
}

/**
 * AlsoInCard — compact tile listing a collection or itinerary that a location
 * already belongs to (shown in the location detail sidebar / "Save to" menu).
 *
 * Figma: Argo-v4 → Also In Card (node 1350:13615). Default is borderless;
 * Hover adds a 1px `edge` border at 85% opacity; Disabled keeps the border at
 * 50% opacity. The border is reserved transparently so hover never shifts layout.
 */
const AlsoInCard = forwardRef<HTMLDivElement, AlsoInCardProps>(
  (
    { className, title, type, count, countLabel, thumbnailUrl, disabled = false, ...props },
    ref,
  ) => {
    const hasMeta = Boolean(type) || count !== undefined;
    const hasCount = count !== undefined;

    return (
      <div
        ref={ref}
        data-slot="also-in-card"
        aria-disabled={disabled || undefined}
        className={cn(
          "flex w-[260px] items-center gap-2 rounded-xl border border-transparent bg-surface p-2",
          "transition-[opacity,border-color]",
          disabled
            ? "pointer-events-none border-edge opacity-50"
            : "cursor-pointer hover:border-edge hover:opacity-85",
          className,
        )}
        {...props}
      >
        {/* Thumbnail — fixed height, width derived from the 22:28 aspect ratio
            so it stays small in indefinite-height containers (e.g. the menu). */}
        <div className="aspect-[22/28] h-10 shrink-0 overflow-hidden rounded-md border border-edge bg-surface p-0.5">
          {thumbnailUrl ? (
            <img
              src={thumbnailUrl}
              alt=""
              className="size-full rounded object-cover"
            />
          ) : (
            <div className="size-full rounded border border-edge bg-surface-muted" />
          )}
        </div>

        {/* Text Content */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
          <p className="type-body-2 type-secondary truncate font-semibold text-content">
            {title}
          </p>
          {hasMeta && (
            <div className="flex items-center type-body-3 font-medium text-content-secondary">
              {type && <span className="truncate">{type}</span>}
              {type && hasCount && (
                <Dot className="size-4 shrink-0 text-content-secondary" aria-hidden="true" />
              )}
              {hasCount && (
                <span className="truncate">
                  {count} {countLabel}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    );
  },
);

AlsoInCard.displayName = "AlsoInCard";

export { AlsoInCard };
export type { AlsoInCardProps };
