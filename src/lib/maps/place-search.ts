// Google Places API (New) search via the Maps JS `Place` class.
//
// Cost model (important): one searchByText / searchNearby call returns up to ~20
// places in a SINGLE billed request — billing is per request, NOT per place. The
// SKU is set by the FIELD MASK: requesting any Enterprise field bills the
// Enterprise SKU. We always request the Enterprise fields — one rich call is far
// cheaper per place than a lean Pro search plus a Place Details call on add.

import { toPriceLevelOrdinal, type PriceLevelOrdinal } from "./price-level";

/** Per-photo metadata persisted to `locations.photos` (distinct from the re-hosted
 *  image URLs). Maps JS doesn't expose Google's photo resource `name`, so it's omitted. */
export interface PlacePhotoMeta {
  widthPx: number;
  heightPx: number;
  authorAttributions?: Array<{ displayName: string; uri?: string; photoUri?: string }>;
}

/** A place returned by a map search, normalized for our UI. */
export interface PlaceSearchResult {
  id: string;
  /** Persisted `locations` row id, set when this result came from a stored/resolved
   *  place (e.g. a resolved Google Maps link) rather than a fresh search. Lets the
   *  add-to-day path link the activity directly instead of re-fetching Google. */
  locationId?: string;
  name: string;
  latitude: number;
  longitude: number;
  types: string[];
  primaryType?: string;
  address?: string;
  photoUrl?: string;
  /** Author attribution display names for the photo (Google ToS requires showing these). */
  photoAttributions?: string[];
  // ── Enterprise-tier fields (undefined on results not yet enriched) ──
  rating?: number;
  userRatingCount?: number;
  /** Human-readable weekday opening-hours lines, e.g. "Monday: 9 AM–6 PM". */
  openingHours?: string[];
  phone?: string;
  website?: string;
  businessStatus?: string;
  googleMapsUri?: string;
  /** Object of Google Maps deep links (directions, reviews, photos). */
  googleMapsLinks?: Record<string, unknown>;
  /**
   * 0–4 ordinal derived from Google's `priceLevel` string. This is the field
   * budget filtering compares against — `priceRange` is currency-denominated
   * and not comparable across cities.
   */
  priceLevel?: PriceLevelOrdinal;
  /** Raw price-range object (startPrice, endPrice, currency). Display only. */
  priceRange?: Record<string, unknown>;
  // ── Persistence-only fields (not rendered; carried through to the API so a
  //    search-added place can be stored without a redundant server-side fetch) ──
  /** Address components (city/country derivation). Pro-tier, always present. */
  addressComponents?: Array<{ longText?: string; shortText?: string; types: string[] }>;
  /** Structured open/close periods — required for route-optimizer opening-hours constraints. */
  openingHoursPeriods?: Array<{
    open: { day: number; hour: number; minute: number };
    close?: { day: number; hour: number; minute: number };
  }>;
  /** Up to 3 resolved photo URLs the server re-hosts into stable storage. */
  photoStorageUrls?: string[];
  /** Per-photo metadata persisted to `locations.photos`. */
  photos?: PlacePhotoMeta[];
  /** Raw `place.toJSON()` payload persisted verbatim to `locations.full_data`. */
  rawPlace?: Record<string, unknown>;
}

/** A chip-driven category filter. Icons live in the UI layer, not here. */
export interface MapSearchChip {
  id: string;
  label: string;
  /** Places API (New) "Table A" types this chip resolves to. */
  includedTypes: string[];
}

// Travel-oriented categories. Order = display order in the search bar.
export const MAP_SEARCH_CHIPS: MapSearchChip[] = [
  { id: "restaurant", label: "Restaurants", includedTypes: ["restaurant"] },
  { id: "cafe", label: "Cafes", includedTypes: ["cafe", "coffee_shop"] },
  { id: "attractions", label: "Attractions", includedTypes: ["tourist_attraction"] },
  { id: "historical", label: "Historical", includedTypes: ["historical_landmark", "monument", "historical_place"] },
  { id: "nature", label: "Nature", includedTypes: ["park", "national_park", "hiking_area", "garden", "botanical_garden"] },
  { id: "museums", label: "Museums", includedTypes: ["museum", "art_gallery"] },
  { id: "shopping", label: "Shopping", includedTypes: ["shopping_mall", "department_store", "market"] },
  { id: "bars", label: "Bars", includedTypes: ["bar", "pub", "wine_bar"] },
];

