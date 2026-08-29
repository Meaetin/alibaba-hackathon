/**
 * The collection store's rules, driven through the in-memory double, and the
 * mapping the collection page renders from.
 *
 * The double is the thing under test as much as it is the harness: a double
 * more permissive than the SQL turns every route test that uses it into a test
 * of the double. So each rule the Postgres path relies on — the owner check
 * inside the read, the unique `(collection, location)` pair, an unknown id
 * skipped rather than inserted, the clock moving only on a real change — is
 * asserted here rather than assumed.
 *
 * The Postgres implementations are not covered here; they are `select`s and
 * `insert`s that need a database, which is what `test:db` is for.
 */

import { describe, expect, it } from "vitest";

import {
  createInMemoryCollectionStore,
  toListItem,
  type CollectionRow,
  type LocationRow,
} from "./collections";
import { toCollectionDetailView, toCollectionLocation } from "./collection-view";

const NOW = new Date("2026-08-29T09:00:00.000Z");
const LATER = new Date("2026-08-29T10:00:00.000Z");
const ALICE = "00000000-0000-4000-8000-00000000a11c";
const BOB = "00000000-0000-4000-8000-00000000b0b0";

function locationRow(id: string, overrides: Partial<LocationRow> = {}): LocationRow {
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
    photo_urls: null,
    photos_resolved_at: null,
    business_status: "OPERATIONAL",
    google_maps_uri: null,
    stay_duration: 75,
    fetched_at: NOW,
    ...overrides,
  };
}

function collectionRow(id: string, userId: string): CollectionRow {
  return {
    id,
    user_id: userId,
    name: `Collection ${id}`,
    description: null,
    country: null,
    region: null,
    latitude: null,
    longitude: null,
    tags: [],
    is_bookmarked: false,
    is_archived: false,
    itinerary_id: null,
    created_at: NOW,
    updated_at: NOW,
  };
}

const HOE_KEE = locationRow("00000000-0000-4000-9000-000000000001", {
  photo_urls: ["https://example.test/hoe-kee.jpg"],
});
const LAU_PA_SAT = locationRow("00000000-0000-4000-9000-000000000002");
const GONE = "00000000-0000-4000-9000-0000000000ff";

function store() {
  return createInMemoryCollectionStore({
    locations: { [HOE_KEE.id]: HOE_KEE, [LAU_PA_SAT.id]: LAU_PA_SAT },
  });
}

describe("ownership", () => {
  it("answers 404 for somebody else's collection, not 403", async () => {
    // A 403 confirms the id names a real thing, which is the one fact an
    // outsider wants. The read cannot tell "no such collection" from "not
    // yours", and that is the point.
    const collections = createInMemoryCollectionStore({
      rows: [collectionRow("00000000-0000-4000-a000-000000000001", ALICE)],
    });

    expect(await collections.readCollection("00000000-0000-4000-a000-000000000001", BOB)).toBeUndefined();
    expect(await collections.listCollections(BOB)).toEqual([]);
  });

  it("refuses every write on a collection that is not yours", async () => {
    const collections = createInMemoryCollectionStore({
      rows: [collectionRow("00000000-0000-4000-a000-000000000001", ALICE)],
      locations: { [HOE_KEE.id]: HOE_KEE },
    });
    const id = "00000000-0000-4000-a000-000000000001";

    expect(await collections.updateCollection(id, { name: "Mine now" }, BOB, NOW)).toBeUndefined();
    expect(await collections.addLocations(id, [HOE_KEE.id], BOB, NOW)).toBeUndefined();
    expect(await collections.removeLocation(id, HOE_KEE.id, BOB)).toBe(false);
    expect(await collections.deleteCollection(id, BOB)).toBe(false);

    // And nothing about the row moved while all four were being refused.
    const untouched = await collections.readCollection(id, ALICE);
    expect(untouched?.name).toBe("Collection 00000000-0000-4000-a000-000000000001");
    expect(untouched?.location_count).toBe(0);
  });
});

