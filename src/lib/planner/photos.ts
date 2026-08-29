/**
 * Photo resolution — the second, billed half of the photo rule. See "Photos:
 * resolve late, never during retrieval" in `docs/personalization-pipeline.md`.
 *
 * Google splits a photo into two acts and only the second one costs:
 *
 *   1. the resource name (`places/ABC/photos/XYZ`) arrives free in retrieval's
 *      `places.photos` field mask, and is stored for every candidate;
 *   2. turning that name into an image bills the **Places Photos SKU, per
 *      fetch** — so it happens here, once, for the ~15 stops that survived,
 *      never for the ~1,000 that didn't.
 *
 * That asymmetry is the entire reason this module takes a *pool* and a
 * *survivor list* rather than a list of places to resolve. The expensive
 * mistake — handing it everything retrieval found — is not expressible in the
 * signature.
 *
 * Failure is deliberately cheap: a stop whose media fetch fails ships without a
 * photo and keeps `photosResolvedAt: null`, so a replan tries again. A stop with
 * no photo names at all is stamped without any fetch, because there is nothing
 * to retry.
 *
 * An optional `PhotoBlobStore` sits in front of Google. Without one the pipeline
 * stores Google's `photoUri` — free to serve, but it expires, which is a known
 * and accepted risk (see `docs/decisions.md`, 2026-08-23). With a store
 * configured, a photo is fetched at most once *ever*, keyed by the place and
 * shared across itineraries.
 */

import { createHash } from "node:crypto";

import { mapWithConcurrency, type FetchLike } from "./http";
import type { PackedDay } from "./pack";
import type { LocationStore, RetrievedPlace } from "./retrieval";

const PLACES_MEDIA_BASE = "https://places.googleapis.com/v1";

/** Card-sized. Google bills per fetch, not per pixel, so this is a quality
 *  knob rather than a cost one. */
const DEFAULT_MAX_WIDTH_PX = 800;

/**
 * One media fetch per stop. The budget in the design doc is "~15 media
 * fetches", and that number only holds if this stays at 1 — raising it
 * multiplies the only per-stop billed call in the pipeline.
 */
const DEFAULT_PHOTOS_PER_PLACE = 1;

const DEFAULT_CONCURRENCY = 4;

/**
 * The survivor list, derived from the finished timeline rather than assembled
 * by hand.
 *
 * This is the guard the signature alone can't give you. `resolvePhotos` already
 * makes "resolve the whole pool" inexpressible, but a caller could still pass
 * the funnel shortlist (~60) or a cluster's candidates — and half of any
 * cluster's places don't survive scheduling. Only `kind: "activity"` segments
 * of a packed, validated day are stops a user will actually see, so only those
 * are worth the Photos SKU. Call this, don't build the list yourself.
 */
export function survivorIdsFromDays(days: readonly PackedDay[]): string[] {
  const ids = days.flatMap((day) =>
    day.segments.flatMap((segment) => (segment.kind === "activity" ? [segment.placeId] : [])),
  );
  return [...new Set(ids)];
}

/**
 * Object key for a stored photo. Derived from the **place id**, so two
 * itineraries containing the same place share one object and only the first
 * one pays.
 *
 * It used to hash the Google resource name, on the belief that a name is stable
 * per photo. It is not — the same search run twice seconds apart returns a
 * different name for every photo of every place. So the key was new on every
 * run, the bucket never hit, and every plan re-bought and re-stored the same
 * image. Keying by place makes "billed once, ever" true for the first time.
 *
 * The trade is that this holds one photo per place. `DEFAULT_PHOTOS_PER_PLACE`
 * is 1 and raising it is the thing this module exists to discourage, so the
 * ordinal is folded in rather than left implicit — a second photo gets its own
 * object instead of overwriting the first.
 */
export function photoBlobKey(placeId: string, index: number, maxWidthPx: number): string {
  const digest = createHash("sha256").update(placeId).digest("hex").slice(0, 32);
  return `photos/${digest}-${index}-w${maxWidthPx}.jpg`;
}

/**
 * Durable storage for fetched image bytes. Optional — without it the pipeline
 * stores Google's `photoUri`, which is free to serve but **expires**, so a
 * saved itinerary reopened weeks later shows broken images and
 * `photos_resolved_at` being set means nothing retries.
 *
 * With it, a photo is fetched from Google at most once ever: the key is derived
 * from the place id, so the second itinerary featuring Kiyomizu-dera pays
 * nothing. That cross-itinerary reuse, not the durability, is where the money
 * is.
 */
