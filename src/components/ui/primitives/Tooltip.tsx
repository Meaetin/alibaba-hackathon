"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import {
  forwardRef,
  type ReactNode,
  type ComponentProps,
} from "react";
import { cn } from "@/lib/utils";

// ============================================================================
// Standardized hover timing
// ============================================================================

// Single source of truth for how long a tooltip waits before appearing on hover
// (and how long it lingers after the pointer leaves). Change these to retune
// EVERY tooltip in the app at once. Per-instance overrides via the `delay` /
// `closeDelay` props on <Tooltip> are still possible but should be rare.
const TOOLTIP_DELAY = 150; // ms before showing on hover
const TOOLTIP_CLOSE_DELAY = 0; // ms before hiding after leave

// ============================================================================
// Tooltip Content Variants
// ============================================================================

// Figma `Tooltip` (432:2): white surface, dark text, subtle border, soft shadow,
// directional arrow. Bubble = px-3 / py-2.5 / rounded-lg / type-body-3.
const tooltipVariants = [
  // Base layout — hug the text on a single line (no fixed width / truncation)
  "z-[10000] flex w-fit items-center whitespace-nowrap",
  // Surface + text + border (light bubble — matches Figma surface treatment)
  "bg-surface text-content border border-edge",
  // Shape + spacing
  "rounded-lg px-3 py-2.5 type-body-3 shadow-default",
  // Animation origin
  "origin-[var(--transform-origin)]",
].join(" ");

// ============================================================================
// Arrow
// ============================================================================

/**
 * Directional tooltip arrow. White fill matching the bubble surface with a 1px
 * `edge`-coloured border on the two slanted sides; the flat (top) edge sits flush
 * against the bubble border. Points down by default; rotated per `data-side`.
 */
function TooltipArrowSvg(props: ComponentProps<"svg">) {
  return (
    <svg width="14" height="7" viewBox="0 0 14 7" fill="none" {...props}>
      {/* Border layer (edge) */}
      <path d="M0 0 L7 7 L14 0 Z" className="fill-edge" />
      {/* Surface fill, inset ~1px so the border shows on the slanted sides */}
      <path d="M1.5 0 L7 5.4 L12.5 0 Z" className="fill-surface" />
    </svg>
  );
}

// ============================================================================
// Types
// ============================================================================

interface TooltipProviderProps
  extends ComponentProps<typeof TooltipPrimitive.Provider> {
  children?: ReactNode;
}

interface TooltipProps extends ComponentProps<typeof TooltipPrimitive.Root> {
  children?: ReactNode;
}

interface TooltipTriggerProps
  extends ComponentProps<typeof TooltipPrimitive.Trigger> {
  className?: string;
  children?: ReactNode;
}

interface TooltipContentProps
  extends ComponentProps<typeof TooltipPrimitive.Popup> {
  className?: string;
  children?: ReactNode;
  /** Side to position the tooltip relative to the trigger */
  side?: "top" | "right" | "bottom" | "left";
  /** Alignment along the chosen side */
  align?: "start" | "center" | "end";
  /** Offset from the trigger (in px) */
  sideOffset?: number;
}

// ============================================================================
// Components
// ============================================================================

/**
 * Tooltip Provider — shares hover/delay config across a subtree. Optional;
 * a `Tooltip` works standalone without one.
 */
function TooltipProvider({
  delay = TOOLTIP_DELAY,
  closeDelay = TOOLTIP_CLOSE_DELAY,
  children,
  ...props
}: TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider delay={delay} closeDelay={closeDelay} {...props}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/**
 * Tooltip Root — wraps a trigger and its content. Hover timing is inherited
 * from the nearest `TooltipProvider` (see `TOOLTIP_DELAY`); Base UI's
 * `Tooltip.Root` does not accept a `delay` prop in this version.
 */
function Tooltip({ children, ...props }: TooltipProps) {
  return <TooltipPrimitive.Root {...props}>{children}</TooltipPrimitive.Root>;
}

/**
 * Tooltip Trigger — the hover/focus target. Pass `render` to project the tooltip
 * onto an existing element (e.g. a `<Link>` or `<button>`).
 */
function TooltipTrigger({ className, children, ...props }: TooltipTriggerProps) {
  return (
    <TooltipPrimitive.Trigger className={className} {...props}>
      {children}
    </TooltipPrimitive.Trigger>
  );
}

/**
 * Tooltip Content — the floating bubble (Portal + Positioner + Popup + Arrow).
 */
const TooltipContent = forwardRef<HTMLDivElement, TooltipContentProps>(
  (
    { className, children, side = "top", align = "center", sideOffset = 6, ...props },
    ref
  ) => {
    return (
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          className="z-[10000]"
          side={side}
          align={align}
          sideOffset={sideOffset}
        >
          <TooltipPrimitive.Popup
            ref={ref}
            className={cn(tooltipVariants, className)}
            {...props}
          >
            {children}
            {/* Directional Arrow */}
            <TooltipPrimitive.Arrow
              className={cn(
                "data-[side=top]:bottom-[-6px]",
                "data-[side=bottom]:top-[-6px] data-[side=bottom]:rotate-180",
                "data-[side=left]:right-[-9px] data-[side=left]:-rotate-90",
                "data-[side=right]:left-[-9px] data-[side=right]:rotate-90"
              )}
            >
              <TooltipArrowSvg />
            </TooltipPrimitive.Arrow>
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    );
  }
);
TooltipContent.displayName = "TooltipContent";

// ============================================================================
// Exports
// ============================================================================

export { TooltipProvider, Tooltip, TooltipTrigger, TooltipContent };

export type {
  TooltipProviderProps,
  TooltipProps,
  TooltipTriggerProps,
  TooltipContentProps,
};
