import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  createInMemoryLocationStore,
  createInMemorySearchCache,
  type FetchLike,
} from "@/lib/planner/retrieval";
import type { ResponsesClient, ResponsesRequest, ResponsesResult } from "@/lib/planner/openai";

import { LinkUserError } from "./errors";
import type { DownloadedMedia, InspectedMedia, MediaSource } from "./media";
import { analyzeLink, type LinkPipelineDeps, type LinkStage } from "./pipeline";
import type { LinkAnalysis, LinkPlatform, Transcript } from "./types";

const URL_UNDER_TEST = "https://www.tiktok.com/@someone/video/7123456789";
const NOW = new Date("2026-08-29T09:00:00Z");

/** Real files on disk, because OCR reads them. The bytes never matter. */
let workDir = "";
let imagePaths: string[] = [];

beforeAll(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "pipeline-test-"));
  imagePaths = await Promise.all(
    Array.from({ length: 3 }, async (_, i) => {
      const file = path.join(workDir, `image_${i}.jpg`);
      await writeFile(file, `image ${i}`);
      return file;
    }),
  );
});

// ── the fakes ────────────────────────────────────────────────────────────────

function inspected(overrides: Partial<InspectedMedia> = {}): InspectedMedia {
  return {
    metadata: {
      url: URL_UNDER_TEST,
      platform: "tiktok",
      title: "cafes in canggu",
      description: "",
      uploader: "someone",
      thumbnail: "https://cdn.example/thumb.jpg",
      durationSeconds: 43,
    },
    videoUrls: ["https://cdn.example/video.mp4"],
    imageUrls: [],
    isImagePost: false,
    ...overrides,
  };
}

function fakeMedia(options: { media?: InspectedMedia; downloaded?: DownloadedMedia } = {}) {
  const source: MediaSource = {
    async inspect(_url: string, _platform: LinkPlatform) {
      return options.media ?? inspected();
    },
    async download() {
      return options.downloaded ?? { kind: "video", path: path.join(workDir, "video.mp4") };
    },
  };
  return source;
}

const analysis: LinkAnalysis = {
  isLocationRelated: true,
  generatedTitle: "Cafes in Canggu",
  summary: "Three cafes.",
  primaryCountry: "Indonesia",
  primaryRegion: "Bali",
  locations: ["Crate Cafe, Canggu, Indonesia"],
};

/** OCR calls carry images; the extraction call does not. That is how one fake
 *  client answers both without being told which is which. */
function fakeResponses(options: { ocrText?: string; ocrThrows?: boolean } = {}) {
  const requests: ResponsesRequest[] = [];
  const client: ResponsesClient = {
    async create(request): Promise<ResponsesResult> {
      requests.push(request);
      const parts = request.input[request.input.length - 1].content;
      const isOcr =
        Array.isArray(parts) && parts.some((part) => part.type === "input_image");

      if (isOcr) {
        if (options.ocrThrows) throw new Error("vision is down");
        return {
          output_text: JSON.stringify({
            frames: [{ index: 0, text: options.ocrText ?? "CRATE CAFE" }],
          }),
          usage: { input_tokens: 900, output_tokens: 20 },
          status: "completed",
        };
      }

      return {
        output_text: JSON.stringify(analysis),
        usage: { input_tokens: 1200, output_tokens: 150 },
        status: "completed",
      };
    },
  };
  return { client, requests };
}

function fakeGoogle() {
  return vi.fn<FetchLike>(async () => ({
    ok: true,
    status: 200,
    async text() { return ""; },
    async json() {
      return {
        places: [
          {
            id: "crate-cafe",
            displayName: { text: "Crate Cafe" },
            formattedAddress: "Canggu, Bali",
            location: { latitude: -8.65, longitude: 115.14 },
            types: ["cafe"],
            primaryType: "cafe",
          },
        ],
      };
    },
  }));
}

const transcript: Transcript = { text: "best cafes in canggu", durationSeconds: 43 };

function deps(overrides: Partial<LinkPipelineDeps> = {}): LinkPipelineDeps {
  const { client } = fakeResponses();
  return {
    media: fakeMedia(),
    transcriber: { async transcribe() { return transcript; } },
    responses: client,
    googleApiKey: "test-key",
    cache: createInMemorySearchCache(),
    store: createInMemoryLocationStore(),
    fetch: fakeGoogle(),
    now: () => NOW,
    workDir,
    sleep: async () => {},
    // Photos are the one thing billed per place. Stubbed so no test resolves
    // one, and asserted on explicitly below.
    resolvePhotos: async () => ({
      places: [],
      stats: {
        poolSize: 0,
        requested: 0,
        notInPool: 0,
        skippedNoNames: 0,
        skippedAlreadyResolved: 0,
        billedCalls: 0,
        blobHits: 0,
        resolved: 0,
        failures: [],
      },
    }),
    // ffmpeg never runs in a test. Both stand-ins return the fixture images.
    extractAudio: async () => path.join(workDir, "audio.mp3"),
    extractFrames: async () => imagePaths,
    ...overrides,
  };
}

// ── the tests ────────────────────────────────────────────────────────────────

