import {
  getWakePhraseLabel,
  matchesWakePhrase,
  resolveWakePhrases,
  wakeTranscriptCandidates,
} from "@/lib/voice/wake/phrases";

type SpeechRecognitionCtor = SpeechRecognitionConstructor;

const DETECTION_COOLDOWN_MS = 2_500;
const RESTART_DELAY_MS = 250;

let recognition: SpeechRecognition | null = null;
let listening = false;
let lastDetectionAt = 0;
let restartTimer: number | null = null;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

function clearRestartTimer(): void {
  if (restartTimer !== null) {
    window.clearTimeout(restartTimer);
    restartTimer = null;
  }
}

async function ensureMicrophonePermission(): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) return;
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  stream.getTracks().forEach((track) => track.stop());
}

export function isWakeWordSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

/** @deprecated Use isWakeWordSupported */
export function isWakeWordConfigured(): boolean {
  return isWakeWordSupported();
}

export { getWakePhraseLabel };

export async function startWakeWord(options: {
  sensitivity: number;
  phrases?: string[];
  onDetected: () => void;
  onError: (message: string) => void;
}): Promise<void> {
  await stopWakeWord();

  const Recognition = getSpeechRecognitionCtor();
  if (!Recognition) {
    throw new Error(
      "Wake word needs a browser with speech recognition (Chrome, Edge, or Safari).",
    );
  }

  try {
    await ensureMicrophonePermission();
  } catch {
    throw new Error("Microphone permission is required for wake word.");
  }

  const instance = new Recognition();
  instance.continuous = true;
  instance.interimResults = true;
  instance.lang = navigator.language?.startsWith("en")
    ? navigator.language
    : "en-AU";
  instance.maxAlternatives = 3;

  const phrases = resolveWakePhrases(options.phrases);

  const handleDetection = () => {
    const now = Date.now();
    if (now - lastDetectionAt < DETECTION_COOLDOWN_MS) return;
    lastDetectionAt = now;
    options.onDetected();
  };

  instance.onresult = (event: SpeechRecognitionEvent) => {
    const candidates = wakeTranscriptCandidates(
      event.results,
      event.resultIndex,
    );
    for (const candidate of candidates) {
      if (matchesWakePhrase(candidate, options.sensitivity, phrases)) {
        handleDetection();
        return;
      }
    }
  };

  instance.onerror = (event: SpeechRecognitionErrorEvent) => {
    if (
      event.error === "aborted" ||
      event.error === "no-speech" ||
      event.error === "network"
    ) {
      return;
    }
    const message =
      event.error === "not-allowed"
        ? "Microphone permission is required for wake word."
        : `Wake word error: ${event.error}`;
    options.onError(message);
  };

  instance.onend = () => {
    if (!listening || recognition !== instance) return;
    clearRestartTimer();
    restartTimer = window.setTimeout(() => {
      if (!listening || recognition !== instance) return;
      try {
        instance.start();
      } catch {
        // Will retry on the next end event.
      }
    }, RESTART_DELAY_MS);
  };

  listening = true;
  recognition = instance;
  instance.start();
}

export async function stopWakeWord(): Promise<void> {
  listening = false;
  clearRestartTimer();
  const instance = recognition;
  recognition = null;

  if (!instance) return;

  instance.onresult = null;
  instance.onerror = null;
  instance.onend = null;

  try {
    instance.abort();
  } catch {
    // ignore
  }

  try {
    instance.stop();
  } catch {
    // ignore
  }
}
