import { useRef } from "react";
import { motion } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import type { OrbStateName } from "@shared/types";
import { VoiceOrb, type VoiceVisualMode } from "./VoiceOrb";
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

// A mouse-down/up movement below this (px) is treated as a click, not a drag —
// the whole area is an OS drag region, so we tell the two apart ourselves.
const CLICK_MOVE_THRESHOLD = 4;

/**
 * The idle Siri-style orb: just the animated orb floating in the corner —
 * no panel, no chrome. Click to open the chat panel; click-and-drag anywhere
 * on it to move it (the whole window is a drag region — main process persists
 * wherever the user drops it).
 */
export function MiniOrb({ state, level, onClick }: MiniOrbProps) {
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const wiggle = useOrbDragWiggle();

  function handleMouseDown(e: React.MouseEvent) {
    dragStart.current = { x: e.clientX, y: e.clientY };
  }

  function handleMouseUp(e: React.MouseEvent) {
    const start = dragStart.current;
    dragStart.current = null;
    if (!start) return;
    const dx = Math.abs(e.clientX - start.x);
    const dy = Math.abs(e.clientY - start.y);
    if (dx < CLICK_MOVE_THRESHOLD && dy < CLICK_MOVE_THRESHOLD) onClick();
  }

  return (
    <motion.div
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
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
        // The whole window is a drag handle; Chromium still delivers the
        // mousedown/mouseup pair above even inside a drag region, so click
        // detection (via the movement threshold) works alongside native drag.
        WebkitAppRegion: "drag",
      } as React.CSSProperties}
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
