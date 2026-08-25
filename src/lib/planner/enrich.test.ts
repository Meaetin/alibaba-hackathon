import { describe, expect, it, vi } from "vitest";

import {
  MAX_VISIT_MINUTES,
  MIN_VISIT_MINUTES,
  clampVisitMinutes,
  collectEnrichmentBatch,
  createInMemoryEnrichmentStore,
  enrichmentSourceHash,
  readEnrichments,
  submitEnrichmentBatch,
  toEnrichmentSubject,
  type EnrichmentSubject,
  type StoredEnrichment,
} from "./enrich";
import { MODELS, PROMPT_VERSIONS, type BatchClient, type BatchHandle } from "./openai";
import { resolveVisitDuration } from "./duration";
import type { CandidatePlace } from "./types";

const NOW = new Date("2026-08-24T09:00:00Z");
const LATER = new Date("2026-12-01T09:00:00Z");

// ── fixtures ─────────────────────────────────────────────────────────────────

function subject(placeId: string, overrides: Partial<EnrichmentSubject> = {}): EnrichmentSubject {
  return {
    placeId,
    name: `Place ${placeId}`,
    types: ["tourist_attraction"],
    rating: 4.5,
    userRatingCount: 1200,
    reviewSnippets: [{ rating: 5, text: "Lovely at sunset." }],
    editorialSummary: "A landmark.",
    reviewSummary: undefined,
    ...overrides,
  };
}

/** A cached row that is fresh on all four fields for `place`. */
function fresh(place: EnrichmentSubject, overrides: Partial<StoredEnrichment> = {}): StoredEnrichment {
  return {
    placeId: place.placeId,
    description: `About ${place.name}.`,
    tags: ["scenic"],
    confidence: 0.8,
    avgVisitMinutes: [45, 90],
    model: MODELS.enrich,
    promptVersion: PROMPT_VERSIONS.enrich,
    sourceHash: enrichmentSourceHash(place),
    expiresAt: LATER,
    ...overrides,
  };
}

/** The model's structured answer, as JSON text. */
function outputJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    description: "A quiet garden with a long approach path.",
    tags: ["quiet", "outdoor-seating"],
    confidence: 0.7,
    visitMinutesMin: 45,
    visitMinutesMax: 75,
    signatureDishes: [],
    bestTimeOfDay: "morning",
    crowdProfile: "quiet",
    ...overrides,
  });
}

/** One line of a Batch output file, in the shape the API actually returns:
 *  the raw Responses body, where the text lives in `output[].content[]`. */
function outputLine(placeId: string, json: string): string {
  return JSON.stringify({
    id: `batch_req_${placeId}`,
    custom_id: placeId,
    response: {
      status_code: 200,
      body: {
        id: `resp_${placeId}`,
        output: [{ type: "message", content: [{ type: "output_text", text: json }] }],
      },
    },
    error: null,
  });
}

/**
 * A fake Batch API. Holds uploaded bodies in a Map, hands back whatever output
 * JSONL the test supplies, and records every call so a test can assert that the
 * cache path issued none.
 */
function fakeBatchClient(
  options: {
    status?: string;
    output?: string;
    /** The batch's **error** file — the requests the provider never ran. */
    errorFile?: string;
    errorOnCreate?: boolean;
    /** File ids whose download throws, so a partial failure is expressible. */
    downloadFailures?: readonly string[];
  } = {},
) {
  const uploads = new Map<string, string>();
  const calls = { upload: 0, create: 0, retrieve: 0, download: 0 };
  const downloaded: string[] = [];
  const handle: BatchHandle = {
    id: "batch_1",
    status: options.status ?? "completed",
    outputFileId: options.output === undefined ? undefined : "file_out",
    errorFileId: options.errorFile === undefined ? undefined : "file_err",
  };
  const client: BatchClient = {
    async uploadJsonl(body, filename) {
      calls.upload += 1;
      uploads.set(filename, body);
      return "file_in";
    },
    async create() {
      calls.create += 1;
      if (options.errorOnCreate) throw new Error("batches.create 500");
      return handle;
    },
    async retrieve() {
      calls.retrieve += 1;
      return handle;
    },
    async downloadJsonl(fileId) {
      calls.download += 1;
      downloaded.push(fileId);
      if (options.downloadFailures?.includes(fileId)) throw new Error(`${fileId} is gone`);
      return (fileId === "file_err" ? options.errorFile : options.output) ?? "";
    },
  };
  return { client, uploads, calls, downloaded };
}

