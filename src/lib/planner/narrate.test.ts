import { describe, expect, it } from "vitest";

import {
  MAX_HIGHLIGHTS,
  SHARED_PREFIX_BLOCK_COUNT,
  SHARED_PREFIX_MIN_CHARS,
  buildSharedPrefix,
  narrateStops,
  stopsFromDays,
  type NarrateStop,
} from "./narrate";
import type { ResponsesClient, ResponsesRequest, ResponsesResult } from "./openai";
import type { PackedDay, TimelineSegment } from "./pack";
import type { CandidatePlace, PlaceEnrichment, PreferenceProfile } from "./types";

const PROMPT_CACHE_KEY = "itinerary-kyoto-2026-08-24";

const PROFILE: PreferenceProfile = {
  interests: ["outdoors", "cafes"],
  dietary: ["vegetarian"],
  pace: "balanced",
  budget: 2,
  typeAffinities: { tourist_attraction: 0.8 },
};

// ── fixtures ─────────────────────────────────────────────────────────────────

function enrichment(overrides: Partial<PlaceEnrichment> = {}): PlaceEnrichment {
  return {
    description: "A riverside tofu house on the Katsura.",
    tags: ["vegetarian-friendly", "scenic"],
    confidence: 0.8,
    avgVisitMinutes: [60, 90],
    ...overrides,
  };
}

function stop(index: number, overrides: Partial<NarrateStop> = {}): NarrateStop {
  return {
    placeId: `p-${index}`,
    name: `Place ${index}`,
    types: ["tourist_attraction"],
    rating: 4.5,
    dayIndex: Math.floor(index / 4),
    role: "activity",
    startMin: 540 + index * 30,
    endMin: 600 + index * 30,
    enrichment: enrichment(),
    matchReasons: [`matches: outdoors`, `4.5 stars`],
    ...overrides,
  };
}

/** Fifteen stops — the fan-out size the design doc budgets for. */
function fifteenStops(): NarrateStop[] {
  return Array.from({ length: 15 }, (_, i) => stop(i));
}

/** The per-stop block is always last; the shared prefix is always before it. */
function textOf(block: ResponsesRequest["input"][number]): string {
  return typeof block.content === "string"
    ? block.content
    : block.content.map((part) => part.text).join("");
}

function payloadOf(request: ResponsesRequest): Record<string, any> {
  return JSON.parse(textOf(request.input[request.input.length - 1]));
}

interface FakeOptions {
  /** Called per attempt. Returning true makes that attempt throw. */
  failFor?(placeId: string): boolean;
  /** Override the model's answer for a stop. Return a string to send raw text. */
  reply?(placeId: string, payload: Record<string, any>): unknown;
  cachedTokens?: number;
  /** Stops whose response comes back `incomplete` — the shape a cap produces. */
  truncateFor?(placeId: string): boolean;
  incompleteReason?: string;
}

/**
 * A hand-built `ResponsesClient`. No mocking framework anywhere in this suite —
 * the port is one method, so a fake is a closure that records what it was asked.
 */
function fakeClient(options: FakeOptions = {}): ResponsesClient & {
  requests: ResponsesRequest[];
} {
  const requests: ResponsesRequest[] = [];
  const client = {
    requests,
    async create(request: ResponsesRequest): Promise<ResponsesResult> {
      requests.push(request);
      const payload = payloadOf(request);
      const placeId = payload.place.place_id as string;
      if (options.failFor?.(placeId)) throw new Error(`upstream 500 for ${placeId}`);

      const answer = options.reply?.(placeId, payload) ?? {
        place_id: placeId,
        why_for_you: `A good fit for you at ${payload.place.name}.`,
        highlights: ["Riverside room", "Seasonal menu"],
        food_recommendations: null,
        tips: null,
      };

      // A truncated response is a 200 carrying a prefix of the JSON. Slicing
      // the real answer is the point: a made-up broken string would parse the
      // same way and would not prove the status is what distinguishes them.
      const truncated = options.truncateFor?.(placeId) === true;
      const body = typeof answer === "string" ? answer : JSON.stringify(answer);

      return {
        output_text: truncated ? body.slice(0, Math.floor(body.length / 2)) : body,
        ...(truncated
          ? {
              status: "incomplete",
              incompleteReason: options.incompleteReason ?? "max_output_tokens",
            }
          : { status: "completed" }),
        usage: {
          input_tokens: 1500,
          output_tokens: 120,
          input_tokens_details: { cached_tokens: options.cachedTokens ?? 0 },
        },
      };
    },
  };
  return client;
}

