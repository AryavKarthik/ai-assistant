import { useRef } from "react";
import { motion } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import type { OrbStateName } from "@shared/types";
import { VoiceOrb, type VoiceVisualMode } from "./VoiceOrb";
import { nova } from "../../lib/ipc";
import { appleSpring, jellySpring } from "../../motion/springs";
import { useOrbDragWiggle } from "../../hooks/useOrbDragWiggle";

function toVisualMode(name: OrbStateName): VoiceVisualMode {
  switch (name) {
    case "listening": return "listening";
    case "bargeIn": return "barge_in";
    case "processing": return "processing";
    case "responding": return "speaking";
    case "working": return "thinking";
    default: return "idle";
  }
}

interface MiniOrbProps {
  state: OrbState;
  level: number;
  onClick: () => void;
}

// A press that moves less than this (px, from the press point) is a click,
// anything more is a drag.
const CLICK_MOVE_THRESHOLD = 4;

/**
 * The idle Siri-style orb: just the animated orb floating in the corner —
 * no panel, no chrome. Click to open the chat panel; click-and-drag anywhere
 * on it to move it (main process persists wherever the user drops it).
 *
 * Dragging is manual (pointer capture + OrbDragMove deltas to main) rather
 * than a CSS `-webkit-app-region: drag` region: on macOS a drag region hands
 * the mousedown to the OS window-drag session and the mouseup never reaches
 * the page, which made click-to-open impossible to detect.
 */
export function MiniOrb({ state, level, onClick }: MiniOrbProps) {
  // Screen-space (not client) coords: the window moves under the cursor
  // during a drag, so client coords barely change and can't measure motion.
  const drag = useRef<{ startX: number; startY: number; lastX: number; lastY: number } | null>(null);
  const wiggle = useOrbDragWiggle();

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { startX: e.screenX, startY: e.screenY, lastX: e.screenX, lastY: e.screenY };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = e.screenX - d.lastX;
    const dy = e.screenY - d.lastY;
    if (dx !== 0 || dy !== 0) {
      nova().orbDragMove(dx, dy);
      d.lastX = e.screenX;
      d.lastY = e.screenY;
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dx = Math.abs(e.screenX - d.startX);
    const dy = Math.abs(e.screenY - d.startY);
    if (dx < CLICK_MOVE_THRESHOLD && dy < CLICK_MOVE_THRESHOLD) onClick();
  }

  function handlePointerCancel() {
    drag.current = null;
  }

  return (
    <motion.div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      title="Nova — click to open, drag to move"
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.08 }}
      transition={appleSpring}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <motion.div
        animate={{ scaleX: wiggle.scaleX, scaleY: wiggle.scaleY, rotate: wiggle.rotate }}
        transition={jellySpring}
      >
        <VoiceOrb visualMode={toVisualMode(state.name)} audioLevel={level} size={76} />
      </motion.div>
    </motion.div>
  );
}