// Field masks (camelCase = Maps JS `Place` property names). BASE_FIELDS are all
// Essentials/Pro tier; ENTERPRISE_EXTRAS bump the call to the Enterprise SKU. We
// always request both (see cost model up top). They're carried through to the
// server as `rawPlace` (→ locations.full_data) when a place is added to a day, so
// we capture everything the SKU already paid for.
const BASE_FIELDS = [
  "id",
  "displayName",
  "location",
  "types",
  "primaryType",
  "primaryTypeDisplayName",
  "formattedAddress",
  // Pro-tier, bills no extra over the fields already requested — gives the
  // authoritative city/country we persist as locality/country when adding to a day.
  "addressComponents",
  "adrFormatAddress",
  "plusCode",
  "viewport",
  "utcOffsetMinutes",
  "accessibilityOptions",
  "svgIconMaskURI",
  "iconBackgroundColor",
  "photos",
  "googleMapsURI",
  "businessStatus",
  "googleMapsLinks",
] as const;

const ENTERPRISE_EXTRAS = [
  "rating",
  "userRatingCount",
  "regularOpeningHours",
  "priceLevel",
  "priceRange",
  "internationalPhoneNumber",
  "nationalPhoneNumber",
  "websiteURI",
] as const;

// Always-Enterprise search field set.
const SEARCH_FIELDS = [...BASE_FIELDS, ...ENTERPRISE_EXTRAS];

// Place Details requests everything except `id` (that's the Place constructor arg).
const DETAILS_FIELDS = SEARCH_FIELDS.filter((f) => f !== "id");

const MAX_RESULTS = 20;
// Photos re-hosted server-side per place when adding to a day (matches the
// backend enrichment's MAX_PHOTOS, so the two add paths store the same count).
const MAX_STORED_PHOTOS = 3;
// Places Nearby Search caps the search circle at 50 km.
const MAX_RADIUS_M = 50_000;
const MIN_RADIUS_M = 500;

export interface PlaceSearchRequest {
  /** Free-text query. When present we use Text Search; when empty we use Nearby Search. */
  query: string;
  /** Place types from the active chip (may be empty). */
  includedTypes: string[];
  /** Bumped on every user-initiated search so the map re-runs the request. */
  nonce: number;
}

/** Derives a Nearby Search circle (center + radius, capped at 50 km) from the map viewport. */
function viewportCircle(map: google.maps.Map): google.maps.CircleLiteral | null {
  const bounds = map.getBounds();
  const center = bounds?.getCenter();
  const ne = bounds?.getNorthEast();
  if (!bounds || !center || !ne) return null;

  const R = 6_371_000; // earth radius (m)
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(ne.lat() - center.lat());
  const dLng = toRad(ne.lng() - center.lng());
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(center.lat())) * Math.cos(toRad(ne.lat())) * Math.sin(dLng / 2) ** 2;
  const radius = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));

  return {
    center: { lat: center.lat(), lng: center.lng() },
    radius: Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, radius)),
  };
}

/** Maps a Maps JS `Place` to our normalized result, skipping any without coordinates. */
function normalizePlace(place: google.maps.places.Place): PlaceSearchResult | null {
  const lat = place.location?.lat();
  const lng = place.location?.lng();
  if (lat == null || lng == null) return null;

  // Newest Places fields aren't always in @types/google.maps; read them off a
  // narrowed view so missing type defs don't break the build.
  const extra = place as unknown as {
    googleMapsLinks?: Record<string, unknown>;
    priceRange?: Record<string, unknown>;
    toJSON?: () => Record<string, unknown>;
  };

  // Resolve up to 3 photo URLs at a 3:2, retina resolution to match the side
  // panel's `aspect-[3/2] w-full` photo container (~420px wide @2x DPR). Google
  // caps at the original size, so this only sharpens when the source allows. The
  // first is the card thumbnail; all are passed to the server to re-host.
  const photoStorageUrls = (place.photos ?? [])
    .slice(0, MAX_STORED_PHOTOS)
    .map((p) => {
      try {
        return p.getURI({ maxWidth: 1200, maxHeight: 800 });
      } catch {
        return undefined;
      }
    })
    .filter((u): u is string => Boolean(u));
  const photoUrl = photoStorageUrls[0];
  const firstPhoto = place.photos?.[0];
  const photoAttributions = firstPhoto?.authorAttributions
    ?.map((a) => a.displayName)
    .filter((n): n is string => Boolean(n));

  // Per-photo metadata (width/height/attributions) persisted to locations.photos —
  // the structured counterpart to the re-hosted photoStorageUrls.
  const photos: PlacePhotoMeta[] | undefined = place.photos
    ?.slice(0, MAX_STORED_PHOTOS)
    .map((p) => ({
      widthPx: p.widthPx,
      heightPx: p.heightPx,
      authorAttributions: p.authorAttributions
        ?.map((a) => ({
          displayName: a.displayName ?? "",
          uri: a.uri ?? undefined,
          // Maps JS casing is photoURI (the author's profile image), matching the
          // REST `photoUri` we persist on the server-fetch path.
          photoUri: a.photoURI ?? undefined,
        }))
        .filter((a) => a.displayName),
    }));

  const addressComponents = place.addressComponents
    ?.map((c) => ({ longText: c.longText ?? undefined, shortText: c.shortText ?? undefined, types: c.types }))
    .filter((c) => c.types.length > 0);

  const openingHoursPeriods = place.regularOpeningHours?.periods?.map((p) => ({
    open: { day: p.open.day, hour: p.open.hour, minute: p.open.minute },
    close: p.close ? { day: p.close.day, hour: p.close.hour, minute: p.close.minute } : undefined,
  }));

  return {
    id: place.id,
    name: place.displayName ?? "Unnamed place",
    latitude: lat,
    longitude: lng,
    types: place.types ?? [],
    primaryType: place.primaryType ?? undefined,
    address: place.formattedAddress ?? undefined,
    photoUrl,
    photoAttributions: photoAttributions?.length ? photoAttributions : undefined,
    rating: place.rating ?? undefined,
    userRatingCount: place.userRatingCount ?? undefined,
    openingHours: place.regularOpeningHours?.weekdayDescriptions ?? undefined,
    phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber ?? undefined,
    website: place.websiteURI ?? undefined,
    businessStatus: place.businessStatus ?? undefined,
    googleMapsUri: place.googleMapsURI ?? undefined,
    googleMapsLinks: extra.googleMapsLinks ?? undefined,
    priceLevel: toPriceLevelOrdinal(place.priceLevel),
    priceRange: extra.priceRange ?? undefined,
    addressComponents: addressComponents?.length ? addressComponents : undefined,
    openingHoursPeriods: openingHoursPeriods?.length ? openingHoursPeriods : undefined,
    photoStorageUrls: photoStorageUrls.length ? photoStorageUrls : undefined,
    photos: photos?.length ? photos : undefined,
    rawPlace: extra.toJSON?.(),
  };
}

