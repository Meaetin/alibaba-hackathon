/**
 * The one model call that turns a video into a list of places.
 *
 * The prompt is Argo's synthesis prompt from
 * `services/video-analysis-service.ts`, near enough word for word: its
 * relevance criteria and its "Place Name, Locality, Country" format are tuned
 * against real travel content and there is nothing to gain by rewriting them
 * from scratch.
 *
 * Two things are different.
 *
 * **The shape is enforced at the API, not by us.** Argo asked for JSON in prose
 * and then hand-checked five fields, throwing if any was the wrong type. A zod
 * schema through `jsonSchemaFormat` makes that unrepresentable, so what is left
 * here are the checks that are about *meaning* rather than shape: a title too
 * long, a summary too long, and the multi-country override.
 *
 * **It does not throw.** Argo's version raised on a malformed answer, which
 * killed the job. Here a failed call returns `null` and the caller still has
 * real metadata, a real transcript and real OCR lines to show for the money it
 * already spent.
 */

import { z } from "zod";

import {
  MODELS,
  jsonSchemaFormat,
  withRetry,
  type ResponsesClient,
  type ResponsesRequest,
} from "@/lib/planner/openai";
import { addUsage, emptyStageUsage, type StageUsage } from "@/lib/planner/pricing";

import type { LinkAnalysis, Transcript, VideoMetadata } from "./types";

/** Long transcripts exist and the tail of a ten-minute vlog is rarely where the
 *  places are. A cap keeps one long video from costing ten times a short one. */
const MAX_TRANSCRIPT_CHARS = 24_000;
/** OCR lines are deduplicated already, so this is generous. */
const MAX_OCR_LINES = 400;
const MAX_OUTPUT_TOKENS = 4096;

const MAX_TITLE_WORDS = 10;
const MAX_SUMMARY_WORDS = 100;
/** Slack before the summary is cut. A model landing on 104 words has followed
 *  the instruction; truncating it mid-sentence to hit exactly 100 has not. */
const SUMMARY_TOLERANCE_WORDS = 120;

const AnalysisSchema = z.object({
  isLocationRelated: z.boolean(),
  generatedTitle: z.string(),
  summary: z.string(),
  primaryCountry: z.string().nullable(),
  primaryRegion: z.string().nullable(),
  locations: z.array(z.string()),
});

const SYSTEM_PROMPT =
  "You are a travel content analyzer. You read a video's metadata, its spoken " +
  "transcript and the text visible on screen, and you report the specific " +
  "places it is about.";

