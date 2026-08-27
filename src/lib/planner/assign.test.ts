import { describe, expect, it, vi } from "vitest";

import {
  assignDays,
  buildAssignRequest,
  dayCapacity,
  openWindowsFor,
  MEAL_MINUTES,
  TRAVEL_SHARE,
  type AssignDayRequest,
  type AssignInput,
} from "./assign";
import { resolveVisitDuration } from "./duration";
import type { ScoredCluster } from "./funnel";
import type { Weekday } from "./hours";
import type { ResponsesClient, ResponsesRequest } from "./openai";
import { DAY_START_MIN, PACE_PLANS } from "./pack";
import type { CandidatePlace, OpeningPeriod, PlaceEnrichment, PreferenceProfile } from "./types";

/** Thursday. Nothing in the planner derives a weekday; it is always injected. */
const WEEKDAY: Weekday = 4;

// ── fixtures ─────────────────────────────────────────────────────────────────

/** The same `[open, close]` hours every day of the week. */
function daily(spans: readonly (readonly [string, string])[]): OpeningPeriod[] {
  const point = (clock: string, day: number) => {
    const [hour, minute] = clock.split(":").map(Number);
    return { day, hour, minute };
  };
  return Array.from({ length: 7 }, (_, day) =>
    spans.map(([open, close]) => ({ open: point(open, day), close: point(close, day) })),
  ).flat();
}

function place(over: Partial<CandidatePlace> & Pick<CandidatePlace, "placeId" | "name">) {
  return {
    types: ["tourist_attraction"],
    latitude: 35.0094,
    longitude: 135.6666,
    rating: 4.5,
    userRatingCount: 1200,
    ...over,
  } satisfies CandidatePlace;
}

/** Open 08:30–17:00: morning and midday, never evening. */
const TENRYUJI = place({
  placeId: "tenryuji",
  name: "Tenryu-ji Temple",
  types: ["place_of_worship", "tourist_attraction"],
  openingPeriods: daily([["8:30", "17:0"]]),
});

/** Two services with a gap between them — the reason a window is probed rather
 *  than tested as one span. */
const SHORAIAN = place({
  placeId: "shoraian",
  name: "Shoraian Tofu",
  types: ["restaurant", "vegetarian_restaurant"],
  openingPeriods: daily([
    ["11:0", "14:0"],
    ["17:30", "20:0"],
  ]),
});

/** Ungated public space. No hours at all, which `hours.ts` reads as always open. */
const BAMBOO = place({
  placeId: "bamboo",
  name: "Arashiyama Bamboo Grove",
  types: ["park", "tourist_attraction"],
});

const KIMONO = place({ placeId: "kimono", name: "Kimono Forest" });
const MONKEY = place({ placeId: "monkey", name: "Iwatayama Monkey Park", types: ["park"] });
const BOAT = place({ placeId: "boat", name: "Hozugawa River Boat Ride" });
const OKOCHI = place({ placeId: "okochi", name: "Okochi Sanso Villa" });
const YOSHIDAYA = place({
  placeId: "yoshidaya",
  name: "Yoshidaya Kyoto Kitchen",
  types: ["restaurant"],
});

const ARASHIYAMA_PLACES = [
  TENRYUJI,
  SHORAIAN,
  BAMBOO,
  KIMONO,
  MONKEY,
  BOAT,
  OKOCHI,
  YOSHIDAYA,
];

/** Second cluster, so "belongs to another day's area" is distinguishable from
 *  "we never retrieved this". */
const GION = place({ placeId: "gion", name: "Gion Shirakawa", latitude: 35.0037, longitude: 135.7 });
const KIYOMIZU = place({
  placeId: "kiyomizu",
  name: "Kiyomizu-dera",
  types: ["place_of_worship"],
  latitude: 34.9949,
  longitude: 135.785,
});
const IZUJU = place({
  placeId: "izuju",
  name: "Izuju Sushi",
  types: ["restaurant", "sushi_restaurant"],
  latitude: 35.0035,
  longitude: 135.7752,
});

