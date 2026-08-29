/**
 * The Postgres half of the collection store, against a real Neon branch.
 *
 * The offline suite tests the in-memory double, which is the harness the route
 * tests run on. It cannot see the four things that only exist in SQL, and every
 * one of them is a rule this feature depends on:
 *
 *   1. the unique `(collection, location)` pair making an add idempotent
 *   2. `collection_locations.location_id` carrying **no** cascade, so removing
 *      a place from a shelf leaves the shared Places row alone
 *   3. `collections.itinerary_id` unique, so a replan cannot give one trip two
 *      companions
 *   4. deleting a collection taking its junction rows and nothing else
 *
 *   npm run test:db
 *
 * Point it at a scratch branch. Every row it writes is namespaced by `RUN_TAG`
 * and deleted afterwards.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/neon-http/migrator";

import { createDb, type Database } from "./client";
import { createCollectionStore, itineraryCollectionIds } from "./collections";
import {
  collection_locations,
  collections,
  itineraries,
  itinerary_activities,
  itinerary_days,
  locations,
  users,
} from "./schema";

const DATABASE_URL = process.env.DATABASE_URL;

/** Every row this file writes carries it, so cleanup can't touch real data. */
const RUN_TAG = "itest-collections";
const NOW = new Date("2026-08-29T09:00:00.000Z");

