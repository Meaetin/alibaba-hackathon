/**
 * `POST /api/jobs/[id]/retry`, driven through the real handler with fake ports.
 *
 * The same seam as `route.post.test.ts` one directory up: no RapidAPI, no
 * ffmpeg, no Whisper, no OpenAI, no Google, no Postgres, and the pipeline, the
 * progress arithmetic and the reset are all the production ones.
 *
 * What this file holds:
 *
 *   1. a failed job runs again on **its own id**, so the card the traveller
 *      clicked is the card that starts moving
 *   2. the row is reset — the bar goes back to the start and the failure's
 *      words are gone — while the poster frame stays, including across the new
 *      run's first progress write
 *   3. a job that finished, and a job that is genuinely still running, are
 *      refused without billing anybody
 *   4. a job long past its last progress write may be retried, which is the
 *      only reason the card offers the button on an in-flight job
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInMemoryContentStore } from "@/lib/db/content";
import { createInMemoryPlanStore, type JobRow, type JobStatus } from "@/lib/db/itineraries";
import { LINK_JOB_TYPE, type LinkPipelineDeps } from "@/lib/links/pipeline";
import { LINK_STUCK_MS } from "@/lib/links/progress";
import type { LinkAnalysisResult } from "@/lib/links/types";
import {
  createInMemoryLocationStore,
  createInMemorySearchCache,
} from "@/lib/planner/retrieval";

import { linkRouteDeps } from "../../../deps";
import { signedIn } from "../../../session-fixture";
import { POST } from "./route";

const URL_UNDER_TEST = "https://www.tiktok.com/@someone/video/7123456789";
const NOW = new Date("2026-08-29T09:00:00Z");

function analysisResult(): LinkAnalysisResult {
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
      locations: [],
    },
    resolved: [],
    stats: {
      transcriptChars: 20,
      whisperAudioSeconds: 43,
      framesExtracted: 43,
      ocrBatches: 5,
      ocrBatchesFailed: 0,
      ocrLines: 1,
      locationsNamed: 0,
      locationsResolved: 0,
      photosResolved: 0,
      locationsDistinct: 0,
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
  };
}

interface HarnessOptions {
  /** What the injected pipeline does once it has reported its first stage.
   *  Lets a test read the row while the run is still in the metadata stage. */
  duringMetadata?: () => Promise<void>;
  /** How the job under test is left before the retry. */
  job?: {
    type?: string;
    status?: JobStatus;
    /** How long before `NOW` the row last had a progress write. */
    silentForMs?: number;
    thumbnail?: string;
    url?: string;
  };
  signedOut?: boolean;
}

