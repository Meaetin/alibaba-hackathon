/**
 * Runs only when a real bucket is configured (`PHOTO_BLOB_*` in `.env.local`).
 *
 *   npm run test:blobs
 *
 * `createS3ObjectStore` is the one seam the offline tests can't reach: HeadObject's
 * 404 shape, path-style addressing, and whether the bucket is actually served
 * publicly are all things only a live bucket can answer. Everything above it —
 * the lookup/download/upload flow — is covered offline in `photo-blobs.test.ts`.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";

import {
  createPhotoBlobStore,
  createS3ObjectStore,
  publicUrlFrom,
  s3ClientFor,
  s3ConfigFromEnv,
  type BytesFetch,
  type S3BucketConfig,
} from "./photo-blobs";

const config = readConfig();

/** Every key this file writes carries it, so cleanup can't touch real objects. */
const RUN_TAG = "photos/itest-step11";
const BODY = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

describe.skipIf(!config)("s3 photo blob store", () => {
  const cfg = config as S3BucketConfig;
  const written: string[] = [];
  let objects: ReturnType<typeof createS3ObjectStore>;

  beforeAll(() => {
    objects = createS3ObjectStore(cfg);
  });

  afterAll(async () => {
    const client = s3ClientFor(cfg);
    await Promise.all(
      written.map((Key) => client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key }))),
    );
  });

  /** The riskiest line in the adapter: every S3-compatible service words its
   *  "missing key" error differently, and getting it wrong turns every lookup
   *  into a throw. */
  it("reports a missing key as a miss, not an error", async () => {
    await expect(objects.has(`${RUN_TAG}-does-not-exist.jpg`)).resolves.toBe(false);
  });

  it("stores an object and then finds it", async () => {
    const key = `${RUN_TAG}-roundtrip.jpg`;
    written.push(key);

    await objects.put(key, BODY, "image/jpeg");
    await expect(objects.has(key)).resolves.toBe(true);
  });

  /** The store persists `publicBaseUrl + key` into `locations.photo_urls` and an
   *  `<img src>` loads it weeks later with no credentials. If the bucket isn't
   *  public, every card silently 403s and nothing in the pipeline notices. */
  it("serves the stored bytes publicly, with the content type intact", async () => {
    const key = `${RUN_TAG}-public.jpg`;
    written.push(key);
    await objects.put(key, BODY, "image/jpeg");

    const response = await fetch(publicUrlFrom(cfg.publicBaseUrl)(key));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(BODY);
  });

  it("round-trips the whole flow: miss, download, store, hit", async () => {
    const sourceKey = `${RUN_TAG}-source.jpg`;
    const targetKey = `${RUN_TAG}-target.jpg`;
    written.push(sourceKey, targetKey);

    // Stand in for Google's CDN with an object we control, so the test needs no
    // billed call and no third-party uptime.
    await objects.put(sourceKey, BODY, "image/jpeg");
    const sourceUrl = publicUrlFrom(cfg.publicBaseUrl)(sourceKey);

    const blobs = createPhotoBlobStore({
      objects,
      publicUrl: publicUrlFrom(cfg.publicBaseUrl),
      fetch: globalThis.fetch as unknown as BytesFetch,
    });

    expect(await blobs.urlFor(targetKey)).toBeUndefined();
    const stored = await blobs.putFromUrl(targetKey, sourceUrl);
    expect(stored).toBe(publicUrlFrom(cfg.publicBaseUrl)(targetKey));
    expect(await blobs.urlFor(targetKey)).toBe(stored);
  });
});

function readConfig(): S3BucketConfig | undefined {
  try {
    return s3ConfigFromEnv();
  } catch {
    // Half-configured throws by design; skip rather than fail collection, since
    // `npm test` must stay green for anyone without a bucket.
    return undefined;
  }
}
