# Nova Mac — Plan 3: Memory + Conversation Context

**Date:** 2026-06-30  
**Scope:** Core recall — conversation history, memory retrieval (memories + reminders), and full-fidelity memory writes (classify/reconcile/dedup/embed/relationships)  
**Excluded:** Tools (save_memory, create_reminder tool-call loop), dynamic model routing, Google integrations

---

## Problem

`electron/chat.ts` is a bare Anthropic stream: a fixed system prompt with no context about the user, no conversation history, and only the latest transcript as input. Nova-on-Mac is stateless — it cannot recall facts between turns, cannot reference prior messages in the same session, and cannot surface upcoming reminders. This is the highest-value gap between the Mac app and the web app.

---

## Goals

1. Nova retains **conversation history** within and across app launches (last 24 messages ≈ 12 turns).
2. Nova **retrieves relevant memories and upcoming reminders** before each turn and injects them into the system prompt.
3. Nova **persists new facts** after each turn using the full classify → reconcile/merge/dedup → embed → relationship-link pipeline, keeping the shared Supabase store consistent with the web app.
4. The existing `ChatDelta` / `ChatDone` / `ChatError` IPC shape is **unchanged** — `useVoice.ts` in the renderer requires zero modification.
5. API keys stay in the main process. The renderer is unaware of `userId`, `conversationId`, or any memory state.
6. Retrieval failures **never block** the spoken reply (1200 ms voice deadline, graceful degradation).

---

## Architecture

### Three-process model — what changes and what stays

| Layer | Change |
|-------|--------|
| Renderer (`src/`) | None — `useVoice.ts` sends the same `ChatSendRequest{requestId, messages:[{user,transcript}]}` |
| `electron/chat.ts` | `streamChat` delegates to `chat-turn.ts`; `buildAnthropicMessages` kept for tests |
| `electron/chat-turn.ts` | **New** — full turn orchestrator (history + retrieval + stream + capture) |
| `electron/conversation.ts` | **New** — find-or-create the perpetual conversation; persist user/assistant messages |
| `electron/memory/` | **New** — ported subset of `lib/memory/` adapted to use the Electron Supabase client |
| `electron/sync.ts` | Drive-by bugfix: `type` → `memory_type` column name |

### New file tree

```
electron/
  chat.ts                  # unchanged public API; internal body delegates to chat-turn
  chat-turn.ts             # NEW: orchestrates every turn
  conversation.ts          # NEW: perpetual conversation + message persistence
  memory/
    index.ts               # re-exports: preRetrieveContext, autoCaptureFromMessage, saveMemory
    client.ts              # getUserId() — cached wrapper around getSupabase().auth.getUser()
    search.ts              # PORT: hybridSearch, preRetrieveContext (memories + reminders)
    save.ts                # PORT: saveMemory with full classify/reconcile/merge/dedup/embed
    extract.ts             # PORT: autoCaptureFromMessage (pattern-based, no LLM call)
    classify.ts            # PORT: classifyMemory (raw fetch → Anthropic, unchanged)
    embed.ts               # PORT: embedText (raw fetch → OpenAI, unchanged)
    reconcile.ts           # PORT: pickReplacementCandidate, findRelatedMemoryIds (pure)
    merge.ts               # PORT: mergeMemoryContent (pure)
    keywords.ts            # PORT: extractSearchTerms, expandSearchTerms, etc. (pure)
    profile.ts             # PORT: CORE_PROFILE_PATTERNS, pickCoreProfileMemories (pure)
    lifestyle-capture.ts   # PORT: extractLifestyleFacts, extractExplicitMemoryContent (pure)
    relationships.ts       # PORT: detectAndLinkRelationships (Supabase + Anthropic)
```

**Single porting rule:** every `createServerClient()` call becomes `getSupabase()` (from `../supabase`). `classify.ts` and `embed.ts` use raw `fetch` with no Supabase — they port unchanged except for import path adjustments. `@/` path aliases become relative imports throughout.

---

## Conversation History & Persistence

### One perpetual conversation

The main process owns conversation identity. On first turn after sign-in it queries Supabase for an existing `conversations` row with `title = "Nova (Mac)"` belonging to the current user. If found, it caches the `id` in memory for the session's lifetime. If not found, it inserts a new row and caches the id.

