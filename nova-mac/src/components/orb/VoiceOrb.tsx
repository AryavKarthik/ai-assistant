import { memo, useEffect, useRef } from "react";
import { WebGLVoiceOrb, type OrbVisualState } from "./webgl-voice-orb";

export type VoiceVisualMode =
  | "idle"
  | "listening"
  | "barge_in"
  | "processing"
  | "thinking"
  | "speaking";

interface VoiceOrbProps {
  visualMode: VoiceVisualMode;
  audioLevel: number;
  /** CSS pixel size of the orb's bounding box. Default 200. */
  size?: number;
}

// Our 6-state voice machine collapses onto the orb's 4 visual states —
// "still listening" reads as idle (grey/calm), matching the reference orb's
// own recommended mapping.
function toOrbState(mode: VoiceVisualMode): OrbVisualState {
  switch (mode) {
    case "thinking":
    case "processing":
      return "thinking";
    case "speaking":
      return "speaking";
    case "barge_in":
      return "bargein";
    default:
      return "idle";
  }
}

export const VoiceOrb = memo(function VoiceOrb({ visualMode, audioLevel, size = 200 }: VoiceOrbProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const orbRef = useRef<WebGLVoiceOrb | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const orb = new WebGLVoiceOrb(containerRef.current, { size });
    orbRef.current = orb;
    orb.setState(toOrbState(visualMode));
    orb.show();
    return () => {
      orb.destroy();
      orbRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    orbRef.current?.setState(toOrbState(visualMode));
  }, [visualMode]);

  useEffect(() => {
    orbRef.current?.setAudioLevel(audioLevel);
  }, [audioLevel]);

  return (
    <div
      ref={containerRef}
      style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center" }}
      aria-hidden
    />
  );
});
