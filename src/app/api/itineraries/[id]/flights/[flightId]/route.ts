/**
 * `PATCH`/`DELETE /api/itineraries/[id]/flights/[flightId]` — one flight.
 *
 * Both narrow by the itinerary as well as by the flight id, so a flight id
 * guessed from one trip cannot be edited or deleted through another. That is
 * the store's `where` clause, not a comparison afterwards: a row read and then
 * rejected is a row that was still read.
 *
 * A flight that is not on this trip is a **404** with the same message as one
 * that does not exist, for the reason `access.ts` gives about the itinerary
 * itself — the distinction is the only fact an outsider is after.
 */

import { flightRouteDeps } from "../../../../deps";
import { refuseUnlessOwner } from "../access";
import { toFlightPatch } from "../parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_MESSAGE = "Flight not found";
const INVALID_MESSAGE = "That flight change couldn't be read.";
const UPDATE_FAILED_MESSAGE = "We couldn't update that flight. Please try again.";
const DELETE_FAILED_MESSAGE = "We couldn't remove that flight. Please try again.";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; flightId: string }> },
): Promise<Response> {
  const { id, flightId } = await context.params;
  const deps = flightRouteDeps.create();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: INVALID_MESSAGE }, { status: 400 });
  }

  const patch = toFlightPatch(body);
  if (!patch) return Response.json({ error: INVALID_MESSAGE }, { status: 400 });

  try {
    const refused = await refuseUnlessOwner(request, id, deps);
    if (refused) return refused;

    const flight = await deps.flights.update(id, flightId, patch, deps.now());
    if (!flight) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    return Response.json(flight);
  } catch (error) {
    console.error(
      `[PATCH /api/itineraries/${id}/flights/${flightId}] the flight could not be updated`,
      error,
    );
    return Response.json({ error: UPDATE_FAILED_MESSAGE }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; flightId: string }> },
): Promise<Response> {
  const { id, flightId } = await context.params;
  const deps = flightRouteDeps.create();

  try {
    const refused = await refuseUnlessOwner(request, id, deps);
    if (refused) return refused;

    const removed = await deps.flights.remove(id, flightId);
    if (!removed) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    // 204: there is no body to send, and `ensureOk` on the client is written
    // for exactly this — calling `res.json()` on it would throw.
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(
      `[DELETE /api/itineraries/${id}/flights/${flightId}] the flight could not be removed`,
      error,
    );
    return Response.json({ error: DELETE_FAILED_MESSAGE }, { status: 500 });
  }
}
