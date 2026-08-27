/**
 * The planner's diagnostic record — what the models said, and what we refused.
 *
 * Everything in here used to be built and then dropped inside a single request.
 * Pass B writes one sentence per stop explaining its pick and nothing read it;
 * `resolveDay` composes a plain-English reason for every id it rejects and the
 * reason died in an array. Both are exactly what you want at 2am when a day
 * comes back thin, so both get a column: `itineraries.planner_debug`.
 *
 * Two rules for this module.
 *
 * **It is diagnostics, never content.** No card renders any of it. A field here
 * may go stale, may be absent on an older row, and may be reshaped without a
 * migration — the column is `jsonb` and `version` says which shape it is.
 *
 * **It depends on nothing.** No imports from `pipeline.ts`, `assign.ts` or
 * `narrate.ts`, because those import *this*, and because `src/lib/db/schema.ts`
 * pulls `PlannerDebug` in to type the column. Per-stage counters deliberately
 * do not live here: they are already durable on `jobs.result.stats`, and a
 * second copy is a second thing to keep true.
 */

/** Bumped when the shape below changes. Read it before trusting an old row. */
export const PLANNER_DEBUG_VERSION = 2;

/**
 * One stop, and why Pass B put it there.
 *
 * The model is asked for this sentence in the same call that does the
 * assignment, so it costs nothing extra to keep and everything to regenerate.
 */
export interface AssignmentRationale {
  dayIndex: number;
  placeId: string;
  /** A stop in the day, or one of the spare picks the packer may surrender. */
  kind: "assignment" | "flex";
  why: string;
}

/**
 * One day the theme pass could not name, and why it fell back to geography.
 *
 * Shaped here rather than imported from `theme.ts` for the rule at the top of
 * this file: this module depends on nothing, because `src/lib/db/schema.ts`
 * pulls `PlannerDebug` in to type a column.
 */
export interface ThemeFallback {
  dayIndex: number;
  /** The id the model named, when it named one that does not exist. */
  anchorPlaceId?: string;
  reason: string;
}

/**
 * How a themed day that could not feed itself was repaired.
 *
 * Recorded because a repair that silently shrinks a list is the failure mode
 * this project already knows about. `rung` says which step of the ladder ran;
 * `after` still short of the target is a real outcome, not a missing field.
 */
export interface ThemeRepair {
  dayIndex: number;
  rung: "widened" | "merged" | "geographic";
  before: number;
  after: number;
  reason: string;
}

/**
 * What reordering one day's route cost and saved, in travel minutes.
 *
 * Pass B orders a day without ever seeing a coordinate, so `beforeMinutes` is
 * the price of that blindness and `savedMinutes` is what the geometry was
 * worth. `reordered: false` with a non-zero `beforeMinutes` is the good case —
 * the day was already walked in its shortest order.
 */
export interface SequencingRecord {
  dayIndex: number;
  beforeMinutes: number;
  afterMinutes: number;
  savedMinutes: number;
  reordered: boolean;
  /** Straight-line metres of the returned order. What a reader recognises. */
  meters: number;
}

/**
 * What the validator did to one day, and what it could not fix.
 *
 * The gap this closes: a live Singapore run produced a day with **zero** stops.
 * Pass B had filled it, `sequenceDay` had routed it (4.4 km, 86 minutes), and
 * then `validateDay` emptied it — and the only surviving trace was
 * `scheduling.failedDays: 1` buried in `jobs.result.stats`, which says how many
 * days went wrong and nothing about which, or why. Every field below was
 * already computed on `DayValidation` and thrown away when the request ended.
 *
 * `scheduled: 0` is the case worth grepping for: the day exists in
 * `itinerary_days`, it has a date and an area name, and there is nothing in it.
 *
 * Shapes are redeclared rather than imported from `validate.ts`, for the rule at
 * the top of this file — this module depends on nothing, because
 * `src/lib/db/schema.ts` pulls `PlannerDebug` in to type a column.
 */
export interface SchedulingRepair {
  /** `closed`, `meal_slot` or `lost_meal` — `ValidationRule` in `validate.ts`. */
  rule: string;
  role: string;
  removed: string;
  /** The swap-in by name, or null when the ladder dropped the stop instead. */
  inserted: string | null;
  reason: string;
}

