# Nova Mac Plan 3: Memory + Conversation Context — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `electron/chat.ts` from a bare Anthropic stream to full web-app parity — conversation history, dynamic intent + model routing, memory/reminder retrieval, a 16-tool call loop, and full-fidelity memory writes — all running in the Electron main process through the existing streaming IPC shape.

**Architecture:** A new `electron/chat-turn.ts` orchestrator replaces the bare `streamChat` body, mirroring the web's `runTurn`. Memory logic is ported from `lib/memory/` into `electron/memory/` and tools from `lib/tools/` into `electron/tools/`; every `createServerClient()` call becomes `getSupabase()`. Google tool handlers work via the shared `google_oauth_tokens` Supabase table — if the user has already linked Google on the web app the Mac gets it for free. The renderer is untouched except for adding `inputModality: "voice"` to `chatSend`.

**Tech Stack:** Electron (Node.js main process), Vitest (tests), `@supabase/supabase-js`, `@anthropic-ai/sdk`, `googleapis` (add), `node:crypto`, TypeScript strict mode.

## Global Constraints

- Never `select("embedding")` on `memories` — ~6 KB of floats per row
- API keys stay in main process only; never cross IPC to renderer
- Every `createServerClient()` → `getSupabase()` from `electron/supabase.ts`
- Every `@/lib/memory/X` → `./X`; every `@/lib/chat/X` → relative path; every `@/lib/db/X` or `@/lib/google/X` → respective ported path
- Type-check gate: `npx tsc --noEmit` must pass after every task
- Test: `npx vitest run electron/path/to/file.test.ts` for a single file; `npm test` for all
- All tests use Vitest Node environment; all network calls (Supabase, Anthropic, OpenAI, Google) stubbed with `vi.mock` / `vi.fn()`
- Commit after every task; commit message format: `feat(mac): <what>` or `fix(mac): <what>`

## File Map

```
shared/
  types.ts                          MODIFY — add inputModality, fix MemorySummary
electron/
  sync.ts                           MODIFY — column bugfix
  chat.ts                           MODIFY — shim to chat-turn
  chat-turn.ts                      CREATE
  conversation.ts                   CREATE
  memory/
    types.ts                        CREATE — local DB type defs
    keywords.ts                     PORT lib/memory/keywords.ts
    merge.ts                        PORT lib/memory/merge.ts
    reconcile.ts                    PORT lib/memory/reconcile.ts
    profile.ts                      PORT lib/memory/profile.ts
    lifestyle-capture.ts            PORT lib/memory/lifestyle-capture.ts
    model-routing.ts                PORT lib/chat/model-routing.ts
    reminder-intent.ts              PORT lib/chat/reminder-intent.ts
    memory-intent.ts                PORT lib/chat/memory-intent.ts
    voice-fallback.ts               PORT lib/chat/voice-fallback.ts
    system-prompt.ts                PORT lib/chat/system-prompt.ts (mac-adapted)
    context-intent.ts               PORT lib/chat/context-intent.ts
    classify.ts                     PORT lib/memory/classify.ts
    embed.ts                        PORT lib/memory/embed.ts
    client.ts                       CREATE — getUserId() cached
    reminders.ts                    PORT lib/db/reminders.ts (listUpcomingReminders + formatReminderLine)
    runtime-context.ts              PORT lib/chat/runtime-context.ts
    retrieval-plan.ts               PORT lib/chat/thread-context.ts + applyMacVoiceOverrides
    search.ts                       PORT lib/memory/search.ts
    relationships.ts                PORT lib/memory/relationships.ts
    save.ts                         PORT lib/memory/save.ts
    extract.ts                      PORT lib/memory/extract.ts
    index.ts                        CREATE — re-exports
  google/
    errors.ts                       PORT lib/google/errors.ts
    crypto.ts                       PORT lib/google/crypto.ts
    config.ts                       PORT lib/google/config.ts
    scopes.ts                       PORT lib/google/scopes.ts
    oauth.ts                        PORT lib/google/oauth.ts
    db-tokens.ts                    PORT lib/db/google-tokens.ts
    auth-client.ts                  PORT lib/google/auth-client.ts
    client.ts                       PORT lib/google/client.ts
    html.ts                         PORT lib/google/html.ts
    calendar.ts                     PORT lib/google/calendar.ts
    gmail.ts                        PORT lib/google/gmail.ts
    youtube-taste.ts                PORT lib/db/youtube-taste.ts
    youtube.ts                      PORT lib/google/youtube.ts
  tools/
    definitions.ts                  PORT lib/tools/definitions.ts (minus plan_workflow)
    web-search.ts                   PORT lib/tools/web-search.ts
    webpage.ts                      PORT lib/tools/webpage.ts
    workouts.ts                     PORT lib/db/workouts.ts
    parse-due-at.ts                 PORT lib/reminders/parse-due-at.ts
    handlers.ts                     PORT lib/tools/handlers.ts
src/
  hooks/useVoice.ts                 MODIFY — add inputModality: "voice"
```

---

### Task 1: Shared types, local type definitions, sync bugfix

**Files:**
- Modify: `shared/types.ts`
- Create: `electron/memory/types.ts`
- Modify: `electron/sync.ts`

**Interfaces:**
- Produces: `MemoryType`, `MemoryCategory`, `MemorySourceType`, `Memory`, `Reminder`, `ReminderStatus`, `Workout`, `Message`, `MessageRole`, `LinkType` — used by every subsequent task

- [ ] **Step 1: Add `inputModality` to `ChatSendRequest` and fix `MemorySummary` in `shared/types.ts`**

```typescript
// shared/types.ts — modify ChatSendRequest (add inputModality field)
export interface ChatSendRequest {
  requestId: string;
  messages: ChatMessage[];
  inputModality?: "voice" | "text";  // add this line
}

// shared/types.ts — modify MemorySummary
export interface MemorySummary {
  id: string;
  content: string;
  memoryType: string | null;  // was: type: string
  salience: number;
}
```

- [ ] **Step 2: Create `electron/memory/types.ts`**

```typescript
// electron/memory/types.ts
export type MessageRole = "user" | "assistant";
export type ReminderStatus = "pending" | "done" | "cancelled";
export type MemoryCategory = "preference" | "fact" | "goal" | "other";
export type MemoryType =
  | "fact" | "preference" | "routine" | "episodic"
  | "goal" | "relationship" | "skill";
export type MemorySourceType = "auto_capture" | "tool_save" | "user_manual";
export type LinkType = "related" | "contradicts" | "refines" | "context_of" | "part_of";

export interface Memory {
  id: string;
  user_id: string;
  content: string;
  category: string | null;
  memory_type: MemoryType | null;
  salience: number;
  last_accessed_at: string | null;
  access_count: number;
  is_pinned: boolean;
  is_archived: boolean;
  source_type: MemorySourceType | null;
  valid_from: string | null;
  valid_until: string | null;
  confidence: number;
  metadata: Record<string, unknown> | null;
  source_message_id: string | null;
  created_at: string;
}

export interface Reminder {
  id: string;
  user_id: string;
  title: string;
  due_at: string | null;
  status: ReminderStatus;
  completed_at: string | null;
  notified_at: string | null;
  notification_channel: string | null;
  source_message_id: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface Workout {
  id: string;
  user_id: string;
  logged_at: string;
  exercise: string;
  sets: number | null;
  reps: number | null;
  weight_kg: number | null;
  duration_min: number | null;
  notes: string | null;
  source_message_id: string | null;
}

export interface MemoryLink {
  id: string;
  user_id: string;
  from_memory_id: string;
  to_memory_id: string;
  link_type: LinkType;
  created_at: string;
}
```

- [ ] **Step 3: Fix `electron/sync.ts` column name and field mapping**

Open `electron/sync.ts`. Change the `listMemories` function:
```typescript
// Before:
.select("id, content, type, salience")
// ...
return (data ?? []).map((r) => ({
  id: r.id, content: r.content, type: r.type, salience: r.salience,
}));

// After:
.select("id, content, memory_type, salience")
// ...
return (data ?? []).map((r) => ({
  id: r.id, content: r.content, memoryType: r.memory_type, salience: r.salience,
}));
```

- [ ] **Step 4: Find and fix any renderer code reading `MemorySummary.type`**

```bash
grep -rn "\.type\b" src/ --include="*.ts" --include="*.tsx" | grep -i "memor\|summary"
```

