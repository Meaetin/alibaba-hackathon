/**
 * The ownership guard both flight routes run before touching a row.
 *
 * It lives beside the handlers for the same reason `parse.ts` does: a Next.js
 * route file may only export its handler, and the rule below must have exactly
 * one definition. Nothing here is a route.
 *
 * **Somebody else's trip is a 404, never a 403.** A 403 confirms that the id
 * names a real itinerary, which is the one fact an outsider wants; a 404 says
 * the same thing to them as an id that was never issued. An itinerary with a
 * null owner is nobody's, so it is a 404 too — those are the trips planned
 * before this app had accounts, and the first sign-up claims them.
 */

import { readItineraryOwner } from "@/lib/db/itineraries";
import type { Database } from "@/lib/db/client";
import type { UserStore } from "@/lib/db/users";

import { userFor } from "../../../deps";

const NOT_FOUND_MESSAGE = "Itinerary not found";
const SIGNED_OUT_MESSAGE = "Please sign in to view this itinerary.";

/**
 * Null when the caller owns the trip, and the `Response` to return when they do
 * not — so a handler spends one line on the check instead of four.
 *
 * It throws on a database failure rather than answering 404, and the handlers
 * catch it as a 500: "this trip is not yours" and "the database is down" are
 * different answers, and collapsing them would render an outage as a missing
 * trip.
 */
export async function refuseUnlessOwner(
  request: Request,
  itineraryId: string,
  deps: { db: Database; users: UserStore; now: () => Date },
): Promise<Response | null> {
  const user = await userFor(request, deps);
  if (!user) return Response.json({ error: SIGNED_OUT_MESSAGE }, { status: 401 });

  const owner = await readItineraryOwner(deps.db, itineraryId);
  if (!owner || owner.userId !== user.id) {
    return Response.json({ error: NOT_FOUND_MESSAGE }, { status: 404 });
  }
  return null;
}
