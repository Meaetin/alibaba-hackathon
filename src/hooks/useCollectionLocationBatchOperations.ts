"use client";

import { useCallback } from "react";
import { createItineraryRouted } from "@/lib/api/itineraries";
import type { QueueJob } from "@/lib/jobs/types";

interface UseCollectionLocationBatchOperationsOptions {
  source: "links" | "collections";
  onRefresh?: () => void;
  onJobCreated?: (job: QueueJob) => void;
}

export function useCollectionLocationBatchOperations({
  source,
  onRefresh,
  onJobCreated,
}: UseCollectionLocationBatchOperationsOptions) {
  const handleAddToDestination = useCallback(
    async (
      destinationId: string,
      locationIds: string[],
      _backingCollectionId?: string,
    ) => {
      if (locationIds.length === 0) return;
      // Collections have no store in this build — the table this wrote to left
      // with Supabase. It throws rather than resolving quietly: the caller
      // shows a success toast, and "added to collection" over a write that did
      // not happen is worse than a plain error the traveller can see.
      throw new Error("Collections are not available in this build.");
    },
    [onRefresh],
  );

  const handleGenerateItinerary = useCallback(
    async (
      locationIds: string[],
      country: string,
      startDate: string,
      totalDays: number,
      title?: string,
      region?: string,
      latitude?: number,
      longitude?: number,
      aiFillGaps: boolean = true,
    ) => {
      const result = await createItineraryRouted({
        source: source === "collections" ? "collection_detail" : "link_detail",
        tripName: title ?? "New Itinerary",
        selectedLocationIds: locationIds,
        aiRecommendations: aiFillGaps,
        startDate,
        totalDays,
        country,
        region,
        latitude,
        longitude,
      });
      if (result.kind === "planning") onJobCreated?.(result.job);
      return result;
    },
    [source, onJobCreated],
  );

  return {
    handleAddToDestination,
    handleGenerateItinerary,
  };
}
