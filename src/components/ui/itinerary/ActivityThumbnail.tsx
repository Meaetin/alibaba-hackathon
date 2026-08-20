"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Figma: DayTimePicker › "Activity Thumbnail" (nodes 1667:14658/14657/14656)
// 32×40 outer, rounded-lg (8), p-0.5 (2), inner image 28×36 rounded-md (6).
//   default  → border-edge-subtle   (mist-100)
//   current  → border-edge-strong   (mist-400 #9ca8ab) — the activity being edited
//   conflict → border-edge-error    (red) — overlaps the selected range
const activityThumbnailVariants = cva(
  // `transition-transform duration-[var(--motion-duration-normal)]` mirrors the LinkCard thumbnail tilt (LinkCard.tsx:34-35)
  // so the conflict tilt animates in/out smoothly as the selected range scrubs over a marker.
  "activity-thumbnail flex items-center overflow-hidden rounded-lg border bg-surface p-0.5 transition-transform duration-[var(--motion-duration-normal)]",
  {
    variants: {
      type: {
        default: "border-edge-subtle",
        current: "border-edge-strong",
        conflict: "border-edge-error rotate-[5deg]",
      },
    },
    defaultVariants: { type: "default" },
  },
);

interface ActivityThumbnailProps
  extends VariantProps<typeof activityThumbnailVariants> {
  className?: string;
  /** Optional image; falls back to an empty muted placeholder (matches Figma). */
  src?: string | null;
  alt?: string;
}

export function ActivityThumbnail({
  className,
  type,
  src,
  alt = "",
}: ActivityThumbnailProps) {
  return (
    <div
      data-slot="activity-thumbnail"
      className={cn(activityThumbnailVariants({ type }), className)}
    >
      <div className="activity-thumbnail-image h-9 w-7 shrink-0 overflow-hidden rounded-md border border-edge-subtle bg-surface-alt">
        {src ? (
          <img
            src={src}
            alt={alt}
            className="activity-thumbnail-photo h-full w-full object-cover"
          />
        ) : null}
      </div>
    </div>
  );
}

ActivityThumbnail.displayName = "ActivityThumbnail";

export type { ActivityThumbnailProps };
