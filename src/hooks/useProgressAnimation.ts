"use client";

import { useEffect, useRef, useState } from "react";
import type { QueueJob } from "./useJobsQueue";

// Maps step number to a target visual percentage.
// Front-loaded: quick jumps early, slow creep toward the end.
const STEP_TO_PERCENT: Record<number, number> = {
  1: 20,
  2: 55,
  3: 82,
  4: 88,
  5: 92,
  6: 95,
  7: 97,
};

function getTargetPercent(job: QueueJob): number {
  if (job.status === "completed") return 100;
  if (job.status === "queued" || job.status === "pending") return 0;

  // Itinerary-planning reports a real percentage derived from measured stage
  // weights — trust it rather than re-deriving one from the step ordinal.
  const reported = job.progress?.percent;
  if (typeof reported === "number") return reported;

  // Status is 'processing'
  const step = job.progress?.step;
  if (!step) return 12; // Just started
  return STEP_TO_PERCENT[step] ?? Math.min(step * 14, 90);
}

const CRAWL_INTERVAL_MS = 2000;
const CRAWL_INCREMENT = 0.4;
const CRAWL_BUFFER = 3; // Stay 3% below next step threshold

export function useProgressAnimation(job: QueueJob): number {
  const target = getTargetPercent(job);
  const [display, setDisplay] = useState(target);
  const crawlTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hasReportedPercent = typeof job.progress?.percent === "number";

  // Jump to target when a new step arrives. Never walk backwards while the job is
  // still running: useJobsQueue's reconcile pass can hand us a staler row than the
  // realtime update we already applied, and a bar that retreats reads as a bug.
  useEffect(() => {
    setDisplay((prev) => {
      if (job.status === "completed" || job.status === "failed") return target;
      if (job.status === "queued" || job.status === "pending") return target;
      return Math.max(prev, target);
    });
  }, [target, job.updated_at, job.status]);

  // Crawl effect: slowly creep forward while processing between steps
  const nextPercent = job.progress?.next_percent;
  const stageMs = job.progress?.stage_ms;
  const firedAt = job.progress?.fired_at;

  useEffect(() => {
    if (crawlTimer.current) clearInterval(crawlTimer.current);
    if (job.status !== "processing") return;

    // When the worker tells us where this stage ends and how long it should take,
    // walk the bar across that span on wall clock. This is what keeps the AI-only
    // landmark skeleton — 45% of the run, one opaque call that reports nothing
    // until it returns — from looking frozen.
    if (hasReportedPercent && nextPercent != null && stageMs && firedAt) {
      const startedAt = new Date(firedAt).getTime();
      const span = nextPercent - CRAWL_BUFFER - target;
      if (span <= 0) return;

      crawlTimer.current = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        // Ease out as the stage overruns its estimate, so a slow run keeps
        // inching rather than parking on the ceiling.
        const ratio = Math.min(1, elapsed / stageMs);
        const projected = target + span * ratio;
        setDisplay((prev) => Math.max(prev, Math.min(projected, nextPercent - CRAWL_BUFFER)));
      }, 500);

      return () => {
        if (crawlTimer.current) clearInterval(crawlTimer.current);
      };
    }

    const step = job.progress?.step ?? 1;
    const nextTarget = STEP_TO_PERCENT[step + 1] ?? (STEP_TO_PERCENT[step] ?? 90);
    const crawlCap = nextTarget - CRAWL_BUFFER;

    crawlTimer.current = setInterval(() => {
      setDisplay((prev) => {
        if (prev >= crawlCap) return prev;
        return Math.min(prev + CRAWL_INCREMENT, crawlCap);
      });
    }, CRAWL_INTERVAL_MS);

    return () => {
      if (crawlTimer.current) clearInterval(crawlTimer.current);
    };
  }, [job.status, job.updated_at, job.progress?.step, hasReportedPercent, target, nextPercent, stageMs, firedAt]);

  return Math.round(display);
}
