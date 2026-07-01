import { getWakePhraseLabel } from "@/lib/voice/wake/phrases";
import type { VoiceSessionState } from "@/lib/voice/types";
import {
  resolveVoiceVisualMode,
  type VoiceVisualMode,
} from "@/lib/voice/visual-mode";

const SYSTEM_STATUS_PATTERNS = [
  /^hearing you/i,
  /^recording/i,
  /^listening for wake word/i,
  /^speak now/i,
  /^interrupting/i,
  /^transcribing/i,
  /^didn't catch that/i,
  /^voice paused/i,
];

export function isVoiceSystemStatus(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SYSTEM_STATUS_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function resolveVoiceStageTranscript(
  sessionState: VoiceSessionState,
  bargeInActive: boolean,
  statusText: string,
  assistantTurnText: string,
  wakeWordMode = false,
): string {
  const mode = resolveVoiceVisualMode(sessionState, bargeInActive);

  if (mode === "thinking" || mode === "speaking") {
    return assistantTurnText.trim();
  }

  if (
    mode === "listening" ||
    mode === "barge_in" ||
    mode === "processing"
  ) {
    const status = statusText.trim();
    if (status && !isVoiceSystemStatus(status)) {
      return status;
    }
  }

  if (mode === "idle" && wakeWordMode) {
    return `Say "${getWakePhraseLabel()}"`;
  }

  return "";
}

export function shouldAnimateVoiceStageText(
  mode: VoiceVisualMode,
  text: string,
): boolean {
  return mode === "thinking" && Boolean(text);
}
