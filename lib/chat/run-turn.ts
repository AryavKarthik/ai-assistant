import type {
  ContentBlock,
  MessageCreateParamsNonStreaming,
  MessageParam,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import type { TurnUsage } from "@/lib/chat/types";
import { buildSystemBlocks, withCachedTools } from "@/lib/chat/prompt-cache";
import {
  getAnthropicClient,
  getCandidateModelsWithOverride,
  type ModelComplexity,
} from "@/lib/anthropic/client";
import { buildClaudeMessages } from "@/lib/chat/build-messages";
import { inferContextIntent } from "@/lib/chat/context-intent";
import type { EphemeralImage } from "@/lib/chat/image";
import { buildReceipt, deriveTrustTags } from "@/lib/chat/receipts";
import { streamMessageWithFallback } from "@/lib/chat/stream-message";
import type { ChatStreamEvent } from "@/lib/chat/stream-events";
import type { ChatActionReceipt } from "@/lib/chat/types";
import { parseModelRequest } from "@/lib/chat/model-override";
import { inferComplexity } from "@/lib/chat/model-routing";
import { inferPersonalityContext } from "@/lib/chat/personality";
import { getForcedReminderTool, isReminderCreateIntent } from "@/lib/chat/reminder-intent";
import { getForcedMemoryTool } from "@/lib/chat/memory-intent";
import {
  buildRuntimeClockContext,
  formatRuntimeClockForPrompt,
} from "@/lib/chat/runtime-context";
import {
  buildDynamicSystemAdditions,
  STATIC_SYSTEM_PROMPT,
  STATIC_VOICE_SYSTEM_PROMPT,
} from "@/lib/chat/system-prompt";
import {
  applyVoiceRetrievalOverrides,
  resolveRetrievalPlan,
  resolveThreadSection,
} from "@/lib/chat/thread-context";
import { loadLastNMessages } from "@/lib/db/messages";
import { autoCaptureFromMessage } from "@/lib/memory/extract";
import { preRetrieveContext } from "@/lib/memory/search";
import { resolveAssistantText, voiceSpokenFallback } from "@/lib/chat/voice-fallback";
import { TOOL_DEFINITIONS, executeTool } from "@/lib/tools";

const MAX_TOOL_ITERATIONS = 10;
const MAX_TOOL_ITERATIONS_VOICE = 3;
const MAX_HISTORY_LOAD = 80;
const VOICE_CONTEXT_TIMEOUT_MS = 1200;

export interface RunTurnInput {
  userId: string;
  conversationId: string;
  userMessageId: string;
  modelPreference?: string | null;
  ephemeralImage?: EphemeralImage;
  threadSection?: string | null;
  inputModality?: "voice" | "text";
  clientTimeZone?: string | null;
}

export interface RunTurnResult {
  text: string;
  modelUsed: string;
  modelPreference: string | null;
  actionReceipts: ChatActionReceipt[];
  trustTags: string[];
  highlightStored: boolean;
  cacheUsage: TurnUsage;
}

export interface PreparedTurnContext {
  userId: string;
  conversationId: string;
  userMessageId: string;
  latestUserMessage: string;
  isVoiceTurn: boolean;
  complexity: ModelComplexity;
  explicitModel: string | null;
  nextPreference: string | null;
  maxTokens: number;
  maxToolIterations: number;
  messages: MessageParam[];
  /** Static portion of the system prompt — cached by Anthropic (TTL 5 min). */
  systemPrompt: string;
  /** Per-turn runtime context (clock, timezone) — not cached. */
  runtimeContext: string;
  forcedTool: string | null;
  reminderCreateIntent: boolean;
  actionReceipts: ChatActionReceipt[];
  voiceCapturePromise: Promise<{ saved: number; memoryIds: string[]; errors: string[] }> | null;
}

export async function prepareTurnContext(
  input: RunTurnInput,
): Promise<PreparedTurnContext> {
  const {
    userId,
    conversationId,
    userMessageId,
    modelPreference,
    ephemeralImage,
    threadSection: threadSectionInput,
    inputModality,
    clientTimeZone,
  } = input;

  const isVoiceTurn = inputModality === "voice";
  const threadSection = resolveThreadSection(threadSectionInput);
  const rawHistory = await loadLastNMessages(conversationId, MAX_HISTORY_LOAD);
  const latestUserMessage = rawHistory[rawHistory.length - 1]?.content ?? "";
  const contextIntent = inferContextIntent(latestUserMessage, threadSection);
  let retrievalPlan = resolveRetrievalPlan(threadSection, contextIntent);
  if (isVoiceTurn) {
    retrievalPlan = applyVoiceRetrievalOverrides(retrievalPlan);
  }
  const history = rawHistory.slice(-retrievalPlan.chatHistoryLimit);

  const complexity: ModelComplexity = isVoiceTurn
    ? "light"
    : inferComplexity(latestUserMessage);
  const modelRequest = parseModelRequest(latestUserMessage);
  const personalityHints = inferPersonalityContext(latestUserMessage);
  // Static base is marked cache_control:ephemeral by buildSystemBlocks.
  // Dynamic per-turn additions (personality_context, thread_context) go into
  // runtimeContext so the cache key stays stable across turns.
  const systemPrompt = isVoiceTurn ? STATIC_VOICE_SYSTEM_PROMPT : STATIC_SYSTEM_PROMPT;
  const dynamicAdditions = buildDynamicSystemAdditions(
    personalityHints,
    threadSection,
    contextIntent,
  );

  let nextPreference = modelPreference ?? null;
  let explicitModel: string | null = null;

  if (modelRequest === "reset") {
    nextPreference = null;
  } else if (modelRequest) {
    explicitModel = modelRequest.model;
    if (modelRequest.persist) {
      nextPreference = modelRequest.model;
    }
  } else if (nextPreference) {
    explicitModel = nextPreference;
  }

  console.log("[model-router] routing", {
    complexity,
    explicitModel: explicitModel ?? "auto",
    pinnedPreference: nextPreference,
  });
  console.log("[personality] routing", personalityHints);
  console.log("[context-router]", {
    threadSection,
    intent: contextIntent,
    memoryLimit: retrievalPlan.memoryLimit,
    chatHistoryLimit: retrievalPlan.chatHistoryLimit,
  });

  const actionReceipts: ChatActionReceipt[] = [];

  const capturePromise = autoCaptureFromMessage(
    userId,
    latestUserMessage,
    userMessageId,
  ).catch((err) => {
    console.error("[memory] auto-capture failed:", err);
    return { saved: 0, memoryIds: [], errors: [] as string[] };
  });

  // For voice turns, capture runs concurrently with the model; we surface
  // the result after the model loop via voiceCapturePromise.

  let captureResult: {
    saved: number;
    memoryIds: string[];
    errors: string[];
  };
  let runtimeClock: Awaited<ReturnType<typeof buildRuntimeClockContext>>;
  let relevantContext: string;

  if (isVoiceTurn) {
    captureResult = { saved: 0, memoryIds: [], errors: [] }; // resolved later via voiceCapturePromise
    // Start the deadline timer before the clock resolves so its own latency
    // doesn't eat into the memory retrieval budget.
    const deadlinePromise = new Promise<string>((resolve) =>
      setTimeout(() => resolve(""), VOICE_CONTEXT_TIMEOUT_MS),
    );
    const clockPromise = buildRuntimeClockContext(userId, new Date(), clientTimeZone);
    [runtimeClock, relevantContext] = await Promise.all([
      clockPromise,
      clockPromise.then((clock) =>
        Promise.race([
          preRetrieveContext(
            userId,
            latestUserMessage,
            retrievalPlan,
            clock,
          ),
          deadlinePromise,
        ]),
      ),
    ]);
  } else {
    [captureResult, runtimeClock] = await Promise.all([
      capturePromise,
      buildRuntimeClockContext(userId, new Date(), clientTimeZone),
    ]);
    relevantContext = await preRetrieveContext(
      userId,
      latestUserMessage,
      retrievalPlan,
      runtimeClock,
    );
  }
  if (!isVoiceTurn && captureResult.saved > 0) {
    console.log("[memory] server auto-captured", captureResult.saved, "fact(s)");
    actionReceipts.push({
      id: `server-capture-${Date.now()}`,
      action: "Memory",
      outcome:
        captureResult.saved === 1
          ? "Saved to memory"
          : `Saved ${captureResult.saved} facts to memory`,
      source: "memory",
      status: "success",
    });
  }
  if (!isVoiceTurn && captureResult.errors.length > 0) {
    console.error("[memory] auto-capture errors:", captureResult.errors);
  }

  const messages: MessageParam[] = buildClaudeMessages({
    history,
    relevantContext,
    ephemeralImage,
  });

  const maxTokens = ephemeralImage ? 1280 : isVoiceTurn ? 650 : 768;
  const recentAssistantText = [...history]
    .reverse()
    .find((m) => m.role === "assistant")?.content;
  const forcedReminderTool = getForcedReminderTool(
    latestUserMessage,
    recentAssistantText,
  );
  const forcedMemoryTool = forcedReminderTool
    ? null
    : getForcedMemoryTool(latestUserMessage);
  const forcedTool = forcedReminderTool ?? forcedMemoryTool;
  const reminderCreateIntent = isReminderCreateIntent(latestUserMessage);
  return {
    userId,
    conversationId,
    userMessageId,
    latestUserMessage,
    isVoiceTurn,
    complexity,
    explicitModel,
    nextPreference,
    maxTokens,
    maxToolIterations: isVoiceTurn
      ? MAX_TOOL_ITERATIONS_VOICE
      : MAX_TOOL_ITERATIONS,
    messages,
    systemPrompt,
    runtimeContext: [dynamicAdditions, formatRuntimeClockForPrompt(runtimeClock)]
      .filter(Boolean)
      .join("\n\n"),
    forcedTool,
    reminderCreateIntent,
    actionReceipts,
    voiceCapturePromise: isVoiceTurn ? capturePromise : null,
  };
}

function buildRunTurnResult(
  ctx: PreparedTurnContext,
  rawText: string,
  selectedModel: string,
  createReminderSucceeded: boolean,
  cacheUsage: TurnUsage,
): RunTurnResult {
  const text = resolveAssistantText(rawText, {
    isVoiceTurn: ctx.isVoiceTurn,
    actionReceipts: ctx.actionReceipts,
    isMemoryIntent: Boolean(getForcedMemoryTool(ctx.latestUserMessage)),
  });

  if (ctx.reminderCreateIntent && !createReminderSucceeded) {
    return {
      text: "I couldn't save that reminder to your Reminders tab. Please try again — I'll call the reminder tool directly this time.",
      modelUsed: selectedModel,
      modelPreference: ctx.nextPreference,
      actionReceipts: ctx.actionReceipts,
      trustTags: deriveTrustTags(ctx.actionReceipts),
      highlightStored: false,
      cacheUsage,
    };
  }

  return {
    text,
    modelUsed: selectedModel,
    modelPreference: ctx.nextPreference,
    actionReceipts: ctx.actionReceipts,
    trustTags: deriveTrustTags(ctx.actionReceipts),
    highlightStored: ctx.actionReceipts.some(
      (receipt) => receipt.source === "memory" && receipt.status === "success",
    ),
    cacheUsage,
  };
}

function zeroUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
}

