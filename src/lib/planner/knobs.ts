/**
 * One file, one table: everything the traveller's persona is allowed to move,
 * and who wins when two axes reach for the same constant.
 *
 * ## Why the axes get new names here
 *
 * `DimensionScores` uses `structure`, `comfort`, `focus`, `social`, and two of
 * those are scored **opposite to how they read** — `structure: 90` is the
 * *least* structure, `comfort: 90` is tolerating the *most* discomfort. That
 * naming matches the quiz methodology doc and the scoring tables in `quiz.ts`,
 * so it stays; it is the wire format. The planner converts once, at this
 * boundary, into `PersonaAxes`, whose names cannot be read backwards. Same
 * discipline `retrieval.ts` already applies to Google's response shapes.
 *
 * ## Why one resolver rather than a knob per module
 *
 * Four pairs of axes collide — two inputs reaching for the same constant in
 * opposite directions — and a collision resolved at two call sites is resolved
 * twice, differently, eventually. Each rule is stated on the field it governs:
 *
 * 1. **`immersion` owns fame.** Deep immersion wants a penalty on famous
 *    places; high spontaneity wants more obscure ones to qualify as finds.
 *    Applied independently they stack, and the trip becomes fifteen places with
 *    forty reviews each. `spontaneity` may move only the serendipity threshold.
 * 2. **`comfortTolerance` owns the price curve.** Polished says don't send me
 *    to the hawker stall; deep immersion says the hawker stall is the point.
 *    `immersion` exempts specific types instead of reshaping the curve.
 * 3. **`pace` owns minutes; `spontaneity` owns openness.** A user can choose
 *    `packed` and score 90 on spontaneity. Generalised: a thing the user typed
 *    beats a thing the quiz inferred. That is also what demotes `derivePace`
 *    to a fallback.
 * 4. Where this and `docs/quiz-pipeline-bridge.md` overlap, the bridge wins —
 *    except where it collides with the rule below, which is settled.
 *
 * ## Absent persona means today, exactly
 *
 * `resolvePlannerKnobs(profile, undefined, pace)` returns the constants this
 * planner used before personas existed, field for field, and `knobs.test.ts`
 * asserts it. That is what lets the Gate A snapshots stay still for a traveller
 * who never took the quiz.
 *
 * The `mid` row of every table below **is** that default row. One table, one
 * rule: a genuinely middling traveller gets the unopinionated plan. Two places
 * where the bridge proposes a mid value that is not today's — a 0.1 popularity
 * weight, one social venue a day — lose to that, and are marked where they sit.
 */

import type { DimensionScores, PersonaResult } from "@/lib/persona/types";

import type { DurationBias } from "./pack";
import type { Pace, PreferenceProfile } from "./types";

// ── the axes ─────────────────────────────────────────────────────────────────

/**
 * The four quiz dimensions under names that read the way they score. Every one
 * is 0–100 and every one increases in the direction its name says.
 */
export interface PersonaAxes {
  /** `structure`. 0 = plans everything, 100 = decides on the day. */
  spontaneity: number;
  /** `comfort`. 0 = wants it polished, 100 = happy roughing it. */
  comfortTolerance: number;
  /** `focus`. 0 = the famous things, 100 = one subject, followed properly. */
  immersion: number;
  /** `social`. 0 = wants company, 100 = wants to be alone. */
  solitude: number;
}

/**
 * The rename, in one place. A test pins all twelve archetype centre points
 * through it, so a future edit cannot silently flip an axis.
 */
export function toPersonaAxes(dimensions: DimensionScores): PersonaAxes {
  return {
    spontaneity: dimensions.structure,
    comfortTolerance: dimensions.comfort,
    immersion: dimensions.focus,
    solitude: dimensions.social,
  };
}

// ── bands ────────────────────────────────────────────────────────────────────

/**
 * Anything a model reads gets a word; deterministic knobs get the raw number.
 * A model will not reliably tell 45 from 55, and asking it to is how a prompt
 * acquires a precision it never had.
 */
export const BAND_WORDS = {
  spontaneity: ["planned", "flexible", "improvised"],
  comfortTolerance: ["polished", "easygoing", "rugged"],
  immersion: ["highlights", "mixed", "deep"],
  solitude: ["group", "either", "solo"],
} as const;

