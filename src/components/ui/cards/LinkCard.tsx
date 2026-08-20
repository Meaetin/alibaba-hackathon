"use client";

import { forwardRef } from "react";

import { cn } from "@/lib/utils";
import { BaseCard, type BaseCardProps } from "./BaseCard";

interface LinkCardProps
  extends Pick<
    BaseCardProps,
    | "className"
    | "style"
    | "label"
    | "href"
    | "prefetchHref"
    | "onClick"
    | "onDelete"
    | "onAddToCollection"
    | "onAddToItinerary"
    | "disabled"
    | "isSelected"
    | "isSelectingMode"
  > {
  imageUrl?: string;
  imageAlt?: string;
  gradient?: string;
}

const LinkCard = forwardRef<HTMLDivElement, LinkCardProps>(
  ({ imageUrl, imageAlt, gradient, label, className, isSelected, ...props }, ref) => {
    const media = (
      <div className="link-card-thumbnail flex min-h-0 w-full flex-1 items-center justify-center px-1 pt-3">
        {/* Phone frame tilts 2° on hover / when selected (Figma 1031:105) */}
        <div
          className={cn(
            "link-card-thumbnail-frame flex aspect-[150/220] h-full max-w-full shrink-0 flex-col rounded-xl border border-edge bg-surface p-1 transition-transform duration-[var(--motion-duration-normal)]",
            isSelected ? "rotate-2" : "group-hover:rotate-2"
          )}
        >
          {imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageUrl}
              alt={imageAlt || label}
              className="min-h-0 flex-1 rounded-lg border border-edge-subtle bg-surface-alt object-cover"
              draggable="false"
            />
          ) : gradient ? (
            <div
              className="min-h-0 flex-1 rounded-lg border border-edge-subtle"
              style={{ background: gradient }}
            />
          ) : (
            <div className="min-h-0 flex-1 rounded-lg border border-edge-subtle bg-surface-alt" />
          )}
        </div>
      </div>
    );

    return (
      <BaseCard
        ref={ref}
        cardClass="link-card"
        iconVariant="link"
        label={label}
        media={media}
        className={className}
        isSelected={isSelected}
        {...props}
      />
    );
  }
);

LinkCard.displayName = "LinkCard";

export { LinkCard };
export type { LinkCardProps };
