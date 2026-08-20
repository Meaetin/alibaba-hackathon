"use client";

import { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo, forwardRef, useImperativeHandle } from "react";
import { type DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Layers, Plus, Minus, PlaneTakeoff, House } from "lucide-react";
import { Button } from "@/components/ui/primitives/Button";
import { ItineraryEditDayColumn } from "./ItineraryEditDayColumn";
import { EditDaySelector } from "./EditDaySelector";
import { parseTimeMins } from "./activity-utils";
import { CompactActivityCard } from "./CompactActivityCard";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import type { ItineraryDayDetail, ItineraryActivityDetail } from "@/lib/supabase/queries/home";
import type { ItineraryPanelVariant } from "./ItinerarySidePanel";
import { motionPresets, motionTransitions } from "@/lib/motion/presets";

const FLIGHT_CATEGORIES = new Set(["flight", "flights"]);

function isFlightActivity(a: ItineraryActivityDetail): boolean {
  const cat = a.category?.toLowerCase() ?? "";
  return FLIGHT_CATEGORIES.has(cat) || a.id.startsWith("flight-");
}

const ACCOMMODATION_CATEGORIES = new Set([
  "accommodation", "lodging", "hotel",
  "lodging_checkin", "lodging_checkout",
]);

function isLodgingActivity(a: ItineraryActivityDetail): boolean {
  const cat = a.category?.toLowerCase() ?? "";
  return ACCOMMODATION_CATEGORIES.has(cat) || a.id.startsWith("accommodation-") || a.id.startsWith("accom-");
}

interface EditDayListProps {
  days: ItineraryDayDetail[];
  panelVariant?: ItineraryPanelVariant | null;
  selectedActivityId?: string | null;
  selectedLocationId?: string | null;
  isCollectionActive?: boolean;
  isDragActive?: boolean;
  timezone?: string;
  pendingTimeIds?: Set<string>;
  /** Preserve the supplied activity array order during transient drag preview. */
  preserveActivityOrder?: boolean;
  onActivityClick?: (activity: ItineraryActivityDetail) => void;
  onActivityDelete?: (activityId: string) => void;
  onActivityAction?: (activity: ItineraryActivityDetail, action: 'attachment' | 'notes' | 'expense') => void;
  activityNotePreviews?: Map<string, string>;
  onActivityQuickNoteSubmit?: (activity: ItineraryActivityDetail, content: string) => void | Promise<void>;
  onActivityQuickNoteRemove?: (activity: ItineraryActivityDetail) => void | Promise<void>;
  onAddActivity?: (dayId: string, insertAtIndex?: number) => void;
  /** Day whose manual add-location panel is currently open — that day's "+" shows the "×" close state. */
  addLocationDayId?: string | null;
  /** Close the open add-location panel (the "×" toggle). */
  onCloseAdd?: () => void;
  onCollectionOpen?: () => void;  onResolveOverlaps?: (dayId: string) => void;
  isResolvingOverlaps?: boolean;
  onOptimizeRoute?: (dayId: string) => void;
  isOptimizingRoute?: boolean;
  hiddenTransports?: Set<string>;
  transportModes?: Record<string, string>;
  unavailableLegIds?: Set<string>;
  onToggleTransportHidden?: (transportId: string) => void;
  onTransportModeChange?: (transportId: string, mode: string) => void;
  onDayScroll?: (dayIndex: number) => void;
  onAddFlight?: () => void;
  isAddingFlight?: boolean;
  onAddLodging?: () => void;
  isAddingLodging?: boolean;
  lodgingMap?: Record<string, { checkInTime?: string; checkOutTime?: string; name?: string } | null>;
  onActivityTimeChange?: (activityId: string, startTime: string, endTime: string | null) => void;
  /** Optimize a single activity's placement (the time-picker wand) — locks all others. */
  onActivityOptimize?: (activityId: string) => void;
  lockedActivityIds?: Set<string>;
  onToggleActivityLock?: (activityId: string) => void;
  /** Commit a new itinerary date range from the day-selector calendar popover. */
  onDatesChange?: (range: DateRange) => void;
}


