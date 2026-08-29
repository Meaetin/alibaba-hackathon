/**
 * A link stage, as a number the progress bar can walk toward.
 *
 * `useProgressAnimation` takes two paths. Given a `percent` it trusts it and
 * crawls between stages on wall clock; given only a `step` it looks the ordinal
 * up in a table that was written for Argo's *cloud* content-analysis pipeline —
 * a different pipeline with different stage boundaries. So this reports a real
 * percentage, the same choice `toJobProgress` makes for the planner, and leaves
 * `step` unset.
 *
 * The weights are measured, not guessed: three live YouTube runs, timings in
 * `LinkAnalysisStats.timings`. They are weights rather than promises — what
 * they decide is how much of the bar a stage owns and how fast the crawl moves
 * across it, so being wrong makes the bar uneven, not incorrect.
 *
 * `watching` is the big one and deliberately so: transcription and OCR run
 * concurrently inside it, and on a video with any length the vision calls
 * dominate. It is also the stage that reports nothing while it runs, which is
 * exactly the case the crawl exists for.
 */

import type { JobProgress } from "@/lib/db/schema";

import type { LinkStage } from "./pipeline";

interface StagePlan {
  stage: Exclude<LinkStage, "done">;
  label: string;
  /** Rough wall-clock cost, ms. Measured across three live runs. */
  ms: number;
}

const LINK_STAGES: readonly StagePlan[] = [
  { stage: "metadata", label: "Reading the post", ms: 1_800 },
  { stage: "download", label: "Fetching the video", ms: 4_500 },
  { stage: "watching", label: "Watching and listening", ms: 7_000 },
  { stage: "extracting", label: "Finding the places", ms: 2_500 },
  { stage: "resolving", label: "Looking them up", ms: 3_000 },
];

const TOTAL_MS = LINK_STAGES.reduce((sum, entry) => sum + entry.ms, 0);

export const LINK_STAGE_COUNT = LINK_STAGES.length;

/**
 * Where a stage sits on the bar, how long it should take, and how much of the
 * run is left after it.
 *
 * Exported so a test can assert the bar only ever moves forward — a percentage
 * table edited by hand is exactly the kind of thing that ends up with stage
 * four behind stage three and nobody notices until a demo.
 */
export function linkStageOutlook(stage: LinkStage): {
  index: number;
  percent: number;
  nextPercent: number;
  stageMs: number;
  etaSeconds: number;
} {
  if (stage === "done") {
    return { index: LINK_STAGES.length, percent: 100, nextPercent: 100, stageMs: 0, etaSeconds: 0 };
  }

  const index = LINK_STAGES.findIndex((entry) => entry.stage === stage);
  const before = LINK_STAGES.slice(0, index).reduce((sum, entry) => sum + entry.ms, 0);
  const own = LINK_STAGES[index].ms;

  return {
    index,
    percent: Math.round((before / TOTAL_MS) * 100),
    nextPercent: Math.round(((before + own) / TOTAL_MS) * 100),
    stageMs: own,
    etaSeconds: Math.round((TOTAL_MS - before) / 1000),
  };
}

/**
 * The `jobs.progress` row for a stage.
 *
 * `thumbnail` is not part of `JobProgress` proper — it is the extension
 * `QueueJob` already declares and `LinkQueueCard` already reads. Putting the
 * video's poster frame there is what makes a queued link render as the video
 * rather than as a grey box, and it costs nothing: the URL is in the metadata
 * we fetched in the first stage.
 */
export function toLinkJobProgress(
  stage: LinkStage,
  now: Date,
  thumbnail?: string,
): JobProgress & { thumbnail?: string } {
  const outlook = linkStageOutlook(stage);
  const label =
    stage === "done" ? "Done" : (LINK_STAGES[outlook.index]?.label ?? "Working");

  return {
    percent: outlook.percent,
    label,
    stage,
    done: outlook.index,
    total: LINK_STAGES.length,
    fired_at: now.toISOString(),
    eta_seconds: outlook.etaSeconds,
    next_percent: outlook.nextPercent,
    stage_ms: outlook.stageMs,
    ...(thumbnail ? { thumbnail } : {}),
  };
}
