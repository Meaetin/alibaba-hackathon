"use client";

import { Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface EditDropIndicatorProps {
  timeLabel?: string;
  idle?: boolean;
  shift?: "down" | "up";
  className?: string;
}

export function EditDropIndicator({ timeLabel, idle = false, shift, className }: EditDropIndicatorProps) {
  if (idle) {
    return (
      <div className={cn("edit-drop-indicator-line h-2 flex items-center", shift === "down" && "translate-y-1", shift === "up" && "-translate-y-[2px]", className)}>
        <div className="edit-drop-indicator-dot size-5 rounded-full shrink-0 -ml-1 flex items-center justify-center bg-content">
          <Plus className="edit-drop-indicator-plus size-3 text-content-on-dark" />
        </div>
        <div className="edit-drop-indicator-bar h-0.5 flex-1 rounded-full bg-content" />
      </div>
    );
  }

  return (
    <div className={cn("edit-drop-indicator", "flex flex-col", className)}>
      {/* Time Label Pill */}
      {timeLabel && (
        <div className="edit-drop-indicator-label flex items-center mb-1">
          <div className="edit-drop-indicator-pill px-2 py-0.5 rounded-md type-body-2 font-semibold text-content-on-dark whitespace-nowrap bg-action-dark">
            {timeLabel}
          </div>
        </div>
      )}

      {/* Drop Line */}
      <div className="edit-drop-indicator-line flex items-center">
        <div className="edit-drop-indicator-dot size-5 rounded-full shrink-0 -ml-1 flex items-center justify-center bg-action-dark">
          <Plus className="edit-drop-indicator-plus size-3 text-content-on-dark" />
        </div>
        <div className="edit-drop-indicator-bar h-0.5 flex-1 rounded-full bg-action-dark" />
      </div>
    </div>
  );
}
