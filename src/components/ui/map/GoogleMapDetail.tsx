"use client";

import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from "react";
import { APIProvider, Map, AdvancedMarker, useMap, useMapsLibrary, Polyline } from "@vis.gl/react-google-maps";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";
import { LocationHoverDetailsPopup } from "@/components/ui/detail-views/LocationHoverDetailsPopup";
import { MapNameBubble } from "./MapNameBubble";
import { getDayPalette, PALETTE_COLORS } from "@/components/ui/calendar/ActivityTimeslot";
import { runPlaceSearch, fetchPlaceDetailsEnterprise, type PlaceSearchRequest, type PlaceSearchResult } from "@/lib/maps/place-search";
import { trackPlacesSearch } from "@/lib/api/maps";
import type { MapLocation, MapPolylineSegment } from "./MapContainer";

/** Hover affordance for location pins: the rich detail card, or a lightweight name bubble. */
export type MapHoverVariant = "card" | "name";

/** Fetches Enterprise Place Details for one place; surfaced to the page on pin click. */
export type PlaceDetailsFetcher = (placeId: string) => Promise<Partial<PlaceSearchResult>>;

/** Runs a viewport-biased place search; surfaced to the page for the add-location form. */
export type PlaceSearchRunner = (query: string, includedTypes: string[]) => Promise<PlaceSearchResult[]>;

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
const MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID_LIGHT ?? "map-light";

function getCenter(locations: MapLocation[]): google.maps.LatLngLiteral {
  if (locations.length === 0) return { lat: 20, lng: 0 };
  const sum = locations.reduce(
    (acc, loc) => ({ lat: acc.lat + loc.latitude, lng: acc.lng + loc.longitude }),
    { lat: 0, lng: 0 }
  );
  return { lat: sum.lat / locations.length, lng: sum.lng / locations.length };
}

function estimateZoom(locations: MapLocation[]): number {
  if (locations.length <= 1) return 13;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const loc of locations) {
    if (loc.latitude < minLat) minLat = loc.latitude;
    if (loc.latitude > maxLat) maxLat = loc.latitude;
    if (loc.longitude < minLng) minLng = loc.longitude;
    if (loc.longitude > maxLng) maxLng = loc.longitude;
  }
  const spread = Math.max(maxLat - minLat, maxLng - minLng);
  if (spread < 0.01) return 15;
  if (spread < 0.05) return 13;
  if (spread < 0.1) return 12;
  if (spread < 0.5) return 10;
  if (spread < 1) return 9;
  if (spread < 3) return 7;
  if (spread < 10) return 5;
  return 4;
}

interface MapBoundsControllerProps {
  locations: MapLocation[];
  defaultCenter?: [number, number];
  defaultZoom?: number;
  fitBoundsKey?: number;
  animateBounds?: boolean;
  singleLocationZoom?: number;
}

