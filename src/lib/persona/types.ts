/**
 * Shared vocabulary for the Travel Persona Quiz. See
 * `docs/travel-persona-quiz-methodology.md` for the dimension model and
 * `docs/archetype-personas.md` for the archetype definitions.
 */

/** Raw 0–100 position on each of the four axes. */
export interface DimensionScores {
  /** d1: 0 = Master Planner, 100 = Spontaneous Wanderer */
  structure: number;
  /** d2: 0 = Luxury-first, 100 = Roughing It */
  comfort: number;
  /** d3: 0 = Sightseeing Highlights, 100 = Deep Immersion */
  focus: number;
  /** d4: 0 = Group-oriented, 100 = Solo-oriented */
  social: number;
}

export type DimensionKey = keyof DimensionScores;

export type TravelArchetypeId =
  | "master_planner"
  | "spontaneous_wanderer"
  | "cultural_diver"
  | "thrill_seeker"
  | "comfort_cruiser"
  | "culinary_nomad"
  | "soulful_soloist"
  | "social_explorer"
  | "nature_pilgrim"
  | "bucket_list_chaser"
  | "slow_immersionist"
  | "weekend_warrior";

export interface QuizOption {
  icon: string;
  title: string;
  description: string;
  /** Score vector this option contributes across all four axes. */
  scores: DimensionScores;
}

export interface QuizQuestion {
  label: string;
  text: string;
  options: QuizOption[];
}

export interface ArchetypeTraits {
  style: string;
  vibe: string;
  superpower: string;
  blindspot: string;
}

export interface ArchetypeDefinition {
  id: TravelArchetypeId;
  name: string;
  icon: string;
  tagline: string;
  description: string;
  traits: ArchetypeTraits;
  destinations: string[];
  /** The archetype's center point in 4D space, used for matching. */
  center: DimensionScores;
}

export interface PersonaResult {
  /** Averaged 0–100 scores — the user's Travel DNA. */
  dimensions: DimensionScores;
  /** Closest-match archetype by Euclidean distance. */
  archetype: ArchetypeDefinition;
  /** Next-closest archetype (the secondary blend). */
  secondaryArchetype: ArchetypeDefinition;
  /** 0–1; how clearly the primary beats the secondary (higher = clearer). */
  confidence: number;
}

/** Index of the selected option per question; null = unanswered. */
export type QuizAnswers = Array<number | null>;

/** Composed illustration for a question screen: scene background + owl pose. */
export interface QuizIllustration {
  /** Flat scene background image (public path). */
  background: string;
  /** Transparent owl pose image (public path). */
  owl: string;
}

export type QuizStage = "intro" | "questions" | "result";

/**
 * A persona as the planner receives it: the answers exactly as given, and the
 * result derived from them.
 *
 * Both halves travel together because the derivation is code. `calculatePersona`
 * is a scoring function that can be retuned; an answer set survives that, a
 * score does not. Anything that needs to know *which option* was picked — the
 * per-axis signals in the planner's persona brief — reads `answers`, because an
 * averaged dimension cannot tell you that.
 */
export interface TravelPersona {
  answers: QuizAnswers;
  result: PersonaResult;
}