/** One line of a Batch **error** file: no response body, just a reason. */
function errorLine(placeId: string, code = "rate_limit_exceeded"): string {
  return JSON.stringify({
    id: `batch_req_${placeId}`,
    custom_id: placeId,
    response: null,
    error: { code, message: "Too many requests for this model." },
  });
}

function uploadedLines(uploads: Map<string, string>) {
  const body = [...uploads.values()][0] ?? "";
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, any>);
}

// ── the read path: all four freshness fields ─────────────────────────────────

describe("readEnrichments freshness", () => {
  const place = subject("p1");

  it("returns the cached row when all four fields agree, and calls no batch API", async () => {
    const batches = fakeBatchClient();
    const store = createInMemoryEnrichmentStore([fresh(place)]);

    const result = await readEnrichments(["p1"], { store, pool: [place], now: NOW });

    expect(result.misses).toEqual([]);
    expect(result.enrichments.get("p1")?.description).toBe("About Place p1.");
    expect(result.stats.hits).toBe(1);
    expect(batches.calls).toEqual({ upload: 0, create: 0, retrieve: 0, download: 0 });
  });

  it("misses on a row whose expires_at has passed", async () => {
    const store = createInMemoryEnrichmentStore([
      fresh(place, { expiresAt: new Date("2026-08-24T08:59:59Z") }),
    ]);

    const result = await readEnrichments(["p1"], { store, pool: [place], now: NOW });

    expect(result.misses).toEqual(["p1"]);
    expect(result.enrichments.size).toBe(0);
    expect(result.stats.expired).toBe(1);
  });

  it("misses on a row written by a different model", async () => {
    const store = createInMemoryEnrichmentStore([fresh(place, { model: "gpt-4o-mini" })]);

    const result = await readEnrichments(["p1"], { store, pool: [place], now: NOW });

    expect(result.misses).toEqual(["p1"]);
    expect(result.stats.staleModel).toBe(1);
  });

  /** The bug the design doc names by hand: the row is fresh, the model matches,
   *  and it answers a question we stopped asking. */
  it("misses on a row written by an older prompt version", async () => {
    const store = createInMemoryEnrichmentStore([
      fresh(place, { promptVersion: PROMPT_VERSIONS.enrich - 1 }),
    ]);

    const result = await readEnrichments(["p1"], { store, pool: [place], now: NOW });

    expect(result.misses).toEqual(["p1"]);
    expect(result.stats.stalePromptVersion).toBe(1);
  });

  it("misses when the reviews the answer was written from have changed", async () => {
    const store = createInMemoryEnrichmentStore([fresh(place)]);
    const rewritten = subject("p1", {
      reviewSnippets: [{ rating: 2, text: "Under scaffolding all summer." }],
    });

    const result = await readEnrichments(["p1"], { store, pool: [rewritten], now: NOW });

    expect(result.misses).toEqual(["p1"]);
    expect(result.stats.staleSourceHash).toBe(1);
    // The other three are untouched, so the stats say which field went stale.
    expect(result.stats.expired).toBe(0);
    expect(result.stats.staleModel).toBe(0);
    expect(result.stats.stalePromptVersion).toBe(0);
  });

  it("changes the hash when the summaries change, not only the reviews", () => {
    const withSummary = subject("p1", { reviewSummary: "Reviewers call it serene." });
    expect(enrichmentSourceHash(withSummary)).not.toBe(enrichmentSourceHash(place));
  });

  it("hashes the same subject to the same digest across calls", () => {
    expect(enrichmentSourceHash(subject("p1"))).toBe(enrichmentSourceHash(subject("p1")));
  });
});

// ── the read path: a miss must not block ─────────────────────────────────────

