"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ReactNode } from "react";
import { MapPin, Clock, FerrisWheel, Link, Bookmark, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";

const popupVariants = cva(
  "location-hover-popup flex flex-col gap-3 p-1 rounded-xl bg-surface border border-edge w-80",
  {
    variants: {
      variant: {
        default: "shadow-default",
        flat: "",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

interface DetailRowProps {
  className?: string;
  text: string;
  type?: "location" | "openingHours";
}

function DetailRow({ className, text, type = "location" }: DetailRowProps) {
  const Icon = type === "openingHours" ? Clock : MapPin;

  return (
    <div className={cn(
      "location-hover-popup-row flex items-start gap-2",
      className
    )}>
      <span className="location-hover-popup-row-icon flex size-5 shrink-0 items-center justify-center">
        <Icon className="size-4 text-content" />
      </span>
      <p className="location-hover-popup-row-text type-body-2 text-content flex-1 truncate">{text}</p>
    </div>
  );
}

interface IconButtonProps {
  className?: string;
  icon: ReactNode;
  variant?: "pill" | "ghost";
  label?: string;
  onClick?: () => void;
}

function IconButton({ className, icon, variant = "ghost", label, onClick }: IconButtonProps) {
  if (variant === "pill") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "location-hover-popup-button-pill inline-flex h-9 items-center justify-center gap-1 rounded-full border bg-action-secondary border-action-secondary-hover pl-2 pr-3 transition-colors",
          "hover:bg-action-secondary-hover hover:border-edge",
          "active:bg-action-secondary-active active:border-edge-strong",
          "focus-visible:ring-3 focus-visible:ring-edge-strong/50 focus-visible:outline-none",
          className
        )}
        aria-label={label}
      >
        <span className="location-hover-popup-button-icon flex size-5 items-center justify-center shrink-0">
          {icon}
        </span>
        {label && <span className="location-hover-popup-button-label type-body-2 text-glyph">{label}</span>}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "location-hover-popup-button flex size-9 items-center justify-center rounded-lg transition-colors",
        "hover:bg-surface-muted-hover active:bg-surface-muted-active",
        "focus-visible:ring-3 focus-visible:ring-edge-strong/50 focus-visible:outline-none",
        className
      )}
      aria-label={label}
    >
      <span className="location-hover-popup-button-icon flex size-5 items-center justify-center">
        {icon}
      </span>
    </button>
  );
}

interface LocationHoverDetailsPopupProps
  extends VariantProps<typeof popupVariants> {
  className?: string;
  /** Location name displayed as title */
  name: string;
  /** Category label (e.g., "Tourist Attraction") */
  category?: string;
  /** Image URL for the location */
  imageUrl?: string;
  /** Location address */
  address?: string;
  /** Opening hours */
  openingHours?: string;
  /** Callback when link button is clicked */
  onLinkClick?: () => void;
  /** Callback when bookmark button is clicked */
  onBookmarkClick?: () => void;
  /** Callback when attach button is clicked */
  onAttachClick?: () => void;
}

const LocationHoverDetailsPopup = forwardRef<
  HTMLDivElement,
  LocationHoverDetailsPopupProps
>(
  (
    {
      className,
      variant,
      name,
      category = "Tourist Attraction",
      imageUrl,
      address,
      openingHours,
      onLinkClick,
      onBookmarkClick,
      onAttachClick,
    },
    ref
  ) => {
    return (
      <div
        ref={ref}
        className={cn(popupVariants({ variant, className }))}
        role="article"
        aria-label={`Location details for ${name}`}
      >
        {/* Image Section */}
        {imageUrl && (
          <img
            src={imageUrl}
            alt={name}
            className="w-full h-auto rounded-lg border border-edge bg-surface-alt"
            style={{ aspectRatio: '240/160' }}
          />
        )}

        {/* Content Section */}
        <div className="flex flex-col gap-2">
          {/* Title */}
          <div className={cn(variant === "flat" ? "pl-1" : "pl-2")}>
            <h3 className="type-body-1 type-secondary font-semibold text-glyph truncate">
              {name}
            </h3>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center justify-between overflow-hidden">
            <div className="flex items-center gap-1">
              {/* Category Pill */}
              <IconButton
                variant="pill"
                icon={<FerrisWheel className="size-4 text-glyph" />}
                label={category}
              />
              {/* Link Button */}
              <IconButton
                variant="ghost"
                icon={<Link className="size-4 text-glyph" />}
                label="Open link"
                onClick={onLinkClick}
              />
              {/* Bookmark Button */}
              <IconButton
                variant="ghost"
                icon={<Bookmark className="size-4 text-glyph" />}
                label="Bookmark"
                onClick={onBookmarkClick}
              />
            </div>
            {/* Attach Button */}
            <IconButton
              variant="ghost"
              icon={<Paperclip className="size-4 text-glyph" />}
              label="Attach"
              onClick={onAttachClick}
            />
          </div>
        </div>

        {/* Details Section */}
        {(address || openingHours) && (
          <div className="flex flex-col gap-0 rounded-lg border border-edge bg-surface p-1">
            <div className="flex flex-col gap-2 p-2">
              {address && (
                <DetailRow text={address} type="location" />
              )}
              {openingHours && (
                <DetailRow text={openingHours} type="openingHours" />
              )}
            </div>
          </div>
        )}
      </div>
    );
  }
);

LocationHoverDetailsPopup.displayName = "LocationHoverDetailsPopup";

export { LocationHoverDetailsPopup };
export type { DetailRowProps };
