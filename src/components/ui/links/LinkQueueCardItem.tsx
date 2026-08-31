"use client";

import { useEffect, useState } from "react";

import { useProgressAnimation } from "@/hooks/useProgressAnimation";
import { LINK_STUCK_MS } from "@/lib/links/progress";
import type { QueueJob } from "@/lib/jobs/types";
import { LinkQueueCard } from "./LinkQueueCard";

/**
 * Binds an in-flight content-analysis job to the link-shaped queue card. Shared
 * by `/links` and Home so progress, retry and thumbnail behavior cannot drift.
 */
export function LinkQueueCardItem({
  job,
  onRemove,
  onRetry,
}: {
  job: QueueJob;
  onRemove?: (id: string) => void;
  onRetry: (job: QueueJob) => Promise<void>;
}) {
  const visualProgress = useProgressAnimation(job);
  const [isRetrying, setIsRetrying] = useState(false);
  const url = (job.payload?.url as string | undefined) ?? "";
  const isFailed = job.status === "failed";
  const isStuckInFlight =
    ["processing", "queued"].includes(job.status) &&
    Date.now() - new Date(job.updated_at).getTime() > LINK_STUCK_MS;
  const canRetry = isFailed || isStuckInFlight;

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

  if (job.status === "completed") return null;

  return (
    <LinkQueueCard
      url={url}
      state={canRetry ? "failed" : job.status === "processing" ? "processing" : "queued"}
      progress={visualProgress}
      thumbnailUrl={job.progress?.thumbnail ?? undefined}
      errorMessage="Couldn't analyze this link. Click retry to try again."
      className="h-full"
      onRemove={onRemove ? () => onRemove(job.id) : undefined}
      onRetry={canRetry ? handleRetry : undefined}
      isRetrying={isRetrying}
    />
  );
}
