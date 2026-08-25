import {
  collectEnrichmentBatch,
  isTerminalEnrichmentBatchStatus,
  submitEnrichmentBatch,
  toEnrichmentSubject,
  type EnrichmentFailure,
  type EnrichmentStore,
  type EnrichmentSubject,
} from "./enrich";
import type { BatchClient } from "./openai";

export interface StoredEnrichmentBatch {
  providerBatchId: string;
  status: string;
  subjects: EnrichmentSubject[];
  /** Every place this batch could not enrich, and why. Written once, when the
   *  batch goes terminal — see `collectQueuedEnrichments`. */
  failures: EnrichmentFailure[];
  createdAt: Date;
  updatedAt: Date;
}

export interface EnrichmentBatchStore {
  listOpen(): Promise<StoredEnrichmentBatch[]>;
  create(input: {
    providerBatchId: string;
    status: string;
    subjects: readonly EnrichmentSubject[];
    now: Date;
  }): Promise<void>;
  /**
   * Closes a batch out. `failures` is written alongside the status because the
   * two are decided together and a second call could leave a terminal batch
   * with no record of what it lost.
   */
  updateStatus(
    providerBatchId: string,
    status: string,
    now: Date,
    failures?: readonly EnrichmentFailure[],
  ): Promise<void>;
}

export interface EnqueueEnrichmentResult {
  requested: number;
  alreadyQueued: number;
  submitted: number;
  providerBatchId?: string;
  error?: string;
}

/**
 * Submits only cache misses not already present in an open durable batch. The
 * OpenAI batch may run for 24 hours; this function waits only for upload and
 * batch creation so the handle cannot be lost between localhost restarts.
 */
export async function enqueueEnrichmentMisses(
  subjects: readonly EnrichmentSubject[],
  deps: { batches: BatchClient; queue: EnrichmentBatchStore; now: Date },
): Promise<EnqueueEnrichmentResult> {
  try {
    const open = await deps.queue.listOpen();
    const queuedIds = new Set(open.flatMap((batch) => batch.subjects.map((item) => item.placeId)));
    const unique = new Map(subjects.map((subject) => [subject.placeId, subject]));
    const pending = [...unique.values()].filter((subject) => !queuedIds.has(subject.placeId));

    // Projected here, not at the call site: `EnrichmentSubject` is a `Pick`, so
    // without this the whole `RetrievedPlace` — coordinates, photo names, price
    // range — lands in the durable batch row.
    const projected = pending.map(toEnrichmentSubject);
    const submitted = await submitEnrichmentBatch(projected, { batches: deps.batches });
    if (!submitted.batch) {
      return {
        requested: unique.size,
        alreadyQueued: unique.size - pending.length,
        submitted: 0,
        error: submitted.error,
      };
    }

    await deps.queue.create({
      providerBatchId: submitted.batch.id,
      status: submitted.batch.status,
      subjects: projected,
      now: deps.now,
    });
    return {
      requested: unique.size,
      alreadyQueued: unique.size - pending.length,
      submitted: pending.length,
      providerBatchId: submitted.batch.id,
    };
  } catch (error) {
    return {
      requested: new Set(subjects.map((subject) => subject.placeId)).size,
      alreadyQueued: 0,
      submitted: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export interface CollectQueuedEnrichmentResult {
  checked: number;
  pending: number;
  terminal: number;
  stored: number;
  failed: number;
  /** Batches this sweep could not even attempt — the store threw before or
   *  during the collect. They stay open, so the next run tries them again. */
  errored: number;
}

/**
 * Checks every open durable batch once. Safe to run repeatedly from localhost.
 *
 * Every batch is isolated. The whole point of a sweep is that it gets through
 * the list: one batch whose output file is gone, or whose rows the database
 * refuses, must cost that batch and nothing else. So the body is wrapped, and a
 * batch that fails keeps its non-terminal status and comes back next run.
 */
export async function collectQueuedEnrichments(deps: {
  batches: BatchClient;
  queue: EnrichmentBatchStore;
  enrichments: EnrichmentStore;
  now: Date;
}): Promise<CollectQueuedEnrichmentResult> {
  const open = await deps.queue.listOpen();
  const totals: CollectQueuedEnrichmentResult = {
    checked: open.length,
    pending: 0,
    terminal: 0,
    stored: 0,
    failed: 0,
    errored: 0,
  };

  for (const record of open) {
    try {
      const result = await collectEnrichmentBatch(record.providerBatchId, {
        batches: deps.batches,
        store: deps.enrichments,
        pool: record.subjects,
        now: deps.now,
      });

      // A batch is closed only when we have its answer *and* got the answer
      // written. A transport or store failure leaves the row open on purpose:
      // marking it terminal would strand a completed output file forever.
      const retryable =
        result.pending || result.transportError !== undefined || result.storeError !== undefined;
      if (result.batch.status !== "unknown" && !retryable) {
        await deps.queue.updateStatus(
          record.providerBatchId,
          result.batch.status,
          deps.now,
          result.failures,
        );
      }
      if (result.storeError) {
        console.error(
          `[enrichment ${record.providerBatchId}] left open after a store failure`,
          result.storeError,
        );
      }

      totals.pending += retryable ? 1 : 0;
      totals.terminal +=
        !retryable && isTerminalEnrichmentBatchStatus(result.batch.status) ? 1 : 0;
      totals.stored += result.stats.stored;
      totals.failed += result.stats.failed;
    } catch (error) {
      console.error(`[enrichment ${record.providerBatchId}] could not be collected`, error);
      totals.errored += 1;
    }
  }

  return totals;
}
