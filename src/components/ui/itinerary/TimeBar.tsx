"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Figma: DayTimePicker › "Time Bar" (nodes 1667:14738 time / 1667:14739 current)
// h-9 (36), rounded-xl (12), filled bar with a vertical notch texture + inset bevel.
//   time    → bg-surface-muted, edge border, secondary bevel, neutral notches
//   current → bg-action-brand,  brand border, brand bevel,    brand notches
const timeBarVariants = cva(
  "time-bar relative h-9 min-w-0 overflow-hidden rounded-xl border",
  {
    variants: {
      type: {
        time: "border-edge bg-surface-muted shadow-[inset_0_-2px_0_0_var(--action-secondary-border),inset_0_2px_0_0_var(--action-secondary-highlight)]",
        current:
          "border-action-brand-border bg-action-brand shadow-[inset_0_-2px_0_0_var(--action-brand-border),inset_0_2px_0_0_var(--action-brand-highlight)]",
      },
    },
    defaultVariants: { type: "time" },
  },
);

// Notch texture: 2px-wide ticks ~6.5px apart, base opacity 0.3, faded to 0 at
// both ends via a mask (deadZone 5% / fadeZone 20%). The notch LAYER is 6px tall
// and vertically centred (NOTCH_LENGTH = 6). Colours are token-bound; current
// uses the brand-300 notch colour.
const TICK_COLOR: Record<"time" | "current", string> = {
  time: "var(--edge)",
  current: "var(--color-brand-300)",
};

const TICK_MASK =
  "linear-gradient(90deg, transparent 0, transparent 5%, #000 20%, #000 80%, transparent 95%, transparent 100%)";

function tickStyle(variant: "time" | "current"): React.CSSProperties {
  return {
    backgroundImage: `repeating-linear-gradient(90deg, ${TICK_COLOR[variant]} 0 2px, transparent 2px 6.5px)`,
    opacity: 0.3,
    maskImage: TICK_MASK,
    WebkitMaskImage: TICK_MASK,
  };
}

interface TimeBarProps extends VariantProps<typeof timeBarVariants> {
  className?: string;
  style?: React.CSSProperties;
}

export function TimeBar({ className, type = "time", style }: TimeBarProps) {
  const variant = type ?? "time";
  return (
    <div
      data-slot="time-bar"
      className={cn(timeBarVariants({ type }), className)}
      style={style}
    >
      {/* Notch Texture — 2px × 6px ticks, centred, faded at both ends (matches dial) */}
      <div
        aria-hidden
        className="time-bar-ticks pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2"
        style={tickStyle(variant)}
      />
    </div>
  );
}

TimeBar.displayName = "TimeBar";

export type { TimeBarProps };
