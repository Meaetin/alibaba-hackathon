/**
 * `POST /api/enrichments/collect`, the sweep.
 *
 * The handler itself is four lines of plumbing, so what is worth pinning is the
 * plumbing being right: the counters reach the caller unchanged, and a failure
 * comes back as a plain sentence with a 500 rather than an unhandled rejection.
 *
 * The counters matter more than they look. This whole queue failed silently for
 * a week because nothing swept it and nothing rendered a number — every trip
 * quietly shipped on the type heuristic in `duration.ts` and looked complete.
 * A sweep whose result is `{ pending: 6 }` and a sweep whose result is
 * `{ stored: 64 }` must not be indistinguishable at the call site.
 */

import { afterEach, describe, expect, it } from "vitest";

import { enrichmentCollectRouteDeps } from "../../deps";
import { POST } from "./route";

const originalCreate = enrichmentCollectRouteDeps.create;

afterEach(() => {
  enrichmentCollectRouteDeps.create = originalCreate;
});

const TOTALS = { checked: 6, pending: 3, terminal: 3, stored: 64, failed: 0, errored: 0 };

/** The four collaborators are never touched by the handler — it hands them
 *  straight to `collect` — so a marker object is a truthful stand-in. */
const collaborators = {
  batches: {} as never,
  queue: {} as never,
  enrichments: {} as never,
};

describe("POST /api/enrichments/collect", () => {
  it("returns the sweep's counters unchanged", async () => {
    enrichmentCollectRouteDeps.create = () => ({
      ...collaborators,
      collect: async () => TOTALS,
      now: () => new Date("2026-08-26T09:00:00.000Z"),
    });

    const response = await POST();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(TOTALS);
  });

  it("passes the injected clock through rather than reading the ambient one", async () => {
    const now = new Date("2026-08-26T09:00:00.000Z");
    let seen: Date | undefined;
    enrichmentCollectRouteDeps.create = () => ({
      ...collaborators,
      collect: async (deps) => {
        seen = deps.now;
        return TOTALS;
      },
      now: () => now,
    });

    await POST();

    expect(seen).toBe(now);
  });

  it("answers 500 with a plain sentence when the batch list cannot be read", async () => {
    enrichmentCollectRouteDeps.create = () => ({
      ...collaborators,
      collect: async () => {
        throw new Error("connection terminated");
      },
      now: () => new Date(),
    });

    const response = await POST();

    expect(response.status).toBe(500);
    const body = await response.json();
    // Never the driver's words — see `getFriendlyApiError`.
    expect(body.error).not.toMatch(/connection/i);
    expect(body.error).toMatch(/couldn't collect/i);
  });

  it("answers 500 when the dependencies cannot be built at all", async () => {
    // A missing OPENAI_API_KEY throws in `create`, before any sweep runs. That
    // must not escape the handler as an unhandled rejection.
    enrichmentCollectRouteDeps.create = () => {
      throw new Error("OPENAI_API_KEY is not set — batches cannot be collected.");
    };

    const response = await POST();

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/couldn't collect/i);
  });
});
