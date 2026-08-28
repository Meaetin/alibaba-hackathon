import { describe, expect, it } from "vitest";

import { parseTimeMins } from "./activity-utils";

/**
 * These pin the one thing that broke the itinerary page: the day's order is a
 * sort on `parseTimeMins`, and reading a stored timestamp in the *viewer's*
 * timezone rotates the day by their offset. The labels stay right — they are
 * rendered in UTC — so the bug is invisible to anyone at UTC+0 and reorders
 * the whole afternoon for anyone east of it.
 */
describe("parseTimeMins", () => {
  it("reads an ISO timestamp in UTC, not the host's timezone", () => {
    expect(parseTimeMins("2026-08-27T09:00:00.000Z")).toBe(540);
    expect(parseTimeMins("2026-08-27T17:15:00.000Z")).toBe(1035);
  });

  it("keeps a stored day in ascending order regardless of where it is read", () => {
    // Day one of the Singapore trip, as `minutesToISO` writes it.
    const day = [540, 606, 690, 778, 877, 949, 1035, 1097, 1196].map((min) => {
      const stamped = new Date("2026-08-27T00:00:00Z");
      stamped.setUTCMinutes(min);
      return stamped.toISOString();
    });
    const sorted = [...day].sort((a, b) => parseTimeMins(a) - parseTimeMins(b));
    expect(sorted).toEqual(day);
  });

  it("honours an explicit timezone", () => {
    expect(parseTimeMins("2026-08-27T09:00:00.000Z", "Asia/Singapore")).toBe(1020);
  });

  it("still reads a bare HH:MM as minutes past midnight", () => {
    expect(parseTimeMins("09:30")).toBe(570);
    expect(parseTimeMins("17:05")).toBe(1025);
  });
});
