import {
  completeAllPendingReminders,
  completeReminder,
  deleteAllPendingReminders,
  deleteReminder,
  insertReminder,
  listReminders,
} from "../memory/reminders";
import { insertWorkout, listWorkouts, searchWorkouts } from "./workouts";
import { saveMemory } from "../memory/save";
import { searchMemories } from "../memory/search";
import { resolveReminderDueAt } from "./parse-due-at";
import { googleWebSearch } from "./web-search";
import { fetchWebpage } from "./webpage";
import type { MemoryCategory } from "../memory/types";

export interface ToolContext {
  userId: string;
  conversationId: string;
  sourceMessageId: string;
  userMessage: string;
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
        case "create_calendar_event":
        case "update_calendar_event":
        case "delete_calendar_event":
          return { error: "Google Calendar is not yet connected on Mac." };
        case "search_gmail":
        case "get_gmail_message":
        case "create_gmail_draft":
          return { error: "Gmail is not yet connected on Mac." };
        case "get_youtube_taste_profile":
        case "search_youtube":
        case "recommend_youtube":
          return { error: "YouTube is not yet connected on Mac." };
        case "web_search":
          return handleWebSearch(input);
        case "fetch_webpage":
          return handleFetchWebpage(input);
        default:
          return { error: `Unknown tool: ${name}` };
      }
    })();
    return result;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Tool execution failed";
    return { error: message };
  }
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

  return {
    success: true,
    id: reminder.id,
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
    const ok = await completeReminder(context.userId, id);
    if (!ok) return { error: `Reminder not found or already done` };
    return { success: true, id };
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
    const ok = await completeReminder(context.userId, matches[0].id);
    if (!ok) return { error: `Failed to complete reminder` };
    return { success: true, id: matches[0].id };
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

  await deleteReminder(context.userId, id);
  return { success: true, id };
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