/**
 * Place data sent to the API when adding a searched place to a day, so the
 * server can persist a full `locations` row WITHOUT a redundant Place Details
 * call (the browser already fetched this in the search). camelCase mirrors the
 * Google/REST field shapes the server maps from.
 */
export interface PlaceDetailsPayload {
  name: string;
  latitude?: number;
  longitude?: number;
  formattedAddress?: string;
  addressComponents?: Array<{ longText?: string; shortText?: string; types: string[] }>;
  types?: string[];
  primaryType?: string;
  rating?: number;
  userRatingCount?: number;
  /** 0–4 ordinal; the budget-filtering input. Persisted to `locations.price_level`. */
  priceLevel?: PriceLevelOrdinal;
  priceRange?: { startPrice?: number; endPrice?: number; currency?: string };
  openingHoursPeriods?: Array<{
    open: { day: number; hour: number; minute: number };
    close?: { day: number; hour: number; minute: number };
  }>;
  weekdayDescriptions?: string[];
  businessStatus?: string;
  websiteUri?: string;
  phone?: string;
  googleMapsUri?: string;
  googleMapsLinks?: Record<string, unknown>;
  photoUrls?: string[];
  /** Per-photo metadata → locations.photos. */
  photos?: PlacePhotoMeta[];
  /** Raw place.toJSON() → locations.full_data. */
  rawPlace?: Record<string, unknown>;
}

/**
 * Normalize the Maps JS `PriceRange` (whose `startPrice`/`endPrice` are `Money`
 * objects — `{ units, currencyCode, nanos }`) into the numeric shape the server
 * persists. Returns undefined when no price data is present.
 */
function normalizePriceRange(
  raw: Record<string, unknown> | undefined,
): { startPrice?: number; endPrice?: number; currency?: string } | undefined {
  if (!raw) return undefined;
  const toNum = (v: unknown): number | undefined => {
    if (typeof v === 'number') return v;
    const units = (v as { units?: unknown } | undefined)?.units;
    const n =
      typeof units === 'string' ? parseInt(units, 10) : typeof units === 'number' ? units : NaN;
    return Number.isFinite(n) ? n : undefined;
  };
  const startPrice = toNum(raw.startPrice);
  const endPrice = toNum(raw.endPrice);
  const currency =
    (raw.startPrice as { currencyCode?: string } | undefined)?.currencyCode ??
    (typeof raw.currency === 'string' ? raw.currency : undefined);
  if (startPrice == null && endPrice == null && !currency) return undefined;
  return { startPrice, endPrice, currency };
}

/**
 * Builds the server persistence payload from a search result — but ONLY when the
 * result already carries Enterprise data (`!placeNeedsDetails`). Returns undefined
 * for a lean Pro-tier result so the server falls back to its own Place Details
 * fetch (the data simply isn't here to pass through).
 */
