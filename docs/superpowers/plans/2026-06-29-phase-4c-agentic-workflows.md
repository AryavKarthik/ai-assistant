# Phase 4C — Agentic Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Claude to decompose multi-step requests into a structured plan the user reviews and approves before execution — with web search, webpage reading, and per-step progress receipts.

**Architecture:** When Claude detects a request requiring 2+ coordinated write actions, it first uses existing tools to discover needed information (e.g., look up a calendar event ID), then calls `plan_workflow` to save a structured plan to the DB and surface a `WorkflowCard` in chat. The user reviews all steps and taps Approve. The browser then streams execution progress from `/api/workflow/[id]/execute`, updating step statuses in real-time. Read steps run automatically; irreversible writes (e.g., Gmail send) still require a per-receipt tap after execution.

**Tech Stack:** Brave Search API (web_search), native `fetch` (fetch_webpage + web calls), Supabase (workflow_runs + workflow_steps tables), Next.js App Router SSE streaming, React (WorkflowCard component)

## Global Constraints

- Never skip the Next.js guide in `node_modules/next/dist/docs/` before writing route handlers — follow existing route patterns in `app/api/chat/route.ts`
- All DB operations use `createServerClient()` from `@/lib/supabase/server` (not browser client)
- All new API routes use `withAuth` from `@/lib/auth/api` — no route may skip auth
- RLS must be enabled on every new table; users may only access their own rows
- MAX_TOOL_ITERATIONS raised to 10 (non-voice), stays 3 for voice turns
- `plan_workflow` is ONLY called for 2+ write actions or complex multi-tool chains — simple single-tool requests still execute directly
- Write actions in workflow plans (create event, create reminder, create draft) are approved by the upfront plan approval; irreversible actions (Gmail send) still require the existing per-receipt confirm button after the step executes
- `BRAVE_SEARCH_API_KEY` must be documented in README and `.env.local` — tool degrades gracefully when missing (returns clear error message)
- All SSE streams follow the existing pattern in `lib/chat/stream-events.ts` and `app/api/chat/route.ts`
- No new npm packages for HTML parsing — use regex-based stripping in `lib/tools/webpage.ts`

---

## File Map

**New files:**
- `supabase/migrations/016_workflow_runs.sql` — workflow_runs + workflow_steps tables with RLS
- `lib/db/workflows.ts` — DB helpers: createWorkflowRun, getWorkflowRun, updateWorkflowStatus, updateStepStatus
- `lib/tools/web-search.ts` — Brave Search API client
- `lib/tools/webpage.ts` — server-side URL fetch + HTML→text extractor
- `app/api/workflow/[id]/execute/route.ts` — POST: approve + execute workflow, streams SSE events
- `app/api/workflow/[id]/route.ts` — GET: fetch workflow state (for resume after refresh)
- `app/api/workflow/[id]/cancel/route.ts` — POST: cancel a pending workflow
- `components/chat/WorkflowCard.tsx` — plan-preview + execution-progress in one component

**Modified files:**
- `lib/chat/types.ts` — extend `ChatActionConfirm` to discriminated union; add `WorkflowStepPreview`; add `conversationId` to `ToolContext`
- `lib/tools/definitions.ts` — add `web_search`, `fetch_webpage`, `plan_workflow` tool schemas
- `lib/tools/handlers.ts` — add `handleWebSearch`, `handleFetchWebpage`, `handlePlanWorkflow`; add `conversationId` to `ToolContext`
- `lib/chat/receipts.ts` — add receipt builders for `web_search`, `fetch_webpage`, `plan_workflow`
- `lib/chat/run-turn.ts` — raise `MAX_TOOL_ITERATIONS` to 10; pass `conversationId` into `executeTool`
- `lib/chat/system-prompt.ts` — add `WORKFLOW_PROMPT` block with routing rules for plan_workflow + web tools
- `components/ui/primitives.tsx` — add `approve_workflow` case to `ActionReceiptRow` (renders WorkflowCard inline)
- `components/chat/ChatScreen.tsx` — handle `approve_workflow` confirm type; wire `handleApproveWorkflow` callback
- `README.md` — document `BRAVE_SEARCH_API_KEY`, workflow_runs migration 016

---

### Task 1: Database migration for workflow_runs and workflow_steps

**Files:**
- Create: `supabase/migrations/016_workflow_runs.sql`

**Interfaces:**
- Produces: `workflow_runs` table (id, user_id, conversation_id, title, description, status), `workflow_steps` table (id, workflow_run_id, step_index, tool_name, args, description, risk_level, status, result, error)

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/016_workflow_runs.sql` with this exact content:

```sql
-- Phase 4C: Agentic workflow persistence
-- workflow_runs: top-level workflow state (plan → approved → running → completed/failed/cancelled)
CREATE TABLE workflow_runs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  -- valid statuses: pending | approved | running | completed | failed | cancelled
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- workflow_steps: one row per planned tool call
CREATE TABLE workflow_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_run_id UUID NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
  step_index INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  args JSONB NOT NULL DEFAULT '{}',
  description TEXT NOT NULL,
  risk_level TEXT NOT NULL DEFAULT 'read',
  -- valid risk levels: read | write | irreversible
  status TEXT NOT NULL DEFAULT 'pending',
  -- valid statuses: pending | running | completed | failed | skipped
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_run_id, step_index)
);

-- Enable Row Level Security
ALTER TABLE workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_steps ENABLE ROW LEVEL SECURITY;

-- Users can only access their own workflow_runs
CREATE POLICY "users_own_workflow_runs"
  ON workflow_runs
  FOR ALL
  USING (auth.uid() = user_id);

-- Users can access steps only if they own the parent run
CREATE POLICY "users_own_workflow_steps"
  ON workflow_steps
  FOR ALL
  USING (
    workflow_run_id IN (
      SELECT id FROM workflow_runs WHERE user_id = auth.uid()
    )
  );

-- Indexes for fast query patterns
CREATE INDEX idx_workflow_runs_user_status
  ON workflow_runs (user_id, status, created_at DESC);
CREATE INDEX idx_workflow_runs_conversation
  ON workflow_runs (conversation_id);
CREATE INDEX idx_workflow_steps_run
  ON workflow_steps (workflow_run_id, step_index);
```

- [ ] **Step 2: Apply the migration**

Option A (automated): `npm run db:migrate`
Option B (manual): paste the SQL into the Supabase SQL editor and run it.

Expected: no errors; both tables appear in Supabase table view.

- [ ] **Step 3: Verify RLS is active**

In Supabase Dashboard → Table Editor → `workflow_runs` → RLS tab: confirm the policy "users_own_workflow_runs" is listed.
In `workflow_steps` → RLS tab: confirm "users_own_workflow_steps" is listed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/016_workflow_runs.sql
git commit -m "feat: add workflow_runs and workflow_steps migrations for Phase 4C"
```

