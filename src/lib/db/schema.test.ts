import { describe, expect, expectTypeOf, it } from "vitest";
import type { InferSelectModel } from "drizzle-orm";

import { itinerary_activities, locations } from "./schema";
import { formatMinutes } from "./time";
import type { PriceRange } from "@/lib/maps/price-range";
import type { ReviewSnippet } from "@/lib/planner/retrieval";
import type { OpeningPeriod } from "@/lib/planner/types";

type LocationRow = InferSelectModel<typeof locations>;
type ActivityRow = InferSelectModel<typeof itinerary_activities>;

/**
 * These assertions exist because the columns they name are each the sole input
 * to something downstream, and dropping one degrades silently rather than
 * failing: `price_level` is budget scoring's only input, `review_snippets` is
 * the enrichment pass's only free text, `photo_names` is what keeps photo
 * resolution off the billed path.
 */
describe("locations row type", () => {
  it("carries the columns later stages depend on", () => {
    expectTypeOf<LocationRow>().toExtend<{
      place_id: string;
      price_level: number | null;
      photo_names: string[] | null;
      photos_resolved_at: Date | null;
      review_snippets: ReviewSnippet[] | null;
      stay_duration: number | null;
    }>();
  });

  it("types the jsonb columns rather than leaving them unknown", () => {
    expectTypeOf<LocationRow["types"]>().toEqualTypeOf<string[]>();
    expectTypeOf<LocationRow["opening_periods"]>().toEqualTypeOf<OpeningPeriod[] | null>();
    expectTypeOf<LocationRow["price_range"]>().toEqualTypeOf<PriceRange | null>();
  });

  it("keeps types non-nullable — an empty list is not the same as no answer", () => {
    expectTypeOf<LocationRow["types"]>().not.toBeNullable();
  });
});

describe("itinerary_activities row type", () => {
  /** Code owns the clock: minutes from midnight, never a timestamp. */
  it("exposes start_min / end_min as numbers, not Dates", () => {
    expectTypeOf<ActivityRow["start_min"]>().toEqualTypeOf<number>();
    expectTypeOf<ActivityRow["end_min"]>().toEqualTypeOf<number>();
  });
});

describe("formatMinutes", () => {
  it("formats minutes from midnight as HH:MM", () => {
    expect(formatMinutes(750)).toBe("12:30");
    expect(formatMinutes(0)).toBe("00:00");
    expect(formatMinutes(1439)).toBe("23:59");
  });

  it("zero-pads both halves", () => {
    expect(formatMinutes(9)).toBe("00:09");
    expect(formatMinutes(540)).toBe("09:00");
  });

  it("renders end-of-day as 24:00, not 00:00", () => {
    expect(formatMinutes(1440)).toBe("24:00");
  });

  it("throws on values that cannot be a time of day", () => {
    expect(() => formatMinutes(-1)).toThrow(RangeError);
    expect(() => formatMinutes(1441)).toThrow(RangeError);
    expect(() => formatMinutes(12.5)).toThrow(RangeError);
    expect(() => formatMinutes(Number.NaN)).toThrow(RangeError);
  });
});
