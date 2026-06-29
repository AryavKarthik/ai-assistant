const MAX_CONTENT_CHARS = 3000;

function isPrivateIp(hostname: string): boolean {
  // Block loopback
  if (hostname === "localhost" || hostname === "::1") return true;
  // Match IPv4
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(hostname);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    return (
      a === 10 ||                           // 10.0.0.0/8
      a === 127 ||                          // 127.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12
      (a === 192 && b === 168) ||           // 192.168.0.0/16
      (a === 169 && b === 254)              // 169.254.0.0/16
    );
  }
  return false;
}

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
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { url, title: "", content: "", truncated: false, error: "Invalid URL" };
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { url, title: "", content: "", truncated: false, error: "Only http/https URLs are supported" };
  }
  if (isPrivateIp(parsed.hostname)) {
    return { url, title: "", content: "", truncated: false, error: "Private/internal URLs are not allowed" };
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

  let html: string;
  try {
    html = await response.text();
  } catch {
    return { url, title: "", content: "", truncated: false, error: "Failed to read response body" };
  }
  const title = extractTitle(html);
  const raw = htmlToText(html);
  const truncated = raw.length > MAX_CONTENT_CHARS;
  const content = truncated ? raw.slice(0, MAX_CONTENT_CHARS) + "…" : raw;

  return { url, title, content, truncated };
}
