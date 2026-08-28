import { describe, expect, it, vi } from "vitest";

import {
  MAX_VISIT_MINUTES,
  MIN_VISIT_MINUTES,
  buildEnrichmentInput,
  buildEnrichmentRequest,
  clampVisitMinutes,
  createInMemoryEnrichmentStore,
  enrichPlaces,
  enrichmentSourceHash,
  readEnrichments,
  toEnrichmentSubject,
  type EnrichmentStore,
  type EnrichmentSubject,
  type StoredEnrichment,
} from "./enrich";
import {
  MODELS,
  PROMPT_VERSIONS,
  type ResponsesClient,
  type ResponsesResult,
} from "./openai";
import { resolveVisitDuration } from "./duration";
import type { CandidatePlace } from "./types";

const NOW = new Date("2026-08-24T09:00:00Z");
const LATER = new Date("2026-12-01T09:00:00Z");

// ── fixtures ─────────────────────────────────────────────────────────────────

function subject(placeId: string, overrides: Partial<EnrichmentSubject> = {}): EnrichmentSubject {
  return {
    placeId,
    name: `Place ${placeId}`,
    types: ["tourist_attraction"],
    rating: 4.5,
    userRatingCount: 1200,
    reviewSnippets: [{ rating: 5, text: "Lovely at sunset." }],
    editorialSummary: "A landmark.",
    reviewSummary: undefined,
    ...overrides,
  };
}

/** A cached row that is fresh on all four fields for `place`. */
function fresh(place: EnrichmentSubject, overrides: Partial<StoredEnrichment> = {}): StoredEnrichment {
  return {
    placeId: place.placeId,
    description: `About ${place.name}.`,
    tags: ["scenic"],
    confidence: 0.8,
    avgVisitMinutes: [45, 90],
    model: MODELS.enrich,
    promptVersion: PROMPT_VERSIONS.enrich,
    sourceHash: enrichmentSourceHash(place),
    expiresAt: LATER,
    ...overrides,
  };
}

// ── the read path: all four freshness fields ─────────────────────────────────

describe("readEnrichments freshness", () => {
  const place = subject("p1");

  it("returns the cached row when all four fields agree", async () => {
    const store = createInMemoryEnrichmentStore([fresh(place)]);

    const result = await readEnrichments(["p1"], { store, pool: [place], now: NOW });

    expect(result.misses).toEqual([]);
    expect(result.enrichments.get("p1")?.description).toBe("About Place p1.");
    expect(result.stats.hits).toBe(1);
  });

  it("misses on a row whose expires_at has passed", async () => {
    const store = createInMemoryEnrichmentStore([
      fresh(place, { expiresAt: new Date("2026-08-24T08:59:59Z") }),
    ]);

    const result = await readEnrichments(["p1"], { store, pool: [place], now: NOW });

    expect(result.misses).toEqual(["p1"]);
    expect(result.enrichments.size).toBe(0);
    expect(result.stats.expired).toBe(1);
  });

  it("misses on a row written by a different model", async () => {
    const store = createInMemoryEnrichmentStore([fresh(place, { model: "gpt-4o-mini" })]);

    const result = await readEnrichments(["p1"], { store, pool: [place], now: NOW });

    expect(result.misses).toEqual(["p1"]);
    expect(result.stats.staleModel).toBe(1);
  });

  /** The bug the design doc names by hand: the row is fresh, the model matches,
   *  and it answers a question we stopped asking. */
  it("misses on a row written by an older prompt version", async () => {
    const store = createInMemoryEnrichmentStore([
      fresh(place, { promptVersion: PROMPT_VERSIONS.enrich - 1 }),
    ]);

    const result = await readEnrichments(["p1"], { store, pool: [place], now: NOW });

    expect(result.misses).toEqual(["p1"]);
    expect(result.stats.stalePromptVersion).toBe(1);
  });

  it("misses when the reviews the answer was written from have changed", async () => {
    const store = createInMemoryEnrichmentStore([fresh(place)]);
    const rewritten = subject("p1", {
      reviewSnippets: [{ rating: 2, text: "Under scaffolding all summer." }],
    });

    const result = await readEnrichments(["p1"], { store, pool: [rewritten], now: NOW });

    expect(result.misses).toEqual(["p1"]);
    expect(result.stats.staleSourceHash).toBe(1);
    // The other three are untouched, so the stats say which field went stale.
    expect(result.stats.expired).toBe(0);
    expect(result.stats.staleModel).toBe(0);
    expect(result.stats.stalePromptVersion).toBe(0);
  });

  it("changes the hash when the summaries change, not only the reviews", () => {
    const withSummary = subject("p1", { reviewSummary: "Reviewers call it serene." });
    expect(enrichmentSourceHash(withSummary)).not.toBe(enrichmentSourceHash(place));
  });

  it("hashes the same subject to the same digest across calls", () => {
    expect(enrichmentSourceHash(subject("p1"))).toBe(enrichmentSourceHash(subject("p1")));
  });
});

