/**
 * Compute Route Matrix — see `routes.ts`.
 *
 * The fake is a `FetchLike` that records what was asked and answers with a
 * hand-built element list, so every assertion here is about the request we send
 * and the answers we accept. No network, no mocking framework.
 *
 * The theme running through these: this module degrades to the straight line on
 * every failure, so almost every wrong behaviour produces a working itinerary.
 * A test that only checks "a leg came back" would pass with the whole module
 * deleted. So the assertions are on the counters and on the mode.
 */

import { describe, expect, it } from "vitest";

import type { FetchLike } from "./http";
import type { TravelLegProvider } from "./pack";
import type { CandidatePlace } from "./types";
import {
  MAX_ELEMENTS,
  TRANSIT_MIN_SAVING_MINUTES,
  buildTravelMatrix,
  chunkPairs,
  departureTimeFor,
} from "./routes";

// ── fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date("2026-08-26T09:00:00.000Z");

const place = (id: string, longitude: number, latitude = 1.28): CandidatePlace => ({
  placeId: id,
  name: id,
  types: ["tourist_attraction"],
  latitude,
  longitude,
});

const A = place("a", 103.85);
const B = place("b", 103.86);
const C = place("c", 103.87);

/** Never called unless the matrix has no answer — which is the point of it. */
const straightLine: TravelLegProvider = () => ({ minutes: 99, meters: 9999 });

interface Recorded {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** `minutesFor` returns the leg in minutes, or undefined for "no route". */
function fakeRoutes(
  minutesFor: (mode: string, from: string, to: string) => number | undefined,
  options: { fail?: string; status?: number } = {},
): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetch: FetchLike = async (url, init) => {
    const body = JSON.parse(init.body ?? "{}") as Record<string, unknown>;
    calls.push({ url, headers: init.headers, body });
    const mode = String(body.travelMode);
    if (options.fail === mode) {
      return {
        ok: false,
        status: options.status ?? 403,
        text: async () => "Routes API has not been used in project",
        json: async () => ({}),
      };
    }
    const origins = body.origins as { waypoint: Record<string, unknown> }[];
    const destinations = body.destinations as { waypoint: Record<string, unknown> }[];
    const idOf = (w: Record<string, unknown>) =>
      (w.placeId as string) ??
      String((w.location as { latLng: { longitude: number } }).latLng.longitude);
    const elements = origins.flatMap((origin, originIndex) =>
      destinations.flatMap((destination, destinationIndex) => {
        const minutes = minutesFor(mode, idOf(origin.waypoint), idOf(destination.waypoint));
        if (minutes === undefined) {
          return [{ originIndex, destinationIndex, condition: "ROUTE_NOT_FOUND" }];
        }
        return [
          {
            originIndex,
            destinationIndex,
            condition: "ROUTE_EXISTS",
            distanceMeters: minutes * 80,
            duration: `${minutes * 60}s`,
          },
        ];
      }),
    );
    return { ok: true, status: 200, text: async () => "", json: async () => elements };
  };
  return { fetch, calls };
}

const build = (places: CandidatePlace[], fetch: FetchLike) =>
  buildTravelMatrix(places, straightLine, { apiKey: "k", fetch, now: NOW });

// ── the request ──────────────────────────────────────────────────────────────

describe("buildTravelMatrix — the request", () => {
  it("asks for status in the field mask", async () => {
    // Without it a per-element failure arrives looking like a successful
    // element, and gets read as a zero-length leg.
    const { fetch, calls } = fakeRoutes(() => 10);
    await build([A, B], fetch);
    for (const call of calls) {
      expect(call.headers["X-Goog-FieldMask"]).toContain("status");
      expect(call.headers["X-Goog-FieldMask"]).toContain("originIndex");
      expect(call.headers["X-Goog-Api-Key"]).toBe("k");
    }
  });

  it("asks for walking and transit, and nothing else", async () => {
    const { fetch, calls } = fakeRoutes(() => 10);
    await build([A, B], fetch);
    expect(calls.map((call) => call.body.travelMode).sort()).toEqual(["TRANSIT", "WALK"]);
  });

  it("sends a departure time on transit and none on walking", async () => {
    // `routingPreference` and `departureTime` are rejected or meaningless
    // outside their modes, and walking does not have a timetable.
    const { fetch, calls } = fakeRoutes(() => 10);
    await build([A, B], fetch);
    const transit = calls.find((call) => call.body.travelMode === "TRANSIT")!;
    const walk = calls.find((call) => call.body.travelMode === "WALK")!;
    expect(typeof transit.body.departureTime).toBe("string");
    expect(walk.body.departureTime).toBeUndefined();
    expect(transit.body.routingPreference).toBeUndefined();
  });

  it("names places by place id, which routes to an entrance rather than a kerb", async () => {
    const { fetch, calls } = fakeRoutes(() => 10);
    await build([A, B], fetch);
    // Both matrices are in flight at once, so assert on every call rather than
    // on whichever landed first.
    for (const call of calls) {
      expect(call.body.origins).toEqual([
        { waypoint: { placeId: "a" } },
        { waypoint: { placeId: "b" } },
      ]);
      expect(call.body.destinations).toEqual(call.body.origins);
    }
  });

  it("skips a place with no coordinates rather than sending a null island", async () => {
    const nowhere: CandidatePlace = { placeId: "nowhere", name: "nowhere", types: [] };
    const { fetch, calls } = fakeRoutes(() => 10);
    await build([A, B, nowhere], fetch);
    const ids = (calls[0].body.destinations as { waypoint: { placeId: string } }[]).map(
      (d) => d.waypoint.placeId,
    );
    expect(ids).toEqual(["a", "b"]);
  });
});

