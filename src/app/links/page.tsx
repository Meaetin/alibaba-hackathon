"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Link } from "lucide-react";

import { LinkCard } from "@/components/ui";
import { CreateCard } from "@/components/ui/dashboard/CreateCard";
import { LinkQueueCard } from "@/components/ui/links/LinkQueueCard";
import { UsageCard } from "@/components/ui/primitives/UsageCard";
import { NewLinkModal } from "@/components/ui/modals/NewLinkModal";
import { useToast } from "@/contexts/ToastContext";
import { AlreadyAnalyzedError, LinkQuotaError, createJob, detachJob, retryJob } from "@/lib/api/client";
import { deleteContent } from "@/lib/api/content";
import { queryClient } from "@/lib/query/queryClient";
import { queryKeys } from "@/lib/query/queryKeys";
import { useJobsQueue } from "@/hooks/useJobsQueue";
import type { QueueJob } from "@/lib/jobs/types";
import { usePaginatedContent } from "@/hooks/usePaginatedContent";
import { useInfiniteScroll } from "@/hooks/useInfiniteScroll";
import { useProgressAnimation } from "@/hooks/useProgressAnimation";
import { useSessionUserId } from "@/hooks/useSessionUserId";
import { useQuotaGate } from "@/hooks/useQuotaGate";
import { useLinkUsageQuery } from "@/hooks/queries/useLinkUsageQuery";
import { motionPresets, motionTransitions } from "@/lib/motion/presets";
import type { CompletedContent } from "@/hooks/usePaginatedContent";

type SortOption = "modified" | "alphabetical";

const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

function QueueCardItem({
  job,
  onRemove,
  onRetry,
}: {
  job: QueueJob;
  onRemove: (id: string) => void;
  onRetry: (job: QueueJob) => Promise<void>;
}) {
  const visualProgress = useProgressAnimation(job);
  const [isRetrying, setIsRetrying] = useState(false);
  const url = (job.payload?.url as string | undefined) ?? "";
  const isFailed = job.status === "failed";
  const isStuckInFlight =
    ["processing", "queued"].includes(job.status) &&
    Date.now() - new Date(job.updated_at).getTime() > STUCK_THRESHOLD_MS;
  const canRetry = isFailed || isStuckInFlight;

  // Clear the retrying state once the backend acks the retry (job leaves "failed").
  // Without this, a retry that succeeds via API but fails again in the worker
  // would render the next failed-state card with a stuck spinner.
  useEffect(() => {
    if (job.status !== "failed") setIsRetrying(false);
  }, [job.status]);

  const handleRetry = async () => {
    if (isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetry(job);
    } catch {
      setIsRetrying(false);
    }
  };

  return (
    <LinkQueueCard
      url={url}
      state={canRetry ? "failed" : job.status === "processing" ? "processing" : "queued"}
      progress={visualProgress}
      thumbnailUrl={job.progress?.thumbnail ?? undefined}
      errorMessage="Couldn't analyze this link. Click retry to try again."
      className="h-full"
      onRemove={() => onRemove(job.id)}
      onRetry={canRetry ? handleRetry : undefined}
      isRetrying={isRetrying}
    />
  );
}

// Subset of the worker's ContentAnalysisResult that the link card reads.
type ContentResult = {
  url?: string;
  title?: string;
  thumbnail?: string;
  content_type?: "video" | "webpage";
  platform?: string;
  creator?: string;
  generated_summary?: string;
  location_count?: number;
};

// A finished content-analysis job already carries its content_id plus the
// normalized result, so we synthesize the completed card straight from it. This
// lets the queue card hand its grid slot to the link card under the SAME key
// (content_id) the moment the job completes — the node persists and morphs in
// place instead of the content table's realtime event lagging behind and making
// the card pop out and back in.
function buildOptimisticContent(job: QueueJob): CompletedContent | null {
  if (!job.content_id) return null;
  const result = (job.result ?? {}) as ContentResult;
  return {
    id: job.content_id,
    content_type: result.content_type ?? "video",
    content_url: result.url ?? (job.payload?.url as string | undefined) ?? "",
    content_title: result.title ?? null,
    content_thumbnail: result.thumbnail ?? job.progress?.thumbnail ?? null,
    content_author: result.creator ?? null,
    platform: result.platform ?? null,
    generated_summary: result.generated_summary ?? null,
    location_count: result.location_count ?? 0,
    processing_status: "completed",
    created_at: job.completed_at ?? job.created_at,
    updated_at: job.updated_at,
    is_bookmarked: false,
    is_archived: false,
  };
}

