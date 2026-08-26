"use client";

import { Dialog } from "@base-ui/react/dialog";
import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import { Button } from "@/components/ui/primitives/Button";
import { useBreakpoint } from "@/hooks/useMediaQuery";
import { motionTransitions } from "@/lib/motion/presets";
import {
  DIMENSION_AXES,
  QUESTIONS,
  calculatePersona,
} from "@/lib/persona/quiz";
import {
  ARCHETYPE_ILLUSTRATIONS,
  INTRO_ILLUSTRATION,
  QUESTION_ILLUSTRATIONS,
} from "@/lib/persona/illustrations";
import { savePersona } from "@/lib/persona/storage";
import type { PersonaResult, QuizAnswers, QuizStage } from "@/lib/persona/types";
import { cn } from "@/lib/utils";

interface PersonaQuizDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Travel Persona Quiz dialog — 12 questions across the 4-axis dimensional
 * model (see docs/travel-persona-quiz-methodology.md). Internal state machine:
 * intro → questions → result. Scoring lives in src/lib/persona/quiz.ts.
 */
function PersonaQuizDialog({ open, onOpenChange }: PersonaQuizDialogProps) {
  const { isPhone } = useBreakpoint();
  const prefersReducedMotion = useReducedMotion();

  const [stage, setStage] = useState<QuizStage>("intro");
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>(
    Array(QUESTIONS.length).fill(null),
  );
  const [result, setResult] = useState<PersonaResult | null>(null);

  const reset = () => {
    setStage("intro");
    setCurrentQ(0);
    setAnswers(Array(QUESTIONS.length).fill(null));
    setResult(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const selectOption = (optionIndex: number) => {
    setAnswers((prev) => {
      const next = [...prev];
      next[currentQ] = optionIndex;
      return next;
    });
  };

  const handleNext = () => {
    if (currentQ < QUESTIONS.length - 1) {
      setCurrentQ((q) => q + 1);
      return;
    }
    setResult(calculatePersona(answers));
    setStage("result");
    // Deliberately not awaited, and it never throws. The result screen is
    // already rendered from the local calculation; the round trip only decides
    // whether the *next* trip this browser plans knows who took the quiz.
    void savePersona(answers);
  };

  const handleBack = () => {
    if (currentQ === 0) {
      // Leaving the question flow discards progress so every Start Quiz is a
      // clean run; Retake and closing the dialog do the same.
      reset();
      return;
    }
    setCurrentQ((q) => q - 1);
  };

  const question = QUESTIONS[currentQ];
  const illustration = QUESTION_ILLUSTRATIONS[currentQ];
  const selected = answers[currentQ];

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        {/* Quiz Backdrop */}
        <Dialog.Backdrop className="persona-quiz-backdrop modal-backdrop-animated fixed inset-0 z-40 bg-black/50" />
        <Dialog.Popup
          data-mobile-sheet={isPhone ? "true" : undefined}
          className={cn(
            "persona-quiz-popup modal-popup-animated fixed z-50",
            isPhone
              ? "inset-x-0 bottom-0 flex max-h-[92dvh] w-full flex-col overflow-y-auto rounded-t-2xl px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3"
              : "left-1/2 top-1/2 flex max-h-[min(860px,92dvh)] w-[32.5rem] -translate-x-1/2 -translate-y-1/2 flex-col overflow-y-auto rounded-2xl p-5",
            "border-edge bg-surface shadow-default",
          )}
          data-region="persona-quiz-dialog"
        >
          {isPhone && (
            <div
              aria-hidden="true"
              className="persona-quiz-sheet-handle mb-3 h-1 w-11 shrink-0 rounded-full bg-surface-muted-active"
            />
          )}

          {stage === "intro" && (
            /* Intro Screen */
            <div className="persona-quiz-intro-screen flex flex-col" data-region="persona-quiz-intro">
              {/* Illustration — scene background + owl mascot */}
              <div className="persona-quiz-illustration relative h-[240px] w-full shrink-0 overflow-hidden rounded-xl border border-edge-subtle bg-surface-alt">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={INTRO_ILLUSTRATION.background}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                  draggable="false"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={INTRO_ILLUSTRATION.owl}
                  alt="Argo the owl"
                  className="absolute bottom-0 left-1/2 h-[92%] -translate-x-1/2 object-contain"
                  draggable="false"
                />
              </div>
              <div className="mt-5 flex flex-col items-center gap-1.5 text-center">
                <Dialog.Title className="type-secondary type-body-1 font-semibold text-content">
                  Persona Quiz
                </Dialog.Title>
                <Dialog.Description className="type-body-2 text-content-secondary">
                  Find out what type of traveler are you. Understand your
                  preference and maybe find out things you didn&apos;t know
                  about before!
                </Dialog.Description>
              </div>
              <div className="mt-6 flex items-center justify-center gap-3">
                <Dialog.Close
                  render={<Button type="button" variant="ghost" size="md" />}
                >
                  Cancel
                </Dialog.Close>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={() => setStage("questions")}
                >
                  Start Quiz
                </Button>
              </div>
            </div>
          )}

          {stage === "questions" && (
            /* Question Screen */
            <div
              className="persona-quiz-question-screen flex flex-col"
              data-region="persona-quiz-question"
            >
              {/* Progress Bar */}
              <div
                className="persona-quiz-progress h-2 w-full shrink-0 overflow-hidden rounded-full bg-surface-muted"
                role="progressbar"
                aria-valuemin={1}
                aria-valuemax={QUESTIONS.length}
                aria-valuenow={currentQ + 1}
                aria-label={`Question ${currentQ + 1} of ${QUESTIONS.length}`}
              >
                <div
                  className="h-full rounded-full bg-action-brand transition-[width] duration-300"
                  style={{ width: `${((currentQ + 1) / QUESTIONS.length) * 100}%` }}
                />
              </div>

              <motion.div
                key={currentQ}
                className="flex flex-col"
                initial={prefersReducedMotion ? false : { opacity: 0, x: 12 }}
                animate={prefersReducedMotion ? undefined : { opacity: 1, x: 0 }}
                transition={motionTransitions.spatial}
              >
                {/* Illustration — scene background + owl mascot */}
                <div className="persona-quiz-illustration relative mt-4 h-[240px] w-full shrink-0 overflow-hidden rounded-xl border border-edge-subtle bg-surface-alt">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={illustration.background}
                    alt=""
                    className="absolute inset-0 size-full object-cover"
                    draggable="false"
                  />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={illustration.owl}
                    alt="Argo the owl"
                    className="absolute bottom-0 left-1/2 h-[92%] -translate-x-1/2 object-contain"
                    draggable="false"
                  />
                </div>

                {/* Question Copy */}
                <div className="mt-5 flex flex-col items-center gap-1.5 text-center">
                  <Dialog.Title className="type-secondary type-body-1 font-semibold text-content">
                    {question.text}
                  </Dialog.Title>
                </div>

                {/* Options */}
                <div className="mt-4 flex flex-col gap-2" role="radiogroup" aria-label={question.label}>
                  {question.options.map((option, index) => {
                    const isSelected = selected === index;
                    return (
                      <button
                        key={option.title}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        onClick={() => selectOption(index)}
                        className={cn(
                          "persona-quiz-option flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                          isSelected
                            ? "border-edge bg-surface-alt"
                            : "border-transparent hover:bg-surface-alt",
                        )}
                      >
                        <span
                          className={cn(
                            "flex size-6 shrink-0 items-center justify-center rounded-lg type-body-4 font-medium",
                            isSelected
                              ? "bg-action-brand text-content-on-brand"
                              : "bg-surface-muted text-content-secondary",
                          )}
                        >
                          {index + 1}
                        </span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="type-body-2 font-medium text-content">
                            {option.title}
                          </span>
                          <span className="type-body-3 text-content-secondary">
                            {option.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </motion.div>

              {/* Actions */}
              <div className="mt-6 flex items-center justify-center gap-3">
                <Button type="button" variant="ghost" size="md" onClick={handleBack}>
                  Back
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  disabled={selected === null}
                  onClick={handleNext}
                >
                  {currentQ === QUESTIONS.length - 1 ? "See My Result" : "Next"}
                </Button>
              </div>
            </div>
          )}

          {stage === "result" && result && (
            /* Result Screen */
            <div
              className="persona-quiz-result-screen flex flex-col items-center"
              data-region="persona-quiz-result"
            >
              {/* Illustration — costumed owl scene for the matched archetype */}
              <div className="persona-quiz-illustration relative h-[240px] w-full shrink-0 overflow-hidden rounded-xl border border-edge-subtle bg-surface-alt">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={ARCHETYPE_ILLUSTRATIONS[result.archetype.id]}
                  alt={result.archetype.name}
                  className="absolute inset-0 size-full object-cover"
                  draggable="false"
                />
              </div>
              <Dialog.Title className="type-secondary type-h4 mt-5 font-semibold text-content">
                {result.archetype.name}
              </Dialog.Title>
              <Dialog.Description className="type-body-2 mt-1 text-center text-content-secondary">
                {result.archetype.tagline}
              </Dialog.Description>
              <p className="type-body-3 mt-3 text-center text-content-secondary">
                {result.archetype.description}
              </p>

              {/* Travel DNA */}
              <div
                className="persona-quiz-dna mt-5 flex w-full flex-col gap-3 rounded-xl border border-edge-subtle bg-surface-alt p-4"
                data-region="persona-quiz-dna"
              >
                <span className="type-body-4 font-medium uppercase tracking-wide text-content-tertiary">
                  Travel DNA
                </span>
                {DIMENSION_AXES.map((axis) => (
                  <div key={axis.key} className="flex flex-col gap-1">
                    <div className="flex items-center justify-between">
                      <span className="type-body-4 text-content-placeholder">{axis.low}</span>
                      <span className="type-body-4 font-medium text-content">
                        {axis.label} · {result.dimensions[axis.key]}
                      </span>
                      <span className="type-body-4 text-content-placeholder">{axis.high}</span>
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                      <div
                        className="h-full rounded-full bg-action-brand"
                        style={{ width: `${result.dimensions[axis.key]}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* Trait Cards */}
              <div
                className="persona-quiz-traits mt-3 grid w-full grid-cols-2 gap-2"
                data-region="persona-quiz-traits"
              >
                {(
                  [
                    ["Travel Style", result.archetype.traits.style],
                    ["Vibe", result.archetype.traits.vibe],
                    ["Superpower", result.archetype.traits.superpower],
                    ["Blind Spot", result.archetype.traits.blindspot],
                  ] as const
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="flex flex-col gap-0.5 rounded-xl border border-edge-subtle bg-surface-alt p-3"
                  >
                    <span className="type-body-4 text-content-placeholder">{label}</span>
                    <span className="type-body-2 font-medium text-content">{value}</span>
                  </div>
                ))}
              </div>

              {/* Destinations */}
              <div className="persona-quiz-destinations mt-3 flex w-full flex-col gap-1.5" data-region="persona-quiz-destinations">
                <span className="type-body-4 font-medium uppercase tracking-wide text-content-tertiary">
                  Destinations for you
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {result.archetype.destinations.map((destination) => (
                    <span
                      key={destination}
                      className="rounded-full border border-edge-subtle bg-surface-alt px-2.5 py-1 type-body-4 font-medium text-content-secondary"
                    >
                      {destination}
                    </span>
                  ))}
                </div>
              </div>

              <p className="type-body-4 mt-3 text-content-placeholder">
                Secondary blend: {result.secondaryArchetype.name}
              </p>

              {/* Actions */}
              <div className="mt-5 flex items-center justify-center gap-3">
                <Button type="button" variant="ghost" size="md" onClick={reset}>
                  Retake
                </Button>
                <Dialog.Close
                  render={<Button type="button" variant="primary" size="md" />}
                >
                  Done
                </Dialog.Close>
              </div>
            </div>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export { PersonaQuizDialog };
export type { PersonaQuizDialogProps };