/** One thing still wrong with a day after repair gave up. */
export interface SchedulingFailure {
  rule: string;
  role: string;
  placeId: string;
  name: string;
  reason: string;
}

export interface SchedulingRecord {
  dayIndex: number;
  areaName: string | null;
  /**
   * Stops the packer was offered: Pass B's assignments **plus** the flex picks
   * it may promote. Counting assignments alone reads "kept 8 of 7" on a day
   * where a spare was promoted, which is how this field was first written.
   */
  offered: number;
  /** Stops in the stored timeline. **Zero means the day shipped empty.** */
  scheduled: number;
  repairs: SchedulingRepair[];
  failures: SchedulingFailure[];
}

/** One id Pass B named that never became a stop, worded for a person. */
export interface AssignmentDrop {
  dayIndex: number;
  placeId: string;
  reason: string;
}

/** One stop that shipped `fallbackContent` instead of the model's prose. */
export interface NarrationFallback {
  placeId: string;
  message: string;
}

/**
 * The whole record, as stored.
 *
 * Read it with `planner_debug.version` in hand — an itinerary planned before a
 * field existed simply doesn't have it.
 */
export interface PlannerDebug {
  version: number;
  /** ISO, from the pipeline's injected clock. Never `new Date()`. */
  recordedAt: string;
  assignment: {
    /** Days Pass B could not fill, by `dayIndex`. The ranked shortlist filled
     *  these instead, so their stops have no `rationale` entry. */
    fallbackDays: number[];
    rationale: AssignmentRationale[];
    dropped: AssignmentDrop[];
  };
  narration: {
    /** Non-empty means the cards are prettier than the model made them. */
    fallbacks: NarrationFallback[];
    /** Stops cut off at `max_output_tokens`. A subset of `fallbacks`, named
     *  separately because the fix is a number rather than a prompt. */
    truncated: number;
    /** Dishes rejected for not being in `signature_dishes`. Non-zero is the
     *  grounding rule working, not a fault. */
    rejectedDishes: number;
  };
  enrichment: {
    /** Shortlisted places with no usable cached enrichment at plan time. These
     *  shipped on the type heuristic and were handed to the durable batch. */
    misses: string[];
  };
  /**
   * What the route reorder bought, per day.
   *
   * A day that was already in its shortest order is still listed, with
   * `savedMinutes: 0` — the question this answers is "did sequencing help", and
   * an absent row cannot tell "it made no difference" apart from "it never
   * ran". The whole field is optional for the same reason one rung up: a plan
   * made before this step existed has none, and an empty array would claim it
   * ran and saved nothing.
   */
  sequencing?: SequencingRecord[];
  /**
   * What scheduling did to each day, including the days it could not save.
   *
   * Optional for the same reason `sequencing` is: a plan made before this
   * existed has none, and an empty array would claim the validator ran and
   * found nothing wrong. Every day is listed, clean ones included — "this day
   * needed no repair" and "this day was never checked" are different answers.
   */
  scheduling?: SchedulingRecord[];
  /**
   * Themed runs only; absent on every geographic plan, which is the default.
   *
   * `fallbacks` is the answer to "why does day three have no premise" — an
   * anchor that named a place we never retrieved, two days claiming the same
   * anchor, a model that did not answer. Each one is recorded and none is
   * retried: a model that named a place we do not have will name it again, and
   * a second call is a second bill.
   */
  themes?: {
    /** What each day ended up being about, best read next to the days. */
    titles: { dayIndex: number; title: string; anchorPlaceId: string }[];
    fallbacks: ThemeFallback[];
    /** Days the feasibility ladder had to repair, and how far down it went. */
    repairs: ThemeRepair[];
  };
}

/**
 * A record with nothing in it, for a caller assembling a `PlanResult` by hand.
 *
 * Every list empty is the honest answer for a plan that did not run — not the
 * same thing as a plan that ran and had nothing to report, but indistinguishable
 * from it, which is why this is a helper and not a default.
 */
export function emptyPlannerDebug(recordedAt: string): PlannerDebug {
  return {
    version: PLANNER_DEBUG_VERSION,
    recordedAt,
    assignment: { fallbackDays: [], rationale: [], dropped: [] },
    narration: { fallbacks: [], truncated: 0, rejectedDishes: 0 },
    enrichment: { misses: [] },
    sequencing: [],
    scheduling: [],
  };
}
