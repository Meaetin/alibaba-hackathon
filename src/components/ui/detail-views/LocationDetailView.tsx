"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import {
  ChevronDown,
  ChevronLeft,
  Globe,
  Hourglass,
  Images,
  Lightbulb,
  MapPin,
  MoreVertical,
  Phone,
  Sparkles,
  UtensilsCrossed,
  Wallet,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { googleMapsPlaceUrl } from "@/lib/maps/google-maps-url";
import { humanizePlaceType } from "@/lib/utils/formatters";
import {
  formatDisplayUrl,
  formatPriceRange,
  formatStaySentence,
  type PriceRange,
} from "@/lib/utils/location-detail";
import { Button } from "@/components/ui/primitives/Button";
import { Separator } from "@/components/ui/primitives/Separator";
import { Sheet } from "@/components/ui/primitives/Sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/primitives/Popover";
import { SearchBar } from "@/components/ui/primitives/SearchBar";
import { AlsoInCard } from "@/components/ui/detail-views/AlsoInCard";
import { OpeningHoursAccordion } from "@/components/ui/detail-views/OpeningHoursAccordion";
import { ImageLightbox } from "@/components/ui/modals/ImageGallery";
import { NewCollectionModal } from "@/components/ui/modals/NewCollectionModal";
import { useLocationReferencesQuery } from "@/hooks/queries/useLocationReferencesQuery";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/queryKeys";
import { useBreakpoint } from "@/hooks/useMediaQuery";
import type { StopContent } from "@/lib/planner/narrate";
import type { LocationReference } from "@/lib/domain-types";
import type { MapClusterData } from "@/components/ui/map/StaticMap";

const StaticMap = dynamic(
  () => import("@/components/ui/map/StaticMap").then((mod) => mod.StaticMap),
  { ssr: false },
);

interface LocationDetailViewData {
  name: string;
  images: string[];
  /** AI-generated location context ("what this place is famous for"). */
  description: string;
  address: string;
  /** Google `weekdayDescriptions` (Monday-first); rendered as an expandable week. */
  openingHoursLines: string[];
  phone: string;
  website: string;
  /** Recommended visit duration in minutes; phrased as a sentence in the view. */
  stayDurationMinutes: number | null;
  /** Parsed Google Places per-person price range. */
  priceRange: PriceRange | null;
  primaryType: string;
  latitude: number;
  longitude: number;
  googleMapsUri: string | null;
  /** Google place id. Lets the Maps link name the place when `googleMapsUri` is
   *  null — which it is for everything retrieved before that field was on the
   *  search mask. Without it the link drops an unlabelled pin on a coordinate. */
  placeId?: string | null;
  /** Pass C's prose for this stop, written for this traveller and this day.
   *  Absent on a place viewed outside an itinerary. */
  stopContent?: StopContent | null;
}

interface LocationDetailViewCollection {
  id: string;
  name: string;
  /** Number of locations, rendered as "N Locations". */
  locationCount?: number;
  /** Cover image URL; falls back to a muted placeholder when absent. */
  thumbnailUrl?: string;
}

/** Itinerary offered in the footer "Add to" menu. Adding writes into the
 *  itinerary's backing collection (handled by the caller's onSaveToItinerary). */
type LocationDetailViewItinerary = LocationDetailViewCollection;

/** A footer menu entry tagged with its kind so Add can route to the right
 *  callback and optimistically insert the correct "Also found in" reference. */
type SaveTarget =
  | ({ type: "Collection" } & LocationDetailViewCollection)
  | ({ type: "Itinerary" } & LocationDetailViewItinerary);

