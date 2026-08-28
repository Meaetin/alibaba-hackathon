/**
 * Cached LLM enrichment — "Beyond-Google Data" in
 * `docs/personalization-pipeline.md`. One profile-agnostic paragraph, a tag
 * list and a visit-length estimate per place, paid for once and cached 90 days.
 *
 * Two paths, and the planner uses both inside one request:
 *
 *   read path   `readEnrichments(placeIds, deps)`  — cache lookup, no network
 *   write path  `enrichPlaces(subjects, deps)`     — ask now, store, return
 *
 * **A miss is not an error.** A place with no cached enrichment falls to the
 * type-heuristic rung of `resolveVisitDuration` and ships without a description.
 * Nothing here throws at the planner; failures are counted and returned.
 *
 * One rule worth stating out loud, because it fails silently:
 *
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
  withBackoff,
  type ResponsesClient,
  type ResponsesRequest,
} from "./openai";
import { mapWithConcurrency } from "./http";
import { addUsage, emptyStageUsage, type StageUsage } from "./pricing";
import type { RetrievedPlace } from "./retrieval";
import type { PlaceEnrichment } from "./types";

// ── shared constants ─────────────────────────────────────────────────────────

const DEFAULT_TTL_DAYS = 90;

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
 * the enricher a whole `RetrievedPlace` and the whole `RetrievedPlace` is what
 * reaches the prompt, coordinates and photo names and all. Nothing downstream
 * reads those fields (`enrichmentSourceHash` digests `buildEnrichmentInput`
 * alone), so this is payload size, not correctness. Call it at every boundary
 * that sends a subject.
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
  /** Places worth handing to `enrichPlaces`. Ids absent from `pool` are not
   *  here — there is no payload to enrich them from. */
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

/** Why a place produced no stored enrichment. Everything here resolves to a
 *  cache miss on the next read, which is how the retry happens. */
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

/**
 * The one request the live path sends, kept as its own function because
 * `enrichmentSourceHash` digests `buildEnrichmentInput` — the request and the
 * hash have to be built from the same shape or a stored row reads as stale to
 * its own reader.
 */
export function buildEnrichmentRequest(
  place: EnrichmentSubject,
  model: string,
): ResponsesRequest {
  return {
    model,
    input: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(buildEnrichmentInput(place)) },
    ],
    reasoning: { effort: "none" },
    text: { format: jsonSchemaFormat("place_enrichment", EnrichmentOutputSchema) },
  };
}

// ── the write path: live ─────────────────────────────────────────────────────

/**
 * How many enrichment calls are in flight at once.
 *
 * Measured against a real 58-place shortlist on this account: 8 took 19.6s, 16
 * took 11.4s, and 24 and 32 bought nothing more than a longer tail — 32's worst
 * call was 8.9s against 3.7s at 16. No 429 at any level, because the binding
 * limit is not requests (58 against 500/min) but tokens: one pass burns ~48k of
 * a 200,000/min budget, so roughly three plans a minute is the ceiling however
 * this is set. 16 is the knee of the curve.
 */
export const ENRICH_CONCURRENCY = 16;

export interface EnrichPlacesDeps {
  client: ResponsesClient;
  store: EnrichmentStore;
  /** Injected so `expiresAt` is decidable. Never `new Date()` inside. */
  now: Date;
  model?: string;
  promptVersion?: number;
  concurrency?: number;
  retries?: number;
  /** Injected for the same reason as `now` — a test that really waits four
   *  seconds for a backoff is a test nobody runs. */
  sleep?: (ms: number) => Promise<void>;
}

export interface EnrichPlacesStats {
  requested: number;
  /** Places that came back with a usable answer and were stored. */
  enriched: number;
  /** Places that did not. Each one falls to the type heuristic in
   *  `duration.ts`, exactly as a cache miss did before this path existed. */
  failed: number;
  /** The database refused the write. The answers are still returned and used
   *  for *this* plan; what is lost is the cache for the next one. */
  storeError?: string;
  /** Tokens, for `stats.cost`. Attributable to this plan, unlike the batch. */
  usage: StageUsage;
}

export interface EnrichPlacesResult {
  enrichments: Map<string, PlaceEnrichment>;
  failures: EnrichmentFailure[];
  stats: EnrichPlacesStats;
}

/**
 * Enrich a shortlist now, rather than queueing it for tomorrow.
 *
 * The batch path is half price and up to 24 hours, which makes it a cache
 * *warmer*: its answers reach the next plan touching those places, never the
 * one that paid to queue them. That is why every first trip to a new city
 * shipped on the type table — a park was 60 minutes because `park` is 60
 * minutes in `duration.ts`, and the itinerary looked complete.
 *
 * This is the same request, sent now. It costs about a cent more per trip and
 * ~11 seconds inside a stage that already reports progress.
 *
 * **Nothing here throws.** A place that fails is a place that falls to the type
 * heuristic, which is precisely what a cache miss already did — so a bad minute
 * at the provider degrades a trip's durations and never its existence. The
 * counters are how you tell the two apart.
 */
