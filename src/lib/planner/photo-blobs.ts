/**
 * The `PhotoBlobStore` implementation `photos.ts` has been waiting for.
 *
 * Deliberately S3-compatible rather than vendor-specific: Cloudflare R2, Neon
 * Object Storage, Supabase Storage and AWS S3 itself all speak the same three
 * calls, so which one is behind the bucket becomes an environment decision
 * instead of a code one. Neon Object Storage is the eventual home — it branches
 * with the database — but it is public beta and `us-east-2` only today, while
 * this project's database lives in `ap-southeast-1`. Nothing here has to change
 * when that lands.
 *
 * Two layers, split so the part with logic is testable with no network and no
 * SDK: `ObjectStore` is the bucket, `createPhotoBlobStore` is the
 * lookup-then-download-then-upload flow that sits on top of it.
 *
 * What this buys, in order of value:
 *   1. a photo is fetched from Google **once ever**, keyed by resource name, so
 *      the second itinerary featuring Kiyomizu-dera pays nothing;
 *   2. the stored URL stops expiring, so a saved itinerary reopened in a month
 *      still renders.
 */

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";

import type { PhotoBlobStore } from "./photos";

/** Fallback when the source doesn't say. Google's Places media is JPEG. */
const DEFAULT_CONTENT_TYPE = "image/jpeg";

/**
 * Just enough of a bucket. `has` and `put` are the only two operations the
 * photo flow performs, and keeping the surface this small is what lets the
 * flow above be tested against a Map.
 */
export interface ObjectStore {
  /** True when the object is already stored. A miss, not an error. */
  has(key: string): Promise<boolean>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

/**
 * Downloading an image needs bytes, and the pipeline's shared `FetchLike`
 * deliberately exposes only `text()` and `json()`. This is the same idea for a
 * different payload, kept local because this is its only consumer.
 */
export interface BytesResponse {
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface BytesFetch {
  (url: string): Promise<BytesResponse>;
}

export interface PhotoBlobStoreDeps {
  objects: ObjectStore;
  /** Object key → the URL a browser will load. See `publicUrlFrom`. */
  publicUrl(key: string): string;
  /** Injected so every test runs with zero network. */
  fetch?: BytesFetch;
}

/**
 * The flow, over any `ObjectStore`.
 *
 * `urlFor` reports a genuine miss as `undefined` and lets a real bucket failure
 * throw — `resolveOne` treats both as "go ask Google", so a broken bucket costs
 * money but never costs the user a photo.
 */
export function createPhotoBlobStore(deps: PhotoBlobStoreDeps): PhotoBlobStore {
  const doFetch = deps.fetch ?? (globalThis.fetch as unknown as BytesFetch);

  return {
    async urlFor(key) {
      return (await deps.objects.has(key)) ? deps.publicUrl(key) : undefined;
    },

    async putFromUrl(key, sourceUrl) {
      const response = await doFetch(sourceUrl);
      if (!response.ok) {
        throw new Error(`photo download ${response.status} for ${key}`);
      }
      const body = new Uint8Array(await response.arrayBuffer());
      if (body.byteLength === 0) {
        throw new Error(`photo download for ${key} returned no bytes`);
      }
      await deps.objects.put(key, body, response.headers.get("content-type") ?? DEFAULT_CONTENT_TYPE);
      return deps.publicUrl(key);
    },
  };
}

// ── the S3 adapter ───────────────────────────────────────────────────────────

export interface S3BucketConfig {
  bucket: string;
  /** R2 and Neon want `auto`; real S3 wants its region. */
  region: string;
  /** Omit for AWS S3 proper; set it for R2, Neon, MinIO, Supabase. */
  endpoint?: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Most S3-compatible services need path-style addressing. */
  forcePathStyle?: boolean;
  /** Where the bucket is served from, e.g. `https://images.example.com`. The
   *  bucket must be public — this store issues no signed URLs. */
  publicBaseUrl: string;
}

export function createS3ObjectStore(config: S3BucketConfig, client = s3ClientFor(config)): ObjectStore {
  return {
    async has(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
        return true;
      } catch (error) {
        if (isNotFound(error)) return false;
        throw error;
      }
    },

    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Immutable by construction: the key is a hash of the photo resource
          // name and the width, so the bytes behind it never change.
          CacheControl: "public, max-age=31536000, immutable",
        }),
      );
    },
  };
}

