/**
 * Shared plumbing for the pipeline's Seam modules — retrieval, photos, and
 * later enrichment. Two things live here, and both exist so a billed call is
 * testable without a network.
 *
 * There is no HTTP client and no retry policy on purpose: each Seam module owns
 * its own endpoint, field mask and failure semantics, because those are the
 * parts worth reading in a diff.
 */

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/**
 * The subset of `fetch` the pipeline uses. Narrow on purpose: a test double is
 * six lines, and `globalThis.fetch` still satisfies it.
 */
export interface FetchLike {
  (
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<HttpResponse>;
}

/**
 * Order-preserving bounded-concurrency map. No dependency, no scheduler.
 *
 * Every caller here is fanning out over *billed* calls, so the bound is a cost
 * and rate-limit control, not a performance tweak — raising it does not make a
 * run cheaper.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}
