/**
 * `GET /api/jobs/[id]` — the poll target for the loading screen.
 *
 * It returns the `jobs` row as Drizzle read it: snake_case, no rename layer, no
 * envelope. `useJobsQueue` types its `QueueJob` off exactly that shape, so
 * anything this handler reshaped would be a second source of truth for the same
 * five progress fields.
 *
 * An unknown id is a **404**, not a 500 and not an empty 200. The client stops
 * polling on a 404 and keeps trying on anything else, so getting this wrong
 * either hides a real outage or leaves a dead id being polled every two seconds
 * until the tab closes.
 *
 * Next 15 hands dynamic segments in as a promise — `params` is awaited below.
 * Its dependencies come from `../../deps` for the same reason: a route file may
 * export only its handler and Next's own config fields.
 */

import { jobsRouteDeps } from "../../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** On the allowlist in `getFriendlyApiError`, so it is safe to render as-is. */
const NOT_FOUND_MESSAGE = "Job not found";
const UNAVAILABLE_MESSAGE = "We couldn't check on that job. Please try again.";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  let job;
  try {
    job = await jobsRouteDeps.create().store.getJob(id);
  } catch (error) {
    // A database that is down is a 500 the client should retry — not a 404,
    // which would tell it to give up on a job that may well be running.
    console.error(`[GET /api/jobs/${id}] could not read the job row`, error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }

  if (!job) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  return Response.json(job);
}
