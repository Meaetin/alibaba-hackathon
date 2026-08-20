"use client";

import type { ReactNode } from "react";
import { Layers, Map as MapIcon, Trash2 } from "lucide-react";

import { Popover } from "@base-ui/react/popover";
import { cn } from "@/lib/utils";
import { menuItemVariants, menuVariants } from "@/components/ui/primitives/Menu";

interface CardActionMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fixed-viewport coordinates to anchor the menu at (kebab button or cursor). */
  coords: { x: number; y: number } | null;
  onDelete?: () => void;
  onAddToCollection?: () => void;
  onAddToItinerary?: () => void;
}

function CardActionMenuItem({
  icon,
  children,
  onClick,
}: {
  icon: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "card-action-menu-item w-full text-left",
        menuItemVariants({ variant: "default", size: "lg", icon: "leading" }),
      )}
      onClick={onClick}
    >
      <span className="flex size-5 items-center justify-center">{icon}</span>
      {children}
    </button>
  );
}

/**
 * Per-card kebab / right-click menu for the card family. Figma node `1738:12564` —
 * the design-system Menu with plain leading glyphs and a **non-destructive** Delete
 * (default variant, no red). Renders only the actions it is given; a separator
 * divides the add-to-destination actions from Delete. Positioned via a zero-size
 * virtual trigger at `coords`, so it can open from the kebab button or a right-click.
 *
 * Owned by `BaseCard` — pages supply the action callbacks, not the menu itself.
 */
export function CardActionMenu({
  open,
  onOpenChange,
  coords,
  onDelete,
  onAddToCollection,
  onAddToItinerary,
}: CardActionMenuProps) {
  const hasAddAction = Boolean(onAddToCollection || onAddToItinerary);

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
          sideOffset={8}
          align="end"
          side="bottom"
          collisionPadding={8}
        >
          <Popover.Popup className={cn("outline-none", menuVariants())}>
            <div className="card-action-menu flex flex-col items-stretch">
              {onAddToCollection && (
                <CardActionMenuItem icon={<Layers className="size-4" />} onClick={onAddToCollection}>
                  Add to Collection
                </CardActionMenuItem>
              )}
              {onAddToItinerary && (
                <CardActionMenuItem icon={<MapIcon className="size-4" />} onClick={onAddToItinerary}>
                  Add to Itinerary
                </CardActionMenuItem>
              )}
              {hasAddAction && onDelete && (
                <div className="card-action-menu-separator my-1 h-px bg-edge-subtle" />
              )}
              {onDelete && (
                <CardActionMenuItem icon={<Trash2 className="size-4" />} onClick={onDelete}>
                  Delete
                </CardActionMenuItem>
              )}
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
