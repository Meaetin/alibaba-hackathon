"use client";

import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { generateItinerary } from "@/lib/api/itineraries";
import { addLocationsToCollection } from "@/lib/supabase/queries";

interface UseCollectionLocationBatchOperationsOptions {
  source: "links" | "collections";
  collectionId?: string;
  onRefresh?: () => void;
  onJobCreated?: (job: { id: string }) => void;
}

export function useCollectionLocationBatchOperations({
  source,
  collectionId,
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
      if (source === "collections" && collectionId) {
      }
      const job = await generateItinerary({
        title: title ?? "New Itinerary",
        location_ids: locationIds,
        aiFillGaps,
        start_date: startDate,
        total_days: totalDays,
        country,
        region,
        latitude,
        longitude,
      });
      onJobCreated?.(job);
      return job;
    },
    [source, collectionId, onJobCreated],
  );

  return {
    handleAddToDestination,
    handleGenerateItinerary,
  };
}
