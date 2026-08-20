"use client";

import { CalendarFold } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDayPalette } from "./ActivityTimeslot";
import {
  Menu,
  MenuTrigger,
  MenuContent,
  MenuItem,
  MenuSeparator,
} from "@/components/ui/primitives/Menu";

interface DaysTabProps {
  totalDays: number;
  expanded: boolean;
  onToggle: () => void;
  focusedDayIndex: number | null;
  onDayClick: (dayIndex: number) => void;
  className?: string;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-input-focus-ring";

export function DaysTab({
  totalDays,
  expanded,
  onToggle,
  focusedDayIndex,
  onDayClick,
  className,
}: DaysTabProps) {
  const days = Array.from({ length: totalDays }, (_, i) => i);
  const focusedPalette = focusedDayIndex != null ? getDayPalette(focusedDayIndex) : null;

  return (
    <Menu open={expanded} onOpenChange={() => onToggle()}>
      {/* Trigger */}
      <MenuTrigger
        aria-label={focusedDayIndex != null ? `Day ${focusedDayIndex + 1} selected` : "Filter by day"}
        className={cn(
          "days-tab-trigger inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full pl-2.5 pr-3",
          "type-body-2 font-medium shadow-default cursor-pointer",
          "transition-colors duration-[var(--motion-duration-normal)] ease-[var(--motion-ease-standard)] motion-reduce:transition-none",
          FOCUS_RING,
          focusedDayIndex != null
            ? "bg-action-secondary-hover border border-edge-strong text-content"
            : "bg-surface border border-edge text-glyph hover:bg-action-secondary-hover hover:border-edge-strong",
          className,
        )}
      >
        <span className="days-tab-trigger-icon flex size-5 items-center justify-center shrink-0">
          {focusedPalette ? (
            <span className="size-3 rounded-full" style={{ backgroundColor: `var(--cal-${focusedPalette}-marker)` }} />
          ) : (
            <CalendarFold className="size-4" />
          )}
        </span>
        <span className="days-tab-trigger-label whitespace-nowrap">
          {focusedDayIndex != null ? `Day ${focusedDayIndex + 1}` : `${totalDays} Days`}
        </span>
      </MenuTrigger>

      {/* Menu Dropdown */}
      <MenuContent align="start" sideOffset={8}>
        {/* All Days */}
        <MenuItem
          icon="none"
          size="lg"
          selected={focusedDayIndex == null}
          onClick={() => {
            if (focusedDayIndex != null) onDayClick(focusedDayIndex);
          }}
        >
          All days
        </MenuItem>

        <MenuSeparator />

        {/* Day Items */}
        {days.map((dayIndex) => {
          const palette = getDayPalette(dayIndex);
          const isSelected = focusedDayIndex === dayIndex;
          return (
            <MenuItem
              key={dayIndex}
              icon="leading"
              size="lg"
              selected={isSelected}
              leadingIcon={
                <span className="size-3 rounded-full" style={{ backgroundColor: `var(--cal-${palette}-marker)` }} />
              }
              onClick={() => onDayClick(dayIndex)}
            >
              Day {dayIndex + 1}
            </MenuItem>
          );
        })}
      </MenuContent>
    </Menu>
  );
}
