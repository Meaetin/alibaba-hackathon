import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { timeToHour, parseLocalDate } from "@/lib/utils/itinerary";
import { formatLodgingDate, formatTimeOfDay } from "@/lib/utils/formatters";
import { mapExtractedFlightToCardProps } from "@/lib/utils/flightCard";
import type { CalendarDay } from "@/components/ui/calendar/ItineraryCalendar";
import type { CalendarActivity } from "@/components/ui/calendar/ActivityTimeslot";
import type { ItineraryDetail, ItineraryDayDetail, ItineraryActivityDetail, ActivityLocation } from "@/lib/supabase/queries/home";
import type { FlightCardProps } from "@/components/ui/detail-views/FlightCard";
import type { LodgingCardProps } from "@/components/ui/detail-views/LodgingCard";
import type { ExtractedFlight } from "@/lib/api/flights";
import type { ExtractedLodging } from "@/lib/api/lodgings";
import type { TransportMode } from "@/components/ui/itinerary/ItineraryDayColumn/constants";
import React from "react";

interface UseItineraryRealtimeParams {
  itineraryId: string | undefined;
  itineraryRef: React.RefObject<ItineraryDetail | null>;
  setCalendarDays: React.Dispatch<React.SetStateAction<CalendarDay[]>>;
  setItinerary: React.Dispatch<React.SetStateAction<ItineraryDetail | null>>;
  showFlightSidebar: boolean;
  setFlights: React.Dispatch<React.SetStateAction<FlightCardProps[]>>;
  showLodgingSidebar: boolean;
  setLodgings: React.Dispatch<React.SetStateAction<LodgingCardProps[]>>;
}

