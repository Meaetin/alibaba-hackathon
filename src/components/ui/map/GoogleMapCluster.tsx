"use client";

import { useEffect, type ReactNode } from "react";
import { APIProvider, Map, AdvancedMarker, MapControl, ControlPosition, useMap } from "@vis.gl/react-google-maps";
import { MapClusterMarker } from "./MapClusterMarker";
import type { MapClusterData } from "./StaticMap";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_LIGHT ?? "map-light";

function calculateMapView(clusters: MapClusterData[]): { center: google.maps.LatLngLiteral; zoom: number } {
  if (clusters.length === 0) return { center: { lat: 20, lng: 0 }, zoom: 1 };
  if (clusters.length === 1) return { center: { lat: clusters[0].latitude, lng: clusters[0].longitude }, zoom: 10 };

  const bounds = clusters.reduce(
    (acc, c) => ({
      minLat: Math.min(acc.minLat, c.latitude),
      maxLat: Math.max(acc.maxLat, c.latitude),
      minLng: Math.min(acc.minLng, c.longitude),
      maxLng: Math.max(acc.maxLng, c.longitude),
    }),
    { minLat: Infinity, maxLat: -Infinity, minLng: Infinity, maxLng: -Infinity }
  );

  const center = {
    lat: (bounds.minLat + bounds.maxLat) / 2,
    lng: (bounds.minLng + bounds.maxLng) / 2,
  };

  const spread = Math.max(bounds.maxLat - bounds.minLat, bounds.maxLng - bounds.minLng);
  let zoom = 3;
  if (spread > 100) zoom = 1;
  else if (spread > 50) zoom = 2;
  else if (spread > 20) zoom = 3;
  else if (spread > 10) zoom = 4;
  else if (spread > 5) zoom = 5;
  else if (spread > 2) zoom = 6;
  else if (spread > 1) zoom = 7;
  else if (spread > 0.5) zoom = 8;
  else zoom = 9;

  return { center, zoom };
}

function MapBoundsController({ clusters }: { clusters: MapClusterData[] }) {
  const map = useMap();

  useEffect(() => {
    if (!map || clusters.length === 0) return;

    if (clusters.length === 1) {
      map.setCenter({ lat: clusters[0].latitude, lng: clusters[0].longitude });
      map.setZoom(10);
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    for (const c of clusters) {
      bounds.extend({ lat: c.latitude, lng: c.longitude });
    }
    map.fitBounds(bounds, 60);
  }, [map, clusters]);

  return null;
}

interface GoogleMapClusterInnerProps {
  clusters: MapClusterData[];
  onClusterClick?: (cluster: MapClusterData) => void;
  interactive?: boolean;
  fitBounds?: boolean;
  renderDetailContent?: (cluster: MapClusterData) => ReactNode;
  showZoomControls?: boolean;
  hoveredClusterId: string | null;
  onHoverChange: (id: string | null) => void;
}

function GoogleMapClusterInner({
  clusters,
  center: centerProp,
  zoom: zoomProp,
  onClusterClick,
  interactive = false,
  fitBounds = true,
  renderDetailContent,
  showZoomControls,
  hoveredClusterId,
  onHoverChange,
}: GoogleMapClusterInnerProps & { center?: [number, number]; zoom?: number }) {
  const autoView = calculateMapView(clusters);
  const center = centerProp ? { lat: centerProp[0], lng: centerProp[1] } : autoView.center;
  const zoom = zoomProp ?? autoView.zoom;

  return (
    <Map
      mapId={MAP_ID}
      defaultCenter={center}
      defaultZoom={zoom}
      gestureHandling={interactive ? "greedy" : "none"}
      disableDefaultUI
      className="size-full"
    >
      {fitBounds && <MapBoundsController clusters={clusters} />}
      {clusters.map((cluster, index) => (
        <AdvancedMarker
          key={`${cluster.id}-${index}`}
          position={{ lat: cluster.latitude, lng: cluster.longitude }}
          onClick={() => onClusterClick?.(cluster)}
          onMouseEnter={() => onHoverChange(cluster.id)}
          onMouseLeave={() => onHoverChange(null)}
        >
          <MapClusterMarker
            count={cluster.count}
            label={cluster.label}
            variant={cluster.variant}
            size={cluster.size ?? "Small"}
            state={cluster.state ?? "Default"}
            hoverMode={interactive ? "detail" : "compact"}
            detailContent={renderDetailContent?.(cluster)}
            isHovered={hoveredClusterId === cluster.id}
          />
        </AdvancedMarker>
      ))}
      {showZoomControls && interactive && (
        <MapControl position={ControlPosition.TOP_RIGHT}>
          <ZoomControls />
        </MapControl>
      )}
    </Map>
  );
}

function ZoomControls() {
  const map = useMap();

  return (
    <div className="map-zoom-controls flex flex-col gap-0.5 m-2">
      <button
        className="map-zoom-in size-8 flex items-center justify-center rounded-t-md bg-surface border border-edge text-content hover:bg-surface-alt transition-colors type-body-1"
        onClick={() => map?.setZoom((map.getZoom() ?? 4) + 1)}
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        className="map-zoom-out size-8 flex items-center justify-center rounded-b-md bg-surface border border-edge border-t-0 text-content hover:bg-surface-alt transition-colors type-body-1"
        onClick={() => map?.setZoom((map.getZoom() ?? 4) - 1)}
        aria-label="Zoom out"
      >
        −
      </button>
    </div>
  );
}

interface GoogleMapClusterProps {
  clusters: MapClusterData[];
  center?: [number, number];
  zoom?: number;
  onClusterClick?: (cluster: MapClusterData) => void;
  interactive?: boolean;
  fitBounds?: boolean;
  renderDetailContent?: (cluster: MapClusterData) => ReactNode;
  showZoomControls?: boolean;
  hoveredClusterId: string | null;
  onHoverChange: (id: string | null) => void;
}

export function GoogleMapCluster(props: GoogleMapClusterProps) {
  return (
    <APIProvider apiKey={API_KEY}>
      <GoogleMapClusterInner {...props} />
    </APIProvider>
  );
}
