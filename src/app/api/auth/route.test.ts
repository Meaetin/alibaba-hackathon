/**
 * The four auth handlers, driven end to end against the in-memory user store.
 *
 * Same seam as every other route test here: `authRouteDeps.create` is
 * reassigned, so this runs the **real** handlers, the real password hashing and
 * the real cookie code with no database and no mocking framework.
 *
 * The two things worth being careful about, and the reason several of these
 * assertions look paranoid:
 *
 * - **A degradation must be observed at the counter, not at the output.** The
 *   persona claim cannot fail a sign-in, so "it signed me in" proves nothing
 *   about whether the claim ran. These tests read the store.
 * - **An assertion that passes with the rule deleted is not a test.** Each
 *   guard below has a case where the guard is the only thing standing between
 *   the assertion and the opposite answer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { hashPassword } from "@/lib/auth/password";
import { hashToken, SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { createInMemoryUserStore } from "@/lib/db/users";

import { authRouteDeps, userFor } from "../deps";
import { POST as login } from "./login/route";
import { POST as logout } from "./logout/route";
import { GET as me } from "./me/route";
import { POST as signup } from "./signup/route";

const NOW = new Date("2026-08-28T10:00:00.000Z");
const EMAIL = "traveller@example.com";
const PASSWORD = "a-good-password";
/** `personaId` is validated as a uuid on the wire, so the fixtures are real ones. */
const PERSONA_ID = "11111111-2222-4333-8444-555555555555";

const originalCreate = authRouteDeps.create;

let users: ReturnType<typeof createInMemoryUserStore>;

function install(now: Date = NOW) {
  users = createInMemoryUserStore();
  authRouteDeps.create = () => ({ users, now: () => now });
  return users;
}

