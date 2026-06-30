# Nova Mac — Plan 3: Memory + Conversation Context

**Date:** 2026-07-01 (revised)
**Scope:** Full parity with the web app's `runTurn` — conversation history, dynamic intent + model routing, memory/reminder retrieval, tool-call loop, and full-fidelity memory writes — adapted for the Electron main process and the existing streaming IPC shape.  
**Excluded:** `plan_workflow` tool (requires web review UI not present on Mac); Google OAuth integrations (Calendar/Gmail/YouTube tools included but return "not connected" gracefully until a future OAuth plan wires them).

---

## Problem

`electron/chat.ts` is a bare Anthropic stream: a fixed system prompt, no conversation history, no memory retrieval, no tools, and only the latest transcript as input. Nova-on-Mac is stateless and featureless compared to the web app — it cannot recall facts, reference prior turns, set reminders, log workouts, or search the web. This plan brings the Mac to full web-app parity.

---

## Goals

1. **Conversation history** — thread prior turns from the shared `messages` table (voice: 8 msgs, text: 40 msgs, matching `applyVoiceRetrievalOverrides`).
2. **Dynamic intent routing** — per-turn `inferContextIntent` → `resolveRetrievalPlan` → `applyVoiceRetrievalOverrides` (voice) to fetch the right context at the right depth.
3. **Dynamic model routing** — `inferComplexity` (light=Haiku, heavy=Sonnet) for text turns; voice always uses the light model (matching web).
4. **Memory + reminder retrieval** — hybrid pgvector + `pg_trgm` search with pinned/profile tiers + upcoming reminders, injected as `<relevant_context>` into the user message.
5. **Full tool-call loop** — port all 16 tools from `TOOL_DEFINITIONS` (excluding `plan_workflow`); `MAX_TOOL_ITERATIONS = 3` for voice, `10` for text (matching web).
6. **Full memory write pipeline** — pattern extraction → classify → reconcile/merge/dedup → embed → relationship links, fire-and-forget after each turn (matching `runTurn` voice capture path).
7. **Runtime clock** — `resolveUserTimezoneCached` + `buildClockForZone` injected into the system prompt each turn, matching the web.
8. **Unchanged renderer** — `useVoice.ts` and any text chat UI send the same `ChatSendRequest`. The only IPC addition is `inputModality?: "voice" | "text"` on that type, which defaults to `"text"` when omitted.

---

## Architecture

### What changes vs. what stays

| Layer | Change |
|-------|--------|
| `shared/types.ts` | Add `inputModality?: "voice" \| "text"` to `ChatSendRequest` |
| `src/hooks/useVoice.ts` | Pass `inputModality: "voice"` in `chatSend` call (one line) |
| `electron/chat.ts` | `streamChat` becomes a shim; delegates to `chat-turn.ts` |
| `electron/chat-turn.ts` | **New** — full turn orchestrator matching web `runTurn` / `runTurnStream` |
| `electron/conversation.ts` | **New** — perpetual conversation find-or-create + message persistence |
| `electron/tools/` | **New** — port of `lib/tools/definitions.ts` + `lib/tools/handlers.ts` (minus `plan_workflow`; plus `electron/tools/web-search.ts`, `electron/tools/webpage.ts`) |
| `electron/memory/` | **New** — port of `lib/memory/` + `lib/chat/context-intent.ts`, `model-routing.ts`, `runtime-context.ts`, and fragments of `system-prompt.ts` |
| `electron/sync.ts` | Drive-by bugfix: `type` → `memory_type` column + `MemorySummary` type rename |

### New directory layout