export type PersonaAxisKey = keyof typeof BAND_WORDS;

export interface PersonaBands {
  spontaneity: (typeof BAND_WORDS.spontaneity)[number];
  comfortTolerance: (typeof BAND_WORDS.comfortTolerance)[number];
  immersion: (typeof BAND_WORDS.immersion)[number];
  solitude: (typeof BAND_WORDS.solitude)[number];
}

/** Inclusive upper bound of the low band. */
const LOW_MAX = 33;
/** Inclusive upper bound of the mid band. */
const MID_MAX = 66;

type BandIndex = 0 | 1 | 2;

function bandIndex(value: number): BandIndex {
  if (value <= LOW_MAX) return 0;
  if (value <= MID_MAX) return 1;
  return 2;
}

export function bandsOf(axes: PersonaAxes): PersonaBands {
  return {
    spontaneity: BAND_WORDS.spontaneity[bandIndex(axes.spontaneity)],
    comfortTolerance: BAND_WORDS.comfortTolerance[bandIndex(axes.comfortTolerance)],
    immersion: BAND_WORDS.immersion[bandIndex(axes.immersion)],
    solitude: BAND_WORDS.solitude[bandIndex(axes.solitude)],
  };
}

/** What a traveller who never took the quiz reads as, on every axis. */
export const NEUTRAL_BANDS: PersonaBands = {
  spontaneity: "flexible",
  comfortTolerance: "easygoing",
  immersion: "mixed",
  solitude: "either",
};

/** The bands of a persona, or the neutral row when there is none. */
export function bandsFor(persona: PersonaResult | undefined): PersonaBands {
  return persona ? bandsOf(toPersonaAxes(persona.dimensions)) : NEUTRAL_BANDS;
}

// ── the knobs ────────────────────────────────────────────────────────────────

/**
 * The four scoring terms and their weights. Always renormalised to sum to 1, so
 * a table entry states an *intent* ("quality matters half again as much") and
 * the resolver does the arithmetic. `popularity` is the fourth term the bridge's
 * `getFocusScoringAdjustments` needed and `score.ts` had no home for.
 */
export interface ScoreWeights {
  affinity: number;
  quality: number;
  priceFit: number;
  popularity: number;
}

export interface PlannerKnobs {
  weights: ScoreWeights;
  /**
   * Subtracted from a place's score in proportion to how famous it is. Owned by
   * `immersion` alone — see collision 1 at the top of this file.
   */
  touristTrapPenalty: number;
  /** Wildcard picks for the whole trip. `spontaneity`. */
  serendipityPerTrip: number;
  /** Review-count ceiling for "great but not famous". `spontaneity`, bounded. */
  serendipityMaxReviews: number;
  /** Slots left loose rather than named. `spontaneity` owns openness. */
  flexPerDay: number;
  /** How far `widenBudget` may walk. 0 when the traveller stated no budget —
   *  there is nothing to widen from. `comfortTolerance`. */
  budgetWidenSteps: number;
  /**
   * Whether being well *below* budget counts against a place. Today's curve is
   * asymmetric — cheap is a perfect fit — and that stays true for everyone
   * except the traveller who said they want it polished.
   */
  priceFitPenalisesBelow: boolean;
  /**
   * Google types that `priceFitPenalisesBelow` never applies to. How `immersion`
   * says "the market is the point" without reshaping a curve it does not own.
   */
  cheapTypeExemptions: readonly string[];
  /** Under this, you walk. `comfortTolerance`. */
  walkMaxMeters: number;
  /** What a sit-down meal occupies. `solitude` — shared tables run long. */
  mealMinutes: number;
  /**
   * Which end of a visit's range to plan for. **`pace` sets the floor and
   * `immersion` may raise it by one step, never lower it** — a traveller who
   * typed `packed` still gets a brisk day, but a deep-immersion one does not
   * get the forty-five-minute version of the temple the day was built around.
   */
  visitDurationBias: DurationBias;
  /**
   * Preferred `PlaceEnrichment.crowdProfile`. **A no-op on a cold city**:
   * enrichment is a 24-hour batch, so the first plan for a city has none of it
   * and this knob moves nothing. That is acceptable, not hidden.
   */
  crowdPreference?: "quiet" | "moderate" | "packed";
  /** Places a day should hold that are worth being at with other people. */
  minSocialVenuesPerDay: number;
}