describe("readEnrichments degradation", () => {
  it("returns the hits, reports the misses, and does not throw", async () => {
    const hit = subject("hit");
    const miss = subject("miss");
    const store = createInMemoryEnrichmentStore([fresh(hit)]);

    const result = await readEnrichments(["hit", "miss"], {
      store,
      pool: [hit, miss],
      now: NOW,
    });

    expect([...result.enrichments.keys()]).toEqual(["hit"]);
    expect(result.misses).toEqual(["miss"]);
    expect(result.stats).toMatchObject({ requested: 2, hits: 1, misses: 1, absent: 1 });
  });

  /** The point of the miss: `resolveVisitDuration` falls to rung 3 and the stop
   *  still gets a sane, positive length. */
  it("leaves an unenriched place on the type-heuristic rung", async () => {
    const miss = subject("miss", { types: ["museum"] });
    const store = createInMemoryEnrichmentStore();

    const result = await readEnrichments(["miss"], { store, pool: [miss], now: NOW });

    const place: CandidatePlace = { placeId: "miss", name: "Museum", types: ["museum"] };
    const duration = resolveVisitDuration(place, result.enrichments.get("miss"), "balanced");
    expect(duration.preferred).toBe(90);
    expect(duration.min).toBeGreaterThan(0);
  });

  it("counts an id with no pool row instead of throwing, and never calls the store for it", async () => {
    const known = subject("known");
    const getMany = vi.fn(async () => []);
    const store = { ...createInMemoryEnrichmentStore(), getMany };

    const result = await readEnrichments(["known", "ghost"], {
      store,
      pool: [known],
      now: NOW,
    });

    expect(result.stats.notInPool).toBe(1);
    expect(result.misses).toEqual(["known"]);
    expect(getMany).toHaveBeenCalledWith(["known"]);
  });
});

// ── the request ──────────────────────────────────────────────────────────────

describe("submitEnrichmentBatch", () => {
  it("puts effort 'none' on every request line", async () => {
    const batches = fakeBatchClient();
    const places = [subject("a"), subject("b"), subject("c")];

    await submitEnrichmentBatch(places, { batches: batches.client });

    const lines = uploadedLines(batches.uploads);
    expect(lines).toHaveLength(3);
    for (const line of lines) {
      expect(line.body.reasoning).toEqual({ effort: "none" });
    }
  });

  it("keys every line by place_id and targets the batched Responses endpoint", async () => {
    const batches = fakeBatchClient();

    const result = await submitEnrichmentBatch([subject("a"), subject("b")], {
      batches: batches.client,
    });

    const lines = uploadedLines(batches.uploads);
    expect(lines.map((line) => line.custom_id)).toEqual(["a", "b"]);
    expect(lines.map((line) => line.url)).toEqual(["/v1/responses", "/v1/responses"]);
    expect(lines[0].body.model).toBe(MODELS.enrich);
    expect(lines[0].body.text.format).toMatchObject({ type: "json_schema" });
    expect(result.batch?.id).toBe("batch_1");
  });

  it("sends the review text and both Google summaries, and nothing else", async () => {
    const batches = fakeBatchClient();

    await submitEnrichmentBatch(
      [subject("a", { reviewSummary: "Reviewers call it serene." })],
      { batches: batches.client },
    );

    const payload = JSON.parse(uploadedLines(batches.uploads)[0].body.input[1].content);
    expect(Object.keys(payload).sort()).toEqual([
      "editorialSummary",
      "name",
      "rating",
      "reviewSnippets",
      "reviewSummary",
      "types",
      "userRatingCount",
    ]);
  });

  it("drops a duplicate place rather than billing for it twice", async () => {
    const batches = fakeBatchClient();

    const result = await submitEnrichmentBatch([subject("a"), subject("a")], {
      batches: batches.client,
    });

    expect(uploadedLines(batches.uploads)).toHaveLength(1);
    expect(result.stats).toMatchObject({ requested: 2, submitted: 1, duplicatesDropped: 1 });
  });

  it("uploads nothing when there is nothing to enrich", async () => {
    const batches = fakeBatchClient();

    const result = await submitEnrichmentBatch([], { batches: batches.client });

    expect(batches.calls).toMatchObject({ upload: 0, create: 0 });
    expect(result.batch).toBeUndefined();
  });

  it("records a failed create instead of throwing", async () => {
    const batches = fakeBatchClient({ errorOnCreate: true });

    const result = await submitEnrichmentBatch([subject("a")], { batches: batches.client });

    expect(result.batch).toBeUndefined();
    expect(result.error).toContain("batches.create 500");
  });
});

