"use client";

import { useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { generateItinerary } from "@/lib/api/itineraries";
import { addLocationsToCollection } from "@/lib/supabase/queries";
import { type Surface } from "@/lib/domain-types";

interface UseCollectionLocationBatchOperationsOptions {
  source: "links" | "collections";
  collectionId?: string;
  onRefresh?: () => void;
  onJobCreated?: (job: { id: string }) => void;
}

/** Describes the save for analytics — itineraries save into a backing collection,
 *  so the destination id alone can't tell the two apart. */
interface SaveTarget {
  target: "collection" | "itinerary";
  /** True when saving a multi-select, false for a single location from the detail panel. */
  isBatch: boolean;
  targetIsNew?: boolean;
  /** Set for itinerary saves so the event carries the itinerary, not its backing collection. */
  itineraryId?: string;
}

const SOURCE_SURFACE: Record<"links" | "collections", Surface> = {
  links: "link_detail",
  collections: "collection_detail",
};

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
      saveTarget?: SaveTarget,
    ) => {
      if (locationIds.length === 0) return;
      const supabase = createClient();
      const targetId = backingCollectionId ?? destinationId;
      const surface = SOURCE_SURFACE[source];
      const { error } = await addLocationsToCollection(
        supabase,
        targetId,
        locationIds,
      );
      if (error) {
        if (saveTarget) {
        }
        throw error;
      }
      if (saveTarget?.target === "itinerary") {
      } else if (saveTarget?.target === "collection") {
      }
      onRefresh?.();
    },
    [onRefresh, source],
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
