import { motion, AnimatePresence } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import { appleSpring } from "../../motion/springs";
import { Waveform } from "./Waveform";
import { ShimmerRing } from "./ShimmerRing";
import { WorkingChip } from "./WorkingChip";
import { ResponseCard } from "../cards/ResponseCard";

const SIZE: Record<OrbState["name"], number> = {
  dormant: 12, listening: 120, processing: 120, responding: 120, working: 0,
};

export function Orb({
  state, level, onSummon, onStop, onExpand,
}: {
  state: OrbState; level: number; onSummon: () => void; onStop: () => void; onExpand: () => void;
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
          <ResponseCard text={state.responseText} onExpand={onExpand} />
        )}
      </AnimatePresence>
    </div>
  );
}
