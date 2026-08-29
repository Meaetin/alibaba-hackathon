/**
 * The wiring both API routes hang off, and the one seam their tests override.
 *
 * It lives beside the routes rather than inside them because **a Next.js route
 * file may only export the handler and the known config fields** — `export const
 * planRouteDeps` in `plan/route.ts` fails the build with "is not a valid Route
 * export field". So the overridable factory moves one file across, the handlers
 * import it, and `route.test.ts` reassigns `create` to run the whole path
 * against fakes: no database, no Google, no OpenAI, no mocking framework.
 *
 * Nothing here is a route. `deps.ts` is not one of the filenames Next treats
 * specially, so this module is ordinary code that happens to sit under `app/`.
 */

import OpenAI from "openai";

import { createContentStore, type ContentStore } from "@/lib/db/content";
import { getDb, type Database } from "@/lib/db/client";
import { createPlanStore, type PlanStore } from "@/lib/db/itineraries";
import { createPersonaStore, type PersonaStore } from "@/lib/db/personas";
import { createUserStore, type UserRow, type UserStore } from "@/lib/db/users";
import { createEnrichmentStore, createLocationStore, createSearchCache } from "@/lib/db/stores";
import type { EnrichmentStore } from "@/lib/planner/enrich";
import type { FetchLike } from "@/lib/planner/http";
import { createWhisperTranscriber, type Transcriber } from "@/lib/links/audio";
import { createRapidApiMediaSource } from "@/lib/links/media";
import { analyzeLink } from "@/lib/links/pipeline";
import type { MediaSource } from "@/lib/links/media";
import { createResponsesClient, type ResponsesClient } from "@/lib/planner/openai";
import { createS3PhotoBlobStore, s3ConfigFromEnv } from "@/lib/planner/photo-blobs";
import type { PhotoBlobStore } from "@/lib/planner/photos";
import { runPlan } from "@/lib/planner/pipeline";
import { readSessionToken } from "@/lib/auth/session";
import type { LocationStore, SearchCache } from "@/lib/planner/retrieval";

export interface PlanRouteDeps {
  store: PlanStore;
  /** Resolves the session cookie into the traveller who owns the trip. */
  users: UserStore;
  /** Resolves `personaId` on the request body into the traveller's answers. */
  personas: PersonaStore;
  runPlan: typeof runPlan;
  /** Injected clocks and randomness. Nothing in the pipeline reads the ambient
   *  ones, and the handler must not reintroduce them. */
  now: () => Date;
  rng: () => number;
  googleApiKey: string;
  cache: SearchCache;
  locations: LocationStore;
  enrichments: EnrichmentStore;
  responses: ResponsesClient;
  fetch?: FetchLike;
  blobs?: PhotoBlobStore;
}

function defaultPlanRouteDeps(): PlanRouteDeps {
  const db = getDb();
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY is not set — the planner cannot run.");
  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleApiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set — the planner cannot run.");

  const blobConfig = s3ConfigFromEnv();
  const openai = new OpenAI({ apiKey: openaiKey });
  return {
    store: createPlanStore(db),
    users: createUserStore(db),
    personas: createPersonaStore(db),
    runPlan,
    now: () => new Date(),
    rng: Math.random,
    googleApiKey,
    cache: createSearchCache(db),
    locations: createLocationStore(db),
    enrichments: createEnrichmentStore(db),
    responses: createResponsesClient(openai),
    blobs: blobConfig ? createS3PhotoBlobStore(blobConfig) : undefined,
  };
}

/** `POST /api/plan`'s dependencies. Reassign `create` in a test; production
 *  never touches it. */
export const planRouteDeps: { create: () => PlanRouteDeps } = {
  create: defaultPlanRouteDeps,
};

/** `GET /api/itineraries/[id]`. It reads the database directly rather than
 *  through a port: `readItineraryDetail` is four selects with no decisions in
 *  them, so there is nothing a double could usefully stand in for. */
export const itineraryRouteDeps: {
  create: () => { db: Database; users: UserStore; now: () => Date };
} = {
  create: () => {
    const db = getDb();
    return { db, users: createUserStore(db), now: () => new Date() };
  },
};

/** `GET /api/jobs/[id]` needs one thing, so it asks for one thing. */
export const jobsRouteDeps: { create: () => { store: PlanStore } } = {
  create: () => ({ store: createPlanStore(getDb()) }),
};

/** `POST /api/persona`. Same shape and the same reason: one seam, no database
 *  in the handler test. The clock is injected here too — a stored `updated_at`
 *  is as reproducible as the plan it later feeds. */
export const personaRouteDeps: {
  create: () => { personas: PersonaStore; users: UserStore; now: () => Date };
} = {
  create: () => {
    const db = getDb();
    return { personas: createPersonaStore(db), users: createUserStore(db), now: () => new Date() };
  },
};