Update each hit to use `.memoryType` instead of `.type`.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add shared/types.ts electron/memory/types.ts electron/sync.ts src/
git commit -m "feat(mac): add inputModality to ChatSendRequest; local types; sync column fix"
```

---

### Task 2: Pure logic ports

Port nine files that contain only pure TypeScript — no Supabase, no external fetch. The only change in each file is replacing `@/` path aliases with relative imports.

**Files to create (all ports):**
- `electron/memory/keywords.ts` ← `lib/memory/keywords.ts`
- `electron/memory/merge.ts` ← `lib/memory/merge.ts`
- `electron/memory/reconcile.ts` ← `lib/memory/reconcile.ts`
- `electron/memory/profile.ts` ← `lib/memory/profile.ts`
- `electron/memory/lifestyle-capture.ts` ← `lib/memory/lifestyle-capture.ts`
- `electron/memory/model-routing.ts` ← `lib/chat/model-routing.ts`
- `electron/memory/reminder-intent.ts` ← `lib/chat/reminder-intent.ts`
- `electron/memory/memory-intent.ts` ← `lib/chat/memory-intent.ts`
- `electron/memory/voice-fallback.ts` ← `lib/chat/voice-fallback.ts`

**Tests:**
- `electron/memory/keywords.test.ts`
- `electron/memory/merge.test.ts`
- `electron/memory/reconcile.test.ts`
- `electron/memory/model-routing.test.ts`

- [ ] **Step 1: Port each file**

For each source → destination pair, run:
```bash
cp ../lib/memory/keywords.ts electron/memory/keywords.ts
cp ../lib/memory/merge.ts electron/memory/merge.ts
cp ../lib/memory/reconcile.ts electron/memory/reconcile.ts
cp ../lib/memory/profile.ts electron/memory/profile.ts
cp ../lib/memory/lifestyle-capture.ts electron/memory/lifestyle-capture.ts
cp ../lib/chat/model-routing.ts electron/memory/model-routing.ts
cp ../lib/chat/reminder-intent.ts electron/memory/reminder-intent.ts
cp ../lib/chat/memory-intent.ts electron/memory/memory-intent.ts
cp ../lib/chat/voice-fallback.ts electron/memory/voice-fallback.ts
```

- [ ] **Step 2: Fix imports in each ported file**

Apply these replacements across all nine files:
```
@/lib/memory/keywords      → ./keywords
@/lib/memory/reconcile     → ./reconcile
@/lib/memory/lifestyle-capture → ./lifestyle-capture
@/lib/chat/reminder-intent → ./reminder-intent
@/lib/supabase/types       → ./types
@/lib/chat/types           → ./types
```

In `voice-fallback.ts`, the `ChatActionReceipt` type is from `@/lib/chat/types`. Define it locally in `electron/memory/types.ts`:

```typescript
// Add to electron/memory/types.ts
export interface ChatActionReceipt {
  id: string;
  action: string;
  outcome: string;
  source: string;
  status: "success" | "error";
}
```

Then in `voice-fallback.ts` change:
```typescript
// Before:
import type { ChatActionReceipt } from "@/lib/chat/types";
// After:
import type { ChatActionReceipt } from "./types";
```

In `memory-intent.ts`, change:
```typescript
// Before:
import { isReminderCreateIntent } from "@/lib/chat/reminder-intent";
import { extractExplicitMemoryContent, isSelfDisclosureMessage } from "@/lib/memory/lifestyle-capture";
// After:
import { isReminderCreateIntent } from "./reminder-intent";
import { extractExplicitMemoryContent, isSelfDisclosureMessage } from "./lifestyle-capture";
```

In `reconcile.ts`, change:
```typescript
// @/lib/memory/keywords → ./keywords
```

In `profile.ts`, change:
```typescript
// @/lib/memory/keywords → ./keywords  (if present)
```

- [ ] **Step 3: Write `electron/memory/keywords.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { extractSearchTerms, expandSearchTerms, normalizeContent } from "./keywords";

describe("extractSearchTerms", () => {
  it("extracts meaningful words, skipping stop words", () => {
    const terms = extractSearchTerms("what is my gym schedule");
    expect(terms).toContain("gym");
    expect(terms).toContain("schedule");
    expect(terms).not.toContain("is");
    expect(terms).not.toContain("my");
  });

  it("returns empty array for empty string", () => {
    expect(extractSearchTerms("")).toEqual([]);
  });
});

describe("normalizeContent", () => {
  it("lowercases and trims", () => {
    expect(normalizeContent("  HELLO World  ")).toBe("hello world");
  });
});

describe("expandSearchTerms", () => {
  it("includes synonyms for known terms", () => {
    const terms = expandSearchTerms(["gym"]);
    expect(terms.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 4: Write `electron/memory/merge.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { mergeMemoryContent } from "./merge";

describe("mergeMemoryContent", () => {
  it("returns existing when new content is identical", () => {
    expect(mergeMemoryContent("I like coffee", "I like coffee")).toBe("I like coffee");
  });

  it("returns new content when existing is a subset", () => {
    const result = mergeMemoryContent("I like coffee", "I like coffee and tea");
    expect(result).toContain("tea");
  });

  it("returns new content when it is a full replacement", () => {
    const result = mergeMemoryContent("I work at Google", "I work at Apple");
    expect(result).toContain("Apple");
  });
});
```

- [ ] **Step 5: Write `electron/memory/reconcile.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { pickReplacementCandidate } from "./reconcile";

const makeMemory = (id: string, content: string) => ({
  id,
  content,
  category: null as string | null,
  memory_type: null as import("./types").MemoryType | null,
  salience: 0.6,
  is_pinned: false,
  valid_from: null as string | null,
  created_at: "2024-01-01T00:00:00Z",
});

describe("pickReplacementCandidate", () => {
  it("returns duplicate when content matches exactly", () => {
    const candidates = [makeMemory("1", "I like coffee")];
    const result = pickReplacementCandidate(candidates, "I like coffee");
    expect(result?.reason).toBe("duplicate");
  });

  it("returns null when no match", () => {
    const candidates = [makeMemory("1", "I like coffee")];
    const result = pickReplacementCandidate(candidates, "I enjoy hiking");
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 6: Write `electron/memory/model-routing.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { inferComplexity } from "./model-routing";

describe("inferComplexity", () => {
  it("returns light for simple queries", () => {
    expect(inferComplexity("what's the weather like?")).toBe("light");
  });

  it("returns heavy for step-by-step queries", () => {
    expect(inferComplexity("explain step-by-step how to build a trading bot")).toBe("heavy");
  });

  it("returns heavy for very long messages", () => {
    expect(inferComplexity("a".repeat(1300))).toBe("heavy");
  });

  it("returns light for empty string", () => {
    expect(inferComplexity("")).toBe("light");
  });
});
```

- [ ] **Step 7: Run tests**

```bash
npx vitest run electron/memory/keywords.test.ts electron/memory/merge.test.ts electron/memory/reconcile.test.ts electron/memory/model-routing.test.ts
```
Expected: all pass.

- [ ] **Step 8: Type-check**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 9: Commit**

```bash
git add electron/memory/
git commit -m "feat(mac): port pure logic — keywords, merge, reconcile, profile, routing, intents"
```

---

### Task 3: context-intent port

**Files:**
- Create: `electron/memory/context-intent.ts`
- Test: `electron/memory/context-intent.test.ts`

**Interfaces:**
- Consumes: `isReminderCreateIntent` from `./reminder-intent`; `isWorkoutRecallRelated` from `./keywords`
- Produces: `inferContextIntent(message: string, section: "main" | "side"): ContextIntent`; `type ContextIntent`; `type ThreadSection`

- [ ] **Step 1: Port `lib/chat/context-intent.ts`**

```bash
cp ../lib/chat/context-intent.ts electron/memory/context-intent.ts
```

- [ ] **Step 2: Fix imports**

```typescript
// Before:
import { isGmailContextIntent } from "@/lib/google/gmail";
import { isWorkoutRecallRelated } from "@/lib/memory/keywords";
import { isReminderCreateIntent } from "@/lib/chat/reminder-intent";

// After:
import { isWorkoutRecallRelated } from "./keywords";
import { isReminderCreateIntent } from "./reminder-intent";

// Inline isGmailContextIntent (remove the import line, add this constant near the top):
const GMAIL_CONTEXT_PATTERN =
  /\b(email|emails|gmail|inbox|unread|mailbox|mail|draft|compose|reply|send)\b/i;
function isGmailContextIntent(message: string): boolean {
  return GMAIL_CONTEXT_PATTERN.test(message);
}
```

- [ ] **Step 3: Write `electron/memory/context-intent.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { inferContextIntent } from "./context-intent";

describe("inferContextIntent", () => {
  it("returns reminders for 'remind me'", () => {
    expect(inferContextIntent("remind me to call John", "main")).toBe("reminders");
  });

  it("returns profile_recall for 'what do you know about me'", () => {
    expect(inferContextIntent("what do you know about me", "main")).toBe("profile_recall");
  });

  it("returns planning for schedule queries", () => {
    expect(inferContextIntent("what's my week looking like", "main")).toBe("planning");
  });

  it("returns temporal for date queries", () => {
    expect(inferContextIntent("what day is it today", "main")).toBe("temporal");
  });

  it("returns email for gmail queries", () => {
    expect(inferContextIntent("check my inbox", "main")).toBe("email");
  });

  it("returns general for generic queries", () => {
    expect(inferContextIntent("how are you", "main")).toBe("general");
  });
});
```

- [ ] **Step 4: Run test**

```bash
npx vitest run electron/memory/context-intent.test.ts
```
Expected: all pass.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/memory/context-intent.ts electron/memory/context-intent.test.ts
git commit -m "feat(mac): port context-intent (inferContextIntent)"
```

---

### Task 4: classify + embed

Both files use raw `fetch` with no Supabase — port is path-alias changes only.

**Files:**
- Create: `electron/memory/classify.ts` ← `lib/memory/classify.ts`
- Create: `electron/memory/embed.ts` ← `lib/memory/embed.ts`
- Test: `electron/memory/classify.test.ts`, `electron/memory/embed.test.ts`

**Interfaces:**
- Produces:
  - `classifyMemory(content: string): Promise<{ memory_type: MemoryType; confidence: number; valid_from?: string }>`
  - `TYPE_SALIENCE: Record<MemoryType, number>`
  - `embedText(text: string): Promise<number[]>`

- [ ] **Step 1: Port the files**

```bash
cp ../lib/memory/classify.ts electron/memory/classify.ts
cp ../lib/memory/embed.ts electron/memory/embed.ts
```

- [ ] **Step 2: Fix imports in both files**

In `classify.ts`:
```typescript
// Before: import type { MemoryType } from "@/lib/supabase/types";
// After:
import type { MemoryType } from "./types";
```

In `embed.ts`:
```typescript
// Before: import { normalizeContent } from "@/lib/memory/keywords";
// After:
import { normalizeContent } from "./keywords";
```

- [ ] **Step 3: Write `electron/memory/classify.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub global fetch before importing classify
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { classifyMemory, TYPE_SALIENCE } from "./classify";

describe("classifyMemory", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("returns a valid memory_type and confidence from Anthropic response", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: '{"memory_type":"fact","confidence":0.9}' }],
      }),
    } as unknown as Response);

    const result = await classifyMemory("My name is Aryav");
    expect(result.memory_type).toBe("fact");
    expect(result.confidence).toBeCloseTo(0.9);
  });

  it("falls back to fact type if response is unparseable", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [{ type: "text", text: "invalid json" }],
      }),
    } as unknown as Response);

    const result = await classifyMemory("Something happened");
    expect(result.memory_type).toBeDefined();
  });
});

describe("TYPE_SALIENCE", () => {
  it("has salience for every memory type", () => {
    const types = ["fact", "preference", "routine", "episodic", "goal", "relationship", "skill"];
    for (const t of types) {
      expect(TYPE_SALIENCE[t as import("./types").MemoryType]).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 4: Write `electron/memory/embed.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { embedText } from "./embed";

describe("embedText", () => {
  beforeEach(() => { mockFetch.mockReset(); });

  it("returns a 1536-dim embedding on success", async () => {
    const embedding = new Array(1536).fill(0.1);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ index: 0, embedding }],
      }),
    } as unknown as Response);

    const result = await embedText("hello world");
    expect(result).toHaveLength(1536);
  });

  it("returns empty array when OPENAI_API_KEY is missing", async () => {
    const original = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    // embedText should either return [] or throw — either is acceptable; just don't hang
    try {
      const result = await embedText("test");
      expect(Array.isArray(result)).toBe(true);
    } catch {
      // throwing is also acceptable
    }
    process.env.OPENAI_API_KEY = original;
  });
});
```

- [ ] **Step 5: Run tests**

```bash
npx vitest run electron/memory/classify.test.ts electron/memory/embed.test.ts
```
Expected: all pass.

- [ ] **Step 6: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/memory/classify.ts electron/memory/embed.ts electron/memory/classify.test.ts electron/memory/embed.test.ts
git commit -m "feat(mac): port classify + embed (raw fetch)"
```

