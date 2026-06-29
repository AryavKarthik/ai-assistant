# Prompt Cache Usage Tracking

**Date:** 2026-06-29
**Status:** Approved

## Problem

Prompt caching (`cache_control: { type: "ephemeral" }`) is configured on the static system prompt and tool definitions in `lib/chat/prompt-cache.ts`. However, `response.usage` — which contains `cache_creation_input_tokens` and `cache_read_input_tokens` — is never captured or logged. The Anthropic dashboard shows zero cache reads, making it impossible to confirm caching is working without inspecting raw HTTP traffic.

## Goal

Surface cache token counts per assistant turn:
- In server logs (immediate, per-call visibility)
- In Supabase message metadata (durable, queryable per turn)

No frontend changes. No DB schema changes (metadata is already JSONB).

## Approach: Log + persist usage in message metadata

### Data shape

A single `TurnUsage` interface aggregates all Anthropic calls within one turn (first call + any tool-loop iterations):

```ts
interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}
```

Fields map 1:1 to `response.usage` from the Anthropic SDK. Multi-call turns sum all four fields across iterations.

### Data flow

```
Anthropic API call
  → response.usage captured
  → [cache-usage] log line emitted
  → usage accumulated (summed across tool iterations)
  → RunTurnResult.cacheUsage
  → buildAssistantMetadata(result)
  → AssistantMessageMetadata.cacheUsage
  → saveMessage(..., metadata)
  → Supabase messages.metadata JSONB
```

### Files changed

| File | Change |
|------|--------|
| `lib/chat/types.ts` | Add `TurnUsage` interface |
| `lib/chat/stream-message.ts` | Capture `response.usage`, return `usage` alongside `response` and `model` |
| `lib/chat/run-turn.ts` | Add `accumulateUsage` helper; sum usage across tool iterations in both `runTurn` and `runTurnStream`; add `cacheUsage` to `RunTurnResult` |
| `lib/chat/message-metadata.ts` | Add `cacheUsage?: TurnUsage` to `AssistantMessageMetadata`; update `buildAssistantMetadata` and `parseMessageMetadata` |
| `app/api/chat/route.ts` | Pass `cacheUsage` from result into `buildAssistantMetadata` |

### Logging format

One line per Anthropic API call (not per turn):
```
[cache-usage] model=claude-haiku-4-5 creation=4821 read=0 input=4971 output=142
```

On a cache hit (second message in session, within 5 min TTL):
```
[cache-usage] model=claude-haiku-4-5 creation=0 read=4821 input=150 output=88
```

### Supabase query to verify

```sql
select
  id,
  created_at,
  metadata->'cacheUsage' as cache_usage
from messages
where role = 'assistant'
order by created_at desc
limit 20;
```

## What confirms caching is working

- First message in a session: `cacheCreationInputTokens > 0`, `cacheReadInputTokens = 0`
- Second message within 5 min: `cacheCreationInputTokens = 0`, `cacheReadInputTokens > 0`
- Dashboard numbers match log numbers → API key is correct and caching is real

## Out of scope

- Frontend display of cache stats
- New API endpoints for cache metrics
- DB schema changes
