"use client";

import { motion } from "motion/react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/primitives/Button";
import { ProgressBar } from "@/components/ui/primitives/ProgressBar";
import { useProgressAnimation } from "@/hooks/useProgressAnimation";
import { useProgressEta } from "@/hooks/useProgressEta";
import type { QueueJob } from "@/hooks/useJobsQueue";

interface ItineraryLoadingScreenProps {
  className?: string;
  title?: string;
  subtitle?: string;
  onDismiss?: () => void;
  dismissLabel?: string;
  /**
   * In-flight planning job. When supplied, the screen reports the worker's real
   * stage, percentage and ETA. Without it the bar falls back to the indeterminate
   * one-shot fill, which is what the navigation-loading caller (MainLayout) wants —
   * there's no job behind a route change.
   */
  job?: QueueJob | null;
}

export function ItineraryLoadingScreen({
  className,
  title = "Loading Itinerary",
  subtitle = "Hold on while we load your trip...",
  onDismiss,
  dismissLabel = "Continue Browsing, Alert When Ready",
  job,
}: ItineraryLoadingScreenProps) {
  return (
    <div
      className={cn(
        "itinerary-loading-screen fixed inset-0 z-50 flex flex-col items-center justify-center gap-10 bg-surface",
        className
      )}
    >
      <motion.div
        className="itinerary-loading-spinner flex items-center justify-center"
        animate={{ rotate: [0, 360] }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
      >
        <Image
          src="/images/argo-icon.svg"
          alt="Argo"
          width={24}
          height={24}
          className="itinerary-loading-icon size-6"
        />
      </motion.div>

      <div className="itinerary-loading-text flex flex-col items-center gap-4">
        <h2 className="itinerary-loading-title type-h4 type-secondary text-content">{title}</h2>
        <p className="itinerary-loading-subtitle type-body-2 text-content-secondary">{subtitle}</p>

        {/* Progress Bar */}
        {job ? <TrackedProgress job={job} /> : (
          <ProgressBar value={100} showLabel={false} autoFill className="itinerary-loading-progress w-48 mt-2" />
        )}

        {onDismiss && (
          <Button variant="secondary" size="md" onClick={onDismiss} className="itinerary-loading-dismiss mt-4">
            {dismissLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Live stage + percent + countdown for a tracked planning job. */
function TrackedProgress({ job }: { job: QueueJob }) {
  const progress = useProgressAnimation(job);
  const { label: etaLabel, isOverrun } = useProgressEta(job);

  const isWaiting = job.status === "queued" || job.status === "pending";
  const stage = isWaiting ? "Waiting to start" : job.progress?.label ?? "Getting started";
  // Always time, never a percentage — the bar already carries the percentage.
  const trailing = isWaiting ? "In queue" : isOverrun || !etaLabel ? "Almost there" : etaLabel;

  return (
    <div className="itinerary-loading-tracked mt-2 flex w-72 flex-col gap-2">
      <ProgressBar
        value={progress}
        label={stage}
        formatLabel={() => trailing}
        labelClassName="type-body-4 gap-2 [&>span:first-child]:min-w-0 [&>span:first-child]:truncate [&>span:last-child]:shrink-0"
        className="itinerary-loading-progress w-full"
      />
    </div>
  );
}
