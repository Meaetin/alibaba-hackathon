"use client";

import { MapPin } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { motionTransitions } from "@/lib/motion/presets";
import { PanelEmptyState } from "@/components/ui/detail-views/PanelEmptyState";
import { DraggablePanelCard } from "./DraggablePanelCard";
import type {
  CollectionWithRole,
  CollectionWithLocations,
  Location,
} from "@/lib/api/collections";

interface CollectionPanelProps {
  collections: CollectionWithRole[];
  loading?: boolean;
  itineraryCollection?: CollectionWithLocations | null;
  itineraryLocationIds?: Set<string>;
  showItineraryActivities?: boolean;
  onLocationSelect?: (location: Location) => void;
  onClose?: () => void;
  className?: string;
}

export function CollectionPanel({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  collections,
  loading,
  itineraryCollection,
  itineraryLocationIds,
  showItineraryActivities = true,
  onLocationSelect,
  className,
}: CollectionPanelProps) {
  const prefersReducedMotion = useReducedMotion();

  const hasLocations =
    itineraryCollection && itineraryCollection.locations.length > 0;

  const filteredLocations = hasLocations
    ? itineraryCollection.locations.filter((location) =>
        showItineraryActivities || !itineraryLocationIds?.has(location.id)
      )
    : [];

  return (
    <div
      data-slot="collection-panel"
      className={cn("collection-panel flex flex-col h-full", className)}
    >
      {/* Loading State */}
      {loading && (
        <div className="collection-panel-loading flex items-center justify-center flex-1">
          <div className="collection-panel-spinner size-6 border-2 border-edge border-t-action-dark rounded-full animate-spin" />
        </div>
      )}

      {/* Empty State */}
      {!loading && !hasLocations && (
        <PanelEmptyState
          data-region="itinerary-edit-panel-collection-empty"
          imageSrc="/images/stickers/Location%20Pin.svg"
          title="No Items Yet"
          description="Add items to get started with your collection."
          className="collection-panel-empty"
        />
      )}

      {/* All Filtered State */}
      {!loading && hasLocations && filteredLocations.length === 0 && (
        <div className="collection-panel-all-scheduled flex flex-col items-center justify-center flex-1 gap-2 text-content-secondary">
          <MapPin className="collection-panel-all-scheduled-icon size-6 opacity-40" />
          <p className="collection-panel-all-scheduled-title type-body-2 font-medium">All locations scheduled</p>
          <p className="collection-panel-all-scheduled-subtitle type-body-3 text-center text-content-tertiary">
            Every location in this collection is already in your itinerary
          </p>
        </div>
      )}

      {/* Location Cards Grid */}
      {!loading && hasLocations && filteredLocations.length > 0 && (
        <motion.div
          layout
          transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.spatial}
          data-region="itinerary-edit-collection-grid"
          className="collection-panel-grid grid grid-cols-2 gap-2"
        >
          <AnimatePresence initial={false}>
            {filteredLocations.map((location) => (
              <motion.div
                key={location.id}
                layout
                initial={prefersReducedMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.control}
                className="collection-panel-card-item h-[220px]"
              >
                <DraggablePanelCard
                  location={location}
                  onClick={() => onLocationSelect?.(location)}
                  className="collection-panel-card h-full"
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

CollectionPanel.displayName = "CollectionPanel";
