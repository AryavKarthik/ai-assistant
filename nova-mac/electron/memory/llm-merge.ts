import { extractJsonPayload } from "./json-extract";

// Replaces blind string-picking (mergeMemoryContent) for ambiguous reconciliation
// matches (subject_key / overlap / semantic) with an actual judgment call: are
// these two statements the same real-world fact, and if so what's the single
// consolidated version? merge.ts remains the fallback when this call fails or
// is unavailable — never a hard dependency.

export interface LLMMergeResult {
  sameFact: boolean;
  mergedContent: string;
}

export async function reconcileWithLLM(
  existing: string,
  incoming: string,
): Promise<LLMMergeResult | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;

  const model =
    process.env.ANTHROPIC_MODEL_LIGHT?.trim() || "claude-haiku-4-5-20251001";

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        messages: [
          {
            role: "user",
            content: `Two candidate memory statements about the same user. Decide whether they describe the same real-world fact/topic (even if worded very differently), or genuinely different facts.

If SAME topic: write ONE consolidated third-person sentence keeping every still-true, non-conflicting detail from both. Where they actually conflict (e.g. old city vs new city), the "Incoming" statement wins for the conflicting detail — but keep any other detail from "Existing" that "Incoming" doesn't contradict.
If DIFFERENT facts (not the same topic at all): set same_fact to false; merged_content can just repeat the incoming statement.

Existing: "${existing}"
Incoming: "${incoming}"

Reply with JSON only, no explanation: {"same_fact": <bool>, "merged_content": "<string>"}`,
          },
        ],
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const json = (await response.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    const text = json.content[0]?.text?.trim() ?? "";
    const parsed = JSON.parse(extractJsonPayload(text)) as {
      same_fact?: boolean;
      merged_content?: string;
    };

    if (typeof parsed.same_fact !== "boolean" || !parsed.merged_content?.trim()) {
      return null;
    }

    return {
      sameFact: parsed.same_fact,
      mergedContent: parsed.merged_content.trim(),
    };
  } catch {
    return null;
  }
}
