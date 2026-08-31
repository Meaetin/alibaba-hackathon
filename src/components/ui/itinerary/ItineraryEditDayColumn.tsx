"use client";

import React, { useMemo, useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MapPin, Plus, ArrowDownUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";
import { EditDropIndicator } from "./EditDropIndicator";
import { detectConflicts } from "./overlap-utils";
import { StripeBackground } from "@/components/ui/StripeBackground/StripeBackground";
import { formatDayDate, parseTimeMins } from "./activity-utils";
import { CompactActivityCard, getActivityCardLayout } from "./CompactActivityCard";
import type { DayTimeMarker } from "./DayTimePicker";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { TransportDetailRow } from "./TransportDetailRow";
import { InlineFlightRow } from "./InlineFlightRow";
import { INSET_PX } from "./ItineraryDayColumn/constants";
import type { ItineraryDayDetail, ItineraryActivityDetail } from "@/lib/db/itinerary-detail";
import type { FlightCardProps } from "@/components/ui/detail-views/FlightCard";
import { motionTransitions } from "@/lib/motion/presets";

interface ItineraryEditDayColumnProps {
  day: ItineraryDayDetail;
  dayIndex: number;
  selectedActivityId?: string | null;
  /** Activity ID to scroll to (earliest match from collection click) */
  scrollToActivityId?: string | null;
  isDragActive?: boolean;
  timezone?: string;
  /** Activities whose times are being recalculated server-side — show a loading state. */
  pendingTimeIds?: Set<string>;
  /** True while a drag preview is live — the dragged card is already rendered in
   *  its prospective slot, so the striped "drop here" placeholder is redundant. */
  preserveActivityOrder?: boolean;
  onActivityClick?: (activity: ItineraryActivityDetail) => void;
  onActivityDelete?: (activityId: string) => void;
  onActivityAction?: (activity: ItineraryActivityDetail, action: 'attachment' | 'notes' | 'expense') => void;
  activityNotePreviews?: Map<string, string>;
  onActivityQuickNoteSubmit?: (activity: ItineraryActivityDetail, content: string) => void | Promise<void>;
  onActivityQuickNoteRemove?: (activity: ItineraryActivityDetail) => void | Promise<void>;
  onAddActivity?: (dayId: string, insertAtIndex?: number) => void;
  /** True while this day's manual add-location panel is open — turns the header
   *  "+" into a close "×" (rotated) that calls `onCloseAdd`. */
  isAddActive?: boolean;
  /** Close the open add-location panel (used by the "×" toggle). */
  onCloseAdd?: () => void;
  /** Accepted, not implemented — the component ignores this today. */
  onCollectionOpen?: () => void;
  /** Accepted, not implemented — the component ignores this today. */
  isCollectionActive?: boolean;
  className?: string;
  globalTransportHidden?: boolean;
  /** Accepted, not implemented — the component ignores this today. */
  hiddenTransports?: Set<string>;
  transportModes?: Record<string, string>;
  /** Activity IDs whose outgoing leg returned no route in the chosen mode this
   *  session. Keeps the transport row on screen to say so instead of silently
   *  vanishing it the moment a mode returns nothing. */
  unavailableLegIds?: Set<string>;
  /** Accepted, not implemented — the component ignores this today. */
  onToggleTransportHidden?: (transportId: string) => void;
  /** `activityId` is the row the leg DEPARTS — the row that owns travel_mode. */
  onTransportModeChange?: (activityId: string, mode: string) => void;
  onActivityTimeChange?: (activityId: string, startTime: string, endTime: string | null) => void;
  /** Optimize a single activity's placement (the time-picker wand) — locks all others. */
  onActivityOptimize?: (activityId: string) => void;
  lockedActivityIds?: Set<string>;
  onToggleActivityLock?: (activityId: string) => void;
  /** Re-time the day's activities around conflicts (forward cascade). */
  onResolveOverlaps?: (dayId: string) => void;
  /** True while travel times for a reorder are being priced — disables the button. */
  isResolvingOverlaps?: boolean;
  /** Arrival-flight entry shown before day one's first activity. */
  flight?: FlightCardProps | null;
  /** Opens the itinerary's Flight workspace; the row never opens a form itself. */
  onFlightOpen?: () => void;
}

function isTransportActivity(activity: ItineraryActivityDetail): boolean {
  const cat = activity.category?.toLowerCase() ?? "";
  return cat === "transportation" || cat === "transport" || cat === "travel";
}

/** A stop has coordinates only when its location carries both lat and lng. */
function hasCoords(activity: ItineraryActivityDetail): boolean {
  return activity.location?.latitude != null && activity.location?.longitude != null;
}

/** Google Maps directions URL for a transport leg (opens in a new tab from the
 *  transport row's map-pin button). Returns null when the destination has no
 *  coordinates; origin is added when available. */
function buildDirectionsUrl(
  origin: ItineraryActivityDetail | null | undefined,
  destination: ItineraryActivityDetail | null | undefined,
  mode: string,
): string | null {
  const dest = destination?.location;
  if (dest?.latitude == null || dest?.longitude == null) return null;
  const travelmode = mode === "walk" ? "walking" : "driving";
  const params = new URLSearchParams({ api: "1", travelmode });
  params.set("destination", `${dest.latitude},${dest.longitude}`);
  const orig = origin?.location;
  if (orig?.latitude != null && orig?.longitude != null) {
    params.set("origin", `${orig.latitude},${orig.longitude}`);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function ActivityCardWrapper({ isSelected, scrollOnSelect, children }: { isSelected: boolean; scrollOnSelect?: boolean; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const prevSelected = useRef(false);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    if (isSelected && !prevSelected.current && scrollOnSelect && ref.current) {
      ref.current.scrollIntoView({ behavior: prefersReducedMotion ? "auto" : "smooth", block: "nearest" });
    }
    prevSelected.current = isSelected;
  }, [isSelected, prefersReducedMotion, scrollOnSelect]);

  // `layout` animates the card to its new slot (and shifts the others) on reorder.
  return (
    <motion.div
      ref={ref}
      layout="position"
      transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.reorder}
      className="edit-activity-wrapper flex flex-col"
    >
      {children}
    </motion.div>
  );
}

function DropGap({
  dayId,
  index,
  slot,
  isDragActive,
  dropEnabled,
  showDropZone = true,
  onClickAdd,
  ghostActive,
  position,
}: {
  dayId: string;
  index: number;
  slot?: string;
  isDragActive: boolean;
  dropEnabled: boolean;
  showDropZone?: boolean;
  onClickAdd?: () => void;
  ghostActive?: boolean;
  position?: "above-card" | "below-card";
}) {
  const prefersReducedMotion = useReducedMotion();
  const gapId = slot ? `edit-gap-${dayId}-${slot}` : `edit-gap-${dayId}-${index}`;
  const { setNodeRef, isOver } = useDroppable({
    id: gapId,
    // Keep insertion slots registered before a drag starts. Enabling them only
    // after `onDragStart` makes their first measured rect timing-dependent, so
    // a transport-less gap can be skipped in favour of the adjacent card.
    disabled: false,
    data: { type: "gap" as const, dayId, index },
  });
  const compactDropTarget = dropEnabled && !showDropZone;

  return (
    <div
      className={cn(
        "edit-drop-gap relative group/gap",
        compactDropTarget || !dropEnabled ? "h-0 -mt-2" : "min-h-[16px]",
      )}
    >
      <div
        ref={setNodeRef}
        className={cn(
          "edit-drop-gap-target w-full",
          compactDropTarget
            ? "absolute inset-x-0 -top-3 z-20 h-6"
            : dropEnabled
              ? "relative min-h-[16px]"
              : "h-0",
        )}
      >
        <AnimatePresence initial={false}>
          {isOver && showDropZone && (
            <motion.div
              key="drop-zone"
              className="edit-drop-zone"
              initial={prefersReducedMotion ? false : { height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.fast}
            >
              {/* Drop Indicator */}
              <EditDropIndicator />
              {/* Drop Zone Placeholder */}
              <StripeBackground
                color="zinc-100"
                className="edit-drop-zone-stripe rounded-xl min-h-[72px]"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {!isDragActive && onClickAdd && (
        <div
          className={cn(
            "edit-drop-gap-hover edit-drop-indicator-line absolute inset-x-0 z-10 flex items-center transition-opacity cursor-pointer",
            "h-2",
            position === "above-card" ? "top-2" : "top-1",
            ghostActive ? "opacity-100" : "opacity-0 hover:opacity-100",
          )}
          onClick={onClickAdd}
        >
          <div className="edit-drop-indicator-dot size-5 rounded-full shrink-0 -ml-1 flex items-center justify-center bg-content">
            <Plus className="edit-drop-indicator-plus size-3 text-content-on-dark" />
          </div>
          <div className="edit-drop-indicator-bar h-0.5 flex-1 rounded-full bg-content" />
        </div>
      )}
    </div>
  );
}

function EmptyDayDropTarget({
  dayId,
  isDragActive,
  onClickAdd,
}: {
  dayId: string;
  isDragActive: boolean;
  onClickAdd?: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const { setNodeRef, isOver } = useDroppable({
    id: `edit-empty-day-${dayId}`,
    data: { type: "gap" as const, dayId, index: 0 },
  });

  return (
    <div
      ref={setNodeRef}
      data-region="itinerary-edit-day-empty"
      className="edit-day-empty-placeholder relative w-full"
    >
      {isDragActive ? (
        <motion.div
          className={cn(
            "edit-day-empty-drop-target min-h-[52px] w-full overflow-hidden rounded-xl border transition-colors",
            isOver
              ? "border-content/30 bg-surface-muted"
              : "border-edge-subtle bg-surface",
          )}
          initial={false}
          animate={{ opacity: 1 }}
          transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.fast}
        >
          {isOver ? (
            <>
              <EditDropIndicator />
              <StripeBackground
                color="zinc-100"
                className="edit-day-empty-drop-stripe min-h-[52px]"
              />
            </>
          ) : (
            <div className="flex min-h-[52px] items-center justify-center text-content-tertiary">
              <span className="type-body-2 font-medium">Drop activity here</span>
            </div>
          )}
        </motion.div>
      ) : (
        <button
          type="button"
          className="group w-full cursor-pointer"
          onClick={onClickAdd}
        >
          <div className="edit-day-empty-card flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-edge-subtle bg-surface text-content-secondary transition-colors group-hover:bg-surface-muted group-hover:text-content">
            <Plus className="edit-day-empty-add-icon size-4" />
            <span className="edit-day-empty-add-label type-body-2 font-medium">Add activity</span>
          </div>
        </button>
      )}
    </div>
  );
}

function DraggableActivityCard({
  activity,
  dayId,
  index,
  dayDate,
  expanded,
  timezone,
  timeLoading,
  locked,
  onToggleLock,
  onDelete,
  onAction,
  activityNotePreview,
  onQuickNoteSubmit,
  onQuickNoteRemove,
  onTimeChange,
  onOptimize,
  markers,
  onClick,
}: {
  activity: ItineraryActivityDetail;
  dayId: string;
  index: number;
  dayDate?: string;
  expanded: boolean;
  timezone?: string;
  timeLoading?: boolean;
  locked?: boolean;
  onToggleLock?: () => void;
  onDelete?: () => void;
  onAction?: (action: 'attachment' | 'notes' | 'expense') => void;
  activityNotePreview?: string | null;
  onQuickNoteSubmit?: (content: string) => void | Promise<void>;
  onQuickNoteRemove?: () => void | Promise<void>;
  onTimeChange?: (startTime: string, endTime: string | null) => void;
  onOptimize?: () => void;
  markers?: DayTimeMarker[];
  onClick?: () => void;
}) {
  // Flights and lodging supplied the only permanently-locked cards, and both
  // are gone; a stop is locked now only because the caller says so.
  const isLocked = !!locked;

  // While the inline time picker is open, drag is suspended so reordering can't
  // fire from underneath the open popover.
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const dragDisabled = isLocked || timePickerOpen;
  const prefersReducedMotion = useReducedMotion();

  const { attributes, listeners, setNodeRef, isDragging, transform, transition } = useSortable({
    id: `edit-activity-${activity.id}`,
    data: { type: "activity" as const, activity, dayId, index },
    disabled: dragDisabled,
    transition: prefersReducedMotion
      ? null
      : { duration: 200, easing: "cubic-bezier(0.25, 1, 0.5, 1)" },
  });

  const sortableTransform = transform
    ? {
        ...transform,
        scaleX: transform.scaleX * (isDragging ? 1.012 : 1),
        scaleY: transform.scaleY * (isDragging ? 1.012 : 1),
      }
    : null;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(sortableTransform),
        transition: isDragging || prefersReducedMotion ? undefined : transition,
        zIndex: isDragging ? 20 : undefined,
        opacity: isDragging ? 0 : 1,
        pointerEvents: isDragging ? "none" : undefined,
      }}
      className={cn(
        "edit-draggable-card",
        "relative touch-none rounded-xl transition-[box-shadow] duration-[var(--motion-duration-normal)] ease-[var(--motion-ease-spatial)]",
        dragDisabled ? "cursor-default" : "cursor-grab",
        isDragging && !dragDisabled && "cursor-grabbing shadow-[0_18px_44px_rgba(9,11,12,0.18),0_4px_12px_rgba(9,11,12,0.10)]",
      )}
      {...(dragDisabled ? {} : { ...listeners, ...attributes })}
    >
      <CompactActivityCard
        activity={activity}
        layout={getActivityCardLayout(activity, { editable: true })}
        selected={expanded && !isDragging}
        timezone={timezone}
        dayDate={dayDate}
        timeLoading={timeLoading}
        locked={locked}
        onToggleLock={onToggleLock}
        onDelete={onDelete}
        onAction={onAction}
        activityNotePreview={activityNotePreview}
        onQuickNoteSubmit={onQuickNoteSubmit}
        onQuickNoteRemove={onQuickNoteRemove}
        onTimeChange={onTimeChange}
        onOptimize={onOptimize}
        onTimePickerOpenChange={setTimePickerOpen}
        markers={markers}
        onClick={onClick}
      />
    </div>
  );
}

function GhostActivityCard({ onDismiss }: { onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        const target = e.target as HTMLElement;
        if (target.closest(".edit-drop-gap-hover, .edit-drop-gap, [data-slot='edit-panel'], .menu, [role='menu'], [role='listbox']")) return;
        onDismiss();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onDismiss]);

  return (
    <motion.div
      ref={ref}
      className="ghost-activity-card"
      initial={prefersReducedMotion ? false : { opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.control}
    >
      <div className="ghost-activity-skeleton border border-edge-subtle rounded-xl p-2 w-full bg-surface flex items-start gap-2">
        {/* Timeline */}
        <div className="flex flex-col items-center gap-2 self-stretch shrink-0">
          <div className="grayscale opacity-60"><CategoryBadge category="neutral" icon={MapPin} iconSize={14} /></div>
          <div className="w-px flex-1 bg-edge-subtle" />
        </div>
        {/* Content */}
        <div className="flex flex-col flex-1 min-w-0 gap-2 self-stretch">
          <div className="flex gap-2 items-start w-full">
            <div className="flex flex-col flex-1 min-w-0 gap-1">
              <div className="h-4 w-32 rounded bg-surface-muted animate-pulse" />
              <div className="h-3 w-20 rounded bg-surface-muted animate-pulse" />
            </div>
            <div className="size-[72px] rounded-lg shrink-0 bg-surface-muted animate-pulse" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function ItineraryEditDayColumn({
  day,
  dayIndex,
  selectedActivityId,
  scrollToActivityId,
  isDragActive = false,
  timezone,
  pendingTimeIds,
  preserveActivityOrder = false,
  onActivityClick,
  onActivityDelete,
  onActivityAction,
  activityNotePreviews,
  onActivityQuickNoteSubmit,
  onActivityQuickNoteRemove,
  onAddActivity,
  isAddActive = false,
  onCloseAdd,
  className,
  globalTransportHidden = false,
  transportModes,
  unavailableLegIds,
  onTransportModeChange,
  lockedActivityIds,
  onToggleActivityLock,
  onActivityTimeChange,
  onActivityOptimize,
  onResolveOverlaps,
  isResolvingOverlaps = false,
  flight,
  onFlightOpen,
}: ItineraryEditDayColumnProps) {
  const { setNodeRef: setDropRef } = useDroppable({
    id: `edit-day-${day.id}`,
    data: { type: "day" as const, dayId: day.id },
  });

  const resolvedTimezone = timezone ?? "UTC";

  const [ghostSlot, setGhostSlot] = useState<string | null>(null);

  const dismissGhost = useCallback(() => setGhostSlot(null), []);

  // Dismiss ghost when selection changes or drag starts
  useEffect(() => { if (isDragActive) setGhostSlot(null); }, [isDragActive]);
  useEffect(() => { if (selectedActivityId) setGhostSlot(null); }, [selectedActivityId]);

  const dateLabel = useMemo(() => {
    try {
      return formatDayDate(day.date);
    } catch {
      return `Day ${dayIndex + 1}`;
    }
  }, [day.date, dayIndex]);

  // Ordered by `position` (migration 122, ADR 0007) — read from the data, not
  // from array placement, because these arrays get rebuilt by refetches and
  // realtime row echoes that carry no ordering intent.
  //
  // This used to re-sort by start_time, which discarded the date via
  // `parseTimeMins` — so an activity pushed past midnight sorted to 00:00 and
  // jumped to the top of the day even when the server had it correctly last.
  const sortedActivities = useMemo(
    () =>
      day.activities
        .filter((a) => !isTransportActivity(a))
        .map((activity, index) => ({ activity, index }))
        .sort((a, b) => {
          const ap = a.activity.position ?? Number.MAX_SAFE_INTEGER;
          const bp = b.activity.position ?? Number.MAX_SAFE_INTEGER;
          return ap === bp ? a.index - b.index : ap - bp;
        })
        .map(({ activity }) => activity),
    [day.activities],
  );

  const flightInsertionIndex = useMemo(() => {
    if (!onFlightOpen) return -1;
    if (!flight) return 0;
    if (!flight.departTime) return 0;
    const flightMinutes = parseTimeMins(flight.departTime, resolvedTimezone);
    const index = sortedActivities.findIndex((activity) =>
      activity.start_time
        ? parseTimeMins(activity.start_time, resolvedTimezone) > flightMinutes
        : false
    );
    return index >= 0 ? index : sortedActivities.length;
  }, [flight, onFlightOpen, resolvedTimezone, sortedActivities]);

  // Day's activities as DayTimePicker markers (conflict detection on the inline time pill).
  const dayMarkers = useMemo<DayTimeMarker[]>(
    () =>
      sortedActivities
        .filter((a) => a.start_time)
        .map((a) => ({
          id: a.id,
          startMinutes: parseTimeMins(a.start_time as string, resolvedTimezone),
          endMinutes: a.end_time ? parseTimeMins(a.end_time, resolvedTimezone) : null,
          src: a.photo_url ?? a.location?.photo_urls?.[0] ?? null,
          name: a.name,
        })),
    [sortedActivities, resolvedTimezone],
  );



  // Activity time ranges for overlap detection
  const activityRanges = useMemo(() => {
    return sortedActivities
      .filter((a) => a.start_time)
      .map((a) => {
        const startMin = parseTimeMins(a.start_time!, resolvedTimezone);
        const endMin = a.end_time
          ? parseTimeMins(a.end_time, resolvedTimezone)
          : a.travel_duration_seconds
            ? startMin + Math.round(a.travel_duration_seconds / 60)
            : startMin + 60;
        return { id: a.id, startMin, endMin };
      });
  }, [sortedActivities, resolvedTimezone]);

  // Overlap insets: depth * INSET_PX per conflict level
  const overlapInsets = useMemo(() => {
    const ranges = activityRanges;
    const overlaps = (a: typeof ranges[0], b: typeof ranges[0]) =>
      a.startMin < b.endMin && a.endMin > b.startMin;

    const depths = new Map<string, number>();
    for (let i = 0; i < ranges.length; i++) {
      let depth = 0;
      for (let j = 0; j < i; j++) {
        if (overlaps(ranges[j], ranges[i])) {
          depth = Math.max(depth, (depths.get(ranges[j].id) ?? 0) + 1);
        }
      }
      depths.set(ranges[i].id, depth);
    }

    const result = new Map<string, number>();
    for (const [id, depth] of depths) {
      result.set(id, depth * INSET_PX);
    }
    return result;
  }, [activityRanges]);

  const conflictIds = useMemo(
    () => detectConflicts(day.activities),
    [day.activities, transportModes],
  );

  const handleGapClick = useCallback((slot: string, insertAtIndex: number) => {
    setGhostSlot((prev) => prev === slot ? null : slot);
    onAddActivity?.(day.id, insertAtIndex);
  }, [onAddActivity, day.id]);

  return (
    <div
      ref={setDropRef}
      data-slot="edit-day-column"
      className={cn(
        "edit-day-column",
        "flex flex-col px-3 transition-[width,opacity,transform]",
        className,
      )}
    >
      {/* Day Header — date + per-day actions (deconflict shows only on conflict; both
          disabled). Sticky below the 72px day-selector; the next day's header pushes
          it up so only the current day's header is pinned at the top. */}
      <div
        data-day-header
        data-region="itinerary-edit-day-header"
        className={cn("edit-day-column-header", "sticky top-[72px] z-10 bg-surface flex items-center justify-between py-3")}
      >
        <span className="edit-day-column-date type-h4 type-secondary font-semibold text-content">{dateLabel}</span>
        <div className="edit-day-column-actions flex items-center gap-2">
          {sortedActivities.length === 0 ? (
            /* Empty day — single "+" to add the first activity (replaces the populated
               deconflict/AI-populate actions). While this day's add panel is open the
               "+" rotates 45° into an "×" that closes it. */
            <Button
              variant="ghost"
              size="sm"
              icon="only"
              aria-label={isAddActive ? "Cancel adding activity" : "Add activity"}
              title={isAddActive ? "Cancel" : "Add activity"}
              className="edit-day-column-add-button"
              onClick={() => (isAddActive ? onCloseAdd?.() : onAddActivity?.(day.id, 0))}
            >
              <Plus className={cn("edit-day-column-add-icon size-4 transition-transform", isAddActive && "rotate-45")} />
            </Button>
          ) : (
            <>
              {/* Deconflict — appears only when this day has conflicting activities */}
              {conflictIds.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="only"
                  disabled={isResolvingOverlaps}
                  onClick={() => onResolveOverlaps?.(day.id)}
                  title="Resolve conflicting times"
                  aria-label="Resolve conflicts"
                  className="edit-day-column-deconflict-button"
                >
                  {isResolvingOverlaps ? (
                    <Loader2 className="edit-day-column-deconflict-icon size-4 animate-spin" />
                  ) : (
                    <ArrowDownUp className="edit-day-column-deconflict-icon size-4" />
                  )}
                </Button>
              )}
              {/* Add Activity — a persistent, glanceable "+" so adding the next
                 stop doesn't depend on discovering the hover-only inter-card gap
                 (UXR-017). Appends to the end of the day. While this day's add panel
                 is open the "+" rotates 45° into an "×" that closes it. */}
              <Button
                variant="ghost"
                size="sm"
                icon="only"
                aria-label={isAddActive ? "Cancel adding activity" : "Add activity"}
                title={isAddActive ? "Cancel" : "Add activity"}
                className="edit-day-column-add-button"
                onClick={() => (isAddActive ? onCloseAdd?.() : onAddActivity?.(day.id, sortedActivities.length))}
              >
                <Plus className={cn("edit-day-column-add-icon size-4 transition-transform", isAddActive && "rotate-45")} />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Activity List */}
      <div className={cn("edit-day-activities", "flex flex-col gap-2")}> 
        {sortedActivities.length === 0 ? (
          <>
            {onFlightOpen ? <InlineFlightRow flight={flight} onClick={onFlightOpen} /> : null}
            {/* Keep the full empty card registered as index 0 so both activity and
                external-location drags can reliably target an otherwise empty day. */}
            <EmptyDayDropTarget
              dayId={day.id}
              isDragActive={isDragActive}
              onClickAdd={() => onAddActivity?.(day.id, 0)}
            />
          </>
        ) : (
          <>
            <SortableContext
              id={`edit-sortable-day-${day.id}`}
              items={sortedActivities.map((activity) => `edit-activity-${activity.id}`)}
              strategy={verticalListSortingStrategy}
            >
              {sortedActivities.map((activity, i) => {
              const isActivityMatch = selectedActivityId === activity.id;
              const isScrollTarget = scrollToActivityId === activity.id;
              const isSelected = isActivityMatch || isScrollTarget;
              const showTransportBefore = i > 0;
              const inset = overlapInsets.get(activity.id) ?? 0;
              const isOverlapping = conflictIds.has(activity.id);

              const preTransportSlot = `pre-transport-${i}`;
              const preCardSlot = `pre-card-${i}`;
              // The leg into this card departs the PREVIOUS activity, and
              // `travel_mode` lives on the row the leg departs — so that row is
              // both where the persisted mode is read from and what a mode change
              // must target. Ephemeral `transportModes` wins while a switch is in
              // flight (optimistic), then the server value takes over.
              const legOriginId = sortedActivities[i - 1]?.id;
              const legMode =
                (legOriginId ? transportModes?.[legOriginId] : undefined) ??
                sortedActivities[i - 1]?.travel_mode ??
                "drive";
              // No leg into a stop unless both it and the previous stop have coordinates —
              // a coordless location runs no Directions call and shows no transport row.
              const legHasCoords = showTransportBefore && hasCoords(sortedActivities[i - 1]) && hasCoords(activity);
              // travel_* lives on the previous row (it describes the leg leaving that row).
              // With no computed distance and duration there's nothing to show — hide the row.
              const legHasTravelData =
                sortedActivities[i - 1]?.travel_distance_meters != null ||
                sortedActivities[i - 1]?.travel_duration_seconds != null;
              const legUnavailable = legOriginId ? unavailableLegIds?.has(legOriginId) ?? false : false;
              const isTransportVisible =
                legHasCoords && (legHasTravelData || legUnavailable) && !globalTransportHidden;

              return (
                <React.Fragment key={activity.id}>
                  {i === flightInsertionIndex && onFlightOpen ? (
                    <InlineFlightRow flight={flight} onClick={onFlightOpen} />
                  ) : null}
                  {/* Gap: before transport row (or directly before card if transport hidden) */}
                  <DropGap
                    dayId={day.id}
                    index={i}
                    isDragActive={isDragActive}
                    dropEnabled={isDragActive}
                    showDropZone={!preserveActivityOrder}
                    onClickAdd={() => handleGapClick(preTransportSlot, i)}
                    ghostActive={ghostSlot === preTransportSlot}
                    position={i > 0 ? "below-card" : undefined}
                  />
                  <AnimatePresence>
                    {ghostSlot === preTransportSlot && (
                      <GhostActivityCard onDismiss={dismissGhost} />
                    )}
                  </AnimatePresence>

                  {/* Transport Row + pre-card gap — only when transport is visible */}
                  {isTransportVisible && (
                    (() => {
                      return (
                        <>
                          <TransportDetailRow
                            // Leg INTO this card (from the previous activity) is stored on
                            // the previous row — travel_* describes the leg leaving a row.
                            distanceMeters={sortedActivities[i - 1]?.travel_distance_meters ?? null}
                            durationSeconds={sortedActivities[i - 1]?.travel_duration_seconds ?? null}
                            transportMode={legMode}
                            unavailable={legUnavailable}
                            globalHidden={false}
                            loading={
                              pendingTimeIds?.has(sortedActivities[i - 1].id) ||
                              pendingTimeIds?.has(activity.id)
                            }
                            onModeChange={(mode) =>
                              legOriginId && onTransportModeChange?.(legOriginId, mode)
                            }
                            mapsUrl={buildDirectionsUrl(sortedActivities[i - 1], activity, legMode)}
                          />

                          {/* Gap: between transport row and activity card */}
                          <DropGap
                            dayId={day.id}
                            index={i}
                            slot={preCardSlot}
                            isDragActive={isDragActive}
                            dropEnabled={isDragActive}
                            showDropZone={!preserveActivityOrder}
                            onClickAdd={() => handleGapClick(preCardSlot, i)}
                            ghostActive={ghostSlot === preCardSlot}
                            position="above-card"
                          />
                          <AnimatePresence>
                            {ghostSlot === preCardSlot && (
                              <GhostActivityCard onDismiss={dismissGhost} />
                            )}
                          </AnimatePresence>
                        </>
                      );
                    })()
                  )}

                  {/* Activity Card */}
                  <ActivityCardWrapper isSelected={isSelected} scrollOnSelect={isScrollTarget}>
                    <div
                      className={cn(
                        "edit-activity-card-outer",
                        "relative transition-[background-color,border-color,box-shadow,transform,opacity]",
                        isOverlapping && [
                          "rounded-xl",
                          "after:pointer-events-none after:absolute after:inset-0 after:rounded-xl after:content-['']",
                          "after:shadow-[inset_0_0_0_1px_var(--color-action-warning)]",
                        ],
                      )}
                      style={inset > 0 ? { width: `calc(100% - ${inset}px)`, marginLeft: "auto" } : undefined}
                    >
                      <DraggableActivityCard
                        activity={activity}
                        dayId={day.id}
                        index={i}
                        dayDate={day.date}
                        expanded={isSelected}
                        timezone={resolvedTimezone}
                        timeLoading={pendingTimeIds?.has(activity.id)}
                        locked={lockedActivityIds?.has(activity.id)}
                        onToggleLock={onToggleActivityLock ? () => onToggleActivityLock(activity.id) : undefined}
                        onDelete={onActivityDelete ? () => onActivityDelete(activity.id) : undefined}
                        onAction={onActivityAction ? (action) => onActivityAction(activity, action) : undefined}
                        activityNotePreview={activityNotePreviews?.get(activity.id) ?? null}
                        onQuickNoteSubmit={(content) => onActivityQuickNoteSubmit?.(activity, content)}
                        onQuickNoteRemove={() => onActivityQuickNoteRemove?.(activity)}
                        onTimeChange={onActivityTimeChange ? (start, end) => onActivityTimeChange(activity.id, start, end) : undefined}
                        onOptimize={onActivityOptimize ? () => onActivityOptimize(activity.id) : undefined}
                        markers={dayMarkers}
                        onClick={() => onActivityClick?.(activity)}
                      />
                    </div>
                  </ActivityCardWrapper>
                </React.Fragment>
              );
              })}
            </SortableContext>
            {flightInsertionIndex === sortedActivities.length && onFlightOpen ? (
              <InlineFlightRow flight={flight} onClick={onFlightOpen} />
            ) : null}
            {/* Drop gap after the last card. It used to be hidden when a lodging
                end-bookend took the slot; there is no lodging any more. */}
            {(
              <>
                <DropGap
                  dayId={day.id}
                  index={sortedActivities.length}
                  isDragActive={isDragActive}
                  dropEnabled={isDragActive}
                  showDropZone={!preserveActivityOrder}
                  onClickAdd={() => handleGapClick("trailing", sortedActivities.length)}
                  ghostActive={ghostSlot === "trailing"}
                  position="below-card"
                />
                <AnimatePresence>
                  {ghostSlot === "trailing" && (
                    <GhostActivityCard onDismiss={dismissGhost} />
                  )}
                </AnimatePresence>
              </>
            )}

          </>
        )}
      </div>
    </div>
  );
}

ItineraryEditDayColumn.displayName = "ItineraryEditDayColumn";

export type { ItineraryEditDayColumnProps };