export function s3ClientFor(config: S3BucketConfig): S3Client {
  const options: S3ClientConfig = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      sessionToken: config.sessionToken,
    },
  };
  if (config.endpoint) {
    options.endpoint = config.endpoint;
    options.forcePathStyle = config.forcePathStyle ?? true;
  }
  return new S3Client(options);
}

/** `publicBaseUrl` + key, with exactly one slash between them. */
export function publicUrlFrom(publicBaseUrl: string): (key: string) => string {
  const base = publicBaseUrl.replace(/\/+$/, "");
  return (key) => `${base}/${key.replace(/^\/+/, "")}`;
}

/** The two layers wired together — what a route handler actually calls. */
export function createS3PhotoBlobStore(
  config: S3BucketConfig,
  fetchImpl?: BytesFetch,
): PhotoBlobStore {
  return createPhotoBlobStore({
    objects: createS3ObjectStore(config),
    publicUrl: publicUrlFrom(config.publicBaseUrl),
    fetch: fetchImpl,
  });
}

/**
 * Reads the bucket out of the environment, or returns undefined.
 *
 * Undefined is a supported state, not a failure: without a store the pipeline
 * stores Google's expiring `photoUri` and still produces a trip. A *partial*
 * configuration is different — that's a typo someone should hear about, so it
 * throws rather than silently degrading to the expensive path.
 */
export function s3ConfigFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
): S3BucketConfig | undefined {
  const bucket = env.PHOTO_BLOB_BUCKET;
  const publicBaseUrl = env.PHOTO_BLOB_PUBLIC_URL;
  const accessKeyId = env.PHOTO_BLOB_ACCESS_KEY_ID ?? env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.PHOTO_BLOB_SECRET_ACCESS_KEY ?? env.AWS_SECRET_ACCESS_KEY;

  const provided = [bucket, publicBaseUrl, accessKeyId, secretAccessKey].filter(Boolean).length;
  if (provided === 0) return undefined;
  if (provided < 4) {
    throw new Error(
      "Photo blob store is half-configured. Set all of PHOTO_BLOB_BUCKET, " +
        "PHOTO_BLOB_PUBLIC_URL and the access key pair, or none of them.",
    );
  }

  return {
    bucket: bucket!,
    publicBaseUrl: publicBaseUrl!,
    accessKeyId: accessKeyId!,
    secretAccessKey: secretAccessKey!,
    sessionToken: env.PHOTO_BLOB_SESSION_TOKEN ?? env.AWS_SESSION_TOKEN,
    region: env.PHOTO_BLOB_REGION ?? env.AWS_REGION ?? "auto",
    endpoint: env.PHOTO_BLOB_ENDPOINT ?? env.AWS_ENDPOINT_URL_S3,
  };
}

/** In-memory `ObjectStore` for tests and the offline path. */
export function createInMemoryObjectStore(seed?: Record<string, Uint8Array>): ObjectStore & {
  entries(): Map<string, { body: Uint8Array; contentType: string }>;
} {
  const objects = new Map<string, { body: Uint8Array; contentType: string }>(
    Object.entries(seed ?? {}).map(([key, body]) => [key, { body, contentType: DEFAULT_CONTENT_TYPE }]),
  );
  return {
    async has(key) {
      return objects.has(key);
    },
    async put(key, body, contentType) {
      objects.set(key, { body, contentType });
    },
    entries: () => objects,
  };
}

function isNotFound(error: unknown): boolean {
  const name = (error as { name?: string })?.name;
  const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
  return name === "NotFound" || name === "NoSuchKey" || status === 404;
}
