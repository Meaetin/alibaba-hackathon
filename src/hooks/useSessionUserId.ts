import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Resolves the current authenticated user's id from the Supabase session.
 * Returns null until the session loads (or when signed out).
 */
export function useSessionUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null);
    });
  }, []);

  return userId;
}
