/**
 * Cached LLM enrichment — "Beyond-Google Data" in
 * `docs/personalization-pipeline.md`. One profile-agnostic paragraph, a tag
 * list and a visit-length estimate per place, paid for once and cached 90 days.
 *
 * The shape of this module is dictated by one fact: enrichment runs on the
 * **Batch API**, whose turnaround is up to 24 hours, and a planning job has
 * 60–120 seconds. So it splits in two, and the planner only ever touches the
 * first half:
 *
 *   read path   `readEnrichments(placeIds, deps)`      — cache lookup, no network
 *   write path  `submitEnrichmentBatch(places, deps)`  — build JSONL, create batch
 *               `collectEnrichmentBatch(id, deps)`     — download, validate, store
 *
 * **A miss is not an error.** A place with no cached enrichment falls to the
 * type-heuristic rung of `resolveVisitDuration` and ships without a description.
 * Nothing here throws at the planner; failures are counted and returned. The
 * write path is the pre-warm job that runs the night before a demo, and the
 * only thing a missed pre-warm costs is a slightly duller trip.
 *
 * Two rules worth stating out loud, because both fail silently:
 *
 * - **Results are keyed by `custom_id`, never by position.** The Batch API
 *   returns lines in whatever order it finishes them. Reading them positionally
 *   gives every place someone else's description and nothing crashes.
 * - **`avgVisitMinutes` is untrusted input.** `resolveVisitDuration` trusts
 *   rung 2 completely, so a model-authored `[0, 0]` becomes a zero-minute
 *   activity and `[120, 30]` becomes `preferred < min`. Everything leaving this
 *   module goes through `clampVisitMinutes` first.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

import { DEFAULT_VISIT_MINUTES } from "./duration";
import {
  MODELS,
  PROMPT_VERSIONS,
  jsonSchemaFormat,
  parseJsonl,
  withRetry,
  type BatchClient,
  type BatchHandle,
} from "./openai";
import type { RetrievedPlace } from "./retrieval";
import type { PlaceEnrichment } from "./types";

// ── the batch wire ───────────────────────────────────────────────────────────

/** The Responses API, batched. Never Chat Completions — see `openai.ts`. */
export const ENRICH_BATCH_ENDPOINT = "/v1/responses";

/** The only window the Batch API offers, and the reason this is a pre-warm job
 *  rather than something the planner awaits. */
export const ENRICH_COMPLETION_WINDOW = "24h";

/** Statuses after which a batch will not change. Anything else means "come
 *  back later" and must not trigger a download. */
export const ENRICHMENT_TERMINAL_STATUSES = [
  "completed",
  "failed",
  "expired",
  "cancelled",
] as const;

const TERMINAL_STATUSES = new Set<string>(ENRICHMENT_TERMINAL_STATUSES);

export function isTerminalEnrichmentBatchStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status);
}

const DEFAULT_TTL_DAYS = 90;

const BATCH_INPUT_FILENAME = "place-enrichment.jsonl";

/** Review text is the enrichment's only real evidence, and five is what the
 *  shortlist mask stores. Matches `MAX_REVIEW_SNIPPETS` in `retrieval.ts`. */
const MAX_REVIEW_SNIPPETS = 5;

// ── the visit-duration clamp ─────────────────────────────────────────────────

/**
 * Floor and ceiling for a model-authored visit length.
 *
 * These are guards, not estimates. The floor exists because a zero-minute
 * activity is a packer bug wearing an enrichment costume; the ceiling exists
 * because one hallucinated `[480, 960]` eats a whole day and the packer, which
 * treats these bounds as honest, has no way to notice.
 */
export const MIN_VISIT_MINUTES = 15;
export const MAX_VISIT_MINUTES = 300;

/**
 * Sorts, floors and ceilings a `[low, high]` minute range so
 * `resolveVisitDuration` can go on trusting rung 2.
 *
 * Handles the three shapes the model actually produces wrong: a zero or
 * negative pair, a reversed pair, and a wildly large one. A non-finite endpoint
 * falls back to the other endpoint, or to the global default when neither is
 * usable.
 */