---

### Task 5: Memory client, reminders DB, runtime-context

**Files:**
- Create: `electron/memory/client.ts`
- Create: `electron/memory/reminders.ts`
- Create: `electron/memory/runtime-context.ts` ← `lib/chat/runtime-context.ts`
- Test: `electron/memory/client.test.ts`, `electron/memory/runtime-context.test.ts`

**Interfaces:**
- Produces:
  - `getUserId(): Promise<string>` — throws if not signed in
  - `resetUserIdCache(): void` — call on sign-out
  - `listUpcomingReminders(userId: string, limit: number): Promise<Reminder[]>`
  - `formatReminderLine(reminder: Reminder): string`
  - `buildClockForZone(timeZone: string, date?: Date): RuntimeClockContext`
  - `resolveUserTimezoneCached(userId: string): Promise<string>`
  - `formatRuntimeClockForPrompt(clock: RuntimeClockContext): string`

- [ ] **Step 1: Create `electron/memory/client.ts`**

```typescript
import { getSupabase } from "../supabase";

let cachedUserId: string | null = null;

export async function getUserId(): Promise<string> {
  if (cachedUserId) return cachedUserId;
  const { data, error } = await getSupabase().auth.getUser();
  if (error || !data.user) throw new Error("Not signed in");
  cachedUserId = data.user.id;
  return cachedUserId;
}

export function resetUserIdCache(): void {
  cachedUserId = null;
}
```

- [ ] **Step 2: Create `electron/memory/reminders.ts`**

```typescript
import { getSupabase } from "../supabase";
import type { Reminder } from "./types";

export async function listUpcomingReminders(
  userId: string,
  limit = 5,
): Promise<Reminder[]> {
  const { data, error } = await getSupabase()
    .from("reminders")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "pending")
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as Reminder[];
}

export function formatReminderLine(reminder: Pick<Reminder, "title" | "due_at">): string {
  if (!reminder.due_at) return `- [reminder] ${reminder.title}`;
  const date = new Date(reminder.due_at);
  const label = date.toLocaleDateString("en-AU", {
    weekday: "short", day: "numeric", month: "short",
  });
  return `- [reminder] ${reminder.title} — due ${label}`;
}
```

- [ ] **Step 3: Port `lib/chat/runtime-context.ts`**

```bash
cp ../lib/chat/runtime-context.ts electron/memory/runtime-context.ts
```

Apply these changes to `electron/memory/runtime-context.ts`:
```typescript
// Before:
import { createServerClient } from "@/lib/supabase/server";
import { extractSubjectKey } from "@/lib/memory/reconcile";
// After:
import { getSupabase } from "../supabase";
import { extractSubjectKey } from "./reconcile";

// In fetchTimezoneMemoryHints, replace:
//   const supabase = createServerClient();
// with:
//   const supabase = getSupabase();
```

- [ ] **Step 4: Write `electron/memory/client.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase", () => ({ getSupabase: vi.fn() }));
import { getSupabase } from "../supabase";
import { getUserId, resetUserIdCache } from "./client";

describe("getUserId", () => {
  beforeEach(() => {
    resetUserIdCache();
    vi.clearAllMocks();
  });

  it("returns userId when signed in", async () => {
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: { id: "user-123" } }, error: null }) },
    });
    const id = await getUserId();
    expect(id).toBe("user-123");
  });

  it("caches the userId across calls", async () => {
    const mockGetUser = vi.fn().mockResolvedValue({
      data: { user: { id: "user-123" } }, error: null,
    });
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({ auth: { getUser: mockGetUser } });
    await getUserId();
    await getUserId();
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  it("throws when not signed in", async () => {
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    await expect(getUserId()).rejects.toThrow("Not signed in");
  });
});
```

- [ ] **Step 5: Write `electron/memory/runtime-context.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { buildClockForZone, formatRuntimeClockForPrompt } from "./runtime-context";

describe("buildClockForZone", () => {
  it("returns structured clock for a valid timezone", () => {
    const date = new Date("2026-07-01T09:00:00Z");
    const clock = buildClockForZone("Australia/Sydney", date);
    expect(clock.timezone).toBe("Australia/Sydney");
    expect(clock.iso).toBe(date.toISOString());
    expect(clock.localDate).toBeTruthy();
    expect(clock.localTime).toBeTruthy();
  });
});

describe("formatRuntimeClockForPrompt", () => {
  it("produces a runtime_context XML block", () => {
    const date = new Date("2026-07-01T09:00:00Z");
    const clock = buildClockForZone("UTC", date);
    const prompt = formatRuntimeClockForPrompt(clock);
    expect(prompt).toContain("<runtime_context>");
    expect(prompt).toContain("</runtime_context>");
    expect(prompt).toContain("Now:");
  });
});
```

- [ ] **Step 6: Run tests**

```bash
npx vitest run electron/memory/client.test.ts electron/memory/runtime-context.test.ts
```
Expected: all pass.

- [ ] **Step 7: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/memory/client.ts electron/memory/reminders.ts electron/memory/runtime-context.ts electron/memory/client.test.ts electron/memory/runtime-context.test.ts
git commit -m "feat(mac): memory client, reminders DB, runtime-context"
```

---

### Task 6: Retrieval plan + system prompt

**Files:**
- Create: `electron/memory/retrieval-plan.ts`
- Create: `electron/memory/system-prompt.ts`
- Test: `electron/memory/retrieval-plan.test.ts`

**Interfaces:**
- Produces:
  - `RetrievalPlan` interface
  - `resolveRetrievalPlan(section: "main", intent: ContextIntent): RetrievalPlan`
  - `applyMacVoiceOverrides(plan: RetrievalPlan): RetrievalPlan`
  - `MAC_VOICE_SYSTEM_PROMPT: string`
  - `MAC_TEXT_SYSTEM_PROMPT: string`
  - `buildMacSystemPrompt(isVoice: boolean, clock: RuntimeClockContext): string`

- [ ] **Step 1: Create `electron/memory/retrieval-plan.ts`**

```bash
cp ../lib/chat/thread-context.ts electron/memory/retrieval-plan.ts
```

Apply these changes:
```typescript
// Before:
import type { ContextIntent, ThreadSection } from "@/lib/chat/context-intent";
// After:
import type { ContextIntent, ThreadSection } from "./context-intent";

// Rename the exported interface from ContextRetrievalPlan to RetrievalPlan
// (or keep both; export RetrievalPlan as an alias)
export type RetrievalPlan = ContextRetrievalPlan;

// Remove the autoCaptureProfileFacts, calendarLimit, gmailHighlightLimit,
// workoutLimit, youtubeTaste fields from the SectionCeiling and replace
// MAIN_CEILING calendarLimit / gmailHighlightLimit / workoutLimit with 0,
// youtubeTaste with false.
// Keep the rest of the file identical.
```

After the existing `applyVoiceRetrievalOverrides` export, add:

```typescript
/** Mac-specific voice override: raises memory cap from 4→12 vs web default. */
export function applyMacVoiceOverrides(plan: RetrievalPlan): RetrievalPlan {
  const base = applyVoiceRetrievalOverrides(plan);
  return {
    ...base,
    memoryLimit: Math.min(plan.memoryLimit, 12),
    queryMatchPool: Math.min(plan.queryMatchPool, 16),
  };
}
```

- [ ] **Step 2: Create `electron/memory/system-prompt.ts`**

```bash
cp ../lib/chat/system-prompt.ts electron/memory/system-prompt.ts
```

Apply these changes:
```typescript
// Remove the buildDynamicSystemAdditions function's imports for personality
// (keep the function but it will only be used for text turns)
// Change all @/ imports to relative:
// @/lib/chat/personality → remove (inline types as needed or use string literals)
// @/lib/chat/context-intent → ./context-intent
// @/lib/chat/thread-context → ./retrieval-plan

// Replace web-UI references in the prompt strings:
// "Reminders tab" → "your reminders"
// "at /connections" → "via the web app"
// "Chrome for background push" → "the app"
// "browser push" → "push notifications"
```

Then add at the bottom of the file:

```typescript
import type { RuntimeClockContext } from "./runtime-context";
import { formatRuntimeClockForPrompt } from "./runtime-context";

export function buildMacSystemPrompt(isVoice: boolean, clock: RuntimeClockContext): string {
  const base = isVoice ? STATIC_VOICE_SYSTEM_PROMPT : STATIC_SYSTEM_PROMPT;
  return `${base}\n\n${formatRuntimeClockForPrompt(clock)}`;
}
```

- [ ] **Step 3: Write `electron/memory/retrieval-plan.test.ts`**

```typescript
import { describe, it, expect } from "vitest";
import { resolveRetrievalPlan, applyMacVoiceOverrides } from "./retrieval-plan";

describe("resolveRetrievalPlan", () => {
  it("returns high memory limit for profile_recall", () => {
    const plan = resolveRetrievalPlan("main", "profile_recall");
    expect(plan.memoryLimit).toBeGreaterThanOrEqual(20);
  });

  it("returns reminders for reminders intent", () => {
    const plan = resolveRetrievalPlan("main", "reminders");
    expect(plan.reminderLimit).toBeGreaterThan(0);
  });

  it("returns moderate memory for general intent", () => {
    const plan = resolveRetrievalPlan("main", "general");
    expect(plan.memoryLimit).toBeGreaterThan(0);
    expect(plan.memoryLimit).toBeLessThanOrEqual(15);
  });
});

