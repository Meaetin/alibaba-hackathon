/**
 * Canonical price range, shared by the browser map search, the server-side
 * planner retrieval and the detail cards. Sibling of `price-level.ts`, and it
 * exists for the same reason: two transports report the same fact in two
 * shapes, and `locations.price_range` is one column.
 *
 * Google returns a nested money range — `{ startPrice: { currencyCode, units } }`
 * — with `units` as a *string*. Storing that verbatim would make every reader
 * parse integers out of strings and re-derive the currency, so both write paths
 * flatten here first.
 *
 * Display only. It's currency-denominated and not comparable across cities,
 * which is why budget scoring reads `priceLevel` instead.
 */

export interface PriceRange {
  startPrice?: number;
  endPrice?: number;
  currency?: string;
}

/**
 * Accepts Google's nested shape from either transport, and is idempotent on an
 * already-flattened row. Returns undefined when there is no usable amount *and*
 * no currency — "we don't know" must stay distinguishable from "it's free".
 */
export function toPriceRange(raw: unknown): PriceRange | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const source = raw as Record<string, unknown>;

  const startPrice = toAmount(source.startPrice);
  const endPrice = toAmount(source.endPrice);
  const currency =
    (source.startPrice as { currencyCode?: string } | undefined)?.currencyCode ??
    (source.endPrice as { currencyCode?: string } | undefined)?.currencyCode ??
    (typeof source.currency === "string" ? source.currency : undefined);

  if (startPrice == null && endPrice == null && !currency) return undefined;
  return { startPrice, endPrice, currency };
}

function toAmount(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  const units = (value as { units?: unknown } | undefined)?.units;
  const parsed = typeof units === "string" ? Number.parseInt(units, 10) : units;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : undefined;
}
