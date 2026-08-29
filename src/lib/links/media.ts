/**
 * Metadata and media, via RapidAPI's `social-download-all-in-one`.
 *
 * This is Argo's `services/video-downloader.ts`, ported. The first version of
 * this port used yt-dlp instead — one binary, no key — and it worked on YouTube
 * and then failed on the first TikTok tried, with "Unable to extract universal
 * data for rehydration". That is the tax on scraping: the extractor breaks
 * whenever the platform changes its page, and it breaks for everyone at once.
 * Paying an API to keep up with that is the trade Argo already made.
 *
 * ## One call, two stages
 *
 * `autolink` returns the metadata *and* the direct media URLs together, so
 * `inspect` makes the billed call and `download` spends only bandwidth. That is
 * what keeps the duration guard useful: a seventeen-minute video is refused
 * after one cheap call and before any bytes move.
 *
 * ## Image posts are not an edge case
 *
 * A TikTok slideshow has `duration: 0` and images where the video would be, and
 * travel content is full of them. `download` returns a discriminated union
 * rather than a path, so the pipeline can send a slideshow's images straight to
 * OCR and skip the audio it does not have.
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";

import { LinkUserError } from "./errors";
import type { LinkPlatform, VideoMetadata } from "./types";

const AUTOLINK_HOST = "social-download-all-in-one.p.rapidapi.com";
const AUTOLINK_PATH = "/v1/social/autolink";

/**
 * A second, YouTube-only call.
 *
 * `autolink` returns an empty `author` for YouTube, and the channel's `@handle`
 * is the closest equivalent to TikTok's `unique_id` or Instagram's `username`.
 * Best-effort throughout: a failure here costs a display name, not the video.
 */
const YOUTUBE_HOST = "youtube-scraper3.p.rapidapi.com";
const YOUTUBE_PATH = "/api/v1/video/detail";

/** One provider blip otherwise burns the whole job. Argo's numbers. */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [2_000, 5_000];

const REQUEST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 180_000;

/** TikTok reports milliseconds; everything else reports seconds. */
const TIKTOK_MS_THRESHOLD = 1_000;

interface MediaItem {
  type: "video" | "image";
  url: string;
  extension?: string;
  quality?: string;
  is_audio?: boolean;
}

interface AutolinkResponse {
  url?: string;
  source?: "tiktok" | "instagram" | "youtube";
  /** Display name. Empty for YouTube — see `YOUTUBE_HOST`. */
  author?: string;
  title?: string;
  thumbnail?: string;
  duration?: number;
  medias?: MediaItem[];
  /** TikTok handle. */
  unique_id?: string;
  /** Instagram handle. */
  owner?: { username?: string };
}

/** What one billed `autolink` call tells us. */
export interface InspectedMedia {
  metadata: VideoMetadata;
  videoUrls: string[];
  imageUrls: string[];
  /** A slideshow: images and no video track, so no audio to transcribe. */
  isImagePost: boolean;
}

export type DownloadedMedia =
  | { kind: "video"; path: string }
  | { kind: "images"; paths: string[] };

export interface MediaSource {
  /** The billed call. Returns metadata and the URLs to fetch. */
  inspect(url: string, platform: LinkPlatform): Promise<InspectedMedia>;
  /** Bandwidth only — the URLs came from `inspect`. */
  download(media: InspectedMedia, dir: string): Promise<DownloadedMedia>;
}

/** TikTok's duration is milliseconds once it is over a second. */
export function normalizeDuration(source: string | undefined, duration: number): number {
  if (source === "tiktok" && duration > TIKTOK_MS_THRESHOLD) return Math.round(duration / 1000);
  return Math.round(duration);
}

/**
 * The platform's own handle, which is what a person recognises.
 *
 * Instagram puts it on `owner.username`, TikTok on `unique_id`, and YouTube
 * nowhere at all — hence the second call, whose answer arrives here as
 * `youtubeHandle`. Falls back to the display name, then to "Unknown".
 */
export function creatorHandle(
  platform: LinkPlatform,
  response: AutolinkResponse,
  youtubeHandle?: string | null,
): string {
  if (platform === "instagram" && response.owner?.username?.trim()) {
    return response.owner.username.trim();
  }
  if (platform === "tiktok" && response.unique_id?.trim()) return response.unique_id.trim();
  if (platform === "youtube" && youtubeHandle?.trim()) return youtubeHandle.trim();
  return response.author?.trim() || "Unknown";
}

/**
 * Which of the returned medias we actually want, per platform.
 *
 * Argo's rules, and each one is a scar. TikTok offers the same video watermarked
 * and not, so quality is a preference chain. Instagram and YouTube list video
 * tracks with no audio muxed in — `is_audio` is what separates a file Whisper
 * can read from a silent one — so that flag is checked before falling back to
 * any mp4 at all.
 */
