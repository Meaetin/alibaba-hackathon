/**
 * The collections handlers, driven through the real routes with fake ports.
 *
 * Everything here is the production path except the database and the clock.
 * `collectionRouteDeps.create` is the one seam, the same one `plan/route.test.ts`
 * and `content` use — no mocking framework, because there isn't one in this repo.
 *
 * The properties this file holds:
 *
 *   1. a signed-out caller can read an empty grid but cannot write
 *   2. somebody else's collection is a 404, never a 403, on every verb
 *   3. an add reports what landed, and adding twice is a success
 *   4. removing a place removes the junction row and nothing else
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createInMemoryCollectionStore,
  type LocationRow,
} from "@/lib/db/collections";

import { collectionRouteDeps } from "../deps";
import { signedIn } from "../session-fixture";
import { GET as listCollections, POST as createCollection } from "./route";
import {
  DELETE as deleteCollection,
  GET as readCollection,
  PATCH as patchCollection,
} from "./[id]/route";
import { POST as addLocations } from "./[id]/locations/route";
import { DELETE as removeLocation } from "./[id]/locations/[locationId]/route";

const NOW = new Date("2026-08-29T09:00:00.000Z");

function locationRow(id: string): LocationRow {
  return {
    id,
    place_id: `place-${id}`,
    name: `Place ${id}`,
    latitude: 1.29,
    longitude: 103.85,
    types: ["restaurant"],
    primary_type: "restaurant",
    rating: 4.4,
    user_rating_count: 900,
    price_level: 2,
    price_range: null,
    formatted_address: "1 Test Street",
    city: "Singapore",
    opening_periods: null,
    review_snippets: null,
    editorial_summary: null,
    review_summary: null,
    serves_vegetarian_food: null,
    shortlist_hydrated_at: null,
    photo_names: null,
    photo_urls: ["https://example.test/photo.jpg"],
    photos_resolved_at: NOW,
    business_status: "OPERATIONAL",
    google_maps_uri: null,
    stay_duration: 75,
    fetched_at: NOW,
  };
}

const HOE_KEE = locationRow("00000000-0000-4000-9000-000000000001");
const LAU_PA_SAT = locationRow("00000000-0000-4000-9000-000000000002");
/** A well-formed uuid with no row behind it. */
const GONE = "00000000-0000-4000-9000-0000000000ff";

const originalCreate = collectionRouteDeps.create;

interface Harness {
  collections: ReturnType<typeof createInMemoryCollectionStore>;
  session: Awaited<ReturnType<typeof signedIn>>;
}

async function install(): Promise<Harness> {
  const session = await signedIn({ now: NOW });
  const collections = createInMemoryCollectionStore({
    locations: { [HOE_KEE.id]: HOE_KEE, [LAU_PA_SAT.id]: LAU_PA_SAT },
  });
  collectionRouteDeps.create = () => ({
    collections,
    users: session.users,
    now: () => NOW,
  });
  currentCookie = session.cookie;
  return { collections, session };
}

let currentCookie: string | null = null;

