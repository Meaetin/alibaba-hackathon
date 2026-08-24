import { describe, expect, it, vi } from "vitest";

import type { FetchLike } from "./http";
import type { PackedDay, TimelineSegment } from "./pack";
import {
  createInMemoryPhotoBlobStore,
  photoBlobKey,
  resolvePhotos,
  survivorIdsFromDays,
  type PhotoBlobStore,
} from "./photos";
import {
  createInMemoryObjectStore,
  createPhotoBlobStore,
  publicUrlFrom,
  type BytesFetch,
} from "./photo-blobs";
import { createInMemoryLocationStore, type RetrievedPlace } from "./retrieval";

const NOW = new Date("2026-08-23T09:00:00Z");
const API_KEY = "test-key";

// ── fixtures ─────────────────────────────────────────────────────────────────

/** A `locations` row as retrieval leaves it: names stored, media never fetched. */
function unresolved(placeId: string, photoCount = 3): RetrievedPlace {
  return {
    placeId,
    name: placeId,
    city: "Kyoto",
    types: ["tourist_attraction"],
    reviewSnippets: [],
    shortlistHydratedAt: null,
    photoNames: Array.from({ length: photoCount }, (_, i) => `places/${placeId}/photos/AeJb${i}`),
    photoUrls: null,
    photosResolvedAt: null,
    fetchedAt: new Date("2026-08-22T09:00:00Z"),
  };
}

/**
 * A fake media endpoint. `skipHttpRedirect=true` makes Google answer with JSON
 * carrying a `photoUri` rather than 302-ing to the image bytes.
 */
function fakeMediaFetch(failFor: readonly string[] = []) {
  return vi.fn<FetchLike>(async (url) => {
    const photoName = url.slice(`https://places.googleapis.com/v1/`.length, url.indexOf("/media"));
    if (failFor.some((id) => photoName.includes(id))) {
      return {
        ok: false,
        status: 500,
        async text() {
          return "INTERNAL";
        },
        async json() {
          return {};
        },
      };
    }
    return {
      ok: true,
      status: 200,
      async text() {
        return "";
      },
      async json() {
        return {
          name: `${photoName}/media`,
          photoUri: `https://lh3.googleusercontent.com/places/${photoName}`,
        };
      },
    };
  });
}

function urlsOf(fetchMock: ReturnType<typeof fakeMediaFetch>) {
  return fetchMock.mock.calls.map((call) => call[0]);
}

// ── the cost rule ────────────────────────────────────────────────────────────

