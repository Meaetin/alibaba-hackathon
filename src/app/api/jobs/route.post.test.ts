/**
 * `POST /api/jobs`, driven through the real handler with fake ports.
 *
 * Everything is the production path except the things that cost money or need
 * a server: RapidAPI, ffmpeg, Whisper, OpenAI, Google and Postgres. The
 * pipeline, the progress arithmetic, the result mapping and the error mapping
 * are all real — which is what `linkRouteDeps.create` exists for.
 *
 * Four properties this file holds:
 *
 *   1. the job row comes back **before** the analysis finishes
 *   2. a link we will not touch is a 400 with no row left behind
 *   3. a failure a person can act on survives; a provider's own words do not
 *   4. the stored result carries the fields the links page already reads
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryContentStore, type LocationRow } from "@/lib/db/content";
import { createInMemoryPlanStore, type JobRow } from "@/lib/db/itineraries";
import type { LinkPipelineDeps } from "@/lib/links/pipeline";
import { LinkUserError } from "@/lib/links/errors";
import type { LinkAnalysisResult } from "@/lib/links/types";
import {
  createInMemoryLocationStore,
  createInMemorySearchCache,
} from "@/lib/planner/retrieval";

import { linkRouteDeps } from "../deps";
import { signedIn } from "../session-fixture";
import { POST } from "./route";

const URL_UNDER_TEST = "https://www.tiktok.com/@someone/video/7123456789";
const NOW = new Date("2026-08-29T09:00:00Z");

function analysisResult(overrides: Partial<LinkAnalysisResult> = {}): LinkAnalysisResult {
  return {
    metadata: {
      url: URL_UNDER_TEST,
      platform: "tiktok",
      title: "cafes in canggu #bali",
      description: "",
      uploader: "someone",
      thumbnail: "https://cdn.example/thumb.jpg",
      durationSeconds: 43,
    },
    transcript: { text: "best cafes in canggu", durationSeconds: 43 },
    ocrLines: ["CRATE CAFE"],
    analysis: {
      isLocationRelated: true,
      generatedTitle: "Three Cafes in Canggu",
      summary: "A guide to three cafes in Canggu.",
      primaryCountry: "Indonesia",
      primaryRegion: "Bali",
      locations: ["Crate Cafe, Canggu, Indonesia"],
    },
    resolved: [
      {
        mention: "Crate Cafe, Canggu, Indonesia",
        place: { placeId: "crate-cafe", name: "Crate Cafe" } as never,
      },
    ],
    stats: {
      transcriptChars: 20,
      whisperAudioSeconds: 43,
      framesExtracted: 43,
      ocrBatches: 5,
      ocrBatchesFailed: 0,
      ocrLines: 1,
      locationsNamed: 1,
      locationsResolved: 1,
      photosResolved: 1,
      locationsDistinct: 1,
      failures: [],
      usage: [],
      timings: {
        metadataMs: 1,
        downloadMs: 1,
        transcriptionMs: 1,
        frameExtractMs: 1,
        ocrMs: 1,
        extractMs: 1,
        resolveMs: 1,
      },
    },
    ...overrides,
  };
}

interface HarnessOptions {
  /** What the injected pipeline does. Defaults to succeeding. */
  analyze?: (url: string, deps: LinkPipelineDeps) => Promise<LinkAnalysisResult>;
  signedOut?: boolean;
  /** Makes `linkRouteDeps.create` throw, as an unset env var would. */
  unconfigured?: boolean;
}

/** Enough of a `locations` row for the store to seat a place against. */
function locationRow(placeId: string): LocationRow {
  return {
    id: `loc-${placeId}`,
    place_id: placeId,
    name: "Crate Cafe",
    latitude: -8.65,
    longitude: 115.14,
    types: ["cafe"],
    primary_type: "cafe",
    rating: 4.6,
    user_rating_count: 900,
    price_level: null,
    price_range: null,
    formatted_address: "Canggu, Bali",
    city: "Bali",
    opening_periods: null,
    review_snippets: null,
    editorial_summary: null,
    review_summary: null,
    serves_vegetarian_food: null,
    shortlist_hydrated_at: null,
    photo_names: null,
    photo_urls: null,
    photos_resolved_at: null,
    business_status: null,
    google_maps_uri: null,
    stay_duration: null,
    fetched_at: NOW,
  } as LocationRow;
}

