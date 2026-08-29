// @vitest-environment jsdom
//
// jsdom is set per file on purpose. The global vitest environment is `node` and
// the whole planner suite depends on that staying true.

import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, notifyManager } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { trackJob, trackedJobs } from "@/lib/jobs/tracked";
import { useJobsQueue, type QueueJob } from "./useJobsQueue";

const POLL_INTERVAL_MS = 2000;

function makeJob(overrides: Partial<QueueJob> = {}): QueueJob {
  return {
    id: "job-1",
    type: "itinerary-planning",
    status: "processing",
    itinerary_id: null,
    payload: { city: "Singapore" },
    result: null,
    error: null,
    progress: {
      percent: 40,
      label: "Choosing places",
      stage: "funnel",
      done: 4,
      total: 10,
      step: 4,
      fired_at: "2026-08-24T10:00:00.000Z",
      eta_seconds: 30,
      next_percent: 60,
      stage_ms: 12000,
    },
    created_at: "2026-08-24T09:59:00.000Z",
    updated_at: "2026-08-24T10:00:00.000Z",
    ...overrides,
  };
}

/** Every test drives the hook through the real fetch path, so this is the spy. */
let fetchMock: ReturnType<typeof vi.fn>;

/** Queue of responses the fetch mock hands back, one per call; the last repeats. */
function respondWith(...responses: Array<{ ok: boolean; status?: number; body?: unknown }>) {
  let index = 0;
  fetchMock.mockImplementation(async () => {
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return {
      ok: response.ok,
      status: response.status ?? (response.ok ? 200 : 500),
      json: async () => response.body,
    } as Response;
  });
}

function renderQueue(options: Parameters<typeof useJobsQueue>[0] = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, children);
  return renderHook(() => useJobsQueue(options), { wrapper });
}

/** Lets the interval fire and the poll's promise chain settle. */
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Vitest's jsdom ships no `localStorage`, so the queue's memory has to be
 * supplied here — a real `Map` behind the four methods `tracked.ts` calls,
 * not a spy, because these tests assert on what was stored and not on which
 * method was reached.
 */
function stubLocalStorage() {
  const entries = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
    removeItem: (key: string) => void entries.delete(key),
    clear: () => entries.clear(),
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    get length() {
      return entries.size;
    },
  } satisfies Storage);
}

