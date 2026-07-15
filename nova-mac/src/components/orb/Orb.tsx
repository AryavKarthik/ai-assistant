import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import type { OrbStateName } from "@shared/types";
import { VoiceOrb, type VoiceVisualMode } from "./VoiceOrb";
import { TextComposer } from "../composer/TextComposer";
import { nova } from "../../lib/ipc";
import { linkifyText } from "../../lib/linkify";
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

// The orb never moves: it lives in a fixed box pinned to the window's
// top-right corner in BOTH modes, and only scales (transform, around its own
// center) between collapsed and expanded. The chat chrome fades in around it.
const ORB_BOX = 118;
const ORB_BOX_TOP = 8;
const ORB_BOX_RIGHT = 8;
const COLLAPSED_SCALE = 76 / ORB_BOX;
// A press that moves less than this (px, from the press point) is a click,
// anything more is a drag.
const CLICK_MOVE_THRESHOLD = 4;

interface OrbProps {
  state: OrbState;
  level: number;
  expanded: boolean;
  /** Click on the orb itself: expand when collapsed, collapse when expanded. */
  onOrbClick: () => void;
  onExpand?: () => void;
  onCollapse?: () => void;
  onSend?: (text: string) => void;
}

function ChromeButton({ label, title, onClick }: { label: string; title: string; onClick?: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
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
      {label}
    </button>
  );
}