export function clampVisitMinutes(range: readonly [number, number]): [number, number] {
  const usable = range.filter((value) => Number.isFinite(value));
  const low = Number.isFinite(range[0]) ? range[0] : (usable[0] ?? DEFAULT_VISIT_MINUTES);
  const high = Number.isFinite(range[1]) ? range[1] : (usable[0] ?? DEFAULT_VISIT_MINUTES);
  const sorted = low <= high ? [low, high] : [high, low];
  return [clampMinutes(sorted[0]), clampMinutes(sorted[1])];
}

function clampMinutes(value: number): number {
  return Math.round(Math.min(MAX_VISIT_MINUTES, Math.max(MIN_VISIT_MINUTES, value)));
}

// ── what the model is shown ──────────────────────────────────────────────────

/**
 * The columns enrichment reads. A `RetrievedPlace` satisfies it; naming the
 * subset keeps the hash input visible in one place, since anything added here
 * silently invalidates every cached row.
 */
export type EnrichmentSubject = Pick<
  RetrievedPlace,
  | "placeId"
  | "name"
  | "types"
  | "rating"
  | "userRatingCount"
  | "reviewSnippets"
  | "editorialSummary"
  | "reviewSummary"
>;

/**
 * Exactly what goes over the wire, and exactly what `enrichmentSourceHash`
 * digests. Key order is fixed by the literal in `buildEnrichmentInput` — the
 * hash is over `JSON.stringify` of this, so reordering the fields would
 * invalidate the whole cache.
 */
export interface EnrichmentInput {
  name: string;
  types: string[];
  rating?: number;
  userRatingCount?: number;
  /** Up to five review texts. The only free-form evidence the pass gets. */
  reviewSnippets: string[];
  /** Google's own blurb. Present on roughly half of places. */
  editorialSummary?: string;
  /** Google's AI review digest. Empty for whole countries — see AGENTS.md. */
  reviewSummary?: string;
}

/**
 * The subject, projected at **runtime**.
 *
 * `EnrichmentSubject` is a `Pick`, which exists only in the type checker — hand
 * `submitEnrichmentBatch` or the durable queue a whole `RetrievedPlace` and the
 * whole `RetrievedPlace` is what gets persisted, coordinates and photo names
 * and all. Nothing downstream reads those fields (`enrichmentSourceHash`
 * digests `buildEnrichmentInput` alone), so this is storage, not correctness —
 * but a batch of sixty full location rows is a jsonb column nobody meant to
 * write. Call this at every boundary that stores or sends a subject.
 */
export function toEnrichmentSubject(place: EnrichmentSubject): EnrichmentSubject {
  return {
    placeId: place.placeId,
    name: place.name,
    types: place.types,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    reviewSnippets: place.reviewSnippets,
    editorialSummary: place.editorialSummary,
    reviewSummary: place.reviewSummary,
  };
}

export function buildEnrichmentInput(place: EnrichmentSubject): EnrichmentInput {
  return {
    name: place.name,
    types: place.types,
    rating: place.rating,
    userRatingCount: place.userRatingCount,
    reviewSnippets: (place.reviewSnippets ?? [])
      .slice(0, MAX_REVIEW_SNIPPETS)
      .map((snippet) => snippet.text)
      .filter((text) => text.length > 0),
    editorialSummary: place.editorialSummary,
    reviewSummary: place.reviewSummary,
  };
}

/**
 * `sha256` of the payload the model is shown.
 *
 * This is the fourth freshness field, and the one that catches the case the
 * other three miss: Google's reviews changed, so the cached answer describes a
 * place that no longer reads that way. Exported so a test can compute the
 * expectation instead of pinning a digest literal.
 */
export function enrichmentSourceHash(place: EnrichmentSubject): string {
  return createHash("sha256").update(JSON.stringify(buildEnrichmentInput(place))).digest("hex");
}

// ── what the model returns ───────────────────────────────────────────────────

