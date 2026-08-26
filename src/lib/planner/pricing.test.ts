/**
 * Model spend — see `pricing.ts`.
 *
 * Two things here are decisions rather than arithmetic, and both are the kind
 * that produce a confident wrong number rather than an error:
 *
 * - `cached_tokens` is a **subset** of `input_tokens`. Adding them would bill
 *   the cached part twice and the total would still look plausible.
 * - A model with no rate on file costs **null**, not zero. A stage silently
 *   reporting $0.00 is worse than one reporting nothing, because somebody will
 *   believe the first.
 */

import { describe, expect, it } from "vitest";

import {
  BATCH_DISCOUNT,
  addUsage,
  costOf,
  emptyStageUsage,
  formatUsd,
  summarizeCost,
} from "./pricing";

const TERRA = "gpt-5.6-terra"; // $2.00 in / $0.20 cached / $12.00 out
const LUNA = "gpt-5.6-luna"; // $0.20 in / $0.02 cached / $1.20 out

describe("addUsage", () => {
  it("accumulates across calls and counts each one", () => {
    let tally = emptyStageUsage("narrate", LUNA);
    tally = addUsage(tally, { input_tokens: 100, output_tokens: 50 });
    tally = addUsage(tally, { input_tokens: 200, output_tokens: 60 });
    expect(tally).toMatchObject({
      stage: "narrate",
      calls: 2,
      inputTokens: 300,
      outputTokens: 110,
      cachedInputTokens: 0,
    });
  });

  it("counts a call that reported no usage at all", () => {
    // A response can arrive without a usage block. It was still made and still
    // billed; dropping it would make a flaky run look cheap.
    const tally = addUsage(emptyStageUsage("narrate", LUNA), undefined);
    expect(tally.calls).toBe(1);
    expect(tally.inputTokens).toBe(0);
  });

  it("treats cached tokens as part of the input, never as an extra", () => {
    const tally = addUsage(emptyStageUsage("narrate", LUNA), {
      input_tokens: 1000,
      output_tokens: 0,
      input_tokens_details: { cached_tokens: 900 },
    });
    expect(tally.inputTokens).toBe(1000);
    expect(tally.cachedInputTokens).toBe(900);
  });

  it("clamps a cached count that exceeds the input rather than going negative", () => {
    const tally = addUsage(emptyStageUsage("narrate", LUNA), {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 999 },
    });
    expect(tally.cachedInputTokens).toBe(100);
    expect(costOf(tally)).toBeGreaterThanOrEqual(0);
  });
});

describe("costOf", () => {
  it("bills the uncached remainder at full rate and the cached part at the discount", () => {
    const usage = {
      ...emptyStageUsage("assign", TERRA),
      calls: 1,
      inputTokens: 1_000_000,
      cachedInputTokens: 500_000,
      outputTokens: 1_000_000,
    };
    // 0.5M × $2 + 0.5M × $0.20 + 1M × $12 = $1.00 + $0.10 + $12.00
    expect(costOf(usage)).toBeCloseTo(13.1, 6);
  });

  it("halves a batch stage", () => {
    const usage = {
      ...emptyStageUsage("enrich", LUNA, true),
      calls: 1,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    };
    // ($0.20 + $1.20) × 50%
    expect(costOf(usage)).toBeCloseTo(1.4 * BATCH_DISCOUNT, 6);
  });

  it("returns null — not zero — for a model with no rate on file", () => {
    const usage = {
      ...emptyStageUsage("narrate", "gpt-5-nano"),
      calls: 1,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    };
    expect(costOf(usage)).toBeNull();
  });

  it("costs nothing for a stage that made no calls", () => {
    expect(costOf(emptyStageUsage("theme", TERRA))).toBe(0);
  });
});

describe("summarizeCost", () => {
  const priced = {
    ...emptyStageUsage("assign", TERRA),
    calls: 1,
    inputTokens: 1_000_000,
    outputTokens: 0,
  };
  const unpriced = {
    ...emptyStageUsage("narrate", "gpt-5-nano"),
    calls: 20,
    inputTokens: 1_000_000,
    outputTokens: 0,
  };

  it("adds the stages it can price", () => {
    expect(summarizeCost([priced]).usd).toBeCloseTo(2, 6);
    expect(summarizeCost([priced]).unpriced).toEqual([]);
  });

  it("names the models it could not price, so the total reads as a floor", () => {
    const summary = summarizeCost([priced, unpriced]);
    expect(summary.usd).toBeCloseTo(2, 6); // the nano stage contributed nothing
    expect(summary.unpriced).toEqual(["gpt-5-nano"]);
    expect(summary.stages.find((s) => s.stage === "narrate")?.usd).toBeNull();
  });

  it("keeps two stages sharing a model apart", () => {
    // Pass B and the theme call both run on `MODELS.assign`, and "the expensive
    // model cost $4" cannot say which of them spent it.
    const summary = summarizeCost([priced, { ...priced, stage: "theme" }]);
    expect(summary.stages.map((s) => s.stage)).toEqual(["assign", "theme"]);
  });
});

describe("formatUsd", () => {
  it("shows enough decimals that a cheap stage is not rounded to nothing", () => {
    expect(formatUsd(0.0123)).toBe("$0.0123");
    expect(formatUsd(0.00004)).toBe("<$0.0001");
    expect(formatUsd(0)).toBe("$0");
  });
});
