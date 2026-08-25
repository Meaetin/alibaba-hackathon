"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchItineraryDetail } from "@/lib/api/itineraries";
import { queryKeys } from "@/lib/query/queryKeys";

export function useItineraryDetailQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.itineraryDetail(id ?? ""),
    queryFn: () => fetchItineraryDetail(id!),
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}