// ── the answer ───────────────────────────────────────────────────────────────

describe("buildTravelMatrix — choosing a mode", () => {
  it("walks when transit saves nothing worth boarding for", async () => {
    const { fetch } = fakeRoutes((mode) =>
      mode === "WALK" ? 12 : 12 - (TRANSIT_MIN_SAVING_MINUTES - 1),
    );
    const matrix = await build([A, B], fetch);
    const leg = matrix.getTravelLeg(A, B);
    expect(leg.mode).toBe("walk");
    expect(leg.minutes).toBe(12);
    expect(matrix.stats.chosenTransit).toBe(0);
  });

  it("takes transit when it is meaningfully faster", async () => {
    const { fetch } = fakeRoutes((mode) => (mode === "WALK" ? 17 : 11));
    const matrix = await build([A, B], fetch);
    const leg = matrix.getTravelLeg(A, B);
    expect(leg.mode).toBe("transit");
    expect(leg.minutes).toBe(11);
    expect(matrix.stats.chosenTransit).toBe(2); // a→b and b→a
  });

  it("walks when no line connects the two places", async () => {
    const { fetch } = fakeRoutes((mode) => (mode === "WALK" ? 14 : undefined));
    const matrix = await build([A, B], fetch);
    expect(matrix.getTravelLeg(A, B).mode).toBe("walk");
    expect(matrix.stats.transitLegs).toBe(0);
    expect(matrix.stats.estimated).toBe(0);
  });

  it("reads the returned mode as authoritative, so the distance threshold cannot override it", async () => {
    // A and B are ~1.1 km apart, under `WALK_MAX_METERS` — the old rule would
    // call this a walk however long the bus saved.
    const { fetch } = fakeRoutes((mode) => (mode === "WALK" ? 20 : 6));
    const matrix = await build([A, B], fetch);
    expect(matrix.getTravelLeg(A, B).mode).toBe("transit");
  });
});

// ── degradation, which is the part that hides ────────────────────────────────