function cluster(places: CandidatePlace[], score: number): ScoredCluster {
  return {
    centroid: { latitude: 35.0094, longitude: 135.6666 },
    score,
    places,
    scored: places.map((p, index) => ({
      placeId: p.placeId,
      score: Math.round((0.9 - index * 0.05) * 100) / 100,
      reasons: [`matches: ${p.types[0]}`],
    })),
  };
}

const PROFILE: PreferenceProfile = {
  interests: ["temples", "food"],
  dietary: ["vegetarian"],
  pace: "balanced",
  budget: 2,
};

/** Rung 2 of the duration ladder — 100–140 min, nothing like the 45 the
 *  `place_of_worship` heuristic would give. */
const TENRYUJI_ENRICHMENT: PlaceEnrichment = {
  description: "A Zen temple with a garden that predates the buildings around it.",
  tags: ["scenic", "unesco"],
  confidence: 0.9,
  avgVisitMinutes: [100, 140],
};

function dayRequest(dayIndex: number): AssignDayRequest {
  return { dayIndex, weekday: WEEKDAY, capacity: dayCapacity("balanced") };
}

function assignInput(over: Partial<AssignInput> = {}): AssignInput {
  return {
    profile: PROFILE,
    clusters: [cluster(ARASHIYAMA_PLACES, 0.71), cluster([GION, KIYOMIZU, IZUJU], 0.64)],
    days: [dayRequest(0), dayRequest(1)],
    enrichments: new Map([[TENRYUJI.placeId, TENRYUJI_ENRICHMENT]]),
    ...over,
  };
}

// ── the fake client ──────────────────────────────────────────────────────────

/**
 * Records every request it is handed and answers with canned text. No mocking
 * framework: the port is one method, and a spy that could drift from
 * `ResponsesClient` is worth less than four lines that cannot.
 */
function fakeClient(replies: readonly string[]) {
  const requests: ResponsesRequest[] = [];
  const create = vi.fn(async (request: ResponsesRequest) => {
    requests.push(request);
    const text = replies[Math.min(requests.length - 1, replies.length - 1)];
    return { output_text: text, usage: { input_tokens: 4_200, output_tokens: 310 } };
  });
  return { client: { create } satisfies ResponsesClient, requests, create };
}

interface CannedSlot {
  slot_role: string;
  place_id: string;
}

function reply(
  days: { day: number; area_name?: string | null; assignments: CannedSlot[]; flex?: string[] }[],
): string {
  return JSON.stringify({
    days: days.map((day) => ({
      day: day.day,
      area_name: day.area_name === undefined ? "Arashiyama" : day.area_name,
      assignments: day.assignments.map((slot) => ({ ...slot, why: "worth the walk" })),
      flex: (day.flex ?? []).map((place_id) => ({ place_id, why: "if there is time" })),
    })),
  });
}

const FULL_DAY: CannedSlot[] = [
  { slot_role: "activity", place_id: "bamboo" },
  { slot_role: "lunch", place_id: "shoraian" },
  { slot_role: "activity", place_id: "tenryuji" },
  { slot_role: "activity", place_id: "kimono" },
  { slot_role: "dinner", place_id: "yoshidaya" },
];

const DAY_TWO: CannedSlot[] = [
  { slot_role: "activity", place_id: "kiyomizu" },
  { slot_role: "lunch", place_id: "izuju" },
  { slot_role: "activity", place_id: "gion" },
];

const BOTH_DAYS = reply([
  { day: 1, assignments: FULL_DAY, flex: ["monkey"] },
  { day: 2, area_name: "Gion", assignments: DAY_TWO },
]);

/**
 * The request as it goes over the wire, with the JSON payload blocks parsed
 * back out — otherwise the payload is one opaque string and a key check over
 * the request would inspect nothing at all.
 */
function serializedRequest(request: ResponsesRequest): unknown {
  const wire = JSON.parse(JSON.stringify(request)) as { input: { content: string }[] };
  return {
    ...wire,
    input: wire.input.map((block) => {
      try {
        return JSON.parse(block.content) as unknown;
      } catch {
        return block.content;
      }
    }),
  };
}

/** Every key that appears anywhere in a serialized value, at any depth. */
function keysDeep(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) keysDeep(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      into.add(key);
      keysDeep(child, into);
    }
  }
  return into;
}

// ── capacity ─────────────────────────────────────────────────────────────────

