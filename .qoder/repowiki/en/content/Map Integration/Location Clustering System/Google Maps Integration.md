# Google Maps Integration

<cite>
**Referenced Files in This Document**
- [GoogleMapCluster.tsx](file://src/components/ui/map/GoogleMapCluster.tsx)
- [StaticMap.tsx](file://src/components/ui/map/StaticMap.tsx)
- [MapContainer.tsx](file://src/components/ui/map/MapContainer.tsx)
- [MapClusterMarker.tsx](file://src/components/ui/map/MapClusterMarker.tsx)
- [MapMarkerHover.tsx](file://src/components/ui/map/MapMarkerHover.tsx)
- [useMapClusters.ts](file://src/hooks/useMapClusters.ts)
- [locality-pins.ts](file://src/lib/maps/locality-pins.ts)
- [maps.ts](file://src/lib/api/maps.ts)
</cite>

## Table of Contents
1. [Introduction](#introduction)
2. [Project Structure](#project-structure)
3. [Core Components](#core-components)
4. [Architecture Overview](#architecture-overview)
5. [Detailed Component Analysis](#detailed-component-analysis)
6. [Dependency Analysis](#dependency-analysis)
7. [Performance Considerations](#performance-considerations)
8. [Troubleshooting Guide](#troubleshooting-guide)
9. [Conclusion](#conclusion)
10. [Appendices](#appendices)

## Introduction
This document provides comprehensive documentation for the GoogleMapCluster component, which serves as the main container for interactive map clustering using Google Maps via @vis.gl/react-google-maps. It covers configuration options (center coordinates, zoom levels, interactive mode, fit bounds behavior, and custom render functions), integration with Google Maps API, theme-aware map styling, automatic view calculation based on cluster distribution, examples for setup and user interactions, performance considerations for large datasets, and best practices for initialization.

## Project Structure
The map clustering feature is implemented across several components and utilities:
- GoogleMapCluster: Main container that initializes the Google Map, manages view calculations, and renders cluster markers.
- StaticMap: A wrapper that lazily loads GoogleMapCluster and handles intersection-based rendering and hover state.
- MapContainer: A separate map container used for detailed maps; included here to clarify differences from clustering-focused components.
- MapClusterMarker and MapMarkerHover: UI for marker visuals and hover tooltips.
- useMapClusters: Hook to fetch and build clusters from data sources.
- locality-pins: Utility to group raw locations into clusters by locality labels.
- maps.ts: Analytics tracking for map usage.

```mermaid
graph TB
subgraph "UI Layer"
SM["StaticMap"]
GMC["GoogleMapCluster"]
MCM["MapClusterMarker"]
MMH["MapMarkerHover"]
end
subgraph "Hooks & Utils"
UMC["useMapClusters"]
LP["buildLocalityPins"]
end
subgraph "External"
GM["@vis.gl/react-google-maps"]
THEME["next-themes"]
end
SM --> GMC
GMC --> MCM
MCM --> MMH
UMC --> LP
GMC --> GM
GMC --> THEME
```

**Diagram sources**
- [GoogleMapCluster.tsx:1-181](file://src/components/ui/map/GoogleMapCluster.tsx#L1-L181)
- [StaticMap.tsx:1-103](file://src/components/ui/map/StaticMap.tsx#L1-L103)
- [MapClusterMarker.tsx:1-115](file://src/components/ui/map/MapClusterMarker.tsx#L1-L115)
- [MapMarkerHover.tsx:1-78](file://src/components/ui/map/MapMarkerHover.tsx#L1-L78)
- [useMapClusters.ts:1-61](file://src/hooks/useMapClusters.ts#L1-L61)
- [locality-pins.ts:1-78](file://src/lib/maps/locality-pins.ts#L1-L78)

**Section sources**
- [GoogleMapCluster.tsx:1-181](file://src/components/ui/map/GoogleMapCluster.tsx#L1-L181)
- [StaticMap.tsx:1-103](file://src/components/ui/map/StaticMap.tsx#L1-L103)
- [MapContainer.tsx:1-99](file://src/components/ui/map/MapContainer.tsx#L1-L99)

## Core Components
- GoogleMapCluster: Renders a Google Map with cluster markers, supports center/zoom overrides, interactive gestures, fit bounds, custom detail content, optional zoom controls, and hover state management.
- StaticMap: Lazy-loads GoogleMapCluster when visible, tracks map load analytics, and manages hover state for cluster markers.
- MapClusterMarker: Displays a pin icon and hover tooltip or custom detail content based on hover mode.
- MapMarkerHover: Compact tooltip showing count and label.
- useMapClusters: Fetches raw location data and builds clusters grouped by locality labels.
- buildLocalityPins: Groups items by region/country and computes average coordinates and counts.

Key responsibilities:
- View calculation: Automatically compute center and zoom based on cluster spread.
- Fit bounds: Optionally adjust map viewport to include all clusters.
- Theme-aware styling: Select light/dark map IDs based on current theme.
- Interaction: Optional interactive mode enabling gestures and zoom controls.

**Section sources**
- [GoogleMapCluster.tsx:13-181](file://src/components/ui/map/GoogleMapCluster.tsx#L13-L181)
- [StaticMap.tsx:9-103](file://src/components/ui/map/StaticMap.tsx#L9-L103)
- [MapClusterMarker.tsx:8-115](file://src/components/ui/map/MapClusterMarker.tsx#L8-L115)
- [MapMarkerHover.tsx:7-78](file://src/components/ui/map/MapMarkerHover.tsx#L7-L78)
- [useMapClusters.ts:16-61](file://src/hooks/useMapClusters.ts#L16-L61)
- [locality-pins.ts:4-78](file://src/lib/maps/locality-pins.ts#L4-L78)

## Architecture Overview
The system composes React components around Google Maps via @vis.gl/react-google-maps. Data flows from hooks and utilities into the map, which renders markers and handles interactions.

```mermaid
sequenceDiagram
participant Parent as "Parent Component"
participant StaticMap as "StaticMap"
participant GoogleMapCluster as "GoogleMapCluster"
participant Map as "@vis.gl/react-google-maps Map"
participant Marker as "MapClusterMarker"
participant Hover as "MapMarkerHover"
Parent->>StaticMap : Provide clusters, props
StaticMap->>StaticMap : IntersectionObserver check
StaticMap-->>Parent : Loading placeholder until visible
StaticMap->>GoogleMapCluster : Render when visible
GoogleMapCluster->>Map : Initialize with theme-aware mapId, defaultCenter, defaultZoom
GoogleMapCluster->>GoogleMapCluster : calculateMapView(clusters)
GoogleMapCluster->>Map : fitBounds if enabled
loop For each cluster
GoogleMapCluster->>Marker : Render AdvancedMarker with position
Marker->>Hover : Show compact tooltip or custom detailContent on hover
end
Parent->>GoogleMapCluster : onClusterClick handler
GoogleMapCluster-->>Parent : Emit cluster click event
```

**Diagram sources**
- [GoogleMapCluster.tsx:13-136](file://src/components/ui/map/GoogleMapCluster.tsx#L13-L136)
- [StaticMap.tsx:39-93](file://src/components/ui/map/StaticMap.tsx#L39-L93)
- [MapClusterMarker.tsx:51-115](file://src/components/ui/map/MapClusterMarker.tsx#L51-L115)
- [MapMarkerHover.tsx:42-78](file://src/components/ui/map/MapMarkerHover.tsx#L42-L78)

## Detailed Component Analysis

### GoogleMapCluster
Responsibilities:
- Wraps the map with APIProvider for Google Maps integration.
- Computes auto view (center and zoom) based on cluster distribution.
- Applies theme-aware map ID selection.
- Renders cluster markers with hover and click handlers.
- Optionally fits bounds to show all clusters.
- Provides optional zoom controls in interactive mode.

Configuration options:
- clusters: Array of cluster data objects including id, count, label, latitude, longitude, variant, size, state, filterValue.
- center: Optional [lat, lng] tuple to override auto-calculated center.
- zoom: Optional number to override auto-calculated zoom.
- onClusterClick: Optional callback invoked when a cluster marker is clicked.
- interactive: Boolean to enable gestures and zoom controls.
- fitBounds: Boolean to automatically fit the map to include all clusters.
- renderDetailContent: Optional function to provide custom detail content for hover in “detail” mode.
- showZoomControls: Boolean to show custom zoom controls (defaults to interactive).
- hoveredClusterId: Controlled state indicating currently hovered cluster id.
- onHoverChange: Callback to update hovered cluster id.

Automatic view calculation:
- If no clusters, returns a default center and low zoom.
- If one cluster, centers on it with moderate zoom.
- Otherwise, calculates bounding box and selects zoom based on geographic spread thresholds.

Fit bounds behavior:
- Uses LatLngBounds to extend over all cluster positions and applies padding.
- Single cluster case sets center and zoom directly.

Theme-aware styling:
- Chooses mapId based on resolved theme (light/dark) from next-themes.

Interaction handling:
- Markers emit onClick to onClusterClick.
- Markers emit onMouseEnter/onMouseLeave to update hoveredClusterId via onHoverChange.

```mermaid
flowchart TD
Start(["Render GoogleMapCluster"]) --> CheckClusters{"clusters.length > 0?"}
CheckClusters --> |No| DefaultView["Use default center and zoom"]
CheckClusters --> |Yes| CalcSpread["Compute min/max lat/lng"]
CalcSpread --> CenterCalc["Calculate center as midpoint"]
CenterCalc --> SpreadCheck{"Compute spread"}
SpreadCheck --> ZoomSelect["Select zoom based on spread thresholds"]
ZoomSelect --> ApplyView{"centerProp or zoomProp provided?"}
ApplyView --> |Yes| Override["Use provided center/zoom"]
ApplyView --> |No| Auto["Use calculated center/zoom"]
Override --> FitBounds{"fitBounds enabled?"}
Auto --> FitBounds
FitBounds --> |Yes| Fit["Apply fitBounds to clusters"]
FitBounds --> |No| SkipFit["Skip fitting"]
Fit --> End(["Markers rendered"])
SkipFit --> End
```

**Diagram sources**
- [GoogleMapCluster.tsx:13-67](file://src/components/ui/map/GoogleMapCluster.tsx#L13-L67)
- [GoogleMapCluster.tsx:80-136](file://src/components/ui/map/GoogleMapCluster.tsx#L80-L136)

**Section sources**
- [GoogleMapCluster.tsx:13-181](file://src/components/ui/map/GoogleMapCluster.tsx#L13-L181)

### StaticMap
Responsibilities:
- Lazily loads GoogleMapCluster when the container enters the viewport.
- Tracks map load analytics when visible.
- Manages hover state for cluster markers and passes it down.

Props:
- clusters, center, zoom, height, className, onClusterClick, interactive, fitBounds, renderDetailContent, showZoomControls.

Behavior:
- Shows a loading placeholder until visible.
- Dynamically imports GoogleMapCluster to reduce initial bundle cost.
- Delegates hover state to GoogleMapCluster via controlled props.

**Section sources**
- [StaticMap.tsx:9-103](file://src/components/ui/map/StaticMap.tsx#L9-L103)

### MapClusterMarker and MapMarkerHover
Responsibilities:
- Display a pin icon with variant, size, and state styles.
- Show a compact tooltip (count + label) or custom detail content on hover.
- Support emphasis states (hover/active) with visual transitions.

Props:
- count, label, variant, size, state, hoverMode, detailContent, isHovered.

Behavior:
- In compact mode, shows MapMarkerHover above the marker.
- In detail mode, renders provided detailContent.
- Applies CSS classes for visibility transitions on hover.

**Section sources**
- [MapClusterMarker.tsx:8-115](file://src/components/ui/map/MapClusterMarker.tsx#L8-L115)
- [MapMarkerHover.tsx:7-78](file://src/components/ui/map/MapMarkerHover.tsx#L7-L78)

### useMapClusters and buildLocalityPins
Responsibilities:
- Fetch raw location data per source (dashboard, collections, content, itineraries).
- Build clusters grouped by locality labels (“region, country” or “country”).
- Compute average coordinates and counts per group.
- Return clusters and entityIdsByLocality mapping for filtering.

Data flow:
- useQuery triggers query function with Supabase client.
- Query returns RawMapLocation[].
- buildLocalityPins groups and aggregates into MapClusterData[].

**Section sources**
- [useMapClusters.ts:16-61](file://src/hooks/useMapClusters.ts#L16-L61)
- [locality-pins.ts:4-78](file://src/lib/maps/locality-pins.ts#L4-L78)

## Dependency Analysis
Component relationships and external dependencies:
- GoogleMapCluster depends on @vis.gl/react-google-maps for Map, AdvancedMarker, MapControl, ControlPosition, useMap, and APIProvider.
- Theme integration via next-themes for map style selection.
- StaticMap dynamically imports GoogleMapCluster to optimize loading.
- useMapClusters depends on Supabase client and queries to retrieve raw locations.
- buildLocalityPins transforms raw data into cluster structures consumed by the map.

```mermaid
graph LR
GMC["GoogleMapCluster"] --> GM["@vis.gl/react-google-maps"]
GMC --> THEME["next-themes"]
SM["StaticMap"] --> GMC
UMC["useMapClusters"] --> SUPA["Supabase Client"]
UMC --> LP["buildLocalityPins"]
LP --> DATA["RawMapLocation[]"]
SM --> TRACK["trackMapLoad()"]
```

**Diagram sources**
- [GoogleMapCluster.tsx:1-12](file://src/components/ui/map/GoogleMapCluster.tsx#L1-L12)
- [StaticMap.tsx:34-37](file://src/components/ui/map/StaticMap.tsx#L34-L37)
- [useMapClusters.ts:1-15](file://src/hooks/useMapClusters.ts#L1-L15)
- [locality-pins.ts:1-3](file://src/lib/maps/locality-pins.ts#L1-L3)
- [maps.ts:11-33](file://src/lib/api/maps.ts#L11-L33)

**Section sources**
- [GoogleMapCluster.tsx:1-12](file://src/components/ui/map/GoogleMapCluster.tsx#L1-L12)
- [StaticMap.tsx:34-37](file://src/components/ui/map/StaticMap.tsx#L34-L37)
- [useMapClusters.ts:1-15](file://src/hooks/useMapClusters.ts#L1-L15)
- [locality-pins.ts:1-3](file://src/lib/maps/locality-pins.ts#L1-L3)
- [maps.ts:11-33](file://src/lib/api/maps.ts#L11-L33)

## Performance Considerations
- Lazy loading: StaticMap uses dynamic import and intersection observer to defer map initialization until visible, reducing initial bundle and runtime overhead.
- Cluster grouping: buildLocalityPins groups by string keys and computes averages once, minimizing repeated computations during render.
- Fit bounds: fitBounds is applied only when enabled; single-cluster optimization avoids unnecessary bounds computation.
- Interactive mode: Disabling gestures reduces interaction overhead when not needed.
- Analytics: trackMapLoad records usage without blocking UI; errors are caught to prevent failures.

Recommendations:
- Use fitBounds sparingly for large datasets; consider precomputing bounds or limiting visible clusters.
- Prefer compact hover mode for better performance with many markers.
- Ensure clusters array is memoized or stable to avoid re-renders.
- Keep cluster data minimal; pass only necessary fields to markers.

[No sources needed since this section provides general guidance]

## Troubleshooting Guide
Common issues and resolutions:
- Map does not appear:
  - Verify environment variables for Google Maps API key and map IDs are set.
  - Ensure the container has a defined height; StaticMap uses height prop to size the map.
- Clusters not centered or zoom incorrect:
  - Provide explicit center and zoom props to override auto-calculation.
  - Disable fitBounds if automatic fitting causes unexpected views.
- Interactions not working:
  - Set interactive=true to enable gestures and zoom controls.
  - Confirm onClusterClick and onHoverChange handlers are provided and correctly wired.
- Hover not showing:
  - Ensure hoveredClusterId and onHoverChange are managed in parent state.
  - Check that detailContent is provided when using detail hover mode.

Analytics and monitoring:
- trackMapLoad is called when the map becomes visible; failures are silently ignored to avoid breaking UI.

**Section sources**
- [GoogleMapCluster.tsx:9-12](file://src/components/ui/map/GoogleMapCluster.tsx#L9-L12)
- [StaticMap.tsx:57-65](file://src/components/ui/map/StaticMap.tsx#L57-L65)
- [maps.ts:11-33](file://src/lib/api/maps.ts#L11-L33)

## Conclusion
GoogleMapCluster provides a robust, theme-aware, and configurable interface for displaying clustered map data with Google Maps. It supports automatic view calculation, optional fit bounds, interactive gestures, and customizable hover details. Paired with StaticMap’s lazy loading and useMapClusters’ data processing, it offers an efficient and flexible solution for interactive map clustering in applications.

[No sources needed since this section summarizes without analyzing specific files]

## Appendices

### Configuration Options Summary
- clusters: Required array of cluster data objects.
- center: Optional [lat, lng] to override auto center.
- zoom: Optional number to override auto zoom.
- onClusterClick: Optional callback for cluster clicks.
- interactive: Boolean to enable gestures and zoom controls.
- fitBounds: Boolean to fit map to cluster bounds.
- renderDetailContent: Optional function to render custom detail content on hover.
- showZoomControls: Boolean to show zoom controls (defaults to interactive).
- hoveredClusterId: Controlled state for hover highlighting.
- onHoverChange: Callback to update hovered cluster id.

**Section sources**
- [GoogleMapCluster.tsx:69-172](file://src/components/ui/map/GoogleMapCluster.tsx#L69-L172)
- [StaticMap.tsx:21-32](file://src/components/ui/map/StaticMap.tsx#L21-L32)

### Example Setup Patterns
- Basic static map with clustering:
  - Provide clusters and let auto view calculate center and zoom.
  - Use StaticMap to lazy-load and manage hover state.
- Interactive map with custom detail content:
  - Set interactive=true and provide renderDetailContent to show rich info on hover.
  - Wire onClusterClick to handle navigation or actions.
- Custom bounds and zoom:
  - Pass center and zoom props to override automatic calculations.
  - Disable fitBounds if you want full control over viewport.

[No sources needed since this section provides conceptual examples]

### Data Model: MapClusterData
Fields:
- id: Unique identifier for the cluster.
- count: Number of items in the cluster.
- label: Human-readable label (e.g., “Region, Country”).
- latitude: Average latitude for the cluster.
- longitude: Average longitude for the cluster.
- variant: Visual variant (“by Country”, “by Collection”, “by Location”).
- size: Marker size (“Small”, “Medium”).
- state: Visual state (“Default”, “Hover”, “Active”).
- filterValue: Value used for filtering/grouping.

**Section sources**
- [StaticMap.tsx:9-19](file://src/components/ui/map/StaticMap.tsx#L9-L19)