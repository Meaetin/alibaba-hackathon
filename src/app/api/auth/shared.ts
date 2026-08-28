/**
 * What sign-up and sign-in both need. Not a route — `shared.ts` is not one of
 * the filenames Next treats specially, so this is ordinary code that happens to
 * sit under `app/`, exactly as `../deps.ts` is.
 *
 * It exists because sign-up and sign-in differ in one step (create the account
 * versus check the password) and agree on the other four: read the body,
 * normalise the email, start a session, claim the browser's anonymous persona,
 * and answer with a cookie. Two copies of four steps is how the two paths end
 * up disagreeing about what a session is.
 */

import { z } from "zod";

import { createSessionToken, expiryFrom, hashToken, sessionCookie } from "@/lib/auth/session";
import type { UserRow } from "@/lib/db/users";

import type { AuthRouteDeps } from "../deps";

/**
 * Eight characters, and no composition rules. A rule that demands a digit and a
 * symbol reliably produces `Password1!` — length is the property that actually
 * costs an attacker anything.
 */
const MIN_PASSWORD_LENGTH = 8;

/** Above bcrypt's 72-byte truncation for no reason other than sanity; scrypt
 *  has no such limit, but an unbounded field is a free way to burn CPU. */
const MAX_PASSWORD_LENGTH = 200;

export const CredentialsSchema = z.object({
  email: z.string().trim().min(3).max(320).email(),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  displayName: z.string().trim().min(1).max(80).optional(),
  /**
   * The persona this browser took while signed out, if it has one. In the body
   * rather than read from a cookie for the same reason `POST /api/plan` takes
   * `personaId` in its body — one seam, and a handler that a test can drive
   * with a plain `Request`.
   */
  personaId: z.string().uuid().optional(),
});

export type Credentials = z.infer<typeof CredentialsSchema>;

/** Case and surrounding space are not part of an identity. Stored folded, so
 *  the unique index on `users.email` is doing what it looks like it does. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface PublicUser {
  id: string;
  email: string;
  display_name: string | null;
}

/** Never return the row. `password_hash` is on it. */
export function publicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, display_name: row.display_name };
}

/**
 * Starts a session for a user just authenticated, claims their anonymous
 * persona if they brought one, and builds the response that carries the cookie.
 *
 * **The persona claim cannot fail the sign-in.** Somebody who has just typed
 * their password correctly is signed in; losing a quiz result costs them
 * personalisation on the next plan, which is not worth an error screen. Same
 * rule `savePersona` already follows on the client.
 */
export async function signedInResponse(
  user: UserRow,
  personaId: string | undefined,
  deps: AuthRouteDeps,
): Promise<Response> {
  const now = deps.now();
  const token = createSessionToken();

  await deps.users.startSession({
    tokenHash: hashToken(token),
    userId: user.id,
    now,
    expiresAt: expiryFrom(now),
  });

  if (personaId) {
    try {
      const claimed = await deps.users.claimPersona({ personaId, userId: user.id, now });
      if (!claimed) {
        // Not an error: the usual reason is that this traveller already has a
        // persona, and the second usual reason is a stale id in localStorage.
        console.warn(`[auth] persona ${personaId} was not claimed for ${user.id}`);
      }
    } catch (error) {
      console.error(`[auth] persona ${personaId} could not be claimed`, error);
    }
  }

  return Response.json(
    { user: publicUser(user) },
    { status: 200, headers: { "Set-Cookie": sessionCookie(token) } },
  );
}
