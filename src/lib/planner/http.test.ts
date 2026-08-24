import { describe, expect, it } from "vitest";

import { mapWithConcurrency } from "./http";

/** Resolves when `release()` is called — no timers, so the test is not a race. */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

describe("mapWithConcurrency", () => {
  it("preserves input order regardless of completion order", async () => {
    const gates = [gate(), gate(), gate()];
    const running = mapWithConcurrency([0, 1, 2], 3, async (i) => {
      await gates[i].promise;
      return `item-${i}`;
    });

    // finish backwards
    gates[2].release();
    gates[1].release();
    gates[0].release();

    await expect(running).resolves.toEqual(["item-0", "item-1", "item-2"]);
  });

  it("never runs more than `limit` at once — the bound is a billing control", async () => {
    const gates = Array.from({ length: 6 }, gate);
    let inFlight = 0;
    let peak = 0;

    const running = mapWithConcurrency(gates, 2, async (g) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await g.promise;
      inFlight -= 1;
      return null;
    });

    for (const g of gates) {
      g.release();
      await Promise.resolve();
    }
    await running;

    expect(peak).toBe(2);
  });

  it("returns [] for no items without starting a worker", async () => {
    await expect(mapWithConcurrency([], 4, async () => "never")).resolves.toEqual([]);
  });
});
