import { normalizeContent } from "./keywords";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const MAX_BATCH_SIZE = 100;

async function callEmbeddingsApi(inputs: string[]): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: inputs }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`OpenAI embeddings API error ${response.status}: ${body}`);
  }

  const json = (await response.json()) as {
    data: Array<{ index: number; embedding: number[] }>;
  };

  // Sort by index to ensure order matches input array
  return json.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      const isRateLimit =
        err instanceof Error && err.message.includes("429");
      if (!isRateLimit || attempt === maxAttempts) throw err;
      await new Promise((resolve) =>
        setTimeout(resolve, Math.pow(2, attempt) * 500),
      );
    }
  }
  throw lastError;
}

// Embed a single text. Returns empty array if content is too short.
export async function embedText(text: string): Promise<number[]> {
  const normalized = normalizeContent(text);
  if (normalized.length < 3) return [];

  const results = await withRetry(() => callEmbeddingsApi([normalized]));
  return results[0] ?? [];
}

// Embed multiple texts in batches of MAX_BATCH_SIZE.
export async function embedTexts(texts: string[]): Promise<number[][]> {
  const normalized = texts.map(normalizeContent);
  const results: number[][] = new Array(normalized.length).fill([]);

  for (let i = 0; i < normalized.length; i += MAX_BATCH_SIZE) {
    const batchTexts = normalized.slice(i, i + MAX_BATCH_SIZE);
    const validIndices: number[] = [];
    const validTexts: string[] = [];

    batchTexts.forEach((t, j) => {
      if (t.length >= 3) {
        validIndices.push(i + j);
        validTexts.push(t);
      }
    });

    if (validTexts.length === 0) continue;

    const batchResults = await withRetry(() => callEmbeddingsApi(validTexts));
    validIndices.forEach((originalIdx, batchIdx) => {
      results[originalIdx] = batchResults[batchIdx] ?? [];
    });
  }

  return results;
}

export { EMBEDDING_DIMENSIONS };