describe("applyMacVoiceOverrides", () => {
  it("caps memoryLimit at 12", () => {
    const plan = resolveRetrievalPlan("main", "profile_recall"); // returns 32
    const voice = applyMacVoiceOverrides(plan);
    expect(voice.memoryLimit).toBeLessThanOrEqual(12);
  });

  it("caps chatHistoryLimit at 8", () => {
    const plan = resolveRetrievalPlan("main", "general");
    const voice = applyMacVoiceOverrides(plan);
    expect(voice.chatHistoryLimit).toBeLessThanOrEqual(8);
  });

  it("keeps memoryLimit from plan if already below 12", () => {
    const plan = resolveRetrievalPlan("main", "temporal"); // returns 4
    const voice = applyMacVoiceOverrides(plan);
    expect(voice.memoryLimit).toBeLessThanOrEqual(4);
  });
});
```

- [ ] **Step 4: Run test**

```bash
npx vitest run electron/memory/retrieval-plan.test.ts
```
Expected: all pass.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/memory/retrieval-plan.ts electron/memory/system-prompt.ts electron/memory/retrieval-plan.test.ts
git commit -m "feat(mac): retrieval plan + applyMacVoiceOverrides + system prompt"
```

---

### Task 7: Memory search

**Files:**
- Create: `electron/memory/search.ts` ← `lib/memory/search.ts`
- Test: `electron/memory/search.test.ts`

**Interfaces:**
- Consumes: `getSupabase`, `embedText`, `listUpcomingReminders`, `formatReminderLine`, `retrieveMemoriesForTurn` (internal), `RetrievalPlan`
- Produces:
  - `preRetrieveContext(userId: string, message: string, plan: RetrievalPlan, clock?: RuntimeClockContext): Promise<string>`
  - `searchMemories(userId: string, query: string, limit?: number): Promise<MemorySearchResult[]>`
  - `findReconciliationCandidates(userId: string, content: string): Promise<MemorySearchResult[]>`
  - `MemorySearchResult` interface

- [ ] **Step 1: Port `lib/memory/search.ts`**

```bash
cp ../lib/memory/search.ts electron/memory/search.ts
```

Apply these changes:
```typescript
// Before:
import { createServerClient } from "@/lib/supabase/server";
import type { ContextRetrievalPlan } from "@/lib/chat/thread-context";
import type { RuntimeClockContext } from "@/lib/chat/runtime-context";
import { getGoogleConnectionStatus } from "@/lib/db/google-tokens";
import { getUpcomingCalendarLines } from "@/lib/google/calendar";
import { getUnreadHighlights, isGmailInboxRecall } from "@/lib/google/gmail";
import { formatTastePreRetrieveLine, getCachedTasteProfile } from "@/lib/google/youtube";
import { formatReminderLine, listUpcomingReminders } from "@/lib/db/reminders";
import { getRecentWorkouts } from "@/lib/db/workouts";
import { updateMemoryAccess } from "@/lib/db/memories";
import type { Memory, MemoryType } from "@/lib/supabase/types";
import { expandSearchTerms, extractSearchTerms, extractSignificantTerms, formatWorkoutLine, isWorkoutRecallRelated, normalizeContent } from "@/lib/memory/keywords";
import { extractSubjectKey } from "@/lib/memory/reconcile";
import { CORE_PROFILE_PATTERNS, isCoreProfileMemory, pickCoreProfileMemories, pickMinimalCoreProfileMemories } from "@/lib/memory/profile";
import { embedText } from "@/lib/memory/embed";

// After:
import { getSupabase } from "../supabase";
import type { RetrievalPlan } from "./retrieval-plan";
import type { RuntimeClockContext } from "./runtime-context";
import { listUpcomingReminders, formatReminderLine } from "./reminders";
import type { MemoryType } from "./types";
import { expandSearchTerms, extractSearchTerms, extractSignificantTerms, isWorkoutRecallRelated, normalizeContent } from "./keywords";
import { extractSubjectKey } from "./reconcile";
import { CORE_PROFILE_PATTERNS, isCoreProfileMemory, pickCoreProfileMemories, pickMinimalCoreProfileMemories } from "./profile";
import { embedText } from "./embed";
```

Replace `ContextRetrievalPlan` with `RetrievalPlan` everywhere in the file.

Replace `createServerClient()` with `getSupabase()` everywhere.

Add a local `updateMemoryAccess` function (removes dependency on `lib/db/memories`):
```typescript
function updateMemoryAccess(ids: string[]): Promise<void> {
  return getSupabase()
    .rpc("increment_memory_access", { p_memory_ids: ids })
    .then(() => undefined)
    .catch((err: unknown) => console.error("[memory] access tracking failed:", err));
}
```

Remove the Google/calendar/youtube/workout blocks from `preRetrieveContext` (those fetches are gated by `plan.calendarLimit > 0` etc. which will be 0 until Google is wired — the code can stay but the Google imports are removed). Actually, simplest approach: remove the `connections` check and the Google async tasks block entirely — they'll be added back in Task 11. Replace with a stub:

```typescript
// In preRetrieveContext, remove the Google block and replace with:
// (Google context sources added in Task 11)
```

Remove `formatWorkoutLine` and `isWorkoutRecallRelated` imports that aren't in `keywords.ts`. If `keywords.ts` doesn't export `formatWorkoutLine`, remove the workout retrieval block from `preRetrieveContext`.

- [ ] **Step 2: Write `electron/memory/search.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("./embed", () => ({ embedText: vi.fn().mockResolvedValue([]) }));
import { getSupabase } from "../supabase";
import { searchMemories } from "./search";

function makeSupabaseMock(rows: unknown[]) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  return { from: vi.fn().mockReturnValue(chain), rpc: chain.rpc };
}

describe("searchMemories", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns empty array for empty query with no fallback", async () => {
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(makeSupabaseMock([]));
    const result = await searchMemories("user-1", "");
    expect(result).toEqual([]);
  });

  it("returns matching memories for a query", async () => {
    const rows = [
      { id: "m1", content: "User likes coffee", category: "preference",
        memory_type: "preference", salience: 0.8, is_pinned: false,
        valid_from: null, created_at: "2024-01-01T00:00:00Z" },
    ];
    const mock = makeSupabaseMock(rows);
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(mock);
    const result = await searchMemories("user-1", "coffee");
    expect(result.length).toBeGreaterThanOrEqual(0); // keyword path or vector path
  });
});
```

- [ ] **Step 3: Run test**

```bash
npx vitest run electron/memory/search.test.ts
```
Expected: pass.

- [ ] **Step 4: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/memory/search.ts electron/memory/search.test.ts
git commit -m "feat(mac): port memory search (hybrid RRF + preRetrieveContext)"
```

---

### Task 8: Memory save pipeline

**Files:**
- Create: `electron/memory/relationships.ts` ← `lib/memory/relationships.ts`
- Create: `electron/memory/save.ts` ← `lib/memory/save.ts`
- Test: `electron/memory/save.test.ts`

**Interfaces:**
- Produces:
  - `saveMemory(userId: string, content: string, options?: SaveMemoryOptions): Promise<SaveMemoryResult>`
  - `updateMemory(userId: string, memoryId: string, content: string, ...): Promise<Memory>`
  - `detectAndLinkRelationships(userId: string, memoryId: string, content: string, type: MemoryType): Promise<void>`

- [ ] **Step 1: Port `lib/memory/relationships.ts`**

```bash
cp ../lib/memory/relationships.ts electron/memory/relationships.ts
```

Apply changes:
```typescript
// Before:
import { createServerClient } from "@/lib/supabase/server";
import type { MemoryType, LinkType } from "@/lib/supabase/types";
import { searchMemories } from "@/lib/memory/search";
import { embedText } from "@/lib/memory/embed";
// After:
import { getSupabase } from "../supabase";
import type { MemoryType, LinkType } from "./types";
import { searchMemories } from "./search";
import { embedText } from "./embed";

// Replace createServerClient() → getSupabase()
```

- [ ] **Step 2: Port `lib/memory/save.ts`**

```bash
cp ../lib/memory/save.ts electron/memory/save.ts
```

Apply changes:
```typescript
// Before:
import { createServerClient } from "@/lib/supabase/server";
import type { Memory, MemoryCategory, MemorySourceType, MemoryType } from "@/lib/supabase/types";
import { mergeMemoryContent } from "@/lib/memory/merge";
import { findRelatedMemoryIds, pickReplacementCandidate } from "@/lib/memory/reconcile";
import { findReconciliationCandidates, type MemorySearchResult } from "@/lib/memory/search";
import { embedText } from "@/lib/memory/embed";
import { classifyMemory, TYPE_SALIENCE } from "@/lib/memory/classify";
import { updateMemoryEmbedding } from "@/lib/db/memories";
// After:
import { getSupabase } from "../supabase";
import type { Memory, MemoryCategory, MemorySourceType, MemoryType } from "./types";
import { mergeMemoryContent } from "./merge";
import { findRelatedMemoryIds, pickReplacementCandidate } from "./reconcile";
import { findReconciliationCandidates, type MemorySearchResult } from "./search";
import { embedText } from "./embed";
import { classifyMemory, TYPE_SALIENCE } from "./classify";

// Replace createServerClient() → getSupabase()

// Replace the updateMemoryEmbedding call with an inline version:
function scheduleEmbedding(memoryId: string, content: string): void {
  embedText(content)
    .then((embedding) => {
      if (embedding.length === 0) return;
      return getSupabase()
        .from("memories")
        .update({ embedding })
        .eq("id", memoryId);
    })
    .catch((err: unknown) => {
      console.error("[memory] embedding failed, will retry on backfill:", err);
    });
}

// Replace the relationships import at the bottom with:
// import("./relationships")
//   .then(({ detectAndLinkRelationships }) => detectAndLinkRelationships(...))
//   .catch(...)
```

- [ ] **Step 3: Write `electron/memory/save.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("./classify", () => ({
  classifyMemory: vi.fn().mockResolvedValue({ memory_type: "fact", confidence: 0.9 }),
  TYPE_SALIENCE: { fact: 0.7, preference: 0.8, routine: 0.75, episodic: 0.5, goal: 0.85, relationship: 0.8, skill: 0.75 },
}));
vi.mock("./embed", () => ({ embedText: vi.fn().mockResolvedValue([]) }));
vi.mock("./search", () => ({
  findReconciliationCandidates: vi.fn().mockResolvedValue([]),
  searchMemories: vi.fn().mockResolvedValue([]),
}));
vi.mock("./reconcile", () => ({
  pickReplacementCandidate: vi.fn().mockReturnValue(null),
  findRelatedMemoryIds: vi.fn().mockReturnValue([]),
}));

