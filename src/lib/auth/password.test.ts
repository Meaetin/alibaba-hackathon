import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("hashPassword", () => {
  it("produces a different string every time, for the same password", async () => {
    // The salt is what makes this true, and it is the whole reason two people
    // who pick the same password do not get the same row.
    const [a, b] = await Promise.all([hashPassword("correct horse"), hashPassword("correct horse")]);
    expect(a).not.toBe(b);
    expect(await verifyPassword("correct horse", a)).toBe(true);
    expect(await verifyPassword("correct horse", b)).toBe(true);
  });

  it("writes the cost parameters into the stored string", async () => {
    // Not decoration: `verifyPassword` reads them back, which is what lets the
    // cost be raised later without invalidating every existing password.
    const [scheme, n, r, p] = (await hashPassword("whatever")).split("$");
    expect(scheme).toBe("scrypt");
    expect(Number(n)).toBeGreaterThan(1);
    expect(Number(r)).toBeGreaterThan(0);
    expect(Number(p)).toBeGreaterThan(0);
  });

  it("never contains the password", async () => {
    expect(await hashPassword("hunter2")).not.toContain("hunter2");
  });
});

describe("verifyPassword", () => {
  it("rejects the wrong password", async () => {
    const stored = await hashPassword("correct horse");
    expect(await verifyPassword("correct horses", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
    expect(await verifyPassword("Correct Horse", stored)).toBe(false);
  });

  it("verifies a password at the far end of the byte range", async () => {
    // bcrypt truncates at 72 bytes and would pass this by accident; scrypt does
    // not, and the test says which behaviour is intended.
    const long = "e".repeat(80) + "TAIL";
    const stored = await hashPassword(long);
    expect(await verifyPassword(long, stored)).toBe(true);
    expect(await verifyPassword("e".repeat(80) + "TAIm", stored)).toBe(false);
  });

  it("normalises unicode, so the same typed password matches either encoding", async () => {
    // "é" composed vs decomposed. Two keyboards produce different bytes for a
    // password the person believes is one password.
    const composed = "cafépass";
    const decomposed = "cafépass";
    expect(composed).not.toBe(decomposed);
    expect(await verifyPassword(decomposed, await hashPassword(composed))).toBe(true);
  });

  it("returns false rather than throwing on a corrupt stored string", async () => {
    // A bad row must fail the login, not 500 the endpoint — which would tell an
    // outsider exactly which account has a bad row.
    for (const stored of [
      "",
      "not-a-hash",
      "scrypt$16384$8$1$onlyfivefields",
      "scrypt$16384$8$1$c2FsdA==$aGFzaA==$extra",
      "argon2$16384$8$1$c2FsdA==$aGFzaA==",
      "scrypt$0$8$1$c2FsdA==$aGFzaA==",
      "scrypt$abc$8$1$c2FsdA==$aGFzaA==",
      "scrypt$16384$8$1$$",
      // An `N` past the memory limit throws inside scrypt rather than
      // mismatching, and that is still "no", not a crash.
      "scrypt$1073741824$8$1$c2FsdA==$aGFzaA==",
    ]) {
      expect(await verifyPassword("anything", stored)).toBe(false);
    }
  });

  it("rejects a hash of the right shape but the wrong length", async () => {
    // `timingSafeEqual` throws on a length mismatch, so the guard in front of it
    // is load-bearing: without it this case is a 500 instead of a false.
    const stored = "scrypt$16384$8$1$c2FsdA==$" + Buffer.alloc(31).toString("base64");
    expect(await verifyPassword("anything", stored)).toBe(false);
  });
});
