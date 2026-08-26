/**
 * The persona, as words a model can act on.
 *
 * Three prompts will read this — the theme pass, Pass B and Pass C — and none
 * of them ever sees a number. A model will not reliably tell 45 from 55, and
 * asking it to is how a prompt acquires a precision it never had. Deterministic
 * knobs get the raw axis; prompts get a band word and a sentence.
 *
 * ## The rule that decides whether this works at all
 *
 * **Write instructions to the planner, not descriptions of the person.**
 *
 * - Bad: *"This traveller is spontaneous and open to new experiences."*
 * - Good: *"Anchor two or three fixed points a day and leave the rest as a
 *   direction to walk in."*
 *
 * A model handed adjectives returns adjectives. A model handed planning
 * instructions returns a plan. Every clause below is phrased as something to
 * *do*, and a new one that reads as a character sketch is a bug.
 *
 * ## Why it is bounded
 *
 * Four traits, four signals, at most three negatives. Twelve answers rendered
 * as twelve sentences is a wall of text the model weights at random.
 *
 * `traits` come from the bands — where the traveller sits on each axis overall.
 * `signals` come from the single most diagnostic *answer* per axis, which an
 * averaged score cannot tell you. The two are allowed to disagree, and the
 * disagreement is informative: "spreadsheet time" on question one while landing
 * `flexible` overall means "generally easy, but wants the first day pinned
 * down". They are labelled separately in the prompt so the model can hold both.
 *
 * ## What must never come through here
 *
 * `avoid` is **preferences, not filters**. Dietary needs and budget are hard
 * constraints and live in `hardFilterReason`, which runs deterministically
 * after any model has spoken. Moving one of those into a prompt turns a rule
 * into a suggestion.
 */

import type { PersonaResult, QuizAnswers, TravelPersona } from "@/lib/persona/types";

import { bandsOf, toPersonaAxes, type PersonaBands } from "./knobs";

export interface PersonaBrief {
  /** "The Culinary Nomad". Voice only — nothing branches on it. */
  archetype: string;
  /** One per axis, from the bands. Always four. */
  traits: string[];
  /** One per axis, from the most diagnostic answer. Four, or none. */
  signals: string[];
  /** 0–3 concrete negatives, from low bands only. */
  avoid: string[];
}

// ── traits: twelve clauses, four selected ────────────────────────────────────

const TRAIT_CLAUSES: {
  [K in keyof PersonaBands]: Record<PersonaBands[K], string>;
} = {
  spontaneity: {
    planned: "Fill every slot with a named place. No open time.",
    flexible: "Fill the day, but leave one slot as a named area rather than a named place.",
    improvised:
      "Anchor two or three fixed points a day; leave the rest as a direction to walk in.",
  },
  comfortTolerance: {
    polished:
      "Indoors and seated where there is a choice. Short transfers. Skip the queue-in-the-sun option.",
    easygoing: "Mix comfortable and basic — a hawker lunch is fine if dinner is sit-down.",
    rugged: "Street stalls, long walks and local transport are the point, not a compromise.",
  },
  immersion: {
    highlights:
      "The things this city is known for, in an efficient order. Say why each is famous.",
    mixed: "Two well-known anchors a day; everything else local.",
    deep: "One subject per day, followed properly. Prefer places locals use over places that are famous.",
  },
  solitude: {
    group: "Shared tables, markets, things worth doing together. Meals run long.",
    either: "No social preference — choose on quality alone.",
    solo: "Places that are good alone: counters, gardens, viewpoints, galleries. No group-format activities.",
  },
};

// ── signals: the most diagnostic answer per axis ─────────────────────────────

/**
 * Which question speaks loudest for each axis, from the spread table in
 * `docs/travel-persona-quiz-methodology.md` §5. Four questions, three options
 * each — twelve fragments to write, not thirty-six.
 *
 * Indices are 0-based into `QUESTIONS`. They are asserted against the question
 * labels in `persona-brief.test.ts`, because a question inserted above one of
 * these would otherwise shift every signal onto the wrong axis and still read
 * perfectly well.
 */
export const SIGNAL_QUESTIONS: {
  [K in keyof PersonaBands]: { index: number; label: string; fragments: readonly string[] };
} = {
  // Q1, "Trip Prep" — spread 90.
  spontaneity: {
    index: 0,
    label: "Trip Prep",
    fragments: [
      "Wants the shape settled before arriving — an unnamed slot will read as a gap, not as freedom.",
      "Has a handful of must-sees and no plan around them — anchor those and leave the rest loose.",
      "Booked nothing on purpose — give neighbourhoods and directions rather than a schedule.",
    ],
  },
  // Q3, "Accommodation" — spread 85.
  comfortTolerance: {
    index: 2,
    label: "Accommodation",
    fragments: [
      "Wants a predictable base — bias toward established, well-reviewed places.",
      "Comfortable in ordinary neighbourhoods — residential areas are fair game.",
      "Indifferent to polish — the rougher option is usually the one they would pick.",
    ],
  },
  // Q5, "Culture" — spread 75.
  immersion: {
    index: 4,
    label: "Culture",
    fragments: [
      "Wants to be in it rather than near it — pick places where something is actually happening.",
      "Wants the local thing in small doses, not a whole day of it.",
      "Prefers watching to joining — viewpoints, galleries and counters over workshops and classes.",
    ],
  },
  // Q6, "Social Style" — spread 90.
  solitude: {
    index: 5,
    label: "Social Style",
    fragments: [
      "Travelling with people — favour places that are better with company than without.",
      "Open to company without needing it — a shared table is a bonus, never the reason to go.",
      "Good company for themselves — nothing that needs a second person to work.",
    ],
  },
};

