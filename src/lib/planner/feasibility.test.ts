import { describe, expect, it, vi } from "vitest";

import type { ThemedCluster } from "./group";
import { mealCapacity, repairFeasibility } from "./feasibility";
import type { DayTheme } from "./theme";
import type { CandidatePlace } from "./types";

function sight(placeId: string, latitude = 35.0, longitude = 135.7): CandidatePlace {
  return { placeId, name: placeId, types: ["tourist_attraction"], latitude, longitude };
}

function eatery(placeId: string, latitude = 35.0, longitude = 135.7): CandidatePlace {
  return { placeId, name: placeId, types: ["ramen_restaurant", "restaurant"], latitude, longitude };
}

function theme(dayIndex: number): DayTheme {
  return {
    dayIndex,
    title: `Day ${dayIndex + 1}`,
    premise: "A day about one thing.",
    anchorPlaceId: `anchor-${dayIndex}`,
    includedTypes: ["cafe"],
    radiusHint: "walkable",
  };
}

function cluster(
  dayIndex: number,
  places: CandidatePlace[],
  centroid = { latitude: 35.0, longitude: 135.7 },
  themed = true,
): ThemedCluster {
  return { centroid, places, label: `Day ${dayIndex + 1}`, ...(themed ? { theme: theme(dayIndex) } : {}) };
}

const MEALS = 2;

