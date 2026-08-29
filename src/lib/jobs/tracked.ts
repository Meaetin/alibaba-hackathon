import type { QueueJob } from "./types";

/**
 * The job ids this browser is watching, kept in `localStorage` so a queue card
 * survives a navigation and a reload.
 *
 * `useJobsQueue` holds its subscription list in React state and `upsertJob` is
 * the only way an id enters it, so a plan queued on `/collections/[id]` was
 * invisible on `/home`: that page mounts with an empty list and never learns
 * the job exists. This is the pointer that carries across.
 *
 * **Ids and types only, never rows.** A stored copy of a job would out-live the
 * run it describes and start disagreeing with it — the same reason
 * `src/lib/persona/storage.ts` keeps a pointer and not a `PersonaResult`. The
 * row is always refetched from `GET /api/jobs/:id`.
 *
 * **Keyed by traveller.** One browser can sign into two accounts, and a card
 * for a trip the previous one planned is somebody else's trip.
 *
 * **Entries expire after an hour.** A job whose Node process died mid-plan
 * never reaches a terminal status, so nothing else would ever remove it and
 * every page load from then on would start polling it again, every two seconds,
 * forever. An hour is far longer than either pipeline takes — a plan is minutes,
 * a link is seconds — and a traveller who comes back later than that wants the
 * finished trip in the grid, not a progress bar for a run that ended.
 */

/** One watched job. `type` is stored so a queue restores only its own kind. */
export interface TrackedJob {
  id: string;
  type: string;
  /** When tracking started, ISO. Read only by the expiry sweep. */
  at: string;
}

export const TRACKED_JOB_MAX_AGE_MS = 60 * 60 * 1000;

const KEY_PREFIX = "argo:tracked-jobs:";

function keyFor(userId: string): string {
  return `${KEY_PREFIX}${userId}`;
}

/**
 * `localStorage`, or `null` where there isn't one.
 *
 * Read off `globalThis` rather than `window` because there are three places
 * without one: the server render, Safari's private mode (where `setItem`
 * throws), and this repo's own test environment — Vitest's jsdom provides no
 * storage at all, so a test has to stub one. A browser that cannot remember its
 * queue is a browser back to the old per-page behaviour, which is worse and not
 * broken.
 */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(userId: string): TrackedJob[] {
  const store = storage();
  if (!store) return [];
  try {
    const raw = store.getItem(keyFor(userId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is TrackedJob =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as TrackedJob).id === "string" &&
        typeof (entry as TrackedJob).type === "string" &&
        typeof (entry as TrackedJob).at === "string",
    );
  } catch {
    return [];
  }
}

function write(userId: string, entries: TrackedJob[]): void {
  const store = storage();
  if (!store) return;
  try {
    if (entries.length === 0) store.removeItem(keyFor(userId));
    else store.setItem(keyFor(userId), JSON.stringify(entries));
  } catch {
    // Storage is full or blocked. Nothing here is worth failing a render over.
  }
}

function isFresh(entry: TrackedJob, now: number): boolean {
  const at = new Date(entry.at).getTime();
  // An unparseable timestamp is a row we can no longer age, so it is expired.
  return Number.isFinite(at) && now - at < TRACKED_JOB_MAX_AGE_MS;
}

/**
 * What this browser was watching for `userId`, newest first, optionally
 * narrowed to one job type. Expired entries are swept on the way out, so the
 * list never grows without something reading it.
 */
export function trackedJobs(
  userId: string,
  type?: string,
  now: number = Date.now(),
): TrackedJob[] {
  const stored = read(userId);
  const fresh = stored.filter((entry) => isFresh(entry, now));
  if (fresh.length !== stored.length) write(userId, fresh);
  return type ? fresh.filter((entry) => entry.type === type) : fresh;
}

/** Starts remembering a job. Re-tracking one already stored leaves its original
 *  `at` alone — a retry must not buy the entry another hour of life. */
export function trackJob(
  userId: string,
  job: Pick<QueueJob, "id" | "type">,
  now: number = Date.now(),
): void {
  const entries = trackedJobs(userId, undefined, now);
  if (entries.some((entry) => entry.id === job.id)) return;
  write(userId, [{ id: job.id, type: job.type, at: new Date(now).toISOString() }, ...entries]);
}

/** Forgets a job. A no-op when the id is not stored, so the callers that untrack
 *  on every poll of a 404 write once rather than once per render. */
export function untrackJob(userId: string, jobId: string, now: number = Date.now()): void {
  const entries = trackedJobs(userId, undefined, now);
  const next = entries.filter((entry) => entry.id !== jobId);
  if (next.length === entries.length) return;
  write(userId, next);
}
