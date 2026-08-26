/**
 * `POST /api/enrichments/collect` — sweep the durable enrichment queue.
 *
 * `runPlan` hands every place it could not enrich to an OpenAI batch and moves
 * on; the answers arrive within 24 hours and something has to go and get them.
 * Until this route existed nothing did, so `enrichment_batches` filled up with
 * rows stuck at `validating` and `place_enrichments` stayed empty — and every
 * visit duration in every trip came off the type table in `duration.ts` while
 * the itinerary looked complete. That is the shape of failure this pipeline
 * produces by design: each stage degrades rather than throwing, so the only way
 * to see a broken one is to read its counter.
 *
 * So the counters are the response body. `pending` above zero is the normal
 * answer for a batch OpenAI has not finished; `errored` above zero is the one
 * worth looking at.
 *
 * **POST, not GET**, because it writes: it downloads output files, inserts
 * enrichments and closes batch rows. Safe to call repeatedly — a batch is
 * closed only once its answer is stored, so a re-run picks up exactly what the
 * last one could not finish.
 */

import { enrichmentCollectRouteDeps } from "../../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAVAILABLE_MESSAGE = "We couldn't collect the enrichment batches. Please try again.";

export async function POST(): Promise<Response> {
  let deps;
  try {
    deps = enrichmentCollectRouteDeps.create();
  } catch (error) {
    // A missing API key is a configuration fault, not a transient one. Say so
    // in the log and give the caller the plain sentence.
    console.error("[POST /api/enrichments/collect] could not build dependencies", error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }

  try {
    // `collectQueuedEnrichments` already wraps each batch, so one bad batch
    // costs its own row and not the other nine. Reaching this catch means the
    // *list* of open batches could not be read.
    const totals = await deps.collect({
      batches: deps.batches,
      queue: deps.queue,
      enrichments: deps.enrichments,
      now: deps.now(),
    });
    return Response.json(totals);
  } catch (error) {
    console.error("[POST /api/enrichments/collect] the sweep failed", error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }
}
