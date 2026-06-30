import type { ModelComplexity } from "./types";

// Sonnet only when the user clearly wants deep reasoning, planning, or analysis.
const HEAVY_PATTERNS: RegExp[] = [
  /\b(step-by-step|step by step)\b/i,
  /\bpros and cons\b/i,
  /\broot cause\b/i,
  /\bimplementation plan\b/i,
  /\bsystem design\b/i,
  /\btrade-?offs?\b/i,
  /\bdeep dive\b/i,
  /\b(detailed|comprehensive)\s+(analysis|plan|breakdown|review)\b/i,
  /\b(compare|contrast)\s+\S+(\s+\S+){0,6}\s+(and|vs\.?|versus)\b/i,
  /\b(write|draft|create)\s+(a\s+)?(detailed\s+)?(plan|strategy|architecture|spec|proposal)\b/i,
  /\b(debug|diagnose)\s+(this|the|my)\s+(code|bug|error|issue|problem)\b/i,
  /\bfigure out why\b/i,
  /\bthink (this )?through carefully\b/i,
  /\breason (this )?through\b/i,
];

export function inferComplexity(message: string): ModelComplexity {
  const normalized = message.trim();
  if (!normalized) return "light";

  const lower = normalized.toLowerCase();

  if (HEAVY_PATTERNS.some((pattern) => pattern.test(lower))) {
    return "heavy";
  }

  // Very long, multi-part asks only — not everyday 2–3 sentence chat.
  const sentenceCount = lower
    .split(/[.!?]+/)
    .map((part) => part.trim())
    .filter(Boolean).length;

  if (normalized.length > 1200 || sentenceCount >= 6) {
    return "heavy";
  }

  return "light";
}
