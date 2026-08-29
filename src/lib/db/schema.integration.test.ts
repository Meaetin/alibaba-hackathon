/**
 * Runs only when `DATABASE_URL` points at a real Neon branch. This is a
 * nightly / pre-demo check, not a per-commit gate — nothing in CI should block
 * on a network round trip to Postgres.
 *
 *   DATABASE_URL=postgres://... npx vitest run src/lib/db
 *
 * Point it at a scratch branch. The round-trip tests write rows (namespaced by
 * `RUN_TAG` and deleted afterwards), and `migrate()` writes to
 * `drizzle.__drizzle_migrations`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, like } from "drizzle-orm";
import { migrate } from "drizzle-orm/neon-http/migrator";

import { createDb, type Database } from "./client";
import { locations, place_search_cache } from "./schema";
import { createLocationStore, createSearchCache } from "./stores";
import type { RetrievedPlace } from "@/lib/planner/retrieval";

const DATABASE_URL = process.env.DATABASE_URL;

/** Every row this file writes carries it, so cleanup can't touch real data. */
const RUN_TAG = "itest-step9";

describe.skipIf(!DATABASE_URL)("neon schema", () => {
  let db: Database;

  beforeAll(async () => {
    db = createDb(DATABASE_URL!);
    await migrate(db, { migrationsFolder: "./drizzle" });
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(locations).where(like(locations.place_id, `${RUN_TAG}%`));
    await db.delete(place_search_cache).where(like(place_search_cache.query_hash, `${RUN_TAG}%`));
  });

  it("applies migrations cleanly and leaves every table queryable", async () => {
    await expect(db.select().from(locations).limit(1)).resolves.toBeInstanceOf(Array);
    await expect(db.select().from(place_search_cache).limit(1)).resolves.toBeInstanceOf(Array);
  });

  it("round-trips a full locations row, jsonb columns included", async () => {
    const store = createLocationStore(db);
    const place = fullPlace(`${RUN_TAG}-round-trip`);

    await store.upsertMany([place]);
    const [read] = await store.getMany([place.placeId]);

    expect(read).toEqual(place);
  });

  it("does not let a refetch wipe enrichment or resolved photos", async () => {
    const store = createLocationStore(db);
    const placeId = `${RUN_TAG}-preserve`;
    const resolvedAt = new Date("2026-08-01T00:00:00.000Z");

    await store.upsertMany([
      {
        ...fullPlace(placeId),
        stayDuration: 90,
        photoUrls: ["https://example.test/photo.jpg"],
        photosResolvedAt: resolvedAt,
      },
    ]);
    // Retrieval never learns these three, so it always writes them empty.
    const [merged] = await store.upsertMany([{ ...fullPlace(placeId), name: "Refetched" }]);

    const [read] = await store.getMany([placeId]);
    expect(merged).toEqual(read);
    expect(read.name).toBe("Refetched");
    expect(read.stayDuration).toBe(90);
    expect(read.photoUrls).toEqual(["https://example.test/photo.jpg"]);
    expect(read.photosResolvedAt).toEqual(resolvedAt);
  });

  it("writes every shortlist field in one patch, false included", async () => {
    const store = createLocationStore(db);
    const placeId = `${RUN_TAG}-hydrate`;
    const hydratedAt = new Date("2026-08-24T00:00:00.000Z");

    // As retrieval leaves it: nothing from the Atmosphere mask.
    await store.upsertMany([
      {
        ...fullPlace(placeId),
        reviewSnippets: null,
        editorialSummary: undefined,
        reviewSummary: undefined,
        servesVegetarianFood: undefined,
        shortlistHydratedAt: null,
      },
    ]);

    const [written] = await store.updateShortlistHydration([
      {
        placeId,
        reviewSnippets: [{ rating: 4, text: "Queue moves fast." }],
        editorialSummary: "A South Indian vegetarian chain.",
        reviewSummary: "Diners praise the dosas.",
        // The value most likely to be lost in a `?? null` / `|| null` slip.
        servesVegetarianFood: false,
        shortlistHydratedAt: hydratedAt,
      },
    ]);

    const [read] = await store.getMany([placeId]);
    expect(written).toEqual(read);
    expect(read.reviewSnippets).toEqual([{ rating: 4, text: "Queue moves fast." }]);
    expect(read.editorialSummary).toBe("A South Indian vegetarian chain.");
    expect(read.reviewSummary).toBe("Diners praise the dosas.");
    expect(read.servesVegetarianFood).toBe(false);
    expect(read.shortlistHydratedAt).toEqual(hydratedAt);
  });

  // The stated contract is that the in-memory and Postgres stores are
  // interchangeable, and the in-memory one lets an incoming value win.
  it("lets an upsert carrying hydration write it onto an unhydrated row", async () => {
    const store = createLocationStore(db);
    const placeId = `${RUN_TAG}-hydrate-upsert`;
    const hydratedAt = new Date("2026-08-24T00:00:00.000Z");

    await store.upsertMany([
      {
        ...fullPlace(placeId),
        editorialSummary: undefined,
        reviewSummary: undefined,
        servesVegetarianFood: undefined,
        shortlistHydratedAt: null,
      },
    ]);
    await store.upsertMany([
      {
        ...fullPlace(placeId),
        editorialSummary: "Written by an upsert.",
        servesVegetarianFood: true,
        shortlistHydratedAt: hydratedAt,
      },
    ]);

    const [read] = await store.getMany([placeId]);
    expect(read.editorialSummary).toBe("Written by an upsert.");
    expect(read.servesVegetarianFood).toBe(true);
    expect(read.shortlistHydratedAt).toEqual(hydratedAt);
  });

  it("does not let a refetch wipe shortlist hydration", async () => {
    const store = createLocationStore(db);
    const placeId = `${RUN_TAG}-hydrate-preserve`;
    const hydratedAt = new Date("2026-08-24T00:00:00.000Z");

    await store.upsertMany([{ ...fullPlace(placeId), shortlistHydratedAt: hydratedAt }]);
    await store.updateShortlistHydration([
      {
        placeId,
        reviewSnippets: [],
        servesVegetarianFood: false,
        shortlistHydratedAt: hydratedAt,
      },
    ]);

    // Retrieval refetches and, as always, knows none of the Atmosphere fields.
    await store.upsertMany([
      {
        ...fullPlace(placeId),
        name: "Refetched",
        reviewSnippets: null,
        editorialSummary: undefined,
        reviewSummary: undefined,
        servesVegetarianFood: undefined,
        shortlistHydratedAt: null,
      },
    ]);

    const [read] = await store.getMany([placeId]);
    expect(read.name).toBe("Refetched");
    expect(read.servesVegetarianFood).toBe(false);
    expect(read.shortlistHydratedAt).toEqual(hydratedAt);
  });

  it("keeps resolved photos when Google returns a different resource-name set", async () => {
    // Google hands back a fresh token for every photo on every search, so a
    // changed name set is the normal case and says nothing about the media.
    const store = createLocationStore(db);
    const placeId = `${RUN_TAG}-photo-version`;
    const resolvedAt = new Date("2026-08-01T00:00:00.000Z");
    const original = {
      ...fullPlace(placeId),
      photoUrls: ["https://example.test/old.jpg"],
      photosResolvedAt: resolvedAt,
    };

    await store.upsertMany([original]);
    const [merged] = await store.upsertMany([
      {
        ...fullPlace(placeId),
        photoNames: ["places/abc/photos/new"],
      },
    ]);

    expect(merged.photoNames).toEqual(["places/abc/photos/new"]);
    expect(merged.photoUrls).toEqual(["https://example.test/old.jpg"]);
    expect(merged.photosResolvedAt).toEqual(resolvedAt);
  });

  it("applies a photo write whose resource-name set no longer matches the row", async () => {
    const store = createLocationStore(db);
    const placeId = `${RUN_TAG}-stale-photo-write`;
    const oldNames = ["places/abc/photos/old"];
    const newNames = ["places/abc/photos/new"];
    const resolvedAt = new Date("2026-08-01T00:00:00.000Z");

    await store.upsertMany([{ ...fullPlace(placeId), photoNames: oldNames }]);
    await store.upsertMany([{ ...fullPlace(placeId), photoNames: newNames }]);
    await store.updatePhotoResolution([
      {
        placeId,
        photoNames: oldNames,
        photoUrls: ["https://example.test/resolved.jpg"],
        photosResolvedAt: resolvedAt,
      },
    ]);

    const [read] = await store.getMany([placeId]);
    expect(read.photoNames).toEqual(newNames);
    expect(read.photoUrls).toEqual(["https://example.test/resolved.jpg"]);
    expect(read.photosResolvedAt).toEqual(resolvedAt);
  });

  it("defaults place_search_cache.expires_at to +30 days", async () => {
    const queryHash = `${RUN_TAG}-ttl`;
    await db
      .insert(place_search_cache)
      .values({ query_hash: queryHash, place_ids: ["abc"] })
      .onConflictDoNothing();

    const [row] = await db
      .select()
      .from(place_search_cache)
      .where(eq(place_search_cache.query_hash, queryHash));

    const days = (row.expires_at.getTime() - row.created_at.getTime()) / 86_400_000;
    expect(days).toBeCloseTo(30, 3);
  });

  it("upserts a cache entry rather than colliding on the primary key", async () => {
    const cache = createSearchCache(db);
    const queryHash = `${RUN_TAG}-upsert`;
    const expiresAt = new Date("2026-12-01T00:00:00.000Z");

    await cache.put({ queryHash, placeIds: ["one"], expiresAt });
    await cache.put({ queryHash, placeIds: ["one", "two"], expiresAt });

    expect(await cache.get(queryHash)).toEqual({ placeIds: ["one", "two"], expiresAt });
  });
});