// ── avoid ────────────────────────────────────────────────────────────────────

/**
 * Negatives, from low bands only, and deliberately literal.
 *
 * Models follow negatives poorly, so there are three of these at most and each
 * names a thing rather than a quality. `solitude` has no entry: its low band is
 * *group*, and "wants company" is expressed by the trait clause asking for
 * shared tables — a negative there would have to forbid solitude, which nobody
 * wants forbidden.
 */
const AVOID_CLAUSES: Partial<{ [K in keyof PersonaBands]: string }> = {
  spontaneity: "No unnamed slots and no 'explore the area' time.",
  comfortTolerance: "No hostels, no long bus rides, no street-stall-only meals.",
  immersion: "Do not build a day around one obscure thing.",
};

const LOW_BAND: { [K in keyof PersonaBands]: PersonaBands[K] } = {
  spontaneity: "planned",
  comfortTolerance: "polished",
  immersion: "highlights",
  solitude: "group",
};

// ── building ─────────────────────────────────────────────────────────────────

const AXES = ["spontaneity", "comfortTolerance", "immersion", "solitude"] as const;

/**
 * The brief for one persona. `answers` is optional so a persona reconstructed
 * from scores alone still produces traits — `signals` is simply empty, which is
 * honest, where inventing a fragment from an averaged score would not be.
 */
export function buildPersonaBrief(
  result: PersonaResult,
  answers?: QuizAnswers,
): PersonaBrief {
  const bands = bandsOf(toPersonaAxes(result.dimensions));
  return {
    archetype: result.archetype.name,
    traits: AXES.map((axis) => traitFor(axis, bands)),
    signals: answers ? signalsFrom(answers) : [],
    avoid: AXES.flatMap((axis) => {
      const clause = AVOID_CLAUSES[axis];
      return clause && isLowBand(axis, bands) ? [clause] : [];
    }),
  };
}

/** Generic so the axis key and its band vocabulary stay tied together — the
 *  compiler refuses `TRAIT_CLAUSES.immersion[bands.solitude]`. */
function traitFor<K extends keyof PersonaBands>(axis: K, bands: PersonaBands): string {
  return TRAIT_CLAUSES[axis][bands[axis]];
}

function isLowBand<K extends keyof PersonaBands>(axis: K, bands: PersonaBands): boolean {
  return bands[axis] === LOW_BAND[axis];
}

/** The brief for a stored persona, or nothing when the traveller never took the quiz. */
export function personaBriefFor(persona: TravelPersona | undefined): PersonaBrief | undefined {
  return persona ? buildPersonaBrief(persona.result, persona.answers) : undefined;
}

function signalsFrom(answers: QuizAnswers): string[] {
  return AXES.flatMap((axis) => {
    const { index, fragments } = SIGNAL_QUESTIONS[axis];
    const answer = answers[index];
    // An unanswered diagnostic question says nothing rather than saying the
    // middle option — the middle option is itself a position.
    if (answer == null || answer < 0 || answer >= fragments.length) return [];
    return [fragments[answer]];
  });
}

// ── rendering ────────────────────────────────────────────────────────────────

/**
 * Which prompt gets which half.
 *
 * `theme` is inventing the premise, so it gets everything. `assign` is choosing
 * slots rather than writing, so the signals — which are about voice and taste —
 * would only be noise. `narrate` is choosing a voice, so it gets the archetype
 * name and the signals but not the negatives: a sentence about a place is not
 * where you tell a model what to leave out.
 */
export type BriefAudience = "theme" | "assign" | "narrate";

const AUDIENCE_SECTIONS: Record<BriefAudience, readonly (keyof PersonaBrief)[]> = {
  theme: ["archetype", "traits", "signals", "avoid"],
  assign: ["traits", "avoid"],
  narrate: ["archetype", "traits", "signals"],
};

const SECTION_HEADINGS: Record<keyof PersonaBrief, string> = {
  archetype: "traveller_archetype",
  // Labelled apart on purpose: `traits` is where they sit overall and `signals`
  // is what they actually answered, and the two are allowed to disagree.
  traits: "how_to_build_their_days",
  signals: "what_they_told_us",
  avoid: "avoid",
};

/**
 * The brief as prompt text, or an empty string when there is no persona.
 *
 * An empty string rather than an omitted block so a caller can concatenate
 * unconditionally — and, more importantly, so a persona-less prompt is
 * byte-identical to the prompt this planner sent before personas existed.
 */
export function renderPersonaBrief(
  brief: PersonaBrief | undefined,
  audience: BriefAudience,
): string {
  if (!brief) return "";
  const lines: string[] = [];
  for (const section of AUDIENCE_SECTIONS[audience]) {
    const heading = SECTION_HEADINGS[section];
    if (section === "archetype") {
      lines.push(`${heading}: ${brief.archetype}`);
      continue;
    }
    const items = brief[section] as string[];
    if (items.length === 0) continue;
    lines.push(`${heading}:`);
    for (const item of items) lines.push(`- ${item}`);
  }
  return lines.join("\n");
}
