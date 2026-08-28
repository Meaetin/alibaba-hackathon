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
 *
 * **Somebody else's trip is also a 404, never a 403.** A 403 confirms that the
 * id names a real itinerary, which is the one fact an outsider wants; a 404
 * says the same thing to them as an id that was never issued.
 *
 * An itinerary with **no** owner is nobody's, so it is a 404 too. Those are the
 * rows planned before this app had accounts, and the first sign-up claims them
 * (see `claimOwnerlessItineraries`). One left over after that is a leftover.
 */

import { readItineraryOwner } from "@/lib/db/itineraries";
import { readItineraryDetail } from "@/lib/db/itinerary-detail";

import { itineraryRouteDeps, userFor } from "../../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NOT_FOUND_MESSAGE = "Itinerary not found";
const UNAVAILABLE_MESSAGE = "We couldn't load that itinerary. Please try again.";
const SIGNED_OUT_MESSAGE = "Please sign in to view this itinerary.";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const deps = itineraryRouteDeps.create();

  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  let itinerary;
  try {
    const owner = await readItineraryOwner(deps.db, id);
    if (!owner || owner.userId !== user.id) {
      return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
    }
    itinerary = await readItineraryDetail(deps.db, id);
  } catch (error) {
    console.error(`[GET /api/itineraries/${id}] could not read the itinerary`, error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }

  if (!itinerary) return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  return Response.json(itinerary);
}
