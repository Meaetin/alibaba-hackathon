import { authFetch, unwrap, ensureOk } from './client'
import { type Surface } from '@/lib/domain-types'
import type { PlaceDetailsPayload } from '@/lib/maps/place-search'
import type { ActivityLocation } from '@/lib/supabase/queries/home'

export interface ItineraryWithRole {
  id: string
  name: string
  overview?: string
  country?: string
  region?: string
  latitude?: number
  longitude?: number
  start_date?: string
  end_date?: string
  total_days: number
  total_activities: number
  collection_id: string
  user_role: 'owner' | 'collaborator'
  is_bookmarked: boolean
  is_archived: boolean
  is_public: boolean
  public_token?: string | null
  invite_token?: string | null
  invite_token_expires_at?: string | null
  thumbnail_url?: string | null
  created_at: string
  updated_at: string
}

export interface Itinerary {
  id: string
  owner_id: string
  name: string
  overview?: string
  country: string
  region?: string
  latitude?: number
  longitude?: number
  start_date: string
  end_date: string
  total_days: number
  total_activities: number
  is_public: boolean
  public_token?: string
  invite_token?: string
  invite_token_expires_at?: string
  thumbnail_url?: string
  created_at: string
  updated_at: string
}

export async function getItineraries(): Promise<ItineraryWithRole[]> {
  const res = await authFetch('/api/itineraries')
  return unwrap<ItineraryWithRole[]>(res, 'Failed to fetch itineraries')
}

export interface GenerateItineraryParams {
  title: string
  location_ids: string[]
  /** false → skip AI gap-fill + meal discovery; keep clustering + route optimization. Default true. */
  aiFillGaps?: boolean
  start_date: string
  total_days: number
  country: string
  region?: string
  latitude?: number
  longitude?: number
  overview?: string
  preferences?: {
    maxK?: number
    kmeansInitMethod?: 'kmeans++' | 'random' | 'grid'
    maxIterations?: number
    startTime?: string
    endTime?: string
  }
}

export interface GenerateItineraryJob {
  id: string
  user_id: string
  type: string
  status: string
  payload: Record<string, unknown>
  created_at: string
}

export class ItineraryQuotaError extends Error {
  current_count: number
  max_itineraries: number

  constructor(message: string, current_count: number, max_itineraries: number) {
    super(message)
    this.name = 'ItineraryQuotaError'
    this.current_count = current_count
    this.max_itineraries = max_itineraries
  }
}