---

### Task 2: DB helpers for workflow CRUD

**Files:**
- Create: `lib/db/workflows.ts`

**Interfaces:**
- Produces:
  - `createWorkflowRun(params): Promise<WorkflowRunRow>`
  - `getWorkflowRun(id: string): Promise<WorkflowRunRow | null>`
  - `getWorkflowWithSteps(id: string): Promise<WorkflowRunRow & { steps: WorkflowStepRow[] } | null>`
  - `updateWorkflowStatus(id: string, status: WorkflowRunRow["status"]): Promise<void>`
  - `updateStepStatus(stepId: string, status, result?, error?): Promise<void>`
  - Types: `WorkflowRunRow`, `WorkflowStepRow`

- [ ] **Step 1: Create `lib/db/workflows.ts`**

```typescript
import { createServerClient } from "@/lib/supabase/server";

export type WorkflowStatus =
  | "pending"
  | "approved"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type StepStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export type RiskLevel = "read" | "write" | "irreversible";

export interface WorkflowStepRow {
  id: string;
  workflow_run_id: string;
  step_index: number;
  tool_name: string;
  args: Record<string, unknown>;
  description: string;
  risk_level: RiskLevel;
  status: StepStatus;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkflowRunRow {
  id: string;
  user_id: string;
  conversation_id: string;
  title: string;
  description: string;
  status: WorkflowStatus;
  created_at: string;
  updated_at: string;
}

export async function createWorkflowRun(params: {
  userId: string;
  conversationId: string;
  title: string;
  description: string;
  steps: Array<{
    stepIndex: number;
    toolName: string;
    args: Record<string, unknown>;
    description: string;
    riskLevel: RiskLevel;
  }>;
}): Promise<WorkflowRunRow> {
  const supabase = createServerClient();

  const { data: run, error: runError } = await supabase
    .from("workflow_runs")
    .insert({
      user_id: params.userId,
      conversation_id: params.conversationId,
      title: params.title,
      description: params.description,
      status: "pending",
    })
    .select()
    .single<WorkflowRunRow>();

  if (runError || !run) throw runError ?? new Error("Failed to create workflow run");

  const stepRows = params.steps.map((s) => ({
    workflow_run_id: run.id,
    step_index: s.stepIndex,
    tool_name: s.toolName,
    args: s.args,
    description: s.description,
    risk_level: s.riskLevel,
    status: "pending",
  }));

  const { error: stepsError } = await supabase
    .from("workflow_steps")
    .insert(stepRows);

  if (stepsError) throw stepsError;

  return run;
}

export async function getWorkflowWithSteps(
  id: string,
): Promise<(WorkflowRunRow & { steps: WorkflowStepRow[] }) | null> {
  const supabase = createServerClient();

  const { data: run, error: runError } = await supabase
    .from("workflow_runs")
    .select("*")
    .eq("id", id)
    .single<WorkflowRunRow>();

  if (runError) return null;
  if (!run) return null;

  const { data: steps, error: stepsError } = await supabase
    .from("workflow_steps")
    .select("*")
    .eq("workflow_run_id", id)
    .order("step_index", { ascending: true });

  if (stepsError) throw stepsError;

  return { ...run, steps: (steps ?? []) as WorkflowStepRow[] };
}

export async function updateWorkflowStatus(
  id: string,
  status: WorkflowStatus,
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("workflow_runs")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function updateStepStatus(
  stepId: string,
  status: StepStatus,
  result?: Record<string, unknown> | null,
  errorMsg?: string | null,
): Promise<void> {
  const supabase = createServerClient();
  const { error } = await supabase
    .from("workflow_steps")
    .update({
      status,
      result: result ?? null,
      error: errorMsg ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", stepId);
  if (error) throw error;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error|warning" | head -20
```

Expected: no TypeScript errors in `lib/db/workflows.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/db/workflows.ts
git commit -m "feat: add workflow DB helpers (createWorkflowRun, updateStepStatus, etc.)"
```

---

### Task 3: Web search and webpage tools

**Files:**
- Create: `lib/tools/web-search.ts`
- Create: `lib/tools/webpage.ts`

**Interfaces:**
- Produces:
  - `braveWebSearch(query: string, count?: number): Promise<{ results: BraveSearchResult[]; error?: string }>`
  - `fetchWebpage(url: string): Promise<{ url: string; title: string; content: string; truncated: boolean; error?: string }>`
- Consumes: `BRAVE_SEARCH_API_KEY` env var

- [ ] **Step 1: Create `lib/tools/web-search.ts`**

```typescript
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

  const data = (await response.json()) as {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
  };

  const results = (data.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    description: r.description ?? "",
  }));

  return { results };
}
```

- [ ] **Step 2: Create `lib/tools/webpage.ts`**

```typescript
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
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep -E "error" | head -20
```

Expected: no errors in the new files.

- [ ] **Step 4: Commit**

```bash
git add lib/tools/web-search.ts lib/tools/webpage.ts
git commit -m "feat: add braveWebSearch and fetchWebpage tool helpers"
```

---

### Task 4: Extend types, add tool schemas and handlers for web + workflow tools

**Files:**
- Modify: `lib/chat/types.ts`
- Modify: `lib/tools/definitions.ts`
- Modify: `lib/tools/handlers.ts`
- Modify: `lib/chat/receipts.ts`
- Modify: `lib/chat/run-turn.ts` (ToolContext extension only — MAX_TOOL_ITERATIONS comes in Task 7)

**Interfaces:**
- Produces (types):
  - `WorkflowStepPreview { index: number; description: string; toolName: string; riskLevel: "read"|"write"|"irreversible" }`
  - `ChatActionConfirm` converted to discriminated union with `send_gmail_draft | approve_workflow | open_browser_tab`
- Consumes: `lib/db/workflows.ts:createWorkflowRun`

- [ ] **Step 1: Extend `lib/chat/types.ts`**

Replace the `ChatActionConfirm` interface and add `WorkflowStepPreview`:

Find and replace in `lib/chat/types.ts`:

```typescript
// OLD — replace this block:
export interface ChatActionConfirm {
  type: "send_gmail_draft";
  draftId: string;
  to: string;
  subject: string;
  preview?: string;
}
```

With:

