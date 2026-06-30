import { motion, AnimatePresence } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import { appleSpring } from "../../motion/springs";
import { Waveform } from "./Waveform";
import { ShimmerRing } from "./ShimmerRing";
import { WorkingChip } from "./WorkingChip";

const SIZE: Record<OrbState["name"], number> = {
  dormant: 12, listening: 120, processing: 120, responding: 120, working: 0,
};

export function Orb({
  state, level, onSummon, onStop,
}: {
  state: OrbState; level: number; onSummon: () => void; onStop: () => void;
}) {
  if (state.name === "working") {
    return (
      <div style={{ position: "fixed", right: 24, bottom: 24 }}>
        <WorkingChip step={state.workingStep} onStop={onStop} />
      </div>
    );
  }

  const size = SIZE[state.name];
  const breathing = state.name === "responding";

  return (
    <div style={{ position: "fixed", right: 24, bottom: 24 }}>
      <motion.div
        className="nova-glass nova-orb"
        onClick={state.name === "dormant" ? onSummon : undefined}
        animate={{
          width: size, height: size,
          opacity: state.name === "dormant" ? 0.55 : 1,
          scale: breathing ? [1, 1.06, 1] : 1,
        }}
        transition={
          breathing
            ? { scale: { repeat: Infinity, duration: 2.4, ease: "easeInOut" }, ...appleSpring }
            : appleSpring
        }
        style={{
          position: "relative", display: "flex",
          alignItems: "center", justifyContent: "center",
          cursor: state.name === "dormant" ? "pointer" : "default",
        }}
      >
        {state.name === "listening" && <Waveform level={level} />}
        {state.name === "processing" && <ShimmerRing />}
      </motion.div>

      <AnimatePresence>
        {state.name === "responding" && state.responseText && (
          <motion.div
            className="nova-glass nova-card"
            initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(6px)" }}
            transition={appleSpring}
            style={{ marginTop: 12, padding: "12px 16px", maxWidth: 320, fontSize: 14 }}
          >
            {state.responseText.slice(0, 200)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