export async function enrichPlaces(
  subjects: readonly EnrichmentSubject[],
  deps: EnrichPlacesDeps,
): Promise<EnrichPlacesResult> {
  const model = deps.model ?? MODELS.enrich;
  const promptVersion = deps.promptVersion ?? PROMPT_VERSIONS.enrich;
  const wanted = dedupeSubjects(subjects);

  const stats: EnrichPlacesStats = {
    requested: wanted.length,
    enriched: 0,
    failed: 0,
    usage: emptyStageUsage("enrich", model),
  };
  const enrichments = new Map<string, PlaceEnrichment>();
  const failures: EnrichmentFailure[] = [];
  if (wanted.length === 0) return { enrichments, failures, stats };

  const expiresAt = new Date(deps.now.getTime() + DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);
  const rows: StoredEnrichment[] = [];

  await mapWithConcurrency(wanted, deps.concurrency ?? ENRICH_CONCURRENCY, async (place: EnrichmentSubject) => {
    const outcome = await withBackoff(
      () => deps.client.create(buildEnrichmentRequest(place, model)),
      { retries: deps.retries ?? 2, sleep: deps.sleep },
    );

    if ("error" in outcome) {
      failures.push({ placeId: place.placeId, reason: "api_error", message: outcome.error.message });
      return;
    }
    // Counted whatever came back. A response that failed to parse was still
    // generated and still billed; costing only the usable ones would make a bad
    // run look cheap.
    stats.usage = addUsage(stats.usage, outcome.value.usage);

    const result = readResponseText(place.placeId, outcome.value.output_text);
    if ("reason" in result) {
      // A response cut off at the token cap parses exactly like a model that
      // wrote nonsense, and the two need different fixes — so the truncation
      // reason rides along in the message rather than being lost.
      const truncated = outcome.value.status === "incomplete";
      failures.push(
        truncated
          ? { ...result, message: `incomplete: ${outcome.value.incompleteReason ?? "unknown"}` }
          : result,
      );
      return;
    }

    const enrichment = toEnrichment(result.output);
    enrichments.set(place.placeId, enrichment);
    rows.push({
      ...enrichment,
      placeId: place.placeId,
      model,
      promptVersion,
      sourceHash: enrichmentSourceHash(place),
      expiresAt,
    });
  });

  stats.enriched = rows.length;
  stats.failed = failures.length;

  // The store is the one thing here allowed to be a problem, and it still is
  // not fatal: these answers are already in `enrichments` and this plan will
  // use them. A refused write costs the *next* plan a cache hit, so it is
  // reported rather than thrown.
  if (rows.length > 0) {
    try {
      await deps.store.putMany(rows);
      await deps.store.updateStayDuration(stayDurationBackfill(rows));
    } catch (error) {
      stats.storeError = messageOf(error);
      console.error("[enrich] answers could not be cached", error);
    }
  }

  return { enrichments, failures, stats };
}

/**
 * The scalar rung 1 of the visit-duration ladder reads. Midpoint of an
 * already-clamped range, so it is finite, positive and inside [MIN, MAX] by
 * construction. Shared by both write paths — a live answer and a batched one
 * must backfill `locations.stay_duration` the same way or the same place gets
 * two lengths depending on which path found it.
 */
function stayDurationBackfill(
  rows: readonly StoredEnrichment[],
): { placeId: string; minutes: number }[] {
  return rows.map((row) => ({
    placeId: row.placeId,
    minutes: Math.round((row.avgVisitMinutes[0] + row.avgVisitMinutes[1]) / 2),
  }));
}

function dedupeSubjects(subjects: readonly EnrichmentSubject[]): EnrichmentSubject[] {
  const seen = new Map<string, EnrichmentSubject>();
  // Projected on the way in, not merely typed: `EnrichmentSubject` is a `Pick`,
  // which is compile-time only, so a whole `RetrievedPlace` handed in here would
  // reach `enrichmentSourceHash` carrying coordinates and photo names.
  for (const place of subjects) {
    if (!seen.has(place.placeId)) seen.set(place.placeId, toEnrichmentSubject(place));
  }
  return [...seen.values()];
}

/**
 * One model answer, validated. Every rejection is a named `EnrichmentFailure`
 * rather than a throw: a place that fails falls to the type heuristic, which is
 * exactly what a cache miss already did.
 */
function readResponseText(
  placeId: string,
  text: string,
): { output: EnrichmentOutput } | EnrichmentFailure {
  if (text.trim().length === 0) return { placeId, reason: "no_output_text" };
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
  if (!isUsable(validated.data)) return { placeId, reason: "empty_description" };
  return { output: validated.data };
}

function messageOf(error: unknown): string | undefined {
  if (error == null) return undefined;
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : JSON.stringify(error);
}
