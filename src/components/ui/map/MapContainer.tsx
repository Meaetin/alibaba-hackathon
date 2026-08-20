"use client";

import { forwardRef, useEffect } from "react";
import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import { useIntersectionObserver } from "@/hooks/useIntersectionObserver";
import { trackMapLoad } from "@/lib/api/maps";
import type { GoogleMapDetailProps } from "./GoogleMapDetail";

export interface MapLocation {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  photo_urls?: string[];
  category?: string;
  address?: string;
  openingHours?: string;
  onLinkClick?: () => void;
  onBookmarkClick?: () => void;
  onAttachClick?: () => void;
  /** 0-based day this stop belongs to (drives the day color + numbered pin). */
  dayIndex?: number;
}

export interface MapPolylineSegment {
  id: string;
  dayIndex: number;
  encodedPath: string;
  color?: string;
}

interface MapContainerProps extends GoogleMapDetailProps {
  className?: string;
  height?: number | string;
  /** Skip lazy-loading and render the map immediately. Use for off-screen panels (e.g. PIP). */
  eager?: boolean;
}

const DynamicGoogleMapDetail = dynamic(
  () => import("./GoogleMapDetail").then((mod) => mod.GoogleMapDetail),
  { ssr: false }
);

const MapContainer = forwardRef<HTMLDivElement, MapContainerProps>(
  ({ locations, polylines, className, height = 400, defaultCenter, defaultZoom, interactive, fitBoundsKey, highlightedLocationId, eager = false, animateBounds, singleLocationZoom, hoverVariant, onLocationClick, searchRequest, onSearchResults, onSearchResultClick, onSearchLoadingChange, onPlaceDetailsFetcherReady, onPlaceSearchReady }, _ref) => {
    const [containerRef, isInView] = useIntersectionObserver<HTMLDivElement>();
    const shouldRender = eager || isInView;

    useEffect(() => {
      if (shouldRender) {
        trackMapLoad();
      }
    }, [shouldRender]);

    return (
      <div
        ref={containerRef}
        className={cn(
          "map-container relative z-0 overflow-hidden rounded-lg border border-edge",
          className
        )}
        style={{ height }}
      >
        {!shouldRender ? (
          <div className="map-loading-placeholder absolute inset-0 flex items-center justify-center rounded-lg bg-surface-alt">
            <span className="map-loading-text text-content-secondary type-body-2">Loading map...</span>
          </div>
        ) : (
          <DynamicGoogleMapDetail
            locations={locations}
            polylines={polylines}
            defaultCenter={defaultCenter}
            defaultZoom={defaultZoom}
            interactive={interactive}
            fitBoundsKey={fitBoundsKey}
            highlightedLocationId={highlightedLocationId}
            animateBounds={animateBounds}
            singleLocationZoom={singleLocationZoom}
            hoverVariant={hoverVariant}
            onLocationClick={onLocationClick}
            searchRequest={searchRequest}
            onSearchResults={onSearchResults}
            onSearchResultClick={onSearchResultClick}
            onSearchLoadingChange={onSearchLoadingChange}
            onPlaceDetailsFetcherReady={onPlaceDetailsFetcherReady}
            onPlaceSearchReady={onPlaceSearchReady}
          />
        )}
      </div>
    );
  }
);

MapContainer.displayName = "MapContainer";

export { MapContainer };
export type { MapContainerProps };
