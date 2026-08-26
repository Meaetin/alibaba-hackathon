import { eq, notInArray } from "drizzle-orm";

import { ENRICHMENT_TERMINAL_STATUSES } from "@/lib/planner/enrich";
import type { EnrichmentFailure } from "@/lib/planner/enrich";
import type {
  EnrichmentBatchStore,
  StoredEnrichmentBatch,
} from "@/lib/planner/enrichment-queue";

import type { Database } from "./client";
import { enrichment_batches } from "./schema";

export function createEnrichmentBatchStore(db: Database): EnrichmentBatchStore {
  return {
    async listOpen() {
      const rows = await db
        .select()
        .from(enrichment_batches)
        .where(notInArray(enrichment_batches.status, [...ENRICHMENT_TERMINAL_STATUSES]));
      return rows.map(toStoredBatch);
    },

    async create(input) {
      await db.insert(enrichment_batches).values({
        provider_batch_id: input.providerBatchId,
        status: input.status,
        subjects: [...input.subjects],
        created_at: input.now,
        updated_at: input.now,
      });
    },

    async updateStatus(providerBatchId, status, now, failures, usage) {
      await db
        .update(enrichment_batches)
        .set({
          status,
          updated_at: now,
          // Only written when the caller has an answer. Passing `undefined`
          // leaves the column alone, so a status-only patch cannot blank a
          // record of what the batch lost — or of what it cost.
          ...(failures ? { failures: [...failures] as EnrichmentFailure[] } : {}),
          ...(usage ? { usage } : {}),
        })
        .where(eq(enrichment_batches.provider_batch_id, providerBatchId));
    },
  };
}

type EnrichmentBatchRow = typeof enrichment_batches.$inferSelect;

function toStoredBatch(row: EnrichmentBatchRow): StoredEnrichmentBatch {
  return {
    providerBatchId: row.provider_batch_id,
    status: row.status,
    subjects: row.subjects,
    failures: row.failures ?? [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
