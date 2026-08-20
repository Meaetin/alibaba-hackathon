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
