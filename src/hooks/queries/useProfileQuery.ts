"use client";

import type { CurrentUser } from "@/lib/api/auth";

import { useCurrentUserQuery } from "./useCurrentUserQuery";

/**
 * The signed-in user's profile.
 *
 * It used to read a Supabase `profiles` table that this build never had, so it
 * always resolved to `null` and every consumer rendered "Guest". There is no
 * separate profile now — an account *is* the profile — so this reads the same
 * `/api/auth/me` query as everything else and keeps its old shape so the three
 * call sites do not move.
 *
 * `avatar_url` has no column and never had a real value; it stays on the type
 * as `null` because `Avatar` takes it and falls back to initials.
 */
export interface ProfileRow {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
}

function toProfile(user: CurrentUser | null | undefined): ProfileRow | null {
  if (!user) return null;
  return { ...user, avatar_url: null };
}

/**
 * `userId` is ignored: the cookie already says who is asking, and a client that
 * could name a different user would be asking for somebody else's profile. It
 * stays in the signature so the call sites keep compiling.
 */
export function useProfileQuery(_userId: string | null) {
  const query = useCurrentUserQuery();
  return { ...query, data: toProfile(query.data) };
}
