import type { MapClusterData } from "@/components/ui/map/StaticMap";
import type { RawMapLocation } from "@/lib/supabase/queries/map-clusters";

export interface ClusterResult {
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

export function buildClusters(
  items: RawMapLocation[],
  variant: MapClusterData["variant"],
): ClusterResult {
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
