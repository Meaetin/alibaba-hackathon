/** Hosts that Google Maps share links resolve to (long links + short-link domains). */
const GOOGLE_MAPS_HOST_PATTERN = /^(?:(?:www|maps)\.)?google\.com$|^maps\.app\.goo\.gl$|^goo\.gl$/i;

/** True when a string parses as a URL on a recognized Google Maps host. */
export function looksLikeGoogleMapsUrl(value: string): boolean {
  try {
    return GOOGLE_MAPS_HOST_PATTERN.test(new URL(value).host);
  } catch {
    return false;
  }
}

/**
 * A link that opens a specific place on Google Maps.
 *
 * Three sources, in descending order of how well they identify the place:
 *
 *   1. `googleMapsUri` — Google's own canonical link for the place. Free, on
 *      the Pro tier that `SEARCH_FIELD_MASK` already pays for.
 *   2. The place id, in the documented Maps URLs form. Every stored location
 *      has one, including the trips planned before the column existed, so this
 *      is what makes the button work today. `query` is required by the API even
 *      when `query_place_id` decides the answer — it is the label Maps shows
 *      while it resolves, not the search.
 *   3. Coordinates. This drops an unlabelled pin rather than opening the place,
 *      so it is genuinely a last resort, not an equivalent.
 */
export function googleMapsPlaceUrl(place: {
  googleMapsUri?: string | null;
  placeId?: string | null;
  name?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}): string | null {
  if (place.googleMapsUri) return place.googleMapsUri;

  const query = encodeURIComponent(place.name?.trim() || "");
  if (place.placeId && query) {
    return `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${encodeURIComponent(place.placeId)}`;
  }
  if (place.latitude != null && place.longitude != null) {
    return `https://www.google.com/maps/search/?api=1&query=${place.latitude},${place.longitude}`;
  }
  return null;
}