async function harness(options: HarnessOptions = {}) {
  const store = createInMemoryPlanStore();
  const content = createInMemoryContentStore({
    locations: { "crate-cafe": locationRow("crate-cafe") },
  });
  const session = await signedIn({ now: NOW });

  const analyze =
    options.analyze ?? (async () => analysisResult());
  const calls: { url: string }[] = [];

  linkRouteDeps.create = () => {
    if (options.unconfigured) throw new Error("RAPIDAPI_KEY is not set");
    return {
      store,
      users: session.users,
      content,
      analyzeLink: (async (url: string, pipelineDeps: LinkPipelineDeps) => {
        calls.push({ url });
        const result = await analyze(url, pipelineDeps);
        // The real pipeline reports as it goes, and the handler's progress
        // writes are part of what this file is testing.
        pipelineDeps.onStage?.("metadata");
        pipelineDeps.onStage?.("watching", result.metadata);
        return result;
      }) as never,
      media: {} as never,
      transcriber: {} as never,
      responses: {} as never,
      googleApiKey: "test-key",
      cache: createInMemorySearchCache(),
      locations: createInMemoryLocationStore(),
      now: () => NOW,
    };
  };

  return { store, content, session, calls };
}

/** Wraps a payload the way `createJob` does. A raw string is sent verbatim so
 *  the malformed-body case can still be exercised. */
function post(body: unknown, cookie?: string): Request {
  const wrapped =
    typeof body === "string" || body === undefined
      ? body
      : { type: "content-analysis", payload: body };
  return new Request("http://localhost/api/jobs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: typeof wrapped === "string" ? wrapped : JSON.stringify(wrapped),
  });
}

/** The background half is fire-and-forget, so tests wait on the row. */
async function settled(store: ReturnType<typeof createInMemoryPlanStore>, jobId: string) {
  await vi.waitFor(() => {
    const row = store.rows.get(jobId);
    expect(row?.status === "completed" || row?.status === "failed").toBe(true);
  });
  return store.rows.get(jobId) as JobRow;
}

const originalCreate = linkRouteDeps.create;
let networkFetch: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Nothing here may reach the real network.
  networkFetch = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  expect(networkFetch).not.toHaveBeenCalled();
  networkFetch.mockRestore();
  linkRouteDeps.create = originalCreate;
});

