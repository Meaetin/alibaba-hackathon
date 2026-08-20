"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getEntityLocations } from "@/lib/supabase/queries/search";
import { queryKeys } from "@/lib/query/queryKeys";

export function useEntityLocationsQuery(
  entityType: "link" | "collection" | "itinerary" | null,
  entityId: string | null,
) {
  return useQuery({
    queryKey: queryKeys.entityLocations(entityType ?? "", entityId ?? ""),
    queryFn: () => {
      const supabase = createClient();
      return getEntityLocations(supabase, entityType!, entityId!);
    },
    enabled: !!entityType && !!entityId,
    staleTime: 5 * 60 * 1000,
  });
}
