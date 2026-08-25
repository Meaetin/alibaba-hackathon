"use client";

import { useEffect, useState } from "react";
import { ItineraryQueueCard } from "./ItineraryQueueCard";
import { useProgressAnimation } from "@/hooks/useProgressAnimation";
import { useLocationPhoto } from "@/hooks/useLocationPhoto";
import type { QueueJob } from "@/lib/jobs/types";

// Matches the server's retry gate (backend/api/src/routes/jobs.ts) — a job stuck
// in flight this long is offered a retry even though it never formally failed.
const STUCK_THRESHOLD_MS = 15 * 60 * 1000;

/** Reads the trip name, destination, and chosen photo off the job payload. */
function describeTrip(job: QueueJob): {
  title: string;
  region?: string;
  country?: string;
  thumbnailUrl?: string;
} {
  const payload = (job.payload ?? {}) as {
    title?: string;
    region?: string;
    country?: string;
    thumbnailUrl?: string;
  };
  return {
    title: payload.title?.trim() || "New itinerary",
    region: payload.region || undefined,
    country: payload.country || undefined,
    thumbnailUrl: payload.thumbnailUrl || undefined,
  };
}

/**
 * Binds an in-flight itinerary-planning job to the queue card: animates the
 * worker-reported percentage, ticks the ETA down locally, and owns the retry
 * spinner. Shared by the itineraries grid and the home recents grid.
 */
export function ItineraryQueueCardItem({
  job,
  gradient,
  onRemove,
  onRetry,
}: {
  job: QueueJob;
  gradient?: string;
  onRemove: (id: string) => void;
  onRetry: (job: QueueJob) => Promise<void>;
}) {
  const progress = useProgressAnimation(job);
  const [isRetrying, setIsRetrying] = useState(false);

  const { title, region, country, thumbnailUrl } = describeTrip(job);
  // The photo chosen when the job was queued and carried in its payload — the
  // worker saves that exact URL, so the media slot doesn't change when the job
  // lands. It's absent when the destination wasn't cached yet (the API won't
  // block a creation on an Unsplash call): resolve it here instead, seeded with
  // the job id so this lookup and the worker's land on the same photo.
  const { url: photoUrl, isPending: isPhotoPending } = useLocationPhoto(
    { region, country, seed: job.id },
    Boolean(thumbnailUrl),
  );
  const isFailed = job.status === "failed";
  const isStuckInFlight =
    ["processing", "queued"].includes(job.status) &&
    Date.now() - new Date(job.updated_at).getTime() > STUCK_THRESHOLD_MS;
  const canRetry = isFailed || isStuckInFlight;

  // Clear the spinner once the backend acks the retry (job leaves "failed"), so a
  // retry that fails again doesn't render the next failed card mid-spin.
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

  // Defensive only: useJobsQueue removes completed rows after its callback,
  // but an intermediate render must never relabel a completed job as queued.
  if (job.status === "completed") return null;

  return (
    <ItineraryQueueCard
      title={title}
      state={canRetry ? "failed" : job.status === "processing" ? "processing" : "queued"}
      progress={progress}
      imageUrl={thumbnailUrl ?? photoUrl ?? undefined}
      isImagePending={isPhotoPending}
      gradient={gradient}
      errorMessage="We couldn't finish this itinerary. Try again."
      className="h-full"
      onRemove={() => onRemove(job.id)}
      onRetry={canRetry ? handleRetry : undefined}
      isRetrying={isRetrying}
    />
  );
}