This "find-or-create on first turn" pattern means no extra work on app launch — it resolves lazily. If the user signs out and back in, a new find-or-create resolves the correct conversation for the new user.

```typescript
// electron/conversation.ts (conceptual)

let cachedConversationId: string | null = null;

export async function getOrCreateConversation(userId: string): Promise<string> {
  if (cachedConversationId) return cachedConversationId;
  const supabase = getSupabase();
  const { data } = await supabase
    .from("conversations")
    .select("id")
    .eq("user_id", userId)
    .eq("title", "Nova (Mac)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (data) {
    cachedConversationId = data.id;
    return data.id;
  }
  const { data: created, error } = await supabase
    .from("conversations")
    .insert({ user_id: userId, title: "Nova (Mac)" })
    .select("id")
    .single();
  if (error) throw error;
  cachedConversationId = created.id;
  return created.id;
}

export function resetConversationCache(): void {
  cachedConversationId = null; // call on sign-out
}
```

### Message persistence

```
Before call:  INSERT messages (conversation_id, role="user", content=transcript)
              UPDATE conversations SET updated_at=now()
After done:   INSERT messages (conversation_id, role="assistant", content=fullText) [fire-and-forget]
```

The assistant message is persisted after `ChatDone` — its `id` is not needed by the renderer, so it can be non-blocking.

### 24-message window

`loadLastNMessages(conversationId, 24)` ordered by `created_at DESC` then reversed — retrieves the 24 most-recent messages regardless of age, giving Nova the last ~12 turns of context without bounding on recency. Voice turns are short (≤100 tokens each), so 24 messages is generous within the `max_tokens: 650` voice budget.

The turn orchestrator builds the Anthropic messages array from this history, prepends `<relevant_context>` to the latest user message (matching web `buildClaudeMessages`), and passes it to the stream.

---

## Memory Retrieval

### Fixed voice retrieval plan

Rather than the web's per-thread plan machinery, the Mac uses a single constant plan tuned for voice:

```typescript
const VOICE_RETRIEVAL_PLAN = {
  memoryLimit: 6,
  queryMatchPool: 10,
  recentMemoryFallback: 0,       // voice relies on core profile + query match
  coreProfileMode: "minimal",    // name, location, job — top facts only
  reminderLimit: 3,              // up to 3 upcoming pending reminders
  calendarLimit: 0,              // not yet wired
  gmailHighlightLimit: 0,        // not yet wired
  workoutLimit: 0,               // not yet wired
  youtubeTaste: false,           // not yet wired
  chatHistoryLimit: 24,
  intent: "general",
  threadSection: "main",
  contextNote: "nova-mac voice turn",
} satisfies ContextRetrievalPlan;
```

`memoryLimit: 6` gives Nova the 6 most relevant memories. `coreProfileMode: "minimal"` always includes up to ~4 core profile facts (name/location/job) via `pickMinimalCoreProfileMemories`. These core facts are included first and then query-matched memories fill the remaining budget, deduped via the existing `dedupeResults`.

### Retrieval pipeline

Runs in parallel, with a 1200 ms voice deadline on the combined memory+reminder fetch:

```
getUserId()  ──────────────────────────────────────────────────────▶ userId
                                                                          │
getOrCreateConversation(userId)                                           │
loadLastNMessages(conversationId, 24)                                     │
resolveUserTimezoneCached(userId) ──▶ buildClockForZone() ──▶ clock       │
                                                                          ▼
Promise.race([                                                    1200ms deadline
  Promise.all([
    retrieveMemoriesForTurn(userId, transcript, VOICE_RETRIEVAL_PLAN),
    listUpcomingReminders(userId, 3),
  ]).then(format into lines),
  timeout("")
])
```

If the deadline fires, `relevantContext` is empty string — the call still proceeds with history but no injected context.

### Context block format

Matches the web app's format exactly so shared tooling/prompts stay consistent:

```
<relevant_context thread="main" intent="general" note="nova-mac voice turn">
- [memory id=abc (fact)] User's name is Aryav
- [memory id=def (routine)] Goes to the gym Monday, Wednesday, Friday
- [reminder] Review project proposal — due Wednesday 2 Jul
</relevant_context>
```

