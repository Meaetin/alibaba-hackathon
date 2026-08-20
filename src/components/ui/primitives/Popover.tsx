"use client";

import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cva, type VariantProps } from "class-variance-authority";
import {
  forwardRef,
  type ReactNode,
  type ComponentProps,
} from "react";
import { cn } from "@/lib/utils";

// ============================================================================
// Popover Content Variants
// ============================================================================

const popoverVariants = cva(
  [
    // Base styles — gap-1.5 (6px) between content children per Figma
    "z-10 flex flex-col gap-1.5 overflow-hidden",
    // Background and border
    "bg-surface border border-edge",
    // Shape — rounded-xl (12px) per Figma
    "rounded-xl p-3",
    // Shadow
    "shadow-default",
    // Animation origin
    "origin-[var(--transform-origin)]",
    // Focus ring for accessibility
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong/50",
  ].join(" ")
);

// ============================================================================
// Popover Arrow
// ============================================================================

/**
 * Directional popover arrow. White `surface` fill with a 1px `edge` border on the
 * two slanted sides; flat edge sits flush against the popover border. Points down
 * by default; rotated per `data-side`.
 */
function PopoverArrowSvg(props: ComponentProps<"svg">) {
  return (
    <svg width="16" height="8" viewBox="0 0 16 8" fill="none" {...props}>
      {/* Border layer (edge) */}
      <path d="M0 0 L8 8 L16 0 Z" className="fill-edge" />
      {/* Surface fill, inset ~1px so the border shows on the slanted sides */}
      <path d="M1.5 0 L8 6.2 L14.5 0 Z" className="fill-surface" />
    </svg>
  );
}

// ============================================================================
// Types
// ============================================================================

interface PopoverProps extends ComponentProps<typeof PopoverPrimitive.Root> {
  children?: ReactNode;
}

interface PopoverTriggerProps
  extends ComponentProps<typeof PopoverPrimitive.Trigger> {
  className?: string;
  children?: ReactNode;
  /** Open popover on hover instead of click */
  openOnHover?: boolean;
  /** Delay before opening on hover (in ms) */
  delay?: number;
}

interface PopoverContentProps
  extends VariantProps<typeof popoverVariants>,
    ComponentProps<typeof PopoverPrimitive.Popup> {
  className?: string;
  children?: ReactNode;
  /** Offset from the trigger/anchor */
  sideOffset?: number;
  /** Alignment of the popover */
  align?: "start" | "center" | "end";
  /** Side to position the popover */
  side?: "top" | "right" | "bottom" | "left";
  /** Render a directional arrow pointing toward the trigger (rotation follows the resolved side) */
  arrow?: "none" | "top" | "bottom" | "left" | "right";
  /** Padding from the viewport edges */
  collisionPadding?: number | { top?: number; right?: number; bottom?: number; left?: number };
  /** Anchor element to position relative to (instead of trigger) */
  anchor?: HTMLElement | null | React.RefObject<HTMLElement | null>;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Popover Root component - wraps trigger and content
 */
function Popover({ children, ...props }: PopoverProps) {
  return <PopoverPrimitive.Root {...props}>{children}</PopoverPrimitive.Root>;
}

/**
 * Popover Trigger - the element that opens the popover
 */
function PopoverTrigger({
  className,
  children,
  openOnHover,
  delay,
  ...props
}: PopoverTriggerProps) {
  return (
    <PopoverPrimitive.Trigger
      className={className}
      openOnHover={openOnHover}
      delay={delay}
      {...props}
    >
      {children}
    </PopoverPrimitive.Trigger>
  );
}

/**
 * Popover Content - the floating container
 */
const PopoverContent = forwardRef<HTMLDivElement, PopoverContentProps>(
  (
    {
      className,
      children,
      sideOffset,
      align = "center",
      side = "bottom",
      arrow = "none",
      collisionPadding = 8,
      anchor,
      ...props
    },
    ref
  ) => {
    const hasArrow = arrow !== "none";
    // Arrow adds visual spacing — use a larger default offset when present.
    const resolvedOffset = sideOffset ?? (hasArrow ? 8 : 4);
    return (
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner
          className="z-10"
          sideOffset={resolvedOffset}
          align={align}
          side={side}
          collisionPadding={collisionPadding}
          anchor={anchor}
        >
          <PopoverPrimitive.Popup
            ref={ref}
            className={cn(
              "popover",
              popoverVariants(),
              className
            )}
            {...props}
          >
            {children}
          </PopoverPrimitive.Popup>
          {/* Directional Arrow — sibling of Popup so the popup's overflow-hidden never clips it */}
          {hasArrow && (
            <PopoverPrimitive.Arrow
              className={cn(
                "data-[side=top]:bottom-[-7px]",
                "data-[side=bottom]:top-[-7px] data-[side=bottom]:rotate-180",
                "data-[side=left]:right-[-11px] data-[side=left]:-rotate-90",
                "data-[side=right]:left-[-11px] data-[side=right]:rotate-90"
              )}
            >
              <PopoverArrowSvg />
            </PopoverPrimitive.Arrow>
          )}
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    );
  }
);
PopoverContent.displayName = "PopoverContent";

// ============================================================================
// Exports
// ============================================================================

export {
  Popover,
  PopoverTrigger,
  PopoverContent,
};

export type {
  PopoverProps,
  PopoverTriggerProps,
  PopoverContentProps,
};
