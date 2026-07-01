import type { MemoryType } from "@/lib/supabase/types";

export interface ClassificationResult {
  memory_type: MemoryType;
  confidence: number;
  valid_from?: string; // ISO date string for episodic memories
}

interface PatternRule {
  regex: RegExp;
  type: MemoryType;
  confidence: number;
}

// High-confidence pattern rules — ordered by specificity
const PATTERN_RULES: PatternRule[] = [
  // Episodic: time-anchored events (most specific — check first)
  {
    regex: /\b(?:yesterday|last (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|month)|on (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]* \d{1,2}|\d{1,2}(?:st|nd|rd|th)? (?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec))\b.{0,80}(?:met|attended|went|had|visited|spoke|talked|interviewed|submitted|finished|completed|started|signed|saw|watched)/i,
    type: "episodic",
    confidence: 0.88,
  },
  {
    regex: /\b(?:met with|spoke with|talked to|had (?:a |an )?(?:meeting|interview|call|chat|session|lesson|class|exam|test))\b/i,
    type: "episodic",
    confidence: 0.85,
  },
  // Relationship: people the user knows
  {
    regex: /\b(?:my (?:professor|prof|teacher|tutor|lecturer|supervisor|doctor|therapist|coach|mentor|boss|manager|colleague|coworker|classmate|roommate|friend|best friend|partner|boyfriend|girlfriend|husband|wife|brother|sister|mom|mum|dad|father|mother|aunt|uncle|grandma|grandpa|cousin))\b/i,
    type: "relationship",
    confidence: 0.90,
  },
  // Routine: recurring temporal patterns
  {
    regex: /\b(?:every (?:morning|evening|night|day|week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|each (?:day|week|morning|evening)|(?:daily|weekly) (?:routine|habit|schedule)|i (?:always|usually|typically|normally) (?:wake|sleep|go|start|end|do|eat|drink|exercise|run|walk|study|work))\b/i,
    type: "routine",
    confidence: 0.85,
  },
  {
    regex: /\b(?:my (?:morning|evening|daily|weekly|night) routine|i wake up at|i go to bed at|i start (?:work|studying) at|i finish at)\b/i,
    type: "routine",
    confidence: 0.88,
  },
  // Skill: abilities and knowledge
  {
    regex: /\b(?:i (?:know|can|play|speak|write|code|program|build|design|teach)|i'?m (?:good|great|experienced|proficient|fluent|skilled) (?:at|in|with)|i'?ve been (?:learning|studying|practicing|working with))\b/i,
    type: "skill",
    confidence: 0.82,
  },
  // Goal: aspirations and intentions
  {
    regex: /\b(?:i (?:want to|aim to|hope to|plan to|intend to)|my goal is|i'?m (?:trying|working|aiming|planning) to|i'?d like to|i'?m working (?:towards|toward|on))\b/i,
    type: "goal",
    confidence: 0.85,
  },
  // Preference: likes, dislikes, preferences
  {
    regex: /\b(?:i (?:love|like|enjoy|prefer|hate|dislike|can't stand|don't like)|my favou?rite|i'?m not a fan of|i (?:always|never) (?:eat|drink|watch|listen|read|use))\b/i,
    type: "preference",
    confidence: 0.82,
  },
  // Fact: identity/biographical info
  {
    regex: /\b(?:my name is|i'?m (?:called|named)|i (?:live in|am from|was born in|grew up in|moved to)|i (?:am|'?m) \d+ years? old|i (?:work at|work for|study at|go to|attend)|i'?m (?:a|an) [\w\s]+(?:student|engineer|developer|teacher|doctor|nurse|designer|manager|lawyer|chef|artist|writer|scientist))\b/i,
    type: "fact",
    confidence: 0.85,
  },
];

// Date patterns for episodic valid_from extraction
const DATE_PATTERNS: Array<{ regex: RegExp; toDate: (m: RegExpMatchArray) => string | null }> = [
  {
    // "on March 12", "on Mar 12"
    regex: /\bon (?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?) (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?/i,
    toDate: (m) => {
      try {
        const year = m[2] ?? new Date().getFullYear().toString();
        return new Date(`${m[0].replace(/^on /i, "")} ${year}`).toISOString();
      } catch {
        return null;
      }
    },
  },
  {
    // "last Monday", "last week"
    regex: /\blast (monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    toDate: (m) => {
      const days = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];
      const target = days.indexOf(m[1].toLowerCase());
      if (target === -1) return null;
      const now = new Date();
      const diff = (now.getDay() - target + 7) % 7 || 7;
      now.setDate(now.getDate() - diff);
      return now.toISOString();
    },
  },
  {
    // "yesterday"
    regex: /\byesterday\b/i,
    toDate: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      return d.toISOString();
    },
  },
];

function extractEpisodicDate(content: string): string | undefined {
  for (const pattern of DATE_PATTERNS) {
    const match = content.match(pattern.regex);
    if (match) {
      const result = pattern.toDate(match);
      if (result) return result;
    }
  }
  return undefined;
}

function classifyByPattern(content: string): ClassificationResult | null {
  let best: { type: MemoryType; confidence: number } | null = null;

  for (const rule of PATTERN_RULES) {
    if (!rule.regex.test(content)) continue;
    if (!best || rule.confidence > best.confidence) {
      best = { type: rule.type, confidence: rule.confidence };
    }
  }

  if (!best) return null;

  const result: ClassificationResult = {
    memory_type: best.type,
    confidence: best.confidence,
  };

  if (best.type === "episodic") {
    result.valid_from = extractEpisodicDate(content);
  }

  return result;
}

async function classifyWithLLM(content: string): Promise<ClassificationResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return { memory_type: "fact", confidence: 0.5 };

  const model =
    process.env.ANTHROPIC_MODEL_LIGHT?.trim() ?? "claude-haiku-4-5-20251001";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 64,
        messages: [
          {
            role: "user",
            content: `Classify this memory into exactly one type. Reply with JSON only, no explanation.
Types: fact, preference, routine, episodic, goal, relationship, skill
Memory: "${content.slice(0, 300)}"
JSON: {"type":"<type>","confidence":<0.5-1.0>}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(4000),
    });

    if (!response.ok) return { memory_type: "fact", confidence: 0.5 };

    const json = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = json.content[0]?.text?.trim() ?? "";
    const parsed = JSON.parse(text) as { type?: string; confidence?: number };

    const VALID_TYPES = new Set<MemoryType>([
      "fact","preference","routine","episodic","goal","relationship","skill",
    ]);
    const type = parsed.type as MemoryType;
    const confidence = Number(parsed.confidence ?? 0.6);

    if (!VALID_TYPES.has(type)) return { memory_type: "fact", confidence: 0.5 };

    const result: ClassificationResult = {
      memory_type: type,
      confidence: Math.min(1, Math.max(0.5, confidence)),
    };
    if (type === "episodic") {
      result.valid_from = extractEpisodicDate(content);
    }
    return result;
  } catch {
    return { memory_type: "fact", confidence: 0.5 };
  }
}

// Classify a memory content string into a MemoryType with confidence score.
// Uses pattern matching first; falls back to Haiku LLM for ambiguous content.
export async function classifyMemory(
  content: string,
): Promise<ClassificationResult> {
  const patternResult = classifyByPattern(content);

  if (patternResult && patternResult.confidence >= 0.82) {
    return patternResult;
  }

  // Low-confidence or no pattern match: use LLM
  try {
    return await classifyWithLLM(content);
  } catch {
    return patternResult ?? { memory_type: "fact", confidence: 0.5 };
  }
}

// Default salience scores per memory type
export const TYPE_SALIENCE: Record<MemoryType, number> = {
  fact: 0.85,
  relationship: 0.85,
  routine: 0.80,
  preference: 0.70,
  goal: 0.70,
  skill: 0.70,
  episodic: 0.65,
};
