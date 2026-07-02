import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import type { OrbStateName } from "@shared/types";
import { VoiceOrb, type VoiceVisualMode } from "./VoiceOrb";
import { TextComposer } from "../composer/TextComposer";
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

// Only surface text for things sound cues alone can't explain (an actual
// error, or a timer notice). No routine "Say Hey Jarvis" / "Listening…" /
// "Thinking…" captions — the orb's own color is that feedback now.
function noticeText(state: OrbState): string | null {
  return state.error ?? state.notice ?? null;
}

function noticeTone(state: OrbState): string {
  if (state.error) return "rgba(255, 120, 120, 0.95)";
  return "rgba(255, 214, 130, 0.95)";
}

interface OrbProps {
  state: OrbState;
  level: number;
  onSummon?: () => void;
  onStop?: () => void;
  onExpand?: () => void;
  onCollapse?: () => void;
  onSend?: (text: string) => void;
}

export function Orb({ state, level, onExpand, onCollapse, onSend }: OrbProps) {
  const visualMode = toVisualMode(state.name);
  const active = state.name !== "dormant";
  const scrollRef = useRef<HTMLDivElement>(null);
  const notice = noticeText(state);
  const wiggle = useOrbDragWiggle();

  // Keep the newest streamed text in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state.responseText]);

  return (
    <motion.div
      // Grows from the top-right corner, where the mini orb was sitting —
      // reads as the orb itself expanding, not a separate window sliding in.
      // No background/border/shadow at all — the window underneath is fully
      // transparent, so this is the orb and its content floating directly on
      // the desktop, same as the collapsed mini orb.
      initial={{ opacity: 0, scale: 0.55 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={appleSpring}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        boxSizing: "border-box",
        transformOrigin: "top right",
      }}
    >
      {/* Drag strip + minimal icon controls (no visible app chrome, like Siri) */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 4,
          padding: "10px 10px 0",
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
      >
        <button
          onClick={onExpand}
          title="Open Nova settings"
          style={{
            WebkitAppRegion: "no-drag",
            background: "transparent",
            border: "none",
            borderRadius: 999,
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontSize: 13,
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s, color 0.15s",
          } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.color = "rgba(255,255,255,0.75)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "rgba(255,255,255,0.4)";
          }}
        >
          ⚙
        </button>
        <button
          onClick={onCollapse}
          title="Collapse to orb"
          style={{
            WebkitAppRegion: "no-drag",
            background: "transparent",
            border: "none",
            borderRadius: 999,
            color: "rgba(255,255,255,0.4)",
            cursor: "pointer",
            fontSize: 13,
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "background 0.15s, color 0.15s",
          } as React.CSSProperties}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(255,255,255,0.08)";
            e.currentTarget.style.color = "rgba(255,255,255,0.75)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
            e.currentTarget.style.color = "rgba(255,255,255,0.4)";
          }}
        >
          ▴
        </button>
      </div>

      {/* Orb + (only when there's something worth reading) a notice */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
          paddingTop: 0,
        }}
      >
        <motion.div
          animate={{ scale: active ? 1 : 0.92 }}
          transition={appleSpring}
        >
          <motion.div
            animate={{ scaleX: wiggle.scaleX, scaleY: wiggle.scaleY, rotate: wiggle.rotate }}
            transition={jellySpring}
          >
            <VoiceOrb visualMode={visualMode} audioLevel={level} size={118} />
          </motion.div>
        </motion.div>

        <AnimatePresence>
          {notice && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              style={{
                fontSize: 13,
                fontWeight: 500,
                color: noticeTone(state),
                minHeight: 18,
              }}
            >
              {notice}
            </motion.div>
          )}
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
                color: "rgba(255,255,255,0.7)",
                background: "rgba(255,255,255,0.09)",
                backdropFilter: "blur(20px) saturate(180%)",
                WebkitBackdropFilter: "blur(20px) saturate(180%)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 18,
                padding: "9px 14px",
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
              background: "rgba(255,255,255,0.06)",
              backdropFilter: "blur(20px) saturate(180%)",
              WebkitBackdropFilter: "blur(20px) saturate(180%)",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 18,
              padding: "10px 14px",
            }}
          >
            {state.responseText}
          </div>
        )}
      </div>

      <TextComposer onSend={onSend} />
    </motion.div>
  );
}
