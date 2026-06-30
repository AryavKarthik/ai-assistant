import { motion, AnimatePresence } from "framer-motion";
import { appleSpring } from "../../motion/springs";
import type { ChatMessage } from "@shared/types";

export function ChatSheet({
  open, messages, onClose,
}: { open: boolean; messages: ChatMessage[]; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={appleSpring}
          style={{
            position: "fixed", left: 0, right: 0, bottom: 0, height: "70%",
            background: "rgba(28,28,30,0.98)", borderTopLeftRadius: 16, borderTopRightRadius: 16,
            boxShadow: "0 -8px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column",
          }}
        >
          <div
            onClick={onClose}
            style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3,
              background: "rgba(255,255,255,0.3)", margin: "10px 0", cursor: "pointer" }}
          />
          <div style={{ overflowY: "auto", padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.length === 0 && <div style={{ opacity: 0.4, fontSize: 14 }}>No messages yet.</div>}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
                <div style={{
                  padding: "8px 12px", borderRadius: 14, fontSize: 14,
                  background: m.role === "user" ? "rgba(10,132,255,0.9)" : "rgba(58,58,60,0.9)",
                }}>{m.content}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
