import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("../memory/save", () => ({
  saveMemory: vi.fn().mockResolvedValue({ action: "created", memory: { id: "m1", content: "test" } }),
}));
vi.mock("../memory/search", () => ({
  searchMemories: vi.fn().mockResolvedValue([{ id: "m1", content: "coffee preference" }]),
}));
vi.mock("../memory/reminders", () => ({
  insertReminder: vi.fn().mockResolvedValue({ id: "r1", title: "test", status: "pending", due_at: null }),
  listReminders: vi.fn().mockResolvedValue([]),
  completeReminder: vi.fn().mockResolvedValue(true),
  completeAllPendingReminders: vi.fn().mockResolvedValue(2),
  deleteReminder: vi.fn().mockResolvedValue(undefined),
  deleteAllPendingReminders: vi.fn().mockResolvedValue(0),
}));
vi.mock("./workouts", () => ({
  insertWorkout: vi.fn().mockResolvedValue({ id: "w1", exercise: "bench press" }),
  listWorkouts: vi.fn().mockResolvedValue([]),
  searchWorkouts: vi.fn().mockResolvedValue([]),
}));
vi.mock("../google/calendar", () => ({
  listCalendarEvents: vi.fn().mockRejectedValue(new Error("Google Calendar not linked")),
  createCalendarEvent: vi.fn().mockRejectedValue(new Error("Google Calendar not linked")),
  updateCalendarEvent: vi.fn().mockRejectedValue(new Error("Google Calendar not linked")),
  deleteCalendarEvent: vi.fn().mockRejectedValue(new Error("Google Calendar not linked")),
}));
vi.mock("../google/gmail", () => ({
  searchGmail: vi.fn().mockRejectedValue(new Error("Gmail not linked")),
  getGmailMessage: vi.fn().mockRejectedValue(new Error("Gmail not linked")),
  createGmailDraft: vi.fn().mockRejectedValue(new Error("Gmail not linked")),
}));
vi.mock("../google/youtube", () => ({
  getCachedTasteProfile: vi.fn().mockResolvedValue(null),
  searchYoutube: vi.fn().mockRejectedValue(new Error("YouTube not linked")),
  recommendYoutube: vi.fn().mockRejectedValue(new Error("YouTube not linked")),
}));
vi.mock("../google/errors", () => ({
  YOUTUBE_MISSING_SCOPE_ERROR: "YouTube is connected but missing permission.",
  isInsufficientScopeError: vi.fn().mockReturnValue(false),
}));

import { executeTool } from "./handlers";

const ctx = { userId: "u1", conversationId: "c1", sourceMessageId: "m1", userMessage: "test" };

describe("executeTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("save_memory delegates to saveMemory", async () => {
    const result = await executeTool("save_memory", { content: "I like coffee" }, ctx);
    expect(result).toHaveProperty("success", true);
  });

  it("search_memory returns results", async () => {
    const result = await executeTool("search_memory", { query: "coffee" }, ctx);
    expect(result).toHaveProperty("memories");
  });

  it("create_reminder creates and returns the reminder", async () => {
    const result = await executeTool("create_reminder", { title: "Buy milk" }, ctx);
    expect(result).toHaveProperty("success", true);
  });

  it("list_calendar_events returns not-connected when Google auth returns null", async () => {
    // With no token row in Supabase, getCalendarClient returns null → CALENDAR_NOT_CONNECTED
    const result = await executeTool("list_calendar_events", {}, ctx);
    expect(result).toHaveProperty("error");
  });

  it("unknown tool returns error", async () => {
    const result = await executeTool("nonexistent_tool", {}, ctx);
    expect(result).toHaveProperty("error");
  });
});
