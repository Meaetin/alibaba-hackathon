"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { ChevronDown, Clock9, SlidersHorizontal, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";
import { Switch } from "@/components/ui/primitives/Switch";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/primitives/Menu";
import { ActivityThumbnail } from "./ActivityThumbnail";
import { TimeBar } from "./TimeBar";

// ============================================================================
// DayTimePicker — 24h activity-time picker (ruler-tape design, UXR-001).
//
// A fine tick-tape ruler with the selection rendered as ONE red capsule you
// grab to move (drag the edges to resize). Answers the UXR-001 comprehension
// feedback: the selection reads as a single object — never two grey handles
// (#1); the range + duration are always on screen (#2); overlapping siblings
// tint red and the duration reddens (#3); the current thumbnail rides the
// window start, locked to the axis (#4).
//
// 24h minutes (0–1440). Fluid width (fills its container); mounted in a Popover
// off the activity card's time pill.
// ============================================================================

const DAY_MIN = 1440;
const TICK_STEP = 20; // minutes between ruler ticks → 73 ticks across the day
const TICKS = Array.from({ length: DAY_MIN / TICK_STEP + 1 }, (_, i) => i * TICK_STEP);

const SNAP_PX = 10; // magnetic-snap pixel radius around a sibling boundary (break past it to overlap)
const RESET_TRANSITION_MS = 250;

// Visible-window presets — picked from the top-right dropdown. "24 hr" is the
// full day; "18 hr" trims the dead small hours, starting the axis at 6 AM and
// running to 12 AM (midnight).
type WindowKey = "18h" | "24h";
const WINDOWS: { key: WindowKey; label: string; start: number; end: number }[] = [
  { key: "18h", label: "18 hr", start: 360, end: DAY_MIN }, // 6 AM – 12 AM
  { key: "24h", label: "24 hr", start: 0, end: DAY_MIN }, // 12 AM – 12 AM
];

// Deconflict inputs come from the activity's data (suggested stay duration +
// travel estimate) via props. These are the fallbacks used only when that data
// is missing — matching the itinerary defaults used elsewhere (1 hr stay,
// 30 min travel; see `?? 60` / `?? 1800s` in the itinerary page).
const DEFAULT_STAY_MIN = 60;
const DEFAULT_TRAVEL_MIN = 30;

export interface DayTimeMarker {
  id: string;
  /** 24h minutes 0–1440 */
  startMinutes: number;
  /** 24h minutes 0–1440; null for a single-time (point) activity */
  endMinutes: number | null;
  src?: string | null;
  name?: string;
}

interface DayTimePickerProps {
  /** Selected start, 24h minutes (0–1440). */
  startMinutes: number;
  /** Selected end, 24h minutes (0–1440). Ignored in single-time mode. */
  endMinutes: number;
  /** Single-time ("Start Time Only") mode — one handle, no duration bar. */
  singleTime?: boolean;
  /** Fires live as the draft changes (drag/keys). In single-time mode `end === start`. */
  onChange: (startMinutes: number, endMinutes: number) => void;
  /** Toggle single-time mode (the "Start Time Only" switch). */
  onSingleTimeChange?: (singleTime: boolean) => void;
  /** Reset to the host's open-time snapshot. */
  onReset?: () => void;
  /** Commit the current draft to the host. When provided, a Save button is shown. */
  onSave?: () => void;
  /** Optimize this activity's placement (the wand). When provided, the wand runs
   *  the host's day-level route optimizer (others locked) instead of the local
   *  single-activity deconflict fallback. */
  onOptimize?: () => void;
  /** Disables the Save button — typically until the draft differs from the open-time snapshot. */
  saveDisabled?: boolean;
  /** Other activities on the day → thumbnails + live conflict detection. */
  markers?: DayTimeMarker[];
  /** The activity being edited — rendered as a `current` thumbnail that tracks the start handle. */
  currentActivity?: { src?: string | null; name?: string };
  /** Suggested stay duration (minutes) for the deconflict action — from the
   *  location's `stay_duration`. Falls back to a 1-hour default when absent. */
  suggestedDuration?: number;
  /** Travel buffer (minutes) deconflict leaves clear before/after neighbours —
   *  from the activity's routing estimate. Falls back to 30 minutes when absent. */
  travelBuffer?: number;
  /** Snap increment in minutes. Default 10. */
  snap?: number;
  /** Minimum gap between start and end (minutes). Defaults to `snap`. */
  minGap?: number;
  className?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Deconflict — reset the activity to its suggested duration ("how long people
 * usually spend here") and drop it into the nearest free slot that also leaves
 * `travelBuffer` of travel time before/after the neighbouring (locked) activities.
 * Returns the new [start, end]; if nothing fits, it falls back to the clamped
 * current start with the suggested duration.
 */
function deconflictTimes(
  currentStart: number,
  duration: number,
  markers: DayTimeMarker[],
  travelBuffer: number,
): [number, number] {
  // Locked occupied intervals (ranges only; a point marker occupies nothing).
  const occupied = markers
    .map((m): [number, number] => [m.startMinutes, m.endMinutes ?? m.startMinutes])
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0] - b[0]);

