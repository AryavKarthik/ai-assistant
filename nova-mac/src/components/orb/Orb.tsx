import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import type { OrbStateName } from "@shared/types";
import { VoiceOrb, type VoiceVisualMode } from "./VoiceOrb";
import { TextComposer } from "../composer/TextComposer";
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

function statusLabel(state: OrbState): string {
  if (state.error) return state.error;
  if (state.notice) return state.notice;
  switch (state.name) {
    case "listening": return "Listening…";
    case "processing": return "Thinking…";
    case "working": return state.workingStep ?? "Working on it…";
    case "responding": return "Speaking";
    case "bargeIn": return "Go ahead — listening";
    default: return "Say “Hey Jarvis”";
  }
}

function statusTone(state: OrbState): string {
  if (state.error) return "rgba(255, 120, 120, 0.95)";
  if (state.notice) return "rgba(255, 214, 130, 0.95)";
  switch (state.name) {
    case "listening": return "rgba(147, 197, 253, 0.95)";
    case "bargeIn": return "rgba(251, 191, 36, 0.95)";
    case "processing":
    case "working": return "rgba(196, 181, 253, 0.95)";
    case "responding": return "rgba(110, 231, 183, 0.95)";
    default: return "rgba(255, 255, 255, 0.4)";
  }
}

interface OrbProps {
  state: OrbState;
  level: number;
  onSummon?: () => void;
  onStop?: () => void;
  onExpand?: () => void;
}

export function Orb({ state, level, onExpand }: OrbProps) {
  const visualMode = toVisualMode(state.name);
  const active = state.name !== "dormant";
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest streamed text in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state.responseText]);

  return (
    <motion.div
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={appleSpring}
      className="nova-glass"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        borderRadius: 24,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {/* Drag strip + settings */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 12px 0",
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: "rgba(255,255,255,0.35)",
          }}
        >
          Nova
        </div>
        <button
          onClick={onExpand}
          title="Open Nova"
          style={{
            WebkitAppRegion: "no-drag",
            background: "rgba(255,255,255,0.07)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            color: "rgba(255,255,255,0.55)",
            cursor: "pointer",
            fontSize: 13,
            padding: "3px 8px",
            lineHeight: 1,
          } as React.CSSProperties}
        >
          ⚙
        </button>
      </div>

      {/* Orb + status */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          paddingTop: 4,
        }}
      >
        <motion.div
          animate={{ scale: active ? 1 : 0.92 }}
          transition={appleSpring}
        >
          <VoiceOrb visualMode={visualMode} audioLevel={level} size={148} />
        </motion.div>

        <AnimatePresence mode="wait">
          <motion.div
            key={statusLabel(state)}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: statusTone(state),
              minHeight: 18,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {(state.name === "processing" || state.name === "working") && (
              <motion.span
                animate={{ opacity: [0.3, 1, 0.3] }}
                transition={{ duration: 1.1, repeat: Infinity }}
                style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: "currentColor" }}
              />
            )}
            {statusLabel(state)}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Transcript + streamed response */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          padding: "10px 20px 8px",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <AnimatePresence>
          {state.transcript && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              style={{
                alignSelf: "flex-end",
                maxWidth: "88%",
                fontSize: 12.5,
                lineHeight: 1.45,
                color: "rgba(255,255,255,0.65)",
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "14px 14px 4px 14px",
                padding: "7px 11px",
              }}
            >
              {state.transcript}
            </motion.div>
          )}
        </AnimatePresence>
        {state.responseText && (
          <div
            style={{
              alignSelf: "flex-start",
              maxWidth: "94%",
              fontSize: 13.5,
              lineHeight: 1.55,
              color: "rgba(255,255,255,0.92)",
            }}
          >
            {state.responseText}
          </div>
        )}
      </div>

      <TextComposer />
    </motion.div>
  );
}
