"use client";

import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { createItineraryRouted } from "@/lib/api/itineraries";
import { addLocationsToCollection } from "@/lib/supabase/queries";
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
      backingCollectionId?: string,
    ) => {
      if (locationIds.length === 0) return;
      const supabase = createClient();
      const targetId = backingCollectionId ?? destinationId;
      const { error } = await addLocationsToCollection(
        supabase,
        targetId,
        locationIds,
      );
      if (error) throw error;
      onRefresh?.();
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
