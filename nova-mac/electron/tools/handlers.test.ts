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
vi.mock("./browser-control", () => ({
  listBrowserTabs: vi.fn().mockResolvedValue({ tabs: [] }),
  openBrowserTab: vi.fn().mockResolvedValue({ url: "https://example.com" }),
  activateBrowserTab: vi.fn().mockResolvedValue({ activated: 1 }),
  closeBrowserTab: vi.fn().mockResolvedValue({ closed: 1 }),
  getActiveTabContent: vi.fn().mockResolvedValue({
    title: "Example",
    url: "https://example.com",
    text: "hello",
    truncated: false,
  }),
  executeBrowserJs: vi.fn().mockResolvedValue({ result: "1", truncated: false }),
  organizeBrowserTabs: vi.fn().mockResolvedValue({
    windowIndex: 1,
    mode: "domain",
    changed: true,
    before: ["a", "b"],
    after: ["b", "a"],
    moved_count: 2,
    dry_run: true,
  }),
}));
vi.mock("./skills-store", () => ({
  createSkill: vi.fn().mockReturnValue({
    id: "s1",
    name: "Chemistry Tuition",
    triggers: ["open chemistry tuition"],
    actions: [{ type: "open_path", path: "/tmp/chem.pdf" }],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }),
  listSkills: vi.fn().mockReturnValue([]),
  updateSkill: vi.fn().mockReturnValue({
    id: "s1",
    name: "Chemistry Tuition",
    triggers: ["open chemistry tuition"],
    actions: [{ type: "open_path", path: "/tmp/chem.pdf" }],
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }),
  deleteSkill: vi.fn().mockReturnValue(true),
  runSkill: vi.fn().mockResolvedValue({
    skill_id: "s1",
    skill_name: "Chemistry Tuition",
    actions_run: 1,
    failures: [],
  }),
}));
vi.mock("./mac-control", () => ({
  setSystemVolume: vi.fn().mockResolvedValue({ verified: true }),
  getSystemVolume: vi.fn().mockResolvedValue({ level: 50, muted: false }),
  setScreenBrightness: vi.fn().mockResolvedValue({ level: 0.5, method: "brightness-cli" }),
  nudgeScreenBrightness: vi.fn().mockResolvedValue({ method: "key-simulation" }),
  openApp: vi.fn().mockResolvedValue(undefined),
  quitApp: vi.fn().mockResolvedValue(undefined),
  openUrl: vi.fn().mockResolvedValue(undefined),
  runAppleScript: vi.fn().mockResolvedValue({ output: "ok" }),
  runShortcut: vi.fn().mockResolvedValue({ output: "ok" }),
  listShortcuts: vi.fn().mockResolvedValue({ shortcuts: [] }),
  setClockTimer: vi.fn().mockResolvedValue({ started: true, hours: 0, minutes: 1, seconds: 0 }),
  hasAccessibility: vi.fn().mockResolvedValue(true),
  openPrivacySettings: vi.fn().mockResolvedValue(undefined),
  controlMedia: vi.fn().mockResolvedValue({ action: "playpause" }),
  playOnYouTube: vi.fn().mockResolvedValue({ played: true, note: "ok" }),
  runShellCommand: vi.fn().mockResolvedValue({ output: "", exitCode: 0, truncated: false }),
  spotlightSearch: vi.fn().mockResolvedValue({ paths: [], count: 0 }),
  openPath: vi.fn().mockResolvedValue(undefined),
  openSettingsPane: vi.fn().mockResolvedValue({ opened: "privacy" }),
  getClipboard: vi.fn().mockResolvedValue({ text: "", truncated: false }),
  setClipboard: vi.fn().mockResolvedValue(undefined),
  takeScreenshot: vi.fn().mockResolvedValue({ path: "/tmp/x.png" }),
  trashFile: vi.fn().mockResolvedValue({ trashed: "/tmp/a.txt" }),
  moveFile: vi.fn().mockResolvedValue({
    from: "/tmp/a.txt",
    to: "/tmp/b.txt",
    overwritten: false,
  }),
  renameFile: vi.fn().mockResolvedValue({
    from: "/tmp/a.txt",
    to: "/tmp/b.txt",
    overwritten: false,
  }),
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

  it("get_youtube_taste_profile returns not-linked error when profile is null", async () => {
    const result = await executeTool("get_youtube_taste_profile", {}, ctx);
    expect(result).toEqual({
      error: "YouTube not linked. Connect via the web app.",
    });
  });

  it("organize_browser_tabs supports dry_run", async () => {
    const result = await executeTool(
      "organize_browser_tabs",
      { mode: "domain", dry_run: true },
      ctx,
    );
    expect(result).toMatchObject({
      success: true,
      mode: "domain",
      dry_run: true,
    });
  });

  it("trash_file requires absolute path", async () => {
    const result = await executeTool("trash_file", { path: "notes.txt" }, ctx);
    expect(result).toEqual({ error: "path must be an absolute path" });
  });

  it("move_file validates required inputs", async () => {
    const result = await executeTool("move_file", { source_path: "/tmp/a.txt" }, ctx);
    expect(result).toEqual({ error: "destination_path is required" });
  });

  it("rename_file returns success for valid input", async () => {
    const result = await executeTool(
      "rename_file",
      { path: "/tmp/a.txt", new_name: "b.txt" },
      ctx,
    );
    expect(result).toMatchObject({
      success: true,
      from: "/tmp/a.txt",
      to: "/tmp/b.txt",
    });
  });

  it("create_custom_skill validates required inputs", async () => {
    const result = await executeTool("create_custom_skill", { name: "Chem" }, ctx);
    expect(result).toEqual({ error: "triggers must be a non-empty array" });
  });

  it("create_custom_skill returns saved skill", async () => {
    const result = await executeTool(
      "create_custom_skill",
      {
        name: "Chemistry Tuition",
        triggers: ["open chemistry tuition"],
        actions: [{ type: "open_path", path: "/tmp/chem.pdf" }],
      },
      ctx,
    );
    expect(result).toMatchObject({
      success: true,
      skill: { id: "s1", name: "Chemistry Tuition" },
    });
  });

  it("run_custom_skill returns execution result", async () => {
    const result = await executeTool("run_custom_skill", { id: "s1" }, ctx);
    expect(result).toMatchObject({
      success: true,
      skill_id: "s1",
      actions_run: 1,
    });
  });
});