// ── the response: keyed by custom_id, never by position ──────────────────────

describe("collectEnrichmentBatch correlation", () => {
  /** The silent, catastrophic failure: read positionally, every place gets
   *  someone else's description. */
  it("lands every enrichment on the right place_id from a shuffled output file", async () => {
    const pool = [subject("a"), subject("b"), subject("c")];
    const shuffled = [
      outputLine("c", outputJson({ description: "About C." })),
      outputLine("a", outputJson({ description: "About A." })),
      outputLine("b", outputJson({ description: "About B." })),
    ].join("\n");
    const batches = fakeBatchClient({ output: shuffled });
    const store = createInMemoryEnrichmentStore();

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store,
      pool,
      now: NOW,
    });

    expect(result.stats.stored).toBe(3);
    const rows = await store.getMany(["a", "b", "c"]);
    expect(rows.map((row) => [row.placeId, row.description])).toEqual([
      ["a", "About A."],
      ["b", "About B."],
      ["c", "About C."],
    ]);
  });

  it("stamps each row with the source hash of the place it belongs to", async () => {
    const pool = [subject("a"), subject("b")];
    const output = [
      outputLine("b", outputJson()),
      outputLine("a", outputJson()),
    ].join("\n");
    const batches = fakeBatchClient({ output });
    const store = createInMemoryEnrichmentStore();

    await collectEnrichmentBatch("batch_1", { batches: batches.client, store, pool, now: NOW });

    const [rowA, rowB] = await store.getMany(["a", "b"]);
    expect(rowA.sourceHash).toBe(enrichmentSourceHash(pool[0]));
    expect(rowB.sourceHash).toBe(enrichmentSourceHash(pool[1]));
    expect(rowA.sourceHash).not.toBe(rowB.sourceHash);
  });

  it("writes a row a later read accepts on all four fields", async () => {
    const pool = [subject("a")];
    const batches = fakeBatchClient({ output: outputLine("a", outputJson()) });
    const store = createInMemoryEnrichmentStore();

    await collectEnrichmentBatch("batch_1", { batches: batches.client, store, pool, now: NOW });
    const read = await readEnrichments(["a"], { store, pool, now: NOW });

    expect(read.stats.hits).toBe(1);
    expect(read.misses).toEqual([]);
  });
});

// ── the response: what gets dropped, and why ─────────────────────────────────

