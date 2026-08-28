import { describe, expect, it } from "vitest";

import { mulberry32 } from "./__tests__/rng";
import { MEMBER_RADIUS_SLACK, TYPE_MATCH_DISCOUNT, groupByTheme } from "./group";
import { RADIUS_METERS, type DayTheme } from "./theme";
import type { CandidatePlace } from "./types";

function place(
  placeId: string,
  latitude: number,
  longitude: number,
  types: string[] = ["tourist_attraction"],
): CandidatePlace {
  return { placeId, name: placeId, types, latitude, longitude };
}

function theme(dayIndex: number, anchorPlaceId: string, includedTypes: string[] = []): DayTheme {
  return {
    dayIndex,
    title: `Day ${dayIndex + 1}`,
    premise: "A day around one thing.",
    anchorPlaceId,
    includedTypes,
    radiusHint: "walkable",
  };
}

/** Two anchors far apart, and a place beside each. */
const NORTH_ANCHOR = place("north-anchor", 35.05, 135.75);
const SOUTH_ANCHOR = place("south-anchor", 34.9, 135.6);

function group(
  places: readonly CandidatePlace[],
  themes: readonly DayTheme[],
  totalDays = themes.length,
) {
  const pool = new Map(
    [...places, NORTH_ANCHOR, SOUTH_ANCHOR].map((place) => [place.placeId, place]),
  );
  return groupByTheme({ places, themes, pool, totalDays, rng: mulberry32(1337) });
}

describe("groupByTheme", () => {
  it("gives every place to its nearest anchor", () => {
    const near = place("near-north", 35.051, 135.751);
    const far = place("near-south", 34.901, 135.601);
    const { clusters } = group(
      [NORTH_ANCHOR, SOUTH_ANCHOR, near, far],
      [theme(0, "north-anchor"), theme(1, "south-anchor")],
    );
    expect(clusters[0].places.map((p) => p.placeId)).toContain("near-north");
    expect(clusters[1].places.map((p) => p.placeId)).toContain("near-south");
  });

  // A contested place has to be inside *both* anchors' reach, or the cap
  // decides the contest before the discount can. The pair of anchors below sit
  // about 1.8 km apart for that reason; `NORTH_ANCHOR` and `SOUTH_ANCHOR` are
  // 20 km apart and nothing can be contested between them.
  const WEST_ANCHOR = place("west-anchor", 35.05, 135.75);
  const EAST_ANCHOR = place("east-anchor", 35.05, 135.77);

  it("gives every place to exactly one theme", () => {
    // The same ramen shop is a plausible member of three premises. It goes to
    // one, or the funnel's per-cluster cap is spent on the same place twice.
    const contested = place("ramen", 35.05, 135.76, ["ramen_restaurant"]);
    const { clusters } = group(
      [WEST_ANCHOR, EAST_ANCHOR, contested],
      [theme(0, "west-anchor"), theme(1, "east-anchor")],
    );
    const holders = clusters.filter((c) => c.places.some((p) => p.placeId === "ramen"));
    expect(holders).toHaveLength(1);
  });

  it("lets a type match pull a place one theme over", () => {
    // Slightly closer to the west anchor, but it is what the east theme asked
    // for — and the discount is sized to win exactly this contest.
    const between = place("cafe", 35.05, 135.7595, ["cafe"]);
    const noMatch = group(
      [WEST_ANCHOR, EAST_ANCHOR, between],
      [theme(0, "west-anchor"), theme(1, "east-anchor")],
    );
    const withMatch = group(
      [WEST_ANCHOR, EAST_ANCHOR, between],
      [theme(0, "west-anchor"), theme(1, "east-anchor", ["cafe"])],
    );
    const holderOf = (result: ReturnType<typeof group>) =>
      result.clusters.findIndex((c) => c.places.some((p) => p.placeId === "cafe"));

    expect(holderOf(noMatch)).toBe(0);
    expect(holderOf(withMatch)).toBe(1);
    // And the discount is a discount, not a licence: bounded below 1.
    expect(TYPE_MATCH_DISCOUNT).toBeGreaterThan(0);
    expect(TYPE_MATCH_DISCOUNT).toBeLessThan(1);
  });

  it("cannot pull a place across the city on a type match", () => {
    // The rule that keeps a themed day a day rather than a train timetable.
    const rightBesideNorth = place("cafe", 35.0501, 135.7501, ["cafe"]);
    const { clusters } = group(
      [NORTH_ANCHOR, SOUTH_ANCHOR, rightBesideNorth],
      [theme(0, "north-anchor"), theme(1, "south-anchor", ["cafe"])],
    );
    expect(clusters[0].places.map((p) => p.placeId)).toContain("cafe");
  });

  it("frames a themed day on its anchor, not on the mean of its members", () => {
    // The centroid is what the map frames and what "how spread out is this
    // day" is measured from. For a themed day both answers are the anchor.
    const stray = place("stray", 35.2, 135.9);
    const { clusters } = group([NORTH_ANCHOR, stray], [theme(0, "north-anchor")], 1);
    expect(clusters[0].centroid).toEqual({ latitude: 35.05, longitude: 135.75 });
  });

  it("labels a themed day with its title, so the day already has a name", () => {
    const { clusters } = group([NORTH_ANCHOR], [theme(0, "north-anchor")], 1);
    expect(clusters[0].label).toBe("Day 1");
    expect(clusters[0].theme?.premise).toBeDefined();
  });

  it("clusters the leftovers geographically for a day with no theme", () => {
    const orphan = place("orphan", 34.5, 135.0);
    const { clusters, geographicDays } = group(
      [NORTH_ANCHOR, orphan],
      [theme(0, "north-anchor")],
      2,
    );
    expect(geographicDays).toEqual([1]);
    expect(clusters).toHaveLength(2);
    expect(clusters[1].theme).toBeUndefined();
  });

  it("does not build a themeless day from the themed day's stops", () => {
    // The two halves cannot be interleaved: geography runs over what no theme
    // claimed, or day two is day one again.
    const nearNorth = place("near-north", 35.0511, 135.7511);
    const { clusters } = group([NORTH_ANCHOR, nearNorth], [theme(0, "north-anchor")], 2);
    const themed = new Set(clusters[0].places.map((p) => p.placeId));
    for (const place of clusters[1].places) {
      expect(themed.has(place.placeId), place.placeId).toBe(false);
    }
  });

  it("refuses an anchor Google gave no coordinates for", () => {
    // `theme.ts` verified the id exists. It cannot verify there is a point to
    // search around, and a theme without one cannot claim anybody.
    const noCoords: CandidatePlace = { placeId: "ghost", name: "ghost", types: [] };
    const pool = new Map([["ghost", noCoords], [NORTH_ANCHOR.placeId, NORTH_ANCHOR]]);
    const result = groupByTheme({
      places: [NORTH_ANCHOR],
      themes: [theme(0, "ghost")],
      pool,
      totalDays: 1,
      rng: mulberry32(1337),
    });
    expect(result.geographicDays).toEqual([0]);
    expect(result.clusters[0].theme).toBeUndefined();
  });

  it("returns one cluster per day, in day order, even when a day is empty", () => {
    // The funnel is told `dayAligned` for themed runs, so index is day. A
    // missing entry here would renumber every day after it.
    const { clusters } = group([NORTH_ANCHOR], [theme(0, "north-anchor")], 3);
    expect(clusters).toHaveLength(3);
  });
});

