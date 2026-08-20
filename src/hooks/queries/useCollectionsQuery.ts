"use client";

import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import {
  getCollections,
  type CollectionWithRole,
} from "@/lib/api/collections";

export function useCollectionsQuery() {
  return useQuery<CollectionWithRole[]>({
    queryKey: queryKeys.collections(),
    queryFn: () => getCollections(),
    staleTime: 60 * 1000,
  });
}