describe("collectEnrichmentBatch failures", () => {
  it("treats an empty description as a failure — not stored, and named in failures", async () => {
    const pool = [subject("a"), subject("b")];
    const output = [
      outputLine("a", outputJson({ description: "   " })),
      outputLine("b", outputJson({ description: "About B." })),
    ].join("\n");
    const batches = fakeBatchClient({ output });
    const store = createInMemoryEnrichmentStore();

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store,
      pool,
      now: NOW,
    });

    expect(await store.getMany(["a"])).toEqual([]);
    expect(result.failures).toEqual([{ placeId: "a", reason: "empty_description" }]);
    expect(result.stats).toMatchObject({ stored: 1, failed: 1 });
  });

  /** "Retried" against a 24-hour batch means: the next read misses, so the next
   *  submit asks again. There is no inline retry to assert. */
  it("leaves an empty-description place as a miss on the next read", async () => {
    const pool = [subject("a")];
    const batches = fakeBatchClient({ output: outputLine("a", outputJson({ description: "" })) });
    const store = createInMemoryEnrichmentStore();

    await collectEnrichmentBatch("batch_1", { batches: batches.client, store, pool, now: NOW });
    const read = await readEnrichments(["a"], { store, pool, now: NOW });

    expect(read.misses).toEqual(["a"]);
  });

  it("drops and counts a line that is not JSON at all", async () => {
    const pool = [subject("a")];
    const output = ["{ this is not json", outputLine("a", outputJson())].join("\n");
    const batches = fakeBatchClient({ output });
    const store = createInMemoryEnrichmentStore();

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store,
      pool,
      now: NOW,
    });

    expect(result.stats).toMatchObject({ lines: 2, malformedLines: 1, stored: 1 });
    expect(result.failures).toEqual([]);
  });

  it("drops and counts a custom_id that was never submitted", async () => {
    const pool = [subject("a")];
    const output = [outputLine("a", outputJson()), outputLine("ghost", outputJson())].join("\n");
    const batches = fakeBatchClient({ output });
    const store = createInMemoryEnrichmentStore();

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store,
      pool,
      now: NOW,
    });

    expect(result.stats.unknownCustomId).toBe(1);
    expect(result.stats.stored).toBe(1);
    expect(await store.getMany(["ghost"])).toEqual([]);
  });

  it("drops a line whose model output is not valid JSON", async () => {
    const pool = [subject("a")];
    const batches = fakeBatchClient({ output: outputLine("a", "{ nope") });
    const store = createInMemoryEnrichmentStore();

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store,
      pool,
      now: NOW,
    });

    expect(result.failures[0]).toMatchObject({ placeId: "a", reason: "malformed_output" });
    expect(result.stats.stored).toBe(0);
  });

  it("drops a line whose output is missing a required field", async () => {
    const pool = [subject("a")];
    const json = JSON.stringify({ description: "About A." });
    const batches = fakeBatchClient({ output: outputLine("a", json) });
    const store = createInMemoryEnrichmentStore();

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store,
      pool,
      now: NOW,
    });

    expect(result.failures[0]).toMatchObject({ placeId: "a", reason: "schema_violation" });
  });

  it("records a per-line API error rather than throwing", async () => {
    const pool = [subject("a")];
    const line = JSON.stringify({
      custom_id: "a",
      response: { status_code: 429, body: {} },
      error: { message: "rate limited" },
    });
    const batches = fakeBatchClient({ output: line });
    const store = createInMemoryEnrichmentStore();

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store,
      pool,
      now: NOW,
    });

    expect(result.failures[0]).toMatchObject({ placeId: "a", reason: "api_error" });
    expect(result.stats.stored).toBe(0);
  });

  it("does not download while the batch is still running", async () => {
    const batches = fakeBatchClient({ status: "in_progress" });
    const store = createInMemoryEnrichmentStore();

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store,
      pool: [subject("a")],
      now: NOW,
    });

    expect(result.pending).toBe(true);
    expect(batches.calls.download).toBe(0);
    expect(result.stored).toEqual([]);
  });
});

// ── the stay_duration backfill ───────────────────────────────────────────────

describe("collectEnrichmentBatch stay_duration backfill", () => {
  it("fills a null stay_duration and leaves an existing one alone", async () => {
    const pool = [subject("null-row"), subject("set-row")];
    const stayDurations = new Map<string, number | null>([
      ["null-row", null],
      ["set-row", 120],
    ]);
    const output = [
      outputLine("null-row", outputJson({ visitMinutesMin: 40, visitMinutesMax: 80 })),
      outputLine("set-row", outputJson({ visitMinutesMin: 40, visitMinutesMax: 80 })),
    ].join("\n");
    const batches = fakeBatchClient({ output });
    const store = createInMemoryEnrichmentStore([], stayDurations);

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store,
      pool,
      now: NOW,
    });

    expect(stayDurations.get("null-row")).toBe(60);
    expect(stayDurations.get("set-row")).toBe(120);
    expect(result.stats.stayDurationsOffered).toBe(2);
  });

  it("does not create a stay_duration for a place with no locations row", async () => {
    const pool = [subject("a")];
    const stayDurations = new Map<string, number | null>();
    const batches = fakeBatchClient({ output: outputLine("a", outputJson()) });
    const store = createInMemoryEnrichmentStore([], stayDurations);

    await collectEnrichmentBatch("batch_1", { batches: batches.client, store, pool, now: NOW });

    expect(stayDurations.has("a")).toBe(false);
  });
});

// ── the clamp ────────────────────────────────────────────────────────────────

