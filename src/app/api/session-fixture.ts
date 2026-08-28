/**
 * A signed-in traveller, for the route handler tests.
 *
 * Not a route — same as `deps.ts`, this is ordinary code that happens to sit
 * under `app/`, because Next only treats specific filenames specially.
 *
 * It exists because **every** handler test now has to answer "who is asking",
 * and three suites building a user store, hashing a password and minting a
 * cookie by hand is three chances to build a session the real `userFor` would
 * reject. This uses the real `createInMemoryUserStore` and the real
 * `hashToken`, so a cookie from here is a cookie the production path accepts.
 */

import { createInMemoryUserStore, type UserRow, type UserStore } from "@/lib/db/users";
import { expiryFrom, hashToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";

export interface SignedIn {
  users: UserStore & ReturnType<typeof createInMemoryUserStore>;
  user: UserRow;
  /** A `Cookie` header naming a live session for `user`. */
  cookie: string;
  /** The raw token, for tests that sign out or tamper with it. */
  token: string;
}

const TOKEN = "test-session-token";

export async function signedIn(options?: {
  now?: Date;
  email?: string;
  token?: string;
}): Promise<SignedIn> {
  const now = options?.now ?? new Date("2026-08-28T00:00:00.000Z");
  const token = options?.token ?? TOKEN;
  const users = createInMemoryUserStore();

  const user = await users.create({
    email: options?.email ?? "traveller@example.com",
    display_name: "Traveller",
    // A real scrypt hash costs ~50ms and no test here checks a password; the
    // ones that do call `hashPassword` themselves.
    password_hash: "scrypt$16384$8$1$c2FsdA==$aGFzaA==",
    now,
  });
  if (!user) throw new Error("the fixture could not create its user");

  await users.startSession({
    tokenHash: hashToken(token),
    userId: user.id,
    now,
    expiresAt: expiryFrom(now),
  });

  return { users, user, cookie: `${SESSION_COOKIE_NAME}=${token}`, token };
}

/** A request carrying the fixture's session cookie. */
export function signedInRequest(url: string, cookie: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("cookie", cookie);
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return new Request(url, { ...init, headers });
}