function MapBoundsController({ locations, defaultCenter, defaultZoom, fitBoundsKey, animateBounds, singleLocationZoom }: MapBoundsControllerProps) {
  const map = useMap();
  const hasFittedRef = useRef(false);

  const locationKey = locations.map((l) => l.id).join(",");

  useEffect(() => {
    if (!map) return;

    if (locations.length === 0) {
      if (defaultCenter) {
        map.moveCamera({ center: { lat: defaultCenter[0], lng: defaultCenter[1] }, zoom: defaultZoom ?? 6 });
      }
      return;
    }

    const bounds = new google.maps.LatLngBounds();
    for (const loc of locations) {
      bounds.extend({ lat: loc.latitude, lng: loc.longitude });
    }

    if (!hasFittedRef.current) {
      map.moveCamera({ center: bounds.getCenter().toJSON(), zoom: estimateZoom(locations) });
      hasFittedRef.current = true;
    } else if (locations.length === 1) {
      if (animateBounds) {
        map.panTo({ lat: locations[0].latitude, lng: locations[0].longitude });
        map.setZoom(singleLocationZoom ?? 14);
      } else {
        map.moveCamera({ center: { lat: locations[0].latitude, lng: locations[0].longitude }, zoom: 13 });
      }
    } else {
      map.fitBounds(bounds, 60);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, locationKey, defaultCenter, defaultZoom, fitBoundsKey]);

  return null;
}

interface MapSearchControllerProps {
  placesLib: google.maps.PlacesLibrary | null;
  request: PlaceSearchRequest | null;
  onResults: (results: PlaceSearchResult[]) => void;
  onLoadingChange?: (loading: boolean) => void;
}

/**
 * Runs place searches against the live map viewport. Lives inside `<Map>` so it
 * can read `useMap()`; re-runs whenever `request.nonce` changes.
 */
function MapSearchController({ placesLib, request, onResults, onLoadingChange }: MapSearchControllerProps) {
  const map = useMap();
  // Read callbacks through refs so unstable parent identities don't re-run (and
  // cancel) an in-flight search. Only `request` identity should drive a new run.
  const onResultsRef = useRef(onResults);
  const onLoadingRef = useRef(onLoadingChange);
  onResultsRef.current = onResults;
  onLoadingRef.current = onLoadingChange;
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!map || !placesLib || !request) return;

    const runId = ++runIdRef.current;
    void (async () => {
      onLoadingRef.current?.(true);
      try {
        // Text query → Text Search SKU; chip-only → Nearby Search SKU.
        const mode = request.query.trim() ? "text" : "nearby";
        const results = await runPlaceSearch(placesLib, map, {
          query: request.query,
          includedTypes: request.includedTypes,
        });
        void trackPlacesSearch(mode);
        if (runId === runIdRef.current) onResultsRef.current(results);
      } catch (e) {
        console.error("[map search]", e);
        if (runId === runIdRef.current) onResultsRef.current([]);
      } finally {
        if (runId === runIdRef.current) onLoadingRef.current?.(false);
      }
    })();
  }, [map, placesLib, request]);

  return null;
}

interface MapSearchRunnerProviderProps {
  placesLib: google.maps.PlacesLibrary | null;
  onReady?: (runner: PlaceSearchRunner | null) => void;
}

/**
 * Exposes a viewport-biased place-search runner to the page (which lives outside
 * APIProvider and can't call the SDK directly). Lives inside `<Map>` for `useMap()`.
 * The runner issues an Enterprise place search and records the billed request,
 * exactly like MapSearchController.
 */
function MapSearchRunnerProvider({ placesLib, onReady }: MapSearchRunnerProviderProps) {
  const map = useMap();

  useEffect(() => {
    if (!onReady) return;
    if (!map || !placesLib) {
      onReady(null);
      return;
    }
    const runner: PlaceSearchRunner = async (query, includedTypes) => {
      const mode = query.trim() ? "text" : "nearby";
      const results = await runPlaceSearch(placesLib, map, { query, includedTypes });
      void trackPlacesSearch(mode);
      return results;
    };
    onReady(runner);
    return () => onReady(null);
  }, [map, placesLib, onReady]);

  return null;
}

/**
 * Numbered stop pin using the Argo "Location Pin (no hole)" shape — an inline SVG
 * (viewBox cropped so the tip sits at bottom-center, matching AdvancedMarker's
 * bottom-center anchoring). The body is day-colored with a surface-colored outline
 * that cuts it out of the map; the order number is centered over the pin head.
 * Source asset: /images/stickers/Location Pin(no hole).svg.
 */
