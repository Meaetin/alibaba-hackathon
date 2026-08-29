"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTheme } from "next-themes";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";
import { parseLocalDate } from "@/lib/utils/itinerary";
import { getDayColor } from "@/components/ui/calendar/ActivityTimeslot";
import { CompactDayColumn } from "./CompactDayColumn";
import type { ItineraryDetail, ItineraryActivityDetail } from "@/lib/db/itinerary-detail";
import type { FlightCardProps } from "@/components/ui/detail-views/FlightCard";

interface ItineraryQuickViewProps {
  itinerary: ItineraryDetail;
  onActivityClick?: (activity: ItineraryActivityDetail, dayIndex: number) => void;
  activityNotePreviews?: Map<string, string>;
  flight?: FlightCardProps | null;
  onFlightOpen?: () => void;
  className?: string;
}

/** Short pill label for a day: "Jun 25", falling back to "Day N" with no date. */
function dayPillLabel(date: string | null | undefined, index: number): string {
  if (!date) return `Day ${index + 1}`;
  return parseLocalDate(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ItineraryQuickView({
  itinerary,
  onActivityClick,
  activityNotePreviews,
  flight,
  onFlightOpen,
  className,
}: ItineraryQuickViewProps) {
  const days = itinerary.days;
  const flightDayIndex = flight?.departDate
    ? Math.max(0, days.findIndex((day) => day.date?.slice(0, 10) === flight.departDate?.slice(0, 10)))
    : 0;
  const { resolvedTheme } = useTheme();
  const prefersReducedMotion = useReducedMotion();
  const isDark = resolvedTheme === "dark";
  // The day board is horizontally swipeable but, on phones, only one column is in
  // view — so a tappable pill row doubles as the affordance (there ARE more days)
  // and the control (jump straight to one). It mirrors the home mobile filter pills.
  const scrollRef = useRef<HTMLDivElement>(null);
  const pillRowRef = useRef<HTMLDivElement>(null);
  const [activeDayIndex, setActiveDayIndex] = useState(0);

  // Swipe → active pill. Find the day column whose left edge sits closest to the
  // scroll container's left edge (the snap point) and mark it active.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const columns = el.firstElementChild as HTMLElement | null;
    if (!columns) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const containerLeft = el.getBoundingClientRect().left;
        const children = Array.from(columns.children) as HTMLElement[];
        let nearest = 0;
        let min = Infinity;
        children.forEach((child, i) => {
          const dist = Math.abs(child.getBoundingClientRect().left - containerLeft);
          if (dist < min) {
            min = dist;
            nearest = i;
          }
        });
        setActiveDayIndex(nearest);
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [days.length]);

  // Keep the active pill in view as the day changes (swipe or tap).
  useEffect(() => {
    const row = pillRowRef.current;
    const pill = row?.children[activeDayIndex] as HTMLElement | undefined;
    pill?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "nearest", inline: "center" });
  }, [activeDayIndex, prefersReducedMotion]);

  // Tap pill → snap that day column to the start of the scroll viewport.
  const scrollToDay = useCallback((index: number) => {
    const el = scrollRef.current;
    const columns = el?.firstElementChild as HTMLElement | undefined;
    const child = columns?.children[index] as HTMLElement | undefined;
    if (!el || !child) return;
    setActiveDayIndex(index);
    const delta = child.getBoundingClientRect().left - el.getBoundingClientRect().left;
    el.scrollBy({ left: delta, behavior: prefersReducedMotion ? "auto" : "smooth" });
  }, [prefersReducedMotion]);

  return (
    <div
      data-slot="itinerary-quick-view"
      data-region="itinerary-detail-day-board"
      className={cn(
        // The .day-board fills one column on phones, two on tablets, then
        // restores the denser desktop board. Extra days remain horizontally
        // scrollable at every breakpoint.
        "itinerary-quick-view-container @container mx-auto flex min-h-0 w-full max-w-[1600px] flex-col px-3 md:px-8 lg:px-10",
        className,
      )}
    >
      {/* Day Pills (mobile) — discoverability + quick jump for the swipeable board */}
      {days.length > 1 && (
        <div
          ref={pillRowRef}
          data-region="itinerary-detail-day-pills"
          className="itinerary-quickview-day-pills -mr-3 mb-3 flex gap-2 overflow-x-auto pb-1 pr-3 scrollbar-none md:hidden"
          aria-label="Select a day"
        >
          {days.map((day, index) => {
            const active = activeDayIndex === index;
            return (
              <button
                key={day.id}
                type="button"
                aria-pressed={active}
                onClick={() => scrollToDay(index)}
                className={cn(
                  "itinerary-quickview-day-pill inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 type-body-2 font-medium transition-colors",
                  active
                    ? "border-edge bg-surface-muted text-glyph"
                    : "border-edge-subtle bg-surface text-content-secondary hover:bg-surface-alt hover:text-glyph",
                )}
              >
                {/* Day color dot — matches this day's map path + pin color */}
                <span
                  aria-hidden="true"
                  className="itinerary-quickview-day-pill-dot size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: getDayColor(index, isDark) }}
                />
                {dayPillLabel(day.date, index)}
              </button>
            );
          })}
        </div>
      )}

      <div
        ref={scrollRef}
        className="itinerary-quickview-day-columns-scroll -mr-3 flex-1 snap-x snap-mandatory touch-pan-x overflow-x-auto pb-4 overscroll-x-contain scrollbar-none md:-mr-8 lg:-mr-10"
      >
        <div className="itinerary-quickview-view-columns day-board [--day-cols:1] pb-10 pr-3 md:[--day-cols:2] md:pr-8 lg:[--day-cols:3] lg:pr-10 xl:[--day-cols:4]">
          {days.map((day, index) => (
            <CompactDayColumn
              key={day.id}
              day={day}
              dayIndex={index}
              timezone="UTC"
              activityNotePreviews={activityNotePreviews}
              flight={index === flightDayIndex ? flight : undefined}
              onFlightOpen={index === flightDayIndex ? onFlightOpen : undefined}
              onActivityClick={
                onActivityClick
                  ? (activity) => onActivityClick(activity, index)
                  : undefined
              }
              className="snap-start"
            />
          ))}
        </div>
      </div>
    </div>
  );
}