describe("repairFeasibility", () => {
  it("leaves a day that can already feed itself alone", async () => {
    const fed = cluster(0, [sight("a"), eatery("e1"), eatery("e2")]);
    const widen = vi.fn(async () => []);
    const { clusters, repairs } = await repairFeasibility([fed], { mealsPerDay: MEALS, widen });

    expect(repairs).toEqual([]);
    expect(clusters[0].places).toHaveLength(3);
    // Rung 1 costs a billed Nearby Search. A day that does not need one must
    // not buy one.
    expect(widen).not.toHaveBeenCalled();
  });

  it("widens first, and stops there when widening was enough", async () => {
    const thin = cluster(0, [sight("a"), eatery("e1")]);
    const { clusters, repairs } = await repairFeasibility([thin], {
      mealsPerDay: MEALS,
      widen: async () => [eatery("found")],
      geographicFor: () => cluster(0, [sight("z"), eatery("g1"), eatery("g2"), eatery("g3")]),
    });

    expect(repairs).toHaveLength(1);
    expect(repairs[0].rung).toBe("widened");
    expect(repairs[0].before).toBe(1);
    expect(repairs[0].after).toBe(2);
    // The day keeps its premise, which is the whole point of trying this first.
    expect(clusters[0].theme).toBeDefined();
  });

  it("ignores what a widen returns that it already had", async () => {
    const thin = cluster(0, [sight("a"), eatery("e1")]);
    const { clusters, repairs } = await repairFeasibility([thin], {
      mealsPerDay: MEALS,
      // A wider circle returns the narrower circle's places too.
      widen: async () => [eatery("e1"), sight("a")],
    });
    expect(clusters[0].places).toHaveLength(2);
    expect(repairs.every((r) => r.rung !== "widened")).toBe(true);
  });

  it("borrows from the nearest day that can spare it", async () => {
    const thin = cluster(0, [sight("a")], { latitude: 35.0, longitude: 135.7 });
    const far = cluster(
      1,
      [eatery("far-1", 36, 136), eatery("far-2", 36, 136), eatery("far-3", 36, 136), eatery("far-4", 36, 136)],
      { latitude: 36, longitude: 136 },
    );
    const near = cluster(
      2,
      [eatery("near-1", 35.01, 135.71), eatery("near-2", 35.01, 135.71), eatery("near-3", 35.01, 135.71), eatery("near-4", 35.01, 135.71)],
      { latitude: 35.01, longitude: 135.71 },
    );

    const { clusters, repairs } = await repairFeasibility([thin, far, near], {
      mealsPerDay: MEALS,
    });

    // The borrowed restaurant must be one the traveller could plausibly reach
    // on the borrowing day, so the donor is chosen by anchor distance.
    expect(repairs[0].rung).toBe("merged");
    const borrowed = clusters[0].places.map((p) => p.placeId);
    expect(borrowed.some((id) => id.startsWith("near-"))).toBe(true);
    expect(borrowed.some((id) => id.startsWith("far-"))).toBe(false);
  });

  it("never takes a donor below its own feasibility", async () => {
    // Otherwise the repair just moves the problem one day along. The donor
    // holds exactly the target and can spare nothing, so nothing moves.
    //
    // The donor is deliberately themeless: a themed donor would be repaired on
    // the next pass of the loop and would borrow its own restaurants straight
    // back, which hides a broken rule behind an oscillation. That is the shape
    // this assertion had on first writing, and it survived the mutation.
    const thin = cluster(0, [sight("a")]);
    const donor = cluster(1, [eatery("e1"), eatery("e2")], { latitude: 35.001, longitude: 135.7 }, false);
    const { clusters, repairs } = await repairFeasibility([thin, donor], { mealsPerDay: MEALS });

    expect(mealCapacity(clusters[1])).toBe(MEALS);
    expect(mealCapacity(clusters[0])).toBe(0);
    expect(repairs).toEqual([]);
  });

  it("borrows only the surplus", async () => {
    const thin = cluster(0, [sight("a")]);
    const donor = cluster(
      1,
      [eatery("e1"), eatery("e2"), eatery("e3")],
      { latitude: 35.001, longitude: 135.7 },
      false,
    );
    const { clusters, repairs } = await repairFeasibility([thin, donor], { mealsPerDay: MEALS });

    // One spare, so one moves — the thin day is still short, and says so.
    expect(repairs.map((r) => r.rung)).toEqual(["merged"]);
    expect(mealCapacity(clusters[0])).toBe(1);
    expect(mealCapacity(clusters[1])).toBe(MEALS);
  });

  it("gives up the premise for a day nothing else could fix", async () => {
    const thin = cluster(0, [sight("a")]);
    const geographic = cluster(0, [sight("z"), eatery("g1"), eatery("g2")], undefined, false);
    const { clusters, repairs } = await repairFeasibility([thin], {
      mealsPerDay: MEALS,
      geographicFor: () => geographic,
    });

    expect(repairs.map((r) => r.rung)).toEqual(["geographic"]);
    // The premise is dropped rather than kept over a day with nothing to eat.
    expect(clusters[0].theme).toBeUndefined();
    expect(mealCapacity(clusters[0])).toBe(2);
  });

  it("keeps the thin theme when the geography is no better", async () => {
    // Replacing a thin day with an equally thin one loses the premise for
    // nothing, and the day was going to be thin either way.
    const thin = cluster(0, [sight("a"), eatery("e1")]);
    const { clusters, repairs } = await repairFeasibility([thin], {
      mealsPerDay: MEALS,
      geographicFor: () => cluster(0, [sight("z"), eatery("g1")], undefined, false),
    });
    expect(repairs).toEqual([]);
    expect(clusters[0].theme).toBeDefined();
  });

  it("leaves a day that never had a theme alone", async () => {
    // It is already the geographic path, and `ScoredCluster.shortfall` reports
    // its thinness the way it always has.
    const geographic = cluster(0, [sight("a")], undefined, false);
    const widen = vi.fn(async () => []);
    const { repairs } = await repairFeasibility([geographic], { mealsPerDay: MEALS, widen });
    expect(repairs).toEqual([]);
    expect(widen).not.toHaveBeenCalled();
  });

  it("records a repair that helped but did not finish the job", async () => {
    // Still short of the target is a real outcome. Reporting only the successes
    // is how a silently thin day reaches the traveller.
    const thin = cluster(0, [sight("a")]);
    const { repairs } = await repairFeasibility([thin], {
      mealsPerDay: MEALS,
      widen: async () => [eatery("found")],
    });
    expect(repairs).toEqual([
      {
        dayIndex: 0,
        rung: "widened",
        before: 0,
        after: 1,
        reason: "searched wider and found 1 more place to eat",
      },
    ]);
  });

  it("works with no ports at all", async () => {
    // Both are optional so the ladder can run, and be tested, with no network.
    const thin = cluster(0, [sight("a")]);
    const { clusters, repairs } = await repairFeasibility([thin], { mealsPerDay: MEALS });
    expect(repairs).toEqual([]);
    expect(clusters[0].places).toHaveLength(1);
  });

  it("does not mutate the clusters it was given", async () => {
    const thin = cluster(0, [sight("a")]);
    const donor = cluster(1, [eatery("e1"), eatery("e2"), eatery("e3")], {
      latitude: 35.001,
      longitude: 135.7,
    });
    const donorPlacesBefore = [...donor.places];
    await repairFeasibility([thin, donor], { mealsPerDay: MEALS });
    expect(thin.places).toHaveLength(1);
    expect(donor.places).toEqual(donorPlacesBefore);
  });
});
