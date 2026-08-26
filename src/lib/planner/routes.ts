/**
 * Real travel times, from the Routes API's Compute Route Matrix.
 *
 * What this replaces is a straight line and two constants: `createStraightLineTravel`
 * measured great-circle metres, divided by 80 m/min, and called anything under
 * 1200 m a walk. That threshold decided the *mode* as well as the minutes, so a
 * 1035 m leg was a walk and a 1208 m leg was a bus, 173 metres apart, and
 * neither was ever looked up. Google routes the first one in 11 minutes on the
 * 131 bus; we called it a 23-minute walk.
 *
 * **A matrix, not per-leg directions, and the reason is the interface.**
 * `TravelLegProvider` says never let a network call sit behind this signature —
 * `packDay` calls it hundreds of times per day hunting for a set of durations
 * that fits, and `sequenceDay` calls it thousands of times enumerating orders.
 * Per-leg Directions would be thousands of billed requests for one day. So the
 * whole N×N is fetched once, up front, and the provider is a map lookup. The
 * seam does not change at all: this returns the same `TravelLegProvider` the
 * pipeline already passes around.
 *
 * **Two matrices, because the mode is a measurement and not a guess.** We ask
 * for walking and transit over the same pairs and take the faster, subject to
 * `TRANSIT_MIN_SAVING_MINUTES` — nobody boards a bus to save ninety seconds.
 * Google's transit duration already includes the walk to the stop and the wait,
 * so the two numbers are directly comparable.
 *
 * **Everything degrades to the straight line, and every degradation is
 * counted.** A pair Google will not route, a key without the Routes API turned
 * on, a request that times out: all of them fall back to crow-flight, which is
 * exactly what shipped before. That is also how this could fail invisibly — a
 * trip built entirely on fallbacks looks identical to one built on real
 * routing. So `TravelMatrixStats` is the point of the module as much as the
 * durations are, and the wiring test asserts on the counters.
 */

import { metersBetween } from "./geo";
import type { FetchLike } from "./http";
import type { TravelLeg, TravelLegProvider, TravelMode } from "./pack";
import type { CandidatePlace } from "./types";

// ── the wire ─────────────────────────────────────────────────────────────────

const ROUTE_MATRIX_URL = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix";

/**
 * `status` is mandatory in this mask — the reference says so outright, and
 * without it a per-element failure arrives as an element with no error on it
 * and gets read as a zero-length leg. The two indices are equally load-bearing:
 * the response is not required to come back in request order.
 */
const ROUTE_MATRIX_FIELD_MASK = [
  "originIndex",
  "destinationIndex",
  "status",
  "condition",
  "distanceMeters",
  "duration",
].join(",");

/**
 * Google's per-request element caps. Transit is the tight one by a factor of
 * six, which is what makes `chunkPairs` necessary rather than defensive.
 */
export const MAX_ELEMENTS = { WALK: 625, TRANSIT: 100 } as const;

/**
 * At most this many places may name themselves by `placeId` in one request —
 * origins and destinations counted together. A place id routes to the entrance
 * Google knows about; a bare coordinate routes to the nearest road, which for a
 * park entrance is a different corner of it.
 */
const MAX_PLACE_ID_WAYPOINTS = 50;

/** Transit has to save at least this much before it is worth boarding. */
export const TRANSIT_MIN_SAVING_MINUTES = 5;

/** Google refuses a transit departure outside roughly -7 to +100 days. We keep
 *  well inside it: a trip planned for last month still has to route. */
const DEPARTURE_WINDOW = { minDays: -6, maxDays: 99 } as const;

/**
 * The local hour we price transit at: mid-morning, between the day's 9:00 start
 * and its first meal, on a full weekday timetable.
 *
 * One hour has to stand for a day that runs 9:00 to 21:00, because the
 * departure time is an input to the matrix and the matrix is built before the
 * clock is stamped — asking per-leg would mean a request per leg, which is the
 * whole thing this module exists to avoid. The cost of the simplification is
 * roughly the difference between midday and evening frequency on the same line.
 */
const REPRESENTATIVE_LOCAL_HOUR = 10;

// ── what a caller gets ───────────────────────────────────────────────────────

