"use client";

import { useQuery } from "@tanstack/react-query";

import { fetchCurrentUser, type CurrentUser } from "@/lib/api/auth";
import { queryKeys } from "@/lib/query/queryKeys";

/**
 * Who is signed in, or `null`.
 *
 * One query for the whole app, so the nine components that ask do it once —
 * `useSessionUserId` and `useProfileQuery` are both thin readings of this. The
 * hook it replaced ran a bare `useEffect` per component and hit Supabase every
 * mount.
 *
 * `GET /api/auth/me` answers 200 with `{ user: null }` when nobody is signed
 * in, so signed-out is data here, not an error state. That is what lets
 * `isLoading` mean "we do not know yet" rather than doubling as "signed out",
 * which is the distinction a redirect has to get right.
 */
export function useCurrentUserQuery() {
  return useQuery<CurrentUser | null>({
    queryKey: queryKeys.currentUser(),
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000,
    // The session outlives a tab switch; refetching on every focus is a request
    // per alt-tab for an answer that changes twice a month.
    refetchOnWindowFocus: false,
    retry: false,
  });
}