describe("the reach cap", () => {
  // `walkable` is 1200 m, so a walkable theme reaches 1800 m. The number comes
  // from the hint alone now — see `radiusFor`.
  const reach = RADIUS_METERS.walkable * MEMBER_RADIUS_SLACK;

  // 0.01 degrees of latitude is about 1.1 km, so `near` is inside the reach and
  // `far` is about 5.6 km out — the shape of the Singapore cafe that cost a day
  // seven of its ten stops.
  const near = place("near", 35.06, 135.75);
  const far = place("far", 35.1, 135.75);

  it("refuses a place no anchor is close enough to, and counts it", () => {
    const { clusters, unclaimed } = group(
      [NORTH_ANCHOR, near, far],
      [theme(0, "north-anchor")],
      1,
    );
    const ids = clusters[0].places.map((p) => p.placeId);
    expect(ids).toContain("near");
    expect(ids).not.toContain("far");
    // Kept, not merely counted: a cut that only shrinks a list is the bug this
    // project already knows about, and a count cannot be handed to a day that
    // needs somewhere to eat. `alternatesFor` offers the meal-capable ones.
    expect(unclaimed.map((p) => p.placeId)).toEqual(["far"]);
  });

  it("does not let a type match buy extra reach", () => {
    // The discount decides *which* theme wins a place it could join. It must not
    // decide *whether* it can join at all — that was the actual defect: a cafe
    // 5.7 km out matched the coffee theme's types and was treated as 40% closer.
    const distantCafe = place("distant-cafe", 35.1, 135.75, ["cafe"]);
    const { clusters, unclaimed } = group(
      [NORTH_ANCHOR, distantCafe],
      [theme(0, "north-anchor", ["cafe"])],
      1,
    );
    expect(clusters[0].places.map((p) => p.placeId)).not.toContain("distant-cafe");
    expect(unclaimed.map((p) => p.placeId)).toEqual(["distant-cafe"]);
  });

  it("reaches further for a wider theme, and for nothing else", () => {
    // The hint is the only input. It used to scale with `walkMaxMeters` too,
    // which meant a traveller who said "I like it comfortable" silently
    // searched two-thirds of the city and got a day with nothing in it.
    const tight = group([NORTH_ANCHOR, far], [theme(0, "north-anchor")], 1);
    expect(tight.clusters[0].places.map((p) => p.placeId)).not.toContain("far");

    const wide = group([NORTH_ANCHOR, far], [{ ...theme(0, "north-anchor"), radiusHint: "wide" }], 1);
    expect(wide.clusters[0].places.map((p) => p.placeId)).toContain("far");
  });

  it("hands what it refused to a themeless day rather than losing it", () => {
    // The cap decides what a *theme* is about. It is not a filter on the trip.
    const { clusters, unclaimed } = group(
      [NORTH_ANCHOR, near, far],
      [theme(0, "north-anchor")],
      2,
    );
    expect(unclaimed.map((p) => p.placeId)).toEqual(["far"]);
    expect(clusters[1].places.map((p) => p.placeId)).toContain("far");
  });

  it("claims a place sitting exactly on the reach", () => {
    // The boundary is inclusive, and something has to pin which side it is on.
    const onEdge = place("on-edge", NORTH_ANCHOR.latitude! + reach / 111_195, 135.75);
    const { clusters } = group([NORTH_ANCHOR, onEdge], [theme(0, "north-anchor")], 1);
    expect(clusters[0].places.map((p) => p.placeId)).toContain("on-edge");
  });
});