/**
 * The structured-output contract. Two scalar minute fields rather than a tuple:
 * they map straight onto the `visit_min` / `visit_max` columns, and a
 * fixed-length array is the one JSON Schema shape structured outputs are
 * fussiest about.
 *
 * Every field is required and nullable rather than optional, which is what
 * OpenAI's strict structured outputs demand.
 */
const EnrichmentOutputSchema = z.object({
  description: z.string(),
  tags: z.array(z.string()),
  confidence: z.number(),
  visitMinutesMin: z.number(),
  visitMinutesMax: z.number(),
  signatureDishes: z.array(z.string()),
  bestTimeOfDay: z.enum(["morning", "midday", "sunset", "evening"]).nullable(),
  crowdProfile: z.enum(["quiet", "moderate", "packed"]).nullable(),
});

type EnrichmentOutput = z.infer<typeof EnrichmentOutputSchema>;

const SYSTEM_PROMPT = [
  "You summarise a place for a travel planner from review text.",
  "Ground every claim in the supplied evidence; never invent a fact, a dish or a price.",
  "description: one or two sentences, always non-empty, in the voice of a guidebook.",
  "tags: short lowercase hyphenated traits, e.g. vegetarian-friendly, outdoor-seating, good-for-kids.",
  "confidence: 0 to 1, reflecting how much evidence you actually had. Two reviews and no types is low.",
  "visitMinutesMin / visitMinutesMax: how long a visit typically takes, in minutes.",
  "signatureDishes: only for places that serve food, and only dishes reviewers name. Otherwise empty.",
  "bestTimeOfDay and crowdProfile: null unless the evidence supports an answer.",
].join("\n");

/**
 * `description` is the Pass C fallback, so an empty one degrades a stop to a
 * bare name and a time. The pipeline doc is explicit: treat it as a failure and
 * retry, not as an acceptable answer.
 */
function isUsable(output: EnrichmentOutput): boolean {
  return output.description.trim().length > 0;
}

function toEnrichment(output: EnrichmentOutput): PlaceEnrichment {
  return {
    description: output.description.trim(),
    tags: output.tags,
    confidence: output.confidence,
    avgVisitMinutes: clampVisitMinutes([output.visitMinutesMin, output.visitMinutesMax]),
    signatureDishes: output.signatureDishes.length > 0 ? output.signatureDishes : undefined,
    bestTimeOfDay: output.bestTimeOfDay ?? undefined,
    crowdProfile: output.crowdProfile ?? undefined,
  };
}

// ── the port Step 9 fills in ─────────────────────────────────────────────────

/**
 * A `place_enrichments` row: the cached answer plus the four fields that decide
 * whether it is still allowed to be used.
 */
export interface StoredEnrichment extends PlaceEnrichment {
  placeId: string;
  /** Invalidate by model version, not only by time. */
  model: string;
  /** Bumped when *we* change the prompt. The TTL never catches that: the row is
   *  still fresh, still the same model, and now answers a question we stopped
   *  asking. This is the bug the design doc names by hand. */
  promptVersion: number;
  /** `enrichmentSourceHash` of the payload the answer was produced from. */
  sourceHash: string;
  expiresAt: Date;
}

/** `place_enrichments`, plus the one narrow patch enrichment makes to
 *  `locations`. */
export interface EnrichmentStore {
  getMany(placeIds: readonly string[]): Promise<StoredEnrichment[]>;
  putMany(rows: readonly StoredEnrichment[]): Promise<void>;
  /**
   * Backfills `locations.stay_duration` **where it is null**, never over an
   * existing value — a hand-set or previously-resolved duration outranks a
   * fresh model estimate. Narrow on purpose: enrichment must never write a
   * whole `locations` row, because the row it holds is a retrieval snapshot and
   * would be stale by the time a batch comes back.
   */
  updateStayDuration(
    updates: readonly { placeId: string; minutes: number }[],
  ): Promise<void>;
}

/**
 * Test double and offline path.
 *
 * `stayDurations` is the caller's own map, so a test can inspect what was
 * patched: a key present with `null` is a `locations` row whose
 * `stay_duration` is null, a key absent is a row that doesn't exist. That
 * mirrors `update ... where place_id = $1 and stay_duration is null` exactly.
 */