describe("adding places", () => {
  it("counts what landed, not what was offered", async () => {
    const collections = store();
    const created = await collections.createCollection({ name: "Hawker" }, ALICE, NOW);

    const first = await collections.addLocations(
      created.id,
      [HOE_KEE.id, LAU_PA_SAT.id, GONE],
      ALICE,
      NOW,
    );

    // "Added 3" over a grid showing 2 is the kind of lie nobody reports.
    expect(first).toEqual({ added: 2, duplicates: 0, unknown: 1 });
  });

  it("is idempotent — adding a place twice is a success, not an error", async () => {
    const collections = store();
    const created = await collections.createCollection({ name: "Hawker" }, ALICE, NOW);
    await collections.addLocations(created.id, [HOE_KEE.id], ALICE, NOW);

    const again = await collections.addLocations(
      created.id,
      [HOE_KEE.id, LAU_PA_SAT.id],
      ALICE,
      LATER,
    );

    expect(again).toEqual({ added: 1, duplicates: 1, unknown: 0 });
    const detail = await collections.readCollection(created.id, ALICE);
    expect(detail?.locations).toHaveLength(2);
  });

  it("moves the clock only when the contents actually changed", async () => {
    // A no-op add that reordered the grid would be a write the traveller did
    // not make — `/collections` sorts by `updated_at`.
    const collections = store();
    const created = await collections.createCollection({ name: "Hawker" }, ALICE, NOW);
    await collections.addLocations(created.id, [HOE_KEE.id], ALICE, NOW);

    await collections.addLocations(created.id, [HOE_KEE.id], ALICE, LATER);
    expect((await collections.readCollection(created.id, ALICE))?.updated_at).toBe(
      NOW.toISOString(),
    );

    await collections.addLocations(created.id, [LAU_PA_SAT.id], ALICE, LATER);
    expect((await collections.readCollection(created.id, ALICE))?.updated_at).toBe(
      LATER.toISOString(),
    );
  });

  it("removes a place without touching the shared location row", async () => {
    // `collection_locations.location_id` carries no cascade for exactly this:
    // one traveller tidying up must not take a restaurant out of the itinerary
    // and three links that also point at it.
    const collections = store();
    const created = await collections.createCollection({ name: "Hawker" }, ALICE, NOW);
    await collections.addLocations(created.id, [HOE_KEE.id, LAU_PA_SAT.id], ALICE, NOW);

    expect(await collections.removeLocation(created.id, HOE_KEE.id, ALICE)).toBe(true);
    // A second remove is false: it was already gone.
    expect(await collections.removeLocation(created.id, HOE_KEE.id, ALICE)).toBe(false);

    const detail = await collections.readCollection(created.id, ALICE);
    expect(detail?.locations.map((entry) => entry.location.id)).toEqual([LAU_PA_SAT.id]);
  });
});

describe("the companion collection", () => {
  const TRIP = "00000000-0000-4000-8000-0000000000e1";

  it("holds every place the trip scheduled, deduped", async () => {
    const collections = createInMemoryCollectionStore({
      locations: { [HOE_KEE.id]: HOE_KEE, [LAU_PA_SAT.id]: LAU_PA_SAT },
      itineraryStops: {
        [TRIP]: {
          name: "Three days in Singapore",
          // The same place on two days, and one stop whose location never
          // resolved to a row.
          locationIds: [HOE_KEE.id, null, LAU_PA_SAT.id, HOE_KEE.id],
        },
      },
    });

    const created = await collections.createItineraryCollection(TRIP, ALICE, NOW);
    const detail = await collections.readCollection(created!.collectionId, ALICE);

    expect(detail?.name).toBe("Three days in Singapore");
    expect(detail?.locations.map((entry) => entry.location.id).sort()).toEqual(
      [HOE_KEE.id, LAU_PA_SAT.id].sort(),
    );
  });

  it("creates nothing for a trip with no located stops", async () => {
    // An empty shelf beside a trip reads as "this trip saved nothing", which is
    // a different and wrong statement from "nothing was saved yet".
    const collections = createInMemoryCollectionStore({
      itineraryStops: { [TRIP]: { name: "Ghost trip", locationIds: [null, null] } },
    });

    expect(await collections.createItineraryCollection(TRIP, ALICE, NOW)).toBeUndefined();
    expect(await collections.listCollections(ALICE)).toEqual([]);
  });

  it("gives one trip one companion, however often it is asked", async () => {
    const collections = createInMemoryCollectionStore({
      locations: { [HOE_KEE.id]: HOE_KEE },
      itineraryStops: { [TRIP]: { name: "Replanned", locationIds: [HOE_KEE.id] } },
    });

    expect(await collections.createItineraryCollection(TRIP, ALICE, NOW)).toBeDefined();
    expect(await collections.createItineraryCollection(TRIP, ALICE, LATER)).toBeUndefined();
    expect(await collections.listCollections(ALICE)).toHaveLength(1);
  });
});

