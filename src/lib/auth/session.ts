/**
 * The session cookie: minting a token, hashing it for storage, and the two
 * string functions that put it on a response and read it off a request.
 *
 * ## Why the cookie is read from a header, not from `next/headers`
 *
 * Every route handler in this app is drivable from a plain `Request` in a test
 * — that is what `planRouteDeps` exists for, and why `personaId` travels in the
 * plan route's body rather than in a cookie. `cookies()` from `next/headers`
 * only resolves inside a Next request scope, so a handler that called it could
 * not be tested that way. Parsing `request.headers.get("cookie")` costs one
 * small function and keeps every handler a pure `Request → Response`.
 *
 * ## The token is never stored
 *
 * `hashToken` is what goes in the database. A `sessions` row cannot be replayed
 * as a login, so a leaked dump is not a set of live sessions. The browser holds
 * the only copy of the secret, which is also why there is no way to show
 * somebody their own token again.
 */

import { createHash, randomBytes } from "node:crypto";

import { SESSION_COOKIE_NAME } from "./cookie";

// Re-exported so Node-side callers have one import to remember. Middleware must
// take it from `cookie.ts` directly — this module needs `node:crypto`, and the
// Edge runtime middleware runs on has none.
export { SESSION_COOKIE_NAME };

/** Thirty days. Long for a demo, short enough that an abandoned laptop expires. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;

/**
 * A fresh session token. Randomness is a parameter for the same reason `rng`
 * and `now` are parameters everywhere else in this codebase: a test that cannot
 * fix the token cannot assert on the cookie.
 */
export function createSessionToken(random: (size: number) => Buffer = randomBytes): string {
  return random(TOKEN_BYTES).toString("base64url");
}

/** What the database stores. Never the token itself. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function expiryFrom(now: Date, ttlMs: number = SESSION_TTL_MS): Date {
  return new Date(now.getTime() + ttlMs);
}

/**
 * Reads one cookie out of a raw `Cookie` header.
 *
 * Deliberately tolerant of the shapes a real header takes — `a=1; b=2`, stray
 * spaces, a value containing `=` — and returns `undefined` for anything it
 * cannot find. An unreadable cookie is "signed out", never an error.
 */
export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    if (trimmed.slice(0, eq) !== name) continue;
    const value = trimmed.slice(eq + 1);
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return undefined;
}

export function readSessionToken(request: Request): string | undefined {
  return readCookie(request.headers.get("cookie"), SESSION_COOKIE_NAME);
}

interface CookieOptions {
  maxAgeSeconds: number;
  /** `secure` is off on localhost, where the demo runs, and on everywhere else. */
  secure: boolean;
}

function serialize(value: string, { maxAgeSeconds, secure }: CookieOptions): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    "Path=/",
    "HttpOnly",
    // `Lax` and not `Strict`: `Strict` withholds the cookie on the first
    // navigation in from anywhere, so following a link to your own itinerary
    // would land you on the login page and then work on refresh.
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** `Set-Cookie` value that starts a session. */
export function sessionCookie(token: string, options?: Partial<CookieOptions>): string {
  return serialize(token, {
    maxAgeSeconds: options?.maxAgeSeconds ?? Math.floor(SESSION_TTL_MS / 1000),
    secure: options?.secure ?? process.env.NODE_ENV === "production",
  });
}

/**
 * `Set-Cookie` value that ends one. `Max-Age=0` with the same name and path is
 * how a cookie is deleted; an omitted `Set-Cookie` leaves the browser holding a
 * token whose row we just deleted, which reads as signed in until the next
 * request comes back empty.
 */
export function clearedSessionCookie(options?: Partial<CookieOptions>): string {
  return serialize("", {
    maxAgeSeconds: 0,
    secure: options?.secure ?? process.env.NODE_ENV === "production",
  });
}
