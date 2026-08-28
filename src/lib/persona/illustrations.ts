/**
 * Question-screen illustrations: a flat scene background per question theme
 * (public/images/quiz/backgrounds) with the Argo owl mascot composited on top
 * in a matching pose (public/images/quiz/transparent-owl-pose). Index-aligned
 * with `QUESTIONS` in ./quiz. Scene art direction follows the Duolingo-style
 * flat vector references; the owl assets are the canonical character lock in
 * public/images/quiz/CHARACTER.md.
 */

import type { QuizIllustration, TravelArchetypeId } from "./types";

const BG = "/images/quiz/backgrounds";
const OWL = "/images/quiz/transparent-owl-pose";
const RESULTS = "/images/quiz/results";

const owl = (pose: string) => `${OWL}/argo-owl-${pose}.png`;

/** Intro screen — the owl welcomes the user at the start of the journey. */
export const INTRO_ILLUSTRATION: QuizIllustration = {
  background: `${BG}/quiz-bg-00-intro.png`,
  owl: owl("welcoming"),
};

export const QUESTION_ILLUSTRATIONS: QuizIllustration[] = [
  // 1 · Trip Prep — Japan map + open suitcase; owl points at the plan.
  { background: `${BG}/quiz-bg-01-trip-prep.png`, owl: owl("pointing") },
  // 2 · First Morning — sunrise street + café; owl wanders in.
  { background: `${BG}/quiz-bg-02-first-morning.png`, owl: owl("walking") },
  // 3 · Accommodation — hotel, tent, guesthouse; owl sits in.
  { background: `${BG}/quiz-bg-03-accommodation.png`, owl: owl("sitting") },
  // 4 · Pace — hammock park; owl thinks it over.
  { background: `${BG}/quiz-bg-04-pace.png`, owl: owl("thinking") },
  // 5 · Culture — torii gate + lanterns; owl takes it in.
  { background: `${BG}/quiz-bg-05-culture.png`, owl: owl("three-quarter") },
  // 6 · Social Style — table set for a group; owl waves hello.
  { background: `${BG}/quiz-bg-06-social.png`, owl: owl("waving") },
  // 7 · Food — market stalls + noodle cart; owl front and hungry.
  { background: `${BG}/quiz-bg-07-food.png`, owl: owl("front") },
  // 8 · Risk & Comfort — bus + hilltop festival; owl points "let's go".
  { background: `${BG}/quiz-bg-08-risk-comfort.png`, owl: owl("pointing") },
  // 9 · Packing — open suitcase; owl checks it from behind.
  { background: `${BG}/quiz-bg-09-packing.png`, owl: owl("back") },
  // 10 · Memories — summit sunset; owl gazes at the view.
  { background: `${BG}/quiz-bg-10-memories.png`, owl: owl("back") },
  // 11 · Detours — broken-down train; owl watches from the side.
  { background: `${BG}/quiz-bg-11-detours.png`, owl: owl("side-profile") },
  // 12 · Homecoming — open door + photo wall; owl celebrates.
  { background: `${BG}/quiz-bg-12-homecoming.png`, owl: owl("celebrating") },
];

/**
 * Result-screen illustrations: the owl in a costume matching each archetype,
 * drawn into a fitting scene (generated with the CHARACTER.md identity lock).
 */
export const ARCHETYPE_ILLUSTRATIONS: Record<TravelArchetypeId, string> = {
  master_planner: `${RESULTS}/archetype-master-planner.png`,
  spontaneous_wanderer: `${RESULTS}/archetype-spontaneous-wanderer.png`,
  cultural_diver: `${RESULTS}/archetype-cultural-diver.png`,
  thrill_seeker: `${RESULTS}/archetype-thrill-seeker.png`,
  comfort_cruiser: `${RESULTS}/archetype-comfort-cruiser.png`,
  culinary_nomad: `${RESULTS}/archetype-culinary-nomad.png`,
  soulful_soloist: `${RESULTS}/archetype-soulful-soloist.png`,
  social_explorer: `${RESULTS}/archetype-social-explorer.png`,
  nature_pilgrim: `${RESULTS}/archetype-nature-pilgrim.png`,
  bucket_list_chaser: `${RESULTS}/archetype-bucket-list-chaser.png`,
  slow_immersionist: `${RESULTS}/archetype-slow-immersionist.png`,
  weekend_warrior: `${RESULTS}/archetype-weekend-warrior.png`,
};
