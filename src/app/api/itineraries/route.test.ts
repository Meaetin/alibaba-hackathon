/**
 * The two itinerary reads, and specifically their **gates**.
 *
 * The queries underneath (`readItineraryList`, `readItineraryDetail`) are
 * selects with no decisions in them and are covered where their mapping lives.
 * What is worth testing here is who is allowed to see what — the part that is a
 * decision, and the part where getting it wrong hands one traveller another
 * traveller's trip.
 *
 * The three read functions are module-mocked and `db` is an empty object. That
 * is enough, and it is deliberate rather than lazy: every assertion here is
 * about the branch taken *before* a query runs, so a working database would add
 * nothing but setup. The mapping those functions do is tested where it lives.
 *
 * This is the one place in the repo that uses `vi.mock`. There is no mocking
 * framework in the planner suite and there should not be — the ports there have
 * in-memory doubles. `readItineraryOwner` and friends have none, on purpose:
 * they are selects with no decisions in them, so a double would only prove the
 * double works. Mocking is how a *caller* of an un-doubled read gets tested.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Database } from "@/lib/db/client";
import { createInMemoryUserStore } from "@/lib/db/users";

import { itineraryRouteDeps } from "../deps";
import { signedIn, signedInRequest } from "../session-fixture";
import { GET as list } from "./route";
import { GET as detail } from "./[id]/route";

const NOW = new Date("2026-08-28T10:00:00.000Z");
const TRIP_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const originalCreate = itineraryRouteDeps.create;

vi.mock("@/lib/db/itinerary-list", () => ({
  readItineraryList: vi.fn(async () => [{ id: TRIP_ID, name: "Singapore trip" }]),
}));
vi.mock("@/lib/db/itinerary-detail", () => ({
  readItineraryDetail: vi.fn(async () => ({ id: TRIP_ID, name: "Singapore trip" })),
}));

/** Set per test. `readItineraryOwner` is spied onto this. */
let owner: { userId: string | null } | undefined;

vi.mock("@/lib/db/itineraries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/itineraries")>();
  return { ...actual, readItineraryOwner: vi.fn(async () => owner) };
});

let session: Awaited<ReturnType<typeof signedIn>>;

async function install() {
  session = await signedIn({ now: NOW });
  itineraryRouteDeps.create = () => ({
    db: {} as Database,
    users: session.users,
    now: () => NOW,
  });
}

const params = { params: Promise.resolve({ id: TRIP_ID }) };

beforeEach(async () => {
  // Call history, not implementations. Without this the "never reads the trip"
  // assertion sees the *previous* test's call and fails for the wrong reason —
  // which is exactly the sort of cross-test bleed that makes a real regression
  // look like a flake.
  vi.clearAllMocks();
  owner = undefined;
  await install();
});

afterEach(() => {
  itineraryRouteDeps.create = originalCreate;
  vi.restoreAllMocks();
});

describe("GET /api/itineraries", () => {
  it("returns the traveller's own list", async () => {
    const response = await list(signedInRequest("http://localhost/api/itineraries", session.cookie));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: TRIP_ID, name: "Singapore trip" }]);
  });

  it("answers 401 for a signed-out caller, not an empty list", async () => {
    // They are different answers: one means "you have no trips", the other
    // means "we don't know who you are". Rendering the first for the second
    // tells somebody their work is gone.
    const response = await list(new Request("http://localhost/api/itineraries"));
    expect(response.status).toBe(401);
    expect(await response.json()).not.toEqual([]);
  });

  it("scopes the read to the signed-in user, not to anything on the wire", async () => {
    const { readItineraryList } = await import("@/lib/db/itinerary-list");
    await list(
      signedInRequest("http://localhost/api/itineraries?userId=someone-else", session.cookie),
    );
    expect(readItineraryList).toHaveBeenCalledWith(expect.anything(), session.user.id);
  });

  it("turns a failed read into a sentence, not a stack trace", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { readItineraryList } = await import("@/lib/db/itinerary-list");
    vi.mocked(readItineraryList).mockRejectedValueOnce(new Error('relation "itineraries" gone'));

    const response = await list(signedInRequest("http://localhost/api/itineraries", session.cookie));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toMatch(/relation/);
    expect(errors).toHaveBeenCalled();
  });
});

