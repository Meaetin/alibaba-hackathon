"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getRecentlyViewed } from "@/lib/supabase/queries/recentlyViewed";
import { queryKeys } from "@/lib/query/queryKeys";

export function useRecentlyViewedQuery(userId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.recentlyViewed(userId ?? ""),
    queryFn: () => {
      const supabase = createClient();
      return getRecentlyViewed(supabase, userId!);
    },
    enabled: !!userId && enabled,
    staleTime: 2 * 60 * 1000,
  });
}