export function useItineraryRealtime({
  itineraryId,
  itineraryRef,
  setCalendarDays,
  setItinerary,
  showFlightSidebar,
  setFlights,
  showLodgingSidebar,
  setLodgings,
}: UseItineraryRealtimeParams) {
  const activitiesChannelRef = useRef<ReturnType<ReturnType<typeof createClient>["channel"]> | null>(null);

  // Realtime: itinerary_activities (INSERT / UPDATE / DELETE)
  useEffect(() => {
    if (!itineraryId) return;
    const supabase = createClient();

    // Activity rows reference a location via location_id. After an INSERT echo
    // arrives we don't yet have the joined location object that getItineraryDetail
    // returns on a hard refresh, so the view-mode card renders without its
    // thumbnail/address. Fetch the locations row asynchronously and patch the
    // activity once we have it. Best-effort: failure leaves the activity in
    // place with location: null (same as before the patch).
    const hydrateActivityLocation = async (activityId: string, dayId: string, locationId: string) => {
      // Keep this projection in sync with the `locations(...)` select in
      // `getItineraryDetail()` (home.ts) — the PlaceDetailsBlock reads all of
      // these fields and a missing column on the realtime hydration shows up
      // as silently-dropped UI rows.
      const { data: loc, error: locErr } = await supabase
        .from('locations')
        .select(
          'id, name, latitude, longitude, photo_urls, formatted_address, ' +
          'google_maps_uri, google_maps_links, location_context, regular_opening_hours, ' +
          'stay_duration, rating, user_rating_count, price_range, primary_type, ' +
          'categories, business_status, website_uri, ' +
          'international_phone_number, national_phone_number, photos'
        )
        .eq('id', locationId)
        .single();
      if (locErr || !loc) {
        console.warn('Failed to hydrate activity location:', locErr);
        return;
      }
      const location = loc as unknown as ActivityLocation;
      setItinerary((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          days: prev.days.map((day) =>
            day.id !== dayId
              ? day
              : {
                  ...day,
                  activities: day.activities.map((a) =>
                    a.id !== activityId ? a : { ...a, location }
                  ),
                },
          ),
        };
      });
    };

    const channel = supabase
      .channel(`itinerary-activities-${itineraryId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'itinerary_activities', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const row = payload.new as {
            id: string; day_id: string; name: string;
            start_time: string | null; end_time: string | null;
            category: string | null; meal_type: string | null; photo_url: string | null;
            latitude: number | null; longitude: number | null; place_id: string | null;
            location_id: string | null; correlation_id: string | null;
            source_flight_id: string | null; source_lodging_id: string | null;
            flight_depart_time: string | null; flight_arrive_time: string | null;
          };
          setCalendarDays((prev) => {
            const dayIndex = prev.findIndex((d) => d.id === row.day_id);
            if (dayIndex === -1) return prev;
            if (prev[dayIndex].activities.some((a) => a.id === row.id)) return prev;
            const timezone = itineraryRef.current?.timezone ?? undefined;
            const newActivity: CalendarActivity = {
              id: row.id,
              dayId: row.day_id,
              dayIndex,
              name: row.name,
              startHour: timeToHour(row.start_time, timezone),
              endHour: timeToHour(row.end_time, timezone),
              category: (row.category === 'meal' ? 'meal' : row.category === 'flight' ? 'flight' : 'poi') as 'poi' | 'meal' | 'flight',
              photoUrl: row.photo_url ?? undefined,
              placeId: row.place_id ?? undefined,
              latitude: row.latitude ?? undefined,
              longitude: row.longitude ?? undefined,
            };
            return prev.map((day) =>
              day.id === row.day_id
                ? { ...day, activities: [...day.activities, newActivity] }
                : day
            );
          });

          // Mirror into itinerary.days so view-mode (which reads itinerary.days,
          // not calendarDays) stays in sync with backend-persisted activities.
          setItinerary((prev) => {
            if (!prev) return prev;
            const dayIndex = prev.days.findIndex((d) => d.id === row.day_id);
            if (dayIndex === -1) return prev;
            if (prev.days[dayIndex].activities.some((a) => a.id === row.id)) return prev;
            const newActivity: ItineraryActivityDetail = {
              id: row.id,
              day_id: row.day_id,
              day_index: dayIndex,
              name: row.name,
              start_time: row.start_time,
              end_time: row.end_time,
              category: row.category ?? 'poi',
              meal_type: row.meal_type ?? null,
              place_id: row.place_id ?? null,
              correlation_id: row.correlation_id ?? null,
              location_id: row.location_id ?? null,
              photo_url: row.photo_url ?? null,
              source_flight_id: row.source_flight_id ?? null,
              source_lodging_id: row.source_lodging_id ?? null,
              flight_depart_time: row.flight_depart_time ?? null,
              flight_arrive_time: row.flight_arrive_time ?? null,
              location: null,
            };
            return {
              ...prev,
              days: prev.days.map((day) =>
                day.id === row.day_id
                  ? { ...day, activities: [...day.activities, newActivity] }
                  : day
              ),
            };
          });

          if (row.location_id) {
            void hydrateActivityLocation(row.id, row.day_id, row.location_id);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'itinerary_activities', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const row = payload.new as {
            id: string;
            day_id: string;
            start_time: string | null;
            end_time: string | null;
            travel_polyline: string | null;
            travel_distance_meters: number | null;
            travel_duration_seconds: number | null;
            travel_mode: TransportMode | null;
            position: number | null;
          };
          const timezone = itineraryRef.current?.timezone ?? undefined;
          const newStartHour = timeToHour(row.start_time, timezone);
          const newEndHour = timeToHour(row.end_time, timezone);
          setCalendarDays((prev) => {
            const targetDayIndex = prev.findIndex((d) => d.id === row.day_id);
            const current = prev
              .flatMap((day) => day.activities)
              .find((a) => a.id === row.id);
            if (!current) return prev;

            const updated: CalendarActivity = {
              ...current,
              dayId: row.day_id,
              dayIndex: targetDayIndex === -1 ? current.dayIndex : targetDayIndex,
              startHour: newStartHour,
              endHour: newEndHour,
              travelPolyline: row.travel_polyline ?? undefined,
              travelDistanceMeters: row.travel_distance_meters ?? undefined,
              travelDurationSeconds: row.travel_duration_seconds ?? undefined,
            };

            // Same day → replace in place. Rebuilding as filter-then-append moved
            // the row to the end of the array, which silently renumbered the map's
            // stop pins (they are numbered in array order) on any update that
            // didn't change times — a mode switch, for instance.
            if (current.dayId === row.day_id) {
              return prev.map((day) =>
                day.id === row.day_id
                  ? {
                      ...day,
                      activities: day.activities.map((a) => (a.id === row.id ? updated : a)),
                    }
                  : day,
              );
            }

            // Cross-day move: it genuinely has to leave one day and join another.
            return prev.map((day) => {
              if (day.id === current.dayId) {
                return { ...day, activities: day.activities.filter((a) => a.id !== row.id) };
              }
              if (day.id === row.day_id) {
                return { ...day, activities: [...day.activities, updated] };
              }
              return day;
            });
          });

          // Mirror update into itinerary.days for view mode.
          setItinerary((prev) => {
            if (!prev) return prev;
            const targetDayIndex = prev.days.findIndex((d) => d.id === row.day_id);
            const current = prev.days
              .flatMap((day) => day.activities)
              .find((a) => a.id === row.id);
            if (!current) return prev;

            const updated: ItineraryActivityDetail = {
              ...current,
              day_id: row.day_id,
              day_index: targetDayIndex === -1 ? current.day_index : targetDayIndex,
              start_time: row.start_time,
              end_time: row.end_time,
              travel_polyline: row.travel_polyline ?? null,
              travel_distance_meters: row.travel_distance_meters ?? null,
              travel_duration_seconds: row.travel_duration_seconds ?? null,
              travel_mode: row.travel_mode ?? null,
              // Order is data, not array placement (migration 122 / ADR 0007).
              // Dropping this let a reorder's own echo hand back the row with its
              // pre-drag ordinal, which then re-sorted the card straight back.
              position: row.position ?? current.position ?? null,
            };

            // Same day → replace in place (see the calendarDays branch above for
            // why appending was wrong).
            if (current.day_id === row.day_id) {
              return {
                ...prev,
                days: prev.days.map((day) =>
                  day.id === row.day_id
                    ? {
                        ...day,
                        activities: day.activities.map((a) => (a.id === row.id ? updated : a)),
                      }
                    : day,
                ),
              };
            }

            return {
              ...prev,
              days: prev.days.map((day) => {
                if (day.id === current.day_id) {
                  return { ...day, activities: day.activities.filter((a) => a.id !== row.id) };
                }
                if (day.id === row.day_id) {
                  return { ...day, activities: [...day.activities, updated] };
                }
                return day;
              }),
            };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'itinerary_activities', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const row = payload.old as { id: string };
          setCalendarDays((prev) =>
            prev.map((day) => ({
              ...day,
              activities: day.activities.filter((a) => a.id !== row.id),
            }))
          );
          setItinerary((prev) =>
            prev
              ? {
                  ...prev,
                  days: prev.days.map((day) => ({
                    ...day,
                    activities: day.activities.filter((a) => a.id !== row.id),
                  })),
                }
              : prev
          );
        }
      )
      .on('broadcast', { event: 'activity_added' }, ({ payload }) => {
        const a = payload as CalendarActivity;
        setCalendarDays((prev) => {
          const dayIndex = prev.findIndex((d) => d.id === a.dayId);
          if (dayIndex === -1) return prev;
          if (prev[dayIndex].activities.some((x) => x.id === a.id)) return prev;
          return prev.map((day) =>
            day.id === a.dayId
              ? { ...day, activities: [...day.activities, { ...a, dayIndex }] }
              : day
          );
        });
      })
      .subscribe();

    activitiesChannelRef.current = channel;
    return () => {
      activitiesChannelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [itineraryId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime: itinerary_days (INSERT / DELETE) — syncs date range changes from collaborators
  useEffect(() => {
    if (!itineraryId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`itinerary-days-${itineraryId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'itinerary_days', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const row = payload.new as { id: string; date: string; day_index?: number; area_name?: string | null; timezone?: string | null };
          setCalendarDays((prev) => {
            if (prev.some((d) => d.id === row.id)) return prev;
            const newDay = { id: row.id, date: parseLocalDate(row.date), activities: [] };
            return [...prev, newDay].sort((a, b) => a.date.getTime() - b.date.getTime());
          });

          // Mirror into itinerary.days so view mode sees newly-created days
          // (e.g. when a flight's depart/arrive date falls outside the current range).
          setItinerary((prev) => {
            if (!prev) return prev;
            if (prev.days.some((d) => d.id === row.id)) return prev;
            const newDay: ItineraryDayDetail = {
              id: row.id,
              date: row.date,
              day_index: row.day_index ?? prev.days.length,
              area_name: row.area_name ?? null,
              timezone: row.timezone ?? null,
              activities: [],
            };
            const merged = [...prev.days, newDay].sort(
              (a, b) => parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime(),
            );
            return { ...prev, days: merged };
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'itinerary_days', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const row = payload.old as { id: string };
          setCalendarDays((prev) => prev.filter((d) => d.id !== row.id));
          setItinerary((prev) =>
            prev ? { ...prev, days: prev.days.filter((d) => d.id !== row.id) } : prev,
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [itineraryId]);

  // Realtime: itineraries — syncs name, country, spot count from collaborator edits
  useEffect(() => {
    if (!itineraryId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`itinerary-meta-${itineraryId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'itineraries', filter: `id=eq.${itineraryId}` },
        (payload) => {
          const row = payload.new as Partial<ItineraryDetail>;
          setItinerary((prev) => (prev ? { ...prev, ...row } : prev));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [itineraryId]);

  // Realtime: user_itinerary — syncs collaborator joins/leaves (updates avatar group + traveller count)
  useEffect(() => {
    if (!itineraryId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`itinerary-members-${itineraryId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_itinerary', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const row = payload.new as { user_id: string; role: string };
          setItinerary((prev) =>
            prev
              ? { ...prev, collaborators: [...prev.collaborators, { user_id: row.user_id, role: row.role }] }
              : prev
          );
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'user_itinerary', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const row = payload.old as { user_id: string };
          setItinerary((prev) =>
            prev
              ? { ...prev, collaborators: prev.collaborators.filter((c) => c.user_id !== row.user_id) }
              : prev
          );
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [itineraryId]);

  // Realtime: itinerary_flights — syncs flight cards while the sidebar is open
  useEffect(() => {
    if (!showFlightSidebar || !itineraryId) return;
    const supabase = createClient();
    const mapFlight = mapExtractedFlightToCardProps;
    const channel = supabase
      .channel(`itinerary-flights-${itineraryId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'itinerary_flights', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          setFlights((prev) => {
            const f = payload.new as ExtractedFlight;
            if (prev.some((c) => c.id === f.id)) return prev;
            return [...prev, mapFlight(f)];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'itinerary_flights', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const f = payload.new as ExtractedFlight;
          setFlights((prev) => prev.map((c) => (c.id === f.id ? mapFlight(f) : c)));
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'itinerary_flights', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const row = payload.old as { id: string };
          setFlights((prev) => prev.filter((c) => c.id !== row.id));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [showFlightSidebar, itineraryId]);

  // Realtime: itinerary_lodgings — syncs lodging cards while the sidebar is open
  useEffect(() => {
    if (!showLodgingSidebar || !itineraryId) return;
    const supabase = createClient();
    const mapLodging = (l: ExtractedLodging): LodgingCardProps => ({
      id: l.id,
      image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800",
      address: l.address ?? "",
      name: l.name ?? "",
      confirmation: l.confirmation ?? "",
      cost: l.cost != null ? `${l.currency ?? ""}${l.cost}`.trim() : "",
      checkIn: formatLodgingDate(l.check_in_date),
      checkInTime: formatTimeOfDay(l.check_in_time),
      checkOut: formatLodgingDate(l.check_out_date),
      checkOutTime: formatTimeOfDay(l.check_out_time),
      sourceAttachmentId: l.source_attachment_id ?? null,
    });
    const channel = supabase
      .channel(`itinerary-lodgings-${itineraryId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'itinerary_lodgings', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          setLodgings((prev) => {
            const l = payload.new as ExtractedLodging;
            if (prev.some((c) => c.id === l.id)) return prev;
            return [...prev, mapLodging(l)];
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'itinerary_lodgings', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const l = payload.new as ExtractedLodging;
          setLodgings((prev) => prev.map((c) => (c.id === l.id ? mapLodging(l) : c)));
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'itinerary_lodgings', filter: `itinerary_id=eq.${itineraryId}` },
        (payload) => {
          const row = payload.old as { id: string };
          setLodgings((prev) => prev.filter((c) => c.id !== row.id));
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [showLodgingSidebar, itineraryId]);

  return { activitiesChannelRef };
}
