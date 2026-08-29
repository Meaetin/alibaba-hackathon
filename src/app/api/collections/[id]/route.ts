/**
 * `GET`/`PATCH`/`DELETE /api/collections/[id]` — one shelf.
 *
 * **Somebody else's collection is a 404, never a 403**, the same rule
 * `GET /api/content/[id]` and `GET /api/itineraries/[id]` keep: a 403 confirms
 * the id names a real thing, which is the one fact an outsider wants. The
 * ownership check lives inside the store's `where` clause rather than as a
 * comparison afterwards — a row read and then rejected is a row that was still
 * read.
 *
 * Deleting a collection removes its `collection_locations` rows by cascade and
 * touches `locations` not at all. Those are the shared Places cache, pointed at
 * by links and by itineraries; a delete that reached them would be one
 * traveller tidying up and another traveller's trip losing a restaurant.
 */

import { z } from "zod";

import { collectionRouteDeps, userFor } from "../../deps";
import { toCollectionDetailView } from "@/lib/db/collection-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_MESSAGE = "Collection not found";
const UNAVAILABLE_MESSAGE = "We couldn't load that collection.";
const UPDATE_FAILED_MESSAGE = "We couldn't update that collection.";
const DELETE_FAILED_MESSAGE = "We couldn't delete that collection.";
const BAD_REQUEST_MESSAGE = "That change isn't something we can save.";

/**
 * `.nullable()` on the five clearable fields is load-bearing, not decoration:
 * absent means unchanged and `null` means cleared, and a schema that accepted
 * only `undefined` would make "remove the region" unexpressible.
 */
const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    country: z.string().trim().min(1).nullable().optional(),
    region: z.string().trim().min(1).nullable().optional(),
    latitude: z.number().min(-90).max(90).nullable().optional(),
    longitude: z.number().min(-180).max(180).nullable().optional(),
    is_bookmarked: z.boolean().optional(),
    is_archived: z.boolean().optional(),
  })
  // An empty patch would move `updated_at` and reorder the grid over a write
  // the traveller did not make.
  .refine((patch) => Object.keys(patch).length > 0, { message: "no fields to update" });

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const deps = collectionRouteDeps.create();

  const user = await userFor(request, deps);
  // No session means no collection of yours, which is the same answer as no
  // collection.
  if (!user) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });

  try {
    const detail = await deps.collections.readCollection(id, user.id);
    if (!detail) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    return Response.json(toCollectionDetailView(detail));
  } catch (error) {
    // A database that is down is a 500 the client should retry, not a 404 that
    // tells it the collection is gone.
    console.error(`[GET /api/collections/${id}] the collection could not be read`, error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    console.error(`[PATCH /api/collections/${id}] rejected request body`, parsed.error.issues);
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const deps = collectionRouteDeps.create();
  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });

  try {
    const updated = await deps.collections.updateCollection(
      id,
      parsed.data,
      user.id,
      deps.now(),
    );
    if (!updated) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    return Response.json(updated);
  } catch (error) {
    console.error(`[PATCH /api/collections/${id}] the collection could not be updated`, error);
    return Response.json({ error: UPDATE_FAILED_MESSAGE }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const deps = collectionRouteDeps.create();

  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });

  try {
    const deleted = await deps.collections.deleteCollection(id, user.id);
    if (!deleted) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`[DELETE /api/collections/${id}] the collection could not be deleted`, error);
    return Response.json({ error: DELETE_FAILED_MESSAGE }, { status: 500 });
  }
}
