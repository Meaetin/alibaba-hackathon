"use client";

import { useQuery } from "@tanstack/react-query";

import type { LocationReference, LocationReferenceExclude } from "@/lib/domain-types";
import { queryKeys } from "@/lib/query/queryKeys";

/**
 * Collections and itineraries, other than the one being viewed, that also
 * contain a location.
 *
 * **There is no backend for this.** It read Supabase tables this build does not
 * have. Wiring it means a Neon read and a route under `src/app/api/`.
 *
 * Kept rather than deleted because the "also found in" block renders from it in
 * two detail panels, and an empty list is exactly the right answer for a
 * traveller whose only itinerary is the one they are looking at.
 */
export function useLocationReferencesQuery(
  locationId: string | null | undefined,
  exclude?: LocationReferenceExclude,
  enabled = true,
) {
  return useQuery<LocationReference[]>({
    queryKey: queryKeys.locationReferences(locationId ?? "", exclude),
    queryFn: async () => [],
    enabled: !!locationId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}
