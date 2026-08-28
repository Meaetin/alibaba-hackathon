/**
 * Travel legs with nothing on the wire.
 *
 * This is what the planner uses when it is not paying Google. `routes.ts` still
 * exists and still measures, but it bills per element — two matrices over every
 * pair of a day's stops, its spares and its replacements, which came to 29,310
 * elements across a couple of weeks of demo trips. Nothing cached a leg, so the
 * walk from Merlion Park to Gardens by the Bay was bought again on every
 * replan. `PipelineDeps.routing` defaults to `"estimate"` and lands here.
 *
 * **What replaced measurement is a model, and it was fitted, not guessed.**
 * The old stand-in divided crow-flight metres by 80 and called anything under
 * 1200 m a walk. Checked against 81 legs Google really routed — seven
 * travellers, sixteen complete days of a live Singapore run — it understated a
 * leg on **53 of them and overstated on 3**, and understated a whole day's
 * travel by 525 minutes out of 2440. That bias is not a rounding error: the
 * packer believes the day is 22% emptier than it is, fills the space, and then
 * the validator drops the stops that do not fit. Days that shipped two stops
 * out of eight offered were partly this.
 *
 * Three constants carry the fit, and each is a real quantity rather than a
 * fudge factor:
 *
 * - **`STREET_DETOUR_FACTOR`** — streets do not go where the crow goes. Over
 *   those 81 legs Google's distance was a median **1.52x** the great-circle one
 *   and 1.64x weighted by length. 1.5 is that number.
 * - **`WALK_M_PER_MIN`** — 80 metres of *street* per minute, 4.8 km/h.
 * - **`TRANSIT_BOARDING_MINUTES` / `TRANSIT_M_PER_MIN`** — eight minutes to
 *   reach a stop and wait, then 225 street metres a minute, about 13.5 km/h
 *   door to door. Google's transit durations already include the wait, which is
 *   what makes the two totals directly comparable.
 *
 * After: mean error per leg **3.8 minutes against 7.3**, distance error 434 m
 * against 844 m, the systematic undercount gone (18 legs over, 19 under), and a
 * day's total travel out by 4% rather than 22%. Fitting on six travellers and
 * testing on the seventh held up — the held-out error ran 1.9 to 6.4 minutes,
 * so these are not seven trips' worth of overfitting.
 *
 * **What is genuinely lost is the mode, and it cannot be bought back offline.**
 * Whether the 131 bus beats the walk needs a timetable, and nobody gives those
 * away at city scale. So the choice is a threshold again — the exact thing
 * `routes.ts` was written to stop doing. It agrees with Google's measured
 * choice on 89% of those 81 legs, which is better than it sounds and is still a
 * guess. `PlanStats.travel.source` says which of the two answered, per plan,
 * so a trip built on the model can never be mistaken for a routed one.
 */

import { metersBetween as greatCircleMeters } from "./geo";
import { WALK_MAX_METERS, type TravelLeg, type TravelLegProvider } from "./pack";
// The margin comes from `routes.ts` on purpose. "When is boarding worth it" is
// one question, and a measured leg and an estimated one answering it differently
// would put two travellers on different buses for the same reason.
import { TRANSIT_MIN_SAVING_MINUTES } from "./routes";
import type { CandidatePlace } from "./types";

/** Street metres per crow-flight metre. Median 1.52 over 81 routed legs. */
export const STREET_DETOUR_FACTOR = 1.5;

/** Walking pace, in street metres per minute. */
export const WALK_M_PER_MIN = 80;

/** Reaching a stop and waiting for the service, before a metre is travelled. */
export const TRANSIT_BOARDING_MINUTES = 8;

/** Transit pace once moving, in street metres per minute. */
export const TRANSIT_M_PER_MIN = 225;

export interface TravelEstimateStats {
  /**
   * Distinct ordered pairs answered, by the mode they came back as. The
   * provider memoizes, so a pair the packer asks about four hundred times is
   * counted once — these are pairs, not lookups, unlike `estimated` on
   * `TravelMatrixStats`.
   */
  walk: number;
  transit: number;
}

export interface TravelEstimate {
  getTravelLeg: TravelLegProvider;
  stats: TravelEstimateStats;
}

/**
 * A memoized provider and the counters it fills as it goes.
 *
 * Same shape as `buildTravelMatrix`, deliberately: the pipeline picks one or
 * the other and everything downstream must not be able to tell which.
 *
 * `walkMaxMeters` is the traveller's own tolerance from `knobs.ts` — 800 metres
 * polished, 1200 easygoing, 2000 rugged. Below it nobody boards anything, so
 * the leg is a walk whatever the arithmetic says. Above it the two totals
 * compete, and transit has to win by `TRANSIT_MIN_SAVING_MINUTES` before it is
 * worth a platform. Passing the knob in here rather than reading it in `pack.ts`
 * is what keeps a leg coherent: the minutes and the mode now come out of one
 * decision, instead of the minutes being walking arithmetic while the label
 * came from a separate threshold that never touched them.
 */
export function createTravelEstimate(walkMaxMeters: number = WALK_MAX_METERS): TravelEstimate {
  const cache = new Map<string, TravelLeg>();
  const stats: TravelEstimateStats = { walk: 0, transit: 0 };

  const getTravelLeg: TravelLegProvider = (from, to) => {
    // `\u0000`, escaped rather than typed. A literal NUL byte in the source
    // makes grep and ripgrep classify this whole file as binary and skip it
    // silently — the file stops appearing in code search and nothing warns you.
    const key = `${from.placeId}\u0000${to.placeId}`;
    const hit = cache.get(key);
    if (hit) return hit;

    const meters = Math.round(crowMeters(from, to) * STREET_DETOUR_FACTOR);
    const walkMinutes = meters / WALK_M_PER_MIN;
    const transitMinutes = TRANSIT_BOARDING_MINUTES + meters / TRANSIT_M_PER_MIN;
    const transit =
      meters >= walkMaxMeters && transitMinutes <= walkMinutes - TRANSIT_MIN_SAVING_MINUTES;

    const leg: TravelLeg = {
      // Up, never to nearest. `pack.ts` puts the leg on the five-minute grid
      // with `ceilToStep`, and ceiling to the whole minute first cannot change
      // where that lands — so this is free — while rounding to nearest can:
      // a 10.2-minute leg becomes 10 and then 10, where the honest answer is
      // 15. That is a five-minute undercount on roughly one leg in ten, which
      // is the exact bias this model was fitted to remove.
      minutes: Math.ceil(transit ? transitMinutes : walkMinutes),
      meters,
      mode: transit ? "transit" : "walk",
    };
    if (transit) stats.transit += 1;
    else stats.walk += 1;
    cache.set(key, leg);
    return leg;
  };

  return { getTravelLeg, stats };
}

/** Zero for a place with no coordinates: a leg is minutes, and `NaN` minutes
 *  would poison every arrival time downstream. Clustering already dropped
 *  those, so only a hand-built input reaches it. */
function crowMeters(from: CandidatePlace, to: CandidatePlace): number {
  if (
    from.latitude === undefined ||
    from.longitude === undefined ||
    to.latitude === undefined ||
    to.longitude === undefined
  ) {
    return 0;
  }
  return greatCircleMeters(
    { latitude: from.latitude, longitude: from.longitude },
    { latitude: to.latitude, longitude: to.longitude },
  );
}
