"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { MousePointer2, Sparkles, MoreVertical, Trash2, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/primitives/Button";
import { Menu, MenuContent, MenuItem, MenuTrigger } from "@/components/ui/primitives/Menu";
import { Sheet } from "@/components/ui/primitives/Sheet";
import { LocationCard } from "@/components/ui";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { LocationDetailView } from "@/components/ui/detail-views/LocationDetailView";
import { useNavbarFilter } from "@/contexts/NavbarFilterContext";
import { cn } from "@/lib/utils";
import { scrollScrollableAncestorToTop } from "@/lib/utils/scroll";
import { formatDisplayUrl } from "@/lib/utils/location-detail";
import { useToast } from "@/contexts/ToastContext";
import { useRubberBandSelection } from "@/hooks/useRubberBandSelection";
import { useQuotaGate } from "@/hooks/useQuotaGate";
import { useLinkDetailsDial } from "@/hooks/useLinkDetailsDial";
import { useCollectionLocationBatchOperations } from "@/hooks/useCollectionLocationBatchOperations";
import { useJobsQueue } from "@/hooks/useJobsQueue";
import { useSessionUserId } from "@/hooks/useSessionUserId";
import { ActionToolbar, type ActionToolbarItinerary } from "@/components/ui/dashboard/ActionToolbar";
import { NewItineraryModal } from "@/components/ui/modals/NewItineraryModal";
import {
  createCollection,
  getCollections,
  type CollectionWithRole,
} from "@/lib/api/collections";
import { getFriendlyApiError } from "@/lib/errors/userMessages";
import { deleteContent, getContentDetail } from "@/lib/api/content";
import { toLinkDetail, toLinkLocations, type LinkDetail, type LinkLocationItem } from "@/lib/links/detail-view";
import { ItineraryQuotaError, getItineraries, type ItineraryWithRole } from "@/lib/api/itineraries";
import { ItineraryLoadingScreen } from "@/components/ui/itinerary/ItineraryLoadingScreen";
import type { MapClusterData } from "@/components/ui/map/StaticMap";
import { useRecordView } from "@/hooks/useRecordView";
import { useHighlightLocation } from "@/hooks/useHighlightLocation";
import { useBreakpoint } from "@/hooks/useMediaQuery";

const StaticMap = dynamic(
  () => import("@/components/ui/map/StaticMap").then((mod) => mod.StaticMap),
  { ssr: false },
);

// ───── Types ────────────────────────────────────────────────────────────────

/** Both shapes, and the mapping that fills them, live in
 *  `src/lib/links/detail-view.ts` — a `page.tsx` may only export its default
 *  component, so a mapper written here could never be tested. */
type LocationItem = LinkLocationItem;



type SelectedLocation = LocationItem;

