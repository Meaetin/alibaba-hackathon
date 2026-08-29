/**
 * `GET`/`DELETE /api/content/[id]` — one analyzed link.
 *
 * **Somebody else's link is a 404, never a 403**, the same rule
 * `GET /api/itineraries/[id]` keeps: a 403 confirms the id names a real thing,
 * which is the one fact an outsider wants. The ownership check lives inside the
 * store's `where` clause rather than as a comparison afterwards — a row read
 * and then rejected is a row that was still read.
 *
 * Deleting a link removes its `content_locations` rows by cascade and touches
 * `locations` not at all. Those are the shared Places cache, pointed at by
 * other links and by itineraries; a delete that reached them would be one
 * traveller tidying up and another traveller's trip losing a restaurant.
 */

import { contentRouteDeps, userFor } from "../../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** On the allowlist in `getFriendlyApiError`, so it renders as-is. */
const NOT_FOUND_MESSAGE = "Location not found";
const UNAVAILABLE_MESSAGE = "We couldn't load that link.";
const DELETE_FAILED_MESSAGE = "We couldn't delete that link.";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const deps = contentRouteDeps.create();

  const user = await userFor(request, deps);
  // No session means no link of yours, which is the same answer as no link.
  if (!user) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });

  try {
    const detail = await deps.content.readContentDetail(id, user.id);
    if (!detail) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    return Response.json(detail);
  } catch (error) {
    // A database that is down is a 500 the client should retry, not a 404 that
    // tells it the link is gone.
    console.error(`[GET /api/content/${id}] the link could not be read`, error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const deps = contentRouteDeps.create();

  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });

  try {
    const deleted = await deps.content.deleteContent(id, user.id);
    if (!deleted) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`[DELETE /api/content/${id}] the link could not be deleted`, error);
    return Response.json({ error: DELETE_FAILED_MESSAGE }, { status: 500 });
  }
}