export async function generateItinerary(params: GenerateItineraryParams): Promise<GenerateItineraryJob> {
  const res = await authFetch('/api/itineraries', {
    method: 'POST',
    body: JSON.stringify(params),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    if (res.status === 403 && data?.code === 'ITINERARY_QUOTA_EXCEEDED') {
      throw new ItineraryQuotaError(
        data.error || 'Itinerary limit reached',
        data.current_count ?? 0,
        data.max_itineraries ?? 0,
      )
    }
    throw new Error(data.error || 'Failed to generate itinerary')
  }

  return res.json()
}

export async function updateItinerary(
  id: string,
  fields: { name?: string; country?: string; region?: string | null; start_date?: string; end_date?: string; thumbnail_url?: string | null; is_bookmarked?: boolean; is_archived?: boolean }
): Promise<Itinerary> {
  const res = await authFetch(`/api/itineraries/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
  return unwrap<Itinerary>(res, 'Failed to update itinerary')
}

export interface CreateActivityPayload {
  day_id: string
  name: string
  start_time?: string
  end_time?: string
  location_id?: string
  category?: 'poi' | 'meal' | 'flight' | 'lodging_checkin' | 'lodging_checkout'
  latitude?: number
  longitude?: number
  place_id?: string
  photo_url?: string
  estimated_duration_hours?: number
  /**
   * Enterprise place data the browser already fetched during search. When present
   * (place_id + no location_id), the server persists the location from this instead
   * of re-fetching Place Details — avoiding a duplicate Enterprise-billed call.
   */
  place_details?: PlaceDetailsPayload
  /** Drag-drop path: recompute the day's legs + times server-side and return them. */
  recompute_times?: boolean
  /** Client-generated token echoed back on the realtime INSERT so the optimistic
   *  card can be matched to its persisted row regardless of name/start_time changes. */
  correlation_id?: string
  /** Slot within the day to insert at. Omit to append. The server renumbers the
   *  day around the new row, so an add into a middle gap keeps the position it was
   *  dropped at instead of jumping to the end on the next read. */
  position?: number
}

/** A day's activities after a server-side Directions cascade, ready to apply to edit state. */
export type TravelMode = 'drive' | 'walk'

export interface CascadedActivity {
  id: string
  start_time: string | null
  end_time: string | null
  travel_mode?: TravelMode
  travel_duration_seconds: number | null
  travel_distance_meters: number | null
  travel_polyline: string | null
}

export interface TravelModeResult {
  travel_mode: TravelMode
  travel_duration_seconds: number | null
  travel_distance_meters: number | null
  travel_polyline: string | null
  /** Google has no route for this pair in this mode (e.g. two stops separated by water). */
  unavailable: boolean
}

/**
 * Sets the transport mode for the leg DEPARTING `activityId` and returns that
 * mode's real duration/distance/polyline. The server does not retime the day —
 * any resulting overlap surfaces through the normal conflict detection.
 */
export async function setActivityTravelMode(
  itineraryId: string,
  activityId: string,
  mode: TravelMode,
): Promise<TravelModeResult> {
  const res = await authFetch(
    `/api/itineraries/${itineraryId}/activities/${activityId}/travel-mode`,
    { method: 'PATCH', body: JSON.stringify({ mode }) },
  )
  await ensureOk(res, 'Failed to change transport mode')
  return res.json()
}

export interface CascadeResult {
  day_id: string
  activities: CascadedActivity[]
  source_day?: { day_id: string; activities: CascadedActivity[] }
}

export interface CreatedActivity {
  id: string
  day_id: string
  itinerary_id: string
  name: string
  start_time?: string | null
  end_time?: string | null
  category?: string | null
  latitude?: number | null
  longitude?: number | null
  place_id?: string | null
  photo_url?: string | null
  location_id?: string | null
  estimated_duration_hours?: number | null
  correlation_id?: string | null
  /** Joined location row (present when the activity has a location_id), so the card
   *  can render full detail in one go after a place_id-only add was enriched server-side. */
  location?: ActivityLocation | null
  /** Present when the activity was created via the drag-drop path (recompute_times). */
  cascade?: CascadeResult
}

export async function createActivity(
  itineraryId: string,
  payload: CreateActivityPayload
): Promise<CreatedActivity> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/activities`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    const msg = Array.isArray(data.error)
      ? data.error.map((e: { message?: string }) => e.message).join(', ')
      : data.error || 'Failed to create activity'
    throw new Error(msg)
  }
  return res.json()
}

export async function deleteActivity(
  itineraryId: string,
  activityId: string,
  options?: { recompute_times?: boolean }
): Promise<CascadeResult | null> {
  // recompute_times=true makes the server recompute the day's legs after the
  // delete and return them (200); otherwise it's a fire-and-forget 204.
  const qs = options?.recompute_times ? '?recompute_times=true' : ''
  const res = await authFetch(`/api/itineraries/${itineraryId}/activities/${activityId}${qs}`, {
    method: 'DELETE',
  })
  await ensureOk(res, 'Failed to delete activity')
  if (res.status === 204) return null
  return res.json()
}

export async function moveActivity(
  itineraryId: string,
  activityId: string,
  params: {
    day_id?: string
    start_time: string
    end_time: string | null
    affected_activity_ids?: string[]
    clear_leg_ids?: string[]
    source_day_id?: string
    recompute_times?: boolean
    /** The day's full activity-id list in its post-drop order. Authoritative for
     *  ordering — the server writes `position` = array index. `start_time` is only
     *  a scheduling hint the cascade uses as a floor. */
    ordered_activity_ids?: string[]
    /** Same, for the source day on a cross-day move. */
    source_ordered_activity_ids?: string[]
  }
): Promise<CascadeResult | null> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/activities/${activityId}`, {
    method: 'PATCH',
    body: JSON.stringify(params),
  })
  await ensureOk(res, 'Failed to move activity')
  // The drag-drop path (recompute_times) returns 200 with cascaded times; plain moves are 204.
  if (res.status === 204) return null
  return res.json()
}

export interface OptimizeDayRouteResult {
  activities: Array<{ id: string; start_time: string; end_time: string }>
  dropped: Array<{ id: string; name: string }>
}

/**
 * Runs Google Route Optimization on a single day and returns a preview: the new
 * times for reordered activities and any locations that don't fit (to be dropped).
 * No changes are persisted until the caller applies them.
 */
export async function optimizeDayRoute(
  itineraryId: string,
  dayId: string,
  lockedIds: string[]
): Promise<OptimizeDayRouteResult> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/days/${dayId}/optimize-route`, {
    method: 'POST',
    body: JSON.stringify({ locked_ids: lockedIds }),
  })
  return unwrap<OptimizeDayRouteResult>(res, 'Failed to optimize route')
}