  // Merge overlaps so we can read off the free gaps between them.
  const merged: [number, number][] = [];
  for (const [s, e] of occupied) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }

  // Free gaps, tracking whether each edge abuts a locked activity (→ needs travel).
  const gaps: { start: number; end: number; leftOcc: boolean; rightOcc: boolean }[] = [];
  let cursor = 0;
  for (const [s, e] of merged) {
    if (s > cursor) gaps.push({ start: cursor, end: s, leftOcc: cursor > 0, rightOcc: true });
    cursor = Math.max(cursor, e);
  }
  gaps.push({ start: cursor, end: DAY_MIN, leftOcc: cursor > 0, rightOcc: false });

  // Nearest slot that fits the duration plus travel clearance on occupied edges.
  let best: number | null = null;
  let bestDist = Infinity;
  for (const g of gaps) {
    const lo = g.start + (g.leftOcc ? travelBuffer : 0);
    const hi = g.end - duration - (g.rightOcc ? travelBuffer : 0);
    if (hi < lo) continue;
    const cand = clamp(currentStart, lo, hi);
    const dist = Math.abs(cand - currentStart);
    if (dist < bestDist) {
      bestDist = dist;
      best = cand;
    }
  }

  if (best === null) {
    const cs = clamp(currentStart, 0, DAY_MIN - duration);
    return [cs, cs + duration];
  }
  return [best, best + duration];
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

function snapTo(raw: number, interval: number) {
  return clamp(Math.round(raw / interval) * interval, 0, DAY_MIN);
}

