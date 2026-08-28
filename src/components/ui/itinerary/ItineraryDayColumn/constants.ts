export const INSET_PX = 32;

/** Mirrors `itinerary_activities.travel_mode` so the client and DB share one vocabulary. */
/** Re-exported so the display type and the stored type are the same type.
 *  `transit` is what the planner produces for any leg over `WALK_MAX_METERS` —
 *  a third mode, not a synonym for driving, since a Singapore MRT hop shown as
 *  a car is a different trip. */
export type { ActivityTravelMode as TransportMode } from "@/lib/db/itinerary-detail";
