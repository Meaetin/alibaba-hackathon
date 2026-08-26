/**
 * The persistence half of Step 15.
 *
 * Two kinds of test in one file, deliberately. The row shapers are pure
 * functions over a `PlanResult` and are tested as such — no database, no skip,
 * they run on every commit. `saveItinerary` itself is an integration test that
 * skips unless `DATABASE_URL` is set, following
 * `src/lib/db/schema.integration.test.ts`: it is a pre-demo check, not a
 * per-commit gate.
 *
 * What the shapers have to get right is small and easy to get wrong: only
 * `activity` segments become rows, travel is folded into the stop it leaves
 * rather than becoming a row of its own, and the last stop of a day has no leg.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/neon-http/migrator";

import { emptyPlannerDebug } from "@/lib/planner/debug";
import type { StopContent } from "@/lib/planner/narrate";
import type { PackedDay, TimelineSegment } from "@/lib/planner/pack";
import type { PlanResult, PlannedDay } from "@/lib/planner/pipeline";
import type { RetrievedPlace } from "@/lib/planner/retrieval";
import type { ScoredPlace } from "@/lib/planner/score";
import type { PreferenceProfile } from "@/lib/planner/types";

import { createDb, type Database } from "./client";
import {
  activityRows,
  dayRow,
  itineraryRow,
  saveItinerary,
  toJobProgress,
} from "./itineraries";
import { itineraries, itinerary_activities, itinerary_days, locations } from "./schema";
import { createLocationStore } from "./stores";

// ── a hand-built plan ────────────────────────────────────────────────────────

const PROFILE: PreferenceProfile = {
  interests: ["cafes", "temples"],
  dietary: ["vegetarian"],
  pace: "balanced",
  budget: 2,
};

function place(placeId: string, name: string, latitude: number): RetrievedPlace {
  return {
    placeId,
    name,
    city: "Kyoto",
    types: ["cafe"],
    latitude,
    longitude: 135.77,
    reviewSnippets: null,
    shortlistHydratedAt: null,
    photoNames: [],
    photoUrls: null,
    photosResolvedAt: null,
    fetchedAt: new Date("2026-08-24T09:00:00.000Z"),
  };
}

const PLACES = new Map<string, RetrievedPlace>([
  ["p1", place("p1", "Kissa Master", 35.0)],
  ["p2", place("p2", "Nanzen-ji", 35.01)],
]);

const SEGMENTS: TimelineSegment[] = [
  { kind: "activity", placeId: "p1", name: "Kissa Master", role: "activity", position: 1, startMin: 540, endMin: 600 },
  { kind: "travel", mode: "walk", startMin: 600, endMin: 615, fromName: "Kissa Master", toName: "Nanzen-ji" },
  { kind: "break", reason: "free", startMin: 615, endMin: 630 },
  { kind: "activity", placeId: "p2", name: "Nanzen-ji", role: "lunch", position: 2, startMin: 690, endMin: 765 },
];

const DAY: PackedDay = {
  segments: SEGMENTS,
  dropped: [{ placeId: "p3", name: "Somewhere else", reason: "over budget — no room left in the day" }],
};

const CONTENT = new Map<string, StopContent>([
  [
    "p1",
    {
      whyForYou: "You asked for coffee and this is the good stuff.",
      highlights: ["the counter", "the siphon"],
      tips: ["Go early."],
    },
  ],
  [
    "p2",
    {
      whyForYou: "A vegetarian lunch inside a temple garden.",
      highlights: ["the aqueduct"],
      foodRecommendations: [{ dish: "yudofu", note: "the reason to come" }],
    },
  ],
]);

const SCORED = new Map<string, ScoredPlace>([
  ["p1", { placeId: "p1", score: 0.81, reasons: ["matches: cafes", "4.6★ · 2.1k reviews"] }],
  ["p2", { placeId: "p2", score: 0.74, reasons: ["matches: temples"] }],
]);

const PLANNED_DAY: PlannedDay = {
  dayIndex: 0,
  date: "2026-09-14",
  areaName: "Higashiyama",
  weekday: 1,
  day: DAY,
  input: { assignments: [], flex: [] },
  repairs: [],
  failures: [],
  travelToNext: new Map([["p1", { mode: "walk", minutes: 15, meters: 900 }]]),
};

const RESULT = {
  request: {
    city: "Kyoto",
    country: "Japan",
    startDate: "2026-09-14",
    totalDays: 1,
    profile: PROFILE,
  },
  days: [PLANNED_DAY],
  places: PLACES,
  content: CONTENT,
  scored: SCORED,
  funnelStats: { retrieved: 86, afterFilters: 82, afterClusterCap: 60, afterGlobalCap: 42 },
  debug: emptyPlannerDebug("2026-09-14T00:00:00.000Z"),
  stats: {} as PlanResult["stats"],
} satisfies Omit<PlanResult, "stats"> & { stats: PlanResult["stats"] };

// ── the shapers ──────────────────────────────────────────────────────────────

describe("itineraryRow", () => {
  it("carries the request, the profile and the funnel's own numbers", () => {
    const row = itineraryRow(RESULT);
    expect(row.city).toBe("Kyoto");
    expect(row.country).toBe("Japan");
    expect(row.start_date).toBe("2026-09-14");
    expect(row.total_days).toBe(1);
    expect(row.profile).toEqual(PROFILE);
    expect(row.funnel_stats).toEqual(RESULT.funnelStats);
    expect(row.planner_debug).toEqual(RESULT.debug);
  });

  it("names the trip after the city when the caller didn't", () => {
    expect(itineraryRow(RESULT).name).toBe("Kyoto trip");
    expect(itineraryRow({ ...RESULT, request: { ...RESULT.request, name: "  " } }).name).toBe(
      "Kyoto trip",
    );
    expect(
      itineraryRow({ ...RESULT, request: { ...RESULT.request, name: "Autumn in Kyoto" } }).name,
    ).toBe("Autumn in Kyoto");
  });

  it("centres the map on the stops, not on nothing", () => {
    const row = itineraryRow(RESULT);
    expect(row.latitude).toBeCloseTo(35.005, 5);
    expect(row.longitude).toBeCloseTo(135.77, 5);
    // A trip whose stops have no coordinates stores null rather than (0, 0) —
    // the null island is a pin in the Gulf of Guinea.
    const unlocated = itineraryRow({
      ...RESULT,
      places: new Map([["p1", { ...place("p1", "Kissa Master", 0), latitude: undefined, longitude: undefined }]]),
    });
    expect(unlocated.latitude).toBeNull();
    expect(unlocated.longitude).toBeNull();
  });
});

describe("dayRow", () => {
  it("dates the day and names its area", () => {
    expect(dayRow("itin-1", PLANNED_DAY)).toEqual({
      itinerary_id: "itin-1",
      day_index: 0,
      date: "2026-09-14",
      area_name: "Higashiyama",
    });
  });

  it("stores a null area rather than inventing one", () => {
    expect(dayRow("itin-1", { ...PLANNED_DAY, areaName: undefined }).area_name).toBeNull();
  });
});

describe("activityRows", () => {
  const context = {
    locationIds: new Map([["p1", "loc-1"]]),
    content: CONTENT,
    scored: SCORED,
  };

  it("turns only the stops into rows — travel and breaks are not stops", () => {
    const rows = activityRows("day-1", PLANNED_DAY, context);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.position)).toEqual([1, 2]);
    expect(rows.map((row) => row.slot_role)).toEqual(["activity", "lunch"]);
  });

  it("stores minutes from midnight, never a timestamp", () => {
    const [first, second] = activityRows("day-1", PLANNED_DAY, context);
    expect(first.start_min).toBe(540);
    expect(first.end_min).toBe(600);
    expect(second.start_min).toBe(690);
    expect(second.end_min).toBe(765);
  });

  it("folds the outgoing leg into the stop it leaves, and leaves the last one bare", () => {
    const [first, second] = activityRows("day-1", PLANNED_DAY, context);
    expect(first.travel_to_next).toEqual({ mode: "walk", minutes: 15, meters: 900 });
    expect(second.travel_to_next).toBeNull();
  });

  it("resolves location_id where the row exists and stores null where it does not", () => {
    const [first, second] = activityRows("day-1", PLANNED_DAY, context);
    expect(first.location_id).toBe("loc-1");
    expect(second.location_id).toBeNull();
  });

  it("carries the score and match reasons the funnel produced", () => {
    const [first] = activityRows("day-1", PLANNED_DAY, context);
    expect(first.score).toBeCloseTo(0.81, 5);
    expect(first.match_reasons).toEqual(["matches: cafes", "4.6★ · 2.1k reviews"]);
  });

  it("stores Pass C's content field by field, and null when the stop has none", () => {
    const [first, second] = activityRows("day-1", PLANNED_DAY, context);
    expect(first.content).toEqual({
      whyForYou: "You asked for coffee and this is the good stuff.",
      highlights: ["the counter", "the siphon"],
      tips: ["Go early."],
    });
    // No `foodRecommendations` key at all on a non-meal stop, rather than null.
    expect(Object.keys(first.content!)).not.toContain("foodRecommendations");
    expect(second.content).toMatchObject({
      foodRecommendations: [{ dish: "yudofu", note: "the reason to come" }],
    });

    const bare = activityRows("day-1", PLANNED_DAY, { ...context, content: new Map() });
    expect(bare.every((row) => row.content === null)).toBe(true);
  });

  it("stores an empty day as no rows rather than as a row with nothing in it", () => {
    const empty: PlannedDay = { ...PLANNED_DAY, day: { segments: [], dropped: [] } };
    expect(activityRows("day-1", empty, context)).toEqual([]);
  });
});

describe("toJobProgress", () => {
  const now = new Date("2026-08-24T09:00:00.000Z");

  it("adds the four fields the loading screen animates on", () => {
    const progress = toJobProgress(
      { stage: "assign", label: "Choosing what goes on which day", percent: 32, done: 4, total: 9 },
      now,
    );
    expect(progress.fired_at).toBe(now.toISOString());
    expect(progress.next_percent).toBeGreaterThan(progress.percent);
    expect(progress.stage_ms).toBeGreaterThan(0);
    expect(progress.eta_seconds).toBeGreaterThan(0);
  });

  it("leaves `step` unset — that ordinal belongs to another pipeline", () => {
    const progress = toJobProgress(
      { stage: "retrieve", label: "Searching for places", percent: 0, done: 0, total: 9 },
      now,
    );
    expect(progress.step).toBeUndefined();
  });

  it("runs the countdown to zero at the end", () => {
    const done = toJobProgress(
      { stage: "done", label: "Your trip is ready", percent: 100, done: 9, total: 9 },
      now,
    );
    expect(done.eta_seconds).toBe(0);
    expect(done.next_percent).toBe(100);
  });
});

// ── the write ────────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;

/** Every row this file writes carries it, so cleanup can't touch real data. */
const RUN_TAG = "itest-step15";

