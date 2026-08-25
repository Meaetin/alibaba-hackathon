/**
 * Stage 7 — a theme that cannot seat a day, repaired without asking a model.
 *
 * Theme-first has one real cost the geographic path does not: **infeasibility
 * is discovered after you have paid.** A thin geographic cluster is visible at
 * cluster time, before a cent is spent — that is what `ScoredCluster.shortfall`
 * reports. A thin *theme* is only visible after its Nearby Search has been
 * billed. This module is the mitigation, and it stays deterministic for exactly
 * that reason: a second model call here would double the latency budget on the
 * days that are already going badly.
 *
 * ## The ladder
 *
 * 1. **Widen** — search the anchor again at a larger radius.
 * 2. **Merge** — take meal-capable places from the nearest theme, nearest to
 *    this anchor first, and never enough to make the donor infeasible in turn.
 * 3. **Fall back** — give the day its plain geographic cluster and drop the
 *    premise.
 *
 * Every rung is recorded. A repair that silently shrinks a list is the bug this
 * project already knows about — see `funnel.dropped`, which exists for the same
 * reason.
 *
 * ## What "merge" means here, precisely
 *
 * Not "fuse two days into one". That would leave the trip a day short and every
 * day after it renumbered. It means the thin day **borrows** from its nearest
 * neighbour: the neighbour keeps its premise and loses a restaurant or two.
 * A day with a premise and nothing to eat is worse than two days that share a
 * ramen shop.
 */

import type { ThemedCluster } from "./group";
import { isRestaurant } from "./taxonomy";
import type { CandidatePlace } from "./types";

/** Which rung of the ladder a day ended on. `ok` means it never needed one. */
export type FeasibilityRung = "ok" | "widened" | "merged" | "geographic";

export interface FeasibilityRepair {
  dayIndex: number;
  rung: Exclude<FeasibilityRung, "ok">;
  /** Meal-capable places before the repair. */
  before: number;
  /** Meal-capable places after it. Still short of the target is a real outcome. */
  after: number;
  reason: string;
}

export interface FeasibilityDeps {
  /** Meal-capable places a day needs. `FUNNEL_DEFAULTS.mealsPerCluster`. */
  mealsPerDay: number;
  /**
   * Search this theme's anchor again, wider. Returns whatever it found —
   * including places already in the cluster, which are deduped here.
   *
   * Optional so the ladder can be tested, and run, with no network at all. A
   * caller that omits it skips rung 1 and the repair starts at merge.
   */
  widen?: (cluster: ThemedCluster) => Promise<readonly CandidatePlace[]>;
  /**
   * The plain geographic cluster for a day, for the last rung. Optional for
   * the same reason; without it, an unfixable day keeps its thin theme and
   * says so rather than being replaced by nothing.
   */
  geographicFor?: (dayIndex: number) => ThemedCluster | undefined;
}

export interface FeasibilityResult {
  clusters: ThemedCluster[];
  repairs: FeasibilityRepair[];
}

/** How many places in this cluster could seat a meal. */
export function mealCapacity(cluster: ThemedCluster): number {
  return cluster.places.filter(isRestaurant).length;
}

/**
 * Walks the ladder for every themed day that cannot feed itself.
 *
 * Days without a theme are left alone: they are already the geographic path,
 * and `ScoredCluster.shortfall` reports their thinness the way it always has.
 */
