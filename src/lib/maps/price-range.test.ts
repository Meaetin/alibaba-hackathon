import { describe, expect, it } from "vitest";

import { toPriceRange } from "./price-range";

describe("toPriceRange", () => {
  it("flattens Google's nested money range", () => {
    expect(
      toPriceRange({
        startPrice: { currencyCode: "JPY", units: "1000" },
        endPrice: { currencyCode: "JPY", units: "2000" },
      }),
    ).toEqual({ startPrice: 1000, endPrice: 2000, currency: "JPY" });
  });

  /** Rows written by the browser path are already flat — re-normalizing one
   *  must not corrupt it, or a read-modify-write loses the price. */
  it("is idempotent on an already-flattened row", () => {
    const flat = { startPrice: 1000, endPrice: 2000, currency: "JPY" };
    expect(toPriceRange(flat)).toEqual(flat);
  });

  it("takes the currency from whichever end carries it", () => {
    expect(toPriceRange({ endPrice: { currencyCode: "VND", units: "100000" } })).toEqual({
      startPrice: undefined,
      endPrice: 100000,
      currency: "VND",
    });
  });

  it("keeps a currency-only range — the card renders it as a prefix", () => {
    expect(toPriceRange({ currency: "SGD" })).toEqual({
      startPrice: undefined,
      endPrice: undefined,
      currency: "SGD",
    });
  });

  it("returns undefined for absent, empty and unparseable input", () => {
    expect(toPriceRange(undefined)).toBeUndefined();
    expect(toPriceRange(null)).toBeUndefined();
    expect(toPriceRange({})).toBeUndefined();
    expect(toPriceRange("¥¥")).toBeUndefined();
    expect(toPriceRange({ startPrice: { units: "not-a-number" } })).toBeUndefined();
  });
});