describe("analyzeLink", () => {
  it("runs every stage and returns metadata, transcript, on-screen text and places", async () => {
    const stages: LinkStage[] = [];
    const result = await analyzeLink(URL_UNDER_TEST, deps({ onStage: (stage) => stages.push(stage) }));

    expect(stages).toEqual(["metadata", "download", "watching", "extracting", "resolving", "done"]);
    expect(result.metadata.title).toBe("cafes in canggu");
    expect(result.transcript.text).toBe("best cafes in canggu");
    expect(result.ocrLines).toEqual(["CRATE CAFE"]);
    expect(result.analysis?.generatedTitle).toBe("Cafes in Canggu");
    expect(result.resolved[0].place?.placeId).toBe("crate-cafe");
  });

  it("hands the thumbnail to the progress callback from the download stage on", async () => {
    const seen: (string | undefined)[] = [];
    await analyzeLink(
      URL_UNDER_TEST,
      deps({ onStage: (_stage, metadata) => seen.push(metadata?.thumbnail) }),
    );

    // The very first call has no metadata yet; every later one does.
    expect(seen[0]).toBeUndefined();
    expect(seen.slice(1).every((thumb) => thumb === "https://cdn.example/thumb.jpg")).toBe(true);
  });

  it("counts a distinct venue once even when the model named it twice", async () => {
    const { client } = fakeResponses();
    const twiceNamed: ResponsesClient = {
      async create(request) {
        const parts = request.input[request.input.length - 1].content;
        if (Array.isArray(parts) && parts.some((part) => part.type === "input_image")) {
          return client.create(request);
        }
        return {
          output_text: JSON.stringify({
            ...analysis,
            locations: ["Crate Cafe, Canggu, Indonesia", "Crate, Canggu, Indonesia"],
          }),
          usage: { input_tokens: 100, output_tokens: 10 },
          status: "completed",
        };
      },
    };

    const result = await analyzeLink(URL_UNDER_TEST, deps({ responses: twiceNamed }));

    expect(result.stats.locationsResolved).toBe(2);
    expect(result.stats.locationsDistinct).toBe(1);
  });

  // ── the guards ─────────────────────────────────────────────────────────────

  it("refuses a link it will not touch before spending anything", async () => {
    const media = fakeMedia();
    const inspect = vi.spyOn(media, "inspect");

    await expect(analyzeLink("https://vimeo.com/1", deps({ media }))).rejects.toThrow(LinkUserError);
    expect(inspect).not.toHaveBeenCalled();
  });

  /**
   * Mutation-checked. The cap sits between `inspect` and `download` on purpose:
   * a seventeen-minute video costs one cheap metadata call and no bandwidth,
   * no Whisper minute and no vision calls.
   */
  it("refuses a video past the duration cap, after metadata and before download", async () => {
    const media = fakeMedia({
      media: inspected({
        metadata: { ...inspected().metadata, durationSeconds: 1_012 },
      }),
    });
    const download = vi.spyOn(media, "download");

    await expect(
      analyzeLink(URL_UNDER_TEST, deps({ media, maxDurationSeconds: 600 })),
    ).rejects.toThrow(/17 minutes long; the limit is 10/);
    expect(download).not.toHaveBeenCalled();
  });

  /**
   * Argo's `analyzeVideo` re-throws when either half rejects, so one bad vision
   * call loses the transcript beside it and fails the whole job. Mutation-check
   * this by rethrowing `seen.reason`.
   */
  it("ships a result when every OCR call fails, and counts the batches", async () => {
    const { client } = fakeResponses({ ocrThrows: true });
    const result = await analyzeLink(URL_UNDER_TEST, deps({ responses: client }));

    expect(result.analysis).not.toBeNull();
    expect(result.ocrLines).toEqual([]);
    // The vision calls failing is a counted loss inside a stage that still
    // returns — different from the stage itself dying, below.
    expect(result.stats.ocrBatchesFailed).toBe(1);
    expect(result.stats.failures.join(" ")).toContain("OCR batches failed");
    // The transcript survived, which is the entire point.
    expect(result.transcript.text).toBe("best cafes in canggu");
  });

  it("ships a result when frame extraction itself dies", async () => {
    const result = await analyzeLink(
      URL_UNDER_TEST,
      deps({
        extractFrames: async () => {
          throw new Error("ffmpeg exited 1");
        },
      }),
    );

    expect(result.analysis).not.toBeNull();
    expect(result.ocrLines).toEqual([]);
    // Nothing was even attempted, so there are no batches to have failed.
    expect(result.stats.ocrBatches).toBe(0);
    expect(result.stats.failures.join(" ")).toContain("No on-screen text");
  });

  it("ships a result when transcription dies, on the on-screen text alone", async () => {
    const result = await analyzeLink(
      URL_UNDER_TEST,
      deps({
        transcriber: {
          async transcribe() {
            throw new Error("whisper is down");
          },
        },
      }),
    );

    expect(result.analysis).not.toBeNull();
    expect(result.ocrLines).toEqual(["CRATE CAFE"]);
    expect(result.stats.failures.join(" ")).toContain("No transcript");
  });

  it("says plainly when it lost both, rather than leaving two zeros to be joined up", async () => {
    const { client } = fakeResponses({ ocrThrows: true });
    const result = await analyzeLink(
      URL_UNDER_TEST,
      deps({
        responses: client,
        transcriber: {
          async transcribe() {
            throw new Error("whisper is down");
          },
        },
      }),
    );

    expect(result.stats.failures.join(" ")).toContain("Neither audio nor on-screen text");
  });

  // ── slideshows ─────────────────────────────────────────────────────────────

  it("reads a slideshow's own pictures as its frames and never looks for audio", async () => {
    const transcribe = vi.fn(async () => transcript);
    const extractAudio = vi.fn(async () => path.join(workDir, "audio.mp3"));
    const extractFrames = vi.fn(async () => imagePaths);

    const result = await analyzeLink(
      URL_UNDER_TEST,
      deps({
        media: fakeMedia({
          media: inspected({ videoUrls: [], imageUrls: ["a", "b", "c"], isImagePost: true }),
          downloaded: { kind: "images", paths: imagePaths },
        }),
        transcriber: { transcribe },
        extractAudio,
        extractFrames,
      }),
    );

    expect(transcribe).not.toHaveBeenCalled();
    expect(extractAudio).not.toHaveBeenCalled();
    // ffmpeg has nothing to sample: the images already are the frames.
    expect(extractFrames).not.toHaveBeenCalled();
    expect(result.stats.framesExtracted).toBe(3);
    expect(result.ocrLines).toEqual(["CRATE CAFE"]);
  });

  it("does not call a silent slideshow a failure — it never had audio to lose", async () => {
    const result = await analyzeLink(
      URL_UNDER_TEST,
      deps({
        media: fakeMedia({
          media: inspected({ videoUrls: [], imageUrls: ["a"], isImagePost: true }),
          downloaded: { kind: "images", paths: imagePaths },
        }),
      }),
    );

    expect(result.stats.failures.join(" ")).not.toContain("No transcript");
    expect(result.stats.failures.join(" ")).not.toContain("Neither audio");
  });

  // ── reporting ──────────────────────────────────────────────────────────────

  it("resolves a photo for each place it found, and for nothing else", async () => {
    const asked: string[][] = [];
    await analyzeLink(
      URL_UNDER_TEST,
      deps({
        resolvePhotos: async (_pool, survivorIds) => {
          asked.push([...survivorIds]);
          return {
            places: [],
            stats: {
              poolSize: 1,
              requested: survivorIds.length,
              notInPool: 0,
              skippedNoNames: 0,
              skippedAlreadyResolved: 0,
              billedCalls: survivorIds.length,
              blobHits: 0,
              resolved: survivorIds.length,
              failures: [],
            },
          };
        },
      }),
    );

    // The places that resolved, never the wider pool — this is the only thing
    // in the pipeline billed per place rather than per run.
    expect(asked).toEqual([["crate-cafe"]]);
  });

  it("buys no photos when nothing resolved", async () => {
    const resolvePhotos = vi.fn();
    const broken: ResponsesClient = {
      async create(request) {
        const parts = request.input[request.input.length - 1].content;
        if (Array.isArray(parts) && parts.some((part) => part.type === "input_image")) {
          return { output_text: '{"frames":[]}', usage: {}, status: "completed" };
        }
        return {
          output_text: JSON.stringify({ ...analysis, isLocationRelated: false, locations: [] }),
          usage: {},
          status: "completed",
        };
      },
    };

    await analyzeLink(URL_UNDER_TEST, deps({ responses: broken, resolvePhotos: resolvePhotos as never }));
    expect(resolvePhotos).not.toHaveBeenCalled();
  });

  it("still ships the places when photo resolution throws", async () => {
    const result = await analyzeLink(
      URL_UNDER_TEST,
      deps({
        resolvePhotos: async () => {
          throw new Error("photos are down");
        },
      }),
    );

    // A place with no picture is a card with a grey box, not a lost link.
    expect(result.resolved[0].place?.placeId).toBe("crate-cafe");
    expect(result.stats.photosResolved).toBe(0);
    expect(result.stats.failures.join(" ")).toContain("No photos");
  });

  it("reports the OCR and extraction spend separately", async () => {
    const result = await analyzeLink(URL_UNDER_TEST, deps());
    const stages = result.stats.usage.map((entry) => entry.stage);

    expect(stages).toContain("ocr");
    expect(stages).toContain("link-extract");
  });

  it("omits retrieval stats when the extraction produced nothing to look up", async () => {
    const broken: ResponsesClient = {
      async create(request) {
        const parts = request.input[request.input.length - 1].content;
        if (Array.isArray(parts) && parts.some((part) => part.type === "input_image")) {
          return { output_text: '{"frames":[]}', usage: {}, status: "completed" };
        }
        return { output_text: "not json", usage: {}, status: "completed" };
      },
    };

    const result = await analyzeLink(URL_UNDER_TEST, deps({ responses: broken }));

    expect(result.analysis).toBeNull();
    expect(result.stats.retrieval).toBeUndefined();
    expect(result.stats.failures.join(" ")).toContain("not JSON");
  });
});