```
electron/
  chat.ts                         # unchanged public API; shim → chat-turn
  chat-turn.ts                    # NEW: full turn orchestrator
  conversation.ts                 # NEW: perpetual conversation + message persistence
  tools/
    definitions.ts                # PORT: TOOL_DEFINITIONS (all tools except plan_workflow)
    handlers.ts                   # PORT: executeTool dispatcher + all handlers
    web-search.ts                 # PORT: googleWebSearch (or Brave) raw fetch
    webpage.ts                    # PORT: fetchWebpage raw fetch
  memory/
    index.ts                      # re-exports for chat-turn consumption
    client.ts                     # getUserId() — cached getSupabase().auth.getUser()
    search.ts                     # PORT: hybridSearch, retrieveMemoriesForTurn, preRetrieveContext
    save.ts                       # PORT: saveMemory, updateMemory
    extract.ts                    # PORT: autoCaptureFromMessage
    classify.ts                   # PORT: classifyMemory (raw Anthropic fetch)
    embed.ts                      # PORT: embedText (raw OpenAI fetch)
    reconcile.ts                  # PORT: pickReplacementCandidate, findRelatedMemoryIds
    merge.ts                      # PORT: mergeMemoryContent
    keywords.ts                   # PORT: extractSearchTerms, expandSearchTerms, etc.
    profile.ts                    # PORT: CORE_PROFILE_PATTERNS, pickCoreProfileMemories
    lifestyle-capture.ts          # PORT: extractLifestyleFacts, extractExplicitMemoryContent
    relationships.ts              # PORT: detectAndLinkRelationships
    runtime-context.ts            # PORT: resolveUserTimezoneCached, buildClockForZone, formatRuntimeClockForPrompt
    context-intent.ts             # PORT: inferContextIntent, ContextIntent type
    retrieval-plan.ts             # PORT: RetrievalPlan type, resolveRetrievalPlan, applyVoiceRetrievalOverrides
    model-routing.ts              # PORT: inferComplexity
```

**Single porting rule:** every `createServerClient()` → `getSupabase()`. `@/` path aliases → relative imports. `classify.ts`, `embed.ts`, `web-search.ts`, `webpage.ts` use raw `fetch` — they port with no Supabase changes. Pure logic files (`reconcile.ts`, `merge.ts`, `keywords.ts`, `profile.ts`, `lifestyle-capture.ts`, `model-routing.ts`, `context-intent.ts`) need only path alias adjustments.

---

## IPC Change — `ChatSendRequest`

```typescript
// shared/types.ts
export interface ChatSendRequest {
  requestId: string;
  messages: ChatMessage[];
  inputModality?: "voice" | "text";  // NEW — defaults to "text" when absent
}
```

`useVoice.ts` adds `inputModality: "voice"` to its existing `chatSend` call — one line change, no structural impact.

---

## Conversation History & Persistence

### One perpetual conversation

The main process owns conversation identity. On first turn, lazily queries Supabase for `conversations` where `user_id = userId AND title = "Nova (Mac)"`, takes the most recent by `created_at`. If none exists, inserts one. Caches the `id` in memory for the session. On sign-out, `resetConversationCache()` clears it.

### Message persistence

```
Before Anthropic call:  INSERT messages(conversation_id, role="user",   content=transcript)
                        UPDATE conversations SET updated_at=now()
After ChatDone:         INSERT messages(conversation_id, role="assistant", content=fullText)  [fire-and-forget]
```

User message is persisted before the call so its `id` can be passed to `autoCaptureFromMessage` as `sourceMessageId`.

### History window

Matches `applyVoiceRetrievalOverrides` behavior from the web:

| Modality | `chatHistoryLimit` |
|----------|--------------------|
| voice    | 8 (from `applyVoiceRetrievalOverrides`) |
| text     | 40 (from `MAIN_CEILING`) |

`loadLastNMessages(conversationId, limit)` — ordered `created_at DESC`, reversed — gives the most recent N messages regardless of age.

---

## Dynamic Intent Routing

Port `inferContextIntent` and `resolveRetrievalPlan` directly from the web, plus `applyVoiceRetrievalOverrides` for voice turns.

