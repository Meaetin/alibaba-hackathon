import { parseTimeMins, isRealActivity } from "../activity-utils";
import type { TransportMode } from "./constants";
import type { ItineraryActivityDetail } from "@/lib/supabase/queries/home";

export interface LodgingInfo {
  name: string;
  locationId?: string;
  latitude?: number;
  longitude?: number;
  checkInTime?: string;
  checkOutTime?: string;
}

export interface ActivityItem {
  type: "activity";
  id: string;
  activity: ItineraryActivityDetail;
  startMin: number;
  endMin: number;
  pushed: boolean;
}

export interface TransportItem {
  type: "transport";
  id: string;
  fromName: string;
  toName: string;
  mode: TransportMode;
  durationSeconds: number;
  distanceKm: number;
  hidden: boolean;
  startMin: number;
  endMin: number;
  isConflict: boolean;
}

export type DaySequenceItem =
  | ActivityItem
  | TransportItem;

interface PositionedItem {
  id: string;
  startMin: number;
  endMin: number;
  lat: number | null;
  lng: number | null;
  locationName: string;
  activity?: ItineraryActivityDetail;
}

function getActivityEndMin(a: ItineraryActivityDetail, startMin: number): number {
  if (a.end_time) return parseTimeMins(a.end_time);
  if (a.travel_duration_seconds) return startMin + Math.round(a.travel_duration_seconds / 60);
  // No end_time and no travel duration → single-point activity (e.g. lodging
  // check-in/check-out). Zero duration so it doesn't synthesize a phantom block.
  return startMin;
}

export interface BuildDaySequenceConfig {
  activities: ItineraryActivityDetail[];
  accommodation: LodgingInfo | null;
  transportModes: Record<string, TransportMode>;
  hiddenTransports: Set<string>;
  globalStartMin: number;
  globalEndMin: number;
}

export function buildDaySequence(config: BuildDaySequenceConfig): DaySequenceItem[] {
  const {
    activities,
    transportModes,
    hiddenTransports,
    globalStartMin,
  } = config;

  const realActivities = activities
    .filter((a) => isRealActivity(a) && a.start_time)
    .sort((a, b) => parseTimeMins(a.start_time!) - parseTimeMins(b.start_time!));

  const positioned: PositionedItem[] = [];

  for (const a of realActivities) {
    const startMin = parseTimeMins(a.start_time!);
    const endMin = getActivityEndMin(a, startMin);
    positioned.push({
      id: a.id,
      startMin,
      endMin,
      lat: a.location?.latitude ?? null,
      lng: a.location?.longitude ?? null,
      locationName: a.location?.name ?? a.name,
      activity: a,
    });
  }

  positioned.sort((a, b) => a.startMin - b.startMin);

  const sequence: DaySequenceItem[] = [];

  for (let i = 0; i < positioned.length; i++) {
    const item = positioned[i];
    const prev = i > 0 ? positioned[i - 1] : null;

    let transportDuration = 0;
    let transportId: string | null = null;
    let transportDistanceKm = 0;

    if (prev && prev.lat != null && prev.lng != null && item.lat != null && item.lng != null) {
      // Only emit transport legs when the previous row has real Google Routes
      // data on it (travel_* fields on row i describe the leg from activity i
      // to activity i+1). No synthetic/mocked fallback — the backend's
      // recalculateRouteLegs cascade fills these asynchronously, and until it
      // does we simply render no leg rather than invent one.
      const dbDistanceMeters = prev.activity?.travel_distance_meters;
      const dbDurationSeconds = prev.activity?.travel_duration_seconds;
      if (
        dbDistanceMeters != null &&
        dbDistanceMeters > 0 &&
        dbDurationSeconds != null &&
        dbDurationSeconds > 0
      ) {
        transportId = `transport-${prev.id}-${item.id}`;
        transportDistanceKm = Math.round((dbDistanceMeters / 1000) * 10) / 10;
        transportDuration = Math.max(1, Math.round(dbDurationSeconds / 60));
      }
    }

    const prevEndMin = prev ? prev.endMin : globalStartMin;

    if (transportId && transportDuration > 0) {
      const hidden = hiddenTransports.has(transportId);
      // travel_mode lives on the row the leg DEPARTS (`prev`). The ephemeral
      // transportModes overlay only wins while a switch is still in flight.
      const mode =
        (prev ? transportModes[prev.id] : undefined) ??
        prev?.activity?.travel_mode ??
        "drive";
      const tStartMin = prevEndMin;
      const tEndMin = tStartMin + transportDuration;

      // Hidden transports render nothing. A visible leg either departs just in
      // time (any slack stays at the origin, unrendered) or, when it's longer
      // than the gap, renders as a conflict overlapping the destination. A
      // zero-gap leg (prev ends exactly when the next starts) with any travel
      // time can never fit, so `<=` lets it surface as a conflict too.
      if (tStartMin <= item.startMin && !hidden) {
        const freeAfterTransport = item.startMin - tEndMin;
        if (freeAfterTransport >= 0) {
          sequence.push({
            type: "transport",
            id: transportId,
            fromName: prev!.locationName,
            toName: item.locationName,
            mode,
            durationSeconds: transportDuration * 60,
            distanceKm: transportDistanceKm,
            hidden,
            startMin: item.startMin - transportDuration,
            endMin: item.startMin,
            isConflict: false,
          });
        } else {
          sequence.push({
            type: "transport",
            id: transportId,
            fromName: prev!.locationName,
            toName: item.locationName,
            mode,
            durationSeconds: transportDuration * 60,
            distanceKm: transportDistanceKm,
            hidden,
            startMin: tStartMin,
            endMin: tEndMin,
            isConflict: true,
          });
        }
      }
    }

    if (item.activity) {
      sequence.push({
        type: "activity",
        id: item.id,
        activity: item.activity,
        startMin: item.startMin,
        endMin: item.endMin,
        pushed: false,
      });
    }

  }

  return sequence;
}