export interface PreviewLeg {
  from_activity_id: string
  to_activity_id: string
  durationSeconds: number | null
  distanceMeters: number | null
}

/**
 * Prices exact Google DRIVE travel times for a hypothetical set of activity
 * adjacencies without persisting anything. Used by deconflict to fill in legs
 * created by a reorder (e.g. 3→2) that have no stored travel time yet.
 */
export async function previewDayLegs(
  itineraryId: string,
  dayId: string,
  legs: { from_activity_id: string; to_activity_id: string }[]
): Promise<{ legs: PreviewLeg[] }> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/days/${dayId}/preview-legs`, {
    method: 'POST',
    body: JSON.stringify({ legs }),
  })
  return unwrap<{ legs: PreviewLeg[] }>(res, 'Failed to preview travel times')
}

export async function createItinerary(name: string, country: string, region?: string, latitude?: number, longitude?: number, startDate?: string, totalDays?: number, endDate?: string): Promise<Itinerary> {
  const res = await authFetch('/api/itineraries/blank', {
    method: 'POST',
    body: JSON.stringify({
      name,
      country,
      ...(region ? { region } : {}),
      ...(latitude != null ? { latitude } : {}),
      ...(longitude != null ? { longitude } : {}),
      ...(startDate ? { startDate } : {}),
      ...(totalDays ? { totalDays } : {}),
      ...(endDate ? { endDate } : {}),
    }),
  })

  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    if (res.status === 403 && data?.code === 'ITINERARY_QUOTA_EXCEEDED') {
      throw new ItineraryQuotaError(
        data.error || 'Itinerary limit reached',
        data.current_count ?? 0,
        data.max_itineraries ?? 0,
      )
    }
    throw new Error(data.error || 'Failed to create itinerary')
  }

  return res.json()
}

/**
 * Result of {@link createItineraryRouted} — discriminated so callers know which
 * post-create UX to run (navigate to a finished itinerary vs. await an async job).
 */
export type ItineraryCreateResult =
  | { kind: 'blank'; itinerary: Itinerary }
  | { kind: 'planning'; job: GenerateItineraryJob }

export interface CreateItineraryRoutedInput {
  tripName: string
  country: string
  region?: string
  latitude?: number
  longitude?: number
  startDate: string
  endDate?: string
  totalDays: number
  /** Locations the user selected before opening the modal. Empty drives the 2a/2b cases. */
  selectedLocationIds: string[]
  /** State of the "Start with AI recommendations" toggle. */
  aiRecommendations: boolean
  /** Surface the create modal was opened from, for analytics. */
  source: Surface
}

/**
 * Routes the four itinerary-creation cases to the correct endpoint:
 *
 *   | AI toggle | locations | → endpoint                        |
 *   | --------- | --------- | --------------------------------- |
 *   | off       | none      | POST /api/itineraries/blank       | (2b → { kind: 'blank' })
 *   | on        | none      | POST /api/itineraries (ids: [])   | (2a → { kind: 'planning' })
 *   | on/off    | some      | POST /api/itineraries             | (1a/1b → { kind: 'planning' })
 *
 * `aiFillGaps` mirrors the AI toggle, so the planner skips gap-fill + meals for 1b.
 * Quota errors propagate from the underlying calls unchanged.
 */
export async function createItineraryRouted(
  input: CreateItineraryRoutedInput,
): Promise<ItineraryCreateResult> {
  const hasLocations = input.selectedLocationIds.length > 0

  // Case 2b: no locations + AI off → empty itinerary.
  if (!hasLocations && !input.aiRecommendations) {
    const itinerary = await createItinerary(
      input.tripName,
      input.country,
      input.region,
      input.latitude,
      input.longitude,
      input.startDate,
      input.totalDays,
      input.endDate,
    )
    return { kind: 'blank', itinerary }
  }

  // Cases 1a / 1b / 2a → async planning job.
  const job = await generateItinerary({
    title: input.tripName,
    location_ids: input.selectedLocationIds,
    aiFillGaps: input.aiRecommendations,
    start_date: input.startDate,
    total_days: input.totalDays,
    country: input.country,
    region: input.region,
    latitude: input.latitude,
    longitude: input.longitude,
  })
  return { kind: 'planning', job }
}

export interface ItineraryCollaborator {
  id: string
  email: string
  role: string
  joined_at: string
}

export async function generateItineraryPublicToken(itineraryId: string): Promise<{ token: string }> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/tokens/public`, { method: 'POST' })
  return unwrap<{ token: string }>(res, 'Failed to generate public token')
}

