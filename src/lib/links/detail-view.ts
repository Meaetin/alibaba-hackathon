/**
 * `GET /api/content/[id]` turned into what `/links/[id]` renders.
 *
 * It lives here, not in the page, because a Next `page.tsx` may only export its
 * default component — so a mapper written inline there cannot be tested, and
 * the mapping is where all the decisions are. The page imports the two view
 * types from this file and keeps its own local ones.
 *
 * Everything here is a pure function over a `ContentDetail`. Nothing fetches.
 */

import type { ContentDetail, LocationRow } from "@/lib/db/content";
import { weekdayDescriptionsFrom } from "@/lib/db/itinerary-detail";
import { googleMapsPlaceUrl } from "@/lib/maps/google-maps-url";
import type { PriceRange } from "@/lib/maps/price-range";

/** The header of `/links/[id]`. */
export interface LinkDetail {
  id: string;
  url: string;
  normalizedUrl: string;
  title: string;
  thumbnailUrl: string;
  country: string;
}

/** One card in the link's location grid. */
export interface LinkLocationItem {
  id: string;
  name: string;
  address: string;
  type: "location";
  latitude: number;
  longitude: number;
  thumbnailUrl: string;
  primaryType: string;
  sourceUrl: string;
  description: string;
  details: {
    address: string;
    openingHoursLines: string[];
    phone: string;
    website: string;
    stayDurationMinutes: number | null;
    priceRange: PriceRange | null;
  };
  images: string[];
  isFavorite: boolean;
  isArchived: boolean;
  googleMapsUri: string | null;
}

export function toLinkDetail(detail: ContentDetail): LinkDetail {
  return {
    id: detail.id,
    url: detail.content_url,
    normalizedUrl: detail.normalized_url,
    // A link with no title still needs something on the header; its URL is the
    // most useful thing left to call it.
    title: detail.content_title ?? detail.content_url,
    thumbnailUrl: detail.content_thumbnail ?? "",
    // The map filter chip reads this. Region first, because "Bali" locates a
    // trip better than "Indonesia" does.
    country: detail.primary_region ?? detail.primary_country ?? "",
  };
}

/**
 * One place, as a card.
 *
 * **A place with no coordinates is dropped.** The grid puts every card on a
 * map, and a location at (0, 0) is a pin in the Gulf of Guinea rather than a
 * missing one. Google returns a coordinate for everything it has, so this is
 * the row-never-persisted case, not the ordinary one.
 *
 * Three fields the ported card asks for and this database does not have:
 * `phone`, `website`, and a per-place favourite flag. They render empty rather
 * than being faked. `locations` carries `opening_periods` but neither contact
 * field — see the note in `AGENTS.md` about what the Places field masks buy.
 */
export function toLinkLocation(
  mention: string,
  row: LocationRow,
  sourceUrl: string,
): LinkLocationItem | null {
  if (row.latitude === null || row.longitude === null) return null;

  const photos = row.photo_urls ?? [];

  return {
    id: row.id,
    name: row.name,
    address: row.formatted_address ?? "",
    type: "location",
    latitude: row.latitude,
    longitude: row.longitude,
    thumbnailUrl: photos[0] ?? "",
    primaryType: row.primary_type ?? row.types[0] ?? "",
    sourceUrl,
    // Google's blurb where there is one. Falling back to the model's own words
    // for the place is deliberate: "Hoe Kee Porridge, Singapore, Singapore" is
    // thin, but it is true, and it is what the video actually said.
    description: row.editorial_summary ?? row.review_summary ?? mention,
    details: {
      address: row.formatted_address ?? "",
      openingHoursLines: weekdayDescriptionsFrom(row.opening_periods),
      phone: "",
      website: "",
      stayDurationMinutes: row.stay_duration,
      priceRange: row.price_range,
    },
    images: photos,
    isFavorite: false,
    isArchived: false,
    googleMapsUri: googleMapsPlaceUrl({
      googleMapsUri: row.google_maps_uri,
      placeId: row.place_id,
      name: row.name,
      latitude: row.latitude,
      longitude: row.longitude,
    }),
  };
}

export function toLinkLocations(detail: ContentDetail): LinkLocationItem[] {
  return detail.locations.flatMap((entry) => {
    const item = toLinkLocation(entry.mention, entry.location, detail.content_url);
    return item ? [item] : [];
  });
}