export function createInMemoryEnrichmentStore(
  seed?: readonly StoredEnrichment[],
  stayDurations?: Map<string, number | null>,
): EnrichmentStore {
  const rows = new Map<string, StoredEnrichment>((seed ?? []).map((row) => [row.placeId, row]));
  return {
    async getMany(placeIds) {
      return placeIds.flatMap((id) => {
        const row = rows.get(id);
        return row ? [row] : [];
      });
    },
    async putMany(incoming) {
      for (const row of incoming) rows.set(row.placeId, row);
    },
    async updateStayDuration(updates) {
      if (!stayDurations) return;
      for (const update of updates) {
        if (!stayDurations.has(update.placeId)) continue;
        if (stayDurations.get(update.placeId) !== null) continue;
        stayDurations.set(update.placeId, update.minutes);
      }
    },
  };
}

// ── the read path ────────────────────────────────────────────────────────────

export interface ReadEnrichmentsDeps {
  store: EnrichmentStore;
  /**
   * The retrieved rows the ids came from. Required, not optional: the
   * source-hash half of the freshness check is uncomputable without the input
   * payload, and a check you can silently skip is not a check.
   */
  pool: readonly EnrichmentSubject[];
  /** Injected so expiry is decidable. Never `new Date()` inside. */
  now: Date;
  model?: string;
  promptVersion?: number;
}

/**
 * Why each requested place did or didn't come back with an enrichment. A cut
 * that only shrinks a list is a silent bug, so every rejection has a counter.
 */
export interface EnrichmentReadStats {
  requested: number;
  /** Ids with no row in `pool` — a caller bug, counted rather than thrown. */
  notInPool: number;
  hits: number;
  misses: number;
  /** Nothing cached at all. The ordinary cold-city case. */
  absent: number;
  expired: number;
  staleModel: number;
  stalePromptVersion: number;
  staleSourceHash: number;
}

export interface ReadEnrichmentsResult {
  enrichments: Map<string, PlaceEnrichment>;
  /** Places worth handing to `submitEnrichmentBatch`. Ids absent from `pool`
   *  are not here — there is no payload to enrich them from. */
  misses: string[];
  stats: EnrichmentReadStats;
}

/**
 * Read-through cache. Never calls the network, never throws, never blocks.
 *
 * A row is usable only when **all four** freshness fields agree: it hasn't
 * expired, the model is the one we'd ask today, the prompt version is the one
 * we'd ask with, and the input it was produced from still hashes the same.
 * Dropping any one of them serves an answer to a question nobody asked.
 */
export async function readEnrichments(
  placeIds: readonly string[],
  deps: ReadEnrichmentsDeps,
): Promise<ReadEnrichmentsResult> {
  const now = deps.now;
  const model = deps.model ?? MODELS.enrich;
  const promptVersion = deps.promptVersion ?? PROMPT_VERSIONS.enrich;

  const bySubject = new Map(deps.pool.map((place) => [place.placeId, place]));
  const wanted = [...new Set(placeIds)];
  const stats: EnrichmentReadStats = {
    requested: wanted.length,
    notInPool: 0,
    hits: 0,
    misses: 0,
    absent: 0,
    expired: 0,
    staleModel: 0,
    stalePromptVersion: 0,
    staleSourceHash: 0,
  };

  const known = wanted.flatMap((placeId) => {
    const place = bySubject.get(placeId);
    if (!place) {
      stats.notInPool += 1;
      return [];
    }
    return [place];
  });

  const stored = known.length > 0 ? await deps.store.getMany(known.map((p) => p.placeId)) : [];
  const byPlaceId = new Map(stored.map((row) => [row.placeId, row]));

  const enrichments = new Map<string, PlaceEnrichment>();
  const misses: string[] = [];

  for (const place of known) {
    const row = byPlaceId.get(place.placeId);
    if (!row) {
      stats.absent += 1;
      stats.misses += 1;
      misses.push(place.placeId);
      continue;
    }

    // Every field is checked, not short-circuited on the first failure, so the
    // stats say which of the four actually went stale.
    let fresh = true;
    if (row.expiresAt <= now) {
      stats.expired += 1;
      fresh = false;
    }
    if (row.model !== model) {
      stats.staleModel += 1;
      fresh = false;
    }
    if (row.promptVersion !== promptVersion) {
      stats.stalePromptVersion += 1;
      fresh = false;
    }
    if (row.sourceHash !== enrichmentSourceHash(place)) {
      stats.staleSourceHash += 1;
      fresh = false;
    }

    if (!fresh) {
      stats.misses += 1;
      misses.push(place.placeId);
      continue;
    }
    stats.hits += 1;
    // Clamped again on the way out: a row written before the clamp existed, or
    // by a hand-run script, must not reach the packer unbounded.
    enrichments.set(place.placeId, {
      ...toPlaceEnrichment(row),
      avgVisitMinutes: clampVisitMinutes(row.avgVisitMinutes),
    });
  }

  return { enrichments, misses, stats };
}

