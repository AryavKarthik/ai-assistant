# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

```bash
npm run dev          # start Next.js dev server
npm run build        # production build
npm run lint         # eslint
npm run db:migrate   # apply all SQL migrations (requires SUPABASE_DB_URL)

# Cron scripts (run with dev server up)
npm run cron:reminders     # reminder cleanup + push dispatch
npm run cron:proactive     # daily brief + nudges
npm run cron:memory-decay  # episodic salience decay

# DB maintenance scripts
npm run db:backfill-embeddings   # generate missing pgvector embeddings
npm run db:classify-memories     # classify existing memories by type
npm run db:dedupe-memories       # deduplicate overlapping memories
```

No test runner is configured. The project uses TypeScript strict mode; `npm run build` catches type errors.

## Architecture

**Next.js App Router** with server components and route handlers under `app/`. All pages require auth (Supabase magic-link) enforced in `app/layout.tsx`.

### Request flow for a chat message

1. `POST /api/chat` (`app/api/chat/route.ts`) receives the user message
2. `runTurn` / `runTurnStream` in `lib/chat/run-turn.ts` orchestrates the entire turn:
   - Loads last 80 messages from DB
   - Runs `preRetrieveContext` (hybrid memory search + calendar + Gmail + reminders + workouts)
   - Infers personality, complexity, model, thread section, context intent
   - Calls Claude with `MAX_TOOL_ITERATIONS = 3`; each tool result feeds back into Claude
   - Returns action receipts and trust tags persisted to `messages.metadata`

### Key `lib/chat/` modules

| File | Purpose |
|------|---------|
| `run-turn.ts` | Main turn orchestrator (non-streaming and streaming paths) |
| `stream-message.ts` | SSE streaming with Haiku→Sonnet fallback |
| `system-prompt.ts` | `BASE_SYSTEM_PROMPT`, `buildDynamicSystemAdditions`, `FORMATTING_PROMPT` |
| `model-routing.ts` | `inferComplexity` — light (Haiku) vs heavy (Sonnet) based on regex patterns |
| `model-override.ts` | Parses in-chat commands like "use sonnet" / "use auto routing" |
| `context-intent.ts` | Detects what external context (calendar, Gmail, workouts) a message needs |
| `thread-context.ts` | Main vs side thread routing; retrieval plan overrides for voice |
| `personality.ts` | Mood/mode detection for tone variation |
| `receipts.ts` | `buildReceipt` / `deriveTrustTags` — generates action receipts per tool result |
| `prompt-cache.ts` | Anthropic prompt cache breakpoints on system prompt + tools |
| `runtime-context.ts` | Injects current date/time/timezone into the system prompt |

### Memory system (`lib/memory/`)

- `save.ts` — upserts a memory row; fire-and-forget embed + relationship linking
- `search.ts` — `preRetrieveContext`: hybrid search (pgvector cosine + `pg_trgm` ILIKE) merged via RRF
- `embed.ts` — calls OpenAI `text-embedding-3-small` (1536-dim) via raw `fetch`
- `classify.ts` — pattern-match → Haiku LLM fallback for memory type classification
- `merge.ts` / `reconcile.ts` — dedup/merge logic on save
- `relationships.ts` — auto-detects memory links (`related`, `contradicts`, etc.)
- `decay.ts` — episodic/goal salience decay (run weekly via cron)

Memory types: `fact`, `preference`, `routine`, `episodic`, `goal`, `relationship`, `skill`.  
`embedding` column is excluded from all list/search queries to avoid transferring 6 KB of floats per row.

### Tools (`lib/tools/`)

- `definitions.ts` — `TOOL_DEFINITIONS` array (Claude sees these as tool schemas)
- `handlers.ts` — `executeTool` dispatcher; each tool maps to a DB/API call
- `index.ts` — re-exports both

Adding a new tool: add schema in `definitions.ts`, add handler in `handlers.ts`.

### Google integrations (`lib/google/`)

Per-service OAuth stored encrypted in `google_oauth_tokens` table. Each service has its own connect/disconnect flow under `app/api/google/`. Connections UI at `/connections`.

### Voice (`lib/voice/`, `app/api/voice/`)

- `POST /api/voice/transcribe` — STT (OpenAI or GCP)
- `POST /api/voice/synthesize` — TTS (OpenAI or GCP)
- Voice turns use `runTurnStream`; TTS prefetches sentence-by-sentence

### Proactive (`lib/proactive/`, `app/api/cron/proactive/`)

Cron runs every 5 min; generates daily brief + nudges using `preRetrieveContext` and Haiku. Stored in `proactive_notifications` table, delivered via Web Push.

## Database

All migrations are in `supabase/migrations/` (numbered, sequential). Apply in order. RLS is enforced on every table — auth session cookie must be present or service role key used for scripts.

Core tables: `conversations`, `messages` (with `metadata` JSONB for receipts/trust tags), `memories`, `memory_links`, `reminders`, `workouts`, `google_oauth_tokens`, `user_preferences`, `proactive_notifications`, `push_subscriptions`.

Supabase RPCs: `search_memories_by_vector`, `increment_memory_access` (defined in migration 015).

## Component structure

- `components/shell/` — `AppShell`, global nav/layout
- `components/chat/` — message rendering, composer, streaming
- `components/memory/` — Memory Manager UI
- `components/ui/` — shared primitives (shadcn-based)
- `components/voice/` — voice overlay and controls
- Navigation via `AppDock` (floating dock); tab pages use `PageShell`

## Environment variables

See `README.md` for the full list. Minimum for local dev: `ANTHROPIC_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Voice and Google integrations need additional keys.

**Important:** Do not paste multi-line GCP service account JSON into `.env.local` — save it to `gcp-service-account.json` and set `GOOGLE_APPLICATION_CREDENTIALS=./gcp-service-account.json` instead.

## Model configuration

| Env var | Default | Used for |
|---------|---------|---------|
| `ANTHROPIC_MODEL_LIGHT` | `claude-haiku-4-5-20251001` | Everyday chat, briefs |
| `ANTHROPIC_MODEL_HEAVY` | `claude-sonnet-4-6` | Complex analysis, planning |
| `ANTHROPIC_MODEL` | light model | Global default override |

Dynamic routing: `inferComplexity` in `lib/chat/model-routing.ts` chooses light vs heavy per message. Users can override in chat ("use sonnet") or pin ("from now on use haiku").
