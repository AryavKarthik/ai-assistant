# Prompt Cache Usage Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture Anthropic `response.usage` (including cache token counts) after every API call, log it to the server console, and persist it in each assistant message's JSONB metadata column.

**Architecture:** Add a `TurnUsage` type, thread it through the call stack (`streamMessageWithFallback` → `createMessageWithFallback` → `RunTurnResult` → `AssistantMessageMetadata`), summing across tool-loop iterations within a single turn. No DB schema change — metadata is already JSONB.

**Tech Stack:** TypeScript, Next.js App Router, `@anthropic-ai/sdk ^0.105.0`, Supabase.

## Global Constraints

- No new npm packages
- No DB schema migrations
- No frontend changes
- TypeScript strict mode — all changes must pass `npx tsc --noEmit`
- Follow existing code patterns (no class components, no default exports on lib files)

---

### Task 1: Add TurnUsage interface to shared types

**Files:**
- Modify: `lib/chat/types.ts`

**Interfaces:**
- Produces: `TurnUsage` — consumed by Tasks 2, 3, 4

- [ ] **Step 1: Add TurnUsage to types.ts**

Open `lib/chat/types.ts`. Append after the last export:

```ts
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors (or only pre-existing errors unrelated to types.ts).

- [ ] **Step 3: Commit**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant
git add lib/chat/types.ts
git commit -m "feat: add TurnUsage interface for cache token tracking"
```

---

### Task 2: Capture usage in streamMessageWithFallback

**Files:**
- Modify: `lib/chat/stream-message.ts`

**Interfaces:**
- Consumes: `TurnUsage` from `@/lib/chat/types`
- Produces: `streamMessageWithFallback` now returns `Promise<{ response: Message; model: string; usage: TurnUsage }>`

- [ ] **Step 1: Add TurnUsage import to stream-message.ts**

Add to the existing imports at the top of `lib/chat/stream-message.ts`:

```ts
import type { TurnUsage } from "@/lib/chat/types";
```

- [ ] **Step 2: Update the return type of streamMessageWithFallback**

Change the function signature from:

```ts
): Promise<{ response: Message; model: string }> {
```

to:

```ts
): Promise<{ response: Message; model: string; usage: TurnUsage }> {
```

- [ ] **Step 3: Extract usage after finalMessage() and return it**

Replace the lines inside the `try` block:

```ts
      const response = await stream.finalMessage();
      return { response, model };
```

with:

```ts
      const response = await stream.finalMessage();
      const usage: TurnUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      };
      console.log(
        `[cache-usage] model=${model} creation=${usage.cacheCreationInputTokens} read=${usage.cacheReadInputTokens} input=${usage.inputTokens} output=${usage.outputTokens}`,
      );
      return { response, model, usage };
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors pointing to callers of `streamMessageWithFallback` in `run-turn.ts` (they now receive `usage` but don't use it yet — that's fine, destructuring `{ response, model }` still compiles). No errors in `stream-message.ts` itself.

- [ ] **Step 5: Commit**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant
git add lib/chat/stream-message.ts
git commit -m "feat: capture and log cache usage in streamMessageWithFallback"
```

---

### Task 3: Capture usage in createMessageWithFallback and propagate through RunTurnResult

**Files:**
- Modify: `lib/chat/run-turn.ts`

**Interfaces:**
- Consumes: `TurnUsage` from `@/lib/chat/types`; `streamMessageWithFallback` now returns `usage`
- Produces: `RunTurnResult.cacheUsage: TurnUsage`; `buildRunTurnResult` now takes a 5th param `cacheUsage: TurnUsage`

- [ ] **Step 1: Add TurnUsage import to run-turn.ts**

Add to the existing imports at the top of `lib/chat/run-turn.ts`:

```ts
import type { TurnUsage } from "@/lib/chat/types";
```

- [ ] **Step 2: Add cacheUsage to RunTurnResult**

Find the `RunTurnResult` interface and add one field:

```ts
export interface RunTurnResult {
  text: string;
  modelUsed: string;
  modelPreference: string | null;
  actionReceipts: ChatActionReceipt[];
  trustTags: string[];
  highlightStored: boolean;
  cacheUsage: TurnUsage;
}
```

- [ ] **Step 3: Add accumulateUsage and zeroUsage helpers**

Add these two small helpers just above the `runTurn` function (around line 311):

