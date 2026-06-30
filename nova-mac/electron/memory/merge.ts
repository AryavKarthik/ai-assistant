import {
  extractSignificantTerms,
  normalizeContent,
} from "./keywords";

const CORRECTION_PATTERN =
  /\b(not|no longer|actually|instead|rather|correction|i mean|wrong)\b/i;

function isEducationCorrection(existing: string, incoming: string): boolean {
  const educationTerms = /school|university|college|student/i;
  if (!educationTerms.test(existing) || !educationTerms.test(incoming)) {
    return false;
  }

  return (
    CORRECTION_PATTERN.test(incoming) ||
    /\bnot\b.*\bschool\b/i.test(incoming) ||
    (/university|college/i.test(incoming) && /\bschool\b/i.test(existing))
  );
}

function termOverlapScore(a: string, b: string): number {
  const termsA = new Set(extractSignificantTerms(a, 14));
  const termsB = new Set(extractSignificantTerms(b, 14));
  if (termsA.size === 0 || termsB.size === 0) return 0;

  let intersection = 0;
  for (const term of termsA) {
    if (termsB.has(term)) intersection++;
  }

  return intersection / Math.min(termsA.size, termsB.size);
}

// Combine an incoming fact with an existing one when they clearly describe the same topic.
export function mergeMemoryContent(existing: string, incoming: string): string {
  const normExisting = normalizeContent(existing);
  const normIncoming = normalizeContent(incoming);

  if (!normIncoming) return existing;
  if (!normExisting) return incoming;
  if (normExisting === normIncoming) return existing;

  // Corrections and explicit negations always win over older facts.
  if (CORRECTION_PATTERN.test(incoming) || isEducationCorrection(existing, incoming)) {
    return incoming.trim();
  }

  if (normIncoming.includes(normExisting)) return incoming.trim();
  if (normExisting.includes(normIncoming)) return existing.trim();

  const overlap = termOverlapScore(existing, incoming);
  if (overlap < 0.35) return incoming.trim();

  // Same topic — prefer the richer, more complete sentence.
  if (incoming.trim().length >= existing.trim().length) {
    return incoming.trim();
  }
  return existing.trim();
}
