/**
 * A collection's rows turned into what `/collections/[id]` renders.
 *
 * It lives here rather than in the page for the same reason
 * `src/lib/links/detail-view.ts` does: a Next `page.tsx` may only export its
 * default component, so a mapper written inline there cannot be tested, and the
 * mapping is where all the decisions are. The route returns this shape, so the
 * browser gets the ported `Location` type with no rename layer in between.
 *
 * Everything here is a pure function over rows. Nothing fetches.
 */

import { googleMapsPlaceUrl } from "@/lib/maps/google-maps-url";
import type { PriceRange } from "@/lib/maps/price-range";

import type { CollectionDetail, CollectionListItem, LocationRow } from "./collections";
import { weekdayDescriptionsFrom } from "./itinerary-detail";

/**
 * One card in the collection's grid, and the source of its detail view.
 *
 * This is the ported `Location` in `src/lib/api/collections.ts`, field for
 * field. Four of its fields have no column in this database and come back
 * empty rather than faked — `website_uri`, `international_phone_number`,
 * `categories`, and the per-place `is_bookmarked` flag. Same rule
 * `toLinkLocation` keeps, and for the same reason: the Places field masks this
 * app buys do not include contact details, and inventing them would put a
 * phone number on a card that dials nobody.
 */
export interface CollectionLocationView {
  id: string;
  name: string;
  formatted_address?: string;
  latitude?: number;
  longitude?: number;
  primary_type?: string;
  tags: string[];
  photo_urls?: string[];
  rating?: number;
  regular_opening_hours?: { weekdayDescriptions: string[] };
  locality?: string;
  stay_duration?: number;
  price_range?: PriceRange;
  google_maps_uri: string | null;
  place_id?: string;
  /** The blurb the detail view shows. Google's own where there is one. */
  location_context?: string;
  /** Junction-scoped state. Pinned false: there is no per-place flag column,
   *  and the ported card requires both props. */
  is_bookmarked: boolean;
  is_archived: boolean;
  added_at: string;
}

/** The whole payload `GET /api/collections/[id]` returns. */
export interface CollectionDetailView extends CollectionListItem {
  locations: CollectionLocationView[];
}

export function toCollectionLocation(
  row: LocationRow,
  addedAt: string,
): CollectionLocationView {
  const periods = weekdayDescriptionsFrom(row.opening_periods);

  return {
    id: row.id,
    name: row.name,
    formatted_address: row.formatted_address ?? undefined,
    latitude: row.latitude ?? undefined,
    longitude: row.longitude ?? undefined,
    primary_type: row.primary_type ?? row.types[0] ?? undefined,
    tags: row.types,
    photo_urls: row.photo_urls ?? undefined,
    rating: row.rating ?? undefined,
    // Omitted rather than sent empty: the detail view renders an "Opening
    // hours" block whenever the key is present, and an empty one says "we
    // know this place's hours and they are nothing".
    ...(periods.length > 0 ? { regular_opening_hours: { weekdayDescriptions: periods } } : {}),
    locality: row.city ?? undefined,
    stay_duration: row.stay_duration ?? undefined,
    price_range: row.price_range ?? undefined,
    google_maps_uri:
      row.latitude === null || row.longitude === null
        ? null
        : googleMapsPlaceUrl({
            googleMapsUri: row.google_maps_uri,
            placeId: row.place_id,
            name: row.name,
            latitude: row.latitude,
            longitude: row.longitude,
          }),
    place_id: row.place_id,
    // Google's blurb, then its review digest. Unlike `toLinkLocation` there is
    // no third fallback: a link has the model's own words for a place, and a
    // collection has nothing but the row.
    location_context: row.editorial_summary ?? row.review_summary ?? undefined,
    is_bookmarked: false,
    is_archived: false,
    added_at: addedAt,
  };
}

/**
 * A place with no coordinates is **kept** here, unlike on a link's page.
 *
 * `toLinkLocation` drops one because that grid puts every card on a map and a
 * pin at (0, 0) is worse than a missing one. A collection is a list the
 * traveller built, and silently dropping something they saved is the worse
 * failure of the two — the map filters the unlocated out on its own.
 */
export function toCollectionDetailView(detail: CollectionDetail): CollectionDetailView {
  const { locations, ...card } = detail;
  return {
    ...card,
    locations: locations.map((entry) => toCollectionLocation(entry.location, entry.added_at)),
  };
}