/**
 * Exactly what this planner did before personas existed. Every `mid` band
 * resolves to this row, and so does an absent persona; `knobs.test.ts` holds
 * both halves of that.
 */
export const DEFAULT_KNOBS: Omit<PlannerKnobs, "visitDurationBias" | "budgetWidenSteps"> = {
  // `WEIGHTS` in `score.ts`, plus the popularity term at zero — which is what
  // "there is no popularity term" means once the term exists.
  weights: { affinity: 0.4, quality: 0.35, priceFit: 0.25, popularity: 0 },
  touristTrapPenalty: 0,
  // Zero, not one: `pickSerendipity` has been written and unreachable since it
  // was added, so "today's behaviour" is no wildcard at all.
  serendipityPerTrip: 0,
  serendipityMaxReviews: 500,
  flexPerDay: 1,
  priceFitPenalisesBelow: false,
  cheapTypeExemptions: [],
  walkMaxMeters: 1200,
  mealMinutes: 75,
  crowdPreference: undefined,
  // The bridge proposes 1 at mid. It loses to "absent means today", and today
  // nothing counts social venues at all.
  minSocialVenuesPerDay: 0,
};

/** The most `widenBudget` can walk on the 0–4 ordinal. */
const MAX_BUDGET_WIDEN_STEPS = 3;

/** Types a deep-immersion traveller is never talked out of on price. */
const CHEAP_TYPE_EXEMPTIONS = ["market", "food_court"] as const;

const DURATION_BIAS_ORDER: readonly DurationBias[] = ["min", "preferred", "max"];

// ── per-axis tables ──────────────────────────────────────────────────────────

/**
 * `immersion` owns quality, popularity and fame. The mid column is today's.
 *
 * Weights are pre-normalisation intents: `deep` asks for quality half again as
 * heavy, `highlights` asks for a real popularity term, and `resolvePlannerKnobs`
 * divides through so the four still sum to 1.
 */
const IMMERSION: Record<
  PersonaBands["immersion"],
  Pick<PlannerKnobs, "touristTrapPenalty" | "cheapTypeExemptions"> & {
    quality: number;
    popularity: number;
    /** Steps `visitDurationBias` may be raised above what pace chose. */
    durationLift: number;
  }
> = {
  highlights: {
    quality: 0.3,
    popularity: 0.25,
    touristTrapPenalty: 0,
    cheapTypeExemptions: [],
    durationLift: 0,
  },
  mixed: {
    quality: 0.35,
    popularity: 0,
    touristTrapPenalty: 0,
    cheapTypeExemptions: [],
    durationLift: 0,
  },
  deep: {
    quality: 0.45,
    popularity: 0,
    touristTrapPenalty: 0.15,
    cheapTypeExemptions: CHEAP_TYPE_EXEMPTIONS,
    durationLift: 1,
  },
};

/** `spontaneity` owns openness, and the serendipity threshold only. */
const SPONTANEITY: Record<
  PersonaBands["spontaneity"],
  Pick<PlannerKnobs, "serendipityPerTrip" | "serendipityMaxReviews" | "flexPerDay">
> = {
  planned: { serendipityPerTrip: 0, serendipityMaxReviews: 250, flexPerDay: 0 },
  flexible: { serendipityPerTrip: 0, serendipityMaxReviews: 500, flexPerDay: 1 },
  improvised: { serendipityPerTrip: 1, serendipityMaxReviews: 1500, flexPerDay: 2 },
};

/** `comfortTolerance` owns the price curve, the walk and how far budget bends. */
const COMFORT: Record<
  PersonaBands["comfortTolerance"],
  Pick<PlannerKnobs, "walkMaxMeters" | "priceFitPenalisesBelow"> & { widenSteps: number }
> = {
  polished: { walkMaxMeters: 800, priceFitPenalisesBelow: true, widenSteps: 1 },
  easygoing: { walkMaxMeters: 1200, priceFitPenalisesBelow: false, widenSteps: 3 },
  rugged: { walkMaxMeters: 2000, priceFitPenalisesBelow: false, widenSteps: 3 },
};

