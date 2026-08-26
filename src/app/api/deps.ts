/**
 * The wiring both API routes hang off, and the one seam their tests override.
 *
 * It lives beside the routes rather than inside them because **a Next.js route
 * file may only export the handler and the known config fields** — `export const
 * planRouteDeps` in `plan/route.ts` fails the build with "is not a valid Route
 * export field". So the overridable factory moves one file across, the handlers
 * import it, and `route.test.ts` reassigns `create` to run the whole path
 * against fakes: no database, no Google, no OpenAI, no mocking framework.
 *
 * Nothing here is a route. `deps.ts` is not one of the filenames Next treats
 * specially, so this module is ordinary code that happens to sit under `app/`.
 */

import OpenAI from "openai";

import { getDb, type Database } from "@/lib/db/client";
import { createEnrichmentBatchStore } from "@/lib/db/enrichment-batches";
import { createPlanStore, type PlanStore } from "@/lib/db/itineraries";
import { createPersonaStore, type PersonaStore } from "@/lib/db/personas";
import { createEnrichmentStore, createLocationStore, createSearchCache } from "@/lib/db/stores";
import type { EnrichmentStore } from "@/lib/planner/enrich";
import {
  collectQueuedEnrichments,
  enqueueEnrichmentMisses,
  type EnrichmentBatchStore,
} from "@/lib/planner/enrichment-queue";
import type { FetchLike } from "@/lib/planner/http";
import {
  createBatchClient,
  createResponsesClient,
  type BatchClient,
  type ResponsesClient,
} from "@/lib/planner/openai";
import { createS3PhotoBlobStore, s3ConfigFromEnv } from "@/lib/planner/photo-blobs";
import type { PhotoBlobStore } from "@/lib/planner/photos";
import { runPlan } from "@/lib/planner/pipeline";
import type { LocationStore, SearchCache } from "@/lib/planner/retrieval";

export interface PlanRouteDeps {
  store: PlanStore;
  /** Resolves `personaId` on the request body into the traveller's answers. */
  personas: PersonaStore;
  runPlan: typeof runPlan;
  /** Injected clocks and randomness. Nothing in the pipeline reads the ambient
   *  ones, and the handler must not reintroduce them. */
  now: () => Date;
  rng: () => number;
  googleApiKey: string;
  cache: SearchCache;
  locations: LocationStore;
  enrichments: EnrichmentStore;
  enqueueEnrichments?: Parameters<typeof runPlan>[1]["enqueueEnrichments"];
  /** The product default for live enrichment. See `PipelineDeps.enrichNow` —
   *  it is off in the library on purpose, and chosen here. */
  enrichNow?: boolean;
  responses: ResponsesClient;
  fetch?: FetchLike;
  blobs?: PhotoBlobStore;
}

function defaultPlanRouteDeps(): PlanRouteDeps {
  const db = getDb();
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY is not set — the planner cannot run.");
  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleApiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set — the planner cannot run.");

  const blobConfig = s3ConfigFromEnv();
  const openai = new OpenAI({ apiKey: openaiKey });
  const batches = createBatchClient(openai);
  const enrichmentBatchStore = createEnrichmentBatchStore(db);
  return {
    store: createPlanStore(db),
    personas: createPersonaStore(db),
    runPlan,
    now: () => new Date(),
    rng: Math.random,
    googleApiKey,
    cache: createSearchCache(db),
    locations: createLocationStore(db),
    enrichments: createEnrichmentStore(db),
    enqueueEnrichments: async (subjects, now) => {
      const result = await enqueueEnrichmentMisses(subjects, {
        batches,
        queue: enrichmentBatchStore,
        now,
      });
      if (result.error) {
        console.error("[enrichment batch] submission failed", result.error);
      }
    },
    responses: createResponsesClient(openai),
    // Fetch what the cache missed before Pass B, rather than queueing it for
    // tomorrow. Costs about a cent and ~11 seconds; buys a first trip to a new
    // city whose visit lengths are estimates of the places rather than a type
    // table. The batch is still there for pre-warming — see `enrichNow`.
    enrichNow: true,
    blobs: blobConfig ? createS3PhotoBlobStore(blobConfig) : undefined,
  };
}

/** `POST /api/plan`'s dependencies. Reassign `create` in a test; production
 *  never touches it. */
export const planRouteDeps: { create: () => PlanRouteDeps } = {
  create: defaultPlanRouteDeps,
};

/** `GET /api/itineraries/[id]`. It reads the database directly rather than
 *  through a port: `readItineraryDetail` is four selects with no decisions in
 *  them, so there is nothing a double could usefully stand in for. */
export const itineraryRouteDeps: { create: () => { db: Database } } = {
  create: () => ({ db: getDb() }),
};

/** `GET /api/jobs/[id]` needs one thing, so it asks for one thing. */
export const jobsRouteDeps: { create: () => { store: PlanStore } } = {
  create: () => ({ store: createPlanStore(getDb()) }),
};

/**
 * `POST /api/enrichments/collect` — the sweep that closes the loop on the
 * durable enrichment queue.
 *
 * Submission and collection are separated by up to 24 hours, which is the whole
 * reason `enrichment_batches` is a table rather than a promise. Nothing was
 * calling the collector, so every batch sat at `validating` forever and
 * `place_enrichments` stayed empty — which is invisible, because
 * `resolveVisitDuration` simply falls to the type heuristic and a trip still
 * comes out. Exactly the failure mode this codebase already knows about: a
 * degradation ladder is also a way for a real failure to look like success.
 *
 * Same seam as the others: reassign `create` in a test, production never
 * touches it.
 */
export const enrichmentCollectRouteDeps: {
  create: () => {
    collect: typeof collectQueuedEnrichments;
    batches: BatchClient;
    queue: EnrichmentBatchStore;
    enrichments: EnrichmentStore;
    now: () => Date;
  };
} = {
  create: () => {
    const openaiKey = process.env.OPENAI_API_KEY;
    if (!openaiKey) throw new Error("OPENAI_API_KEY is not set — batches cannot be collected.");
    const db = getDb();
    return {
      collect: collectQueuedEnrichments,
      batches: createBatchClient(new OpenAI({ apiKey: openaiKey })),
      queue: createEnrichmentBatchStore(db),
      enrichments: createEnrichmentStore(db),
      now: () => new Date(),
    };
  },
};

/** `POST /api/persona`. Same shape and the same reason: one seam, no database
 *  in the handler test. The clock is injected here too — a stored `updated_at`
 *  is as reproducible as the plan it later feeds. */
export const personaRouteDeps: {
  create: () => { personas: PersonaStore; now: () => Date };
} = {
  create: () => ({ personas: createPersonaStore(getDb()), now: () => new Date() }),
};