function accumulateUsage(acc: TurnUsage, next: TurnUsage): TurnUsage {
  return {
    inputTokens: acc.inputTokens + next.inputTokens,
    outputTokens: acc.outputTokens + next.outputTokens,
    cacheCreationInputTokens: acc.cacheCreationInputTokens + next.cacheCreationInputTokens,
    cacheReadInputTokens: acc.cacheReadInputTokens + next.cacheReadInputTokens,
  };
}

// Core turn logic: pre-retrieve memory → call Claude → tool loop → final text.
export async function runTurn(input: RunTurnInput): Promise<RunTurnResult> {
  const ctx = await prepareTurnContext(input);
  const anthropic = getAnthropicClient();
  const messages = [...ctx.messages];
  let createReminderSucceeded = false;
  let selectedModel = "";
  let turnUsage = zeroUsage();

  let responseResult = await createMessageWithFallback(anthropic, {
    complexity: ctx.complexity,
    explicitModel: ctx.explicitModel,
    max_tokens: ctx.maxTokens,
    systemPrompt: ctx.systemPrompt,
    runtimeContext: ctx.runtimeContext,
    messages,
    tools: TOOL_DEFINITIONS,
    tool_choice: ctx.forcedTool
      ? { type: "tool", name: ctx.forcedTool }
      : { type: "auto" },
    includeRuntimeContext: true,
  });
  let response = responseResult.response;
  selectedModel = responseResult.model;
  turnUsage = accumulateUsage(turnUsage, responseResult.usage);

  let iterations = 0;

  while (
    response.stop_reason === "tool_use" &&
    iterations < ctx.maxToolIterations
  ) {
    const toolUseBlocks = response.content.filter(
      (block): block is ContentBlock & { type: "tool_use" } =>
        block.type === "tool_use",
    );

    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await executeTool(block.name, block.input, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          sourceMessageId: ctx.userMessageId,
          userMessage: ctx.latestUserMessage,
        });
        ctx.actionReceipts.push(buildReceipt(block.name, result));

        if (
          block.name === "create_reminder" &&
          "success" in result &&
          result.success === true
        ) {
          createReminderSucceeded = true;
        }

        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      }),
    );

    messages.push({ role: "user", content: toolResults });

    responseResult = await createMessageWithFallback(anthropic, {
      complexity: ctx.complexity,
      explicitModel: ctx.explicitModel,
      max_tokens: ctx.maxTokens,
      systemPrompt: ctx.systemPrompt,
      runtimeContext: ctx.runtimeContext,
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: { type: "auto" },
    });
    response = responseResult.response;
    selectedModel = responseResult.model;
    turnUsage = accumulateUsage(turnUsage, responseResult.usage);

    iterations++;
  }

  if (response.stop_reason === "tool_use") {
    console.warn(
      `[run-turn] hit MAX_TOOL_ITERATIONS (${ctx.maxToolIterations}) for conversation ${ctx.conversationId}`,
    );
  }

  if (ctx.voiceCapturePromise) {
    const voiceCapture = await ctx.voiceCapturePromise;
    if (voiceCapture.saved > 0) {
      console.log("[memory] voice turn auto-captured", voiceCapture.saved, "fact(s)");
      ctx.actionReceipts.push({
        id: `server-capture-${Date.now()}`,
        action: "Memory",
        outcome:
          voiceCapture.saved === 1
            ? "Saved to memory"
            : `Saved ${voiceCapture.saved} facts to memory`,
        source: "memory",
        status: "success",
      });
    }
    if (voiceCapture.errors.length > 0) {
      console.error("[memory] auto-capture errors:", voiceCapture.errors);
    }
  }

  const text = extractText(response.content);
  return buildRunTurnResult(ctx, text, selectedModel, createReminderSucceeded, turnUsage);
}

