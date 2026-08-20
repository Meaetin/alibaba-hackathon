"use client";

import { useMemo, useState } from "react";
import {
  Globe,
  Hourglass,
  Images,
  MapPin,
  Phone,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { humanizePlaceType } from "@/lib/utils/formatters";
import {
  formatDisplayUrl,
  formatPriceRange,
  formatStaySentence,
} from "@/lib/utils/location-detail";
import { Button } from "@/components/ui/primitives/Button";
import { Pill } from "@/components/ui/primitives/Pill";
import { DetailRow } from "@/components/ui/primitives/DetailRow";
import { Separator } from "@/components/ui/primitives/Separator";
import { ImageLightbox } from "@/components/ui/modals/ImageGallery";
import { AlsoInCard } from "@/components/ui/detail-views/AlsoInCard";
import { OpeningHoursAccordion } from "@/components/ui/detail-views/OpeningHoursAccordion";
import { AlsoFoundInModal } from "@/components/ui/modals/AlsoFoundInModal";
import { useLocationReferencesQuery } from "@/hooks/queries/useLocationReferencesQuery";
import {
  activityLocationToPlaceView,
  PlacePhotoAttribution,
} from "./PlaceDetailsBlock";
import { NoteEditor, type NoteItem } from "@/components/ui/notes/InlineNoteEditor";
import type { ItineraryActivityDetail } from "@/lib/supabase/queries/home";

// ───── Types ─────────────────────────────────────────────────────────────────

export interface ActivityAttachment {
  id: string;
  name: string;
  type: "pdf" | "image" | "file";
  url?: string;
}

export type ActivityNote = NoteItem;

export interface DayActivityMarker {
  id: string;
  start_time: string | null;
  end_time: string | null;
  name?: string | null;
  photo_url?: string | null;
}

interface LocationDetailPanelProps {
  activity: ItineraryActivityDetail;
  timezone?: string;
  className?: string;

  /** True while a freshly-added place is being enriched server-side. The body
   *  renders a skeleton (the name shows in the panel header) until the full
   *  location row lands, so all detail appears in one go rather than popping in. */
  loading?: boolean;

  /** Current itinerary id — excluded from the "Also found in" cross-references. */
  currentItineraryId?: string;

  // ── Contact overrides (fall back to the joined location row when absent) ──
  phone?: string | null;
  website?: string | null;

  // ── Single note (FE-124, Figma 1433:20839) ──
  /** When true, the panel content is swapped for the single-note editor. */
  noteEditing?: boolean;
  /** This activity's one note, or null when none exists yet. */
  note?: ActivityNote | null;
  /** Persist the note (autosaved). */
  onNoteSave?: (note: ActivityNote) => void;
  /** Drop the note when the user empties it. */
  onNoteClear?: () => void;
  /** Notifies the parent (panel header) when the note editor opens/closes. */
  onEditingNoteChange?: (editing: boolean) => void;
  /** Lets the header Back / Note-toggle flush-save and exit the editor. */
  noteBackRef?: React.MutableRefObject<(() => void) | null>;

  // ── Accepted for caller compatibility; not rendered in the read view ──
  attachments?: ActivityAttachment[];
  /** @deprecated Time editing lives on the activity card's time pill. */
  onTimeChange?: (startTime: string, endTime: string | null) => void;
  /** @deprecated Conflict markers are sourced in the day column. */
  dayActivities?: DayActivityMarker[];
}

// ───── Local rows ───────────────────────────────────────────────────────────────

/** Icon + wrapping text row — used for the long stay-duration / price sentences
 *  that would otherwise be truncated by the inline `DetailRow`. */
function InfoRow({
  icon: Icon,
  className,
  children,
}: {
  icon: LucideIcon;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-start gap-1.5 py-3", className)}>
      <div className="flex size-5 shrink-0 items-center justify-center text-glyph">
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <span className="type-body-2 min-w-0 flex-1 font-medium text-content">{children}</span>
    </div>
  );
}

/** Icon + text-bar placeholder for a detail row whose value is still being
 *  enriched server-side. Mirrors the real rows' icon-slot + inline layout. */
function SkeletonRow({ width = "w-1/2" }: { width?: string }) {
  return (
    <div className="location-detail-skeleton-row flex items-center gap-1.5 py-3" aria-hidden="true">
      <div className="size-5 shrink-0 animate-pulse rounded-md bg-surface-muted" />
      <div className={cn("h-4 animate-pulse rounded-md bg-surface-muted", width)} />
    </div>
  );
}

// ───── Component ──────────────────────────────────────────────────────────────

export function LocationDetailPanel({
  activity,
  className,
  loading = false,
  currentItineraryId,
  phone,
  website,
  noteEditing = false,
  note,
  onNoteSave,
  onNoteClear,
  onEditingNoteChange,
  noteBackRef,
}: LocationDetailPanelProps) {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [alsoFoundInOpen, setAlsoFoundInOpen] = useState(false);

  // "Also found in" — other collections/itineraries containing this location.
  const locationId = activity.location?.id ?? null;
  const { data: references = [], isLoading: referencesLoading } =
    useLocationReferencesQuery(locationId, { itineraryId: currentItineraryId });
  const hasReferences = references.length > 0;
  const previewReferences = references.slice(0, 2);

  // Photos — activity photo first, then unique location photos.
  const photoUrls: string[] = [];
  if (activity.photo_url) photoUrls.push(activity.photo_url);
  if (activity.location?.photo_urls) {
    for (const url of activity.location.photo_urls) {
      if (url && !photoUrls.includes(url)) photoUrls.push(url);
    }
  }
  const extraImageCount = photoUrls.length - 3;

  const photoAttributions = activity.location?.photos?.[0]?.authorAttributions
    ?.map((a) => a.displayName)
    .filter((n): n is string => Boolean(n));

  const placeView = activity.location
    ? activityLocationToPlaceView(activity.location, {
        phone,
        website,
        primaryPhotoUrl: activity.photo_url ?? activity.location.photo_urls?.[0] ?? null,
      })
    : null;

  const primaryType = activity.location?.primary_type ?? "";

  const openingHoursLines = placeView?.openingHoursLines ?? [];

  const staySentence = formatStaySentence(activity.location?.stay_duration);
  const priceRangeText = formatPriceRange(activity.location?.price_range);
  const hasBottomDetails = Boolean(staySentence || priceRangeText);

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
    if (locationId) {
    }
  };

  const handleOpenGoogleMaps = () => {
    const uri =
      placeView?.googleMapsUri ??
      (activity.location?.latitude != null && activity.location?.longitude != null
        ? `https://www.google.com/maps/search/?api=1&query=${activity.location.latitude},${activity.location.longitude}`
        : null);
    if (uri) window.open(uri, "_blank", "noopener,noreferrer");
  };

  // A blank note to back the editor when this activity has none yet. Stable per
  // activity so the editor doesn't reset its draft on unrelated re-renders.
  const editorNote = useMemo<ActivityNote>(
    () =>
      note ?? {
        id: activity.id,
        content: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    [note, activity.id],
  );

  // ── Single-note editor takeover (FE-124) ──
  if (noteEditing) {
    return (
      <div
        data-slot="location-detail-note"
        data-region="itinerary-edit-panel-note"
        className={cn("location-detail-note h-full", className)}
      >
        <NoteEditor
          note={editorNote}
          showControls={false}
          showLastEdited
          onSave={(n) => onNoteSave?.(n)}
          onClear={onNoteClear}
          onBack={() => onEditingNoteChange?.(false)}
          backRef={noteBackRef}
        />
      </div>
    );
  }

  return (
    <div
      data-slot="location-detail-panel"
      data-region="location-detail-panel"
      className={cn("location-detail-panel flex flex-col gap-3", className)}
      aria-busy={loading || undefined}
    >
      {/* Location Context */}
      {(loading || placeView?.description || primaryType || placeView) && (
        <div className="location-detail-context-section flex flex-col gap-2">
          {placeView?.description ? (
            <p className="location-detail-context type-body-2 text-content-secondary">
              {placeView.description}
            </p>
          ) : loading ? (
            /* Context blurb is AI-generated server-side — skeleton it until it lands. */
            <div className="location-detail-context-skeleton flex flex-col gap-2" aria-hidden="true">
              <div className="h-4 w-full animate-pulse rounded-md bg-surface-muted" />
              <div className="h-4 w-2/3 animate-pulse rounded-md bg-surface-muted" />
            </div>
          ) : null}
          {/* Tags + Google Maps */}
          <div className="location-detail-primary-type-row flex items-start justify-between gap-2">
            {primaryType ? (
              <div className="location-detail-primary-type flex flex-wrap items-center gap-2">
                <Pill type="default" className="cursor-default">
                  {humanizePlaceType(primaryType)}
                </Pill>
              </div>
            ) : loading ? (
              <div className="h-6 w-24 animate-pulse rounded-full bg-surface-muted" aria-hidden="true" />
            ) : null}
            <Button
              variant="outline"
              size="sm"
              icon="leading"
              onClick={handleOpenGoogleMaps}
              className="location-detail-maps-button shrink-0"
            >
              <MapPin className="size-4" />
              Google Maps
            </Button>
          </div>
        </div>
      )}

      {/* Image Gallery Skeleton — shown while enriching when no photo arrived yet */}
      {photoUrls.length === 0 && loading && (
        <div
          className="location-detail-gallery-skeleton flex h-[352px] flex-col gap-2"
          aria-hidden="true"
        >
          <div className="flex-1 min-h-0 animate-pulse rounded-xl bg-surface-muted" />
          <div className="flex flex-1 min-h-0 gap-2">
            <div className="flex-1 animate-pulse rounded-xl bg-surface-muted" />
            <div className="flex-1 animate-pulse rounded-xl bg-surface-muted" />
          </div>
        </div>
      )}

      {/* Image Gallery */}
      {photoUrls.length > 0 && (
        <div className="location-detail-gallery flex h-[352px] flex-col gap-2">
          {/* Main Image */}
          <button
            type="button"
            onClick={() => openLightbox(0)}
            className="location-detail-gallery-main relative flex-1 min-h-0 w-full overflow-hidden rounded-xl bg-surface-alt outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-edge-strong"
          >
            <img
              src={photoUrls[0]}
              alt={activity.name}
              className="absolute inset-0 size-full object-cover"
            />
            <PlacePhotoAttribution attributions={photoAttributions} />
          </button>
          {/* Sub Images */}
          {photoUrls.length > 1 && (
            <div className="location-detail-gallery-sub flex flex-1 min-h-0 w-full gap-2">
              {[1, 2].map((index) =>
                photoUrls[index] ? (
                  <button
                    key={index}
                    type="button"
                    onClick={() => openLightbox(index)}
                    className="location-detail-gallery-cell relative flex-1 min-w-0 h-full overflow-hidden rounded-xl bg-surface-alt outline-none cursor-pointer focus-visible:ring-2 focus-visible:ring-edge-strong"
                  >
                    <img
                      src={photoUrls[index]}
                      alt={`${activity.name} - ${index + 1}`}
                      className="absolute inset-0 size-full object-cover"
                    />
                    {index === 2 && extraImageCount > 0 && (
                      <span className="location-detail-gallery-more absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/50 to-transparent p-3">
                        <span className="flex items-center gap-1.5 type-body-2 font-medium text-white">
                          <Images className="size-4" />+{extraImageCount} more
                        </span>
                      </span>
                    )}
                  </button>
                ) : (
                  <div
                    key={index}
                    className="location-detail-gallery-placeholder flex-1 min-w-0 h-full rounded-xl bg-surface-alt"
                  />
                ),
              )}
            </div>
          )}
        </div>
      )}

      {/* Detail Rows */}
      {(loading ||
        placeView?.address ||
        openingHoursLines.length > 0 ||
        placeView?.phone ||
        placeView?.website ||
        hasBottomDetails) && (
        <div className="location-detail-rows flex flex-col px-2">
          {/* Address */}
          {placeView?.address && (
            <div className="location-detail-address">
              <DetailRow layout="inline" showLabel={false} icon={MapPin} label="Address" value={placeView.address} />
            </div>
          )}

          {/* Opening Hours (full week, expandable) — skeleton until enrichment lands */}
          {openingHoursLines.length > 0 ? (
            <OpeningHoursAccordion lines={openingHoursLines} />
          ) : loading ? (
            <SkeletonRow width="w-2/3" />
          ) : null}

          {/* Phone */}
          {placeView?.phone ? (
            <div className="location-detail-phone">
              <DetailRow layout="inline" showLabel={false} icon={Phone} label="Phone" value={placeView.phone} />
            </div>
          ) : loading ? (
            <SkeletonRow width="w-1/2" />
          ) : null}

          {/* Website */}
          {placeView?.website ? (
            <div className="location-detail-website">
              <DetailRow
                layout="inline"
                showLabel={false}
                icon={Globe}
                label="Website"
                value={
                  <a
                    href={placeView.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="location-detail-website-link text-content-info hover:underline"
                  >
                    {formatDisplayUrl(placeView.website)}
                  </a>
                }
              />
            </div>
          ) : loading ? (
            <SkeletonRow width="w-3/5" />
          ) : null}

          {(hasBottomDetails || loading) && <Separator className="my-1" />}

          {/* Stay Duration — AI-estimated server-side; skeleton until it lands */}
          {staySentence ? (
            <InfoRow icon={Hourglass} className="location-detail-stay-duration">
              {staySentence}
            </InfoRow>
          ) : loading ? (
            <SkeletonRow width="w-3/4" />
          ) : null}

          {/* Price Range */}
          {priceRangeText && (
            <InfoRow icon={Wallet} className="location-detail-price-range">
              {priceRangeText}
            </InfoRow>
          )}
        </div>
      )}

      {/* Also Found In Section */}
      {hasReferences && (
        <div
          data-region="location-detail-also-found-in"
          className="location-detail-also-found-in flex flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-alt p-3"
        >
          <p className="location-detail-also-found-in-label type-body-2 font-medium text-content">
            Also found in:
          </p>
          <div className="location-detail-also-found-in-list flex flex-col items-center gap-2">
            {previewReferences.map((ref) => (
              <AlsoInCard
                key={`${ref.type}-${ref.id}`}
                title={ref.name}
                type={ref.type}
                count={ref.locationCount}
                countLabel="Locations"
                thumbnailUrl={ref.thumbnailUrl ?? undefined}
                className="w-full border-edge"
              />
            ))}
            {references.length > previewReferences.length && (
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  setAlsoFoundInOpen(true);
                }}
                className="location-detail-also-found-in-more"
              >
                Show more
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Image Lightbox */}
      {photoUrls.length > 0 && (
        <ImageLightbox
          images={photoUrls}
          alt={activity.name}
          initialIndex={lightboxIndex}
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
        />
      )}

      {/* Also Found In Modal */}
      <AlsoFoundInModal
        open={alsoFoundInOpen}
        onOpenChange={setAlsoFoundInOpen}
        location={{
          name: activity.name,
          description: activity.location?.location_context,
          thumbnailUrl: photoUrls[0] ?? null,
        }}
        references={references}
        loading={referencesLoading}
      />
    </div>
  );
}

LocationDetailPanel.displayName = "LocationDetailPanel";

export type { LocationDetailPanelProps };
