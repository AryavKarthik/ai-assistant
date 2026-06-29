const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

export interface BraveSearchResult {
  title: string;
  url: string;
  description: string;
}

export async function braveWebSearch(
  query: string,
  count = 5,
): Promise<{ results: BraveSearchResult[]; error?: string }> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    return {
      results: [],
      error: "Web search is not configured. Add BRAVE_SEARCH_API_KEY to enable it.",
    };
  }

  const url = new URL(BRAVE_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.min(count, 10)));

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      headers: {
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "X-Subscription-Token": apiKey,
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Network error";
    return { results: [], error: `Search request failed: ${msg}` };
  }

  if (!response.ok) {
    return { results: [], error: `Brave Search API returned ${response.status}` };
  }

  let data: {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
  };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    return { results: [], error: "Failed to parse search API response" };
  }

  const results = (data.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
  }));

  return { results };
}
