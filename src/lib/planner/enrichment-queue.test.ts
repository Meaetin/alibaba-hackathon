import { describe, expect, it, vi } from "vitest";

import { createInMemoryEnrichmentStore, type EnrichmentSubject } from "./enrich";
import {
  collectQueuedEnrichments,
  enqueueEnrichmentMisses,
  type EnrichmentBatchStore,
  type StoredEnrichmentBatch,
} from "./enrichment-queue";
import type { BatchClient, BatchHandle } from "./openai";

const NOW = new Date("2026-08-24T09:00:00Z");

function subject(placeId: string): EnrichmentSubject {
  return {
    placeId,
    name: `Place ${placeId}`,
    types: ["tourist_attraction"],
    rating: 4.5,
    userRatingCount: 20,
    reviewSnippets: [{ rating: 5, text: "Lovely at sunset." }],
  };
}

function queueStore(seed: StoredEnrichmentBatch[] = []) {
  const rows = new Map(seed.map((row) => [row.providerBatchId, row]));
  const store: EnrichmentBatchStore = {
    async listOpen() {
      return [...rows.values()].filter(
        (row) => !["completed", "failed", "expired", "cancelled"].includes(row.status),
      );
    },
    async create(input) {
      rows.set(input.providerBatchId, {
        providerBatchId: input.providerBatchId,
        status: input.status,
        subjects: [...input.subjects],
        failures: [],
        createdAt: input.now,
        updatedAt: input.now,
      });
    },
    async updateStatus(providerBatchId, status, now, failures) {
      const row = rows.get(providerBatchId);
      if (!row) return;
      rows.set(providerBatchId, {
        ...row,
        status,
        updatedAt: now,
        ...(failures ? { failures: [...failures] } : {}),
      });
    },
  };
  return { store, rows };
}

function outputLine(placeId: string): string {
  const text = JSON.stringify({
    description: `About ${placeId}.`,
    tags: ["scenic"],
    confidence: 0.8,
    visitMinutesMin: 45,
    visitMinutesMax: 75,
    signatureDishes: [],
    bestTimeOfDay: null,
    crowdProfile: "quiet",
  });
  return JSON.stringify({
    custom_id: placeId,
    response: {
      status_code: 200,
      body: { output: [{ type: "message", content: [{ type: "output_text", text }] }] },
    },
    error: null,
  });
}