function toPlaceEnrichment(row: StoredEnrichment): PlaceEnrichment {
  return {
    description: row.description,
    tags: row.tags,
    confidence: row.confidence,
    avgVisitMinutes: row.avgVisitMinutes,
    signatureDishes: row.signatureDishes,
    bestTimeOfDay: row.bestTimeOfDay,
    crowdProfile: row.crowdProfile,
  };
}

// ── the write path: submit ───────────────────────────────────────────────────

export interface SubmitEnrichmentDeps {
  batches: BatchClient;
  model?: string;
  promptVersion?: number;
}

export interface EnrichmentSubmitStats {
  requested: number;
  /** Distinct places written to the JSONL. */
  submitted: number;
  duplicatesDropped: number;
}

export interface SubmitEnrichmentResult {
  /** Absent when the upload or the create call failed. */
  batch?: BatchHandle;
  /** Set instead of throwing. A failed pre-warm costs a duller trip, not a job. */
  error?: string;
  /** `place_id` → `sourceHash`, in submission order. Useful to a caller that
   *  wants to record what it asked for; `collectEnrichmentBatch` recomputes. */
  submitted: { placeId: string; sourceHash: string }[];
  stats: EnrichmentSubmitStats;
}

/**
 * Builds the JSONL, uploads it and creates the batch. Returns the handle; it
 * does **not** wait, because the window is 24 hours.
 *
 * Feed this `readEnrichments(...).misses`, resolved back to their pool rows.
 */
export async function submitEnrichmentBatch(
  places: readonly EnrichmentSubject[],
  deps: SubmitEnrichmentDeps,
): Promise<SubmitEnrichmentResult> {
  const model = deps.model ?? MODELS.enrich;

  const unique: EnrichmentSubject[] = [];
  const seen = new Set<string>();
  for (const place of places) {
    if (seen.has(place.placeId)) continue;
    seen.add(place.placeId);
    unique.push(place);
  }

  const stats: EnrichmentSubmitStats = {
    requested: places.length,
    submitted: unique.length,
    duplicatesDropped: places.length - unique.length,
  };
  const submitted = unique.map((place) => ({
    placeId: place.placeId,
    sourceHash: enrichmentSourceHash(place),
  }));

  if (unique.length === 0) return { submitted, stats };

  const body = unique.map((place) => JSON.stringify(batchLine(place, model))).join("\n");
  const created = await withRetry(async () => {
    const inputFileId = await deps.batches.uploadJsonl(body, BATCH_INPUT_FILENAME);
    return await deps.batches.create({
      inputFileId,
      endpoint: ENRICH_BATCH_ENDPOINT,
      completionWindow: ENRICH_COMPLETION_WINDOW,
    });
  });

  if ("error" in created) return { error: created.error.message, submitted, stats };
  return { batch: created.value, submitted, stats };
}

/**
 * One `/v1/responses` request line.
 *
 * `custom_id` is the `place_id` and nothing else — it is the only thing that
 * gets the answer back to the right place, since the Batch API returns lines in
 * completion order.
 *
 * `reasoning.effort` is `"none"` and is never omitted: the API default is
 * `medium`, so an unset effort quietly buys reasoning tokens for sixty tag
 * extractions.
 */