export default function LinksPage() {
  const { showToast } = useToast();
  const { showQuotaToast } = useQuotaGate();
  const prefersReducedMotion = useReducedMotion();

  const userId = useSessionUserId();
  const [sortOption] = useState<SortOption>("modified");
  const [newLinkModalOpen, setNewLinkModalOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");

  const { data: linkUsage } = useLinkUsageQuery(userId);

  // Just-finished jobs rendered as completed cards immediately, before their
  // real `content` row arrives via realtime — keyed by content_id so the queue
  // card morphs into the link card in the same slot. Pruned once the real row
  // lands (see effect below).
  const [optimisticCompleted, setOptimisticCompleted] = useState<CompletedContent[]>([]);

  const { jobs: queueJobs, removeJob, upsertJob } = useJobsQueue({
    type: "content-analysis",
    onJobCompleted: (job) => {
      const result = (job.result ?? {}) as ContentResult;
      showToast({
        title: "Link finished analyzing",
        variant: "success",
        thumbnail: result.thumbnail ?? job.progress?.thumbnail,
        action: job.content_id
          ? { label: "View", href: `/links/${job.content_id}` }
          : undefined,
      });
      const optimistic = buildOptimisticContent(job);
      if (optimistic) {
        setOptimisticCompleted((prev) =>
          prev.some((c) => c.id === optimistic.id) ? prev : [optimistic, ...prev],
        );
      }
      refreshContent();
    },
    onJobFailed: () => {
      showToast({
        title: "Couldn't analyze this link.",
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
    content: completedContent,
    isLoading: contentLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    refresh: refreshContent,
  } = usePaginatedContent({
    userId,
    filter: "links",
    sortOption,
  });

  const { sentinelRef } = useInfiniteScroll(loadMore, {
    enabled: hasMore && !isLoadingMore,
  });

  // Drop optimistic cards once their real `content` row has loaded, so the link
  // card hands off to the canonical row (same key → no flicker).
  useEffect(() => {
    setOptimisticCompleted((prev) => {
      if (prev.length === 0) return prev;
      const realIds = new Set(completedContent.map((c) => c.id));
      const next = prev.filter((c) => !realIds.has(c.id));
      return next.length === prev.length ? prev : next;
    });
  }, [completedContent]);

  const handleRemoveJob = async (jobId: string) => {
    removeJob(jobId);
    try {
      await detachJob(jobId);
      if (userId) queryClient.invalidateQueries({ queryKey: queryKeys.linkUsage(userId) });
    } catch {
      showToast({ title: "Couldn't remove link, try again later.", variant: "error" });
    }
  };

  const handleRetryJob = async (job: QueueJob) => {
    try {
      // The endpoint returns the reset row (queued, or pending if dispatched).
      // Merge it immediately so the card leaves the failed state without waiting
      // on realtime.
      const updated = (await retryJob(job.id)) as QueueJob | null;
      if (updated?.id) upsertJob(updated);
    } catch (err) {
      showToast({ title: "Couldn't requeue link, try again later.", variant: "error" });
      throw err;
    }
  };

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

  // Single-item delete — the card's kebab / right-click menu (owned by BaseCard)
  // calls this with the card's id.
  const handleDelete = useCallback(
    (id: string) => {
      deleteContent(id)
        .then(() => {
          refreshContent();
          showToast({ title: "Deleted", variant: "success" });
        })
        .catch(() => showToast({ title: "Something went wrong. Try again.", variant: "error" }));
    },
    [refreshContent, showToast],
  );

  // Merge the two data sources into one keyed list so a completing job morphs
  // into its link card in place. A job's grid slot is identified by its
  // content_id; once that id surfaces as a completed card (optimistic or real),
  // the queue card drops out and the link card takes over the same key.
  const realCompletedIds = new Set(completedContent.map((c) => c.id));
  const pendingOptimistic = optimisticCompleted.filter((c) => !realCompletedIds.has(c.id));
  const optimisticIds = new Set(pendingOptimistic.map((c) => c.id));

  const seenJobContentIds = new Set<string>();
  const activeJobs = queueJobs.filter((job) => {
    if (job.content_id && (realCompletedIds.has(job.content_id) || optimisticIds.has(job.content_id))) {
      return false;
    }
    if (job.content_id) {
      if (seenJobContentIds.has(job.content_id)) return false;
      seenJobContentIds.add(job.content_id);
    }
    return true;
  });

  // Completed cards in render order: just-finished (optimistic) first, then the
  // paginated real rows.
  const completedCards = [...pendingOptimistic, ...completedContent];

  const isEmpty = completedCards.length === 0 && activeJobs.length === 0;

  return (
    <div className="links-page flex flex-col min-h-full pt-[var(--navbar-height)]" data-region="links-page">
      {/* Header + grid share one shell so left/right edges always align */}
      <div
        data-region="links-shell"
        className="links-shell mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-3 pt-3 pb-10 md:px-8 lg:px-12 xl:px-20"
      >
        {/* Header Section */}
        <div data-region="links-header" className="links-header-row flex w-full flex-col items-stretch gap-3 md:flex-row md:items-start md:justify-between">
          <h1 className="links-header-title type-h4 font-secondary font-semibold text-glyph">
            Your Links
          </h1>
          <UsageCard
            type="link"
            usage={linkUsage}
            variant="detailed"
            upgradeHref={linkUsage && linkUsage.used >= linkUsage.max ? "/billing" : undefined}
            className="links-usage-card w-full shrink-0 md:w-[280px]"
          />
        </div>

        {/* Cards Grid — @container so the bento's ratio-locked tiles read 100cqw */}
        <div data-region="links-bento-wrap" className="@container w-full">
          {/* Bento Grid — uniform 243:292 tiles, ladder 2→3→4→5 (5 max) */}
          <div
            data-region="links-cards-grid"
            className="links-cards-grid bento-grid [--cols:1] [--ratio:0.72] sm:[--cols:2] sm:[--ratio:calc(292/243)] md:[--cols:3] lg:[--cols:4] xl:[--cols:5]"
          >
            {/* Add Link Card — always first */}
            <div data-region="links-create" className="h-full">
              <CreateCard type="link" className="h-full" onAction={() => setNewLinkModalOpen(true)} />
            </div>

            {/* Queue Cards — active jobs (failed pinned, then newest first).
                Keyed by content_id so the card morphs into its link card in the
                same slot when the job finishes. */}
            {activeJobs.map((job) => (
              <motion.div
                key={job.content_id ?? job.id}
                layout
                data-region="links-queue-card"
                className="h-full"
              >
                <QueueCardItem
                  job={job}
                  onRemove={handleRemoveJob}
                  onRetry={handleRetryJob}
                />
              </motion.div>
            ))}

            {/* Link Cards — completed links, recency order. Shares the queue
                card's key so a completing job reuses the same node (no remount).
                `initial` only plays for genuinely new cards, not morphed ones. */}
            {completedCards.map((item: CompletedContent) => {
              const isCompletionHandoff = optimisticIds.has(item.id);

              return (
                <motion.div
                key={item.id}
                layout
                data-region="links-card"
                data-card-id={item.id}
                className="h-full"
                initial={prefersReducedMotion || !isCompletionHandoff ? false : motionPresets.completionHandoff.initial}
                animate={motionPresets.completionHandoff.animate}
                transition={prefersReducedMotion ? motionTransitions.instant : motionTransitions.spatial}
              >
                <LinkCard
                  label={item.content_title ?? item.content_url}
                  imageUrl={item.content_thumbnail ?? undefined}
                  href={`/links/${item.id}`}
                  className="h-full"
                  onDelete={() => handleDelete(item.id)}
                />
                </motion.div>
              );
            })}
          </div>

          {/* Loading State */}
          {contentLoading && (
            <div className="flex items-center justify-center py-16 w-full">
              <span className="type-body-2 text-content-secondary">Loading links…</span>
            </div>
          )}

          {/* Empty State */}
          {!contentLoading && isEmpty && (
            <div
              data-region="links-empty-state"
              className="flex flex-col items-center justify-center py-16 gap-3 w-full"
            >
              <div className="flex items-center justify-center size-14 rounded-2xl bg-surface-muted">
                <Link className="size-7 text-content-secondary" />
              </div>
              <div className="flex flex-col items-center gap-1 text-center">
                <p className="type-body-1 text-glyph">No links yet</p>
                <p className="type-body-2 text-content-secondary">
                  Add a link and we&apos;ll extract the locations for you
                </p>
              </div>
            </div>
          )}

          {/* Infinite Scroll Sentinel */}
          <div ref={sentinelRef} data-region="links-feed-sentinel" />
          {isLoadingMore && (
            <div className="flex justify-center py-4">
              <span className="type-body-2 text-content-secondary">Loading more...</span>
            </div>
          )}
        </div>
      </div>

      {/* New Link Modal */}
      <NewLinkModal
        open={newLinkModalOpen}
        onOpenChange={setNewLinkModalOpen}
        linkValue={linkValue}
        onLinkChange={setLinkValue}
        onSubmit={handleLinkSubmit}
        onCancel={() => setNewLinkModalOpen(false)}
      />
    </div>
  );
}
