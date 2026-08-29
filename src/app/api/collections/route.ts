/**
 * `GET`/`POST /api/collections` — the traveller's shelves.
 *
 * The whole list, no cursor, the same call `GET /api/content` and
 * `readItineraryList` make: a person keeps tens of collections, not thousands.
 *
 * `GET` is empty for a signed-out caller rather than a 401, because the grid's
 * "no collections found" state is the right thing to show somebody who is not
 * signed in and an error toast on a page they can legitimately look at is not.
 * `POST` is a 401, because a write that quietly did nothing is the failure this
 * repo keeps writing down.
 */

import { z } from "zod";

import { collectionRouteDeps, userFor } from "../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAVAILABLE_MESSAGE = "We couldn't load your collections.";
const CREATE_FAILED_MESSAGE = "We couldn't create that collection.";
const BAD_REQUEST_MESSAGE = "That collection is missing a name.";
const SIGNED_OUT_MESSAGE = "Please sign in to create a collection.";

/** The coordinate is validated rather than passed through, the same rule
 *  `POST /api/plan` applies to `base`: it seeds the trip form's autocomplete,
 *  and a longitude of 3000 there puts a trip nowhere with nothing to say why. */
const CreateSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  country: z.string().trim().min(1).optional(),
  region: z.string().trim().min(1).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const deps = collectionRouteDeps.create();

  const user = await userFor(request, deps);
  if (!user) return Response.json([]);

  try {
    return Response.json(await deps.collections.listCollections(user.id));
  } catch (error) {
    console.error("[GET /api/collections] the list could not be read", error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }
}

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    // The technical detail stays in the log; the caller gets a sentence.
    console.error("[POST /api/collections] rejected request body", parsed.error.issues);
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const deps = collectionRouteDeps.create();
  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  try {
    const created = await deps.collections.createCollection(parsed.data, user.id, deps.now());
    return Response.json(created, { status: 201 });
  } catch (error) {
    console.error("[POST /api/collections] the collection could not be created", error);
    return Response.json({ error: CREATE_FAILED_MESSAGE }, { status: 500 });
  }
}
