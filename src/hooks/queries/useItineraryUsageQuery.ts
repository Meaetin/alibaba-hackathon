"use client";

import { useQuery } from "@tanstack/react-query";
import { getItineraryQuota } from "@/lib/api/profile";
import { queryKeys } from "@/lib/query/queryKeys";

export interface ItineraryUsage {
  used: number;
  max: number;
  planName: string;
  lifetimeGenerated: number;
}

export function useItineraryUsageQuery(userId: string | null) {
  return useQuery<ItineraryUsage>({
    queryKey: queryKeys.itineraryUsage(userId!),
    queryFn: async () => {
      const quota = await getItineraryQuota();
      return {
        used: quota.current_count,
        max: quota.max_itineraries,
        planName: quota.display_name,
        lifetimeGenerated: quota.lifetime_generated,
      };
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}
