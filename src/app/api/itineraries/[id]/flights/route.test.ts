/**
 * The four flight handlers, through the real routes with an in-memory store.
 *
 * Two properties are worth holding here and neither is visible from outside.
 *
 * **Somebody else's trip is a 404, never a 403** — the rule the itinerary read
 * already keeps, applied to a write. And **a flight is reachable only through
 * the itinerary it is on**: a flight id guessed from one trip must not be
 * editable or deletable through another, which the store enforces in its
 * `where` clause rather than by reading a row and then rejecting it.
 *
 * `readItineraryOwner` is module-mocked and `db` is an empty object, following
 * `src/app/api/itineraries/route.test.ts`. That function is a select with no
 * decisions in it; a double would only prove the double works. Everything else
 * runs for real — the parsing, the store, the session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/db/client";
import { createInMemoryFlightStore } from "@/lib/db/flights";

import { flightRouteDeps } from "../../../deps";
import { signedIn, signedInRequest } from "../../../session-fixture";
import { GET as listFlights, POST as addFlight } from "./route";
import { DELETE as removeFlight, PATCH as editFlight } from "./[flightId]/route";

const NOW = new Date("2026-08-29T10:00:00.000Z");
const TRIP_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER_TRIP_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const originalCreate = flightRouteDeps.create;

/** Set per test. `readItineraryOwner` is spied onto this. */
let owner: { userId: string | null } | undefined;

vi.mock("@/lib/db/itineraries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/itineraries")>();
  return { ...actual, readItineraryOwner: vi.fn(async () => owner) };
});

let session: Awaited<ReturnType<typeof signedIn>>;
let flights: ReturnType<typeof createInMemoryFlightStore>;

/** A booked Singapore–Bali hop, the shape the booking flow sends. */
function booking(overrides: Record<string, unknown> = {}) {
  return {
    source: "booked",
    flight_number: "SQ 938",
    airline: "Singapore Airlines",
    depart_date: "2026-09-14",
    depart_time: "09:35",
    depart_airport_code: "SIN",
    depart_city: "Singapore",
    arrive_date: "2026-09-14",
    arrive_time: "12:20",
    arrive_airport_code: "DPS",
    arrive_city: "Denpasar",
    duration_minutes: 165,
    confirmation: "QK4T2Z",
    cost: 412,
    currency: "SGD",
    baggage_allowance: "20 kg checked bag",
    ticket_number: "618-2947183625",
    seat: "12A",
    passenger_name: "Martin Teo",
    ...overrides,
  };
}

