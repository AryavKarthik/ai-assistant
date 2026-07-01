"use client";

import { memo, useEffect, useRef } from "react";
import type { VoiceVisualMode } from "@/lib/voice/visual-mode";

interface VoiceOrbProps {
  visualMode: VoiceVisualMode;
  audioLevel: number;
}

const PALETTES: Record<
  VoiceVisualMode,
  { core: string; mid: string; rim: string; glow: string; speed: number }
> = {
  idle: {
    core: "rgba(220, 220, 228, 0.35)",
    mid: "rgba(90, 90, 100, 0.22)",
    rim: "rgba(255, 255, 255, 0.18)",
    glow: "rgba(255, 255, 255, 0.05)",
    speed: 0.01,
  },
  listening: {
    core: "rgba(255, 255, 255, 0.92)",
    mid: "rgba(200, 210, 255, 0.45)",
    rim: "rgba(147, 197, 253, 0.75)",
    glow: "rgba(96, 165, 250, 0.22)",
    speed: 0.022,
  },
  barge_in: {
    core: "rgba(255, 236, 180, 0.95)",
    mid: "rgba(251, 191, 36, 0.5)",
    rim: "rgba(251, 191, 36, 0.85)",
    glow: "rgba(245, 158, 11, 0.28)",
    speed: 0.034,
  },
  processing: {
    core: "rgba(230, 230, 235, 0.8)",
    mid: "rgba(160, 160, 175, 0.4)",
    rim: "rgba(255, 255, 255, 0.45)",
    glow: "rgba(255, 255, 255, 0.1)",
    speed: 0.04,
  },
  thinking: {
    core: "rgba(210, 200, 255, 0.85)",
    mid: "rgba(167, 139, 250, 0.42)",
    rim: "rgba(196, 181, 253, 0.7)",
    glow: "rgba(139, 92, 246, 0.2)",
    speed: 0.018,
  },
  speaking: {
    core: "rgba(190, 255, 220, 0.9)",
    mid: "rgba(52, 211, 153, 0.42)",
    rim: "rgba(74, 222, 128, 0.75)",
    glow: "rgba(16, 185, 129, 0.24)",
    speed: 0.026,
  },
};

export const VoiceOrb = memo(function VoiceOrb({
  visualMode,
  audioLevel,
}: VoiceOrbProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const levelRef = useRef(audioLevel);
  const modeRef = useRef(visualMode);

  useEffect(() => {
    levelRef.current = audioLevel;
  }, [audioLevel]);

  useEffect(() => {
    modeRef.current = visualMode;
  }, [visualMode]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let phase = 0;

    const draw = () => {
      const w = canvas.width;
      const h = canvas.height;
      const cx = w / 2;
      const cy = h / 2;
      const baseR = Math.min(w, h) * 0.34;
      const level = levelRef.current;
      const mode = modeRef.current;
      const palette = PALETTES[mode];
      const reactive =
        mode === "listening" || mode === "barge_in" || mode === "processing";

      phase +=
        palette.speed + (reactive ? level * 0.05 : 0) + (mode === "thinking" ? 0.006 : 0);

      ctx.clearRect(0, 0, w, h);

      const glow = ctx.createRadialGradient(cx, cy, baseR * 0.15, cx, cy, baseR * 1.45);
      glow.addColorStop(0, palette.glow);
      glow.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, w, h);

      const blobCount = mode === "processing" ? 2 : 3;
      for (let i = 0; i < blobCount; i++) {
        const t = phase + i * (mode === "processing" ? 1.4 : 2.1);
        const wobble =
          Math.sin(t) * (mode === "barge_in" ? 0.14 : 0.08) +
          Math.cos(t * 1.3) * 0.06;
        const levelBoost = reactive ? level * 0.18 : mode === "speaking" ? 0.08 : 0.03;
        const r = baseR * (0.9 + wobble + levelBoost);
        const ox =
          Math.cos(t * (mode === "processing" ? 1.8 : 0.7)) *
          baseR *
          (mode === "barge_in" ? 0.18 : 0.11);
        const oy =
          Math.sin(t * (mode === "processing" ? 2.1 : 0.9)) *
          baseR *
          (mode === "barge_in" ? 0.16 : 0.09);

        const blob = ctx.createRadialGradient(
          cx + ox,
          cy + oy,
          r * 0.12,
          cx + ox,
          cy + oy,
          r,
        );
        blob.addColorStop(0, palette.core);
        blob.addColorStop(0.38, palette.mid);
        blob.addColorStop(0.72, "rgba(30, 30, 36, 0.35)");
        blob.addColorStop(1, "rgba(0, 0, 0, 0)");

        ctx.fillStyle = blob;
        ctx.beginPath();
        ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.strokeStyle = palette.rim;
      ctx.lineWidth = mode === "barge_in" ? 3 : 2;
      ctx.beginPath();
      ctx.arc(cx, cy, baseR * 0.98, 0, Math.PI * 2);
      ctx.stroke();

      if (mode === "listening" || mode === "barge_in") {
        const ringR = baseR * (1.08 + level * 0.22);
        ctx.strokeStyle = palette.rim.replace(/[\d.]+\)$/, "0.35)");
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={`app-voice-orb-shell app-voice-orb-shell--${visualMode}`}
      aria-hidden
    >
      <canvas ref={canvasRef} className="app-voice-orb-canvas" width={400} height={400} />
    </div>
  );
});