function post(
  handler: (request: Request) => Promise<Response>,
  path: string,
  body?: unknown,
  cookie?: string,
): Promise<Response> {
  return handler(
    new Request(`http://localhost${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

/** The token out of a `Set-Cookie`, which is the only place it ever appears. */
function tokenFrom(response: Response): string {
  const header = response.headers.get("set-cookie");
  expect(header).toBeTruthy();
  const match = /argo_session=([^;]*)/.exec(header!);
  expect(match).toBeTruthy();
  return match![1];
}

beforeEach(() => {
  install();
});

afterEach(() => {
  authRouteDeps.create = originalCreate;
  vi.restoreAllMocks();
});

describe("POST /api/auth/signup", () => {
  it("creates an account and signs the person in", async () => {
    const response = await post(signup, "/api/auth/signup", {
      email: EMAIL,
      password: PASSWORD,
      displayName: "Traveller",
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { email: string; display_name: string } };
    expect(body.user.email).toBe(EMAIL);
    expect(body.user.display_name).toBe("Traveller");

    // Signing up signs you in; a second round trip to /login would be ceremony.
    const token = tokenFrom(response);
    expect(await users.userForToken(token, NOW)).toBeDefined();
  });

  it("never returns the password hash", async () => {
    const response = await post(signup, "/api/auth/signup", { email: EMAIL, password: PASSWORD });
    expect(JSON.stringify(await response.json())).not.toContain("scrypt");
  });

  it("stores the password hashed, and verifiably so", async () => {
    await post(signup, "/api/auth/signup", { email: EMAIL, password: PASSWORD });
    const row = await users.findByEmail(EMAIL);
    expect(row?.password_hash).toBeTruthy();
    expect(row?.password_hash).not.toContain(PASSWORD);
    expect(row?.password_hash.startsWith("scrypt$")).toBe(true);
  });

  it("folds the email, so case and space are not part of an identity", async () => {
    await post(signup, "/api/auth/signup", { email: "  Traveller@Example.COM ", password: PASSWORD });
    expect(await users.findByEmail(EMAIL)).toBeDefined();

    // And the folded form is what makes the duplicate check bite.
    const second = await post(signup, "/api/auth/signup", {
      email: "TRAVELLER@example.com",
      password: PASSWORD,
    });
    expect(second.status).toBe(409);
  });

  it("refuses a duplicate email with a sentence, not a stack trace", async () => {
    await post(signup, "/api/auth/signup", { email: EMAIL, password: PASSWORD });
    const response = await post(signup, "/api/auth/signup", { email: EMAIL, password: PASSWORD });

    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/already exists/i);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("refuses a short password", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post(signup, "/api/auth/signup", { email: EMAIL, password: "short" });

    expect(response.status).toBe(400);
    expect(users.rows.size).toBe(0);
    // The specific issues go to the terminal, never to the caller.
    expect(errors).toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toMatch(/too_small|zod/i);
  });

  it("refuses a body that is not JSON at all", async () => {
    const response = await signup(
      new Request("http://localhost/api/auth/signup", { method: "POST", body: "{" }),
    );
    expect(response.status).toBe(400);
  });

  describe("the first account claims the trips that have no owner", () => {
    it("claims them, and says how many in the log", async () => {
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
      users.ownerlessItineraries.push("trip-a", "trip-b");

      await post(signup, "/api/auth/signup", { email: EMAIL, password: PASSWORD });

      expect(users.ownerlessItineraries).toEqual([]);
      expect(warnings).toHaveBeenCalledWith(expect.stringContaining("claimed 2"));
    });

    it("is a one-shot rule: the second account claims nothing", async () => {
      users.ownerlessItineraries.push("trip-a");
      await post(signup, "/api/auth/signup", { email: EMAIL, password: PASSWORD });

      users.ownerlessItineraries.push("trip-c");
      await post(signup, "/api/auth/signup", { email: "second@example.com", password: PASSWORD });

      // Without the "only account there is" guard this reads `[]` and the
      // second traveller silently inherits somebody else's trip.
      expect(users.ownerlessItineraries).toEqual(["trip-c"]);
    });
  });

  describe("the browser's anonymous persona", () => {
    it("is claimed when it belongs to nobody", async () => {
      users.personaOwners.set(PERSONA_ID, null);

      await post(signup, "/api/auth/signup", {
        email: EMAIL,
        password: PASSWORD,
        personaId: PERSONA_ID,
      });

      const user = await users.findByEmail(EMAIL);
      expect(users.personaOwners.get(PERSONA_ID)).toBe(user!.id);
    });

    it("is left alone when it already has an owner", async () => {
      users.personaOwners.set(PERSONA_ID, "someone-else");
      const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});

      const response = await post(signup, "/api/auth/signup", {
        email: EMAIL,
        password: PASSWORD,
        personaId: PERSONA_ID,
      });

      expect(users.personaOwners.get(PERSONA_ID)).toBe("someone-else");
      // Not an error, but it is worth a line in the terminal.
      expect(warnings).toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it("cannot fail the sign-up, even when the claim throws", async () => {
      // Somebody who has just typed their details is signed in. Losing a quiz
      // result costs personalisation on the next plan, not the screen they are
      // looking at.
      const errors = vi.spyOn(console, "error").mockImplementation(() => {});
      authRouteDeps.create = () => ({
        users: {
          ...users,
          claimPersona: () => Promise.reject(new Error("column does not exist")),
        },
        now: () => NOW,
      });

      const response = await post(signup, "/api/auth/signup", {
        email: EMAIL,
        password: PASSWORD,
        personaId: PERSONA_ID,
      });

      expect(response.status).toBe(200);
      expect(tokenFrom(response)).toBeTruthy();
      expect(errors).toHaveBeenCalled();
    });
  });
});

describe("POST /api/auth/login", () => {
  async function existingAccount() {
    const user = await users.create({
      email: EMAIL,
      display_name: null,
      password_hash: await hashPassword(PASSWORD),
      now: NOW,
    });
    return user!;
  }

  it("signs in with the right password", async () => {
    const user = await existingAccount();
    const response = await post(login, "/api/auth/login", { email: EMAIL, password: PASSWORD });

    expect(response.status).toBe(200);
    expect((await users.userForToken(tokenFrom(response), NOW))?.id).toBe(user.id);
  });

  it("gives an unknown email and a wrong password the identical answer", async () => {
    await existingAccount();

    const wrongPassword = await post(login, "/api/auth/login", {
      email: EMAIL,
      password: "not-the-password",
    });
    const unknownEmail = await post(login, "/api/auth/login", {
      email: "nobody@example.com",
      password: PASSWORD,
    });

    // Telling these apart turns this endpoint into a way to ask whether an
    // address has an account here.
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
    expect(wrongPassword.headers.get("set-cookie")).toBeNull();
  });

  it("answers a too-short password with the same 401, not a 400", async () => {
    // A 400 would say "that is not even a valid password on this system", which
    // narrows the search for whoever is guessing.
    vi.spyOn(console, "error").mockImplementation(() => {});
    await existingAccount();
    const response = await post(login, "/api/auth/login", { email: EMAIL, password: "x" });
    expect(response.status).toBe(401);
  });

  it("signs in whatever the case of the typed email", async () => {
    await existingAccount();
    const response = await post(login, "/api/auth/login", {
      email: " TRAVELLER@Example.com ",
      password: PASSWORD,
    });
    expect(response.status).toBe(200);
  });

  it("claims the browser's anonymous persona on the way in", async () => {
    const user = await existingAccount();
    users.personaOwners.set(PERSONA_ID, null);

    await post(login, "/api/auth/login", {
      email: EMAIL,
      password: PASSWORD,
      personaId: PERSONA_ID,
    });

    expect(users.personaOwners.get(PERSONA_ID)).toBe(user.id);
  });

  it("turns a store failure into a sentence, not a stack trace", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    authRouteDeps.create = () => ({
      users: {
        ...users,
        findByEmail: () => Promise.reject(new Error('relation "users" does not exist')),
      },
      now: () => NOW,
    });

    const response = await post(login, "/api/auth/login", { email: EMAIL, password: PASSWORD });
    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: string };
    expect(body.error).not.toMatch(/relation/);
    expect(errors).toHaveBeenCalled();
  });
});

describe("GET /api/auth/me", () => {
  function get(cookie?: string): Promise<Response> {
    return me(
      new Request("http://localhost/api/auth/me", {
        headers: cookie ? { cookie } : {},
      }),
    );
  }

  it("answers 200 with a null user when nobody is signed in", async () => {
    // "Signed out" is the answer to this question, not a failure to answer it.
    // A 401 here would make the client catch an error to render a login form.
    const response = await get();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: null });
  });

  it("names the signed-in user", async () => {
    const signedUp = await post(signup, "/api/auth/signup", { email: EMAIL, password: PASSWORD });
    const response = await get(`${SESSION_COOKIE_NAME}=${tokenFrom(signedUp)}`);

    const body = (await response.json()) as { user: { email: string } };
    expect(body.user.email).toBe(EMAIL);
    expect(JSON.stringify(body)).not.toContain("scrypt");
  });

  it("treats an unknown token as signed out", async () => {
    const response = await get(`${SESSION_COOKIE_NAME}=made-up`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ user: null });
  });
});

describe("POST /api/auth/logout", () => {
  it("deletes the session row and clears the cookie", async () => {
    const signedUp = await post(signup, "/api/auth/signup", { email: EMAIL, password: PASSWORD });
    const token = tokenFrom(signedUp);

    const response = await post(logout, "/api/auth/logout", undefined, `${SESSION_COOKIE_NAME}=${token}`);

    expect(response.status).toBe(200);
    // Both halves matter: clearing only the cookie leaves a live row that a
    // copied token still opens.
    expect(users.sessions.has(hashToken(token))).toBe(false);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("is a 200 when nobody was signed in", async () => {
    const response = await post(logout, "/api/auth/logout");
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });

  it("still clears the cookie when the delete fails", async () => {
    // Refusing to sign somebody out because a delete failed leaves them stuck
    // on a page they are trying to leave.
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    authRouteDeps.create = () => ({
      users: { ...users, endSession: () => Promise.reject(new Error("connection lost")) },
      now: () => NOW,
    });

    const response = await post(logout, "/api/auth/logout", undefined, `${SESSION_COOKIE_NAME}=tok`);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(errors).toHaveBeenCalled();
  });
});

describe("userFor", () => {
  const request = (cookie?: string) =>
    new Request("http://localhost/api/anything", { headers: cookie ? { cookie } : {} });

  it("refuses an expired session", async () => {
    const signedUp = await post(signup, "/api/auth/signup", { email: EMAIL, password: PASSWORD });
    const cookie = `${SESSION_COOKIE_NAME}=${tokenFrom(signedUp)}`;

    expect(await userFor(request(cookie), { users, now: () => NOW })).not.toBeNull();

    // A day past the thirty-day TTL. Without the expiry check in the store this
    // still resolves and a session never ends.
    const later = new Date(NOW.getTime() + 31 * 24 * 60 * 60 * 1000);
    expect(await userFor(request(cookie), { users, now: () => later })).toBeNull();
  });

  it("returns null for no cookie, an unknown token and a store failure alike", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await userFor(request(), { users, now: () => NOW })).toBeNull();
    expect(
      await userFor(request(`${SESSION_COOKIE_NAME}=nope`), { users, now: () => NOW }),
    ).toBeNull();
    expect(
      await userFor(request(`${SESSION_COOKIE_NAME}=nope`), {
        users: { ...users, userForToken: () => Promise.reject(new Error("down")) },
        now: () => NOW,
      }),
    ).toBeNull();
    expect(errors).toHaveBeenCalled();
  });
});