function StopPin({ order, color, highlighted }: { order: number; color: string; highlighted: boolean }) {
  const width = 28;
  const height = Math.round(width * (105 / 101));
  return (
    <div
      className={cn(
        "stop-pin relative origin-bottom transition-transform duration-[var(--motion-duration-normal)] ease-[var(--motion-ease-standard)] motion-reduce:transition-none",
        highlighted ? "scale-[1.286]" : "scale-100",
      )}
      style={{ width, height }}
    >
      <svg
        viewBox="0 0 101 105"
        width={width}
        height={height}
        className="stop-pin-shape block drop-shadow-[0_2px_4px_rgba(0,0,0,0.25)]"
        aria-hidden="true"
      >
        {/* White outline — "cuts" the pin out of the map surface */}
        <path
          d="M50.4452 4.00002C76.1793 3.97336 94.8313 26.9553 92.7413 51.9916L92.6262 53.1857C90.6132 71.5424 80.3815 84.2047 70.9689 92.1316C66.2551 96.1015 61.6749 98.9502 58.2668 100.811C56.5585 101.744 55.1321 102.435 54.115 102.901C53.6064 103.133 53.1991 103.31 52.9085 103.433C52.7631 103.494 52.6463 103.542 52.5611 103.577C52.5189 103.594 52.484 103.607 52.4573 103.618C52.4442 103.623 52.4327 103.628 52.4234 103.631C52.4187 103.633 52.4137 103.635 52.4101 103.636L52.4049 103.639L50.4893 98.7386L52.4008 103.641C51.1008 104.148 49.6522 104.117 48.3744 103.556L50.4893 98.7386L48.3703 103.554L48.3651 103.552C48.3616 103.551 48.3574 103.549 48.3528 103.547C48.3432 103.543 48.3309 103.537 48.3168 103.531C48.2887 103.518 48.2513 103.502 48.2058 103.481C48.1144 103.44 47.9889 103.381 47.8307 103.307C47.5141 103.158 47.0675 102.942 46.5102 102.659C45.3962 102.094 43.8335 101.259 41.9719 100.145C38.2587 97.9244 33.2988 94.5642 28.3203 90.0002C18.393 80.8996 8.00005 66.6178 8 46.8203C8 23.2369 26.9621 4.02452 50.4452 4.00002Z"
          style={{ fill: "var(--surface)" }}
        />
        {/* Day-colored body — matches the route leg color exactly */}
        <path
          d="M87.3958 52.6121C83.7605 85.7632 50.4892 98.7382 50.4892 98.7382C50.4892 98.7382 13.2617 82.4011 13.2617 46.8201C13.2617 26.097 29.9148 9.28309 50.4508 9.26174C73.1165 9.23826 89.8884 29.8838 87.3958 52.6121Z"
          style={{ fill: color }}
        />
      </svg>
      {/* Order number — centered over the pin head (≈44% of total height) */}
      <span className="stop-pin-order absolute left-1/2 top-[44%] -translate-x-[50%] -translate-y-[45%] type-body-3 font-bold leading-none text-content-on-dark">
        {order}
      </span>
    </div>
  );
}