export interface TravelMatrixStats {
  /** Billed requests. Two matrices, each possibly chunked. */
  requests: number;
  /** Pairs the walking matrix answered. */
  walkLegs: number;
  /** Pairs the transit matrix answered. */
  transitLegs: number;
  /** Legs the provider served as transit because it was meaningfully faster. */
  chosenTransit: number;
  /**
   * Pairs no matrix could answer, served from the straight line instead.
   * Non-zero is normal — an alternate swapped in by `validate.ts` was never in
   * the matrix. Equal to the number of pairs asked for means the routing never
   * worked at all, and the trip only *looks* routed.
   */
  estimated: number;
  /** Why routing degraded, if it did. Empty on a clean run. */
  errors: string[];
}

export interface RouteMatrixDeps {
  apiKey: string;
  fetch?: FetchLike;
  /**
   * The day being routed, "YYYY-MM-DD". Transit answers change with the
   * timetable, so a Sunday leg must not be priced on a Tuesday service — this
   * is a real input, not a formality. The instant is derived from it by
   * `departureTimeFor`; omitted, transit is priced for right now.
   */
  departureDate?: string;
  /** Clamps the departure into Google's window. Injected, never ambient. */
  now?: Date;
}

export interface TravelMatrix {
  getTravelLeg: TravelLegProvider;
  stats: TravelMatrixStats;
}

// ── building one ─────────────────────────────────────────────────────────────

/**
 * Fetches walking and transit matrices over `places` and returns a provider.
 *
 * `places` is one day's worth — the stops Pass B assigned, its flex picks, and
 * the alternates the validator may swap in. Anything asked for that is not in
 * that set falls through to `fallback`, which is the straight-line provider the
 * pipeline built anyway.
 */
export async function buildTravelMatrix(
  places: readonly CandidatePlace[],
  fallback: TravelLegProvider,
  deps: RouteMatrixDeps,
): Promise<TravelMatrix> {
  const routable = dedupeById(places).filter(hasCoordinates);
  const stats: TravelMatrixStats = {
    requests: 0,
    walkLegs: 0,
    transitLegs: 0,
    chosenTransit: 0,
    estimated: 0,
    errors: [],
  };

  // One place cannot travel to itself, and zero places cannot travel at all.
  if (routable.length < 2) {
    return { getTravelLeg: wrap(new Map(), fallback, stats), stats };
  }

  const departure = departureTimeFor(deps.departureDate, routable, deps.now ?? new Date());
  const [walk, transit] = await Promise.all([
    fetchMatrix(routable, "WALK", undefined, deps, stats),
    fetchMatrix(routable, "TRANSIT", departure, deps, stats),
  ]);

  stats.walkLegs = walk.size;
  stats.transitLegs = transit.size;

  const legs = new Map<string, TravelLeg>();
  for (const from of routable) {
    for (const to of routable) {
      if (from.placeId === to.placeId) continue;
      const key = pairKey(from.placeId, to.placeId);
      const leg = chooseMode(walk.get(key), transit.get(key));
      if (!leg) continue;
      if (leg.mode === "transit") stats.chosenTransit += 1;
      legs.set(key, leg);
    }
  }

  return { getTravelLeg: wrap(legs, fallback, stats), stats };
}

/**
 * Walk unless transit is meaningfully faster.
 *
 * Google's transit duration already covers the walk to the stop and the wait,
 * so this is one total against another. The margin is what stops the planner
 * putting a traveller on a bus for one stop: a minute saved is not worth a
 * platform, and a day of those reads as absurd even when each leg is optimal.
 */
function chooseMode(
  walk: TravelLeg | undefined,
  transit: TravelLeg | undefined,
): TravelLeg | undefined {
  if (!walk) return transit;
  if (!transit) return walk;
  return transit.minutes <= walk.minutes - TRANSIT_MIN_SAVING_MINUTES ? transit : walk;
}

/**
 * The provider itself: a map lookup, and the straight line for anything the
 * matrix has no answer for. Memoization is inherent — the matrix *is* the memo,
 * which is what lets `sequenceDay` enumerate permutations for free.
 */
