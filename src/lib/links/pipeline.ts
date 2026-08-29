/**
 * Link in, places out.
 *
 * `analyzeLink` is Argo's `jobs/video-analysis.ts` with the cloud taken out —
 * no Pub/Sub redelivery, no checkpoint artifacts written between steps, no
 * Supabase row, no retry counter carried across attempts. Six stages, one local
 * Node process, one temporary directory that is deleted on the way out.
 *
 * ## Where it throws, and where it does not
 *
 * It throws on exactly three things, and every one of them means there is
 * nothing to work with: an unsupported link, metadata we could not read, and a
 * video we could not download. Everything after that degrades and reports.
 *
 * That is a deliberate break from Argo. `analyzeVideo` runs transcription and
 * OCR under `Promise.allSettled` and then **re-throws if either rejected**, so
 * one failed vision call loses the transcript that succeeded beside it and the
 * whole job fails. Here the two sides fail independently: a video with a
 * transcript and no OCR still finds places, and so does a silent video with
 * captions. Both losses land in `stats.failures` and on a counter, because
 * `AGENTS.md` keeps making the same point — a stage with a fallback is also a
 * way for a real failure to reach production looking like success.
 *
 * ## What is injected, and why all of it
 *
 * ffmpeg, yt-dlp, OpenAI and Google all arrive as parameters. That is not
 * ceremony: it is what lets `pipeline.test.ts` run this entire function, in
 * order, with its real branching, on a machine with none of them.
 */

import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { resolvePhotos as defaultResolvePhotos } from "@/lib/planner/photos";
import type { PhotoBlobStore } from "@/lib/planner/photos";
import type { FetchLike, LocationStore, SearchCache } from "@/lib/planner/retrieval";
import type { ResponsesClient } from "@/lib/planner/openai";
import type { StageUsage } from "@/lib/planner/pricing";

import { extractAudio as defaultExtractAudio, type Transcriber } from "./audio";
import { LinkUserError } from "./errors";
import { detectLink } from "./detect";
import { extractLocations } from "./extract";
import { extractFrames as defaultExtractFrames, type FrameOptions } from "./frames";
import type { DownloadedMedia, MediaSource } from "./media";
import { runFrameOcr, type OcrDetail } from "./ocr";
import { resolveLocations } from "./resolve";
import type {
  LinkAnalysisResult,
  LinkAnalysisStats,
  LinkTimings,
  Transcript,
  VideoMetadata,
} from "./types";

/**
 * Ten minutes, which is Argo's `MAX_VIDEO_DURATION`.
 *
 * A guard on spend, not on taste. Whisper bills per second and frames are
 * capped at 180 anyway, so an hour-long video would pay for sixty minutes of
 * audio to read the first three minutes of pictures.
 */
export const MAX_DURATION_SECONDS = 600;

/**
 * `jobs.type` for a link analysis.
 *
 * `"content-analysis"` rather than `"link-analysis"` because that is the string
 * `/links` and `/home` already pass to `useJobsQueue`, and the type is an
 * interface with those pages. It is also Argo's name for the same pipeline.
 * `jobs.type` is free text and `itinerary_id` is nullable, so it needs no
 * migration either way.
 */
export const LINK_JOB_TYPE = "content-analysis";

export interface LinkPipelineDeps {
  media: MediaSource;
  transcriber: Transcriber;
  responses: ResponsesClient;
  /** Google Places key. Only `resolveLocations` spends it. */
  googleApiKey: string;
  cache: SearchCache;
  store: LocationStore;
  fetch?: FetchLike;
  now?: () => Date;
  /** Where the video, audio and frames go. Defaults to a fresh temp directory
   *  that is removed when the run ends. */
  workDir?: string;
  frames?: FrameOptions;
  ocrDetail?: OcrDetail;
  /** Content-addressed photo cache. Without it the stored `photoUri` expires,
   *  which is the planner's existing trade and not this module's to change. */
  blobs?: PhotoBlobStore;
  /** Injected so a test resolves no photos and bills nothing. */
  resolvePhotos?: typeof defaultResolvePhotos;
  maxDurationSeconds?: number;
  /** The wait between OCR retries. Injected for the same reason `now` is: a
   *  test that really sleeps four seconds is a test nobody runs. */
  sleep?: (ms: number) => Promise<void>;
  /** Both default to the real ffmpeg wrappers. Overridden in tests. */
  extractAudio?: typeof defaultExtractAudio;
  extractFrames?: typeof defaultExtractFrames;
  /**
   * Called as each stage begins, for a job row's progress field.
   *
   * The metadata rides along once there is any — the video's thumbnail is what
   * turns a queue card from a grey box into the post being analysed, and it is
   * known from the very first stage.
   */
  onStage?: (stage: LinkStage, metadata?: VideoMetadata) => void;
}

