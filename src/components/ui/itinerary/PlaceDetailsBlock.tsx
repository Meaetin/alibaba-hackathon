"use client";

import { Clock3, ExternalLink, Globe, MapPin, Phone, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { trackPlacePhoto } from "@/lib/api/maps";
import { humanizePlaceType } from "@/lib/utils/formatters";
import { formatDisplayUrl, weekdayDescriptionsFrom } from "@/lib/utils/location-detail";
import type { PlaceSearchResult } from "@/lib/maps/place-search";
import type { ActivityLocationDetail as ActivityLocation } from "@/lib/db/itinerary-detail";

/** Normalized place "view" rendered by PlaceDetailsBlock. The two adapters
 *  (`placeSearchResultToPlaceView`, `activityLocationToPlaceView`) produce this
 *  from a live Google Places search result or a saved itinerary activity. */
export interface PlaceView {
  /** Stable id (used to deduplicate photo billing across renders). */
  id?: string;
  name: string;
  photoUrl?: string | null;
  /** Author display names only (Google ToS requires showing them). */
  photoAttributions?: string[];
  /** Pre-resolved label, humanized from the primary type slug. */
  typeLabel?: string | null;
  rating?: number | null;
  userRatingCount?: number | null;
  address?: string | null;
  /** Prefer national; falls back to international per Google's recommendation. */
  phone?: string | null;
  website?: string | null;
  /** Multi-line opening hours, e.g. ["Monday: 9 AM–6 PM", …]. */
  openingHoursLines?: string[] | null;
  googleMapsUri?: string | null;
  /** AI-generated description (location_context). Empty for live search results. */
  description?: string | null;
  /** When true and rating/hours/phone/website are all missing, render a loading
   *  skeleton (used while a Pro-tier search result enriches to Enterprise). */
  loadingEnterprise?: boolean;
}

/** Tracks which places have already been billed a Place Photo this session,
 *  so re-renders / re-clicks don't double-count the photo SKU. */
const trackedPhotoPlaceIds = new Set<string>();

/** Convert a live map-search result into the shared view. */
export function placeSearchResultToPlaceView(p: PlaceSearchResult): PlaceView {
  const typeSlug = p.primaryType ?? p.types[0];
  return {
    id: p.id,
    name: p.name,
    photoUrl: p.photoUrl,
    photoAttributions: p.photoAttributions,
    typeLabel: typeSlug ? humanizePlaceType(typeSlug) : null,
    rating: p.rating,
    userRatingCount: p.userRatingCount,
    address: p.address,
    phone: p.phone,
    website: p.website,
    openingHoursLines: p.openingHours,
    googleMapsUri: p.googleMapsUri,
    description: null,
  };
}

/** Convert a saved activity's joined `locations` row into the shared view. */
export function activityLocationToPlaceView(
  loc: ActivityLocation,
  opts: { phone?: string | null; website?: string | null; primaryPhotoUrl?: string | null } = {},
): PlaceView {
  const typeSlug = loc.primary_type ?? loc.categories?.[0] ?? null;
  const weekdayDescriptions = weekdayDescriptionsFrom(loc.regular_opening_hours);
  return {
    id: loc.id,
    name: loc.name,
    photoUrl: opts.primaryPhotoUrl ?? loc.photo_urls?.[0] ?? null,
    // Photo attributions come with Google's raw `photos` objects. Retrieval
    // stores resource names and resolved URLs, not those, so a stored location
    // has none — the live map-search path still supplies its own.
    typeLabel: typeSlug ? humanizePlaceType(typeSlug) : null,
    rating: loc.rating,
    userRatingCount: loc.user_rating_count,
    address: loc.formatted_address,
    // Phone and website are not columns in `locations`, so a saved activity has
    // them only when the caller passes them in.
    phone: opts.phone ?? null,
    website: opts.website ?? null,
    openingHoursLines: weekdayDescriptions.length ? weekdayDescriptions : null,
    googleMapsUri: loc.google_maps_uri ?? null,
    // Google's own one-line description of the place — the Atmosphere field the
    // shortlist call already pays for, and a better blurb than the neighbourhood
    // string this used to show.
    description: loc.editorial_summary,
  };
}

interface PlaceDetailsBlockProps {
  view: PlaceView;
  /** Render the hero photo (defaults true). Set false when the caller already
   *  renders the photo as something interactive (e.g. lightbox trigger). The
   *  attribution-pill helper `<PlacePhotoAttribution />` is exported for that case. */
  showPhoto?: boolean;
  className?: string;
}

/** Shared place-details rendering for the itinerary side panel — used by both
 *  the map-search preview (live Google Places result) and saved activities
 *  (joined `locations` row). Every field is rendered conditionally; missing
 *  data simply collapses the row. */
export function PlaceDetailsBlock({ view, showPhoto = true, className }: PlaceDetailsBlockProps) {
  const hasOpeningHours = (view.openingHoursLines?.length ?? 0) > 0;
  const showEnterpriseSkeleton =
    Boolean(view.loadingEnterprise) &&
    view.rating == null &&
    !hasOpeningHours &&
    !view.phone &&
    !view.website;

  const handlePhotoLoad = () => {
    if (!view.id || trackedPhotoPlaceIds.has(view.id)) return;
    trackedPhotoPlaceIds.add(view.id);
    void trackPlacePhoto();
  };

  return (
    <div className={cn("place-details-block flex flex-col gap-3", className)}>
      {/* Photo */}
      {showPhoto && view.photoUrl && (
        <div className="place-details-block-photo-wrapper relative aspect-[3/2] w-full overflow-hidden rounded-xl bg-surface-alt">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={view.photoUrl}
            alt={view.name}
            onLoad={handlePhotoLoad}
            className="place-details-block-photo-img size-full object-cover"
          />
          <PlacePhotoAttribution attributions={view.photoAttributions} />
        </div>
      )}

      {/* Title + Meta */}
      <div className="place-details-block-meta flex flex-col gap-1.5">
        <span className="place-details-block-name type-h4 font-semibold text-content">{view.name}</span>
        {(view.typeLabel || view.rating != null) && (
          <div className="place-details-block-tags flex flex-wrap items-center gap-x-3 gap-y-1">
            {view.typeLabel && (
              <span className="place-details-block-type type-body-3 text-content-secondary">{view.typeLabel}</span>
            )}
            {view.rating != null && (
              <span className="place-details-block-rating inline-flex items-center gap-1 type-body-3 text-content-secondary">
                <Star className="place-details-block-rating-star size-3.5 fill-glyph-warning text-content-warning" />
                {view.rating.toFixed(1)}
                {view.userRatingCount != null && (
                  <span className="place-details-block-rating-count text-content-tertiary">
                    ({view.userRatingCount.toLocaleString()})
                  </span>
                )}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Address */}
      {view.address && (
        <div className="place-details-block-address flex items-start gap-2">
          <MapPin className="place-details-block-address-icon size-4 shrink-0 text-content-tertiary mt-0.5" />
          <span className="place-details-block-address-text type-body-2 text-content-secondary">{view.address}</span>
        </div>
      )}

      {/* Phone */}
      {view.phone && (
        <a
          href={`tel:${view.phone}`}
          className="place-details-block-phone flex items-center gap-2 type-body-2 text-content-secondary hover:text-content transition-colors"
        >
          <Phone className="place-details-block-phone-icon size-4 shrink-0 text-content-tertiary" />
          {view.phone}
        </a>
      )}

      {/* Website */}
      {view.website && (
        <a
          href={view.website}
          target="_blank"
          rel="noopener noreferrer"
          className="place-details-block-website flex items-center gap-2 type-body-2 text-content-info hover:underline"
        >
          <Globe className="place-details-block-website-icon size-4 shrink-0 text-content-tertiary" />
          <span className="place-details-block-website-text truncate">
            {formatDisplayUrl(view.website)}
          </span>
        </a>
      )}

      {/* Opening Hours */}
      {hasOpeningHours && (
        <div className="place-details-block-hours flex items-start gap-2">
          <Clock3 className="place-details-block-hours-icon size-4 shrink-0 text-content-tertiary mt-0.5" />
          <div className="place-details-block-hours-list flex flex-col gap-0.5">
            {view.openingHoursLines!.map((line, i) => (
              <span key={i} className="place-details-block-hours-line type-body-3 text-content-secondary">
                {line}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Google Maps Link */}
      {view.googleMapsUri && (
        <a
          href={view.googleMapsUri}
          target="_blank"
          rel="noopener noreferrer"
          className="place-details-block-maps-link flex items-center gap-2 type-body-2 text-content-info hover:underline"
        >
          <ExternalLink className="place-details-block-maps-link-icon size-4 shrink-0 text-content-tertiary" />
          <span className="place-details-block-maps-link-text">View on Google Maps</span>
        </a>
      )}

      {/* Description */}
      {view.description && (
        <p className="place-details-block-description type-body-2 text-content leading-relaxed">
          {view.description}
        </p>
      )}

      {/* Enterprise Loading Skeleton */}
      {showEnterpriseSkeleton && (
        <div
          className="place-details-block-skeleton flex flex-col gap-2"
          aria-live="polite"
          aria-busy="true"
        >
          <div className="place-details-block-skeleton-line h-3 w-24 rounded bg-surface-muted animate-pulse" />
          <div className="place-details-block-skeleton-line h-3 w-40 rounded bg-surface-muted animate-pulse" />
          <div className="place-details-block-skeleton-line h-3 w-32 rounded bg-surface-muted animate-pulse" />
          <span className="place-details-block-skeleton-sr sr-only">Loading place details…</span>
        </div>
      )}
    </div>
  );
}

PlaceDetailsBlock.displayName = "PlaceDetailsBlock";

/** Small corner-pill credit overlay for Place Photos. Exported separately so
 *  callers that render the photo themselves (e.g. as a lightbox trigger) can
 *  still satisfy Google's attribution requirement. */
export function PlacePhotoAttribution({ attributions }: { attributions?: string[] }) {
  if (!attributions?.length) return null;
  return (
    <span
      className="place-photo-attribution absolute bottom-2 right-2 max-w-[60%] truncate rounded-md bg-black/55 px-2 py-0.5 type-body-4 text-white backdrop-blur-sm pointer-events-none"
      aria-label={`Photo by ${attributions.join(", ")}`}
    >
      {attributions.join(" · ")}
    </span>
  );
}