function request(
  path: string,
  init: RequestInit = {},
  cookie: string | null = currentCookie,
): Request {
  return new Request(`http://localhost${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(init.headers ?? {}),
    },
  });
}

/** Next hands route params as a promise; the handlers await them. */
const params = <T extends Record<string, string>>(value: T) => ({ params: Promise.resolve(value) });

async function makeCollection(name = "Hawker crawl"): Promise<string> {
  const response = await createCollection(
    request("/api/collections", { method: "POST", body: JSON.stringify({ name }) }),
  );
  const body = (await response.json()) as { id: string };
  return body.id;
}

beforeEach(() => {
  currentCookie = null;
});

afterEach(() => {
  collectionRouteDeps.create = originalCreate;
  vi.restoreAllMocks();
});

describe("GET /api/collections", () => {
  it("gives a signed-out caller an empty grid, not an error", async () => {
    await install();
    // The grid's "no collections found" state is the right thing to show
    // somebody who is not signed in. An error toast on a page they can
    // legitimately look at is not.
    const response = await listCollections(request("/api/collections", {}, null));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("lists only the caller's own collections", async () => {
    const harness = await install();
    await makeCollection("Mine");

    const mine = await listCollections(request("/api/collections"));
    expect((await mine.json()) as unknown[]).toHaveLength(1);

    // The same store, a different traveller, and a cookie the real `userFor`
    // accepts. `signedIn` folds a per-call scope into its ids for exactly this
    // — two fixtures that shared an id would compare a thing with itself.
    const stranger = await signedIn({ now: NOW, email: "other@example.com", token: "other" });
    expect(stranger.user.id).not.toBe(harness.session.user.id);
    collectionRouteDeps.create = () => ({
      collections: harness.collections,
      users: stranger.users,
      now: () => NOW,
    });

    const theirs = await listCollections(request("/api/collections", {}, stranger.cookie));
    expect(await theirs.json()).toEqual([]);
  });
});

describe("POST /api/collections", () => {
  it("refuses a signed-out caller rather than writing an ownerless row", async () => {
    const harness = await install();
    const response = await createCollection(
      request("/api/collections", { method: "POST", body: JSON.stringify({ name: "Ghost" }) }, null),
    );

    expect(response.status).toBe(401);
    expect(harness.collections.rows.size).toBe(0);
  });

  it("rejects a nameless collection without a stack trace", async () => {
    await install();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await createCollection(
      request("/api/collections", { method: "POST", body: JSON.stringify({ name: "  " }) }),
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toMatch(/missing a name/);
    expect(errors).toHaveBeenCalled();
  });

  it("stores the coordinate the traveller picked", async () => {
    const harness = await install();
    const response = await createCollection(
      request("/api/collections", {
        method: "POST",
        body: JSON.stringify({
          name: "Singapore",
          country: "Singapore",
          latitude: 1.3521,
          longitude: 103.8198,
        }),
      }),
    );

    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string; latitude?: number };
    expect(created.latitude).toBe(1.3521);
    expect(harness.collections.rows.get(created.id)?.longitude).toBe(103.8198);
  });

  it("refuses a coordinate that is not one", async () => {
    await install();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await createCollection(
      request("/api/collections", {
        method: "POST",
        body: JSON.stringify({ name: "Nowhere", latitude: 3000, longitude: 3000 }),
      }),
    );

    expect(response.status).toBe(400);
    expect(errors).toHaveBeenCalled();
  });
});

describe("/api/collections/[id]", () => {
  it("answers 404 for somebody else's collection on every verb", async () => {
    const harness = await install();
    const id = await makeCollection();

    // Same store, a different traveller, and a cookie the real `userFor`
    // accepts — the difference is only whose id is behind it.
    const stranger = await signedIn({ now: NOW, email: "other@example.com", token: "other" });
    collectionRouteDeps.create = () => ({
      collections: harness.collections,
      users: stranger.users,
      now: () => NOW,
    });
    const theirs = stranger.cookie;

    expect((await readCollection(request(`/api/collections/${id}`, {}, theirs), params({ id }))).status).toBe(404);
    expect(
      (
        await patchCollection(
          request(`/api/collections/${id}`, { method: "PATCH", body: JSON.stringify({ name: "x" }) }, theirs),
          params({ id }),
        )
      ).status,
    ).toBe(404);
    expect(
      (await deleteCollection(request(`/api/collections/${id}`, { method: "DELETE" }, theirs), params({ id }))).status,
    ).toBe(404);

    // A 403 on any of those would confirm the id names a real collection,
    // which is the one fact an outsider wants.
    expect(harness.collections.rows.has(id)).toBe(true);
  });

  it("returns the places in the shape the page renders", async () => {
    await install();
    const id = await makeCollection();
    await addLocations(
      request(`/api/collections/${id}/locations`, {
        method: "POST",
        body: JSON.stringify({ location_ids: [HOE_KEE.id] }),
      }),
      params({ id }),
    );

    const response = await readCollection(request(`/api/collections/${id}`), params({ id }));
    const detail = (await response.json()) as {
      locations: { id: string; photo_urls?: string[]; added_at: string }[];
    };

    expect(detail.locations).toHaveLength(1);
    expect(detail.locations[0].id).toBe(HOE_KEE.id);
    expect(detail.locations[0].photo_urls).toEqual(["https://example.test/photo.jpg"]);
    expect(detail.locations[0].added_at).toBe(NOW.toISOString());
  });

  it("refuses an empty patch rather than touching the clock", async () => {
    await install();
    const id = await makeCollection();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await patchCollection(
      request(`/api/collections/${id}`, { method: "PATCH", body: JSON.stringify({}) }),
      params({ id }),
    );

    // `/collections` sorts by `updated_at`, so an empty patch would reorder the
    // grid over a write the traveller did not make.
    expect(response.status).toBe(400);
    expect(errors).toHaveBeenCalled();
  });

  it("archives a collection through a patch", async () => {
    const harness = await install();
    const id = await makeCollection();

    const response = await patchCollection(
      request(`/api/collections/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ is_archived: true }),
      }),
      params({ id }),
    );

    expect(response.status).toBe(200);
    expect(harness.collections.rows.get(id)?.is_archived).toBe(true);
  });
});

