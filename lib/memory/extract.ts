import type { MemoryCategory, MemoryType } from "@/lib/supabase/types";
import {
  extractExplicitMemoryContent,
  extractLifestyleFacts,
} from "@/lib/memory/lifestyle-capture";
import { saveMemory } from "@/lib/memory/save";

// Re-export for callers that only need explicit extraction.
export { extractExplicitMemoryContent } from "@/lib/memory/lifestyle-capture";

interface ProfilePattern {
  regex: RegExp;
  category: MemoryCategory;
  memoryType?: MemoryType;
  toContent: (match: RegExpMatchArray) => string;
}

export interface AutoCaptureResult {
  saved: number;
  memoryIds: string[];
  errors: string[];
}

// High-confidence profile facts captured server-side so they persist even when
// the model skips save_memory.
const PROFILE_PATTERNS: ProfilePattern[] = [
  {
    regex:
      /\b(?:i'?m|i am)\s+(?:a\s+)?(?:university|college)\s+student\b/i,
    category: "fact",
    toContent: () => "User is a university student (not in school)",
  },
  {
    regex:
      /\b(?:i'?m|i am)\s+(?:in|at)\s+(?:a\s+)?(?:university|college)\b/i,
    category: "fact",
    toContent: () => "User is in university (not in school)",
  },
  {
    regex:
      /\b(?:go(?:es)?\s+to|attend(?:s|ing)?)\s+(?:a\s+)?(?:university|college)\b/i,
    category: "fact",
    toContent: () => "User attends university (not in school)",
  },
  {
    regex:
      /\b(?:not\s+(?:in|at)\s+school|not\s+a\s+school\s+student|i'?m\s+not\s+in\s+school)\b/i,
    category: "fact",
    toContent: () => "User is not in school",
  },
  {
    regex:
      /\b(?:studying|study|major(?:ing)?\s+in)\s+([a-z][\w\s-]{1,40})\b/i,
    category: "fact",
    toContent: (match) => `User is studying ${match[1].trim()}`,
  },
  {
    regex: /\b(?:i'?m|i am)\s+(\d{1,2})\s+years?\s+old\b/i,
    category: "fact",
    toContent: (match) => `User is ${match[1]} years old`,
  },
  {
    regex:
      /\b(?:my name is|call me)\s+([a-z][a-z]+(?:\s+[a-z][a-z]+)?)\b/i,
    category: "fact",
    toContent: (match) =>
      `User's name is ${match[1]
        .split(/\s+/)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")}`,
  },
  {
    regex: /\b(?:i'?m|i am)\s+(?:a\s+)?(vegetarian|vegan|pescatarian)\b/i,
    category: "preference",
    toContent: (match) => `User is ${match[1].toLowerCase()}`,
  },
  {
    regex:
      /\b(?:i'?m|i am)\s+in\s+(?:australian|australia)\s+time(?:zone)?\b/i,
    category: "fact",
    toContent: () =>
      "User's timezone is Australian time (Australia/Sydney, AEDT/AEST)",
  },
  {
    regex: /\b(?:use|always use)\s+(?:aedt|aest|australian time)\b/i,
    category: "fact",
    toContent: (match) => {
      const label =
        match[0].match(/aedt|aest/i)?.[0]?.toUpperCase() ?? "AEDT/AEST";
      return `User prefers ${label} for scheduling and reminders (Australia/Sydney)`;
    },
  },
  {
    regex: /\b(?:my timezone is|i'?m in)\s+(aedt|aest)\b/i,
    category: "fact",
    toContent: (match) =>
      `User's timezone is ${match[1].toUpperCase()} (Australia/Sydney)`,
  },
];

// New patterns for relationships, routines, goals, skills, episodic
const EXTENDED_PATTERNS: ProfilePattern[] = [
  // Relationship: people the user knows
  {
    regex: /\bmy (professor|prof|teacher|tutor|lecturer|supervisor|doctor|therapist|coach|mentor|boss|manager)\s+(?:is\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    category: "fact",
    memoryType: "relationship",
    toContent: (m) => `User's ${m[1].toLowerCase()} is ${m[2]}`,
  },
  {
    regex: /\bmy (friend|best friend|partner|boyfriend|girlfriend|husband|wife|brother|sister|mom|mum|dad|father|mother)\s+(?:is\s+(?:called|named)\s+)?([A-Z][a-z]+)/i,
    category: "fact",
    memoryType: "relationship",
    toContent: (m) => `User's ${m[1].toLowerCase()} is ${m[2]}`,
  },
  // Skill: abilities and languages
  {
    regex: /\bi(?:'m| am) (?:fluent|proficient|experienced|skilled) (?:in|with)\s+([^.,!?;\n]{3,50})/i,
    category: "fact",
    memoryType: "skill",
    toContent: (m) => `User is proficient in ${m[1].trim()}`,
  },
  {
    regex: /\bi(?:'ve| have) been (?:learning|studying|practicing)\s+([^.,!?;\n]{3,60})/i,
    category: "fact",
    memoryType: "skill",
    toContent: (m) => `User has been learning ${m[1].trim()}`,
  },
  {
    regex: /\bi (?:speak|write|read|code in|program in|develop in)\s+([^.,!?;\n]{3,40})/i,
    category: "fact",
    memoryType: "skill",
    toContent: (m) => `User ${m[0].match(/speak|write|read|code|program|develop/i)?.[0] ?? "uses"} ${m[1].trim()}`,
  },
  // Routine: recurring patterns
  {
    regex: /\bi (?:go to the gym|gym|work out|exercise|train|run|jog)\s+(?:every\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|day|week|weekday|weekend)[^.,!?\n]{0,40}/i,
    category: "preference",
    memoryType: "routine",
    toContent: (m) => `User's fitness routine: ${m[0].trim()}`,
  },
  {
    regex: /\bevery\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|evening|night|day|week)\s+(?:i\s+)?([^.,!?;\n]{8,80})/i,
    category: "preference",
    memoryType: "routine",
    toContent: (m) => `User's recurring pattern: Every ${m[1]} — ${m[2].trim()}`,
  },
  // Goal: explicit aspirations
  {
    regex: /\bi(?:'m| am) (?:trying|working|aiming|planning) to\s+([^.,!?;\n]{8,100})/i,
    category: "goal",
    memoryType: "goal",
    toContent: (m) => `User's goal: ${m[1].trim()}`,
  },
  {
    regex: /\bi (?:want|aim|hope|intend|plan) to\s+([^.,!?;\n]{8,100})/i,
    category: "goal",
    memoryType: "goal",
    toContent: (m) => `User wants to ${m[1].trim()}`,
  },
];

const MAX_CAPTURES_PER_MESSAGE = 8;
const MAX_PER_TYPE: Partial<Record<MemoryType, number>> = {
  routine: 2,
  goal: 2,
  relationship: 3,
  skill: 2,
};

async function captureContent(
  userId: string,
  content: string,
  category: MemoryCategory,
  sourceMessageId: string | undefined,
  result: AutoCaptureResult,
  memoryType?: MemoryType,
): Promise<void> {
  try {
    const saved = await saveMemory(userId, content, {
      category,
      memoryType,
      sourceMessageId,
      sourceType: "auto_capture",
      skipClassify: Boolean(memoryType),
    });
    if (saved.action !== "unchanged") {
      result.saved++;
      result.memoryIds.push(saved.memory.id);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed";
    result.errors.push(message);
    console.error("[memory] auto-capture save failed:", err);
  }
}

export async function autoCaptureProfileFacts(
  userId: string,
  message: string,
  sourceMessageId?: string,
): Promise<number> {
  const result = await autoCaptureFromMessage(userId, message, sourceMessageId);
  return result.saved;
}

export async function autoCaptureFromMessage(
  userId: string,
  message: string,
  sourceMessageId?: string,
): Promise<AutoCaptureResult> {
  const trimmed = message.trim();
  const result: AutoCaptureResult = { saved: 0, memoryIds: [], errors: [] };
  if (!trimmed) return result;

  let captureBudget = MAX_CAPTURES_PER_MESSAGE;
  const typeCount: Partial<Record<MemoryType, number>> = {};

  function typeAllowed(t?: MemoryType): boolean {
    if (!t) return true;
    const cap = MAX_PER_TYPE[t];
    if (cap === undefined) return true;
    return (typeCount[t] ?? 0) < cap;
  }

  function recordType(t?: MemoryType): void {
    if (!t) return;
    typeCount[t] = (typeCount[t] ?? 0) + 1;
  }

  // Profile patterns first (highest confidence)
  for (const pattern of PROFILE_PATTERNS) {
    if (captureBudget <= 0) break;
    if (!typeAllowed(pattern.memoryType)) continue;
    const match = trimmed.match(pattern.regex);
    if (!match) continue;
    const content = pattern.toContent(match);
    const before = result.saved;
    await captureContent(userId, content, pattern.category, sourceMessageId, result, pattern.memoryType);
    if (result.saved > before) {
      captureBudget--;
      recordType(pattern.memoryType);
    }
  }

  // Extended patterns (relationship, skill, routine, goal)
  for (const pattern of EXTENDED_PATTERNS) {
    if (captureBudget <= 0) break;
    if (!typeAllowed(pattern.memoryType)) continue;
    const match = trimmed.match(pattern.regex);
    if (!match) continue;
    const content = pattern.toContent(match);
    const before = result.saved;
    await captureContent(userId, content, pattern.category, sourceMessageId, result, pattern.memoryType);
    if (result.saved > before) {
      captureBudget--;
      recordType(pattern.memoryType);
    }
  }

  // Explicit memory request ("remember that...")
  const explicit = extractExplicitMemoryContent(trimmed);
  if (explicit && captureBudget > 0) {
    const before = result.saved;
    await captureContent(userId, explicit, "fact", sourceMessageId, result);
    if (result.saved > before) captureBudget--;
  }

  // Lifestyle facts
  const lifestyleFacts = extractLifestyleFacts(trimmed, captureBudget);
  for (const fact of lifestyleFacts) {
    if (captureBudget <= 0) break;
    const before = result.saved;
    await captureContent(userId, fact.content, fact.category, sourceMessageId, result);
    if (result.saved > before) captureBudget--;
  }

  return result;
}
