/**
 * Reading the text burned into a video's frames.
 *
 * This is the stage the whole port nearly shipped without, and it earns its
 * place: on TikTok and Reels the place name is very often *only* on screen —
 * the audio is music, or a voice saying "you have to try this". A transcript
 * alone gets those videos wrong in a way that looks like success, because it
 * still returns a summary and a country.
 *
 * ## What changed from Argo
 *
 * Argo ran Gemini 2.5 Flash over every frame in one call and fell back to
 * GPT-4o-mini in batches of ten. This runs the OpenAI path only. One vendor,
 * one key, one error taxonomy — and reading a burned-in caption is the easiest
 * thing a vision model does, so the second provider was buying reliability, not
 * accuracy. Everything here is behind `ResponsesClient`, so Gemini goes back in
 * as another implementation of that port rather than as a branch in this file.
 *
 * Two of Argo's rough edges are gone with it. Its batching rewrote the frame
 * index range into the prompt with a regex per batch, and merged the batches by
 * concatenating raw JSON strings with a comma — which produces something
 * unparseable the moment one batch answers with an object instead of an array.
 * Here every batch is asked for indices from zero, the offset is added in code
 * afterwards, and structured output means there is no parse to fail.
 *
 * ## What it costs, and the one thing `detail: "low"` gives up
 *
 * Measured on this account: about 107 input tokens per frame, so a 60-second
 * clip's OCR is roughly a tenth of what its Whisper minute costs. `low` caps
 * the image at 512px, which reads overlay captions comfortably and will miss
 * small text — a shop sign in the background, a menu board. `detail` is an
 * option rather than a constant so that is a decision somebody can revisit,
 * but the default stays where the money is.
 */

import { readFile } from "node:fs/promises";

import { z } from "zod";

import { mapWithConcurrency } from "@/lib/planner/http";
import {
  MODELS,
  jsonSchemaFormat,
  withBackoff,
  type ResponseInputPart,
  type ResponsesClient,
  type ResponsesRequest,
} from "@/lib/planner/openai";
import { addUsage, emptyStageUsage, type StageUsage } from "@/lib/planner/pricing";

/** Frames per vision call. Argo's number, and it holds up: ten images at
 *  `detail: "low"` is about a thousand input tokens, comfortably inside any
 *  output budget, and it keeps a single failure to ten seconds of video. */
export const OCR_BATCH_SIZE = 10;

/** Vision calls in flight. Matches the retrieval and enrichment fan-outs. */
export const OCR_CONCURRENCY = 4;

/**
 * Per batch. Ten frames of dense signage is the worst case and comes in well
 * under this; the cap is here so a model that starts repeating itself stops
 * costing money rather than running to the model's own ceiling.
 */
const MAX_OUTPUT_TOKENS = 4096;

/**
 * Indices are **batch-local** — every batch is asked to number its frames from
 * zero. The offset is added in code after parsing. Telling each batch its true
 * position in the video is what forced Argo into rewriting its prompt per
 * batch, and it buys nothing: nothing downstream reads the index except the
 * "how many frames had text" counter.
 */
const OcrBatchSchema = z.object({
  frames: z.array(
    z.object({
      index: z.number(),
      text: z.string(),
    }),
  ),
});

function buildPrompt(frameCount: number): string {
  return `Perform OCR on these ${frameCount} video frames, in the order given.

Return one entry per frame that contains readable text, with "index" counting
from 0 for the first frame to ${frameCount - 1} for the last.

Rules:
- Focus on text a viewer is meant to read: place names, restaurant and cafe
  names, destination labels, captions, subtitles and on-screen overlays.
- Ignore player chrome — progress bars, view counts, usernames, follow buttons,
  and platform watermarks.
- Omit a frame entirely if it has no meaningful text. Do not invent text.
- Transcribe what is written, including the original language. Do not translate
  and do not summarise.`;
}

function requestFor(prompt: string, images: readonly string[], detail: OcrDetail): ResponsesRequest {
  const content: ResponseInputPart[] = [
    { type: "input_text", text: prompt },
    ...images.map(
      (dataUrl): ResponseInputPart => ({ type: "input_image", image_url: dataUrl, detail }),
    ),
  ];

  return {
    model: MODELS.ocr,
    input: [{ role: "user", content }],
    // Reading text off an image is not a reasoning task, and an unset effort
    // silently buys reasoning tokens per batch.
    reasoning: { effort: "none" },
    text: { format: jsonSchemaFormat("frame_ocr", OcrBatchSchema) },
    max_output_tokens: MAX_OUTPUT_TOKENS,
  };
}

export type OcrDetail = "low" | "high" | "auto";

export interface OcrDeps {
  responses: ResponsesClient;
  batchSize?: number;
  concurrency?: number;
  detail?: OcrDetail;
  /** Injected for the backoff between retries, so a test never really waits. */
  sleep?: (ms: number) => Promise<void>;
}

