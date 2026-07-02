import type { Transition } from "framer-motion";

/** Apple system spring: response ~0.4s, dampingFraction ~0.8 (spec §9). */
export const appleSpring: Transition = { type: "spring", stiffness: 247, damping: 25 };

/** Bouncy, low-damping spring for the orb's jelly squash-and-stretch while dragging. */
export const jellySpring: Transition = { type: "spring", stiffness: 380, damping: 9, mass: 0.5 };
