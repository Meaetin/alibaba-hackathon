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

import { metersBetween } from "./geo";
import { MEMBER_RADIUS_SLACK, type ThemedCluster } from "./group";
import { violatesDietaryNeed } from "./score";
import { isRestaurant } from "./taxonomy";
import { radiusFor, type DayTheme } from "./theme";
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
   * The traveller's dietary needs, so "can this day feed itself" is asked about
   * *this* traveller rather than about restaurants in general.
   *
   * Omitted means no needs, which counts exactly as this module counted before
   * — that equivalence is what keeps every existing day planning identically.
   */
  dietary?: readonly string[];
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

/**
 * One day that entered the ladder, and everything that happened to it.
 *
 * `repairs` only ever held rungs that *worked* — a repair is pushed when
 * `after > before` — so a day that walked all three rungs and fixed nothing
 * left no trace at all. A live Bali day did exactly that: zero places to eat,
 * widened (found none), tried to borrow (no donor in reach), tried the
 * geographic fallback (no better), and the only surviving evidence anywhere was
 * `validateDay` reporting `lost_meal` at the very end of the run.
 *
 * Every day that needed the ladder is listed here, fixed or not. That is the
 * same rule `SchedulingRecord` keeps and for the same reason: "it tried and
 * failed" and "it never ran" are different answers, and a missing row cannot
 * tell them apart.
 */
export interface FeasibilityAttempt {
  dayIndex: number;
  /** Meal-capable places when the day entered the ladder. */
  before: number;
  /** Meal-capable places when it left. Still short is a real outcome. */
  after: number;
  /** Meals the day needed — `after < needed` means it is still short. */
  needed: number;
  /** Rungs actually walked, in order. A rung that changed nothing is still here. */
  tried: Exclude<FeasibilityRung, "ok">[];
  /** True when the day left the ladder still unable to feed itself. */
  unfixed: boolean;
}

export interface FeasibilityResult {
  clusters: ThemedCluster[];
  repairs: FeasibilityRepair[];
  /** Every day that needed the ladder, whether or not it got what it needed. */
  attempts: FeasibilityAttempt[];
}

/**
 * How many places in this cluster could seat a meal **for this traveller**.
 *
 * The dietary half is not decoration. Counting bare `isRestaurant` let a
 * vegetarian's cluster of five steakhouses read as perfectly feasible: the
 * ladder never fired, nothing was widened, nothing was borrowed, and the
 * traveller met the problem at `selectMealCandidates` rung 3 — "limited
 * vegetarian options, call ahead" — after every circle had been billed. The
 * ladder can only repair a shortage it can see.
 *
 * `violatesDietaryNeed` is imported from `score.ts` rather than re-derived, so
 * the stage that *counts* meal capacity and the stage that later *enforces* it
 * cannot disagree. It is the same two-rung rule: Google's own boolean where it
 * answered, the type list where it was silent.
 *
 * No needs counts exactly as before, which is what keeps every non-dietary
 * traveller's plan identical.
 */
export function mealCapacity(cluster: ThemedCluster, dietary: readonly string[] = []): number {
  return cluster.places.filter((place) => canSeatMeal(place, dietary)).length;
}