// ── the read path: a miss must not block ─────────────────────────────────────

describe("readEnrichments degradation", () => {
  it("returns the hits, reports the misses, and does not throw", async () => {
    const hit = subject("hit");
    const miss = subject("miss");
    const store = createInMemoryEnrichmentStore([fresh(hit)]);

    const result = await readEnrichments(["hit", "miss"], {
      store,
      pool: [hit, miss],
      now: NOW,
    });

    expect([...result.enrichments.keys()]).toEqual(["hit"]);
    expect(result.misses).toEqual(["miss"]);
    expect(result.stats).toMatchObject({ requested: 2, hits: 1, misses: 1, absent: 1 });
  });

  /** The point of the miss: `resolveVisitDuration` falls to rung 3 and the stop
   *  still gets a sane, positive length. */
  it("leaves an unenriched place on the type-heuristic rung", async () => {
    const miss = subject("miss", { types: ["museum"] });
    const store = createInMemoryEnrichmentStore();

    const result = await readEnrichments(["miss"], { store, pool: [miss], now: NOW });

    const place: CandidatePlace = { placeId: "miss", name: "Museum", types: ["museum"] };
    const duration = resolveVisitDuration(place, result.enrichments.get("miss"), "balanced");
    expect(duration.preferred).toBe(90);
    expect(duration.min).toBeGreaterThan(0);
  });

  it("counts an id with no pool row instead of throwing, and never calls the store for it", async () => {
    const known = subject("known");
    const getMany = vi.fn(async () => []);
    const store = { ...createInMemoryEnrichmentStore(), getMany };

    const result = await readEnrichments(["known", "ghost"], {
      store,
      pool: [known],
      now: NOW,
    });

    expect(result.stats.notInPool).toBe(1);
    expect(result.misses).toEqual(["known"]);
    expect(getMany).toHaveBeenCalledWith(["known"]);
  });
});

// ── the request ──────────────────────────────────────────────────────────────

// ── the response: keyed by custom_id, never by position ──────────────────────

// ── the response: what gets dropped, and why ─────────────────────────────────

// ── the stay_duration backfill ───────────────────────────────────────────────

// ── the clamp ────────────────────────────────────────────────────────────────

describe("clampVisitMinutes", () => {
  it("turns a zero range into a floor rather than a zero-minute activity", () => {
    expect(clampVisitMinutes([0, 0])).toEqual([MIN_VISIT_MINUTES, MIN_VISIT_MINUTES]);
  });

  it("sorts a reversed range so preferred never lands below min", () => {
    expect(clampVisitMinutes([120, 30])).toEqual([30, 120]);
  });

  it("caps a range that would eat the whole day", () => {
    expect(clampVisitMinutes([600, 1440])).toEqual([MAX_VISIT_MINUTES, MAX_VISIT_MINUTES]);
  });

  it("leaves a sane range untouched", () => {
    expect(clampVisitMinutes([45, 90])).toEqual([45, 90]);
  });

  it("rejects negatives and non-finite endpoints", () => {
    expect(clampVisitMinutes([-30, -10])).toEqual([MIN_VISIT_MINUTES, MIN_VISIT_MINUTES]);
    expect(clampVisitMinutes([Number.NaN, 60])).toEqual([60, 60]);
    expect(clampVisitMinutes([Number.NaN, Number.NaN])).toEqual([60, 60]);
  });

  /** The carried-over bug, stated as the thing it prevents downstream. */
  it("keeps resolveVisitDuration honest for every broken shape", () => {
    const place: CandidatePlace = { placeId: "p", name: "P", types: [] };
    for (const range of [
      [0, 0],
      [120, 30],
      [9999, 9999],
      [-5, 0],
    ] as const) {
      const duration = resolveVisitDuration(
        place,
        { avgVisitMinutes: clampVisitMinutes(range) },
        "packed",
      );
      expect(duration.min).toBeGreaterThanOrEqual(MIN_VISIT_MINUTES);
      expect(duration.max).toBeLessThanOrEqual(MAX_VISIT_MINUTES);
      expect(duration.preferred).toBeGreaterThanOrEqual(duration.min);
      expect(duration.preferred).toBeLessThanOrEqual(duration.max);
    }
  });

  it("clamps a stored row on the way out of the cache, not only on the way in", async () => {
    const place = subject("p1");
    const store = createInMemoryEnrichmentStore([
      fresh(place, { avgVisitMinutes: [0, 5000] }),
    ]);

    const result = await readEnrichments(["p1"], { store, pool: [place], now: NOW });

    expect(result.enrichments.get("p1")?.avgVisitMinutes).toEqual([
      MIN_VISIT_MINUTES,
      MAX_VISIT_MINUTES,
    ]);
  });

});

