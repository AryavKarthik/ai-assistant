import Anthropic from "@anthropic-ai/sdk";

// Singleton Anthropic client — used by the chat turn orchestrator.
let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("Missing ANTHROPIC_API_KEY in environment variables");
    }
    client = new Anthropic({ apiKey });
  }
  return client;
}

const HAIKU_FALLBACK_MODELS = [
  "claude-haiku-4-5",
  "claude-3-5-haiku-latest",
];

const SONNET_FALLBACK_MODELS = [
  "claude-sonnet-4-5",
  "claude-sonnet-4-0",
  "claude-3-5-sonnet-latest",
];

export type ModelComplexity = "light" | "medium" | "heavy";

export const DEFAULT_HAIKU_MODEL = "claude-haiku-4-5";

function getConfiguredModel(complexity: ModelComplexity): string | undefined {
  if (complexity === "heavy") {
    return process.env.ANTHROPIC_MODEL_HEAVY?.trim();
  }
  return (
    process.env.ANTHROPIC_MODEL_LIGHT?.trim() ??
    process.env.ANTHROPIC_MODEL_MEDIUM?.trim()
  );
}

// Returns candidate models in priority order for a complexity tier.
// light/medium → Haiku only; heavy → Sonnet.
export function getCandidateModels(complexity: ModelComplexity): string[] {
  const tierModel = getConfiguredModel(complexity);
  const defaultChain =
    complexity === "heavy" ? SONNET_FALLBACK_MODELS : HAIKU_FALLBACK_MODELS;

  // Global override only applies to heavy tier so auto-routing stays on Haiku.
  const globalModel =
    complexity === "heavy" ? process.env.ANTHROPIC_MODEL?.trim() : undefined;

  return Array.from(
    new Set([tierModel, globalModel, ...defaultChain].filter(Boolean)),
  ) as string[];
}

// User-requested model first, then tier fallbacks if unavailable.
export function getCandidateModelsWithOverride(
  complexity: ModelComplexity,
  explicitModel?: string | null,
): string[] {
  if (!explicitModel) {
    return getCandidateModels(complexity);
  }

  return Array.from(
    new Set([explicitModel, ...getCandidateModels(complexity)]),
  );
}