```
transcript
  └─▶ inferContextIntent(transcript, "main")          → intent (e.g. "reminders", "profile_recall")
  └─▶ resolveRetrievalPlan("main", intent)            → full plan (mirrors web MAIN_CEILING)
  └─▶ [voice only] applyVoiceRetrievalOverrides(plan) → voice-trimmed plan
                                                         (memoryLimit≤4, queryMatchPool≤8,
                                                          chatHistoryLimit=8, reminderLimit≤4)
```

For `context-intent.ts` the `isGmailContextIntent` import becomes a port of that function (it's a simple keyword check in `lib/google/gmail.ts`); `isWorkoutRecallRelated` is already in `keywords.ts` which we're porting.

The ported `retrieval-plan.ts` defines a local `RetrievalPlan` interface that strips unused fields (`youtubeTaste`, `calendarLimit`, `gmailHighlightLimit`, `workoutLimit`) — those fields still exist in the type but will always be 0/false from the plan functions until Google OAuth is wired. This keeps the interface stable for the future without dead code driving bugs.

---

## Dynamic Model Routing

Port `inferComplexity` unchanged from `lib/chat/model-routing.ts`.

| Modality | Routing |
|----------|---------|
| voice    | always light (Haiku) — matching web `isVoiceTurn → complexity: "light"` |
| text     | `inferComplexity(transcript)` → light (Haiku) or heavy (Sonnet) |

Model env vars: `ANTHROPIC_MODEL_LIGHT` (default `claude-haiku-4-5`) and `ANTHROPIC_MODEL_HEAVY` (default `claude-sonnet-4-6`) — same env var names as the web app, so `.env.local` works for both.

---

## Memory Retrieval

Matches web `preRetrieveContext` behaviour exactly, limited to the data sources currently wired on Mac:

```
retrieveMemoriesForTurn(userId, transcript, plan)    → up to plan.memoryLimit memories
                                                       (pinned + minimal core profile + hybrid RRF)
listUpcomingReminders(userId, plan.reminderLimit)    → upcoming pending reminders (if plan.reminderLimit > 0)
[Google calendar/gmail/youtube/workouts → skipped]   plan values are 0/false until OAuth wired
```

Everything runs in `Promise.all` with a 1200ms `Promise.race` deadline (matching `VOICE_CONTEXT_TIMEOUT_MS`). If the deadline fires, `relevantContext` is empty string — the turn proceeds with history only. Deadline applies to both voice and text turns (web applies it to voice only, but on Mac where Supabase is remote the budget is the same).

### Context block format

Matches web exactly (same XML tags, same `formatMemoryLine`, same `formatReminderLine`):

```
<relevant_context thread="main" intent="reminders" note="...">
- [memory id=abc (fact)] User's name is Aryav
- [reminder] Review project proposal — due Wednesday 2 Jul
</relevant_context>
```

Prepended to the latest user message in the Anthropic messages array — not injected into the system prompt.

---

## System Prompt

Port `STATIC_VOICE_SYSTEM_PROMPT` and `STATIC_SYSTEM_PROMPT` from `lib/chat/system-prompt.ts` with a single Mac-specific addition: omit references to "Google Calendar tab", "Reminders tab", "Connections page" (UI elements not present on Mac). The runtime clock block is appended each turn.

```
[STATIC_VOICE_SYSTEM_PROMPT or STATIC_SYSTEM_PROMPT, mac-trimmed]

<runtime_context>
- Now: {localDate}, {localTime} ({timezone})
- ISO: {iso}
</runtime_context>
```

`buildDynamicSystemAdditions` (personality + thread context + intent) is ported for the text path. For voice, the static voice prompt already handles brevity — personality hints are skipped (matching web `isVoiceTurn` path which also skips most dynamic additions).

---

## Tool-Call Loop

Port `TOOL_DEFINITIONS` (all tools minus `plan_workflow`) and `executeTool` into `electron/tools/`.

```
MAX_TOOL_ITERATIONS_VOICE = 3
MAX_TOOL_ITERATIONS_TEXT  = 10
```

**Google tools** (`list_calendar_events`, `create_calendar_event`, `update_calendar_event`, `delete_calendar_event`, `search_gmail`, `get_gmail_message`, `create_gmail_draft`, `get_youtube_taste_profile`, `search_youtube`, `recommend_youtube`): included in the tool definitions and dispatcher. When no Google OAuth is configured, each handler returns `{ error: "Google Calendar/Gmail/YouTube is not connected." }` — the same graceful degradation as the web when a user hasn't linked an account. Claude surfaces a natural explanation in its reply.

**`plan_workflow`**: excluded from Mac tool definitions. The web creates a workflow run that renders an approval UI in the browser — no Mac equivalent exists yet.

**`web_search` / `fetch_webpage`**: port raw fetch implementations directly. These depend only on env vars (`BRAVE_SEARCH_API_KEY` or equivalent) with no Supabase or Google OAuth.

Tool results feed back into the Anthropic message loop identically to the web:

```typescript
// Within the tool loop in chat-turn.ts
while (response.stop_reason === "tool_use" && iterations < maxToolIterations) {
  const toolUseBlocks = ...;
  messages.push({ role: "assistant", content: response.content });
  const toolResults = await Promise.all(
    toolUseBlocks.map(async (block) => ({
      type: "tool_result",
      tool_use_id: block.id,
      content: JSON.stringify(await executeTool(block.name, block.input, context)),
    }))
  );
  messages.push({ role: "user", content: toolResults });
  response = await nextStream(...);
  iterations++;
}
```

`cancelChat` aborts the `AbortController` which signals the current stream; any in-flight tool calls complete before the next iteration but the abort check precedes the next Anthropic call.

---

## Memory Writes — Full Pipeline Parity

After `ChatDone`, fire-and-forget `autoCaptureFromMessage(userId, transcript, userMsgId)`:

```
autoCaptureFromMessage
  ├── PROFILE_PATTERNS regex → saveMemory
  ├── EXTENDED_PATTERNS regex → saveMemory
  ├── extractExplicitMemoryContent → saveMemory
  └── extractLifestyleFacts → saveMemory   (budget-capped per message)

saveMemory
  ├── classifyMemory          (raw Anthropic fetch)
  ├── findReconciliationCandidates + pickReplacementCandidate + mergeMemoryContent
  ├── INSERT or UPDATE memories
  ├── scheduleEmbedding       (raw OpenAI fetch, fire-and-forget)
  └── detectAndLinkRelationships (Supabase + Anthropic, fire-and-forget)
```

No blocking LLM calls in the post-turn path — classify is inside `saveMemory` which is itself fire-and-forget.

---

## Turn Orchestrator (`electron/chat-turn.ts`)

```typescript
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
    if (isVoice) plan = applyVoiceRetrievalOverrides(plan);

    const complexity = isVoice ? "light" : inferComplexity(transcript);
    const model = complexity === "heavy" ? HEAVY_MODEL : LIGHT_MODEL;

    const [history, relevantContext, clock] = await Promise.all([
      loadLastNMessages(conversationId, plan.chatHistoryLimit),
      retrieveWithDeadline(userId, transcript, plan, 1200),
      resolveClockForUser(userId),
    ]);

    const system = buildMacSystemPrompt(isVoice, clock);
    const messages = buildMessages(history, relevantContext);
    const maxIterations = isVoice ? MAX_TOOL_ITERATIONS_VOICE : MAX_TOOL_ITERATIONS_TEXT;
    const context = { userId, conversationId, sourceMessageId: userMsg.id, userMessage: transcript };

    let fullText = "";
    let response;
    let iterations = 0;

    while (true) {
      response = await streamOnce(model, system, messages, controller.signal,
        (delta) => { fullText += delta; emit(IpcChannel.ChatDelta, { requestId: req.requestId, delta }); }
      );
      if (response.stop_reason !== "tool_use" || iterations >= maxIterations) break;
      const toolResults = await runToolLoop(response, messages, context);
      messages.push({ role: "user", content: toolResults });
      iterations++;
    }

    emit(IpcChannel.ChatDone, { requestId: req.requestId, text: fullText });

    void persistAssistantMessage(conversationId, fullText)
      .catch((e) => console.error("[turn] persist assistant msg:", e));
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

`streamChat` in `chat.ts` becomes: `return streamTurn(req, emit)`.

---

## Error Handling & Robustness

| Failure | Behaviour |
|---------|-----------|
| `getUserId()` fails (not signed in) | `ChatError` — turn cannot proceed without identity |
| `getOrCreateConversation` fails | `ChatError` — history requires a conversation |
| `persistUserMessage` fails | `ChatError` — `sourceMessageId` is required for memory capture |
| `loadLastNMessages` fails | `ChatError` — history is load-bearing |
| Retrieval deadline (1200ms) | Empty `relevantContext`, turn proceeds with history only; info log |
| Tool handler throws | Returns `{ error: message }` to Claude — Claude surfaces gracefully in reply |
| Google tool called without OAuth | Returns `{ error: "Google X is not connected." }` |
| `persistAssistantMessage` fails | Fire-and-forget — logged, turn already succeeded |
| `autoCaptureFromMessage` fails | Fire-and-forget — logged, turn already succeeded |
| Sign-out | `resetConversationCache()` — next user gets fresh find-or-create |

---

## Drive-by Fix

`electron/sync.ts` selects `"id, content, type, salience"` from `memories`. The column is `memory_type`. Fix to `"id, content, memory_type, salience"`. Update `MemorySummary` in `shared/types.ts` (`type: string` → `memoryType: string | null`) and any renderer consumers.

---

## Testing

Vitest unit tests, Node environment, all network calls stubbed.

| Test file | What it covers |
|-----------|---------------|
| `electron/conversation.test.ts` | find-or-create: existing → returns id; miss → creates; cached; reset on sign-out |
| `electron/chat.test.ts` | `buildAnthropicMessages` coalescing; `streamTurn` delegates correctly |
| `electron/memory/context-intent.test.ts` | `inferContextIntent` all intent branches |
| `electron/memory/retrieval-plan.test.ts` | `resolveRetrievalPlan` per intent; `applyVoiceRetrievalOverrides` caps |
| `electron/memory/model-routing.test.ts` | `inferComplexity` heavy patterns; length threshold |
| `electron/memory/search.test.ts` | RRF merge & ranking; salience boost; type weights; dedup; deadline race |
| `electron/memory/reconcile.test.ts` | `pickReplacementCandidate` duplicate/subject-key/subset; `findRelatedMemoryIds` |
| `electron/memory/merge.test.ts` | `mergeMemoryContent` idempotence, additive, replacement |
| `electron/memory/classify.test.ts` | Pattern-match paths (no network); LLM path stubbed |
| `electron/memory/extract.test.ts` | `autoCaptureFromMessage`: profile patterns, explicit, lifestyle facts, budget |
| `electron/tools/handlers.test.ts` | `executeTool` for non-Google tools; Google tools return "not connected" |

---

## What This Does Not Include

- **`plan_workflow` tool**: requires an approval UI that doesn't exist on Mac.
- **Google OAuth**: Calendar, Gmail, YouTube tools are wired and will respond gracefully when not connected. Actual OAuth flow is a separate plan.
- **Prompt caching**: web uses `cache_control: ephemeral` on system prompt + tools. Mac can add this later; it's an optimisation, not a feature gap.
- **`buildDynamicSystemAdditions` for voice**: web skips personality hints on voice turns — Mac matches this.