```ts
function zeroUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
}

function accumulateUsage(acc: TurnUsage, next: TurnUsage): TurnUsage {
  return {
    inputTokens: acc.inputTokens + next.inputTokens,
    outputTokens: acc.outputTokens + next.outputTokens,
    cacheCreationInputTokens: acc.cacheCreationInputTokens + next.cacheCreationInputTokens,
    cacheReadInputTokens: acc.cacheReadInputTokens + next.cacheReadInputTokens,
  };
}
```

- [ ] **Step 4: Update createMessageWithFallback to capture and log usage**

Inside `createMessageWithFallback`, after `const response = await anthropic.messages.create({...})`, replace:

```ts
      return { response, model };
```

with:

```ts
      const usage: TurnUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
      };
      console.log(
        `[cache-usage] model=${model} creation=${usage.cacheCreationInputTokens} read=${usage.cacheReadInputTokens} input=${usage.inputTokens} output=${usage.outputTokens}`,
      );
      return { response, model, usage };
```

Also update `createMessageWithFallback`'s return type from `Promise<{ response: ...; model: string }>` to include `usage: TurnUsage`. The function currently has an inferred return type — explicitly add it:

Find the function signature:
```ts
async function createMessageWithFallback(
  anthropic: ReturnType<typeof getAnthropicClient>,
  params: ...
) {
```

Add explicit return type:
```ts
): Promise<{ response: Awaited<ReturnType<typeof anthropic.messages.create>>; model: string; usage: TurnUsage }> {
```

- [ ] **Step 5: Accumulate usage in runTurn**

In `runTurn`, after the line `let selectedModel = "";` add:

```ts
  let turnUsage = zeroUsage();
```

After the first `createMessageWithFallback` call, change:
```ts
  let responseResult = await createMessageWithFallback(anthropic, { ... });
  let response = responseResult.response;
  selectedModel = responseResult.model;
```

to:
```ts
  let responseResult = await createMessageWithFallback(anthropic, { ... });
  let response = responseResult.response;
  selectedModel = responseResult.model;
  turnUsage = accumulateUsage(turnUsage, responseResult.usage);
```

Inside the `while` loop, after the second `createMessageWithFallback` call:
```ts
    responseResult = await createMessageWithFallback(anthropic, { ... });
    response = responseResult.response;
    selectedModel = responseResult.model;
    turnUsage = accumulateUsage(turnUsage, responseResult.usage);
```

At the bottom of `runTurn`, change:
```ts
  return buildRunTurnResult(ctx, text, selectedModel, createReminderSucceeded);
```

to:
```ts
  return buildRunTurnResult(ctx, text, selectedModel, createReminderSucceeded, turnUsage);
```

- [ ] **Step 6: Accumulate usage in runTurnStream**

In `runTurnStream`, after `let iterations = 0;` add:

```ts
  let turnUsage = zeroUsage();
```

After `const streamResult = await streamMessageWithFallback(...)`:
```ts
    response = streamResult.response;
    selectedModel = streamResult.model;
    turnUsage = accumulateUsage(turnUsage, streamResult.usage);
```

At the bottom of `runTurnStream`, change:
```ts
  return buildRunTurnResult(ctx, rawText, selectedModel, createReminderSucceeded);
```

to:
```ts
  return buildRunTurnResult(ctx, rawText, selectedModel, createReminderSucceeded, turnUsage);
```

- [ ] **Step 7: Update buildRunTurnResult signature and body**

Change the signature from:
```ts
function buildRunTurnResult(
  ctx: PreparedTurnContext,
  rawText: string,
  selectedModel: string,
  createReminderSucceeded: boolean,
): RunTurnResult {
```

to:
```ts
function buildRunTurnResult(
  ctx: PreparedTurnContext,
  rawText: string,
  selectedModel: string,
  createReminderSucceeded: boolean,
  cacheUsage: TurnUsage,
): RunTurnResult {
```

In both `return` statements inside `buildRunTurnResult`, add `cacheUsage` to the returned object:

Early-return (reminder failed):
```ts
    return {
      text: "I couldn't save that reminder...",
      modelUsed: selectedModel,
      modelPreference: ctx.nextPreference,
      actionReceipts: ctx.actionReceipts,
      trustTags: deriveTrustTags(ctx.actionReceipts),
      highlightStored: false,
      cacheUsage,
    };
```

Normal return:
```ts
  return {
    text,
    modelUsed: selectedModel,
    modelPreference: ctx.nextPreference,
    actionReceipts: ctx.actionReceipts,
    trustTags: deriveTrustTags(ctx.actionReceipts),
    highlightStored: ctx.actionReceipts.some(
      (receipt) => receipt.source === "memory" && receipt.status === "success",
    ),
    cacheUsage,
  };
```

