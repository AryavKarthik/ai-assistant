import type { CacheControlEphemeral, TextBlockParam, Tool } from "@anthropic-ai/sdk/resources/messages";

const CACHE: CacheControlEphemeral = { type: "ephemeral" };

/**
 * Build the system param as an array of blocks so Anthropic can cache the
 * static prompt separately from per-turn dynamic context (clock, model name).
 *
 * Block 0 — static system prompt         → cached (TTL 5 min)
 * Block 1 — runtime context (optional)   → not cached (changes every turn)
 */
export function buildSystemBlocks(
  staticPrompt: string,
  dynamicContext: string,
): TextBlockParam[] {
  const blocks: TextBlockParam[] = [
    { type: "text", text: staticPrompt, cache_control: CACHE },
  ];
  if (dynamicContext.trim()) {
    blocks.push({ type: "text", text: dynamicContext });
  }
  return blocks;
}

/**
 * Mark the last tool with cache_control so Anthropic caches all tool
 * definitions up to that point. Tool schemas never change between turns.
 */
export function withCachedTools(tools: Tool[]): Tool[] {
  if (tools.length === 0) return tools;
  return tools.map((tool, i) =>
    i === tools.length - 1 ? { ...tool, cache_control: CACHE } : tool,
  );
}