// ── the subject projection ───────────────────────────────────────────────────

describe("toEnrichmentSubject", () => {
  it("drops everything the pass does not read, so a whole location row is never sent", () => {
    const fat = {
      ...subject("a"),
      latitude: 35.0,
      longitude: 135.7,
      formattedAddress: "somewhere",
      photoNames: ["places/a/photos/1"],
      openingPeriods: [{ open: { day: 1, hour: 9, minute: 0 } }],
    } as unknown as EnrichmentSubject;

    const projected = toEnrichmentSubject(fat);

    expect(Object.keys(projected).sort()).toEqual([
      "editorialSummary",
      "name",
      "placeId",
      "rating",
      "reviewSnippets",
      "reviewSummary",
      "types",
      "userRatingCount",
    ]);
  });

  it("hashes to the same digest as the row it came from", () => {
    const place = subject("a");
    expect(enrichmentSourceHash(toEnrichmentSubject(place))).toBe(enrichmentSourceHash(place));
  });
});

// ── the live path ────────────────────────────────────────────────────────────

/**
 * `enrichPlaces` is the answer to a question the batch could not answer: the
 * batch is half price and up to 24 hours, so its results reach the *next* plan
 * touching a place, never the one that queued them. Every first trip to a new
 * city therefore sized its visits from the type table in `duration.ts` and
 * looked complete doing it.
 *
 * Which is also why the assertions below are on the counters. Every failure
 * here degrades to that same type table, so a broken implementation still
 * produces a whole itinerary — `stats.failed` is the only thing that can tell
 * a working run from a silently useless one.
 */
