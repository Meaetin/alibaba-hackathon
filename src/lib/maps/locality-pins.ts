import type { MapClusterData } from "@/components/ui/map/StaticMap";

/**
 * Groups saved entities into map PINS by their `"{region}, {country}"` label —
 * a presentation concern for the home/collections static maps. It is string
 * grouping, not geometry: the pin's lat/lng is the mean of its members.
 *
 * This is NOT the planner's geographic clustering. Day assignment uses k-means
 * over raw coordinates (`src/lib/planner/cluster.ts`) to build neighbourhood
 * clusters; the two must not be confused or shared.
 */

/**
 * One thing with a place on the map. Declared here, with the function that
 * consumes it, rather than in whatever module happens to produce it — it used
 * to live in a Supabase query file, which meant deleting that backend would
 * have taken the input type of this one with it.
 */
export interface RawMapLocation {
  entityId: string;
  region: string | null;
  country: string | null;
  latitude: number;
  longitude: number;
}

export interface LocalityPinResult {
  clusters: MapClusterData[];
  entityIdsByLocality: Map<string, Set<string>>;
}

interface GroupData {
  label: string;
  filterValue: string;
  latitudeSum: number;
  longitudeSum: number;
  count: number;
  entityIds: Set<string>;
}

export function buildLocalityPins(
  items: RawMapLocation[],
  variant: MapClusterData["variant"],
): LocalityPinResult {
  const groups = new Map<string, GroupData>();

  for (const item of items) {
    if (!item.country) continue;

    const key = item.region ? `${item.region}, ${item.country}` : item.country;
    const existing = groups.get(key);

    if (existing) {
      existing.latitudeSum += item.latitude;
      existing.longitudeSum += item.longitude;
      existing.count += 1;
      existing.entityIds.add(item.entityId);
    } else {
      groups.set(key, {
        label: key,
        filterValue: key,
        latitudeSum: item.latitude,
        longitudeSum: item.longitude,
        count: 1,
        entityIds: new Set([item.entityId]),
      });
    }
  }

  const entityIdsByLocality = new Map<string, Set<string>>();
  const clusters: MapClusterData[] = [];

  for (const [key, data] of groups) {
    entityIdsByLocality.set(key, data.entityIds);

    clusters.push({
      id: key,
      count: data.entityIds.size,
      label: data.label,
      latitude: data.latitudeSum / data.count,
      longitude: data.longitudeSum / data.count,
      variant,
      size: "Small",
      state: "Default",
      filterValue: data.filterValue,
    });
  }

  return { clusters, entityIdsByLocality };
}
