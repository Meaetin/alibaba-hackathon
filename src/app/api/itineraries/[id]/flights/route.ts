/**
 * `GET`/`POST /api/itineraries/[id]/flights` — the flights on one trip.
 *
 * These are the endpoints the itinerary page's Flight tab has always called.
 * Until now they pointed at `NEXT_PUBLIC_API_URL`, a REST backend this repo
 * does not contain, which is why nothing about a flight — booked, typed in, or
 * edited — has ever survived a reload.
 *
 * The ownership rule is in `access.ts` and the body parsing is in `parse.ts`,
 * both shared with `[flightId]/route.ts`. A database that is down is a **500**,
 * never the 404: collapsing them would have the tab render "no flights yet"
 * during an outage, and a traveller would add the same flight twice.
 */

import { flightRouteDeps } from "../../../deps";
import { refuseUnlessOwner } from "./access";
import { toFlightInput } from "./parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const READ_FAILED_MESSAGE = "We couldn't load the flights for this trip.";
const WRITE_FAILED_MESSAGE = "We couldn't save that flight. Please try again.";
const INVALID_MESSAGE = "A flight needs a departure date and an arrival date.";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const deps = flightRouteDeps.create();

  try {
    const refused = await refuseUnlessOwner(request, id, deps);
    if (refused) return refused;
    return Response.json(await deps.flights.listByItinerary(id));
  } catch (error) {
    console.error(`[GET /api/itineraries/${id}/flights] the flights could not be read`, error);
    return Response.json({ error: READ_FAILED_MESSAGE }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const deps = flightRouteDeps.create();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: INVALID_MESSAGE }, { status: 400 });
  }

  const input = toFlightInput(body);
  if (!input) return Response.json({ error: INVALID_MESSAGE }, { status: 400 });

  try {
    const refused = await refuseUnlessOwner(request, id, deps);
    if (refused) return refused;
    const flight = await deps.flights.create(id, input, deps.now());
    return Response.json(flight, { status: 201 });
  } catch (error) {
    console.error(`[POST /api/itineraries/${id}/flights] the flight could not be saved`, error);
    return Response.json({ error: WRITE_FAILED_MESSAGE }, { status: 500 });
  }
}