/**
 * `GET`/`PUT /api/preferences`. It needs the persona store as well as the user
 * store: the stored `profile` is **derived** from the picked ids *and* the
 * traveller's persona, and the server rebuilds it on every write so the two
 * cannot drift. Same rule `POST /api/plan` follows with `calculatePersona`.
 */
export const preferencesRouteDeps: {
  create: () => { users: UserStore; personas: PersonaStore; now: () => Date };
} = {
  create: () => {
    const db = getDb();
    return { users: createUserStore(db), personas: createPersonaStore(db), now: () => new Date() };
  },
};

/**
 * `POST /api/links/analyze`.
 *
 * It carries more than the other routes because the link pipeline reaches four
 * things a plan does not — yt-dlp, ffmpeg, Whisper and the local filesystem —
 * and every one of them is behind a parameter so `route.test.ts` can drive the
 * whole handler with none of them installed.
 *
 * `analyzeLink` is injected rather than imported by the handler for the same
 * reason `runPlan` is: importing it at the call site makes the handler
 * untestable without a mocking framework, and there isn't one in this repo.
 */
export interface LinkRouteDeps {
  store: PlanStore;
  users: UserStore;
  /** The library the finished analysis lands in. */
  content: ContentStore;
  analyzeLink: typeof analyzeLink;
  media: MediaSource;
  transcriber: Transcriber;
  responses: ResponsesClient;
  googleApiKey: string;
  cache: SearchCache;
  locations: LocationStore;
  fetch?: FetchLike;
  now: () => Date;
}

function defaultLinkRouteDeps(): LinkRouteDeps {
  const db = getDb();
  const openaiKey = process.env.OPENAI_API_KEY;
  if (!openaiKey) throw new Error("OPENAI_API_KEY is not set — link analysis cannot run.");
  const googleApiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!googleApiKey) throw new Error("GOOGLE_PLACES_API_KEY is not set — link analysis cannot run.");
  const rapidApiKey = process.env.RAPIDAPI_KEY;
  if (!rapidApiKey) throw new Error("RAPIDAPI_KEY is not set — link analysis cannot run.");

  const openai = new OpenAI({ apiKey: openaiKey });
  return {
    store: createPlanStore(db),
    users: createUserStore(db),
    content: createContentStore(db),
    analyzeLink,
    media: createRapidApiMediaSource({ apiKey: rapidApiKey }),
    transcriber: createWhisperTranscriber(openai),
    responses: createResponsesClient(openai),
    googleApiKey,
    cache: createSearchCache(db),
    locations: createLocationStore(db),
    now: () => new Date(),
  };
}

export const linkRouteDeps: { create: () => LinkRouteDeps } = {
  create: defaultLinkRouteDeps,
};

/**
 * `GET /api/content`, `GET`/`DELETE /api/content/[id]`.
 *
 * Lighter than `linkRouteDeps` because reading the library needs none of the
 * pipeline — no RapidAPI, no ffmpeg, no OpenAI, no Google. Just the rows and
 * the person asking for them.
 */
export const contentRouteDeps: {
  create: () => { content: ContentStore; users: UserStore; now: () => Date };
} = {
  create: () => {
    const db = getDb();
    return { content: createContentStore(db), users: createUserStore(db), now: () => new Date() };
  },
};

/**
 * `POST /api/auth/**`. The clock is injected like every other route's, because a
 * session's expiry has to be as reproducible in a test as a plan's timestamps.
 */
export interface AuthRouteDeps {
  users: UserStore;
  now: () => Date;
}

export const authRouteDeps: { create: () => AuthRouteDeps } = {
  create: () => ({ users: createUserStore(getDb()), now: () => new Date() }),
};

/**
 * The one place a request turns into a person.
 *
 * It takes the store rather than reaching for `getDb()` so that every handler
 * behind it stays drivable from a plain `Request` against fakes — the same seam
 * `planRouteDeps` is. It reads the cookie off the request header rather than
 * through `next/headers` for exactly that reason; see `src/lib/auth/session.ts`.
 *
 * Returns `null` for no cookie, an unknown token and an expired one alike.
 * Those are three ways of being signed out, and a handler that distinguished
 * them would be telling an anonymous caller which tokens once existed.
 */
export async function userFor(
  request: Request,
  deps: { users: UserStore; now: () => Date },
): Promise<UserRow | null> {
  const token = readSessionToken(request);
  if (!token) return null;
  try {
    return (await deps.users.userForToken(token, deps.now())) ?? null;
  } catch (error) {
    console.error("[auth] the session could not be read", error);
    return null;
  }
}
