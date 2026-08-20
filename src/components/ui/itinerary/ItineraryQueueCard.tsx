"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef } from "react";
import { X, RefreshCw, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardMedia } from "@/components/ui/cards/CardMedia";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { ProgressBar } from "@/components/ui/primitives/ProgressBar";
import { Button } from "@/components/ui/primitives/Button";

const itineraryQueueCardVariants = cva(
  [
    "relative flex flex-col items-start gap-2 p-2 rounded-2xl border border-edge bg-surface overflow-hidden",
    "transition-colors duration-[var(--motion-duration-fast)]",
    "focus-visible:border-edge-strong focus-visible:ring-edge-strong/50 focus-visible:ring-3 outline-none",
  ].join(" "),
  {
    variants: {
      // Mirrors LinkQueueCard so the two in-flight cards read as one family.
      state: {
        queued: "bg-surface",
        processing: "bg-surface-alt",
        // Coral inset glow = category-brand-icon @ 40%, token-bound.
        failed:
          "bg-surface shadow-[inset_0px_0px_16px_0px_color-mix(in_srgb,var(--category-brand-icon)_40%,transparent)]",
      },
    },
    defaultVariants: {
      state: "queued",
    },
  }
);

interface ItineraryQueueCardProps extends VariantProps<typeof itineraryQueueCardVariants> {
  className?: string;
  /** Trip name from the job payload. */
  title: string;
  progress?: number;
  /** Destination photo, so the card previews like the itinerary card it becomes. */
  imageUrl?: string;
  /**
   * The photo is still being looked up. Holds the media slot on a plain grey
   * frame + spinner rather than showing the gradient, which is the *resolved*
   * "this trip has no photo" state and shouldn't flash on the way to one.
   */
  isImagePending?: boolean;
  gradient?: string;
  errorMessage?: string;
  onRemove?: () => void;
  onRetry?: () => void;
  isRetrying?: boolean;
}

/**
 * In-flight itinerary generation, shaped to sit in the same grid slot as
 * ItineraryCard so the card can hand its place over without the grid reflowing
 * when the job lands.
 */
const ItineraryQueueCard = forwardRef<HTMLDivElement, ItineraryQueueCardProps>(
  (
    {
      className,
      state = "queued",
      title,
      progress = 0,
      imageUrl,
      isImagePending = false,
      gradient,
      errorMessage,
      onRemove,
      onRetry,
      isRetrying = false,
      ...props
    },
    ref
  ) => {
    const isFailed = state === "failed";
    const isQueued = state === "queued";

    // Same single trailing slot as LinkQueueCard: the percentage, or "Waiting..."
    // for a job still behind another run of the user's own (single-flight FIFO)
    // whose bar hasn't started moving yet.
    const progressLabel = isQueued ? "Waiting..." : `${Math.round(progress)}%`;

    return (
      <div
        ref={ref}
        className={cn(
          "itinerary-queue-card group",
          itineraryQueueCardVariants({ state, className })
        )}
        {...props}
      >
        {/* Dismiss button — absolute top-right, visible on hover */}
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon="only"
            className={cn(
              "itinerary-queue-card-remove absolute top-[7px] right-[7px] z-10",
              "text-content-secondary transition-opacity duration-[var(--motion-duration-fast)]",
              "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
              "hover:opacity-100 hover:text-glyph"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label="Dismiss"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}

        {/* Media Area — the finished ItineraryCard's own media slot, holding the
            destination photo the card will keep once the job lands. Falls back
            to the gradient, same as the card it becomes. */}
        <CardMedia
          imageUrl={imageUrl}
          imageAlt=""
          gradient={gradient}
          label={title}
        >
          {isImagePending && !imageUrl ? (
            <div className="itinerary-queue-card-media-pending absolute inset-0 flex items-center justify-center">
              <Loader2
                className="size-6 animate-spin text-glyph-secondary motion-reduce:animate-none"
                aria-hidden="true"
              />
            </div>
          ) : undefined}
        </CardMedia>

        {/* Footer — CategoryBadge + trip name */}
        <div className="itinerary-queue-card-footer flex w-full shrink-0 items-center gap-1.5 px-2 py-1">
          <CategoryBadge category={isFailed ? "brand" : "itinerary"} />
          <span
            className={cn(
              "itinerary-queue-card-title type-body-2 min-w-0 flex-1 truncate font-medium",
              isFailed ? "text-content" : "text-glyph"
            )}
          >
            {title}
          </span>
        </div>

        {/* Error Message — failed state only */}
        {isFailed && (
          <div className="itinerary-queue-card-error-message w-full px-2 pb-1">
            <p className="type-body-4 text-center text-content-secondary">
              {errorMessage ?? "We couldn't finish this itinerary."}
            </p>
          </div>
        )}

        {/* Try Again — failed state only */}
        {isFailed && onRetry && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon="leading"
            className="itinerary-queue-card-retry w-full"
            onClick={(e) => {
              e.stopPropagation();
              if (isRetrying) return;
              onRetry();
            }}
            disabled={isRetrying}
            aria-busy={isRetrying}
          >
            <RefreshCw className={cn("size-4", isRetrying && "animate-spin")} aria-hidden="true" />
            Try Again
          </Button>
        )}

        {/* Progress — percentage over the bar, as on the link queue card */}
        {!isFailed && (
          <div className="itinerary-queue-card-progress w-full px-2 pb-1">
            <ProgressBar
              value={progress}
              formatLabel={() => progressLabel}
              className="w-full"
            />
          </div>
        )}
      </div>
    );
  }
);

ItineraryQueueCard.displayName = "ItineraryQueueCard";

export { ItineraryQueueCard };
export type { ItineraryQueueCardProps };
