import type { Variants, Transition } from 'motion/react';

/**
 * docs/04 §8 — the complete motion vocabulary. Components import from here; no ad-hoc
 * durations or easings anywhere else.
 *
 * Reduced motion is handled two ways: the global CSS media query in `globals.css` collapses
 * transitions, and `MotionConfig reducedMotion="user"` in the root layout makes Framer
 * respect the OS setting for transform-based animation. The result is opacity-only.
 */

export const EASE_BIOCODE = [0.16, 1, 0.3, 1] as const;

export const DURATION = {
  micro: 0.15,
  ui: 0.25,
  page: 0.4,
} as const;

const base: Transition = { duration: DURATION.ui, ease: EASE_BIOCODE };

/** The workhorse: 12px rise + fade. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: base },
};

export const fade: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: base },
};

/** Card grids. docs/04 §8 specifies a 0.06s stagger. */
export function stagger(step = 0.06, delayChildren = 0): Variants {
  return {
    hidden: {},
    visible: { transition: { staggerChildren: step, delayChildren } },
  };
}

/** Cart drawer (docs/04 §6). */
export const drawerSlide: Variants = {
  hidden: { x: '100%' },
  visible: { x: 0, transition: { duration: DURATION.page, ease: EASE_BIOCODE } },
  exit: { x: '100%', transition: { duration: DURATION.ui, ease: EASE_BIOCODE } },
};

/** Mega menu (docs/04 §6) — fade with a 0.98→1 scale. */
export const megaMenu: Variants = {
  hidden: { opacity: 0, scale: 0.98, y: -4 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: DURATION.micro, ease: EASE_BIOCODE },
  },
  exit: { opacity: 0, scale: 0.98, transition: { duration: DURATION.micro, ease: EASE_BIOCODE } },
};

/** docs/04 §2 — the Vitality Ring draws in once, 400ms, ease-out-quint. */
export const signalRing: Variants = {
  hidden: { pathLength: 0, opacity: 0 },
  visible: {
    pathLength: 1,
    opacity: 1,
    transition: { duration: DURATION.page, ease: EASE_BIOCODE },
  },
};
