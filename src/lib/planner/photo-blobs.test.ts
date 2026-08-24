import { describe, expect, it } from "vitest";

import {
  createInMemoryObjectStore,
  createPhotoBlobStore,
  publicUrlFrom,
  s3ConfigFromEnv,
  type BytesFetch,
  type BytesResponse,
  type ObjectStore,
} from "./photo-blobs";

const PUBLIC_BASE = "https://images.example.test";
const KEY = "photos/abc123-w800.jpg";

function bytesResponse(overrides: Partial<BytesResponse> = {}): BytesResponse {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "image/webp" },
    arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
    ...overrides,
  };
}

/** Records what it was asked for, so "zero downloads" is directly assertable. */
function countingFetch(response: BytesResponse = bytesResponse()) {
  const calls: string[] = [];
  const fetchImpl: BytesFetch = async (url) => {
    calls.push(url);
    return response;
  };
  return { fetchImpl, calls };
}

describe("publicUrlFrom", () => {
  it("joins base and key with exactly one slash", () => {
    expect(publicUrlFrom(PUBLIC_BASE)(KEY)).toBe(`${PUBLIC_BASE}/${KEY}`);
    expect(publicUrlFrom(`${PUBLIC_BASE}///`)(`///${KEY}`)).toBe(`${PUBLIC_BASE}/${KEY}`);
  });
});

describe("createPhotoBlobStore", () => {
  it("reports a stored object as a hit without downloading anything", async () => {
    const objects = createInMemoryObjectStore({ [KEY]: new Uint8Array([9]) });
    const { fetchImpl, calls } = countingFetch();
    const blobs = createPhotoBlobStore({
      objects,
      publicUrl: publicUrlFrom(PUBLIC_BASE),
      fetch: fetchImpl,
    });

    expect(await blobs.urlFor(KEY)).toBe(`${PUBLIC_BASE}/${KEY}`);
    expect(calls).toEqual([]);
  });

  it("reports an absent object as a miss", async () => {
    const blobs = createPhotoBlobStore({
      objects: createInMemoryObjectStore(),
      publicUrl: publicUrlFrom(PUBLIC_BASE),
      fetch: countingFetch().fetchImpl,
    });

    expect(await blobs.urlFor(KEY)).toBeUndefined();
  });

  it("downloads the source once, stores the bytes, and returns the public URL", async () => {
    const objects = createInMemoryObjectStore();
    const { fetchImpl, calls } = countingFetch();
    const blobs = createPhotoBlobStore({
      objects,
      publicUrl: publicUrlFrom(PUBLIC_BASE),
      fetch: fetchImpl,
    });

    const url = await blobs.putFromUrl(KEY, "https://google.test/photo.jpg");

    expect(url).toBe(`${PUBLIC_BASE}/${KEY}`);
    expect(calls).toEqual(["https://google.test/photo.jpg"]);
    expect(objects.entries().get(KEY)).toEqual({
      body: new Uint8Array([1, 2, 3, 4]),
      contentType: "image/webp",
    });
  });

  it("falls back to image/jpeg when the source doesn't say", async () => {
    const objects = createInMemoryObjectStore();
    const blobs = createPhotoBlobStore({
      objects,
      publicUrl: publicUrlFrom(PUBLIC_BASE),
      fetch: countingFetch(bytesResponse({ headers: { get: () => null } })).fetchImpl,
    });

    await blobs.putFromUrl(KEY, "https://google.test/photo.jpg");
    expect(objects.entries().get(KEY)?.contentType).toBe("image/jpeg");
  });

  /** `resolveOne` catches this and keeps Google's URL, so the stop still ships
   *  a photo. Storing a zero-byte object instead would poison the cache
   *  permanently — every later lookup would be a "hit" on a broken image. */
  it("refuses to store an empty or failed download", async () => {
    const objects = createInMemoryObjectStore();
    const make = (response: BytesResponse) =>
      createPhotoBlobStore({
        objects,
        publicUrl: publicUrlFrom(PUBLIC_BASE),
        fetch: countingFetch(response).fetchImpl,
      });

    await expect(
      make(bytesResponse({ ok: false, status: 403 })).putFromUrl(KEY, "https://google.test/p.jpg"),
    ).rejects.toThrow("403");
    await expect(
      make(bytesResponse({ arrayBuffer: async () => new ArrayBuffer(0) })).putFromUrl(
        KEY,
        "https://google.test/p.jpg",
      ),
    ).rejects.toThrow("no bytes");
    expect(objects.entries().size).toBe(0);
  });

  it("lets a real bucket failure surface — resolveOne turns it into a miss", async () => {
    const broken: ObjectStore = {
      async has() {
        throw new Error("bucket unreachable");
      },
      async put() {},
    };
    const blobs = createPhotoBlobStore({
      objects: broken,
      publicUrl: publicUrlFrom(PUBLIC_BASE),
      fetch: countingFetch().fetchImpl,
    });

    await expect(blobs.urlFor(KEY)).rejects.toThrow("bucket unreachable");
  });
});

describe("s3ConfigFromEnv", () => {
  const full = {
    PHOTO_BLOB_BUCKET: "argo-photos",
    PHOTO_BLOB_PUBLIC_URL: PUBLIC_BASE,
    PHOTO_BLOB_ACCESS_KEY_ID: "key",
    PHOTO_BLOB_SECRET_ACCESS_KEY: "secret",
  };

  /** No store is a supported state: the pipeline stores Google's expiring URL
   *  and still produces a trip. */
  it("returns undefined when nothing is configured", () => {
    expect(s3ConfigFromEnv({})).toBeUndefined();
  });

  it("throws when only some of it is set, rather than silently degrading", () => {
    expect(() => s3ConfigFromEnv({ PHOTO_BLOB_BUCKET: "argo-photos" })).toThrow("half-configured");
  });

  it("defaults region to auto — what R2 and Neon want", () => {
    expect(s3ConfigFromEnv(full)).toMatchObject({
      bucket: "argo-photos",
      publicBaseUrl: PUBLIC_BASE,
      region: "auto",
      endpoint: undefined,
    });
  });

  it("falls back to the standard AWS_* names, and PHOTO_BLOB_* wins", () => {
    expect(
      s3ConfigFromEnv({
        PHOTO_BLOB_BUCKET: "argo-photos",
        PHOTO_BLOB_PUBLIC_URL: PUBLIC_BASE,
        AWS_ACCESS_KEY_ID: "aws-key",
        AWS_SECRET_ACCESS_KEY: "aws-secret",
        AWS_REGION: "us-east-2",
        AWS_ENDPOINT_URL_S3: "https://s3.example.test",
      }),
    ).toMatchObject({
      accessKeyId: "aws-key",
      region: "us-east-2",
      endpoint: "https://s3.example.test",
    });

    expect(s3ConfigFromEnv({ ...full, AWS_ACCESS_KEY_ID: "ignored" })).toMatchObject({
      accessKeyId: "key",
    });
  });
});
