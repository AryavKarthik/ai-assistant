import type { ContextIntent, ThreadSection } from "./context-intent";

export interface ContextRetrievalPlan {
  memoryLimit: number;
  queryMatchPool: number;
  recentMemoryFallback: number;
  coreProfileMode: "full" | "minimal" | "none";
  reminderLimit: number;
  calendarLimit: number;
  gmailHighlightLimit: number;
  workoutLimit: number;
  youtubeTaste: boolean;
  chatHistoryLimit: number;
  autoCaptureProfileFacts: boolean;
  contextNote: string;
  threadSection: ThreadSection;
  intent: ContextIntent;
}

/** Alias for external consumers. */
export type RetrievalPlan = ContextRetrievalPlan;

interface SectionCeiling {
  memoryLimit: number;
  queryMatchPool: number;
  recentMemoryFallback: number;
  coreProfileFull: boolean;
  reminderLimit: number;
  chatHistoryLimit: number;
}

const MAIN_CEILING: SectionCeiling = {
  memoryLimit: 32,
  queryMatchPool: 30,
  recentMemoryFallback: 12,
  coreProfileFull: true,
  reminderLimit: 8,
  chatHistoryLimit: 40,
};

const SIDE_CEILING: SectionCeiling = {
  memoryLimit: 8,
  queryMatchPool: 10,
  recentMemoryFallback: 0,
  coreProfileFull: false,
  reminderLimit: 2,
  chatHistoryLimit: 80,
};

function getCeiling(section: ThreadSection): SectionCeiling {
  return section === "side" ? SIDE_CEILING : MAIN_CEILING;
}

function cap(value: number, ceiling: number): number {
  return Math.min(value, ceiling);
}

export function resolveThreadSection(
  threadSection: string | null | undefined,
): ThreadSection {
  return threadSection === "side" ? "side" : "main";
}