/** 24h minutes → "7:00 AM" */
function formatClock12(min: number) {
  const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  const h24 = Math.floor(m / 60);
  const mm = (m % 60).toString().padStart(2, "0");
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12}:${mm} ${period}`;
}

/** 24h minutes → "7 AM" (axis anchor label) */
function formatAnchor(min: number) {
  const h24 = Math.floor((min % DAY_MIN) / 60);
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 || 12;
  return `${h12} ${period}`;
}

/** Selected duration → "9h 30m" / "45m" / "2h" */
function formatDuration(mins: number) {
  const d = Math.max(0, Math.round(mins));
  const h = Math.floor(d / 60);
  const m = d % 60;
  if (d === 0) return "0m";
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Range [aStart,aEnd) overlaps marker [bStart,bEnd] (point if bEnd===bStart). */
function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  if (bEnd <= bStart) return bStart >= aStart && bStart < aEnd;
  return aStart < bEnd && bStart < aEnd;
}

/**
 * Magnetic snap — given a set of conflict-free boundary `targets` (sibling
 * starts/ends), return the one nearest to `raw` if it lies within `radius`
 * minutes, else `null`. Drag further than `radius` past a boundary and it
 * releases (returns null), letting the handle follow the pointer and overlap.
 */
function nearestSnapTarget(
  raw: number,
  targets: number[],
  radius: number,
): number | null {
  if (radius <= 0) return null;
  let best: number | null = null;
  let bestDist = radius;
  for (const t of targets) {
    const dist = Math.abs(raw - t);
    if (dist <= bestDist) {
      bestDist = dist;
      best = t;
    }
  }
  return best;
}

type DragMode = "start" | "end" | "move";

// ── Component ─────────────────────────────────────────────────────────────────

export function DayTimePicker({
  startMinutes,
  endMinutes,
  singleTime = false,
  onChange,
  onSingleTimeChange,
  onReset,
  onSave,
  onOptimize,
  saveDisabled,
  markers = [],
  currentActivity,
  suggestedDuration,
  travelBuffer,
  snap = 10,
  minGap,
  className,
}: DayTimePickerProps) {
  const gap = minGap ?? snap;
  // Deconflict inputs: real activity data when present, else itinerary defaults.
  const stayMinutes = suggestedDuration ?? DEFAULT_STAY_MIN;
  const travelMinutes = travelBuffer ?? DEFAULT_TRAVEL_MIN;
  const railRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragMode | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const captureElementRef = useRef<Element | null>(null);
  const pointerMoveListenerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const finishDragListenerRef = useRef<((e: PointerEvent) => void) | null>(null);
  const moveAnchor = useRef<{ grabMin: number; start: number; end: number } | null>(null);
  const resetAnimationFrameRef = useRef<number | null>(null);
  const resetAnimationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const propsRef = useRef({ startMinutes, endMinutes, onChange, snap, gap });
  propsRef.current = { startMinutes, endMinutes, onChange, snap, gap };

  const [rawStart, setRawStart] = useState<number | null>(null);
  const [rawEnd, setRawEnd] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [isResetAnimating, setIsResetAnimating] = useState(false);

  const cancelResetAnimation = useCallback(() => {
    if (resetAnimationFrameRef.current !== null) {
      cancelAnimationFrame(resetAnimationFrameRef.current);
      resetAnimationFrameRef.current = null;
    }
    if (resetAnimationTimerRef.current !== null) {
      clearTimeout(resetAnimationTimerRef.current);
      resetAnimationTimerRef.current = null;
    }
    setIsResetAnimating(false);
  }, []);

  // Visible window — which slice of the day [0,1440] the strip below shows,
  // chosen from the top-right dropdown (default: full 24 hr).
  const [windowKey, setWindowKey] = useState<WindowKey>("24h");
  const activeWindow = WINDOWS.find((w) => w.key === windowKey) ?? WINDOWS[1];
  const viewStart = activeWindow.start;
  const viewEnd = activeWindow.end;
  const span = Math.max(1, viewEnd - viewStart);

  // Live view window bounds, kept in a ref so the pointer handlers cap the
  // selection to the visible range — the red bar can't be dragged or resized
  // outside [viewStart, viewEnd] (e.g. before 6 AM in the 18 hr window).
  const viewWindowRef = useRef({ start: 0, end: DAY_MIN });
  viewWindowRef.current = { start: viewStart, end: viewEnd };

  // View-aware horizontal position: maps a real minute into the visible window.
  // The strip (ticks, red bar, handles, siblings, duration, thumbnails) all use
  // this so they reflect the selected window range together.
  const pct = useCallback(
    (min: number) => ((clamp(min, viewStart, viewEnd) - viewStart) / span) * 100,
    [viewStart, viewEnd, span],
  );

  const visualStart = rawStart ?? startMinutes;
  const visualEnd = singleTime ? visualStart : (rawEnd ?? endMinutes);

  const minutesFromClientX = useCallback((clientX: number) => {
    const rect = railRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return viewStart + ((clientX - rect.left) / rect.width) * span;
  }, [viewStart, span]);

  const handlePointerMove = useCallback(
    (e: PointerEvent) => {
      if (e.pointerId !== activePointerIdRef.current) return;
      const which = dragRef.current;
      if (!which) return;
      const { startMinutes: s, endMinutes: en, onChange: cb, snap: sn, gap: g } = propsRef.current;
      // Cap the selection to the visible (set) window — never let it run past
      // the view's start/end (e.g. before 6 AM in the 18 hr window).
      const { start: vStart, end: vEnd } = viewWindowRef.current;
      const raw = minutesFromClientX(e.clientX);
      const snapped = snapTo(raw, sn);

      // Pixel-based snap radius → minutes, so it feels consistent across window ranges.
      const rect = railRef.current?.getBoundingClientRect();
      const snapRadiusMin = rect && rect.width ? (SNAP_PX / rect.width) * span : 0;

      // Conflict-free boundaries: an "end" handle wants to land on a sibling's
      // start (sit flush before it); a "start" handle wants a sibling's end.
      const siblingStarts = markers.map((m) => m.startMinutes);
      const siblingEnds = markers.map((m) => m.endMinutes ?? m.startMinutes);

      if (which === "move") {
        const a = moveAnchor.current;
        if (!a) return;
        const dur = a.end - a.start;
        const rawStartNext = clamp(a.start + (raw - a.grabMin), vStart, vEnd - dur);

        // Snap the leading edge (window start → sibling end) and/or the trailing
        // edge (window end → sibling start); apply whichever boundary is nearest
        // within the resistance band, shifting the whole window to meet it.
        const leadTarget = nearestSnapTarget(rawStartNext, siblingEnds, snapRadiusMin);
        const trailTarget = nearestSnapTarget(rawStartNext + dur, siblingStarts, snapRadiusMin);
        const leadDist = leadTarget === null ? Infinity : Math.abs(rawStartNext - leadTarget);
        const trailDist = trailTarget === null ? Infinity : Math.abs(rawStartNext + dur - trailTarget);

        let snappedStart: number;
        if (leadTarget !== null && leadDist <= trailDist) {
          snappedStart = clamp(leadTarget, vStart, vEnd - dur);
          setRawStart(snappedStart);
          setRawEnd(snappedStart + dur);
        } else if (trailTarget !== null) {
          snappedStart = clamp(trailTarget - dur, vStart, vEnd - dur);
          setRawStart(snappedStart);
          setRawEnd(snappedStart + dur);
        } else {
          snappedStart = clamp(snapTo(rawStartNext, sn), vStart, vEnd - dur);
          setRawStart(rawStartNext);
          setRawEnd(rawStartNext + dur);
        }
        cb(snappedStart, snappedStart + dur);
        return;
      }
      if (which === "start") {
        const hi = singleTime ? vEnd : en - g;
        // Snap the start handle to a sibling end so the window sits flush after it.
        const target = singleTime ? null : nearestSnapTarget(raw, siblingEnds, snapRadiusMin);
        if (target !== null) {
          const snappedTarget = clamp(target, vStart, hi);
          setRawStart(snappedTarget);
          cb(snappedTarget, en);
        } else {
          setRawStart(clamp(raw, vStart, hi));
          cb(clamp(snapped, vStart, hi), singleTime ? clamp(snapped, vStart, hi) : en);
        }
      } else {
        // Snap the end handle to a sibling start so the window ends flush before it.
        const target = nearestSnapTarget(raw, siblingStarts, snapRadiusMin);
        if (target !== null) {
          const snappedTarget = clamp(target, s + g, vEnd);
          setRawEnd(snappedTarget);
          cb(s, snappedTarget);
        } else {
          setRawEnd(clamp(raw, s + g, vEnd));
          cb(s, clamp(snapped, s + g, vEnd));
        }
      }
    },
    [minutesFromClientX, singleTime, markers, span],
  );

  const cleanupDragResources = useCallback(() => {
    const pointerId = activePointerIdRef.current;
    const captureElement = captureElementRef.current;
    const pointerMoveListener = pointerMoveListenerRef.current;
    const finishDragListener = finishDragListenerRef.current;
    const hadActiveDrag =
      pointerId !== null ||
      pointerMoveListener !== null ||
      finishDragListener !== null;

    activePointerIdRef.current = null;
    captureElementRef.current = null;
    pointerMoveListenerRef.current = null;
    finishDragListenerRef.current = null;
    dragRef.current = null;
    moveAnchor.current = null;

    if (
      pointerId !== null &&
      captureElement?.hasPointerCapture(pointerId)
    ) {
      captureElement.releasePointerCapture(pointerId);
    }

    if (hadActiveDrag) {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    if (pointerMoveListener) {
      document.removeEventListener("pointermove", pointerMoveListener);
    }
    if (finishDragListener) {
      document.removeEventListener("pointerup", finishDragListener);
      document.removeEventListener("pointercancel", finishDragListener);
    }
  }, []);

  const finishDrag = useCallback((e: PointerEvent) => {
    if (e.pointerId !== activePointerIdRef.current) return;

    setRawStart(null);
    setRawEnd(null);
    setDragging(false);
    cleanupDragResources();
  }, [cleanupDragResources]);

  const beginDrag = useCallback(
    (mode: DragMode, e: ReactPointerEvent) => {
      if (activePointerIdRef.current !== null) return;
      cancelResetAnimation();
      e.preventDefault();
      activePointerIdRef.current = e.pointerId;
      captureElementRef.current = e.currentTarget;
      e.currentTarget.setPointerCapture(e.pointerId);
      if (mode === "move") {
        moveAnchor.current = {
          grabMin: minutesFromClientX(e.clientX),
          start: startMinutes,
          end: endMinutes,
        };
      }
      setDragging(true);
      dragRef.current = mode;
      document.body.style.cursor = mode === "move" ? "grabbing" : "ew-resize";
      document.body.style.userSelect = "none";
      pointerMoveListenerRef.current = handlePointerMove;
      finishDragListenerRef.current = finishDrag;
      document.addEventListener("pointermove", handlePointerMove);
      document.addEventListener("pointerup", finishDrag);
      document.addEventListener("pointercancel", finishDrag);
    },
    [cancelResetAnimation, minutesFromClientX, startMinutes, endMinutes, handlePointerMove, finishDrag],
  );

  useEffect(() => cleanupDragResources, [cleanupDragResources]);

  useEffect(() => {
    return () => {
      if (resetAnimationFrameRef.current !== null) {
        cancelAnimationFrame(resetAnimationFrameRef.current);
      }
      if (resetAnimationTimerRef.current !== null) {
        clearTimeout(resetAnimationTimerRef.current);
      }
    };
  }, []);

  const handleReset = () => {
    if (!onReset) return;

    if (resetAnimationFrameRef.current !== null) {
      cancelAnimationFrame(resetAnimationFrameRef.current);
    }
    if (resetAnimationTimerRef.current !== null) {
      clearTimeout(resetAnimationTimerRef.current);
    }

    setIsResetAnimating(true);
    resetAnimationFrameRef.current = requestAnimationFrame(() => {
      resetAnimationFrameRef.current = null;
      onReset();
      resetAnimationTimerRef.current = setTimeout(() => {
        resetAnimationTimerRef.current = null;
        setIsResetAnimating(false);
      }, RESET_TRANSITION_MS);
    });
  };

  const handleDeconflict = () => {
    cancelResetAnimation();
    // Reset to the suggested stay duration, then drop it into the nearest free
    // slot that also leaves travel time before/after the neighbouring activities.
    const [s, e] = deconflictTimes(startMinutes, stayMinutes, markers, travelMinutes);
    onSingleTimeChange?.(false);
    onChange(s, e);
  };

  const handleAllDay = () => {
    cancelResetAnimation();
    onSingleTimeChange?.(false);
    onChange(0, DAY_MIN);
    // Widen the visible window to the full day so the all-day bar isn't clipped.
    setWindowKey("24h");
  };

  // All-day switch toggle — on: span the whole day; off: drop a suggested-duration
  // block into the first free slot so the activity has a sane bounded window again.
  const handleAllDayToggle = (v: boolean) => {
    if (v) {
      handleAllDay();
    } else {
      cancelResetAnimation();
      const [s, e] = deconflictTimes(0, stayMinutes, markers, travelMinutes);
      onSingleTimeChange?.(false);
      onChange(s, e);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const startPct = pct(visualStart);
  const endPct = pct(visualEnd);
  const midPct = singleTime ? startPct : (startPct + endPct) / 2;
  const displayStart = snapTo(visualStart, snap);
  const displayEnd = singleTime ? displayStart : snapTo(visualEnd, snap);
  const displayDuration = singleTime ? 0 : displayEnd - displayStart;
  // Whether the activity currently spans the whole day (drives the All-day switch).
  const isAllDay = !singleTime && displayStart === 0 && displayEnd === DAY_MIN;

  const conflicts = singleTime
    ? []
    : markers.filter((m) =>
        overlaps(visualStart, visualEnd, m.startMinutes, m.endMinutes ?? m.startMinutes),
      );
  const center = singleTime ? visualStart : (visualStart + visualEnd) / 2;
  // Axis anchors recomputed from the CURRENT view window — 5 evenly-spaced marks
  // from viewStart to viewEnd so the labels reflect the window range.
  const periodAnchors = Array.from(
    { length: 5 },
    (_, i) => viewStart + (span * i) / 4,
  );
  const nearestAnchor = periodAnchors.reduce((best, a) =>
    Math.abs(a - center) < Math.abs(best - center) ? a : best,
  );

  // Ruler ticks within the visible window only.
  const visibleTicks = TICKS.filter((min) => min >= viewStart && min <= viewEnd);

  const windowStyle: CSSProperties = {
    left: `${startPct}%`,
    width: `${Math.max(0, endPct - startPct)}%`,
  };

  return (
    <div
      data-slot="day-time-picker"
      data-region="daytimepicker-root"
      className={cn("day-time-picker flex w-full flex-col", className)}
    >
      {/* Header — range readout (left) + deconflict / mode / window menus (right) */}
      <div data-region="daytimepicker-header" className="flex items-center justify-between gap-3 pb-3">
        {/* Range readout — the live current selection as a 12h clock range */}
        <div className="flex items-center gap-2">
          <div data-region="daytimepicker-range-readout" className="flex h-9 items-center justify-center gap-1.5 rounded-xl border border-edge pl-2 pr-3">
            <Clock9 className="size-4 text-glyph" aria-hidden="true" />
            <span className="type-body-2 font-medium text-content whitespace-nowrap tabular-nums">
              {singleTime
                ? formatClock12(displayStart)
                : `${formatClock12(displayStart)} – ${formatClock12(displayEnd)}`}
            </span>
          </div>
        </div>
        {/* Actions — deconflict (clear of locked others) + time-mode menu + window range */}
        <div data-region="daytimepicker-actions" className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon="only"
            type="button"
            aria-label={onOptimize ? "Optimize this activity's time" : "Deconflict"}
            onClick={() => {
              if (onOptimize) {
                cancelResetAnimation();
                onOptimize();
              } else {
                handleDeconflict();
              }
            }}
            disabled={onOptimize ? false : conflicts.length === 0}
          >
            <Wand2 className="size-4" />
          </Button>
          {/* Time-mode menu — Start-time-only / All-day switches */}
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="secondary"
                  size="sm"
                  icon="only"
                  type="button"
                  aria-label="Time options"
                >
                  <SlidersHorizontal className="size-4" />
                </Button>
              }
            />
            <MenuContent
              data-region="daytimepicker-mode-menu"
              side="bottom"
              align="end"
              sideOffset={8}
              className="w-56 gap-2"
            >
              {/* Start time only */}
              <div className="flex items-center justify-between gap-3 px-2 py-1">
                <span className="type-body-2 text-content">Start time only</span>
                <Switch
                  size="sm"
                  checked={singleTime}
                  onCheckedChange={(v) => {
                    cancelResetAnimation();
                    onSingleTimeChange?.(v);
                  }}
                  label="Start time only"
                />
              </div>
              {/* All day */}
              <div className="flex items-center justify-between gap-3 px-2 py-1">
                <span className="type-body-2 text-content">All day</span>
                <Switch
                  size="sm"
                  checked={isAllDay}
                  onCheckedChange={(v) => handleAllDayToggle(v)}
                  label="All day"
                />
              </div>
            </MenuContent>
          </Menu>
          {/* Window range dropdown — picks the visible slice of the day (18 hr / 24 hr) */}
          <Menu>
            <MenuTrigger
              render={
                <Button
                  variant="secondary"
                  size="sm"
                  icon="trailing"
                  type="button"
                  aria-label="Visible window range"
                >
                  {activeWindow.label}
                  <ChevronDown className="size-4" />
                </Button>
              }
            />
            <MenuContent
              data-region="daytimepicker-window-menu"
              side="bottom"
              align="end"
              sideOffset={4}
              className="min-w-[112px]"
            >
              {WINDOWS.map((w) => (
                <MenuItem
                  key={w.key}
                  size="sm"
                  selected={w.key === windowKey}
                  className="min-w-0"
                  onClick={() => {
                    cancelResetAnimation();
                    setWindowKey(w.key);
                  }}
                >
                  {w.label}
                </MenuItem>
              ))}
            </MenuContent>
          </Menu>
        </div>
      </div>

      {/* Divider */}
      <div data-region="daytimepicker-divider" className="-mx-4 border-t border-edge-subtle" />

      {/* Activity Lane — siblings as thumbnails (conflict tilts + reddens),
          current location photo pinned on top, tracking the window start. */}
      <div data-region="daytimepicker-activity-lane" className="relative h-12 pt-3">
        {markers.map((m) => {
          const mEnd = m.endMinutes ?? m.startMinutes;
          const conflict = !singleTime && overlaps(visualStart, visualEnd, m.startMinutes, mEnd);
          return (
            <div
              key={m.id}
              data-region="daytimepicker-activity-thumb"
              className="absolute bottom-0"
              style={{ left: `${pct(m.startMinutes)}%` }}
            >
              <ActivityThumbnail type={conflict ? "conflict" : "default"} src={m.src} alt={m.name ?? ""} />
            </div>
          );
        })}
        {currentActivity && (
          <div
            data-region="daytimepicker-current-thumb"
            className="absolute bottom-0 z-10"
            style={{ left: `${startPct}%` }}
          >
            <ActivityThumbnail type="current" src={currentActivity.src} alt={currentActivity.name ?? ""} />
          </div>
        )}
      </div>

      {/* Ruler tape */}
      <div data-region="daytimepicker-ruler" className="relative pt-2 pb-1">
        <div ref={railRef} data-region="daytimepicker-ruler-rail" className="day-time-picker-rail group relative h-12 touch-none select-none">
          {/* Tick tape — neutral dead-time ruler; the selected region is covered
              by the red TimeBar capsule below. Absolutely positioned via the
              view-aware pct so ticks stay aligned with the window range. */}
          <div className="absolute inset-0">
            {visibleTicks.map((min) => {
              const isHour = min % 60 === 0;
              return (
                <span
                  key={min}
                  data-region="daytimepicker-ruler-tick"
                  className={cn(
                    "absolute top-1/2 w-px -translate-x-1/2 -translate-y-1/2 rounded-full",
                    isHour ? "h-4 bg-edge-strong" : "h-2.5 bg-edge",
                  )}
                  style={{ left: `${pct(min)}%` }}
                />
              );
            })}
          </div>

          {/* Selected window — the live red TimeBar (current), draggable to move */}
          {!singleTime && (
            <div
              aria-label="Move time range"
              data-region="daytimepicker-selection"
              className={cn(
                "absolute inset-y-1 z-10 cursor-grab active:cursor-grabbing",
                isResetAnimating && "transition-[left,width] duration-[var(--motion-duration-medium)] ease-[var(--motion-ease-spatial)] motion-reduce:transition-none",
              )}
              style={windowStyle}
              onPointerDown={(e) => beginDrag("move", e)}
            >
              <TimeBar type="current" className="h-full w-full" />
            </div>
          )}

          {/* Other locations — each sibling as the default grey TimeBar spanning
              its full duration (or a thin neutral marker if zero-duration), so
              you can see where they sit and drag the window to avoid them. Sit
              below the red current bar (z-10) where they overlap, above ticks. */}
          {markers.map((m) => {
            const mEnd = m.endMinutes ?? m.startMinutes;
            const left = pct(m.startMinutes);
            // Covered by the selection → grow the gray bar 4px taller each side
            // (inset-y-0 vs inset-y-1) so it peeks out above/below the red bar and
            // its duration stays visible.
            const conflict =
              !singleTime && mEnd > m.startMinutes &&
              overlaps(visualStart, visualEnd, m.startMinutes, mEnd);
            return mEnd > m.startMinutes ? (
              <div
                key={m.id}
                aria-hidden
                data-region="daytimepicker-sibling-bar"
                className={cn(
                  "pointer-events-none absolute z-[5]",
                  conflict ? "-inset-y-1" : "inset-y-1",
                )}
                style={{ left: `${left}%`, width: `${pct(mEnd) - left}%` }}
              >
                <TimeBar
                  type="time"
                  className={cn("h-full w-full", conflict && "border-edge-strong")}
                />
              </div>
            ) : (
              <span
                key={m.id}
                aria-hidden
                data-region="daytimepicker-sibling-bar"
                className="pointer-events-none absolute inset-y-1 z-[5] w-0.5 -translate-x-1/2 rounded-full bg-edge-strong"
                style={{ left: `${left}%` }}
              />
            );
          })}

          {/* Resize grips — default-style grey handle pills flanking the bar */}
          {!singleTime && (
            <>
              <button
                type="button"
                aria-label="Start time"
                className={cn(
                  "day-time-picker-handle absolute top-1/2 z-20 flex h-5 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center opacity-0 outline-none focus-visible:rounded-md focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-edge-strong/50",
                  dragging && "opacity-100",
                  isResetAnimating && "transition-[left] duration-[var(--motion-duration-medium)] ease-[var(--motion-ease-spatial)] motion-reduce:transition-none",
                )}
                style={{ left: `${startPct}%` }}
                onPointerDown={(e) => beginDrag("start", e)}
              >
                <span className="flex h-full w-full items-center justify-center gap-[2px] rounded-sm border border-edge bg-surface shadow-sm">
                  <span className="h-2.5 w-px rounded-full bg-edge-strong" />
                  <span className="h-2.5 w-px rounded-full bg-edge-strong" />
                </span>
              </button>
              <button
                type="button"
                aria-label="End time"
                className={cn(
                  "day-time-picker-handle absolute top-1/2 z-20 flex h-5 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center opacity-0 outline-none focus-visible:rounded-md focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-edge-strong/50",
                  dragging && "opacity-100",
                  isResetAnimating && "transition-[left] duration-[var(--motion-duration-medium)] ease-[var(--motion-ease-spatial)] motion-reduce:transition-none",
                )}
                style={{ left: `${endPct}%` }}
                onPointerDown={(e) => beginDrag("end", e)}
              >
                <span className="flex h-full w-full items-center justify-center gap-[2px] rounded-sm border border-edge bg-surface shadow-sm">
                  <span className="h-2.5 w-px rounded-full bg-edge-strong" />
                  <span className="h-2.5 w-px rounded-full bg-edge-strong" />
                </span>
              </button>
            </>
          )}

          {/* Single-time handle — renders as a 20-min-wide red TimeBar capsule,
              left-edge aligned to the start time, so it matches the look of a
              20-minute range bar instead of a wider standalone pill. */}
          {singleTime && (
            <button
              type="button"
              aria-label="Start time"
              className={cn(
                "absolute inset-y-1 z-20 cursor-ew-resize outline-none focus-visible:rounded-xl focus-visible:ring-2 focus-visible:ring-edge-strong/50",
                isResetAnimating && "transition-[left,width] duration-[var(--motion-duration-medium)] ease-[var(--motion-ease-spatial)] motion-reduce:transition-none",
              )}
              style={{
                left: `${startPct}%`,
                width: `${Math.max(0, pct(displayStart + 20) - startPct)}%`,
              }}
              onPointerDown={(e) => beginDrag("start", e)}
            >
              <TimeBar type="current" className="h-full w-full" />
            </button>
          )}
        </div>

        {/* Duration — sits below the selected section, centered on it */}
        <div data-region="daytimepicker-duration" className="relative mt-2 h-5">
          <span
            className={cn(
              "absolute top-0 -translate-x-1/2 type-body-3 font-semibold whitespace-nowrap tabular-nums",
              conflicts.length > 0 ? "text-content-error" : "text-content",
              isResetAnimating && "transition-[left] duration-[var(--motion-duration-medium)] ease-[var(--motion-ease-spatial)] motion-reduce:transition-none",
            )}
            style={{ left: `${midPct}%` }}
          >
            {singleTime ? formatClock12(displayStart) : formatDuration(displayDuration)}
          </span>
        </div>

        {/* Period anchors — recomputed from the current view window; nearest is
            bolded. Sit directly below the ruler to label the time axis, spanning
            the full width so the 5 marks line up with the rail's edges. */}
        <div data-region="daytimepicker-anchors" className="mt-1 flex items-center justify-between">
          {periodAnchors.map((a, i) => (
            <span
              key={i}
              className={cn(
                "type-body-3 whitespace-nowrap",
                a === nearestAnchor ? "font-semibold text-content" : "text-content-secondary",
              )}
            >
              {formatAnchor(a)}
            </span>
          ))}
        </div>
      </div>

      {/* Footer — Reset/Save (mode switches moved to the header menu) */}
      <div data-region="daytimepicker-footer" className="mt-2 flex items-center justify-end gap-2 border-t border-edge-subtle pt-3">
        <div className="flex items-center gap-2">
          {onReset && (
            <Button variant="outline" size="sm" type="button" onClick={handleReset}>Reset</Button>
          )}
          {onSave && (
            <Button variant="primary" size="sm" type="button" disabled={saveDisabled} onClick={onSave}>Save</Button>
          )}
        </div>
      </div>
    </div>
  );
}

DayTimePicker.displayName = "DayTimePicker";

export type { DayTimePickerProps };