function wrap(
  legs: Map<string, TravelLeg>,
  fallback: TravelLegProvider,
  stats: TravelMatrixStats,
): TravelLegProvider {
  return (from, to) => {
    const hit = legs.get(pairKey(from.placeId, to.placeId));
    if (hit) return hit;
    stats.estimated += 1;
    return fallback(from, to);
  };
}

// ── one matrix ───────────────────────────────────────────────────────────────

type MatrixMode = "WALK" | "TRANSIT";

/**
 * Fetches every pair for one mode, in as many requests as the element cap
 * requires, and never throws. A mode that fails entirely comes back empty and
 * `chooseMode` falls to the other one; both failing means the day is estimated,
 * which `stats.estimated` will say.
 */
async function fetchMatrix(
  places: readonly CandidatePlace[],
  mode: MatrixMode,
  departureTime: string | undefined,
  deps: RouteMatrixDeps,
  stats: TravelMatrixStats,
): Promise<Map<string, TravelLeg>> {
  const legs = new Map<string, TravelLeg>();
  const doFetch = deps.fetch ?? (globalThis.fetch as FetchLike);

  for (const chunk of chunkPairs(places, MAX_ELEMENTS[mode])) {
    stats.requests += 1;
    try {
      const elements = await requestMatrix(chunk, mode, departureTime, deps.apiKey, doFetch);
      for (const element of elements) {
        const from = chunk.origins[element.originIndex ?? -1];
        const to = chunk.destinations[element.destinationIndex ?? -1];
        if (!from || !to || from.placeId === to.placeId) continue;
        // A per-element failure is a populated `status`, not an HTTP error, and
        // ROUTE_NOT_FOUND is an ordinary answer for transit between two places
        // no line connects. Both mean "no leg", never "a zero-length leg".
        if (element.status && Object.keys(element.status).length > 0) continue;
        if (element.condition !== "ROUTE_EXISTS") continue;
        const minutes = parseDurationSeconds(element.duration);
        if (minutes === undefined) continue;
        legs.set(pairKey(from.placeId, to.placeId), {
          minutes: Math.max(0, Math.round(minutes / 60)),
          meters: element.distanceMeters ?? metersBetween(coords(from), coords(to)),
          mode: mode === "TRANSIT" ? "transit" : "walk",
        });
      }
    } catch (error) {
      // Never throws: the straight line is a working trip, and a routing outage
      // must not be the difference between an itinerary and none.
      const message = error instanceof Error ? error.message : String(error);
      stats.errors.push(`${mode}: ${message}`);
    }
  }

  return legs;
}

interface MatrixChunk {
  origins: readonly CandidatePlace[];
  destinations: readonly CandidatePlace[];
}

/**
 * Splits the full N×N into requests inside the element cap.
 *
 * Destinations stay whole and origins are sliced, because the cap is on the
 * product and slicing one side keeps every element in some chunk exactly once.
 * A 16-place day is 256 elements: one walking request, and three transit ones
 * against a cap of 100.
 */
export function chunkPairs(
  places: readonly CandidatePlace[],
  maxElements: number,
): MatrixChunk[] {
  const perRequest = Math.max(1, Math.floor(maxElements / places.length));
  const chunks: MatrixChunk[] = [];
  for (let i = 0; i < places.length; i += perRequest) {
    chunks.push({ origins: places.slice(i, i + perRequest), destinations: places });
  }
  return chunks;
}

interface RawMatrixElement {
  originIndex?: number;
  destinationIndex?: number;
  status?: Record<string, unknown>;
  condition?: string;
  distanceMeters?: number;
  duration?: string;
}