describe("clampVisitMinutes", () => {
  it("turns a zero range into a floor rather than a zero-minute activity", () => {
    expect(clampVisitMinutes([0, 0])).toEqual([MIN_VISIT_MINUTES, MIN_VISIT_MINUTES]);
  });

  it("sorts a reversed range so preferred never lands below min", () => {
    expect(clampVisitMinutes([120, 30])).toEqual([30, 120]);
  });

  it("caps a range that would eat the whole day", () => {
    expect(clampVisitMinutes([600, 1440])).toEqual([MAX_VISIT_MINUTES, MAX_VISIT_MINUTES]);
  });

  it("leaves a sane range untouched", () => {
    expect(clampVisitMinutes([45, 90])).toEqual([45, 90]);
  });

  it("rejects negatives and non-finite endpoints", () => {
    expect(clampVisitMinutes([-30, -10])).toEqual([MIN_VISIT_MINUTES, MIN_VISIT_MINUTES]);
    expect(clampVisitMinutes([Number.NaN, 60])).toEqual([60, 60]);
    expect(clampVisitMinutes([Number.NaN, Number.NaN])).toEqual([60, 60]);
  });

  /** The carried-over bug, stated as the thing it prevents downstream. */
  it("keeps resolveVisitDuration honest for every broken shape", () => {
    const place: CandidatePlace = { placeId: "p", name: "P", types: [] };
    for (const range of [
      [0, 0],
      [120, 30],
      [9999, 9999],
      [-5, 0],
    ] as const) {
      const duration = resolveVisitDuration(
        place,
        { avgVisitMinutes: clampVisitMinutes(range) },
        "packed",
      );
      expect(duration.min).toBeGreaterThanOrEqual(MIN_VISIT_MINUTES);
      expect(duration.max).toBeLessThanOrEqual(MAX_VISIT_MINUTES);
      expect(duration.preferred).toBeGreaterThanOrEqual(duration.min);
      expect(duration.preferred).toBeLessThanOrEqual(duration.max);
    }
  });

  it("clamps a stored row on the way out of the cache, not only on the way in", async () => {
    const place = subject("p1");
    const store = createInMemoryEnrichmentStore([
      fresh(place, { avgVisitMinutes: [0, 5000] }),
    ]);

    const result = await readEnrichments(["p1"], { store, pool: [place], now: NOW });

    expect(result.enrichments.get("p1")?.avgVisitMinutes).toEqual([
      MIN_VISIT_MINUTES,
      MAX_VISIT_MINUTES,
    ]);
  });

  it("clamps what collect writes, so a bad model range never reaches the store", async () => {
    const pool = [subject("a")];
    const batches = fakeBatchClient({
      output: outputLine("a", outputJson({ visitMinutesMin: 480, visitMinutesMax: 0 })),
    });
    const store = createInMemoryEnrichmentStore();

    await collectEnrichmentBatch("batch_1", { batches: batches.client, store, pool, now: NOW });

    const [row] = await store.getMany(["a"]);
    expect(row.avgVisitMinutes).toEqual([MIN_VISIT_MINUTES, MAX_VISIT_MINUTES]);
  });
});

// ── the error file: the half of a batch nobody was reading ───────────────────

describe("collectEnrichmentBatch error file", () => {
  it("downloads it and names every place the provider refused", async () => {
    const a = subject("a");
    const b = subject("b");
    const batches = fakeBatchClient({
      output: outputLine("a", outputJson()),
      errorFile: errorLine("b"),
    });
    const store = createInMemoryEnrichmentStore();

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store,
      pool: [a, b],
      now: NOW,
    });

    expect(batches.downloaded).toContain("file_err");
    expect(result.stats.errorFileLines).toBe(1);
    expect(result.failures).toEqual([
      { placeId: "b", reason: "api_error", message: expect.stringContaining("rate_limit_exceeded") },
    ]);
    // The one that did come back is still stored — an error file is not a
    // reason to throw away the output file beside it.
    expect(result.stored.map((row) => row.placeId)).toEqual(["a"]);
    expect(result.stats.failed).toBe(1);
  });

  it("reads it even when every request failed and there is no output file at all", async () => {
    const a = subject("a");
    const batches = fakeBatchClient({ errorFile: errorLine("a", "invalid_request_error") });

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store: createInMemoryEnrichmentStore(),
      pool: [a],
      now: NOW,
    });

    // Before the error file was read this returned pending:false with nothing
    // in it, and the reason sixty places kept missing was simply unrecorded.
    expect(result.pending).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toContain("invalid_request_error");
    expect(result.stats.lines).toBe(0);
  });

  it("counts an error line for a place that was never submitted, without storing it", async () => {
    const batches = fakeBatchClient({ errorFile: errorLine("stranger") });
    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store: createInMemoryEnrichmentStore(),
      pool: [subject("a")],
      now: NOW,
    });
    expect(result.stats.errorFileLines).toBe(1);
    expect(result.stats.unknownCustomId).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it("keeps the stored rows when the error file itself will not download", async () => {
    const warn = vi.spyOn(console, "error").mockImplementation(() => {});
    const batches = fakeBatchClient({
      output: outputLine("a", outputJson()),
      errorFile: errorLine("b"),
      downloadFailures: ["file_err"],
    });

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store: createInMemoryEnrichmentStore(),
      pool: [subject("a"), subject("b")],
      now: NOW,
    });

    // Diagnostics are not data. Losing the error file must not hold the batch
    // open forever, and must not cost the row that did come back.
    expect(result.stored.map((row) => row.placeId)).toEqual(["a"]);
    expect(result.pending).toBe(false);
    expect(result.transportError).toBeUndefined();
    warn.mockRestore();
  });
});

