"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, Layers, Route } from "lucide-react";
import { type DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/primitives/Button";
import { Calendar } from "@/components/ui/primitives/Calendar";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/primitives/Popover";
import { ConfirmActionDialog } from "@/components/ui/modals/ConfirmActionDialog";
import { useToast } from "@/contexts/ToastContext";
import type { ItineraryDayDetail } from "@/lib/supabase/queries/home";

interface EditDaySelectorProps {
  days: ItineraryDayDetail[];
  /** Index of the day currently in view (drives the active pill). */
  focusedDayIndex: number;
  /** Smooth-scroll the day list to the clicked day. */
  onDayClick: (dayIndex: number) => void;
  /** Transport route visibility (Figma button ①). */
  transportHidden: boolean;
  onToggleTransport: () => void;
  /** Center panel visibility (Figma button ③). */
  isCollectionActive?: boolean;
  onCollectionOpen?: () => void;
  /** Commit a new itinerary date range from the calendar popover. UI persists locally even when omitted. */
  onDatesChange?: (range: DateRange) => void;
  className?: string;
}

/** Parse a date-only string ("YYYY-MM-DD"[…]) at local midnight, guarding the T-split trap. */
function parseDay(dateStr: string): Date | null {
  const d = new Date(`${dateStr.split("T")[0]}T00:00:00`);
  return isNaN(d.getTime()) ? null : d;
}

/** Calendar-day equality (ignores time-of-day), tolerant of undefined. */
function sameDay(a?: Date, b?: Date): boolean {
  return (
    !!a &&
    !!b &&
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Day-selector strip for the edit-mode day editor (Figma `1412:11609`).
 * A horizontal row of date mini-tabs (date # + month, bordered active pill) plus
 * three action buttons: transport route toggle, a calendar popover to change the
 * itinerary dates (UI only — wiring is a follow-up ticket), and the collection /
 * center-panel toggle. Replaces the previous single sticky animated date label.
 */
export function EditDaySelector({
  days,
  focusedDayIndex,
  onDayClick,
  transportHidden,
  onToggleTransport,
  isCollectionActive,
  onCollectionOpen,
  onDatesChange,
  className,
}: EditDaySelectorProps) {
  // Calendar popover holds a local range. `baseline` is the committed span the
  // Reset button restores to and the reference for detecting dropped days on Save.
  const firstDate = days.length ? parseDay(days[0].date) : null;
  const lastDate = days.length ? parseDay(days[days.length - 1].date) : null;
  const initialRange: DateRange | undefined =
    firstDate && lastDate ? { from: firstDate, to: lastDate } : undefined;
  const [baseline, setBaseline] = useState<DateRange | undefined>(initialRange);
  const [dateRange, setDateRange] = useState<DateRange | undefined>(initialRange);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The range awaiting confirmation. Captured when the drop-days dialog opens so the
  // commit is immune to dateRange being reset (e.g. the popover closing behind the dialog).
  const [pendingRange, setPendingRange] = useState<DateRange | null>(null);
  const { showToast } = useToast();

  // Re-seed baseline + working range only when the committed span actually changes
  // (save refresh, realtime edit) — never on a mere popover open/close, which would
  // clobber an in-progress selection. The ref tracks the last span we seeded from.
  const spanStart = days.length ? days[0].date : null;
  const spanEnd = days.length ? days[days.length - 1].date : null;
  const seededSpanRef = useRef<string | null>(null);
  useEffect(() => {
    const spanKey = `${spanStart ?? ""}|${spanEnd ?? ""}`;
    if (seededSpanRef.current === spanKey) return; // span unchanged — nothing to do

    // The committed span changed under us (save refresh, realtime edit). If the
    // user is mid-flow, their in-progress pick — and any pending drop-days
    // confirmation — was chosen against the OLD span and is now stale. We must not
    // keep it silently: a captured pendingRange would commit a range the user never
    // saw, and an open calendar pick would be wiped on close with no explanation.
    // Dismiss the open UI, tell the user, then re-seed to the new truth below so
    // reopening the calendar shows the current dates.
    if (calendarOpen || confirmOpen) {
      setCalendarOpen(false);
      setConfirmOpen(false);
      setPendingRange(null);
      // Only warn when the change came from *elsewhere*. A local Save sets `baseline`
      // to the committed range before that span echoes back as new `days`, so the echo
      // matches `baseline` — re-seed silently rather than blaming "someone" for our own
      // edit. A genuine external edit produces a span that differs from `baseline`.
      const isExternal =
        !sameDay(initialRange?.from, baseline?.from) ||
        !sameDay(initialRange?.to, baseline?.to);
      if (isExternal) {
        showToast({
          title: "Trip dates changed",
          description: "Someone updated this itinerary. Please re-pick your dates.",
          variant: "default",
        });
      }
    }

    seededSpanRef.current = spanKey;
    setBaseline(initialRange);
    setDateRange(initialRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spanStart, spanEnd, calendarOpen, confirmOpen]);

  // Floor for selectable days: itineraries can't start in the past, so the
  // calendar disables everything before today (local midnight).
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Save needs a complete range — the persist path ignores half-picked ranges.
  const hasRange = Boolean(dateRange?.from && dateRange?.to);

  // Save is a no-op when the picked range still matches the committed span.
  const isUnchanged =
    hasRange &&
    sameDay(dateRange?.from, baseline?.from) &&
    sameDay(dateRange?.to, baseline?.to);

  // A day is "dropped" when the new range no longer covers part of the committed
  // span — i.e. it starts later or ends earlier than the baseline. Those days lose
  // their planned activities, so Save gates on a confirmation when this is true.
  const dropsDays = Boolean(
    hasRange &&
      ((baseline?.from && dateRange!.from! > baseline.from) ||
        (baseline?.to && dateRange!.to! < baseline.to)),
  );

  function commit(range: DateRange) {
    setBaseline(range);
    onDatesChange?.(range);
    setCalendarOpen(false);
  }

  function handleSave() {
    if (!hasRange || !dateRange) return;
    if (dropsDays) {
      setPendingRange(dateRange);
      setConfirmOpen(true);
      return;
    }
    commit(dateRange);
  }

  function handleReset() {
    setDateRange(baseline);
  }

  return (
    <div
      data-region="itinerary-edit-day-selector"
      className={cn(
        "edit-day-selector sticky top-0 z-20 flex items-center justify-between gap-2 bg-surface py-1",
        className,
      )}
    >
      {/* Day Mini-Tabs */}
      <div className="edit-day-selector-tabs flex items-center min-w-0 overflow-x-auto scrollbar-none">
        {days.map((day, i) => {
          const d = parseDay(day.date);
          const num = d ? String(d.getDate()) : "";
          const month = d ? d.toLocaleDateString("en-US", { month: "short" }) : "";
          const isActive = i === focusedDayIndex;
          return (
            <button
              key={day.id}
              type="button"
              onClick={() => onDayClick(i)}
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "edit-day-selector-tab flex h-16 w-[47px] shrink-0 flex-col items-center justify-center rounded-xl type-body-2 transition-colors cursor-pointer",
                isActive
                  ? "border border-edge font-medium text-content"
                  : "text-content-secondary hover:text-content",
              )}
            >
              <span className="edit-day-selector-tab-num">{num}</span>
              <span className="edit-day-selector-tab-month">{month}</span>
            </button>
          );
        })}
      </div>

      {/* Strip Actions */}
      <div className="edit-day-selector-actions flex items-center shrink-0">
        {/* Transport Route Toggle */}
        <Button
          variant={transportHidden ? "ghost" : "primary"}
          size="sm"
          icon="only"
          onClick={onToggleTransport}
          title={transportHidden ? "Show transport segments" : "Hide transport segments"}
          aria-label={transportHidden ? "Show transport segments" : "Hide transport segments"}
          className="edit-day-selector-transport-button"
        >
          <Route className="edit-day-selector-transport-icon size-4" />
        </Button>

        {/* Calendar — change itinerary dates */}
        <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
          <PopoverTrigger
            aria-label="Change itinerary dates"
            title="Change itinerary dates"
            className={cn(
              "edit-day-selector-calendar-trigger",
              buttonVariants({ variant: "ghost", size: "sm", icon: "only" }),
            )}
          >
            <CalendarDays className="edit-day-selector-calendar-icon size-4" />
          </PopoverTrigger>
          <PopoverContent align="end" side="bottom" className="edit-day-selector-calendar-popover p-0">
            <Calendar
              mode="range"
              selected={dateRange}
              onSelect={setDateRange}
              numberOfMonths={1}
              startMonth={today}
              disabled={{ before: today }}
            />

            {/* Calendar Actions — Reset / Save split 50-50 */}
            <div className="edit-day-selector-calendar-actions grid grid-cols-2 gap-2 border-t border-edge p-3">
              <Button
                variant="outline"
                size="sm"
                type="button"
                onClick={handleReset}
                className="edit-day-selector-calendar-reset w-full"
              >
                Reset
              </Button>
              <Button
                variant="primary"
                size="sm"
                type="button"
                disabled={!hasRange || isUnchanged}
                onClick={handleSave}
                className="edit-day-selector-calendar-save w-full"
              >
                Save
              </Button>
            </div>
          </PopoverContent>
        </Popover>

        {/* Collection / Center Panel Toggle */}
        <Button
          variant={isCollectionActive ? "primary" : "secondary"}
          size="sm"
          icon="only"
          onClick={onCollectionOpen}
          aria-label="Toggle collection panel"
          className="edit-day-selector-collection-button"
        >
          <Layers className="edit-day-selector-collection-icon size-4" />
        </Button>
      </div>

      {/* Shorten Dates Confirmation Modal */}
      <ConfirmActionDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Remove days from this trip?"
        confirmLabel="Remove days"
        onConfirm={() => {
          if (pendingRange) commit(pendingRange);
          setPendingRange(null);
          setConfirmOpen(false);
        }}
        onCancel={() => {
          setPendingRange(null);
          setConfirmOpen(false);
        }}
      >
        <p className="type-body-2 text-content-secondary">
          The new dates drop one or more days from your itinerary. All activities planned on the
          removed days will be permanently deleted and can&apos;t be recovered.
        </p>
      </ConfirmActionDialog>
    </div>
  );
}

EditDaySelector.displayName = "EditDaySelector";
