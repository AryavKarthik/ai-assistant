import { isReminderCreateIntent } from "./reminder-intent";
import type { MemoryCategory } from "./types";

export interface CapturedFact {
  content: string;
  category: MemoryCategory;
}

interface LifestylePattern {
  regex: RegExp;
  category: MemoryCategory;
  toContent: (match: RegExpMatchArray) => string | null;
}

function fragment(raw: string, maxLen = 110): string {
  return raw.trim().replace(/[.!?]+$/, "").trim().slice(0, maxLen).trim();
}

function capitalizeSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

const LIFESTYLE_PATTERNS: LifestylePattern[] = [
  {
    regex: /\b(?:i live in|i'm living in|i am living in|i'm based in)\s+([^.,!?;\n]{3,70})/i,
    category: "fact",
    toContent: (m) => `User lives in ${fragment(m[1])}`,
  },
  {
    regex: /\b(?:i'm from|i am from)\s+([^.,!?;\n]{3,60})/i,
    category: "fact",
    toContent: (m) => `User is from ${fragment(m[1])}`,
  },
  {
    regex:
      /\b(?:i work at|i work for|my job is|i'm a|i am a)\s+([^.,!?;\n]{3,80})/i,
    category: "fact",
    toContent: (m) => `User works as / at: ${fragment(m[1])}`,
  },
  {
    regex: /\b(?:allergic to|allergy to)\s+([^.,!?;\n]{2,50})/i,
    category: "fact",
    toContent: (m) => `User is allergic to ${fragment(m[1])}`,
  },
  {
    regex:
      /\b(?:my birthday is|born on|born in)\s+((?:\w+\s+){0,4}\d{1,2}(?:st|nd|rd|th)?(?:\s+\d{4})?|\d{4})/i,
    category: "fact",
    toContent: (m) => `User's birthday / birth date: ${fragment(m[1], 40)}`,
  },
  {
    regex:
      /\b(?:i work out|i go to the gym|i gym)\s+(\d+[\s-]*(?:to|-|and)?[\s-]*\d*\s*times?\s*(?:a|per)\s*week[^.,!?;\n]{0,30})/i,
    category: "fact",
    toContent: (m) => `User's workout frequency: ${fragment(m[1], 60)}`,
  },
  {
    regex:
      /\b(?:i usually|i always|i typically|i often)\s+([^.,!?;\n]{10,120})/i,
    category: "preference",
    toContent: (m) => `User's pattern: ${capitalizeSentence(fragment(m[1]))}`,
  },
  {
    regex:
      /\b(?:every\s+(?:day|week|morning|evening|night|weekend|monday|tuesday|wednesday|thursday|friday|saturday|sunday))\s*,?\s*(?:i\s+)?([^.,!?;\n]{8,100})/i,
    category: "preference",
    toContent: (m) =>
      `User's recurring pattern: ${capitalizeSentence(fragment(m[0], 100))}`,
  },
  {
    regex: /\b(?:my (?:morning|evening|daily) routine is)\s+([^.,!?;\n]{10,120})/i,
    category: "preference",
    toContent: (m) =>
      `User's routine: ${capitalizeSentence(fragment(m[1]))}`,
  },
  {
    regex:
      /\b(?:i wake up|i get up)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    category: "preference",
    toContent: (m) => `User usually wakes up around ${fragment(m[1], 20)}`,
  },
  {
    regex:
      /\b(?:i go to bed|i sleep)\s+(?:at\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i,
    category: "preference",
    toContent: (m) => `User usually goes to bed around ${fragment(m[1], 20)}`,
  },
  {
    regex: /\b(?:my goal is|i'm trying to|i am trying to|i want to)\s+([^.,!?;\n]{8,100})/i,
    category: "goal",
    toContent: (m) => `User's goal: ${capitalizeSentence(fragment(m[1]))}`,
  },
  {
    regex: /\b(?:i prefer|i'd rather)\s+([^.,!?;\n]{5,80})/i,
    category: "preference",
    toContent: (m) => `User prefers ${fragment(m[1])}`,
  },
  {
    regex: /\b(?:i hate|i can't stand|i dislike)\s+([^.,!?;\n]{5,80})/i,
    category: "preference",
    toContent: (m) => `User dislikes ${fragment(m[1])}`,
  },
  {
    regex: /\b(?:i love|i really like|i enjoy)\s+([^.,!?;\n]{5,80})/i,
    category: "preference",
    toContent: (m) => `User likes ${fragment(m[1])}`,
  },
  {
    regex:
      /\bmy\s+(mom|mum|dad|father|mother|brother|sister|partner|wife|husband|girlfriend|boyfriend)\s+([^.,!?;\n]{5,80})/i,
    category: "fact",
    toContent: (m) => {
      const content = fragment(m[2]);
      // Require the fragment to contain at least one word with genuine semantic
      // weight — not just conversational filler ("are going and yeah", "is here
      // too"). Words ≤3 chars or common filler words don't count.
      const FILLER = new Set([
        "going", "coming", "doing", "yeah", "yep", "okay", "well", "fine",
        "just", "also", "like", "that", "here", "there", "then", "this",
        "will", "have", "been", "were", "with", "and", "but", "too", "though",
        "right", "stuff", "things", "really", "very", "much", "some", "more",
      ]);
      const informative = (content.toLowerCase().match(/\b[a-z]{4,}\b/g) ?? [])
        .filter(w => !FILLER.has(w));
      if (informative.length < 1) return null;
      return `User's ${m[1].toLowerCase()}: ${capitalizeSentence(content)}`;
    },
  },
  {
    regex: /\b(?:my|our)\s+(dog|cat|pet)\s+(?:is\s+)?(?:named|called)\s+([a-z][a-z'-]{1,20})/i,
    category: "fact",
    toContent: (m) =>
      `User has a ${m[1].toLowerCase()} named ${capitalizeSentence(m[2])}`,
  },
];

const CONTEXT_SHARING_EXTRACTORS: RegExp[] = [
  /\b(?:just so you know|for context|fyi|heads up),?\s+(.+)$/i,
  /\b(?:a bit about me|about myself)[:\s-]+(.+)$/i,
];

const EXPLICIT_MEMORY_EXTRACTORS: RegExp[] = [
  /^remember\s+(?:that\s+)?(?!to\b)(.+)$/i,
  /^please\s+remember\s+(?:that\s+)?(?!to\b)(.+)$/i,
  /^keep\s+in\s+mind\s+(?:that\s+)?(.+)$/i,
  /^save\s+(?:this|that)\s+to\s+memory:?\s*(.+)$/i,
  /^save\s+to\s+memory:?\s*(.+)$/i,
  /\bcan you remember\s+(?:that\s+)?(?!to\b)(.+)$/i,
  /\bplease\s+save\s+(?:this|that)\s+(?:to\s+memory)?:?\s*(.+)$/i,
];

function normalizeExplicitMemoryContent(raw: string): string {
  const trimmed = raw.trim().replace(/[.!?]+$/, "").trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  if (/^(?:i am|i'?m|my)\b/.test(lower)) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
  if (/^(?:i|we|our|my)\b/.test(lower)) {
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  }
  return `User note: ${trimmed.charAt(0).toUpperCase() + trimmed.slice(1)}`;
}

export function extractExplicitMemoryContent(message: string): string | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  for (const pattern of EXPLICIT_MEMORY_EXTRACTORS) {
    const match = trimmed.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw) continue;
    const content = normalizeExplicitMemoryContent(raw);
    if (content.length >= 3) return content;
  }

  return null;
}

const SELF_DISCLOSURE_SIGNAL =
  /\b(?:i'?m|i am|i'?ve|i have|my |i usually|i always|i never|i often|i typically|i prefer|i like|i love|i hate|i dislike|i work|i live|i go to|every (?:day|week|morning|evening|night)|for context|just so you know|fyi)\b/i;

export function isSelfDisclosureMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length < 12) return false;
  if (isReminderCreateIntent(trimmed)) return false;

  const looksLikeQuestion =
    /^(?:what|how|why|when|where|who|which|can you|could you|should i|do you|are you|is there|tell me)\b/i.test(
      trimmed,
    );
  if (looksLikeQuestion && !SELF_DISCLOSURE_SIGNAL.test(trimmed)) return false;
  if (/\?$/.test(trimmed) && !SELF_DISCLOSURE_SIGNAL.test(trimmed)) return false;

  return SELF_DISCLOSURE_SIGNAL.test(trimmed);
}

function normalizeFactKey(content: string): string {
  return content.toLowerCase().replace(/\s+/g, " ").trim();
}

export function extractContextSharingFacts(message: string): CapturedFact[] {
  const trimmed = message.trim();
  const facts: CapturedFact[] = [];

  for (const pattern of CONTEXT_SHARING_EXTRACTORS) {
    const match = trimmed.match(pattern);
    const raw = match?.[1]?.trim();
    if (!raw || raw.length < 8) continue;
    facts.push({
      content: capitalizeSentence(raw),
      category: "fact",
    });
  }

  return facts;
}

export function extractLifestyleFacts(
  message: string,
  maxFacts = 4,
): CapturedFact[] {
  if (!isSelfDisclosureMessage(message)) return [];

  const trimmed = message.trim();
  const seen = new Set<string>();
  const facts: CapturedFact[] = [];

  const add = (content: string, category: MemoryCategory) => {
    const normalized = normalizeFactKey(content);
    if (normalized.length < 8 || seen.has(normalized)) return;
    seen.add(normalized);
    facts.push({ content, category });
  };

  for (const fact of extractContextSharingFacts(trimmed)) {
    add(fact.content, fact.category);
    if (facts.length >= maxFacts) return facts;
  }

  for (const pattern of LIFESTYLE_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (!match) continue;
    const content = pattern.toContent(match);
    if (!content) continue;
    add(content, pattern.category);
    if (facts.length >= maxFacts) break;
  }

  return facts;
}
