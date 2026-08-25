/**
 * Stage 5 — every candidate to exactly one theme.
 *
 * This is what replaces the statistical centroid with a semantic anchor, and it
 * is deliberately the *only* thing that changes. `PlaceCluster` is the shape the
 * funnel, Pass B and the validator already take, so a themed day is a
 * `PlaceCluster` with a theme attached and nothing downstream needs to know.
 *
 * ## The assignment rule
 *
 * Nearest anchor, weighted by whether the place is the kind of thing the theme
 * asked for. Distance alone would rebuild k-means with worse centroids; type
 * match alone would put a ramen shop from across the city into the ramen day.
 * The weighting is a **discount on distance**, not a bonus on score, so a
 * matching type can pull a place one theme over but never across a city.
 *
 * ## Ties, and why day order breaks them
 *
 * The same ramen shop will be a plausible member of three premises. It goes to
 * exactly one — the best fit, and on an exact tie the earlier day. Earlier
 * rather than "best cluster" because a traveller reads day one first, and a
 * deterministic rule that a person can state beats one they have to derive.
 */

import { clusterPlaces } from "./cluster";
import type { PlaceCluster } from "./cluster";
import type { DayTheme } from "./theme";
import type { CandidatePlace } from "./types";

/** A day's candidate pool, plus what the day is about. */
export interface ThemedCluster extends PlaceCluster {
  /** Absent means this day fell back to geography and has no premise. */
  theme?: DayTheme;
}

/**
 * How much a type match shrinks the distance to a theme's anchor.
 *
 * 0.6 means "a place this theme asked for is treated as 40% closer". Chosen so
 * a match can win a contest between two adjacent anchors and cannot win one
 * between anchors on opposite sides of a city — which is the whole difference
 * between a coherent day and a day you spend on a train.
 */
export const TYPE_MATCH_DISCOUNT = 0.6;

/**
 * Anchors are real places, so their coordinates come from the pool rather than
 * from the model. A theme whose anchor has no coordinates cannot claim anyone.
 */
export interface GroupInput {
  places: readonly CandidatePlace[];
  themes: readonly DayTheme[];
  /** Every retrieved place by id — where an anchor's coordinates come from. */
  pool: ReadonlyMap<string, CandidatePlace>;
  /** Days in the trip. Days without a theme get a geographic cluster. */
  totalDays: number;
  /** Injected. Only the geographic fallback consumes it. */
  rng: () => number;
}

export interface GroupResult {
  /** One entry per day, in day order. A day may hold an empty cluster. */
  clusters: ThemedCluster[];
  /** Days that got a geographic cluster because they had no usable theme. */
  geographicDays: number[];
}

/**
 * Themed days first, then geography for whatever is left.
 *
 * The two halves cannot be interleaved: a geographic cluster for the themeless
 * days must be computed over the places the themes did *not* claim, or a day
 * with no premise is built from the same stops as the day beside it.
 */
export function groupByTheme(input: GroupInput): GroupResult {
  const anchored = input.themes.flatMap((theme) => {
    const anchor = input.pool.get(theme.anchorPlaceId);
    // An anchor with no coordinates is not an anchor. `theme.ts` verified the
    // id exists; it cannot verify Google gave it a location.
    if (anchor?.latitude === undefined || anchor.longitude === undefined) return [];
    return [{ theme, anchor: { latitude: anchor.latitude, longitude: anchor.longitude } }];
  });

  const byDay = new Map<number, ThemedCluster>();
  const claimed = new Set<string>();

  if (anchored.length > 0) {
    const members = new Map<number, CandidatePlace[]>();
    for (const place of input.places) {
      if (place.latitude === undefined || place.longitude === undefined) continue;
      const best = nearestTheme(place, anchored);
      if (best === undefined) continue;
      claimed.add(place.placeId);
      members.set(best, [...(members.get(best) ?? []), place]);
    }

    anchored.forEach(({ theme, anchor }, index) => {
      const places = members.get(index) ?? [];
      byDay.set(theme.dayIndex, {
        // The anchor, not the mean of the members. The centroid is what the map
        // frames and what "how far is this day spread" is measured from, and
        // for a themed day the honest answer to both is the place it is about.
        centroid: anchor,
        places,
        label: theme.title,
        theme,
      });
    });
  }

  // Whatever no theme claimed, clustered the old way, one cluster per themeless
  // day. This is the last rung and it is the behaviour this planner shipped.
  const themelessDays = Array.from({ length: input.totalDays }, (_, day) => day).filter(
    (day) => !byDay.has(day),
  );
  if (themelessDays.length > 0) {
    const leftovers = input.places.filter(
      (place) => !claimed.has(place.placeId) && place.latitude !== undefined,
    );
    const fallback =
      leftovers.length > 0
        ? clusterPlaces([...leftovers], {
            k: Math.min(themelessDays.length, leftovers.length),
            rng: input.rng,
          })
        : [];
    themelessDays.forEach((day, index) => {
      const cluster = fallback[index];
      byDay.set(
        day,
        cluster ?? { centroid: { latitude: 0, longitude: 0 }, places: [], label: undefined },
      );
    });
  }

  return {
    clusters: Array.from({ length: input.totalDays }, (_, day) => byDay.get(day)!).filter(Boolean),
    geographicDays: themelessDays,
  };
}

/**
 * The index of the theme this place belongs to, or `undefined` when no theme
 * has coordinates to compare against.
 *
 * Squared degrees, not metres: every comparison here is between two distances
 * from the same place, so the monotonic transform is free and the trigonometry
 * is not. `cluster.ts` makes the same trade for the same reason.
 */
function nearestTheme(
  place: CandidatePlace,
  themes: readonly { theme: DayTheme; anchor: { latitude: number; longitude: number } }[],
): number | undefined {
  let bestIndex: number | undefined;
  let bestCost = Infinity;
  themes.forEach(({ theme, anchor }, index) => {
    const dLat = place.latitude! - anchor.latitude;
    const dLng = place.longitude! - anchor.longitude;
    const distance = dLat * dLat + dLng * dLng;
    const matches = theme.includedTypes.some((type) => place.types.includes(type));
    const cost = matches ? distance * TYPE_MATCH_DISCOUNT : distance;
    // Strictly less than: an exact tie leaves `bestIndex` on the earlier day.
    if (cost < bestCost) {
      bestCost = cost;
      bestIndex = index;
    }
  });
  return bestIndex;
}