// ── the fan-out never takes the itinerary with it ────────────────────────────

import { QUESTIONS, matchArchetype } from "@/lib/persona/quiz";
import { buildPersonaBrief } from "./persona-brief";

describe("narrateStops — degradation", () => {
  it("returns fourteen narrated stops and one fallback when a single call fails", async () => {
    const client = fakeClient({ failFor: (placeId) => placeId === "p-7" });

    const result = await narrateStops(fifteenStops(), PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
      retries: 1,
    });

    expect(result.content.size).toBe(15);
    expect(result.stats.narrated).toBe(14);
    expect(result.stats.fallback).toBe(1);
    expect(result.failures).toEqual([
      { placeId: "p-7", message: "upstream 500 for p-7" },
    ]);

    // The fallback carries cached enrichment + match reasons, per the
    // degradation ladder — not an empty card.
    expect(result.content.get("p-7")).toEqual({
      whyForYou: "A riverside tofu house on the Katsura.",
      highlights: ["matches: outdoors", "4.5 stars"],
    });
    expect(result.content.get("p-6")?.whyForYou).toContain("A good fit for you");
  });

  it("returns a complete result when all fifteen calls fail", async () => {
    const client = fakeClient({ failFor: () => true });

    const result = await narrateStops(fifteenStops(), PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
      retries: 1,
    });

    expect(result.content.size).toBe(15);
    expect(result.failures).toHaveLength(15);
    expect(result.stats).toMatchObject({ requested: 15, narrated: 0, fallback: 15 });
    for (const stopped of fifteenStops()) {
      expect(result.content.get(stopped.placeId)?.whyForYou.length).toBeGreaterThan(0);
    }
  });

  it("writes a plain sentence rather than an empty whyForYou when there is no enrichment", async () => {
    const client = fakeClient({ failFor: () => true });
    const bare = stop(0, { enrichment: undefined, matchReasons: undefined, role: "lunch" });

    const result = await narrateStops([bare], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
      retries: 0,
    });

    expect(result.content.get("p-0")).toEqual({
      whyForYou: "Lunch at Place 0 on day 1 of your trip.",
      highlights: [],
    });
  });

  it("retries once by default and gives up rather than looping", async () => {
    let attempts = 0;
    const client: ResponsesClient = {
      async create() {
        attempts += 1;
        throw new Error("boom");
      },
    };

    const result = await narrateStops([stop(0)], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    expect(attempts).toBe(2);
    expect(result.stats.fallback).toBe(1);
  });
});

// ── prompt caching: prefix first, byte-identical, one cache key ──────────────

