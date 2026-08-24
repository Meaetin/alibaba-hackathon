"use client";

import { useState, useMemo, useCallback, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Map as MapIcon } from "lucide-react";
import { motion } from "motion/react";
import { ItineraryCard } from "@/components/ui";
import { CreateCard } from "@/components/ui/dashboard/CreateCard";
import { UsageCard } from "@/components/ui/primitives/UsageCard";
import { NewItineraryModal } from "@/components/ui/modals/NewItineraryModal";
import { ConfirmDeleteModal } from "@/components/ui/modals/ConfirmDeleteModal";
import {
  createItineraryRouted,
  ItineraryQuotaError,
  deleteItinerary,
  type ItineraryWithRole,
} from "@/lib/api/itineraries";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/contexts/ToastContext";
import { useSessionUserId } from "@/hooks/useSessionUserId";
import { useQuotaGate } from "@/hooks/useQuotaGate";
import { useJobsQueue, type QueueJob } from "@/hooks/useJobsQueue";
import { ItineraryQueueCardItem } from "@/components/ui/itinerary/ItineraryQueueCardItem";
import { detachJob, retryJob } from "@/lib/api/client";
import { useItinerariesQuery } from "@/hooks/queries/useItinerariesQuery";
import { useItineraryUsageQuery } from "@/hooks/queries/useItineraryUsageQuery";
import { queryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/queryKeys";
import { getItineraryDetail } from "@/lib/supabase/queries/home";
import { useNavigationLoading } from "@/contexts/NavigationLoadingContext";

const itineraryGradient = "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)";

/**
 * Synthesizes the finished itinerary card straight from the completed job, so the
 * grid slot is filled in the same render the queue card leaves it. Without this
 * the card vanishes until the refetch lands and every card after it shifts, then
 * shifts back.
 */
function buildOptimisticItinerary(job: QueueJob): ItineraryWithRole | null {
  const itineraryId = job.result?.itinerary_id as string | undefined;
  if (!itineraryId) return null;
  const payload = (job.payload ?? {}) as {
    title?: string;
    country?: string;
    region?: string;
    totalDays?: number;
    startDate?: string;
    thumbnailUrl?: string;
  };
  const now = job.completed_at ?? job.updated_at;
  return {
    id: itineraryId,
    name: payload.title?.trim() || "New itinerary",
    country: payload.country,
    region: payload.region,
    start_date: payload.startDate,
    total_days: payload.totalDays ?? 0,
    total_activities: 0,
    collection_id: "",
    user_role: "owner",
    is_bookmarked: false,
    is_archived: false,
    is_public: false,
    // The photo the worker saved; falls back to the one the queue card was
    // showing, so this card never blinks to a gradient mid-handover.
    thumbnail_url:
      (job.result?.thumbnail_url as string | undefined) ?? payload.thumbnailUrl ?? null,
    created_at: now,
    updated_at: now,
  };
}

export default function ItinerariesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const { showQuotaToast } = useQuotaGate();
  const { data: itineraries = [], isLoading } = useItinerariesQuery();
  const userId = useSessionUserId();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [, setIsCreating] = useState(false);
  const [newItineraryName, setNewItineraryName] = useState("");

  const { startLoading } = useNavigationLoading();
  const [, startTransition] = useTransition();

  const [deleteModal, setDeleteModal] = useState<{
    open: boolean;
    ids: string[];
    name: string;
    collaboratorCount: number;
  }>({ open: false, ids: [], name: "", collaboratorCount: 0 });

  const { data: itineraryUsage } = useItineraryUsageQuery(userId);

  // Just-finished jobs rendered as real itinerary cards immediately, before the
  // refetched list arrives — keyed by itinerary id so the grid never has a frame
  // where neither the queue card nor the itinerary card exists (which is what made
  // the cards shift twice). Pruned once the canonical row lands.
  const [optimisticItineraries, setOptimisticItineraries] = useState<ItineraryWithRole[]>([]);

  // Itineraries are planned asynchronously. The in-flight jobs render as queue
  // cards at the head of the grid (with live stage + ETA), then hand their slot to
  // the real itinerary card when the job lands.
  //
  // The "Itinerary ready" toast is deliberately NOT raised here — the global
  // ItineraryJobNotifier owns it, and toasting in both places showed it twice.
  const { jobs: planningJobs, removeJob, upsertJob } = useJobsQueue(userId, {
    type: "itinerary-planning",
    onJobCompleted: (job) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.itineraries() });
      if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.upcomingItineraries(userId) });
      const optimistic = buildOptimisticItinerary(job);
      if (optimistic) {
        setOptimisticItineraries((prev) =>
          prev.some((i) => i.id === optimistic.id) ? prev : [optimistic, ...prev],
        );
      }
    },
    // Failure is surfaced by the queue card (error copy + Try Again) and the
    // global notifier's toast — a third announcement here made it fire twice.
  });

  // Hand off to the canonical row once it loads (same key → no remount).
  // Keyed on the id list rather than the array identity — `data = []` hands back
  // a fresh array on every render while the query is empty.
  const realItineraryIdsKey = itineraries.map((i) => i.id).join(",");
  useEffect(() => {
    const realIds = new Set(realItineraryIdsKey ? realItineraryIdsKey.split(",") : []);
    setOptimisticItineraries((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter((i) => !realIds.has(i.id));
      return next.length === prev.length ? prev : next;
    });
  }, [realItineraryIdsKey]);

  const handleRemoveJob = useCallback(
    async (jobId: string) => {
      removeJob(jobId);
      try {
        await detachJob(jobId);
      } catch {
        showToast({ title: "Couldn't dismiss that, try again later.", variant: "error" });
      }
    },
    [removeJob, showToast],
  );

  const handleRetryJob = useCallback(
    async (job: QueueJob) => {
      try {
        // The endpoint returns the reset row — merge it straight away so the card
        // leaves the failed state without waiting on realtime.
        const updated = (await retryJob(job.id)) as QueueJob | null;
        if (updated?.id) upsertJob(updated);
      } catch (err) {
        showToast({ title: "Couldn't retry that, try again later.", variant: "error" });
        throw err;
      }
    },
    [upsertJob, showToast],
  );

  // Active, non-archived itineraries in recency order (most recently modified
  // first), with just-finished jobs merged in ahead of the refetch.
  const filteredItineraries = useMemo(() => {
    const realIds = new Set(itineraries.map((i) => i.id));
    return [...optimisticItineraries.filter((i) => !realIds.has(i.id)), ...itineraries]
      .filter((item) => !item.is_archived)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [itineraries, optimisticItineraries]);

  const handleItineraryHover = useCallback((id: string) => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.itineraryDetail(id),
      queryFn: () => {
        const supabase = createClient();
        return getItineraryDetail(supabase, id);
      },
      staleTime: 5 * 60 * 1000,
    });
  }, []);

  const navigateToItinerary = useCallback((id: string) => {
    startLoading();
    startTransition(() => {
      router.push(`/itineraries/${id}`);
    });
  }, [router, startLoading]);

  const itineraryQuotaExceeded = itineraryUsage ? itineraryUsage.used >= itineraryUsage.max : false;

  const handleCreateNewItinerary = () => {
    if (itineraryQuotaExceeded) {
      showQuotaToast("itinerary", itineraryUsage?.max ?? 0);
      return;
    }
    setIsCreateModalOpen(true);
  };

  // The itineraries page is a no-selection entry point: locations are never
  // pre-selected here, so only the AI toggle matters — on → AI-only plan (2a),
  // off → blank itinerary (2b).
  const handleCreateItinerary = async ({ tripName, country, region, latitude, longitude, startDate, totalDays, endDate, aiRecommendations }: { tripName: string; country?: string; region?: string; latitude?: number; longitude?: number; startDate?: string; totalDays?: number; endDate?: string; aiRecommendations: boolean }) => {
    if (!tripName || !country || !startDate || !totalDays) return;
    setIsCreating(true);
    try {
      const result = await createItineraryRouted({
        source: "itineraries",
        tripName, country, region, latitude, longitude,
        startDate, endDate, totalDays,
        selectedLocationIds: [],
        aiRecommendations,
      });
      setIsCreateModalOpen(false);
      setNewItineraryName("");

      // AI-only itinerary → async job; the itinerary-planning queue above
      // refreshes the list and toasts a "View" link on completion.
      if (result.kind === "planning") {
        showToast({ title: "Generating itinerary…", variant: "success" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.itineraries() });
      if (userId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.upcomingItineraries(userId) });
        queryClient.invalidateQueries({ queryKey: queryKeys.itineraryUsage(userId) });
      }
      navigateToItinerary(result.itinerary.id);
    } catch (err) {
      console.error("Failed to create itinerary:", err);
      if (err instanceof ItineraryQuotaError) {
        if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.itineraryUsage(userId) });
        showQuotaToast("itinerary", err.max_itineraries);
        setIsCreateModalOpen(false);
      } else {
        showToast({
          title: "Failed to create itinerary",
          description: err instanceof Error ? err.message : "Something went wrong.",
          variant: "error",
        });
      }
    } finally {
      setIsCreating(false);
    }
  };

  const handleCancelCreate = () => {
    setIsCreateModalOpen(false);
    setNewItineraryName("");
  };

  // ── Delete handler ───────────────────────────────────────────────────────────
  // The card's kebab / right-click menu (owned by BaseCard) requests deletion;
  // itineraries route through ConfirmDeleteModal (collaborator-aware).

  const handleDeleteRequest = useCallback((item: ItineraryWithRole) => {
    setDeleteModal({ open: true, ids: [item.id], name: item.name, collaboratorCount: 0 });
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const { ids } = deleteModal;
    try {
      await Promise.all(ids.map((id) => deleteItinerary(id)));
      queryClient.invalidateQueries({ queryKey: queryKeys.itineraries() });
      if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.itineraryUsage(userId) });
      showToast({ title: "Deleted", variant: "success" });
    } catch {
      showToast({ title: "Something went wrong. Try again.", variant: "error" });
    }
  }, [deleteModal, userId, showToast]);

  return (
    <div className="itineraries-page flex flex-col min-h-full pt-[var(--navbar-height)]" data-region="itineraries-page">
      {/* Shell — header + bento grid share one container so left/right edges align */}
      <div
        data-region="itineraries-shell"
        className="itineraries-shell mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 pt-3 pb-10 md:px-8 lg:px-12 xl:px-20"
      >
        {/* Header Section — title + usage */}
        <div data-region="itineraries-header" className="itineraries-header-row flex w-full flex-col items-stretch gap-3 md:flex-row md:items-start md:justify-between">
          <h1 data-region="itineraries-title" className="itineraries-title type-h4 font-secondary font-semibold text-glyph">
            Your Itineraries
          </h1>
          <div data-region="itineraries-usage" className="shrink-0">
            <UsageCard
              type="itinerary"
              usage={itineraryUsage}
              variant="detailed"
              upgradeHref={
                itineraryUsage && itineraryUsage.used >= itineraryUsage.max ? "/billing" : undefined
              }
              className="itineraries-usage-card w-full md:w-[280px]"
            />
          </div>
        </div>

        {/* Cards Grid — @container so the bento's ratio-locked tiles read 100cqw */}
        <div data-region="itineraries-bento-wrap" className="@container w-full">
          {/* Bento Grid */}
          <div
            data-region="itineraries-bento-grid"
            className="bento-grid [--ratio:0.72] [--cols:1] sm:[--ratio:calc(292/243)] sm:[--cols:2] md:[--cols:3] lg:[--cols:4] xl:[--cols:5]"
          >
            {/* Create Card — always first */}
            <div data-region="itineraries-create" className="h-full">
              <CreateCard type="itinerary" className="h-full" onAction={handleCreateNewItinerary} />
            </div>

            {/* Queue Cards — itineraries still being planned (failed pinned first,
                then newest). On completion the optimistic itinerary card takes this
                slot in the same render, so nothing below it moves. */}
            {planningJobs.map((job) => (
              <motion.div
                key={job.id}
                layout
                data-region="itineraries-queue-card"
                className="h-full"
              >
                <ItineraryQueueCardItem
                  job={job}
                  gradient={itineraryGradient}
                  onRemove={handleRemoveJob}
                  onRetry={handleRetryJob}
                />
              </motion.div>
            ))}

            {/* Itinerary Cards — recency order, auto-placed after the create card */}
            {filteredItineraries.map((item) => (
              <div
                key={item.id}
                data-region="itineraries-card"
                data-card-id={item.id}
                className="h-full"
                onMouseEnter={() => handleItineraryHover(item.id)}
              >
                <ItineraryCard
                  label={item.name}
                  imageUrl={item.thumbnail_url ?? undefined}
                  gradient={item.thumbnail_url ? undefined : itineraryGradient}
                  className="h-full"
                  prefetchHref={`/itineraries/${item.id}`}
                  onClick={() => navigateToItinerary(item.id)}
                  onDelete={() => handleDeleteRequest(item)}
                />
              </div>
            ))}
          </div>

          {/* Loading State */}
          {isLoading && (
            <div className="itineraries-initial-loading flex w-full items-center justify-center py-16">
              <span className="type-body-2 text-content-secondary">Loading...</span>
            </div>
          )}

          {/* Empty State */}
          {!isLoading && filteredItineraries.length === 0 && planningJobs.length === 0 && (
            <div data-region="itineraries-empty-state" className="itineraries-empty-state flex w-full flex-col items-center justify-center gap-3 py-16">
              <div className="itineraries-empty-icon-wrapper flex size-14 items-center justify-center rounded-2xl bg-surface-muted">
                <MapIcon className="size-7 text-content-secondary" />
              </div>
              <div className="itineraries-empty-content flex flex-col items-center gap-1 text-center">
                <p className="itineraries-empty-title type-body-1 text-glyph">No itineraries found</p>
                <p className="itineraries-empty-subtitle type-body-2 text-content-secondary">
                  Create a new itinerary to get started
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Confirm Delete Modal */}
      <ConfirmDeleteModal
        open={deleteModal.open}
        onOpenChange={(open) => setDeleteModal((prev) => ({ ...prev, open }))}
        entityType="itinerary"
        entityName={deleteModal.name}
        collaboratorCount={deleteModal.collaboratorCount}
        onConfirm={handleConfirmDelete}
      />

      {/* Create Itinerary Modal */}
      <NewItineraryModal
        source="itineraries"
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        tripNameValue={newItineraryName}
        onTripNameChange={setNewItineraryName}
        selectedLocationIds={[]}
        onSubmit={handleCreateItinerary}
        onCancel={handleCancelCreate}
      />
    </div>
  );
}
