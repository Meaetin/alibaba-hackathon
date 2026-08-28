"use client";

import { useQuery } from "@tanstack/react-query";

import type { MapClusterData } from "@/components/ui/map/StaticMap";
import { getItineraries } from "@/lib/api/itineraries";
import { buildLocalityPins, type LocalityPinResult, type RawMapLocation } from "@/lib/maps/locality-pins";
import { queryKeys } from "@/lib/query/queryKeys";

type MapClusterSource = "dashboard" | "collections" | "content" | "itineraries";

/**
 * The pins on the static map at the top of `/home` and `/itineraries`.
 *
 * ## It plots itineraries, and only itineraries
 *
 * There were four queries here — dashboard, collections, content, itineraries —
 * against Supabase tables this build does not have, so all four returned an
 * empty array and the map has always been blank. Itineraries are the one kind
 * of thing with coordinates in the database, and `readItineraryList` already
 * returns them, so all four sources answer with the same list now.
 *
 * `source` stays in the signature because the two call sites pass different
 * values and the parameter is what a future collections backend would key on.
 * It currently changes nothing but the query key.
 */
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
      const itineraries = await getItineraries();
      // A trip with no resolved coordinates has nothing to pin. That happens
      // when every stop failed to persist, which is worth seeing as a missing
      // pin rather than as a pin at (0, 0) in the Gulf of Guinea.
      const located: RawMapLocation[] = itineraries.flatMap((itinerary) =>
        itinerary.latitude === undefined || itinerary.longitude === undefined
          ? []
          : [
              {
                entityId: itinerary.id,
                region: itinerary.region ?? null,
                country: itinerary.country ?? null,
                latitude: itinerary.latitude,
                longitude: itinerary.longitude,
              },
            ],
      );
      return buildLocalityPins(located, "by Location");
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
