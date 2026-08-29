"use client";

import { useQuery } from "@tanstack/react-query";

import type { MapClusterData } from "@/components/ui/map/StaticMap";
import { getContent } from "@/lib/api/content";
import { getItineraries } from "@/lib/api/itineraries";
import { buildLocalityPins, type LocalityPinResult, type RawMapLocation } from "@/lib/maps/locality-pins";
import { queryKeys } from "@/lib/query/queryKeys";

type MapClusterSource = "dashboard" | "collections" | "content" | "itineraries";

/**
 * The pins on the static map at the top of `/home` and `/itineraries`.
 *
 * ## It plots itineraries and analyzed links
 *
 * There were four queries here — dashboard, collections, content, itineraries —
 * against Supabase tables this build does not have, so all four returned an
 * empty array and the map has always been blank. Two have a backend now, and
 * `source` finally means something: `"content"` plots links, `"itineraries"`
 * plots trips, and the dashboard plots both.
 *
 * A link's coordinate is the first place it named that has one, which is the
 * same kind of stand-in as an itinerary card's thumbnail. A link whose places
 * all failed to resolve has nothing to pin, and that is worth seeing as a
 * missing pin rather than as a pin at (0, 0) in the Gulf of Guinea.
 *
 * One failing read must not blank the other kind's pins, so the two are settled
 * independently — the same rule `useDashboardRecent` keeps.
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
      const wantsItineraries = source !== "content";
      const wantsLinks = source === "dashboard" || source === "content";

      const [tripResult, linkResult] = await Promise.allSettled([
        wantsItineraries ? getItineraries() : Promise.resolve([]),
        wantsLinks ? getContent() : Promise.resolve([]),
      ]);

      if (tripResult.status === "rejected") {
        console.error("[map] the itinerary pins could not be loaded", tripResult.reason);
      }
      if (linkResult.status === "rejected") {
        console.error("[map] the link pins could not be loaded", linkResult.reason);
      }

      const itineraries = tripResult.status === "fulfilled" ? tripResult.value : [];
      const links = linkResult.status === "fulfilled" ? linkResult.value : [];
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
      const linkPins: RawMapLocation[] = links.flatMap((item) =>
        item.latitude === null || item.longitude === null
          ? []
          : [
              {
                entityId: item.id,
                region: item.primary_region,
                country: item.primary_country,
                latitude: item.latitude,
                longitude: item.longitude,
              },
            ],
      );

      return buildLocalityPins([...located, ...linkPins], "by Location");
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
