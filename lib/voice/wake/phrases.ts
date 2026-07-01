export const DEFAULT_WAKE_PHRASES = ["hey nova"] as const;

const LOOSE_ALIASES: Record<string, string[]> = {
  "hey nova": ["hey noah", "hay nova", "hey no va"],
};

export function normalizeWakeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeWakePhrase(phrase: string): string {
  return normalizeWakeTranscript(phrase);
}

export function parseWakePhrasesInput(raw: string): string[] {
  const phrases = raw
    .split(/[\n,]+/)
    .map((part) => normalizeWakePhrase(part))
    .filter(Boolean);
  return [...new Set(phrases)];
}

export function formatWakePhrasesForInput(phrases: string[]): string {
  const normalized = phrases.map(normalizeWakePhrase).filter(Boolean);
  return (normalized.length ? normalized : [...DEFAULT_WAKE_PHRASES]).join("\n");
}

export function resolveWakePhrases(phrases?: string[] | null): string[] {
  const configured = (phrases ?? [])
    .map(normalizeWakePhrase)
    .filter(Boolean);
  if (configured.length) return [...new Set(configured)];
  return [...DEFAULT_WAKE_PHRASES];
}

function containsPhrase(normalized: string, phrase: string): boolean {
  if (!normalized || !phrase) return false;
  if (normalized === phrase) return true;
  if (normalized.startsWith(`${phrase} `)) return true;
  if (normalized.endsWith(` ${phrase}`)) return true;
  return normalized.includes(` ${phrase} `) || normalized.includes(phrase);
}

/** Map slider (0.35–0.85) to match strictness. */
export function matchesWakePhrase(
  transcript: string,
  sensitivity: number,
  phrases: string[] = [...DEFAULT_WAKE_PHRASES],
): boolean {
  const normalized = normalizeWakeTranscript(transcript);
  if (!normalized) return false;

  const clamped = Math.min(0.85, Math.max(0.35, sensitivity));
  const configured = resolveWakePhrases(phrases);

  for (const phrase of configured) {
    if (containsPhrase(normalized, phrase)) {
      return true;
    }
  }

  if (clamped >= 0.55) {
    for (const phrase of configured) {
      const aliases = LOOSE_ALIASES[phrase] ?? [];
      if (aliases.some((alias) => containsPhrase(normalized, alias))) {
        return true;
      }
    }
  }

  return false;
}

export function getWakePhraseLabel(phrases?: string[] | null): string {
  const primary = resolveWakePhrases(phrases)[0] ?? DEFAULT_WAKE_PHRASES[0];
  return primary
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Build transcript windows to check from a speech-recognition result list. */
export function wakeTranscriptCandidates(
  results: SpeechRecognitionResultList,
  resultIndex: number,
): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (!result) continue;
    for (let alt = 0; alt < result.length; alt += 1) {
      const text = result[alt]?.transcript?.trim();
      if (text) chunks.push(text);
    }
  }

  const byResult: string[] = [];
  for (let i = 0; i < results.length; i += 1) {
    byResult.push(results[i]?.[0]?.transcript ?? "");
  }

  const recentSlice = byResult.slice(Math.max(0, resultIndex));
  const tailSlice = byResult.slice(-3);

  return [
    chunks.join(" "),
    byResult.join(" "),
    recentSlice.join(" "),
    tailSlice.join(" "),
    ...chunks,
  ];
}