describe("POST /api/jobs", () => {
  it("answers 202 with the job row before the analysis has finished", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { store, session } = await harness({
      analyze: async () => {
        await blocked;
        return analysisResult();
      },
    });

    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;

    expect(response.status).toBe(202);
    // The string `/links` and `/home` already pass to `useJobsQueue`.
    expect(job.type).toBe("content-analysis");
    // The row exists and is not finished — the point of the whole design.
    expect(store.rows.get(job.id)?.status).not.toBe("completed");

    release?.();
    await settled(store, job.id);
  });

  it("records the URL it will actually analyze on the row", async () => {
    const { store, session, calls } = await harness();
    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;
    await settled(store, job.id);

    expect(job.payload).toMatchObject({ url: URL_UNDER_TEST });
    expect(calls[0].url).toBe(URL_UNDER_TEST);
  });

  it("walks the progress bar forward and lands on exactly 100", async () => {
    const { store, session } = await harness();
    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;
    const finished = await settled(store, job.id);

    expect(finished.status).toBe("completed");
    expect(finished.progress?.percent).toBe(100);
  });

  it("puts the video's thumbnail on the row and keeps it there", async () => {
    const { store, session } = await harness();
    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;
    const finished = await settled(store, job.id);

    // Held across stages: dropping it halfway makes the queue card flicker
    // back to a grey box.
    expect((finished.progress as { thumbnail?: string })?.thumbnail).toBe(
      "https://cdn.example/thumb.jpg",
    );
  });

  it("stores a result carrying the fields the links page already reads", async () => {
    const { store, session } = await harness();
    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;
    const finished = await settled(store, job.id);

    expect(finished.result).toMatchObject({
      url: URL_UNDER_TEST,
      // The model's title, not the platform's hashtag soup.
      title: "Three Cafes in Canggu",
      thumbnail: "https://cdn.example/thumb.jpg",
      content_type: "video",
      platform: "tiktok",
      creator: "someone",
      generated_summary: "A guide to three cafes in Canggu.",
      location_count: 1,
    });
  });

  it("stores places by id, not by value, because `locations` already holds the row", async () => {
    const { store, session } = await harness();
    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;
    const finished = await settled(store, job.id);

    const places = (finished.result as { places: unknown[] }).places;
    expect(places).toEqual([
      { mention: "Crate Cafe, Canggu, Indonesia", place_id: "crate-cafe", name: "Crate Cafe" },
    ]);
  });

  it("saves a content row and names it on the job result", async () => {
    const { store, content, session } = await harness();
    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;
    const finished = await settled(store, job.id);

    const contentId = (finished.result as { content_id: string }).content_id;
    expect(contentId).toEqual(expect.any(String));

    const detail = await content.readContentDetail(contentId, session.user.id);
    expect(detail).toMatchObject({
      content_url: URL_UNDER_TEST,
      content_title: "Three Cafes in Canggu",
      primary_region: "Bali",
    });
    expect(detail?.locations).toEqual([
      { mention: "Crate Cafe, Canggu, Indonesia", location: expect.objectContaining({ place_id: "crate-cafe" }) },
    ]);
  });

  it("completes with a null content_id when the row could not be written", async () => {
    const { store, content, session } = await harness();
    content.saveContent = async () => {
      throw new Error("postgres is down");
    };

    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;
    const finished = await settled(store, job.id);

    // The analysis is done and paid for. Losing the library entry is not worth
    // throwing the run away.
    expect(finished.status).toBe("completed");
    expect((finished.result as { content_id: string | null }).content_id).toBeNull();
  });

  it("answers 409 for a link this person already saved, and analyzes nothing", async () => {
    const { content, session, calls } = await harness();
    await content.saveContent(
      {
        content_url: URL_UNDER_TEST,
        content_title: "Saved earlier",
        content_thumbnail: null,
        content_author: null,
        platform: "tiktok",
        generated_summary: null,
        primary_country: null,
        primary_region: null,
        placeIds: [],
        mentions: {},
      },
      session.user.id,
      NOW,
    );

    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "already_analyzed",
      content: { content_title: "Saved earlier" },
    });
    expect(calls).toHaveLength(0);
  });

  it("matches a re-paste that carries tracking parameters", async () => {
    const { content, session } = await harness();
    await content.saveContent(
      {
        content_url: URL_UNDER_TEST,
        content_title: "Saved earlier",
        content_thumbnail: null,
        content_author: null,
        platform: "tiktok",
        generated_summary: null,
        primary_country: null,
        primary_region: null,
        placeIds: [],
        mentions: {},
      },
      session.user.id,
      NOW,
    );

    // The exact form the user pasted: the search that found it, and the
    // millisecond it was tapped.
    const response = await POST(
      post({ url: `${URL_UNDER_TEST}?q=cafe%20in%20bali&t=1787957482884` }, session.cookie),
    );

    expect(response.status).toBe(409);
  });

  // ── refusals ───────────────────────────────────────────────────────────────

  it("refuses an unsupported link with a 400 and leaves no row behind", async () => {
    const { store, session, calls } = await harness();
    const response = await POST(post({ url: "https://vimeo.com/12345" }, session.cookie));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("YouTube, TikTok and Instagram"),
    });
    // A dead queue card that only ever says "couldn't analyze this link" is
    // worse than an answer the caller can act on.
    expect(store.rows.size).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("refuses a missing or malformed body with a 400", async () => {
    const { session } = await harness();

    expect((await POST(post({}, session.cookie))).status).toBe(400);
    expect((await POST(post({ url: "" }, session.cookie))).status).toBe(400);
    expect((await POST(post("not json at all", session.cookie))).status).toBe(400);
  });

  it("refuses an anonymous request with a 401 and leaves no row behind", async () => {
    const { store } = await harness();
    const response = await POST(post({ url: URL_UNDER_TEST }));

    expect(response.status).toBe(401);
    expect(store.rows.size).toBe(0);
  });

  it("answers 503 when link analysis is not configured", async () => {
    await harness({ unconfigured: true });
    const response = await POST(post({ url: URL_UNDER_TEST }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining("unavailable") });
  });

  // ── failures ───────────────────────────────────────────────────────────────

  it("keeps a failure written for the reader, dynamic parts and all", async () => {
    const { store, session } = await harness({
      analyze: async () => {
        throw new LinkUserError("That video is 17 minutes long; the limit is 10.");
      },
    });

    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;
    const finished = await settled(store, job.id);

    expect(finished.status).toBe("failed");
    // No allowlist of literals could carry this: the number is part of it.
    expect(finished.error).toBe("That video is 17 minutes long; the limit is 10.");
  });

  it("never leaks a provider's own words", async () => {
    const { store, session } = await harness({
      analyze: async () => {
        throw new Error("RapidAPI 429 rate_limit_exceeded at /v1/social/autolink");
      },
    });

    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;
    const finished = await settled(store, job.id);

    expect(finished.status).toBe("failed");
    expect(finished.error).toBe("We couldn't analyze that link.");
    expect(finished.error).not.toContain("RapidAPI");
  });

  it("completes a run that degraded, because it still produced places", async () => {
    const { store, session } = await harness({
      analyze: async () =>
        analysisResult({
          transcript: { text: "", durationSeconds: 0 },
          stats: {
            ...analysisResult().stats,
            transcriptChars: 0,
            ocrBatchesFailed: 2,
            failures: ["No transcript: whisper is down", "2 of 5 OCR batches failed."],
          },
        }),
    });

    const response = await POST(post({ url: URL_UNDER_TEST }, session.cookie));
    const job = (await response.json()) as JobRow;
    const finished = await settled(store, job.id);

    // Degraded is not failed: the losses are on the record, and there are
    // still places to show.
    expect(finished.status).toBe("completed");
    expect((finished.result as { stats: { failures: string[] } }).stats.failures).toHaveLength(2);
  });
});
