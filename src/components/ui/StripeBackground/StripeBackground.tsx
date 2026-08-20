"use client";

import { useInsertionEffect } from "react";
import { cn } from "@/lib/utils";

const ANGLE = 40;
const STRIPE_WIDTH = 16;
const OPACITY = 0.4;
// tileW = (2 * STRIPE_WIDTH) / sin(ANGLE°) — one exact gradient period per tile
const TILE_W = ((2 * STRIPE_WIDTH) / Math.sin((ANGLE * Math.PI) / 180)).toFixed(4);

const KEYFRAME_ID = "stripe-background-kf";
const KEYFRAME = "@keyframes stripe-ltr{from{background-position-x:0}to{background-position-x:" + TILE_W + "px}}";

const STRIPE_IMAGE =
  "repeating-linear-gradient(" +
  ANGLE + "deg," +
  "rgba(255,255,255,0)," +
  "rgba(255,255,255,0) " + STRIPE_WIDTH + "px," +
  "rgba(255,255,255," + OPACITY + ") " + STRIPE_WIDTH + "px," +
  "rgba(255,255,255," + OPACITY + ") " + STRIPE_WIDTH * 2 + "px)";

const STRIPE_STYLE: React.CSSProperties = {
  backgroundImage: STRIPE_IMAGE,
  backgroundSize: TILE_W + "px 100%",
  animation: "stripe-ltr var(--motion-duration-decorative-fast) var(--motion-ease-linear) infinite",
};

/**
 * Resolves the `color` prop to a valid CSS color value.
 *
 * Accepts:
 *   "#e0f2fe"    → hex, used as-is
 *   "rgb(...)"   → rgb/rgba, used as-is
 *   "--my-token" → design token → var(--my-token)
 *   "sky-100"    → Tailwind v4 color → var(--color-sky-100)
 */
function resolveColor(color: string): string {
  if (color.startsWith("#") || color.startsWith("rgb")) return color;
  if (color.startsWith("--")) return "var(" + color + ")";
  return "var(--color-" + color + ")";
}

interface StripeBackgroundProps {
  /** Background color: hex (#e0f2fe), design token (--brand), or Tailwind color (sky-100) */
  color: string;
  children?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}

export function StripeBackground({ color, children, className, style }: StripeBackgroundProps) {
  useInsertionEffect(() => {
    if (document.getElementById(KEYFRAME_ID)) return;
    const tag = document.createElement("style");
    tag.id = KEYFRAME_ID;
    tag.textContent = KEYFRAME;
    document.head.appendChild(tag);
  }, []);

  const bgColor = resolveColor(color);

  return (
    <div
      className={cn("overflow-hidden", className)}
      style={{ backgroundColor: bgColor, ...style }}
    >
      <div style={STRIPE_STYLE} className="stripe-background-motion size-full">
        {children}
      </div>
    </div>
  );
}
