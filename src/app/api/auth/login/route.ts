/**
 * `POST /api/auth/login`.
 *
 * Body `{ email, password, personaId? }`, reply `{ user }` plus a session
 * cookie.
 *
 * ## One message for both ways of being wrong
 *
 * An unknown email and a wrong password get the identical 401 and the identical
 * sentence. Telling them apart turns this endpoint into a way to ask whether an
 * address has an account here, which is a fact about somebody that we would be
 * handing to anyone who asks.
 *
 * The timing still tells them apart — a missing user skips the scrypt call and
 * answers faster. Closing that properly means hashing against a dummy on the
 * miss, which is worth doing if this ever leaves localhost and is deliberately
 * not done here; see `AGENTS.md` on the demo runtime.
 */

import { verifyPassword } from "@/lib/auth/password";

import { authRouteDeps } from "../../deps";
import { CredentialsSchema, normalizeEmail, signedInResponse } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BAD_REQUEST_MESSAGE = "Please enter your email address and password.";
const REJECTED_MESSAGE = "That email and password don't match an account.";
const FAILED_MESSAGE = "We couldn't sign you in. Please try again.";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  // `displayName` is ignored here; sharing the schema is worth more than a
  // second one that could drift on the password rules.
  const parsed = CredentialsSchema.safeParse(body);
  if (!parsed.success) {
    // A password below the minimum length cannot match any stored hash, so this
    // is the same answer as a wrong password and gets the same status — a 400
    // here would say "that is not even a valid password on this system", which
    // narrows the search for whoever is guessing.
    console.error("[POST /api/auth/login] rejected request body", parsed.error.issues);
    return Response.json({ error: REJECTED_MESSAGE }, { status: 401 });
  }

  const deps = authRouteDeps.create();

  try {
    const user = await deps.users.findByEmail(normalizeEmail(parsed.data.email));
    if (!user) return Response.json({ error: REJECTED_MESSAGE }, { status: 401 });

    const ok = await verifyPassword(parsed.data.password, user.password_hash);
    if (!ok) return Response.json({ error: REJECTED_MESSAGE }, { status: 401 });

    return await signedInResponse(user, parsed.data.personaId, deps);
  } catch (error) {
    console.error("[POST /api/auth/login] the sign-in could not be completed", error);
    return Response.json({ error: FAILED_MESSAGE }, { status: 500 });
  }
}
