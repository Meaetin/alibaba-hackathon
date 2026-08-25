/**
 * `GET /api/itineraries/[id]` — what the itinerary page renders.
 *
 * The page is a client component and Neon is server-side only, so the read has
 * to cross a route. It returns `ItineraryDetail` exactly as
 * `readItineraryDetail` builds it: snake_case, no envelope, no rename layer,
 * for the same reason `GET /api/jobs/[id]` returns its row as Drizzle read it.
 *
 * An unknown id — or one that is not a uuid — is a **404**. A database that is
 * down is a **500**, which is a different thing: one means "this trip does not
 * exist", the other means "ask again later", and collapsing them would have the
 * page render "not found" during an outage.
 */

import { readItineraryDetail } from "@/lib/db/itinerary-detail";

import { itineraryRouteDeps } from "../../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_MESSAGE = "Itinerary not found";
const UNAVAILABLE_MESSAGE = "We couldn't load that itinerary. Please try again.";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;

  let itinerary;
  try {
    itinerary = await readItineraryDetail(itineraryRouteDeps.create().db, id);
  } catch (error) {
    console.error(`[GET /api/itineraries/${id}] could not read the itinerary`, error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }

  if (!itinerary) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  return Response.json(itinerary);
}
