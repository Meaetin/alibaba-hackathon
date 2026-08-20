"use client";

import Image from "next/image";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";

import { cn } from "@/lib/utils";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/primitives/Menu";

interface LodgingCardProps extends ComponentPropsWithoutRef<"div"> {
  id?: string;
  image: string;
  address: string;
  name: string;
  confirmation: string;
  cost: string;
  checkIn: string;
  checkInTime: string;
  checkOut: string;
  checkOutTime: string;
  checkInDate?: string;
  checkInTimeRaw?: string;
  checkOutDate?: string;
  checkOutTimeRaw?: string;
  currency?: string;
  latitude?: number;
  longitude?: number;
  /** Attachment id this lodging was extracted from. Drives card clickability. */
  sourceAttachmentId?: string | null;
  /** Muted, non-interactive state (Figma State=Disabled). */
  disabled?: boolean;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Fires when the card body (not the menu) is clicked. */
  onCardClick?: () => void;
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-0.5 min-w-0", className)}>
      <span className="type-body-3 font-medium text-content-secondary">{label}</span>
      <span className="type-body-2 font-medium text-content truncate">{value}</span>
    </div>
  );
}

const LodgingCard = forwardRef<HTMLDivElement, LodgingCardProps>(
  (
    {
      className,
      image,
      address,
      name,
      confirmation,
      cost,
      checkIn,
      checkInTime,
      checkOut,
      checkOutTime,
      checkInDate: _checkInDate,
      checkInTimeRaw: _checkInTimeRaw,
      checkOutDate: _checkOutDate,
      checkOutTimeRaw: _checkOutTimeRaw,
      currency,
      latitude: _latitude,
      longitude: _longitude,
      sourceAttachmentId,
      disabled = false,
      onEdit,
      onDelete,
      onCardClick,
      ...props
    },
    ref
  ) => {
    const checkInDisplay = [checkIn, checkInTime].filter(Boolean).join(" · ");
    const checkOutDisplay = [checkOut, checkOutTime].filter(Boolean).join(" · ");
    // `cost` is stored as a plain numeric string; pair it with `currency` only
    // for display so the value can round-trip back through the edit form.
    const costDisplay = cost ? `${currency ?? ""}${cost}`.trim() : "";
    const isInteractive = Boolean(sourceAttachmentId && onCardClick) && !disabled;

    return (
      <div
        ref={ref}
        data-slot="lodging-card"
        role={isInteractive ? "button" : undefined}
        tabIndex={isInteractive ? 0 : undefined}
        aria-label={isInteractive ? `Open source document for ${name || "lodging"}` : undefined}
        aria-disabled={disabled || undefined}
        onClick={isInteractive ? onCardClick : undefined}
        onKeyDown={
          isInteractive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onCardClick?.();
                }
              }
            : undefined
        }
        className={cn(
          "lodging-card group/lodging flex flex-col gap-0 p-2 border border-edge bg-surface rounded-2xl overflow-clip transition-shadow hover:shadow-default",
          isInteractive && "lodging-card-interactive cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong",
          disabled && "lodging-card-disabled opacity-50 pointer-events-none",
          className
        )}
        {...props}
      >
        {/* Image Section */}
        <div className="relative h-[120px] w-full overflow-hidden rounded-xl border border-edge-subtle shadow-default">
          <Image
            src={image}
            alt={name}
            fill
            className="object-cover"
            sizes="(max-width: 768px) 100vw, 384px"
          />
        </div>

        {/* Details Section */}
        <div className="relative flex flex-col gap-2 rounded-lg p-3">
          {/* Name */}
          <div>
            <span className="type-body-3 font-medium text-content-secondary">Name</span>
            <p className="type-body-2 font-medium text-content mt-0.5">{name || "—"}</p>
          </div>

          {/* Address */}
          {address && (
            <div>
              <span className="type-body-3 font-medium text-content-secondary">Address</span>
              <p className="type-body-2 font-medium text-content mt-0.5">{address}</p>
            </div>
          )}

          {/* Check In & Check Out */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Check In" value={checkInDisplay || "—"} />
            <Field label="Check Out" value={checkOutDisplay || "—"} />
          </div>

          {/* Cost & Booking Ref */}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Cost" value={costDisplay || "—"} />
            <Field label="Booking Ref." value={confirmation || "—"} />
          </div>

          {/* More Menu */}
          <div
            className="lodging-card-menu absolute top-2 right-2 opacity-0 group-hover/lodging:opacity-100 transition-opacity"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Menu>
              <MenuTrigger className="flex items-center justify-center size-7 rounded-lg hover:bg-surface-muted-hover">
                <MoreVertical className="size-3.5 text-content-tertiary" />
              </MenuTrigger>
              <MenuContent align="end" side="bottom" sideOffset={4}>
                <MenuItem size="sm" icon="leading" leadingIcon={<Pencil className="size-3.5" />} onClick={onEdit}>
                  Edit
                </MenuItem>
                <MenuItem size="sm" icon="leading" variant="destructive" leadingIcon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                  Delete
                </MenuItem>
              </MenuContent>
            </Menu>
          </div>
        </div>
      </div>
    );
  }
);

LodgingCard.displayName = "LodgingCard";

export { LodgingCard };
export type { LodgingCardProps };