describe("enqueueEnrichmentMisses", () => {
  it("persists a handle and skips places already in an open batch", async () => {
    const existing = subject("a");
    const queue = queueStore([
      {
        providerBatchId: "batch_old",
        status: "in_progress",
        subjects: [existing],
        failures: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    let uploaded = "";
    const batches: BatchClient = {
      async uploadJsonl(body) {
        uploaded = body;
        return "file_in";
      },
      async create(): Promise<BatchHandle> {
        return { id: "batch_new", status: "validating" };
      },
      async retrieve() {
        throw new Error("not used");
      },
      async downloadJsonl() {
        throw new Error("not used");
      },
    };

    const result = await enqueueEnrichmentMisses([existing, subject("b")], {
      batches,
      queue: queue.store,
      now: NOW,
    });

    expect(result).toMatchObject({ alreadyQueued: 1, submitted: 1, providerBatchId: "batch_new" });
    expect(uploaded).toContain('"custom_id":"b"');
    expect(uploaded).not.toContain('"custom_id":"a"');
    expect(queue.rows.get("batch_new")?.subjects.map((item) => item.placeId)).toEqual(["b"]);
  });
});

describe("collectQueuedEnrichments", () => {
  it("collects by the persisted subjects and marks the batch terminal", async () => {
    const place = subject("a");
    const queue = queueStore([
      {
        providerBatchId: "batch_1",
        status: "in_progress",
        subjects: [place],
        failures: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    const batches: BatchClient = {
      async uploadJsonl() {
        throw new Error("not used");
      },
      async create() {
        throw new Error("not used");
      },
      async retrieve() {
        return { id: "batch_1", status: "completed", outputFileId: "file_out" };
      },
      async downloadJsonl() {
        return outputLine("a");
      },
    };
    const enrichments = createInMemoryEnrichmentStore();

    const result = await collectQueuedEnrichments({
      batches,
      queue: queue.store,
      enrichments,
      now: NOW,
    });

    expect(result).toEqual({ checked: 1, pending: 0, terminal: 1, stored: 1, failed: 0, errored: 0 });
    expect(queue.rows.get("batch_1")?.status).toBe("completed");
    expect((await enrichments.getMany(["a"]))[0].description).toBe("About a.");
  });

  it("keeps a completed batch open when its output download fails", async () => {
    const queue = queueStore([
      {
        providerBatchId: "batch_1",
        status: "in_progress",
        subjects: [subject("a")],
        failures: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    const batches: BatchClient = {
      async uploadJsonl() {
        throw new Error("not used");
      },
      async create() {
        throw new Error("not used");
      },
      async retrieve() {
        return { id: "batch_1", status: "completed", outputFileId: "file_out" };
      },
      async downloadJsonl() {
        throw new Error("temporary file error");
      },
    };

    await collectQueuedEnrichments({
      batches,
      queue: queue.store,
      enrichments: createInMemoryEnrichmentStore(),
      now: NOW,
    });

    expect(queue.rows.get("batch_1")?.status).toBe("in_progress");
  });
});

describe("collectQueuedEnrichments isolates each batch", () => {
  /**
   * Every batch completed, each with its own output file. The output is keyed
   * by batch id so two batches in one sweep cannot be served the same rows —
   * which would let a "the good one still stored" assertion pass on the wrong
   * batch's data.
   */
  function allCompleted(outputByBatch: Record<string, string>): BatchClient {
    return {
      async uploadJsonl() {
        return "file_in";
      },
      async create() {
        return { id: "batch_new", status: "validating" };
      },
      async retrieve(batchId) {
        return { id: batchId, status: "completed", outputFileId: `file:${batchId}` };
      },
      async downloadJsonl(fileId) {
        return outputByBatch[fileId.slice("file:".length)] ?? "";
      },
    };
  }

  it("finishes the sweep when one batch throws where nothing else catches", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = queueStore([
      {
        providerBatchId: "batch_bad",
        status: "in_progress",
        subjects: [subject("a")],
        failures: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
      {
        providerBatchId: "batch_good",
        status: "in_progress",
        subjects: [subject("b")],
        failures: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    const enrichments = createInMemoryEnrichmentStore();

    // Note where the failure is planted. `collectEnrichmentBatch` wraps every
    // provider call in `withRetry`, so a throwing `retrieve` comes back as a
    // reported `transportError` and never reaches the loop — testing there
    // would prove nothing about the guard. `updateStatus` is outside that
    // module entirely, which is exactly the gap the try/catch was added for.
    const store: EnrichmentBatchStore = {
      ...queue.store,
      async updateStatus(providerBatchId, status, now, failures) {
        if (providerBatchId === "batch_bad") throw new Error("the queue write failed");
        return queue.store.updateStatus(providerBatchId, status, now, failures);
      },
    };

    const result = await collectQueuedEnrichments({
      batches: allCompleted({ batch_bad: outputLine("a"), batch_good: outputLine("b") }),
      queue: store,
      enrichments,
      now: NOW,
    });

    expect(result.checked).toBe(2);
    expect(result.errored).toBe(1);
    // The good batch was collected and closed despite the bad one beside it.
    expect(queue.rows.get("batch_good")?.status).toBe("completed");
    // And the bad one stays open, so the next sweep tries it again.
    expect(queue.rows.get("batch_bad")?.status).toBe("in_progress");
    expect(await enrichments.getMany(["b"])).toHaveLength(1);
    error.mockRestore();
  });

  it("leaves a batch open when the store refuses its rows", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const queue = queueStore([
      {
        providerBatchId: "batch_1",
        status: "in_progress",
        subjects: [subject("a")],
        failures: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);
    const inner = createInMemoryEnrichmentStore();

    const result = await collectQueuedEnrichments({
      batches: allCompleted({ batch_1: outputLine("a") }),
      queue: queue.store,
      enrichments: {
        ...inner,
        async putMany() {
          throw new Error("violates foreign key");
        },
      },
      now: NOW,
    });

    expect(result.pending).toBe(1);
    expect(result.terminal).toBe(0);
    expect(queue.rows.get("batch_1")?.status).toBe("in_progress");
    error.mockRestore();
  });

  it("writes the failures onto the batch row when it closes it", async () => {
    const queue = queueStore([
      {
        providerBatchId: "batch_1",
        status: "in_progress",
        subjects: [subject("a"), subject("b")],
        failures: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    const batches: BatchClient = {
      async uploadJsonl() {
        return "file_in";
      },
      async create() {
        return { id: "batch_1", status: "completed" };
      },
      async retrieve() {
        return {
          id: "batch_1",
          status: "completed",
          outputFileId: "file_out",
          errorFileId: "file_err",
        };
      },
      async downloadJsonl(fileId) {
        return fileId === "file_err"
          ? JSON.stringify({
              custom_id: "b",
              response: null,
              error: { code: "server_error", message: "The model is unavailable." },
            })
          : outputLine("a");
      },
    };

    await collectQueuedEnrichments({
      batches,
      queue: queue.store,
      enrichments: createInMemoryEnrichmentStore(),
      now: NOW,
    });

    const row = queue.rows.get("batch_1")!;
    expect(row.status).toBe("completed");
    // Without this the only record of what a terminal batch lost was a number
    // in a console line nobody kept.
    expect(row.failures).toEqual([
      { placeId: "b", reason: "api_error", message: expect.stringContaining("server_error") },
    ]);
  });
});

describe("enqueueEnrichmentMisses stores a subject, not a location row", () => {
  it("keeps only the eight fields enrichment reads", async () => {
    const queue = queueStore();
    const fat = {
      ...subject("a"),
      latitude: 1.29,
      longitude: 103.85,
      photoNames: ["places/a/photos/1"],
    } as unknown as EnrichmentSubject;

    await enqueueEnrichmentMisses([fat], {
      batches: {
        async uploadJsonl() {
          return "file_in";
        },
        async create() {
          return { id: "batch_1", status: "validating" };
        },
        async retrieve() {
          return { id: "batch_1", status: "validating" };
        },
        async downloadJsonl() {
          return "";
        },
      },
      queue: queue.store,
      now: NOW,
    });

    const stored = queue.rows.get("batch_1")!.subjects[0] as Record<string, unknown>;
    expect(stored).not.toHaveProperty("latitude");
    expect(stored).not.toHaveProperty("photoNames");
    expect(stored.placeId).toBe("a");
  });
});
