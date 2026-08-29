import { describe, expect, it } from "vitest";

import {
  createInMemoryContentStore,
  normalizeContentUrl,
  type ContentToSave,
  type LocationRow,
} from "./content";

const NOW = new Date("2026-08-29T09:00:00Z");
const LATER = new Date("2026-08-29T10:00:00Z");
const OWNER = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";
const URL_UNDER_TEST = "https://www.tiktok.com/@someone/video/7123456789";

function locationRow(placeId: string, overrides: Partial<LocationRow> = {}): LocationRow {
  return {
    id: `loc-${placeId}`,
    place_id: placeId,
    name: placeId,
    latitude: -8.65,
    longitude: 115.14,
    types: ["cafe"],
    primary_type: "cafe",
    rating: 4.5,
    user_rating_count: 100,
    price_level: null,
    price_range: null,
    formatted_address: `${placeId}, Bali`,
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
    ...overrides,
  } as LocationRow;
}

function toSave(overrides: Partial<ContentToSave> = {}): ContentToSave {
  return {
    content_url: URL_UNDER_TEST,
    content_title: "Three Cafes in Canggu",
    content_thumbnail: "https://cdn.example/thumb.jpg",
    content_author: "agus.balitour",
    platform: "tiktok",
    generated_summary: "A guide to three cafes.",
    primary_country: "Indonesia",
    primary_region: "Bali",
    placeIds: ["crate"],
    mentions: { crate: "Crate Cafe, Canggu, Indonesia" },
    ...overrides,
  };
}

function store() {
  return createInMemoryContentStore({
    locations: {
      crate: locationRow("crate"),
      milk: locationRow("milk"),
      unlocated: locationRow("unlocated", { latitude: null, longitude: null }),
    },
  });
}

describe("normalizeContentUrl", () => {
  /**
   * The reason this function exists. A TikTok arrives carrying the search that
   * found it and the millisecond it was tapped; without stripping those, the
   * same video pasted twice is two links and is billed twice.
   */
  it("strips the query and fragment that a shared link carries", () => {
    const bare = normalizeContentUrl(URL_UNDER_TEST);
    expect(normalizeContentUrl(`${URL_UNDER_TEST}?q=cafe%20in%20bali&t=1787957482884`)).toBe(bare);
    expect(normalizeContentUrl(`${URL_UNDER_TEST}#comments`)).toBe(bare);
    expect(normalizeContentUrl(`${URL_UNDER_TEST}/`)).toBe(bare);
  });

  it("ignores host casing and a leading www", () => {
    expect(normalizeContentUrl("https://WWW.TikTok.com/@a/video/1")).toBe(
      normalizeContentUrl("https://tiktok.com/@a/video/1"),
    );
  });

  /**
   * The bug this function shipped with. YouTube keeps the video id in the
   * **query**, so dropping the query collapsed every watch URL to
   * `youtube.com/watch` — and the second YouTube link anybody pasted came back
   * "already analyzed", pointing at the first. Found by pasting two.
   */
  it("keeps two YouTube videos apart, whose ids live in the query string", () => {
    const first = normalizeContentUrl("https://www.youtube.com/watch?v=G8s0syV_ocs");
    const second = normalizeContentUrl("https://www.youtube.com/watch?v=0QIDD0RKKj0");

    expect(first).not.toBe(second);
    expect(first).toContain("G8s0syV_ocs");
  });

  it("collapses every YouTube URL form onto one canonical id", () => {
    const canonical = normalizeContentUrl("https://www.youtube.com/watch?v=G8s0syV_ocs");

    // A share sheet, the address bar, a Short and an embed are one video.
    for (const form of [
      "https://youtu.be/G8s0syV_ocs",
      "https://www.youtube.com/shorts/G8s0syV_ocs",
      "https://m.youtube.com/watch?v=G8s0syV_ocs&t=42",
      "https://www.youtube.com/embed/G8s0syV_ocs",
    ]) {
      expect(normalizeContentUrl(form), form).toBe(canonical);
    }
  });

  it("still strips tracking parameters that are not the id", () => {
    expect(normalizeContentUrl("https://www.youtube.com/watch?v=abc&si=xyz&t=90")).toBe(
      normalizeContentUrl("https://www.youtube.com/watch?v=abc"),
    );
  });

  it("keeps two different videos apart", () => {
    expect(normalizeContentUrl("https://www.tiktok.com/@a/video/1")).not.toBe(
      normalizeContentUrl("https://www.tiktok.com/@a/video/2"),
    );
  });

  it("does not throw on something that is not a URL", () => {
    expect(normalizeContentUrl("  NOT a url ")).toBe("not a url");
  });
});

