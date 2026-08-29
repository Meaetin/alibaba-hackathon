/**
 * `DELETE /api/collections/[id]/locations/[locationId]` — take one place off a
 * shelf.
 *
 * It deletes the junction row and nothing else. `locations` is the shared
 * Places cache, so removing a restaurant from one traveller's collection must
 * not remove it from the three links and the itinerary that also point at it —
 * which is exactly why `collection_locations.location_id` carries no cascade.
 *
 * A 404 covers three different noes: no such collection, not yours, and the
 * place was never on it. The caller renders all three as "we couldn't remove
 * this location" and refetches, which is the right behaviour for every one.
 */

import { collectionRouteDeps, userFor } from "../../../../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_MESSAGE = "Location not found";
const DELETE_FAILED_MESSAGE = "We couldn't remove this location.";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; locationId: string }> },
): Promise<Response> {
  const { id, locationId } = await context.params;
  const deps = collectionRouteDeps.create();

  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });

  try {
    const removed = await deps.collections.removeLocation(id, locationId, user.id);
    if (!removed) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(
      `[DELETE /api/collections/${id}/locations/${locationId}] the location could not be removed`,
      error,
    );
    return Response.json({ error: DELETE_FAILED_MESSAGE }, { status: 500 });
  }
}