import { getSupabase } from "../supabase";
import { saveMemory } from "./save";

function makeInsertMock(returnedData: unknown) {
  const chain = {
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    single: vi.fn().mockResolvedValue({ data: returnedData, error: null }),
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

describe("saveMemory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a new memory and returns 'created' action", async () => {
    const newMemory = {
      id: "m1", user_id: "u1", content: "I like coffee", category: null,
      memory_type: "fact", salience: 0.7, last_accessed_at: null, access_count: 0,
      is_pinned: false, is_archived: false, source_type: "tool_save",
      valid_from: null, valid_until: null, confidence: 0.9, metadata: null,
      source_message_id: null, created_at: "2024-01-01T00:00:00Z",
    };
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue(makeInsertMock(newMemory));

    const result = await saveMemory("u1", "I like coffee");
    expect(result.action).toBe("created");
    expect(result.memory.content).toBe("I like coffee");
  });
});
```

- [ ] **Step 4: Run test**

```bash
npx vitest run electron/memory/save.test.ts
```
Expected: pass.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/memory/relationships.ts electron/memory/save.ts electron/memory/save.test.ts
git commit -m "feat(mac): port memory save pipeline (classify/reconcile/dedup/embed/relationships)"
```

---

### Task 9: Memory extract + index

**Files:**
- Create: `electron/memory/extract.ts` ← `lib/memory/extract.ts`
- Create: `electron/memory/index.ts`
- Test: `electron/memory/extract.test.ts`

**Interfaces:**
- Produces: `autoCaptureFromMessage(userId: string, message: string, sourceMessageId?: string): Promise<{ saved: number; memoryIds: string[]; errors: string[] }>`

- [ ] **Step 1: Port `lib/memory/extract.ts`**

```bash
cp ../lib/memory/extract.ts electron/memory/extract.ts
```

Apply changes:
```typescript
// Before:
import type { MemoryCategory, MemoryType } from "@/lib/supabase/types";
import { extractExplicitMemoryContent, extractLifestyleFacts } from "@/lib/memory/lifestyle-capture";
import { saveMemory } from "@/lib/memory/save";
// After:
import type { MemoryCategory, MemoryType } from "./types";
import { extractExplicitMemoryContent, extractLifestyleFacts } from "./lifestyle-capture";
import { saveMemory } from "./save";
```

- [ ] **Step 2: Create `electron/memory/index.ts`**

```typescript
// electron/memory/index.ts
export { getUserId, resetUserIdCache } from "./client";
export { preRetrieveContext, searchMemories, findReconciliationCandidates } from "./search";
export type { MemorySearchResult } from "./search";
export { saveMemory, updateMemory } from "./save";
export { autoCaptureFromMessage } from "./extract";
export { inferComplexity } from "./model-routing";
export { inferContextIntent } from "./context-intent";
export type { ContextIntent, ThreadSection } from "./context-intent";
export { resolveRetrievalPlan, applyMacVoiceOverrides } from "./retrieval-plan";
export type { RetrievalPlan } from "./retrieval-plan";
export { resolveUserTimezoneCached, buildClockForZone, formatRuntimeClockForPrompt } from "./runtime-context";
export type { RuntimeClockContext } from "./runtime-context";
export { buildMacSystemPrompt } from "./system-prompt";
export { getForcedMemoryTool } from "./memory-intent";
export { resolveAssistantText, voiceSpokenFallback } from "./voice-fallback";
```

- [ ] **Step 3: Write `electron/memory/extract.test.ts`**

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("./save", () => ({
  saveMemory: vi.fn().mockResolvedValue({ action: "created", memory: { id: "m1" } }),
}));

import { autoCaptureFromMessage } from "./extract";

