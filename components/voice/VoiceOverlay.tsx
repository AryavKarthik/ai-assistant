"use client";

import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import { appIconClass, IconMicrophone, IconSettings, IconX } from "@/components/shell/icons";
import type { VoiceSessionState } from "@/lib/voice/types";
import { resolveVoiceStageTranscript } from "@/lib/voice/stage-text";
import { resolveVoiceVisualMode } from "@/lib/voice/visual-mode";
import { VoiceOrb } from "./VoiceOrb";

interface MicAnchor {
  x: number;
  y: number;
  size: number;
}

interface VoiceOverlayProps {
  visible: boolean;
  micAnchorRef: RefObject<HTMLButtonElement | null>;
  sessionState: VoiceSessionState;
  statusText: string;
  assistantTurnText: string;
  conversationMode: boolean;
  wakeWordMode: boolean;
  bargeInActive?: boolean;
  audioLevel: number;
  error: string | null;
  onStop: () => void;
  onOpenSettings: () => void;
  onDismissError: () => void;
  currentTopic?: string;
  memoryFlash?: boolean;
}

const DEFAULT_ANCHOR: MicAnchor = { x: 0, y: 0, size: 44 };

const STAGE_SPRING = { type: "spring" as const, damping: 34, stiffness: 210, mass: 0.92 };

const WF_BAR_HEIGHTS = Array.from({ length: 32 }, (_, i) =>
  Math.max(6, 40 - Math.abs(15.5 - i) * 2.2),
);

const MODE_LABELS: Record<string, string> = {
  idle: "READY",
  listening: "LISTENING",
  barge_in: "INTERRUPTING",
  processing: "PROCESSING",
  thinking: "THINKING",
  speaking: "SPEAKING",
};

function measureMicAnchor(ref: RefObject<HTMLButtonElement | null>): MicAnchor {
  const el = ref.current;
  if (!el) return DEFAULT_ANCHOR;
  const rect = el.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
    size: Math.max(rect.width, rect.height),
  };
}

