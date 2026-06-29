import {
  completeAllPendingReminders,
  completeReminder,
  deleteAllPendingReminders,
  deleteReminder,
  insertReminder,
  listReminders,
} from "@/lib/db/reminders";
import {
  insertWorkout,
  listWorkouts,
  searchWorkouts,
} from "@/lib/db/workouts";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  listCalendarEvents,
  updateCalendarEvent,
} from "@/lib/google/calendar";
import { createGmailDraft, getGmailMessage, searchGmail } from "@/lib/google/gmail";
import {
  GMAIL_COMPOSE_SCOPE_ERROR,
  isInsufficientScopeError,
  YOUTUBE_MISSING_SCOPE_ERROR,
} from "@/lib/google/errors";
import {
  getCachedTasteProfile,
  recommendYoutube,
  searchYoutube,
} from "@/lib/google/youtube";
import { saveMemory } from "@/lib/memory/save";
import { searchMemories } from "@/lib/memory/search";
import { resolveReminderDueAt } from "@/lib/reminders/parse-due-at";
import { dispatchDueReminderNotifications } from "@/lib/push/dispatch";
import type { MemoryCategory } from "@/lib/supabase/types";
import { googleWebSearch } from "@/lib/tools/web-search";
import { fetchWebpage } from "@/lib/tools/webpage";
import { createWorkflowRun } from "@/lib/db/workflows";

export interface ToolContext {
  userId: string;
  conversationId: string;
  sourceMessageId: string;
  userMessage?: string;
}

// Maps tool name → handler. Returns JSON-serializable result for Claude.
export async function executeTool(
  name: string,
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  try {
    const result = await (async () => {
      switch (name) {
        case "save_memory":
          return handleSaveMemory(input, context);
        case "search_memory":
          return handleSearchMemory(input, context);
        case "log_workout":
          return handleLogWorkout(input, context);
        case "list_workouts":
          return handleListWorkouts(input, context);
        case "search_workouts":
          return handleSearchWorkouts(input, context);
        case "create_reminder":
          return handleCreateReminder(input, context);
        case "list_reminders":
          return handleListReminders(input, context);
        case "complete_reminder":
          return handleCompleteReminder(input, context);
        case "complete_all_reminders":
          return handleCompleteAllReminders(context);
        case "delete_all_reminders":
          return handleDeleteAllReminders(context);
        case "delete_reminder":
          return handleDeleteReminder(input, context);
        case "list_calendar_events":
          return handleListCalendarEvents(input, context);
        case "create_calendar_event":
          return handleCreateCalendarEvent(input, context);
        case "update_calendar_event":
          return handleUpdateCalendarEvent(input, context);
        case "delete_calendar_event":
          return handleDeleteCalendarEvent(input, context);
        case "search_gmail":
          return handleSearchGmail(input, context);
        case "get_gmail_message":
          return handleGetGmailMessage(input, context);
        case "create_gmail_draft":
          return handleCreateGmailDraft(input, context);
        case "get_youtube_taste_profile":
          return handleGetYoutubeTasteProfile(context);
        case "search_youtube":
          return handleSearchYoutube(input, context);
        case "recommend_youtube":
          return handleRecommendYoutube(input, context);
        case "web_search":
          return handleWebSearch(input);
        case "fetch_webpage":
          return handleFetchWebpage(input);
        case "plan_workflow":
          return handlePlanWorkflow(input, context);
        default:
          return { error: `Unknown tool: ${name}` };
      }
    })();
    return result;
  } catch (err) {
    const rawMessage =
      err instanceof Error ? err.message : "Tool execution failed";
    const message = normalizeToolError(name, rawMessage);
    return { error: message };
  }
}

function normalizeToolError(toolName: string, message: string): string {
  if (toolName.includes("gmail") && isInsufficientScopeError(message)) {
    return GMAIL_COMPOSE_SCOPE_ERROR;
  }
  if (toolName.includes("youtube") && isInsufficientScopeError(message)) {
    return YOUTUBE_MISSING_SCOPE_ERROR;
  }
  return message;
}

async function handleSaveMemory(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { content, category, replaces_memory_id } = input as {
    content?: string;
    category?: MemoryCategory;
    replaces_memory_id?: string;
  };

  if (!content?.trim()) {
    return { error: "content is required" };
  }

  const result = await saveMemory(
    context.userId,
    content.trim(),
    category,
    context.sourceMessageId,
    replaces_memory_id,
  );

  return {
    success: true,
    id: result.memory.id,
    action: result.action,
    ...(result.replacedContent
      ? { replaced_content: result.replacedContent }
      : {}),
    ...(result.removedDuplicateIds?.length
      ? { removed_duplicates: result.removedDuplicateIds.length }
      : {}),
  };
}

async function handleSearchMemory(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { query, limit } = input as { query?: string; limit?: number };

  if (!query?.trim()) {
    return { error: "query is required" };
  }

  const memories = await searchMemories(
    context.userId,
    query.trim(),
    Math.min(limit ?? 5, 20),
  );

  return { memories };
}

