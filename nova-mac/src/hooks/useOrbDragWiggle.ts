import { useEffect, useRef, useState } from "react";
import { nova } from "../lib/ipc";

export interface OrbWiggle {
  scaleX: number;
  scaleY: number;
  rotate: number;
}

export const NEUTRAL_WIGGLE: OrbWiggle = { scaleX: 1, scaleY: 1, rotate: 0 };

// Tuned so a brisk drag reads as a lively jelly wobble without ever
// stretching the orb enough to clip against its window's edge.
const VELOCITY_TO_STRETCH = 55;
const MAX_STRETCH = 0.16;
const SQUASH_RATIO = 0.6;
/** No new drag-velocity tick within this window means the drag stopped —
 *  spring back to neutral rather than waiting indefinitely. */
const IDLE_DECAY_MS = 140;

/** Pure conversion from instantaneous drag velocity (px/ms) to a squash-and-
 *  stretch transform: stretched along the axis of motion, squashed on the
 *  other axis, capped so it never exceeds the orb's clipping margin.
 *
 *  Deliberately axis-aligned with rotate always 0: the old version rotated
 *  the orb to the motion angle, but atan2 flaps between +180° and −180° on a
 *  leftward drag (tiny vy sign changes), and the spring animating that jump
 *  spun the orb through a full turn each time — the "spazzing" wobble. The
 *  per-axis blend keeps the same horizontal/vertical feel without any
 *  rotation to flip. */
export function velocityToWiggle(vx: number, vy: number): OrbWiggle {
  const speed = Math.sqrt(vx * vx + vy * vy);
  const stretch = Math.min(speed * VELOCITY_TO_STRETCH, MAX_STRETCH);
  if (speed === 0 || stretch === 0) return NEUTRAL_WIGGLE;
  // Share of the motion on each axis (sums to 1).
  const wx = (vx * vx) / (speed * speed);
  const wy = (vy * vy) / (speed * speed);
  return {
    scaleX: 1 + stretch * wx - stretch * SQUASH_RATIO * wy,
    scaleY: 1 + stretch * wy - stretch * SQUASH_RATIO * wx,
    rotate: 0,
  };
}

/**
 * Turns live window-drag velocity (pixels/ms, from the main process) into a
 * squash-and-stretch transform: the orb stretches along the direction of
 * motion and squashes perpendicular to it, like dragging a soft jelly ball,
 * then snaps back to neutral (via a bouncy spring in the consuming
 * component) the moment the drag stops or pauses.
 */
export function useOrbDragWiggle(): OrbWiggle {
  const [wiggle, setWiggle] = useState<OrbWiggle>(NEUTRAL_WIGGLE);
  const decayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const off = nova().onOrbDragVelocity?.(({ vx, vy }) => {
      setWiggle(velocityToWiggle(vx, vy));
      if (decayTimer.current) clearTimeout(decayTimer.current);
      decayTimer.current = setTimeout(() => setWiggle(NEUTRAL_WIGGLE), IDLE_DECAY_MS);
    });

    return () => {
      off?.();
      if (decayTimer.current) clearTimeout(decayTimer.current);
    };
  }, []);

  return wiggle;
}
