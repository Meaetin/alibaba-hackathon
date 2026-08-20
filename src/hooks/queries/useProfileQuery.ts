"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getProfile, type ProfileRow } from "@/lib/supabase/queries";
import { queryKeys } from "@/lib/query/queryKeys";

export function useProfileQuery(userId: string | null) {
  return useQuery<ProfileRow | null>({
    queryKey: queryKeys.profile(userId ?? ""),
    queryFn: () => {
      const supabase = createClient();
      return getProfile(supabase, userId!);
    },
    enabled: !!userId,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
