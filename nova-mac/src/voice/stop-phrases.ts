import { normalizeTranscriptText } from "./transcript-normalize";

/** Exact dismissal phrases. Lone "bye" omitted — STT often hallucinates it. */
const VOICE_STOP_PHRASES = new Set([
  "stop",
  "stop it",
  "stop now",
  "please stop",
  "stop listening",
  "end",
  "cancel",
  "never mind",
  "nevermind",
  "that's all",
  "thats all",
  "that is all",
  "that's it",
  "thats it",
  "that is it",
  "that's enough",
  "thats enough",
  "that is enough",
  "i'm done",
  "im done",
  "we're done",
  "were done",
  "all done",
  "bye bye",
  "goodbye",
  "good bye",
  "see you",
  "see ya",
  // "that'll be all" variants
  "that'll be all",
  "thatll be all",
  "that'd be all",
  "thatd be all",
  "that should be all",
  "that should do it",
  "that should do",
  "that will be all",
  "that will do",
  "that will do it",
  "thank you that will be all",
  "thanks that will be all",
  // "thank you very much" and similar sign-offs
  "thank you very much",
  "thanks very much",
  "thank you so much",
  "thanks so much",
  "thank you that's all",
  "thank you thats all",
  "thank you that is all",
  "thanks that's all",
  "thanks thats all",
  "thanks that is all",
  // "all right" / "okay" dismissals
  "all right stop",
  "alright stop",
  "ok stop",
  "okay stop",
  "right stop",
  "all right that is enough",
  "alright that is enough",
  "all right that's enough",
  "alright that's enough",
  "all right that will be all",
  "alright that will be all",
  // "can/could you stop" polite requests
  "can you stop",
  "could you stop",
  "would you stop",
  "can you please stop",
  "could you please stop",
  "would you please stop",
  "please stop now",
  // farewell variants
  "have a good one",
  "have a great day",
  "talk to you later",
  "talk later",
  "i'm good",
  "im good",
  "i'm all good",
  "im all good",
]);

const STOP_PREFIXES = [
  "that's all",
  "thats all",
  "that is all",
  "that will be all",
  "that'll be all",
  "thatll be all",
  "that should be all",
  "that should do",
] as const;

// Stripped up to 3 times to handle e.g. "okay can you stop" → "can you stop" → "stop"
const LEADING_FILLER =
  /^(thanks|thank you|ok|okay|alright|all right|right|can you|could you|would you|please)\s+/i;

const TRAILING_FILLER =
  /^(thanks|thank you|very much|so much|for now|then|please|ok|okay)$/i;

function stripTrailingFiller(normalized: string): string {
  let current = normalized;
  for (let i = 0; i < 3; i++) {
    const parts = current.split(" ");
    if (parts.length < 2) break;
    const last = parts[parts.length - 1] ?? "";
    if (!TRAILING_FILLER.test(last)) break;
    current = parts.slice(0, -1).join(" ").trim();
  }
  return current;
}

function matchesStop(candidate: string): boolean {
  if (VOICE_STOP_PHRASES.has(candidate)) return true;
  const stripped = stripTrailingFiller(candidate);
  if (stripped !== candidate && VOICE_STOP_PHRASES.has(stripped)) return true;
  if (candidate.split(" ").length <= 6) {
    return STOP_PREFIXES.some((prefix) => stripped.startsWith(prefix));
  }
  return false;
}

/** True when the utterance is a voice session dismissal phrase. */
export function isVoiceStopPhrase(text: string): boolean {
  const normalized = normalizeTranscriptText(text);
  if (!normalized) return false;

  if (matchesStop(normalized)) return true;

  // Check after each leading-filler strip so "okay thank you very much"
  // matches after stripping "okay" → "thank you very much" (without over-stripping).
  let current = normalized;
  for (let i = 0; i < 3; i++) {
    const next = current.replace(LEADING_FILLER, "").trim();
    if (next === current) break;
    current = next;
    if (matchesStop(current)) return true;
  }

  return false;
}
