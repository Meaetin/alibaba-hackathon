import { describe, expect, it } from "vitest";

import {
  clearedSessionCookie,
  createSessionToken,
  expiryFrom,
  hashToken,
  readCookie,
  readSessionToken,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  sessionCookie,
} from "./session";

describe("createSessionToken", () => {
  it("is url-safe, so it survives a cookie value unescaped", () => {
    const token = createSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(token)).toBe(token);
  });

  it("takes its randomness as a parameter", () => {
    // Same rule as `rng` and `now` everywhere else here: a test that cannot fix
    // the token cannot assert on the cookie it ends up in.
    const token = createSessionToken(() => Buffer.alloc(32, 7));
    expect(token).toBe(Buffer.alloc(32, 7).toString("base64url"));
  });

  it("does not repeat", () => {
    const tokens = new Set(Array.from({ length: 100 }, () => createSessionToken()));
    expect(tokens.size).toBe(100);
  });
});

describe("hashToken", () => {
  it("does not contain the token", () => {
    // The point of storing the hash: a `sessions` row cannot be replayed as a
    // login, so a database dump is not a set of live sessions.
    const token = createSessionToken();
    const hash = hashToken(token);
    expect(hash).not.toContain(token);
    expect(hash).toHaveLength(64);
  });

  it("is stable, so a cookie looks the row up on every request", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
    expect(hashToken("abc")).not.toBe(hashToken("abd"));
  });
});

describe("expiryFrom", () => {
  it("adds the ttl to the clock it is given, not to the ambient one", () => {
    const now = new Date("2026-08-28T12:00:00.000Z");
    expect(expiryFrom(now).getTime()).toBe(now.getTime() + SESSION_TTL_MS);
    expect(expiryFrom(now, 1000)).toEqual(new Date("2026-08-28T12:00:01.000Z"));
  });
});

describe("readCookie", () => {
  it("finds a value among others, however the header is spaced", () => {
    expect(readCookie("a=1; argo_session=tok; b=2", SESSION_COOKIE_NAME)).toBe("tok");
    expect(readCookie("argo_session=tok", SESSION_COOKIE_NAME)).toBe("tok");
    expect(readCookie("  argo_session=tok  ;b=2", SESSION_COOKIE_NAME)).toBe("tok");
  });

  it("keeps a value containing '=', which base64 padding produces", () => {
    expect(readCookie("argo_session=a=b=", SESSION_COOKIE_NAME)).toBe("a=b=");
  });

  it("does not match a cookie whose name merely ends with the one asked for", () => {
    // `not_argo_session` contains `argo_session`; a substring check would return
    // the wrong value here and the bug would only show up with two cookies set.
    expect(readCookie("not_argo_session=other", SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("returns undefined for a missing or unreadable header", () => {
    expect(readCookie(null, SESSION_COOKIE_NAME)).toBeUndefined();
    expect(readCookie("", SESSION_COOKIE_NAME)).toBeUndefined();
    expect(readCookie("nonsense", SESSION_COOKIE_NAME)).toBeUndefined();
    expect(readCookie("=novalue", SESSION_COOKIE_NAME)).toBeUndefined();
  });

  it("survives a value that is not valid percent-encoding", () => {
    // `decodeURIComponent` throws on a lone '%'. An unreadable cookie is
    // "signed out", never a 500.
    expect(readCookie("argo_session=100%", SESSION_COOKIE_NAME)).toBe("100%");
  });
});

describe("readSessionToken", () => {
  it("reads the cookie off a plain Request", () => {
    const request = new Request("http://localhost/", {
      headers: { cookie: `${SESSION_COOKIE_NAME}=tok` },
    });
    expect(readSessionToken(request)).toBe("tok");
    expect(readSessionToken(new Request("http://localhost/"))).toBeUndefined();
  });
});

describe("sessionCookie", () => {
  it("is httpOnly and lax, so no script can read it and links still work", () => {
    const cookie = sessionCookie("tok", { secure: false });
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=tok`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
    expect(cookie).not.toContain("Secure");
  });

  it("adds Secure when asked", () => {
    expect(sessionCookie("tok", { secure: true })).toContain("Secure");
  });

  it("round-trips through readCookie", () => {
    // The two halves of this module have to agree, and they are written apart.
    const token = createSessionToken();
    const header = sessionCookie(token, { secure: false }).split(";")[0];
    expect(readCookie(header, SESSION_COOKIE_NAME)).toBe(token);
  });
});

describe("clearedSessionCookie", () => {
  it("expires the cookie at the same name and path", () => {
    // A different path would set a second cookie rather than delete the first,
    // and the browser would go on sending the original.
    const cleared = clearedSessionCookie({ secure: false });
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Path=/");
    expect(cleared).toContain(`${SESSION_COOKIE_NAME}=`);
  });
});
