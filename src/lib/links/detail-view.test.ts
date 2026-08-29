import { describe, expect, it } from "vitest";

import type { ContentDetail, LocationRow } from "@/lib/db/content";

import { toLinkDetail, toLinkLocation, toLinkLocations } from "./detail-view";

const NOW = new Date("2026-08-29T09:00:00Z");
const SOURCE = "https://www.tiktok.com/@someone/video/7123456789";

function locationRow(overrides: Partial<LocationRow> = {}): LocationRow {
  return {
    id: "loc-1",
    place_id: "crate-cafe",
    name: "Crate Cafe",
    latitude: -8.65,
    longitude: 115.14,
    types: ["cafe", "food"],
    primary_type: "cafe",
    rating: 4.5,
    user_rating_count: 900,
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
    ...overrides,
  } as LocationRow;
}

function detail(overrides: Partial<ContentDetail> = {}): ContentDetail {
  return {
    id: "content-1",
    content_url: SOURCE,
    normalized_url: SOURCE,
    content_title: "Three Cafes in Canggu",
    content_thumbnail: "https://cdn.example/thumb.jpg",
    content_author: "agus.balitour",
    platform: "tiktok",
    generated_summary: "A guide.",
    primary_country: "Indonesia",
    primary_region: "Bali",
    created_at: NOW.toISOString(),
    locations: [{ mention: "Crate Cafe, Canggu, Indonesia", location: locationRow() }],
    ...overrides,
  };
}

describe("toLinkDetail", () => {
  it("prefers the region over the country, because it locates the trip better", () => {
    expect(toLinkDetail(detail()).country).toBe("Bali");
    expect(toLinkDetail(detail({ primary_region: null })).country).toBe("Indonesia");
    expect(toLinkDetail(detail({ primary_region: null, primary_country: null })).country).toBe("");
  });

  it("falls back to the URL when a link has no title", () => {
    expect(toLinkDetail(detail({ content_title: null })).title).toBe(SOURCE);
  });
});

describe("toLinkLocation", () => {
  it("maps a place to a card", () => {
    const item = toLinkLocation("Crate Cafe, Canggu, Indonesia", locationRow(), SOURCE);

    expect(item).toMatchObject({
      id: "loc-1",
      name: "Crate Cafe",
      address: "Canggu, Bali",
      latitude: -8.65,
      primaryType: "cafe",
      sourceUrl: SOURCE,
    });
  });

  /**
   * The grid puts every card on a map. A row with no coordinate would pin at
   * (0, 0) in the Gulf of Guinea, which reads as a bug rather than as absence.
   */
  it("drops a place with no coordinates", () => {
    expect(toLinkLocation("Somewhere", locationRow({ latitude: null }), SOURCE)).toBeNull();
    expect(toLinkLocation("Somewhere", locationRow({ longitude: null }), SOURCE)).toBeNull();
    expect(toLinkLocations(detail({
      locations: [{ mention: "Somewhere", location: locationRow({ latitude: null }) }],
    }))).toEqual([]);
  });

  it("prefers Google's blurb, then its review digest, then the model's own words", () => {
    const editorial = toLinkLocation("mention", locationRow({
      editorial_summary: "A surf-town cafe.",
      review_summary: "Reviewers like the coffee.",
    }), SOURCE);
    expect(editorial?.description).toBe("A surf-town cafe.");

    const digest = toLinkLocation("mention", locationRow({ review_summary: "Reviewers like it." }), SOURCE);
    expect(digest?.description).toBe("Reviewers like it.");

    // Thin, but true, and it is what the video actually said.
    const fallback = toLinkLocation("Crate Cafe, Canggu, Indonesia", locationRow(), SOURCE);
    expect(fallback?.description).toBe("Crate Cafe, Canggu, Indonesia");
  });

  it("renders opening hours when there are any, and nothing when there are not", () => {
    const withHours = toLinkLocation("mention", locationRow({
      opening_periods: [
        { open: { day: 1, hour: 8, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
      ],
    }), SOURCE);
    expect(withHours?.details.openingHoursLines.length).toBe(7);
    expect(withHours?.details.openingHoursLines[0]).toContain("Monday");

    expect(toLinkLocation("mention", locationRow(), SOURCE)?.details.openingHoursLines).toEqual([]);
  });

  /** Three fields the card asks for that this database does not have. Empty is
   *  the honest answer; faking them is not. */
  it("leaves phone, website and the favourite flag empty rather than faking them", () => {
    const item = toLinkLocation("mention", locationRow(), SOURCE);
    expect(item?.details.phone).toBe("");
    expect(item?.details.website).toBe("");
    expect(item?.isFavorite).toBe(false);
  });

  it("links to the place on Google, falling back when the stored URI is null", () => {
    const stored = toLinkLocation("mention", locationRow({
      google_maps_uri: "https://maps.google.com/?cid=1",
    }), SOURCE);
    expect(stored?.googleMapsUri).toBe("https://maps.google.com/?cid=1");

    // Every place stored before `google_maps_uri` joined the field mask.
    const fallback = toLinkLocation("mention", locationRow(), SOURCE);
    expect(fallback?.googleMapsUri).toContain("crate-cafe");
  });

  it("uses the first resolved photo as the thumbnail", () => {
    const withPhotos = toLinkLocation("mention", locationRow({
      photo_urls: ["https://cdn/1.jpg", "https://cdn/2.jpg"],
    }), SOURCE);
    expect(withPhotos?.thumbnailUrl).toBe("https://cdn/1.jpg");
    expect(withPhotos?.images).toHaveLength(2);

    expect(toLinkLocation("mention", locationRow(), SOURCE)?.thumbnailUrl).toBe("");
  });
});
