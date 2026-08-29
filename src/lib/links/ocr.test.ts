import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import type { ResponsesClient, ResponsesRequest, ResponsesResult } from "@/lib/planner/openai";

import { deduplicateLines, runFrameOcr } from "./ocr";

/** The bytes are never looked at — the fake client ignores the images — so the
 *  files only need to exist for `readFile` to succeed. */
let frames: string[] = [];

beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ocr-test-"));
  frames = await Promise.all(
    Array.from({ length: 25 }, async (_, i) => {
      const file = path.join(dir, `frame_${String(i).padStart(4, "0")}.jpg`);
      await writeFile(file, `frame ${i}`);
      return file;
    }),
  );
});

interface FakeOptions {
  /** Text per batch, by batch index. */
  textFor?: (batchIndex: number) => string[];
  /** Batch indices that reject outright. */
  throwOn?: number[];
  /** Batch indices that come back `incomplete`. */
  truncateOn?: number[];
  /** Batch indices that answer with something unparseable. */
  garbageOn?: number[];
}

/**
 * Which batch a request is, read off its own images.
 *
 * Not the call count: batches run four at a time and `withBackoff` retries a
 * thrown one twice, so arrival order says nothing about which batch arrived.
 * Every fixture frame contains the text `frame <n>`, so the first image in a
 * request identifies the batch it belongs to — stable under both.
 */
function batchIndexOf(request: ResponsesRequest, batchSize: number): number {
  const parts = request.input[0].content as { type: string; image_url?: string }[];
  const first = parts.find((part) => part.type === "input_image");
  const bytes = Buffer.from((first?.image_url ?? "").split(",")[1] ?? "", "base64").toString();
  return Math.floor(Number(bytes.replace("frame ", "")) / batchSize);
}

function fakeClient(
  options: FakeOptions = {},
  batchSize = 10,
): ResponsesClient & { requests: ResponsesRequest[] } {
  const requests: ResponsesRequest[] = [];
  return {
    requests,
    async create(request): Promise<ResponsesResult> {
      requests.push(request);
      const index = batchIndexOf(request, batchSize);

      // Retries land here too, so a batch told to throw throws every time —
      // which is what makes `batchesFailed` mean "gave up", not "flaked once".
      if (options.throwOn?.includes(index)) throw new Error("boom");

      const usage = { input_tokens: 100, output_tokens: 10 };
      if (options.garbageOn?.includes(index)) return { output_text: "not json", usage };
      if (options.truncateOn?.includes(index)) {
        return {
          output_text: '{"frames":[{"index":0,"text":"cut off',
          usage,
          status: "incomplete",
          incompleteReason: "max_output_tokens",
        };
      }

      const texts = options.textFor?.(index) ?? [`batch ${index} text`];
      return {
        output_text: JSON.stringify({
          frames: texts.map((text, i) => ({ index: i, text })),
        }),
        usage,
        status: "completed",
      };
    },
  };
}

const noSleep = async () => {};