beforeEach(() => {
  stubLocalStorage();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // React Query notifies its observers through `setTimeout(cb, 0)`. Under fake
  // timers that callback never runs on its own, so every assertion would read
  // the state from one poll ago. Notify synchronously instead.
  notifyManager.setScheduler((callback) => callback());
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useJobsQueue", () => {
  it("polls GET /api/jobs/:id once per interval", async () => {
    respondWith({ ok: true, body: makeJob() });
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "queued" }));
    });
    expect(fetchMock).toHaveBeenCalledTimes(0);

    await advance(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/jobs/job-1");

    await advance(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await advance(POLL_INTERVAL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it("does not poll faster than the interval", async () => {
    respondWith({ ok: true, body: makeJob() });
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "queued" }));
    });

    await advance(POLL_INTERVAL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });

  it("stops polling once the job completes", async () => {
    respondWith({ ok: true, body: makeJob({ status: "completed" }) });
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "processing" }));
    });

    await advance(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.jobs).toHaveLength(0);

    // Ten more intervals. A queue that keeps polling a finished job is a bill,
    // not a bug report.
    await advance(POLL_INTERVAL_MS * 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling once the job fails", async () => {
    respondWith({ ok: true, body: makeJob({ status: "failed", error: "We couldn’t plan that trip." }) });
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "processing" }));
    });

    await advance(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(POLL_INTERVAL_MS * 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.jobs[0].error).toBe("We couldn’t plan that trip.");
  });

  it("surfaces the fields the loading screen's progress hooks read", async () => {
    respondWith({ ok: true, body: makeJob() });
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "queued" }));
    });
    await advance(POLL_INTERVAL_MS);

    const job = result.current.jobs[0];

    // useProgressAnimation reads these.
    expect(job.status).toBe("processing");
    expect(job.progress?.percent).toBe(40);
    expect(typeof job.updated_at).toBe("string");
    expect(job.progress?.next_percent).toBe(60);
    expect(job.progress?.stage_ms).toBe(12000);

    // useProgressEta reads these.
    expect(job.progress?.eta_seconds).toBe(30);
    expect(job.progress?.fired_at).toBe("2026-08-24T10:00:00.000Z");

    // The queue card reads these.
    expect(job.progress?.label).toBe("Choosing places");
    expect(job.progress?.stage).toBe("funnel");
  });

  it("fires onJobCompleted once, on the transition", async () => {
    const onJobCompleted = vi.fn();
    respondWith(
      { ok: true, body: makeJob({ status: "processing" }) },
      { ok: true, body: makeJob({ status: "completed", result: { itinerary_id: "itin-1" } }) },
    );
    const { result } = renderQueue({ onJobCompleted });

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "queued" }));
    });

    await advance(POLL_INTERVAL_MS);
    expect(onJobCompleted).toHaveBeenCalledTimes(0);

    await advance(POLL_INTERVAL_MS);
    expect(onJobCompleted).toHaveBeenCalledTimes(1);
    expect(onJobCompleted.mock.calls[0][0].result).toEqual({ itinerary_id: "itin-1" });

    // Polling has stopped, but re-renders have not — the callback must not fire
    // again just because the same completed row is still in the list.
    await advance(POLL_INTERVAL_MS * 5);
    expect(onJobCompleted).toHaveBeenCalledTimes(1);
  });

  it("fires onJobCompleted once even when the same status is polled repeatedly", async () => {
    const onJobCompleted = vi.fn();
    // Never terminal, so polling continues and the same row comes back forever.
    respondWith({ ok: true, body: makeJob({ status: "processing" }) });
    const { result } = renderQueue({ onJobCompleted });

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "queued" }));
    });

    await advance(POLL_INTERVAL_MS * 4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(onJobCompleted).toHaveBeenCalledTimes(0);
  });

  it("does not re-announce a finished job when a sibling job keeps polling", async () => {
    const onJobCompleted = vi.fn();
    let percent = 10;
    fetchMock.mockImplementation(async (url: string) => {
      const id = url.split("/").pop() as string;
      // job-2's progress moves on every poll. A frozen payload would be
      // structurally shared and stop re-rendering, which is precisely the
      // pressure this test needs to apply.
      percent += 5;
      return {
        ok: true,
        status: 200,
        json: async () =>
          id === "job-1"
            ? makeJob({ id, status: "completed", result: { itinerary_id: "itin-1" } })
            : makeJob({
                id,
                status: "processing",
                progress: { ...makeJob().progress!, percent },
                updated_at: `2026-08-24T10:00:${String(percent).padStart(2, "0")}.000Z`,
              }),
      } as Response;
    });
    const { result } = renderQueue({ onJobCompleted });

    await act(async () => {
      result.current.upsertJob(makeJob({ id: "job-1", status: "processing" }));
      result.current.upsertJob(makeJob({ id: "job-2", status: "processing" }));
    });

    // job-1 finishes on its first poll and stops. job-2 keeps polling, so the
    // hook keeps re-rendering with job-1 still sitting in the list — the exact
    // shape that made the old realtime version toast twice.
    await advance(POLL_INTERVAL_MS * 6);
    expect(onJobCompleted).toHaveBeenCalledTimes(1);
  });

  it("does not announce a job seeded in a terminal state", async () => {
    const onJobCompleted = vi.fn();
    respondWith({ ok: true, body: makeJob({ status: "processing" }) });
    const { result } = renderQueue({ onJobCompleted });

    await act(async () => {
      result.current.upsertJob(makeJob({ id: "job-1", status: "completed" }));
      result.current.upsertJob(makeJob({ id: "job-2", status: "processing" }));
    });

    await advance(POLL_INTERVAL_MS * 3);
    expect(onJobCompleted).toHaveBeenCalledTimes(0);
  });

  it("fires onJobFailed once, on the transition", async () => {
    const onJobFailed = vi.fn();
    respondWith(
      { ok: true, body: makeJob({ status: "processing" }) },
      { ok: true, body: makeJob({ status: "failed", error: "No places found." }) },
    );
    const { result } = renderQueue({ onJobFailed });

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "queued" }));
    });

    await advance(POLL_INTERVAL_MS);
    expect(onJobFailed).toHaveBeenCalledTimes(0);

    await advance(POLL_INTERVAL_MS * 6);
    expect(onJobFailed).toHaveBeenCalledTimes(1);
  });

  it("routes a rejected completion to onJobRejected instead of onJobCompleted", async () => {
    const onJobCompleted = vi.fn();
    const onJobRejected = vi.fn();
    respondWith({ ok: true, body: makeJob({ status: "completed", result: { is_rejected: true } }) });
    const { result } = renderQueue({ onJobCompleted, onJobRejected });

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "processing" }));
    });
    await advance(POLL_INTERVAL_MS);

    expect(onJobRejected).toHaveBeenCalledTimes(1);
    expect(onJobCompleted).toHaveBeenCalledTimes(0);
    expect(result.current.jobs).toHaveLength(0);
  });

  it("gives up on a 404 rather than retrying forever", async () => {
    respondWith({ ok: false, status: 404, body: { error: "Job not found" } });
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "processing" }));
    });

    await advance(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await advance(POLL_INTERVAL_MS * 20);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.current.connectionError).toBe(true);
  });

  it("keeps polling through a server error, which is not a permanent answer", async () => {
    respondWith({ ok: false, status: 500, body: { error: "boom" } });
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "processing" }));
    });

    await advance(POLL_INTERVAL_MS * 3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("removeJob stops that id's polling and drops it from the list", async () => {
    respondWith({ ok: true, body: makeJob({ status: "processing" }) });
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "processing" }));
    });

    await advance(POLL_INTERVAL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.jobs).toHaveLength(1);

    await act(async () => {
      result.current.removeJob("job-1");
    });
    expect(result.current.jobs).toHaveLength(0);

    await advance(POLL_INTERVAL_MS * 10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("polls each tracked id independently", async () => {
    fetchMock.mockImplementation(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => makeJob({ id: url.split("/").pop() as string }),
    }));
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ id: "job-1" }));
      result.current.upsertJob(makeJob({ id: "job-2" }));
    });

    await advance(POLL_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.current.jobs.map((job) => job.id).sort()).toEqual(["job-1", "job-2"]);
  });

  it("hides jobs whose type does not match the requested one", async () => {
    respondWith({ ok: true, body: makeJob({ type: "content-analysis" }) });
    const { result } = renderQueue({ type: "itinerary-planning" });

    await act(async () => {
      result.current.upsertJob(makeJob({ type: "content-analysis" }));
    });
    await advance(POLL_INTERVAL_MS);

    expect(result.current.jobs).toHaveLength(0);
  });

  it("starts empty without a traveller, because there is nothing to restore from", () => {
    const { result } = renderQueue();
    expect(result.current.jobs).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.connectionError).toBe(false);
  });

  it("upsertJob replaces the row for an id it already tracks", async () => {
    respondWith({ ok: true, body: makeJob({ status: "processing" }) });
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "failed", error: "First attempt failed." }));
    });
    expect(result.current.jobs[0].status).toBe("failed");

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "queued", error: null }));
    });
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0].status).toBe("queued");
    expect(result.current.jobs[0].error).toBeNull();
  });
});

