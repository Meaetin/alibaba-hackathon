/**
 * The Neon connection, created lazily.
 *
 * Lazily because most of the codebase is offline: the deterministic core, the
 * whole test suite and the in-memory retrieval path never touch Postgres, and a
 * module that throws at import time for a missing `DATABASE_URL` would take all
 * of them down with it.
 */

import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";

import * as schema from "./schema";

export type Database = ReturnType<typeof createDb>;

/** Explicit connection string — the form the integration tests use. */
export function createDb(connectionString: string): ReturnType<typeof drizzle<typeof schema>> {
  return drizzle(neon(connectionString), { schema });
}

let cached: Database | undefined;

/** Process-wide singleton over `DATABASE_URL`. Throws only when first called. */
export function getDb(): Database {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — cannot reach the planner database.");
  cached = createDb(url);
  return cached;
}
