/**
 * `GET /api/itineraries` — the traveller's own trips, for the grid on
 * `/itineraries` and `/home`.
 *
 * This endpoint is new, and its absence is why those pages have looked empty.
 * `getItineraries()` in `src/lib/api/itineraries.ts` was still calling the old
 * REST backend on `:8080`, which is gone, so the query failed and the grid
 * rendered its empty state on a database full of trips.
 *
 * **Signed out is a 401 and not an empty list.** They are different answers:
 * one means "you have no trips", the other means "we don't know who you are",
 * and a page that renders the first for the second tells somebody their work is
 * gone. The client turns the 401 into a redirect.
 */

import { readItineraryList } from "@/lib/db/itinerary-list";

import { itineraryRouteDeps, userFor } from "../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SIGNED_OUT_MESSAGE = "Please sign in to see your itineraries.";
const UNAVAILABLE_MESSAGE = "We couldn't load your itineraries. Please try again.";

export async function GET(request: Request): Promise<Response> {
  const deps = itineraryRouteDeps.create();

  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  try {
    return Response.json(await readItineraryList(deps.db, user.id));
  } catch (error) {
    console.error("[GET /api/itineraries] could not read the list", error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }
}