function post(body: unknown, cookie = session.cookie, tripId = TRIP_ID): Request {
  return signedInRequest(`http://localhost/api/itineraries/${tripId}/flights`, cookie, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function tripParams(id = TRIP_ID) {
  return { params: Promise.resolve({ id }) };
}

function flightParams(flightId: string, id = TRIP_ID) {
  return { params: Promise.resolve({ id, flightId }) };
}

beforeEach(async () => {
  vi.clearAllMocks();
  session = await signedIn({ now: NOW });
  flights = createInMemoryFlightStore();
  owner = { userId: session.user.id };
  flightRouteDeps.create = () => ({
    db: {} as Database,
    flights,
    users: session.users,
    now: () => NOW,
  });
});

afterEach(() => {
  flightRouteDeps.create = originalCreate;
});

describe("POST /api/itineraries/[id]/flights", () => {
  it("stores a booked flight and hands back the row it wrote", async () => {
    const response = await addFlight(post(booking()), tripParams());
    expect(response.status).toBe(201);

    const body = await response.json();
    expect(body.id).toBeTruthy();
    expect(body.itinerary_id).toBe(TRIP_ID);
    expect(body.source).toBe("booked");
    expect(body.seat).toBe("12A");
    expect(body.passenger_name).toBe("Martin Teo");
    expect(body.ticket_number).toBe("618-2947183625");
    // A fare sent as a number comes back as the string the column holds, with
    // its cents intact — 412.50 must not read as 412.5.
    expect(body.cost).toBe("412");
    expect(flights.rows.size).toBe(1);
  });

  it("keeps the flight after the request that made it is over", async () => {
    await addFlight(post(booking()), tripParams());

    // The whole point of the change: a second, independent request sees it.
    const listed = await listFlights(
      signedInRequest(`http://localhost/api/itineraries/${TRIP_ID}/flights`, session.cookie),
      tripParams(),
    );
    const body = await listed.json();
    expect(body).toHaveLength(1);
    expect(body[0].confirmation).toBe("QK4T2Z");
    expect(body[0].seat).toBe("12A");
  });

  it("keeps a fare's cents rather than rounding them off a float", async () => {
    const response = await addFlight(post(booking({ cost: "412.50" })), tripParams());
    expect((await response.json()).cost).toBe("412.50");
  });

  it("defaults an unknown source to manual rather than refusing the flight", async () => {
    const response = await addFlight(post(booking({ source: "scraped" })), tripParams());
    expect(response.status).toBe(201);
    expect((await response.json()).source).toBe("manual");
  });

  it("takes the departure date as the arrival date on a same-day hop", async () => {
    const { arrive_date: _dropped, ...sameDay } = booking();
    const response = await addFlight(post(sameDay), tripParams());
    expect((await response.json()).arrive_date).toBe("2026-09-14");
  });

  it("refuses a flight with no departure date", async () => {
    const { depart_date: _dropped, ...undated } = booking();
    const response = await addFlight(post(undated), tripParams());
    expect(response.status).toBe(400);
    expect(flights.rows.size).toBe(0);
  });

  it("refuses a date that is not a calendar date", async () => {
    const response = await addFlight(post(booking({ depart_date: "14 Sep 2026" })), tripParams());
    expect(response.status).toBe(400);
    expect(flights.rows.size).toBe(0);
  });

  it("ignores a column the caller is not allowed to write", async () => {
    const response = await addFlight(
      post({ ...booking(), id: "chosen-by-the-browser", itinerary_id: OTHER_TRIP_ID }),
      tripParams(),
    );
    const body = await response.json();
    expect(body.id).not.toBe("chosen-by-the-browser");
    expect(body.itinerary_id).toBe(TRIP_ID);
  });
});

describe("the gates", () => {
  it("refuses a signed-out caller with a 401 and writes nothing", async () => {
    const anonymous = new Request(`http://localhost/api/itineraries/${TRIP_ID}/flights`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(booking()),
    });
    const response = await addFlight(anonymous, tripParams());
    expect(response.status).toBe(401);
    expect(flights.rows.size).toBe(0);
  });

  it("answers 404, not 403, for somebody else's trip", async () => {
    const stranger = await signedIn({ now: NOW, email: "stranger@example.com", token: "other" });
    owner = { userId: stranger.user.id };

    const response = await addFlight(post(booking()), tripParams());
    // A 403 would confirm the id names a real itinerary, which is the one fact
    // an outsider is after.
    expect(response.status).toBe(404);
    expect(flights.rows.size).toBe(0);
  });

  it("answers 404 for a trip nobody owns", async () => {
    owner = { userId: null };
    const response = await addFlight(post(booking()), tripParams());
    expect(response.status).toBe(404);
    expect(flights.rows.size).toBe(0);
  });

  it("answers 404 for a trip that does not exist", async () => {
    owner = undefined;
    const response = await addFlight(post(booking()), tripParams());
    expect(response.status).toBe(404);
  });

  it("lists nothing to a signed-out caller", async () => {
    const response = await listFlights(
      new Request(`http://localhost/api/itineraries/${TRIP_ID}/flights`),
      tripParams(),
    );
    expect(response.status).toBe(401);
  });
});

describe("PATCH /api/itineraries/[id]/flights/[flightId]", () => {
  async function seeded() {
    const created = await addFlight(post(booking()), tripParams());
    return (await created.json()).id as string;
  }

  function patch(flightId: string, body: unknown, tripId = TRIP_ID): Request {
    return signedInRequest(
      `http://localhost/api/itineraries/${tripId}/flights/${flightId}`,
      session.cookie,
      { method: "PATCH", body: JSON.stringify(body) },
    );
  }

  it("changes only the fields it was sent", async () => {
    const id = await seeded();
    const response = await editFlight(patch(id, { terminal: "T3" }), flightParams(id));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.terminal).toBe("T3");
    // The difference between a patch and a replace: one field sent must not
    // wipe the other twenty.
    expect(body.flight_number).toBe("SQ 938");
    expect(body.seat).toBe("12A");
    expect(body.ticket_number).toBe("618-2947183625");
  });

  it("clears a field sent as null, and leaves an absent one alone", async () => {
    const id = await seeded();
    const response = await editFlight(patch(id, { seat: null }), flightParams(id));
    const body = await response.json();
    expect(body.seat).toBeUndefined();
    expect(body.passenger_name).toBe("Martin Teo");
  });

  it("refuses a date in the wrong shape rather than silently dropping it", async () => {
    const id = await seeded();
    const response = await editFlight(patch(id, { depart_date: "next Tuesday" }), flightParams(id));
    expect(response.status).toBe(400);
    // Reporting success on an edit that did not happen is the failure here.
    expect(flights.rows.get(id)?.depart_date).toBe("2026-09-14");
  });

  it("will not edit a flight through an itinerary it is not on", async () => {
    const id = await seeded();
    const response = await editFlight(
      patch(id, { terminal: "T3" }, OTHER_TRIP_ID),
      flightParams(id, OTHER_TRIP_ID),
    );
    expect(response.status).toBe(404);
    expect(flights.rows.get(id)?.terminal).toBeNull();
  });

  it("answers 404 for a flight that does not exist", async () => {
    const response = await editFlight(
      patch("00000000-0000-4000-a000-000000000099", { terminal: "T3" }),
      flightParams("00000000-0000-4000-a000-000000000099"),
    );
    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/itineraries/[id]/flights/[flightId]", () => {
  function del(flightId: string, tripId = TRIP_ID): Request {
    return signedInRequest(
      `http://localhost/api/itineraries/${tripId}/flights/${flightId}`,
      session.cookie,
      { method: "DELETE" },
    );
  }

  it("removes the flight and answers 204 with no body", async () => {
    const created = await addFlight(post(booking()), tripParams());
    const id = (await created.json()).id as string;

    const response = await removeFlight(del(id), flightParams(id));
    expect(response.status).toBe(204);
    expect(flights.rows.size).toBe(0);
  });

  it("removes only the flight it was asked for", async () => {
    const first = (await (await addFlight(post(booking()), tripParams())).json()).id as string;
    const second = (await (
      await addFlight(post(booking({ flight_number: "TR 281", confirmation: "ZZ9Q1P" })), tripParams())
    ).json()).id as string;

    await removeFlight(del(first), flightParams(first));
    expect(flights.rows.has(second)).toBe(true);
    expect(flights.rows.has(first)).toBe(false);
  });

  it("will not delete a flight through an itinerary it is not on", async () => {
    const created = await addFlight(post(booking()), tripParams());
    const id = (await created.json()).id as string;

    const response = await removeFlight(del(id, OTHER_TRIP_ID), flightParams(id, OTHER_TRIP_ID));
    expect(response.status).toBe(404);
    expect(flights.rows.has(id)).toBe(true);
  });

  it("answers 404 for a flight that is already gone", async () => {
    const response = await removeFlight(
      del("00000000-0000-4000-a000-000000000099"),
      flightParams("00000000-0000-4000-a000-000000000099"),
    );
    expect(response.status).toBe(404);
  });
});

describe("GET /api/itineraries/[id]/flights", () => {
  it("returns a trip's flights earliest departure first", async () => {
    await addFlight(post(booking({ depart_date: "2026-09-21", confirmation: "LATER" })), tripParams());
    await addFlight(post(booking({ depart_date: "2026-09-14", confirmation: "EARLIER" })), tripParams());

    const response = await listFlights(
      signedInRequest(`http://localhost/api/itineraries/${TRIP_ID}/flights`, session.cookie),
      tripParams(),
    );
    const body = await response.json();
    expect(body.map((f: { confirmation: string }) => f.confirmation)).toEqual(["EARLIER", "LATER"]);
  });

  it("does not return another trip's flights", async () => {
    await addFlight(post(booking(), session.cookie, OTHER_TRIP_ID), tripParams(OTHER_TRIP_ID));

    const response = await listFlights(
      signedInRequest(`http://localhost/api/itineraries/${TRIP_ID}/flights`, session.cookie),
      tripParams(),
    );
    expect(await response.json()).toEqual([]);
  });

  it("returns an empty list for a trip with no flights", async () => {
    const response = await listFlights(
      signedInRequest(`http://localhost/api/itineraries/${TRIP_ID}/flights`, session.cookie),
      tripParams(),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });
});
