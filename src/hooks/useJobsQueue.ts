"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { queryOptions, useQueries, useQueryClient } from "@tanstack/react-query";
import type { QueueJob } from "@/lib/jobs/types";

export type { QueueJob } from "@/lib/jobs/types";

const POLL_INTERVAL_MS = 2000;

function isTerminal(status: QueueJob["status"] | undefined): boolean {
  return status === "completed" || status === "failed";
}

/** Carries the HTTP status so a 404 can stop polling while a 500 keeps trying. */
class JobFetchError extends Error {
  status: number;

  constructor(status: number) {
    super(`Job request failed with status ${status}`);
    this.name = "JobFetchError";
    this.status = status;
  }
}

async function fetchJob(jobId: string): Promise<QueueJob> {
  const res = await fetch(`/api/jobs/${jobId}`);
  if (!res.ok) throw new JobFetchError(res.status);
  return (await res.json()) as QueueJob;
}

function jobQueryKey(jobId: string) {
  return ["job", jobId] as const;
}

function jobQueryOptions(jobId: string) {
  return queryOptions({
    queryKey: jobQueryKey(jobId),
    queryFn: () => fetchJob(jobId),
    // The shared client sets a five-minute staleTime; a job row is stale the
    // instant it is read.
    staleTime: 0,
    // A retry ladder would fire extra requests between poll ticks and blur the
    // one thing this hook has to get right — how often it hits the server.
    retry: false,
    // `upsertJob` has already written the caller's row into the cache, so the
    // mount fetch would only duplicate the first interval tick — and for a job
    // seeded in a terminal state it would be a request we never wanted at all.
    refetchOnMount: false,
    refetchInterval: (query) => {
      if (isTerminal(query.state.data?.status)) return false;
      // A job id that does not exist will never start existing. Anything else
      // (a 500, a dropped connection) is worth another try.
      const error = query.state.error;
      if (error instanceof JobFetchError && error.status === 404) return false;
      return POLL_INTERVAL_MS;
    },
  });
}

