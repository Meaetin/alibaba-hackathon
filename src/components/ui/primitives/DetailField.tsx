"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * DetailField — atomic label + value pair for read-only data.
 *
 * Figma: Argo-v4 → ❖ Components → ↳ DetailField (node 369:2).
 * 4 variants: LabelFont (Primary/Secondary) × ColorScheme (Default/Inherit).
 * Label and value are both Body 2 (14px); the value is always Switzer Medium,
 * the label switches to Lora SemiBold when labelFont="secondary".
 */

const detailFieldLabelVariants = cva("type-body-2", {
  variants: {
    labelFont: {
      primary: "font-medium",
      secondary: "type-secondary font-semibold",
    },
    colorScheme: {
      default: "text-content-placeholder",
      inherit: "text-inherit",
    },
  },
  defaultVariants: {
    labelFont: "primary",
    colorScheme: "default",
  },
});

const detailFieldValueVariants = cva("type-body-2 font-medium", {
  variants: {
    colorScheme: {
      default: "text-content",
      inherit: "text-inherit",
    },
  },
  defaultVariants: {
    colorScheme: "default",
  },
});

interface DetailFieldProps
  extends Omit<React.ComponentPropsWithoutRef<"div">, "color">,
    VariantProps<typeof detailFieldLabelVariants> {
  /** Field label, rendered above the value. */
  label: string;
  /** Field value. */
  value: React.ReactNode;
}

function DetailField({
  className,
  label,
  value,
  labelFont = "primary",
  colorScheme = "default",
  ...props
}: DetailFieldProps) {
  return (
    <div
      data-slot="detail-field"
      className={cn("flex flex-col items-start gap-1.5", className)}
      {...props}
    >
      <span className={cn(detailFieldLabelVariants({ labelFont, colorScheme }))}>
        {label}
      </span>
      <span className={cn(detailFieldValueVariants({ colorScheme }))}>
        {value}
      </span>
    </div>
  );
}

export { DetailField, detailFieldLabelVariants, detailFieldValueVariants };
export type { DetailFieldProps };
