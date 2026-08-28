"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type TransitionEvent } from "react";
import {
  AlertTriangle,
  Clock,
  MoreVertical,
  Pencil,
  Paperclip,
  MapPin,
  SendHorizontal,
  StickyNote,
  Trash2,
  UtensilsCrossed,
  PlaneTakeoff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CategoryBadge, type CategoryBadgeProps } from "@/components/ui/primitives/CategoryBadge";
import { Button, buttonVariants } from "@/components/ui/primitives/Button";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/primitives/Tooltip";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/primitives/Popover";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/primitives/Menu";
import { Avatar } from "@/components/ui/primitives/Avatar";
import { useSessionUserId } from "@/hooks/useSessionUserId";
import { useProfileQuery } from "@/hooks/queries/useProfileQuery";
import { DayTimePicker, type DayTimeMarker } from "./DayTimePicker";
import { humanizePlaceType } from "@/lib/utils/formatters";
import { parseTimeMins, minsToHHMM } from "./activity-utils";
import { getOpeningHoursStatus } from "./opening-hours-status";

// Cards re-render constantly under drag; this keeps the warning an impression
// event rather than a render counter.
const reportedHoursWarnings = new Set<string>();
import type { ItineraryActivityDetail } from "@/lib/db/itinerary-detail";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ActivityCardLayout = "full" | "compact" | "edit";
export type ActivityAction = "attachment" | "notes" | "expense";

export interface CompactActivityCardProps {
  activity: ItineraryActivityDetail;
  layout?: ActivityCardLayout;
  selected?: boolean;
  disabled?: boolean;
  elevated?: boolean;
  timezone?: string;
  /** Calendar date of the day this card sits on ("YYYY-MM-DD"); used to check opening hours. */
  dayDate?: string;
  /** Show a loading shimmer in place of the time while it's recalculated server-side. */
  timeLoading?: boolean;
  fallbackImage?: string;
  onClick?: () => void;
  onDelete?: () => void;
  onAction?: (action: ActivityAction) => void;
  activityNotePreview?: string | null;
  onQuickNoteSubmit?: (content: string) => void | Promise<void>;
  onQuickNoteRemove?: () => void | Promise<void>;
  /** Renders an existing note as static card content without note controls. */
  readOnlyNote?: boolean;
  /** When provided (edit layout), the time pill opens an inline DayTimePicker; the draft commits via this on Save. */
  onTimeChange?: (startTime: string, endTime: string | null) => void;
  /** Optimize just this activity's time (the picker's wand) — runs the day route optimizer with every other activity locked. */
  onOptimize?: () => void;
  /** Fires when the inline time picker opens/closes — lets the parent disable drag while it's open. */
  onTimePickerOpenChange?: (open: boolean) => void;
  /** Other activities on the same day — markers + conflict detection in the time picker. */
  markers?: DayTimeMarker[];
  locked?: boolean;
  onToggleLock?: () => void;
  className?: string;
}

// ─── Layout Helper ────────────────────────────────────────────────────────────

export function getActivityCardLayout(
  activity: ItineraryActivityDetail,
  opts?: { editable?: boolean },
): ActivityCardLayout {
  // Lodging and flights are gone with the backend that supplied them, so every
  // stop takes the same layout and the choice is edit-mode only.
  return opts?.editable ? "edit" : "full";
}

// ─── Badge Resolver ───────────────────────────────────────────────────────────

function resolveBadge(
  activity: ItineraryActivityDetail,
): { category: NonNullable<CategoryBadgeProps["category"]>; icon: LucideIcon } {
  const cat = activity.category?.toLowerCase() ?? "";


  if (activity.id.startsWith("flight-") || cat === "flight" || cat === "flights") {
    return { category: "flight", icon: PlaneTakeoff };
  }

  // Only restaurants are stored as "meal"; everything else (poi) gets the map pin.
  // Both share the location color — meal differs by the utensils icon only.
  if (cat === "meal") {
    return { category: "location", icon: UtensilsCrossed };
  }
  return { category: "location", icon: MapPin };
}

// ─── Time Helpers ─────────────────────────────────────────────────────────────