export interface OcrResult {
  /** Every distinct line seen, in the order it first appeared. */
  lines: string[];
  framesRead: number;
  /** Frames the model returned any text for. Low against `framesRead` on a
   *  video with no overlays, which is information, not a fault. */
  framesWithText: number;
  batches: number;
  /** Batches that never answered. Their frames are simply not in `lines`, and
   *  nothing else in the result says so — which is why this is counted. */
  batchesFailed: number;
  usage: StageUsage;
}

/**
 * Collapses lines seen across every frame into one list.
 *
 * A caption sits on screen for several seconds, so at one frame per second the
 * same words come back three or four times. Comparison is trimmed and
 * lowercased; the first spelling seen is the one kept, because the model's
 * casing is usually the sign's casing. Single characters go — they are almost
 * always a stray glyph off a watermark.
 */
export function deduplicateLines(lines: readonly string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const key = trimmed.toLowerCase();
    if (trimmed.length > 1 && !seen.has(key)) {
      seen.add(key);
      unique.push(trimmed);
    }
  }
  return unique;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Runs OCR over every frame and returns the distinct lines.
 *
 * **Nothing here throws.** A batch that fails — a rate limit that outlasts the
 * backoff, a refusal, a truncated answer — is counted and its frames are lost;
 * the rest of the video still reads. Losing ten seconds of on-screen text is
 * not worth losing the whole analysis, and the caller can see the loss in
 * `batchesFailed` rather than having to infer it from a thin result.
 */
export async function runFrameOcr(
  framePaths: readonly string[],
  deps: OcrDeps,
): Promise<OcrResult> {
  // A mutable holder rather than a running total returned from each worker,
  // matching `enrichPlaces` — the fan-out is cooperative, so reassignment
  // inside the callback is safe and reads the same way in both files.
  const tally = { usage: emptyStageUsage("ocr", MODELS.ocr) };
  if (framePaths.length === 0) {
    return {
      lines: [],
      framesRead: 0,
      framesWithText: 0,
      batches: 0,
      batchesFailed: 0,
      usage: tally.usage,
    };
  }

  const detail = deps.detail ?? "low";
  const batches = chunk(framePaths, deps.batchSize ?? OCR_BATCH_SIZE);

  const results = await mapWithConcurrency(
    batches,
    deps.concurrency ?? OCR_CONCURRENCY,
    async (paths): Promise<{ entries: { index: number; text: string }[] } | { failed: true }> => {
      // Read inside the batch, not up front: 180 frames held as buffers and
      // again as base64 is memory spent to save nothing.
      const images = await Promise.all(
        paths.map(async (framePath) => {
          const bytes = await readFile(framePath);
          return `data:image/jpeg;base64,${bytes.toString("base64")}`;
        }),
      );

      const attempt = await withBackoff(
        () => deps.responses.create(requestFor(buildPrompt(paths.length), images, detail)),
        { sleep: deps.sleep },
      );

      if ("error" in attempt) {
        console.warn(`[link ocr] a batch of ${paths.length} frames failed: ${attempt.error.message}`);
        return { failed: true };
      }

      const response = attempt.value;
      // Counted whatever came back. A response that failed to parse was still
      // generated and still billed, so costing only the usable batches would
      // make a bad run look cheap — same rule `enrichPlaces` keeps.
      tally.usage = addUsage(tally.usage, response.usage);

      // An `incomplete` response is a 200 carrying half an object. It parses as
      // broken JSON and is otherwise indistinguishable from a model writing
      // nonsense, so it is named rather than merged into the generic failure.
      if (response.status === "incomplete") {
        console.warn(`[link ocr] a batch was cut off (${response.incompleteReason ?? "unknown"})`);
        return { failed: true };
      }

      // `JSON.parse` throwing here would reject the whole fan-out and take the
      // pipeline's "nothing in this stage throws" promise with it.
      try {
        const parsed = OcrBatchSchema.safeParse(JSON.parse(response.output_text || "{}"));
        if (!parsed.success) return { failed: true };
        return { entries: parsed.data.frames };
      } catch {
        return { failed: true };
      }
    },
  );

  const allLines: string[] = [];
  let framesWithText = 0;
  let batchesFailed = 0;

  results.forEach((result) => {
    if ("failed" in result) {
      batchesFailed += 1;
      return;
    }
    for (const entry of result.entries) {
      const lines = entry.text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      if (lines.length > 0) framesWithText += 1;
      allLines.push(...lines);
    }
  });

  return {
    lines: deduplicateLines(allLines),
    framesRead: framePaths.length,
    framesWithText,
    batches: batches.length,
    batchesFailed,
    usage: tally.usage,
  };
}
