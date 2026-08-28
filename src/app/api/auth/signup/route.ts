/**
 * `POST /api/auth/signup` — where an account comes from.
 *
 * Body `{ email, password, displayName?, personaId? }`, reply `{ user }` plus a
 * session cookie, so signing up signs you in. Requiring a second round trip to
 * `/login` right after would be ceremony with no security in it.
 *
 * ## The first account inherits the trips that have no owner
 *
 * This app planned itineraries for weeks before it had accounts, and those rows
 * have `user_id` null. The first person to sign up takes them, because on this
 * project they are that person's demo trips and the alternative is a list that
 * opens empty on a database full of work.
 *
 * It is a one-shot rule and it is enforced inside the SQL, not around it — see
 * `claimOwnerlessItineraries`. The second account claims nothing.
 */

import { hashPassword } from "@/lib/auth/password";

import { authRouteDeps } from "../../deps";
import { CredentialsSchema, normalizeEmail, signedInResponse } from "../shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BAD_REQUEST_MESSAGE =
  "Please enter an email address and a password of at least 8 characters.";
const TAKEN_MESSAGE = "An account already exists for that email. Try signing in instead.";
const FAILED_MESSAGE = "We couldn't create your account. Please try again.";

export async function POST(request: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const parsed = CredentialsSchema.safeParse(body);
  if (!parsed.success) {
    // The issues go to the terminal, never to the caller: "password too short"
    // is helpful, and the same channel would happily report which field of an
    // email probe was wrong.
    console.error("[POST /api/auth/signup] rejected request body", parsed.error.issues);
    return Response.json({ error: BAD_REQUEST_MESSAGE }, { status: 400 });
  }

  const deps = authRouteDeps.create();
  const email = normalizeEmail(parsed.data.email);

  try {
    const user = await deps.users.create({
      email,
      display_name: parsed.data.displayName ?? null,
      password_hash: await hashPassword(parsed.data.password),
      now: deps.now(),
    });

    // `undefined` is the unique index refusing a duplicate, which is the
    // race-proof version of asking first. It is not a failure.
    if (!user) return Response.json({ error: TAKEN_MESSAGE }, { status: 409 });

    const claimed = await deps.users.claimOwnerlessItineraries(user.id);
    if (claimed > 0) {
      console.warn(`[auth] first account ${user.id} claimed ${claimed} ownerless itineraries`);
    }

    return await signedInResponse(user, parsed.data.personaId, deps);
  } catch (error) {
    console.error("[POST /api/auth/signup] the account could not be created", error);
    return Response.json({ error: FAILED_MESSAGE }, { status: 500 });
  }
}
