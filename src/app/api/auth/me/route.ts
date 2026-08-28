/**
 * `GET /api/auth/me` — who the cookie belongs to.
 *
 * **Answers 200 with `{ user: null }` when nobody is signed in**, rather than
 * 401. "Signed out" is the answer to this question, not a failure to answer it,
 * and the client hook behind it wants a value it can render, not an error it
 * has to catch. Every route that actually guards something returns the 401.
 */

import { authRouteDeps, userFor } from "../../deps";
import { publicUser } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const deps = authRouteDeps.create();
  const user = await userFor(request, deps);
  return Response.json({ user: user ? publicUser(user) : null }, { status: 200 });
}
