"use client";

import * as React from "react";
import { SquareDashed, type LucideIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * DetailRow — icon + label + value metadata row.
 *
 * Figma: Argo-v4 → ❖ Components → ↳ DetailRow (node 497:2).
 * 2 variants: Layout (Stacked | Inline).
 * - Stacked: 20px icon left, label above value (both Switzer Medium, Body 2).
 * - Inline: icon + label (Lora SemiBold) + value (Switzer Medium, fills + truncates).
 *   `showLabel={false}` renders just icon + value.
 *
 * The leading icon is swappable (Figma square-dashed placeholder by default).
 */

const detailRowVariants = cva("flex gap-1.5", {
  variants: {
    layout: {
      stacked: "items-start py-2",
      inline: "items-center py-3",
    },
  },
  defaultVariants: {
    layout: "stacked",
  },
});

interface DetailRowProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "color">,
    VariantProps<typeof detailRowVariants> {
  /** Leading icon (defaults to the Figma square-dashed placeholder). */
  icon?: LucideIcon;
  /** Row label. */
  label: string;
  /** Row value. */
  value: React.ReactNode;
  /** Hide the label (Inline layout only — renders icon + value). */
  showLabel?: boolean;
}

function DetailRow({
  className,
  icon: Icon = SquareDashed,
  label,
  value,
  layout = "stacked",
  showLabel = true,
  ...props
}: DetailRowProps) {
  return (
    <div
      data-slot="detail-row"
      className={cn(detailRowVariants({ layout }), className)}
      {...props}
    >
      {/* Leading Icon */}
      <div className="flex size-5 shrink-0 items-center justify-center text-glyph">
        <Icon className="size-4" aria-hidden="true" />
      </div>

      {layout === "stacked" ? (
        /* Stacked: label above value */
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="type-body-2 font-medium text-content">{label}</span>
          <span className="type-body-2 font-medium text-content">{value}</span>
        </div>
      ) : (
        /* Inline: label beside value */
        <>
          {showLabel && (
            <span className="type-body-2 type-secondary shrink-0 font-semibold text-content">
              {label}
            </span>
          )}
          <span className="type-body-2 min-w-0 flex-1 truncate font-medium text-content">
            {value}
          </span>
        </>
      )}
    </div>
  );
}

export { DetailRow, detailRowVariants };
export type { DetailRowProps };