export type LinkStage =
  | "metadata"
  | "download"
  | "watching"
  | "extracting"
  | "resolving"
  | "done";

const NO_TRANSCRIPT: Transcript = { text: "", durationSeconds: 0 };

async function timed<T>(fn: () => Promise<T>): Promise<[T, number]> {
  const started = Date.now();
  const value = await fn();
  return [value, Date.now() - started];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The images OCR reads.
 *
 * A video is sampled by ffmpeg. A slideshow's own pictures already are the
 * frames — there is no video to sample and nothing to extract — so they go
 * straight through. Both end up as a list of JPEG paths, which is all
 * `runFrameOcr` has ever wanted.
 */
async function framesFor(
  media: DownloadedMedia,
  dir: string,
  extract: typeof defaultExtractFrames,
  options: FrameOptions | undefined,
  timings: LinkTimings,
): Promise<string[]> {
  if (media.kind === "images") return media.paths;

  const started = Date.now();
  try {
    return await extract(media.path, dir, options);
  } finally {
    timings.frameExtractMs = Date.now() - started;
  }
}

export async function analyzeLink(
  url: string,
  deps: LinkPipelineDeps,
): Promise<LinkAnalysisResult> {
  const target = detectLink(url);
  if (!target.ok) throw new LinkUserError(target.reason);

  const timings: LinkTimings = {
    metadataMs: 0,
    downloadMs: 0,
    transcriptionMs: 0,
    frameExtractMs: 0,
    ocrMs: 0,
    extractMs: 0,
    resolveMs: 0,
  };
  const failures: string[] = [];
  const usage: StageUsage[] = [];

  const dir = deps.workDir ?? (await mkdtemp(path.join(tmpdir(), `argo-link-${randomUUID()}-`)));
  const owned = deps.workDir === undefined;

  try {
    deps.onStage?.("metadata");
    const [inspected, metadataMs] = await timed(() =>
      deps.media.inspect(target.url, target.platform),
    );
    timings.metadataMs = metadataMs;
    const { metadata } = inspected;

    const cap = deps.maxDurationSeconds ?? MAX_DURATION_SECONDS;
    if (metadata.durationSeconds > cap) {
      throw new LinkUserError(
        `That video is ${Math.round(metadata.durationSeconds / 60)} minutes long; ` +
          `the limit is ${Math.round(cap / 60)}.`,
      );
    }

    deps.onStage?.("download", metadata);
    const [media, downloadMs] = await timed(() => deps.media.download(inspected, dir));
    timings.downloadMs = downloadMs;

    deps.onStage?.("watching", metadata);
    const audioOf = deps.extractAudio ?? defaultExtractAudio;
    const framesOf = deps.extractFrames ?? defaultExtractFrames;

    // Listening and looking are independent and both are slow, so they overlap
    // — Whisper on a three-minute clip and eighteen vision calls take about the
    // same wall-clock, and running them in series doubles the wait for nothing.
    //
    // A slideshow has no audio track, so there is nothing to listen to and the
    // transcription half is not run at all. That is different from a failed
    // transcription and must not be reported as one: an image post with no
    // speech is working exactly as intended.
    const [heard, seen] = await Promise.allSettled([
      media.kind === "images"
        ? Promise.resolve(NO_TRANSCRIPT)
        : (async () => {
            const started = Date.now();
            try {
              const audioPath = await audioOf(media.path, dir);
              return await deps.transcriber.transcribe(audioPath);
            } finally {
              timings.transcriptionMs = Date.now() - started;
            }
          })(),
      (async () => {
        const framePaths = await framesFor(media, dir, framesOf, deps.frames, timings);
        const ocrStarted = Date.now();
        try {
          return await runFrameOcr(framePaths, {
            responses: deps.responses,
            detail: deps.ocrDetail,
            sleep: deps.sleep,
          });
        } finally {
          timings.ocrMs = Date.now() - ocrStarted;
        }
      })(),
    ]);

    const transcript = heard.status === "fulfilled" ? heard.value : NO_TRANSCRIPT;
    if (heard.status === "rejected") {
      failures.push(`No transcript: ${messageOf(heard.reason)}`);
    }

    const ocr = seen.status === "fulfilled" ? seen.value : null;
    if (seen.status === "rejected") {
      failures.push(`No on-screen text: ${messageOf(seen.reason)}`);
    }
    if (ocr) {
      usage.push(ocr.usage);
      if (ocr.batchesFailed > 0) {
        failures.push(`${ocr.batchesFailed} of ${ocr.batches} OCR batches failed.`);
      }
    }
    const ocrLines = ocr?.lines ?? [];

    // Both sides being gone is survivable — a title and a caption sometimes
    // name the city on their own — but it is the one combination where the
    // answer is mostly guesswork, so it is said plainly rather than inferred
    // from two separate counters reading zero.
    const lostAudio = media.kind === "video" && heard.status === "rejected";
    if (lostAudio && (seen.status === "rejected" || ocrLines.length === 0)) {
      failures.push("Neither audio nor on-screen text was available; working from metadata only.");
    }

    deps.onStage?.("extracting", metadata);
    const [extraction, extractMs] = await timed(() =>
      extractLocations({ metadata, transcript, ocrLines }, { responses: deps.responses }),
    );
    timings.extractMs = extractMs;
    usage.push(extraction.usage);
    if (extraction.failure) failures.push(extraction.failure);

    deps.onStage?.("resolving", metadata);
    const [resolution, resolveMs] = extraction.analysis
      ? await timed(() =>
          resolveLocations(extraction.analysis!, {
            apiKey: deps.googleApiKey,
            cache: deps.cache,
            store: deps.store,
            fetch: deps.fetch,
            now: deps.now?.(),
          }),
        )
      : ([{ resolved: [] }, 0] as [Awaited<ReturnType<typeof resolveLocations>>, number]);
    timings.resolveMs = resolveMs;

    for (const failure of resolution.stats?.failures ?? []) {
      failures.push(`Places search failed for "${failure.request.query}": ${failure.message}`);
    }

    // Photos are the last thing bought and the only thing bought per *place*
    // rather than per run. Retrieval stored the resource names for free;
    // turning one into an image bills the Places Photos SKU, so it happens here
    // — over the places that survived resolution — and never over the pool.
    //
    // It is folded into the resolve stage rather than given a stage of its own:
    // it is a handful of parallel fetches against a step that already takes
    // seconds, and the progress weights are measured, not invented.
    const survivors = resolution.resolved.flatMap((entry) => (entry.place ? [entry.place] : []));
    let photosResolved = 0;
    if (survivors.length > 0) {
      const resolvePhotosFor = deps.resolvePhotos ?? defaultResolvePhotos;
      try {
        const photos = await resolvePhotosFor(
          survivors,
          survivors.map((place) => place.placeId),
          {
            apiKey: deps.googleApiKey,
            store: deps.store,
            fetch: deps.fetch,
            now: deps.now?.(),
            blobs: deps.blobs,
          },
        );
        photosResolved = photos.stats.resolved;
        for (const failure of photos.stats.failures) {
          failures.push(`Photo failed for ${failure.placeId}: ${failure.message}`);
        }
      } catch (error) {
        // A place with no picture is a card with a grey box, not a lost trip.
        failures.push(`No photos: ${messageOf(error)}`);
      }
    }

    const stats: LinkAnalysisStats = {
      transcriptChars: transcript.text.length,
      whisperAudioSeconds: transcript.durationSeconds,
      framesExtracted: ocr?.framesRead ?? 0,
      ocrBatches: ocr?.batches ?? 0,
      ocrBatchesFailed: ocr?.batchesFailed ?? 0,
      ocrLines: ocrLines.length,
      locationsNamed: extraction.analysis?.locations.length ?? 0,
      locationsResolved: resolution.resolved.filter((entry) => entry.place !== null).length,
      photosResolved,
      locationsDistinct: new Set(
        resolution.resolved.flatMap((entry) => (entry.place ? [entry.place.placeId] : [])),
      ).size,
      ...(resolution.stats ? { retrieval: resolution.stats } : {}),
      failures,
      usage,
      timings,
    };

    deps.onStage?.("done", metadata);
    return {
      metadata,
      transcript,
      ocrLines,
      analysis: extraction.analysis,
      resolved: resolution.resolved,
      stats,
    };
  } finally {
    // Only clean up a directory this function created. A caller that passed its
    // own workDir wants to keep what is in it — that is the whole reason to
    // pass one.
    if (owned) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export type { VideoMetadata };
