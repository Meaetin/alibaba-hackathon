/**
 * Runs the link pipeline against one real URL and prints what came back.
 *
 * The point of a script rather than only a route: this is the entry point that
 * spends real money on a real video, so it should be runnable without a browser
 * and it should say exactly what it bought. Every counter the pipeline keeps is
 * printed, including the ones that report a stage quietly degrading.
 *
 * Usage:
 *   npm run links:analyze -- "https://www.tiktok.com/@someone/video/123"
 *   npm run links:analyze -- "<url>" --keep      # leave the temp files behind
 *
 * Needs OPENAI_API_KEY, GOOGLE_PLACES_API_KEY and DATABASE_URL in `.env.local`,
 * plus RAPIDAPI_KEY and `ffmpeg` on PATH. It writes to `locations` and
 * `place_search_cache` through the real stores, which is deliberate: a second
 * run of the same video should be free, and it only is if the first one cached.
 */

import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import OpenAI from "openai";

import { getDb } from "@/lib/db/client";
import { createLocationStore, createSearchCache } from "@/lib/db/stores";
import { createResponsesClient } from "@/lib/planner/openai";
import { formatUsd, summarizeCost, PRICES_AS_OF } from "@/lib/planner/pricing";
import { createWhisperTranscriber } from "@/lib/links/audio";
import { createRapidApiMediaSource } from "@/lib/links/media";
import { analyzeLink } from "@/lib/links/pipeline";

const OUTPUT = path.join(process.cwd(), "scripts", "output", "link-analysis.json");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set. Copy .env.local.example to .env.local and fill it in.`);
    process.exit(1);
  }
  return value;
}

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const keep = args.includes("--keep");
  const url = args.find((arg) => !arg.startsWith("--"));
  if (!url) {
    console.error('Usage: npm run links:analyze -- "<video url>" [--keep]');
    process.exit(1);
  }

  const openai = new OpenAI({ apiKey: required("OPENAI_API_KEY") });
  const googleApiKey = required("GOOGLE_PLACES_API_KEY");
  required("RAPIDAPI_KEY");
  required("DATABASE_URL");
  const db = getDb();

  // With --keep the directory is ours, so `analyzeLink` leaves it alone and the
  // frames and audio are still there to look at afterwards.
  const workDir = keep ? await mkdtemp(path.join(tmpdir(), "argo-link-keep-")) : undefined;
  if (workDir) console.log(`Working directory: ${workDir}`);

  console.log(`Analyzing ${url}\n`);
  const started = Date.now();

  const result = await analyzeLink(url, {
    media: createRapidApiMediaSource({ apiKey: required("RAPIDAPI_KEY") }),
    transcriber: createWhisperTranscriber(openai),
    responses: createResponsesClient(openai),
    googleApiKey,
    cache: createSearchCache(db),
    store: createLocationStore(db),
    now: () => new Date(),
    workDir,
    onStage: (stage) => console.log(`  ... ${stage}`),
  });

  const { metadata, analysis, resolved, stats } = result;

  console.log(`\n${"=".repeat(72)}`);
  console.log(`${metadata.title}`);
  console.log(`by ${metadata.uploader} on ${metadata.platform} · ${metadata.durationSeconds}s`);
  console.log("=".repeat(72));

  if (analysis) {
    console.log(`\nTitle:    ${analysis.generatedTitle}`);
    console.log(`About a place? ${analysis.isLocationRelated ? "yes" : "no"}`);
    console.log(`Country:  ${analysis.primaryCountry ?? "(none)"}`);
    console.log(`Region:   ${analysis.primaryRegion ?? "(none)"}`);
    console.log(`\nSummary:  ${analysis.summary}`);
  } else {
    console.log("\nThe extraction call produced nothing usable.");
  }

  const duplicates = stats.locationsResolved - stats.locationsDistinct;
  console.log(
    `\nPlaces (${stats.locationsResolved} of ${stats.locationsNamed} resolved` +
      `${duplicates > 0 ? `, ${stats.locationsDistinct} distinct venues` : ""}):`,
  );
  for (const entry of resolved) {
    if (entry.place) {
      const rating = entry.place.rating ? ` ${entry.place.rating}*` : "";
      console.log(`  [ok] ${entry.mention}`);
      console.log(`       -> ${entry.place.name}${rating}  (${entry.place.placeId})`);
    } else {
      console.log(`  [--] ${entry.mention}  (${entry.reason})`);
    }
  }
  if (resolved.length === 0) console.log("  (none)");

  console.log(`\nWhat it read:`);
  console.log(`  transcript      ${stats.transcriptChars} chars from ${stats.whisperAudioSeconds.toFixed(1)}s of audio`);
  console.log(`  on-screen text  ${stats.ocrLines} distinct lines from ${stats.framesExtracted} frames`);
  console.log(`  OCR batches     ${stats.ocrBatches} run, ${stats.ocrBatchesFailed} failed`);
  if (stats.retrieval) {
    console.log(`  Places searches ${stats.retrieval.billedCalls} billed, ${stats.retrieval.cacheHits} from cache`);
  } else {
    console.log(`  Places searches none — the video is not about places`);
  }

  console.log(`\nTimings:`);
  for (const [stage, ms] of Object.entries(stats.timings)) {
    console.log(`  ${stage.replace(/Ms$/, "").padEnd(16)} ${seconds(ms as number)}`);
  }
  console.log(`  ${"total".padEnd(16)} ${seconds(Date.now() - started)}`);

  // Whisper is deliberately absent from this table: it bills per second of
  // audio, and `pricing.ts` prices tokens. A row reading $0.00 for it would be
  // read as free rather than as unpriced.
  console.log(`\nModel spend (list prices as of ${PRICES_AS_OF}; Whisper bills per second and is not in this table):`);
  const cost = summarizeCost(stats.usage);
  for (const stage of cost.stages) {
    const shown = stage.usd === null ? "no price on file" : formatUsd(stage.usd);
    console.log(
      `  ${stage.stage.padEnd(14)} ${String(stage.calls).padStart(3)} calls  ` +
        `${stage.inputTokens} in / ${stage.outputTokens} out  ${shown}`,
    );
  }
  const floor = cost.unpriced.length > 0 ? " (a floor — no price on file for " + cost.unpriced.join(", ") + ")" : "";
  console.log(`  ${"total".padEnd(14)}     ${formatUsd(cost.usd)}${floor}`);

  if (stats.failures.length > 0) {
    console.log(`\nWhat degraded:`);
    for (const failure of stats.failures) console.log(`  - ${failure}`);
  }

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, JSON.stringify(result, null, 2));
  console.log(`\nFull result written to ${path.relative(process.cwd(), OUTPUT)}`);
}

main().catch((error) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
