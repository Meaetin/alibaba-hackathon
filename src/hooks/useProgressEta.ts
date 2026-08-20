"use client";

import { useEffect, useState } from "react";
import type { QueueJob } from "./useJobsQueue";

/**
 * Human phrasing for the time left on an itinerary-planning job.
 *
 * Production p50 is ~43s and p95 ~82s, so this reads in seconds for almost every
 * real run — a "1 min" granularity would spend the whole job showing the same
 * string. Precision is deliberately coarse (10s buckets): the estimate is a p50
 * over a long-tailed distribution and a second-accurate countdown would imply a
 * confidence we do not have.
 */
function phrase(secondsLeft: number): string {
  if (secondsLeft > 150) return `about ${Math.round(secondsLeft / 60)} min left`;
  if (secondsLeft > 90) return "about 2 min left";
  if (secondsLeft > 45) return "about a minute left";
  return `about ${Math.max(10, Math.round(secondsLeft / 10) * 10)} seconds left`;
}

/**
 * Counts down locally between worker updates, so the number moves every second
 * without a realtime write per tick.
 *
 * Always expressed as time — never a percentage. The bar already carries the
 * percentage, and swapping the countdown for a duplicate of it (which is what
 * happened when the estimate ran out) tells the user nothing about waiting.
 */
export function useProgressEta(job: QueueJob): { label: string | null; isOverrun: boolean } {
  const firedAt = job.progress?.fired_at;
  const etaSeconds = job.progress?.eta_seconds;
  const percent = job.progress?.percent;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (job.status !== "processing" && job.status !== "pending" && job.status !== "queued") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.status]);

  if (job.status !== "processing" || etaSeconds == null || !firedAt) {
    return { label: null, isOverrun: false };
  }

  const elapsedSinceReport = (now - new Date(firedAt).getTime()) / 1000;
  const secondsLeft = etaSeconds - elapsedSinceReport;

  // "A few seconds left" while the bar reads 43% is a promise the run can't keep.
  // Below the last stretch, hold the countdown at a floor instead of letting it
  // drain to zero between reports — the next worker report will correct it.
  const nearlyDone = (percent ?? 0) >= 90;
  if (secondsLeft <= 5) {
    if (nearlyDone) return { label: null, isOverrun: true };
    return { label: phrase(10), isOverrun: false };
  }

  return { label: phrase(secondsLeft), isOverrun: false };
}