export function resolveRetrievalPlan(
  section: ThreadSection,
  intent: ContextIntent,
): ContextRetrievalPlan {
  const ceiling = getCeiling(section);

  switch (intent) {
    case "profile_recall":
      return {
        memoryLimit: cap(section === "main" ? 32 : 8, ceiling.memoryLimit),
        queryMatchPool: cap(section === "main" ? 30 : 10, ceiling.queryMatchPool),
        recentMemoryFallback: cap(section === "main" ? 12 : 0, ceiling.recentMemoryFallback),
        coreProfileMode: section === "main" ? "full" : "minimal",
        reminderLimit: 0,
        calendarLimit: 0,
        gmailHighlightLimit: 0,
        workoutLimit: 0,
        youtubeTaste: false,
        chatHistoryLimit: ceiling.chatHistoryLimit,
        autoCaptureProfileFacts: false,
        contextNote: "profile recall — expanded user memory within section ceiling",
        threadSection: section,
        intent,
      };

    case "planning":
      return {
        memoryLimit: cap(section === "main" ? 12 : 4, ceiling.memoryLimit),
        queryMatchPool: cap(section === "main" ? 16 : 6, ceiling.queryMatchPool),
        recentMemoryFallback: cap(section === "main" ? 4 : 0, ceiling.recentMemoryFallback),
        coreProfileMode: "minimal",
        reminderLimit: ceiling.reminderLimit,
        calendarLimit: 0,
        gmailHighlightLimit: 0,
        workoutLimit: 0,
        youtubeTaste: false,
        chatHistoryLimit: ceiling.chatHistoryLimit,
        autoCaptureProfileFacts: false,
        contextNote: "planning — schedule and reminders included; memory kept moderate",
        threadSection: section,
        intent,
      };

    case "scheduling":
      return {
        memoryLimit: cap(section === "main" ? 8 : 3, ceiling.memoryLimit),
        queryMatchPool: cap(section === "main" ? 12 : 4, ceiling.queryMatchPool),
        recentMemoryFallback: 0,
        coreProfileMode: "minimal",
        reminderLimit: cap(2, ceiling.reminderLimit),
        calendarLimit: 0,
        gmailHighlightLimit: 0,
        workoutLimit: 0,
        youtubeTaste: false,
        chatHistoryLimit: ceiling.chatHistoryLimit,
        autoCaptureProfileFacts: false,
        contextNote: "scheduling — calendar-focused context",
        threadSection: section,
        intent,
      };

    case "temporal":
      return {
        memoryLimit: cap(section === "main" ? 4 : 2, ceiling.memoryLimit),
        queryMatchPool: cap(section === "main" ? 6 : 3, ceiling.queryMatchPool),
        recentMemoryFallback: 0,
        coreProfileMode: "minimal",
        reminderLimit: 0,
        calendarLimit: 0,
        gmailHighlightLimit: 0,
        workoutLimit: 0,
        youtubeTaste: false,
        chatHistoryLimit: ceiling.chatHistoryLimit,
        autoCaptureProfileFacts: false,
        contextNote: "temporal — today anchor and near calendar events when connected",
        threadSection: section,
        intent,
      };

    case "reminders":
      return {
        memoryLimit: cap(section === "main" ? 6 : 2, ceiling.memoryLimit),
        queryMatchPool: cap(section === "main" ? 8 : 4, ceiling.queryMatchPool),
        recentMemoryFallback: 0,
        coreProfileMode: "minimal",
        reminderLimit: ceiling.reminderLimit,
        calendarLimit: 0,
        gmailHighlightLimit: 0,
        workoutLimit: 0,
        youtubeTaste: false,
        chatHistoryLimit: ceiling.chatHistoryLimit,
        autoCaptureProfileFacts: false,
        contextNote: "reminders — task list included",
        threadSection: section,
        intent,
      };

    case "email":
      return {
        memoryLimit: cap(section === "main" ? 8 : 3, ceiling.memoryLimit),
        queryMatchPool: cap(section === "main" ? 10 : 4, ceiling.queryMatchPool),
        recentMemoryFallback: 0,
        coreProfileMode: "minimal",
        reminderLimit: 0,
        calendarLimit: 0,
        gmailHighlightLimit: 0,
        workoutLimit: 0,
        youtubeTaste: false,
        chatHistoryLimit: ceiling.chatHistoryLimit,
        autoCaptureProfileFacts: false,
        contextNote: "email — inbox highlights included",
        threadSection: section,
        intent,
      };

    case "workout":
      return {
        memoryLimit: cap(section === "main" ? 8 : 3, ceiling.memoryLimit),
        queryMatchPool: cap(section === "main" ? 12 : 5, ceiling.queryMatchPool),
        recentMemoryFallback: 0,
        coreProfileMode: "minimal",
        reminderLimit: 0,
        calendarLimit: 0,
        gmailHighlightLimit: 0,
        workoutLimit: 0,
        youtubeTaste: false,
        chatHistoryLimit: ceiling.chatHistoryLimit,
        autoCaptureProfileFacts: false,
        contextNote: "workout — recent exercise logs included",
        threadSection: section,
        intent,
      };

    case "youtube":
      return {
        memoryLimit: cap(section === "main" ? 8 : 3, ceiling.memoryLimit),
        queryMatchPool: cap(section === "main" ? 10 : 4, ceiling.queryMatchPool),
        recentMemoryFallback: 0,
        coreProfileMode: "minimal",
        reminderLimit: 0,
        calendarLimit: 0,
        gmailHighlightLimit: 0,
        workoutLimit: 0,
        youtubeTaste: false,
        chatHistoryLimit: ceiling.chatHistoryLimit,
        autoCaptureProfileFacts: false,
        contextNote: "youtube — taste profile included when connected",
        threadSection: section,
        intent,
      };

    case "thread_focus":
      return {
        memoryLimit: section === "main" ? 4 : 0,
        queryMatchPool: section === "main" ? 6 : 0,
        recentMemoryFallback: 0,
        coreProfileMode: "minimal",
        reminderLimit: 0,
        calendarLimit: 0,
        gmailHighlightLimit: 0,
        workoutLimit: 0,
        youtubeTaste: false,
        chatHistoryLimit: ceiling.chatHistoryLimit,
        autoCaptureProfileFacts: false,
        contextNote: "thread-first — prioritize this conversation's message history",
        threadSection: section,
        intent,
      };

    case "general":
    default:
      return {
        memoryLimit: cap(section === "main" ? 10 : 3, ceiling.memoryLimit),
        queryMatchPool: cap(section === "main" ? 14 : 5, ceiling.queryMatchPool),
        recentMemoryFallback: cap(section === "main" ? 6 : 0, ceiling.recentMemoryFallback),
        coreProfileMode: "minimal",
        reminderLimit: 0,
        calendarLimit: 0,
        gmailHighlightLimit: 0,
        workoutLimit: 0,
        youtubeTaste: false,
        chatHistoryLimit: ceiling.chatHistoryLimit,
        autoCaptureProfileFacts: false,
        contextNote:
          section === "side"
            ? "light global context — lean on this thread's history"
            : "light context — only include what fits this message",
        threadSection: section,
        intent,
      };
  }
}

/** Tighter retrieval for spoken turns — less DB/API work before the model replies. */
export function applyVoiceRetrievalOverrides(
  plan: ContextRetrievalPlan,
): ContextRetrievalPlan {
  const keepReminders =
    plan.intent === "reminders" || plan.intent === "planning";

  return {
    ...plan,
    memoryLimit: Math.min(plan.memoryLimit, 4),
    queryMatchPool: Math.min(plan.queryMatchPool, 8),
    recentMemoryFallback: Math.min(plan.recentMemoryFallback, 3),
    reminderLimit: keepReminders ? Math.min(plan.reminderLimit, 4) : 0,
    calendarLimit: 0,
    gmailHighlightLimit: 0,
    workoutLimit: 0,
    youtubeTaste: false,
    chatHistoryLimit: Math.min(plan.chatHistoryLimit, 8),
    autoCaptureProfileFacts: plan.autoCaptureProfileFacts,
    contextNote: `${plan.contextNote}; voice turn — trimmed context`,
  };
}

/** Mac-specific voice override: raises memory cap from 4→12 vs web default. */
export function applyMacVoiceOverrides(plan: RetrievalPlan): RetrievalPlan {
  const base = applyVoiceRetrievalOverrides(plan);
  return {
    ...base,
    memoryLimit: Math.min(plan.memoryLimit, 12),
    queryMatchPool: Math.min(plan.queryMatchPool, 16),
  };
}
