"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ReactNode } from "react";
import { X, RefreshCw, FileWarning } from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { ProgressBar } from "@/components/ui";
import { Button } from "@/components/ui/primitives/Button";

const linkQueueCardVariants = cva(
  [
    "relative flex flex-col items-start gap-2 p-2 rounded-2xl border border-edge bg-surface overflow-hidden",
    "transition-colors duration-[var(--motion-duration-fast)]",
    "focus-visible:border-edge-strong focus-visible:ring-edge-strong/50 focus-visible:ring-3 outline-none",
  ].join(" "),
  {
    variants: {
      // Figma node 957:46 — all states use `border-edge`; bg + treatment differ.
      state: {
        default: "bg-surface hover:bg-surface-alt",
        hover: "bg-surface-alt",
        processing: "bg-surface-alt",
        queued: "bg-surface hover:bg-surface-alt",
        // Coral inset glow = category-brand-icon (brand-400 #ec7d7f) @ 40%, token-bound.
        failed:
          "bg-surface shadow-[inset_0px_0px_16px_0px_color-mix(in_srgb,var(--category-brand-icon)_40%,transparent)]",
      },
    },
    defaultVariants: {
      state: "default",
    },
  }
);

interface LinkQueueCardProps
  extends VariantProps<typeof linkQueueCardVariants> {
  className?: string;
  url: string;
  progress?: number;
  progressLabel?: string;
  thumbnailUrl?: string;
  thumbnailAlt?: string;
  children?: ReactNode;
  errorMessage?: string;
  onClick?: () => void;
  onRemove?: () => void;
  onRetry?: () => void;
  isRetrying?: boolean;
}

const LinkQueueCard = forwardRef<HTMLDivElement, LinkQueueCardProps>(
  (
    {
      className,
      state = "default",
      url,
      progress = 0,
      progressLabel,
      thumbnailUrl,
      thumbnailAlt,
      children,
      errorMessage,
      onClick,
      onRemove,
      onRetry,
      isRetrying = false,
      ...props
    },
    ref
  ) => {
    const isQueued = state === "queued";
    const isFailed = state === "failed";

    const getProgressLabel = () => {
      if (progressLabel) return progressLabel;
      if (isQueued) return "Waiting...";
      return `${progress}%`;
    };

    return (
      <div
        ref={ref}
        role={onClick ? "button" : undefined}
        tabIndex={onClick ? 0 : undefined}
        className={cn(
          "link-queue-card group",
          linkQueueCardVariants({ state, className })
        )}
        onClick={onClick}
        onKeyDown={(e) => {
          if (onClick && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onClick();
          }
        }}
        {...props}
      >
        {/* Close button — absolute top-right, visible on hover */}
        {onRemove && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            icon="only"
            className={cn(
              "link-queue-card-remove absolute top-[7px] right-[7px] z-10",
              "text-content-secondary transition-opacity duration-[var(--motion-duration-fast)]",
              "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100",
              "hover:opacity-100 hover:text-glyph"
            )}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            aria-label="Remove from queue"
          >
            <X className="size-4" aria-hidden="true" />
          </Button>
        )}

        {/* Media Area — phone-frame thumbnail (mirrors LinkCard) */}
        <div className="link-queue-card-thumbnail flex min-h-0 w-full flex-1 items-center justify-center px-1 pt-3">
          {/* Phone frame tilts 2° while processing / on hover (Figma 1139:82, 1139:62) */}
          <div
            className={cn(
              "link-queue-card-thumbnail-frame flex aspect-[150/220] h-full max-w-full shrink-0 flex-col rounded-xl border border-edge bg-surface p-1 transition-transform duration-[var(--motion-duration-normal)]",
              (state === "processing" || state === "hover") && "rotate-2",
              (state === "default" || state === "queued") && "group-hover:rotate-2"
            )}
          >
            {thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumbnailUrl}
                alt={thumbnailAlt || url}
                className="min-h-0 flex-1 rounded-lg border border-edge-subtle bg-surface-alt object-cover"
                draggable="false"
              />
            ) : children ? (
              <div className="min-h-0 flex-1 rounded-lg border border-edge-subtle bg-surface-alt">
                {children}
              </div>
            ) : (
              <div className="min-h-0 flex-1 rounded-lg border border-edge-subtle bg-surface-alt" />
            )}
          </div>
        </div>

        {/* Footer — CategoryBadge + URL (aligned with LinkCard footer) */}
        <div className="link-queue-card-footer flex items-center gap-1.5 px-2 py-1 w-full shrink-0">
          <CategoryBadge
            category={isFailed ? "brand" : "link"}
            icon={isFailed ? FileWarning : undefined}
          />
          <span
            className={cn(
              "link-queue-card-url type-body-2 font-medium truncate flex-1 min-w-0",
              isFailed ? "text-content" : "text-glyph"
            )}
          >
            {url}
          </span>
        </div>

        {/* Error message — failed state only */}
        {isFailed && (
          <div className="link-queue-card-error-message w-full px-2 pb-1">
            <p className="type-body-4 text-center text-content-secondary">
              {errorMessage ?? "Error fetching content"}
            </p>
          </div>
        )}

        {/* Try Again button — failed state only */}
        {isFailed && onRetry && (
          <Button
            type="button"
            variant="primary"
            size="sm"
            icon="leading"
            className="link-queue-card-retry w-full"
            onClick={(e) => {
              e.stopPropagation();
              if (isRetrying) return;
              onRetry();
            }}
            disabled={isRetrying}
            aria-busy={isRetrying}
          >
            <RefreshCw
              className={cn("size-4", isRetrying && "animate-spin")}
              aria-hidden="true"
            />
            Try Again
          </Button>
        )}

        {/* Progress Bar — hidden in failed state */}
        {!isFailed && (
          <div className="link-queue-card-progress w-full px-2 pb-1">
            <ProgressBar
              value={progress}
              formatLabel={getProgressLabel}
              className="w-full"
            />
          </div>
        )}
      </div>
    );
  }
);

LinkQueueCard.displayName = "LinkQueueCard";

export { LinkQueueCard };
export type { LinkQueueCardProps };