describe("POST /api/collections/[id]/locations", () => {
  it("reports what landed, not what was sent", async () => {
    await install();
    const id = await makeCollection();
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await addLocations(
      request(`/api/collections/${id}/locations`, {
        method: "POST",
        body: JSON.stringify({ location_ids: [HOE_KEE.id, LAU_PA_SAT.id, GONE] }),
      }),
      params({ id }),
    );

    expect(await response.json()).toEqual({ added: 2, duplicates: 0, unknown: 1 });
    // The only way an unknown id happens is a client holding a stale row, so
    // it is warned about rather than swallowed.
    expect(warnings).toHaveBeenCalled();
  });

  it("treats adding the same place twice as a success", async () => {
    await install();
    const id = await makeCollection();
    const body = JSON.stringify({ location_ids: [HOE_KEE.id] });

    await addLocations(
      request(`/api/collections/${id}/locations`, { method: "POST", body }),
      params({ id }),
    );
    const second = await addLocations(
      request(`/api/collections/${id}/locations`, { method: "POST", body }),
      params({ id }),
    );

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ added: 0, duplicates: 1, unknown: 0 });
  });

  it("is a 404 for a collection that is not the caller's", async () => {
    const harness = await install();
    const id = await makeCollection();
    const stranger = await signedIn({ now: NOW, email: "other@example.com", token: "other" });
    collectionRouteDeps.create = () => ({
      collections: harness.collections,
      users: stranger.users,
      now: () => NOW,
    });

    const response = await addLocations(
      request(
        `/api/collections/${id}/locations`,
        { method: "POST", body: JSON.stringify({ location_ids: [HOE_KEE.id] }) },
        stranger.cookie,
      ),
      params({ id }),
    );

    expect(response.status).toBe(404);
    expect(harness.collections.members.get(id) ?? []).toHaveLength(0);
  });

  it("rejects an empty list rather than answering a no-op with a success", async () => {
    await install();
    const id = await makeCollection();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await addLocations(
      request(`/api/collections/${id}/locations`, {
        method: "POST",
        body: JSON.stringify({ location_ids: [] }),
      }),
      params({ id }),
    );

    expect(response.status).toBe(400);
    expect(errors).toHaveBeenCalled();
  });
});

describe("DELETE /api/collections/[id]/locations/[locationId]", () => {
  it("removes the junction row and leaves the shared place alone", async () => {
    const harness = await install();
    const id = await makeCollection();
    await addLocations(
      request(`/api/collections/${id}/locations`, {
        method: "POST",
        body: JSON.stringify({ location_ids: [HOE_KEE.id, LAU_PA_SAT.id] }),
      }),
      params({ id }),
    );

    const response = await removeLocation(
      request(`/api/collections/${id}/locations/${HOE_KEE.id}`, { method: "DELETE" }),
      params({ id, locationId: HOE_KEE.id }),
    );

    expect(response.status).toBe(204);
    expect((harness.collections.members.get(id) ?? []).map((entry) => entry.locationId)).toEqual([
      LAU_PA_SAT.id,
    ]);
  });

  it("is a 404 for a place that was never on the collection", async () => {
    await install();
    const id = await makeCollection();

    const response = await removeLocation(
      request(`/api/collections/${id}/locations/${HOE_KEE.id}`, { method: "DELETE" }),
      params({ id, locationId: HOE_KEE.id }),
    );

    expect(response.status).toBe(404);
  });
});