export function selectMedia(response: AutolinkResponse): {
  videoUrls: string[];
  imageUrls: string[];
} {
  const medias = response.medias ?? [];
  if (medias.length === 0) return { videoUrls: [], imageUrls: [] };

  const source = response.source;
  const images = () => medias.filter((m) => m.type === "image").map((m) => m.url);
  const mp4s = (quality?: string) =>
    medias
      .filter(
        (m) =>
          m.type === "video" &&
          m.extension === "mp4" &&
          (quality === undefined || m.quality === quality),
      )
      .map((m) => m.url);

  if (source === "tiktok") {
    // A slideshow reports duration 0 and carries only images.
    if (normalizeDuration(source, response.duration ?? 0) === 0) {
      return { videoUrls: [], imageUrls: images() };
    }
    const preferred = mp4s("hd_no_watermark");
    if (preferred.length > 0) return { videoUrls: preferred, imageUrls: [] };
    const clean = mp4s("no_watermark");
    if (clean.length > 0) return { videoUrls: clean, imageUrls: [] };
    return { videoUrls: mp4s(), imageUrls: [] };
  }

  const withAudio = medias
    .filter((m) => m.type === "video" && m.extension === "mp4" && m.is_audio === true)
    .map((m) => m.url);
  if (withAudio.length > 0) return { videoUrls: withAudio, imageUrls: [] };

  const anyVideo = mp4s();
  if (anyVideo.length > 0) return { videoUrls: anyVideo, imageUrls: [] };

  // Instagram carousels reach here: no video track at all.
  return { videoUrls: [], imageUrls: images() };
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return { ok: false, status: response.status, message: text.slice(0, 200) };
    }
    return { ok: true, body: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

export interface RapidApiOptions {
  apiKey: string;
  /** Injected so the whole source is testable with no network. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

export function createRapidApiMediaSource(options: RapidApiOptions): MediaSource {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  async function autolink(url: string): Promise<AutolinkResponse> {
    let last = "";

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const outcome = await fetchJson(
          `https://${AUTOLINK_HOST}${AUTOLINK_PATH}`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-rapidapi-host": AUTOLINK_HOST,
              "x-rapidapi-key": options.apiKey,
            },
            body: JSON.stringify({ url }),
          },
          REQUEST_TIMEOUT_MS,
        );

        if (outcome.ok) return outcome.body as AutolinkResponse;

        // A 4xx that is not a rate limit is our request being wrong — a private
        // post, a deleted one, an unsupported host. Asking again buys the same
        // answer at twice the price.
        if (!isRetryableStatus(outcome.status)) {
          throw new LinkUserError(
            "That post could not be read. It may be private, deleted, or from an unsupported account.",
          );
        }
        last = `HTTP ${outcome.status} ${outcome.message}`;
      } catch (error) {
        if (error instanceof LinkUserError) throw error;
        last = error instanceof Error ? error.message : String(error);
      }

      if (attempt < MAX_ATTEMPTS) await sleep(BACKOFF_MS[attempt - 1]);
    }

    throw new Error(`social-download failed after ${MAX_ATTEMPTS} attempts: ${last}`);
  }

  async function youtubeHandleFor(url: string): Promise<string | null> {
    const videoId = youtubeVideoId(url);
    if (!videoId) return null;
    try {
      const outcome = await fetchJson(
        `https://${YOUTUBE_HOST}${YOUTUBE_PATH}?video_id=${encodeURIComponent(videoId)}`,
        {
          method: "GET",
          headers: { "x-rapidapi-host": YOUTUBE_HOST, "x-rapidapi-key": options.apiKey },
        },
        REQUEST_TIMEOUT_MS,
      );
      if (!outcome.ok) return null;
      const body = outcome.body as { data?: { video?: { channel?: { handle?: string } } } };
      return body.data?.video?.channel?.handle?.replace(/^@/, "").trim() || null;
    } catch {
      return null;
    }
  }

  async function fetchToFile(url: string, destination: string): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await doFetch(url, {
        signal: controller.signal,
        headers: {
          // The CDN serves these to browsers. `identity` because a compressed
          // body would have to be inflated before ffmpeg could read it.
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "*/*",
          "Accept-Encoding": "identity",
        },
      });
      if (!response.ok) {
        throw new Error(`download failed: ${response.status} ${response.statusText}`);
      }
      await writeFile(destination, Buffer.from(await response.arrayBuffer()));
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async inspect(url, platform) {
      // Independent calls, so they overlap. The YouTube one is skipped for
      // every other platform and returns null rather than throwing.
      const [response, youtubeHandle] = await Promise.all([
        autolink(url),
        platform === "youtube" ? youtubeHandleFor(url) : Promise.resolve(null),
      ]);

      const { videoUrls, imageUrls } = selectMedia(response);
      if (videoUrls.length === 0 && imageUrls.length === 0) {
        throw new LinkUserError("There is no video or image in that post to analyze.");
      }

      return {
        metadata: {
          url,
          platform,
          title: response.title?.trim() ?? "",
          // `autolink` has no caption field distinct from the title, so unlike
          // yt-dlp there is no description to read. On TikTok the title *is*
          // the caption, which is where the place names usually are.
          description: "",
          uploader: creatorHandle(platform, response, youtubeHandle),
          thumbnail: response.thumbnail?.trim() ?? "",
          durationSeconds: normalizeDuration(response.source, response.duration ?? 0),
        },
        videoUrls,
        imageUrls,
        isImagePost: videoUrls.length === 0 && imageUrls.length > 0,
      };
    },

    async download(media, dir) {
      if (media.isImagePost) {
        const paths: string[] = [];
        for (const [index, url] of media.imageUrls.entries()) {
          const file = path.join(dir, `image_${String(index).padStart(4, "0")}.jpg`);
          await fetchToFile(url, file);
          paths.push(file);
        }
        return { kind: "images", paths };
      }

      const file = path.join(dir, "video.mp4");
      await fetchToFile(media.videoUrls[0], file);
      return { kind: "video", path: file };
    },
  };
}

/**
 * The video id in any YouTube URL form.
 *
 * Exported for its own test: it is the input to the handle lookup, and every
 * one of these forms appears in the wild.
 */
export function youtubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();

    if (host.endsWith("youtu.be")) {
      return parsed.pathname.replace(/^\/+/, "").split("/")[0] || null;
    }
    if (host.endsWith("youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return v;
      const segments = parsed.pathname.split("/").filter(Boolean);
      if (segments.length >= 2 && ["shorts", "embed", "live"].includes(segments[0])) {
        return segments[1] || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}
