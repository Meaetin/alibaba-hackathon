"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { searchViaRpc } from "@/lib/supabase/queries/search";
import { queryKeys } from "@/lib/query/queryKeys";

export function useSearchQuery(
  userId: string | null,
  query: string,
  filterType: string | null,
  offset: number,
) {
  return useQuery({
    queryKey: queryKeys.search(query, filterType, offset),
    queryFn: () => {
      const supabase = createClient();
      return searchViaRpc(supabase, userId!, query, filterType, offset);
    },
    enabled: !!userId && query.trim().length > 0,
    staleTime: 30 * 1000,
  });
}
