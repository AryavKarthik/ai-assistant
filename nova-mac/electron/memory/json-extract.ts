// Claude/Haiku frequently wraps a "reply with JSON only" response in a
// markdown code fence (```json ... ```) despite being told not to — a bare
// JSON.parse on the raw text throws on that wrapper, and every caller here
// was catching the error and silently falling back to a generic default
// (classify.ts: {type: "fact", confidence: 0.5}; llm-merge.ts: null → forced
// merge) — meaning the LLM-backed path was failing far more often than a
// genuine API/timeout error would explain. Strip the fence before parsing.
export function extractJsonPayload(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : text).trim();
}
