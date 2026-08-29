"use client";

import { useCallback } from "react";
import { addLocationsToCollection } from "@/lib/api/collections";
import { createItineraryRouted } from "@/lib/api/itineraries";
import { announcePlanningJob } from "@/lib/jobs/events";
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
  /**
   * Puts the given places on a collection.
   *
   * `destinationId` is always a **collection** id. The itinerary callers pass
   * the trip's companion collection — `ActionToolbarItinerary.collectionId` —
   * because an itinerary is a schedule and a place with no day and no time has
   * nowhere to sit in one. Saving to a trip means saving to its shelf.
   *
   * It refreshes rather than patching local state: the response says how many
   * places actually landed, and a place already on the shelf lands zero times.
   */
  const handleAddToDestination = useCallback(
    async (destinationId: string, locationIds: string[]) => {
      if (locationIds.length === 0) return;
      await addLocationsToCollection(destinationId, locationIds);
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
      if (result.kind === "planning") {
        // Announced here, not left to each caller. A plan started from a
        // collection or a link is the same plan as one started from the create
        // modal, and both of those pages had been throwing the row away — so
        // the layout queue never polled it, its "Itinerary ready" toast could
        // not fire, and the loading overlay animated nothing.
        announcePlanningJob(result.job);
        onJobCreated?.(result.job);
      }
      return result;
    },
    [source, onJobCreated],
  );

  return {
    handleAddToDestination,
    handleGenerateItinerary,
  };
}