function batchLine(place: EnrichmentSubject, model: string) {
  return {
    custom_id: place.placeId,
    method: "POST",
    url: ENRICH_BATCH_ENDPOINT,
    body: {
      model,
      input: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(buildEnrichmentInput(place)) },
      ],
      reasoning: { effort: "none" },
      text: { format: jsonSchemaFormat("place_enrichment", EnrichmentOutputSchema) },
    },
  };
}

// ── the write path: collect ──────────────────────────────────────────────────

export interface CollectEnrichmentDeps {
  batches: BatchClient;
  store: EnrichmentStore;
  /**
   * The same rows that were submitted. Two jobs: it decides whether a returned
   * `custom_id` was ever asked for, and it supplies the payload the
   * `sourceHash` is recomputed from — submit and collect are separated by up to
   * a day, so nothing can be held in memory between them.
   */
  pool: readonly EnrichmentSubject[];
  /** Injected so `expiresAt` is decidable. Never `new Date()` inside. */
  now: Date;
  model?: string;
  promptVersion?: number;
  ttlDays?: number;
}

/** Why a returned line produced no stored row. Everything here resolves to a
 *  cache miss on the next read, which is how the retry happens — there is no
 *  inline retry against a 24-hour batch. */
export type EnrichmentFailureReason =
  | "api_error"
  | "no_output_text"
  | "malformed_output"
  | "schema_violation"
  | "empty_description";

export interface EnrichmentFailure {
  placeId: string;
  reason: EnrichmentFailureReason;
  message?: string;
}

export interface EnrichmentCollectStats {
  status: string;
  /** Non-blank lines in the output file. */
  lines: number;
  /** Lines that were not JSON at all. Dropped, not thrown. */
  malformedLines: number;
  /** Lines whose `custom_id` is in no pool row. Dropped, not thrown. */
  unknownCustomId: number;
  /** Lines read out of the batch's **error** file. Requests the provider never
   *  ran at all; they appear in no output file, so without this download they
   *  are invisible and `failed` undercounts by exactly this much. */
  errorFileLines: number;
  stored: number;
  failed: number;
  /** Rows offered to the `stay_duration` backfill. The store applies them only
   *  where the column is null, and it doesn't report back how many took. */
  stayDurationsOffered: number;
}

export interface CollectEnrichmentResult {
  batch: BatchHandle;
  /** True while the batch is still running. Nothing was downloaded or stored. */
  pending: boolean;
  /** Provider/file transport failed. A durable collector must leave this batch
   * open so a later run retries instead of losing a completed output file. */
  transportError?: string;
  /**
   * The rows were validated but the database refused them — a `locations` row
   * deleted under the foreign key, a connection dropped mid-write. Reported
   * rather than thrown for the same reason as `transportError`: a collector
   * sweeping ten batches must not lose the other nine to one bad write, and
   * the batch has to stay open so the next sweep retries it.
   */
  storeError?: string;
  stored: StoredEnrichment[];
  failures: EnrichmentFailure[];
  stats: EnrichmentCollectStats;
}

/**
 * Retrieves a batch and, once it is terminal, downloads the output file,
 * validates every line and writes the survivors.
 *
 * Nothing here throws. A batch that failed wholesale, an output file that won't
 * download, a line that isn't JSON, a `custom_id` nobody submitted — each is a
 * counter and, where a place can be named, a `failures` entry. The next
 * `readEnrichments` misses on all of them and the next batch asks again.
 */
