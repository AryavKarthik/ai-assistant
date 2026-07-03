import { describe, it, expect, vi, beforeEach } from "vitest";

// Must be set before the chat-turn module initializes the Anthropic client check
process.env.ANTHROPIC_API_KEY = "sk-test";

vi.mock("./memory/index", () => ({
  getUserId: vi.fn().mockResolvedValue("u1"),
  inferContextIntent: vi.fn().mockReturnValue("general"),
  resolveRetrievalPlan: vi.fn().mockReturnValue({ chatHistoryLimit: 8, memoryLimit: 4, queryMatchPool: 8, reminderLimit: 0, recentMemoryFallback: 0, coreProfileMode: "minimal", intent: "general", contextNote: "" }),
  applyMacVoiceOverrides: vi.fn((p) => p),
  preRetrieveContext: vi.fn().mockResolvedValue(""),
  resolveUserTimezoneCached: vi.fn().mockResolvedValue("UTC"),
  buildClockForZone: vi.fn().mockReturnValue({ iso: "2026-07-01T00:00:00Z", localDate: "July 1", localTime: "12:00 PM", timezone: "UTC", timezoneLabel: "UTC" }),
  buildMacSystemPrompt: vi.fn().mockReturnValue("You are Nova."),
  inferComplexity: vi.fn().mockReturnValue("light"),
  autoCaptureFromMessage: vi.fn().mockResolvedValue({ saved: 0, memoryIds: [], errors: [] }),
  resolveAssistantText: vi.fn((text) => text || "fallback"),
}));

vi.mock("./conversation", () => ({
  getOrCreateConversation: vi.fn().mockResolvedValue("conv-1"),
  persistUserMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
  loadLastNMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("./tools/handlers", () => ({
  executeTool: vi.fn(),
}));

vi.mock("./tools/definitions", () => ({
  TOOL_DEFINITIONS: [],
  getToolDefinitions: () => [],
}));

// Mock Anthropic client
const mockStream = {
  on: vi.fn().mockImplementation(function (this: unknown, event: string, cb: (delta: string) => void) {
    if (event === "text") cb("Hello from Nova");
    return this;
  }),
  finalMessage: vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "Hello from Nova" }] }),
};
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { stream: vi.fn().mockReturnValue(mockStream) },
  })),
}));

import { IpcChannel, type ChatSendRequest } from "@shared/types";
import { streamTurn, cancelTurn } from "./chat-turn";

describe("streamTurn", () => {
  const emits: Array<[IpcChannel, unknown]> = [];
  const emit = (ch: IpcChannel, payload: unknown) => emits.push([ch, payload]);

  beforeEach(() => {
    emits.length = 0;
    vi.clearAllMocks();
  });

  it("emits ChatDelta and ChatDone for a successful voice turn", async () => {
    const req: ChatSendRequest = {
      requestId: "req-1",
      messages: [{ role: "user", content: "hello" }],
      inputModality: "voice",
    };
    await streamTurn(req, emit);
    expect(emits.some(([ch]) => ch === IpcChannel.ChatDelta)).toBe(true);
    expect(emits.some(([ch]) => ch === IpcChannel.ChatDone)).toBe(true);
  });

  it("emits ChatError when userId fails", async () => {
    const { getUserId } = await import("./memory/index");
    (getUserId as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Not signed in"));
    const req: ChatSendRequest = { requestId: "req-2", messages: [{ role: "user", content: "hi" }] };
    await streamTurn(req, emit);
    expect(emits.some(([ch]) => ch === IpcChannel.ChatError)).toBe(true);
  });

  it("cancelTurn aborts in-flight request silently", async () => {
    // Register a slow stream
    const { default: AnthropicMock } = await import("@anthropic-ai/sdk");
    (AnthropicMock as unknown as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      messages: {
        stream: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnThis(),
          finalMessage: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
        }),
      },
    }));
    const req: ChatSendRequest = { requestId: "req-slow", messages: [{ role: "user", content: "slow" }] };
    const turnPromise = streamTurn(req, emit);
    cancelTurn("req-slow");
    await turnPromise;
    expect(emits.every(([ch]) => ch !== IpcChannel.ChatError)).toBe(true);
  });
});