async function harness(options: HarnessOptions = {}) {
  const store = createInMemoryPlanStore();
  const content = createInMemoryContentStore();
  const session = await signedIn({ now: NOW });
  const calls: { url: string }[] = [];

  const job = await store.createJob({
    type: options.job?.type ?? LINK_JOB_TYPE,
    payload: { url: options.job?.url ?? URL_UNDER_TEST },
    now: NOW,
  });

  const spec = options.job ?? {};
  const lastWrite = new Date(NOW.getTime() - (spec.silentForMs ?? 0));
  await store.updateJob(
    job.id,
    {
      status: spec.status ?? "failed",
      error: spec.status === "failed" || !spec.status ? "That video is private." : null,
      progress: {
        percent: 62,
        label: "Watching and listening",
        stage: "watching",
        done: 2,
        total: 5,
        fired_at: lastWrite.toISOString(),
        ...(spec.thumbnail === undefined ? {} : { thumbnail: spec.thumbnail }),
      } as never,
    },
    lastWrite,
  );

  linkRouteDeps.create = () => ({
    store,
    users: session.users,
    content,
    analyzeLink: (async (url: string, pipelineDeps: LinkPipelineDeps) => {
      calls.push({ url });
      const result = analysisResult();
      // The real pipeline reports the metadata stage *before* RapidAPI answers,
      // so at this point the run has no thumbnail of its own — which is the
      // whole case the seeded one covers.
      pipelineDeps.onStage?.("metadata");
      if (options.duringMetadata) await options.duringMetadata();
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
  });

  return { store, content, session, calls, job };
}

function retry(id: string, cookie?: string): Request {
  return new Request(`http://localhost/api/jobs/${id}/retry`, {
    method: "POST",
    headers: cookie ? { Cookie: cookie } : undefined,
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
  networkFetch = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  expect(networkFetch).not.toHaveBeenCalled();
  networkFetch.mockRestore();
  linkRouteDeps.create = originalCreate;
});

describe("POST /api/jobs/[id]/retry", () => {
  it("runs the failed job again on the same id and answers 202", async () => {
    const { store, session, calls, job } = await harness();

    const response = await POST(retry(job.id, session.cookie), {
      params: Promise.resolve({ id: job.id }),
    });
    const reset = (await response.json()) as JobRow;

    expect(response.status).toBe(202);
    // The same row, not a second one: the card is already polling this id.
    expect(reset.id).toBe(job.id);
    expect(calls).toEqual([{ url: URL_UNDER_TEST }]);

    const finished = await settled(store, job.id);
    expect(finished.status).toBe("completed");
    expect(finished.progress?.percent).toBe(100);
  });

  it("hands back a row the progress bar reads as back at the start", async () => {
    const { session, job } = await harness();

    const response = await POST(retry(job.id, session.cookie), {
      params: Promise.resolve({ id: job.id }),
    });
    const reset = (await response.json()) as JobRow;

    // `useProgressAnimation` refuses to walk backwards while a job is
    // processing, so a retry stamped `processing` would leave the bar parked on
    // the percentage the failure died at. Queued is what resets it.
    expect(reset.status).toBe("queued");
    expect(reset.progress?.percent).toBe(0);
  });

  it("clears the failure's words", async () => {
    const { session, job } = await harness();

    const response = await POST(retry(job.id, session.cookie), {
      params: Promise.resolve({ id: job.id }),
    });
    const reset = (await response.json()) as JobRow;

    expect(reset.error).toBeNull();
  });

  it("keeps the poster frame while the new run has none of its own", async () => {
    let release: (() => void) | undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { store, session, job } = await harness({
      job: { thumbnail: "https://cdn.example/old.jpg" },
      duringMetadata: () => blocked,
    });

    const response = await POST(retry(job.id, session.cookie), {
      params: Promise.resolve({ id: job.id }),
    });
    const reset = (await response.json()) as JobRow;

    // Otherwise the card the traveller is watching blanks to a grey box for the
    // two seconds it takes RapidAPI to answer again.
    expect((reset.progress as { thumbnail?: string })?.thumbnail).toBe(
      "https://cdn.example/old.jpg",
    );

    // And it must survive the new run's first progress write, which happens
    // before that answer arrives.
    await vi.waitFor(() => {
      expect(store.rows.get(job.id)?.status).toBe("processing");
    });
    expect((store.rows.get(job.id)?.progress as { thumbnail?: string })?.thumbnail).toBe(
      "https://cdn.example/old.jpg",
    );

    release?.();
    await settled(store, job.id);
  });

  it("retries a job that has been silent for longer than a run can take", async () => {
    // The card offers the button on an in-flight job for exactly this case: the
    // process that was running it is gone, so nothing will ever finish the row.
    const { store, session, calls, job } = await harness({
      job: { status: "processing", silentForMs: LINK_STUCK_MS + 1000 },
    });

    const response = await POST(retry(job.id, session.cookie), {
      params: Promise.resolve({ id: job.id }),
    });

    expect(response.status).toBe(202);
    expect(calls).toHaveLength(1);
    await settled(store, job.id);
  });

  // ── refusals ───────────────────────────────────────────────────────────────

  it("refuses a job that is genuinely still running, and analyzes nothing", async () => {
    const { session, calls, job } = await harness({
      job: { status: "processing", silentForMs: 4_000 },
    });

    const response = await POST(retry(job.id, session.cookie), {
      params: Promise.resolve({ id: job.id }),
    });

    // Two pipelines on one row fight over the bar and can save the library
    // entry twice.
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "That link is still being analyzed.",
    });
    expect(calls).toHaveLength(0);
  });

  it("refuses a job that already finished, and analyzes nothing", async () => {
    // Silent for longer than a run can take, so the "still running" rung cannot
    // be what refuses it — and the message is asserted for the same reason.
    // Both refusals are 409s, and a test that cannot tell them apart passes
    // whichever one fires.
    const { session, calls, job } = await harness({
      job: { status: "completed", silentForMs: LINK_STUCK_MS + 1000 },
    });

    const response = await POST(retry(job.id, session.cookie), {
      params: Promise.resolve({ id: job.id }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: "That link has already been analyzed.",
    });
    expect(calls).toHaveLength(0);
  });

  it("does not know how to retry a planning job", async () => {
    const { session, calls, job } = await harness({ job: { type: "itinerary-planning" } });

    const response = await POST(retry(job.id, session.cookie), {
      params: Promise.resolve({ id: job.id }),
    });

    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("answers 404 for an id that names nothing", async () => {
    const { session, calls } = await harness();

    const response = await POST(
      retry("00000000-0000-4000-8000-999999999999", session.cookie),
      { params: Promise.resolve({ id: "00000000-0000-4000-8000-999999999999" }) },
    );

    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it("refuses an anonymous caller, because a retry spends money", async () => {
    const { calls, job } = await harness();

    const response = await POST(retry(job.id), {
      params: Promise.resolve({ id: job.id }),
    });

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it("refuses a stored URL this app would no longer accept", async () => {
    const { session, calls, job } = await harness({ job: { url: "https://vimeo.com/12345" } });

    const response = await POST(retry(job.id, session.cookie), {
      params: Promise.resolve({ id: job.id }),
    });

    expect(response.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});