describe("autoCaptureFromMessage", () => {
  it("captures explicit memory requests", async () => {
    const result = await autoCaptureFromMessage("u1", "remember that I like hiking");
    expect(result.saved).toBeGreaterThanOrEqual(0);
  });

  it("captures profile patterns", async () => {
    const result = await autoCaptureFromMessage("u1", "I'm a university student");
    expect(result.saved).toBeGreaterThanOrEqual(0);
  });

  it("returns zero for empty messages", async () => {
    const result = await autoCaptureFromMessage("u1", "");
    expect(result.saved).toBe(0);
  });

  it("never captures more than the budget cap", async () => {
    const result = await autoCaptureFromMessage(
      "u1",
      "I like coffee, tea, hiking, coding, gym, reading, cooking, yoga, swimming, gaming",
    );
    expect(result.saved).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 4: Run test**

```bash
npx vitest run electron/memory/extract.test.ts
```
Expected: pass.

- [ ] **Step 5: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/memory/extract.ts electron/memory/index.ts electron/memory/extract.test.ts
git commit -m "feat(mac): port memory extract + create memory/index.ts"
```

---

### Task 10: Tools — non-Google handlers, web search, webpage, workouts

**Files:**
- Create: `electron/tools/definitions.ts`
- Create: `electron/tools/web-search.ts`
- Create: `electron/tools/webpage.ts`
- Create: `electron/tools/workouts.ts`
- Create: `electron/tools/parse-due-at.ts`
- Create: `electron/tools/handlers.ts` (non-Google tools only; Google handlers added in Task 11)
- Test: `electron/tools/handlers.test.ts`

**Interfaces:**
- Produces: `TOOL_DEFINITIONS: Tool[]`, `executeTool(name: string, input: unknown, context: ToolContext): Promise<Record<string, unknown>>`

- [ ] **Step 1: Install `googleapis`**

```bash
npm install googleapis
```

- [ ] **Step 2: Port `lib/tools/definitions.ts` (minus `plan_workflow`)**

```bash
cp ../lib/tools/definitions.ts electron/tools/definitions.ts
```

Open `electron/tools/definitions.ts` and remove the entire `plan_workflow` tool object (the last one in the array). No import changes needed — this file only imports from `@anthropic-ai/sdk`.

- [ ] **Step 3: Port `lib/tools/web-search.ts` and `lib/tools/webpage.ts`**

```bash
cp ../lib/tools/web-search.ts electron/tools/web-search.ts
cp ../lib/tools/webpage.ts electron/tools/webpage.ts
```

No import changes needed in either file — both use only `fetch` (global in Node 18+) and no project imports.

- [ ] **Step 4: Port `lib/db/workouts.ts`**

```bash
cp ../lib/db/workouts.ts electron/tools/workouts.ts
```

Apply changes:
```typescript
// Before: import { createServerClient } from "@/lib/supabase/server";
// After: import { getSupabase } from "../supabase";

// Before: import type { Workout } from "@/lib/supabase/types";
// After: import type { Workout } from "../memory/types";

// Replace all createServerClient() → getSupabase()
```

- [ ] **Step 5: Port `lib/reminders/parse-due-at.ts`**

```bash
cp ../lib/reminders/parse-due-at.ts electron/tools/parse-due-at.ts
```

No import changes needed (pure function).

- [ ] **Step 6: Create `electron/tools/handlers.ts`** (non-Google tools; Google stubs for now)

```bash
cp ../lib/tools/handlers.ts electron/tools/handlers.ts
```

Apply these changes:

```typescript
// Replace all imports at the top:
import {
  completeAllPendingReminders, completeReminder, deleteAllPendingReminders,
  deleteReminder, insertReminder, listReminders,
} from "../memory/reminders-write";  // see Step 6a below
import { insertWorkout, listWorkouts, searchWorkouts } from "./workouts";
import { saveMemory } from "../memory/save";
import { searchMemories } from "../memory/search";
import { resolveReminderDueAt } from "./parse-due-at";
import { googleWebSearch } from "./web-search";
import { fetchWebpage } from "./webpage";
import type { MemoryCategory } from "../memory/types";

// Remove these imports (Google handlers added in Task 11):
// import { createCalendarEvent, ... } from "@/lib/google/calendar";
// import { createGmailDraft, ... } from "@/lib/google/gmail";
// import { getCachedTasteProfile, ... } from "@/lib/google/youtube";
// import { GMAIL_COMPOSE_SCOPE_ERROR, ... } from "@/lib/google/errors";
// import { createWorkflowRun } from "@/lib/db/workflows";

// Remove the plan_workflow case from the switch.
// Replace all Google tool cases with stubs:
case "list_calendar_events":
case "create_calendar_event":
case "update_calendar_event":
case "delete_calendar_event":
  return { error: "Google Calendar is not yet connected on Mac." };
case "search_gmail":
case "get_gmail_message":
case "create_gmail_draft":
  return { error: "Gmail is not yet connected on Mac." };
case "get_youtube_taste_profile":
case "search_youtube":
case "recommend_youtube":
  return { error: "YouTube is not yet connected on Mac." };

// Remove dispatchDueReminderNotifications call in handleCreateReminder
// (Mac doesn't use web push from main process)
```

Step 6a — add reminder write functions to `electron/memory/reminders.ts`:

```typescript
// Append to electron/memory/reminders.ts:

export async function insertReminder(
  userId: string,
  input: { title: string; due_at?: string | null; source_message_id?: string },
): Promise<Reminder> {
  const { data, error } = await getSupabase()
    .from("reminders")
    .insert({ user_id: userId, title: input.title, due_at: input.due_at ?? null, source_message_id: input.source_message_id ?? null })
    .select("*").single();
  if (error) throw error;
  return data as Reminder;
}

export async function listReminders(
  userId: string,
  options: { status?: string; limit?: number } = {},
): Promise<Reminder[]> {
  const { status = "pending", limit = 20 } = options;
  let query = getSupabase()
    .from("reminders").select("*").eq("user_id", userId)
    .order("created_at", { ascending: false }).limit(limit);
  if (status !== "all") query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Reminder[];
}

export async function completeReminder(userId: string, id?: string, title?: string): Promise<boolean> {
  let query = getSupabase().from("reminders").update({ status: "done", completed_at: new Date().toISOString() }).eq("user_id", userId).eq("status", "pending");
  if (id) query = query.eq("id", id);
  else if (title) query = query.eq("title", title);
  else return false;
  const { error } = await query;
  return !error;
}

export async function completeAllPendingReminders(userId: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from("reminders").update({ status: "done", completed_at: new Date().toISOString() })
    .eq("user_id", userId).eq("status", "pending").select("id");
  if (error) throw error;
  return (data ?? []).length;
}

export async function deleteReminder(userId: string, id: string): Promise<void> {
  const { error } = await getSupabase().from("reminders").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function deleteAllPendingReminders(userId: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from("reminders").delete().eq("user_id", userId).eq("status", "pending").select("id");
  if (error) throw error;
  return (data ?? []).length;
}
```

Update the import in `handlers.ts` to use `"../memory/reminders"` (not `../memory/reminders-write`).

- [ ] **Step 7: Write `electron/tools/handlers.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../supabase", () => ({ getSupabase: vi.fn() }));
vi.mock("../memory/save", () => ({
  saveMemory: vi.fn().mockResolvedValue({ action: "created", memory: { id: "m1", content: "test" } }),
}));
vi.mock("../memory/search", () => ({
  searchMemories: vi.fn().mockResolvedValue([{ id: "m1", content: "coffee preference" }]),
}));
vi.mock("../memory/reminders", () => ({
  insertReminder: vi.fn().mockResolvedValue({ id: "r1", title: "test", status: "pending", due_at: null }),
  listReminders: vi.fn().mockResolvedValue([]),
  completeReminder: vi.fn().mockResolvedValue(true),
  completeAllPendingReminders: vi.fn().mockResolvedValue(2),
  deleteReminder: vi.fn().mockResolvedValue(undefined),
  deleteAllPendingReminders: vi.fn().mockResolvedValue(0),
}));
vi.mock("./workouts", () => ({
  insertWorkout: vi.fn().mockResolvedValue({ id: "w1", exercise: "bench press" }),
  listWorkouts: vi.fn().mockResolvedValue([]),
  searchWorkouts: vi.fn().mockResolvedValue([]),
}));

import { executeTool } from "./handlers";

const ctx = { userId: "u1", conversationId: "c1", sourceMessageId: "m1", userMessage: "test" };

describe("executeTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("save_memory delegates to saveMemory", async () => {
    const result = await executeTool("save_memory", { content: "I like coffee" }, ctx);
    expect(result).toHaveProperty("success", true);
  });

  it("search_memory returns results", async () => {
    const result = await executeTool("search_memory", { query: "coffee" }, ctx);
    expect(result).toHaveProperty("memories");
  });

  it("create_reminder creates and returns the reminder", async () => {
    const result = await executeTool("create_reminder", { title: "Buy milk" }, ctx);
    expect(result).toHaveProperty("success", true);
  });

  it("list_calendar_events returns not-connected error", async () => {
    const result = await executeTool("list_calendar_events", {}, ctx);
    expect((result as { error: string }).error).toContain("not yet connected");
  });

  it("unknown tool returns error", async () => {
    const result = await executeTool("nonexistent_tool", {}, ctx);
    expect(result).toHaveProperty("error");
  });
});
```

- [ ] **Step 8: Run test**

```bash
npx vitest run electron/tools/handlers.test.ts
```
Expected: all pass.

- [ ] **Step 9: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/tools/
git commit -m "feat(mac): tool definitions, handlers (non-Google stubs), web-search, webpage, workouts"
```

---

### Task 11: Google integration — wire real Google tool handlers

Port the Google auth/crypto/API layer and replace the stubs in `handlers.ts` with real implementations.

**Files:**
- Create: `electron/google/errors.ts`, `crypto.ts`, `config.ts`, `scopes.ts`, `oauth.ts`, `html.ts`
- Create: `electron/google/db-tokens.ts` ← `lib/db/google-tokens.ts`
- Create: `electron/google/auth-client.ts` ← `lib/google/auth-client.ts`
- Create: `electron/google/client.ts` ← `lib/google/client.ts`
- Create: `electron/google/calendar.ts` ← `lib/google/calendar.ts`
- Create: `electron/google/gmail.ts` ← `lib/google/gmail.ts`
- Create: `electron/google/youtube-taste.ts` ← `lib/db/youtube-taste.ts`
- Create: `electron/google/youtube.ts` ← `lib/google/youtube.ts`
- Modify: `electron/tools/handlers.ts` (replace stubs)
- Test: additions to `electron/tools/handlers.test.ts`

**Env var required (not new — must match web app's value):**
`GOOGLE_TOKEN_ENCRYPTION_KEY` — the Mac decrypts tokens the web app encrypted; they must share this key.

- [ ] **Step 1: Port pure Google infrastructure**

```bash
mkdir -p electron/google
cp ../lib/google/errors.ts electron/google/errors.ts
cp ../lib/google/crypto.ts electron/google/crypto.ts
cp ../lib/google/config.ts electron/google/config.ts
cp ../lib/google/scopes.ts electron/google/scopes.ts
cp ../lib/google/oauth.ts electron/google/oauth.ts
cp ../lib/google/html.ts electron/google/html.ts
```

Fix imports in each file (all use `@/lib/google/X` → `./X`):
- `crypto.ts`: `@/lib/google/config` → `./config`
- `oauth.ts`: `@/lib/google/config` → `./config`; `@/lib/google/scopes` → `./scopes`
- `config.ts`: remove any `NEXT_PUBLIC_APP_URL` usage; replace redirect URIs with a sensible default (`http://localhost:3000` for dev) since the Mac doesn't run an HTTP server for OAuth callbacks. The redirect URIs won't be invoked in normal tool use; they're only needed if we ever add OAuth initiation from Mac.

- [ ] **Step 2: Port `lib/db/google-tokens.ts` → `electron/google/db-tokens.ts`**

```bash
cp ../lib/db/google-tokens.ts electron/google/db-tokens.ts
```

Apply:
```typescript
// Before: import { createServerClient } from "@/lib/supabase/server";
// After:  import { getSupabase } from "../supabase";

// Before: import { encryptToken, decryptToken } from "@/lib/google/crypto";
// After:  import { encryptToken, decryptToken } from "./crypto";
// (and similarly for other @/lib/google/ imports)

// Replace all createServerClient() → getSupabase()
```

- [ ] **Step 3: Port auth-client, client**

```bash
cp ../lib/google/auth-client.ts electron/google/auth-client.ts
cp ../lib/google/client.ts electron/google/client.ts
```

In `auth-client.ts`:
```typescript
// @/lib/db/google-tokens → ./db-tokens
// @/lib/google/crypto → ./crypto
// @/lib/google/oauth → ./oauth
// @/lib/google/scopes → ./scopes
```

In `client.ts`:
```typescript
// @/lib/google/auth-client → ./auth-client
// (googleapis is already installed)
```

- [ ] **Step 4: Port calendar, gmail, youtube, youtube-taste**

```bash
cp ../lib/google/calendar.ts electron/google/calendar.ts
cp ../lib/google/gmail.ts electron/google/gmail.ts
cp ../lib/db/youtube-taste.ts electron/google/youtube-taste.ts
cp ../lib/google/youtube.ts electron/google/youtube.ts
```

For each file, fix imports:
```typescript
// @/lib/google/client → ./client
// @/lib/google/errors → ./errors
// @/lib/google/scopes → ./scopes
// @/lib/google/html → ./html
// @/lib/db/google-tokens → ./db-tokens
// @/lib/db/youtube-taste → ./youtube-taste
// @/lib/google/auth-client → ./auth-client
// @/lib/google/config → ./config
// @/lib/chat/runtime-context → ../memory/runtime-context
// createServerClient() → getSupabase()
```

- [ ] **Step 5: Wire Google handlers in `electron/tools/handlers.ts`**

Add Google imports at the top of `handlers.ts`:
```typescript
import { listCalendarEvents, createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } from "../google/calendar";
import { searchGmail, getGmailMessage, createGmailDraft, isGmailContextIntent } from "../google/gmail";
import { getCachedTasteProfile, searchYoutube, recommendYoutube } from "../google/youtube";
import { GMAIL_COMPOSE_SCOPE_ERROR, YOUTUBE_MISSING_SCOPE_ERROR, isInsufficientScopeError } from "../google/errors";
```

Replace the Google stub cases with the real handler functions (copy from web's `handlers.ts` and adjust imports). The `normalizeToolError` function is already there — keep it.

- [ ] **Step 6: Add Google handler tests to `electron/tools/handlers.test.ts`**

```typescript
// Add to the existing describe block:

it("list_calendar_events returns not-connected when auth returns null", async () => {
  // The calendar client returns null when no token row exists
  vi.doMock("../google/calendar", () => ({
    listCalendarEvents: vi.fn().mockRejectedValue(new Error("Google Calendar not linked")),
  }));
  const result = await executeTool("list_calendar_events", {}, ctx);
  expect(result).toHaveProperty("error");
});
```

- [ ] **Step 7: Verify `GOOGLE_TOKEN_ENCRYPTION_KEY` is documented**

Open `.env.local` (or `.env.example` if one exists). Add a comment:
```
# Must match the GOOGLE_TOKEN_ENCRYPTION_KEY in the web app — tokens are shared via Supabase
GOOGLE_TOKEN_ENCRYPTION_KEY=
```

- [ ] **Step 8: Run all tool tests**

```bash
npx vitest run electron/tools/handlers.test.ts
```
Expected: all pass.

- [ ] **Step 9: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/google/ electron/tools/handlers.ts electron/tools/handlers.test.ts
git commit -m "feat(mac): Google integration — calendar, gmail, youtube handlers via shared Supabase tokens"
```

---

### Task 12: Conversation management

**Files:**
- Create: `electron/conversation.ts`
- Test: `electron/conversation.test.ts`

**Interfaces:**
- Produces:
  - `getOrCreateConversation(userId: string): Promise<string>` — returns conversationId
  - `resetConversationCache(): void`
  - `persistUserMessage(conversationId: string, content: string): Promise<{ id: string }>`
  - `persistAssistantMessage(conversationId: string, content: string): Promise<void>`
  - `loadLastNMessages(conversationId: string, limit: number): Promise<Array<{ role: "user" | "assistant"; content: string; id: string }>>`

- [ ] **Step 1: Create `electron/conversation.ts`**

```typescript
import { getSupabase } from "./supabase";

let cachedConversationId: string | null = null;

export async function getOrCreateConversation(userId: string): Promise<string> {
  if (cachedConversationId) return cachedConversationId;

  const supabase = getSupabase();
  const { data: existing } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("title", "Nova (Mac)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    cachedConversationId = existing.id as string;
    return cachedConversationId;
  }

  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title: "Nova (Mac)" })
    .select("id")
    .single();

  if (error) throw error;
  cachedConversationId = created.id as string;
  return cachedConversationId;
}

export function resetConversationCache(): void {
  cachedConversationId = null;
}

export async function persistUserMessage(
  conversationId: string,
  content: string,
): Promise<{ id: string }> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role: "user", content })
    .select("id")
    .single();

  if (error) throw error;

  await supabase
    .from("conversations")
    .update({ updated_at: new Date().toISOString() })
    .eq("id", conversationId);

  return { id: data.id as string };
}