// Failed jobs pin to the front so errors are always visible; within each
// group newest first, so a freshly added job lands right after the errors.
function compareQueueJobs(a: QueueJob, b: QueueJob): number {
  const aFailed = a.status === "failed" ? 0 : 1;
  const bFailed = b.status === "failed" ? 0 : 1;
  if (aFailed !== bFailed) return aFailed - bFailed;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

/**
 * Tracks in-flight background jobs by polling `GET /api/jobs/:id` once every
 * two seconds per job, stopping the moment a job reaches `completed` or
 * `failed`.
 *
 * **The queue does not survive a page reload.** The set of job ids being watched
 * lives in React state, seeded only by `upsertJob`. The realtime version could
 * rebuild the list from Supabase by querying `jobs` for the signed-in user, but
 * auth was removed from this app, so there is no user to query by and no
 * server-side list endpoint to replace it. Reload the page mid-plan and the
 * queue card disappears; the job itself keeps running and the itinerary still
 * lands in the list when it finishes.
 *
 * `isLoading` is therefore effectively always `false`. `upsertJob` hands the
 * hook a complete row, so there is no initial list to fetch and nothing to wait
 * on. It stays in the return value because the five pages destructure it.
 */
export function useJobsQueue({
  type,
  onJobCompleted,
  onJobFailed,
  onJobRejected,
}: {
  type?: string;
  onJobCompleted?: (job: QueueJob) => void;
  onJobFailed?: (job: QueueJob) => void;
  onJobRejected?: (job: QueueJob) => void;
} = {}) {
  // The subscription list. It changes only through upsertJob/removeJob, never
  // from a poll result, so the set of running queries stays stable while polling.
  // The rows themselves live in the query cache, not here.
  const [trackedIds, setTrackedIds] = useState<string[]>([]);

  const onJobCompletedRef = useRef(onJobCompleted);
  onJobCompletedRef.current = onJobCompleted;
  const onJobFailedRef = useRef(onJobFailed);
  onJobFailedRef.current = onJobFailed;
  const onJobRejectedRef = useRef(onJobRejected);
  onJobRejectedRef.current = onJobRejected;

  // Last status seen per job, so the terminal callbacks fire on the transition
  // and not on every poll that repeats the same answer.
  const lastStatusRef = useRef<Map<string, QueueJob["status"]>>(new Map());
  const completedForCleanupRef = useRef<string[]>([]);

  const queryClient = useQueryClient();

  const results = useQueries({
    queries: trackedIds.map((jobId) => jobQueryOptions(jobId)),
  });

  // `upsertJob` writes the caller's row into the cache before the query mounts,
  // so `result.data` is populated from the first render — there is no pending
  // window to fall back over.
  const jobs = useMemo(() => {
    const list: QueueJob[] = [];
    for (const result of results) {
      const job = result.data;
      if (!job) continue;
      if (type && job.type !== type) continue;
      list.push(job);
    }
    return list.sort(compareQueueJobs);
  }, [results, type]);

  const connectionError = results.some((result) => result.isError);
  const isLoading = results.some((result) => result.isPending);

  useEffect(() => {
    const completed: string[] = [];
    for (const job of jobs) {
      const previous = lastStatusRef.current.get(job.id);
      if (previous === job.status) continue;
      lastStatusRef.current.set(job.id, job.status);
      if (job.status === "failed") {
        onJobFailedRef.current?.(job);
      } else if (job.status === "completed") {
        if ((job.result as Record<string, unknown> | null)?.is_rejected) {
          onJobRejectedRef.current?.(job);
        } else {
          onJobCompletedRef.current?.(job);
        }
        completed.push(job.id);
      }
    }
    if (completed.length > 0) {
      completedForCleanupRef.current.push(...completed);
      setTrackedIds((previous) => previous.filter((id) => !completed.includes(id)));
    }
  }, [jobs]);

  // TanStack Query warns that removing an actively observed query causes a
  // hard loading state. `trackedIds` changes first; this effect runs after the
  // next render, when `useQueries` no longer observes the completed rows.
  useEffect(() => {
    if (completedForCleanupRef.current.length === 0) return;
    const completed = completedForCleanupRef.current.splice(0);
    for (const jobId of completed) {
      lastStatusRef.current.delete(jobId);
      queryClient.removeQueries({ queryKey: jobQueryKey(jobId), exact: true });
    }
  }, [queryClient, trackedIds]);

  useEffect(() => {
    if (!connectionError) return;
    console.error("useJobsQueue: a tracked job could not be fetched");
  }, [connectionError]);

  /** Stops polling this id and drops its card. */
  const removeJob = useCallback((jobId: string) => {
    lastStatusRef.current.delete(jobId);
    setTrackedIds((previous) => previous.filter((id) => id !== jobId));
  }, []);

  /**
   * Starts tracking a job, or replaces the row we hold for one already tracked.
   * This is the only way an id enters the queue. Seeding records the job's
   * current status without firing a callback, so handing back a row that is
   * already `completed` does not re-announce it.
   */
  const upsertJob = useCallback(
    (job: QueueJob) => {
      lastStatusRef.current.set(job.id, job.status);
      if (job.status === "completed") {
        completedForCleanupRef.current.push(job.id);
        setTrackedIds((previous) => previous.filter((id) => id !== job.id));
        return;
      }
      // Write straight into the cache so a re-seed (the retry endpoint handing
      // back a reset row) shows immediately instead of waiting for the next poll.
      queryClient.setQueryData(jobQueryKey(job.id), (previous: QueueJob | undefined) =>
        previous ? { ...previous, ...job } : job,
      );
      setTrackedIds((previous) =>
        previous.includes(job.id) ? previous : [...previous, job.id],
      );
    },
    [queryClient],
  );

  return { jobs, isLoading, connectionError, removeJob, upsertJob };
}
