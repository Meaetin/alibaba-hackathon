/**
 * Which platform a link is, and whether we will touch it at all.
 *
 * Argo asked a broader question here (`services/content-detector.ts`): it
 * fetched unknown URLs, counted words, sniffed for video embeds and routed to a
 * webpage pipeline. There is no webpage pipeline in this port, so the question
 * collapses to *is this one of the three platforms yt-dlp handles*.
 *
 * **The allowlist is the security control, not a convenience.** `analyzeLink`
 * hands this URL to a subprocess that will connect to it, so an unchecked URL
 * is a request forgery with extra steps — `file://`, `http://169.254.169.254/`,
 * a redirect to something on localhost. Argo's generic `sanitizeUrl` had to
 * reason about all of that because it accepted any site. Refusing everything
 * but three known hosts over https is a stronger rule and a far shorter one.
 */

import type { LinkPlatform } from "./types";

/**
 * Host suffixes we accept, per platform.
 *
 * Matched as suffixes against the *parsed* hostname, never with `includes` on
 * the raw string. `https://youtube.com.evil.test/x` contains "youtube.com" and
 * is not YouTube; Argo's `urlLower.includes('youtube.com')` says it is.
 */
const HOSTS: ReadonlyArray<{ suffixes: readonly string[]; platform: LinkPlatform }> = [
  { platform: "youtube", suffixes: ["youtube.com", "youtu.be"] },
  { platform: "tiktok", suffixes: ["tiktok.com"] },
  { platform: "instagram", suffixes: ["instagram.com"] },
];

function platformForHost(hostname: string): LinkPlatform | null {
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const entry of HOSTS) {
    if (entry.suffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
      return entry.platform;
    }
  }
  return null;
}

export type LinkTarget =
  | { ok: true; url: string; platform: LinkPlatform }
  | { ok: false; reason: string };

/**
 * Parses and vets a pasted link.
 *
 * The returned `url` is the parsed form, not the input: whatever reaches the
 * subprocess should be the thing that was checked, not a string that merely
 * looked like it. Query and fragment survive — a YouTube watch id lives in the
 * query, and stripping it would break the common case to tidy up the rare one.
 */
export function detectLink(raw: string): LinkTarget {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (!trimmed) return { ok: false, reason: "No link was given." };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: "That is not a valid URL." };
  }

  // http is refused rather than upgraded. All three platforms serve https, so
  // an http link is either very old or someone steering us at a proxy.
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "Only https links are supported." };
  }

  const platform = platformForHost(parsed.hostname);
  if (!platform) {
    return { ok: false, reason: "Only YouTube, TikTok and Instagram links are supported." };
  }

  return { ok: true, url: parsed.toString(), platform };
}