async function requestMatrix(
  chunk: MatrixChunk,
  mode: MatrixMode,
  departureTime: string | undefined,
  apiKey: string,
  doFetch: FetchLike,
): Promise<RawMatrixElement[]> {
  // Place ids route to entrances; coordinates route to the nearest road. Past
  // Google's cap on named waypoints the whole request has to use coordinates,
  // because mixing would put half a day's legs on a different footing.
  const byPlaceId = chunk.origins.length + chunk.destinations.length <= MAX_PLACE_ID_WAYPOINTS;
  const body: Record<string, unknown> = {
    origins: chunk.origins.map((place) => ({ waypoint: waypoint(place, byPlaceId) })),
    destinations: chunk.destinations.map((place) => ({ waypoint: waypoint(place, byPlaceId) })),
    travelMode: mode,
  };
  // `routingPreference` is rejected outside DRIVE and TWO_WHEELER, so it is
  // absent rather than defaulted.
  if (mode === "TRANSIT" && departureTime) body.departureTime = departureTime;

  const response = await doFetch(ROUTE_MATRIX_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": ROUTE_MATRIX_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Route Matrix ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  const data = await response.json();
  // The endpoint streams a JSON array. Anything else is a shape change, and
  // reading it as empty would silently estimate the whole day.
  if (!Array.isArray(data)) throw new Error("Route Matrix returned a non-array body");
  return data as RawMatrixElement[];
}

function waypoint(place: CandidatePlace, byPlaceId: boolean): Record<string, unknown> {
  if (byPlaceId && place.placeId) return { placeId: place.placeId };
  return { location: { latLng: coords(place) } };
}

// ── small pieces ─────────────────────────────────────────────────────────────

/**
 * When to price this day's transit.
 *
 * Two problems solved in one function. **The planner has no timezone** — see
 * `ITINERARY_TIMEZONE` — so a naive midnight-UTC departure is 08:00 in
 * Singapore, 19:00 the previous evening in New York, and a night timetable for
 * half the world. The offset is estimated from the places themselves, one hour
 * per 15° of longitude: that lands Singapore an hour off its real +8, which
 * moves a bus by a few minutes and never by a service pattern.
 *
 * **And Google refuses a departure outside roughly a week back to a hundred
 * days out.** A trip whose dates fall outside that still has to route, so the
 * instant is clamped rather than dropped — a nearby week's timetable is a far
 * better answer than no transit at all.
 */
export function departureTimeFor(
  date: string | undefined,
  places: readonly CandidatePlace[],
  now: Date,
): string {
  const wanted = date === undefined ? now : new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(wanted.getTime())) return now.toISOString();

  if (date !== undefined) {
    wanted.setUTCHours(REPRESENTATIVE_LOCAL_HOUR - utcOffsetHours(places));
  }
  const floor = new Date(now.getTime() + DEPARTURE_WINDOW.minDays * 86_400_000);
  const ceiling = new Date(now.getTime() + DEPARTURE_WINDOW.maxDays * 86_400_000);
  const clamped = wanted < floor ? floor : wanted > ceiling ? ceiling : wanted;
  return clamped.toISOString();
}

/** Solar time from longitude: 15° of it is an hour. Political timezones drift
 *  from this by up to a couple of hours, which is a frequency difference and
 *  not a service one. */
function utcOffsetHours(places: readonly CandidatePlace[]): number {
  const longitudes = places
    .map((place) => place.longitude)
    .filter((value): value is number => value != null)
    .sort((a, b) => a - b);
  if (longitudes.length === 0) return 0;
  return Math.round(longitudes[Math.floor(longitudes.length / 2)] / 15);
}

/** `"1234s"` → seconds. Undefined for anything that is not that shape. */
function parseDurationSeconds(duration: string | undefined): number | undefined {
  if (!duration) return undefined;
  const seconds = Number.parseFloat(duration.replace(/s$/, ""));
  return Number.isFinite(seconds) ? seconds : undefined;
}

function pairKey(from: string, to: string): string {
  // `\u0000` written as the escape, never as the byte: a literal NUL makes
  // ripgrep classify this whole file as binary and skip it in every search,
  // silently. It compiles and every test passes — the file just vanishes
  // from code search.
  return `${from}\u0000${to}`;
}

function hasCoordinates(
  place: CandidatePlace,
): place is CandidatePlace & { latitude: number; longitude: number } {
  return place.latitude != null && place.longitude != null;
}

function coords(place: CandidatePlace): { latitude: number; longitude: number } {
  return { latitude: place.latitude ?? 0, longitude: place.longitude ?? 0 };
}

function dedupeById(places: readonly CandidatePlace[]): CandidatePlace[] {
  const seen = new Map<string, CandidatePlace>();
  for (const place of places) if (!seen.has(place.placeId)) seen.set(place.placeId, place);
  return [...seen.values()];
}

export type { TravelMode };