describe("GET /api/itineraries/[id]", () => {
  it("returns the trip to its owner", async () => {
    owner = { userId: session.user.id };
    const response = await detail(
      signedInRequest(`http://localhost/api/itineraries/${TRIP_ID}`, session.cookie),
      params,
    );
    expect(response.status).toBe(200);
  });

  it("answers 404 — not 403 — for somebody else's trip", async () => {
    // A 403 confirms the id names a real itinerary, which is the one fact an
    // outsider wants. A 404 says the same thing as an id never issued.
    owner = { userId: "11111111-2222-4333-8444-555555555555" };
    const response = await detail(
      signedInRequest(`http://localhost/api/itineraries/${TRIP_ID}`, session.cookie),
      params,
    );
    expect(response.status).toBe(404);
  });

  it("answers 404 for a trip with no owner at all", async () => {
    // The rows planned before this app had accounts. The first sign-up claims
    // them; one left over after that belongs to nobody.
    owner = { userId: null };
    const response = await detail(
      signedInRequest(`http://localhost/api/itineraries/${TRIP_ID}`, session.cookie),
      params,
    );
    expect(response.status).toBe(404);
  });

  it("answers 401 for a signed-out caller", async () => {
    owner = { userId: session.user.id };
    const response = await detail(
      new Request(`http://localhost/api/itineraries/${TRIP_ID}`),
      params,
    );
    expect(response.status).toBe(401);
  });

  it("never reads the trip when the gate refuses", async () => {
    // The gate has to run *before* the read, or a refused request still pays
    // for five selects and the 404 is only a formatting choice.
    const { readItineraryDetail } = await import("@/lib/db/itinerary-detail");
    owner = { userId: "11111111-2222-4333-8444-555555555555" };

    await detail(
      signedInRequest(`http://localhost/api/itineraries/${TRIP_ID}`, session.cookie),
      params,
    );
    expect(readItineraryDetail).not.toHaveBeenCalled();
  });

  it("distinguishes a missing trip from a database that is down", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { readItineraryOwner } = await import("@/lib/db/itineraries");
    vi.mocked(readItineraryOwner).mockRejectedValueOnce(new Error("connection lost"));

    const response = await detail(
      signedInRequest(`http://localhost/api/itineraries/${TRIP_ID}`, session.cookie),
      params,
    );
    // 500, not 404 — collapsing them renders "not found" during an outage.
    expect(response.status).toBe(500);
    expect(errors).toHaveBeenCalled();
  });
});

describe("the in-memory user store matches the contract the real one keeps", () => {
  it("refuses to claim a persona that already has an owner", async () => {
    const users = createInMemoryUserStore();
    const a = (await users.create({
      email: "a@example.com",
      display_name: null,
      password_hash: "x",
      now: NOW,
    }))!;
    const b = (await users.create({
      email: "b@example.com",
      display_name: null,
      password_hash: "x",
      now: NOW,
    }))!;
    users.personaOwners.set("p", null);

    expect(await users.claimPersona({ personaId: "p", userId: a.id, now: NOW })).toBe(true);
    expect(await users.claimPersona({ personaId: "p", userId: b.id, now: NOW })).toBe(false);
  });

  it("refuses a traveller a second persona", async () => {
    // `travel_personas.user_id` is unique, so the real store's `where` clause
    // is what stops a blind update throwing. The double keeps the same rule.
    const users = createInMemoryUserStore();
    const user = (await users.create({
      email: "a@example.com",
      display_name: null,
      password_hash: "x",
      now: NOW,
    }))!;
    users.personaOwners.set("p1", null);
    users.personaOwners.set("p2", null);

    expect(await users.claimPersona({ personaId: "p1", userId: user.id, now: NOW })).toBe(true);
    expect(await users.claimPersona({ personaId: "p2", userId: user.id, now: NOW })).toBe(false);
  });

  it("expires a session on the clock it is handed", async () => {
    const users = createInMemoryUserStore();
    const user = (await users.create({
      email: "a@example.com",
      display_name: null,
      password_hash: "x",
      now: NOW,
    }))!;
    await users.startSession({
      tokenHash: (await import("@/lib/auth/session")).hashToken("tok"),
      userId: user.id,
      now: NOW,
      expiresAt: new Date(NOW.getTime() + 1000),
    });

    expect(await users.userForToken("tok", NOW)).toBeDefined();
    expect(await users.userForToken("tok", new Date(NOW.getTime() + 2000))).toBeUndefined();
  });
});