```typescript
export interface WorkflowStepPreview {
  index: number;
  description: string;
  toolName: string;
  riskLevel: "read" | "write" | "irreversible";
}

export type ChatActionConfirm =
  | {
      type: "send_gmail_draft";
      draftId: string;
      to: string;
      subject: string;
      preview?: string;
    }
  | {
      type: "approve_workflow";
      workflowId: string;
      title: string;
      steps: WorkflowStepPreview[];
    }
  | {
      type: "open_browser_tab";
      url: string;
      title?: string;
    };
```

Also add `conversationId` to `ToolContext`. Open `lib/tools/handlers.ts`, find:

```typescript
export interface ToolContext {
  userId: string;
  sourceMessageId: string;
  userMessage?: string;
}
```

Replace with:

```typescript
export interface ToolContext {
  userId: string;
  conversationId: string;
  sourceMessageId: string;
  userMessage?: string;
}
```

- [ ] **Step 2: Fix TypeScript errors from ChatActionConfirm change**

Run:

```bash
npm run build 2>&1 | grep "error" | head -30
```

The only expected error is in `components/chat/ChatScreen.tsx` where it checks `receipt.confirm?.type !== "send_gmail_draft"`. Fix by changing that guard:

In `components/chat/ChatScreen.tsx`, find:

```typescript
if (receipt?.confirm?.type !== "send_gmail_draft") return;
```

Replace with:

```typescript
if (receipt?.confirm?.type !== "send_gmail_draft" && receipt?.confirm?.type !== "approve_workflow") return;
```

Wait — that line is inside `handleConfirmReceipt`. The `approve_workflow` confirm is handled separately (it starts execution streaming). So keep the guard as-is for `send_gmail_draft`. The `approve_workflow` path will be a new `handleApproveWorkflow` added in Task 9. For now just verify the type errors are localized.

- [ ] **Step 3: Add tool schemas to `lib/tools/definitions.ts`**

Append these three tool definitions to the `TOOL_DEFINITIONS` array at the end of `lib/tools/definitions.ts`:

```typescript
  {
    name: "web_search",
    description:
      "Search the web for current information, facts, news, or any topic the user asks about. Use when the answer requires real-time or external information not in memory. Returns titles, URLs, and descriptions. If the user asks to open a specific result, call fetch_webpage or open_browser_tab next.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query — be specific and include relevant context",
        },
        count: {
          type: "integer",
          description: "Number of results to return (1–10, default 5)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fetch_webpage",
    description:
      "Fetch and read the text content of a specific URL. Use after web_search to read a result in detail, or when the user provides a link they want summarized. Returns cleaned page text (up to 3000 chars). An 'Open' button will appear in chat for the user to view the page.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full URL to fetch (must start with http:// or https://)",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "plan_workflow",
    description:
      "Create a structured multi-step workflow plan when the user asks for 2 or more coordinated WRITE actions across different tools (e.g., reschedule meeting + email someone + create reminder). Call this AFTER any necessary read/discovery steps (e.g., finding the event ID first). Do NOT use for single-tool actions — call the tool directly. Do NOT use for read-only workflows. The plan will be shown to the user for review before any step executes.",
    input_schema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Short title for the workflow (max 60 chars), e.g. 'Reschedule and notify'",
        },
        description: {
          type: "string",
          description: "One sentence summary of what this workflow does",
        },
        steps: {
          type: "array",
          description: "Ordered steps. Include full resolved args — all event IDs, email addresses, etc. must be known before calling plan_workflow.",
          items: {
            type: "object",
            properties: {
              tool: {
                type: "string",
                description: "Exact tool name from TOOL_DEFINITIONS (e.g. update_calendar_event, create_gmail_draft, create_reminder)",
              },
              args: {
                type: "object",
                description: "Complete arguments for the tool — same format as calling the tool directly",
              },
              description: {
                type: "string",
                description: "Human-readable description shown to the user (e.g. 'Move 3pm meeting to 4pm')",
              },
              risk_level: {
                type: "string",
                enum: ["read", "write", "irreversible"],
                description: "read: safe, no side effects. write: creates/modifies data (reversible). irreversible: cannot be undone (sending email).",
              },
            },
            required: ["tool", "args", "description", "risk_level"],
          },
          minItems: 2,
        },
      },
      required: ["title", "description", "steps"],
    },
  },
```

- [ ] **Step 4: Add handlers to `lib/tools/handlers.ts`**

At the top of `lib/tools/handlers.ts`, add these imports:

```typescript
import { braveWebSearch } from "@/lib/tools/web-search";
import { fetchWebpage } from "@/lib/tools/webpage";
import { createWorkflowRun } from "@/lib/db/workflows";
```

Inside the `executeTool` switch block (before the `default` case), add three new cases. Find the last `case` statement (e.g., `case "recommend_youtube":`) and add after it:

```typescript
        case "web_search":
          return handleWebSearch(inp);
        case "fetch_webpage":
          return handleFetchWebpage(inp);
        case "plan_workflow":
          return handlePlanWorkflow(inp, context);
```

Then add the three handler functions at the bottom of the file (before the end):

```typescript
async function handleWebSearch(
  input: unknown,
): Promise<Record<string, unknown>> {
  const inp = input as { query: string; count?: number };
  if (!inp.query?.trim()) {
    return { error: "query is required" };
  }
  const { results, error } = await braveWebSearch(inp.query.trim(), inp.count ?? 5);
  if (error) return { error };
  return { results, count: results.length };
}

async function handleFetchWebpage(
  input: unknown,
): Promise<Record<string, unknown>> {
  const inp = input as { url: string };
  if (!inp.url?.trim()) {
    return { error: "url is required" };
  }
  const result = await fetchWebpage(inp.url.trim());
  return result as Record<string, unknown>;
}

async function handlePlanWorkflow(
  input: unknown,
  context: ToolContext,
): Promise<Record<string, unknown>> {
  const inp = input as {
    title: string;
    description: string;
    steps: Array<{
      tool: string;
      args: Record<string, unknown>;
      description: string;
      risk_level: "read" | "write" | "irreversible";
    }>;
  };

  if (!inp.title?.trim() || !Array.isArray(inp.steps) || inp.steps.length < 2) {
    return { error: "plan_workflow requires a title and at least 2 steps" };
  }

  const run = await createWorkflowRun({
    userId: context.userId,
    conversationId: context.conversationId,
    title: inp.title.trim(),
    description: inp.description?.trim() ?? "",
    steps: inp.steps.map((s, i) => ({
      stepIndex: i,
      toolName: s.tool,
      args: s.args ?? {},
      description: s.description,
      riskLevel: s.risk_level,
    })),
  });

  return {
    workflow_id: run.id,
    title: inp.title,
    step_count: inp.steps.length,
    steps: inp.steps.map((s, i) => ({
      index: i,
      description: s.description,
      tool_name: s.tool,
      risk_level: s.risk_level,
    })),
    status: "pending",
  };
}
```