export async function runTurnStream(
  input: RunTurnInput,
  emit: (event: ChatStreamEvent) => void,
): Promise<RunTurnResult> {
  const ctx = await prepareTurnContext(input);
  const anthropic = getAnthropicClient();
  const messages = [...ctx.messages];
  let createReminderSucceeded = false;
  let selectedModel = "";
  let iterations = 0;
  let turnUsage = zeroUsage();
  let response;
  let emittedAnyDelta = false;

  const onDelta = (delta: string) => {
    emittedAnyDelta = true;
    emit({ type: "delta", text: delta });
  };

  while (true) {
    const emitDeltas = ctx.isVoiceTurn || iterations > 0 ? true : !ctx.forcedTool;

    if (
      iterations === 0 &&
      ctx.forcedTool &&
      ctx.isVoiceTurn &&
      !emittedAnyDelta
    ) {
      const progressText =
        ctx.forcedTool === "create_reminder"
          ? "Setting that reminder…"
          : "One moment…";
      onDelta(progressText);
    }

    const streamResult = await streamMessageWithFallback(
      anthropic,
      {
        complexity: ctx.complexity,
        explicitModel: ctx.explicitModel,
        max_tokens: ctx.maxTokens,
        systemPrompt: ctx.systemPrompt,
        runtimeContext: ctx.runtimeContext,
        messages,
        tools: TOOL_DEFINITIONS,
        tool_choice:
          iterations === 0 && ctx.forcedTool
            ? { type: "tool", name: ctx.forcedTool }
            : { type: "auto" },
        includeRuntimeContext: true,
      },
      emitDeltas ? { emitDeltas: true, onTextDelta: onDelta } : {},
    );

    response = streamResult.response;
    selectedModel = streamResult.model;
    turnUsage = accumulateUsage(turnUsage, streamResult.usage);

    if (response.stop_reason !== "tool_use") {
      break;
    }

    if (iterations >= ctx.maxToolIterations) {
      console.warn(
        `[run-turn] hit MAX_TOOL_ITERATIONS (${ctx.maxToolIterations}) for conversation ${ctx.conversationId}`,
      );
      break;
    }

    const toolUseBlocks = response.content.filter(
      (block): block is ContentBlock & { type: "tool_use" } =>
        block.type === "tool_use",
    );

    messages.push({ role: "assistant", content: response.content });

    const toolResults = await Promise.all(
      toolUseBlocks.map(async (block) => {
        const result = await executeTool(block.name, block.input, {
          userId: ctx.userId,
          conversationId: ctx.conversationId,
          sourceMessageId: ctx.userMessageId,
          userMessage: ctx.latestUserMessage,
        });
        ctx.actionReceipts.push(buildReceipt(block.name, result));

        if (
          block.name === "create_reminder" &&
          "success" in result &&
          result.success === true
        ) {
          createReminderSucceeded = true;
        }

        return {
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: JSON.stringify(result),
        };
      }),
    );

    messages.push({ role: "user", content: toolResults });
    iterations++;
  }

  const rawText = extractText(response!.content);
  const text = resolveAssistantText(rawText, {
    isVoiceTurn: ctx.isVoiceTurn,
    actionReceipts: ctx.actionReceipts,
    isMemoryIntent: Boolean(getForcedMemoryTool(ctx.latestUserMessage)),
  });

  if (ctx.isVoiceTurn && !rawText.trim()) {
    const spokenFallback = voiceSpokenFallback(ctx.actionReceipts);
    if (spokenFallback && emittedAnyDelta) {
      emit({ type: "delta", text: ` ${spokenFallback}` });
    } else if (text && !emittedAnyDelta) {
      emit({ type: "delta", text });
    }
  } else if (!emittedAnyDelta && text) {
    emit({ type: "delta", text });
  }

  if (ctx.voiceCapturePromise) {
    const voiceCapture = await ctx.voiceCapturePromise;
    if (voiceCapture.saved > 0) {
      console.log("[memory] voice turn auto-captured", voiceCapture.saved, "fact(s)");
      ctx.actionReceipts.push({
        id: `server-capture-${Date.now()}`,
        action: "Memory",
        outcome:
          voiceCapture.saved === 1
            ? "Saved to memory"
            : `Saved ${voiceCapture.saved} facts to memory`,
        source: "memory",
        status: "success",
      });
    }
    if (voiceCapture.errors.length > 0) {
      console.error("[memory] auto-capture errors:", voiceCapture.errors);
    }
  }

  return buildRunTurnResult(ctx, rawText, selectedModel, createReminderSucceeded, turnUsage);
}

