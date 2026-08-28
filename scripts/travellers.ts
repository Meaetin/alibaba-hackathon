/**
 * Seven test travellers, as twelve quiz answers each.
 *
 * These exist to answer one question the app cannot otherwise answer: does the
 * persona actually change the trip, or is the quiz collecting twelve answers
 * and spending none of them? `scripts/plan-persona-trips.ts` sends each of
 * these through `POST /api/persona` and `POST /api/plan` — the same front door
 * the browser uses — and puts the seven itineraries side by side.
 *
 * ## Why answers rather than dimensions
 *
 * `calculatePersona` is a scoring function that can be retuned. An answer set
 * survives that; a coordinate does not. Same reason `travel_personas` stores
 * answers and `POST /api/plan` rebuilds the result from them rather than
 * reading the derived columns.
 *
 * `intendedArchetype` is the claim each set makes, and `checkTravellers` in the
 * runner asserts it before a single request is billed. A scoring change that
 * relabels one of these travellers should be loud, because it means the same
 * twelve answers now describe a different person.
 *
 * ## Why these seven
 *
 * They were originally picked by **band combination** rather than archetype
 * name, because under the old averaging scorer seven of the twelve archetypes
 * were unreachable and 94.3% of answer sets read neutral on all four bands.
 * `scoreAnswers` returns a percentile now, so all twelve archetypes and all 81
 * band combinations are reachable — see "An axis score is a percentile now" in
 * AGENTS.md.
 *
 * The answer sets below are unchanged: each one is a character, written to read
 * like a person. What changed is where they land, and they land better —
 * `suite-life` reaches `comfort_cruiser`, which no answer set could reach
 * before, and the `solitude` axis finally varies across the seven instead of
 * being pinned at `either` for everybody.
 *
 * Two still sit beside the archetype their prose describes rather than on it:
 * `spreadsheet` reads as `weekend_warrior` rather than `master_planner`, and
 * `trailhead` as `spontaneous_wanderer` rather than `nature_pilgrim`. That is
 * recorded rather than tuned away — the archetype is a prior, and since
 * `buildProfile` now reads the chosen options directly, `trailhead` gets
 * `outdoors` and hiking affinities regardless of which archetype won.
 *
 * Two are awkward on purpose. `in-between` contradicts itself across the
 * twelve, and `careful-eater` puts a polished persona against a vegetarian hard
 * constraint on the tightest budget — the persona must lose.
 *
 * The `form` on each traveller is the create modal, not the quiz. Dietary and
 * budget live there because `buildProfile` takes them from the form and never
 * infers them, and pace lives there because the modal asks for it directly.
 */

import type { QuizAnswers, TravelArchetypeId } from "../src/lib/persona/types.ts";
import type { BudgetLevel, Pace } from "../src/lib/planner/types.ts";

export interface Traveller {
  /** Slug used for the itinerary name and the report. */
  key: string;
  /** How the report refers to them. */
  name: string;
  /** One line on who this is, in the words a person would use. */
  note: string;
  /** The archetype this answer set claims to produce. Asserted before billing. */
  intendedArchetype: TravelArchetypeId;
  /**
   * The four planner bands this answer set claims to produce, as
   * `spontaneity/comfortTolerance/immersion/solitude`. Asserted alongside the
   * archetype, and the more important of the two: `resolvePlannerKnobs` reads
   * the bands, and only `buildProfile` reads the archetype.
   */
  intendedBands: string;
  /** Twelve answers, one per question, in `QUESTIONS` order. */
  answers: QuizAnswers;
  /** The create modal's half: what the traveller typed rather than inferred. */
  form: {
    pace: Pace;
    /** HARD. Never inferred from a persona, at any archetype. */
    dietary: string[];
    /** Optional — absent lets `deriveBudget` fall back to the persona. */
    budget?: BudgetLevel;
  };
}