describe("ContentStore", () => {
  it("saves a link and reads it back with its places in order", async () => {
    const content = store();
    const { contentId } = await content.saveContent(
      toSave({ placeIds: ["milk", "crate"], mentions: { milk: "Milk & Madu", crate: "Crate Cafe" } }),
      OWNER,
      NOW,
    );

    const detail = await content.readContentDetail(contentId, OWNER);
    expect(detail?.content_title).toBe("Three Cafes in Canggu");
    // The order the model named them in, which is roughly video order.
    expect(detail?.locations.map((entry) => entry.mention)).toEqual(["Milk & Madu", "Crate Cafe"]);
  });

  it("keeps the model's own words beside the place Google matched", async () => {
    const content = store();
    const { contentId } = await content.saveContent(
      toSave({ mentions: { crate: "Crate Cafe, Canggu, Indonesia" } }),
      OWNER,
      NOW,
    );

    const detail = await content.readContentDetail(contentId, OWNER);
    // Without the mention there is no way to see that a name matched the wrong
    // venue, which is this pipeline's known failure mode.
    expect(detail?.locations[0]).toMatchObject({
      mention: "Crate Cafe, Canggu, Indonesia",
      location: expect.objectContaining({ place_id: "crate" }),
    });
  });

  it("skips a place with no `locations` row rather than inventing one", async () => {
    const content = store();
    const { contentId } = await content.saveContent(
      toSave({ placeIds: ["crate", "never-persisted"], mentions: { crate: "Crate Cafe" } }),
      OWNER,
      NOW,
    );

    const detail = await content.readContentDetail(contentId, OWNER);
    expect(detail?.locations).toHaveLength(1);

    // Counted from what landed, not from what was offered. A card claiming two
    // places over a page showing one is the lie nobody reports.
    const [listed] = await content.listContent(OWNER);
    expect(listed.location_count).toBe(1);
  });

  it("counts one venue once when the model named it twice", async () => {
    const content = store();
    await content.saveContent(
      toSave({ placeIds: ["crate", "crate"], mentions: { crate: "Crate Cafe" } }),
      OWNER,
      NOW,
    );

    const [listed] = await content.listContent(OWNER);
    expect(listed.location_count).toBe(1);
  });

  it("replaces a re-analyzed link instead of saving it twice", async () => {
    const content = store();
    const first = await content.saveContent(toSave(), OWNER, NOW);
    const second = await content.saveContent(
      toSave({
        content_url: `${URL_UNDER_TEST}?q=cafe%20in%20bali`,
        content_title: "A better title",
        placeIds: ["milk"],
        mentions: { milk: "Milk & Madu" },
      }),
      OWNER,
      LATER,
    );

    expect(second.contentId).toBe(first.contentId);
    expect(await content.listContent(OWNER)).toHaveLength(1);

    const detail = await content.readContentDetail(first.contentId, OWNER);
    expect(detail?.content_title).toBe("A better title");
    // Replaced, not merged: keeping a venue the new run no longer believes in
    // is indistinguishable from one it simply did not reach.
    expect(detail?.locations.map((entry) => entry.mention)).toEqual(["Milk & Madu"]);
  });

  it("saves two YouTube videos as two links, not one", async () => {
    const content = store();
    await content.saveContent(
      toSave({ content_url: "https://www.youtube.com/watch?v=G8s0syV_ocs" }),
      OWNER,
      NOW,
    );
    await content.saveContent(
      toSave({ content_url: "https://www.youtube.com/watch?v=0QIDD0RKKj0" }),
      OWNER,
      LATER,
    );

    // Two rows, not one overwriting the other.
    expect(await content.listContent(OWNER)).toHaveLength(2);
  });

  it("lets two travellers each save the same video", async () => {
    const content = store();
    await content.saveContent(toSave(), OWNER, NOW);
    await content.saveContent(toSave(), OTHER, NOW);

    expect(await content.listContent(OWNER)).toHaveLength(1);
    expect(await content.listContent(OTHER)).toHaveLength(1);
  });

  it("lists newest first", async () => {
    const content = store();
    await content.saveContent(toSave({ content_url: "https://www.tiktok.com/@a/video/1" }), OWNER, NOW);
    await content.saveContent(toSave({ content_url: "https://www.tiktok.com/@a/video/2" }), OWNER, LATER);

    const listed = await content.listContent(OWNER);
    expect(listed.map((item) => item.content_url)).toEqual([
      "https://www.tiktok.com/@a/video/2",
      "https://www.tiktok.com/@a/video/1",
    ]);
  });

  // ── ownership ──────────────────────────────────────────────────────────────

  /**
   * Somebody else's link reads as absent, not as forbidden. A 403 confirms the
   * id names a real thing, which is the one fact an outsider wants.
   */
  it("hides another traveller's link from both reading and deleting", async () => {
    const content = store();
    const { contentId } = await content.saveContent(toSave(), OWNER, NOW);

    expect(await content.readContentDetail(contentId, OTHER)).toBeUndefined();
    expect(await content.deleteContent(contentId, OTHER)).toBe(false);
    // Still there for its owner.
    expect(await content.readContentDetail(contentId, OWNER)).toBeDefined();
  });

  it("deletes a link for its owner and reports whether it did", async () => {
    const content = store();
    const { contentId } = await content.saveContent(toSave(), OWNER, NOW);

    expect(await content.deleteContent(contentId, OWNER)).toBe(true);
    expect(await content.readContentDetail(contentId, OWNER)).toBeUndefined();
    expect(await content.deleteContent(contentId, OWNER)).toBe(false);
  });

  // ── the map ────────────────────────────────────────────────────────────────

  it("carries the first located place as the link's coordinate", async () => {
    const content = store();
    await content.saveContent(
      toSave({
        placeIds: ["unlocated", "crate"],
        mentions: { unlocated: "Somewhere", crate: "Crate Cafe" },
      }),
      OWNER,
      NOW,
    );

    // The first place with a coordinate, not the first place.
    const [listed] = await content.listContent(OWNER);
    expect(listed).toMatchObject({ latitude: -8.65, longitude: 115.14, primary_region: "Bali" });
  });

  it("leaves the coordinate null when nothing resolved, rather than pinning (0, 0)", async () => {
    const content = store();
    await content.saveContent(toSave({ placeIds: [], mentions: {} }), OWNER, NOW);

    const [listed] = await content.listContent(OWNER);
    expect(listed.latitude).toBeNull();
    expect(listed.longitude).toBeNull();
  });

  // ── the already-analyzed lookup ────────────────────────────────────────────

  it("finds a link this person saved, whatever parameters the re-paste carries", async () => {
    const content = store();
    await content.saveContent(toSave(), OWNER, NOW);

    const found = await content.findByUrl(
      normalizeContentUrl(`${URL_UNDER_TEST}?q=cafe%20in%20bali&t=1787957482884`),
      OWNER,
    );
    expect(found?.content_title).toBe("Three Cafes in Canggu");

    // Per person: somebody else saving it does not make it yours.
    expect(await content.findByUrl(normalizeContentUrl(URL_UNDER_TEST), OTHER)).toBeUndefined();
  });
});