export default function LinkDetailPage() {
  const { showToast } = useToast();
  const { showQuotaToast } = useQuotaGate();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const contentId = params?.id;
  const { setFilter } = useNavbarFilter();
  const userId = useSessionUserId();

  const [linkDetail, setLinkDetail] = useState<LinkDetail | null>(null);
  const [locations, setLocations] = useState<LocationItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const { isPhone } = useBreakpoint();

  useRecordView("link", contentId);
  useHighlightLocation();

  const { jobs: planningJobs, upsertJob: upsertPlanningJob } = useJobsQueue({
    type: "itinerary-planning",
    restoreFor: userId,
    onJobCompleted: (job) => {
      const itineraryId = (job.result as Record<string, unknown> | undefined)
        ?.itinerary_id as string | undefined;
      // Only redirect if the user is actively waiting on the loading screen.
      // If they chose "Continue Browsing", MainLayout's job queue
      // surfaces a "View" toast instead.
      if (isGenerating && itineraryId) {
        router.push(`/itineraries/${itineraryId}`);
        return;
      }
      setIsGenerating(false);
    },
    onJobFailed: () => {
      setIsGenerating(false);
    },
  });

  // Newest in-flight run drives the overlay's stage/ETA readout. Failed jobs are
  // pinned to the front of the queue but the overlay is torn down on failure, so
  // they're filtered out rather than shown mid-generation.
  const trackedPlanningJob = useMemo(
    () => planningJobs.find((j) => j.status !== "failed") ?? null,
    [planningJobs],
  );

  const [selectedLocation, setSelectedLocation] =
    useState<SelectedLocation | null>(null);
  const [isMapPreviewReady, setIsMapPreviewReady] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const dial = useLinkDetailsDial();
  const selection = useRubberBandSelection({
    dragThreshold: dial.drag.threshold,
  });
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [saveCollections, setSaveCollections] = useState<CollectionWithRole[]>([]);
  const [saveItineraries, setSaveItineraries] = useState<ItineraryWithRole[]>([]);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generateLocationIds, setGenerateLocationIds] = useState<string[]>([]);
  const [generateTripName, setGenerateTripName] = useState("");

  const batchOps = useCollectionLocationBatchOperations({
    source: "links",
    onRefresh: () => selection.clearSelection(),
    // Seeds the queue above. `upsertJob` is the only way an id enters it, and
    // without this the loading overlay rendered `job={null}` — a progress bar
    // that never moved and a plan that never redirected when it landed.
    onJobCreated: upsertPlanningJob,
  });

  // Collections offered in the ActionToolbar "Save to" menu.
  useEffect(() => {
    let cancelled = false;
    getCollections()
      .then((list) => {
        if (!cancelled) setSaveCollections(list.filter((c) => !c.is_archived));
      })
      .catch(() => {
        if (!cancelled) setSaveCollections([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Itineraries offered in the ActionToolbar "Save to" menu.
  //
  // Only ones with a companion collection. Saving to a trip means saving to its
  // shelf, and a trip planned before companions existed has none — offering it
  // would post places to an empty collection id and quietly store nothing.
  useEffect(() => {
    let cancelled = false;
    getItineraries()
      .then((list) => {
        if (!cancelled) {
          setSaveItineraries(list.filter((i) => !i.is_archived && !!i.collection_id));
        }
      })
      .catch(() => {
        if (!cancelled) setSaveItineraries([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Save the current selection into a collection (toolbar "Save to" menu).
  const handleSaveToCollection = useCallback(
    async (targetCollectionId: string) => {
      const locationIds = Array.from(selection.selectedIds);
      try {
        await batchOps.handleAddToDestination(targetCollectionId, locationIds);
        const target = saveCollections.find((c) => c.id === targetCollectionId);
        showToast({ title: `Added ${locationIds.length} to ${target?.name ?? "collection"}` });
      } catch (err) {
        showToast({
          title: getFriendlyApiError(err, "We couldn't add these locations."),
          variant: "error",
        });
      }
    },
    [selection.selectedIds, batchOps, saveCollections, showToast],
  );

  // Save the current selection into an itinerary's backing collection.
  const handleSaveToItinerary = useCallback(
    async (itinerary: ActionToolbarItinerary) => {
      const locationIds = Array.from(selection.selectedIds);
      try {
        await batchOps.handleAddToDestination(itinerary.collectionId, locationIds);
        showToast({ title: `Added ${locationIds.length} to ${itinerary.name}` });
      } catch (err) {
        showToast({
          title: getFriendlyApiError(err, "We couldn't add these locations."),
          variant: "error",
        });
      }
    },
    [selection.selectedIds, batchOps, showToast],
  );

  // Open the generate-itinerary flow for the current selection.
  const openGenerate = useCallback(() => {
    setGenerateLocationIds(Array.from(selection.selectedIds));
    setGenerateTripName(linkDetail?.title ?? "");
    setGenerateModalOpen(true);
  }, [selection.selectedIds, linkDetail?.title]);

  // Fetch the link and the places it named.
  //
  // A link that is not this traveller's answers 404 exactly like one that does
  // not exist — the API will not confirm that an id is real to somebody who
  // does not own it — so both land in the same "not found" branch here.
  useEffect(() => {
    if (!contentId) {
      setIsLoading(false);
      setNotFound(true);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setNotFound(false);

    getContentDetail(contentId)
      .then((detail) => {
        if (cancelled) return;
        setLinkDetail(toLinkDetail(detail));
        setLocations(toLinkLocations(detail));
        setNotFound(false);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error(`[links] ${contentId} could not be read`, error);
        setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      setFilter(null);
    };
  }, [contentId, setFilter]);

  useEffect(() => {
    type IdleWindow = Window & {
      requestIdleCallback?: (
        cb: () => void,
        opts?: { timeout: number },
      ) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const w = window as IdleWindow;
    if (w.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setIsMapPreviewReady(true), {
        timeout: 1500,
      });
      return () => w.cancelIdleCallback?.(id);
    }
    const t = window.setTimeout(() => setIsMapPreviewReady(true), 800);
    return () => window.clearTimeout(t);
  }, []);

  // Close the detail view and scroll the card it was opened from back into view.
  const closeDetailView = useCallback(() => {
    const id = selectedLocation?.id;
    setSelectedLocation(null);
    if (!id) return;
    requestAnimationFrame(() => {
      document
        .querySelector(`[data-location-id="${id}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [selectedLocation]);

  // Esc closes the detail view first, then clears any selection.
  const { clearSelection } = selection;
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (selectedLocation) {
        closeDetailView();
      } else if (selection.selectedIds.size > 0) {
        clearSelection();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [selectedLocation, selection.selectedIds.size, clearSelection, closeDetailView]);

  const handleLocationClick = (location: SelectedLocation) => {
    if (selection.consumeClickSuppression(location.id)) return;
    if (selection.selectedIds.size > 0) {
      selection.toggleItem(location.id);
      return;
    }
    setSelectedLocation(location);
    if (!isPhone) scrollScrollableAncestorToTop(scrollContainerRef.current);
  };

  const filteredAndSortedLocations = useMemo(() => {
    return locations.filter((loc) => !loc.isArchived);
  }, [locations]);

  const mapClusters = useMemo((): MapClusterData[] => {
    return filteredAndSortedLocations.map((location) => ({
      id: location.id,
      count: 1,
      label: location.name,
      latitude: location.latitude,
      longitude: location.longitude,
      variant: "by Location" as const,
      size: "Small" as const,
      state: "Default" as const,
      filterValue: location.id,
    }));
  }, [filteredAndSortedLocations]);

  const isSelectingMode =
    selection.selectedIds.size > 0 || selection.isDragging;

  // Hero "Select all" toggle: selects every location, then flips to
  // "Deselect all" once they're all selected (UXR-014).
  const allSelected =
    filteredAndSortedLocations.length > 0 &&
    selection.selectedIds.size === filteredAndSortedLocations.length;

  const { selectAll } = selection;
  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      clearSelection();
    } else {
      selectAll(filteredAndSortedLocations.map((l) => l.id));
    }
  }, [allSelected, selectAll, clearSelection, filteredAndSortedLocations]);

  // Hero "Generate" acts on EVERY location on the page (the floating
  // ActionToolbar's generate is the selection-scoped one).
  const handleGenerateAll = useCallback(() => {
    setGenerateLocationIds(filteredAndSortedLocations.map((l) => l.id));
    setGenerateTripName(linkDetail?.title ?? "");
    setGenerateModalOpen(true);
  }, [filteredAndSortedLocations, linkDetail?.title]);

  const handleDeleteLink = useCallback(async () => {
    if (!contentId) return;

    try {
      await deleteContent(contentId);
      showToast({ title: "Deleted", variant: "success" });
      router.push("/links");
    } catch (err) {
      showToast({
        title: getFriendlyApiError(err, "We couldn't delete this link."),
        variant: "error",
      });
    }
  }, [contentId, router, showToast]);

  // Add the currently-open location to a chosen collection (detail-view footer,
  // same "Save to" menu as the toolbar but scoped to this single location).
  const handleDetailSaveToCollection = useCallback(
    async (targetCollectionId: string) => {
      if (!selectedLocation) return;
      try {
        await batchOps.handleAddToDestination(targetCollectionId, [selectedLocation.id]);
        const target = saveCollections.find((c) => c.id === targetCollectionId);
        showToast({ title: `Added to ${target?.name ?? "collection"}` });
      } catch (err) {
        showToast({
          title: getFriendlyApiError(err, "We couldn't add this location."),
          variant: "error",
        });
      }
    },
    [selectedLocation, batchOps, saveCollections, showToast],
  );

  // Create a collection inline from the detail-view save picker (UXR-013), then
  // refresh the "Save to" list and hand the new id back so the location is saved
  // straight into it.
  const handleDetailCreateCollection = useCallback(
    async (data: {
      name: string;
      country?: string;
      region?: string;
      latitude?: number;
      longitude?: number;
      tags?: string[];
    }) => {
      try {
        const created = await createCollection(
          data.name,
          data.country,
          data.region,
          data.latitude,
          data.longitude,
          data.tags,
        );
        const list = await getCollections();
        setSaveCollections(list.filter((c) => !c.is_archived));
        return { id: created.id, name: created.name };
      } catch (err) {
        showToast({
          title: getFriendlyApiError(err, "We couldn't create the collection."),
          variant: "error",
        });
        return null;
      }
    },
    [showToast],
  );

  const saveMenuCollections = useMemo(
    () =>
      saveCollections.map((c) => ({
        id: c.id,
        name: c.name,
        locationCount: c.location_count,
        thumbnailUrl: c.thumbnail_url ?? c.preview_images?.[0],
      })),
    [saveCollections],
  );

  // Itineraries offered in the detail-view footer "Add to" menu.
  const saveMenuItineraries = useMemo(
    () =>
      saveItineraries.map((i) => ({
        id: i.id,
        name: i.name,
        locationCount: i.total_activities,
        thumbnailUrl: i.thumbnail_url ?? undefined,
      })),
    [saveItineraries],
  );

  // Add the currently-open location to a chosen itinerary's backing collection.
  const handleDetailSaveToItinerary = useCallback(
    async (itineraryId: string) => {
      if (!selectedLocation) return;
      const itinerary = saveItineraries.find((i) => i.id === itineraryId);
      if (!itinerary) return;
      try {
        await batchOps.handleAddToDestination(itinerary.collection_id, [selectedLocation.id]);
        showToast({ title: `Added to ${itinerary.name}` });
      } catch (err) {
        showToast({
          title: getFriendlyApiError(err, "We couldn't add this location."),
          variant: "error",
        });
      }
    },
    [selectedLocation, batchOps, saveItineraries, showToast],
  );

  const renderSelectedLocationDetail = (className?: string) => {
    if (!selectedLocation) return null;
    return (
      <LocationDetailView
        key={selectedLocation.id}
        location={{
          name: selectedLocation.name,
          images: selectedLocation.images,
          description: selectedLocation.description,
          address: selectedLocation.details.address,
          openingHoursLines: selectedLocation.details.openingHoursLines,
          phone: selectedLocation.details.phone,
          website: selectedLocation.details.website,
          stayDurationMinutes: selectedLocation.details.stayDurationMinutes,
          priceRange: selectedLocation.details.priceRange,
          primaryType: selectedLocation.primaryType,
          latitude: selectedLocation.latitude,
          longitude: selectedLocation.longitude,
          googleMapsUri: selectedLocation.googleMapsUri,
        }}
        locationId={selectedLocation.id}
        onBack={closeDetailView}
        collections={saveMenuCollections}
        itineraries={saveMenuItineraries}
        onSaveToCollection={handleDetailSaveToCollection}
        onSaveToItinerary={handleDetailSaveToItinerary}
        onCreateCollection={handleDetailCreateCollection}
        className={className}
      />
    );
  };

  return (
    <div
      data-region="link-detail-page"
      className="link-detail-page-container flex flex-col flex-1 min-h-full relative pt-[var(--navbar-height)]"
      onMouseDown={selection.handleGridMouseDown}
    >
      {/* Scrollable Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <div
          data-region="link-detail-shell"
          className="link-detail-wrapper flex flex-col items-center px-3 pt-3 pb-10 md:px-8 lg:px-12 xl:px-20 min-h-[calc(100dvh-var(--navbar-height))]"
        >
          <div
            data-region="link-detail-content"
            className="link-detail-content flex w-full max-w-[1600px] flex-col gap-6"
          >
            {selectedLocation && !isPhone ? (
              /* Location Detail Section */
              renderSelectedLocationDetail()
            ) : (
              /* Hero Section */
              <div
                data-region="link-detail-hero"
                className="link-detail-hero flex w-full flex-col items-center gap-5"
              >
                {/* Map Section */}
                <div
                  data-region="link-detail-hero-media"
                  className="link-hero-media flex w-full flex-col items-center"
                >
                  <div
                    data-region="link-detail-hero-map"
                    className="link-hero-map -mb-20 h-60 w-full overflow-hidden rounded-2xl border border-edge p-1 opacity-50"
                  >
                    <div className="relative size-full overflow-hidden rounded-xl border border-edge bg-surface-alt pointer-events-none">
                      {isMapPreviewReady && mapClusters.length > 0 && (
                        <StaticMap
                          clusters={mapClusters}
                          height="100%"
                          className="border-0 rounded-xl"
                          fitBounds
                        />
                      )}
                    </div>
                  </div>
                  <div
                    data-region="link-detail-hero-phone"
                    className="link-hero-phone relative flex h-[264px] w-[180px] flex-col rounded-2xl border border-edge bg-surface p-1 shadow-[0px_1px_4px_0px_rgba(0,0,0,0.04),0px_4px_16px_0px_rgba(0,0,0,0.08)]"
                  >
                    <div className="flex-1 min-h-0 overflow-hidden rounded-[10px] border border-edge bg-surface-alt">
                      {linkDetail?.thumbnailUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={linkDetail.thumbnailUrl}
                          alt={linkDetail.title}
                          className="block size-full object-cover"
                        />
                      ) : null}
                    </div>
                  </div>
                </div>

                {/* Header Section */}
                <div
                  data-region="link-detail-hero-header"
                  className="link-hero-header flex w-full flex-col items-center justify-center gap-1.5"
                >
                  <h1 className="link-hero-title type-body-1 type-secondary font-semibold text-content max-w-full truncate text-center">
                    {linkDetail?.title ??
                      (isLoading ? "Loading..." : notFound ? "Link not found" : "")}
                  </h1>
                  {linkDetail?.url && (
                    <a
                      href={linkDetail.normalizedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-region="link-detail-hero-source"
                      className="link-hero-source flex max-w-full items-center gap-1.5 py-1"
                    >
                      <CategoryBadge category="link" />
                      <span className="type-body-2 font-medium text-glyph truncate">
                        {formatDisplayUrl(linkDetail.normalizedUrl)}
                      </span>
                    </a>
                  )}
                </div>

                {/* Action Bar */}
                <div
                  data-region="link-detail-hero-actions"
                  className="link-hero-actions flex items-center gap-2"
                >
                  <div className="link-hero-action flex w-[64px] flex-col items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm" icon="only"
                      aria-label={allSelected ? "Deselect all" : "Select all"}
                      aria-pressed={allSelected}
                      onClick={toggleSelectAll}
                      disabled={filteredAndSortedLocations.length === 0}
                      className={cn(
                        allSelected && "bg-surface-muted border-edge-strong",
                      )}
                    >
                      {allSelected ? (
                        <X className="size-4" />
                      ) : (
                        <MousePointer2 className="size-4" />
                      )}
                    </Button>
                    <span className="type-body-4 text-glyph whitespace-nowrap">
                      {allSelected ? "Deselect all" : "Select all"}
                    </span>
                  </div>
                  <div className="link-hero-action flex w-[50px] flex-col items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm" icon="only"
                      aria-label="Generate"
                      onClick={handleGenerateAll}
                      disabled={filteredAndSortedLocations.length === 0}
                    >
                      <Sparkles className="size-4" />
                    </Button>
                    <span className="type-body-4 text-glyph">Generate</span>
                  </div>
                  <div className="link-hero-action flex w-[50px] flex-col items-center gap-1">
                    <Menu>
                      <MenuTrigger
                        aria-label="More options"
                        className={cn(
                          "link-detail-more-trigger button",
                          buttonVariants({ variant: "outline", size: "sm", icon: "only" }),
                        )}
                      >
                        <MoreVertical className="size-4" />
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem
                          size="lg"
                          icon="leading"
                          leadingIcon={<Trash2 className="size-4" />}
                          onClick={handleDeleteLink}
                        >
                          Delete link
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                    <span className="type-body-4 text-glyph">More</span>
                  </div>
                </div>
              </div>
            )}

            {/* Cards Grid */}
            <div
              data-region="link-detail-cards-section"
              className="link-detail-cards-section flex w-full flex-col gap-3"
            >
              {/* @container so the bento's ratio-locked tiles read 100cqw */}
              <div data-region="link-detail-cards-wrap" className="@container w-full">
                <div
                  data-region="link-detail-cards-grid"
                  className="link-detail-cards-grid bento-grid [--cols:2] sm:[--cols:3] lg:[--cols:4] xl:[--cols:5] [--ratio:calc(320/243)]"
                >
                {filteredAndSortedLocations.map((location) => {
                  const isSelected = selection.selectedIds.has(location.id);
                  return (
                    <div
                      key={location.id}
                      ref={selection.registerCard(location.id)}
                      data-card
                      data-card-id={location.id}
                      data-location-id={location.id}
                      className="h-full min-h-0"
                      onMouseDown={(e) =>
                        selection.handleCardMouseDown(location.id, e)
                      }
                    >
                      <LocationCard
                        label={location.name}
                        imageUrl={location.thumbnailUrl}
                        imageAlt={location.name}
                        className="h-full"
                        style={
                          isSelectingMode && !isSelected
                            ? {
                                opacity: dial.unselected.opacity,
                                filter:
                                  [
                                    dial.unselected.grayscale > 0
                                      ? `grayscale(${dial.unselected.grayscale}%)`
                                      : "",
                                    dial.unselected.blur > 0
                                      ? `blur(${dial.unselected.blur}px)`
                                      : "",
                                  ]
                                    .filter(Boolean)
                                    .join(" ") || undefined,
                                transform:
                                  dial.unselected.scale < 1
                                    ? `scale(${dial.unselected.scale})`
                                    : undefined,
                              }
                            : undefined
                        }
                        isSelected={isSelected}
                        isSelectingMode={isSelectingMode}
                        onClick={() => handleLocationClick(location)}
                      />
                    </div>
                  );
                })}
                </div>
              </div>

              {/* Rubber band selection rectangle */}
              {selection.selectionRect && (
                <div
                  className="rubber-band-rect fixed pointer-events-none z-50"
                  style={{
                    left: selection.selectionRect.x,
                    top: selection.selectionRect.y,
                    width: selection.selectionRect.width,
                    height: selection.selectionRect.height,
                    borderRadius: dial.rubberBand.borderRadius,
                    backgroundColor: `color-mix(in srgb, ${dial.rubberBand.color} ${Math.round(dial.rubberBand.bgOpacity * 100)}%, transparent)`,
                  }}
                />
              )}

              {/* Empty State */}
              {!isLoading && filteredAndSortedLocations.length === 0 && (
                <div
                  data-region="link-detail-empty-state"
                  className="flex flex-col items-center justify-center py-16 text-content-secondary"
                >
                  <p className="type-body-1">
                    {notFound ? "Link not found" : "No locations found"}
                  </p>
                  <p className="type-body-2 mt-1">
                    {notFound
                      ? "This link doesn't exist or you don't have access to it"
                      : "Try a different filter or add new locations"}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <Sheet
        side="bottom"
        open={isPhone && !!selectedLocation}
        onOpenChange={(open) => {
          if (!open && selectedLocation) closeDetailView();
        }}
        title={selectedLocation?.name ?? "Location details"}
        className="max-h-[90dvh] p-0"
      >
        <div
          aria-hidden="true"
          className="mx-auto my-3 h-1 w-11 shrink-0 rounded-full bg-surface-muted-active"
        />
        {renderSelectedLocationDetail("max-h-[90dvh] overflow-y-auto rounded-none border-0")}
      </Sheet>

      {/* Selection Action Toolbar */}
      {selection.selectedIds.size > 0 && (
        <ActionToolbar
          count={selection.selectedIds.size}
          collections={saveCollections.map((c) => ({
            id: c.id,
            name: c.name,
            locationCount: c.location_count,
            thumbnailUrl: c.thumbnail_url ?? c.preview_images?.[0],
            updatedAt: c.updated_at,
          }))}
          onSaveToCollection={handleSaveToCollection}
          itineraries={saveItineraries.map((i) => ({
            id: i.id,
            name: i.name,
            activityCount: i.total_activities,
            thumbnailUrl: i.thumbnail_url ?? undefined,
            collectionId: i.collection_id,
            updatedAt: i.updated_at,
          }))}
          onSaveToItinerary={handleSaveToItinerary}
          onCreateCollection={handleDetailCreateCollection}
          onGenerate={openGenerate}
          onClose={selection.clearSelection}
          menuOpen={saveMenuOpen}
          onMenuOpenChange={setSaveMenuOpen}
        />
      )}

      {/* Generate Itinerary Modal */}
      <NewItineraryModal
        source="link_detail"
        open={generateModalOpen}
        onOpenChange={setGenerateModalOpen}
        tripNameValue={generateTripName}
        onTripNameChange={setGenerateTripName}
        selectedLocationIds={generateLocationIds}
        onSubmit={async (data) => {
          setGenerateModalOpen(false);
          setIsGenerating(true);
          try {
            await batchOps.handleGenerateItinerary(
              generateLocationIds,
              data.country ?? linkDetail?.country ?? "",
              data.startDate!,
              data.totalDays!,
              data.tripName,
              data.region,
              data.latitude,
              data.longitude,
              data.aiRecommendations,
            );
          } catch (err) {
            setIsGenerating(false);
            if (err instanceof ItineraryQuotaError) {
              showQuotaToast("itinerary", err.max_itineraries);
            } else {
              showToast({
                variant: "error",
                title: "Failed to generate itinerary",
                description: err instanceof Error ? err.message : "Something went wrong.",
              });
            }
          }
        }}
      />

      {/* Itinerary Generating Screen */}
      {isGenerating && (
        <ItineraryLoadingScreen
          title="Generating Itinerary"
          subtitle="Planning your perfect trip..."
          job={trackedPlanningJob}
          onDismiss={() => setIsGenerating(false)}
        />
      )}
    </div>
  );
}
