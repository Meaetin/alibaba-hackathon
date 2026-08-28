/**
 * The mappings, not the queries.
 *
 * `readItineraryDetail` is four selects with no decisions in them, and a fake
 * database would only prove the fake works — the same reasoning as
 * `diagnostics.ts`. What is worth pinning is the arithmetic between the
 * planner's shape and the page's, because every one of these has a plausible
 * wrong answer that still renders.
 */

import { describe, expect, it } from "vitest";

import type { PlannerDebug } from "@/lib/planner/debug";

import {
  categoryFor,
  endDateFor,
  minutesToISO,
  overviewFrom,
  weekdayDescriptionsFrom,
} from "./itinerary-detail";

describe("minutesToISO", () => {
  it("stamps minutes from midnight onto the day", () => {
    expect(minutesToISO("2026-08-27", 540)).toBe("2026-08-27T09:00:00.000Z");
    expect(minutesToISO("2026-08-27", 1_198)).toBe("2026-08-27T19:58:00.000Z");
  });

  it("rolls a day that runs past midnight onto the next date", () => {
    // `DAY_END_MIN` is 21:00 so the packer cannot produce this, but a stored
    // day is data and wrapping to the same morning would put a nightcap twelve
    // hours before the lunch it followed.
    expect(minutesToISO("2026-08-27", 1_500)).toBe("2026-08-28T01:00:00.000Z");
  });

  it("holds across a month boundary", () => {
    // `setUTCDate` past the end of the month is the whole reason this is date
    // arithmetic and not string surgery.
    expect(minutesToISO("2026-08-31", 1_500)).toBe("2026-09-01T01:00:00.000Z");
  });

  it("treats midnight as the start of its own day", () => {
    expect(minutesToISO("2026-08-27", 0)).toBe("2026-08-27T00:00:00.000Z");
  });
});

describe("endDateFor", () => {
  it("is inclusive of the first day", () => {
    // Three days starting Thursday ends Saturday, not Sunday. Off by one here
    // is a day the page renders empty.
    expect(endDateFor("2026-08-27", 3)).toBe("2026-08-29");
  });

  it("makes a one-day trip start and end on the same date", () => {
    expect(endDateFor("2026-08-27", 1)).toBe("2026-08-27");
  });

  it("crosses a month boundary", () => {
    expect(endDateFor("2026-08-30", 4)).toBe("2026-09-02");
  });
});

describe("categoryFor", () => {
  it("calls every role that puts you at a table a meal", () => {
    expect(categoryFor("lunch")).toBe("meal");
    expect(categoryFor("dinner")).toBe("meal");
    // A coffee stop is a meal to this page: its own place heuristic counts
    // `cafe` and `coffee_shop`, and a card that disagreed would show a
    // different icon for the same kind of stop depending on where it came from.
    expect(categoryFor("cafe_break")).toBe("meal");
  });

  it("calls everything else a point of interest", () => {
    expect(categoryFor("activity")).toBe("poi");
  });
});

describe("overviewFrom", () => {
  const debug = (titles: { title: string; dayIndex: number }[]) =>
    ({
      themes: { titles: titles.map((t) => ({ ...t, anchorPlaceId: "x" })) },
    }) as unknown as PlannerDebug;

  it("reads the premises back in day order, however they were stored", () => {
    expect(
      overviewFrom(
        debug([
          { title: "Southern Ridges Outdoors", dayIndex: 2 },
          { title: "Heritage and Hawker Fare", dayIndex: 0 },
          { title: "Coffee and Local Eats", dayIndex: 1 },
        ]),
      ),
    ).toBe(
      "Day 1: Heritage and Hawker Fare. Day 2: Coffee and Local Eats. Day 3: Southern Ridges Outdoors.",
    );
  });

  it("says nothing for a trip planned by geography", () => {
    // A geographic plan has no premises, and inventing a blurb for one is how a
    // page starts sounding generated.
    expect(overviewFrom(null)).toBeNull();
    expect(overviewFrom({} as PlannerDebug)).toBeNull();
    expect(overviewFrom(debug([]))).toBeNull();
  });
});

describe("weekdayDescriptionsFrom", () => {
  const period = (day: number, openHour: number, closeHour: number) => ({
    open: { day, hour: openHour, minute: 0 },
    close: { day, hour: closeHour, minute: 30 },
  });

  it("renders Monday first, over Google's Sunday-first numbering", () => {
    // Google numbers Sunday 0. Reading that as Monday shifts every day by one
    // and still produces a perfectly plausible week.
    const lines = weekdayDescriptionsFrom([period(0, 10, 16), period(1, 9, 17)]);
    expect(lines[0]).toBe("Monday: 09:00 – 17:30");
    expect(lines[6]).toBe("Sunday: 10:00 – 16:30");
  });

  it("says Closed for a day with no period", () => {
    const lines = weekdayDescriptionsFrom([period(1, 9, 17)]);
    expect(lines[1]).toBe("Tuesday: Closed");
  });

  it("joins a day that opens twice", () => {
    const lines = weekdayDescriptionsFrom([period(1, 9, 12), period(1, 17, 22)]);
    expect(lines[0]).toBe("Monday: 09:00 – 12:30, 17:00 – 22:30");
  });

  it("reads a period with no close as always open", () => {
    // Google's encoding for a 24-hour place: one period, no close.
    const lines = weekdayDescriptionsFrom([{ open: { day: 0, hour: 0, minute: 0 } }]);
    expect(lines).toHaveLength(7);
    expect(lines.every((l) => l.endsWith("Open 24 hours"))).toBe(true);
  });

  it("says nothing at all when there are no hours", () => {
    // "We never got hours" and "closed all week" are different answers, and a
    // park rendered as shut every day is the second one told as the first.
    expect(weekdayDescriptionsFrom(null)).toEqual([]);
    expect(weekdayDescriptionsFrom([])).toEqual([]);
  });
});
