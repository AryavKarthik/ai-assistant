export type InteractionMode =
  | "study"
  | "planning"
  | "coding"
  | "life_admin"
  | "general";

export type ModeSource = "explicit" | "inferred";
export type UserMood = "stressed" | "brainstorming" | "neutral";
export type EasterEggKind = "motivate" | "villain_speech" | "coach" | null;

export interface PersonalityContext {
  mode: InteractionMode;
  modeSource: ModeSource;
  mood: UserMood;
  easterEgg: EasterEggKind;
}

const MODE_OVERRIDES: Array<{ mode: InteractionMode; pattern: RegExp }> = [
  { mode: "coding", pattern: /\b(coding mode|dev mode|developer mode)\b/i },
  { mode: "study", pattern: /\b(study mode|tutor mode|teach me mode)\b/i },
  { mode: "planning", pattern: /\b(planning mode|planner mode|help me plan)\b/i },
  { mode: "life_admin", pattern: /\b(life admin mode|admin mode)\b/i },
];

const CODING_PATTERNS: RegExp[] = [
  /\b(code|coding|bug|error|function|api|deploy|refactor|stack trace|typescript|javascript)\b/i,
];
const STUDY_PATTERNS: RegExp[] = [
  /\b(homework|exam|study|studying|explain|concept|quiz|learn|eli5)\b/i,
];
const PLANNING_PATTERNS: RegExp[] = [
  /\b(schedule|plan|planning|prioriti(?:ze|s)|roadmap|week ahead|goals?)\b/i,
];
const LIFE_ADMIN_PATTERNS: RegExp[] = [
  /\b(remind|reminder|appointment|errands?|calendar|todo|to-do|due)\b/i,
];

const STRESSED_PATTERNS: RegExp[] = [
  /\b(overwhelmed|stressed?|anxious|behind|panic|can't focus|too much)\b/i,
];
const BRAINSTORM_PATTERNS: RegExp[] = [
  /\b(ideas?|brainstorm|what if|options?|creative|riff)\b/i,
];

const MOTIVATE_PATTERNS: RegExp[] = [/\bmotivate me\b/i];
const VILLAIN_PATTERNS: RegExp[] = [
  /\bvillain speech\b/i,
  /\bgive me a villain speech\b/i,
];
const COACH_PATTERNS: RegExp[] = [/\btalk like a coach\b/i, /\bcoach mode\b/i];

export function inferPersonalityContext(message: string): PersonalityContext {
  const normalized = message.trim();

  const explicitMode = inferExplicitMode(normalized);
  const mode = explicitMode ?? inferModeFromContent(normalized);
  const modeSource: ModeSource = explicitMode ? "explicit" : "inferred";

  return {
    mode,
    modeSource,
    mood: inferMood(normalized),
    easterEgg: inferEasterEgg(normalized),
  };
}

function inferExplicitMode(message: string): InteractionMode | null {
  for (const override of MODE_OVERRIDES) {
    if (!override.pattern.test(message)) continue;
    return override.mode;
  }
  return null;
}

function inferModeFromContent(message: string): InteractionMode {
  if (matchesAny(message, CODING_PATTERNS)) return "coding";
  if (matchesAny(message, STUDY_PATTERNS)) return "study";
  if (matchesAny(message, PLANNING_PATTERNS)) return "planning";
  if (matchesAny(message, LIFE_ADMIN_PATTERNS)) return "life_admin";
  return "general";
}

function inferMood(message: string): UserMood {
  if (matchesAny(message, STRESSED_PATTERNS)) return "stressed";
  if (matchesAny(message, BRAINSTORM_PATTERNS)) return "brainstorming";
  return "neutral";
}

function inferEasterEgg(message: string): EasterEggKind {
  if (matchesAny(message, VILLAIN_PATTERNS)) return "villain_speech";
  if (matchesAny(message, MOTIVATE_PATTERNS)) return "motivate";
  if (matchesAny(message, COACH_PATTERNS)) return "coach";
  return null;
}

function matchesAny(message: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(message));
}