export async function revokeItineraryPublicToken(itineraryId: string): Promise<void> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/tokens/public`, { method: 'DELETE' })
  await ensureOk(res, 'Failed to revoke public token')
}

export async function generateItineraryInviteToken(itineraryId: string): Promise<{ token: string; expires_at: string }> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/tokens/invite`, { method: 'POST' })
  return unwrap<{ token: string; expires_at: string }>(res, 'Failed to generate invite token')
}

export async function revokeItineraryInviteToken(itineraryId: string): Promise<void> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/tokens/invite`, { method: 'DELETE' })
  await ensureOk(res, 'Failed to revoke invite token')
}

export async function getItineraryCollaborators(itineraryId: string): Promise<ItineraryCollaborator[]> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/collaborators`)
  return unwrap<ItineraryCollaborator[]>(res, 'Failed to fetch collaborators')
}

export async function removeItineraryCollaborator(itineraryId: string, userId: string): Promise<void> {
  const res = await authFetch(`/api/itineraries/${itineraryId}/collaborators/${userId}`, { method: 'DELETE' })
  await ensureOk(res, 'Failed to remove collaborator')
}

export async function getItineraryInviteInfo(token: string): Promise<{ id: string; name: string; country?: string; region?: string; type: string }> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
  const res = await fetch(`${apiUrl}/api/itineraries/invite/${token}/info`)
  return unwrap<{ id: string; name: string; country?: string; region?: string; type: string }>(res, 'Failed to fetch invite info')
}

export async function joinItineraryByToken(token: string): Promise<Itinerary> {
  const res = await authFetch(`/api/itineraries/join/${token}`, { method: 'POST' })
  return unwrap<Itinerary>(res, 'Failed to join itinerary')
}

export interface PublicItineraryActivity {
  id: string
  name: string
  start_time?: string
  end_time?: string
  category?: string
  photo_url?: string
}

export interface PublicItineraryDay {
  id: string
  date: string
  day_index: number
  area_name?: string | null
  itinerary_activities: PublicItineraryActivity[]
}

export interface PublicItinerary {
  id: string
  name: string
  country?: string
  region?: string
  start_date?: string
  end_date?: string
  total_days: number
  total_activities: number
  overview?: string
  thumbnail_url?: string | null
  days: PublicItineraryDay[]
}

export async function getPublicItinerary(token: string): Promise<PublicItinerary> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || ''
  const res = await fetch(`${apiUrl}/api/itineraries/public/${token}`)
  return unwrap<PublicItinerary>(res, 'Itinerary not found')
}

export async function deleteItinerary(id: string): Promise<void> {
  const res = await authFetch(`/api/itineraries/${id}`, {
    method: 'DELETE',
  })
  await ensureOk(res, 'Failed to delete itinerary')
}
