import type { Transition, Variants } from "framer-motion";

/**
 * Motion tokens (spec §178). Motion explains state changes; it never delays
 * persistence, navigation, focus or input. Durations in seconds.
 */
export const DURATION = {
  press: 0.12,
  disclosure: 0.19,
  entry: 0.21,
  modal: 0.25,
  exit: 0.15,
  chart: 0.38,
} as const;

export const EASE = {
  out: [0.22, 1, 0.36, 1] as [number, number, number, number],
  inOut: [0.65, 0, 0.35, 1] as [number, number, number, number],
  in: [0.4, 0, 1, 1] as [number, number, number, number],
};

/** 20–35 ms per item, only for the first few visible items. */
export const STAGGER = 0.028;
export const MAX_STAGGERED = 7;

export const entryTransition: Transition = { duration: DURATION.entry, ease: EASE.out };
export const exitTransition: Transition = { duration: DURATION.exit, ease: EASE.in };

export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 6 },
  visible: (i: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: { ...entryTransition, delay: Math.min(i, MAX_STAGGERED) * STAGGER },
  }),
  exit: { opacity: 0, transition: exitTransition },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: entryTransition },
  exit: { opacity: 0, transition: exitTransition },
};

export const dialogVariants: Variants = {
  hidden: { opacity: 0, scale: 0.98, y: 4 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: DURATION.modal, ease: EASE.out } },
  exit: { opacity: 0, scale: 0.98, transition: exitTransition },
};

export const sheetVariants: Variants = {
  hidden: { y: "100%" },
  visible: { y: 0, transition: { duration: DURATION.modal, ease: EASE.out } },
  exit: { y: "100%", transition: { duration: 0.18, ease: EASE.in } },
};

export const overlayVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURATION.disclosure } },
  exit: { opacity: 0, transition: exitTransition },
};

export type MotionPreference = "system" | "reduced" | "off";