- [ ] **Step 5: Add receipt builders to `lib/chat/receipts.ts`**

At the top of `lib/chat/receipts.ts`, add import:

```typescript
import type { WorkflowStepPreview } from "@/lib/chat/types";
```

Inside `buildReceipt`, before the final `return` fallback, add three new blocks:

```typescript
  if (toolName === "web_search") {
    const count = typeof result.count === "number" ? result.count : 0;
    return {
      id,
      action: "Web search",
      outcome: hasError
        ? String(result.error)
        : count > 0
          ? `Found ${count} result${count === 1 ? "" : "s"}`
          : "No results found",
      source: "temporary",
      status: hasError ? "error" : "info",
    };
  }

  if (toolName === "fetch_webpage") {
    const url = typeof result.url === "string" ? result.url : "";
    const title = typeof result.title === "string" ? result.title : url;
    return {
      id,
      action: "Webpage",
      outcome: hasError ? String(result.error) : `Read: ${title || url}`,
      source: "temporary",
      status: hasError ? "error" : "info",
      confirm: !hasError && url
        ? { type: "open_browser_tab" as const, url, title: title || undefined }
        : undefined,
    };
  }

  if (toolName === "plan_workflow") {
    const workflowId = typeof result.workflow_id === "string" ? result.workflow_id : "";
    const title = typeof result.title === "string" ? result.title : "Workflow";
    const stepCount = typeof result.step_count === "number" ? result.step_count : 0;
    const rawSteps = Array.isArray(result.steps) ? result.steps : [];
    const steps: WorkflowStepPreview[] = rawSteps.map((s: Record<string, unknown>, i: number) => ({
      index: typeof s.index === "number" ? s.index : i,
      description: typeof s.description === "string" ? s.description : "",
      toolName: typeof s.tool_name === "string" ? s.tool_name : "",
      riskLevel: (s.risk_level === "read" || s.risk_level === "write" || s.risk_level === "irreversible")
        ? s.risk_level
        : "write",
    }));
    return {
      id,
      action: "Workflow plan",
      outcome: hasError
        ? String(result.error)
        : `${stepCount} step${stepCount === 1 ? "" : "s"} — tap to review`,
      source: "temporary",
      status: hasError ? "error" : "info",
      confirm: !hasError && workflowId
        ? { type: "approve_workflow" as const, workflowId, title, steps }
        : undefined,
    };
  }
```

- [ ] **Step 6: Pass `conversationId` into `executeTool` in `run-turn.ts`**

In `lib/chat/run-turn.ts`, find every call to `executeTool(block.name, block.input, {` and add `conversationId: ctx.conversationId,` to the context object. There are two calls (one in `runTurn`, one in `runTurnStream`):

```typescript
// Before:
const result = await executeTool(block.name, block.input, {
  userId: ctx.userId,
  sourceMessageId: ctx.userMessageId,
  userMessage: ctx.latestUserMessage,
});

// After:
const result = await executeTool(block.name, block.input, {
  userId: ctx.userId,
  conversationId: ctx.conversationId,
  sourceMessageId: ctx.userMessageId,
  userMessage: ctx.latestUserMessage,
});
```

- [ ] **Step 7: Verify TypeScript compiles**

```bash
npm run build 2>&1 | grep "error" | head -20
```

Expected: zero TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add lib/chat/types.ts lib/tools/definitions.ts lib/tools/handlers.ts lib/chat/receipts.ts lib/chat/run-turn.ts
git commit -m "feat: add web_search, fetch_webpage, plan_workflow tools and receipt builders"
```

---

### Task 5: Workflow execution API — SSE streaming endpoint

**Files:**
- Create: `app/api/workflow/[id]/execute/route.ts`
- Create: `app/api/workflow/[id]/route.ts`
- Create: `app/api/workflow/[id]/cancel/route.ts`

**Interfaces:**
- Produces:
  - `POST /api/workflow/[id]/execute` → `text/event-stream` (SSE events per step)
  - `GET /api/workflow/[id]` → `{ run: WorkflowRunRow, steps: WorkflowStepRow[] }`
  - `POST /api/workflow/[id]/cancel` → `{ cancelled: true }`
- SSE event shapes:
  - `{"type":"step_start","stepIndex":N,"description":"..."}`
  - `{"type":"step_complete","stepIndex":N,"receipt":{...}}`
  - `{"type":"step_failed","stepIndex":N,"error":"..."}`
  - `{"type":"workflow_complete","totalSteps":N}`
  - `{"type":"workflow_error","error":"..."}`
- Consumes: `lib/db/workflows.ts`, `lib/tools/handlers.ts:executeTool`, `lib/chat/receipts.ts:buildReceipt`

- [ ] **Step 1: Read the Next.js App Router docs for route handlers**

```bash
ls node_modules/next/dist/docs/ 2>/dev/null | head -20
# If docs exist, open the routing or API routes section
# Otherwise, use the existing app/api/chat/route.ts as the reference pattern
```

- [ ] **Step 2: Create `app/api/workflow/[id]/route.ts` (GET — fetch workflow state)**

```typescript
import { withAuth } from "@/lib/auth/api";
import { getWorkflowWithSteps } from "@/lib/db/workflows";
import { NextResponse } from "next/server";