describe("the card", () => {
  it("reports the count and previews from what is on the shelf", async () => {
    const collections = store();
    const created = await collections.createCollection({ name: "Hawker" }, ALICE, NOW);
    await collections.addLocations(created.id, [HOE_KEE.id, LAU_PA_SAT.id], ALICE, NOW);

    const [card] = await collections.listCollections(ALICE);
    expect(card.location_count).toBe(2);
    // Only the place with a resolved photo contributes one; the other is a grey
    // box rather than a broken image.
    expect(card.preview_images).toEqual(["https://example.test/hoe-kee.jpg"]);
    expect(card.thumbnail_url).toBe("https://example.test/hoe-kee.jpg");
  });

  it("pins sharing off rather than inventing it", async () => {
    // There is no `collection_collaborators` table and no token routes in this
    // build. The ported card still requires all three props.
    const card = toListItem(collectionRow("00000000-0000-4000-a000-000000000001", ALICE));
    expect(card.is_public).toBe(false);
    expect(card.fork_count).toBe(0);
    expect(card.user_role).toBe("owner");
  });
});

describe("the location view", () => {
  it("leaves the fields this database has no column for empty", async () => {
    const view = toCollectionLocation(HOE_KEE, NOW.toISOString());

    // `website_uri` and `international_phone_number` are not on the Places
    // field masks this app buys. A phone number that dials nobody is worse
    // than a card without one.
    expect(view).not.toHaveProperty("website_uri");
    expect(view).not.toHaveProperty("international_phone_number");
    expect(view.is_bookmarked).toBe(false);
    expect(view.added_at).toBe(NOW.toISOString());
  });

  it("omits opening hours rather than sending an empty list", async () => {
    // The detail view renders an "Opening hours" block whenever the key is
    // present, and an empty one claims we know this place's hours and they are
    // nothing.
    const noHours = toCollectionLocation(HOE_KEE, NOW.toISOString());
    expect(noHours.regular_opening_hours).toBeUndefined();

    const withHours = toCollectionLocation(
      locationRow(HOE_KEE.id, {
        opening_periods: [
          { open: { day: 1, hour: 9, minute: 0 }, close: { day: 1, hour: 17, minute: 0 } },
        ],
      }),
      NOW.toISOString(),
    );
    expect(withHours.regular_opening_hours?.weekdayDescriptions).toHaveLength(7);
  });

  it("keeps a place with no coordinates, unlike a link's grid", async () => {
    // `toLinkLocation` drops one because that grid puts every card on a map and
    // a pin at (0, 0) is worse than a missing one. A collection is a list the
    // traveller built, and silently dropping something they saved is worse.
    const unlocated = locationRow(HOE_KEE.id, { latitude: null, longitude: null });
    const view = toCollectionDetailView({
      ...toListItem(collectionRow("00000000-0000-4000-a000-000000000001", ALICE)),
      locations: [{ location: unlocated, added_at: NOW.toISOString() }],
    });

    expect(view.locations).toHaveLength(1);
    // With no coordinate there is no last-rung Maps link to fall back to.
    expect(view.locations[0].google_maps_uri).toBeNull();
  });
});
