// Detects when the user explicitly asks to use a specific model.

export interface ModelRequest {
  model: string;
  /** Keep using this model on future turns until reset. */
  persist: boolean;
}

const MODEL_ALIASES: Record<string, string> = {
  haiku: "claude-haiku-4-5",
  "haiku 4.5": "claude-haiku-4-5",
  "haiku 4-5": "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-5",
  "sonnet 4.5": "claude-sonnet-4-5",
  "sonnet 4-5": "claude-sonnet-4-5",
};

const RESET_PATTERN =
  /\b(use auto|auto routing|automatic routing|reset model|default model)\b/i;

const PERSIST_PATTERN =
  /\b(from now on|always|going forward|for the rest|for all future)\b/i;

const REQUEST_PATTERN =
  /\b(use|switch to|change to|respond with|answer with)\b/i;

export function parseModelRequest(message: string): ModelRequest | "reset" | null {
  const trimmed = message.trim();
  if (!trimmed) return null;

  if (RESET_PATTERN.test(trimmed)) {
    return "reset";
  }

  if (!REQUEST_PATTERN.test(trimmed)) {
    return null;
  }

  const slugMatch = trimmed.match(/\b(claude-[a-z0-9-]+)\b/i);
  if (slugMatch) {
    return {
      model: slugMatch[1].toLowerCase(),
      persist: PERSIST_PATTERN.test(trimmed),
    };
  }

  const aliasMatch = trimmed.match(
    /\b(haiku(?:\s*4[.-]?5)?|sonnet(?:\s*4[.-]?5)?)\b/i,
  );
  if (aliasMatch) {
    const key = aliasMatch[1].toLowerCase().replace(/\s+/g, " ");
    const model =
      MODEL_ALIASES[key] ??
      MODEL_ALIASES[key.replace(/4[.-]?5/, " 4.5")] ??
      MODEL_ALIASES[key.split(/\s/)[0]];

    if (model) {
      return {
        model,
        persist: PERSIST_PATTERN.test(trimmed),
      };
    }
  }

  return null;
}