- [ ] **Step 8: Verify TypeScript compiles**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only in `message-metadata.ts` and `route.ts` (not yet updated). Zero errors in `run-turn.ts` or `stream-message.ts`.

- [ ] **Step 9: Commit**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant
git add lib/chat/run-turn.ts
git commit -m "feat: accumulate cache usage across tool iterations in runTurn and runTurnStream"
```

---

### Task 4: Persist cache usage in AssistantMessageMetadata and wire up route.ts

**Files:**
- Modify: `lib/chat/message-metadata.ts`
- Modify: `app/api/chat/route.ts`

**Interfaces:**
- Consumes: `TurnUsage` from `@/lib/chat/types`; `RunTurnResult.cacheUsage`
- Produces: `AssistantMessageMetadata.cacheUsage?: TurnUsage` written to Supabase JSONB

- [ ] **Step 1: Add TurnUsage import to message-metadata.ts**

Add to the imports at the top of `lib/chat/message-metadata.ts`:

```ts
import type { TurnUsage } from "@/lib/chat/types";
```

- [ ] **Step 2: Add cacheUsage to AssistantMessageMetadata**

Change the interface:
```ts
export interface AssistantMessageMetadata {
  modelUsed?: string;
  trustTags?: string[];
  actionReceipts?: ChatActionReceipt[];
  highlightStored?: boolean;
  inputModality?: "voice" | "text";
  cacheUsage?: TurnUsage;
}
```

- [ ] **Step 3: Update buildAssistantMetadata to accept and include cacheUsage**

Change the function signature's input type to include `cacheUsage`:

```ts
export function buildAssistantMetadata(result: {
  modelUsed: string;
  trustTags: string[];
  actionReceipts: ChatActionReceipt[];
  highlightStored: boolean;
  inputModality?: "voice" | "text";
  cacheUsage?: TurnUsage;
}): AssistantMessageMetadata {
  return {
    modelUsed: result.modelUsed,
    trustTags: result.trustTags,
    actionReceipts: result.actionReceipts,
    highlightStored: result.highlightStored,
    ...(result.inputModality ? { inputModality: result.inputModality } : {}),
    ...(result.cacheUsage ? { cacheUsage: result.cacheUsage } : {}),
  };
}
```

- [ ] **Step 4: Update parseMessageMetadata to parse cacheUsage**

Inside `parseMessageMetadata`, after the `actionReceipts` parsing block, add:

```ts
  const rawCacheUsage = record.cacheUsage;
  const cacheUsage: TurnUsage | undefined =
    rawCacheUsage &&
    typeof rawCacheUsage === "object" &&
    "inputTokens" in rawCacheUsage
      ? (rawCacheUsage as TurnUsage)
      : undefined;
```

And include it in the return:
```ts
  return {
    modelUsed: typeof record.modelUsed === "string" ? record.modelUsed : undefined,
    trustTags,
    actionReceipts,
    highlightStored:
      typeof record.highlightStored === "boolean" ? record.highlightStored : undefined,
    cacheUsage,
  };
```

- [ ] **Step 5: Verify TypeScript compiles cleanly**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit 2>&1 | head -30
```

`buildAssistantMetadata` in `route.ts` is called with `{ ...result, inputModality }`. Since `result` now has `cacheUsage` and the function accepts it, this should compile with zero errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant
git add lib/chat/message-metadata.ts app/api/chat/route.ts
git commit -m "feat: persist cache token usage in assistant message metadata"
```

---

## Verification After All Tasks

- [ ] **Full TypeScript check:**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Manual smoke test (two messages in same conversation):**

Send message 1, check server logs for:
```
[cache-usage] model=claude-haiku-4-5 creation=XXXX read=0 input=YYYY output=ZZZ
```

Send message 2 within 5 minutes, check for:
```
[cache-usage] model=claude-haiku-4-5 creation=0 read=XXXX input=YYY output=ZZZ
```

`read=XXXX` on the second message confirms caching is working end-to-end.

- [ ] **Supabase spot check:**

```sql
select
  id,
  created_at,
  metadata->'cacheUsage' as cache_usage
from messages
where role = 'assistant'
order by created_at desc
limit 5;
```

Expected: `cache_usage` column shows `{"inputTokens": ..., "cacheCreationInputTokens": ..., "cacheReadInputTokens": ...}` for recent messages.
