import type { Transition } from "framer-motion";

/** Apple system spring: response ~0.4s, dampingFraction ~0.8 (spec §9). */
export const appleSpring: Transition = { type: "spring", stiffness: 247, damping: 25 };