/*
 * Question order, for reading the answer arrays:
 *
 *  0 Trip Prep       0 spreadsheet     1 bookmark a few   2 just pack and go
 *  1 First Morning   0 landmarks       1 wander to a cafe 2 find the wild side
 *  2 Accommodation   0 great hotel     1 local guesthouse 2 hostel or camp
 *  3 Pace            0 dawn to dusk    1 loose rhythm     2 slow and unhurried
 *  4 Culture         0 dive in         1 sample highlights 2 observe at distance
 *  5 Social Style    0 group           1 meet people      2 happy on your own
 *  6 Food            0 food IS the trip 1 street food     2 fuel for the journey
 *  7 Risk & Comfort  0 go immediately  1 check reviews    2 politely decline
 *  8 Packing         0 color-coded     1 one carry-on     2 throw it in a bag
 *  9 Memories        0 epic adventure  1 human connection 2 peaceful moment
 * 10 Detours         0 frustrated      1 delighted        2 chill about it
 * 11 Homecoming      0 my slides       1 you HAVE to go   2 where to next
 */

export const TRAVELLERS: Traveller[] = [
  {
    key: "hawker-hunter",
    name: "The Hawker Hunter",
    note: "Plans the day around what they are going to eat, and will queue an hour for it.",
    intendedArchetype: "cultural_diver",
    intendedBands: "improvised/rugged/deep/either",
    answers: [1, 1, 1, 1, 0, 1, 0, 0, 1, 1, 2, 1],
    form: { pace: "balanced", dietary: [] },
  },
  {
    key: "suite-life",
    name: "The Suite Life",
    note: "Travels to be looked after. A good hotel, the famous things, nothing that involves queueing.",
    intendedArchetype: "comfort_cruiser",
    intendedBands: "planned/polished/highlights/group",
    answers: [0, 0, 0, 0, 2, 0, 2, 2, 0, 2, 0, 0],
    form: { pace: "relaxed", dietary: [] },
  },
  {
    key: "trailhead",
    name: "The Trailhead",
    note: "Would rather be on a path than in a gallery. Sleeps cheap, eats off a cart, measures a day in what they walked.",
    intendedArchetype: "spontaneous_wanderer",
    intendedBands: "improvised/rugged/deep/either",
    answers: [2, 2, 2, 1, 0, 1, 1, 0, 1, 0, 1, 2],
    form: { pace: "balanced", dietary: [] },
  },
  {
    key: "spreadsheet",
    name: "The Spreadsheet",
    note: "Booked everything before the flights and packs to a checklist. Sleeps cheap so the days can be full.",
    intendedArchetype: "weekend_warrior",
    intendedBands: "planned/easygoing/highlights/group",
    answers: [0, 0, 2, 0, 1, 0, 2, 1, 0, 0, 0, 0],
    form: { pace: "packed", dietary: [] },
  },
  {
    key: "long-stay",
    name: "The Long Stay",
    note: "One neighbourhood, properly. Would rather understand a street than tick off a city.",
    intendedArchetype: "slow_immersionist",
    intendedBands: "improvised/rugged/deep/solo",
    answers: [2, 1, 1, 2, 0, 2, 0, 0, 2, 1, 2, 2],
    form: { pace: "relaxed", dietary: [] },
  },

  // ── the two awkward ones ───────────────────────────────────────────────────

  {
    key: "in-between",
    name: "The In-Between",
    note: "Answered honestly, contradicted themselves, and matched their archetype only barely. The blurry case a real quiz produces.",
    intendedArchetype: "spontaneous_wanderer",
    intendedBands: "improvised/rugged/deep/either",
    answers: [2, 1, 1, 1, 2, 1, 1, 0, 1, 1, 1, 2],
    form: { pace: "balanced", dietary: [] },
  },
  {
    key: "careful-eater",
    name: "The Careful Eater",
    note: "Vegetarian, on the tightest budget, with a persona that wants everything polished — the constraint and the persona pull opposite ways, and the constraint must win.",
    intendedArchetype: "comfort_cruiser",
    intendedBands: "planned/polished/highlights/group",
    answers: [1, 0, 0, 1, 2, 0, 2, 2, 0, 2, 0, 2],
    form: { pace: "balanced", dietary: ["vegetarian"], budget: 1 },
  },
];