export async function repairFeasibility(
  clusters: readonly ThemedCluster[],
  deps: FeasibilityDeps,
): Promise<FeasibilityResult> {
  const working = clusters.map((cluster) => ({ ...cluster, places: [...cluster.places] }));
  const repairs: FeasibilityRepair[] = [];

  for (let index = 0; index < working.length; index++) {
    const cluster = working[index];
    if (!cluster.theme) continue;
    if (mealCapacity(cluster) >= deps.mealsPerDay) continue;

    const dayIndex = cluster.theme.dayIndex;
    const before = mealCapacity(cluster);

    // Rung 1 — widen.
    if (deps.widen) {
      const found = await deps.widen(cluster);
      const known = new Set(cluster.places.map((place) => place.placeId));
      const added = found.filter((place) => !known.has(place.placeId));
      if (added.length > 0) {
        cluster.places.push(...added);
        const after = mealCapacity(cluster);
        if (after > before) {
          repairs.push({
            dayIndex,
            rung: "widened",
            before,
            after,
            reason: `searched wider and found ${after - before} more place${after - before === 1 ? "" : "s"} to eat`,
          });
        }
        if (after >= deps.mealsPerDay) continue;
      }
    }

    // Rung 2 — borrow from the nearest theme that can spare it.
    const borrowedFrom = borrow(working, index, deps.mealsPerDay);
    if (borrowedFrom !== undefined) {
      repairs.push({
        dayIndex,
        rung: "merged",
        before,
        after: mealCapacity(cluster),
        reason: `took places to eat from ${working[borrowedFrom].theme?.title ?? "the nearest day"}`,
      });
      if (mealCapacity(cluster) >= deps.mealsPerDay) continue;
    }

    // Rung 3 — give up the premise and take the geography.
    const geographic = deps.geographicFor?.(dayIndex);
    if (geographic && mealCapacity(geographic) > mealCapacity(cluster)) {
      working[index] = { ...geographic, theme: undefined };
      repairs.push({
        dayIndex,
        rung: "geographic",
        before,
        after: mealCapacity(geographic),
        reason: "the theme could not seat a day, so this day is planned by neighbourhood instead",
      });
    }
  }

  return { clusters: working, repairs };
}

/**
 * Moves meal-capable places from the nearest theme into `index`, nearest to the
 * borrower's anchor first.
 *
 * Two rules make this a repair rather than a robbery. The donor is chosen by
 * **anchor distance**, so the borrowed restaurant is one the traveller could
 * plausibly reach on the borrowing day; and the donor is never taken below its
 * own feasibility, or the repair simply moves the problem one day along.
 *
 * Returns the donor's index, or `undefined` when nobody could spare anything.
 */
function borrow(
  clusters: ThemedCluster[],
  index: number,
  mealsPerDay: number,
): number | undefined {
  const borrower = clusters[index];
  const need = mealsPerDay - mealCapacity(borrower);
  if (need <= 0) return undefined;

  const donors = clusters
    .map((cluster, i) => ({ cluster, i }))
    .filter(({ cluster, i }) => i !== index && mealCapacity(cluster) > mealsPerDay)
    .sort(
      (a, b) =>
        squaredDistance(borrower.centroid, a.cluster.centroid) -
        squaredDistance(borrower.centroid, b.cluster.centroid),
    );

  for (const { cluster: donor, i } of donors) {
    const spare = mealCapacity(donor) - mealsPerDay;
    if (spare <= 0) continue;
    const moving = donor.places
      .filter(isRestaurant)
      .sort(
        (a, b) =>
          squaredDistance(pointOf(a), borrower.centroid) -
          squaredDistance(pointOf(b), borrower.centroid),
      )
      .slice(0, Math.min(spare, need));
    if (moving.length === 0) continue;

    const moved = new Set(moving.map((place) => place.placeId));
    donor.places = donor.places.filter((place) => !moved.has(place.placeId));
    borrower.places.push(...moving);
    return i;
  }
  return undefined;
}

/** Squared degrees. Every comparison here is between two distances from the
 *  same point, so the monotonic transform is free and trigonometry is not. */
function squaredDistance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const dLat = a.latitude - b.latitude;
  const dLng = a.longitude - b.longitude;
  return dLat * dLat + dLng * dLng;
}

/** A place with no coordinates sorts to the far end rather than crashing —
 *  it can still be borrowed, just last. */
function pointOf(place: CandidatePlace): { latitude: number; longitude: number } {
  return { latitude: place.latitude ?? 1e6, longitude: place.longitude ?? 1e6 };
}
