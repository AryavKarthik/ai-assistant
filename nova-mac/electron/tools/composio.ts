/**
 * Composio tool bridge — exposes the user's Composio-connected apps
 * (Google Docs, Notion, Slack, ...) to Claude as two meta-tools:
 *
 *   composio_search_tools — find available actions for a task/app
 *   composio_execute      — execute one action by slug with arguments
 *
 * Requires COMPOSIO_API_KEY in .env.local (see README "Composio" section).
 * Optional COMPOSIO_USER_ID selects the Composio user/entity the connected
 * accounts live under (defaults to "default", which is where accounts land
 * when connected through the Composio dashboard).
 */

const BASE_URL = "https://backend.composio.dev/api/v3";

function apiKey(): string {
  const key = process.env.COMPOSIO_API_KEY?.trim();
  if (!key) {
    throw new Error(
      "Composio is not configured. Add COMPOSIO_API_KEY to .env.local and restart Nova.",
    );
  }
  return key;
}

function composioUserId(): string {
  return process.env.COMPOSIO_USER_ID?.trim() || "default";
}

export function composioConfigured(): boolean {
  return Boolean(process.env.COMPOSIO_API_KEY?.trim());
}

async function composioFetch(
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "x-api-key": apiKey(),
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message =
      (typeof body.message === "string" && body.message) ||
      (typeof body.error === "string" && body.error) ||
      `Composio request failed (${res.status})`;
    throw new Error(message);
  }
  return body;
}

interface ComposioToolSummary {
  slug: string;
  name: string;
  description: string;
  toolkit: string;
  input_parameters?: unknown;
}

function summarizeTool(raw: Record<string, unknown>): ComposioToolSummary {
  const toolkit = raw.toolkit as Record<string, unknown> | undefined;
  return {
    slug: String(raw.slug ?? raw.name ?? ""),
    name: String(raw.name ?? raw.slug ?? ""),
    description: String(raw.description ?? "").slice(0, 300),
    toolkit: String(toolkit?.slug ?? toolkit?.name ?? ""),
    input_parameters: raw.input_parameters,
  };
}

export async function handleComposioSearchTools(
  input: unknown,
): Promise<Record<string, unknown>> {
  const { query, toolkit, limit, include_schemas } = input as {
    query?: string;
    toolkit?: string;
    limit?: number;
    include_schemas?: boolean;
  };
  const params = new URLSearchParams();
  if (query?.trim()) params.set("search", query.trim());
  if (toolkit?.trim()) params.set("toolkit_slug", toolkit.trim().toLowerCase());
  params.set("limit", String(Math.min(Math.max(limit ?? 10, 1), 25)));

  const body = (await composioFetch(`/tools?${params.toString()}`)) as {
    items?: Array<Record<string, unknown>>;
  };
  const items = (body.items ?? []).map(summarizeTool);
  // Schemas are large; strip them unless explicitly requested so the search
  // round stays cheap — composio_execute errors report missing arguments.
  if (!include_schemas) {
    for (const item of items) delete item.input_parameters;
  }
  return { tools: items, count: items.length };
}

export async function handleComposioExecute(
  input: unknown,
): Promise<Record<string, unknown>> {
  const { tool_slug, arguments: args } = input as {
    tool_slug?: string;
    arguments?: Record<string, unknown>;
  };
  if (!tool_slug?.trim()) return { error: "tool_slug is required" };

  const body = (await composioFetch(
    `/tools/execute/${encodeURIComponent(tool_slug.trim().toUpperCase())}`,
    {
      method: "POST",
      body: JSON.stringify({
        user_id: composioUserId(),
        arguments: args ?? {},
      }),
    },
  )) as Record<string, unknown>;

  const successful = body.successful !== false;
  if (!successful) {
    return {
      error: String(body.error ?? "Composio action failed"),
      data: body.data ?? null,
    };
  }
  // Cap the payload — some actions (document reads) return very large bodies.
  const data = JSON.stringify(body.data ?? body);
  return {
    success: true,
    data: data.length > 6000 ? `${data.slice(0, 6000)}… (truncated)` : data,
  };
}
