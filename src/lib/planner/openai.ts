/**
 * The OpenAI boundary, in one file, for the same reason `http.ts` exists: three
 * modules bill this vendor (enrichment, Pass B, Pass C) and every one of them
 * has to be testable with zero network.
 *
 * What lives here is only what all three share — the model table, the effort
 * ladder, and two narrow ports. Prompts, schemas, retry semantics and failure
 * handling belong to the module that owns the call, because those are the parts
 * worth reading in a diff.
 *
 * Everything below is the **Responses** API (`client.responses.*`), never Chat
 * Completions. The two differ in request shape and mixing them is the standard
 * way to end up with code that half-works.
 */

import type OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";

/**
 * Three call sites with nothing in common but the vendor, so three entries.
 * A single model everywhere reads as simplicity and prices like carelessness.
 *
 * Frontier (`gpt-5.6-sol`) is deliberately absent: nothing in this pipeline
 * asks a model to do anything hard. Code owns the clock, the geometry and the
 * filtering; the model puts ids in buckets and writes two sentences.
 */
export const MODELS = {
  /** Pass B. One call per itinerary, constrained combinatorial work plus
   *  arithmetic against a stated minute budget. The one place a cheap model's
   *  failure is expensive, because a bad assignment costs a repair loop. */
  assign: "gpt-5.6-terra",
  /** Pass C. ~15 short prose calls per itinerary, no reasoning. */
  narrate: "gpt-5.6-luna",
  /** Enrichment. ~60 batched tag extractions. Explicitly not a reasoning task. */
  enrich: "gpt-5.6-luna",
} as const;

/**
 * The full ladder. `medium` is the API default, which is exactly why every call
 * site sets this explicitly — an unset effort silently buys reasoning tokens
 * for tag extraction.
 */
export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Bumped when *we* change a prompt. The 90-day TTL never catches that: the
 * cached row is still fresh, still the same model, and now answers a question
 * we stopped asking. Keyed by module so one prompt edit doesn't invalidate the
 * other module's cache.
 */
export const PROMPT_VERSIONS = {
  enrich: 1,
} as const;

// ── the Responses port (Pass B, Pass C) ──────────────────────────────────────

/** One turn of input. `input` is an array so the shared prefix is addressable
 *  as its own blocks — see `prompt_cache_key` below. */
export interface ResponseInputText {
  type: "input_text";
  text: string;
  prompt_cache_breakpoint?: { mode: "explicit" };
}

export interface ResponseInputBlock {
  role: "system" | "developer" | "user" | "assistant";
  content: string | ResponseInputText[];
}

export interface ResponsesRequest {
  model: string;
  input: ResponseInputBlock[];
  /** Never omitted. See `ReasoningEffort`. */
  reasoning: { effort: ReasoningEffort };
  /** `{ format: jsonSchemaFormat(...) }` for a structured response. */
  text?: { format: unknown };
  /**
   * Routes calls that share a prefix to the same cache. OpenAI's prompt caching
   * is automatic — there is no breakpoint to place — but it routes on a prefix
   * hash, so this must be a per-itinerary constant, never a per-stop one.
   */
  prompt_cache_key?: string;
  /** GPT-5.6 supports explicit-only caching for a stable prefix followed by
   * request-specific content. */
  prompt_cache_options?: { mode: "explicit" | "implicit"; ttl?: "30m" };
  max_output_tokens?: number;
}

export interface ResponsesUsage {
  input_tokens?: number;
  output_tokens?: number;
  /** `cached_tokens` at 0 across a fan-out means the prefix is not shared.
   *  Diff two rendered requests before touching anything else. */
  input_tokens_details?: { cached_tokens?: number };
}

export interface ResponsesResult {
  output_text: string;
  usage?: ResponsesUsage;
  /**
   * `"completed"`, `"incomplete"`, `"failed"`. Carried because an `incomplete`
   * response still arrives with a 200 and a partial `output_text` — which parses
   * as broken JSON and is otherwise indistinguishable from a model that simply
   * wrote nonsense. The two need different fixes, so they need different names.
   */
  status?: string;
  /** Why an `incomplete` response stopped, e.g. `"max_output_tokens"`. */
  incompleteReason?: string;
}

