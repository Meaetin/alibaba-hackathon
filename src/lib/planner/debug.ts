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
export const PLANNER_DEBUG_VERSION = 1;

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
  };
}