/** Search-result marker — the default Argo location pin (with hole). */
function SearchMarker({ hovered }: { hovered: boolean }) {
  return (
    <div
      className={cn(
        "search-marker origin-bottom transition-transform duration-[var(--motion-duration-normal)] ease-[var(--motion-ease-standard)] motion-reduce:transition-none",
        hovered ? "scale-[1.333]" : "scale-100",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/stickers/Location Pin.svg"
        alt=""
        className="search-marker-pin block"
        style={{ width: 24, height: Math.round(24 * (116 / 101)) }}
      />
    </div>
  );
}

/**
 * Shared prop contract for the map detail view. `MapContainer` extends this
 * with its own lazy-load/layout props (className, height, eager).
 */
export interface GoogleMapDetailProps {
  locations: MapLocation[];
  polylines?: MapPolylineSegment[];
  /** Default center when no locations are present (e.g. country center) */
  defaultCenter?: [number, number];
  /** Default zoom when no locations are present */
  defaultZoom?: number;
  /** Enable full user control (scroll zoom, drag, double-click zoom). Default: false */
  interactive?: boolean;
  /** Increment to re-trigger fitBounds */
  fitBoundsKey?: number;
  /** Location id to highlight on the map */
  highlightedLocationId?: string | null;
  /** Use smooth animated transitions for subsequent bounds changes instead of snapping */
  animateBounds?: boolean;
  /** Zoom level used when animating to a single location (default: 14) */
  singleLocationZoom?: number;
  /** Hover affordance for pins: rich detail card (default) or lightweight name bubble */
  hoverVariant?: MapHoverVariant;
  /** Click handler for the itinerary's own location pins (opens its detail panel) */
  onLocationClick?: (location: MapLocation) => void;
  /** Active place-search request; drives result markers on the map */
  searchRequest?: PlaceSearchRequest | null;
  /** Called with the latest place-search results (e.g. for a result count) */
  onSearchResults?: (results: PlaceSearchResult[]) => void;
  /** Called when a search-result pin is clicked */
  onSearchResultClick?: (place: PlaceSearchResult) => void;
  /** Called when a place search starts/finishes */
  onSearchLoadingChange?: (loading: boolean) => void;
  /** Receives an Enterprise Place Details fetcher once the places library loads */
  onPlaceDetailsFetcherReady?: (fetcher: PlaceDetailsFetcher | null) => void;
  /** Receives a viewport-biased place-search runner once the places library loads */
  onPlaceSearchReady?: (runner: PlaceSearchRunner | null) => void;
}

function GoogleMapDetailInner({ locations, polylines, defaultCenter, defaultZoom, interactive, fitBoundsKey, highlightedLocationId, animateBounds, singleLocationZoom, hoverVariant = "card", onLocationClick, searchRequest = null, onSearchResults, onSearchResultClick, onSearchLoadingChange, onPlaceDetailsFetcherReady, onPlaceSearchReady }: GoogleMapDetailProps) {
  const { resolvedTheme } = useTheme();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredSearchId, setHoveredSearchId] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<PlaceSearchResult[]>([]);
  const placesLib = useMapsLibrary("places");

  // Compute 1-based sequence numbers for stop pins that carry a dayIndex.
  // Each day group is numbered independently in array order. Locations without
  // dayIndex are excluded (they render as the default fallback pin).
  const stopOrderMap = useMemo(() => {
    const orderMap: Record<string, number> = {};
    const dayCounts: Record<number, number> = {};
    for (const location of locations) {
      if (location.dayIndex == null) continue;
      const count = (dayCounts[location.dayIndex] ?? 0) + 1;
      dayCounts[location.dayIndex] = count;
      orderMap[location.id] = count;
    }
    return orderMap;
  }, [locations]);

  const handleSearchResults = useCallback((results: PlaceSearchResult[]) => {
    setSearchResults(results);
    onSearchResults?.(results);
  }, [onSearchResults]);

  // Clear result markers when the search is dismissed.
  useEffect(() => {
    if (!searchRequest) setSearchResults([]);
  }, [searchRequest]);

  // Expose an Enterprise Place Details fetcher to the page once the places library
  // is loaded (the page lives outside APIProvider so it can't call the SDK itself).
  useEffect(() => {
    if (!onPlaceDetailsFetcherReady) return;
    onPlaceDetailsFetcherReady(placesLib ? (placeId) => fetchPlaceDetailsEnterprise(placesLib, placeId) : null);
    return () => onPlaceDetailsFetcherReady(null);
  }, [placesLib, onPlaceDetailsFetcherReady]);

  const initialCenter = locations.length > 0
    ? getCenter(locations)
    : defaultCenter
      ? { lat: defaultCenter[0], lng: defaultCenter[1] }
      : { lat: 20, lng: 0 };

  const initialZoom = locations.length === 0
    ? (defaultZoom ?? 6)
    : estimateZoom(locations);

  return (
    <Map
      mapId={MAP_ID}
      defaultCenter={initialCenter}
      defaultZoom={initialZoom}
      gestureHandling={interactive ? "greedy" : "none"}
      disableDefaultUI
      clickableIcons={false}
      className="size-full"
    >
      <MapBoundsController
        locations={locations}
        defaultCenter={defaultCenter}
        defaultZoom={defaultZoom}
        fitBoundsKey={fitBoundsKey}
        animateBounds={animateBounds}
        singleLocationZoom={singleLocationZoom}
      />
      {/* Route Polylines — white casing under a vibrant solid line */}
      {polylines?.map((segment) => {
        const mainColor = segment.color ?? (() => {
          const palette = getDayPalette(segment.dayIndex);
          const colors = PALETTE_COLORS[palette];
          return resolvedTheme === 'dark' ? colors.dark : colors.light;
        })();
        return (
          <Fragment key={segment.id}>
            <Polyline encodedPath={segment.encodedPath} strokeColor="#ffffff" strokeWeight={9} strokeOpacity={1} zIndex={1} />
            <Polyline encodedPath={segment.encodedPath} strokeColor={mainColor} strokeWeight={5} strokeOpacity={1} zIndex={2} />
          </Fragment>
        );
      })}
      {/* Stop Markers — numbered day-colored teardrop pins when dayIndex is set; default pin otherwise */}
      {locations.map((location) => {
        const isHighlighted = location.id === hoveredId || location.id === highlightedLocationId;
        const order = stopOrderMap[location.id];
        const hasDay = order != null;
        const palette = getDayPalette(location.dayIndex ?? 0);
        const colors = PALETTE_COLORS[palette];
        const dayColor = resolvedTheme === "dark" ? colors.dark : colors.light;
        return (
          <AdvancedMarker
            key={location.id}
            position={{ lat: location.latitude, lng: location.longitude }}
            onMouseEnter={() => setHoveredId(location.id)}
            onMouseLeave={() => setHoveredId(null)}
            onClick={onLocationClick ? () => onLocationClick(location) : undefined}
            zIndex={isHighlighted ? 10 : 0}
          >
            <div className={cn("map-detail-marker-wrapper relative flex flex-col items-center", onLocationClick && "cursor-pointer")}>
              {hoveredId === location.id && (
                <div className="map-detail-popup absolute bottom-full left-1/2 mb-2 -translate-x-1/2 z-50 pointer-events-auto">
                  {hoverVariant === "name" ? (
                    <MapNameBubble name={location.name} />
                  ) : (
                    <LocationHoverDetailsPopup
                      name={location.name}
                      category={location.category}
                      imageUrl={location.photo_urls?.[0]}
                      address={location.address}
                      openingHours={location.openingHours}
                      onLinkClick={location.onLinkClick}
                      onBookmarkClick={location.onBookmarkClick}
                      onAttachClick={location.onAttachClick}
                      variant="default"
                    />
                  )}
                </div>
              )}
              {hasDay ? (
                <StopPin order={order} color={dayColor} highlighted={isHighlighted} />
              ) : (
                <div className="map-detail-default-marker flex size-9 items-end justify-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src="/images/stickers/Location Pin.svg"
                    alt=""
                    className={cn(
                      "map-detail-default-marker-image size-6 origin-bottom",
                      isHighlighted && "map-detail-default-marker-image-highlighted",
                    )}
                  />
                </div>
              )}
            </div>
          </AdvancedMarker>
        );
      })}

      {/* Place Search Controller + Result Markers */}
      <MapSearchController
        placesLib={placesLib}
        request={searchRequest}
        onResults={handleSearchResults}
        onLoadingChange={onSearchLoadingChange}
      />
      <MapSearchRunnerProvider placesLib={placesLib} onReady={onPlaceSearchReady} />
      {/* Search Result Markers — default Argo pin (with hole), scales on hover */}
      {searchResults.map((place) => {
        const isHovered = hoveredSearchId === place.id;
        return (
          <AdvancedMarker
            key={`search-${place.id}`}
            position={{ lat: place.latitude, lng: place.longitude }}
            onMouseEnter={() => setHoveredSearchId(place.id)}
            onMouseLeave={() => setHoveredSearchId(null)}
            onClick={() => onSearchResultClick?.(place)}
            zIndex={isHovered ? 20 : 5}
          >
            <div className="map-search-marker-wrapper relative flex cursor-pointer flex-col items-center">
              {isHovered && (
                <div className="map-search-popup absolute bottom-full left-1/2 mb-2 -translate-x-1/2 z-50 pointer-events-none">
                  <MapNameBubble name={place.name} />
                </div>
              )}
              <SearchMarker hovered={isHovered} />
            </div>
          </AdvancedMarker>
        );
      })}
    </Map>
  );
}

export function GoogleMapDetail({ locations, polylines, defaultCenter, defaultZoom, interactive, fitBoundsKey, highlightedLocationId, animateBounds, singleLocationZoom, hoverVariant, onLocationClick, searchRequest, onSearchResults, onSearchResultClick, onSearchLoadingChange, onPlaceDetailsFetcherReady, onPlaceSearchReady }: GoogleMapDetailProps) {
  return (
    <APIProvider apiKey={API_KEY}>
      <GoogleMapDetailInner
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
    </APIProvider>
  );
}
