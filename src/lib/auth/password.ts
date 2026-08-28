/**
 * Password hashing on Node's built-in `scrypt`. No dependency, no invented
 * cryptography — the only decisions here are the cost parameters and the
 * encoding, and both are stated in the stored string rather than in this file.
 *
 * ## The stored form carries its own parameters
 *
 * `scrypt$16384$8$1$<salt>$<hash>`, both halves base64. A bare digest would
 * make the cost parameters implicit in whatever this module happened to say on
 * the day, so raising `N` later would silently fail every existing password
 * with no error to read — the verify would simply return false and the user
 * would be told their password was wrong. Reading the cost back out of the row
 * means old hashes keep verifying and new ones get the new cost.
 *
 * ## What this does not do
 *
 * There is no rate limiting here and none anywhere else in this app. scrypt
 * makes one guess expensive; it does nothing about a machine making millions of
 * them against a login endpoint that answers as fast as it can.
 */

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/** CPU/memory cost. 16384 × 8 × 1 is roughly 16 MB and a few tens of ms. */
const N = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** scrypt refuses to allocate `N * r * 128` bytes unless told it may. */
const MEMORY_LIMIT = 64 * 1024 * 1024;

const PREFIX = "scrypt";

function derive(
  password: string,
  salt: Buffer,
  cost: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      KEY_BYTES,
      { N: cost.N, r: cost.r, p: cost.p, maxmem: MEMORY_LIMIT },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/**
 * Hashes a password for storage. Every call uses a fresh salt, so hashing the
 * same password twice gives two different strings — that is the point, and a
 * test asserts it rather than asserting a fixed digest.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, { N, r: BLOCK_SIZE, p: PARALLELISM });
  return [PREFIX, N, BLOCK_SIZE, PARALLELISM, salt.toString("base64"), key.toString("base64")].join(
    "$",
  );
}

/**
 * Checks a password against a stored hash.
 *
 * Returns `false` for a malformed or unknown-algorithm stored string rather
 * than throwing: a corrupt row must fail the login, not 500 the endpoint and
 * tell the world which account has a bad row.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6) return false;

  const [prefix, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (prefix !== PREFIX) return false;

  const cost = { N: Number(rawN), r: Number(rawR), p: Number(rawP) };
  if (!Number.isInteger(cost.N) || !Number.isInteger(cost.r) || !Number.isInteger(cost.p)) {
    return false;
  }
  if (cost.N <= 1 || cost.r <= 0 || cost.p <= 0) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(rawSalt, "base64");
    expected = Buffer.from(rawHash, "base64");
  } catch {
    return false;
  }
  if (salt.length === 0 || expected.length === 0) return false;

  let actual: Buffer;
  try {
    actual = await derive(password, salt, cost);
  } catch {
    // A stored `N` large enough to exceed `maxmem` throws. That is a bad row,
    // not a correct password.
    return false;
  }

  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // digest length through the difference between an exception and a `false`.

  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
