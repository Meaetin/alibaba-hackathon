/**
 * Shared vocabulary for the personalization pipeline. See
 * `docs/personalization-pipeline.md` for how each field is consumed.
 *
 * Naming rule this file exists to enforce: a *profile* describes the traveller
 * and drives retrieval, scoring and narration. *Options* describe the scheduler
 * and drive clustering and packing. They are never merged into one object.
 */

/** Fixed taxonomy. Adding a member means adding a row to the taxonomy bridge. */
export type Interest =
  | "outdoors"
  | "cafes"
  | "temples"
  | "museums"
  | "food"
  | "nightlife"
  | "shopping";

export type Pace = "relaxed" | "balanced" | "packed";

/** Google `priceLevel` ordinal. `undefined` means the user didn't say. */
export type BudgetLevel = 1 | 2 | 3 | 4;

export interface PreferenceProfile {
  /** Soft weights — influence ranking, never filter. */
  interests: Interest[];
  /** HARD constraints. A vegetarian shown a steakhouse is a system failure. */
  dietary: string[];
  pace: Pace;
  /**
   * Not yet wired to a UI. The backend reads it wherever the frontend ends up
   * collecting it (onboarding chips or the create-itinerary modal), so the
   * placement decision can stay open.
   */
  budget?: BudgetLevel;
  /** Learned from saves/removals. Absent until the learning loop ships. */
  typeAffinities?: Record<string, number>;
}

/** Scheduler knobs. Nothing here describes the traveller. */
export interface SchedulerOptions {
  maxK?: number;
  kmeansInitMethod?: "kmeans++" | "random" | "grid";
  maxIterations?: number;
  /** "HH:MM" wall clock bounds for a planned day. */
  startTime?: string;
  endTime?: string;
}
