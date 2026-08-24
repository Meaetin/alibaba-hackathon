import { authFetch, unwrap } from './client'
import type { PriceRange } from "@/lib/maps/price-range";

/**
 * A persisted `locations` row returned by the resolve-google-maps-url endpoint.
 * Mirrors the columns the itinerary detail query selects for an activity's
 * location, so the resolved place renders with the same fields a saved one does.
 */
export interface ResolvedGoogleMapsLocation {
  id: string
  place_id: string | null
  name: string
  latitude: number | null
  longitude: number | null
  photo_urls: string[] | null
  formatted_address: string | null
  google_maps_uri: string | null
  google_maps_links: Record<string, unknown> | null
  location_context: string | null
  regular_opening_hours: unknown
  stay_duration: number | null
  rating: number | null
  user_rating_count: number | null
  price_range: PriceRange | null
  primary_type: string | null
  categories: string[] | null
  business_status: string | null
  website_uri: string | null
  international_phone_number: string | null
  national_phone_number: string | null
}

/**
 * Resolve a Google Maps share link into a persisted `locations` row. The server
 * expands/parses the URL to a `place_id`, reuses the cached row when we've stored
 * that place before, or fetches Enterprise Place Details and persists a new row.
 * Returns the full row so the caller can render rich fields and link the location
 * to an activity directly (no client-side Place Details call).
 */
export async function resolveGoogleMapsUrl(
  url: string,
): Promise<{ location: ResolvedGoogleMapsLocation }> {
  const res = await authFetch('/api/locations/resolve-google-maps-url', {
    method: 'POST',
    body: JSON.stringify({ url }),
  })
  return unwrap<{ location: ResolvedGoogleMapsLocation }>(res, 'Failed to resolve Google Maps link')
}