describe("narrateStops — prompt cache prefix", () => {
  it("puts the shared prefix first and the per-stop payload strictly after it", async () => {
    const client = fakeClient();
    await narrateStops(fifteenStops(), PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    expect(client.requests).toHaveLength(15);

    const first = client.requests[0].input;
    const other = client.requests[9].input;

    const prefixOf = (blocks: typeof first) => blocks.slice(0, SHARED_PREFIX_BLOCK_COUNT);
    const suffixOf = (blocks: typeof first) => blocks.slice(SHARED_PREFIX_BLOCK_COUNT);

    // Byte equality, not deep-ish equality: caching routes on a prefix hash, so
    // a single differing character is a miss.
    expect(JSON.stringify(prefixOf(first))).toBe(JSON.stringify(prefixOf(other)));
    expect(JSON.stringify(suffixOf(first))).not.toBe(JSON.stringify(suffixOf(other)));

    expect(first[0].role).toBe("system");
    expect(first[1].role).toBe("developer");
    expect(suffixOf(first)).toHaveLength(1);
    expect(suffixOf(first)[0].role).toBe("user");

    // And every one of the fifteen shares the same prefix, not just these two.
    const prefixes = new Set(client.requests.map((r) => JSON.stringify(prefixOf(r.input))));
    expect(prefixes.size).toBe(1);
  });

  it("clears the 1024-token floor below which nothing caches at all", () => {
    const prefix = buildSharedPrefix(PROFILE);
    const chars = prefix.reduce((total, block) => total + textOf(block).length, 0);

    // 4096 chars ~ 1024 tokens at the conservative four-chars-per-token
    // estimate for English. Under the floor OpenAI caches nothing, and just
    // above it caching is documented as inconsistent — hence a floor to clear,
    // not a target to hit.
    expect(chars).toBeGreaterThan(SHARED_PREFIX_MIN_CHARS);
  });

  it("sends one prompt_cache_key, from deps, on every call", async () => {
    const client = fakeClient();
    await narrateStops(fifteenStops(), PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    const keys = new Set(client.requests.map((r) => r.prompt_cache_key));
    expect(keys.size).toBe(1);
    expect([...keys]).toEqual([PROMPT_CACHE_KEY]);
  });

  it("marks the stable developer prefix and disables changing suffix writes", async () => {
    const client = fakeClient();
    await narrateStops([stop(0)], PROFILE, { client, promptCacheKey: PROMPT_CACHE_KEY });

    expect(client.requests[0].prompt_cache_options).toEqual({ mode: "explicit" });
    expect(client.requests[0].input[1].content).toEqual([
      expect.objectContaining({
        type: "input_text",
        prompt_cache_breakpoint: { mode: "explicit" },
      }),
    ]);
  });

  it("sets reasoning effort explicitly, defaulting to none", async () => {
    const client = fakeClient();
    await narrateStops([stop(0)], PROFILE, { client, promptCacheKey: PROMPT_CACHE_KEY });
    expect(client.requests[0].reasoning).toEqual({ effort: "none" });

    const explicit = fakeClient();
    await narrateStops([stop(0)], PROFILE, {
      client: explicit,
      promptCacheKey: PROMPT_CACHE_KEY,
      effort: "low",
    });
    expect(explicit.requests[0].reasoning).toEqual({ effort: "low" });
  });

  it("sums cached_tokens from usage.input_tokens_details across calls", async () => {
    const client = fakeClient({ cachedTokens: 1152 });
    const result = await narrateStops(fifteenStops(), PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    expect(result.stats.cachedTokens).toBe(15 * 1152);
  });
});

// ── the profile slice is a slice ─────────────────────────────────────────────

describe("narrateStops — the persona brief", () => {
  const BRIEF = buildPersonaBrief(
    matchArchetype({ structure: 85, comfort: 80, focus: 90, social: 85 }),
    Array(QUESTIONS.length).fill(2),
  );

  it("rides in the cached prefix, never in the per-stop payload", async () => {
    const client = fakeClient();
    await narrateStops(fifteenStops(), PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
      brief: BRIEF,
    });

    const prefixText = client.requests[0].input
      .slice(0, SHARED_PREFIX_BLOCK_COUNT)
      .map(textOf)
      .join("\n");
    expect(prefixText).toContain(BRIEF.traits[0]);
    expect(prefixText).toContain(BRIEF.archetype);

    // The whole point of putting it in the prefix: fifteen cache reads, not
    // fifteen misses. A brief in the per-stop block would still *work*.
    for (const request of client.requests) {
      const perStop = request.input.slice(SHARED_PREFIX_BLOCK_COUNT).map(textOf).join("\n");
      expect(perStop).not.toContain(BRIEF.traits[0]);
    }
    const prefixes = new Set(
      client.requests.map((r) => JSON.stringify(r.input.slice(0, SHARED_PREFIX_BLOCK_COUNT))),
    );
    expect(prefixes.size).toBe(1);
  });

  it("leaves the prefix byte-identical when there is no persona", async () => {
    // The requirement that keeps the Gate A snapshots and every warm cache
    // still for a traveller who never took the quiz.
    expect(JSON.stringify(buildSharedPrefix(PROFILE, undefined))).toBe(
      JSON.stringify(buildSharedPrefix(PROFILE)),
    );
  });

  it("tells the narrator the trip is already decided", async () => {
    // Pass C writes about a timeline that is finished. A brief that read as
    // "pick places like this" would invite it to editorialise about stops the
    // scheduler chose and it cannot change.
    const prefix = buildSharedPrefix(PROFILE, BRIEF).map(textOf).join("\n");
    expect(prefix).toMatch(/never to change which places are in the trip/i);
  });
});

describe("narrateStops — profile slice", () => {
  it("sends only interests and dietary", async () => {
    const client = fakeClient();
    await narrateStops([stop(0)], PROFILE, { client, promptCacheKey: PROMPT_CACHE_KEY });

    const developerBlock = textOf(client.requests[0].input[1]);
    const slice = JSON.parse(developerBlock.match(/traveller_profile_slice: (\{.*\})/)![1]);

    expect(Object.keys(slice).sort()).toEqual(["dietary", "interests"]);
    expect(slice).toEqual({ interests: ["outdoors", "cafes"], dietary: ["vegetarian"] });

    // pace and budget shape the schedule, which is already decided; a writer
    // handed them editorialises about a decision it did not make.
    const wholePrompt = client.requests[0].input.map(textOf).join("\n");
    expect(wholePrompt).not.toContain("pace");
    expect(wholePrompt).not.toContain("budget");
    expect(wholePrompt).not.toContain("typeAffinities");
  });
});

// ── grounding: no dish the enrichment pass never saw ─────────────────────────

describe("narrateStops — food recommendations", () => {
  const mealStop = stop(0, {
    role: "lunch",
    enrichment: enrichment({ signatureDishes: ["yudofu set", "seasonal tofu course"] }),
  });

  it("asks every meal slot for food_recommendations", async () => {
    const client = fakeClient();
    await narrateStops([mealStop, stop(1, { role: "dinner" })], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    for (const request of client.requests) {
      expect(payloadOf(request).output_rules.food_recommendations).toBe("required");
    }
  });

  it("sends signature_dishes as the grounding list", async () => {
    const client = fakeClient();
    await narrateStops([mealStop], PROFILE, { client, promptCacheKey: PROMPT_CACHE_KEY });

    expect(payloadOf(client.requests[0]).place.enrichment.signature_dishes).toEqual([
      "yudofu set",
      "seasonal tofu course",
    ]);
  });

  it("rejects a dish that is not in signature_dishes and keeps the rest of the card", async () => {
    const client = fakeClient({
      reply: (placeId) => ({
        place_id: placeId,
        why_for_you: "Vegetarian is the point of the menu here.",
        highlights: ["Riverside tatami room"],
        food_recommendations: [
          { dish: "Yudofu set", note: "Simmered at your table" },
          { dish: "Wagyu beef sushi", note: "Melts in your mouth" },
        ],
        tips: null,
      }),
    });

    const result = await narrateStops([mealStop], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    const content = result.content.get("p-0")!;
    expect(content.foodRecommendations).toEqual([
      { dish: "Yudofu set", note: "Simmered at your table" },
    ]);
    const dishes = JSON.stringify(content);
    expect(dishes).not.toContain("Wagyu");

    // The stop is still narrated — the grounding rule drops a dish, not a card.
    expect(result.stats.narrated).toBe(1);
    expect(result.stats.rejectedDishes).toBe(1);
    expect(result.failures).toEqual([]);
  });

  it("rejects every dish when the meal stop has no enrichment to ground them", async () => {
    const client = fakeClient({
      reply: (placeId) => ({
        place_id: placeId,
        why_for_you: "A solid lunch stop.",
        highlights: [],
        food_recommendations: [{ dish: "House ramen", note: "Invented" }],
        tips: null,
      }),
    });

    const result = await narrateStops([stop(0, { role: "lunch", enrichment: undefined })], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    expect(result.content.get("p-0")?.foodRecommendations).toBeUndefined();
    expect(result.stats.rejectedDishes).toBe(1);
  });

  it("omits food_recommendations from output_rules on a non-meal slot", async () => {
    const client = fakeClient();
    await narrateStops([stop(0, { role: "activity" }), stop(1, { role: "cafe_break" })], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    for (const request of client.requests) {
      const rules = payloadOf(request).output_rules;
      expect(Object.keys(rules)).not.toContain("food_recommendations");
      expect(rules.max_highlights).toBe(MAX_HIGHLIGHTS);
      expect(rules.reference_only_provided_names).toBe(true);
    }
  });

  it("strips food recommendations a non-meal slot returned anyway", async () => {
    const client = fakeClient({
      reply: (placeId) => ({
        place_id: placeId,
        why_for_you: "A garden that suits your love of the outdoors.",
        highlights: ["Moss garden"],
        food_recommendations: [{ dish: "Matcha parfait", note: "At the kiosk" }],
        tips: null,
      }),
    });

    // The dish is deliberately one the grounding list *would* accept. Otherwise
    // this passes even with the role guard removed, because the grounding
    // filter drops it anyway — and then it tests nothing.
    const gardenWithDishes = stop(0, {
      role: "activity",
      enrichment: enrichment({ signatureDishes: ["Matcha parfait"] }),
    });

    const result = await narrateStops([gardenWithDishes], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    expect(result.content.get("p-0")?.foodRecommendations).toBeUndefined();
    expect(result.stats.rejectedDishes).toBe(0);
    expect(result.stats.narrated).toBe(1);
  });
});

// ── correlation is by echoed id, never by position ───────────────────────────

describe("narrateStops — response handling", () => {
  it("discards a response whose place_id names a different stop", async () => {
    const client = fakeClient({
      reply: (placeId) => ({
        place_id: placeId === "p-3" ? "p-9" : placeId,
        why_for_you: `Written for ${placeId === "p-3" ? "p-9" : placeId}.`,
        highlights: [],
        food_recommendations: null,
        tips: null,
      }),
    });

    const result = await narrateStops([stop(3), stop(9)], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
      retries: 0,
    });

    // p-3 falls back rather than wearing p-9's prose.
    expect(result.content.get("p-3")).toEqual({
      whyForYou: "A riverside tofu house on the Katsura.",
      highlights: ["matches: outdoors", "4.5 stars"],
    });
    expect(result.failures).toEqual([
      { placeId: "p-3", message: "place_id mismatch: got p-9" },
    ]);
    expect(result.content.get("p-9")?.whyForYou).toBe("Written for p-9.");
  });

  it("falls back on unparseable output rather than throwing", async () => {
    const client = fakeClient({ reply: () => "not json at all" });
    const result = await narrateStops([stop(0)], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
      retries: 0,
    });

    expect(result.stats.fallback).toBe(1);
    expect(result.failures[0].message).toBe("narration response was not JSON");
  });

  it("falls back on an empty why_for_you", async () => {
    const client = fakeClient({
      reply: (placeId) => ({
        place_id: placeId,
        why_for_you: "   ",
        highlights: ["something"],
        food_recommendations: null,
        tips: null,
      }),
    });

    const result = await narrateStops([stop(0)], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
      retries: 0,
    });

    expect(result.failures[0].message).toBe("narration returned an empty why_for_you");
    expect(result.content.get("p-0")?.whyForYou.length).toBeGreaterThan(0);
  });

  it("caps highlights and keeps non-empty tips", async () => {
    const client = fakeClient({
      reply: (placeId) => ({
        place_id: placeId,
        why_for_you: "Fits your interests.",
        highlights: ["one", "two", "three", "four"],
        food_recommendations: null,
        tips: ["Go early", "  "],
      }),
    });

    const result = await narrateStops([stop(0)], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    expect(result.content.get("p-0")?.highlights).toEqual(["one", "two", "three"]);
    expect(result.content.get("p-0")?.tips).toEqual(["Go early"]);
  });
});

// ── stopsFromDays reads the timeline, it does not recompute it ───────────────

describe("stopsFromDays", () => {
  const activity = (
    placeId: string,
    name: string,
    position: number,
    startMin: number,
    role: NarrateStop["role"] = "activity",
  ): TimelineSegment => ({
    kind: "activity",
    placeId,
    name,
    role,
    position,
    startMin,
    endMin: startMin + 60,
  });

  const day: PackedDay = {
    segments: [
      activity("a", "Tenryu-ji", 1, 540),
      { kind: "travel", mode: "walk", startMin: 600, endMin: 606, fromName: "Tenryu-ji", toName: "Shoraian" },
      activity("b", "Shoraian", 2, 606, "lunch"),
      { kind: "break", reason: "free", startMin: 666, endMin: 690 },
      { kind: "travel", mode: "transit", startMin: 690, endMin: 710, fromName: "Shoraian", toName: "Kinkaku-ji" },
      activity("c", "Kinkaku-ji", 3, 710),
    ],
    dropped: [],
  };

  const places = new Map<string, CandidatePlace>([
    ["a", { placeId: "a", name: "Tenryu-ji", types: ["place_of_worship"], rating: 4.6 }],
    ["b", { placeId: "b", name: "Shoraian", types: ["restaurant"], rating: 4.7 }],
  ]);
  const enrichments = new Map<string, PlaceEnrichment>([["b", enrichment()]]);

  it("emits one stop per activity segment and skips breaks", () => {
    const stops = stopsFromDays([{ dayIndex: 1, day }], places, enrichments);

    expect(stops.map((s) => s.placeId)).toEqual(["a", "b", "c"]);
    expect(stops.every((s) => s.dayIndex === 1)).toBe(true);
    expect(stops[1].role).toBe("lunch");
    expect(stops[1].enrichment).toBeDefined();
    expect(stops[2].enrichment).toBeUndefined();
  });

  it("reads travel legs off the timeline, looking through breaks", () => {
    const stops = stopsFromDays([{ dayIndex: 0, day }], places, enrichments);

    expect(stops[0].previous).toBeUndefined();
    expect(stops[0].next).toEqual({ name: "Shoraian", travelMode: "walk", travelMin: 6 });

    expect(stops[1].previous).toEqual({ name: "Tenryu-ji", travelMode: "walk", travelMin: 6 });
    // The free break sits between the lunch and the transit leg; the leg is
    // still the one that follows.
    expect(stops[1].next).toEqual({ name: "Kinkaku-ji", travelMode: "transit", travelMin: 20 });

    expect(stops[2].previous).toEqual({ name: "Shoraian", travelMode: "transit", travelMin: 20 });
    expect(stops[2].next).toBeUndefined();
  });

  it("carries rating and types from the place map, and survives a missing one", () => {
    const stops = stopsFromDays([{ dayIndex: 0, day }], places, enrichments);

    expect(stops[0]).toMatchObject({ types: ["place_of_worship"], rating: 4.6 });
    expect(stops[2]).toMatchObject({ name: "Kinkaku-ji", types: [] });
    expect(stops[2].rating).toBeUndefined();
  });

  it("carries match reasons through for the fallback when supplied", () => {
    const reasons = new Map([["a", ["matches: outdoors"]]]);
    const stops = stopsFromDays([{ dayIndex: 0, day }], places, enrichments, reasons);

    expect(stops[0].matchReasons).toEqual(["matches: outdoors"]);
    expect(stops[1].matchReasons).toBeUndefined();
  });
});

// ── a response the model never finished ──────────────────────────────────────

describe("narrateStops — truncation", () => {
  it("names the cap rather than calling the half-written JSON malformed", async () => {
    const client = fakeClient({ truncateFor: (placeId) => placeId === "p-3" });
    const result = await narrateStops(fifteenStops(), PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    expect(result.stats.truncated).toBe(1);
    expect(result.stats.fallback).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].placeId).toBe("p-3");
    // The whole point: "raise the cap" and "the model wrote nonsense" have
    // different fixes, and before this they arrived under the same message.
    expect(result.failures[0].message).toContain("max_output_tokens");
    expect(result.failures[0].message).not.toContain("not JSON");
  });

  it("still ships the stop, on the enrichment fallback", async () => {
    const stops = fifteenStops();
    const client = fakeClient({ truncateFor: (placeId) => placeId === "p-3" });
    const result = await narrateStops(stops, PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    expect(result.content.size).toBe(15);
    expect(result.content.get("p-3")!.whyForYou).toBe(enrichment().description);
    // Without this line the case passes with truncation detection removed —
    // half a JSON object fails to parse either way, so the fallback alone
    // proves nothing about which path produced it.
    expect(result.stats.truncated).toBe(1);
  });

  it("reports a stop that stopped for some other reason without blaming the cap", async () => {
    const client = fakeClient({
      truncateFor: (placeId) => placeId === "p-0",
      incompleteReason: "content_filter",
    });
    const result = await narrateStops([stop(0)], PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });

    expect(result.stats.truncated).toBe(1);
    expect(result.failures[0].message).toContain("content_filter");
    expect(result.failures[0].message).not.toContain("max_output_tokens");
  });

  it("leaves a completed response alone — this is not a new failure path", async () => {
    const client = fakeClient();
    const result = await narrateStops(fifteenStops(), PROFILE, {
      client,
      promptCacheKey: PROMPT_CACHE_KEY,
    });
    expect(result.stats.truncated).toBe(0);
    expect(result.stats.narrated).toBe(15);
  });
});
