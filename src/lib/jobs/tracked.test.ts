// @vitest-environment jsdom
//
// jsdom for `Storage` and nothing else — and even that has to be stubbed, since
// Vitest's jsdom ships no `localStorage`. The global environment stays `node`.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TRACKED_JOB_MAX_AGE_MS,
  trackJob,
  trackedJobs,
  untrackJob,
} from "./tracked";

const NOW = Date.parse("2026-08-29T12:00:00.000Z");
const USER = "traveller-1";

/**
 * A real `Map` behind the four methods `tracked.ts` calls, plus a count of the
 * writes. The count is what "does not write" can be asserted on: storing the
 * same list back produces a byte-identical string, so comparing the *value*
 * before and after passes whether or not the write happened.
 */
function stubLocalStorage() {
  const entries = new Map<string, string>();
  const writes = { count: 0 };
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.count += 1;
      entries.set(key, value);
    },
    removeItem: (key: string) => {
      writes.count += 1;
      entries.delete(key);
    },
    clear: () => entries.clear(),
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    get length() {
      return entries.size;
    },
  } satisfies Storage);
  return { entries, writes };
}

let entries: Map<string, string>;
let writes: { count: number };

beforeEach(() => {
  ({ entries, writes } = stubLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("tracked jobs", () => {
  it("hands back what was tracked, newest first", () => {
    trackJob(USER, { id: "job-1", type: "itinerary-planning" }, NOW);
    trackJob(USER, { id: "job-2", type: "itinerary-planning" }, NOW + 1000);

    expect(trackedJobs(USER, undefined, NOW + 2000).map((entry) => entry.id)).toEqual([
      "job-2",
      "job-1",
    ]);
  });

  it("narrows to one job type", () => {
    trackJob(USER, { id: "job-plan", type: "itinerary-planning" }, NOW);
    trackJob(USER, { id: "job-link", type: "content-analysis" }, NOW);

    expect(trackedJobs(USER, "content-analysis", NOW).map((entry) => entry.id)).toEqual([
      "job-link",
    ]);
  });

  it("keeps one traveller's ids away from another's", () => {
    trackJob(USER, { id: "job-1", type: "itinerary-planning" }, NOW);

    expect(trackedJobs("somebody-else", undefined, NOW)).toEqual([]);
  });

  it("tracks an id once, and re-tracking does not extend its life", () => {
    trackJob(USER, { id: "job-1", type: "itinerary-planning" }, NOW);
    // A retry re-seeds the same row. If this reset the clock, a job whose
    // process died would be re-tracked by its own failing poll forever.
    trackJob(USER, { id: "job-1", type: "itinerary-planning" }, NOW + TRACKED_JOB_MAX_AGE_MS - 1);

    expect(trackedJobs(USER, undefined, NOW)).toHaveLength(1);
    expect(trackedJobs(USER, undefined, NOW + TRACKED_JOB_MAX_AGE_MS)).toEqual([]);
  });

  it("forgets an entry past its maximum age, and sweeps it out of storage", () => {
    trackJob(USER, { id: "job-old", type: "itinerary-planning" }, NOW);
    trackJob(
      USER,
      { id: "job-new", type: "itinerary-planning" },
      NOW + TRACKED_JOB_MAX_AGE_MS,
    );

    const read = trackedJobs(USER, undefined, NOW + TRACKED_JOB_MAX_AGE_MS + 1);
    expect(read.map((entry) => entry.id)).toEqual(["job-new"]);
    // Swept on read, not merely filtered: a job whose Node process died never
    // reaches a terminal status, so nothing else would ever remove it.
    expect(entries.get("argo:tracked-jobs:traveller-1")).not.toContain("job-old");
  });

  it("untracks an id", () => {
    trackJob(USER, { id: "job-1", type: "itinerary-planning" }, NOW);
    untrackJob(USER, "job-1", NOW);

    expect(trackedJobs(USER, undefined, NOW)).toEqual([]);
    // The whole key goes, rather than an empty array being left behind.
    expect(entries.has("argo:tracked-jobs:traveller-1")).toBe(false);
  });

  it("does not write when untracking an id it never had", () => {
    trackJob(USER, { id: "job-1", type: "itinerary-planning" }, NOW);
    writes.count = 0;

    untrackJob(USER, "job-2", NOW);

    // The 404 sweep in `useJobsQueue` calls this on every render of a job whose
    // row is gone; a write per render is the thing being avoided.
    expect(writes.count).toBe(0);
    expect(trackedJobs(USER, undefined, NOW).map((entry) => entry.id)).toEqual(["job-1"]);
  });

  it("reads a corrupted entry as nothing, rather than throwing into a render", () => {
    entries.set("argo:tracked-jobs:traveller-1", "not json");

    expect(trackedJobs(USER, undefined, NOW)).toEqual([]);
  });

  it("drops an entry that is not a tracked job", () => {
    entries.set(
      "argo:tracked-jobs:traveller-1",
      JSON.stringify([{ id: "job-1", type: "itinerary-planning", at: new Date(NOW).toISOString() }, 7, { id: 3 }]),
    );

    expect(trackedJobs(USER, undefined, NOW).map((entry) => entry.id)).toEqual(["job-1"]);
  });

  it("remembers nothing at all when there is no storage", () => {
    vi.stubGlobal("localStorage", undefined);

    expect(() => trackJob(USER, { id: "job-1", type: "itinerary-planning" }, NOW)).not.toThrow();
    expect(trackedJobs(USER, undefined, NOW)).toEqual([]);
  });
});
