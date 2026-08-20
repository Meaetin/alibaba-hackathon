"use client";

import { motion } from "motion/react";
import { Loader2 } from "lucide-react";

import { LodgingCard, type LodgingCardProps } from "./LodgingCard";
import { PanelEmptyState } from "./PanelEmptyState";

interface LodgingSidebarProps {
  lodgings: LodgingCardProps[];
  loading?: boolean;
  onAddManual?: () => void;
  onUpload?: () => void;
  onLodgingEdit?: (lodgingId: string) => void;
  onLodgingDelete?: (lodgingId: string) => void;
  onLodgingOpen?: (lodgingId: string) => void;
}

const easeOutQuart = [0.25, 1, 0.5, 1] as const;

function LodgingSidebar({ lodgings, loading, onLodgingEdit, onLodgingDelete, onLodgingOpen }: LodgingSidebarProps) {
  if (loading) {
    return (
      <div className="lodging-loading-state flex flex-col items-center justify-center flex-1 py-16 gap-3">
        <Loader2 className="lodging-loading-spinner size-8 text-content-secondary animate-spin" />
        <p className="lodging-loading-text type-body-2 text-content-secondary">
          Extracting lodging details...
        </p>
      </div>
    );
  }

  if (lodgings.length === 0) {
    return (
      <div data-region="itinerary-edit-panel-lodging-empty" className="lodging-empty-state-wrapper flex flex-1 h-full">
        <PanelEmptyState
          imageSrc="/images/stickers/Luggage.svg"
          title="No Items Yet"
          description="Add items to get started with your collection."
          className="w-full"
        />
      </div>
    );
  }

  return (
    <div className="lodging-sidebar-list flex flex-col gap-2 px-2 pb-3">
      {lodgings.map((lodging, i) => (
        <motion.div
          key={lodging.id ?? `lodging-${i}`}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{
            duration: 0.35,
            ease: easeOutQuart,
            delay: i * 0.08,
          }}
        >
          <LodgingCard
            {...lodging}
            onEdit={lodging.id ? () => onLodgingEdit?.(lodging.id!) : undefined}
            onDelete={lodging.id ? () => onLodgingDelete?.(lodging.id!) : undefined}
            onCardClick={
              lodging.id && lodging.sourceAttachmentId && onLodgingOpen
                ? () => onLodgingOpen(lodging.id!)
                : undefined
            }
          />
        </motion.div>
      ))}
    </div>
  );
}

export { LodgingSidebar };
export type { LodgingSidebarProps };
