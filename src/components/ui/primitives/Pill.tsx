"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

const pillVariants = cva(
  [
    "inline-flex h-9 items-center justify-center rounded-full border px-3",
    "type-body-2 whitespace-nowrap select-none cursor-pointer outline-none",
    "transition-colors",
    "focus-visible:ring-2 focus-visible:ring-edge-strong/50",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      type: {
        default:
          "border-edge bg-surface-alt text-content-tertiary hover:bg-action-secondary-hover hover:text-content",
        selected: [
          "border-action-brand-border bg-action-brand text-content-on-brand",
          "shadow-[inset_-1px_2px_0px_0px_var(--color-brand-highlight),inset_1px_2px_0px_0px_var(--color-brand-highlight),inset_-1px_-2px_0px_0px_var(--color-brand-border),inset_1px_-2px_0px_0px_var(--color-brand-border)]",
          "hover:bg-action-brand-hover",
        ].join(" "),
        input:
          "border-edge bg-transparent text-content-tertiary hover:bg-action-secondary-hover hover:text-content",
      },
    },
    defaultVariants: {
      type: "default",
    },
  },
);

interface PillProps extends VariantProps<typeof pillVariants> {
  className?: string;
  children: ReactNode;
  leadingIcon?: ReactNode;
  onClick?: () => void;
  onRemove?: (e: React.MouseEvent) => void;
  disabled?: boolean;
}

const Pill = forwardRef<HTMLButtonElement, PillProps>(
  ({ className, type, children, leadingIcon, onClick, onRemove, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        type="button"
        role="checkbox"
        aria-checked={type === "selected"}
        disabled={disabled}
        onClick={onClick}
        className={cn(
          pillVariants({ type, className }),
          leadingIcon && "gap-1.5",
          onRemove && "pr-1.5",
        )}
        {...props}
      >
        {leadingIcon && (
          <span className="pill-leading-icon inline-flex items-center">
            {leadingIcon}
          </span>
        )}
        {children}
        {onRemove && (
          <span
            role="button"
            aria-label="Remove tag"
            onClick={(e) => { e.stopPropagation(); onRemove(e); }}
            className="ml-1 inline-flex items-center justify-center size-4 rounded-full opacity-70 hover:opacity-100 transition-opacity"
          >
            <X className="size-3" />
          </span>
        )}
      </button>
    );
  },
);

Pill.displayName = "Pill";

export { Pill, pillVariants };
export type { PillProps };