export interface PhotoBlobStore {
  /** Public URL for an object we already hold, or undefined. */
  urlFor(key: string): Promise<string | undefined>;
  /** Downloads `sourceUrl` and stores it under `key`; returns the public URL. */
  putFromUrl(key: string, sourceUrl: string): Promise<string>;
}

/** Test double and offline path. Records what it was asked to store. */
export function createInMemoryPhotoBlobStore(seed?: Record<string, string>): PhotoBlobStore {
  const objects = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    async urlFor(key) {
      return objects.get(key);
    },
    async putFromUrl(key, sourceUrl) {
      const url = `memory://${key}`;
      objects.set(key, url);
      void sourceUrl;
      return url;
    },
  };
}

export interface PhotoDeps {
  apiKey: string;
  store: LocationStore;
  /** Injected so every test runs with zero network. */
  fetch?: FetchLike;
  /** Injected so `photosResolvedAt` is decidable. Never `new Date()` inside. */
  now?: Date;
  /** When present, photos are cached as bytes and Google is asked at most once
   *  per photo, ever — across every itinerary. */
  blobs?: PhotoBlobStore;
  maxWidthPx?: number;
  photosPerPlace?: number;
  concurrency?: number;
}

export interface PhotoFailure {
  placeId: string;
  message: string;
}

/**
 * Where every stop went. `billedCalls` is the number this module exists to keep
 * small; the rest of the counters explain any gap between it and `requested`.
 */
export interface PhotoStats {
  /** Candidates handed in. Nothing here is fetched for its own sake. */
  poolSize: number;
  /** Distinct survivors asked for. */
  requested: number;
  /** Survivor ids with no row in the pool — a caller bug, counted not thrown. */
  notInPool: number;
  /** Had `photoNames: []`. Stamped, zero fetches. */
  skippedNoNames: number;
  /** Already had `photosResolvedAt`. Skipped so a replan doesn't re-bill. */
  skippedAlreadyResolved: number;
  /** Media fetches Google answered. The Places Photos SKU count. A failed
   *  fetch is in `failures` instead. */
  billedCalls: number;
  /** Photos served from the blob store — the calls the cache avoided. Zero
   *  when no `blobs` store is configured. */
  blobHits: number;
  /** Stops that came away with at least one URL. */
  resolved: number;
  failures: PhotoFailure[];
}

export interface PhotoResult {
  /** The survivor rows, updated, in survivor order. */
  places: RetrievedPlace[];
  stats: PhotoStats;
}

/**
 * Resolves media URLs for `survivorIds` only, using `pool` purely as a lookup.
 *
 * Idempotent by design: a place that already carries `photosResolvedAt` for its
 * current resource-name set is left alone, so re-running a plan costs nothing.
 * Updated rows are patched through the same `LocationStore` port retrieval uses.
 */
