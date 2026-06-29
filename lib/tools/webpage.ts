const MAX_CONTENT_CHARS = 3000;

function extractTitle(html: string): string {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match ? match[1].trim().replace(/\s+/g, " ") : "";
}

function htmlToText(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<\/?(p|div|h[1-6]|li|tr|br|section|article|header|footer)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function fetchWebpage(url: string): Promise<{
  url: string;
  title: string;
  content: string;
  truncated: boolean;
  error?: string;
}> {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { url, title: "", content: "", truncated: false, error: "Only http/https URLs are supported" };
    }
  } catch {
    return { url, title: "", content: "", truncated: false, error: "Invalid URL" };
  }

  let response: Response;
  try {
    response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; Nova-AI-Assistant/1.0; +https://nova.ai)",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Fetch failed";
    return { url, title: "", content: "", truncated: false, error: msg };
  }

  if (!response.ok) {
    return { url, title: "", content: "", truncated: false, error: `HTTP ${response.status}` };
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
    return {
      url,
      title: "",
      content: "",
      truncated: false,
      error: `Cannot read this page type (${contentType.split(";")[0]})`,
    };
  }

  const html = await response.text();
  const title = extractTitle(html);
  const raw = htmlToText(html);
  const truncated = raw.length > MAX_CONTENT_CHARS;
  const content = truncated ? raw.slice(0, MAX_CONTENT_CHARS) + "…" : raw;

  return { url, title, content, truncated };
}
