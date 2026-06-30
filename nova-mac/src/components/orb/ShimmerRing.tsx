import { motion } from "framer-motion";

export function ShimmerRing() {
  return (
    <motion.div
      aria-hidden
      style={{
        position: "absolute", inset: 0, borderRadius: "999px",
        border: "2px solid transparent",
        background:
          "conic-gradient(from 0deg, rgba(255,255,255,0.0), rgba(255,255,255,0.6), rgba(255,255,255,0.0)) border-box",
        WebkitMask:
          "linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0)",
        WebkitMaskComposite: "xor", maskComposite: "exclude",
      }}
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, ease: "linear", duration: 2.4 }}
    />
  );
}
