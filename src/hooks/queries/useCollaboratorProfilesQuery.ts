"use client";

import { useQuery } from "@tanstack/react-query";

import type { ProfileRow } from "@/lib/domain-types";

/**
 * The people sharing a collection or itinerary.
 *
 * **There is no backend for this**, and there is no caller either — sharing and
 * collaborators left with the old REST backend. It survives because it costs
 * four lines, and it is the first thing to delete if this directory is trimmed.
 */
export function useCollaboratorProfilesQuery(userIds: string[]) {
  return useQuery<ProfileRow[]>({
    queryKey: ["collaboratorProfiles", ...userIds.slice().sort()],
    queryFn: async () => [],
    enabled: userIds.length > 0,
    staleTime: Infinity,
  });
}
