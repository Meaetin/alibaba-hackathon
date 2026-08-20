"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  getMapClustersForCollections,
  getMapClustersForContent,
  getMapClustersForItineraries,
  getMapClustersForDashboard,
  type RawMapLocation,
} from "@/lib/supabase/queries/map-clusters";
import { buildLocalityPins, type LocalityPinResult } from "@/lib/maps/locality-pins";
import type { MapClusterData } from "@/components/ui/map/StaticMap";
import { queryKeys } from "@/lib/query/queryKeys";

type MapClusterSource = "dashboard" | "collections" | "content" | "itineraries";

const variantBySource: Record<MapClusterSource, MapClusterData["variant"]> = {
  dashboard: "by Location",
  collections: "by Location",
  content: "by Location",
  itineraries: "by Location",
};

const queryBySource: Record<
  MapClusterSource,
  (supabase: ReturnType<typeof createClient>, userId: string) => Promise<RawMapLocation[]>
> = {
  dashboard: getMapClustersForDashboard,
  collections: getMapClustersForCollections,
  content: getMapClustersForContent,
  itineraries: getMapClustersForItineraries,
};

export function useMapClusters(
  userId: string | null,
  source: MapClusterSource,
): {
  clusters: MapClusterData[];
  entityIdsByLocality: Map<string, Set<string>>;
  isLoading: boolean;
} {
  const { data, isLoading } = useQuery<LocalityPinResult>({
    queryKey: queryKeys.mapClusters(userId ?? "", source),
    queryFn: async () => {
      const supabase = createClient();
      const raw = await queryBySource[source](supabase, userId!);
      return buildLocalityPins(raw, variantBySource[source]);
    },
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
    placeholderData: { clusters: [], entityIdsByLocality: new Map() },
  });

  return {
    clusters: data?.clusters ?? [],
    entityIdsByLocality: data?.entityIdsByLocality ?? new Map(),
    isLoading,
  };
}
