"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Globe, MapPin, CalendarRange, Activity, Loader2, Clock } from "lucide-react";
import { Button } from "@/components/ui/primitives/Button";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { DataPill } from "@/components/ui/primitives/DataPill";
import { cn } from "@/lib/utils";
import { getPublicItinerary, type PublicItinerary } from "@/lib/api/itineraries";
import { getFriendlyApiError } from "@/lib/errors/userMessages";

function formatDate(dateStr?: string) {
  if (!dateStr) return null;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(timeStr?: string) {
  if (!timeStr) return null;
  const [h, m] = timeStr.split(":");
  const hour = parseInt(h, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const display = hour % 12 || 12;
  return `${display}:${m} ${ampm}`;
}

export default function PublicItineraryPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [itinerary, setItinerary] = useState<PublicItinerary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getPublicItinerary(token)
      .then((data) => {
        setItinerary(data);
      })
      .catch((err) => {
        console.error("Failed to load public itinerary:", err);
        setError(getFriendlyApiError(err, "We couldn’t load this itinerary. The link may be invalid or no longer shared."));
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="public-itinerary-loading min-h-screen bg-surface flex items-center justify-center">
        <Loader2 className="size-6 animate-spin text-content-secondary" />
      </div>
    );
  }

  if (error || !itinerary) {
    return (
      <div className="public-itinerary-error min-h-screen bg-surface flex flex-col items-center justify-center gap-2 p-3">
        <p className="type-body-1 text-content-secondary">{error || "We couldn’t load this itinerary."}</p>
        <Button variant="ghost" onClick={() => router.push("/")}>Go home</Button>
      </div>
    );
  }

  const location = [itinerary.region, itinerary.country].filter(Boolean).join(", ");
  const dateLabel = itinerary.start_date && itinerary.end_date
    ? `${formatDate(itinerary.start_date)} – ${formatDate(itinerary.end_date)}`
    : null;

  return (
    <div className="public-itinerary-page min-h-screen bg-surface">
      {/* Public banner */}
      <div className="public-banner flex items-center justify-center gap-2 bg-surface-muted/50 border-b border-edge py-2 px-3">
        <Globe className="size-3.5 text-content-secondary" />
        <span className="type-body-2 text-content-secondary">
          You&apos;re viewing a public itinerary
        </span>
        <button
          type="button"
          className="public-banner-cta type-body-2 text-content underline-offset-2 hover:underline"
          onClick={() => router.push("/login")}
        >
          Sign in to plan your own
        </button>
      </div>

      <div className="public-itinerary-content max-w-2xl mx-auto px-3 py-8 flex flex-col gap-8">
        {/* Header */}
        <div className="public-itinerary-header flex flex-col gap-3">
          <div className="public-itinerary-title-row flex items-start gap-2">
            <div className="public-itinerary-icon mt-0.5">
              <CategoryBadge category="itinerary" />
            </div>
            <div className="flex flex-col gap-1 min-w-0">
              <h1 className="type-h1 font-secondary font-semibold text-glyph">
                {itinerary.name}
              </h1>
              {location && (
                <div className="public-itinerary-location flex items-center gap-1.5 text-content-secondary">
                  <MapPin className="size-3.5 shrink-0" />
                  <span className="type-body-2">{location}</span>
                </div>
              )}
            </div>
          </div>

          <div className="public-itinerary-meta flex flex-wrap gap-2">
            {dateLabel && (
              <DataPill
                icon={<CalendarRange className="size-3.5" />}
                label={dateLabel}
                leading="icon"
              />
            )}
            <DataPill
              icon={<CalendarRange className="size-3.5" />}
              data={itinerary.total_days}
              label={itinerary.total_days === 1 ? "day" : "days"}
              leading="icon"
            />
            <DataPill
              icon={<Activity className="size-3.5" />}
              data={itinerary.total_activities}
              label={itinerary.total_activities === 1 ? "activity" : "activities"}
              leading="icon"
            />
          </div>

          {itinerary.overview && (
            <p className="type-body-1 text-content-secondary">{itinerary.overview}</p>
          )}
        </div>

        {/* Days */}
        {itinerary.days.length > 0 && (
          <div className="public-itinerary-days flex flex-col gap-6">
            {itinerary.days.map((day) => (
              <div key={day.id} className="public-itinerary-day flex flex-col gap-2">
                <div className="public-day-header flex items-center gap-2">
                  <div className="public-day-number flex items-center justify-center size-7 rounded-full bg-surface-muted text-content-secondary type-body-2 font-medium shrink-0">
                    {day.day_index + 1}
                  </div>
                  <div className="flex flex-col">
                    <span className="type-body-1 font-medium text-glyph">
                      Day {day.day_index + 1}
                      {day.area_name ? ` · ${day.area_name}` : ""}
                    </span>
                    {day.date && (
                      <span className="type-body-2 text-content-secondary">
                        {formatDate(day.date)}
                      </span>
                    )}
                  </div>
                </div>

                {day.itinerary_activities.length === 0 ? (
                  <p className="type-body-2 text-content-secondary pl-10">No activities planned.</p>
                ) : (
                  <div className="public-activity-list flex flex-col gap-2 pl-10">
                    {day.itinerary_activities.map((activity) => (
                      <div
                        key={activity.id}
                        className={cn(
                          "public-activity-item flex items-center gap-2 rounded-xl p-2",
                          "bg-surface-alt border border-edge",
                        )}
                      >
                        {activity.photo_url ? (
                          <img
                            src={activity.photo_url}
                            alt=""
                            className="public-activity-photo size-10 rounded-lg object-cover shrink-0"
                          />
                        ) : (
                          <div className="public-activity-placeholder size-10 rounded-lg bg-surface-muted shrink-0" />
                        )}
                        <div className="flex flex-col min-w-0 gap-0.5">
                          <span className="type-body-2 font-medium text-glyph truncate">
                            {activity.name}
                          </span>
                          {activity.start_time && (
                            <div className="flex items-center gap-1 text-content-secondary">
                              <Clock className="size-3" />
                              <span className="type-body-3">
                                {formatTime(activity.start_time)}
                                {activity.end_time ? ` – ${formatTime(activity.end_time)}` : ""}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer CTA */}
        <div className="public-itinerary-footer flex flex-col items-center gap-2 py-6 border-t border-edge">
          <span className="type-body-2 text-content-secondary">Plan your own trip with Argo</span>
          <Button onClick={() => router.push("/login")} className="public-cta-button">
            Get started for free
          </Button>
        </div>
      </div>
    </div>
  );
}
