/**
 * The link pipeline's background half: run it, write what happened onto the
 * `jobs` row, and save the library entry it produced.
 *
 * It lives one file across from the handlers rather than inside `route.ts` for
 * the reason `deps.ts` does — **a Next route file may export only its handler
 * and the known config fields**, so `export async function runLinkJob` there
 * fails the build. Two handlers need it now: `POST /api/jobs` starts a run and
 * `POST /api/jobs/[id]/retry` starts the same run again on the same row, and a
 * second copy of it is a second place for the failure mapping to drift.
 */

import { getFriendlyApiError } from "@/lib/errors/userMessages";
import { isLinkUserError } from "@/lib/links/errors";
import type { LinkStage } from "@/lib/links/pipeline";
import { toLinkJobProgress } from "@/lib/links/progress";
import type { ContentToSave } from "@/lib/db/content";
import { toLinkJobResult } from "@/lib/links/job-result";
import type { LinkAnalysisResult } from "@/lib/links/types";

import type { LinkRouteDeps } from "../deps";

/** The sentence a traveller sees when the failure has no better words of its
 *  own. On the allowlist in `getFriendlyApiError`. */
const FAILED_MESSAGE = "We couldn't analyze that link.";

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
export async function runLinkJob(
  jobId: string,
  url: string,
  deps: LinkRouteDeps,
  ownerId: string,
  /**
   * A thumbnail already on the row, from a run that failed. The metadata stage
   * has none of its own until RapidAPI answers, so without this a retry blanks
   * the card the traveller is watching for the first two seconds — the same
   * flicker the `thumbnail` variable below exists to prevent, across a retry
   * instead of across a stage.
   */
  seedThumbnail?: string,
): Promise<void> {
  // Held across stages so every progress write after the first keeps the
  // thumbnail on the row. Dropping it would make the queue card flicker back to
  // a grey box halfway through.
  let thumbnail: string | undefined = seedThumbnail;

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
