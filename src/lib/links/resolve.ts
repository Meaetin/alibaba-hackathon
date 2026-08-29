/**
 * Turning "Senso-ji Temple, Tokyo, Japan" into a row in `locations`.
 *
 * Argo did this in `services/location-orchestrator.ts`, a 477-line stage with
 * its own geocode cache, relevance scoring and persistence. This is the same
 * idea at a tenth of the size, because the planner already owns every piece:
 * `retrievePlaces` searches, caches for thirty days, writes the `locations`
 * row, and refuses to publish a cache entry until those rows land.
 *
 * ## Why one call per mention rather than one call for all of them
 *
 * `retrievePlaces` takes many requests, which looks like the obvious fit until
 * you read what it returns: a single flat list, deduplicated across requests
 * and skipping any request that matched nothing. Given five mentions and four
 * places back, there is no way to say which mention lost — and if two mentions
 * name the same venue, the second silently has nothing. A mention has to keep
 * its own answer, so it gets its own call.
 *
 * The cost of that is nothing: `pageSize: 1` means each call bills one Text
 * Search, which is exactly what a batched call would have billed, and the
 * thirty-day cache makes a re-run of the same video free.
 */

import { mapWithConcurrency } from "@/lib/planner/http";
import {
  mergeRetrievalStats,
  retrievePlaces,
  type FetchLike,
  type LocationStore,
  type RetrievalStats,
  type SearchCache,
  type SearchRequest,
} from "@/lib/planner/retrieval";

import type { LinkAnalysis, ResolvedLocation } from "./types";

/** Text Searches in flight. Matches `retrievePlaces`' own internal default. */
export const RESOLVE_CONCURRENCY = 4;

/** The top match, and only the top match. A mention names one venue; ranking
 *  twenty candidates for it is a different feature with a different budget. */
const PAGE_SIZE = 1;

export interface ResolveDeps {
  apiKey: string;
  cache: SearchCache;
  store: LocationStore;
  fetch?: FetchLike;
  /** Injected so cache expiry is decidable, exactly as in the planner. */
  now?: Date;
  concurrency?: number;
}

export interface ResolveResult {
  resolved: ResolvedLocation[];
  /** Undefined when nothing was searched. "We did not ask" and "we asked and
   *  Google had nothing" must not read the same. */
  stats?: RetrievalStats;
}

function emptyStats(): RetrievalStats {
  return {
    requested: 0,
    unique: 0,
    cacheHits: 0,
    cacheMisses: 0,
    billedCalls: 0,
    seen: 0,
    duplicatesDropped: 0,
    missingFromStore: 0,
    failures: [],
  };
}

/**
 * The `city` field on the search.
 *
 * It is not sent to Google — the mention already carries its own locality and
 * country — but it is part of the cache key and it becomes `locations.city` on
 * anything newly stored. The region is preferred over the country because
 * "Tokyo" is a more useful thing to have on the row than "Japan", and both are
 * preferred over the empty string, which stores a row nothing can group.
 */
function cityFor(analysis: LinkAnalysis): string {
  return analysis.primaryRegion?.trim() || analysis.primaryCountry?.trim() || "";
}

/**
 * Resolves every place the model named.
 *
 * **A video that is not about places buys nothing.** The guard is here rather
 * than at the call site because this is the only stage that spends money at
 * Google, and a gaming video whose model output happens to contain a stray
 * string should not cost a Text Search to find that out.
 *
 * A mention that matches nothing is kept with `place: null` and a reason. It is
 * the difference between "the model invented a restaurant" and "Google was
 * down", and a list that quietly gets shorter can say neither.
 */
export async function resolveLocations(
  analysis: LinkAnalysis,
  deps: ResolveDeps,
): Promise<ResolveResult> {
  if (!analysis.isLocationRelated) return { resolved: [] };

  // Deduplicated case-insensitively, first spelling kept: a model that names
  // the same cafe twice should not be billed for it twice.
  const seen = new Set<string>();
  const mentions: string[] = [];
  for (const raw of analysis.locations) {
    const mention = raw.trim();
    const key = mention.toLowerCase();
    if (mention.length > 0 && !seen.has(key)) {
      seen.add(key);
      mentions.push(mention);
    }
  }
  if (mentions.length === 0) return { resolved: [], stats: emptyStats() };

  const city = cityFor(analysis);

  const outcomes = await mapWithConcurrency(
    mentions,
    deps.concurrency ?? RESOLVE_CONCURRENCY,
    async (mention): Promise<{ resolved: ResolvedLocation; stats: RetrievalStats }> => {
      const request: SearchRequest = { city, query: mention };
      const result = await retrievePlaces([request], {
        apiKey: deps.apiKey,
        cache: deps.cache,
        store: deps.store,
        fetch: deps.fetch,
        now: deps.now,
        pageSize: PAGE_SIZE,
      });

      const place = result.places[0];
      if (place) return { resolved: { mention, place }, stats: result.stats };

      // `retrievePlaces` never throws on a bad query — it records the failure
      // and returns an empty list — so the two empty cases are told apart by
      // asking whether anything went wrong, not by catching.
      const reason = result.stats.failures.length > 0 ? "search_failed" : "no_match";
      return { resolved: { mention, place: null, reason }, stats: result.stats };
    },
  );

  return {
    resolved: outcomes.map((outcome) => outcome.resolved),
    stats: outcomes.reduce((total, outcome) => mergeRetrievalStats(total, outcome.stats), emptyStats()),
  };
}