export async function collectEnrichmentBatch(
  batchId: string,
  deps: CollectEnrichmentDeps,
): Promise<CollectEnrichmentResult> {
  const now = deps.now;
  const model = deps.model ?? MODELS.enrich;
  const promptVersion = deps.promptVersion ?? PROMPT_VERSIONS.enrich;
  const ttlDays = deps.ttlDays ?? DEFAULT_TTL_DAYS;
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  const bySubject = new Map(deps.pool.map((place) => [place.placeId, place]));
  const stats: EnrichmentCollectStats = {
    status: "unknown",
    lines: 0,
    malformedLines: 0,
    unknownCustomId: 0,
    errorFileLines: 0,
    stored: 0,
    failed: 0,
    stayDurationsOffered: 0,
  };

  const retrieved = await withRetry(() => deps.batches.retrieve(batchId));
  if ("error" in retrieved) {
    return {
      batch: { id: batchId, status: "unknown" },
      pending: true,
      transportError: retrieved.error.message,
      stored: [],
      failures: [],
      stats,
    };
  }

  const batch = retrieved.value;
  stats.status = batch.status;
  const done = TERMINAL_STATUSES.has(batch.status);
  if (!done) return { batch, pending: true, stored: [], failures: [], stats };

  const stored: StoredEnrichment[] = [];
  const failures: EnrichmentFailure[] = [];

  // The output file holds the requests the provider *ran*. A batch where every
  // request was rejected has no output file at all, which is why its absence is
  // not an early return any more — the error file below is then the only record
  // that anything happened.
  if (batch.outputFileId) {
    const outputFileId = batch.outputFileId;
    const downloaded = await withRetry(() => deps.batches.downloadJsonl(outputFileId));
    if ("error" in downloaded) {
      return {
        batch,
        pending: false,
        transportError: downloaded.error.message,
        stored: [],
        failures: [],
        stats,
      };
    }

    const body = downloaded.value;
    stats.lines = body.split("\n").filter((line) => line.trim().length > 0).length;
    const parsed = parseJsonl(body);
    stats.malformedLines = stats.lines - parsed.length;

    for (const line of parsed) {
      const row = line as BatchOutputLine;
      const placeId = typeof row.custom_id === "string" ? row.custom_id : undefined;
      // Position is never consulted. A line we can't name belongs to nobody.
      if (!placeId || !bySubject.has(placeId)) {
        stats.unknownCustomId += 1;
        continue;
      }

      const failure = readOutput(placeId, row);
      if ("reason" in failure) {
        failures.push(failure);
        continue;
      }
      stored.push({
        ...toEnrichment(failure.output),
        placeId,
        model,
        promptVersion,
        sourceHash: enrichmentSourceHash(bySubject.get(placeId)!),
        expiresAt,
      });
    }
  }

  // The error file is where the provider puts requests it never ran. Without
  // this download those places are invisible: they are in no output file, so
  // nothing counts them, and the only symptom is that the same sixty places
  // keep missing the cache forever with no recorded reason.
  if (batch.errorFileId) {
    const failed = await readErrorFile(batch.errorFileId, bySubject, deps, stats);
    failures.push(...failed);
  }

  stats.failed = failures.length;

  if (stored.length === 0) {
    stats.stored = 0;
    return { batch, pending: false, stored, failures, stats };
  }

  // The scalar the ladder's rung 1 reads. Midpoint of an already-clamped range,
  // so it is finite, positive and inside [MIN, MAX] by construction.
  const backfill = stored.map((row) => ({
    placeId: row.placeId,
    minutes: Math.round((row.avgVisitMinutes[0] + row.avgVisitMinutes[1]) / 2),
  }));

  // The store is the one dependency here that can still throw: `putMany` writes
  // through a foreign key to `locations`, so a place whose location row was
  // deleted between submit and collect rejects the whole insert. Reported, not
  // raised — the collector sweeps every open batch in one pass and a database
  // that refuses one of them must not cost the other nine.
  try {
    await deps.store.putMany(stored);
    await deps.store.updateStayDuration(backfill);
  } catch (error) {
    console.error(`[enrichment ${batchId}] the store refused ${stored.length} rows`, error);
    return {
      batch,
      pending: false,
      storeError: messageOf(error) ?? "the enrichment store refused the write",
      stored: [],
      failures,
      stats,
    };
  }

  stats.stored = stored.length;
  stats.stayDurationsOffered = backfill.length;
  return { batch, pending: false, stored, failures, stats };
}