export const GET = withAuth(
  async (request: Request, context: { params: { id: string } }, userId: string) => {
    const { id } = await context.params;
    const workflow = await getWorkflowWithSteps(id);
    if (!workflow) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (workflow.user_id !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return NextResponse.json({ run: workflow, steps: workflow.steps });
  },
);
```

> Note: Check the signature of `withAuth` in `lib/auth/api.ts` — use the exact parameter order it expects. If it wraps differently from the pattern above, match the existing pattern from `app/api/memories/[id]/route.ts`.

- [ ] **Step 3: Create `app/api/workflow/[id]/cancel/route.ts`**

```typescript
import { withAuth } from "@/lib/auth/api";
import { getWorkflowWithSteps, updateWorkflowStatus } from "@/lib/db/workflows";
import { NextResponse } from "next/server";

export const POST = withAuth(
  async (request: Request, context: { params: { id: string } }, userId: string) => {
    const { id } = await context.params;
    const workflow = await getWorkflowWithSteps(id);
    if (!workflow) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (workflow.user_id !== userId) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    if (!["pending", "approved"].includes(workflow.status)) {
      return NextResponse.json({ error: "Cannot cancel a workflow that is already running or completed" }, { status: 400 });
    }
    await updateWorkflowStatus(id, "cancelled");
    return NextResponse.json({ cancelled: true });
  },
);
```

- [ ] **Step 4: Create `app/api/workflow/[id]/execute/route.ts`**

This is the critical SSE-streaming endpoint. Follow the existing stream pattern from `lib/chat/stream-events.ts`:

```typescript
import { withAuth } from "@/lib/auth/api";
import {
  getWorkflowWithSteps,
  updateWorkflowStatus,
  updateStepStatus,
} from "@/lib/db/workflows";
import { executeTool } from "@/lib/tools";
import { buildReceipt } from "@/lib/chat/receipts";
import type { ChatActionReceipt } from "@/lib/chat/types";

function sseEvent(data: Record<string, unknown>): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const POST = withAuth(
  async (request: Request, context: { params: { id: string } }, userId: string) => {
    const { id } = await context.params;
    const workflow = await getWorkflowWithSteps(id);

    if (!workflow) {
      return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    }
    if (workflow.user_id !== userId) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
    }
    if (!["pending", "approved"].includes(workflow.status)) {
      return new Response(
        JSON.stringify({ error: "Workflow is not in an executable state" }),
        { status: 400 },
      );
    }

    const steps = (workflow.steps ?? []).sort((a, b) => a.step_index - b.step_index);

    const stream = new ReadableStream({
      async start(controller) {
        const encode = (s: string) => new TextEncoder().encode(s);

        try {
          await updateWorkflowStatus(id, "running");

          const receipts: ChatActionReceipt[] = [];

          for (const step of steps) {
            controller.enqueue(
              encode(
                sseEvent({
                  type: "step_start",
                  stepIndex: step.step_index,
                  description: step.description,
                  toolName: step.tool_name,
                }),
              ),
            );

            await updateStepStatus(step.id, "running");

            let result: Record<string, unknown>;
            try {
              result = await executeTool(step.tool_name, step.args, {
                userId,
                conversationId: workflow.conversation_id,
                sourceMessageId: "",
                userMessage: "",
              });
            } catch (err) {
              const errorMsg = err instanceof Error ? err.message : "Unexpected error";
              await updateStepStatus(step.id, "failed", null, errorMsg);
              controller.enqueue(
                encode(
                  sseEvent({
                    type: "step_failed",
                    stepIndex: step.step_index,
                    error: errorMsg,
                  }),
                ),
              );
              continue;
            }

            const hasError = typeof result.error === "string";
            await updateStepStatus(
              step.id,
              hasError ? "failed" : "completed",
              hasError ? null : result,
              hasError ? String(result.error) : null,
            );

            const receipt = buildReceipt(step.tool_name, result);
            receipts.push(receipt);

            controller.enqueue(
              encode(
                sseEvent({
                  type: "step_complete",
                  stepIndex: step.step_index,
                  receipt,
                  failed: hasError,
                }),
              ),
            );
          }

          await updateWorkflowStatus(id, "completed");
          controller.enqueue(
            encode(
              sseEvent({
                type: "workflow_complete",
                totalSteps: steps.length,
                receipts,
              }),
            ),
          );
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Workflow execution failed";
          await updateWorkflowStatus(id, "failed").catch(() => {});
          controller.enqueue(
            encode(sseEvent({ type: "workflow_error", error: errorMsg })),
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  },
);
```

> **Important:** Check how `withAuth` wraps handlers in `lib/auth/api.ts`. If it doesn't support returning a `Response` directly (only `NextResponse`), adjust accordingly. Pattern-match with `app/api/chat/route.ts`.

- [ ] **Step 5: Verify the routes compile**

```bash
npm run build 2>&1 | grep "error" | head -20
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add app/api/workflow/
git commit -m "feat: add workflow GET/cancel/execute API routes with SSE streaming"
```

---

### Task 6: Raise MAX_TOOL_ITERATIONS and update system prompt

**Files:**
- Modify: `lib/chat/run-turn.ts`
- Modify: `lib/chat/system-prompt.ts`

**Interfaces:**
- Produces: `MAX_TOOL_ITERATIONS` = 10 (was 3); workflow + web tool guidance in `BASE_SYSTEM_PROMPT`

- [ ] **Step 1: Raise MAX_TOOL_ITERATIONS in `lib/chat/run-turn.ts`**

Find:

```typescript
const MAX_TOOL_ITERATIONS = 3;
```

Replace with:

```typescript
const MAX_TOOL_ITERATIONS = 10;
```

Leave `MAX_TOOL_ITERATIONS_VOICE = 3` unchanged — voice turns stay at 3 to keep latency low.

- [ ] **Step 2: Add workflow + web tool guidance to `lib/chat/system-prompt.ts`**

Find the end of the `BASE_SYSTEM_PROMPT` template string (ends after `- search_memory: when you need to look up stored memories beyond what was pre-fetched.`).

Append the following block before the closing backtick of `BASE_SYSTEM_PROMPT`:

```typescript
`

Web tools:
- web_search: when the user asks for current information, news, facts, or any topic that requires real-time or external knowledge. Use a specific, context-rich query. Surface the most relevant result(s) in your reply — do not dump raw URLs.
- fetch_webpage: when the user provides a link to read, or when a search result needs to be read in detail. An "Open" button will appear so the user can view the page. Keep your summary concise.

Agentic workflows (plan_workflow):
- Use plan_workflow ONLY when the user asks for 2 or more WRITE actions across different tools in one request. Examples: "reschedule my meeting AND email Alex AND remind me to prep", "delete this event AND draft a cancellation email".
- Before calling plan_workflow, first do any necessary READ steps using regular tool calls (e.g., list_calendar_events to find the event ID, search_gmail to find the recipient's address). plan_workflow must include fully resolved args — no unknown IDs or missing fields.
- After plan_workflow succeeds, briefly summarize the plan in your reply so the user knows what they're approving. The UI will display the detailed step list.
- Do NOT use plan_workflow for: single-tool actions, read-only workflows, voice turns, or simple questions.
- Do NOT use plan_workflow when it would delay a simple action — call the tool directly when in doubt.`
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | grep "error" | head -20
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add lib/chat/run-turn.ts lib/chat/system-prompt.ts
git commit -m "feat: raise MAX_TOOL_ITERATIONS to 10 and add workflow/web tool guidance to system prompt"
```

---

### Task 7: WorkflowCard frontend component

**Files:**
- Create: `components/chat/WorkflowCard.tsx`

**Interfaces:**
- Consumes:
  - `WorkflowStepPreview` from `@/lib/chat/types`
  - `ChatActionReceipt` from `@/lib/chat/types`
  - `POST /api/workflow/[id]/execute` (SSE stream)
  - `POST /api/workflow/[id]/cancel`
- Produces: `WorkflowCard` component with `{ workflowId, title, steps, onComplete, onCancel }` props
- States: `pending` (shows plan + approve/cancel buttons) → `running` (shows live step progress) → `done` (shows summary receipts)

- [ ] **Step 1: Create `components/chat/WorkflowCard.tsx`**

```tsx
"use client";

import { useState, useCallback } from "react";
import type { ChatActionReceipt, WorkflowStepPreview } from "@/lib/chat/types";

type WorkflowState = "pending" | "running" | "done" | "error";

interface StepStatus {
  stepIndex: number;
  state: "pending" | "running" | "completed" | "failed";
  receipt?: ChatActionReceipt;
  error?: string;
}

function riskIcon(riskLevel: WorkflowStepPreview["riskLevel"]): string {
  if (riskLevel === "irreversible") return "⚠";
  if (riskLevel === "write") return "✎";
  return "↗";
}

function riskLabel(riskLevel: WorkflowStepPreview["riskLevel"]): string {
  if (riskLevel === "irreversible") return "Irreversible";
  if (riskLevel === "write") return "Write";
  return "Read";
}

export function WorkflowCard({
  workflowId,
  title,
  steps,
  onComplete,
  onCancel,
}: {
  workflowId: string;
  title: string;
  steps: WorkflowStepPreview[];
  onComplete: (receipts: ChatActionReceipt[]) => void;
  onCancel: () => void;
}) {
  const [workflowState, setWorkflowState] = useState<WorkflowState>("pending");
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(
    steps.map((s) => ({ stepIndex: s.index, state: "pending" })),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleApprove = useCallback(async () => {
    setBusy(true);
    setWorkflowState("running");

    try {
      const response = await fetch(`/api/workflow/${workflowId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!response.ok || !response.body) {
        throw new Error(`Execute failed: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const allReceipts: ChatActionReceipt[] = [];
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() ?? "";

        for (const chunk of lines) {
          if (!chunk.startsWith("data: ")) continue;
          const json = chunk.slice(6).trim();
          if (!json) continue;

          let event: Record<string, unknown>;
          try {
            event = JSON.parse(json) as Record<string, unknown>;
          } catch {
            continue;
          }

          if (event.type === "step_start") {
            const idx = event.stepIndex as number;
            setStepStatuses((prev) =>
              prev.map((s) =>
                s.stepIndex === idx ? { ...s, state: "running" } : s,
              ),
            );
          } else if (event.type === "step_complete") {
            const idx = event.stepIndex as number;
            const receipt = event.receipt as ChatActionReceipt | undefined;
            const failed = Boolean(event.failed);
            if (receipt) allReceipts.push(receipt);
            setStepStatuses((prev) =>
              prev.map((s) =>
                s.stepIndex === idx
                  ? {
                      ...s,
                      state: failed ? "failed" : "completed",
                      receipt: receipt ?? undefined,
                    }
                  : s,
              ),
            );
          } else if (event.type === "step_failed") {
            const idx = event.stepIndex as number;
            const errMsg = typeof event.error === "string" ? event.error : "Failed";
            setStepStatuses((prev) =>
              prev.map((s) =>
                s.stepIndex === idx
                  ? { ...s, state: "failed", error: errMsg }
                  : s,
              ),
            );
          } else if (event.type === "workflow_complete") {
            setWorkflowState("done");
            onComplete(allReceipts);
          } else if (event.type === "workflow_error") {
            const errMsg = typeof event.error === "string" ? event.error : "Workflow failed";
            setError(errMsg);
            setWorkflowState("error");
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Execution failed";
      setError(msg);
      setWorkflowState("error");
    } finally {
      setBusy(false);
    }
  }, [workflowId, onComplete]);

  const handleCancel = useCallback(async () => {
    setBusy(true);
    try {
      await fetch(`/api/workflow/${workflowId}/cancel`, {
        method: "POST",
        credentials: "include",
      });
    } catch {
      // Ignore cancel errors — still dismiss the card
    } finally {
      setBusy(false);
      onCancel();
    }
  }, [workflowId, onCancel]);

  return (
    <div className="my-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-4 text-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-[var(--text-primary)]">{title}</p>
          <p className="text-xs text-[var(--text-secondary)]">
            {workflowState === "pending"
              ? `${steps.length} step${steps.length === 1 ? "" : "s"} — review before executing`
              : workflowState === "running"
                ? "Running…"
                : workflowState === "done"
                  ? "Complete"
                  : "Error"}
          </p>
        </div>
        {workflowState === "done" && (
          <span className="text-xs text-[#9fdf9f]">✓ Done</span>
        )}
        {workflowState === "error" && (
          <span className="text-xs text-[#e8a0a0]">✗ Failed</span>
        )}
      </div>

      {/* Step list */}
      <ol className="mb-3 space-y-2">
        {steps.map((step) => {
          const status = stepStatuses.find((s) => s.stepIndex === step.index);
          const state = status?.state ?? "pending";
          const stateColor =
            state === "completed"
              ? "text-[#9fdf9f]"
              : state === "failed"
                ? "text-[#e8a0a0]"
                : state === "running"
                  ? "text-[var(--text-primary)] opacity-90"
                  : "text-[var(--text-secondary)]";
          const stateIcon =
            state === "completed"
              ? "✓"
              : state === "failed"
                ? "✗"
                : state === "running"
                  ? "…"
                  : `${step.index + 1}.`;

          return (
            <li key={step.index} className={`flex items-start gap-2 ${stateColor}`}>
              <span className="w-4 shrink-0 text-center font-mono text-xs">
                {stateIcon}
              </span>
              <span className="flex-1 text-xs">
                {step.description}
                {workflowState === "pending" && (
                  <span
                    className={`ml-1.5 rounded px-1 py-0.5 text-[10px] ${
                      step.riskLevel === "irreversible"
                        ? "bg-amber-900/40 text-amber-300"
                        : step.riskLevel === "write"
                          ? "bg-blue-900/30 text-blue-300"
                          : "bg-[var(--surface-elevated)] text-[var(--text-secondary)]"
                    }`}
                  >
                    {riskIcon(step.riskLevel)} {riskLabel(step.riskLevel)}
                  </span>
                )}
                {state === "failed" && status?.error && (
                  <span className="ml-1 text-[10px] opacity-70">— {status.error}</span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {/* Error message */}
      {error && (
        <p className="mb-2 text-xs text-[#e8a0a0]">{error}</p>
      )}

      {/* Action buttons — only shown in pending state */}
      {workflowState === "pending" && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void handleApprove()}
            disabled={busy}
            className="rounded-lg bg-[var(--accent)] px-3 py-1.5 text-xs font-medium text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? "Starting…" : "Approve all steps"}
          </button>
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={busy}
            className="rounded-lg border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the component compiles without errors**

```bash
npm run build 2>&1 | grep "error" | head -20
```

Expected: no TypeScript errors in `WorkflowCard.tsx`.

- [ ] **Step 3: Commit**

```bash
git add components/chat/WorkflowCard.tsx
git commit -m "feat: add WorkflowCard component (plan preview + SSE execution progress)"
```

---

### Task 8: Wire WorkflowCard into `primitives.tsx` and `ChatScreen.tsx`

**Files:**
- Modify: `components/ui/primitives.tsx`
- Modify: `components/chat/ChatScreen.tsx`

**Interfaces:**
- Consumes: `WorkflowCard` from `@/components/chat/WorkflowCard`
- Produces: approve_workflow receipts render WorkflowCard inline; open_browser_tab receipts render "Open" button

- [ ] **Step 1: Handle `open_browser_tab` in `ActionReceiptRow` in `primitives.tsx`**

In `components/ui/primitives.tsx`, inside `ActionReceiptRow`, find the block that renders the "Send" button:

```typescript
{receipt.confirm?.type === "send_gmail_draft" && !receipt.dismissed && onConfirm ? (
```

After the closing `</>` of that block (before the undo button block), add:

```tsx
{receipt.confirm?.type === "open_browser_tab" && !receipt.dismissed ? (
  <a
    href={receipt.confirm.url}
    target="_blank"
    rel="noopener noreferrer"
    className="rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-xs text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
  >
    Open
  </a>
) : null}
```

- [ ] **Step 2: Handle `approve_workflow` receipts in `primitives.tsx` — suppress default row rendering**

In `ActionReceiptRow`, the `approve_workflow` confirm type should NOT render the small receipt row — it will be rendered as a full `WorkflowCard` by `ChatScreen.tsx`. To prevent it from showing a duplicate row, add an early return at the top of `ActionReceiptRow`:

After the `const toneClass = ...` line, add:

```tsx
// WorkflowCard renders its own full-size card; skip the compact row for it
if (receipt.confirm?.type === "approve_workflow" && !receipt.dismissed) {
  return null;
}
```

- [ ] **Step 3: Add `handleApproveWorkflow` and WorkflowCard rendering to `ChatScreen.tsx`**

At the top of `ChatScreen.tsx`, add this import:

```typescript
import { WorkflowCard } from "@/components/chat/WorkflowCard";
```

Inside the `ChatScreen` component, add a handler after the existing `handleDismissReceipt`:

```typescript
const handleApproveWorkflow = useCallback(
  (messageId: string, receiptId: string, completedReceipts: ChatActionReceipt[]) => {
    // Mark the plan receipt as dismissed (so WorkflowCard doesn't re-show the plan)
    // and append the execution receipts to the message
    setMessages((prev) =>
      prev.map((item) => {
        if (item.id !== messageId) return item;
        const updatedReceipts = (item.actionReceipts ?? []).map((r) =>
          r.id === receiptId ? { ...r, dismissed: true } : r,
        );
        return {
          ...item,
          actionReceipts: [...updatedReceipts, ...completedReceipts],
        };
      }),
    );
    // Persist the dismissed state to the backend
    void persistReceiptState(messageId, [
      ...(messages.find((m) => m.id === messageId)?.actionReceipts ?? []).map((r) =>
        r.id === receiptId ? { ...r, dismissed: true } : r,
      ),
      ...completedReceipts,
    ]);
  },
  [messages],
);

const handleCancelWorkflow = useCallback(
  (messageId: string, receiptId: string) => {
    setMessages((prev) =>
      prev.map((item) => {
        if (item.id !== messageId) return item;
        return {
          ...item,
          actionReceipts: (item.actionReceipts ?? []).map((r) =>
            r.id === receiptId ? { ...r, dismissed: true } : r,
          ),
        };
      }),
    );
  },
  [],
);
```

> Note: `persistReceiptState` is the existing helper in `ChatScreen.tsx` that POSTs to `/api/messages/[id]/metadata`. Check its exact name and signature in `ChatScreen.tsx` (grep for `persistReceipt` or `PATCH /api/messages`), and call it with the correct arguments.

- [ ] **Step 4: Render WorkflowCard inline in the message list**

In `ChatScreen.tsx`, find where `actionReceipts` are mapped to `ActionReceiptRow` components (search for `ActionReceiptRow` in the render section). It will look something like:

```tsx
{message.actionReceipts?.map((receipt) => (
  <ActionReceiptRow
    key={receipt.id}
    receipt={receipt}
    ...
  />
))}
```

Replace that block with:

```tsx
{message.actionReceipts?.map((receipt) => {
  // Render WorkflowCard for approve_workflow receipts that haven't been dismissed
  if (
    receipt.confirm?.type === "approve_workflow" &&
    !receipt.dismissed
  ) {
    return (
      <WorkflowCard
        key={receipt.id}
        workflowId={receipt.confirm.workflowId}
        title={receipt.confirm.title}
        steps={receipt.confirm.steps}
        onComplete={(completedReceipts) =>
          handleApproveWorkflow(message.id, receipt.id, completedReceipts)
        }
        onCancel={() => handleCancelWorkflow(message.id, receipt.id)}
      />
    );
  }

  // Default: render the compact receipt row
  return (
    <ActionReceiptRow
      key={receipt.id}
      receipt={receipt}
      onUndo={onUndoReceipt ? (r) => onUndoReceipt(message.id, r.id) : undefined}
      onConfirm={onConfirmReceipt ? (r) => onConfirmReceipt(message.id, r.id) : undefined}
      onDismiss={onDismissReceipt ? (r) => onDismissReceipt(message.id, r.id) : undefined}
      confirmBusy={confirmBusyReceiptId === receipt.id}
    />
  );
})}
```

> Note: The exact prop names (`onUndoReceipt`, `onConfirmReceipt`, `onDismissReceipt`) may differ in the actual file. Look at what props the existing `ActionReceiptRow` calls receive and mirror the exact pattern.

- [ ] **Step 5: Verify build succeeds**

```bash
npm run build 2>&1 | grep "error" | head -20
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add components/ui/primitives.tsx components/chat/ChatScreen.tsx
git commit -m "feat: wire WorkflowCard into ChatScreen; add open_browser_tab receipt button"
```

---

### Task 9: Update README, env docs, and authoring withAuth pattern verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: updated env var list + migration 016 instructions + Phase 4C status update

- [ ] **Step 1: Add `BRAVE_SEARCH_API_KEY` to README env var list**

In `README.md`, find the `.env.local` setup block (starts around line 43). Add after the `ANTHROPIC_MODEL_HEAVY` entry:

```markdown
  - `BRAVE_SEARCH_API_KEY` — Brave Search API key for web search tool (get one at search.brave.com/app/keys; optional — tool degrades gracefully when missing)
```

- [ ] **Step 2: Add migration 016 to the migration list in README**

Find the migration list (starts at `supabase/migrations/001_initial_schema.sql`). Add at the end:

```markdown
  - `supabase/migrations/016_workflow_runs.sql` (Phase 4C — workflow_runs + workflow_steps tables)
```

- [ ] **Step 3: Update Phase 4C status table in README**

Find the Phase 4 status table:

```markdown
| 4C | planned | Multi-step cross-tool workflows + confirmations |
```

Replace with:

```markdown
| 4C | **shipped** | Multi-step cross-tool workflows, plan-first UI, web search/fetch, per-step streaming receipts |
```

- [ ] **Step 4: Verify `withAuth` signature matches all new route handlers**

```bash
cat lib/auth/api.ts | head -50
```

Compare the handler signature to `app/api/workflow/[id]/execute/route.ts`. If `withAuth` wraps handlers with `(req, context, userId)` ordering differently, fix all three new route files to match.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: update README for Phase 4C (BRAVE_SEARCH_API_KEY, migration 016, status)"
```

---

### Task 10: End-to-end verification

**Files:** No new files — manual testing and build validation only.

- [ ] **Step 1: Full production build**

```bash
npm run build
```

Expected: zero errors, zero TypeScript errors, successful build output.

- [ ] **Step 2: Start dev server**

```bash
npm run dev
```

Expected: server starts at `http://localhost:3000` with no runtime errors.

- [ ] **Step 3: Test web_search tool**

In the chat, type: `What's the latest news about Claude AI?`

Expected:
- Claude calls `web_search` with a relevant query
- Chat shows a "Web search" receipt row with result count
- Claude replies with a natural summary of search results

- [ ] **Step 4: Test fetch_webpage tool**

In the chat, type: `Read https://anthropic.com and summarize what they do`

Expected:
- Claude calls `fetch_webpage`
- Receipt shows "Webpage — Read: [page title]" with an "Open" button
- Clicking "Open" opens `https://anthropic.com` in a new browser tab
- Claude replies with a concise summary

- [ ] **Step 5: Test plan_workflow — multi-step workflow creation**

In the chat, type: `Reschedule my next calendar event to 1 hour later, draft an email to the first attendee explaining the change, and create a reminder to send me a prep note 30 minutes before`

Expected sequence:
1. Claude calls `list_calendar_events` to find the event (read step — runs immediately, no plan needed)
2. Claude calls `plan_workflow` with 3 resolved steps
3. Chat shows `WorkflowCard` with the 3 steps, risk levels, Approve/Cancel buttons
4. Claude's text describes the plan briefly

- [ ] **Step 6: Test workflow approval and execution**

Tap "Approve all steps" in the `WorkflowCard`.

Expected:
- Button shows "Starting…" briefly
- Steps update one-by-one with spinner → checkmark or ✗
- After last step: status shows "Complete"
- Action receipts appear for each step (calendar updated, gmail draft created, reminder created)
- Gmail draft receipt still shows "Send" button (irreversible action, not auto-sent)

- [ ] **Step 7: Test workflow cancellation**

Repeat step 5. When the WorkflowCard appears, tap Cancel.

Expected:
- Card disappears
- No tools executed
- DB row in `workflow_runs` shows `status = cancelled`

- [ ] **Step 8: Test single-tool actions are NOT wrapped in plan_workflow**

Type: `Remind me to buy groceries tomorrow at 9am`

Expected: Claude calls `create_reminder` directly — no `plan_workflow` call, no WorkflowCard.

- [ ] **Step 9: Test MAX_TOOL_ITERATIONS is respected**

Verify in dev server logs that a complex multi-step tool call (e.g., one that needs 4 tool iterations) reaches iteration 4 without hitting the old limit of 3.

Check server logs for: `[run-turn] hit MAX_TOOL_ITERATIONS` — it should NOT appear for normal 4-6 step workflows.

- [ ] **Step 10: Final commit**

```bash
git add -A
git status
# Review the diff — ensure no accidental .env.local changes are staged
git commit -m "feat: Phase 4C complete — agentic workflows, web search, fetch_webpage, plan_workflow, WorkflowCard"
```

---

## Self-Review

### Spec Coverage Check

| Spec requirement | Task |
|---|---|
| Workflow planner: decompose multi-step requests into ordered steps | Task 4 (`plan_workflow` tool) + Task 6 (system prompt routing) |
| Web searches — open new tab on browser and conduct simple tasks | Task 3 (`web_search` + `fetch_webpage`) + Task 8 ("Open" button receipt) |
| Cross-tool examples: reschedule + email + reminder + memory | Task 6 (system prompt examples) + Task 10 (E2E test) |
| Confirmation layer: workflow bundles — review all steps, approve once | Task 7 (`WorkflowCard` plan-preview state) |
| High-impact gates: irreversible actions require explicit confirm | `create_gmail_draft` still produces "Send" receipt button (existing behavior preserved); `risk_level: "irreversible"` shown in UI |
| Workflow state persistence in DB | Task 1 + Task 2 (`workflow_runs` + `workflow_steps`) |
| Resume after refresh | Task 5 (`GET /api/workflow/[id]` returns current status) |
| Failure recovery: report what completed, offer retry | `WorkflowCard` shows per-step ✗ with error message; completed steps shown as ✓ |

### Placeholder Scan

No TBDs, TODOs, or vague instructions found. Every step includes exact code, commands, and expected output.

### Type Consistency Check

- `WorkflowStepPreview.riskLevel` used in `types.ts`, `receipts.ts`, and `WorkflowCard.tsx` — all three use `"read" | "write" | "irreversible"` ✓
- `ChatActionConfirm` discriminated union narrowed by `.type` in all three files that read it (`primitives.tsx`, `ChatScreen.tsx`, `receipts.ts`) ✓
- `ToolContext.conversationId` added in Task 4 Step 1 and consumed in Tasks 4 Step 6 and Task 5 (`execute` endpoint) ✓
- `WorkflowCard.onComplete` receives `ChatActionReceipt[]` — same type as `actionReceipts` on `ChatMessage` ✓

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-29-phase-4c-agentic-workflows.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
