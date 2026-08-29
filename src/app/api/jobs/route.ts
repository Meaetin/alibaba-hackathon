/**
 * `POST /api/jobs` — a video URL in, a job row out.
 *
 * It lives at `/api/jobs` rather than at a `/api/links/*` path of its own
 * because that is where `createJob` in `src/lib/api/client.ts` already posts,
 * and `GET /api/jobs/[id]` — the poller both pages already use — is its
 * sibling. A prettier URL would have needed an adapter translating
 * `{ type, payload }` into it, which is a layer whose only job is to undo a
 * rename.
 *
 * The same execution model as `POST /api/plan`, and for the same reason: the
 * work takes fifteen to twenty-five seconds, which is too long to hold a
 * request open and far too long for a bar that cannot move. So the handler
 * creates a `jobs` row, **returns it before any of the work happens**, and runs
 * the pipeline behind the response in the long-lived local Node process. The
 * client seeds its queue from the returned row and polls `GET /api/jobs/:id`,
 * which already exists and needed no change.
 *
 * **No migration.** `jobs.type` is free text and `jobs.itinerary_id` is
 * nullable, so a link job is an ordinary row in the table the planner already
 * uses.
 *
 * ## Why this is behind a session
 *
 * Not for ownership — `jobs` has no `user_id` and a link job belongs to nobody.
 * It is a spend gate. This endpoint bills OpenAI twice and Google once per
 * place found, and an open one on a dev server anybody can reach is a way to
 * lose money quietly. `/api/plan` guards for a different reason and lands in
 * the same place.
 *
 * ## What is a 400 and what is a failed job
 *
 * A link we will not touch — the wrong platform, a bare http URL, not a URL at
 * all — is a **400 with no row created**. It is a mistake the caller can fix
 * from the message, and leaving a failed job behind for it means a card in the
 * queue that only ever says "couldn't analyze this link". Everything the
 * pipeline discovers *later* — a private video, a ten-minute one, a dead
 * download — is a failed job, because by then there is a row and somebody is
 * watching it.
 */

import { z } from "zod";

import { getFriendlyApiError } from "@/lib/errors/userMessages";
import { detectLink } from "@/lib/links/detect";
import { isLinkUserError } from "@/lib/links/errors";
import { LINK_JOB_TYPE, type LinkStage } from "@/lib/links/pipeline";
import { toLinkJobProgress } from "@/lib/links/progress";
import { normalizeContentUrl, type ContentToSave } from "@/lib/db/content";
import { toLinkJobResult } from "@/lib/links/job-result";
import type { LinkAnalysisResult } from "@/lib/links/types";

import { linkRouteDeps, userFor, type LinkRouteDeps } from "../deps";

/** A long-running Node process. The background work below depends on it. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The shape `createJob(type, payload)` sends.
 *
 * `type` is validated rather than ignored: this endpoint creates exactly one
 * kind of job, and silently analyzing a link for a caller that asked for
 * something else is worse than telling them it does not exist yet.
 */
const BodySchema = z.object({
  type: z.literal(LINK_JOB_TYPE),
  payload: z.object({ url: z.string().trim().min(1) }),
});

/** All three are on the allowlist in `getFriendlyApiError`'s sibling rules —
 *  plain sentences, safe to render as they are. */
const SIGNED_OUT_MESSAGE = "Please sign in to analyze a link.";
const UNAVAILABLE_MESSAGE = "Link analysis is unavailable right now.";
const FAILED_MESSAGE = "We couldn't analyze that link.";
const BAD_BODY_MESSAGE = 'Send { type: "content-analysis", payload: { url } }.';

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: BAD_BODY_MESSAGE }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: BAD_BODY_MESSAGE }, { status: 400 });

  // Vetted before anything is created. `analyzeLink` checks this again on its
  // own — it is a library and cannot assume its caller did — but doing it here
  // is what turns "wrong platform" into an answer instead of a dead queue card.
  const target = detectLink(parsed.data.payload.url);
  if (!target.ok) return Response.json({ error: target.reason }, { status: 400 });

  let deps: LinkRouteDeps;
  try {
    deps = linkRouteDeps.create();
  } catch (error) {
    console.error("[POST /api/links/analyze] link analysis is not configured", error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 503 });
  }

  // After `create`, because the gate needs the store; before the job row,
  // because an anonymous request must not leave one behind.
  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  // The links page renders a 409 as "you already saved this", with a card to
  // open — a better answer than analyzing the same video twice and billing for
  // it. The normalization is what makes it work: your TikTok arrived carrying
  // the search that found it and the millisecond it was tapped.
  const existing = await deps.content.findByUrl(normalizeContentUrl(target.url), user.id);
  if (existing) {
    return Response.json(
      {
        error: "already_analyzed",
        content: {
          id: existing.id,
          content_title: existing.content_title,
          content_thumbnail: existing.content_thumbnail,
          content_url: existing.content_url,
        },
      },
      { status: 409 },
    );
  }

  const job = await deps.store.createJob({
    type: LINK_JOB_TYPE,
    // The URL as vetted, not as typed — a row should record the thing that
    // actually ran.
    payload: { url: target.url },
    now: deps.now(),
  });

  // Deliberately not awaited: the response goes out now and the local Node
  // process carries on behind it.
  void runLinkJob(job.id, target.url, deps, user.id);

  return Response.json(job, { status: 202 });
}

