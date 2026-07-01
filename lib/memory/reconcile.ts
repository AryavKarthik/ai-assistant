import {
  extractSignificantTerms,
  normalizeContent,
} from "@/lib/memory/keywords";
import type { MemoryCategory } from "@/lib/supabase/types";
import type { MemorySearchResult } from "@/lib/memory/search";

const SUBJECT_PATTERNS: Array<{
  regex: RegExp;
  subject: string | ((match: RegExpMatchArray) => string);
}> = [
  { regex: /\b(?:live|lives|living) in\b/i, subject: "residence" },
  { regex: /\b(?:from|hail from)\b/i, subject: "origin" },
  {
    regex: /\bfavorite ([\w\s]+?)(?:\s+is\b|$)/i,
    subject: (match) => `favorite_${normalizeToken(match[1])}`,
  },
  {
    regex: /\ballergic to ([\w-]+)/i,
    subject: (match) => `allergy_${normalizeToken(match[1])}`,
  },
  { regex: /\bworks? (?:at|for)\b/i, subject: "workplace" },
  { regex: /\b(?:job|role) (?:is|as)\b/i, subject: "job_title" },
  { regex: /\b(?:name is|called|goes by)\b/i, subject: "name" },
  { regex: /\b(?:birthday|born (?:on|in))\b/i, subject: "birthday" },
  { regex: /\b\d+ years old\b/i, subject: "age" },
  { regex: /\b(?:phone|number is)\b/i, subject: "phone" },
  { regex: /\b(?:email|e-mail)\b/i, subject: "email" },
  { regex: /\b(?:address is|lives at)\b/i, subject: "address" },
  {
    regex: /\b(?:partner|spouse|wife|husband|boyfriend|girlfriend)(?:'s name)?\b/i,
    subject: "partner",
  },
  {
    regex: /\b(?:brother|sister|sibling)\b/i,
    subject: "sibling",
  },
  {
    regex: /\b(?:mom|mum|mother)\b/i,
    subject: "mother",
  },
  {
    regex: /\b(?:dad|father)\b/i,
    subject: "father",
  },
  {
    regex: /\bfamily\b/i,
    subject: "family",
  },
  {
    regex: /\b(?:dog|cat|pet)(?:'s name)?\b/i,
    subject: (match) =>
      `pet_${normalizeToken(match[0].match(/dog|cat|pet/i)?.[0] ?? "pet")}`,
  },
  {
    regex: /\b(?:vegetarian|vegan|pescatarian|omnivore|dietary)\b/i,
    subject: "diet",
  },
  { regex: /\b(?:timezone|time zone)\b/i, subject: "timezone" },
  {
    regex: /\b(?:i usually|i always|i typically|my routine|routine is)\b/i,
    subject: "routine",
  },
  {
    regex: /\b(?:wake up|get up|go to bed|sleep at|bedtime)\b/i,
    subject: "sleep_schedule",
  },
  {
    regex: /\b(?:work out|gym|lifting|training)\b/i,
    subject: "fitness_routine",
  },
  {
    regex: /\b(?:goal is|trying to|aiming to|working toward)\b/i,
    subject: "goals",
  },
  {
    regex:
      /\b(?:studying|studies|student at|enrolled at|attends|goes to|in school|at school|major(?:ing)? in|degree in|bachelor|master'?s?|phd|doctorate|university|college|school)\b/i,
    subject: "education",
  },
];

const OVERLAP_THRESHOLD = 0.35;

export interface ReplacementCandidate {
  id: string;
  content: string;
  category: string | null;
  created_at: string;
  reason: "duplicate" | "subject_key" | "overlap" | "subset";
  score: number;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function extractSubjectKey(content: string): string | null {
  for (const rule of SUBJECT_PATTERNS) {
    const match = content.match(rule.regex);
    if (!match) continue;
    return typeof rule.subject === "function" ? rule.subject(match) : rule.subject;
  }
  return null;
}

function termOverlapScore(a: string, b: string): number {
  const termsA = new Set(extractSignificantTerms(a, 14));
  const termsB = new Set(extractSignificantTerms(b, 14));
  if (termsA.size === 0 || termsB.size === 0) return 0;

  let intersection = 0;
  for (const term of termsA) {
    if (termsB.has(term)) intersection++;
  }

  const union = new Set([...termsA, ...termsB]).size;
  const jaccard = intersection / union;
  const minCoverage = intersection / Math.min(termsA.size, termsB.size);
  return Math.max(jaccard, minCoverage);
}

function scorePair(
  newContent: string,
  candidate: MemorySearchResult,
  category?: MemoryCategory,
): { score: number; reason: ReplacementCandidate["reason"] } | null {
  const normalizedNew = normalizeContent(newContent);
  const normalizedExisting = normalizeContent(candidate.content);

  if (normalizedExisting === normalizedNew) {
    return { score: 1, reason: "duplicate" };
  }

  if (normalizedExisting.includes(normalizedNew) || normalizedNew.includes(normalizedExisting)) {
    return { score: 0.95, reason: "subset" };
  }

  const newSubject = extractSubjectKey(newContent);
  const existingSubject = extractSubjectKey(candidate.content);
  if (newSubject && existingSubject && newSubject === existingSubject) {
    return { score: 0.9, reason: "subject_key" };
  }

  const overlap = termOverlapScore(newContent, candidate.content);
  const categoryBonus =
    category && candidate.category === category ? 0.1 : 0;
  const score = overlap + categoryBonus;

  if (score >= OVERLAP_THRESHOLD) {
    return { score, reason: "overlap" };
  }

  return null;
}

function toCandidate(
  memory: MemorySearchResult,
  reason: ReplacementCandidate["reason"],
  score: number,
): ReplacementCandidate {
  return {
    id: memory.id,
    content: memory.content,
    category: memory.category,
    created_at: memory.created_at,
    reason,
    score,
  };
}

// Pick an existing memory to replace when new content updates or contradicts it.
export function pickReplacementCandidate(
  candidates: MemorySearchResult[],
  newContent: string,
  category?: MemoryCategory,
): ReplacementCandidate | null {
  let best: ReplacementCandidate | null = null;

  for (const candidate of candidates) {
    const scored = scorePair(newContent, candidate, category);
    if (!scored) continue;

    const next = toCandidate(candidate, scored.reason, scored.score);
    if (!best || next.score > best.score) {
      best = next;
    }
  }

  return best;
}

// Find every stored memory that duplicates the kept fact (for cleanup after merge).
export function findRelatedMemoryIds(
  candidates: MemorySearchResult[],
  content: string,
  keptId: string,
  category?: MemoryCategory,
): string[] {
  const newSubject = extractSubjectKey(content);

  return candidates
    .filter((candidate) => {
      if (candidate.id === keptId) return false;

      const scored = scorePair(content, candidate, category);
      if (scored) return true;

      const subject = extractSubjectKey(candidate.content);
      return Boolean(newSubject && subject && newSubject === subject);
    })
    .map((candidate) => candidate.id);
}
