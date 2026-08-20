import type { PlaceSearchResult } from "./place-search";
import type { ResolvedGoogleMapsLocation } from "@/lib/api/locations";
import { weekdayDescriptionsFrom } from "@/lib/utils/location-detail";

/**
 * Maps a persisted `locations` row (as returned by the resolve-google-maps-url
 * endpoint) into the `PlaceSearchResult` shape the Add Location form and its
 * optimistic activity card consume. `id` carries the Google place id (the form's
 * place_id semantics); `locationId` carries the persisted row id so the add-to-day
 * path can link the activity directly without re-fetching Google.
 */
export function locationRowToPlaceSearchResult(
  row: ResolvedGoogleMapsLocation,
): PlaceSearchResult {
  const hours = row.regular_opening_hours;
  const periods =
    hours && typeof hours === "object" && Array.isArray((hours as Record<string, unknown>).periods)
      ? ((hours as Record<string, unknown>).periods as PlaceSearchResult["openingHoursPeriods"])
      : undefined;
  const weekdayDescriptions = weekdayDescriptionsFrom(hours);
  const photos = row.photo_urls ?? undefined;

  return {
    id: row.place_id ?? row.id,
    locationId: row.id,
    name: row.name,
    latitude: row.latitude ?? 0,
    longitude: row.longitude ?? 0,
    types: row.categories ?? [],
    primaryType: row.primary_type ?? undefined,
    address: row.formatted_address ?? undefined,
    photoUrl: photos?.[0],
    rating: row.rating ?? undefined,
    userRatingCount: row.user_rating_count ?? undefined,
    openingHours: weekdayDescriptions.length ? weekdayDescriptions : undefined,
    phone: row.national_phone_number ?? row.international_phone_number ?? undefined,
    website: row.website_uri ?? undefined,
    businessStatus: row.business_status ?? undefined,
    googleMapsUri: row.google_maps_uri ?? undefined,
    googleMapsLinks: row.google_maps_links ?? undefined,
    priceRange: row.price_range ?? undefined,
    openingHoursPeriods: periods,
    photoStorageUrls: photos,
  };
}