describe.skipIf(!DATABASE_URL)("saveItinerary", () => {
  let db: Database;

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    await migrate(db, { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(itineraries).where(like(itineraries.name, `${RUN_TAG}%`));
    await db.delete(locations).where(like(locations.place_id, `${RUN_TAG}%`));
  });

  it("writes the itinerary, its days and its stops, and joins the stops to locations", async () => {
    const store = createLocationStore(db);
    const rows = [
      { ...place(`${RUN_TAG}-p1`, "Kissa Master", 35.0) },
      { ...place(`${RUN_TAG}-p2`, "Nanzen-ji", 35.01) },
    ];
    await store.upsertMany(rows);

    const result = {
      ...RESULT,
      request: { ...RESULT.request, name: `${RUN_TAG} Kyoto` },
      days: [
        {
          ...PLANNED_DAY,
          day: {
            ...DAY,
            segments: SEGMENTS.map((segment) =>
              segment.kind === "activity"
                ? { ...segment, placeId: `${RUN_TAG}-${segment.placeId}` }
                : segment,
            ),
          },
          travelToNext: new Map([
            [`${RUN_TAG}-p1`, { mode: "walk" as const, minutes: 15, meters: 900 }],
          ]),
        },
      ],
      places: new Map(rows.map((row) => [row.placeId, row])),
      content: new Map([...CONTENT].map(([id, value]) => [`${RUN_TAG}-${id}`, value])),
      scored: new Map(
        [...SCORED].map(([id, value]) => [
          `${RUN_TAG}-${id}`,
          { ...value, placeId: `${RUN_TAG}-${id}` },
        ]),
      ),
    };

    const { itineraryId } = await saveItinerary(db, result);
    expect(itineraryId).toMatch(/^[0-9a-f-]{36}$/);

    const [stored] = await db.select().from(itineraries).where(eq(itineraries.id, itineraryId));
    expect(stored.city).toBe("Kyoto");
    expect(stored.start_date).toBe("2026-09-14");
    expect(stored.funnel_stats).toEqual(RESULT.funnelStats);
    expect(stored.profile).toEqual(PROFILE);

    const days = await db
      .select()
      .from(itinerary_days)
      .where(eq(itinerary_days.itinerary_id, itineraryId));
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-09-14");
    expect(days[0].area_name).toBe("Higashiyama");

    const activities = await db
      .select()
      .from(itinerary_activities)
      .where(eq(itinerary_activities.day_id, days[0].id));
    expect(activities).toHaveLength(2);
    const byPosition = activities.sort((a, b) => a.position - b.position);
    expect(byPosition[0].start_min).toBe(540);
    expect(byPosition[0].location_id).not.toBeNull();
    expect(byPosition[0].travel_to_next).toEqual({ mode: "walk", minutes: 15, meters: 900 });
    expect(byPosition[1].travel_to_next).toBeNull();
    expect(byPosition[1].content).toMatchObject({
      foodRecommendations: [{ dish: "yudofu", note: "the reason to come" }],
    });
  });
});