function buildPrompt(
  metadata: VideoMetadata,
  transcript: string,
  ocrLines: readonly string[],
): string {
  const transcriptSection = transcript.trim()
    ? `TRANSCRIPT:\n${transcript.trim().slice(0, MAX_TRANSCRIPT_CHARS)}`
    : "TRANSCRIPT: (no audio transcript available)";

  const lines = ocrLines.slice(0, MAX_OCR_LINES);
  const ocrSection = lines.length
    ? `ON-SCREEN TEXT (OCR FROM FRAMES):\n${lines.join("\n")}`
    : "ON-SCREEN TEXT: (no text detected in frames)";

  const header = [
    metadata.title ? `VIDEO TITLE: "${metadata.title}"` : "",
    metadata.description ? `VIDEO DESCRIPTION: "${metadata.description}"` : "",
    metadata.uploader ? `CREATOR: ${metadata.uploader}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return `Analyze this travel/location video from the metadata, transcript and on-screen text below.

${header}

${transcriptSection}

${ocrSection}

RELEVANCE CRITERIA:
- isLocationRelated = true if the content primarily features travel vlogs, city
  tours, destination guides, restaurant or cafe reviews naming specific venues,
  landmarks and attractions, "things to do in [place]" recommendations, or
  walking and food tours.
- isLocationRelated = false if it is general lifestyle content with no location
  focus, a product review, unboxing or tutorial, gaming, comedy or
  entertainment, a personal vlog with no significant location mentions, or a
  music or dance video that is not about a specific place.

INSTRUCTIONS:
1. generatedTitle: a clean title, at most ${MAX_TITLE_WORDS} words. Describe what
   the viewer will see or gain, include location names where they matter, and use
   no emojis, hashtags or slang. Take the video's own title as context but
   rewrite it when it is missing or full of hashtags.
2. summary: what the video is about, under ${MAX_SUMMARY_WORDS} words.
3. locations: ONLY specific venues, landmarks and points of interest.
   - Read all three sources with equal care. The description is where a creator
     lists what they visited, so on many posts it names more venues than the
     transcript and the on-screen text put together. Take every venue any of the
     three names, not just the ones that appear in more than one.
   - Format each one as "Place Name, Locality, Country".
     Examples: "Senso-ji Temple, Tokyo, Japan", "Clarke Quay, Singapore, Singapore".
   - INCLUDE restaurants, cafes, bars, hotels, temples, museums, parks,
     monuments, markets and specific attractions.
   - EXCLUDE bare city names, countries, regions, and neighbourhoods with no
     specific venue attached.
   - EXCLUDE anything named only as background: history, an explanation of what
     a word means, a place that has closed, or somewhere the creator mentions
     without going to or recommending. A description often opens with a
     paragraph of history — those names are context, not the itinerary.
   - One entry per distinct venue. If two places are mentioned together, list
     each separately.
   - Always fill in the locality with the nearest city or town; never leave it
     blank. Use complete official names for all three parts.
   - Return an empty array if no specific places are named.
4. primaryCountry: the single country the content is primarily about. MUST be
   null when the content spans several countries ("best places in Europe") or
   when the country is unclear. Do not pick one country out of a list.
5. primaryRegion: a state, province, island or region — "Bali", "California",
   "Hokkaido", "Tuscany". MUST be null when the content spans several regions or
   several countries. State or province level, never a city, never a continent.

EXAMPLES of primaryCountry / primaryRegion:
- "Tokyo food guide" -> primaryCountry "Japan", primaryRegion "Tokyo"
- "Best of Italy" -> primaryCountry "Italy", primaryRegion null
- "Best places in Europe" -> both null
- "Cute cafes" -> both null`;
}

function requestFor(prompt: string): ResponsesRequest {
  return {
    model: MODELS.linkExtract,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    reasoning: { effort: "none" },
    text: { format: jsonSchemaFormat("link_analysis", AnalysisSchema) },
    max_output_tokens: MAX_OUTPUT_TOKENS,
  };
}

/**
 * The country named at the end of a "Place, Locality, Country" string.
 *
 * Two parts means the locality was dropped and the country is last, which the
 * model does for city-states often enough to be worth handling.
 */
function countryOf(mention: string): string | null {
  const parts = mention
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) return parts[2].toLowerCase();
  if (parts.length === 2) return parts[1].toLowerCase();
  return null;
}

export interface MultiCountryOverride {
  primaryCountry: string | null;
  primaryRegion: string | null;
  overridden: boolean;
  countries: string[];
}

/**
 * Forces both primary fields to null when the places named span two or more
 * countries.
 *
 * Ported from Argo's `utils/multi-country-override.ts`, and it exists because
 * the prompt above does not reliably work: told to return null for
 * multi-country content, the model still picks "Italy" out of a "best of
 * Europe" list. The places it named are better evidence than the field it
 * filled in, so they overrule it.
 *
 * This is not cosmetic. `primaryRegion` becomes the `city` on every Places
 * search in `resolve.ts`, so a wrong one sends every lookup to the wrong
 * country and stores rows under it.
 */
export function applyMultiCountryOverride(analysis: LinkAnalysis): MultiCountryOverride {
  const countries = new Set<string>();
  for (const mention of analysis.locations) {
    const country = countryOf(mention);
    if (country) countries.add(country);
  }

  if (countries.size >= 2) {
    return {
      primaryCountry: null,
      primaryRegion: null,
      overridden: true,
      countries: [...countries],
    };
  }

  return {
    primaryCountry: analysis.primaryCountry,
    primaryRegion: analysis.primaryRegion,
    overridden: false,
    countries: [...countries],
  };
}

/** Trims a title or summary that ran past its instruction. */
function clamp(analysis: LinkAnalysis): LinkAnalysis {
  const titleWords = analysis.generatedTitle.trim().split(/\s+/).filter(Boolean);
  const summaryWords = analysis.summary.trim().split(/\s+/).filter(Boolean);

  return {
    ...analysis,
    generatedTitle:
      titleWords.length > MAX_TITLE_WORDS
        ? titleWords.slice(0, MAX_TITLE_WORDS).join(" ")
        : analysis.generatedTitle.trim(),
    summary:
      summaryWords.length > SUMMARY_TOLERANCE_WORDS
        ? `${summaryWords.slice(0, MAX_SUMMARY_WORDS).join(" ")}...`
        : analysis.summary.trim(),
  };
}

export interface ExtractDeps {
  responses: ResponsesClient;
  /** One retry, then degrade — the caller has a fallback and a retry loop on a
   *  single call is worse than shipping what we have. */
  retries?: number;
}

export interface ExtractResult {
  /** Null when the call failed or answered something unusable. */
  analysis: LinkAnalysis | null;
  usage: StageUsage;
  /** One plain sentence, present only when `analysis` is null. */
  failure?: string;
}

export async function extractLocations(
  input: { metadata: VideoMetadata; transcript: Transcript; ocrLines: readonly string[] },
  deps: ExtractDeps,
): Promise<ExtractResult> {
  let usage = emptyStageUsage("link-extract", MODELS.linkExtract);
  const prompt = buildPrompt(input.metadata, input.transcript.text, input.ocrLines);

  const attempt = await withRetry(
    () => deps.responses.create(requestFor(prompt)),
    deps.retries ?? 1,
  );
  if ("error" in attempt) {
    return { analysis: null, usage, failure: `Extraction failed: ${attempt.error.message}` };
  }

  const response = attempt.value;
  usage = addUsage(usage, response.usage);

  if (response.status === "incomplete") {
    return {
      analysis: null,
      usage,
      failure: `Extraction was cut off (${response.incompleteReason ?? "unknown"}).`,
    };
  }

  let parsed;
  try {
    parsed = AnalysisSchema.safeParse(JSON.parse(response.output_text || "{}"));
  } catch {
    return { analysis: null, usage, failure: "Extraction returned text that is not JSON." };
  }
  if (!parsed.success) {
    return { analysis: null, usage, failure: "Extraction returned the wrong shape." };
  }

  const clamped = clamp(parsed.data);
  const override = applyMultiCountryOverride(clamped);
  if (override.overridden) {
    console.warn(
      `[link extract] places span ${override.countries.length} countries ` +
        `(${override.countries.join(", ")}) — dropping primaryCountry ` +
        `"${clamped.primaryCountry}" and primaryRegion "${clamped.primaryRegion}"`,
    );
  }

  return {
    analysis: {
      ...clamped,
      primaryCountry: override.primaryCountry,
      primaryRegion: override.primaryRegion,
    },
    usage,
  };
}
