/**
 * `GET /api/content` and `GET`/`DELETE /api/content/[id]`, through the real
 * handlers with an in-memory store.
 *
 * The property worth holding here is the one that is easy to get wrong and
 * impossible to see from the outside: **somebody else's link is a 404, never a
 * 403.** A 403 confirms the id names a real thing, which is the one fact an
 * outsider wants.
 */

import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryContentStore,
  type ContentToSave,
  type LocationRow,
} from "@/lib/db/content";

import { contentRouteDeps } from "../deps";
import { signedIn, type SignedIn } from "../session-fixture";
import { GET as listContent } from "./route";
import { DELETE as deleteOne, GET as readOne } from "./[id]/route";

const NOW = new Date("2026-08-29T09:00:00Z");
const URL_UNDER_TEST = "https://www.tiktok.com/@someone/video/7123456789";

function locationRow(): LocationRow {
  return {
    id: "loc-1",
    place_id: "crate-cafe",
    name: "Crate Cafe",
    latitude: -8.65,
    longitude: 115.14,
    types: ["cafe"],
    primary_type: "cafe",
    rating: 4.5,
    user_rating_count: 100,
    price_level: null,
    price_range: null,
    formatted_address: "Canggu, Bali",
    city: "Bali",
    opening_periods: null,
    review_snippets: null,
    editorial_summary: null,
    review_summary: null,
    serves_vegetarian_food: null,
    shortlist_hydrated_at: null,
    photo_names: null,
    photo_urls: null,
    photos_resolved_at: null,
    business_status: null,
    google_maps_uri: null,
    stay_duration: null,
    fetched_at: NOW,
  } as LocationRow;
}

function toSave(overrides: Partial<ContentToSave> = {}): ContentToSave {
  return {
    content_url: URL_UNDER_TEST,
    content_title: "Three Cafes in Canggu",
    content_thumbnail: "https://cdn.example/thumb.jpg",
    content_author: "agus.balitour",
    platform: "tiktok",
    generated_summary: "A guide.",
    primary_country: "Indonesia",
    primary_region: "Bali",
    placeIds: ["crate-cafe"],
    mentions: { "crate-cafe": "Crate Cafe, Canggu, Indonesia" },
    ...overrides,
  };
}

async function harness() {
  const content = createInMemoryContentStore({ locations: { "crate-cafe": locationRow() } });
  const session = await signedIn({ now: NOW });

  contentRouteDeps.create = () => ({ content, users: session.users, now: () => NOW });
  return { content, session };
}

