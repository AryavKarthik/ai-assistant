export {
  getWakePhraseLabel,
  isWakeWordConfigured,
  isWakeWordSupported,
  startWakeWord,
  stopWakeWord,
} from "@/lib/voice/wake/listener";

export {
  DEFAULT_WAKE_PHRASES,
  formatWakePhrasesForInput,
  matchesWakePhrase,
  normalizeWakeTranscript,
  parseWakePhrasesInput,
  resolveWakePhrases,
} from "@/lib/voice/wake/phrases";
