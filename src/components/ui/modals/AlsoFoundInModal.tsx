"use client";

import { Dialog } from "@base-ui/react/dialog";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";
import { Separator } from "@/components/ui/primitives/Separator";
import { AlsoInCard } from "@/components/ui/detail-views/AlsoInCard";
import type { LocationReference } from "@/lib/domain-types";

interface AlsoFoundInModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The location the references belong to — rendered as the header card. */
  location: {
    name: string;
    description?: string | null;
    thumbnailUrl?: string | null;
  };
  /** Other collections + itineraries containing this location. */
  references: LocationReference[];
  /** Shows a spinner in the list while the cross-reference query is in flight. */
  loading?: boolean;
}

/**
 * AlsoFoundInModal — "Show more" overlay listing every other collection and
 * itinerary that also contains the current location. Opened from the location
 * panel's "Also found in" section. Informational only (rows do not navigate).
 *
 * Figma: Argo-v4 → "Show More modal" (node 1433:20349).
 */
export function AlsoFoundInModal({
  open,
  onOpenChange,
  location,
  references,
  loading = false,
}: AlsoFoundInModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Backdrop */}
        <Dialog.Backdrop className="also-found-in-backdrop fixed inset-0 z-40 bg-black/50 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />

        {/* Modal */}
        <Dialog.Popup
          data-region="itinerary-edit-also-found-in-modal"
          className={cn(
            "also-found-in-popup fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "flex flex-col items-center gap-3 p-4 rounded-2xl w-[min(37.5rem,92vw)] max-h-[min(40rem,85vh)]",
            "bg-surface border border-edge shadow-default",
            "transition-[opacity,transform] duration-[var(--motion-duration-normal)]",
            "data-[starting-style]:opacity-0 data-[starting-style]:scale-95",
            "data-[ending-style]:opacity-0 data-[ending-style]:scale-95",
          )}
        >
          {/* Header Card */}
          <div className="also-found-in-header flex w-full items-start gap-3 rounded-xl bg-surface p-3">
            <div className="also-found-in-header-thumb size-[72px] shrink-0 overflow-hidden rounded-lg border border-edge bg-surface-alt">
              {location.thumbnailUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={location.thumbnailUrl}
                  alt=""
                  className="size-full object-cover"
                />
              )}
            </div>
            <div className="also-found-in-header-text flex min-w-0 flex-1 flex-col gap-1 overflow-hidden">
              <Dialog.Title className="also-found-in-title type-body-1 type-secondary font-semibold text-content">
                {location.name}
              </Dialog.Title>
              {location.description && (
                <p className="also-found-in-description type-body-2 font-medium text-content-secondary line-clamp-2">
                  {location.description}
                </p>
              )}
            </div>
          </div>

          {/* Separator */}
          <Separator orientation="horizontal" />

          {/* List Label */}
          <div className="also-found-in-label-row flex w-full items-center">
            <p className="also-found-in-label type-body-2 font-medium text-content">
              Also found in:
            </p>
          </div>

          {/* References List */}
          <div className="also-found-in-list flex min-h-0 w-full flex-1 flex-col items-center gap-3 overflow-y-auto">
            {loading ? (
              // Loading State
              <div className="flex w-full items-center justify-center py-12 text-content-secondary">
                <Loader2 className="size-5 animate-spin" />
              </div>
            ) : references.length > 0 ? (
              references.map((ref) => (
                <AlsoInCard
                  key={`${ref.type}-${ref.id}`}
                  data-region="itinerary-also-found-in-row"
                  title={ref.name}
                  type={ref.type}
                  count={ref.locationCount}
                  countLabel="Locations"
                  thumbnailUrl={ref.thumbnailUrl ?? undefined}
                  className="w-full border-edge"
                />
              ))
            ) : (
              // Empty State
              <p className="py-12 type-body-2 text-content-secondary">
                Not found in any other collections or itineraries.
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="also-found-in-footer flex w-full items-center justify-center">
            <Button variant="ghost" size="md" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

AlsoFoundInModal.displayName = "AlsoFoundInModal";