interface LocationDetailViewProps {
  location: LocationDetailViewData;
  onBack: () => void;
  /**
   * Canonical `locations.id`. Drives the sidebar "Also found in" list of other
   * collections/itineraries containing this place; omit (or pass null) when the
   * location isn't persisted and the section should stay hidden.
   */
  locationId?: string | null;
  /** Current itinerary id — excluded from the "Also found in" cross-references. */
  excludeItineraryId?: string;
  /** Current collection id — excluded from the "Also found in" cross-references. */
  excludeCollectionId?: string;
  /** Collections offered in the footer "Add to" menu (same list as the toolbar). */
  collections?: LocationDetailViewCollection[];
  /** Itineraries offered in the footer "Add to" menu (same list as the toolbar). */
  itineraries?: LocationDetailViewItinerary[];
  /** Called with the chosen collection id when the user clicks Add. */
  onSaveToCollection?: (collectionId: string) => void | Promise<void>;
  /** Called with the chosen itinerary id when the user clicks Add. */
  onSaveToItinerary?: (itineraryId: string) => void | Promise<void>;
  /**
   * Create a new collection inline from the save picker (UXR-013). Receives the
   * NewCollectionModal form data; must perform the real create and resolve with
   * the new collection's `{ id, name }` so this location can be saved straight
   * into it. When omitted, the "Add to new collection" row is hidden.
   */
  onCreateCollection?: (data: {
    name: string;
    country?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    tags?: string[];
  }) => Promise<{ id: string; name: string } | null | void>;
  className?: string;
}

function DetailRow({
  icon: Icon,
  text,
  wrap = false,
  className,
  children,
}: {
  icon: LucideIcon;
  text?: string;
  /** Allow the value to wrap over multiple lines instead of truncating. */
  wrap?: boolean;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("location-detail-view-row flex w-full items-start gap-1.5 py-3", className)}>
      <div className="location-detail-view-row-icon flex size-5 shrink-0 items-center justify-center">
        <Icon className="size-4 text-glyph" aria-hidden="true" />
      </div>
      <div
        className={cn(
          "location-detail-view-row-text type-body-2 font-medium text-content flex-1 min-w-0",
          !wrap && "truncate",
        )}
      >
        {children ?? text}
      </div>
    </div>
  );
}

function GalleryCell({
  src,
  alt,
  className,
  onClick,
  children,
}: {
  src: string;
  alt: string;
  className?: string;
  onClick: () => void;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "location-gallery-cell relative overflow-hidden rounded-xl bg-surface-alt cursor-pointer",
        "outline-none focus-visible:ring-2 focus-visible:ring-edge-strong",
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="absolute inset-0 size-full object-cover" />
      {children}
    </button>
  );
}