async function handleLogWorkout(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const fields = input as {
    exercise?: string;
    sets?: number;
    reps?: number;
    weight_kg?: number;
    duration_min?: number;
    notes?: string;
  };

  if (!fields.exercise?.trim()) {
    return { error: "exercise is required" };
  }

  const workout = await insertWorkout(context.userId, {
    exercise: fields.exercise.trim(),
    sets: fields.sets,
    reps: fields.reps,
    weight_kg: fields.weight_kg,
    duration_min: fields.duration_min,
    notes: fields.notes,
    source_message_id: context.sourceMessageId,
  });

  return { success: true, id: workout.id, exercise: workout.exercise };
}

async function handleListWorkouts(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { limit, since } = input as { limit?: number; since?: string };

  const workouts = await listWorkouts(context.userId, {
    limit: Math.min(limit ?? 20, 50),
    since,
  });

  return { workouts };
}

async function handleSearchWorkouts(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { exercise, since, limit } = input as {
    exercise?: string;
    since?: string;
    limit?: number;
  };

  const workouts = await searchWorkouts(context.userId, {
    exercise,
    since,
    limit: Math.min(limit ?? 20, 50),
  });

  return { workouts };
}

async function handleCreateReminder(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { title, due_at } = input as { title?: string; due_at?: string };

  if (!title?.trim()) {
    return { error: "title is required" };
  }

  const resolvedDueAt = resolveReminderDueAt(
    context.userMessage ?? "",
    due_at ?? null,
  );

  const reminder = await insertReminder(context.userId, {
    title: title.trim(),
    due_at: resolvedDueAt,
    source_message_id: context.sourceMessageId,
  });

  if (reminder.due_at && new Date(reminder.due_at).getTime() <= Date.now()) {
    try {
      await dispatchDueReminderNotifications(context.userId);
    } catch (err) {
      console.error("[push] dispatch on create failed:", err);
    }
  }

  return {
    success: true,
    id: reminder.id,
    pushNote:
      "Browser push requires enabling notifications on the Reminders tab. Due reminders notify while this app is open or via the server cron job.",
  };
}

async function handleListReminders(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { status, limit } = input as {
    status?: "pending" | "done" | "cancelled" | "all";
    limit?: number;
  };

  const reminders = await listReminders(context.userId, {
    status: status ?? "pending",
    limit: limit ?? 20,
  });

  return { reminders };
}

async function handleCompleteReminder(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { id, title } = input as { id?: string; title?: string };

  if (id) {
    const reminder = await completeReminder(context.userId, id);
    return { success: true, id: reminder.id };
  }

  if (title?.trim()) {
    const needle = title.trim().toLowerCase();
    const pending = await listReminders(context.userId, {
      status: "pending",
      limit: 50,
    });
    const matches = pending.filter((r) =>
      r.title.toLowerCase().includes(needle),
    );
    if (matches.length === 0) {
      return { error: `No pending reminder matching "${title}"` };
    }
    if (matches.length > 1) {
      return {
        error: `Multiple reminders match "${title}". Use id from list_reminders.`,
        matches: matches.map((r) => ({ id: r.id, title: r.title })),
      };
    }
    const reminder = await completeReminder(context.userId, matches[0].id);
    return { success: true, id: reminder.id };
  }

  return { error: "id or title is required" };
}

async function handleCompleteAllReminders(
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const count = await completeAllPendingReminders(context.userId);
  return { success: true, completed_count: count };
}

async function handleDeleteAllReminders(
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const count = await deleteAllPendingReminders(context.userId);
  return { success: true, deleted_count: count };
}

async function handleDeleteReminder(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { id } = input as { id?: string };

  if (!id) {
    return { error: "id is required" };
  }

  const deleted = await deleteReminder(context.userId, id);
  if (!deleted) {
    return { error: "Reminder not found" };
  }
  return { success: true, id };
}

async function handleListCalendarEvents(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { time_min, time_max, max_results } = input as {
    time_min?: string;
    time_max?: string;
    max_results?: number;
  };

  const result = await listCalendarEvents(context.userId, {
    timeMin: time_min,
    timeMax: time_max,
    maxResults: max_results,
  });

  if ("error" in result) return { error: result.error };
  return { events: result.events };
}

async function handleCreateCalendarEvent(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const fields = input as {
    summary?: string;
    start?: string;
    end?: string;
    description?: string;
    location?: string;
    attendees?: string[];
  };

  if (!fields.summary?.trim() || !fields.start || !fields.end) {
    return { error: "summary, start, and end are required" };
  }

  const result = await createCalendarEvent(context.userId, {
    summary: fields.summary.trim(),
    start: fields.start,
    end: fields.end,
    description: fields.description,
    location: fields.location,
    attendees: fields.attendees,
  });

  if ("error" in result) return { error: result.error };
  return { success: true, event: result.event };
}

