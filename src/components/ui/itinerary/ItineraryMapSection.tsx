"use client";

import dynamic from "next/dynamic";
import { cn } from "@/lib/utils";
import type { MapLocation, MapPolylineSegment } from "@/components/ui/map/MapContainer";
import type { MapHoverVariant } from "@/components/ui/map/GoogleMapDetail";

const MapContainer = dynamic(
  () => import("@/components/ui/map/MapContainer").then((mod) => mod.MapContainer),
  { ssr: false }
);

interface ItineraryMapSectionProps {
  locations: MapLocation[];
  polylines: MapPolylineSegment[];
  defaultCenter?: [number, number];
  hoverVariant?: MapHoverVariant;
  className?: string;
}

export function ItineraryMapSection({
  locations,
  polylines,
  defaultCenter,
  hoverVariant,
  className,
}: ItineraryMapSectionProps) {
  if (locations.length === 0) return null;

  return (
    <div
      data-region="itinerary-detail-map"
      className={cn(
        "itinerary-map-section mx-auto w-full max-w-[1600px] px-3 pt-3 md:px-8 md:pt-6 lg:px-10",
        className,
      )}
    >
      {/* Map Card */}
      <div className="itinerary-map-card relative w-full rounded-2xl border border-edge bg-surface p-1">
        <div className="itinerary-map-card-inner overflow-clip rounded-xl bg-surface-alt">
          <MapContainer
            locations={locations}
            polylines={polylines}
            defaultCenter={defaultCenter}
            height="clamp(18rem, 45vw, 25.75rem)"
            hoverVariant={hoverVariant}
            className="itinerary-map-container rounded-xl border-0"
          />
        </div>
      </div>
    </div>
  );
}