/**
 * The batch's error file, turned into one `api_error` failure per named place.
 *
 * Downloading it is diagnostics, not data — every place in here resolves to a
 * cache miss on the next read whether or not we know why. So a download that
 * fails is logged and shrugged off rather than holding the batch open: the
 * alternative is a batch that can never reach terminal because one file is
 * permanently ungettable.
 */
async function readErrorFile(
  errorFileId: string,
  bySubject: ReadonlyMap<string, EnrichmentSubject>,
  deps: CollectEnrichmentDeps,
  stats: EnrichmentCollectStats,
): Promise<EnrichmentFailure[]> {
  const downloaded = await withRetry(() => deps.batches.downloadJsonl(errorFileId));
  if ("error" in downloaded) {
    console.error("[enrichment] could not download the batch error file", downloaded.error);
    return [];
  }

  const failures: EnrichmentFailure[] = [];
  for (const line of parseJsonl(downloaded.value)) {
    stats.errorFileLines += 1;
    const row = line as BatchOutputLine;
    const placeId = typeof row.custom_id === "string" ? row.custom_id : undefined;
    if (!placeId || !bySubject.has(placeId)) {
      stats.unknownCustomId += 1;
      continue;
    }
    failures.push({
      placeId,
      reason: "api_error",
      message: providerErrorMessage(row.error),
    });
  }
  return failures;
}

/** One line of a Batch output file. */
interface BatchOutputLine {
  custom_id?: unknown;
  response?: { status_code?: number; body?: unknown } | null;
  error?: unknown;
}

/** Everything between a returned line and a validated answer, in one place so
 *  each failure shape gets its own reason rather than a shared "bad row". */
function readOutput(
  placeId: string,
  row: BatchOutputLine,
): { output: EnrichmentOutput } | EnrichmentFailure {
  const status = row.response?.status_code;
  if (row.error != null || (typeof status === "number" && status >= 400)) {
    return { placeId, reason: "api_error", message: messageOf(row.error) };
  }

  const text = outputTextOf(row.response?.body);
  if (text === undefined) return { placeId, reason: "no_output_text" };

  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    return { placeId, reason: "malformed_output", message: messageOf(error) };
  }

  const validated = EnrichmentOutputSchema.safeParse(json);
  if (!validated.success) {
    return { placeId, reason: "schema_violation", message: validated.error.message };
  }
  // Structured output constrains shape, never usefulness. An empty description
  // would leave Pass C's fallback with a bare name and a time.
  if (!isUsable(validated.data)) return { placeId, reason: "empty_description" };
  return { output: validated.data };
}

/**
 * `output_text` is an SDK convenience that does not exist in the raw JSON a
 * Batch output file carries, so the `output[].content[]` walk is the real path
 * and the flat field is the fallback for a hand-written fixture.
 */
function outputTextOf(body: unknown): string | undefined {
  const response = body as { output_text?: unknown; output?: unknown } | null | undefined;
  if (typeof response?.output_text === "string" && response.output_text.length > 0) {
    return response.output_text;
  }
  const output = Array.isArray(response?.output) ? response.output : [];
  const parts = output.flatMap((item) => {
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) return [];
    return content.flatMap((part) => {
      const typed = part as { type?: unknown; text?: unknown };
      return typed.type === "output_text" && typeof typed.text === "string" ? [typed.text] : [];
    });
  });
  return parts.length > 0 ? parts.join("") : undefined;
}

/**
 * An error-file line's `error` is `{ code, message }`, not an `Error` — running
 * it through `messageOf` would store the whole object as JSON and bury the one
 * sentence a person needs.
 */
function providerErrorMessage(error: unknown): string {
  const detail = error as { code?: unknown; message?: unknown } | null | undefined;
  if (typeof detail?.message === "string" && detail.message.length > 0) {
    return typeof detail.code === "string" ? `${detail.code}: ${detail.message}` : detail.message;
  }
  return messageOf(error) ?? "the provider rejected this request";
}

function messageOf(error: unknown): string | undefined {
  if (error == null) return undefined;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}
