"use client";

import { useState } from "react";
import { ChevronDown, Clock4 } from "lucide-react";

import { cn } from "@/lib/utils";
import { todayWeekdayIndex } from "@/lib/utils/location-detail";

interface OpeningHoursAccordionProps {
  /** Monday-first weekday hour lines (e.g. "Monday: 9 AM – 5 PM"). */
  lines: string[];
  className?: string;
}

/**
 * Collapsible opening-hours panel: shows today's hours as a one-line summary,
 * expands to the full Monday-first week with the current day bolded.
 */
export function OpeningHoursAccordion({ lines, className }: OpeningHoursAccordionProps) {
  const [expanded, setExpanded] = useState(false);

  if (lines.length === 0) return null;

  const todayIndex = todayWeekdayIndex();
  const todayHoursLine = lines[todayIndex] ?? lines[0] ?? null;

  return (
    <div className={cn("opening-hours-accordion flex flex-col", className)}>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="opening-hours-accordion-toggle flex w-full items-center gap-1.5 py-3 text-left outline-none focus-visible:underline"
      >
        <span className="flex size-5 shrink-0 items-center justify-center text-glyph">
          <Clock4 className="size-4" aria-hidden="true" />
        </span>
        <span className="type-body-2 min-w-0 flex-1 truncate font-medium text-content">
          {expanded ? "Opening hours" : (todayHoursLine ?? "Opening hours")}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-glyph transition-transform duration-[var(--motion-control-duration)] ease-[var(--motion-ease-standard)]",
            expanded && "rotate-180",
          )}
          aria-hidden="true"
        />
      </button>
      <div
        className={cn(
          "opening-hours-accordion-content grid transition-[grid-template-rows,opacity] duration-[var(--motion-control-duration)] ease-[var(--motion-ease-standard)]",
          expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
        aria-hidden={!expanded}
      >
        <div className="min-h-0 overflow-hidden">
          <ul className="opening-hours-accordion-list flex flex-col gap-1 pb-3 pl-[26px]">
            {lines.map((line, index) => (
              <li
                key={index}
                className={cn(
                  "type-body-3",
                  index === todayIndex
                    ? "font-semibold text-content"
                    : "text-content-secondary",
                )}
              >
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