export function Orb({ state, level, expanded, onOrbClick, onExpand, onCollapse, onSend }: OrbProps) {
  const visualMode = toVisualMode(state.name);
  const active = state.name !== "dormant";
  const scrollRef = useRef<HTMLDivElement>(null);
  const notice = noticeText(state);
  const wiggle = useOrbDragWiggle();

  // Manual drag (see MiniOrb history: a CSS drag region swallows the mouseup
  // on macOS and kills click detection). Screen-space coords — the window
  // moves under the cursor during a drag, so client coords barely change.
  const drag = useRef<{
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    /** True once movement passed the click threshold and the window follows. */
    moving: boolean;
  } | null>(null);

  // Collapsed-mode click-through: the window is always panel-sized, so while
  // collapsed everything except the orb box must let clicks fall through to
  // whatever is beneath. Main ignores mouse events with forwarding enabled,
  // which keeps mousemove observable here — we flip interactivity on hover.
  useEffect(() => {
    if (expanded) {
      nova().orbSetMouseIgnore(false);
      return;
    }
    let ignoring = true;
    nova().orbSetMouseIgnore(true);
    const onMove = (e: MouseEvent) => {
      if (drag.current) return; // never yank interactivity mid-drag
      const overOrb =
        e.clientX >= window.innerWidth - ORB_BOX_RIGHT - ORB_BOX &&
        e.clientX <= window.innerWidth - ORB_BOX_RIGHT &&
        e.clientY >= ORB_BOX_TOP &&
        e.clientY <= ORB_BOX_TOP + ORB_BOX;
      if (overOrb === ignoring) {
        ignoring = !overOrb;
        nova().orbSetMouseIgnore(ignoring);
      }
    };
    document.addEventListener("mousemove", onMove);
    return () => document.removeEventListener("mousemove", onMove);
  }, [expanded]);

  // Keep the newest streamed text in view.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [state.responseText]);

  function handlePointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      startX: e.screenX,
      startY: e.screenY,
      lastX: e.screenX,
      lastY: e.screenY,
      moving: false,
    };
  }

  function handlePointerMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    // Phantom-drag guard: if the pointerup was ever lost (window hidden
    // mid-drag, hotkey, Mission Control, capture dropped), drag.current
    // survives with no button held — and then every hover over the orb moved
    // the window by the cursor's delta, so the orb chased/"ran away from" the
    // cursor until the next click. No buttons down ⇒ this cannot be a drag.
    if (e.buttons === 0) {
      drag.current = null;
      return;
    }
    // Don't move the window until the press has clearly become a drag —
    // streaming sub-threshold jitter made every click nudge the window a
    // pixel or two and fire the jelly wiggle, which read as the orb
    // "spazzing out" on click.
    if (!d.moving) {
      const fromStartX = Math.abs(e.screenX - d.startX);
      const fromStartY = Math.abs(e.screenY - d.startY);
      if (fromStartX < CLICK_MOVE_THRESHOLD && fromStartY < CLICK_MOVE_THRESHOLD) return;
      d.moving = true;
    }
    const dx = e.screenX - d.lastX;
    const dy = e.screenY - d.lastY;
    if (dx !== 0 || dy !== 0) {
      nova().orbDragMove(dx, dy);
      d.lastX = e.screenX;
      d.lastY = e.screenY;
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const dx = Math.abs(e.screenX - d.startX);
    const dy = Math.abs(e.screenY - d.startY);
    if (dx < CLICK_MOVE_THRESHOLD && dy < CLICK_MOVE_THRESHOLD) onOrbClick();
  }

  function handlePointerCancel() {
    drag.current = null;
  }

  // Expanded-panel drag: same manual pointer-drag as the orb (pointer capture
  // + OrbDragMove deltas). Native -webkit-app-region:drag hands the mousedown
  // to the OS drag session on macOS and swallows the mouseup, and in practice
  // it never reliably moved this transparent always-on-top window — so the
  // chat panel simply couldn't be repositioned. Buttons bail out before the
  // capture so their clicks still land.
  const panelDrag = useRef<{ lastX: number; lastY: number } | null>(null);

  function handlePanelPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, input, textarea, a")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    panelDrag.current = { lastX: e.screenX, lastY: e.screenY };
  }

  function handlePanelPointerMove(e: React.PointerEvent) {
    const d = panelDrag.current;
    if (!d) return;
    // Same phantom-drag guard as the orb's handlePointerMove.
    if (e.buttons === 0) {
      panelDrag.current = null;
      return;
    }
    const dx = e.screenX - d.lastX;
    const dy = e.screenY - d.lastY;
    if (dx !== 0 || dy !== 0) {
      nova().orbDragMove(dx, dy);
      d.lastX = e.screenX;
      d.lastY = e.screenY;
    }
  }

  function handlePanelPointerEnd() {
    panelDrag.current = null;
  }

  // Chrome scales out of the orb's center so expanding reads as the orb
  // blooming into the panel, not a separate window appearing.
  const orbCenterX = `calc(100% - ${ORB_BOX_RIGHT + ORB_BOX / 2}px)`;
  const orbCenterY = `${ORB_BOX_TOP + ORB_BOX / 2}px`;

  return (
    // Viewport units, not %: html/body/#root never get an explicit height
    // anywhere in this app (AppShell.tsx uses the same 100vh trick for the
    // same reason) — a plain height:"100%" here has no ancestor chain to
    // resolve against, so it computes to auto/0 and every absolutely
    // positioned child below (the orb, the inset:0 chrome) loses its real
    // containing block and collapses/mispositions.
    <div style={{ position: "relative", width: "100vw", height: "100vh" }}>
      <AnimatePresence>
        {expanded && (
          <motion.div
            key="chrome"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={appleSpring}
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              boxSizing: "border-box",
              transformOrigin: `${orbCenterX} ${orbCenterY}`,
            }}
          >
            {/* Header row: a manual drag strip (pointer capture + OrbDragMove,
                same mechanism as the orb) that stops short of the orb's box.
                Deliberately NOT -webkit-app-region:drag — see the panel-drag
                handlers above for why native drag regions are off-limits in
                this window. */}
            <div style={{ height: ORB_BOX_TOP + ORB_BOX, display: "flex", alignItems: "flex-start", boxSizing: "border-box" }}>
              <div
                onPointerDown={handlePanelPointerDown}
                onPointerMove={handlePanelPointerMove}
                onPointerUp={handlePanelPointerEnd}
                onPointerCancel={handlePanelPointerEnd}
                onLostPointerCapture={handlePanelPointerEnd}
                title="Drag to move Nova"
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 4,
                  padding: "10px 0 0 10px",
                  boxSizing: "border-box",
                  width: `calc(100% - ${ORB_BOX_RIGHT + ORB_BOX}px)`,
                  height: "100%",
                  cursor: "grab",
                }}
              >
                <ChromeButton label="⚙" title="Open Nova settings" onClick={onExpand} />
                <ChromeButton label="▴" title="Collapse to orb" onClick={onCollapse} />
              </div>
            </div>

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
                    textAlign: "center",
                  }}
                >
                  {notice}
                </motion.div>
              )}
            </AnimatePresence>

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
                    overflowWrap: "break-word",
                  }}
                >
                  {linkifyText(state.responseText)}
                </div>
              )}
            </div>

            <TextComposer onSend={onSend} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* The orb — rendered after (above) the chrome so its pointer handlers
          win over the drag strip. Fixed box, never unmounts, never moves:
          only its scale animates between modes, around its own center. */}
      <motion.div
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handlePointerCancel}
        title={expanded ? "Nova — click to collapse, drag to move" : "Nova — click to open, drag to move"}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        whileHover={{ scale: 1.06 }}
        transition={appleSpring}
        style={{
          position: "absolute",
          top: ORB_BOX_TOP,
          right: ORB_BOX_RIGHT,
          width: ORB_BOX,
          height: ORB_BOX,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
        }}
      >
        <motion.div
          animate={{ scale: (expanded ? 1 : COLLAPSED_SCALE) * (active ? 1 : 0.92) }}
          transition={appleSpring}
        >
          <motion.div
            animate={{ scaleX: wiggle.scaleX, scaleY: wiggle.scaleY, rotate: wiggle.rotate }}
            transition={jellySpring}
          >
            {/* Speaking bobble: a gentle vertical bob + breathing scale while
                the reply is being spoken, on its own wrapper so it composes
                with (rather than fights) the drag wiggle above. */}
            <motion.div
              animate={
                visualMode === "speaking"
                  ? { y: [0, -3.5, 0.5, 2.5, 0], scale: [1, 1.025, 1, 0.985, 1] }
                  : { y: 0, scale: 1 }
              }
              transition={
                visualMode === "speaking"
                  ? { duration: 1.35, repeat: Infinity, ease: "easeInOut" }
                  : appleSpring
              }
            >
              <VoiceOrb visualMode={visualMode} audioLevel={level} size={ORB_BOX} />
            </motion.div>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}
