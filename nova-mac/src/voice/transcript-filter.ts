import { normalizeTranscriptText } from "./transcript-normalize";
import { isVoiceStopPhrase } from "./stop-phrases";

/** Common STT hallucinations from silence / background noise. */
const NOISE_PHRASES = new Set([
  "you",
  "uh",
  "um",
  "hmm",
  "ah",
  "oh",
  "the",
  "a",
  "i",
  "it",
  "thanks for watching",
  "thank you for watching",
  "subscribe",
  "like and subscribe",
  "music",
  "applause",
]);

const SHORT_GARBAGE = /^(thanks|thank you|bye|okay|ok)\.?$/i;

/** Returns true if transcript looks like noise, not real speech. */
export function isGarbageTranscript(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return true;
  if (!/[a-zA-Z0-9]/.test(trimmed)) return true;

  const normalized = normalizeTranscriptText(trimmed);

  if (NOISE_PHRASES.has(normalized)) return true;
  if (isVoiceStopPhrase(normalized)) return false;
  if (SHORT_GARBAGE.test(normalized)) return true;

  return false;
}

export function sanitizeTranscript(text: string): string {
  const trimmed = text.trim();
  if (isVoiceStopPhrase(trimmed)) return trimmed;
  if (isGarbageTranscript(trimmed)) return "";
  return trimmed;
}