/** `isRestaurant`, narrowed to what this traveller may actually eat. */
function canSeatMeal(place: CandidatePlace, dietary: readonly string[]): boolean {
  return isRestaurant(place) && !dietary.some((need) => violatesDietaryNeed(place, need));
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
  const attempts: FeasibilityAttempt[] = [];
  const dietary = deps.dietary ?? [];

  for (let index = 0; index < working.length; index++) {
    const cluster = working[index];
    if (!cluster.theme) continue;
    if (mealCapacity(cluster, dietary) >= deps.mealsPerDay) continue;

    const dayIndex = cluster.theme.dayIndex;
    const before = mealCapacity(cluster, dietary);
    // Pushed on entry and mutated as the ladder walks, so a day that falls out
    // of any rung below via `continue` is still on the record.
    const attempt: FeasibilityAttempt = {
      dayIndex,
      before,
      after: before,
      needed: deps.mealsPerDay,
      tried: [],
      unfixed: true,
    };
    attempts.push(attempt);
    const settle = (): void => {
      attempt.after = mealCapacity(working[index], dietary);
      attempt.unfixed = attempt.after < deps.mealsPerDay;
    };

    // Rung 1 — widen.
    if (deps.widen) {
      attempt.tried.push("widened");
      const found = await deps.widen(cluster);
      const known = new Set(cluster.places.map((place) => place.placeId));
      const added = found.filter((place) => !known.has(place.placeId));
      if (added.length > 0) {
        cluster.places.push(...added);
        const after = mealCapacity(cluster, dietary);
        if (after > before) {
          repairs.push({
            dayIndex,
            rung: "widened",
            before,
            after,
            reason: `searched wider and found ${after - before} more place${after - before === 1 ? "" : "s"} to eat`,
          });
        }
        if (after >= deps.mealsPerDay) {
          settle();
          continue;
        }
      }
    }

    // Rung 2 — borrow from the nearest theme that can spare it.
    attempt.tried.push("merged");
    const borrowedFrom = borrow(working, index, deps.mealsPerDay, reachOf(cluster.theme), dietary);
    if (borrowedFrom !== undefined) {
      repairs.push({
        dayIndex,
        rung: "merged",
        before,
        after: mealCapacity(cluster, dietary),
        reason: `took places to eat from ${working[borrowedFrom].theme?.title ?? "the nearest day"}`,
      });
      if (mealCapacity(cluster, dietary) >= deps.mealsPerDay) {
        settle();
        continue;
      }
    }

    // Rung 3 — give up the premise and take the geography.
    if (deps.geographicFor) attempt.tried.push("geographic");
    const geographic = deps.geographicFor?.(dayIndex);
    if (geographic && mealCapacity(geographic, dietary) > mealCapacity(cluster, dietary)) {
      working[index] = { ...geographic, theme: undefined };
      repairs.push({
        dayIndex,
        rung: "geographic",
        before,
        after: mealCapacity(geographic, dietary),
        reason: "the theme could not seat a day, so this day is planned by neighbourhood instead",
      });
    }
    settle();
  }

  return { clusters: working, repairs, attempts };
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
  reach: number,
  dietary: readonly string[],
): number | undefined {
  const borrower = clusters[index];
  const need = mealsPerDay - mealCapacity(borrower, dietary);
  if (need <= 0) return undefined;

  const donors = clusters
    .map((cluster, i) => ({ cluster, i }))
    .filter(({ cluster, i }) => i !== index && mealCapacity(cluster, dietary) > mealsPerDay)
    .sort(
      (a, b) =>
        squaredDistance(borrower.centroid, a.cluster.centroid) -
        squaredDistance(borrower.centroid, b.cluster.centroid),
    );

  for (const { cluster: donor, i } of donors) {
    const spare = mealCapacity(donor, dietary) - mealsPerDay;
    if (spare <= 0) continue;
    const moving = donor.places
      // What is borrowed has to be edible by the borrower. Lending a vegetarian
      // five steakhouses satisfies the arithmetic and feeds nobody.
      .filter((place) => canSeatMeal(place, dietary))
      .filter((place) => withinReach(place, borrower.centroid, reach))
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

/**
 * The reach a borrowed place must sit inside, matching `groupByTheme`'s cap so
 * one rule governs both halves.
 *
 * There is no opt-out. It used to return `Infinity` when the caller passed no
 * `walkMaxMeters`, which was a way for rung 2 to hand back exactly what
 * membership had just refused — the day then reads as repaired, with its two
 * restaurants, while the packer still spends the morning on transit.
 *
 * It takes the theme rather than the cluster because the loop above skips a
 * themeless cluster outright, so "this day has no circle" was a branch nothing
 * could reach.
 */
function reachOf(theme: DayTheme): number {
  return radiusFor(theme.radiusHint) * MEMBER_RADIUS_SLACK;
}

/**
 * A place with no coordinates is refused whenever there is a bound to check it
 * against: unreachable is the safe reading of unknown, and the alternative is
 * feeding `pointOf`'s sentinel latitude into trigonometry that happily returns
 * a small number for it.
 */
function withinReach(
  place: CandidatePlace,
  centre: { latitude: number; longitude: number },
  reach: number,
): boolean {
  if (reach === Infinity) return true;
  if (place.latitude === undefined || place.longitude === undefined) return false;
  return metersBetween({ latitude: place.latitude, longitude: place.longitude }, centre) <= reach;
}
