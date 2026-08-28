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

/** A restaurant a vegetarian cannot eat in: rung 2 of `violatesDietaryNeed`. */
function steakhouse(placeId: string, latitude = 35.0, longitude = 135.7): CandidatePlace {
  return { placeId, name: placeId, types: ["steak_house", "restaurant"], latitude, longitude };
}

/** A restaurant Google itself says serves no vegetarian food: rung 1. */
function refusedByGoogle(placeId: string, latitude = 35.0, longitude = 135.7): CandidatePlace {
  return {
    placeId,
    name: placeId,
    types: ["ramen_restaurant", "restaurant"],
    latitude,
    longitude,
    servesVegetarianFood: false,
  };
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

  it("will not borrow a restaurant the borrower could never reach", async () => {
    // The cap in `groupByTheme` refuses a distant place at membership time.
    // It is unconditional now — there used to be an opt-out (omit
    // `walkMaxMeters` and the bound disappeared), and a test pinning it.
    // Without the same bound here, rung 2 hands one straight back and the day
    // reads as repaired — two restaurants — while the packer still spends the
    // morning on transit. The donor is themeless so it is not repaired on the
    // next pass and cannot borrow its own places back.
    const thin = cluster(0, [sight("a")], { latitude: 35.0, longitude: 135.7 });
    const donor = cluster(
      1,
      [
        eatery("reachable", 35.008, 135.7), // ~0.9 km from the borrower
        eatery("far-1", 35.1, 135.7), // ~11 km
        eatery("far-2", 35.11, 135.7),
        eatery("far-3", 35.12, 135.7),
        eatery("far-4", 35.13, 135.7),
      ],
      { latitude: 35.1, longitude: 135.7 },
      false,
    );

    const { clusters, repairs } = await repairFeasibility([thin, donor], { mealsPerDay: MEALS });

    const borrowed = clusters[0].places.map((p) => p.placeId);
    expect(borrowed).toContain("reachable");
    expect(borrowed.some((id) => id.startsWith("far-"))).toBe(false);
    // The donor could spare three, and the day still needed two. Taking only
    // the one that is actually reachable leaves the day short, and it says so.
    expect(repairs.map((r) => r.rung)).toEqual(["merged"]);
    expect(mealCapacity(clusters[0])).toBe(1);
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

/**
 * The ladder can only repair a shortage it can see.
 *
 * `mealCapacity` counted bare `isRestaurant`, so a vegetarian's day of five
 * steakhouses read as perfectly feasible: nothing widened, nothing was
 * borrowed, and the traveller met the problem at `selectMealCandidates` rung 3
 * — "limited vegetarian options, call ahead" — after every circle had been
 * billed for.
 */
describe("a day that cannot feed *this* traveller", () => {
  it("counts a steakhouse for a traveller with no needs and not for a vegetarian", () => {
    const day = cluster(0, [sight("a"), steakhouse("s1"), steakhouse("s2")]);
    expect(mealCapacity(day)).toBe(2);
    expect(mealCapacity(day, ["vegetarian"])).toBe(0);
  });

  it("reads Google's direct refusal, not just the type list", () => {
    // Rung 1 of `violatesDietaryNeed`: a ramen shop is no kind of conflict by
    // type, and Google saying `false` outright is what convicts it.
    const day = cluster(0, [refusedByGoogle("r1"), refusedByGoogle("r2")]);
    expect(mealCapacity(day)).toBe(2);
    expect(mealCapacity(day, ["vegetarian"])).toBe(0);
  });

  it("fires the ladder for a vegetarian on a day that looked fed", async () => {
    const steakDay = cluster(0, [sight("a"), steakhouse("s1"), steakhouse("s2")]);
    const widen = vi.fn(async () => [eatery("veg-1"), eatery("veg-2")]);

    // With no needs the day is already feasible and must not buy a search.
    const untroubled = await repairFeasibility([cluster(0, [sight("a"), steakhouse("s1"), steakhouse("s2")])], {
      mealsPerDay: MEALS,
      widen,
    });
    expect(untroubled.repairs).toEqual([]);
    expect(widen).not.toHaveBeenCalled();

    const repaired = await repairFeasibility([steakDay], {
      mealsPerDay: MEALS,
      dietary: ["vegetarian"],
      widen,
    });
    expect(widen).toHaveBeenCalledTimes(1);
    expect(repaired.repairs).toHaveLength(1);
    expect(repaired.repairs[0].rung).toBe("widened");
    expect(repaired.repairs[0].before).toBe(0);
    expect(repaired.repairs[0].after).toBe(2);
  });

  /**
   * Lending a vegetarian five steakhouses satisfies the arithmetic and feeds
   * nobody. The donor must be themeless, or it gets repaired on the next pass
   * of the loop and borrows its own restaurants straight back — an assertion
   * written against two themed clusters passes whatever the rule says.
   */
  it("borrows only what the borrower can actually eat", async () => {
    const hungry = cluster(0, [sight("a")]);
    const donor = cluster(
      1,
      // Four edible places, so the donor can spare two and still keep its own
      // two — the rule that makes this a repair rather than a robbery. The
      // three steakhouses are the point: they are nearer in the list and would
      // have been lent first under the old count.
      [
        steakhouse("s1"),
        steakhouse("s2"),
        steakhouse("s3"),
        eatery("veg-1"),
        eatery("veg-2"),
        eatery("veg-3"),
        eatery("veg-4"),
      ],
      { latitude: 35.0, longitude: 135.7 },
      false,
    );

    const { clusters, repairs } = await repairFeasibility([hungry, donor], {
      mealsPerDay: MEALS,
      dietary: ["vegetarian"],
    });

    expect(repairs.map((r) => r.rung)).toEqual(["merged"]);
    const borrowed = clusters[0].places.filter((p) => p.placeId !== "a");
    expect(borrowed).toHaveLength(2);
    for (const place of borrowed) {
      expect(place.types, `${place.placeId} is not edible by a vegetarian`).not.toContain(
        "steak_house",
      );
    }
  });
});

/**
 * `repairs` only ever held rungs that worked, so a day that walked all three
 * and fixed nothing left no trace. A live Bali day did exactly that — nothing
 * to eat, widened and found none, no donor within reach, no better geography —
 * and the only surviving evidence in the whole run was `validateDay` reporting
 * `lost_meal` at the very end.
 */
describe("what the ladder tried, not just what worked", () => {
  it("records a day that walked every rung and fixed nothing", async () => {
    const hopeless = cluster(0, [sight("a")]);
    const { repairs, attempts } = await repairFeasibility([hopeless], {
      mealsPerDay: MEALS,
      widen: async () => [],
      geographicFor: () => cluster(0, [sight("z")]),
    });

    // The old record: silence.
    expect(repairs).toEqual([]);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      dayIndex: 0,
      before: 0,
      after: 0,
      needed: MEALS,
      unfixed: true,
    });
    expect(attempts[0].tried).toEqual(["widened", "merged", "geographic"]);
  });

  it("lists a day it did fix, and does not call it unfixed", async () => {
    const thin = cluster(0, [sight("a"), eatery("e1")]);
    const { attempts } = await repairFeasibility([thin], {
      mealsPerDay: MEALS,
      widen: async () => [eatery("found")],
    });

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({ before: 1, after: 2, unfixed: false });
    // It stopped at the rung that worked rather than walking the rest.
    expect(attempts[0].tried).toEqual(["widened"]);
  });

  /**
   * A day that never needed the ladder must not appear. This is the opposite
   * error from the one above and just as bad on a page somebody reads to find
   * the day that went wrong.
   */
  it("says nothing about a day that could already feed itself", async () => {
    const fed = cluster(0, [sight("a"), eatery("e1"), eatery("e2")]);
    const { attempts } = await repairFeasibility([fed], { mealsPerDay: MEALS });
    expect(attempts).toEqual([]);
  });

  it("records the rung it stopped at when borrowing was enough", async () => {
    const hungry = cluster(0, [sight("a")]);
    const donor = cluster(
      1,
      [eatery("d1"), eatery("d2"), eatery("d3"), eatery("d4")],
      { latitude: 35.0, longitude: 135.7 },
      false,
    );
    const { attempts } = await repairFeasibility([hungry, donor], { mealsPerDay: MEALS });

    expect(attempts).toHaveLength(1);
    expect(attempts[0].tried).toEqual(["merged"]);
    expect(attempts[0].unfixed).toBe(false);
  });
});
