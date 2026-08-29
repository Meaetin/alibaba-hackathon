"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { useRouter, useParams } from "next/navigation";
import {
  MoreVertical,
  CircleArrowOutUpRight,
  MousePointer2,
  Sparkles,
  Plus,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/primitives/Button";
import { Sheet } from "@/components/ui/primitives/Sheet";
import { LocationCard } from "@/components/ui";
import { CollectionImageGrid } from "@/components/ui/cards/CollectionCard";
import { ActionToolbar, type ActionToolbarItinerary } from "@/components/ui/dashboard/ActionToolbar";
import { Menu, MenuTrigger, MenuContent, MenuItem } from "@/components/ui/primitives/Menu";
import { LocationDetailView } from "@/components/ui/detail-views/LocationDetailView";
import { NewLocationModal } from "@/components/ui/modals/NewLocationModal";
import { useNavbarFilter } from "@/contexts/NavbarFilterContext";
import { cn } from "@/lib/utils";
import { weekdayDescriptionsFrom } from "@/lib/utils/location-detail";
import { scrollScrollableAncestorToTop } from "@/lib/utils/scroll";
import { useToast } from "@/contexts/ToastContext";
import { addLocationFromGoogleMapsUrl, createCollection, deleteCollection, getCollection, getCollections, removeCollectionLocation } from "@/lib/api/collections";
import type { CollectionWithLocations, CollectionWithRole, Location } from "@/lib/api/collections";
import { getFriendlyApiError } from "@/lib/errors/userMessages";
import type { MapClusterData } from "@/components/ui/map/StaticMap";
import { useRubberBandSelection } from "@/hooks/useRubberBandSelection";
import { useSessionUserId } from "@/hooks/useSessionUserId";
import { useQuotaGate } from "@/hooks/useQuotaGate";
import { rubberBandStyle, unselectedCardStyle } from "@/lib/selection-style";
import { useCollectionLocationBatchOperations } from "@/hooks/useCollectionLocationBatchOperations";
import { useJobsQueue } from "@/hooks/useJobsQueue";
import { queryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/queryKeys";
import { NewItineraryModal } from "@/components/ui/modals/NewItineraryModal";
import type { PlaceResult } from "@/components/ui/primitives/PlaceAutocomplete";
import { ItineraryLoadingScreen } from "@/components/ui/itinerary/ItineraryLoadingScreen";
import { InviteModal, type SharingState } from "@/components/ui/modals/InviteModal";
import { useRecordView } from "@/hooks/useRecordView";
import { useHighlightLocation } from "@/hooks/useHighlightLocation";
import { useBreakpoint } from "@/hooks/useMediaQuery";
import { useLocationPhoto } from "@/hooks/useLocationPhoto";
import { useItineraryUsageQuery } from "@/hooks/queries/useItineraryUsageQuery";
import { ItineraryQuotaError, getItineraries, type ItineraryWithRole } from "@/lib/api/itineraries";

const StaticMap = dynamic(
  () => import("@/components/ui/map/StaticMap").then((mod) => mod.StaticMap),
  { ssr: false },
);

export default function CollectionDetailPage() {
  const { showToast } = useToast();
  const { showQuotaToast } = useQuotaGate();
  const router = useRouter();
  const params = useParams();
  const collectionId = params.id as string;
  const { isPhone } = useBreakpoint();

  const [collection, setCollection] = useState<CollectionWithLocations | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchQuery] = useState("");
  const [selectedLocation, setSelectedLocation] = useState<Location | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const { setFilter } = useNavbarFilter();

  const [addFromGoogleMapsOpen, setAddFromGoogleMapsOpen] = useState(false);
  const [pendingGoogleMapsAdds, setPendingGoogleMapsAdds] = useState<string[]>([]);
  const userId = useSessionUserId();

  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [saveCollections, setSaveCollections] = useState<CollectionWithRole[]>([]);
  const [saveItineraries, setSaveItineraries] = useState<ItineraryWithRole[]>([]);
  const [generateModalOpen, setGenerateModalOpen] = useState(false);
  const [generateLocationIds, setGenerateLocationIds] = useState<string[]>([]);
  const [generateTripName, setGenerateTripName] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [shareModalOpen, setShareModalOpen] = useState(false);

  // Suppress rubber-band selection while any modal is open so a stray drag
  // behind the overlay doesn't start selecting cards.
  const isAnyModalOpen =
    addFromGoogleMapsOpen || generateModalOpen || shareModalOpen;
  const selection = useRubberBandSelection({
    disabled: isAnyModalOpen,
  });

  const collectionDefaultPlace = useMemo((): PlaceResult | null => {
    if (!collection) return null;
    const { country, region, latitude, longitude } = collection;
    if (!country) return null;
    const description = [region, country].filter(Boolean).join(", ");
    return {
      description,
      region: region ?? null,
      country,
      latitude: latitude ?? 0,
      longitude: longitude ?? 0,
    };
  }, [collection]);

  const collectionViewedRef = useRef<string | null>(null);
  const refreshCollection = useCallback(() => {
    getCollection(collectionId).then(setCollection);
  }, [collectionId]);

  const batchOps = useCollectionLocationBatchOperations({
    source: "collections",
    onRefresh: () => {
      selection.clearSelection();
      refreshCollection();
    },
    onJobCreated: () => {
      showToast({ title: "Generating itinerary..." });
    },
  });

  const { jobs: planningJobs } = useJobsQueue({
    type: "itinerary-planning",
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
      // The worker populates the auto-created itinerary collection's locations
      // after the itinerary row is saved. If the user is viewing that collection
      // here, refetch so the card grid renders without needing a hard refresh.
      refreshCollection();
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

  useRecordView("collection", collectionId);
  useHighlightLocation();

  useEffect(() => {
    if (!collection || collectionViewedRef.current === collection.id) return;
    collectionViewedRef.current = collection.id;
  }, [collection]);

  const hasLocationPhotos = collection?.locations?.some((l) => l.photo_urls?.length) ?? false;
  const { url: fallbackThumbnail } = useLocationPhoto(
    { region: collection?.region || collection?.name, country: collection?.country },
    hasLocationPhotos || !!collection?.thumbnail_url,
  );

  const collectionShareImageUrl = useMemo(() => {
    if (!collection) return null;
    return (
      collection.locations
        .map((location) => location.photo_urls?.[0])
        .find((url): url is string => Boolean(url)) ??
      collection.thumbnail_url ??
      fallbackThumbnail ??
      null
    );
  }, [collection, fallbackThumbnail]);

  const collectionShareTargetSummary = useMemo(() => {
    if (!collection) return undefined;
    const locationLabel = [collection.region, collection.country]
      .filter(Boolean)
      .join(", ");
    const placeCount = collection.locations.length;

    return {
      imageUrl: collectionShareImageUrl,
      locationLabel: locationLabel || null,
      detailLabel: `${placeCount} saved ${placeCount === 1 ? "place" : "places"}`,
    };
  }, [collection, collectionShareImageUrl]);

  const { data: itineraryUsage } = useItineraryUsageQuery(userId);
  const itineraryQuotaExceeded = itineraryUsage ? itineraryUsage.used >= itineraryUsage.max : false;

  // Collections offered in the ActionToolbar "Save to" menu (excludes this one).
  useEffect(() => {
    let cancelled = false;
    getCollections()
      .then((list) => {
        if (!cancelled) {
          setSaveCollections(list.filter((c) => !c.is_archived && c.id !== collectionId));
        }
      })
      .catch(() => {
        if (!cancelled) setSaveCollections([]);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

  // Itineraries offered in the ActionToolbar "Save to" menu.
  //
  // Excludes the one backed by this collection, and every trip with no
  // companion collection at all — saving to a trip means saving to its shelf,
  // and a trip planned before companions existed has none.
  useEffect(() => {
    let cancelled = false;
    getItineraries()
      .then((list) => {
        if (!cancelled) {
          setSaveItineraries(
            list.filter(
              (i) => !i.is_archived && !!i.collection_id && i.collection_id !== collectionId,
            ),
          );
        }
      })
      .catch(() => {
        if (!cancelled) setSaveItineraries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionId]);

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

  // Remove the current selection from this collection (toolbar delete button).
  const handleDeleteSelected = useCallback(async () => {
    const locationIds = Array.from(selection.selectedIds);
    if (locationIds.length === 0) return;
    const idSet = new Set(locationIds);
    selection.clearSelection();
    setCollection((prev) =>
      prev
        ? { ...prev, locations: prev.locations.filter((l) => !idSet.has(l.id)) }
        : prev,
    );
    try {
      await Promise.all(
        locationIds.map((id) => removeCollectionLocation(collectionId, id)),
      );
      showToast({ title: `Removed ${locationIds.length} from ${collection?.name ?? "collection"}` });
    } catch (err) {
      showToast({
        title: getFriendlyApiError(err, "We couldn't remove these locations."),
        variant: "error",
      });
      refreshCollection();
    }
  }, [selection, collectionId, collection?.name, showToast, refreshCollection]);

  // Open the generate-itinerary flow for the current selection.
  const openGenerate = useCallback(() => {
    if (itineraryQuotaExceeded) {
      showQuotaToast("itinerary", itineraryUsage?.max ?? 0);
      return;
    }
    setGenerateLocationIds(Array.from(selection.selectedIds));
    setGenerateTripName(collection?.name ?? "");
    setGenerateModalOpen(true);
  }, [itineraryQuotaExceeded, itineraryUsage?.max, showQuotaToast, selection.selectedIds, collection?.name]);

  // Collections offered in the detail-view footer "Add to" menu.
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

  // Add the currently-open location to a chosen collection (detail-view footer).
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
        setSaveCollections(
          list.filter((c) => !c.is_archived && c.id !== collectionId),
        );
        return { id: created.id, name: created.name };
      } catch (err) {
        showToast({
          title: getFriendlyApiError(err, "We couldn't create the collection."),
          variant: "error",
        });
        return null;
      }
    },
    [collectionId, showToast],
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

  useEffect(() => {
    setIsLoading(true);
    getCollection(collectionId)
      .then(setCollection)
      .catch((err: Error) => {
        console.error("Failed to load collection:", err);
        setError(getFriendlyApiError(err, "We couldn’t load this collection."));
      })
      .finally(() => setIsLoading(false));
  }, [collectionId]);

  useEffect(() => {
    if (collection) {
      setFilter({
        type: "collection",
        label: collection.name,
        thumbnailUrl: collection.thumbnail_url || undefined,
        entityId: collection.id,
      });
    }
    return () => { setFilter(null); };
  }, [collection, setFilter]);

  const handleLocationClick = (location: Location) => {
    if (selection.consumeClickSuppression(location.id)) return;
    if (selection.selectedIds.size > 0) {
      selection.toggleItem(location.id);
      return;
    }
    setSelectedLocation(location);
    if (!isPhone) scrollScrollableAncestorToTop(scrollContainerRef.current);
  };

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

  // Remove a single location from this collection (card kebab → Delete).
  const handleDeleteLocation = useCallback(
    async (locationId: string) => {
      setCollection((prev) =>
        prev
          ? { ...prev, locations: prev.locations.filter((l) => l.id !== locationId) }
          : prev,
      );
      try {
        await removeCollectionLocation(collectionId, locationId);
      } catch (err) {
        showToast({
          title: getFriendlyApiError(err, "We couldn't remove this location."),
          variant: "error",
        });
        refreshCollection();
      }
    },
    [collectionId, showToast, refreshCollection],
  );

  // Delete this collection entirely (More → Delete).
  const handleDeleteCollection = useCallback(async () => {
    try {
      await deleteCollection(collectionId);
      router.push("/collections");
    } catch (err) {
      showToast({
        title: getFriendlyApiError(err, "We couldn't delete this collection."),
        variant: "error",
      });
    }
  }, [collectionId, router, showToast]);

  const filteredAndSortedLocations = useMemo(() => {
    if (!collection) return [];

    // Dedup by id first: an optimistic add (handleAddFromGoogleMapsSubmit
    // prepends to prev.locations) can race a refreshCollection that already
    // returns the same location, leaving two entries with one id — a duplicate
    // React key and the place shown twice. Keep the first occurrence.
    const seen = new Set<string>();
    let filtered = collection.locations.filter((l) => {
      if (l.is_archived || seen.has(l.id)) return false;
      seen.add(l.id);
      return true;
    });

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((l) => l.name.toLowerCase().includes(q));
    }

    // Newest-added first. Sort client-side off the junction's added_at so the
    // order is guaranteed regardless of API array order or refetch races.
    return [...filtered].sort((a, b) => (b.added_at ?? "").localeCompare(a.added_at ?? ""));
  }, [collection, searchQuery]);

  type PendingGridItem = { id: string; __pending: true };
  type GridItem = Location | PendingGridItem;

  const gridItems = useMemo<GridItem[]>(
    () => [
      ...pendingGoogleMapsAdds.map((id): PendingGridItem => ({ id, __pending: true })),
      ...filteredAndSortedLocations,
    ],
    [pendingGoogleMapsAdds, filteredAndSortedLocations],
  );

  useEffect(() => {
    selection.clearSelection();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery]);

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

  // Hero "Generate" acts on EVERY location in the collection (the floating
  // ActionToolbar's generate is the selection-scoped one).
  const handleGenerateAll = useCallback(() => {
    if (itineraryQuotaExceeded) {
      showQuotaToast("itinerary", itineraryUsage?.max ?? 0);
      return;
    }
    setGenerateLocationIds(filteredAndSortedLocations.map((l) => l.id));
    setGenerateTripName(collection?.name ?? "");
    setGenerateModalOpen(true);
  }, [
    itineraryQuotaExceeded,
    itineraryUsage?.max,
    showQuotaToast,
    filteredAndSortedLocations,
    collection?.name,
  ]);

  const mapClusters = useMemo((): MapClusterData[] => {
    return filteredAndSortedLocations
      .filter((l) => l.latitude != null && l.longitude != null)
      .map((l) => ({
        id: l.id,
        count: 1,
        label: l.name,
        latitude: l.latitude!,
        longitude: l.longitude!,
        variant: "by Location" as const,
        size: "Small" as const,
        state: "Default" as const,
        filterValue: l.id,
      }));
  }, [filteredAndSortedLocations]);

  const renderSelectedLocationDetail = (className?: string) => {
    if (!selectedLocation) return null;
    return (
      <LocationDetailView
        key={selectedLocation.id}
        location={{
          name: selectedLocation.name,
          images: selectedLocation.photo_urls ?? [],
          description: selectedLocation.location_context ?? "",
          address:
            selectedLocation.formatted_address ??
            [selectedLocation.locality, selectedLocation.country]
              .filter(Boolean)
              .join(", "),
          openingHoursLines: weekdayDescriptionsFrom(selectedLocation.regular_opening_hours),
          phone: selectedLocation.international_phone_number ?? "",
          website: selectedLocation.website_uri ?? "",
          stayDurationMinutes: selectedLocation.stay_duration ?? null,
          priceRange: selectedLocation.price_range ?? null,
          primaryType: selectedLocation.primary_type ?? "",
          latitude: selectedLocation.latitude ?? 0,
          longitude: selectedLocation.longitude ?? 0,
          googleMapsUri: selectedLocation.google_maps_uri ?? null,
        }}
        locationId={selectedLocation.id}
        excludeCollectionId={collectionId}
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

  const handleAddFromGoogleMapsSubmit = useCallback((url: string) => {
    const tempId = `pending-${typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
    setAddFromGoogleMapsOpen(false);
    setPendingGoogleMapsAdds((prev) => [tempId, ...prev]);

    const dropGhost = () =>
      setPendingGoogleMapsAdds((prev) => prev.filter((id) => id !== tempId));

    void addLocationFromGoogleMapsUrl(collectionId, url)
      .then((result) => {
        showToast({
          title: result.alreadyInCollection ? "Already in this collection" : "Added to collection",
          variant: result.alreadyInCollection ? "default" : "success",
        });
        // Already present: the card is in the list, so just clear the ghost.
        if (result.alreadyInCollection) {
          dropGhost();
          return;
        }
        // Swap the ghost for the real (fully-enriched) card in one batched
        // render so the top slot stays filled and sibling cards don't shift.
        // added_at = now sorts it to the top, where the ghost was.
        const newLocation: Location = {
          ...result.location,
          is_bookmarked: false,
          is_archived: false,
          added_at: new Date().toISOString(),
        };
        setCollection((prev) =>
          prev ? { ...prev, locations: [newLocation, ...prev.locations] } : prev,
        );
        dropGhost();
      })
      .catch((err: unknown) => {
        console.error("Failed to add location from Google Maps:", err);
        const message = getFriendlyApiError(
          err,
          "We couldn’t add this place. Please check the link and try again.",
        );
        showToast({ title: message, variant: "error" });
        dropGhost();
      });
  }, [collectionId, showToast]);

  if (error) {
    return (
      <div className="collection-detail-error flex flex-col items-center justify-center flex-1 gap-3 text-content-secondary">
        <p className="collection-detail-error-text type-body-1">Collection not found</p>
        <Button variant="secondary" onClick={() => router.push("/collections")}>
          Back to collections
        </Button>
      </div>
    );
  }

  return (
    <div
      className="collection-detail-page flex flex-col flex-1 min-h-full relative pt-[var(--navbar-height)]"
      onMouseDown={selection.handleGridMouseDown}
    >
      {/* Main Scrollable Content */}
      <div
        ref={scrollContainerRef}
        className="collection-detail-scroll-container flex flex-col flex-1 min-h-0 min-w-0 overflow-y-auto"
      >
        <div
          data-region="collection-detail-shell"
          className="collection-detail-shell mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 pt-3 pb-10 md:px-8 lg:px-12 xl:px-20 min-h-[calc(100dvh-var(--navbar-height))]"
        >
          {selectedLocation && !isPhone ? (
            /* Location Detail Section */
            renderSelectedLocationDetail()
          ) : (
          /* Hero Section */
          <div
            data-region="collection-detail-hero"
            className="collection-detail-hero flex w-full flex-col items-center gap-5"
          >
            {/* Map Section */}
            <div
              data-region="collection-detail-hero-media"
              className="collection-detail-hero-media flex w-full flex-col items-center"
            >
              {(() => {
                const hasCollectionCoords =
                  collection?.latitude != null && collection?.longitude != null;
                const hasMapData = mapClusters.length > 0 || hasCollectionCoords;
                if (!hasMapData) return null;
                return (
                  <div
                    data-region="collection-detail-hero-map"
                    className="collection-detail-hero-map -mb-20 h-60 w-full overflow-hidden rounded-2xl border border-edge p-1 opacity-50"
                  >
                    <div className="relative size-full overflow-hidden rounded-xl border border-edge bg-surface-alt pointer-events-none">
                      <StaticMap
                        clusters={mapClusters}
                        height="100%"
                        className="border-0 rounded-xl"
                        fitBounds
                        {...(mapClusters.length === 0 && hasCollectionCoords
                          ? { center: [collection!.latitude!, collection!.longitude!], zoom: 10 }
                          : {})}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Circular Collection Avatar */}
              <div
                data-region="collection-detail-avatar"
                className="collection-detail-avatar relative z-10 flex size-[180px] shrink-0 flex-col rounded-full border border-edge bg-surface p-1 shadow-[0px_1px_4px_0px_rgba(0,0,0,0.04),0px_4px_16px_0px_rgba(0,0,0,0.08)]"
              >
                <div className="flex-1 min-h-0 overflow-hidden rounded-full border border-edge-subtle bg-surface-alt">
                  {(() => {
                    const previewImages = collection?.locations
                      ?.map((l) => l.photo_urls?.[0])
                      .filter((url): url is string => Boolean(url))
                      .slice(0, 4) ?? [];
                    return previewImages.length > 0 ? (
                      <CollectionImageGrid images={previewImages} />
                    ) : collection?.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={collection.thumbnail_url}
                        alt={collection?.name ?? ""}
                        className="collection-detail-avatar-image block size-full object-cover"
                      />
                    ) : (
                      <div className="collection-detail-avatar-fallback flex items-center justify-center size-full bg-gradient-to-br from-action-dark/20 to-action-dark/5">
                        <span className="collection-detail-avatar-initial type-body-2 font-medium text-content/40 select-none">
                          {collection?.name?.charAt(0)?.toUpperCase() ?? ""}
                        </span>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>

            {/* Header Section */}
            <div
              data-region="collection-detail-header"
              className="collection-detail-header flex w-full flex-col items-center justify-center gap-1.5"
            >
              <h1 className="collection-detail-title type-body-1 type-secondary font-semibold text-content max-w-full truncate text-center">
                {isLoading ? "Loading…" : collection?.name}
              </h1>
              {collection?.description && (
                <p className="collection-detail-description type-body-2 text-content-secondary max-w-full truncate text-center">
                  {collection.description}
                </p>
              )}
            </div>

            {/* Action Bar */}
            <div
              data-region="collection-detail-actions"
              className="collection-detail-actions flex items-center gap-2"
            >
              {/* Add — opens the add-location modal directly */}
              <div className="collection-detail-action flex w-[50px] flex-col items-center gap-1">
                <Button
                  variant="outline"
                  size="sm" icon="only"
                  aria-label="Add location"
                  onClick={() => setAddFromGoogleMapsOpen(true)}
                >
                  <Plus className="size-4" />
                </Button>
                <span className="type-body-4 text-glyph">Add</span>
              </div>
              {/* Select all / Deselect all */}
              <div className="collection-detail-action flex w-[64px] flex-col items-center gap-1">
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
              {/* Generate */}
              <div className="collection-detail-action flex w-[50px] flex-col items-center gap-1">
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
              {/* Share — disabled for now */}
              <div className="collection-detail-action flex w-[50px] flex-col items-center gap-1">
                <Button
                  variant="outline"
                  size="sm" icon="only"
                  aria-label="Share"
                  onClick={() => setShareModalOpen(true)}
                  disabled
                >
                  <CircleArrowOutUpRight className="size-4" />
                </Button>
                <span className="type-body-4 text-glyph">Share</span>
              </div>
              {/* More — Edit (disabled) / Delete */}
              <div className="collection-detail-action flex w-[50px] flex-col items-center gap-1">
                <Menu>
                  <MenuTrigger
                    aria-label="More options"
                    className={cn(
                      "collection-detail-more-trigger button",
                      buttonVariants({ variant: "outline", size: "sm", icon: "only" }),
                    )}
                  >
                    <MoreVertical className="size-4" />
                  </MenuTrigger>
                  <MenuContent>
                    <MenuItem
                      size="lg"
                      icon="leading"
                      leadingIcon={<Pencil className="size-4" />}
                      disabled
                    >
                      Edit
                    </MenuItem>
                    <MenuItem
                      size="lg"
                      icon="leading"
                      leadingIcon={<Trash2 className="size-4" />}
                      onClick={handleDeleteCollection}
                    >
                      Delete
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
            data-region="collection-detail-cards-section"
            className="collection-detail-cards-section flex w-full flex-col gap-3"
          >
            {/* Rubber band selection rectangle */}
            {selection.selectionRect && (
              <div
                className="collection-detail-rubber-band fixed pointer-events-none z-50"
                style={rubberBandStyle(selection.selectionRect)}
              />
            )}

            {isLoading ? (
              /* Loading State */
              <div className="@container w-full">
                <div className="bento-grid [--cols:2] sm:[--cols:3] lg:[--cols:4] xl:[--cols:5] [--ratio:calc(320/243)]">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className="collection-detail-skeleton-tile h-full rounded-2xl bg-surface-muted animate-pulse"
                    />
                  ))}
                </div>
              </div>
            ) : gridItems.length === 0 ? (
              /* Empty State */
              <div
                data-region="collection-detail-empty-state"
                className="collection-detail-empty-state flex flex-col items-center justify-center py-16 text-content-secondary"
              >
                <p className="collection-detail-empty-title type-body-1">No locations found</p>
                <p className="collection-detail-empty-subtitle type-body-2 mt-1">
                  {searchQuery
                    ? "Try a different search term"
                    : "Add locations to this collection"}
                </p>
              </div>
            ) : (
              /* @container so the bento's ratio-locked tiles read 100cqw */
              <div data-region="collection-detail-cards-wrap" className="@container w-full">
                <div
                  data-region="collection-detail-cards-grid"
                  className="collection-detail-cards-grid bento-grid [--cols:2] sm:[--cols:3] lg:[--cols:4] xl:[--cols:5] [--ratio:calc(320/243)]"
                >
                  {gridItems.map((item) => {
                    if ("__pending" in item) {
                      return (
                        <div
                          key={item.id}
                          className="collection-detail-pending-tile h-full rounded-2xl bg-surface-muted animate-pulse"
                        />
                      );
                    }
                    const location = item;
                    const isSelected = selection.selectedIds.has(location.id);
                    return (
                      <div
                        key={location.id}
                        className="collection-detail-grid-card-wrapper h-full min-h-0"
                        ref={selection.registerCard(location.id)}
                        data-card
                        data-card-id={location.id}
                        data-location-id={location.id}
                        onMouseDown={(e) => selection.handleCardMouseDown(location.id, e)}
                        // Right-click stays menu-less — the kebab is the only menu trigger.
                        onContextMenuCapture={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <LocationCard
                          label={location.name}
                          imageUrl={location.photo_urls?.[0]}
                          imageAlt={location.name}
                          className="h-full"
                          style={
                            isSelectingMode && !isSelected ? unselectedCardStyle() : undefined
                          }
                          isSelected={isSelected}
                          isSelectingMode={isSelectingMode}
                          onClick={() => handleLocationClick(location)}
                          onDelete={() => handleDeleteLocation(location.id)}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
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

      {/* Add Location (from Google Maps) Modal */}
      <NewLocationModal
        open={addFromGoogleMapsOpen}
        onOpenChange={setAddFromGoogleMapsOpen}
        onSubmit={handleAddFromGoogleMapsSubmit}
      />

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
          onDelete={handleDeleteSelected}
          onClose={selection.clearSelection}
          menuOpen={saveMenuOpen}
          onMenuOpenChange={setSaveMenuOpen}
        />
      )}

      {/* Generate Itinerary Modal */}
      <NewItineraryModal
        source="collection_detail"
        open={generateModalOpen}
        onOpenChange={setGenerateModalOpen}
        tripNameValue={generateTripName}
        onTripNameChange={setGenerateTripName}
        defaultPlace={collectionDefaultPlace}
        selectedLocationIds={generateLocationIds}
        onSubmit={async (data) => {
          setGenerateModalOpen(false);
          setIsGenerating(true);
          try {
            await batchOps.handleGenerateItinerary(
              generateLocationIds,
              data.country ?? collection?.country ?? "",
              data.startDate!,
              data.totalDays!,
              data.tripName,
              data.region ?? collection?.region,
              data.latitude,
              data.longitude,
              data.aiRecommendations,
            );
          } catch (err) {
            setIsGenerating(false);
            if (err instanceof ItineraryQuotaError) {
              if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.itineraryUsage(userId) });
              showQuotaToast("itinerary", err.max_itineraries);
            } else {
              showToast({
                title: "Failed to generate itinerary",
                description: err instanceof Error ? err.message : "Something went wrong.",
                variant: "error",
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

      {/* Share Modal */}
      {collection && (
        <InviteModal
          open={shareModalOpen}
          onOpenChange={setShareModalOpen}
          entityType="collection"
          entityId={collectionId}
          entityName={collection.name}
          targetSummary={collectionShareTargetSummary}
          isPublic={collection.is_public}
          publicToken={collection.public_token}
          inviteToken={collection.invite_token}
          inviteTokenExpiresAt={collection.invite_token_expires_at}
          userRole={userId && collection.owner_id === userId ? "owner" : "collaborator"}
          onSharingChange={(updates: SharingState) => {
            setCollection((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                ...(updates.isPublic !== undefined && { is_public: updates.isPublic }),
                ...(updates.publicToken !== undefined && { public_token: updates.publicToken ?? undefined }),
                ...(updates.inviteToken !== undefined && { invite_token: updates.inviteToken ?? undefined }),
                ...(updates.inviteTokenExpiresAt !== undefined && { invite_token_expires_at: updates.inviteTokenExpiresAt ?? undefined }),
              } as typeof prev;
            });
          }}
        />
      )}

    </div>
  );
}
