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
 *  stretch transform: stretched along the direction of motion, squashed
 *  perpendicular to it, capped so it never exceeds the orb's clipping margin. */
export function velocityToWiggle(vx: number, vy: number): OrbWiggle {
  const speed = Math.sqrt(vx * vx + vy * vy);
  const stretch = Math.min(speed * VELOCITY_TO_STRETCH, MAX_STRETCH);
  const rotate = stretch > 0.01 ? (Math.atan2(vy, vx) * 180) / Math.PI : 0;
  return { scaleX: 1 + stretch, scaleY: 1 - stretch * SQUASH_RATIO, rotate };
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
