"use client";

import { useState, useMemo, useRef, useEffect, useCallback, type MouseEvent, type PointerEvent, type UIEvent } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { motion, useReducedMotion } from "motion/react";
import { FolderOpen } from "lucide-react";
import { LinkCard, CollectionCard, ItineraryCard, LocationCard } from "@/components/ui";
import { UsageCard } from "@/components/ui/primitives/UsageCard";
import { NewLinkModal } from "@/components/ui/modals/NewLinkModal";
import { NewCollectionModal } from "@/components/ui/modals/NewCollectionModal";
import { NewItineraryModal } from "@/components/ui/modals/NewItineraryModal";
import type { NewItinerarySubmission } from "@/components/ui/modals/NewItineraryModal";
import { CreateCard } from "@/components/ui/dashboard/CreateCard";
import { type ListingCardType } from "@/components/ui/dashboard/ListingContextMenu";
import { AddToDestinationModal } from "@/components/ui/modals/AddToDestinationModal";
import { ConfirmDeleteModal } from "@/components/ui/modals/ConfirmDeleteModal";
import { createItineraryRouted, ItineraryQuotaError } from "@/lib/api/itineraries";
import { useToast } from "@/contexts/ToastContext";
import { AlreadyAnalyzedError, LinkQuotaError, createJob, detachJob, retryJob } from "@/lib/api/client";
import { createCollection } from "@/lib/api/collections";
import { useDashboardRecent } from "@/hooks/useDashboardRecent";
import { useJobsQueue } from "@/hooks/useJobsQueue";
import type { QueueJob } from "@/lib/jobs/types";
import { announcePlanningJob } from "@/lib/jobs/events";
import { ItineraryQueueCardItem } from "@/components/ui/itinerary/ItineraryQueueCardItem";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useMapClusters } from "@/hooks/useMapClusters";
import { useSessionUserId } from "@/hooks/useSessionUserId";
import { useQuotaGate } from "@/hooks/useQuotaGate";
import { useNavbarLocationFilter } from "@/hooks/useNavbarLocationFilter";
import { useModalAnimation } from "@/hooks/useModalAnimation";
import { deleteContent } from "@/lib/api/content";
import { deleteCollection } from "@/lib/api/collections";
import { deleteItinerary } from "@/lib/api/itineraries";
import type { RecentContentItem } from "@/lib/domain-types";
import type { MapClusterData } from "@/components/ui/map/StaticMap";
import { useProfileQuery } from "@/hooks/queries/useProfileQuery";
import { useLinkUsageQuery } from "@/hooks/queries/useLinkUsageQuery";
import { FilterPill } from "@/components/ui/navbar/FilterPill";
import { queryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/queryKeys";
import { useBreakpoint } from "@/hooks/useMediaQuery";
import { CategoryBadge } from "@/components/ui/primitives/CategoryBadge";
import { cn } from "@/lib/utils";
import { motionPresets, motionTransitions } from "@/lib/motion/presets";

const StaticMap = dynamic(
  () => import("@/components/ui/map/StaticMap").then((mod) => mod.StaticMap),
  { ssr: false },
);

// Default map viewport when the user has no location clusters yet (Singapore).
const SINGAPORE_CENTER: [number, number] = [1.3521, 103.8198];
const SINGAPORE_ZOOM = 11;

interface CarouselDragState {
  active: boolean;
  moved: boolean;
  pointerId: number | null;
  startX: number;
  scrollLeft: number;
}

type MobileContentFilter = "all" | "link" | "collection" | "itinerary";

const MOBILE_CONTENT_FILTERS: Array<{
  value: MobileContentFilter;
  label: string;
}> = [
  { value: "all", label: "All" },
  { value: "link", label: "Links" },
  { value: "collection", label: "Collections" },
  { value: "itinerary", label: "Itineraries" },
];

const MOBILE_CREATE_SLIDES = [
  { key: "link", label: "Add a link" },
  { key: "collection", label: "Create a collection" },
  { key: "itinerary", label: "Plan an itinerary" },
] as const;

function getItemHref(item: RecentContentItem): string {
  switch (item.type) {
    case "itinerary":   return `/itineraries/${item.id}`;
    case "collection":  return `/collections/${item.id}`;
    case "link":        return `/links/${item.id}`;
    case "location":    return `/links/${item.id}`;
  }
}

/**
 * Synthesizes the finished itinerary's feed item straight from the completed job,
 * so its grid slot is filled in the same render the queue card leaves it. Without
 * this the card vanishes until the refresh lands and the feed shifts, then shifts
 * back. Mirrors the links page's `buildOptimisticContent`.
 */
function buildOptimisticItineraryItem(job: QueueJob): RecentContentItem | null {
  const itineraryId = job.result?.itinerary_id as string | undefined;
  if (!itineraryId) return null;
  const payload = (job.payload ?? {}) as { title?: string; thumbnailUrl?: string };
  return {
    id: itineraryId,
    type: "itinerary",
    name: payload.title?.trim() || "New itinerary",
    // The photo the worker saved; falls back to the one the queue card was
    // showing, so this card never blinks to a gradient mid-handover.
    thumbnail_url:
      (job.result?.thumbnail_url as string | undefined) ?? payload.thumbnailUrl ?? null,
    updated_at: job.completed_at ?? job.updated_at,
    is_bookmarked: false,
    is_archived: false,
  };
}

const typeGradients: Record<string, string> = {
  link: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
  collection: "linear-gradient(135deg, #f093fb 0%, #f5576c 100%)",
  itinerary: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
  location: "linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)",
};

export default function DashboardPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { showQuotaToast } = useQuotaGate();
  const userId = useSessionUserId();
  const { isPhone } = useBreakpoint();
  const shouldReduceMotion = useReducedMotion();
  const newItemIdsRef = useRef(new Set<string>());
  const [newLinkModalOpen, setNewLinkModalOpen] = useState(false);
  const [newCollectionModalOpen, setNewCollectionModalOpen] = useState(false);
  const [isCreatingCollection, setIsCreatingCollection] = useState(false);
  const [newItineraryModalOpen, setNewItineraryModalOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [collectionValue, setCollectionValue] = useState("");
  const [tripNameValue, setTripNameValue] = useState("");
  const [locationFilter, setLocationFilter] = useState<string | null>(null);
  const [mobileContentFilter, setMobileContentFilter] = useState<MobileContentFilter>("all");
  // Finished planning jobs held as feed items until the refresh catches up.
  const [optimisticItineraries, setOptimisticItineraries] = useState<RecentContentItem[]>([]);
  const cardsSectionRef = useRef<HTMLDivElement>(null);
  const createCarouselRef = useRef<HTMLDivElement>(null);
  const [activeCreateSlide, setActiveCreateSlide] = useState(0);
  const createCarouselDragRef = useRef<CarouselDragState>({
    active: false,
    moved: false,
    pointerId: null,
    startX: 0,
    scrollLeft: 0,
  });
  const suppressCreateCarouselClickRef = useRef(false);

  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    ids: string[];
    cardType: ListingCardType;
    name: string;
    collaboratorCount: number;
  }>({ open: false, ids: [], cardType: "link", name: "", collaboratorCount: 0 });
  const [addToDestModal, setAddToDestModal] = useState<{
    open: boolean;
    mode: "collection" | "itinerary";
    locationIds: string[];
  }>({ open: false, mode: "collection", locationIds: [] });

  const dashboardVisitTrackedRef = useRef(false);

  const { data: profile } = useProfileQuery(userId);
  const { data: linkUsage } = useLinkUsageQuery(userId);

  const { items, isLoading, isLoadingMore, hasMore, loadMore, removeItem, prependItem, refresh } = useDashboardRecent({
    userId,
    filter: "recent",
    sortOption: "modified",
  });

  // Listen for cross-component creation events and prepend new items into the
  // dashboard list. The dashboard's own create handlers prepend directly; this
  // covers creates from elsewhere.
  useEffect(() => {
    const handler = (e: Event) => {
      const item = (e as CustomEvent<RecentContentItem>).detail;
      if (!item) return;
      newItemIdsRef.current.add(item.id);
      prependItem(item);
    };
    window.addEventListener("argo:content-prepended", handler);
    return () => window.removeEventListener("argo:content-prepended", handler);
  }, [prependItem]);

  useJobsQueue({
    type: "content-analysis",
    onJobCompleted: (job) => {
      refresh();
      showToast({
        title: "Link finished analyzing",
        variant: "success",
        thumbnail: job.progress?.thumbnail,
        // On `job.result`, not on the row — `jobs` has no `content_id` column.
        action: (job.result as { content_id?: string } | undefined)?.content_id
          ? { label: "View", href: `/links/${(job.result as { content_id: string }).content_id}` }
          : undefined,
      });
    },
    onJobFailed: () => {
      showToast({
        title: "Error analyzing link, try again later.",
        variant: "error",
      });
    },
    onJobRejected: () => {
      showToast({
        title: "No travel locations found in this link.",
        variant: "error",
      });
    },
  });

  const {
    jobs: planningJobs,
    removeJob: removePlanningJob,
    upsertJob: upsertPlanningJob,
  } = useJobsQueue({
    type: "itinerary-planning",
    // No "Itinerary ready" toast here — MainLayout's persistent local queue
    // owns it, and raising it in both places shows it twice.
    onJobCompleted: (job) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.itineraries() });
      if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.upcomingItineraries(userId) });
      const optimistic = buildOptimisticItineraryItem(job);
      if (optimistic) {
        setOptimisticItineraries((prev) =>
          prev.some((i) => i.id === optimistic.id) ? prev : [optimistic, ...prev],
        );
      }
      refresh();
    },
    // Failure is surfaced by the queue card (error copy + Try Again) and the
    // layout queue's toast — a third announcement here shows it twice.
  });

  // Hand off to the canonical row once the refresh lands (same key → no remount).
  // Keyed on the id list rather than the array identity: a refetch that returns
  // the same rows must not re-enter this effect, or its own setState feeds the
  // next render and the depth limit trips.
  const realItemIdsKey = items.map((i) => i.id).join(",");
  useEffect(() => {
    const realIds = new Set(realItemIdsKey ? realItemIdsKey.split(",") : []);
    setOptimisticItineraries((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((i) => !realIds.has(i.id));
      return next.length === prev.length ? prev : next;
    });
  }, [realItemIdsKey]);

  const handleRemovePlanningJob = useCallback(
    async (jobId: string) => {
      removePlanningJob(jobId);
      try {
        await detachJob(jobId);
      } catch {
        showToast({ title: "Couldn't dismiss that, try again later.", variant: "error" });
      }
    },
    [removePlanningJob, showToast],
  );

  const handleRetryPlanningJob = useCallback(
    async (job: QueueJob) => {
      try {
        const updated = (await retryJob(job.id)) as QueueJob | null;
        if (updated?.id) upsertPlanningJob(updated);
      } catch (err) {
        showToast({ title: "Couldn't retry that, try again later.", variant: "error" });
        throw err;
      }
    },
    [upsertPlanningJob, showToast],
  );

  const { sentinelRef } = useInfiniteScroll(loadMore, {
    enabled: hasMore && !isLoadingMore && !isLoading,
  });

  useEffect(() => {
    if (!userId || isLoading || dashboardVisitTrackedRef.current) return;
    dashboardVisitTrackedRef.current = true;
  }, [userId, isLoading, items.length]);

  useEffect(() => {
    setMobileContentFilter("all");
  }, []);

  const { clusters: mapClusters, entityIdsByLocality } = useMapClusters(userId, "dashboard");
  useModalAnimation();
  useNavbarLocationFilter(locationFilter, entityIdsByLocality);

  const handleClusterClick = (cluster: MapClusterData) => {
    setLocationFilter(cluster.filterValue ?? null);
    setTimeout(() => {
      cardsSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 100);
  };

  const handleCreateCarouselPointerDown = useCallback((event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse" || event.button !== 0) return;
    createCarouselDragRef.current = {
      active: true,
      moved: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      scrollLeft: event.currentTarget.scrollLeft,
    };
    event.currentTarget.dataset.dragging = "true";
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleCreateCarouselPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = createCarouselDragRef.current;
    if (!drag.active) return;

    const deltaX = event.clientX - drag.startX;
    if (Math.abs(deltaX) > 4) {
      drag.moved = true;
      suppressCreateCarouselClickRef.current = true;
      event.preventDefault();
    }

    event.currentTarget.scrollLeft = drag.scrollLeft - deltaX;
  }, []);

  const endCreateCarouselDrag = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = createCarouselDragRef.current;
    if (!drag.active) return;

    if (drag.pointerId !== null && event.currentTarget.hasPointerCapture(drag.pointerId)) {
      event.currentTarget.releasePointerCapture(drag.pointerId);
    }
    delete event.currentTarget.dataset.dragging;
    createCarouselDragRef.current = {
      active: false,
      moved: false,
      pointerId: null,
      startX: 0,
      scrollLeft: event.currentTarget.scrollLeft,
    };

    if (drag.moved) {
      window.setTimeout(() => {
        suppressCreateCarouselClickRef.current = false;
      }, 0);
    }
  }, []);

  const handleCreateCarouselClickCapture = useCallback((event: MouseEvent<HTMLDivElement>) => {
    if (!suppressCreateCarouselClickRef.current) return;
    event.preventDefault();
    event.stopPropagation();
    suppressCreateCarouselClickRef.current = false;
  }, []);

  const updateActiveCreateSlide = useCallback((carousel: HTMLDivElement) => {
    const firstSlide = carousel.firstElementChild as HTMLElement | null;
    const slideWidth = firstSlide?.offsetWidth ?? carousel.clientWidth;
    const gap = Number.parseFloat(window.getComputedStyle(carousel).gap || "0");
    const index = Math.round(carousel.scrollLeft / Math.max(slideWidth + gap, 1));
    setActiveCreateSlide(Math.max(0, Math.min(MOBILE_CREATE_SLIDES.length - 1, index)));
  }, []);

  const handleCreateCarouselScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    updateActiveCreateSlide(event.currentTarget);
  }, [updateActiveCreateSlide]);

  const scrollToCreateSlide = useCallback((index: number) => {
    const carousel = createCarouselRef.current;
    const target = carousel?.children.item(index) as HTMLElement | null;
    if (!carousel || !target) return;
    carousel.scrollTo({ left: target.offsetLeft - carousel.offsetLeft, behavior: "smooth" });
  }, []);

  const mergedItems = useMemo(() => {
    if (optimisticItineraries.length === 0) return items;
    const realIds = new Set(items.map((i) => i.id));
    return [...optimisticItineraries.filter((i) => !realIds.has(i.id)), ...items];
  }, [items, optimisticItineraries]);

  const locationFilteredContent = useMemo(() => {
    if (!locationFilter) return mergedItems;
    const entityIds = entityIdsByLocality.get(locationFilter);
    if (!entityIds) return [];
    return mergedItems.filter((item) => entityIds.has(item.id));
  }, [mergedItems, locationFilter, entityIdsByLocality]);

  const filteredContent = useMemo(() => {
    if (!isPhone || mobileContentFilter === "all") return locationFilteredContent;
    return locationFilteredContent.filter((item) => item.type === mobileContentFilter);
  }, [isPhone, locationFilteredContent, mobileContentFilter]);

  // In-flight itineraries follow the mobile type filter, but not the locality
  // filter — the job has no locality until it resolves, and silently hiding a
  // running job would recreate the very blind spot these cards exist to fix.
  const visiblePlanningJobs = useMemo(() => {
    if (isPhone && mobileContentFilter !== "all" && mobileContentFilter !== "itinerary") return [];
    return planningJobs;
  }, [planningJobs, isPhone, mobileContentFilter]);

  // The "Latest Viewed" tile is explicitly placed (col2/row2), so an auto-placed
  // queue card can never land in it — which is why a running job appeared below
  // older content despite being the newest thing the user has. Give the tile to
  // the newest in-flight job when there is one and demote the latest item into
  // the feed, so "newest first" holds for jobs too.
  const featuredJob = visiblePlanningJobs[0] ?? null;
  const trailingJobs = featuredJob ? visiblePlanningJobs.slice(1) : visiblePlanningJobs;
  const featuredItem = featuredJob ? null : filteredContent[0];
  const feedItems = featuredJob ? filteredContent : filteredContent.slice(1);

  const handleLinkSubmit = async (linkUrl: string) => {
    try {
      await createJob("content-analysis", { url: linkUrl });
    } catch (err) {
      if (err instanceof AlreadyAnalyzedError) {
        setNewLinkModalOpen(false);
        setLinkValue("");
        showToast({
          title: "You've already analyzed this link",
          thumbnail: err.content.content_thumbnail ?? undefined,
          action: { label: "View", href: `/links/${err.content.id}` },
        });
        return;
      }
      // Handled here rather than re-thrown: the modal renders thrown errors as
      // inline field text, which is the wrong shape for a paywall. Close it and
      // show the upgrade toast instead. showQuotaToast emits quota_blocked.
      if (err instanceof LinkQuotaError) {
        if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.linkUsage(userId) });
        setNewLinkModalOpen(false);
        setLinkValue("");
        showQuotaToast("link", err.monthlyLimit);
        return;
      }
      throw err;
    }
    if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.linkUsage(userId) });
    setNewLinkModalOpen(false);
    setLinkValue("");
    showToast({
      title: "Link sent to queue",
      action: { label: "View", href: "/links" },
    });
  };

  const handleCollectionSubmit = async (data: { name: string; country?: string; region?: string; latitude?: number; longitude?: number; tags?: string[] }) => {
    setIsCreatingCollection(true);
    try {
      const collection = await createCollection(data.name, data.country, data.region, data.latitude, data.longitude, data.tags);
      queryClient.invalidateQueries({ queryKey: queryKeys.collections() });
      newItemIdsRef.current.add(collection.id);
      prependItem({
        id: collection.id,
        type: "collection",
        name: collection.name,
        thumbnail_url: collection.thumbnail_url ?? null,
        updated_at: collection.updated_at ?? new Date().toISOString(),
        is_bookmarked: false,
        is_archived: false,
      });
      setNewCollectionModalOpen(false);
      setCollectionValue("");
      showToast({
        title: "Collection created",
        description: `"${collection.name}" is ready.`,
        action: { label: "View", href: `/collections/${collection.id}` },
        duration: 5000,
      });
    } catch (err) {
      showToast({
        title: "Failed to create collection",
        description: err instanceof Error ? err.message : "Something went wrong.",
        duration: 5000,
      });
    } finally {
      setIsCreatingCollection(false);
    }
  };

  const handleItinerarySubmit = async (data: NewItinerarySubmission) => {
    if (!data.tripName || !data.country || !data.startDate || !data.totalDays) return;
    try {
      const result = await createItineraryRouted({
        source: "dashboard",
        tripName: data.tripName,
        country: data.country,
        region: data.region,
        latitude: data.latitude,
        longitude: data.longitude,
        startDate: data.startDate,
        endDate: data.endDate,
        totalDays: data.totalDays,
        selectedLocationIds: data.selectedLocationIds,
        aiRecommendations: data.aiRecommendations,
        pace: data.pace,
      });
      setNewItineraryModalOpen(false);
      setTripNameValue("");

      // AI-only itinerary (no locations + AI on) → async job; the
      // itinerary-planning queue below surfaces a "View" toast on completion.
      if (result.kind === "planning") {
        upsertPlanningJob(result.job);
        announcePlanningJob(result.job);
        showToast({ title: "Generating itinerary…", variant: "success" });
        return;
      }

      // Blank itinerary → created synchronously, navigate straight in.
      const itinerary = result.itinerary;
      queryClient.invalidateQueries({ queryKey: queryKeys.itineraries() });
      if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.upcomingItineraries(userId) });
      newItemIdsRef.current.add(itinerary.id);
      prependItem({
        id: itinerary.id,
        type: "itinerary",
        name: itinerary.name,
        thumbnail_url: itinerary.thumbnail_url ?? null,
        updated_at: itinerary.updated_at ?? new Date().toISOString(),
        is_bookmarked: false,
        is_archived: false,
        metadata: { country: itinerary.country },
      });
      router.push(`/itineraries/${itinerary.id}`);
    } catch (err) {
      if (err instanceof ItineraryQuotaError) {
        if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.itineraryUsage(userId) });
        showToast({
          variant: "error",
          title: "Itinerary limit reached",
          description: `You've reached your limit of ${err.max_itineraries} itineraries. Delete one or upgrade your plan.`,
        });
        setNewItineraryModalOpen(false);
      } else {
        showToast({
          variant: "error",
          title: "Failed to create itinerary",
          description: err instanceof Error ? err.message : "Something went wrong.",
        });
      }
    }
  };

  // ── Helpers to resolve context menu target from a card item ──────────────────

  const resolveCardType = (item: RecentContentItem): ListingCardType => {
    switch (item.type) {
      case "itinerary": return "itinerary";
      case "collection": return "collection";
      case "link": return "link";
      case "location": return "location";
    }
  };

  // ── Card menu actions (owned by BaseCard's kebab / right-click) ──────────────

  const handleDelete = useCallback(
    (item: RecentContentItem) => {
      const cardType = resolveCardType(item);
      if (cardType === "link") {
        deleteContent(item.id)
          .then(() => {
            removeItem(item.id);
            showToast({ title: "Deleted", variant: "success" });
          })
          .catch(() => showToast({ title: "Something went wrong. Try again.", variant: "error" }));
      } else {
        setDeleteModal({ open: true, ids: [item.id], cardType, name: item.name, collaboratorCount: 0 });
      }
    },
    [removeItem, showToast],
  );

  const handleConfirmDelete = useCallback(async () => {
    const { ids, cardType } = deleteModal;
    try {
      await Promise.all(
        ids.map((id) =>
          cardType === "collection" ? deleteCollection(id) : deleteItinerary(id),
        ),
      );
      ids.forEach((id) => {
        if (cardType === "collection") {
        }
        removeItem(id);
      });
      showToast({ title: "Deleted", variant: "success" });
    } catch {
      showToast({ title: "Something went wrong. Try again.", variant: "error" });
    }
  }, [deleteModal, removeItem, showToast]);

  // Resolve a card item's locations, then open AddToDestinationModal.
  //
  // Only links and locations ever carried locations directly, and the dashboard
  // now lists itineraries only, so nothing on this grid can reach the second
  // branch. Both halves of the flow — resolving a link's locations, and writing
  // them into a collection — read Supabase tables this build does not have.
  // They say so rather than resolving quietly into a success toast.
  const handleAddToDestination = useCallback(
    async (item: RecentContentItem, mode: "collection" | "itinerary") => {
      if (item.type !== "location") {
        showToast({ title: "This isn't available in this build.", variant: "error" });
        return;
      }
      setAddToDestModal({ open: true, mode, locationIds: [item.id] });
    },
    [showToast],
  );

  const handleAddToDestinationConfirm = useCallback(async () => {
    throw new Error("Collections are not available in this build.");
  }, []);

  // Renders the appropriate entity card for a feed/latest item, wiring its kebab /
  // right-click actions per type (delete + add-to-destination where applicable).
  // The grid cell (a motion.div) wraps this; the card fills the cell via `h-full`.
  const renderCardInner = (item: RecentContentItem) => {
    const sharedProps = {
      label: item.name,
      imageUrl: item.thumbnail_url ?? undefined,
      gradient: typeGradients[item.type],
      className: "h-full",
      href: getItemHref(item),
    };
    if (item.type === "collection") {
      return (
        <CollectionCard
          label={item.name}
          images={item.preview_images?.length ? item.preview_images : item.thumbnail_url ? [item.thumbnail_url] : undefined}
          gradient={item.preview_images?.length || item.thumbnail_url ? undefined : typeGradients[item.type]}
          fallbackQuery={item.name}
          className="h-full"
          href={getItemHref(item)}
          onDelete={() => handleDelete(item)}
        />
      );
    }
    if (item.type === "itinerary") {
      return <ItineraryCard {...sharedProps} onDelete={() => handleDelete(item)} />;
    }
    if (item.type === "location") {
      return (
        <LocationCard
          {...sharedProps}
          onAddToCollection={() => handleAddToDestination(item, "collection")}
          onAddToItinerary={() => handleAddToDestination(item, "itinerary")}
        />
      );
    }
    return (
      <LinkCard
        {...sharedProps}
        onDelete={() => handleDelete(item)}
        onAddToCollection={() => handleAddToDestination(item, "collection")}
        onAddToItinerary={() => handleAddToDestination(item, "itinerary")}
      />
    );
  };

  return (
    <div className="dashboard-page flex flex-col min-h-full pt-[var(--navbar-height)]" data-region="home-page">
      {/* Header Section — greeting + usage, shares the shell with the bento grid so edges align */}
      <div
        data-region="home-shell"
        className="dashboard-shell mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 pt-3 pb-10 md:px-8 lg:px-12 xl:px-20"
      >
        {/* Welcome Row */}
        <div data-region="home-header" className="dashboard-welcome-row flex w-full flex-col items-stretch gap-3 md:flex-row md:items-start md:justify-between">
          <h1 className="dashboard-welcome-title type-h4 font-secondary font-semibold text-glyph">
            Welcome back, {profile?.display_name || profile?.email?.split("@")[0] || "User"}
          </h1>
          <UsageCard
            type="link"
            usage={linkUsage}
            variant="detailed"
            upgradeHref={linkUsage && linkUsage.used >= linkUsage.max ? "/billing" : undefined}
            className="dashboard-usage-card w-full shrink-0 md:w-[280px]"
          />
        </div>

        {/* Location Filter Pill */}
        {locationFilter && (
          <div className="shrink-0">
            <FilterPill
              type="location"
              label={locationFilter}
              onDismiss={() => setLocationFilter(null)}
            />
          </div>
        )}

        {/* Mobile create carousel — a clear progress cue makes the horizontal path discoverable. */}
        <div className="md:hidden">
          <div
            ref={createCarouselRef}
            data-region="home-create-carousel"
            aria-label="Create options"
            className="flex cursor-grab touch-pan-x snap-x snap-mandatory gap-2 overflow-x-scroll overscroll-x-contain pb-1 select-none scrollbar-none active:cursor-grabbing data-[dragging=true]:cursor-grabbing [-webkit-overflow-scrolling:touch]"
            onClickCapture={handleCreateCarouselClickCapture}
            onPointerCancel={endCreateCarouselDrag}
            onPointerDown={handleCreateCarouselPointerDown}
            onPointerMove={handleCreateCarouselPointerMove}
            onPointerUp={endCreateCarouselDrag}
            onScroll={handleCreateCarouselScroll}
          >
            <div className="flex-[0_0_88%] snap-start">
              <CreateCard type="link" className="h-[260px]" onAction={() => setNewLinkModalOpen(true)} />
            </div>
            <div className="flex-[0_0_88%] snap-start">
              <CreateCard type="collection" className="h-[260px]" onAction={() => setNewCollectionModalOpen(true)} />
            </div>
            <div className="flex-[0_0_88%] snap-start">
              <CreateCard type="itinerary" className="h-[260px]" onAction={() => setNewItineraryModalOpen(true)} />
            </div>
          </div>

          <div className="flex h-8 items-center justify-center px-1">
            <div className="inline-flex items-center gap-1.5" role="group" aria-label="Create option carousel controls">
              {MOBILE_CREATE_SLIDES.map((slide, index) => {
                const active = index === activeCreateSlide;
                return (
                  <button
                    key={slide.key}
                    type="button"
                    onClick={() => scrollToCreateSlide(index)}
                    aria-label={`Show ${slide.label}`}
                    aria-current={active ? "true" : undefined}
                    className="flex min-h-8 items-center py-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-edge-strong"
                  >
                    <span
                      className={cn(
                        "block h-1.5 rounded-full bg-edge-strong transition-[width,background-color] duration-[var(--motion-duration-normal)] ease-[var(--motion-ease-standard)] motion-reduce:transition-none",
                        active ? "w-6 bg-action-brand" : "w-1.5 hover:bg-content-secondary",
                      )}
                    />
                  </button>
                );
              })}
            </div>

          </div>
        </div>

        {/* Mobile content filter */}
        <div
          data-region="home-mobile-content-filter"
          className="flex gap-2 overflow-x-auto pb-1 scrollbar-none md:hidden"
          aria-label="Filter dashboard content"
        >
          {MOBILE_CONTENT_FILTERS.map((filterOption) => {
            const active = mobileContentFilter === filterOption.value;
            const category = filterOption.value === "all" ? null : filterOption.value;

            return (
              <button
                key={filterOption.value}
                type="button"
                aria-pressed={active}
                onClick={() => setMobileContentFilter(filterOption.value)}
                className={cn(
                  "dashboard-mobile-filter-button inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 type-body-2 font-medium transition-colors",
                  active
                    ? "border-edge bg-surface-muted text-glyph"
                    : "border-edge-subtle bg-surface text-content-secondary hover:bg-surface-alt hover:text-glyph",
                )}
              >
                {category && <CategoryBadge category={category} className="size-5" iconSize={10} />}
                {filterOption.label}
              </button>
            );
          })}
        </div>

        {/* Cards Grid — @container so the bento's ratio-locked tiles read 100cqw */}
        <div ref={cardsSectionRef} data-region="home-bento-wrap" className="@container w-full">
          {/* Bento Grid */}
          <div
            data-region="home-bento-grid"
            className="bento-grid [--cols:2] [--ratio:calc(320/243)] md:[--cols:2] md:[--ratio:0.72] lg:[--cols:4] lg:[--ratio:calc(292/243)] xl:[--cols:5]"
          >
            {/* Create Cards — fixed 2×2 block, breakpoint-invariant placement */}
            <div data-region="home-create-link" className="hidden md:block lg:col-start-1 lg:row-start-1">
              <CreateCard type="link" className="h-full" onAction={() => setNewLinkModalOpen(true)} />
            </div>
            <div data-region="home-create-collection" className="hidden md:block lg:col-start-2 lg:row-start-1">
              <CreateCard type="collection" className="h-full" onAction={() => setNewCollectionModalOpen(true)} />
            </div>
            <div data-region="home-create-itinerary" className="hidden md:block lg:col-start-1 lg:row-start-2">
              <CreateCard type="itinerary" className="h-full" onAction={() => setNewItineraryModalOpen(true)} />
            </div>

            {/* Map Tile — pinned top-right (3×2 at xl, 2×2 at lg, full-width banner below) */}
            <div
              data-region="home-map-tile"
              className="dashboard-map-container hidden min-w-0 md:col-span-2 md:row-start-3 md:block lg:col-start-3 lg:row-start-1 lg:row-span-2 xl:col-span-3"
            >
              <div className="dashboard-map-outer-wrapper h-full rounded-2xl border border-edge bg-surface p-1">
                <div className="dashboard-map-inner-wrapper h-full w-full overflow-hidden rounded-xl bg-surface-alt">
                  <StaticMap
                    clusters={mapClusters}
                    height="100%"
                    className="border-0 rounded-xl"
                    onClusterClick={handleClusterClick}
                    {...(mapClusters.length === 0 ? { center: SINGAPORE_CENTER, zoom: SINGAPORE_ZOOM } : {})}
                  />
                </div>
              </div>
            </div>

            {/* Latest Viewed — newest thing the user has, filling the 4th tile
                (col2/row2). An in-flight itinerary outranks any existing card, so
                it takes this tile and the latest item drops into the feed. */}
            {featuredJob && (
              <motion.div
                key={featuredJob.id}
                data-region="home-latest-viewed"
                className="h-full md:col-start-2 md:row-start-2 lg:col-start-2 lg:row-start-2"
                // Keyed on the job this tile renders, the way every other card
                // here is keyed on its own id. It used to read `filteredContent[0]`,
                // left over from when this tile held the latest content item —
                // which by definition is *not* what it renders once a job takes
                // it, and which is undefined outright when there is no content.
                initial={
                  newItemIdsRef.current.has(featuredJob.id) && !shouldReduceMotion
                    ? motionPresets.completionHandoff.initial
                    : false
                }
                animate={motionPresets.completionHandoff.animate}
                transition={
                  shouldReduceMotion ? motionTransitions.instant : motionTransitions.spatial
                }
                onAnimationComplete={() => {
                  newItemIdsRef.current.delete(featuredJob.id);
                }}
              >
                <ItineraryQueueCardItem
                  job={featuredJob}
                  gradient={typeGradients.itinerary}
                  onRemove={handleRemovePlanningJob}
                  onRetry={handleRetryPlanningJob}
                />
              </motion.div>
            )}
            {featuredItem && (
              <motion.div
                key={featuredItem.id}
                layout
                data-region="home-latest-viewed"
                data-card-id={featuredItem.id}
                className="h-full md:col-start-2 md:row-start-2 lg:col-start-2 lg:row-start-2"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25, ease: [0.25, 1, 0.5, 1] }}
              >
                {renderCardInner(featuredItem)}
              </motion.div>
            )}

            {/* Queue Cards — any further in-flight itineraries, ahead of the feed */}
            {trailingJobs.map((job) => (
              <motion.div
                key={job.id}
                layout
                data-region="home-itinerary-queue-card"
                className="h-full"
              >
                <ItineraryQueueCardItem
                  job={job}
                  gradient={typeGradients.itinerary}
                  onRemove={handleRemovePlanningJob}
                  onRetry={handleRetryPlanningJob}
                />
              </motion.div>
            ))}

            {/* Feed Cards — everything after the latest, auto-placed from the first free row */}
            {feedItems.map((item) => (
              <motion.div
                key={item.id}
                layout
                data-region="home-feed-card"
                data-card-id={item.id}
                className="h-full"
                initial={
                  newItemIdsRef.current.has(item.id) && !shouldReduceMotion
                    ? motionPresets.completionHandoff.initial
                    : false
                }
                animate={motionPresets.completionHandoff.animate}
                transition={
                  shouldReduceMotion ? motionTransitions.instant : motionTransitions.spatial
                }
                onAnimationComplete={() => {
                  newItemIdsRef.current.delete(item.id);
                }}
              >
                {renderCardInner(item)}
              </motion.div>
            ))}
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="dashboard-initial-loading flex w-full items-center justify-center py-16">
              <span className="type-body-2 text-content-secondary">Loading...</span>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && filteredContent.length === 0 && visiblePlanningJobs.length === 0 && (
            <div data-region="home-empty-state" className="dashboard-empty-state flex w-full flex-col items-center justify-center gap-3 py-16">
              <div className="dashboard-empty-icon-wrapper flex size-14 items-center justify-center rounded-2xl bg-surface-muted">
                <FolderOpen className="size-7 text-content-secondary" />
              </div>
              <div className="dashboard-empty-content flex flex-col items-center gap-1 text-center">
                <p className="dashboard-empty-title type-body-1 text-glyph">No content found</p>
                <p className="dashboard-empty-subtitle type-body-2 text-content-secondary">
                  Try a different filter or add new content
                </p>
              </div>
            </div>
          )}

          {/* Infinite Scroll Sentinel */}
          <div ref={sentinelRef} data-region="home-feed-sentinel" />
          {isLoadingMore && (
            <div className="dashboard-infinite-scroll-loading flex justify-center py-4">
              <span className="type-body-2 text-content-secondary">Loading more...</span>
            </div>
          )}
        </div>
      </div>

      {/* Confirm Delete Modal */}
      <ConfirmDeleteModal
        open={deleteModal.open}
        onOpenChange={(open) => setDeleteModal((prev) => ({ ...prev, open }))}
        entityType={deleteModal.cardType === "itinerary" ? "itinerary" : "collection"}
        entityName={deleteModal.name}
        collaboratorCount={deleteModal.collaboratorCount}
        onConfirm={handleConfirmDelete}
      />

      {/* Add to Destination Modal */}
      <AddToDestinationModal
        open={addToDestModal.open}
        onOpenChange={(open) => setAddToDestModal((prev) => ({ ...prev, open }))}
        mode={addToDestModal.mode}
        locationIds={addToDestModal.locationIds}
        onAdd={handleAddToDestinationConfirm}
      />

      {/* New Link Modal */}
      <NewLinkModal
        open={newLinkModalOpen}
        onOpenChange={setNewLinkModalOpen}
        linkValue={linkValue}
        onLinkChange={setLinkValue}
        onSubmit={handleLinkSubmit}
        onCancel={() => setNewLinkModalOpen(false)}
      />

      {/* New Collection Modal */}
      <NewCollectionModal
        open={newCollectionModalOpen}
        onOpenChange={setNewCollectionModalOpen}
        collectionValue={collectionValue}
        onCollectionChange={setCollectionValue}
        onSubmit={handleCollectionSubmit}
        onCancel={() => setNewCollectionModalOpen(false)}
        isLoading={isCreatingCollection}
      />

      {/* New Itinerary Modal */}
      <NewItineraryModal
        source="dashboard"
        open={newItineraryModalOpen}
        onOpenChange={setNewItineraryModalOpen}
        tripNameValue={tripNameValue}
        onTripNameChange={setTripNameValue}
        selectedLocationIds={[]}
        onSubmit={handleItinerarySubmit}
        onCancel={() => setNewItineraryModalOpen(false)}
      />
    </div>
  );
}