describe("buildTravelMatrix — falling back", () => {
  it("counts a pair it never routed instead of pretending it did", async () => {
    const { fetch } = fakeRoutes(() => 10);
    const matrix = await build([A, B], fetch);
    const leg = matrix.getTravelLeg(A, C); // C was never in the matrix
    expect(leg.minutes).toBe(99); // the straight line
    expect(matrix.stats.estimated).toBe(1);
  });

  it("records the reason when a whole mode is refused, and still returns a provider", async () => {
    // A key without the Routes API enabled answers 403 to every request. The
    // trip must still be planned — on the other mode.
    const { fetch } = fakeRoutes(() => 10, { fail: "TRANSIT" });
    const matrix = await build([A, B], fetch);
    expect(matrix.stats.errors.join(" ")).toMatch(/TRANSIT: Route Matrix 403/);
    expect(matrix.stats.transitLegs).toBe(0);
    expect(matrix.getTravelLeg(A, B).mode).toBe("walk");
  });

  it("degrades to the straight line when both modes fail, and says so", async () => {
    const dead: FetchLike = async () => {
      throw new Error("socket hang up");
    };
    const matrix = await buildTravelMatrix([A, B], straightLine, {
      apiKey: "k",
      fetch: dead,
      now: NOW,
    });
    expect(matrix.getTravelLeg(A, B).minutes).toBe(99);
    expect(matrix.stats.estimated).toBe(1);
    expect(matrix.stats.errors).toHaveLength(2); // one per mode
  });

  it("refuses a body that is not the array the endpoint documents", async () => {
    // A shape change here would otherwise read as "no routes" and silently
    // estimate every leg in the trip.
    const wrongShape: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({ elements: [] }),
    });
    const matrix = await buildTravelMatrix([A, B], straightLine, {
      apiKey: "k",
      fetch: wrongShape,
      now: NOW,
    });
    expect(matrix.stats.errors.join(" ")).toMatch(/non-array/);
  });

  it("ignores an element carrying a status, rather than reading it as a zero leg", async () => {
    const withStatus: FetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => [
        {
          originIndex: 0,
          destinationIndex: 1,
          condition: "ROUTE_EXISTS",
          duration: "0s",
          status: { code: 3, message: "invalid waypoint" },
        },
      ],
    });
    const matrix = await buildTravelMatrix([A, B], straightLine, {
      apiKey: "k",
      fetch: withStatus,
      now: NOW,
    });
    expect(matrix.getTravelLeg(A, B).minutes).toBe(99);
    expect(matrix.stats.estimated).toBe(1);
  });

  it("makes no request at all for a day with nothing to travel between", async () => {
    const { fetch, calls } = fakeRoutes(() => 10);
    const matrix = await buildTravelMatrix([A], straightLine, { apiKey: "k", fetch, now: NOW });
    expect(calls).toHaveLength(0);
    expect(matrix.stats.requests).toBe(0);
  });
});

// ── the caps ─────────────────────────────────────────────────────────────────

describe("chunkPairs", () => {
  const many = Array.from({ length: 16 }, (_, i) => place(`p${i}`, 103.8 + i * 0.01));

  it("keeps a 16-place day inside the transit cap", () => {
    const chunks = chunkPairs(many, MAX_ELEMENTS.TRANSIT);
    for (const chunk of chunks) {
      expect(chunk.origins.length * chunk.destinations.length).toBeLessThanOrEqual(
        MAX_ELEMENTS.TRANSIT,
      );
    }
  });

  it("covers every pair exactly once", () => {
    const seen = new Set<string>();
    for (const chunk of chunkPairs(many, MAX_ELEMENTS.TRANSIT)) {
      for (const from of chunk.origins) {
        for (const to of chunk.destinations) {
          const key = `${from.placeId}->${to.placeId}`;
          expect(seen.has(key)).toBe(false);
          seen.add(key);
        }
      }
    }
    expect(seen.size).toBe(many.length * many.length);
  });

  it("sends a 16-place walking matrix in one request and a transit one in three", async () => {
    // 256 elements: under the walking cap of 625, and three slices of 6×16=96
    // under the transit cap of 100.
    const { fetch, calls } = fakeRoutes(() => 10);
    await build(many, fetch);
    expect(calls.filter((call) => call.body.travelMode === "WALK")).toHaveLength(1);
    expect(calls.filter((call) => call.body.travelMode === "TRANSIT")).toHaveLength(3);
  });
});

describe("departureTimeFor", () => {
  const singapore = [A, B, C]; // ~103.86°E, so +7 by longitude
  const newYork = [place("nyc", -73.98, 40.75)]; // ~-74°W, so -5

  it("prices the day at mid-morning where the places actually are", () => {
    // 10:00 in Singapore is 03:00 UTC. Midnight UTC — the obvious naive choice
    // — would be 08:00 there, and 19:00 the previous evening in New York.
    expect(departureTimeFor("2026-09-14", singapore, NOW)).toBe("2026-09-14T03:00:00.000Z");
    expect(departureTimeFor("2026-09-14", newYork, NOW)).toBe("2026-09-14T15:00:00.000Z");
  });

  it("clamps a trip in the past forward rather than dropping transit entirely", () => {
    // Google refuses a departure more than about a week back. A nearby week's
    // timetable is a far better answer than no transit at all.
    const clamped = new Date(departureTimeFor("2020-01-01", singapore, NOW));
    expect(clamped.getTime()).toBeGreaterThan(NOW.getTime() - 7 * 86_400_000);
    expect(clamped.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });

  it("clamps a trip too far out back inside the window", () => {
    const clamped = new Date(departureTimeFor("2030-01-01", singapore, NOW));
    expect(clamped.getTime()).toBeLessThan(NOW.getTime() + 100 * 86_400_000);
  });

  it("falls back to now for a date it cannot read, rather than an invalid instant", () => {
    expect(departureTimeFor("not-a-date", singapore, NOW)).toBe(NOW.toISOString());
  });
});
