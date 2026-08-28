"use client";

import { useCurrentUserQuery } from "./queries/useCurrentUserQuery";

/**
 * The signed-in user's id, or `null` while it is loading and when signed out.
 *
 * The signature is unchanged from the Supabase version this replaces, which is
 * why its nine call sites did not move. The body is different in one way that
 * matters: this shares a single TanStack query with every other caller, where
 * the old hook ran its own `useEffect` and asked again on every mount.
 *
 * It still cannot tell "loading" from "signed out" — both are `null` — because
 * the components reading it only ever use the id to enable a query. Anything
 * that needs the difference, like a redirect, must read `useCurrentUserQuery`
 * directly and look at `isLoading`.
 */
export function useSessionUserId(): string | null {
  return useCurrentUserQuery().data?.id ?? null;
}