// ── a store that refuses the write ───────────────────────────────────────────

describe("collectEnrichmentBatch and a database that says no", () => {
  function refusingStore(where: "putMany" | "updateStayDuration") {
    const inner = createInMemoryEnrichmentStore();
    return {
      ...inner,
      async putMany(rows: readonly StoredEnrichment[]) {
        if (where === "putMany") throw new Error('violates foreign key "place_enrichments_place_id_fkey"');
        return inner.putMany(rows);
      },
      async updateStayDuration(updates: readonly { placeId: string; minutes: number }[]) {
        if (where === "updateStayDuration") throw new Error("connection terminated");
        return inner.updateStayDuration(updates);
      },
    };
  }

  it("reports a rejected insert instead of throwing out of the collector", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const batches = fakeBatchClient({ output: outputLine("a", outputJson()) });

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store: refusingStore("putMany"),
      pool: [subject("a")],
      now: NOW,
    });

    expect(result.storeError).toContain("foreign key");
    expect(result.stored).toEqual([]);
    expect(result.stats.stored).toBe(0);
    error.mockRestore();
  });

  it("reports a failed stay_duration backfill the same way", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const batches = fakeBatchClient({ output: outputLine("a", outputJson()) });

    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store: refusingStore("updateStayDuration"),
      pool: [subject("a")],
      now: NOW,
    });

    expect(result.storeError).toContain("connection terminated");
    error.mockRestore();
  });

  it("still stamps stayDurationsOffered when the write goes through", async () => {
    const batches = fakeBatchClient({ output: outputLine("a", outputJson()) });
    const result = await collectEnrichmentBatch("batch_1", {
      batches: batches.client,
      store: createInMemoryEnrichmentStore(),
      pool: [subject("a")],
      now: NOW,
    });
    expect(result.storeError).toBeUndefined();
    expect(result.stats.stored).toBe(1);
    expect(result.stats.stayDurationsOffered).toBe(1);
  });
});

// ── the subject projection ───────────────────────────────────────────────────

describe("toEnrichmentSubject", () => {
  it("drops everything the pass does not read, so a batch row is not a location row", () => {
    const fat = {
      ...subject("a"),
      latitude: 35.0,
      longitude: 135.7,
      formattedAddress: "somewhere",
      photoNames: ["places/a/photos/1"],
      openingPeriods: [{ open: { day: 1, hour: 9, minute: 0 } }],
    } as unknown as EnrichmentSubject;

    const projected = toEnrichmentSubject(fat);

    expect(Object.keys(projected).sort()).toEqual([
      "editorialSummary",
      "name",
      "placeId",
      "rating",
      "reviewSnippets",
      "reviewSummary",
      "types",
      "userRatingCount",
    ]);
  });

  it("hashes to the same digest as the row it came from", () => {
    const place = subject("a");
    expect(enrichmentSourceHash(toEnrichmentSubject(place))).toBe(enrichmentSourceHash(place));
  });
});
