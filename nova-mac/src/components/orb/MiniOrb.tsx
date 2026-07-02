import { motion } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import type { OrbStateName } from "@shared/types";
import { VoiceOrb, type VoiceVisualMode } from "./VoiceOrb";
import { appleSpring } from "../../motion/springs";

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

/**
 * The idle Siri-style orb: just the animated orb floating in the corner —
 * no panel, no chrome. Click to open the chat panel.
 */
export function MiniOrb({ state, level, onClick }: MiniOrbProps) {
  return (
    <motion.button
      onClick={onClick}
      title="Open Nova"
      initial={{ opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.08 }}
      whileTap={{ scale: 0.94 }}
      transition={appleSpring}
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        WebkitAppRegion: "no-drag",
      } as React.CSSProperties}
    >
      <VoiceOrb visualMode={toVisualMode(state.name)} audioLevel={level} size={92} />
    </motion.button>
  );
}
