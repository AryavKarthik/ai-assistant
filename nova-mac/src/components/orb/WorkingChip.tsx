import { motion } from "framer-motion";
import { appleSpring } from "../../motion/springs";

export function WorkingChip({ step, onStop }: { step: string | null; onStop: () => void }) {
  return (
    <motion.div
      className="nova-glass nova-card"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={appleSpring}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}
    >
      <span style={{ fontSize: 13, opacity: 0.9 }}>{step ?? "Working…"}</span>
      <button
        onClick={onStop}
        style={{
          fontSize: 12, padding: "4px 10px", borderRadius: 999, border: "none",
          background: "rgba(255,69,58,0.9)", color: "white", cursor: "pointer",
        }}
      >
        Stop
      </button>
    </motion.div>
  );
}
