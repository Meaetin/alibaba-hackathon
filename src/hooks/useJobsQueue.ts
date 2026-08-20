"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface QueueJob {
  id: string;
  user_id: string;
  type: string;
  status: "pending" | "queued" | "processing" | "completed" | "failed" | "cancelled";
  payload: Record<string, unknown> | null;
  result?: Record<string, unknown>;
  error?: string;
  content_id?: string;
  progress?: {
    step: number;
    label: string;
    fired_at: string;
    thumbnail?: string;
    /** Itinerary-planning only: worker-computed percentage, authoritative when present. */
    percent?: number;
    stage?: string;
    eta_seconds?: number;
    done?: number;
    total?: number;
    /** Percentage this stage ends at + its expected duration, for gap-filling. */
    next_percent?: number;
    stage_ms?: number;
  } | null;
  detached: boolean;
  created_at: string;
  updated_at: string;
  completed_at?: string;
}

// Failed jobs pin to the front so errors are always visible; within each
// group newest first, so a freshly added job lands right after the errors.
function compareQueueJobs(a: QueueJob, b: QueueJob): number {
  const aFailed = a.status === "failed" ? 0 : 1;
  const bFailed = b.status === "failed" ? 0 : 1;
  if (aFailed !== bFailed) return aFailed - bFailed;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

export function useJobsQueue(
  userId: string | null,
  {
    type,
    onJobCompleted,
    onJobFailed,
    onJobRejected,
  }: {
    type?: string;
    onJobCompleted?: (job: QueueJob) => void;
    onJobFailed?: (job: QueueJob) => void;
    onJobRejected?: (job: QueueJob) => void;
  } = {}
) {
  const [jobs, setJobs] = useState<QueueJob[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connectionError, setConnectionError] = useState(false);
  const onJobCompletedRef = useRef(onJobCompleted);
  onJobCompletedRef.current = onJobCompleted;
  const onJobFailedRef = useRef(onJobFailed);
  onJobFailedRef.current = onJobFailed;
  const onJobRejectedRef = useRef(onJobRejected);
  onJobRejectedRef.current = onJobRejected;
  // Tracks last known status per job to detect transitions (not repeated updates)
  const jobStatusesRef = useRef<Map<string, QueueJob["status"]>>(new Map());
  // Unique per hook instance. realtime-js dedupes channels by topic, so two
  // useJobsQueue calls with the same userId (e.g. the home page runs one for
  // content-analysis and one for itinerary-planning) would otherwise share a
  // single channel — the second .on('postgres_changes') then lands on an
  // already-subscribed channel and throws. A per-instance suffix keeps them
  // independent. Colons from useId() are stripped to keep the topic clean.
  const instanceId = useId().replace(/[^a-zA-Z0-9]/g, "");

  useEffect(() => {
    if (!userId) {
      setIsLoading(false);
      return;
    }

    let mounted = true;
    const supabase = createClient();

    const oneDayAgo = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    // Fires the terminal-transition callbacks for a job we last saw in flight.
    // Shared by the realtime handler and the reconciliation pass so a job that
    // finishes while we're disconnected produces the same effects.
    const emitTransition = (job: QueueJob, prevStatus?: QueueJob["status"]) => {
      if (job.status === prevStatus) return;
      if (job.status === "failed") {
        onJobFailedRef.current?.(job);
      } else if (job.status === "completed") {
        if ((job.result as Record<string, unknown>)?.is_rejected) {
          onJobRejectedRef.current?.(job);
        } else {
          onJobCompletedRef.current?.(job);
        }
      }
    };

    // postgres_changes has no replay: a message that lands while the tab is
    // backgrounded, asleep or briefly offline is gone for good, leaving the
    // queue card stuck mid-progress forever. Re-read the rows we still believe
    // are running and settle them by hand.
    const reconcile = async () => {
      const tracked = [...jobStatusesRef.current.entries()]
        .filter(([, status]) => ["queued", "pending", "processing"].includes(status))
        .map(([id]) => id);
      if (tracked.length === 0) return;

      const { data } = await supabase.from("jobs").select("*").in("id", tracked);
      if (!mounted || !data) return;

      for (const row of data as QueueJob[]) {
        if (type && row.type !== type) continue;
        const prev = jobStatusesRef.current.get(row.id);
        if (row.status === prev) continue;
        jobStatusesRef.current.set(row.id, row.status);
        emitTransition(row, prev);
        setJobs((current) => {
          const stillVisible =
            (["queued", "pending", "processing"].includes(row.status) ||
              (row.status === "failed" &&
                Date.now() - new Date(row.updated_at).getTime() < 24 * 60 * 60 * 1000)) &&
            !row.detached;
          if (!stillVisible) return current.filter((j) => j.id !== row.id);
          return current
            .map((j) => (j.id === row.id ? { ...j, ...row } : j))
            .sort(compareQueueJobs);
        });
      }
    };

    // Initial fetch — include failed (under 1 day old) so users can see and retry them
    let query = supabase
      .from("jobs")
      .select("*")
      .eq("user_id", userId)
      .eq("detached", false);

    if (type) query = query.eq("type", type);

    query
      .or(
        `status.in.(queued,pending,processing),and(status.eq.failed,updated_at.gte.${oneDayAgo()})`
      )
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (mounted) {
          const fetched = ((data as QueueJob[]) ?? []).sort(compareQueueJobs);
          fetched.forEach((j) => jobStatusesRef.current.set(j.id, j.status));
          setJobs(fetched);
          setIsLoading(false);
        }
      });

    // A tab returning to the foreground is the common case for a missed update.
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void reconcile();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    // Realtime subscription
    const channel = supabase
      .channel(`jobs_queue_${userId}_${instanceId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "jobs",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (!mounted) return;
          setConnectionError(false);

          const { eventType, new: newRecord, old: oldRecord } = payload;

          if (eventType === "INSERT") {
            const job = newRecord as QueueJob;
            const isTypeMatch = !type || job.type === type;
            if (isTypeMatch) {
              jobStatusesRef.current.set(job.id, job.status);
            }
            const isRecentFailed =
              job.status === "failed" &&
              Date.now() - new Date(job.updated_at).getTime() < 24 * 60 * 60 * 1000;
            if (
              isTypeMatch &&
              (["queued", "pending", "processing"].includes(job.status) || isRecentFailed) &&
              !job.detached
            ) {
              setJobs((prev) => [...prev, job].sort(compareQueueJobs));
            }
          }

          if (eventType === "UPDATE") {
            const job = newRecord as QueueJob;
            const isTypeMatch = !type || job.type === type;
            const isRecentFailed =
              job.status === "failed" &&
              Date.now() - new Date(job.updated_at).getTime() < 24 * 60 * 60 * 1000;
            const isVisible =
              isTypeMatch &&
              (["queued", "pending", "processing"].includes(job.status) || isRecentFailed) &&
              !job.detached;

            const prevStatus = jobStatusesRef.current.get(job.id);
            if (isTypeMatch) {
              jobStatusesRef.current.set(job.id, job.status);
            }

            if (isTypeMatch) emitTransition(job, prevStatus);

            setJobs((prev) => {
              if (!isVisible) {
                return prev.filter((j) => j.id !== job.id);
              }
              const exists = prev.some((j) => j.id === job.id);
              if (exists) {
                // Re-sort so a job transitioning to failed jumps to the front
                return prev
                  .map((j) =>
                    j.id === job.id
                      ? {
                          ...j,
                          ...job,
                          payload: job.payload ?? j.payload,
                          progress: job.progress ?? j.progress,
                        }
                      : j
                  )
                  .sort(compareQueueJobs);
              }
              return [...prev, job].sort(compareQueueJobs);
            });
          }

          if (eventType === "DELETE") {
            const id = (oldRecord as { id: string }).id;
            setJobs((prev) => prev.filter((j) => j.id !== id));
          }
        }
      )
      .subscribe((status) => {
        if (!mounted) return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnectionError(true);
        } else if (status === "SUBSCRIBED") {
          setConnectionError(false);
          // Covers the reconnect case, where we were subscribed, dropped, and
          // came back without ever seeing the updates in between.
          void reconcile();
        }
      });

    return () => {
      mounted = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      supabase.removeChannel(channel);
    };
  }, [userId, instanceId, type]);

  const removeJob = (jobId: string) => {
    jobStatusesRef.current.delete(jobId);
    setJobs((prev) => prev.filter((j) => j.id !== jobId));
  };

  // Optimistically merge a job into the queue (e.g. the row returned by the
  // retry endpoint) so the card reflects the new status immediately instead of
  // waiting on the realtime UPDATE, which can lag or drop.
  const upsertJob = (job: QueueJob) => {
    jobStatusesRef.current.set(job.id, job.status);
    setJobs((prev) => {
      const exists = prev.some((j) => j.id === job.id);
      if (exists) {
        return prev
          .map((j) =>
            j.id === job.id
              ? { ...j, ...job, payload: job.payload ?? j.payload, progress: job.progress ?? j.progress }
              : j
          )
          .sort(compareQueueJobs);
      }
      return [...prev, job].sort(compareQueueJobs);
    });
  };

  return { jobs, isLoading, connectionError, removeJob, upsertJob };
}