function fullPlace(placeId: string): RetrievedPlace {
  return {
    placeId,
    name: "Fushimi Inari Taisha",
    types: ["tourist_attraction", "place_of_worship"],
    primaryType: "tourist_attraction",
    latitude: 34.9671,
    longitude: 135.7727,
    rating: 4.6,
    userRatingCount: 12345,
    priceLevel: 0,
    businessStatus: "OPERATIONAL",
    stayDuration: undefined,
    openingPeriods: [{ open: { day: 0, hour: 0, minute: 0 } }],
    city: "Kyoto",
    formattedAddress: "68 Fukakusa Yabunouchicho, Fushimi Ward, Kyoto",
    priceRange: { startPrice: 0, endPrice: 500, currency: "JPY" },
    reviewSnippets: [{ rating: 5, text: "Go at dawn." }],
    editorialSummary: "A vermilion torii path up Mount Inari.",
    reviewSummary: "Visitors call the summit hike long but worth it.",
    servesVegetarianFood: undefined,
    shortlistHydratedAt: new Date("2026-08-23T01:00:00.000Z"),
    photoNames: ["places/abc/photos/def"],
    photoUrls: null,
    photosResolvedAt: null,
    fetchedAt: new Date("2026-08-23T00:00:00.000Z"),
  };
}