export const VoiceOverlay = memo(function VoiceOverlay({
  visible,
  micAnchorRef,
  sessionState,
  statusText,
  assistantTurnText,
  wakeWordMode,
  bargeInActive = false,
  audioLevel,
  error,
  onStop,
  onOpenSettings,
  onDismissError,
  currentTopic,
  memoryFlash = false,
}: VoiceOverlayProps) {
  const [flashKey, setFlashKey] = useState(0);
  const prevFlash = useRef(false);

  useEffect(() => {
    if (memoryFlash && !prevFlash.current) {
      setFlashKey(k => k + 1);
    }
    prevFlash.current = memoryFlash;
  }, [memoryFlash]);
  const [anchor, setAnchor] = useState<MicAnchor>(DEFAULT_ANCHOR);
  const [mounted, setMounted] = useState(false);

  const visualMode = resolveVoiceVisualMode(sessionState, bargeInActive);
  const transcript = resolveVoiceStageTranscript(
    sessionState,
    bargeInActive,
    statusText,
    assistantTurnText,
    wakeWordMode,
  );

  const isSpeaking = visualMode === "speaking";
  const showWaveform =
    visualMode === "listening" || visualMode === "barge_in" || isSpeaking;

  useLayoutEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!visible) return;
    setAnchor(measureMicAnchor(micAnchorRef));
    const onResize = () => setAnchor(measureMicAnchor(micAnchorRef));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [visible, micAnchorRef, sessionState]);

  useLayoutEffect(() => {
    if (!visible) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [visible]);

  const stageStyle = {
    "--voice-origin-x": `${anchor.x}px`,
    "--voice-origin-y": `${anchor.y}px`,
    "--voice-origin-size": `${anchor.size}px`,
  } as CSSProperties;

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {visible ? (
        <motion.div
          key="voice-stage"
          className={`app-voice-stage app-voice-stage--${visualMode}`}
          style={stageStyle}
          role="dialog"
          aria-modal="true"
          aria-label="Voice conversation"
          initial={{
            clipPath: `circle(${anchor.size * 0.5}px at ${anchor.x}px ${anchor.y}px)`,
            opacity: 0,
          }}
          animate={{
            clipPath: "circle(155vmax at 50% 40%)",
            opacity: 1,
          }}
          exit={{
            clipPath: `circle(${anchor.size * 0.5}px at ${anchor.x}px ${anchor.y}px)`,
            opacity: 0,
          }}
          transition={STAGE_SPRING}
        >
          <motion.div
            className="app-voice-stage-content"
            initial={{ opacity: 0, y: 36 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ ...STAGE_SPRING, delay: 0.06 }}
          >
            {/* Orb as full-screen ambient backdrop */}
            <div className="app-voice-orb-fill">
              <VoiceOrb visualMode={visualMode} audioLevel={audioLevel} />
            </div>

            {/* Identity — top left */}
            <p className="app-voice-identity" aria-hidden>NOVA</p>

            {/* Status label — top right */}
            <div className="app-voice-status-wrap" aria-hidden>
              <div className="app-voice-status-text">
                <span>AI ASSISTANT</span>
                <span>VOICE ACTIVE</span>
              </div>
            </div>

            {/* Context card — left side, vertically centered */}
            {currentTopic ? (
              <div className="app-voice-context-wrap" aria-hidden>
                <p className="app-voice-context-label">CURRENT TOPIC</p>
                <div className="app-voice-context-pill">{currentTopic}</div>
              </div>
            ) : null}

            {/* Bottom stack: mode label + animated dots + transcript + waveform */}
            <div className="app-voice-bottom-stack">
              <p className="app-voice-mode-name">
                {MODE_LABELS[visualMode] ?? visualMode.toUpperCase()}
              </p>
              <div className="app-voice-dots" aria-hidden>
                <span /><span /><span />
              </div>
              {transcript ? (
                <p className="app-voice-subtitle" aria-live="polite">
                  {transcript}
                </p>
              ) : null}
              {showWaveform ? (
                <div className="app-voice-waveform" aria-hidden>
                  {isSpeaking && <div className="app-voice-wf-glow" />}
                  <div className="app-voice-wf-bars app-voice-wf-bars--main">
                    {WF_BAR_HEIGHTS.map((h, i) => (
                      <div
                        key={i}
                        className={`app-voice-wf-bar ${
                          isSpeaking
                            ? "app-voice-wf-bar--speaking"
                            : "app-voice-wf-bar--listening"
                        }`}
                        style={{
                          height: `${h}px`,
                          animationDelay: `${isSpeaking ? i * 0.05 : Math.abs(15.5 - i) * 0.05}s`,
                        }}
                      />
                    ))}
                  </div>
                  <div className="app-voice-wf-line" />
                  <div
                    className="app-voice-wf-bars app-voice-wf-bars--ref"
                    style={{ opacity: isSpeaking ? 0.3 : 0.2 }}
                  >
                    {WF_BAR_HEIGHTS.map((h, i) => (
                      <div
                        key={i}
                        className={`app-voice-wf-bar ${
                          isSpeaking
                            ? "app-voice-wf-bar--speaking-ref"
                            : "app-voice-wf-bar--listening-ref"
                        }`}
                        style={{
                          height: `${h}px`,
                          animationDelay: `${isSpeaking ? i * 0.05 : Math.abs(15.5 - i) * 0.05}s`,
                        }}
                      />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Three spread controls at bottom */}
            <div className="app-voice-controls">
              <div
                className={`app-voice-ctrl-btn app-voice-ctrl-mic--${visualMode}`}
                aria-hidden
              >
                <IconMicrophone className={appIconClass} />
              </div>
              <button
                type="button"
                className="app-voice-ctrl-btn app-voice-ctrl-stop"
                aria-label="End voice session"
                onClick={onStop}
              >
                <IconX className={appIconClass} />
              </button>
              <button
                type="button"
                className="app-voice-ctrl-btn"
                aria-label="Voice settings"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenSettings();
                }}
              >
                <IconSettings className={appIconClass} />
              </button>
            </div>

            <p className="app-voice-stage-hint" aria-hidden>
              or say &ldquo;stop&rdquo;
            </p>

            {error ? (
              <div className="app-voice-stage-error">
                <p>{error}</p>
                <button
                  type="button"
                  className="app-inline-action"
                  onClick={onDismissError}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
          </motion.div>

          {/* Memory absorbed — ripple rings outside overflow:hidden content */}
          <AnimatePresence>
            {flashKey > 0 ? (
              <div key={flashKey} className="app-voice-memory-flash" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <motion.div
                    key={i}
                    className="app-voice-memory-ring"
                    initial={{ scale: 0.5, opacity: 0.6 }}
                    animate={{ scale: 2.0, opacity: 0 }}
                    transition={{
                      duration: 1.2,
                      delay: i * 0.2,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                  />
                ))}
              </div>
            ) : null}
          </AnimatePresence>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
});