describe("dayCapacity", () => {
  it("denominates the budget in minutes, off the clock", () => {
    const capacity = dayCapacity("balanced");
    const dayMinutes = PACE_PLANS.balanced.dayEndMin - DAY_START_MIN;

    expect(dayMinutes).toBe(720);
    expect(capacity.activityMinutes).toBe(
      dayMinutes - 2 * MEAL_MINUTES - Math.round(dayMinutes * TRAVEL_SHARE.balanced),
    );
    expect(capacity).toEqual({ activityMinutes: 390, meals: 2, flex: 1 });
  });

  it("charges every meal asked for", () => {
    expect(dayCapacity("balanced", 1).activityMinutes).toBe(
      dayCapacity("balanced", 2).activityMinutes + MEAL_MINUTES,
    );
    expect(dayCapacity("balanced", 0).meals).toBe(0);
  });

  it("never goes negative, however many meals are asked for", () => {
    expect(dayCapacity("relaxed", 20).activityMinutes).toBe(0);
  });
});

// ── open windows ─────────────────────────────────────────────────────────────

describe("openWindowsFor", () => {
  it("gives a place with no known hours all three windows", () => {
    expect(openWindowsFor(BAMBOO, WEEKDAY)).toEqual(["morning", "midday", "evening"]);
  });

  it("stops at closing time", () => {
    expect(openWindowsFor(TENRYUJI, WEEKDAY)).toEqual(["morning", "midday"]);
  });

  it("keeps both services of a restaurant that shuts in between", () => {
    expect(openWindowsFor(SHORAIAN, WEEKDAY)).toEqual(["midday", "evening"]);
  });

  it("returns nothing for a place shut all day", () => {
    const mondayOnly: OpeningPeriod[] = [
      { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
    ];
    expect(openWindowsFor({ openingPeriods: mondayOnly }, WEEKDAY)).toEqual([]);
  });
});

// ── the request ──────────────────────────────────────────────────────────────

describe("the Pass B request", () => {
  const payloadOf = (request: ResponsesRequest) => {
    const content = request.input[1].content;
    if (typeof content !== "string") throw new Error("Pass B payload must be text");
    return JSON.parse(content) as Record<string, never>;
  };

  it("states capacity in minutes, not slot counts", () => {
    const request = buildAssignRequest(assignInput(), { client: fakeClient([]).client });
    const payload = payloadOf(request) as unknown as {
      days: { day: number; capacity: Record<string, number> }[];
    };

    expect(payload.days[0].capacity).toEqual({ activity_minutes: 390, meals: 2, flex: 1 });
    expect(payload.days.map((d) => d.day)).toEqual([1, 2]);
    expect(keysDeep(payload.days)).not.toContain("activities");
  });

  it("gives every candidate a coarse open_windows array", () => {
    const request = buildAssignRequest(assignInput(), { client: fakeClient([]).client });
    const payload = payloadOf(request) as unknown as {
      clusters: { candidates: { place_id: string; open_windows: string[] }[] }[];
    };
    const byId = new Map(payload.clusters[0].candidates.map((c) => [c.place_id, c.open_windows]));

    expect(byId.get("tenryuji")).toEqual(["morning", "midday"]);
    expect(byId.get("shoraian")).toEqual(["midday", "evening"]);
    expect(byId.get("bamboo")).toEqual(["morning", "midday", "evening"]);
    for (const windows of byId.values()) {
      expect(windows.every((w) => ["morning", "midday", "evening"].includes(w))).toBe(true);
    }
  });

  /**
   * The test that keeps the payload small when someone "just adds lat/lng for
   * context". Every omitted field is hallucination surface, and the candidates
   * genuinely carry coordinates and periods — they are dropped on the way out.
   */
  it("omits coordinates, addresses, photos and opening periods, at every depth", () => {
    const request = buildAssignRequest(assignInput(), { client: fakeClient([]).client });
    const keys = keysDeep(serializedRequest(request));

    for (const forbidden of [
      "latitude",
      "longitude",
      "formatted_address",
      "formattedAddress",
      "photos",
      "periods",
      "opening_periods",
      "openingPeriods",
      "centroid",
    ]) {
      expect(keys).not.toContain(forbidden);
    }
    // The serialized request really did carry the candidates it was meant to.
    expect(keys).toContain("open_windows");
    expect(keys).toContain("visit_minutes");
    expect(TENRYUJI.latitude).toBeDefined();
    expect(TENRYUJI.openingPeriods).toBeDefined();
  });

  it("groups candidates by cluster and gives each group its summary", () => {
    const withShortfall = cluster([GION, KIYOMIZU, IZUJU], 0.64);
    withShortfall.shortfall = "no restaurant to seat a meal in";
    const request = buildAssignRequest(assignInput({ clusters: [cluster(ARASHIYAMA_PLACES, 0.71), withShortfall] }), {
      client: fakeClient([]).client,
    });
    const payload = payloadOf(request) as unknown as {
      days: { day: number; cluster_id: string }[];
      clusters: {
        cluster_id: string;
        cluster_score: number;
        place_count: number;
        shortfall?: string;
        candidates: { place_id: string }[];
      }[];
    };

    expect(payload.clusters).toHaveLength(2);
    expect(payload.clusters[0]).toMatchObject({
      cluster_id: "cluster-1",
      cluster_score: 0.71,
      place_count: ARASHIYAMA_PLACES.length,
    });
    expect(payload.clusters[0].candidates.map((c) => c.place_id)).toEqual(
      ARASHIYAMA_PLACES.map((p) => p.placeId),
    );
    expect(payload.clusters[1].shortfall).toBe("no restaurant to seat a meal in");
    // Each day names the group it must draw from.
    expect(payload.days.map((d) => d.cluster_id)).toEqual(["cluster-1", "cluster-2"]);
  });

  it("sets reasoning effort explicitly, and the shared prefix comes first", async () => {
    const { client, requests } = fakeClient([BOTH_DAYS]);
    await assignDays(assignInput(), { client, effort: "medium", promptCacheKey: "trip-42" });

    expect(requests[0].reasoning).toEqual({ effort: "medium" });
    expect(requests[0].input[0].role).toBe("system");
    expect(requests[0].input[0].content).toEqual(expect.any(String));
    expect(requests[0].input[0].content).not.toContain("place_id\":");
    expect(requests[0].prompt_cache_key).toBe("trip-42");
    expect(requests[0].model).toBe("gpt-5.6-terra");
    expect(requests[0].text?.format).toBeDefined();
  });

  it("defaults effort to low rather than leaving the API's medium", async () => {
    const { client, requests } = fakeClient([BOTH_DAYS]);
    await assignDays(assignInput(), { client });
    expect(requests[0].reasoning).toEqual({ effort: "low" });
  });
});

// ── the response ─────────────────────────────────────────────────────────────

describe("the Pass B response", () => {
  it("turns assignments into an ordered PackDayInput", async () => {
    const { client } = fakeClient([BOTH_DAYS]);
    const result = await assignDays(assignInput(), { client });

    expect(result.days.map((d) => d.dayIndex)).toEqual([0, 1]);
    expect(result.days[0].fallback).toBe(false);
    expect(result.days[0].input.assignments.map((a) => a.place.placeId)).toEqual([
      "bamboo",
      "shoraian",
      "tenryuji",
      "kimono",
      "yoshidaya",
    ]);
    expect(result.days[0].input.assignments.map((a) => a.role)).toEqual([
      "activity",
      "lunch",
      "activity",
      "activity",
      "dinner",
    ]);
    expect(result.dropped).toEqual([]);
    expect(result.usage?.input_tokens).toBe(4_200);
  });

  it("drops a place_id that was never in the candidate set, with a reason", async () => {
    const { client } = fakeClient([
      reply([
        {
          day: 1,
          assignments: [
            { slot_role: "activity", place_id: "bamboo" },
            { slot_role: "lunch", place_id: "ChIJ_invented_by_the_model" },
          ],
        },
        { day: 2, area_name: "Gion", assignments: DAY_TWO },
      ]),
    ]);
    const result = await assignDays(assignInput(), { client });

    expect(result.days[0].input.assignments.map((a) => a.place.placeId)).toEqual(["bamboo"]);
    expect(result.dropped).toEqual([
      {
        dayIndex: 0,
        placeId: "ChIJ_invented_by_the_model",
        reason: "not in the candidate set — nothing with this id was retrieved",
      },
    ]);
  });

  it("drops a place borrowed from another day's cluster, and says which", async () => {
    const { client } = fakeClient([
      reply([
        {
          day: 1,
          assignments: [
            { slot_role: "activity", place_id: "bamboo" },
            { slot_role: "lunch", place_id: "izuju" },
          ],
        },
        { day: 2, area_name: "Gion", assignments: DAY_TWO },
      ]),
    ]);
    const result = await assignDays(assignInput(), { client });

    expect(result.dropped).toEqual([
      { dayIndex: 0, placeId: "izuju", reason: "belongs to another day's area" },
    ]);
  });

  it("drops a repeat of a place already in the same day", async () => {
    const { client } = fakeClient([
      reply([
        {
          day: 1,
          assignments: [
            { slot_role: "activity", place_id: "bamboo" },
            { slot_role: "lunch", place_id: "shoraian" },
            { slot_role: "activity", place_id: "bamboo" },
          ],
        },
        { day: 2, area_name: "Gion", assignments: DAY_TWO },
      ]),
    ]);
    const result = await assignDays(assignInput(), { client });

    expect(result.days[0].input.assignments).toHaveLength(2);
    expect(result.dropped).toEqual([
      { dayIndex: 0, placeId: "bamboo", reason: "already assigned earlier in this day" },
    ]);
  });

  /**
   * Code owns the budget. The packer knows the real travel legs and the real
   * wall clock; truncating here on an estimate would drop a stop that fits.
   */
  it("passes an over-budget day through to the packer unchanged", async () => {
    const everything: CannedSlot[] = ARASHIYAMA_PLACES.map((p) => ({
      slot_role: p.placeId === "shoraian" ? "lunch" : p.placeId === "yoshidaya" ? "dinner" : "activity",
      place_id: p.placeId,
    }));
    const { client } = fakeClient([
      reply([
        { day: 1, assignments: everything },
        { day: 2, area_name: "Gion", assignments: DAY_TWO },
      ]),
    ]);

    const input = assignInput();
    const result = await assignDays(input, { client });
    const assigned = result.days[0].input.assignments;
    const activityMinutes = assigned
      .filter((a) => a.role === "activity")
      .reduce((sum, a) => sum + a.duration.preferred, 0);

    expect(assigned).toHaveLength(ARASHIYAMA_PLACES.length);
    expect(activityMinutes).toBeGreaterThan(input.days[0].capacity.activityMinutes);
    expect(result.days[0].fallback).toBe(false);
    expect(result.dropped).toEqual([]);
  });

  it("parses flex picks into flex, never into assignments", async () => {
    const { client } = fakeClient([BOTH_DAYS]);
    const result = await assignDays(assignInput(), { client });

    expect(result.days[0].input.flex?.map((f) => f.place.placeId)).toEqual(["monkey"]);
    expect(result.days[0].input.assignments.map((a) => a.place.placeId)).not.toContain("monkey");
    expect(result.days[0].input.flex?.[0].duration.preferred).toBeGreaterThan(0);
  });

  it("resolves durations through the ladder, enrichment where there is one", async () => {
    const { client } = fakeClient([BOTH_DAYS]);
    const input = assignInput();
    const result = await assignDays(input, { client });
    const byId = new Map(result.days[0].input.assignments.map((a) => [a.place.placeId, a.duration]));

    // Rung 2 — the 100–140 minute enriched estimate.
    expect(byId.get("tenryuji")).toEqual(
      resolveVisitDuration(TENRYUJI, TENRYUJI_ENRICHMENT, "balanced"),
    );
    expect(byId.get("tenryuji")).toEqual({ min: 100, preferred: 120, max: 140 });

    // Rung 3 — `place_of_worship` would have given it 45 instead.
    expect(byId.get("kimono")).toEqual(resolveVisitDuration(KIMONO, undefined, "balanced"));
    expect(byId.get("kimono")?.preferred).toBe(60);
    expect(byId.get("tenryuji")?.preferred).not.toBe(byId.get("kimono")?.preferred);
  });

  it("echoes area_name, and names the day from its best place when the model omits it", async () => {
    const { client } = fakeClient([
      reply([
        { day: 1, area_name: "Arashiyama", assignments: FULL_DAY },
        { day: 2, area_name: null, assignments: DAY_TWO },
      ]),
    ]);
    const result = await assignDays(assignInput(), { client });

    expect(result.days[0].areaName).toBe("Arashiyama");
    // Cluster two is best-scored-first, so its head is the best place.
    expect(result.days[1].areaName).toBe(GION.name);
  });

  it("prefers a label the caller already knows over the model's guess", async () => {
    const { client } = fakeClient([BOTH_DAYS]);
    const days = [{ ...dayRequest(0), areaName: "Sagano" }, dayRequest(1)];
    const result = await assignDays(assignInput({ days }), { client });

    expect(result.days[0].areaName).toBe("Sagano");
  });
});

// ── degradation ──────────────────────────────────────────────────────────────

describe("Pass B degradation", () => {
  it("falls back to top-scored candidates when a day comes back empty", async () => {
    const { client } = fakeClient([
      reply([
        { day: 1, assignments: [] },
        { day: 2, area_name: "Gion", assignments: DAY_TWO },
      ]),
    ]);
    const result = await assignDays(assignInput(), { client });

    expect(result.days[0].fallback).toBe(true);
    expect(result.days[0].input.assignments.length).toBeGreaterThan(0);
    // A day, not a list: meals seated in restaurants, sights around them.
    expect(result.days[0].input.assignments.map((a) => a.role)).toContain("lunch");
    expect(result.days[0].input.assignments.map((a) => a.role)).toContain("dinner");
    expect(result.days[0].input.assignments.find((a) => a.role === "lunch")?.place.placeId).toBe(
      "shoraian",
    );
    // The other day is untouched by one day's failure.
    expect(result.days[1].fallback).toBe(false);
  });

  it("offers a full day rather than exactly what it thinks will fit", async () => {
    const { client } = fakeClient([reply([{ day: 1, assignments: [] }])]);
    const result = await assignDays(assignInput({ days: [dayRequest(0)] }), { client });
    const day = result.days[0].input;

    // Five sights around two meals, in that order, plus one spare. The clock
    // decides which of them survives; nothing here trims the list first.
    expect(day.assignments.map((a) => a.place.placeId)).toEqual([
      "tenryuji",
      "shoraian",
      "bamboo",
      "kimono",
      "monkey",
      "yoshidaya",
      "boat",
    ]);
    expect(day.flex?.map((f) => f.place.placeId)).toEqual(["okochi"]);
    const used = [...day.assignments, ...(day.flex ?? [])].map((s) => s.place.placeId);
    expect(new Set(used).size).toBe(used.length);
  });

  it("retries a malformed response exactly once, then falls back without throwing", async () => {
    const { client, create } = fakeClient(["not json at all"]);
    const result = await assignDays(assignInput(), { client });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.days.every((day) => day.fallback)).toBe(true);
    expect(result.days).toHaveLength(2);
    expect(result.dropped).toEqual([]);
  });

  it("treats well-formed JSON that misses the schema the same way", async () => {
    const { client, create } = fakeClient([JSON.stringify({ itinerary: ["day one"] })]);
    const result = await assignDays(assignInput(), { client });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.days.every((day) => day.fallback)).toBe(true);
  });

  it("takes the retry's answer when the first call is the only bad one", async () => {
    const { client, create } = fakeClient(["}{", BOTH_DAYS]);
    const result = await assignDays(assignInput(), { client });

    expect(create).toHaveBeenCalledTimes(2);
    expect(result.days[0].fallback).toBe(false);
    expect(result.days[0].input.assignments).toHaveLength(5);
  });

  it("honours a retries override", async () => {
    const { client, create } = fakeClient(["not json at all"]);
    await assignDays(assignInput(), { client, retries: 0 });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("survives a thrown transport error", async () => {
    const create = vi.fn(async () => {
      throw new Error("ECONNRESET");
    });
    const result = await assignDays(assignInput(), { client: { create } as ResponsesClient });

    expect(result.days).toHaveLength(2);
    expect(result.days.every((day) => day.fallback)).toBe(true);
  });

  it("returns a well-formed day when the fallback has nothing to draw on", async () => {
    const { client } = fakeClient(["not json at all"]);
    const result = await assignDays(
      assignInput({ clusters: [cluster([], 0), cluster([], 0)] }),
      { client },
    );

    expect(result.days).toHaveLength(2);
    for (const day of result.days) {
      expect(day.fallback).toBe(true);
      expect(day.input.assignments).toEqual([]);
      expect(day.input.flex).toEqual([]);
      expect(day.areaName).toBeUndefined();
    }
  });

  it("fills a day the model never answered for", async () => {
    const { client } = fakeClient([reply([{ day: 1, assignments: FULL_DAY }])]);
    const result = await assignDays(assignInput(), { client });

    expect(result.days[0].fallback).toBe(false);
    expect(result.days[1].fallback).toBe(true);
    expect(result.days[1].input.assignments.map((a) => a.place.placeId)).toContain("kiyomizu");
  });

  it("falls back for a day with more days than clusters", async () => {
    const { client } = fakeClient([BOTH_DAYS]);
    const result = await assignDays(
      assignInput({ days: [dayRequest(0), dayRequest(1), dayRequest(2)] }),
      { client },
    );

    expect(result.days).toHaveLength(3);
    expect(result.days[2].fallback).toBe(true);
    expect(result.days[2].input.assignments).toEqual([]);
  });
});

// ── the sentence Pass B writes, and where it goes ────────────────────────────

describe("Pass B's reasoning is kept, not paid for and dropped", () => {
  it("records one entry per stop, tagged with the day it belongs to", async () => {
    const { client } = fakeClient([BOTH_DAYS]);
    const result = await assignDays(assignInput(), { client });

    const dayOne = result.rationale.filter((entry) => entry.dayIndex === 0);
    expect(dayOne.map((entry) => entry.placeId)).toEqual([
      "bamboo",
      "shoraian",
      "tenryuji",
      "kimono",
      "yoshidaya",
      "monkey",
    ]);
    for (const entry of dayOne.slice(0, 5)) {
      expect(entry.kind).toBe("assignment");
      expect(entry.why).toBe("worth the walk");
    }
  });

  it("distinguishes a spare pick from a stop", async () => {
    const { client } = fakeClient([BOTH_DAYS]);
    const result = await assignDays(assignInput(), { client });

    const flex = result.rationale.filter((entry) => entry.kind === "flex");
    expect(flex).toEqual([
      { dayIndex: 0, placeId: "monkey", kind: "flex", why: "if there is time" },
    ]);
  });

  it("keeps prose out of the packer's input entirely", async () => {
    const { client } = fakeClient([BOTH_DAYS]);
    const result = await assignDays(assignInput(), { client });

    // `SlotAssignment` is arithmetic over minutes. A `why` on it would be prose
    // the packer has to carry past every shrink, drop and swap.
    for (const assignment of result.days[0].input.assignments) {
      expect(assignment).not.toHaveProperty("why");
    }
  });

  it("records nothing for an id it refused", async () => {
    const { client } = fakeClient([
      reply([
        {
          day: 1,
          assignments: [
            { slot_role: "activity", place_id: "bamboo" },
            { slot_role: "lunch", place_id: "ChIJ_invented_by_the_model" },
          ],
        },
        { day: 2, area_name: "Gion", assignments: DAY_TWO },
      ]),
    ]);
    const result = await assignDays(assignInput(), { client });

    expect(result.rationale.map((entry) => entry.placeId)).not.toContain(
      "ChIJ_invented_by_the_model",
    );
  });

  it("skips a blank sentence rather than storing an empty string", async () => {
    const { client } = fakeClient([
      JSON.stringify({
        days: [
          {
            day: 1,
            area_name: "Arashiyama",
            assignments: [{ slot_role: "activity", place_id: "bamboo", why: "   " }],
            flex: [],
          },
          {
            day: 2,
            area_name: "Gion",
            assignments: [{ slot_role: "activity", place_id: "gion", why: null }],
            flex: [],
          },
        ],
      }),
    ]);
    const result = await assignDays(assignInput(), { client });

    expect(result.rationale).toEqual([]);
    // And the stops themselves are unaffected — a missing sentence is not a
    // reason to lose the assignment.
    expect(result.days[0].input.assignments.map((a) => a.place.placeId)).toEqual(["bamboo"]);
  });

  it("has nothing to record when the whole call failed", async () => {
    const { client } = fakeClient(["not json at all"]);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await assignDays(assignInput(), { client });

    expect(result.days.every((day) => day.fallback)).toBe(true);
    expect(result.rationale).toEqual([]);
    error.mockRestore();
  });
});

describe("a refused id is said out loud", () => {
  it("warns once per drop, naming the day, the place and the reason", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeClient([
      reply([
        {
          day: 1,
          assignments: [
            { slot_role: "activity", place_id: "bamboo" },
            { slot_role: "lunch", place_id: "izuju" },
          ],
        },
        { day: 2, area_name: "Gion", assignments: DAY_TWO },
      ]),
    ]);

    await assignDays(assignInput(), { client });

    expect(warn).toHaveBeenCalledTimes(1);
    const [line] = warn.mock.calls[0];
    expect(line).toContain("day 1");
    expect(line).toContain("izuju");
    expect(line).toContain("belongs to another day's area");
    warn.mockRestore();
  });

  it("says nothing when the model named only ids it was given", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { client } = fakeClient([BOTH_DAYS]);
    await assignDays(assignInput(), { client });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("only a restaurant may hold a meal", () => {
  // The live failure: Pass B seated lunch at TANGS at Tang Plaza and dinner at
  // Mandarin Gallery, both department stores. `validate.ts` refused both with
  // "not somewhere you can eat a meal", and the day shipped with one stop.
  it("tells the model which places can hold a meal", () => {
    const request = buildAssignRequest(assignInput(), { client: fakeClient([]).client })
    const content = request.input[1].content
    if (typeof content !== "string") throw new Error("Pass B payload must be text")
    const payload = JSON.parse(content) as {
      clusters: { candidates: { types: string[]; can_hold_a_meal: boolean }[] }[]
    }
    const candidates = payload.clusters.flatMap((c) => c.candidates)
    expect(candidates.length).toBeGreaterThan(0)
    for (const candidate of candidates) {
      const isRestaurant = candidate.types.some(
        (t) => t === "restaurant" || t.endsWith("_restaurant"),
      )
      expect(candidate.can_hold_a_meal).toBe(isRestaurant)
    }
    // Both answers have to occur, or the flag is a constant and proves nothing.
    expect(candidates.some((c) => c.can_hold_a_meal)).toBe(true)
    expect(candidates.some((c) => !c.can_hold_a_meal)).toBe(true)
  })

  it("keeps a non-restaurant named for lunch, as an activity", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { client } = fakeClient([
      reply([
        {
          day: 1,
          assignments: [
            // Kimono Forest is a tourist attraction. A perfectly good hour, and
            // not lunch.
            { slot_role: "lunch", place_id: "kimono" },
            { slot_role: "activity", place_id: "bamboo" },
          ],
        },
        { day: 2, area_name: "Gion", assignments: DAY_TWO },
      ]),
    ])

    const result = await assignDays(assignInput(), { client })
    const dayOne = result.days[0].input.assignments
    const kimono = dayOne.find((a) => a.place.placeId === "kimono")

    // Demoted, not dropped: punishing the model's mistake by deleting the stop
    // costs the traveller a place they never chose wrongly.
    expect(kimono).toBeDefined()
    expect(kimono!.role).toBe("activity")
    expect(dayOne.some((a) => a.role === "lunch")).toBe(false)

    // And it is recorded, both durably and on the terminal.
    expect(result.dropped.some((d) => d.placeId === "kimono")).toBe(true)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it("leaves a real restaurant in its meal slot", async () => {
    const { client } = fakeClient([BOTH_DAYS])
    const result = await assignDays(assignInput(), { client })
    const meals = result.days.flatMap((d) =>
      d.input.assignments.filter((a) => a.role === "lunch" || a.role === "dinner"),
    )
    expect(meals.length).toBeGreaterThan(0)
    for (const meal of meals) {
      expect(meal.place.types.some((t) => t === "restaurant" || t.endsWith("_restaurant"))).toBe(
        true,
      )
    }
  })
})