async function createMessageWithFallback(
  anthropic: ReturnType<typeof getAnthropicClient>,
  params: Omit<MessageCreateParamsNonStreaming, "model" | "system"> & {
    complexity: ModelComplexity;
    explicitModel?: string | null;
    includeRuntimeContext?: boolean;
    systemPrompt: string;
    runtimeContext?: string;
  },
) {
  const {
    complexity,
    explicitModel,
    includeRuntimeContext = false,
    systemPrompt,
    runtimeContext = "",
    ...messageParams
  } = params;
  const models = getCandidateModelsWithOverride(complexity, explicitModel);
  let lastError: unknown;

  for (const model of models) {
    try {
      const runtimeNote = includeRuntimeContext
        ? `\n\nRuntime model context:\n` +
          `- Current model in use for this response: ${model}\n` +
          `- If the user asks which model you are using, answer with this exact model name.`
        : "";
      const dynamicContext = [runtimeContext, runtimeNote]
        .filter(Boolean)
        .join("\n\n");
      const response = await anthropic.messages.create({
        ...messageParams,
        system: buildSystemBlocks(systemPrompt, dynamicContext),
        tools: withCachedTools((messageParams.tools ?? []) as Tool[]),
        model,
      });
      const usage: TurnUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      };
      console.log(
        `[cache-usage] model=${model} creation=${usage.cacheCreationInputTokens} read=${usage.cacheReadInputTokens} input=${usage.inputTokens} output=${usage.outputTokens}`,
      );
      return { response, model, usage };
    } catch (error) {
      lastError = error;
      if (!isRetryableModelError(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("No available Anthropic model could be used.");
}

function isRetryableModelError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as {
    status?: number;
    error?: { error?: { type?: string } };
    type?: string;
  };

  // 404 = model not found; 529 = API overloaded — both warrant trying the next candidate
  return (
    maybeError.status === 404 ||
    maybeError.status === 529 ||
    maybeError.error?.error?.type === "not_found_error" ||
    maybeError.type === "not_found_error" ||
    maybeError.error?.error?.type === "overloaded_error" ||
    maybeError.type === "overloaded_error"
  );
}

function extractText(content: ContentBlock[]): string {
  const textBlocks = content
    .filter((block) => block.type === "text")
    .map((block) => block.text);

  if (textBlocks.length > 0) {
    return textBlocks.join("\n").trim();
  }

  return "";
}