function LocationDetailView({
  location,
  onBack,
  locationId,
  excludeItineraryId,
  excludeCollectionId,
  collections = [],
  itineraries = [],
  onSaveToCollection,
  onSaveToItinerary,
  onCreateCollection,
  className,
}: LocationDetailViewProps) {
  const queryClient = useQueryClient();
  const { isPhone } = useBreakpoint();
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedTarget, setSelectedTarget] = useState<SaveTarget | null>(null);
  // Inline create-collection (UXR-013): modal open + its controlled name field,
  // seeded from the picker search so a typed query carries into the create flow.
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  // "Also found in" — other collections/itineraries containing this location.
  const referencesExclude = {
    itineraryId: excludeItineraryId,
    collectionId: excludeCollectionId,
  };
  const { data: references = [], isLoading: referencesLoading } =
    useLocationReferencesQuery(locationId, referencesExclude);
  const hasReferences = references.length > 0;

  useEffect(() => {
    if (!isPhone || !menuOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      if (
        target.closest(".location-save-target-sheet") ||
        target.closest(".location-detail-view-add-input")
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      setMenuOpen(false);
    };

    document.addEventListener("pointerdown", handlePointerDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [isPhone, menuOpen]);

  // Collections + itineraries offered in the footer "Add to" menu.
  const saveTargets: SaveTarget[] = [
    ...collections.map((c) => ({ type: "Collection" as const, ...c })),
    ...itineraries.map((i) => ({ type: "Itinerary" as const, ...i })),
  ];
  const filteredTargets = query
    ? saveTargets.filter((t) =>
        t.name.toLowerCase().includes(query.toLowerCase()),
      )
    : saveTargets;

  // Typed search text, used to seed the new-collection name in the modal.
  const trimmedQuery = query.trim();

  // Save this location into a collection/itinerary, optimistically slotting it
  // into "Also found in" and reconciling with the server once the write lands.
  const saveLocationTo = async (target: SaveTarget) => {
    if (locationId) {
      const key = queryKeys.locationReferences(locationId, referencesExclude);
      queryClient.setQueryData<LocationReference[]>(key, (old = []) => {
        if (old.some((r) => r.type === target.type && r.id === target.id)) return old;
        const optimistic: LocationReference = {
          id: target.id,
          type: target.type,
          name: target.name,
          locationCount: (target.locationCount ?? 0) + 1,
          thumbnailUrl: target.thumbnailUrl ?? null,
        };
        return [optimistic, ...old];
      });
    }

    if (target.type === "Collection") {
      await onSaveToCollection?.(target.id);
    } else {
      await onSaveToItinerary?.(target.id);
    }

    // Reconcile names/counts (and drop the row if the write failed) with truth.
    if (locationId) {
      queryClient.invalidateQueries({
        queryKey: ["locationReferences", locationId],
      });
    }
  };

  // Add the currently-selected target via the footer Add button.
  const handleAddToTarget = async () => {
    if (!selectedTarget) return;
    const target = selectedTarget;
    setSelectedTarget(null);
    await saveLocationTo(target);
  };

  // Open the create-collection modal, seeding its name from the picker search.
  const handleOpenCreateModal = () => {
    setCreateName(trimmedQuery);
    setMenuOpen(false);
    setCreateModalOpen(true);
  };

  // UXR-013: completing the modal creates the collection AND saves this location
  // straight into it — no second "Add" step. Resolves with the new collection so
  // we can route the save to its real id.
  const handleCreateSubmit = async (data: {
    name: string;
    country?: string;
    region?: string;
    latitude?: number;
    longitude?: number;
    tags?: string[];
  }) => {
    const created = await onCreateCollection?.(data);
    setQuery("");
    setCreateName("");
    setCreateModalOpen(false);
    if (created?.id) {
      await saveLocationTo({
        type: "Collection",
        id: created.id,
        name: created.name,
        locationCount: 0,
      });
    }
  };

  const openLightbox = (index: number) => {
    setLightboxIndex(index);
    setLightboxOpen(true);
    if (locationId) {
    }
  };

  const mapCluster: MapClusterData[] = [
    {
      id: "detail-pin",
      count: 1,
      label: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      variant: "by Location",
      size: "Small",
      state: "Default",
      filterValue: "detail-pin",
    },
  ];

  const handleOpenGoogleMaps = () => {
    const url = googleMapsPlaceUrl({
      googleMapsUri: location.googleMapsUri,
      placeId: location.placeId,
      name: location.name,
      latitude: location.latitude || null,
      longitude: location.longitude || null,
    });
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  };

  // Pass C writes four things per stop. The itinerary card shows the first,
  // clamped to two lines, and nothing showed the other three — so they land
  // here, where a traveller comes for the detail.
  const whyForYou = location.stopContent?.whyForYou?.trim() || null;
  const highlights = location.stopContent?.highlights?.filter((h) => h.trim()) ?? [];
  const foodRecommendations =
    location.stopContent?.foodRecommendations?.filter((f) => f.dish.trim()) ?? [];
  const tips = location.stopContent?.tips?.filter((t) => t.trim()) ?? [];

  const extraImageCount = location.images.length - 3;

  const openingHoursLines = location.openingHoursLines;

  const staySentence = formatStaySentence(location.stayDurationMinutes);
  const priceRangeText = formatPriceRange(location.priceRange);
  const hasBottomDetails = Boolean(staySentence || priceRangeText);

  const renderSaveTargetPicker = (className?: string) => (
    <div className={cn("flex flex-col gap-1", className)}>
      <div className="p-3">
        <SearchBar
          placeholder="Search"
          className="w-full"
          autoFocus
          onSearch={setQuery}
        />
      </div>
      <Separator orientation="horizontal" />
      {/* New Collection Row — opens the real NewCollectionModal (UXR-013) */}
      {onCreateCollection && (
        <button
          type="button"
          onClick={handleOpenCreateModal}
          className={cn(
            "group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors",
            "hover:bg-surface-muted focus-visible:bg-surface-muted",
          )}
        >
          {/* Empty collection cover — the 2×2 image-grid shape, all gray */}
          <span className="flex size-9 shrink-0 rounded-lg border border-edge bg-surface p-0.5">
            <span className="grid size-full grid-cols-2 grid-rows-2 gap-[2px] overflow-hidden rounded-md">
              {Array.from({ length: 4 }).map((_, i) => (
                <span key={i} className="bg-surface-muted" />
              ))}
            </span>
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="type-body-2 font-medium text-content">
              {trimmedQuery
                ? `Add to "${trimmedQuery}"`
                : "Add to new collection"}
            </span>
            <span className="type-body-3 text-content-secondary">
              Your place to organize spots
            </span>
          </span>
        </button>
      )}
      {/* Collections + Itineraries List */}
      {filteredTargets.length > 0 ? (
        <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
          {filteredTargets.map((target) => (
            <AlsoInCard
              key={`${target.type}-${target.id}`}
              title={target.name}
              type={target.type}
              count={target.locationCount}
              countLabel="Locations"
              thumbnailUrl={target.thumbnailUrl}
              className="w-full"
              role="button"
              onClick={() => {
                setSelectedTarget(target);
                setMenuOpen(false);
              }}
            />
          ))}
        </div>
      ) : !onCreateCollection ? (
        <p className="px-3 py-2 type-body-2 text-content-secondary">
          No collections or itineraries found
        </p>
      ) : null}
    </div>
  );

  const addToDestinationTrigger = (
    <>
      <span className="location-detail-view-add-thumbnail flex h-7 w-[22px] shrink-0 flex-col rounded-md border border-edge bg-surface p-0.5">
        <span className="flex-1 rounded-[4px] border border-edge bg-surface-alt" />
      </span>
      <span
        className={cn(
          "flex-1 min-w-0 truncate type-body-2 text-left",
          selectedTarget ? "text-content" : "text-content-placeholder",
        )}
      >
        {selectedTarget?.name ?? "Select Collection or Itinerary"}
      </span>
      <ChevronDown className="size-4 shrink-0 text-glyph" aria-hidden="true" />
    </>
  );

  const renderAddToDestination = (className?: string) => (
    <div
      data-region="location-detail-add"
      className={cn(
        "location-detail-view-sidebar-footer flex w-full items-center gap-3",
        className,
      )}
    >
      {isPhone ? (
        <>
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            className="location-detail-view-add-input flex h-11 flex-1 min-w-0 items-center gap-1.5 rounded-xl border border-edge bg-surface px-2 text-left outline-none focus-visible:border-edge-strong"
          >
            {addToDestinationTrigger}
          </button>
          <Sheet
            side="bottom"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            title="Select collection or itinerary"
            className="location-save-target-sheet z-[70] max-h-[70dvh] p-2"
          >
            <div
              aria-hidden="true"
              className="mx-auto my-1 h-1 w-11 shrink-0 rounded-full bg-surface-muted-active"
            />
            {renderSaveTargetPicker("max-h-[calc(70dvh-1rem)] overflow-y-auto")}
          </Sheet>
        </>
      ) : (
        <Popover open={menuOpen} onOpenChange={setMenuOpen}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className="location-detail-view-add-input flex h-11 flex-1 min-w-0 items-center gap-1.5 rounded-xl border border-edge bg-surface px-2 text-left outline-none focus-visible:border-edge-strong"
              />
            }
          >
            {addToDestinationTrigger}
          </PopoverTrigger>
          {/* Save To Menu */}
          <PopoverContent
            side="top"
            align="start"
            sideOffset={8}
            className="w-[min(20rem,calc(100vw-2rem))] gap-1 rounded-2xl p-2"
          >
            {renderSaveTargetPicker()}
          </PopoverContent>
        </Popover>
      )}
      <Button
        variant="dark"
        size="md"
        disabled={!selectedTarget}
        onClick={handleAddToTarget}
      >
        Add
      </Button>
    </div>
  );

  return (
    <div
      data-slot="location-detail-view"
      className={cn(
        "location-detail-view flex h-auto w-full flex-col overflow-hidden rounded-2xl border border-edge bg-surface",
        "md:h-[640px] md:flex-row",
        "animate-in fade-in slide-in-from-top-6 duration-[var(--motion-duration-slow)] ease-[var(--motion-ease-standard)]",
        className,
      )}
    >
      {/* Main Content */}
      <div className="location-detail-view-main flex flex-1 min-w-0 flex-col gap-3 overflow-visible p-3 md:overflow-hidden">
        {/* Header Row */}
        <div className="location-detail-view-header flex w-full flex-wrap items-center gap-2 md:gap-3">
          <Button variant="outline" size="sm" icon="only" aria-label="Back" onClick={onBack}>
            <ChevronLeft className="size-4" />
          </Button>
          <h2 className="location-detail-view-title type-body-1 font-medium text-glyph flex-1 basis-[11rem] min-w-0 truncate">
            {location.name}
          </h2>
          {location.primaryType && (
            <div className="location-detail-view-primary-type flex max-h-9 flex-wrap gap-2 overflow-hidden">
              <span className="location-detail-view-primary-type-pill flex h-9 items-center rounded-full border border-edge bg-surface-alt px-3 type-body-2 font-medium text-glyph whitespace-nowrap">
                {humanizePlaceType(location.primaryType)}
              </span>
            </div>
          )}
          <Button variant="outline" size="sm" icon="leading" onClick={handleOpenGoogleMaps}>
            <MapPin className="size-4" />
            Google Maps
          </Button>
        </div>

        {/* Body Row */}
        <div className="location-detail-view-body flex flex-1 min-h-0 w-full flex-col gap-3 md:flex-row">
          {/* Image Gallery */}
          <div className="location-gallery flex h-[300px] min-h-0 min-w-0 flex-col gap-2 md:h-auto md:flex-1">
            {/* Main Image */}
            {location.images[0] ? (
              <GalleryCell
                src={location.images[0]}
                alt={location.name}
                className="flex-1 min-h-0 w-full"
                onClick={() => openLightbox(0)}
              />
            ) : (
              <div className="location-gallery-placeholder flex-1 min-h-0 w-full rounded-xl bg-surface-alt" />
            )}
            {/* Sub Images */}
            {location.images.length > 1 && (
              <div className="location-gallery-sub flex flex-1 min-h-0 w-full gap-2">
                {[1, 2].map((index) =>
                  location.images[index] ? (
                    <GalleryCell
                      key={index}
                      src={location.images[index]}
                      alt={`${location.name} - ${index + 1}`}
                      className="flex-1 min-w-0 h-full"
                      onClick={() => openLightbox(index)}
                    >
                      {index === 2 && extraImageCount > 0 && (
                        <span className="location-gallery-more absolute inset-0 flex items-end justify-end bg-gradient-to-t from-black/50 to-transparent p-3">
                          <span className="flex items-center gap-1.5 type-body-2 font-medium text-white">
                            <Images className="size-4" />
                            +{extraImageCount} more
                          </span>
                        </span>
                      )}
                    </GalleryCell>
                  ) : (
                    <div
                      key={index}
                      className="location-gallery-placeholder flex-1 min-w-0 h-full rounded-xl bg-surface-alt"
                    />
                  ),
                )}
              </div>
            )}
          </div>

          {/* Info Column */}
          <div className="location-detail-view-info flex min-h-0 w-full flex-col gap-3 md:w-[380px] md:shrink-0">
            {/* Map */}
            <div className="location-detail-view-map h-[160px] w-full shrink-0 overflow-hidden rounded-xl border border-edge p-1 md:h-[140px]">
              <div className="relative size-full overflow-hidden rounded-lg border border-edge bg-surface-alt">
                {location.latitude !== 0 && location.longitude !== 0 && (
                  <StaticMap
                    clusters={mapCluster}
                    height="100%"
                    className="border-0 rounded-lg"
                    fitBounds
                  />
                )}
              </div>
            </div>

            {/* Why This Stop */}
            {(whyForYou || highlights.length > 0 || foodRecommendations.length > 0 || tips.length > 0) && (
              <div className="location-detail-view-why mx-2 flex flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-alt p-3">
                {whyForYou && (
                  <div className="location-detail-view-why-lead flex gap-2">
                    <Sparkles className="size-4 shrink-0 translate-y-0.5 text-glyph-secondary" />
                    <p className="location-detail-view-why-text type-body-2 text-content">{whyForYou}</p>
                  </div>
                )}

                {highlights.length > 0 && (
                  <ul className="location-detail-view-highlights flex flex-col gap-1.5">
                    {highlights.map((highlight) => (
                      <li
                        key={highlight}
                        className="location-detail-view-highlight flex gap-2 type-body-3 text-content-secondary"
                      >
                        <span aria-hidden="true" className="text-glyph-secondary">
                          &bull;
                        </span>
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {foodRecommendations.length > 0 && (
                  <div className="location-detail-view-food flex flex-col gap-1.5">
                    {foodRecommendations.map((item) => (
                      <div key={item.dish} className="location-detail-view-food-item flex gap-2">
                        <UtensilsCrossed className="size-4 shrink-0 translate-y-0.5 text-glyph-secondary" />
                        <p className="type-body-3 text-content-secondary">
                          <span className="font-medium text-content">{item.dish}</span>
                          {item.note ? ` — ${item.note}` : null}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                {tips.length > 0 && (
                  <div className="location-detail-view-tips flex flex-col gap-1.5">
                    {tips.map((tip) => (
                      <div key={tip} className="location-detail-view-tip flex gap-2">
                        <Lightbulb className="size-4 shrink-0 translate-y-0.5 text-glyph-secondary" />
                        <p className="type-body-3 text-content-secondary">{tip}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Description — Google's blurb for everyone, under the one written
                for this traveller. */}
            {location.description && (
              <p className="location-detail-view-description px-2 type-body-2 font-medium text-glyph">
                {location.description}
              </p>
            )}

            {/* Detail Rows */}
            <div className="location-detail-view-rows flex flex-col px-2 md:flex-1 md:min-h-0 md:overflow-y-auto">
              {/* Address */}
              {location.address && (
                <div className="location-detail-view-address">
                  <DetailRow icon={MapPin} text={location.address} />
                </div>
              )}

              {/* Opening Hours (full week, expandable) */}
              <OpeningHoursAccordion lines={openingHoursLines} />

              {/* Phone */}
              {location.phone && (
                <div className="location-detail-view-phone">
                  <DetailRow icon={Phone} text={location.phone} />
                </div>
              )}

              {/* Website */}
              {location.website && (
                <div className="location-detail-view-website">
                  <DetailRow icon={Globe}>
                    <a
                      href={location.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="location-detail-view-website-link block truncate text-content-info hover:underline"
                    >
                      {formatDisplayUrl(location.website)}
                    </a>
                  </DetailRow>
                </div>
              )}

              {hasBottomDetails && <Separator className="my-1 w-full" />}

              {/* Stay Duration */}
              {staySentence && (
                <div className="location-detail-view-stay-duration">
                  <DetailRow icon={Hourglass} text={staySentence} wrap />
                </div>
              )}

              {/* Price Range */}
              {priceRangeText && (
                <div className="location-detail-view-price-range">
                  <DetailRow icon={Wallet} text={priceRangeText} wrap />
                </div>
              )}
            </div>
          </div>
        </div>

        {isPhone &&
          renderAddToDestination(
            "sticky bottom-0 z-10 -mx-3 w-auto border-t border-edge bg-surface px-3 py-3 md:hidden",
          )}
      </div>

      {/* Sidebar */}
      <div className="location-detail-view-sidebar hidden shrink-0 flex-col border-l border-edge md:flex md:w-[300px] md:gap-3 md:p-3 lg:w-[380px] lg:gap-6 lg:p-6">
        {/* Sidebar Header */}
        <div className="location-detail-view-sidebar-header flex w-full items-center gap-3">
          {hasReferences && (
            <p className="location-detail-view-also-found-in-label type-body-2 font-medium text-content flex-1 min-w-0">
              Also found in:
            </p>
          )}
          <Button
            variant="ghost"
            size="sm"
            icon="only"
            aria-label="More options"
            className="ml-auto"
          >
            <MoreVertical className="size-4" />
          </Button>
        </div>

        {hasReferences ? (
          /* Also Found In List */
          <div
            data-region="location-detail-also-found-in"
            className="location-detail-view-also-found-in flex w-full flex-1 min-h-0 flex-col gap-3 overflow-y-auto"
          >
            {references.map((ref) => (
              <AlsoInCard
                key={`${ref.type}-${ref.id}`}
                title={ref.name}
                type={ref.type}
                count={ref.locationCount}
                countLabel="Locations"
                thumbnailUrl={ref.thumbnailUrl ?? undefined}
                className="w-full"
              />
            ))}
          </div>
        ) : referencesLoading ? (
          /* Loading State — keep the footer pinned while the query is in flight */
          <div className="location-detail-view-sidebar-loading w-full flex-1 min-h-0" />
        ) : (
          /* Empty State */
          <div className="location-detail-view-sidebar-empty flex w-full flex-1 min-h-0 flex-col items-center justify-center">
            <div className="flex w-[245px] flex-col items-center gap-3 pb-6 text-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/images/stickers/Bookmark.svg"
                alt=""
                aria-hidden="true"
                className="h-16 w-auto"
              />
              <div className="flex w-full flex-col gap-1">
                <p className="type-body-1 font-medium text-glyph">Not saved anywhere yet</p>
                <p className="type-body-2 text-content-secondary">
                  Add into your collection or itinerary.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Add to Destination */}
        {!isPhone && renderAddToDestination()}
      </div>

      {/* New Collection Modal — the real design-system create flow (UXR-013) */}
      {onCreateCollection && (
        <NewCollectionModal
          open={createModalOpen}
          onOpenChange={(open) => {
            if (!open) setCreateName("");
            setCreateModalOpen(open);
          }}
          collectionValue={createName}
          onCollectionChange={setCreateName}
          onSubmit={handleCreateSubmit}
          onCancel={() => {
            setCreateName("");
            setCreateModalOpen(false);
          }}
        />
      )}

      {/* Image Lightbox */}
      <ImageLightbox
        images={location.images}
        alt={location.name}
        initialIndex={lightboxIndex}
        open={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
      />
    </div>
  );
}

LocationDetailView.displayName = "LocationDetailView";

export { LocationDetailView };
export type {
  LocationDetailViewProps,
  LocationDetailViewData,
  LocationDetailViewCollection,
  LocationDetailViewItinerary,
};
