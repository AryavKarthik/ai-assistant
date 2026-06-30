const GOOGLE_ENDPOINT = "https://www.googleapis.com/customsearch/v1";

export interface WebSearchResult {
  title: string;
  url: string;
  description: string;
}

export async function googleWebSearch(
  query: string,
  count = 5,
): Promise<{ results: WebSearchResult[]; error?: string }> {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const engineId = process.env.GOOGLE_SEARCH_ENGINE_ID;
  if (!apiKey || !engineId) {
    return {
      results: [],
      error: "Web search is not configured. Add GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_ENGINE_ID to enable it.",
    };
  }

  const url = new URL(GOOGLE_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", engineId);
  url.searchParams.set("q", query);
  url.searchParams.set("num", String(Math.min(count, 10)));

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { results: [], error: `Search request failed: ${msg}` };
  }

  if (!response.ok) {
    return { results: [], error: `Google Custom Search API returned ${response.status}` };
  }

  let data: {
    items?: Array<{ title?: string; link?: string; snippet?: string }>;
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    return { results: [], error: "Failed to parse search API response" };
  }

  const results = (data.items ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.link ?? "",
    description: r.snippet ?? "",
  }));

  return { results };
}