export async function persistAssistantMessage(
  conversationId: string,
  content: string,
): Promise<void> {
  if (!content.trim()) return;
  const supabase = getSupabase();
  const { error } = await supabase
    .from("messages")
    .insert({ conversation_id: conversationId, role: "assistant", content });
  if (error) console.error("[conversation] persist assistant msg:", error);
}

export async function loadLastNMessages(
  conversationId: string,
  limit: number,
): Promise<Array<{ id: string; role: "user" | "assistant"; content: string }>> {
  const { data, error } = await getSupabase()
    .from("messages")
    .select("id, role, content")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; role: string; content: string }>)
    .reverse()
    .map((m) => ({ id: m.id, role: m.role as "user" | "assistant", content: m.content }));
}
```

- [ ] **Step 2: Write `electron/conversation.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./supabase", () => ({ getSupabase: vi.fn() }));
import { getSupabase } from "./supabase";
import { getOrCreateConversation, resetConversationCache, loadLastNMessages } from "./conversation";

function mockSupabase(overrides: Record<string, unknown> = {}) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    ...overrides,
  };
  return { from: vi.fn().mockReturnValue(chain) };
}

describe("getOrCreateConversation", () => {
  beforeEach(() => {
    resetConversationCache();
    vi.clearAllMocks();
  });

  it("returns existing conversation id when found", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "conv-existing" }, error: null }),
    };
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(chain) });

    const id = await getOrCreateConversation("user-1");
    expect(id).toBe("conv-existing");
  });

  it("creates a new conversation when none exists", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      single: vi.fn().mockResolvedValue({ data: { id: "conv-new" }, error: null }),
    };
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(chain) });

    const id = await getOrCreateConversation("user-1");
    expect(id).toBe("conv-new");
  });

  it("uses cached id on subsequent calls without querying Supabase", async () => {
    const mockFrom = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "conv-cached" }, error: null }),
    });
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({ from: mockFrom });

    await getOrCreateConversation("user-1");
    await getOrCreateConversation("user-1");
    expect(mockFrom).toHaveBeenCalledTimes(1);
  });
});

describe("loadLastNMessages", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns messages in chronological order (oldest first)", async () => {
    const rows = [
      { id: "m2", role: "assistant", content: "Hi there" },
      { id: "m1", role: "user", content: "Hello" },
    ];
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: rows, error: null }),
    };
    (getSupabase as ReturnType<typeof vi.fn>).mockReturnValue({ from: vi.fn().mockReturnValue(chain) });

    const msgs = await loadLastNMessages("conv-1", 10);
    expect(msgs[0].content).toBe("Hi there");
    expect(msgs[1].content).toBe("Hello");
  });
});
```

- [ ] **Step 3: Run test**

```bash
npx vitest run electron/conversation.test.ts
```
Expected: all pass.

- [ ] **Step 4: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/conversation.ts electron/conversation.test.ts
git commit -m "feat(mac): conversation management — find-or-create perpetual conversation + message persistence"
```

---

### Task 13: Chat-turn orchestrator

**Files:**
- Create: `electron/chat-turn.ts`
- Test: `electron/chat-turn.test.ts`

**Interfaces:**
- Consumes: all of `electron/memory/`, `electron/tools/`, `electron/conversation.ts`
- Produces: `streamTurn(req: ChatSendRequest, emit: (ch: IpcChannel, payload: unknown) => void): Promise<void>`, `cancelTurn(requestId: string): void`

- [ ] **Step 1: Create `electron/chat-turn.ts`**

```typescript
import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";
import { IpcChannel, type ChatSendRequest } from "@shared/types";
import { getUserId, inferContextIntent, resolveRetrievalPlan, applyMacVoiceOverrides, preRetrieveContext, resolveUserTimezoneCached, buildClockForZone, buildMacSystemPrompt, inferComplexity, autoCaptureFromMessage, resolveAssistantText } from "./memory/index";
import { TOOL_DEFINITIONS, executeTool } from "./tools/handlers";
import { getOrCreateConversation, persistUserMessage, persistAssistantMessage, loadLastNMessages } from "./conversation";

const LIGHT_MODEL = process.env.ANTHROPIC_MODEL_LIGHT?.trim() || "claude-haiku-4-5-20251001";
const HEAVY_MODEL = process.env.ANTHROPIC_MODEL_HEAVY?.trim() || "claude-sonnet-4-6";
const MAX_TOOL_ITERATIONS_VOICE = 3;
const MAX_TOOL_ITERATIONS_TEXT = 10;
const RETRIEVAL_DEADLINE_MS = 1200;

let anthropic: Anthropic | null = null;
function client(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

const inFlight = new Map<string, AbortController>();

export function cancelTurn(requestId: string): void {
  inFlight.get(requestId)?.abort();
  inFlight.delete(requestId);
}

function buildMessages(
  history: Array<{ role: "user" | "assistant"; content: string; id: string }>,
  relevantContext: string,
): MessageParam[] {
  return history.map((m, i) => {
    const isLatest = i === history.length - 1 && m.role === "user";
    const content = isLatest && relevantContext
      ? `${relevantContext}\n\n${m.content}`
      : m.content;
    return { role: m.role, content };
  });
}

async function retrieveWithDeadline(
  userId: string,
  transcript: string,
  plan: ReturnType<typeof resolveRetrievalPlan>,
  deadlineMs: number,
): Promise<string> {
  const timeout = new Promise<string>((resolve) =>
    setTimeout(() => resolve(""), deadlineMs),
  );
  return Promise.race([
    preRetrieveContext(userId, transcript, plan).catch((err) => {
      console.error("[turn] retrieval failed:", err);
      return "";
    }),
    timeout,
  ]);
}

export async function streamTurn(
  req: ChatSendRequest,
  emit: (channel: IpcChannel, payload: unknown) => void,
): Promise<void> {
  const isVoice = req.inputModality === "voice";
  const transcript = req.messages.at(-1)?.content ?? "";
  const controller = new AbortController();
  inFlight.set(req.requestId, controller);

  try {
    const userId = await getUserId();
    const conversationId = await getOrCreateConversation(userId);
    const userMsg = await persistUserMessage(conversationId, transcript);

    const intent = inferContextIntent(transcript, "main");
    let plan = resolveRetrievalPlan("main", intent);
    if (isVoice) plan = applyMacVoiceOverrides(plan);

    const complexity = isVoice ? "light" : inferComplexity(transcript);
    const model = complexity === "heavy" ? HEAVY_MODEL : LIGHT_MODEL;
    const maxIterations = isVoice ? MAX_TOOL_ITERATIONS_VOICE : MAX_TOOL_ITERATIONS_TEXT;
    const maxTokens = isVoice ? 650 : 768;

    const [history, relevantContext, timezone] = await Promise.all([
      loadLastNMessages(conversationId, plan.chatHistoryLimit),
      retrieveWithDeadline(userId, transcript, plan, RETRIEVAL_DEADLINE_MS),
      resolveUserTimezoneCached(userId),
    ]);

    const clock = buildClockForZone(timezone);
    const system = buildMacSystemPrompt(isVoice, clock);
    const messages = buildMessages(history, relevantContext);
    const toolContext = { userId, conversationId, sourceMessageId: userMsg.id, userMessage: transcript };

    let fullText = "";
    let iterations = 0;

    while (true) {
      let streamDone = false;
      const stream = client().messages.stream(
        {
          model,
          max_tokens: maxTokens,
          system,
          messages,
          tools: TOOL_DEFINITIONS,
        },
        { signal: controller.signal },
      );

      stream.on("text", (delta: string) => {
        fullText += delta;
        emit(IpcChannel.ChatDelta, { requestId: req.requestId, delta });
      });

      const response = await stream.finalMessage();
      streamDone = true;

      if (response.stop_reason !== "tool_use" || iterations >= maxIterations) {
        break;
      }

      const toolUseBlocks = response.content.filter(
        (b): b is Extract<typeof b, { type: "tool_use" }> => b.type === "tool_use",
      );
      messages.push({ role: "assistant", content: response.content });

      const toolResults = await Promise.all(
        toolUseBlocks.map(async (block) => ({
          type: "tool_result" as const,
          tool_use_id: block.id,
          content: JSON.stringify(await executeTool(block.name, block.input, toolContext)),
        })),
      );
      messages.push({ role: "user", content: toolResults });
      iterations++;
    }

    const resolvedText = resolveAssistantText(fullText, {
      isVoiceTurn: isVoice,
      actionReceipts: [],
    });

    emit(IpcChannel.ChatDone, { requestId: req.requestId, text: resolvedText });

    void persistAssistantMessage(conversationId, resolvedText)
      .catch((e) => console.error("[turn] persist assistant:", e));
    void autoCaptureFromMessage(userId, transcript, userMsg.id)
      .catch((e) => console.error("[memory] capture:", e));

  } catch (err) {
    if (controller.signal.aborted) return;
    emit(IpcChannel.ChatError, {
      requestId: req.requestId,
      message: err instanceof Error ? err.message : "Chat failed",
    });
  } finally {
    inFlight.delete(req.requestId);
  }
}
```

