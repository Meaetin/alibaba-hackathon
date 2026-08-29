/**
 * `POST /api/jobs/[id]/retry` — run a link job again on the row it already has.
 *
 * The queue card on `/links` shows a "Try Again" button on a failed link, and
 * `retryJob` in `src/lib/api/client.ts` has always posted here. This is the
 * handler it was posting at.
 *
 * **The same row, not a new one.** Analysing the URL again through
 * `POST /api/jobs` would work, but it hands back a second id — so the failed
 * card has to be dropped and a fresh one added, and the traveller watches their
 * link jump out of the grid and back into it. Resetting this row means the card
 * they clicked is the card that starts moving, and `useJobsQueue` is already
 * polling the id.
 *
 * **Behind a session for the reason `POST /api/jobs` is**: a retry re-runs the
 * whole pipeline, which bills OpenAI twice and Google once per place found.
 * It is a spend gate, not ownership — `jobs` has no `user_id`, so the row
 * belongs to nobody and the content it produces lands with whoever pressed the
 * button.
 *
 * ## What it refuses, and why each one is not just tidiness
 *
 * - A **completed** job is a 409. The analysis succeeded and its `content` row
 *   is already in the library; running it again would bill for a second copy
 *   of an answer we have.
 * - A job that is **still running** is a 409. Two pipelines writing progress to
 *   one row would fight over the bar and could save the library entry twice.
 *   "Still running" means it wrote something within `LINK_STUCK_MS` — the same
 *   bound the card uses to decide whether to offer the button at all, imported
 *   rather than restated so the two cannot disagree.
 * - A job of another **type** is a 404. This handler knows how to run one
 *   pipeline; an itinerary job is not a link job with a different string on it.
 */

import { detectLink } from "@/lib/links/detect";
import { LINK_JOB_TYPE } from "@/lib/links/pipeline";
import { LINK_STUCK_MS, toLinkJobProgress } from "@/lib/links/progress";

import { linkRouteDeps, userFor, type LinkRouteDeps } from "../../../deps";
import { runLinkJob } from "../../run";

/** A long-running Node process. The background work below depends on it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All on the allowlist in `getFriendlyApiError`'s sibling rules — plain
 *  sentences, safe to render as they are. */
const SIGNED_OUT_MESSAGE = "Please sign in to analyze a link.";
const UNAVAILABLE_MESSAGE = "Link analysis is unavailable right now.";
const NOT_FOUND_MESSAGE = "Job not found";
const FINISHED_MESSAGE = "That link has already been analyzed.";
const RUNNING_MESSAGE = "That link is still being analyzed.";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  let deps: LinkRouteDeps;
  try {
    deps = linkRouteDeps.create();
  } catch (error) {
    console.error(`[POST /api/jobs/${id}/retry] link analysis is not configured`, error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 503 });
  }

  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  let job;
  try {
    job = await deps.store.getJob(id);
  } catch (error) {
    // A database that is down is a 500 the client may retry — not a 404, which
    // would tell it to give up on a job that is genuinely there.
    console.error(`[POST /api/jobs/${id}/retry] could not read the job row`, error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }

  if (!job || job.type !== LINK_JOB_TYPE) {
    return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  }

  if (job.status === "completed") {
    return Response.json({ error: FINISHED_MESSAGE }, { status: 409 });
  }

  const now = deps.now();
  const silentFor = now.getTime() - new Date(job.updated_at).getTime();
  if (job.status !== "failed" && silentFor < LINK_STUCK_MS) {
    return Response.json({ error: RUNNING_MESSAGE }, { status: 409 });
  }

  // The URL the row recorded, vetted again. It was vetted before the row was
  // written, so this only fires if `detect.ts` has since narrowed what it
  // accepts — in which case re-running would fail inside the pipeline anyway,
  // and saying so now is the better answer.
  const target = detectLink((job.payload as { url?: string } | null)?.url ?? "");
  if (!target.ok) return Response.json({ error: target.reason }, { status: 400 });

  // Back to the start of the bar, keeping the poster frame the failed run had
  // already found. `queued` rather than `processing` is what makes the card's
  // progress bar reset: `useProgressAnimation` refuses to walk backwards while
  // a job is processing, so a retry stamped `processing` would leave the bar
  // parked at the percentage the failure died on.
  //
  // `result` is deliberately left alone rather than nulled: only a finished run
  // writes one, and a finished run is refused four lines up. Nulling it would be
  // a line no test could ever turn red.
  const thumbnail = (job.progress as { thumbnail?: string } | null)?.thumbnail;
  const reset = await deps.store.updateJob(
    id,
    {
      status: "queued",
      progress: toLinkJobProgress("metadata", now, thumbnail),
      error: null,
    },
    now,
  );

  // Deliberately not awaited: the response goes out now and the local Node
  // process carries on behind it, exactly as `POST /api/jobs` does.
  void runLinkJob(id, target.url, deps, user.id, thumbnail);

  return Response.json(reset ?? job, { status: 202 });
}
