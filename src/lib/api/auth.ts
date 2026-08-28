/**
 * The browser's half of authentication: four calls to `/api/auth/**`.
 *
 * Every one is a same-origin `fetch` with no `Authorization` header, because
 * the session is an httpOnly cookie the browser attaches on its own. That is
 * the point of the cookie — no token in JavaScript means no token for a script
 * on the page to read.
 *
 * `credentials: "same-origin"` is the default for same-origin requests and is
 * written out anyway: it is the one property that makes any of this work, and a
 * default nobody can see is a default somebody will "clean up".
 */

import { getFriendlyApiError } from "@/lib/errors/userMessages";

export interface CurrentUser {
  id: string;
  email: string;
  display_name: string | null;
}

/** Thrown by the four calls below so a form can render one plain sentence. */
export class AuthError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

async function readError(response: Response, fallback: string): Promise<AuthError> {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string") return new AuthError(body.error, response.status);
  } catch {
    // A non-JSON body is a proxy or a crash, not something to show anyone.
  }
  return new AuthError(fallback, response.status);
}

/**
 * The signed-in user, or `null`.
 *
 * A network failure returns `null` rather than throwing. "We could not reach
 * the server" and "you are signed out" look identical to everything downstream,
 * and treating the first as an error would put a red banner on a page whose
 * only correct response is to show the sign-in form.
 */
export async function fetchCurrentUser(): Promise<CurrentUser | null> {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin" });
    if (!response.ok) return null;
    const body = (await response.json()) as { user?: CurrentUser | null };
    return body.user ?? null;
  } catch (error) {
    console.error("[auth] the session could not be read", error);
    return null;
  }
}

export interface Credentials {
  email: string;
  password: string;
  displayName?: string;
  /** The persona this browser took before it had an account, if any. */
  personaId?: string;
}

async function post(path: string, body: unknown, fallback: string): Promise<CurrentUser> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (error) {
    console.error(`[auth] ${path} could not be reached`, error);
    throw new AuthError(getFriendlyApiError(error, fallback), 0);
  }

  if (!response.ok) throw await readError(response, fallback);

  const parsed = (await response.json()) as { user?: CurrentUser };
  if (!parsed.user) throw new AuthError(fallback, response.status);
  return parsed.user;
}

export function signUp(credentials: Credentials): Promise<CurrentUser> {
  return post("/api/auth/signup", credentials, "We couldn't create your account.");
}

export function signIn(credentials: Credentials): Promise<CurrentUser> {
  return post("/api/auth/login", credentials, "We couldn't sign you in.");
}

/**
 * Ends the session. Never throws: a sign-out that reports failure leaves
 * somebody stuck on a page they are trying to leave, and the cookie is cleared
 * by the response either way.
 */
export async function signOut(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } catch (error) {
    console.error("[auth] the sign-out request failed", error);
  }
}
