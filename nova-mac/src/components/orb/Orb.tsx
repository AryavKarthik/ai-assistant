import type { OrbState } from "../../orb/orb-machine";
import type { OrbStateName } from "@shared/types";
import { VoiceOrb, type VoiceVisualMode } from "./VoiceOrb";

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

interface OrbProps {
  state: OrbState;
  level: number;
  onSummon?: () => void;
  onStop?: () => void;
  onExpand?: () => void;
}

export function Orb({ state, level, onExpand }: OrbProps) {
  const visualMode = toVisualMode(state.name);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: "24px 16px",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      {/* Gear button */}
      <button
        onClick={onExpand}
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          background: "rgba(255,255,255,0.08)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 8,
          color: "rgba(255,255,255,0.6)",
          cursor: "pointer",
          fontSize: 16,
          padding: "4px 8px",
          lineHeight: 1,
        }}
        title="Open settings"
      >
        ⚙
      </button>

      <VoiceOrb visualMode={visualMode} audioLevel={level} />

      {/* Transcript / response text */}
      {state.transcript && (
        <div
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.55)",
            textAlign: "center",
            maxWidth: 340,
            lineHeight: 1.5,
          }}
        >
          {state.transcript}
        </div>
      )}
      {state.responseText && (
        <div
          style={{
            fontSize: 14,
            color: "rgba(255,255,255,0.88)",
            textAlign: "center",
            maxWidth: 340,
            lineHeight: 1.6,
          }}
        >
          {state.responseText}
        </div>
      )}
      {state.error && (
        <div style={{ fontSize: 12, color: "rgba(255,80,80,0.9)", textAlign: "center" }}>
          {state.error}
        </div>
      )}
    </div>
  );
}
