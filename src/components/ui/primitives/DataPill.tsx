"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ReactNode, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const dataPillVariants = cva(
  "inline-flex h-9 items-center justify-center rounded-full border font-medium type-body-2 text-glyph transition-colors disabled:opacity-50 disabled:pointer-events-none aria-disabled:opacity-50 aria-disabled:pointer-events-none",
  {
    variants: {
      variant: {
        default: "bg-action-secondary border-action-secondary-hover hover:bg-action-secondary-hover hover:border-edge active:bg-action-secondary-active active:border-edge-strong",
        brand: "bg-action-brand/10 border-edge-brand/20 text-content-brand hover:bg-action-brand/15 active:bg-action-brand/20",
      },
      leading: {
        none: "gap-0 px-3",
        icon: "gap-1 pl-2 pr-3",
        number: "gap-0.5 px-3",
        both: "gap-1 pl-2 pr-3",
      },
    },
    defaultVariants: {
      variant: "default",
      leading: "none",
    },
  }
);

interface DataPillProps extends VariantProps<typeof dataPillVariants>, HTMLAttributes<HTMLDivElement> {
  /** Data value to display (number, emoji, etc.) */
  data?: ReactNode;
  /** Label text */
  label: string;
  /** Optional icon to display before content */
  icon?: ReactNode;
}

const DataPill = forwardRef<HTMLDivElement, DataPillProps>(
  ({ className, variant, leading, data, label, icon, ...props }, ref) => {
    const showIcon = leading === "icon" || leading === "both";
    const showData = leading === "number" || leading === "both";

    return (
      <div
        ref={ref}
        className={cn(
          "data-pill",
          dataPillVariants({ variant, leading, className })
        )}
        {...props}
      >
        {showIcon && icon && (
          <span className="data-pill-icon flex size-5 items-center justify-center shrink-0 text-content">
            {icon}
          </span>
        )}
        {showData && data && (
          <span className="data-pill-value type-body-2">{data}</span>
        )}
        <span className="data-pill-label type-body-2">{label}</span>
      </div>
    );
  }
);

DataPill.displayName = "DataPill";

export { DataPill };
export type { DataPillProps };
