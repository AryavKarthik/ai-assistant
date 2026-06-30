import { motion } from "framer-motion";
import { appleSpring } from "../../motion/springs";

export function ResponseCard({ text, onExpand }: { text: string; onExpand: () => void }) {
  return (
    <motion.div
      className="nova-glass nova-card"
      initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, filter: "blur(6px)" }}
      transition={appleSpring}
      onClick={onExpand}
      style={{ marginTop: 12, padding: "12px 16px", maxWidth: 320, fontSize: 14, cursor: "pointer" }}
    >
      {text.slice(0, 200)}
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.5 }}>Swipe up / click for full chat ↑</div>
    </motion.div>
  );
}
