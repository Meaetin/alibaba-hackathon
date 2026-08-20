"use client";

import { Separator as BaseSeparator } from "@base-ui/react/separator";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

// Outer padded hit-area wrapper (matches Figma Separator frame: 8px on the long
// axis, 4px on the short axis). The wrapper stretches to fill its parent so the
// inner line can span the full extent.
const separatorWrapperVariants = cva("flex shrink-0 items-center", {
  variants: {
    orientation: {
      horizontal: "w-full px-2 py-1",
      vertical: "h-full flex-col px-1 py-2",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
});

// Inner 1px rule. Fills the padded wrapper and draws its stroke with the `edge`
// token via a single-direction border (a full border would double the rule
// thickness against the 1px box).
const separatorLineVariants = cva("border-edge border-solid", {
  variants: {
    orientation: {
      horizontal: "h-px w-full border-t",
      vertical: "w-px h-full border-l",
    },
  },
  defaultVariants: {
    orientation: "horizontal",
  },
});

interface SeparatorProps extends VariantProps<typeof separatorWrapperVariants> {
  className?: string;
}

export function Separator({
  className,
  orientation = "horizontal",
}: SeparatorProps) {
  // Resolve orientation to ensure it's never null
  const resolvedOrientation = orientation ?? "horizontal";

  return (
    <div
      className={cn(
        "separator",
        separatorWrapperVariants({ orientation: resolvedOrientation }),
        className
      )}
    >
      <BaseSeparator
        orientation={resolvedOrientation}
        className={cn(
          "separator-line",
          separatorLineVariants({ orientation: resolvedOrientation })
        )}
      />
    </div>
  );
}

Separator.displayName = "Separator";
