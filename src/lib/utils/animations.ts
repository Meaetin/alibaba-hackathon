import type { Transition, Variants } from "motion/react";

const EASE_SNAP: [number, number, number, number] = [0.22, 1, 0.36, 1];

// ───── Stagger Container ────────────────────────────────────────────────────

export const staggerContainer: Variants = {
  hidden: { transition: { staggerChildren: 0.08, staggerDirection: -1 } },
  visible: { transition: { staggerChildren: 0.1, delayChildren: 0.02 } },
};

// ───── Stagger Items ────────────────────────────────────────────────────────

export const staggerSlideDown: Variants = {
  hidden: { opacity: 0, y: -12, transition: { duration: 0.25, ease: EASE_SNAP } },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: EASE_SNAP } },
};

export const staggerSlideUp: Variants = {
  hidden: { opacity: 0, y: 20, transition: { duration: 0.25, ease: EASE_SNAP } },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE_SNAP } },
};

// ───── Card Grid Animation ──────────────────────────────────────────────────

export const cardEntryTransition = (index: number): Transition => ({
  type: "spring",
  duration: 0.5,
  bounce: 0,
  delay: index * 0.04,
});

export const cardEntry = {
  initial: { opacity: 0, scale: 0.8, filter: "blur(4px)" },
  exit: { opacity: 0, scale: 0.8, filter: "blur(4px)" },
};