export interface EditDayListHandle {
  /** Smooth-scroll the day list so the given day's column lands at the top. */
  scrollToDay: (dayIndex: number) => void;
}

export const EditDayList = forwardRef<EditDayListHandle, EditDayListProps>(function EditDayList({
  days,
  panelVariant,
  selectedActivityId,
  selectedLocationId,
  isCollectionActive,
  isDragActive,
  timezone,
  pendingTimeIds,
  preserveActivityOrder,
  onActivityClick,
  onActivityDelete,
  onActivityAction,
  activityNotePreviews,
  onActivityQuickNoteSubmit,
  onActivityQuickNoteRemove,
  onAddActivity,
  addLocationDayId,
  onCloseAdd,
  onCollectionOpen,  onResolveOverlaps,
  isResolvingOverlaps,
  hiddenTransports,
  transportModes,
  unavailableLegIds,
  onToggleTransportHidden,
  onTransportModeChange,
  onDayScroll,
  onAddFlight,
  isAddingFlight,
  onAddLodging,
  isAddingLodging,
  lodgingMap,
  onActivityTimeChange,
  onActivityOptimize,
  lockedActivityIds,
  onToggleActivityLock,
  onDatesChange,
}: EditDayListProps, ref) {
  const prefersReducedMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<(HTMLDivElement | null)[]>([]);
  const currentDayIndexRef = useRef(0);
  const lastScrollTopRef = useRef(0);

  const [currentDayIndex, setCurrentDayIndex] = useState(0);
  const [globalTransportHidden, setGlobalTransportHidden] = useState(false);
  const [dragDayMinHeights, setDragDayMinHeights] = useState<Record<string, number>>({});

  // Cross-day preview removes the card from its source column immediately. Without
  // preserving that column's original height, every date below it jumps upward
  // under the stationary pointer and the drop can land one day later than the user
  // intended. Capture each day's pre-preview height for the lifetime of the drag;
  // destinations may still grow naturally, while sources can no longer collapse.
  useLayoutEffect(() => {
    if (!isDragActive) {
      setDragDayMinHeights({});
      return;
    }

    setDragDayMinHeights((current) => {
      if (Object.keys(current).length > 0) return current;
      return Object.fromEntries(
        days.map((day, index) => [day.id, dayRefs.current[index]?.getBoundingClientRect().height ?? 0]),
      );
    });
  }, [days, isDragActive]);

  // Day-selector height — the sticky strip's offset for scroll-position tracking
  // and as the scroll-margin for click-to-day navigation.
  const DAY_SELECTOR_OFFSET = 72;

  // Smooth-scroll the day list to a day (day-selector tab click). The day wrapper
  // carries scroll-mt so it lands just below the sticky selector. Select the
  // clicked day immediately so the active pill matches the destination — scroll
  // detection alone lands a frame behind because the header sits right on the line.
  const scrollToDay = useCallback((dayIndex: number) => {
    currentDayIndexRef.current = dayIndex;
    setCurrentDayIndex(dayIndex);
    onDayScroll?.(dayIndex);
    dayRefs.current[dayIndex]?.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "start" });
  }, [onDayScroll, prefersReducedMotion]);

  // Expose scrollToDay so the map's day menu can scroll the column list to a day.
  useImperativeHandle(ref, () => ({ scrollToDay }), [scrollToDay]);

  const handleScroll = useCallback(() => {
    const scrollContainer = containerRef.current?.closest(
      ".itinerary-edit-left-scroll"
    ) as HTMLElement | null;
    if (!scrollContainer) return;

    const scrollTop = scrollContainer.scrollTop;
    lastScrollTopRef.current = scrollTop;

    const containerRect = scrollContainer.getBoundingClientRect();
    const stickyBottom = containerRect.top + DAY_SELECTOR_OFFSET;

    // Active day = the last day whose header top has reached the sticky line.
    // Top-based (not midpoint) so it agrees with click-to-day, which lands a
    // header exactly on the line. Small tolerance absorbs sub-pixel rounding.
    let found = 0;
    for (let i = 0; i < dayRefs.current.length; i++) {
      const el = dayRefs.current[i];
      if (!el) continue;
      const header = el.querySelector("[data-day-header]") as HTMLElement | null;
      const target = header ?? el;
      const top = target.getBoundingClientRect().top;
      // Header pins exactly on the line (sticky), so a tiny tolerance keeps the
      // pill highlight switching in lockstep with the sticky-header swap.
      if (top <= stickyBottom + 2) {
        found = i;
      }
    }

    if (found !== currentDayIndexRef.current) {
      currentDayIndexRef.current = found;
      setCurrentDayIndex(found);
      onDayScroll?.(found);
    }
  }, [onDayScroll]);

  useEffect(() => {
    const scrollContainer = containerRef.current?.closest(
      ".itinerary-edit-left-scroll"
    ) as HTMLElement | null;
    if (!scrollContainer) return;
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [handleScroll]);

  // Scroll to earliest activity only for collection-panel clicks (not direct activity clicks).
  // Direct clicks set selectedActivityId to a real activity ID that exists in the days.
  // Collection clicks set it to the location ID which won't match any activity ID.
  const scrollToActivityId = useMemo(() => {
    if (!selectedLocationId || !selectedActivityId) return null;
    const isDirectClick = days.some(day =>
      day.activities.some(a => a.id === selectedActivityId)
    );
    if (isDirectClick) return null;
    for (const day of days) {
      const sorted = [...(day.activities ?? [])].sort((a, b) => {
        const ta = a.start_time ?? "";
        const tb = b.start_time ?? "";
        return ta.localeCompare(tb);
      });
      for (const activity of sorted) {
        if (activity.location?.id === selectedLocationId) {
          return activity.id;
        }
      }
    }
    return null;
  }, [selectedActivityId, selectedLocationId, days]);

  const flightActivities = useMemo(() => {
    if (panelVariant !== "flight") return [];
    return days.flatMap((day) =>
      day.activities.filter(isFlightActivity).sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""))
    );
  }, [days, panelVariant]);

  const isFlightMode = panelVariant === "flight";

  const lodgingActivities = useMemo(() => {
    if (panelVariant !== "lodging") return [];
    return days.flatMap((day) =>
      day.activities.filter(isLodgingActivity).sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""))
    );
  }, [days, panelVariant]);

  const isLodgingMode = panelVariant === "lodging";

  if (isFlightMode) {
    return (
      <div ref={containerRef} className={cn("edit-day-list-flight", "flex flex-col py-2")}>
        {/* Flight Mode Header */}
        <div className={cn("flight-mode-header", "sticky top-0 z-20 bg-surface px-3 flex items-center justify-between py-3")}>
          <div className="flight-mode-title flex items-center gap-2 px-3">
            <span className="flight-mode-label type-h4 type-secondary font-bold text-content">Flight</span>
            <Button variant="ghost" size="sm" icon="only" className="flight-mode-add-button" onClick={onAddFlight} aria-label={isAddingFlight ? "Cancel adding flight" : "Add flight"}>
              <span className="relative size-4">
                <AnimatePresence initial={false}>
                  <motion.span
                    key={isAddingFlight ? "minus" : "plus"}
                    className="absolute inset-0"
                    {...(prefersReducedMotion ? {} : motionPresets.iconSwap)}
                    transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.iconSwap}
                  >
                    {isAddingFlight ? <Minus className="flight-mode-add-icon size-4" /> : <Plus className="flight-mode-add-icon size-4" />}
                  </motion.span>
                </AnimatePresence>
              </span>
            </Button>
          </div>
          <Button
            variant={isCollectionActive ? "primary" : "secondary"}
            size="sm"
            icon="only"
            onClick={onCollectionOpen}
            aria-label="Open collection"
            className="edit-day-list-collection-button"
          >
            <Layers className="collection-button-icon size-4" />
          </Button>
        </div>

        {/* Flight Activities */}
        <div className={cn("flight-activities-list", "flex flex-col gap-2 px-3")}>
          {flightActivities.map((activity) => (
            <CompactActivityCard
              key={activity.id}
              activity={activity}
              selected={selectedActivityId === activity.id}
              timezone={timezone}
              onClick={() => onActivityClick?.(activity)}
              onDelete={() => onActivityDelete?.(activity.id)}
              onAction={(action) => onActivityAction?.(activity, action)}
              activityNotePreview={activityNotePreviews?.get(activity.id) ?? null}
              onQuickNoteSubmit={(content) => onActivityQuickNoteSubmit?.(activity, content)}
              onQuickNoteRemove={() => onActivityQuickNoteRemove?.(activity)}
            />
          ))}

          {/* Ghost Card — New Flight */}
          <AnimatePresence initial={false}>
            {isAddingFlight && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.control}
                className="edit-day-list-flight-ghost"
              >
                <div className="flight-skeleton-card border border-edge-subtle rounded-xl p-2 w-full bg-surface flex items-start gap-2">
                  {/* Timeline */}
                  <div className="flex flex-col items-center gap-2 self-stretch shrink-0">
                    <div className="grayscale opacity-60"><CategoryBadge category="flight" icon={PlaneTakeoff} iconSize={14} /></div>
                    <div className="w-px flex-1 bg-edge-subtle" />
                  </div>
                  {/* Content */}
                  <div className="flex flex-col flex-1 min-w-0 gap-2 self-stretch">
                    <div className="flex gap-2 items-start w-full">
                      <div className="flex flex-col flex-1 min-w-0 gap-1">
                        <div className="flight-skeleton-title h-4 w-32 rounded bg-surface-muted animate-pulse" />
                        <div className="flight-skeleton-subtitle h-3 w-20 rounded bg-surface-muted animate-pulse" />
                      </div>
                      <div className="size-[72px] rounded-lg shrink-0 bg-surface-muted animate-pulse" />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  if (isLodgingMode) {
    return (
      <div ref={containerRef} className={cn("edit-day-list-lodging", "flex flex-col py-2")}>
        {/* Lodging Mode Header */}
        <div className={cn("lodging-mode-header", "sticky top-0 z-20 bg-surface px-3 flex items-center justify-between py-3")}>
          <div className="lodging-mode-title flex items-center gap-2 px-3">
            <span className="lodging-mode-label type-h4 type-secondary font-bold text-content">Lodging</span>
            <Button variant="ghost" size="sm" icon="only" className="lodging-mode-add-button" onClick={onAddLodging} aria-label={isAddingLodging ? "Cancel adding lodging" : "Add lodging"}>
              <span className="relative size-4">
                <AnimatePresence initial={false}>
                  <motion.span
                    key={isAddingLodging ? "minus" : "plus"}
                    className="absolute inset-0"
                    {...(prefersReducedMotion ? {} : motionPresets.iconSwap)}
                    transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.iconSwap}
                  >
                    {isAddingLodging ? <Minus className="lodging-mode-add-icon size-4" /> : <Plus className="lodging-mode-add-icon size-4" />}
                  </motion.span>
                </AnimatePresence>
              </span>
            </Button>
          </div>
          <Button
            variant={isCollectionActive ? "primary" : "secondary"}
            size="sm"
            icon="only"
            onClick={onCollectionOpen}
            aria-label="Open collection"
            className="edit-day-list-collection-button"
          >
            <Layers className="collection-button-icon size-4" />
          </Button>
        </div>

        {/* Lodging Activities */}
        <div className={cn("lodging-activities-list", "flex flex-col gap-2 px-3")}>
          {lodgingActivities.map((activity) => (
            <CompactActivityCard
              key={activity.id}
              activity={activity}
              layout="full"
              selected={selectedActivityId === activity.id}
              timezone={timezone}
              fallbackImage="https://images.unsplash.com/photo-1566073771259-6a8506099945?w=400"
              onClick={() => onActivityClick?.(activity)}
              onDelete={() => onActivityDelete?.(activity.id)}
              onAction={(action) => onActivityAction?.(activity, action)}
              activityNotePreview={activityNotePreviews?.get(activity.id) ?? null}
              onQuickNoteSubmit={(content) => onActivityQuickNoteSubmit?.(activity, content)}
              onQuickNoteRemove={() => onActivityQuickNoteRemove?.(activity)}
            />
          ))}

          {/* Ghost Card — New Lodging */}
          <AnimatePresence initial={false}>
            {isAddingLodging && (
              <motion.div
                initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.control}
                className="edit-day-list-lodging-ghost"
              >
                <div className="lodging-skeleton-card border border-edge-subtle rounded-xl p-2 w-full bg-surface flex items-center gap-2">
                  {/* Badge */}
                  <div className="grayscale opacity-60"><CategoryBadge category="accommodation" icon={House} iconSize={14} /></div>
                  {/* Text */}
                  <div className="lodging-skeleton-text flex flex-col flex-1 min-w-0 gap-1">
                    <div className="lodging-skeleton-title h-4 w-32 rounded bg-surface-muted animate-pulse" />
                    <div className="lodging-skeleton-subtitle h-3 w-20 rounded bg-surface-muted animate-pulse" />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn("edit-day-list", "flex flex-col py-2")}>
      {/* Day Selector — sticky day mini-tabs + transport / calendar / collection actions */}
      <EditDaySelector
        days={days}
        focusedDayIndex={currentDayIndex}
        onDayClick={scrollToDay}
        transportHidden={globalTransportHidden}
        onToggleTransport={() => setGlobalTransportHidden((v) => !v)}
        isCollectionActive={isCollectionActive}
        onCollectionOpen={onCollectionOpen}
        onDatesChange={onDatesChange}
        className="px-3"
      />

      {/* Day Columns */}
      {days.map((day, i) => (
        <div
          key={day.id}
          data-region="itinerary-edit-day"
          className={cn("edit-day-columns scroll-mt-[72px]", i === days.length - 1 && "min-h-[calc(100vh-120px)]")}
          style={dragDayMinHeights[day.id] ? { minHeight: dragDayMinHeights[day.id] } : undefined}
          ref={(el) => { dayRefs.current[i] = el; }}
        >
          <ItineraryEditDayColumn
            day={day}
            dayIndex={i}
            selectedActivityId={selectedActivityId}
            scrollToActivityId={scrollToActivityId}
            isDragActive={isDragActive}
            timezone={timezone}
            pendingTimeIds={pendingTimeIds}
            preserveActivityOrder={preserveActivityOrder}
            onActivityClick={onActivityClick}
            onActivityDelete={onActivityDelete}
            onActivityAction={onActivityAction}
            activityNotePreviews={activityNotePreviews}
            onActivityQuickNoteSubmit={onActivityQuickNoteSubmit}
            onActivityQuickNoteRemove={onActivityQuickNoteRemove}
            onAddActivity={onAddActivity}
            isAddActive={addLocationDayId === day.id}
            onCloseAdd={onCloseAdd}
            globalTransportHidden={globalTransportHidden}
            onResolveOverlaps={onResolveOverlaps}
            isResolvingOverlaps={isResolvingOverlaps}
            hiddenTransports={hiddenTransports}
            transportModes={transportModes}
            unavailableLegIds={unavailableLegIds}
            onToggleTransportHidden={onToggleTransportHidden}
            onTransportModeChange={onTransportModeChange}
            onCollectionOpen={onCollectionOpen}
            isCollectionActive={isCollectionActive}
            accommodation={lodgingMap?.[day.id] ?? null}
            totalDays={days.length}
            lockedActivityIds={lockedActivityIds}
            onToggleActivityLock={onToggleActivityLock}
            onActivityTimeChange={onActivityTimeChange}
            onActivityOptimize={onActivityOptimize}
            previousDayLastActivity={i > 0 ? (() => {
              const prevActivities = days[i - 1].activities
                .filter((a) => a.start_time)
                .sort((a, b) => parseTimeMins(a.start_time!) - parseTimeMins(b.start_time!));
              return prevActivities[prevActivities.length - 1] ?? null;
            })() : null}
          />
        </div>
      ))}
    </div>
  );
});

EditDayList.displayName = "EditDayList";
