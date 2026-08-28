/**
 * `POST /api/auth/logout`.
 *
 * Deletes the session row **and** clears the cookie. Both, deliberately:
 * clearing only the cookie leaves a live row that anyone holding a copy of the
 * token can still use, and deleting only the row leaves the browser looking
 * signed in until its next request comes back empty.
 *
 * It always answers 200. Signing out when you were not signed in is not an
 * error, and there is nothing useful for a caller to do differently.
 */

import { clearedSessionCookie, readSessionToken } from "@/lib/auth/session";

import { authRouteDeps } from "../../deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const token = readSessionToken(request);

  if (token) {
    try {
      await authRouteDeps.create().users.endSession(token);
    } catch (error) {
      // The cookie still gets cleared below. A failed delete leaves a row that
      // expires on its own; refusing to sign the person out would be worse.
      console.error("[POST /api/auth/logout] the session row could not be deleted", error);
    }
  }

  return Response.json(
    { ok: true },
    { status: 200, headers: { "Set-Cookie": clearedSessionCookie() } },
  );
}