function get(path: string, cookie?: string): Request {
  return new Request(`http://localhost${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

/** A second traveller, with their own id —  scopes them so two
 *  travellers in one test cannot share one, which would silently turn every
 *  assertion below into a comparison of a thing with itself. */
async function intruder(): Promise<SignedIn> {
  return signedIn({ now: NOW, email: "other@example.com", token: "other-token" });
}

const originalCreate = contentRouteDeps.create;
afterEach(() => {
  contentRouteDeps.create = originalCreate;
});

describe("GET /api/content", () => {
  it("returns this traveller's links, newest first", async () => {
    const { content, session } = await harness();
    await content.saveContent(toSave({ content_url: "https://www.tiktok.com/@a/video/1" }), session.user.id, NOW);
    await content.saveContent(
      toSave({ content_url: "https://www.tiktok.com/@a/video/2" }),
      session.user.id,
      new Date("2026-08-29T10:00:00Z"),
    );

    const response = await listContent(get("/api/content", session.cookie));
    const body = (await response.json()) as { content_url: string }[];

    expect(response.status).toBe(200);
    expect(body.map((item) => item.content_url)).toEqual([
      "https://www.tiktok.com/@a/video/2",
      "https://www.tiktok.com/@a/video/1",
    ]);
  });

  /**
   * Empty, not a 401. "No links yet" is the right thing to show somebody who is
   * not signed in; an error toast on a page they may legitimately look at is not.
   */
  it("answers with an empty list for a signed-out caller", async () => {
    const { content, session } = await harness();
    await content.saveContent(toSave(), session.user.id, NOW);

    const response = await listContent(get("/api/content"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
  });

  it("carries the coordinate and region the map pins need", async () => {
    const { content, session } = await harness();
    await content.saveContent(toSave(), session.user.id, NOW);

    const [item] = (await (await listContent(get("/api/content", session.cookie))).json()) as {
      latitude: number;
      primary_region: string;
    }[];
    expect(item).toMatchObject({ latitude: -8.65, primary_region: "Bali" });
  });

  it("answers 500, not an empty list, when the store is broken", async () => {
    const { content, session } = await harness();
    content.listContent = async () => {
      throw new Error("postgres is down");
    };

    // An empty list would read as "you have no links", which is a different
    // and much worse answer than "we could not check".
    const response = await listContent(get("/api/content", session.cookie));
    expect(response.status).toBe(500);
  });
});

describe("GET /api/content/[id]", () => {
  it("returns the link and the places it named", async () => {
    const { content, session } = await harness();
    const { contentId } = await content.saveContent(toSave(), session.user.id, NOW);

    const response = await readOne(get(`/api/content/${contentId}`, session.cookie), params(contentId));
    const body = (await response.json()) as { content_title: string; locations: unknown[] };

    expect(response.status).toBe(200);
    expect(body.content_title).toBe("Three Cafes in Canggu");
    expect(body.locations).toHaveLength(1);
  });

  it("answers 404 for another traveller's link, never 403", async () => {
    const { content, session } = await harness();
    const { contentId } = await content.saveContent(toSave(), session.user.id, NOW);
    const other = await intruder();
    contentRouteDeps.create = () => ({ content, users: other.users, now: () => NOW });

    const response = await readOne(get(`/api/content/${contentId}`, other.cookie), params(contentId));

    // 403 would confirm the id is real, which is the one fact an outsider wants.
    expect(response.status).toBe(404);
  });

  it("answers 404 for an unknown id and for a signed-out caller", async () => {
    const { content, session } = await harness();
    const { contentId } = await content.saveContent(toSave(), session.user.id, NOW);

    expect((await readOne(get("/api/content/nope", session.cookie), params("nope"))).status).toBe(404);
    expect((await readOne(get(`/api/content/${contentId}`), params(contentId))).status).toBe(404);
  });

  it("answers 500 when the read itself broke, so the client retries", async () => {
    const { content, session } = await harness();
    content.readContentDetail = async () => {
      throw new Error("postgres is down");
    };

    // A 404 here would tell the client the link is gone and stop it trying.
    const response = await readOne(get("/api/content/x", session.cookie), params("x"));
    expect(response.status).toBe(500);
  });
});

describe("DELETE /api/content/[id]", () => {
  it("deletes the traveller's own link and answers 204", async () => {
    const { content, session } = await harness();
    const { contentId } = await content.saveContent(toSave(), session.user.id, NOW);

    const response = await deleteOne(get(`/api/content/${contentId}`, session.cookie), params(contentId));

    expect(response.status).toBe(204);
    expect(await content.readContentDetail(contentId, session.user.id)).toBeUndefined();
  });

  it("refuses to delete another traveller's link, and leaves it standing", async () => {
    const { content, session } = await harness();
    const { contentId } = await content.saveContent(toSave(), session.user.id, NOW);
    const other = await intruder();
    contentRouteDeps.create = () => ({ content, users: other.users, now: () => NOW });

    const response = await deleteOne(get(`/api/content/${contentId}`, other.cookie), params(contentId));

    expect(response.status).toBe(404);
    contentRouteDeps.create = () => ({ content, users: session.users, now: () => NOW });
    expect(await content.readContentDetail(contentId, session.user.id)).toBeDefined();
  });

  it("answers 404 when there was nothing to delete", async () => {
    const { session } = await harness();
    const response = await deleteOne(get("/api/content/nope", session.cookie), params("nope"));
    expect(response.status).toBe(404);
  });
});