function formatTime(time: string | null, timezone = "UTC"): string | null {
  if (!time) return null;
  if (time.includes("T")) {
    const d = new Date(time);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: timezone,
    });
  }
  const parts = time.split(":");
  if (parts.length < 2) return null;
  const hour = parseInt(parts[0], 10);
  const minute = parts[1];
  const ampm = hour >= 12 ? "PM" : "AM";
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h}:${minute} ${ampm}`;
}

function formatTimeRange(
  startTime: string | null,
  endTime: string | null,
  timezone = "UTC",
): string | null {
  const start = formatTime(startTime, timezone);
  const end = formatTime(endTime, timezone);
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  return null;
}

// ─── Duration Helper ──────────────────────────────────────────────────────────

function formatActivityDuration(
  activity: ItineraryActivityDetail,
): string | null {
  let mins: number | null = null;

  if (activity.start_time && activity.end_time) {
    // The shared helper, not a private copy reading the browser's clock: a stop
    // whose start and end straddle local midnight would otherwise measure as a
    // negative day.
    const diff = parseTimeMins(activity.end_time) - parseTimeMins(activity.start_time);
    if (diff > 0) mins = diff;
  }

  if (
    mins === null &&
    typeof activity.location?.stay_duration === "number" &&
    activity.location.stay_duration > 0
  ) {
    mins = activity.location.stay_duration;
  }

  if (mins === null) return null;

  if (mins < 60) return `~${mins}m`;
  const h = mins / 60;
  const rounded = Math.round(h * 2) / 2;
  return `~${rounded}h`;
}

// ─── Component ────────────────────────────────────────────────────────────────

function CompactActivityCard({
  activity,
  layout: layoutProp,
  selected = false,
  disabled = false,
  elevated = false,
  timezone,
  dayDate,
  timeLoading = false,
  fallbackImage,
  onClick,
  onDelete: _onDelete,
  onAction,
  activityNotePreview,
  onQuickNoteSubmit,
  onQuickNoteRemove,
  readOnlyNote = false,
  onTimeChange,
  onOptimize,
  onTimePickerOpenChange,
  markers,
  locked: _locked = false,
  onToggleLock: _onToggleLock,
  className,
}: CompactActivityCardProps) {
  const layout = layoutProp ?? getActivityCardLayout(activity);
  const badge = resolveBadge(activity);
  const cat = activity.category?.toLowerCase() ?? "";

  const timeRange = formatTimeRange(activity.start_time, activity.end_time, timezone);
  const durationLabel = formatActivityDuration(activity);
  const incomingNotePreview = activityNotePreview?.trim() ?? "";
  const [localNoteOverride, setLocalNoteOverride] = useState<string | null | undefined>(undefined);
  const notePreview = localNoteOverride === undefined ? incomingNotePreview : (localNoteOverride ?? "");
  const hasVisibleActivityNote = Boolean(notePreview);
  const [quickNoteDraft, setQuickNoteDraft] = useState("");
  const [isEditingNote, setIsEditingNote] = useState(false);
  const [noteComposerRequested, setNoteComposerRequested] = useState(false);
  const [quickNoteSaving, setQuickNoteSaving] = useState(false);
  const [quickNoteRemoving, setQuickNoteRemoving] = useState(false);
  const hasQuickNoteDraft = Boolean(quickNoteDraft.trim());
  const canRenderNoteSection =
    hasVisibleActivityNote ||
    (!readOnlyNote && selected && (hasQuickNoteDraft || (noteComposerRequested && Boolean(onQuickNoteSubmit))));
  const [noteSectionHidden, setNoteSectionHidden] = useState(false);
  const noteSectionOpen = canRenderNoteSection && (readOnlyNote || !noteSectionHidden);
  const previousNotePreviewRef = useRef(notePreview);
  const notePreviewRef = useRef<HTMLSpanElement | null>(null);
  const [notePreviewMaxHeight, setNotePreviewMaxHeight] = useState("1.25rem");
  const [isNotePreviewExpanded, setIsNotePreviewExpanded] = useState(selected);
  const quickNoteInputRef = useRef<HTMLTextAreaElement | null>(null);
  // Quick notes are always authored by the current user — show their avatar.
  const sessionUserId = useSessionUserId();
  const { data: noteAuthorProfile } = useProfileQuery(sessionUserId);

  useEffect(() => {
    if (localNoteOverride === undefined) return;
    if (localNoteOverride === incomingNotePreview || (!localNoteOverride && !incomingNotePreview)) {
      setLocalNoteOverride(undefined);
    }
  }, [incomingNotePreview, localNoteOverride]);

  useEffect(() => {
    if (selected || hasVisibleActivityNote || hasQuickNoteDraft || !noteComposerRequested) return;
    setNoteComposerRequested(false);
  }, [hasQuickNoteDraft, hasVisibleActivityNote, noteComposerRequested, selected]);

  useEffect(() => {
    const previousNotePreview = previousNotePreviewRef.current;
    previousNotePreviewRef.current = notePreview;
    if (!notePreview || previousNotePreview === notePreview) return;
    setNoteSectionHidden(false);
  }, [notePreview]);

  useEffect(() => {
    if (!noteSectionOpen || hasVisibleActivityNote && !isEditingNote) return;
    const frame = requestAnimationFrame(() => {
      quickNoteInputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [hasVisibleActivityNote, isEditingNote, noteSectionOpen]);

  // Grow the composer textarea to fit its content (capped by max-h-24, which
  // then scrolls) while the note is being edited. Resets to a single row when
  // the draft is cleared — and since the composer only mounts while the card is
  // selected, deselecting collapses back to the truncated one-line preview.
  useEffect(() => {
    const el = quickNoteInputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [quickNoteDraft, noteSectionOpen, isEditingNote]);

  // A saved note is always mounted so its one-line preview stays visible on an
  // unselected card. Keep wrapped content in place until its collapse finishes;
  // otherwise switching to `truncate` makes the card snap shut before the
  // max-height transition can play. Re-targeting the CSS transition also makes
  // a quick re-select reverse smoothly from the current height.
  useLayoutEffect(() => {
    const element = notePreviewRef.current;
    if (!element) return;

    if (selected) {
      if (!isNotePreviewExpanded) {
        setIsNotePreviewExpanded(true);
        return;
      }

      const frame = requestAnimationFrame(() => {
        setNotePreviewMaxHeight(`${element.scrollHeight}px`);
      });
      return () => cancelAnimationFrame(frame);
    }

    if (!isNotePreviewExpanded) {
      setNotePreviewMaxHeight("1.25rem");
      return;
    }

    setNotePreviewMaxHeight(`${element.scrollHeight}px`);
    const frame = requestAnimationFrame(() => {
      setNotePreviewMaxHeight("1.25rem");
    });
    return () => cancelAnimationFrame(frame);
  }, [selected, isNotePreviewExpanded, notePreview]);

  const handleNotePreviewTransitionEnd = (event: TransitionEvent<HTMLSpanElement>) => {
    if (event.propertyName === "max-height" && !selected) {
      setIsNotePreviewExpanded(false);
    }
  };

  // ── Inline time picker (24h minutes, 0–1440) — edit layout only ──
  const DEFAULT_START_MIN = 540; // 9:00 AM
  const DEFAULT_DURATION_MIN = 60;
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [tpStart, setTpStart] = useState(DEFAULT_START_MIN);
  const [tpEnd, setTpEnd] = useState(DEFAULT_START_MIN + DEFAULT_DURATION_MIN);
  const [tpSingle, setTpSingle] = useState(false);
  const tpSnapshot = useRef({ start: DEFAULT_START_MIN, end: DEFAULT_START_MIN + DEFAULT_DURATION_MIN, single: false });

  // Sibling markers exclude this card's own activity.
  const pickerMarkers = useMemo(
    () => (markers ?? []).filter((m) => m.id !== activity.id),
    [markers, activity.id],
  );

  const commitTime = useCallback(
    (s: number, e: number, single: boolean) => {
      onTimeChange?.(minsToHHMM(s), single ? null : minsToHHMM(e));
    },
    [onTimeChange],
  );

  const handleTimePickerOpenChange = (open: boolean) => {
    if (open) {
      const single = activity.start_time != null && activity.end_time == null;
      const s = activity.start_time != null ? parseTimeMins(activity.start_time, timezone) : DEFAULT_START_MIN;
      let e =
        !single && activity.end_time != null
          ? parseTimeMins(activity.end_time, timezone)
          : Math.min(s + DEFAULT_DURATION_MIN, 1440);
      // A 12 AM (midnight) end persists as 00:00, which parses back to 0 and
      // makes the range end at/before its start — collapsing the picker to "0m".
      // Within this single-day picker (0–1440), an end at/before the start can
      // only mean midnight, so re-read it as end-of-day so the window reopens
      // intact (covers both "… – 12 AM" ranges and all-day 12 AM–12 AM).
      if (!single && e <= s) e = 1440;
      setTpStart(s);
      setTpEnd(e);
      setTpSingle(single);
      tpSnapshot.current = { start: s, end: e, single };
    }
    setTimePickerOpen(open);
    onTimePickerOpenChange?.(open);
  };

  // Draft callbacks update local state only — nothing propagates to the day
  // column until the user presses Save (handleSave) below.
  const handleTpChange = (s: number, e: number) => {
    setTpStart(s);
    setTpEnd(e);
  };

  const handleTpSingleChange = (single: boolean) => {
    let e = tpEnd;
    if (!single && e <= tpStart) e = Math.min(tpStart + DEFAULT_DURATION_MIN, 1440);
    setTpEnd(e);
    setTpSingle(single);
  };

  const handleTpReset = () => {
    const snap = tpSnapshot.current;
    setTpStart(snap.start);
    setTpEnd(snap.end);
    setTpSingle(snap.single);
  };

  // Save is enabled only once the draft differs from the open-time snapshot.
  const tpSnap = tpSnapshot.current;
  const hasTimeChanges =
    tpSingle !== tpSnap.single ||
    tpStart !== tpSnap.start ||
    (!tpSingle && tpEnd !== tpSnap.end);

  const handleSave = () => {
    commitTime(tpStart, tpEnd, tpSingle);
    setTimePickerOpen(false);
    onTimePickerOpenChange?.(false);
  };

  const thumbnailUrl =
    activity.photo_url ?? activity.location?.photo_urls?.[0] ?? fallbackImage ?? null;

  // Description: prefer location_context, fallback to the humanized primary type
  const primaryType = activity.location?.primary_type;
  // Pass C's sentence first: it is written for this traveller and this day,
  // where the editorial summary is Google's description of the place for
  // everyone. The type name is the last resort.
  const description =
    activity.content?.whyForYou ??
    activity.location?.editorial_summary ??
    (primaryType ? humanizePlaceType(primaryType) : null);

  const isLodgingBookend = false;

  const lodgingLabel = (() => {
    if (!activity.start_time) return null;
    const timeOnly = formatTimeRange(activity.start_time, null, timezone);
    if (isLodgingBookend && !activity.end_time) {
      return `${activity.id.includes("lodging-start") ? "Leave at" : "Returned at"} ${timeOnly}`;
    }
    if (cat === "lodging_checkin") return `Check in at ${timeOnly}`;
    if (cat === "lodging_checkout") return `Check out at ${timeOnly}`;
    return null;
  })();

  // Opening hours closure check
  const hoursStatus = useMemo(
    () =>
      dayDate
        ? getOpeningHoursStatus(
            activity.location?.regular_opening_hours,
            dayDate,
            activity.start_time,
            activity.end_time,
            timezone,
          )
        : ({ kind: "ok" } as const),
    [
      activity.location?.regular_opening_hours,
      dayDate,
      activity.start_time,
      activity.end_time,
      timezone,
    ],
  );
  const hoursWarning = "label" in hoursStatus ? hoursStatus.label : null;

  useEffect(() => {
    if (hoursStatus.kind === "ok") return;
    const key = `${activity.id}:${hoursStatus.kind}`;
    if (reportedHoursWarnings.has(key)) return;
    reportedHoursWarnings.add(key);
  }, [activity.id, hoursStatus]);

  // Inline brand alert icon (footer) — hover reveals the closure message. No
  // other interaction. Placed next to the time per Figma (982:181).
  const hoursWarningElement = hoursWarning ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="compact-card-hours-warning inline-flex items-center justify-center shrink-0 size-5 text-glyph-brand cursor-default"
            aria-label={hoursWarning}
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <AlertTriangle className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="top">{hoursWarning}</TooltipContent>
    </Tooltip>
  ) : null;

  const handleActionClick = (event: MouseEvent<HTMLElement>, action: ActivityAction) => {
    event.stopPropagation();
    onAction?.(action);
  };

  const handleSavedNoteClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!selected) onClick?.();
  };

  const saveQuickNote = async () => {
    const content = quickNoteDraft.trim();
    if (!content || !onQuickNoteSubmit || quickNoteSaving) return;
    setLocalNoteOverride(content);
    setQuickNoteDraft("");
    setIsEditingNote(false);
    setNoteComposerRequested(false);
    setNoteSectionHidden(false);
    setQuickNoteSaving(true);
    try {
      await onQuickNoteSubmit(content);
    } catch (error) {
      setLocalNoteOverride(undefined);
      setQuickNoteDraft(content);
      throw error;
    } finally {
      setQuickNoteSaving(false);
    }
  };

  const handleQuickNoteSubmit = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    void saveQuickNote().catch(() => undefined);
  };

  const handleQuickNoteEdit = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    startQuickNoteEdit();
  };

  const startQuickNoteEdit = () => {
    setQuickNoteDraft(notePreview);
    setIsEditingNote(true);
    setNoteComposerRequested(true);
    setNoteSectionHidden(false);
    if (!selected) onClick?.();
  };

  const handleSavedNoteDoubleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (!onQuickNoteSubmit) return;
    startQuickNoteEdit();
  };

  const handleQuickNoteRemove = async (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    if (!onQuickNoteRemove || quickNoteRemoving) return;
    setLocalNoteOverride(null);
    setIsEditingNote(false);
    setNoteComposerRequested(false);
    setQuickNoteRemoving(true);
    try {
      await onQuickNoteRemove();
      setNoteSectionHidden(false);
    } catch {
      // The remove callback surfaces its own user-facing error; just revert.
      setLocalNoteOverride(undefined);
    } finally {
      setQuickNoteRemoving(false);
    }
  };

  const handleNoteToggle = (event: MouseEvent<HTMLElement>) => {
    event.stopPropagation();
    // Treat the note control as an explicit Save action while the inline
    // composer contains text, rather than hiding an unsaved draft.
    if (hasQuickNoteDraft && (!hasVisibleActivityNote || isEditingNote)) {
      void saveQuickNote().catch(() => undefined);
      return;
    }
    if (!canRenderNoteSection) {
      if (!hasVisibleActivityNote && onQuickNoteSubmit) {
        setNoteComposerRequested(true);
        setNoteSectionHidden(false);
        if (!selected) onClick?.();
      }
      return;
    }
    setNoteSectionHidden((hidden) => !hidden);
  };

  const noteAvatar = (
    <Avatar
      size="sm"
      type={noteAuthorProfile?.avatar_url ? "image" : "initial"}
      src={noteAuthorProfile?.avatar_url ?? undefined}
      name={noteAuthorProfile?.display_name ?? noteAuthorProfile?.email ?? undefined}
      className="compact-card-note-avatar shrink-0"
    />
  );

  // One layout for every note row — the collapsed preview, the expanded preview,
  // and the composer — so the avatar and padding never move between states and
  // only the text's height animates. The avatar (32px) is top-aligned; each row's
  // text carries `mt-2` (see below) so its first line's optical center matches the
  // avatar's, keeping a single line looking vertically centered against it.
  const noteRowClass = "flex min-h-9 w-full gap-3 px-2 py-0";

  const noteButton = !readOnlyNote && (hasVisibleActivityNote || onQuickNoteSubmit || onQuickNoteRemove) ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={noteSectionOpen ? "outline" : "ghost"}
            size="sm"
            icon="only"
            onClick={handleNoteToggle}
            aria-label={noteSectionOpen ? "Hide note" : "Show note"}
            aria-pressed={noteSectionOpen || undefined}
            className={cn(
              "compact-card-note-button",
              noteSectionOpen && "text-content",
            )}
          />
        }
      >
        <StickyNote className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="top">{hasVisibleActivityNote ? "Edit note" : "Add note"}</TooltipContent>
    </Tooltip>
  ) : null;

  // Outer shell classes
  const shellClasses = cn(
    "compact-activity-card",
    "relative border border-edge-subtle bg-surface rounded-xl p-2 gap-2 w-full cursor-pointer transition-[background-color,border-color,box-shadow] motion-safe:duration-[var(--motion-control-duration)] motion-safe:ease-[var(--motion-ease-standard)]",
    // Selected state — brand focus rail while keeping the card surface white.
    selected && [
      "border-edge bg-surface shadow-[0_4px_14px_0_var(--brand-shadow)]",
      "before:content-[''] before:absolute before:-left-2 before:bottom-2 before:top-2 before:w-1 before:origin-center before:rounded-full before:bg-action-brand",
      "motion-safe:before:animate-[activity-card-selected-rail_220ms_ease-out]",
    ],
    // Hover preview — short centered rail that expands to the selected rail on focus.
    !selected && onClick && !disabled && [
      "before:content-[''] before:absolute before:-left-2 before:top-1/2 before:h-3 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-action-brand",
      "before:opacity-0 before:transition-opacity before:duration-150 before:ease-out hover:before:opacity-100",
    ],
    // Disabled state
    disabled && "opacity-50 pointer-events-none",
    // Elevated lodging bookend bg
    elevated && !selected && "bg-surface-muted",
    // Layout-specific flex direction
    layout === "compact" ? "flex items-center" : "flex items-start",
    className,
  );

  return (
    <div
      data-slot="compact-activity-card"
      className={cn(
        "compact-activity-card-wrap flex w-full flex-col",
        noteSectionOpen && "rounded-xl border border-edge bg-surface-alt pb-2",
      )}
    >
      <div
        className={shellClasses}
        onClick={onClick}
      >
      {/* ── layout="compact" (accommodation / flight bookends) ── */}
      {layout === "compact" && (
        <>
          {/* Badge */}
          <CategoryBadge
            category={badge.category}
            icon={badge.icon}
            iconSize={14}
          />

          {/* Text */}
          <div className="compact-card-text flex flex-col flex-1 min-w-0 gap-0.5">
            <span className="compact-card-name type-body-2 type-secondary font-semibold text-content truncate">
              {activity.name}
            </span>
            {/* Subtitle: lodging label, timeRange, or neither */}
            {(lodgingLabel || timeRange) && (
              <span className="compact-card-subtitle type-body-3 text-content-secondary truncate">
                {lodgingLabel ?? timeRange}
              </span>
            )}
          </div>

          {/* Duration */}
          {durationLabel && (
            <span className="compact-card-duration type-body-3 text-content-secondary shrink-0">
              {durationLabel}
            </span>
          )}

          {/* Action button */}
          {(onAction || noteButton) && (
            <div className="compact-card-actions flex items-center gap-1">
              {noteButton}
              {onAction && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="only"
                  onClick={(e) => handleActionClick(e, "attachment")}
                  aria-label="Attach"
                >
                  <Paperclip className="size-4" />
                </Button>
              )}
            </div>
          )}
        </>
      )}

      {/* ── layout="full" or layout="edit" (location-type activities) ── */}
      {(layout === "full" || layout === "edit") && (
        <>
          {/* Timeline Column */}
          <div className="compact-card-timeline flex flex-col items-center gap-2 self-stretch shrink-0">
            <CategoryBadge
              category={badge.category}
              icon={badge.icon}
              iconSize={14}
            />
            {/* Vertical connector line */}
            <div className="compact-card-timeline-line w-px flex-1 bg-edge-subtle" />
          </div>

          {/* Content Column */}
          <div className="compact-card-content flex flex-col flex-1 min-w-0 gap-2 self-stretch">
            {/* Header */}
            <div className="compact-card-header flex gap-2 items-start w-full">

              {/* Text Section */}
              <div className="compact-card-text-section flex flex-col flex-1 min-w-0 gap-1">
                <span className="compact-card-name type-body-2 type-secondary font-semibold text-content truncate">
                  {activity.name}
                </span>

                {/* Description */}
                {description && (
                  <span className="compact-card-description type-body-3 text-content-secondary line-clamp-2 leading-tight">
                    {description}
                  </span>
                )}

              </div>

              {/* Thumbnail */}
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt={activity.name}
                  className="compact-card-thumbnail size-[72px] rounded-lg object-cover shrink-0 border border-edge-subtle bg-surface-muted"
                  draggable={false}
                />
              ) : (
                <div className="compact-card-thumbnail-placeholder size-[72px] rounded-lg shrink-0 bg-surface-muted border border-edge-subtle" />
              )}
            </div>

            {/* Footer */}
            {layout === "full" && (
              <div className="compact-card-footer flex items-end justify-between gap-2 w-full">
                {/* Time + alert */}
                <div className="compact-card-footer-time-group flex items-end gap-2 min-w-0">
                  <span className="compact-card-footer-time type-body-3 text-content-secondary min-w-0 truncate">
                    {timeLoading ? (
                      <span
                        className="compact-card-time-loading h-3.5 w-24 rounded bg-surface-muted animate-pulse inline-block"
                        aria-label="Calculating time"
                      />
                    ) : (
                      (lodgingLabel ?? timeRange ?? "")
                    )}
                  </span>
                  {hoursWarningElement}
                  {noteButton}
                </div>

                {/* Duration */}
                {durationLabel && (
                  <span className="compact-card-duration type-body-3 text-content shrink-0">
                    {durationLabel}
                  </span>
                )}
              </div>
            )}

            {/* Edit Footer — time pill + alert + duration */}
            {layout === "edit" && (
              <div className="compact-card-edit-footer flex items-center justify-between gap-2 w-full">
                {/* Time pill + alert */}
                <div className="compact-card-edit-footer-group flex items-center gap-1 min-w-0">
                  {onTimeChange ? (
                    <Popover open={timePickerOpen} onOpenChange={handleTimePickerOpenChange}>
                      <PopoverTrigger
                        className={cn(buttonVariants({ variant: "outline", size: "sm", icon: "leading" }))}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Clock className="size-4" />
                        {timeRange ?? "Set time"}
                      </PopoverTrigger>
                      {/* Day Time Picker Popover */}
                      <PopoverContent
                        side="bottom"
                        align="start"
                        className="day-time-picker-popover w-[608px] max-w-[calc(100vw-2rem)] gap-0 rounded-2xl border-edge-subtle p-4"
                      >
                        <DayTimePicker
                          startMinutes={tpStart}
                          endMinutes={tpEnd}
                          singleTime={tpSingle}
                          markers={pickerMarkers}
                          currentActivity={{ src: thumbnailUrl, name: activity.name }}
                          suggestedDuration={activity.location?.stay_duration ?? undefined}
                          travelBuffer={
                            activity.travel_duration_seconds != null
                              ? Math.round(activity.travel_duration_seconds / 60)
                              : undefined
                          }
                          onOptimize={
                            onOptimize
                              ? () => {
                                  // Optimizing commits day-level changes via the confirm
                                  // dialog, so close this popover before handing off.
                                  setTimePickerOpen(false);
                                  onTimePickerOpenChange?.(false);
                                  onOptimize();
                                }
                              : undefined
                          }
                          onChange={handleTpChange}
                          onSingleTimeChange={handleTpSingleChange}
                          onReset={handleTpReset}
                          onSave={handleSave}
                          saveDisabled={!hasTimeChanges}
                        />
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      icon="leading"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClick?.();
                      }}
                    >
                      <Clock className="size-4" />
                      {timeRange ?? "Set time"}
                    </Button>
                  )}
                  {hoursWarningElement}
                  {noteButton}
                </div>

                {/* Duration */}
                {durationLabel && (
                  <span className="compact-card-duration type-body-3 text-content shrink-0">
                    {durationLabel}
                  </span>
                )}
              </div>
            )}
          </div>

        </>
      )}
      </div>
      <div
        className={cn(
          "compact-card-note-section grid transition-[grid-template-rows,opacity,transform,margin] duration-[var(--motion-duration-normal)] ease-[var(--motion-ease-standard)]",
          noteSectionOpen
            ? "mt-2 grid-rows-[1fr] opacity-100 translate-y-0"
            : "mt-0 grid-rows-[0fr] opacity-0 -translate-y-1",
        )}
        aria-hidden={!noteSectionOpen}
      >
        <div
          className={cn(
            "min-h-0 overflow-hidden rounded-xl transition-colors duration-[var(--motion-duration-normal)]",
          )}
        >
          {hasVisibleActivityNote && !isEditingNote ? (
            <div className={cn("compact-card-note-row group items-start text-left", noteRowClass)}>
              <button
                type="button"
                className="compact-card-note-main flex min-w-0 flex-1 items-start gap-2 text-left"
                onClick={handleSavedNoteClick}
                onDoubleClick={!readOnlyNote ? handleSavedNoteDoubleClick : undefined}
                aria-label="Open activity note"
              >
                {noteAvatar}
                <span
                  ref={notePreviewRef}
                  className={cn(
                    "compact-card-note-preview type-body-2 mt-2 min-w-0 flex-1 text-content overflow-hidden transition-[max-height] duration-[var(--motion-duration-normal)] ease-[var(--motion-ease-standard)] motion-reduce:transition-none",
                    // Keep wrapped content during collapse; it switches to a
                    // truncated one-line preview after the height transition ends.
                    isNotePreviewExpanded
                      ? "whitespace-pre-wrap break-words"
                      : "max-h-5 truncate",
                  )}
                  style={{ maxHeight: notePreviewMaxHeight }}
                  onTransitionEnd={handleNotePreviewTransitionEnd}
                >
                  {notePreview}
                </span>
              </button>
              {!readOnlyNote && (onQuickNoteSubmit || onQuickNoteRemove) && (
                <Menu>
                  <MenuTrigger
                    className="compact-card-note-menu-trigger flex size-9 shrink-0 items-center justify-center rounded-lg opacity-0 transition-opacity group-hover:opacity-100 data-[popup-open]:opacity-100 hover:bg-surface-muted-hover"
                    aria-label="Note options"
                    disabled={quickNoteRemoving}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="size-4 text-content-tertiary" aria-hidden="true" />
                  </MenuTrigger>
                  <MenuContent side="bottom" align="end" sideOffset={4} className="compact-card-note-menu">
                    {onQuickNoteSubmit && (
                      <MenuItem
                        size="md"
                        icon="leading"
                        leadingIcon={<Pencil className="size-3.5" />}
                        onClick={handleQuickNoteEdit}
                      >
                        Edit
                      </MenuItem>
                    )}
                    {onQuickNoteRemove && (
                      <MenuItem
                        size="md"
                        variant="destructive"
                        icon="leading"
                        leadingIcon={<Trash2 className="size-3.5" />}
                        onClick={handleQuickNoteRemove}
                      >
                        Remove
                      </MenuItem>
                    )}
                  </MenuContent>
                </Menu>
              )}
            </div>
          ) : onQuickNoteSubmit ? (
            <form
              className={cn("compact-card-note-row items-start", noteRowClass)}
              onSubmit={(e) => e.preventDefault()}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="mt-1.5 shrink-0">{noteAvatar}</div>
              <textarea
                ref={quickNoteInputRef}
                rows={1}
                value={quickNoteDraft}
                onChange={(e) => setQuickNoteDraft(e.target.value)}
                onKeyDown={(e) => {
                  // Enter submits; Shift+Enter inserts a newline. Skip while an
                  // IME composition is active so Enter can commit candidates.
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    void saveQuickNote().catch(() => undefined);
                  }
                }}
                placeholder="Add a quick note"
                className="compact-card-note-input type-body-2 mt-0 max-h-24 min-w-0 flex-1 resize-none overflow-y-auto rounded-xl border border-edge bg-surface px-3 py-3 text-content outline-none placeholder:text-content-placeholder transition-[border-color] duration-[var(--motion-control-duration)] ease-[var(--motion-ease-standard)] focus:border-edge-strong"
                disabled={quickNoteSaving}
                aria-label="Add a quick note"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="only"
                onClick={handleQuickNoteSubmit}
                disabled={!quickNoteDraft.trim() || quickNoteSaving}
                aria-label="Send quick note"
                className="compact-card-note-send-button mt-1 shrink-0"
              >
                <SendHorizontal className="size-4" aria-hidden="true" />
              </Button>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

CompactActivityCard.displayName = "CompactActivityCard";

export { CompactActivityCard };
