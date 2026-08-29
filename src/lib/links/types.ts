/**
 * The shapes the link pipeline passes between its stages.
 *
 * This is a port of Argo's content-analysis worker
 * (`backend/worker/src/jobs/video-analysis.ts` and the services under it) with
 * everything cloud-shaped removed: no Pub/Sub, no checkpoint artifacts, no
 * Supabase row, no retry ladder. What is left is the part that answers the only
 * question worth asking — *which places does this video talk about* — and it
 * runs in one local Node process.
 *
 * Two conventions carried over from the planner, on purpose:
 *
 * - **Every stage reports counters, not just output.** Four of the six stages
 *   degrade rather than throw, and a degraded run produces an itinerary-shaped
 *   answer that looks exactly like a good one. The counters are the only way to
 *   tell them apart, which is the lesson `AGENTS.md` records three times over.
 * - **Nothing reads an ambient clock or vendor client.** They arrive as
 *   parameters, so the whole pipeline runs in a test with no ffmpeg, no yt-dlp
 *   and no network.
 */

import type { RetrievalStats, RetrievedPlace } from "@/lib/planner/retrieval";
import type { StageUsage } from "@/lib/planner/pricing";

/** The three platforms yt-dlp handles well enough to demo. */
export type LinkPlatform = "youtube" | "tiktok" | "instagram";

/**
 * What the platform says about itself, before we have watched anything.
 *
 * `description` is the caption — on TikTok and Instagram it is frequently the
 * single richest source of place names in the whole post, so it goes to the
 * model alongside the transcript rather than being logged and dropped.
 */
export interface VideoMetadata {
  url: string;
  platform: LinkPlatform;
  title: string;
  description: string;
  uploader: string;
  thumbnail: string;
  durationSeconds: number;
}

/** A spoken transcript, and the audio length Whisper actually billed for. */
export interface Transcript {
  text: string;
  durationSeconds: number;
}

/**
 * The model's answer, before any of it is checked against Google.
 *
 * `locations` are strings the model wrote — "Senso-ji Temple, Tokyo, Japan" —
 * and they are claims, not facts. `resolve.ts` is what turns a claim into a
 * `place_id`, and a claim that resolves to nothing is kept and marked rather
 * than quietly dropped.
 */
export interface LinkAnalysis {
  isLocationRelated: boolean;
  generatedTitle: string;
  summary: string;
  primaryCountry: string | null;
  primaryRegion: string | null;
  locations: string[];
}

/** Why a mention has no place attached. */
export type UnresolvedReason = "no_match" | "search_failed";

/**
 * One thing the model named, and the Google place it turned out to be.
 *
 * The mention is kept verbatim next to the match. Without it there is no way to
 * see that "Marina Bay Sands, Singapore, Singapore" resolved to a shopping mall
 * three doors down, which is the failure mode this whole stage has.
 */
export interface ResolvedLocation {
  mention: string;
  place: RetrievedPlace | null;
  reason?: UnresolvedReason;
}

/** Wall-clock per stage, ms. Enough to see which one is worth optimising. */
export interface LinkTimings {
  metadataMs: number;
  downloadMs: number;
  /** Audio extraction plus the Whisper call. Runs concurrently with OCR. */
  transcriptionMs: number;
  frameExtractMs: number;
  ocrMs: number;
  extractMs: number;
  resolveMs: number;
}

export interface LinkAnalysisStats {
  transcriptChars: number;
  /**
   * Seconds of audio sent to Whisper.
   *
   * Deliberately not in `usage`: Whisper bills per second, not per token, so
   * pricing it through `StageUsage` would either invent a token count or report
   * a free stage. `pricing.ts` prices tokens and says "no price on file" for
   * anything it does not know — a $0.00 row is worse than no row.
   */
  whisperAudioSeconds: number;
  framesExtracted: number;
  ocrBatches: number;
  ocrBatchesFailed: number;
  ocrLines: number;
  locationsNamed: number;
  locationsResolved: number;
  /** Places whose photo was fetched this run. Zero when every one was already
   *  resolved by an earlier link or plan, which is the cache working. */
  photosResolved: number;
  /**
   * Distinct `place_id`s among the resolved mentions.
   *
   * Lower than `locationsResolved` when two names are one venue — "Lau Pa Sat"
   * and "Telok Ayer Market" are the same market, and a real run named both.
   * The list itself is deliberately not shortened: a mention that turned out to
   * be a duplicate is still something the video said, and a list that quietly
   * gets shorter cannot say which of the two Google agreed with.
   */
  locationsDistinct: number;
  /** Present only once resolution has run. Omitted — not zeroed — when the
   *  video was not location-related, so "we did not ask" and "we asked and
   *  Google had nothing" stay different answers. */
  retrieval?: RetrievalStats;
  /** One plain sentence per stage that degraded. Empty on a clean run. */
  failures: string[];
  usage: StageUsage[];
  timings: LinkTimings;
}

export interface LinkAnalysisResult {
  metadata: VideoMetadata;
  transcript: Transcript;
  ocrLines: string[];
  /** Null when the extraction call failed. The metadata above is still real. */
  analysis: LinkAnalysis | null;
  resolved: ResolvedLocation[];
  stats: LinkAnalysisStats;
}
