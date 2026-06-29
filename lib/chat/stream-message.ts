import type Anthropic from "@anthropic-ai/sdk";
import type {
  Message,
  MessageCreateParamsNonStreaming,
  Tool,
} from "@anthropic-ai/sdk/resources/messages";
import {
  getCandidateModelsWithOverride,
  type ModelComplexity,
} from "@/lib/anthropic/client";
import { buildSystemBlocks, withCachedTools } from "@/lib/chat/prompt-cache";
import type { TurnUsage } from "@/lib/chat/types";

export interface StreamMessageOptions {
  onTextDelta?: (delta: string) => void;
  emitDeltas?: boolean;
}

function isModelNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybeError = error as {
    status?: number;
    error?: { error?: { type?: string } };
    type?: string;
  };

  return (
    maybeError.status === 404 ||
    maybeError.error?.error?.type === "not_found_error" ||
    maybeError.type === "not_found_error"
  );
}

export async function streamMessageWithFallback(
  anthropic: Anthropic,
  params: Omit<MessageCreateParamsNonStreaming, "model" | "system"> & {
    complexity: ModelComplexity;
    explicitModel?: string | null;
    includeRuntimeContext?: boolean;
    systemPrompt: string;
    runtimeContext?: string;
  },
  options: StreamMessageOptions = {},
): Promise<{ response: Message; model: string; usage: TurnUsage }> {
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

      const stream = anthropic.messages.stream({
        ...messageParams,
        system: buildSystemBlocks(systemPrompt, dynamicContext),
        tools: withCachedTools((messageParams.tools ?? []) as Tool[]),
        model,
      });

      if (options.emitDeltas && options.onTextDelta) {
        stream.on("text", (delta) => {
          options.onTextDelta?.(delta);
        });
      }

      const response = await stream.finalMessage();
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
      if (!isModelNotFound(error)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("No available Anthropic model could be used.");
}
