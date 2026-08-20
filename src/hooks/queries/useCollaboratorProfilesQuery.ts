"use client";

import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getProfiles } from "@/lib/supabase/queries";

export function useCollaboratorProfilesQuery(userIds: string[]) {
  return useQuery({
    queryKey: ["collaboratorProfiles", ...userIds.slice().sort()],
    queryFn: () => {
      const supabase = createClient();
      return getProfiles(supabase, userIds);
    },
    enabled: userIds.length > 0,
    staleTime: Infinity,
  });
}