/**
 * The half that makes a queue card survive a navigation. Everything here turns
 * on `restoreFor`: without it the hook is per-mount, which is what every page
 * did while a plan queued on `/collections/[id]` was invisible on `/home`.
 */
describe("useJobsQueue restoring across pages", () => {
  const USER = "traveller-1";

  it("restores the ids this browser was watching, and only its own type", async () => {
    trackJob(USER, { id: "job-plan", type: "itinerary-planning" });
    trackJob(USER, { id: "job-link", type: "content-analysis" });
    respondWith({ ok: true, body: makeJob({ id: "job-plan" }) });

    const { result } = renderQueue({ type: "itinerary-planning", restoreFor: USER });
    await advance(0);

    expect(result.current.jobs.map((j) => j.id)).toEqual(["job-plan"]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual(["/api/jobs/job-plan"]);
  });

  it("restores nothing for a different traveller", async () => {
    trackJob("somebody-else", { id: "job-plan", type: "itinerary-planning" });
    respondWith({ ok: true, body: makeJob({ id: "job-plan" }) });

    const { result } = renderQueue({ type: "itinerary-planning", restoreFor: USER });
    await advance(0);

    expect(result.current.jobs).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("remembers a job seeded through upsertJob", async () => {
    respondWith({ ok: true, body: makeJob() });
    const { result } = renderQueue({ restoreFor: USER });

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "queued" }));
    });

    expect(trackedJobs(USER).map((entry) => entry.id)).toEqual(["job-1"]);
  });

  it("remembers nothing when no traveller is given", async () => {
    respondWith({ ok: true, body: makeJob() });
    const { result } = renderQueue();

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "queued" }));
    });

    expect(trackedJobs(USER)).toEqual([]);
  });

  it("forgets a job that reaches a terminal status", async () => {
    respondWith({ ok: true, body: makeJob({ status: "completed" }) });
    const { result } = renderQueue({ restoreFor: USER });

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "processing" }));
    });
    expect(trackedJobs(USER)).toHaveLength(1);

    await advance(POLL_INTERVAL_MS);
    expect(trackedJobs(USER)).toEqual([]);
  });

  it("forgets a failed job too, so a read failure is not re-announced on every page", async () => {
    respondWith({ ok: true, body: makeJob({ status: "failed", error: "Planning failed." }) });
    const { result } = renderQueue({ restoreFor: USER });

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "processing" }));
    });
    await advance(POLL_INTERVAL_MS);

    // The card stays on the page that watched it fail — it carries the retry.
    expect(result.current.jobs[0].status).toBe("failed");
    expect(trackedJobs(USER)).toEqual([]);
  });

  it("forgets a dismissed job, so the next page does not restore it", async () => {
    respondWith({ ok: true, body: makeJob() });
    const { result } = renderQueue({ restoreFor: USER });

    await act(async () => {
      result.current.upsertJob(makeJob({ status: "processing" }));
    });
    await act(async () => {
      result.current.removeJob("job-1");
    });

    expect(result.current.jobs).toEqual([]);
    expect(trackedJobs(USER)).toEqual([]);
  });

  it("forgets an id the server answers 404 for", async () => {
    trackJob(USER, { id: "job-gone", type: "itinerary-planning" });
    respondWith({ ok: false, status: 404 });

    renderQueue({ type: "itinerary-planning", restoreFor: USER });
    await advance(0);

    expect(trackedJobs(USER)).toEqual([]);
  });

  it("keeps an id the server merely failed to answer", async () => {
    trackJob(USER, { id: "job-1", type: "itinerary-planning" });
    respondWith({ ok: false, status: 500 });

    renderQueue({ type: "itinerary-planning", restoreFor: USER });
    await advance(0);

    expect(trackedJobs(USER).map((entry) => entry.id)).toEqual(["job-1"]);
  });
});
