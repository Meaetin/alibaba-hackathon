"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import {
  getItineraries,
  type ItineraryWithRole,
} from "@/lib/api/itineraries";

export function useItinerariesQuery() {
  return useQuery<ItineraryWithRole[]>({
    queryKey: queryKeys.itineraries(),
    queryFn: getItineraries,
    staleTime: 60 * 1000,
  });
}
