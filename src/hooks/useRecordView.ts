"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordView } from "@/lib/supabase/mutations/recordView";
import { queryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/queryKeys";

export function useRecordView(
  entityType: "link" | "collection" | "itinerary",
  entityId: string | undefined,
) {
  const recorded = useRef(false);

  useEffect(() => {
    if (!entityId || recorded.current) return;
    recorded.current = true;

    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      const userId = data.session?.user.id;
      if (!userId) return;
      recordView(supabase, entityType, entityId).then(() => {
        queryClient.invalidateQueries({
          queryKey: queryKeys.recentlyViewed(userId),
        });
      });
    });
  }, [entityType, entityId]);
}