export function toPlaceDetailsPayload(place: PlaceSearchResult): PlaceDetailsPayload | undefined {
  if (placeNeedsDetails(place)) return undefined;
  return {
    name: place.name,
    latitude: place.latitude,
    longitude: place.longitude,
    formattedAddress: place.address,
    addressComponents: place.addressComponents,
    types: place.types,
    primaryType: place.primaryType,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    priceLevel: place.priceLevel,
    priceRange: normalizePriceRange(place.priceRange),
    openingHoursPeriods: place.openingHoursPeriods,
    weekdayDescriptions: place.openingHours,
    businessStatus: place.businessStatus,
    websiteUri: place.website,
    phone: place.phone,
    googleMapsUri: place.googleMapsUri,
    googleMapsLinks: place.googleMapsLinks,
    photoUrls: place.photoStorageUrls,
    photos: place.photos,
    rawPlace: place.rawPlace,
  };
}

/**
 * True when a result is missing the Enterprise-tier detail fields — i.e. it came
 * from a Pro-tier search and a pin click should fetch Place Details to enrich it.
 */
export function placeNeedsDetails(place: PlaceSearchResult): boolean {
  return (
    place.rating == null &&
    !place.openingHours?.length &&
    !place.phone &&
    !place.website
  );
}

/**
 * Fetches Enterprise-tier Place Details for one place. Used on pin click to enrich
 * a Pro-tier search result. Place Details is the cheapest of the three SKUs.
 */
export async function fetchPlaceDetailsEnterprise(
  placesLib: google.maps.PlacesLibrary,
  placeId: string,
): Promise<Partial<PlaceSearchResult>> {
  const place = new placesLib.Place({ id: placeId });
  await place.fetchFields({ fields: DETAILS_FIELDS });
  return normalizePlace(place) ?? {};
}

/**
 * Runs a single place search against the current map viewport.
 * - With a text query → Text Search (New), biased to the viewport.
 * - Without text (chip only) → Nearby Search (New), restricted to the viewport circle.
 * Returns up to 20 results from ONE billed API request.
 */
export async function runPlaceSearch(
  placesLib: google.maps.PlacesLibrary,
  map: google.maps.Map,
  { query, includedTypes }: Pick<PlaceSearchRequest, "query" | "includedTypes">,
): Promise<PlaceSearchResult[]> {
  const { Place } = placesLib;
  const trimmed = query.trim();
  const fields = [...SEARCH_FIELDS];

  let places: google.maps.places.Place[] = [];
  let mode: "text" | "nearby";
  let requestDebug: Record<string, unknown>;

  if (trimmed.length > 0) {
    mode = "text";
    const bounds = map.getBounds();
    const request = {
      textQuery: trimmed,
      fields,
      ...(bounds ? { locationBias: bounds } : {}),
      ...(includedTypes[0] ? { includedType: includedTypes[0] } : {}),
      maxResultCount: MAX_RESULTS,
    };
    requestDebug = { ...request, locationBias: bounds?.toJSON() };
    const result = await Place.searchByText(request);
    places = result.places ?? [];
  } else {
    mode = "nearby";
    const circle = viewportCircle(map);
    if (!circle) return [];
    const request = {
      fields,
      locationRestriction: circle,
      ...(includedTypes.length > 0 ? { includedTypes } : {}),
      maxResultCount: MAX_RESULTS,
    };
    requestDebug = request;
    const result = await Place.searchNearby(request);
    places = result.places ?? [];
  }

  const normalized = places
    .map(normalizePlace)
    .filter((p): p is PlaceSearchResult => p !== null);

  // Dev-only: inspect exactly what Google returned (raw Place objects) vs what we
  // keep (normalized). Open the browser console and expand the group.
  if (process.env.NODE_ENV !== "production") {
    /* eslint-disable no-console */
    console.groupCollapsed(
      `%c[place-search] ${mode}/enterprise%c ${trimmed ? `"${trimmed}" ` : ""}→ ${normalized.length} results`,
      "color:#6366f1;font-weight:600",
      "color:inherit",
    );
    console.log("request:", requestDebug);
    console.table(
      normalized.map((p) => ({
        name: p.name,
        primaryType: p.primaryType,
        types: p.types.join(", "),
        rating: p.rating,
        reviews: p.userRatingCount,
        address: p.address,
        hasPhoto: Boolean(p.photoUrl),
        lat: p.latitude,
        lng: p.longitude,
      })),
    );
    console.log("normalized results:", normalized);
    console.log("raw Place objects:", places);
    console.groupEnd();
    /* eslint-enable no-console */
  }

  return normalized;
}
