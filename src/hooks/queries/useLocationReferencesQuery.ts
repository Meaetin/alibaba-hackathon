"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  getLocationReferences,
  type LocationReferenceExclude,
} from "@/lib/supabase/queries/location-references";
import { queryKeys } from "@/lib/query/queryKeys";

/**
 * Collections + itineraries (other than the one currently being viewed) that
 * also contain a location. Disabled until a real `locationId` is supplied so
 * locally-added, not-yet-persisted activities never trigger a fetch.
 */
export function useLocationReferencesQuery(
  locationId: string | null | undefined,
  exclude?: LocationReferenceExclude,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.locationReferences(locationId ?? "", exclude),
    queryFn: () => {
      const supabase = createClient();
      return getLocationReferences(supabase, locationId!, exclude);
    },
    enabled: !!locationId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}
