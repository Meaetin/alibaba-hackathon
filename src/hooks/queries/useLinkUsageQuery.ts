"use client";

import { useQuery } from "@tanstack/react-query";
import { getQuota } from "@/lib/api/profile";
import { queryKeys } from "@/lib/query/queryKeys";

function getMonthResetDate(): string {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

export interface LinkUsage {
  used: number;
  max: number;
  planName: string;
  resetDate: string;
}

export function useLinkUsageQuery(userId: string | null) {
  return useQuery<LinkUsage>({
    queryKey: queryKeys.linkUsage(userId!),
    queryFn: async () => {
      const quota = await getQuota();
      return {
        used: quota.used,
        max: quota.monthly_limit,
        planName: quota.display_name,
        resetDate: getMonthResetDate(),
      };
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
}
