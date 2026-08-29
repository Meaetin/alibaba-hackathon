/**
 * `POST /api/collections/[id]/locations` — put places on a shelf.
 *
 * This is the endpoint behind "add to collection" everywhere it appears: the
 * selection toolbar and the detail-view picker on `/links/[id]`, the same two
 * on `/collections/[id]`, and the picker on `/itineraries/[id]`. All of them
 * route through `useCollectionLocationBatchOperations`, and all of them send
 * `locations.id` — the shared Places cache row, which is why a place found in a
 * video and the same place scheduled in a trip are one row and one photo bill.
 *
 * **Adding a place twice is a success, not an error.** The unique
 * `(collection, location)` pair is what makes that true, and the response says
 * how many actually landed rather than how many were offered — a toast reading
 * "added 8" over a grid showing 6 is the kind of lie nobody reports.
 */

import { z } from "zod";

import { collectionRouteDeps, userFor } from "../../../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_MESSAGE = "Collection not found";
const BAD_REQUEST_MESSAGE = "We couldn't add these locations.";
const ADD_FAILED_MESSAGE = "We couldn't add these locations.";

/** A hundred is well past any selection a rubber band can draw and short of a
 *  request big enough to be worth worrying about. */
const MAX_LOCATIONS_PER_REQUEST = 100;

const AddSchema = z.object({
  location_ids: z.array(z.string().trim().min(1)).min(1).max(MAX_LOCATIONS_PER_REQUEST),
});

export async function POST(
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

  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) {
    console.error(
      `[POST /api/collections/${id}/locations] rejected request body`,
      parsed.error.issues,
    );
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const deps = collectionRouteDeps.create();
  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });

  try {
    const result = await deps.collections.addLocations(
      id,
      parsed.data.location_ids,
      user.id,
      deps.now(),
    );
    if (!result) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });

    // An id with no `locations` row is skipped, not invented — the same rule
    // `saveContent` applies. It is warned about here rather than swallowed,
    // because the only way it happens is a client holding a stale id.
    if (result.unknown > 0) {
      console.warn(
        `[POST /api/collections/${id}/locations] ${result.unknown} of ` +
          `${parsed.data.location_ids.length} ids have no location row and were skipped`,
      );
    }
    return Response.json(result);
  } catch (error) {
    console.error(
      `[POST /api/collections/${id}/locations] the locations could not be added`,
      error,
    );
    return Response.json({ error: ADD_FAILED_MESSAGE }, { status: 500 });
  }
}
