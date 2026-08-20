"use client";

import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const markerHoverVariants = cva(
  "map-marker-hover bg-action-secondary border border-action-secondary-hover border-solid content-stretch flex gap-1 items-center justify-center pl-2 pr-3 relative rounded-full",
  {
    variants: {
      variant: {
        "by Country": "",
        "by Collection": "",
        "by Location": "",
      },
      size: {
        Medium: "h-9",
        Small: "h-8",
      },
    },
    defaultVariants: {
      variant: "by Country",
      size: "Small",
    },
  }
);

interface MapMarkerHoverProps
  extends VariantProps<typeof markerHoverVariants> {
  /** Number to display in the count badge */
  count: number;
  /** Text to display (country, collection name, or location name depending on variant) */
  label: string;
  /** Additional class name */
  className?: string;
  /** Children (for additional customization) */
  children?: ReactNode;
  /** Whether the marker is hovered (affects text color for "by Country" variant) */
  isHovered?: boolean;
}

const MapMarkerHover = forwardRef<HTMLDivElement, MapMarkerHoverProps>(
  ({ count, label, variant, size, className, children, isHovered }, ref) => {
    // Text color varies by variant: "by Country" uses foreground, others use secondary-foreground
    const labelTextColor = variant === "by Country" ? "text-content" : "text-glyph";

    return (
      <div
        ref={ref}
        className={cn(
          "map-marker-hover-wrapper",
          markerHoverVariants({ variant, size, className })
        )}
      >
        {/* Count Badge */}
        <div className="map-marker-hover-count bg-surface-muted content-stretch flex h-5 items-center justify-center px-2 relative rounded-full shrink-0">
          <div className="map-marker-hover-count-text flex flex-col font-sans font-medium justify-center leading-[0] not-italic relative shrink-0 text-content text-sm tracking-[-0.35px] whitespace-nowrap">
            <p className="leading-5">{count}</p>
          </div>
        </div>
        {/* Label Text */}
        <div className={cn(
          "map-marker-hover-label flex flex-col font-sans font-medium justify-center leading-[0] not-italic relative shrink-0 text-sm tracking-[-0.35px] whitespace-nowrap",
          labelTextColor
        )}>
          <p className="leading-5">{label}</p>
        </div>
        {children}
      </div>
    );
  }
);

MapMarkerHover.displayName = "MapMarkerHover";

export { MapMarkerHover };
export type { MapMarkerHoverProps };