async function handleUpdateCalendarEvent(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const fields = input as {
    event_id?: string;
    summary?: string;
    start?: string;
    end?: string;
    description?: string;
    location?: string;
  };

  if (!fields.event_id) {
    return { error: "event_id is required" };
  }

  const result = await updateCalendarEvent(context.userId, {
    event_id: fields.event_id,
    summary: fields.summary,
    start: fields.start,
    end: fields.end,
    description: fields.description,
    location: fields.location,
  });

  if ("error" in result) return { error: result.error };
  return { success: true, event: result.event };
}

async function handleDeleteCalendarEvent(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { event_id } = input as { event_id?: string };

  if (!event_id) {
    return { error: "event_id is required" };
  }

  const result = await deleteCalendarEvent(context.userId, event_id);
  if ("error" in result) return { error: result.error };
  return { success: true };
}

async function handleSearchGmail(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { query, max_results } = input as {
    query?: string;
    max_results?: number;
  };

  if (!query?.trim()) {
    return { error: "query is required" };
  }

  const result = await searchGmail(
    context.userId,
    query.trim(),
    Math.min(max_results ?? 10, 25),
  );
  if ("error" in result) return { error: result.error };
  return { messages: result.messages };
}

async function handleGetGmailMessage(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { message_id } = input as { message_id?: string };

  if (!message_id) {
    return { error: "message_id is required" };
  }

  const result = await getGmailMessage(context.userId, message_id);
  if ("error" in result) return { error: result.error };
  return { message: result.message };
}

async function handleCreateGmailDraft(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const fields = input as {
    to?: string;
    subject?: string;
    body?: string;
    cc?: string;
    bcc?: string;
    reply_to_message_id?: string;
  };

  if (!fields.to?.trim() || !fields.body?.trim()) {
    return { error: "to and body are required" };
  }

  const result = await createGmailDraft(context.userId, {
    to: fields.to.trim(),
    subject: fields.subject?.trim() ?? "",
    body: fields.body.trim(),
    cc: fields.cc,
    bcc: fields.bcc,
    reply_to_message_id: fields.reply_to_message_id,
  });

  if ("error" in result) return { error: result.error };

  return {
    success: true,
    draft_id: result.draft.draftId,
    to: result.draft.to,
    subject: result.draft.subject,
    preview: result.draft.preview,
  };
}

async function handleGetYoutubeTasteProfile(
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const profile = await getCachedTasteProfile(context.userId, {
    refreshIfStale: true,
  });
  if (!profile) {
    return { error: "YouTube not linked or taste profile unavailable." };
  }
  return { profile };
}

async function handleSearchYoutube(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { query, max_results, duration } = input as {
    query?: string;
    max_results?: number;
    duration?: "short" | "medium" | "long";
  };

  if (!query?.trim()) {
    return { error: "query is required" };
  }

  const result = await searchYoutube(context.userId, query.trim(), {
    maxResults: max_results,
    duration,
  });
  if ("error" in result) return { error: result.error };
  return { videos: result.videos };
}

async function handleRecommendYoutube(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const { topic } = input as { topic?: string };

  if (!topic?.trim()) {
    return { error: "topic is required" };
  }

  const result = await recommendYoutube(context.userId, topic.trim());
  if ("error" in result) return { error: result.error };
  return { videos: result.videos, taste_summary: result.tasteSummary };
}

async function handleWebSearch(
  input: unknown,
): Promise<Record<string, unknown>> {
  const inp = input as { query: string; count?: number };
  if (!inp.query?.trim()) {
    return { error: "query is required" };
  }
  const { results, error } = await googleWebSearch(inp.query.trim(), inp.count ?? 5);
  if (error) return { error };
  return { results, count: results.length };
}

async function handleFetchWebpage(
  input: unknown,
): Promise<Record<string, unknown>> {
  const inp = input as { url: string };
  if (!inp.url?.trim()) {
    return { error: "url is required" };
  }
  const result = await fetchWebpage(inp.url.trim());
  return result as Record<string, unknown>;
}

async function handlePlanWorkflow(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const inp = input as {
    title: string;
    description: string;
    steps: Array<{
      tool: string;
      args: Record<string, unknown>;
      description: string;
      risk_level: "read" | "write" | "irreversible";
    }>;
  };

  if (!inp.title?.trim() || !Array.isArray(inp.steps) || inp.steps.length < 2) {
    return { error: "plan_workflow requires a title and at least 2 steps" };
  }

  const run = await createWorkflowRun({
    userId: context.userId,
    conversationId: context.conversationId,
    title: inp.title.trim(),
    description: inp.description?.trim() ?? "",
    steps: inp.steps.map((s, i) => ({
      stepIndex: i,
      toolName: s.tool,
      args: s.args ?? {},
      description: s.description,
      riskLevel: s.risk_level,
    })),
  });

  return {
    workflow_id: run.id,
    title: inp.title,
    step_count: inp.steps.length,
    steps: inp.steps.map((s, i) => ({
      index: i,
      description: s.description,
      tool_name: s.tool,
      risk_level: s.risk_level,
    })),
    status: "pending",
  };
}