describe("runFrameOcr", () => {
  it("splits frames into batches and makes one call per batch", async () => {
    const client = fakeClient();
    const result = await runFrameOcr(frames, { responses: client, batchSize: 10, sleep: noSleep });

    // 25 frames at 10 per batch is 10 + 10 + 5.
    expect(client.requests).toHaveLength(3);
    expect(result.batches).toBe(3);
    expect(result.framesRead).toBe(25);

    // Sorted for the same reason as the prompt assertion below: four batches
    // run at a time, so the order they arrive in is not the order they were cut.
    const images = client.requests
      .map(
        (request) =>
          (request.input[0].content as { type: string }[]).filter(
            (part) => part.type === "input_image",
          ).length,
      )
      .sort((a, b) => b - a);
    expect(images).toEqual([10, 10, 5]);
  });

  it("sends every frame at `detail: low` by default, which is what fixes the price", async () => {
    const client = fakeClient();
    await runFrameOcr(frames.slice(0, 3), { responses: client, sleep: noSleep });

    const parts = client.requests[0].input[0].content as { type: string; detail?: string }[];
    const imageParts = parts.filter((part) => part.type === "input_image");
    expect(imageParts).toHaveLength(3);
    expect(imageParts.every((part) => part.detail === "low")).toBe(true);
  });

  it("asks each batch to number from zero rather than rewriting the prompt", async () => {
    const client = fakeClient();
    await runFrameOcr(frames, { responses: client, batchSize: 10, sleep: noSleep });

    // Sorted, not indexed: batches run four at a time, so arrival order is not
    // batch order. Asserting on `prompts[2]` passed by luck until a busier run
    // reordered them.
    const prompts = client.requests
      .map((request) => (request.input[0].content as { type: string; text?: string }[])[0].text ?? "")
      .sort();

    // Every batch counts from zero. Argo regex-rewrote the true index range
    // into each prompt; nothing downstream reads it, so nothing sends it.
    expect(prompts.every((prompt) => prompt.includes("from 0 for the first frame"))).toBe(true);

    // Two full batches of ten and one of five — the last batch is told its own
    // size, which is the only thing that differs.
    expect(prompts.filter((prompt) => prompt.includes("to 9 for the last"))).toHaveLength(2);
    expect(prompts.filter((prompt) => prompt.includes("to 4 for the last"))).toHaveLength(1);
  });

  it("keeps one copy of a line a caption repeats across frames", async () => {
    const client = fakeClient({
      textFor: () => ["Lau Pa Sat", "LAU PA SAT", "  lau pa sat  ", "Maxwell Food Centre"],
    }, 10);
    const result = await runFrameOcr(frames.slice(0, 10), { responses: client, sleep: noSleep });

    // First spelling wins: the model's casing is usually the sign's casing.
    expect(result.lines).toEqual(["Lau Pa Sat", "Maxwell Food Centre"]);
    expect(result.framesWithText).toBe(4);
  });

  /**
   * The guard the pipeline's whole "degrade, do not die" promise rests on.
   * Mutation-checked: making a failed batch rethrow turns this red.
   */
  it("counts a failed batch and still returns what the other batches read", async () => {
    const client = fakeClient({
      throwOn: [1],
      textFor: (index) => [`text from batch ${index}`],
    });
    const result = await runFrameOcr(frames, {
      responses: client,
      batchSize: 10,
      sleep: noSleep,
    });

    expect(result.batchesFailed).toBe(1);
    expect(result.batches).toBe(3);
    expect(result.lines).toEqual(["text from batch 0", "text from batch 2"]);
  });

  it("treats a truncated response and unparseable text as failures, not as empty frames", async () => {
    const truncated = await runFrameOcr(frames.slice(0, 10), {
      responses: fakeClient({ truncateOn: [0] }, 10),
      sleep: noSleep,
    });
    expect(truncated.batchesFailed).toBe(1);
    expect(truncated.lines).toEqual([]);

    const garbage = await runFrameOcr(frames.slice(0, 10), {
      responses: fakeClient({ garbageOn: [0] }, 10),
      sleep: noSleep,
    });
    expect(garbage.batchesFailed).toBe(1);
    expect(garbage.lines).toEqual([]);
  });

  it("bills a batch that came back unusable, because it was still generated", async () => {
    const result = await runFrameOcr(frames.slice(0, 10), {
      responses: fakeClient({ garbageOn: [0] }, 10),
      sleep: noSleep,
    });

    // Costing only the usable answers would make a bad run look cheap.
    expect(result.usage.calls).toBe(1);
    expect(result.usage.inputTokens).toBe(100);
  });

  it("asks nothing at all when there are no frames", async () => {
    const client = fakeClient();
    const result = await runFrameOcr([], { responses: client, sleep: noSleep });

    expect(client.requests).toHaveLength(0);
    expect(result).toMatchObject({ lines: [], batches: 0, framesRead: 0 });
    expect(result.usage.calls).toBe(0);
  });
});

describe("deduplicateLines", () => {
  it("drops single characters, which are watermark noise rather than text", () => {
    expect(deduplicateLines(["a", "ok", "  ", "Lau Pa Sat"])).toEqual(["ok", "Lau Pa Sat"]);
  });

  it("preserves first-seen order", () => {
    expect(deduplicateLines(["second", "first", "second"])).toEqual(["second", "first"]);
  });
});
