import type { Transition, Variants } from "motion/react";

/**
 * Motion's JavaScript API uses seconds while the CSS motion tokens use
 * milliseconds. Keep this adapter intentionally small: it exists only for
 * stateful choreography that cannot be expressed as a CSS transition.
 */
export const motionTokens = {
  duration: {
    fast: 0.15,
    normal: 0.2,
    medium: 0.25,
    slow: 0.3,
  },
  easing: {
    standard: [0, 0, 0.2, 1],
    emphasized: [0.32, 0.72, 0, 1],
    spatial: [0.25, 1, 0.5, 1],
  },
} as const;

export const motionTransitions = {
  fast: {
    duration: motionTokens.duration.fast,
    ease: motionTokens.easing.standard,
  },
  control: {
    duration: motionTokens.duration.normal,
    ease: motionTokens.easing.standard,
  },
  spatial: {
    duration: motionTokens.duration.medium,
    ease: motionTokens.easing.spatial,
  },
  iconSwap: {
    type: "spring",
    duration: motionTokens.duration.slow,
    bounce: 0,
  },
  reorder: {
    duration: motionTokens.duration.normal,
    ease: motionTokens.easing.spatial,
  },
  instant: { duration: 0 },
} satisfies Record<string, Transition>;

export const motionPresets = {
  completionHandoff: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
  },
  panelContent: {
    initial: { opacity: 0, x: 8 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 4 },
  },
  iconSwap: {
    initial: { opacity: 0, transform: "scale(0.95)", filter: "blur(2px)" },
    animate: { opacity: 1, transform: "scale(1)", filter: "blur(0px)" },
    exit: { opacity: 0, transform: "scale(0.95)", filter: "blur(2px)" },
  },
} satisfies Record<string, Variants>;
