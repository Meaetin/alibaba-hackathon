"use client";

import {
  Trash2,
  Sparkles,
} from "lucide-react";

import { Popover } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { menuVariants, menuItemVariants } from "@/components/ui/primitives/Menu";

export type ListingCardType = "link" | "collection" | "itinerary" | "location";

interface ListingContextMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  coords: { x: number; y: number } | null;
  cardType: ListingCardType;
  onAddToCollection?: () => void;
  onAddToItinerary?: () => void;
  onGenerateItinerary?: () => void;
  onDelete?: () => void;
}

interface ContextMenuItemProps {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  variant?: "default" | "destructive";
}

function ContextMenuItem({ icon, children, onClick, variant = "default" }: ContextMenuItemProps) {
  return (
    <button
      className={cn(
        "context-menu-item",
        menuItemVariants({ size: "lg", icon: "leading", variant }),
        variant === "default" && "hover:bg-surface-alt hover:border-edge-subtle",
        "w-full text-left",
      )}
      onClick={onClick}
    >
      <span className="context-menu-item-icon flex items-center justify-center">{icon}</span>
      <span className="context-menu-item-label flex items-center gap-1">{children}</span>
    </button>
  );
}

const showAddToCollection: Record<ListingCardType, boolean> = {
  link: true,
  collection: false,
  itinerary: false,
  location: true,
};

const showAddToItinerary: Record<ListingCardType, boolean> = {
  link: true,
  collection: true,
  itinerary: false,
  location: true,
};

const showDelete: Record<ListingCardType, boolean> = {
  link: true,
  collection: true,
  itinerary: true,
  location: false,
};

export function ListingContextMenu({
  open,
  onOpenChange,
  coords,
  cardType,
  onAddToCollection,
  onAddToItinerary,
  onGenerateItinerary,
  onDelete,
}: ListingContextMenuProps) {
  const hasDestinationOptions = showAddToCollection[cardType] || showAddToItinerary[cardType];
  const canDelete = showDelete[cardType] && onDelete;

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger
        nativeButton={false}
        render={
          <div
            aria-hidden
            style={{
              position: "fixed",
              left: coords?.x ?? 0,
              top: coords?.y ?? 0,
              width: 0,
              height: 0,
              pointerEvents: "none",
            }}
          />
        }
      />
      <Popover.Portal>
        <Popover.Positioner
          className="z-[120]"
          sideOffset={4}
          align="start"
          side="bottom"
          collisionPadding={8}
        >
          <Popover.Popup
            className={cn("outline-none", menuVariants())}
          >
            <div className="context-menu-popup flex flex-col items-stretch overflow-clip rounded-lg">
              {showAddToCollection[cardType] && onAddToCollection && (
                <ContextMenuItem
                  icon={<CategoryBadge category="collection" />}
                  onClick={onAddToCollection}
                >
                  Add to Collection
                </ContextMenuItem>
              )}
              {showAddToItinerary[cardType] && onAddToItinerary && (
                <ContextMenuItem
                  icon={<CategoryBadge category="itinerary" />}
                  onClick={onAddToItinerary}
                >
                  Add to Itinerary
                </ContextMenuItem>
              )}
              {cardType === "location" && onGenerateItinerary && (
                <ContextMenuItem
                  icon={<CategoryBadge category="itinerary" icon={Sparkles} />}
                  onClick={onGenerateItinerary}
                >
                  Generate Itinerary
                </ContextMenuItem>
              )}

              {canDelete && (
                <>
                  {hasDestinationOptions && (
                    <div className="context-menu-separator -mx-1 my-1 h-px bg-edge-strong" />
                  )}
                  <ContextMenuItem
                    icon={
                      <CategoryBadge category="neutral" icon={Trash2} />
                    }
                    onClick={onDelete}
                    variant="destructive"
                  >
                    Delete
                  </ContextMenuItem>
                </>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