/**
 * Writes the `content` row, or returns null having said why.
 *
 * **A failed save does not fail the job.** The analysis is done and paid for;
 * the result is already on the job row and the traveller can see their places.
 * What is lost is the library entry, which is worth a loud log and not worth
 * throwing away a run over.
 *
 * Only resolved places are saved. A mention Google could not match has no
 * `place_id` and therefore no `locations` row to point at — it stays on
 * `jobs.result` where the diagnostics live.
 */
async function saveContent(
  result: LinkAnalysisResult,
  deps: LinkRouteDeps,
  ownerId: string,
  jobId: string,
): Promise<string | null> {
  const resolved = result.resolved.flatMap((entry) =>
    entry.place ? [{ placeId: entry.place.placeId, mention: entry.mention }] : [],
  );

  const input: ContentToSave = {
    content_url: result.metadata.url,
    // The model's title where there is one: it is written to be read, while
    // the platform's is usually hashtags.
    content_title: result.analysis?.generatedTitle || result.metadata.title || null,
    content_thumbnail: result.metadata.thumbnail || null,
    content_author: result.metadata.uploader || null,
    platform: result.metadata.platform,
    generated_summary: result.analysis?.summary ?? null,
    primary_country: result.analysis?.primaryCountry ?? null,
    primary_region: result.analysis?.primaryRegion ?? null,
    placeIds: resolved.map((entry) => entry.placeId),
    mentions: Object.fromEntries(resolved.map((entry) => [entry.placeId, entry.mention])),
  };

  try {
    const { contentId } = await deps.content.saveContent(input, ownerId, deps.now());
    return contentId;
  } catch (error) {
    console.error(`[link ${jobId}] the content row could not be saved`, error);
    return null;
  }
}

/**
 * Runs the pipeline and writes what happened onto the row.
 *
 * A thrown pipeline is a failed job with a plain sentence; the provider's own
 * words go to the log and never to the traveller. A pipeline that *degraded* —
 * no transcript, failed OCR batches, a Places search that 400'd — completes,
 * because it still produced places, and the losses are on `stats.failures`
 * where somebody can read them.
 */
async function runLinkJob(
  jobId: string,
  url: string,
  deps: LinkRouteDeps,
  ownerId: string,
): Promise<void> {
  // Held across stages so every progress write after the first keeps the
  // thumbnail on the row. Dropping it would make the queue card flicker back to
  // a grey box halfway through.
  let thumbnail: string | undefined;

  const write = async (stage: LinkStage, thumb?: string) => {
    if (thumb) thumbnail = thumb;
    const now = deps.now();
    try {
      await deps.store.updateJob(
        jobId,
        { status: "processing", progress: toLinkJobProgress(stage, now, thumbnail) },
        now,
      );
    } catch (error) {
      // A progress write is a nicety. Losing one must not lose the analysis
      // that is already most of the way through.
      console.warn(`[link ${jobId}] progress write failed at ${stage}`, error);
    }
  };

  try {
    const result = await deps.analyzeLink(url, {
      media: deps.media,
      transcriber: deps.transcriber,
      responses: deps.responses,
      googleApiKey: deps.googleApiKey,
      cache: deps.cache,
      store: deps.locations,
      fetch: deps.fetch,
      now: deps.now,
      onStage: (stage, metadata) => void write(stage, metadata?.thumbnail),
    });

    const contentId = await saveContent(result, deps, ownerId, jobId);

    const now = deps.now();
    await deps.store.updateJob(
      jobId,
      {
        status: "completed",
        // The finished result is the better source: it is the thumbnail we
        // actually analysed, and it does not depend on a progress write having
        // landed earlier.
        progress: toLinkJobProgress("done", now, result.metadata.thumbnail || thumbnail),
        result: toLinkJobResult(result, contentId) as unknown as Record<string, unknown>,
        error: null,
      },
      now,
    );
  } catch (error) {
    console.error(`[link ${jobId}] the pipeline failed`, error);
    const now = deps.now();
    // A `LinkUserError` was written for the reader — "that video is 17 minutes
    // long" is the whole answer, and it is dynamic, so no allowlist can carry
    // it. Everything else goes through the usual gate.
    const message = isLinkUserError(error)
      ? error.message
      : getFriendlyApiError(error, FAILED_MESSAGE);
    await deps.store
      .updateJob(jobId, { status: "failed", error: message }, now)
      .catch((writeError) => {
        console.error(`[link ${jobId}] the failure could not be recorded`, writeError);
      });
  }
}
