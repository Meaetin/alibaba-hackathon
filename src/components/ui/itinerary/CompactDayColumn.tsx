"use client";

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { formatDayDate, parseTimeMins } from "./activity-utils";
import { CompactActivityCard, getActivityCardLayout } from "./CompactActivityCard";
import { TransportDetailRow } from "./TransportDetailRow";
import type { ItineraryDayDetail, ItineraryActivityDetail } from "@/lib/supabase/queries/home";

interface CompactDayColumnProps {
  day: ItineraryDayDetail;
  dayIndex: number;
  timezone?: string;
  onActivityClick?: (activity: ItineraryActivityDetail) => void;
  activityNotePreviews?: Map<string, string>;
  className?: string;
}

function isTransportActivity(activity: ItineraryActivityDetail): boolean {
  const cat = activity.category?.toLowerCase() ?? "";
  return cat === "transportation" || cat === "transport" || cat === "travel";
}

function hasTransportData(activity: ItineraryActivityDetail): boolean {
  return (
    (activity.travel_distance_meters != null && activity.travel_distance_meters > 0) ||
    (activity.travel_duration_seconds != null && activity.travel_duration_seconds > 0)
  );
}

function CompactDayColumn({
  day,
  dayIndex,
  timezone,
  onActivityClick,
  activityNotePreviews,
  className,
}: CompactDayColumnProps) {
  const dateLabel = useMemo(() => {
    try {
      return formatDayDate(day.date);
    } catch {
      return `Day ${dayIndex + 1}`;
    }
  }, [day.date, dayIndex]);

  const sortedActivities = useMemo(() => {
    return [...day.activities]
      .filter((a) => !isTransportActivity(a))
      .sort((a, b) => {
        if (!a.start_time && !b.start_time) return 0;
        if (!a.start_time) return 1;
        if (!b.start_time) return -1;
        return parseTimeMins(a.start_time) - parseTimeMins(b.start_time);
      });
  }, [day.activities]);

  return (
    <div
      data-slot="compact-day-column"
      data-region="itinerary-detail-day-column"
      className={cn(
        // Width is set by the parent `.day-board` (responsive cqw fraction).
        // The 280px floor starts at sm; narrower phones use the full viewport.
        "compact-day-column min-w-0 flex flex-col gap-3 rounded-2xl border border-edge-subtle bg-surface-alt p-3 sm:min-w-[280px]",
        className,
      )}
    >
      {/* Day Header */}
      <div data-region="itinerary-detail-day-header" className="compact-day-header px-1">
        <span className="compact-day-header-text type-body-1 type-secondary font-semibold text-content">
          {dateLabel}
        </span>
      </div>

      {/* Activities */}
      <div className="compact-day-activities flex flex-col gap-2">
        {sortedActivities.length === 0 ? (
          <div className="compact-day-empty flex items-center justify-center py-6 text-content-secondary type-body-2">
            No activities planned
          </div>
        ) : (
          sortedActivities.map((activity, i) => {
            const layout = getActivityCardLayout(activity);
            // travel_* on a row describes the leg from that activity to the
            // next one, so the leg arriving at activity[i] lives on the
            // previous row.
            const prevActivity = i > 0 ? sortedActivities[i - 1] : null;
            const showTransportBefore =
              prevActivity != null &&
              hasTransportData(prevActivity);

            return (
              <div key={activity.id} data-activity-id={activity.id} className="compact-day-activity-item flex flex-col gap-2">
                {showTransportBefore && (
                  <TransportDetailRow
                    distanceMeters={prevActivity.travel_distance_meters ?? null}
                    durationSeconds={prevActivity.travel_duration_seconds ?? null}
                    transportMode={prevActivity.travel_mode ?? "drive"}
                  />
                )}
                <CompactActivityCard
                  activity={activity}
                  layout={layout}
                  timezone={timezone}
                  dayDate={day.date}
                  activityNotePreview={activityNotePreviews?.get(activity.id) ?? null}
                  readOnlyNote
                  onClick={onActivityClick ? () => onActivityClick(activity) : undefined}
                  className={
                    onActivityClick ? undefined : "cursor-default"
                  }
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

CompactDayColumn.displayName = "CompactDayColumn";

export { CompactDayColumn };
export type { CompactDayColumnProps };