This block is prepended to the latest user message in the Anthropic messages array (not injected into the system prompt), matching `buildClaudeMessages` behavior from the web.

---

## System Prompt

The Mac voice system prompt gains awareness of memory context. The runtime clock is appended to the system prompt as a `<runtime_context>` block (not cached — changes every call, but the system prompt body above it is stable).

```
You are Nova, a concise, friendly voice assistant on the user's Mac.
Replies are spoken aloud — keep them short and natural, usually 1–3 sentences.

Memory and context:
- Pre-fetched context in <relevant_context> may include memories and pending reminders.
  Use them naturally to give personalized, time-aware replies.
- Do not mention databases, memory systems, or that you are checking separate systems.
- Do not repeat back facts the user just told you unless confirming something important.

<runtime_context>
- Now: {localDate}, {localTime} ({timezone})
- ISO: {iso}
</runtime_context>
```

The runtime clock resolves via `resolveUserTimezoneCached` (queries `memories` for timezone hints, cached 10 min) then `buildClockForZone`. Both functions are ported from `lib/chat/runtime-context.ts` into `electron/memory/` since they query the memories table.

---

## Memory Writes — Full Pipeline Parity

After every turn, `autoCaptureFromMessage(userId, transcript, userMessageId)` runs **fire-and-forget** (does not block the IPC response). It mirrors the web `run-turn.ts` voice capture path exactly.

### Capture → save chain

```
autoCaptureFromMessage(transcript)
  ├── PROFILE_PATTERNS regex → saveMemory (high confidence, no LLM needed)
  ├── EXTENDED_PATTERNS regex → saveMemory
  ├── extractExplicitMemoryContent ("remember that...") → saveMemory
  └── extractLifestyleFacts → saveMemory (up to MAX_CAPTURES_PER_MESSAGE total)

saveMemory(userId, content, options)
  ├── classifyMemory(content)        ← raw Anthropic fetch (works in main process as-is)
  ├── findReconciliationCandidates() ← hybrid search to find potential duplicates
  ├── pickReplacementCandidate()     ← pure logic
  ├── mergeMemoryContent()           ← pure logic
  ├── INSERT or UPDATE memories      ← Supabase (getSupabase() client)
  ├── scheduleEmbedding()            ← raw OpenAI fetch, fire-and-forget
  └── detectAndLinkRelationships()   ← Supabase + Anthropic, fire-and-forget
```

**No new LLM calls per turn are blocking** — classify runs inside `saveMemory` which is already fire-and-forget. Embedding and relationship-link detection are fire-and-forget within `saveMemory` itself.

---

## Turn Orchestrator (`electron/chat-turn.ts`)

```typescript
export async function streamTurn(
  transcript: string,
  requestId: string,
  emit: (channel: IpcChannel, payload: unknown) => void,
): Promise<void> {
  const controller = new AbortController();
  inFlight.set(requestId, controller);

  try {
    const userId = await getUserId();       // cached after first call
    const conversationId = await getOrCreateConversation(userId);

    // Persist user message (blocking — needed before we load history)
    const userMsg = await persistUserMessage(conversationId, transcript);

    // Load history + retrieval in parallel, retrieval with deadline
    const [history, relevantContext, clock] = await Promise.all([
      loadLastNMessages(conversationId, 24),
      retrieveWithDeadline(userId, transcript, 1200),
      resolveClockForUser(userId),
    ]);

    const systemPrompt = buildVoiceSystemPrompt(clock);
    const messages = buildMessages(history, relevantContext);

    // Anthropic stream (same shape as before)
    let fullText = "";
    const stream = client().messages.stream(
      { model: VOICE_MODEL, max_tokens: 650, system: systemPrompt, messages },
      { signal: controller.signal },
    );
    stream.on("text", (delta) => {
      fullText += delta;
      emit(IpcChannel.ChatDelta, { requestId, delta });
    });
    await stream.finalMessage();

    emit(IpcChannel.ChatDone, { requestId, text: fullText });

    // Fire-and-forget post-turn work
    void persistAssistantMessage(conversationId, fullText);
    void autoCaptureFromMessage(userId, transcript, userMsg.id).catch(
      (err) => console.error("[memory] capture failed:", err),
    );
  } catch (err) {
    if (controller.signal.aborted) return;
    emit(IpcChannel.ChatError, {
      requestId,
      message: err instanceof Error ? err.message : "Chat failed",
    });
  } finally {
    inFlight.delete(requestId);
  }
}
```

