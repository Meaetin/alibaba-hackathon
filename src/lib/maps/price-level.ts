/**
 * Canonical price-level ordinal, shared by the browser map search and the
 * server-side planner retrieval.
 *
 * Google reports price level as a string in both transports, and the two
 * spellings differ: the Maps JS `Place` class yields `"MODERATE"` while the
 * Places REST API yields `"PRICE_LEVEL_MODERATE"`. Neither matches the 1–4
 * ordinal a `PreferenceProfile.budget` carries. Everything converts here so the
 * two paths can never drift.
 *
 * `priceRange` (a currency-denominated money range) is persisted alongside this
 * but is NOT used for filtering — it isn't comparable across cities.
 */

/** 0 = free, 4 = very expensive. Matches Google's own ordering. */
export type PriceLevelOrdinal = 0 | 1 | 2 | 3 | 4;

const ORDINAL_BY_NAME: Record<string, PriceLevelOrdinal> = {
  FREE: 0,
  INEXPENSIVE: 1,
  MODERATE: 2,
  EXPENSIVE: 3,
  VERY_EXPENSIVE: 4,
};

/**
 * Accepts either spelling (`"MODERATE"` or `"PRICE_LEVEL_MODERATE"`) and returns
 * undefined for `PRICE_LEVEL_UNSPECIFIED`, unknown values, and absent data —
 * "we don't know" must stay distinguishable from "it's free".
 */
export function toPriceLevelOrdinal(raw: unknown): PriceLevelOrdinal | undefined {
  if (typeof raw !== "string") return undefined;
  const name = raw.startsWith("PRICE_LEVEL_") ? raw.slice("PRICE_LEVEL_".length) : raw;
  return ORDINAL_BY_NAME[name];
}