/** `solitude` owns how long a meal runs and who a day is shaped for. */
const SOLITUDE: Record<
  PersonaBands["solitude"],
  Pick<PlannerKnobs, "mealMinutes" | "minSocialVenuesPerDay" | "crowdPreference">
> = {
  group: { mealMinutes: 95, minSocialVenuesPerDay: 2, crowdPreference: "packed" },
  either: { mealMinutes: 75, minSocialVenuesPerDay: 0, crowdPreference: undefined },
  solo: { mealMinutes: 60, minSocialVenuesPerDay: 0, crowdPreference: "quiet" },
};

/**
 * What `pace` alone says about visit length — `PACE_PLANS[pace].durationBias`,
 * restated here rather than imported so this module has no runtime dependency
 * on the packer. The pair is pinned in `knobs.test.ts`.
 */
const PACE_DURATION_BIAS: Record<Pace, DurationBias> = {
  relaxed: "max",
  balanced: "preferred",
  packed: "min",
};

// ── the resolver ─────────────────────────────────────────────────────────────

/**
 * The traveller, the persona and the pace they typed, resolved into every
 * constant the planner is allowed to vary. No module below reads a
 * `PersonaResult`: each takes the one knob it needs as a parameter, the way
 * `rng` and `now` are already injected.
 */
export function resolvePlannerKnobs(
  profile: PreferenceProfile,
  persona: PersonaResult | undefined,
  pace: Pace,
): PlannerKnobs {
  const paceBias = PACE_DURATION_BIAS[pace];
  // No budget means nothing to widen from. Stated here rather than inside
  // `widenBudget`, which already reads `profile.budget` and would otherwise
  // decide the same thing twice.
  const widenCeiling = profile.budget == null ? 0 : MAX_BUDGET_WIDEN_STEPS;

  if (!persona) {
    return {
      ...DEFAULT_KNOBS,
      visitDurationBias: paceBias,
      budgetWidenSteps: Math.min(COMFORT.easygoing.widenSteps, widenCeiling),
    };
  }

  const bands = bandsOf(toPersonaAxes(persona.dimensions));
  const immersion = IMMERSION[bands.immersion];
  const spontaneity = SPONTANEITY[bands.spontaneity];
  const comfort = COMFORT[bands.comfortTolerance];
  const solitude = SOLITUDE[bands.solitude];

  return {
    weights: normalise({
      affinity: DEFAULT_KNOBS.weights.affinity,
      quality: immersion.quality,
      priceFit: DEFAULT_KNOBS.weights.priceFit,
      popularity: immersion.popularity,
    }),
    touristTrapPenalty: immersion.touristTrapPenalty,
    cheapTypeExemptions: immersion.cheapTypeExemptions,
    serendipityPerTrip: spontaneity.serendipityPerTrip,
    serendipityMaxReviews: spontaneity.serendipityMaxReviews,
    flexPerDay: spontaneity.flexPerDay,
    walkMaxMeters: comfort.walkMaxMeters,
    priceFitPenalisesBelow: comfort.priceFitPenalisesBelow,
    budgetWidenSteps: Math.min(comfort.widenSteps, widenCeiling),
    mealMinutes: solitude.mealMinutes,
    minSocialVenuesPerDay: solitude.minSocialVenuesPerDay,
    crowdPreference: solitude.crowdPreference,
    visitDurationBias: liftDurationBias(paceBias, immersion.durationLift),
  };
}

/** Collision 3, in one line: pace is the floor, immersion may only raise. */
function liftDurationBias(base: DurationBias, lift: number): DurationBias {
  const index = DURATION_BIAS_ORDER.indexOf(base);
  return DURATION_BIAS_ORDER[Math.min(DURATION_BIAS_ORDER.length - 1, index + lift)];
}

/**
 * The four terms, divided through by their sum. A table entry says how much a
 * term matters relative to the others; the scorer needs them to sum to 1 or its
 * output stops being comparable across travellers.
 */
function normalise(weights: ScoreWeights): ScoreWeights {
  const total = weights.affinity + weights.quality + weights.priceFit + weights.popularity;
  if (total <= 0) return { ...DEFAULT_KNOBS.weights };
  return {
    affinity: weights.affinity / total,
    quality: weights.quality / total,
    priceFit: weights.priceFit / total,
    popularity: weights.popularity / total,
  };
}