`streamChat` in `chat.ts` becomes a thin shim: extract `transcript = req.messages.at(-1)?.content ?? ""` and call `streamTurn(transcript, req.requestId, emit)`.

---

## Error Handling & Robustness

| Failure | Behaviour |
|---------|-----------|
| Supabase unreachable on first turn | `getOrCreateConversation` throws → `ChatError` emitted. Auth is a precondition; if Supabase is unreachable the turn cannot proceed. |
| `loadLastNMessages` fails | Throws → `ChatError`. History is required for a coherent turn. |
| Retrieval deadline fires (1200 ms) | Empty `relevantContext` — call proceeds with history only. Logged at info level. |
| `persistUserMessage` fails | Throws → `ChatError`. Message must be persisted before the call so the assistant reply can reference it via `source_message_id`. |
| `persistAssistantMessage` fails | Fire-and-forget — logged, turn already succeeded. |
| `autoCaptureFromMessage` fails | Fire-and-forget — caught, logged, turn already succeeded. |
| `embedText` / `detectAndLinkRelationships` fail | Internal to `saveMemory`, already fire-and-forget with error logging. |
| Sign-out | `resetConversationCache()` is called so the next user gets a fresh find-or-create. |

---

## Drive-by Fix

`electron/sync.ts` line 18 selects `"id, content, type, salience"` from `memories`. The actual column is `memory_type`, not `type`. This returns `null` for every memory in the UI. Fix in the same commit as conversation.ts.

```typescript
// Before
.select("id, content, type, salience")

// After
.select("id, content, memory_type, salience")
```

The `MemorySummary` type in `shared/types.ts` uses `type: string` — rename that field to `memoryType: string | null` to match reality, and update `listMemories` and any renderer consumers.

---

## Testing

All tests are Vitest unit tests in Node environment (`.test.ts` colocated with the file under test or in a dedicated `__tests__/` sibling). Network calls (Anthropic API, OpenAI API, Supabase) are stubbed via `vi.mock` or manual spies.

| Test file | What it covers |
|-----------|---------------|
| `electron/conversation.test.ts` | find-or-create: returns existing id; creates new on miss; caches across calls; resets on sign-out |
| `electron/chat.test.ts` | `buildAnthropicMessages` role coalescing, empty-content filtering (already partly exists) |
| `electron/memory/search.test.ts` | RRF merge & ranking: keyword-only, vector-only, combined; salience boost; type weights; dedup |
| `electron/memory/reconcile.test.ts` | `pickReplacementCandidate` duplicate/subject-key/subset detection; `findRelatedMemoryIds` |
| `electron/memory/merge.test.ts` | `mergeMemoryContent` idempotence, additive merge, full replacement |
| `electron/memory/classify.test.ts` | Pattern-match paths (no network); LLM path stubbed |
| `electron/memory/extract.test.ts` | `autoCaptureFromMessage`: profile patterns, explicit capture, lifestyle facts, budget cap |

---

## What This Does Not Include

- **Tool-call loop** (save_memory, create_reminder as Claude tools): deferred. Nova can read and surface memories but cannot be directed to save or modify them mid-turn via tool use.
- **Dynamic model routing**: Haiku (voice model) is fixed. Complexity-based Haiku/Sonnet routing is a separate improvement.
- **Google integrations** (Calendar, Gmail, YouTube, Workouts): no OAuth wired on Mac. Deferred.
- **Relationship-link read surface**: links are written but not read back into retrieval context (matching current web behaviour — links are stored but retrieval uses RRF scores, not the link graph).
- **`MemorySummary` update in renderer**: the `sync.ts` fix updates the field name; any renderer code displaying memory type must be updated accordingly (likely one line in `components/shell/ThreadSidebar.tsx` or similar).
