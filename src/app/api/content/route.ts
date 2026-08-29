/**
 * `GET /api/content` — the traveller's analyzed links.
 *
 * The whole list, no cursor. A person saves tens of links, not thousands, and
 * `usePaginatedContent` already reports `hasMore: false` rather than pretending
 * to a cursor the endpoint has no concept of. Same call `readItineraryList`
 * makes for the same reason.
 *
 * Empty for a signed-out caller rather than a 401: the grid's "no links yet"
 * state is the right thing to show somebody who is not signed in, and an error
 * toast on a page they can legitimately look at is not.
 */

import { contentRouteDeps, userFor } from "../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UNAVAILABLE_MESSAGE = "We couldn't load your links.";

export async function GET(request: Request): Promise<Response> {
  const deps = contentRouteDeps.create();

  const user = await userFor(request, deps);
  if (!user) return Response.json([]);

  try {
    return Response.json(await deps.content.listContent(user.id));
  } catch (error) {
    console.error("[GET /api/content] the list could not be read", error);
    return Response.json({ error: UNAVAILABLE_MESSAGE }, { status: 500 });
  }
}
