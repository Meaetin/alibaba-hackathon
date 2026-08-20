"use client";

import { forwardRef, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { MapMarkerHover } from "./MapMarkerHover";

const markerVariants = cva(
  "relative flex items-center justify-center transition-[background-color,border-color,color,box-shadow]",
  {
    variants: {
      variant: {
        "by Country": "text-content",
        "by Collection": "text-content",
        "by Location": "text-content",
      },
      size: {
        Small: "size-6",
        Medium: "size-8",
      },
      state: {
        Default: "",
        Hover: "",
        Active: "",
      },
    },
    defaultVariants: {
      variant: "by Country",
      size: "Small",
      state: "Default",
    },
  }
);

interface MapClusterMarkerProps
  extends VariantProps<typeof markerVariants> {
  /** Number of items in this cluster */
  count: number;
  /** Text to display on hover */
  label: string;
  /** Additional class name */
  className?: string;
  /** Hover mode - "compact" shows count/label above marker, "detail" shows full location card */
  hoverMode?: "compact" | "detail";
  /** Detail content for "detail" hover mode */
  detailContent?: ReactNode;
  /** Whether this marker is currently hovered */
  isHovered?: boolean;
}

const MapClusterMarker = forwardRef<HTMLDivElement, MapClusterMarkerProps>(
  (
    {
      count,
      label,
      variant,
      size,
      state,
      className,
      hoverMode = "compact",
      detailContent,
      isHovered = false,
    },
    ref
  ) => {
    const isEmphasized = isHovered || state === "Hover" || state === "Active";

    return (
      <div
        ref={ref}
        className={cn(
          "map-cluster-marker relative",
          className
        )}
      >
        {/* Base marker icon */}
        <div className={cn(
          "map-cluster-marker-icon",
          isEmphasized && "map-cluster-marker-icon-emphasized",
          markerVariants({ variant, size, state: isHovered ? "Hover" : state })
        )}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/stickers/Location Pin.svg" alt="" className="size-6" />
        </div>

        {/* Hover popup - animated above marker */}
        <div
          className={cn(
            "map-cluster-marker-hover pointer-events-none absolute bottom-full left-1/2 mb-2",
            isHovered
              ? "map-cluster-marker-hover-visible"
              : "map-cluster-marker-hover-hidden"
          )}
        >
          {hoverMode === "compact" ? (
            <MapMarkerHover
              count={count}
              label={label}
              variant={variant}
              size={size}
            />
          ) : (
            detailContent
          )}
        </div>
      </div>
    );
  }
);

MapClusterMarker.displayName = "MapClusterMarker";

export { MapClusterMarker };
export type { MapClusterMarkerProps };
