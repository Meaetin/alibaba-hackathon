"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getItineraryDetail } from "@/lib/supabase/queries/home";
import { queryKeys } from "@/lib/query/queryKeys";

export function useItineraryDetailQuery(id: string | null) {
  return useQuery({
    queryKey: queryKeys.itineraryDetail(id ?? ""),
    queryFn: () => {
      const supabase = createClient();
      return getItineraryDetail(supabase, id!);
    },
    enabled: !!id,
    staleTime: 5 * 60 * 1000,
  });
}