export async function resolvePhotos(
  pool: readonly RetrievedPlace[],
  survivorIds: readonly string[],
  deps: PhotoDeps,
): Promise<PhotoResult> {
  const now = deps.now ?? new Date();
  const doFetch = deps.fetch ?? (globalThis.fetch as FetchLike);
  const maxWidthPx = deps.maxWidthPx ?? DEFAULT_MAX_WIDTH_PX;
  const photosPerPlace = deps.photosPerPlace ?? DEFAULT_PHOTOS_PER_PLACE;

  const byPlaceId = new Map(pool.map((place) => [place.placeId, place]));
  const wanted = [...new Set(survivorIds)];

  const stats: PhotoStats = {
    poolSize: pool.length,
    requested: wanted.length,
    notInPool: 0,
    skippedNoNames: 0,
    skippedAlreadyResolved: 0,
    billedCalls: 0,
    blobHits: 0,
    resolved: 0,
    failures: [],
  };

  const targets = wanted.flatMap((placeId) => {
    const place = byPlaceId.get(placeId);
    if (!place) {
      stats.notInPool += 1;
      return [];
    }
    return [place];
  });

  const outcomes = await mapWithConcurrency(
    targets,
    deps.concurrency ?? DEFAULT_CONCURRENCY,
    async (place): Promise<RetrievedPlace> => {
      if (place.photosResolvedAt !== null) {
        stats.skippedAlreadyResolved += 1;
        return place;
      }
      // Nothing to retry, so stamp it: "we looked, this place has no photos"
      // must stay distinguishable from "we never looked".
      if (place.photoNames.length === 0) {
        stats.skippedNoNames += 1;
        return { ...place, photoUrls: [], photosResolvedAt: now };
      }

      const names = place.photoNames.slice(0, photosPerPlace);
      const urls: string[] = [];
      for (const [index, name] of names.entries()) {
        try {
          urls.push(
            await resolveOne(name, {
              blobKey: photoBlobKey(place.placeId, index, maxWidthPx),
              doFetch,
              apiKey: deps.apiKey,
              maxWidthPx,
              blobs: deps.blobs,
              stats,
            }),
          );
        } catch (error) {
          // Not counted as billed: a 4xx generally isn't, and overstating the
          // Photos SKU is the same lie as understating it. Same rule as
          // `RetrievalStats.billedCalls`.
          stats.failures.push({ placeId: place.placeId, message: messageOf(error) });
        }
      }

      // A photo is decoration; the stop ships either way. Leaving the stamp
      // null on total failure is what lets a replan try again.
      if (urls.length === 0) return place;
      stats.resolved += 1;
      return { ...place, photoUrls: urls, photosResolvedAt: now };
    },
  );

  const changed = outcomes.filter((place, i) => place !== targets[i]);
  if (changed.length > 0) {
    await deps.store.updatePhotoResolution(
      changed.map((place) => ({
        placeId: place.placeId,
        photoNames: place.photoNames,
        photoUrls: place.photoUrls ?? [],
        photosResolvedAt: place.photosResolvedAt!,
      })),
    );
  }

  return { places: outcomes, stats };
}

/**
 * One photo, cheapest path first.
 *
 * The blob lookup comes before the media call on purpose: a bucket hit is the
 * difference between paying the Photos SKU once per *photo* and once per
 * *itinerary that shows it*. Without a blob store this collapses to the plain
 * Google path and stores an expiring `photoUri`.
 */
async function resolveOne(
  photoName: string,
  ctx: {
    /** Keyed by place, not by `photoName` — see `photoBlobKey`. */
    blobKey: string;
    doFetch: FetchLike;
    apiKey: string;
    maxWidthPx: number;
    blobs?: PhotoBlobStore;
    stats: PhotoStats;
  },
): Promise<string> {
  const key = ctx.blobKey;

  if (ctx.blobs) {
    // A lookup that throws is a bucket problem, not an itinerary problem — the
    // same rule the write below follows. Treat it as a miss and pay Google.
    const cached = await ctx.blobs.urlFor(key).catch(() => undefined);
    if (cached) {
      ctx.stats.blobHits += 1;
      return cached;
    }
  }

  const photoUri = await fetchMediaUri(photoName, ctx);
  ctx.stats.billedCalls += 1;
  if (!ctx.blobs) return photoUri;

  // A store that fails is a caching problem, not an itinerary problem — fall
  // back to the URL we already paid for rather than dropping the photo.
  try {
    return await ctx.blobs.putFromUrl(key, photoUri);
  } catch {
    return photoUri;
  }
}

/**
 * `skipHttpRedirect=true` makes the media endpoint answer with JSON carrying a
 * `photoUri` instead of 302-ing to the image.
 *
 * That matters for more than convenience: the alternative is persisting the
 * `/media` request URL itself, which would have to embed the API key to render
 * in an `<img src>`. `GOOGLE_PLACES_API_KEY` is a server key with no referrer
 * restriction — publishing it in page HTML would hand it to anyone who reads
 * the source, and every image render would re-bill the Photos SKU. The
 * `photoUri` we store carries no key and is served by Google's CDN.
 */
async function fetchMediaUri(
  photoName: string,
  ctx: { doFetch: FetchLike; apiKey: string; maxWidthPx: number },
): Promise<string> {
  const url =
    `${PLACES_MEDIA_BASE}/${photoName}/media` +
    `?maxWidthPx=${ctx.maxWidthPx}&skipHttpRedirect=true`;

  const response = await ctx.doFetch(url, {
    method: "GET",
    headers: { "X-Goog-Api-Key": ctx.apiKey },
  });

  if (!response.ok) {
    throw new Error(`Places Photos ${response.status}: ${await response.text()}`);
  }
  const data = (await response.json()) as { photoUri?: string };
  if (!data.photoUri) throw new Error(`Places Photos returned no photoUri for ${photoName}`);
  return data.photoUri;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
