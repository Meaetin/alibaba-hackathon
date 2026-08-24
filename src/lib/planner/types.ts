/**
 * Shared vocabulary for the personalization pipeline. See
 * `docs/personalization-pipeline.md` for how each field is consumed.
 *
 * Naming rule this file exists to enforce: a *profile* describes the traveller
 * and drives retrieval, scoring and narration. *Options* describe the scheduler
 * and drive clustering and packing. They are never merged into one object.
 */

import type { PriceLevelOrdinal } from "@/lib/maps/price-level";

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

/**
 * One `regularOpeningHours.periods[]` entry, exactly as the Places API returns
 * it. `day` is **0 = Sunday** through 6 = Saturday — Google's numbering, kept
 * rather than translated so a payload can be diffed against the type.
 */
export interface OpeningPeriodPoint {
  day: number;
  hour: number;
  minute: number;
}

export interface OpeningPeriod {
  open: OpeningPeriodPoint;
  /**
   * Absent is Google's encoding for "always open" — it arrives as a lone period
   * at day 0, 00:00 with no close. See `hours.ts`.
   */
  close?: OpeningPeriodPoint;
}

/**
 * A retrieved place as the deterministic core consumes it — produced by
 * retrieval (Places REST) and scored/filtered/clustered without ever going
 * back to Google. Field names follow the REST response, not the DB row.
 */
export interface CandidatePlace {
  placeId: string;
  name: string;
  types: string[];
  primaryType?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  userRatingCount?: number;
  /** 0–4 ordinal via `toPriceLevelOrdinal`; undefined = Google didn't say. */
  priceLevel?: PriceLevelOrdinal;
  businessStatus?: string;
  /** Minutes; `locations.stay_duration`, backfilled from enrichment. Rung 1
   *  of the visit-duration ladder when present. */
  stayDuration?: number;
  /**
   * `regularOpeningHours.periods`. Already in retrieval's field mask, so this
   * costs nothing extra. Absent or empty means we have no hours for the place,
   * which `hours.ts` reads as always open — see the caveat there.
   */
  openingPeriods?: OpeningPeriod[];
  /**
   * Google's own answer to the dietary question, from the shortlist hydration
   * mask — **three-state**. `true`/`false` are Google's answer; `undefined`
   * means it never said, which is the common case outside chains and must
   * never be read as `false`. Absent until `hydrateShortlist` runs.
   */
  servesVegetarianFood?: boolean;
}

/**
 * Cached per place_id — profile-agnostic, pay once, TTL ~90 days. Produced by
 * the enrichment pass (Step 12), consumed by duration resolution, the dietary
 * ladder (tags) and Pass C. See "Beyond-Google Data" in the pipeline doc.
 */
export interface PlaceEnrichment {
  /** 1–2 sentences. Replaces Google's editorialSummary. */
  description: string;
  /** e.g. ["vegetarian-friendly", "outdoor-seating"] — rung 2 of the dietary ladder. */
  tags: string[];
  confidence: number;
  /** [low, high] minutes estimate — rung 2 of the visit-duration ladder. */
  avgVisitMinutes: [number, number];
  /** Feeds foodRecommendations. Grounded by enrichment, never invented by Pass C. */
  signatureDishes?: string[];
  bestTimeOfDay?: "morning" | "midday" | "sunset" | "evening";
  crowdProfile?: "quiet" | "moderate" | "packed";
}