describe.skipIf(!DATABASE_URL)("collections in Postgres", () => {
  let db: Database;
  let store: ReturnType<typeof createCollectionStore>;
  let ownerId: string;
  let strangerId: string;
  let hoeKee: string;
  let lauPaSat: string;

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    await migrate(db, { migrationsFolder: "./drizzle" });
    store = createCollectionStore(db);

    const [owner, stranger] = await db
      .insert(users)
      .values([
        { email: `${RUN_TAG}-owner@example.test`, password_hash: "x", created_at: NOW, updated_at: NOW },
        { email: `${RUN_TAG}-other@example.test`, password_hash: "x", created_at: NOW, updated_at: NOW },
      ])
      .returning({ id: users.id });
    ownerId = owner.id;
    strangerId = stranger.id;

    const places = await db
      .insert(locations)
      .values([
        { place_id: `${RUN_TAG}-hoe-kee`, name: "Hoe Kee", photo_urls: ["https://example.test/a.jpg"] },
        { place_id: `${RUN_TAG}-lau-pa-sat`, name: "Lau Pa Sat" },
      ])
      .returning({ id: locations.id });
    hoeKee = places[0].id;
    lauPaSat = places[1].id;
  });

  afterAll(async () => {
    if (!db) return;
    // Collections and itineraries cascade to their children; `locations` and
    // `users` are deleted last because everything else references them.
    await db.delete(collections).where(like(collections.name, `${RUN_TAG}%`));
    await db.delete(itineraries).where(like(itineraries.name, `${RUN_TAG}%`));
    await db.delete(locations).where(like(locations.place_id, `${RUN_TAG}%`));
    await db.delete(users).where(like(users.email, `${RUN_TAG}%`));
  });

  it("adds places once, however many times they are offered", async () => {
    const created = await store.createCollection({ name: `${RUN_TAG} idempotent` }, ownerId, NOW);

    const first = await store.addLocations(created.id, [hoeKee, lauPaSat], ownerId, NOW);
    const second = await store.addLocations(created.id, [hoeKee, lauPaSat], ownerId, NOW);

    expect(first).toEqual({ added: 2, duplicates: 0, unknown: 0 });
    // The unique index is what makes this true rather than hoped for.
    expect(second).toEqual({ added: 0, duplicates: 2, unknown: 0 });

    const detail = await store.readCollection(created.id, ownerId);
    expect(detail?.locations).toHaveLength(2);
    expect(detail?.location_count).toBe(2);
    expect(detail?.preview_images).toEqual(["https://example.test/a.jpg"]);
  });

  it("skips an id with no location row rather than failing the whole add", async () => {
    const created = await store.createCollection({ name: `${RUN_TAG} partial` }, ownerId, NOW);
    const gone = "00000000-0000-4000-9000-0000000000ff";

    const result = await store.addLocations(created.id, [hoeKee, gone], ownerId, NOW);

    expect(result).toEqual({ added: 1, duplicates: 0, unknown: 1 });
  });

  it("removes a place from a shelf and leaves the shared Places row alone", async () => {
    const created = await store.createCollection({ name: `${RUN_TAG} remove` }, ownerId, NOW);
    await store.addLocations(created.id, [hoeKee], ownerId, NOW);

    expect(await store.removeLocation(created.id, hoeKee, ownerId)).toBe(true);

    // The whole reason `collection_locations.location_id` has no cascade: one
    // traveller tidying up must not delete a restaurant an itinerary and three
    // links also point at.
    const [row] = await db.select().from(locations).where(eq(locations.id, hoeKee));
    expect(row).toBeDefined();
  });

  it("refuses every write from somebody who does not own the collection", async () => {
    const created = await store.createCollection({ name: `${RUN_TAG} owned` }, ownerId, NOW);

    expect(await store.updateCollection(created.id, { name: "theirs" }, strangerId, NOW)).toBeUndefined();
    expect(await store.addLocations(created.id, [hoeKee], strangerId, NOW)).toBeUndefined();
    expect(await store.removeLocation(created.id, hoeKee, strangerId)).toBe(false);
    expect(await store.deleteCollection(created.id, strangerId)).toBe(false);
    expect(await store.readCollection(created.id, strangerId)).toBeUndefined();

    expect(await store.readCollection(created.id, ownerId)).toBeDefined();
  });

  it("deletes a collection with its junction rows and nothing else", async () => {
    const created = await store.createCollection({ name: `${RUN_TAG} doomed` }, ownerId, NOW);
    await store.addLocations(created.id, [hoeKee, lauPaSat], ownerId, NOW);

    expect(await store.deleteCollection(created.id, ownerId)).toBe(true);

    const links = await db
      .select()
      .from(collection_locations)
      .where(eq(collection_locations.collection_id, created.id));
    expect(links).toHaveLength(0);
    const places = await db.select().from(locations).where(eq(locations.id, lauPaSat));
    expect(places).toHaveLength(1);
  });

  it("gives a trip one companion collection, holding its stops, once", async () => {
    const [trip] = await db
      .insert(itineraries)
      .values({
        user_id: ownerId,
        name: `${RUN_TAG} Singapore`,
        city: "Singapore",
        start_date: "2026-09-14",
        total_days: 1,
        profile: { interests: [], dietary: [], pace: "balanced" },
        created_at: NOW,
      })
      .returning({ id: itineraries.id });
    const [day] = await db
      .insert(itinerary_days)
      .values({ itinerary_id: trip.id, day_index: 0, date: "2026-09-14" })
      .returning({ id: itinerary_days.id });
    await db.insert(itinerary_activities).values([
      { day_id: day.id, location_id: hoeKee, position: 0, slot_role: "lunch", start_min: 720, end_min: 795 },
      // The same place twice, and a stop whose location never resolved.
      { day_id: day.id, location_id: lauPaSat, position: 1, slot_role: "activity", start_min: 840, end_min: 900 },
      { day_id: day.id, location_id: hoeKee, position: 2, slot_role: "dinner", start_min: 1080, end_min: 1155 },
      { day_id: day.id, location_id: null, position: 3, slot_role: "activity", start_min: 1200, end_min: 1260 },
    ]);

    const created = await store.createItineraryCollection(trip.id, ownerId, NOW);
    expect(created).toBeDefined();

    const detail = await store.readCollection(created!.collectionId, ownerId);
    expect(detail?.name).toBe(`${RUN_TAG} Singapore`);
    expect(detail?.locations.map((entry) => entry.location.id).sort()).toEqual(
      [hoeKee, lauPaSat].sort(),
    );

    // A replan must not fail the save over a shelf that already exists, and
    // must not create a second one: `collections.itinerary_id` is unique.
    expect(await store.createItineraryCollection(trip.id, ownerId, NOW)).toBeUndefined();

    expect(await itineraryCollectionIds(db, [trip.id])).toEqual(
      new Map([[trip.id, created!.collectionId]]),
    );

    // And deleting the trip takes its companion with it, which is the direction
    // the foreign key was put on this side to get.
    await db.delete(itineraries).where(eq(itineraries.id, trip.id));
    expect(await store.readCollection(created!.collectionId, ownerId)).toBeUndefined();
  });

  it("reports no companion for a trip planned before they existed", async () => {
    const [trip] = await db
      .insert(itineraries)
      .values({
        user_id: ownerId,
        name: `${RUN_TAG} older`,
        city: "Kyoto",
        start_date: "2026-09-14",
        total_days: 1,
        profile: { interests: [], dietary: [], pace: "balanced" },
        created_at: NOW,
      })
      .returning({ id: itineraries.id });

    // Absent from the map, never an empty string — the card's `collection_id`
    // is what the "Save to itinerary" menus filter on.
    expect(await itineraryCollectionIds(db, [trip.id])).toEqual(new Map());
    // And a trip with no located stops gets no shelf rather than an empty one.
    expect(await store.createItineraryCollection(trip.id, ownerId, NOW)).toBeUndefined();
  });
});