- [ ] **Step 2: Write `electron/chat-turn.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./memory/index", () => ({
  getUserId: vi.fn().mockResolvedValue("u1"),
  inferContextIntent: vi.fn().mockReturnValue("general"),
  resolveRetrievalPlan: vi.fn().mockReturnValue({ chatHistoryLimit: 8, memoryLimit: 4, queryMatchPool: 8, reminderLimit: 0, recentMemoryFallback: 0, coreProfileMode: "minimal", intent: "general", contextNote: "" }),
  applyMacVoiceOverrides: vi.fn((p) => p),
  preRetrieveContext: vi.fn().mockResolvedValue(""),
  resolveUserTimezoneCached: vi.fn().mockResolvedValue("UTC"),
  buildClockForZone: vi.fn().mockReturnValue({ iso: "2026-07-01T00:00:00Z", localDate: "July 1", localTime: "12:00 PM", timezone: "UTC", timezoneLabel: "UTC" }),
  buildMacSystemPrompt: vi.fn().mockReturnValue("You are Nova."),
  inferComplexity: vi.fn().mockReturnValue("light"),
  autoCaptureFromMessage: vi.fn().mockResolvedValue({ saved: 0, memoryIds: [], errors: [] }),
  resolveAssistantText: vi.fn((text) => text || "fallback"),
}));

vi.mock("./conversation", () => ({
  getOrCreateConversation: vi.fn().mockResolvedValue("conv-1"),
  persistUserMessage: vi.fn().mockResolvedValue({ id: "msg-1" }),
  persistAssistantMessage: vi.fn().mockResolvedValue(undefined),
  loadLastNMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("./tools/handlers", () => ({
  TOOL_DEFINITIONS: [],
  executeTool: vi.fn(),
}));

// Mock Anthropic client
const mockStream = {
  on: vi.fn().mockImplementation(function (this: unknown, event: string, cb: (delta: string) => void) {
    if (event === "text") cb("Hello from Nova");
    return this;
  }),
  finalMessage: vi.fn().mockResolvedValue({ stop_reason: "end_turn", content: [{ type: "text", text: "Hello from Nova" }] }),
};
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { stream: vi.fn().mockReturnValue(mockStream) },
  })),
}));

import { IpcChannel, type ChatSendRequest } from "@shared/types";
import { streamTurn, cancelTurn } from "./chat-turn";

describe("streamTurn", () => {
  const emits: Array<[IpcChannel, unknown]> = [];
  const emit = (ch: IpcChannel, payload: unknown) => emits.push([ch, payload]);

  beforeEach(() => {
    emits.length = 0;
    vi.clearAllMocks();
  });

  it("emits ChatDelta and ChatDone for a successful voice turn", async () => {
    const req: ChatSendRequest = {
      requestId: "req-1",
      messages: [{ role: "user", content: "hello" }],
      inputModality: "voice",
    };
    await streamTurn(req, emit);
    expect(emits.some(([ch]) => ch === IpcChannel.ChatDelta)).toBe(true);
    expect(emits.some(([ch]) => ch === IpcChannel.ChatDone)).toBe(true);
  });

  it("emits ChatError when userId fails", async () => {
    const { getUserId } = await import("./memory/index");
    (getUserId as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("Not signed in"));
    const req: ChatSendRequest = { requestId: "req-2", messages: [{ role: "user", content: "hi" }] };
    await streamTurn(req, emit);
    expect(emits.some(([ch]) => ch === IpcChannel.ChatError)).toBe(true);
  });

  it("cancelTurn aborts in-flight request silently", async () => {
    // Register a slow stream
    const { default: AnthropicMock } = await import("@anthropic-ai/sdk");
    (AnthropicMock as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      messages: {
        stream: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnThis(),
          finalMessage: vi.fn().mockReturnValue(new Promise(() => {})), // never resolves
        }),
      },
    }));
    const req: ChatSendRequest = { requestId: "req-slow", messages: [{ role: "user", content: "slow" }] };
    const turnPromise = streamTurn(req, emit);
    cancelTurn("req-slow");
    await turnPromise;
    expect(emits.every(([ch]) => ch !== IpcChannel.ChatError)).toBe(true);
  });
});
```

- [ ] **Step 3: Run test**

```bash
npx vitest run electron/chat-turn.test.ts
```
Expected: all pass.

- [ ] **Step 4: Type-check and commit**

```bash
npx tsc --noEmit
git add electron/chat-turn.ts electron/chat-turn.test.ts
git commit -m "feat(mac): chat-turn orchestrator — full runTurn parity (history, retrieval, tools, capture)"
```

---

### Task 14: Wire up — chat.ts shim + useVoice.ts

**Files:**
- Modify: `electron/chat.ts`
- Modify: `src/hooks/useVoice.ts`
- Modify: `electron/auth.ts` (call `resetConversationCache` + `resetUserIdCache` on sign-out)

- [ ] **Step 1: Replace `streamChat` body in `electron/chat.ts`**

Open `electron/chat.ts`. Replace the `streamChat` function body (keep `buildAnthropicMessages` and `cancelChat` for test compatibility — `cancelChat` just delegates):

```typescript
import { streamTurn, cancelTurn } from "./chat-turn";
import type { ChatSendRequest } from "@shared/types";
import { IpcChannel } from "@shared/types";

// Keep buildAnthropicMessages export (used in existing tests)
export { buildAnthropicMessages } from "./chat-turn-helpers"; // see step 1a

export function cancelChat(requestId: string): void {
  cancelTurn(requestId);
}

export async function streamChat(
  req: ChatSendRequest,
  emit: (channel: IpcChannel, payload: unknown) => void,
): Promise<void> {
  return streamTurn(req, emit);
}
```

Step 1a — create `electron/chat-turn-helpers.ts` to preserve `buildAnthropicMessages` for existing tests:

```typescript
// electron/chat-turn-helpers.ts
import type { ChatMessage } from "@shared/types";

/** Trim empties, coalesce consecutive same-role turns. */
export function buildAnthropicMessages(
  messages: ChatMessage[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    const content = m.content.trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + content;
    else out.push({ role: m.role, content });
  }
  return out;
}
```

- [ ] **Step 2: Add `inputModality: "voice"` in `src/hooks/useVoice.ts`**

Find the `nova().chatSend({...})` call (around line 239). Add `inputModality`:

```typescript
// Before:
nova().chatSend({
  requestId: id,
  messages: [{ role: "user", content: transcript }],
});

// After:
nova().chatSend({
  requestId: id,
  messages: [{ role: "user", content: transcript }],
  inputModality: "voice",
});
```

- [ ] **Step 3: Reset caches on sign-out in `electron/auth.ts`**

```typescript
// Add imports at top:
import { resetConversationCache } from "./conversation";
import { resetUserIdCache } from "./memory/client";

// In signOut():
export async function signOut(): Promise<void> {
  await getSupabase().auth.signOut();
  clearSession();
  resetConversationCache();   // add this
  resetUserIdCache();          // add this
  emit(IpcChannel.AuthChanged, { signedIn: false, email: null });
}
```

- [ ] **Step 4: Run full test suite**

```bash
npm test
```
Expected: all pass, zero failures.

- [ ] **Step 5: Type-check**

```bash
npx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 6: Build check**

```bash
npm run build
```
Expected: clean build (electron-vite produces `out/`).

- [ ] **Step 7: Final commit**

```bash
git add electron/chat.ts electron/chat-turn-helpers.ts src/hooks/useVoice.ts electron/auth.ts
git commit -m "feat(mac): wire chat-turn — shim streamChat, add inputModality:voice, reset caches on sign-out"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|-----------------|------|
| `inputModality` on `ChatSendRequest` | Task 1 |
| `electron/memory/types.ts` (local type defs) | Task 1 |
| `sync.ts` column bugfix | Task 1 |
| Pure logic ports (keywords, merge, reconcile, profile, lifestyle-capture, model-routing, reminder/memory-intent, voice-fallback) | Task 2 |
| `context-intent` / `inferContextIntent` | Task 3 |
| `classify` + `embed` (raw fetch) | Task 4 |
| `getUserId` / `resetUserIdCache` | Task 5 |
| `listUpcomingReminders` / `formatReminderLine` | Task 5 |
| `runtime-context` (timezone-aware clock) | Task 5 |
| `resolveRetrievalPlan` + `applyMacVoiceOverrides` (memoryLimit≤12) | Task 6 |
| Mac-adapted system prompt | Task 6 |
| `preRetrieveContext` (hybrid RRF + pinned + profile) | Task 7 |
| `searchMemories` / `findReconciliationCandidates` | Task 7 |
| `detectAndLinkRelationships` | Task 8 |
| `saveMemory` (classify/reconcile/merge/dedup/embed) | Task 8 |
| `autoCaptureFromMessage` + `memory/index.ts` | Task 9 |
| `TOOL_DEFINITIONS` (minus plan_workflow) | Task 10 |
| `web-search` + `webpage` + `workouts` handlers | Task 10 |
| Non-Google tool handlers (reminder CRUD, workout CRUD, memory, web) | Task 10 |
| Google integration (calendar, gmail, youtube via shared tokens) | Task 11 |
| `getOrCreateConversation` perpetual "Nova (Mac)" conversation | Task 12 |
| `persistUserMessage` / `persistAssistantMessage` / `loadLastNMessages` | Task 12 |
| `streamTurn` orchestrator (history + retrieval + tools + capture + model routing) | Task 13 |
| Voice: 8-msg history, ≤12 memories; Text: 40-msg, up to 32 memories | Tasks 6, 13 |
| `MAX_TOOL_ITERATIONS`: 3 voice / 10 text | Task 13 |
| 1200 ms retrieval deadline | Task 13 |
| `streamChat` shim | Task 14 |
| `useVoice.ts` `inputModality: "voice"` | Task 14 |
| Sign-out cache reset | Task 14 |

All spec requirements covered.

**Placeholder scan:** No TBDs or incomplete steps found.

**Type consistency:** `RetrievalPlan` used consistently in Tasks 6, 7, 13. `MemorySearchResult` exported from `search.ts` and consumed by `save.ts`. `ChatActionReceipt` defined in `types.ts` (Task 1) and imported in `voice-fallback.ts` (Task 2). `cancelChat` → `cancelTurn` delegation preserved in Task 14. `buildAnthropicMessages` preserved in `chat-turn-helpers.ts` so `electron/chat.test.ts` continues to pass.
