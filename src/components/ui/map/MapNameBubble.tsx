"use client";

import { cn } from "@/lib/utils";

interface MapNameBubbleProps {
  name: string;
  className?: string;
}

/**
 * Lightweight label shown above a map pin on hover — just the location name in a
 * rounded bubble with a downward caret. Replaces the heavier hover card on maps
 * that opt into `hoverVariant="name"`.
 */
export function MapNameBubble({ name, className }: MapNameBubbleProps) {
  return (
    <div className={cn("map-name-bubble relative flex flex-col items-center", className)}>
      <div className="map-name-bubble-body max-w-[200px] truncate rounded-full border border-edge bg-surface px-2.5 py-1 type-body-3 font-medium text-content shadow-default">
        {name}
      </div>
      {/* Caret */}
      <div className="map-name-bubble-caret -mt-px size-2 rotate-45 border-b border-r border-edge bg-surface" />
    </div>
  );
}
