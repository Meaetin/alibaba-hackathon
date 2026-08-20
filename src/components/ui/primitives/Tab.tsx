"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Underline-style tab indicator (Figma "Tab" — node 233:2).
// Variants: Size (md/sm) × Icon (none/leading/only) × State (default/hover/selected/disabled).
// A 3px bottom border is always reserved (transparent by default) so state changes never shift layout.
const tabVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center border-b-[3px] border-transparent type-body-2 whitespace-nowrap transition-colors outline-none [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      size: {
        md: "",
        sm: "",
      },
      icon: {
        none: "",
        leading: "gap-1.5",
        only: "",
      },
    },
    compoundVariants: [
      // md — heights/padding from Figma (None/Leading 43px, Only 39px)
      { size: "md", icon: "none", className: "h-[43px] px-3" },
      { size: "md", icon: "leading", className: "h-[43px] pl-2 pr-3" },
      { size: "md", icon: "only", className: "h-[39px] px-2" },
      // sm — heights/padding from Figma (None/Leading 37px, Only 33px)
      { size: "sm", icon: "none", className: "h-[37px] px-3" },
      { size: "sm", icon: "leading", className: "h-[37px] pl-2 pr-3" },
      { size: "sm", icon: "only", className: "h-[33px] px-1.5" },
    ],
    defaultVariants: { size: "md", icon: "none" },
  },
);

export interface TabProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type">,
    VariantProps<typeof tabVariants> {
  /** Renders the brand underline + emphasised label. */
  selected?: boolean;
  /** Icon node for `icon="leading"` / `icon="only"` (rendered in a 20px slot). */
  leadingIcon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

function Tab({
  className,
  size = "md",
  icon = "none",
  selected = false,
  disabled = false,
  leadingIcon,
  children,
  ...props
}: TabProps) {
  const stateClass = disabled
    ? "text-content-secondary opacity-50 pointer-events-none"
    : selected
      ? "text-content font-medium border-edge-brand"
      : "text-glyph font-normal hover:font-medium hover:border-edge-muted";

  return (
    <button
      type="button"
      data-slot="tab"
      role="tab"
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      disabled={disabled}
      className={cn(tabVariants({ size, icon }), stateClass, className)}
      {...props}
    >
      {(icon === "leading" || icon === "only") && leadingIcon && (
        <span className="flex size-5 items-center justify-center">{leadingIcon}</span>
      )}
      {icon !== "only" && children}
    </button>
  );
}

export { Tab, tabVariants };
