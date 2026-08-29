/**
 * The link pipeline's result, as it is stored on `jobs.result`.
 *
 * It lives here rather than in the route because **a Next route file may only
 * export its handler and the known config fields** — `export function
 * toLinkJobResult` there fails the build with "is not a valid Route export
 * field", the same constraint that put `deps.ts` one file across from the
 * handlers that use it. Being its own module also means the mapping is testable
 * without driving a request through the handler, and the mapping is the part
 * with decisions in it.
 */

import type { LinkAnalysisResult } from "./types";

/**
 * What lands on `jobs.result`.
 *
 * snake_case, because it is a database row and that is this repo's rule for
 * one. The first eight fields are the shape the ported links UI already reads
 * off a completed job (`buildOptimisticContent` in `src/app/links/page.tsx`) —
 * matching it costs nothing now and is what lets that page light up later
 * without a second result shape to keep true.
 *
 * **The places are stored by id, not by value.** `retrievePlaces` has already
 * written every one of them to `locations`; copying the full row in here would
 * be a second copy that goes stale the moment the first is refreshed. Anything
 * needing more than a name joins the table.
 */
export interface LinkJobResult {
  /**
   * The `content` row this run produced.
   *
   * `buildOptimisticContent` on `/links` keys the finished card on it, so the
   * queue card can morph into the link card in the same grid slot instead of
   * popping out and back in when the list refetches. Null when the row could
   * not be written — the analysis still succeeded and is still worth showing.
   */
  content_id: string | null;
  url: string;
  title: string;
  thumbnail: string;
  content_type: "video";
  platform: string;
  creator: string;
  generated_summary: string;
  location_count: number;
  analysis: LinkAnalysisResult["analysis"];
  places: { mention: string; place_id: string | null; name: string | null; reason?: string }[];
  transcript: string;
  ocr_lines: string[];
  stats: LinkAnalysisResult["stats"];
}

export function toLinkJobResult(
  result: LinkAnalysisResult,
  contentId: string | null,
): LinkJobResult {
  return {
    content_id: contentId,
    url: result.metadata.url,
    // The model's title where there is one: it is written to be read, while the
    // platform's is full of hashtags. Falls back to the platform's.
    title: result.analysis?.generatedTitle || result.metadata.title,
    thumbnail: result.metadata.thumbnail,
    content_type: "video",
    platform: result.metadata.platform,
    creator: result.metadata.uploader,
    generated_summary: result.analysis?.summary ?? "",
    // Distinct venues, not mentions — two names for one market is one place to
    // visit, and this number is what a card renders.
    location_count: result.stats.locationsDistinct,
    analysis: result.analysis,
    places: result.resolved.map((entry) => ({
      mention: entry.mention,
      place_id: entry.place?.placeId ?? null,
      name: entry.place?.name ?? null,
      ...(entry.reason ? { reason: entry.reason } : {}),
    })),
    transcript: result.transcript.text,
    ocr_lines: result.ocrLines,
    stats: result.stats,
  };
}