describe('enrichPlaces', () => {
  const subject = (id: string, over: Partial<EnrichmentSubject> = {}): EnrichmentSubject => ({
    placeId: id,
    name: `Place ${id}`,
    types: ['museum'],
    city: 'Kyoto',
    rating: 4.5,
    userRatingCount: 100,
    reviewSnippets: [{ rating: 5, text: 'lovely' }],
    ...over,
  }) as EnrichmentSubject

  const answer = {
    description: 'A fine place.',
    tags: ['quiet'],
    confidence: 0.8,
    visitMinutesMin: 40,
    visitMinutesMax: 80,
    signatureDishes: [],
    bestTimeOfDay: null,
    crowdProfile: null,
  }

  /** Never really sleeps — a test that waits out a backoff is a test nobody runs. */
  const noSleep = async () => {}

  /** A Responses stand-in whose nth answer is `reply(n)`. Returning an `Error`
   *  means that attempt throws, which is how the retry cases are written. */
  function client(reply: (n: number) => Partial<ResponsesResult> | Error): ResponsesClient & {
    calls: number
  } {
    let calls = 0
    const fake: ResponsesClient & { calls: number } = {
      calls: 0,
      async create() {
        const out = reply(calls++)
        fake.calls = calls
        if (out instanceof Error) throw out
        return {
          output_text: '',
          usage: { input_tokens: 100, output_tokens: 20 },
          ...out,
        } as ResponsesResult
      },
    }
    return fake
  }

  const ok = () => client(() => ({ output_text: JSON.stringify(answer) }))

  it('stores what it fetched and returns it for this plan', async () => {
    const store = createInMemoryEnrichmentStore()
    const result = await enrichPlaces([subject('a'), subject('b')], {
      client: ok(),
      store,
      now: NOW,
      sleep: noSleep,
    })

    expect(result.stats).toMatchObject({ requested: 2, enriched: 2, failed: 0 })
    expect(result.enrichments.get('a')?.avgVisitMinutes).toEqual([40, 80])
    // Stored too, or the next plan pays for the same answer again.
    expect((await store.getMany(['a', 'b'])).map((row) => row.placeId).sort()).toEqual(['a', 'b'])
  })

  it('clamps a bad model range on the way to the store', async () => {
    // `resolveVisitDuration` trusts this rung completely, so an unclamped
    // [480, 0] is a zero-minute activity and a day that eats itself.
    const store = createInMemoryEnrichmentStore()
    await enrichPlaces([subject('a')], {
      client: client(() => ({
        output_text: JSON.stringify({ ...answer, visitMinutesMin: 480, visitMinutesMax: 0 }),
      })),
      store,
      now: NOW,
      sleep: noSleep,
    })

    const [row] = await store.getMany(['a'])
    expect(row.avgVisitMinutes).toEqual([MIN_VISIT_MINUTES, MAX_VISIT_MINUTES])
  })

  it('counts the tokens of every call, including the ones that came back useless', async () => {
    const store = createInMemoryEnrichmentStore()
    const result = await enrichPlaces([subject('a'), subject('b')], {
      client: client((n) =>
        n === 0 ? { output_text: JSON.stringify(answer) } : { output_text: '{"not":"valid"}' },
      ),
      store,
      now: NOW,
      sleep: noSleep,
    })

    // Costing only the usable answers would make a run look cheaper the worse
    // it went. A line that came back as a schema violation was still billed.
    expect(result.stats.usage.calls).toBe(2)
    expect(result.stats.usage.inputTokens).toBe(200)
    expect(result.stats).toMatchObject({ enriched: 1, failed: 1 })
  })

  it('degrades a failed place instead of throwing, so the trip still plans', async () => {
    const result = await enrichPlaces([subject('a')], {
      client: client(() => new Error('boom')),
      store: createInMemoryEnrichmentStore(),
      now: NOW,
      sleep: noSleep,
      retries: 0,
    })
    expect(result.stats).toMatchObject({ enriched: 0, failed: 1 })
    expect(result.failures[0]).toMatchObject({ placeId: 'a', reason: 'api_error' })
  })

  it('retries a rate limit and keeps the answer when it clears', async () => {
    const rateLimited = Object.assign(new Error('429 rate_limit_exceeded'), { status: 429 })
    const result = await enrichPlaces([subject('a')], {
      client: client((n) =>
        n === 0 ? rateLimited : { output_text: JSON.stringify(answer) },
      ),
      store: createInMemoryEnrichmentStore(),
      now: NOW,
      sleep: noSleep,
    })
    expect(result.stats).toMatchObject({ enriched: 1, failed: 0 })
  })

  it('does not retry a request that is simply wrong', async () => {
    // A 400 is our bug. Asking again buys the same answer at twice the price.
    const badRequest = Object.assign(new Error('400 invalid schema'), { status: 400 })
    const fake = client(() => badRequest)
    await enrichPlaces([subject('a')], {
      client: fake,
      store: createInMemoryEnrichmentStore(),
      now: NOW,
      sleep: noSleep,
      retries: 3,
    })
    expect(fake.calls).toBe(1)
  })

  it('names a truncated response rather than calling it malformed', async () => {
    // A response cut off at the token cap parses exactly like a model writing
    // nonsense, and the two need different fixes — one is a number.
    const result = await enrichPlaces([subject('a')], {
      client: client(() => ({
        output_text: '{"description":"A fine pl',
        status: 'incomplete',
        incompleteReason: 'max_output_tokens',
      })),
      store: createInMemoryEnrichmentStore(),
      now: NOW,
      sleep: noSleep,
    })
    expect(result.failures[0].message).toContain('max_output_tokens')
  })

  it('still serves this plan when the cache write is refused', async () => {
    const refusing: EnrichmentStore = {
      ...createInMemoryEnrichmentStore(),
      async putMany() {
        throw new Error('connection terminated')
      },
    }
    const result = await enrichPlaces([subject('a')], {
      client: ok(),
      store: refusing,
      now: NOW,
      sleep: noSleep,
    })
    // The answer is in hand; what was lost is the next plan's cache hit.
    expect(result.enrichments.get('a')).toBeDefined()
    expect(result.stats.storeError).toContain('connection terminated')
  })

  it('sends one request per distinct place', async () => {
    const fake = ok()
    await enrichPlaces([subject('a'), subject('a')], {
      client: fake,
      store: createInMemoryEnrichmentStore(),
      now: NOW,
      sleep: noSleep,
    })
    expect(fake.calls).toBe(1)
  })

  it('makes no call at all for an empty list', async () => {
    const fake = ok()
    const result = await enrichPlaces([], {
      client: fake,
      store: createInMemoryEnrichmentStore(),
      now: NOW,
      sleep: noSleep,
    })
    expect(fake.calls).toBe(0)
    expect(result.stats.usage.calls).toBe(0)
  })

  it('sends the same request the batch would have sent', async () => {
    // The two paths are separated by a day and a cache, and
    // `enrichmentSourceHash` digests the payload — so a live answer and a
    // batched one that phrased the place differently would each look stale to
    // the other's reader.
    const place = subject('a')
    const request = buildEnrichmentRequest(place, MODELS.enrich)
    expect(request.reasoning.effort).toBe('none')
    expect(request.model).toBe(MODELS.enrich)
    const userBlock = request.input.find((block) => block.role === 'user')!
    expect(JSON.parse(userBlock.content as string)).toEqual(buildEnrichmentInput(place))
  })
})
