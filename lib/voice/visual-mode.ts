import type { VoiceSessionState } from "@/lib/voice/types";

export type VoiceVisualMode =
  | "idle"
  | "listening"
  | "barge_in"
  | "processing"
  | "thinking"
  | "speaking";

export function resolveVoiceVisualMode(
  sessionState: VoiceSessionState,
  bargeInActive: boolean,
): VoiceVisualMode {
  if (bargeInActive && sessionState === "listening") return "barge_in";
  switch (sessionState) {
    case "listening":
      return "listening";
    case "processing_stt":
    case "sending":
      return "processing";
    case "assistant_streaming":
      return "thinking";
    case "assistant_speaking":
      return "speaking";
    default:
      return "idle";
  }
}

export const VOICE_MODE_META: Record<
  VoiceVisualMode,
  { label: string; hint: string }
> = {
  idle: {
    label: "Ready",
    hint: "Start speaking when you're ready",
  },
  listening: {
    label: "Listening",
    hint: "I'll send when you pause",
  },
  barge_in: {
    label: "Interrupting",
    hint: "Speak your new request",
  },
  processing: {
    label: "Processing",
    hint: "Turning speech into text",
  },
  thinking: {
    label: "Thinking",
    hint: "Preparing a reply",
  },
  speaking: {
    label: "Speaking",
    hint: "Talk anytime to interrupt",
  },
};