describe("resolvePhotos cost", () => {
  it("bills 15 media fetches for 15 survivors out of a 1,000-place pool", async () => {
    const pool = Array.from({ length: 1000 }, (_, i) => unresolved(`p-${i}`));
    const survivors = pool.slice(0, 15).map((p) => p.placeId);
    const fetchMock = fakeMediaFetch();

    const result = await resolvePhotos(pool, survivors, {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(15);
    expect(result.stats.billedCalls).toBe(15);
    expect(result.stats.poolSize).toBe(1000);
    expect(result.places).toHaveLength(15);
  });

  it("fetches one photo per stop even when a place carries several names", async () => {
    const place = unresolved("a", 5);
    const fetchMock = fakeMediaFetch();

    const result = await resolvePhotos([place], ["a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.places[0].photoUrls).toHaveLength(1);
  });

  it("honours photosPerPlace when a caller asks for more, capped by names held", async () => {
    const fetchMock = fakeMediaFetch();
    const result = await resolvePhotos([unresolved("a", 2)], ["a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
      photosPerPlace: 4,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.places[0].photoUrls).toHaveLength(2);
  });

  it("bills a survivor listed twice only once", async () => {
    const fetchMock = fakeMediaFetch();
    const result = await resolvePhotos([unresolved("a")], ["a", "a", "a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.stats.requested).toBe(1);
  });

  it("does not re-bill a place that already has photos_resolved_at", async () => {
    const already: RetrievedPlace = {
      ...unresolved("a"),
      photoUrls: ["https://lh3.googleusercontent.com/places/a"],
      photosResolvedAt: new Date("2026-08-22T12:00:00Z"),
    };
    const fetchMock = fakeMediaFetch();

    const result = await resolvePhotos([already], ["a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(result.stats.skippedAlreadyResolved).toBe(1);
    expect(result.places[0]).toBe(already);
  });

  it("counts a survivor id missing from the pool instead of throwing", async () => {
    const fetchMock = fakeMediaFetch();
    const result = await resolvePhotos([unresolved("a")], ["a", "ghost"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.stats.notInPool).toBe(1);
    expect(result.places.map((p) => p.placeId)).toEqual(["a"]);
  });
});

// ── the stamp ────────────────────────────────────────────────────────────────

describe("photos_resolved_at", () => {
  it("is stamped with the injected now on success", async () => {
    const result = await resolvePhotos([unresolved("a")], ["a"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(),
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(result.places[0].photosResolvedAt).toEqual(NOW);
    expect(result.places[0].photoUrls).toEqual([
      "https://lh3.googleusercontent.com/places/places/a/photos/AeJb0",
    ]);
  });

  it("stamps a place with no photo names without fetching anything", async () => {
    const fetchMock = fakeMediaFetch();
    const result = await resolvePhotos([unresolved("a", 0)], ["a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(result.stats.skippedNoNames).toBe(1);
    expect(result.places[0].photoNames).toEqual([]);
    expect(result.places[0].photoUrls).toEqual([]);
    expect(result.places[0].photosResolvedAt).toEqual(NOW);
  });

  it("keeps 'has no photos' distinguishable from 'never attempted'", async () => {
    const noPhotos = unresolved("no-photos", 0);
    const notASurvivor = unresolved("not-a-survivor");

    const result = await resolvePhotos([noPhotos, notASurvivor], ["no-photos"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(),
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    // looked, found nothing: names empty AND stamped
    expect(result.places[0].photoNames).toEqual([]);
    expect(result.places[0].photosResolvedAt).toEqual(NOW);
    // never looked: stamp still null, so a replan knows to try
    expect(notASurvivor.photosResolvedAt).toBeNull();
  });
});

// ── failure ships the stop anyway ────────────────────────────────────────────

describe("failure handling", () => {
  it("does not fail the itinerary when a media fetch fails — the stop ships without a photo", async () => {
    const pool = [unresolved("good"), unresolved("broken")];
    const fetchMock = fakeMediaFetch(["broken"]);

    const result = await resolvePhotos(pool, ["good", "broken"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(result.places).toHaveLength(2);
    expect(result.places[0].photoUrls).toHaveLength(1);
    expect(result.places[1].photoUrls).toBeNull();
    expect(result.stats.failures).toEqual([
      { placeId: "broken", message: expect.stringContaining("500") },
    ]);
    expect(result.stats.resolved).toBe(1);
    expect(result.stats.billedCalls).toBe(1);
  });

  it("leaves photos_resolved_at null on failure, so a replan retries", async () => {
    const result = await resolvePhotos([unresolved("broken")], ["broken"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(["broken"]),
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(result.places[0].photosResolvedAt).toBeNull();
  });

  it("treats a 200 with no photoUri as a failure, not as a resolved stop", async () => {
    const fetchMock = vi.fn<FetchLike>(async () => ({
      ok: true,
      status: 200,
      async text() {
        return "";
      },
      async json() {
        return { name: "places/a/photos/AeJb0/media" };
      },
    }));

    const result = await resolvePhotos([unresolved("a")], ["a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(result.places[0].photosResolvedAt).toBeNull();
    expect(result.stats.failures).toHaveLength(1);
    expect(result.stats.resolved).toBe(0);
  });
});

// ── the request ──────────────────────────────────────────────────────────────

describe("the media request", () => {
  it("sends the key as a header and skipHttpRedirect, never a key in the URL", async () => {
    const fetchMock = fakeMediaFetch();
    await resolvePhotos([unresolved("a")], ["a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://places.googleapis.com/v1/places/a/photos/AeJb0/media?maxWidthPx=800&skipHttpRedirect=true",
    );
    expect(init.headers["X-Goog-Api-Key"]).toBe(API_KEY);
    expect(init.method).toBe("GET");
    // A key in the URL would be published in the page's <img src>.
    expect(url).not.toContain(API_KEY);
    expect(url).not.toContain("key=");
  });

  it("stores a CDN photoUri, not the billed /media endpoint", async () => {
    const result = await resolvePhotos([unresolved("a")], ["a"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(),
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(result.places[0].photoUrls?.[0]).not.toContain("/media");
  });

  it("honours maxWidthPx", async () => {
    const fetchMock = fakeMediaFetch();
    await resolvePhotos([unresolved("a")], ["a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
      maxWidthPx: 1600,
    });

    expect(urlsOf(fetchMock)[0]).toContain("maxWidthPx=1600");
  });
});

// ── persistence ──────────────────────────────────────────────────────────────

describe("write-back", () => {
  it("persists only the rows it changed", async () => {
    const store = createInMemoryLocationStore();
    const updatePhotoResolution = vi.spyOn(store, "updatePhotoResolution");
    const pool = [unresolved("good"), unresolved("broken"), unresolved("untouched")];

    await resolvePhotos(pool, ["good", "broken"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(["broken"]),
      store,
      now: NOW,
    });

    expect(updatePhotoResolution).toHaveBeenCalledTimes(1);
    expect(updatePhotoResolution.mock.calls[0][0].map((p) => p.placeId)).toEqual(["good"]);
  });

  it("does not touch the store when there is nothing to write", async () => {
    const store = createInMemoryLocationStore();
    const updatePhotoResolution = vi.spyOn(store, "updatePhotoResolution");

    await resolvePhotos([unresolved("broken")], ["broken"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(["broken"]),
      store,
      now: NOW,
    });

    expect(updatePhotoResolution).not.toHaveBeenCalled();
  });

  it("leaves the input rows untouched — updates are copies", async () => {
    const place = unresolved("a");
    await resolvePhotos([place], ["a"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(),
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(place.photoUrls).toBeNull();
    expect(place.photosResolvedAt).toBeNull();
  });
});

// ── the survivor list ────────────────────────────────────────────────────────

describe("survivorIdsFromDays", () => {
  function activity(placeId: string, position: number): TimelineSegment {
    return {
      kind: "activity",
      placeId,
      name: placeId,
      role: "activity",
      position,
      startMin: 540 + position * 60,
      endMin: 600 + position * 60,
    };
  }

  it("returns only the stops that made the timeline, not the candidates that didn't", () => {
    const day: PackedDay = {
      segments: [
        activity("kept-1", 1),
        { kind: "travel", mode: "walk", startMin: 600, endMin: 615, fromName: "a", toName: "b" },
        activity("kept-2", 2),
      ],
      dropped: [
        { placeId: "cut-1", name: "cut-1", reason: "day ran out of clock" },
        { placeId: "cut-2", name: "cut-2", reason: "closed during its slot" },
      ],
    };

    expect(survivorIdsFromDays([day])).toEqual(["kept-1", "kept-2"]);
  });

  it("ignores travel and break segments — they have no place to photograph", () => {
    const day: PackedDay = {
      segments: [
        { kind: "break", reason: "free", startMin: 540, endMin: 600 },
        activity("only-one", 1),
        { kind: "travel", mode: "transit", startMin: 660, endMin: 690, fromName: "a", toName: "b" },
      ],
      dropped: [],
    };

    expect(survivorIdsFromDays([day])).toEqual(["only-one"]);
  });

  it("dedupes a place that appears on two days, so it is billed once", () => {
    const day = (id: string): PackedDay => ({ segments: [activity(id, 1)], dropped: [] });
    expect(survivorIdsFromDays([day("shared"), day("shared")])).toEqual(["shared"]);
  });

  it("is the list resolvePhotos bills for — half a cluster's candidates cost nothing", async () => {
    // 15 candidates in one area; the packer keeps 6.
    const pool = Array.from({ length: 15 }, (_, i) => unresolved(`p-${i}`));
    const days: PackedDay[] = [
      {
        segments: pool.slice(0, 6).map((p, i) => activity(p.placeId, i + 1)),
        dropped: pool.slice(6).map((p) => ({
          placeId: p.placeId,
          name: p.name,
          reason: "not scheduled",
        })),
      },
    ];
    const fetchMock = fakeMediaFetch();

    const result = await resolvePhotos(pool, survivorIdsFromDays(days), {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(result.stats.billedCalls).toBe(6);
  });
});

// ── the blob cache ───────────────────────────────────────────────────────────

describe("photo blob store", () => {
  it("keys an object by the photo resource name, stably and per width", () => {
    const name = "places/ChIJabc/photos/AeJb1";
    expect(photoBlobKey(name, 800)).toBe(photoBlobKey(name, 800));
    expect(photoBlobKey(name, 800)).not.toBe(photoBlobKey(name, 1600));
    expect(photoBlobKey(name, 800)).not.toBe(photoBlobKey("places/ChIJxyz/photos/AeJb1", 800));
    expect(photoBlobKey(name, 800)).toMatch(/^photos\/[0-9a-f]{32}-w800\.jpg$/);
  });

  it("stores the bucket URL, not Google's expiring photoUri", async () => {
    const blobs = createInMemoryPhotoBlobStore();
    const result = await resolvePhotos([unresolved("a")], ["a"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(),
      store: createInMemoryLocationStore(),
      now: NOW,
      blobs,
    });

    expect(result.places[0].photoUrls?.[0]).toBe(
      `memory://${photoBlobKey("places/a/photos/AeJb0", 800)}`,
    );
    expect(result.places[0].photoUrls?.[0]).not.toContain("googleusercontent");
  });

  it("does not call Google at all for a photo already in the bucket", async () => {
    const key = photoBlobKey("places/a/photos/AeJb0", 800);
    const blobs = createInMemoryPhotoBlobStore({ [key]: "https://bucket.example/a.jpg" });
    const fetchMock = fakeMediaFetch();

    const result = await resolvePhotos([unresolved("a")], ["a"], {
      apiKey: API_KEY,
      fetch: fetchMock,
      store: createInMemoryLocationStore(),
      now: NOW,
      blobs,
    });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(result.stats.blobHits).toBe(1);
    expect(result.stats.billedCalls).toBe(0);
    expect(result.places[0].photoUrls).toEqual(["https://bucket.example/a.jpg"]);
  });

  it("bills a shared photo once across two itineraries, which is the point", async () => {
    const blobs = createInMemoryPhotoBlobStore();
    const deps = {
      apiKey: API_KEY,
      store: createInMemoryLocationStore(),
      now: NOW,
      blobs,
    };

    const first = await resolvePhotos([unresolved("kiyomizu")], ["kiyomizu"], {
      ...deps,
      fetch: fakeMediaFetch(),
    });
    // A second trip featuring the same place, with no row carried over.
    const secondFetch = fakeMediaFetch();
    const second = await resolvePhotos([unresolved("kiyomizu")], ["kiyomizu"], {
      ...deps,
      fetch: secondFetch,
    });

    expect(first.stats.billedCalls).toBe(1);
    expect(second.stats.billedCalls).toBe(0);
    expect(secondFetch).toHaveBeenCalledTimes(0);
    expect(second.stats.blobHits).toBe(1);
    expect(second.places[0].photoUrls).toEqual(first.places[0].photoUrls);
  });

  it("falls back to the paid photoUri when the bucket write fails", async () => {
    const blobs: PhotoBlobStore = {
      async urlFor() {
        return undefined;
      },
      async putFromUrl() {
        throw new Error("bucket unreachable");
      },
    };

    const result = await resolvePhotos([unresolved("a")], ["a"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(),
      store: createInMemoryLocationStore(),
      now: NOW,
      blobs,
    });

    // The call was already paid for; dropping the photo would waste it.
    expect(result.places[0].photoUrls).toEqual([
      "https://lh3.googleusercontent.com/places/places/a/photos/AeJb0",
    ]);
    expect(result.stats.resolved).toBe(1);
    expect(result.stats.failures).toEqual([]);
  });

  it("treats a failing bucket lookup as a miss rather than losing the photo", async () => {
    const blobs: PhotoBlobStore = {
      async urlFor() {
        throw new Error("bucket unreachable");
      },
      async putFromUrl(key) {
        return `https://bucket.example/${key}`;
      },
    };

    const result = await resolvePhotos([unresolved("a")], ["a"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(),
      store: createInMemoryLocationStore(),
      now: NOW,
      blobs,
    });

    // A caching problem must never become an itinerary problem — same rule the
    // write path follows. It costs a billed call, not a photo.
    expect(result.stats.blobHits).toBe(0);
    expect(result.stats.billedCalls).toBe(1);
    expect(result.stats.failures).toEqual([]);
    expect(result.places[0].photoUrls).toEqual(["https://bucket.example/" + photoBlobKey("places/a/photos/AeJb0", 800)]);
  });

  it("composes with the real S3-shaped store: one Google call per photo, ever", async () => {
    const objects = createInMemoryObjectStore();
    const downloads: string[] = [];
    const bytesFetch: BytesFetch = async (url) => {
      downloads.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => "image/jpeg" },
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      };
    };
    const blobs = createPhotoBlobStore({
      objects,
      publicUrl: publicUrlFrom("https://images.example.test"),
      fetch: bytesFetch,
    });

    const mediaFetch = fakeMediaFetch();
    const deps = {
      apiKey: API_KEY,
      fetch: mediaFetch,
      store: createInMemoryLocationStore(),
      now: NOW,
      blobs,
    };

    const first = await resolvePhotos([unresolved("a")], ["a"], deps);
    // A different itinerary, a different unresolved row, the same place.
    const second = await resolvePhotos([unresolved("a")], ["a"], deps);

    const key = photoBlobKey("places/a/photos/AeJb0", 800);
    expect(first.places[0].photoUrls).toEqual([`https://images.example.test/${key}`]);
    expect(second.places[0].photoUrls).toEqual(first.places[0].photoUrls);

    // This is the whole argument for the blob store: the second itinerary pays
    // Google nothing, and the URL it serves doesn't expire.
    expect(second.stats.blobHits).toBe(1);
    expect(second.stats.billedCalls).toBe(0);
    expect(mediaFetch).toHaveBeenCalledTimes(1);
    expect(downloads).toHaveLength(1);
    expect(objects.entries().size).toBe(1);
  });

  it("reports zero blob hits when no store is configured", async () => {
    const result = await resolvePhotos([unresolved("a")], ["a"], {
      apiKey: API_KEY,
      fetch: fakeMediaFetch(),
      store: createInMemoryLocationStore(),
      now: NOW,
    });

    expect(result.stats.blobHits).toBe(0);
  });
});
