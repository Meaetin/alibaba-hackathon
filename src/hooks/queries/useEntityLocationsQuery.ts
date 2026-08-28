"use client";

import { useQuery } from "@tanstack/react-query";

import type { EntityLocationItem } from "@/lib/domain-types";
import { queryKeys } from "@/lib/query/queryKeys";

/**
 * The locations inside a link, collection or itinerary.
 *
 * **There is no backend for this.** It joined Supabase tables this build does
 * not have. For an *itinerary* the same data already comes back on
 * `GET /api/itineraries/[id]`, so this is the shortest of the wiring jobs left
 * here — the other two entity types have no store at all.
 *
 * Kept rather than deleted because the navbar's location filter is typed
 * against it.
 */
export function useEntityLocationsQuery(
  entityType: "link" | "collection" | "itinerary" | null,
  entityId: string | null,
) {
  return useQuery<EntityLocationItem[]>({
    queryKey: queryKeys.entityLocations(entityType ?? "", entityId ?? ""),
    queryFn: async () => [],
    enabled: !!entityType && !!entityId,
    staleTime: 5 * 60 * 1000,
  });
}
