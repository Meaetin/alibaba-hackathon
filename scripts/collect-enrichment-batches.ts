import OpenAI from "openai";

import { getDb } from "../src/lib/db/client.ts";
import { createEnrichmentBatchStore } from "../src/lib/db/enrichment-batches.ts";
import { createEnrichmentStore } from "../src/lib/db/stores.ts";
import { collectQueuedEnrichments } from "../src/lib/planner/enrichment-queue.ts";
import { createBatchClient } from "../src/lib/planner/openai.ts";

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const db = getDb();
  const result = await collectQueuedEnrichments({
    batches: createBatchClient(new OpenAI({ apiKey })),
    queue: createEnrichmentBatchStore(db),
    enrichments: createEnrichmentStore(db),
    now: new Date(),
  });

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("Could not collect enrichment batches", error);
  process.exitCode = 1;
});