/**
 * The subset of `client.responses` the pipeline uses. Narrow on purpose: a test
 * double is four lines, and the real SDK still satisfies it via
 * `createResponsesClient`.
 */
export interface ResponsesClient {
  create(request: ResponsesRequest): Promise<ResponsesResult>;
}

export function createResponsesClient(client: OpenAI): ResponsesClient {
  return {
    async create(request) {
      const response = await client.responses.create({
        ...(request as unknown as Record<string, never>),
        stream: false,
      });
      const incomplete = response.incomplete_details as { reason?: string } | null | undefined;
      return {
        output_text: response.output_text ?? "",
        usage: response.usage as ResponsesUsage | undefined,
        status: response.status,
        incompleteReason: incomplete?.reason,
      };
    },
  };
}

/**
 * `text.format` for a structured response. Schema conformance is enforced at
 * the API layer, so there is no JSON-repair loop to write.
 *
 * It constrains *shape*, never *truth*: a perfectly-formed response can still
 * name a place that was never retrieved. The membership check stays ours.
 */
export function jsonSchemaFormat(name: string, schema: z.ZodType): unknown {
  return zodTextFormat(schema, name);
}

// ── the Batch port (enrichment) ──────────────────────────────────────────────

/** Terminal statuses are `completed`, `failed`, `expired` and `cancelled`. */
export interface BatchHandle {
  id: string;
  status: string;
  outputFileId?: string;
  errorFileId?: string;
}

/**
 * The Batch API, reduced to four verbs over JSONL strings. The SDK's file
 * upload wants an `Uploadable`; keeping that out of the port means the fake is
 * a `Map<string, string>` and the tests never build a `File`.
 */
export interface BatchClient {
  uploadJsonl(body: string, filename: string): Promise<string>;
  create(input: {
    inputFileId: string;
    endpoint: string;
    completionWindow: string;
  }): Promise<BatchHandle>;
  retrieve(batchId: string): Promise<BatchHandle>;
  downloadJsonl(fileId: string): Promise<string>;
}

export function createBatchClient(client: OpenAI): BatchClient {
  const toHandle = (batch: {
    id: string;
    status: string;
    output_file_id?: string | null;
    error_file_id?: string | null;
  }): BatchHandle => ({
    id: batch.id,
    status: batch.status,
    outputFileId: batch.output_file_id ?? undefined,
    errorFileId: batch.error_file_id ?? undefined,
  });

  return {
    async uploadJsonl(body, filename) {
      const file = new File([body], filename, { type: "application/jsonl" });
      const uploaded = await client.files.create({ file, purpose: "batch" });
      return uploaded.id;
    },
    async create({ inputFileId, endpoint, completionWindow }) {
      const batch = await client.batches.create({
        input_file_id: inputFileId,
        endpoint: endpoint as "/v1/responses",
        completion_window: completionWindow as "24h",
      });
      return toHandle(batch);
    },
    async retrieve(batchId) {
      return toHandle(await client.batches.retrieve(batchId));
    },
    async downloadJsonl(fileId) {
      return await (await client.files.content(fileId)).text();
    },
  };
}

// ── shared helpers ───────────────────────────────────────────────────────────

/**
 * One retry, then give up and let the caller degrade. Not a backoff policy:
 * every call site here has a deterministic fallback, so a job that keeps
 * retrying is strictly worse than one that ships the fallback.
 */
export async function withRetry<T>(
  attempt: () => Promise<T>,
  retries = 1,
): Promise<{ value: T } | { error: Error }> {
  let last: Error = new Error("no attempt made");
  for (let i = 0; i <= retries; i++) {
    try {
      return { value: await attempt() };
    } catch (error) {
      last = error instanceof Error ? error : new Error(String(error));
    }
  }
  return { error: last };
}

/** JSONL in, one parsed object per non-blank line. Batch output and error
 *  files are both this shape; a malformed line is skipped, not fatal. */
export function parseJsonl(body: string): unknown[] {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}
