"use client";

import { forwardRef, useEffect, useState, useCallback, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { trackMapLoad } from "@/lib/api/maps";

export interface MapClusterData {
  id: string;
  count: number;
  label: string;
  latitude: number;
  longitude: number;
  variant?: "by Country" | "by Collection" | "by Location";
  size?: "Small" | "Medium";
  state?: "Default" | "Hover" | "Active";
  filterValue?: string;
}

interface StaticMapProps {
  clusters: MapClusterData[];
  center?: [number, number];
  zoom?: number;
  height?: number | string;
  className?: string;
  onClusterClick?: (cluster: MapClusterData) => void;
  interactive?: boolean;
  fitBounds?: boolean;
  renderDetailContent?: (cluster: MapClusterData) => ReactNode;
  showZoomControls?: boolean;
}

const DynamicGoogleMapCluster = dynamic(
  () => import("./GoogleMapCluster").then((mod) => mod.GoogleMapCluster),
  { ssr: false }
);

const StaticMap = forwardRef<HTMLDivElement, StaticMapProps>(
  ({
    clusters,
    center,
    zoom,
    height = 400,
    className,
    onClusterClick,
    interactive = false,
    fitBounds = true,
    renderDetailContent,
    showZoomControls,
  }, _ref) => {
    const [containerRef, isInView] = useIntersectionObserver<HTMLDivElement>();
    const [hoveredClusterId, setHoveredClusterId] = useState<string | null>(null);

    const shouldShowZoomControls = showZoomControls ?? interactive;

    const handleHoverChange = useCallback((id: string | null) => {
      setHoveredClusterId(id);
    }, []);

    useEffect(() => {
      if (isInView) {
        trackMapLoad();
      }
    }, [isInView]);

    return (
      <div
        ref={containerRef}
        className={cn(
          "static-map-container relative z-0 overflow-hidden rounded-lg border border-edge",
          className
        )}
        style={{ height }}
      >
        {!isInView ? (
          <div className="static-map-loading absolute inset-0 flex items-center justify-center rounded-lg bg-surface-alt">
            <span className="static-map-loading-text text-content-secondary type-body-2">Loading map...</span>
          </div>
        ) : (
          <DynamicGoogleMapCluster
            clusters={clusters}
            center={center}
            zoom={zoom}
            onClusterClick={onClusterClick}
            interactive={interactive}
            fitBounds={fitBounds}
            renderDetailContent={renderDetailContent}
            showZoomControls={shouldShowZoomControls}
            hoveredClusterId={hoveredClusterId}
            onHoverChange={handleHoverChange}
          />
        )}
      </div>
    );
  }
);

StaticMap.displayName = "StaticMap";

export { StaticMap };
export type { StaticMapProps };
