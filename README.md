 # AI Assistant

## Goal
A chat-first personal AI assistant that feels like one brain.

## Current (V1 + Phase 2 + Phase 3 + Phase 4A/4B/4D complete)
- Chat interface with conversation history (Supabase)
- **Supabase Auth** — magic-link sign-in; per-user data with RLS
- **Multiple chat threads** — sidebar with new/switch/delete; selected thread in `/?thread=<id>`
- **Ephemeral images** — attach one image per message for vision; text-only persistence
- **Memory Manager** — `/memory` page with type tabs (Facts, Preferences, Routines, Episodic, Goals, People, Skills), salience bars, pin/archive, "needs review" filter, and semantic search
- **Hybrid memory** — pgvector embeddings + `pg_trgm` keyword search merged via Reciprocal Rank Fusion; 7 typed memory categories; salience scoring; episodic decay; auto-relationship linking
- **Reminders tab** — pending list grouped by due date, mark done, manual add; **browser push** for due reminders (opt-in)
- **Connections** — `/connections` page to link **Google Calendar, Gmail, and YouTube** independently
- Claude tool calling: memory, workouts, reminders, calendar, **Gmail (search, draft, send with confirmation)**, **YouTube search/recommend**
- Unified pre-retrieval: memories + reminders + calendar + **Gmail highlights (when email-related)** + **YouTube taste** + workouts (when relevant)
- Memory auto-save with dedup/merge, classification, and fire-and-forget embedding
- **Voice** — push-to-talk, conversation mode, wake word ("Hey Nova"), barge-in, streaming TTS; up to 2 minutes of continuous speech
- **Proactive assistant** — daily brief, nudges, follow-ups via `/settings` and `/notifications`
- **Personality routing** — mode/mood-aware tone with clarification-first behavior
- Dynamic model routing (Haiku default, Sonnet for complex tasks) with manual override in chat
- Model-used display per assistant reply

## V1 does not do
- Full Mac control (Phase 4E)
- Autonomous file cleanup (Phase 4E, gated)
- Multi-step agentic workflows beyond 3 tool iterations (Phase 4C)
- Gmail Pub/Sub real-time awareness (Phase 4F)
- Composio-managed third-party integrations (planned; see [Composio](#composio-optional))

## Stack
- Next.js App Router
- TypeScript
- Anthropic Claude API
- Supabase (Postgres + Auth)
- Google Calendar, Gmail, and YouTube APIs (OAuth 2.0)
- Composio (optional — third-party tool OAuth; planned)
- Tailwind CSS

## Local setup
1. Install dependencies:
   - `npm install`
2. Create `.env.local` with:
   - `ANTHROPIC_API_KEY`
   - `OPENAI_API_KEY` (voice STT + TTS when using OpenAI providers)
   - `GCP_PROJECT_ID` (optional — Google Cloud Speech/TTS)
   - `GCP_SERVICE_ACCOUNT_JSON` (optional — **single-line** JSON for Vercel; do not use multi-line in `.env`)
   - `GOOGLE_APPLICATION_CREDENTIALS` (optional — local path to service account key file, recommended for dev)
   - `ANTHROPIC_MODEL` (optional global default)
   - `ANTHROPIC_MODEL_LIGHT` (optional)
   - `ANTHROPIC_MODEL_MEDIUM` (optional)
   - `ANTHROPIC_MODEL_HEAVY` (optional)
   - `BRAVE_SEARCH_API_KEY` — Brave Search API key for web search tool (get one at search.brave.com/app/keys; optional — tool degrades gracefully when missing)
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (cron/scripts; required for `ensureAppUser` on first login)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (Phase 2H)
   - `GOOGLE_REDIRECT_URI=http://localhost:3000/api/google/calendar/callback`
   - `GOOGLE_CALENDAR_SCOPES=https://www.googleapis.com/auth/calendar`
   - `GOOGLE_TOKEN_ENCRYPTION_KEY` — 32-byte key as 64 hex chars (generate: `openssl rand -hex 32`)
   - `GOOGLE_GMAIL_REDIRECT_URI=http://localhost:3000/api/google/gmail/callback` (optional)
   - `GOOGLE_YOUTUBE_REDIRECT_URI=http://localhost:3000/api/google/youtube/callback` (optional)
   - `YOUTUBE_TASTE_CACHE_TTL_HOURS` (optional, default 24)
   - `CRON_SECRET` — protects `/api/cron/reminders` (cleanup + push dispatch)
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Web Push (generate: `npx web-push generate-vapid-keys`; subject e.g. `mailto:you@example.com`)
   - `DEFAULT_USER_ID` (optional — only for `npm run db:migrate-user` seed migration)
   - `COMPOSIO_API_KEY` (optional — Composio integrations; see [Composio](#composio-optional))
3. **Supabase Auth** (Dashboard → Authentication):
   - Enable **Email** provider (magic link)
   - Site URL: `http://localhost:3000`
   - Redirect URLs: `http://localhost:3000/auth/callback`
4. **Google Cloud** (same project as OAuth client):
   - Enable **Google Calendar API**, **Gmail API**, **YouTube Data API v3**
   - OAuth consent screen: add scopes for calendar, `gmail.compose` (or `gmail.readonly` + `gmail.compose`), `youtube.readonly` (+ `openid`/`email` optional for Connections display)
   - Add yourself as a **Test user** while in Testing mode
   - Authorized redirect URIs (must match exactly):
     - `http://localhost:3000/api/google/calendar/callback`
     - `http://localhost:3000/api/google/gmail/callback`
     - `http://localhost:3000/api/google/youtube/callback`
5. Apply migrations:
   - `npm run db:migrate` (requires `SUPABASE_DB_URL` in `.env.local`), or paste each file in Supabase SQL editor:
   - `supabase/migrations/001_initial_schema.sql`
   - `supabase/migrations/002_pg_trgm_index.sql` (optional)
   - `supabase/migrations/003_reminder_lifecycle.sql`
   - `supabase/migrations/004_auth_rls.sql`
   - `supabase/migrations/005_google_oauth_tokens.sql`
   - `supabase/migrations/006_google_services.sql`
   - `supabase/migrations/007_youtube_taste_cache.sql`
   - `supabase/migrations/008_push_subscriptions.sql`
   - `supabase/migrations/009_thread_sections.sql`
   - `supabase/migrations/010_message_fk_on_delete_set_null.sql`
   - `supabase/migrations/011_message_metadata.sql`
   - `supabase/migrations/012_user_preferences.sql`
   - `supabase/migrations/013_proactive_notifications.sql`
   - `supabase/migrations/014_memory_v2.sql` (Phase 4D — pgvector, memory types, salience, memory_links)
   - `supabase/migrations/015_memory_v2_rpc.sql` (Phase 4D — vector search + access tracking RPCs)
   - `supabase/migrations/016_workflow_runs.sql` (Phase 4C — workflow_runs + workflow_steps tables)
6. Run dev server:
   - `npm run dev`
7. Sign in at `/login` with your email (magic link).

**Migrate existing v1 seed data** (optional, after first login):
```bash
# Copy your auth UUID from Supabase → Authentication → Users
npm run db:migrate-user -- --from=a0000000-0000-4000-8000-000000000001 --to=<your-auth-uuid>
```

**Cron (reminder cleanup + push dispatch):**
- Set `CRON_SECRET` and VAPID keys in `.env.local`
- Local dev: `npm run cron:reminders` (with dev server running)
- Production: `vercel.json` runs `/api/cron/reminders` every 5 minutes (Vercel sends `Authorization: Bearer $CRON_SECRET` when `CRON_SECRET` is set)
- Non-Vercel: schedule `POST` or `GET` to `/api/cron/reminders` with `Authorization: Bearer $CRON_SECRET`

**Cron (proactive briefs + nudges):**
- Local dev: `npm run cron:proactive` (with dev server running)
- Production: `vercel.json` runs `/api/cron/proactive` every 5 minutes (same `CRON_SECRET`)
- Opt in at `/settings` — proactive features default **off**

**Cron (memory decay):**
- Production: `vercel.json` runs `/api/cron/memory-decay` every Sunday at 3am UTC (same `CRON_SECRET`)
- Decays salience on old episodic/goal memories; archives below-threshold entries
- Local dev: `npm run cron:memory-decay` (with dev server running)

**Push notifications:**
- On `/reminders`, click **Enable notifications** (browser permission + service worker)
- Reminders need a `due_at` in the past or present to trigger push on the next cron run

If you see `row-level security policy` errors, ensure migrations `004`–`008` are applied and you are signed in (session cookie present).

### Dynamic model routing
- Default model is **Haiku** for everyday chat, reminders, memory, and workouts.
- **Sonnet** is used only when a message looks complex (analysis, planning, long multi-part asks).
- Override in chat: `use haiku`, `switch to sonnet`, or `use claude-haiku-4-5`.
- Pin a model: `from now on use haiku`. Reset: `use auto routing`.

## Composio (optional)

[Composio](https://composio.dev) can provide OAuth and tool access to many third-party apps (Slack, Notion, GitHub, Linear, etc.) through one integration layer, instead of wiring each service manually like the current Google Calendar / Gmail / YouTube flows on `/connections`.

**Status:** not wired into this app yet. Google services still use direct OAuth (`GOOGLE_CLIENT_ID`, encrypted tokens in `google_oauth_tokens`). Composio is the planned path for expanding tool coverage beyond Google.

### When to use Composio vs direct Google OAuth

| Approach | Good for |
|----------|----------|
| **Direct Google OAuth** (current) | Calendar, Gmail, YouTube — shipped with RLS, scope health, and UI on `/connections` |
| **Composio** | New integrations quickly; multi-app toolkits; MCP or SDK-based agent tools |

### 1. Create a Composio account and API key

1. Sign up at [dashboard.composio.dev](https://dashboard.composio.dev).
2. Open **Settings** (or **AI Clients** in the sidebar) and copy your API key.
3. Add to `.env.local`:

```bash
COMPOSIO_API_KEY=your_composio_api_key
```

Use the Supabase auth user id as the Composio `user_id` when you integrate — one Composio user per app user.

### 2. Connect apps in Composio

1. In the Composio dashboard, open **Connected accounts** (or the toolkit for an app).
2. Connect the services you want (e.g. Slack, Notion).
3. Complete each provider’s OAuth consent flow.

Composio stores refresh tokens; the app will reference them via `composio.create(user_id)` rather than `google_oauth_tokens`.

### 3. Integration options (when implemented)

**Native SDK (TypeScript)** — tools passed into the existing Claude tool loop:

- Docs: [Composio quickstart](https://docs.composio.dev/docs/quickstart)
- Pattern: `composio.create(userId)` → `session.tools()` → merge with `lib/tools/definitions.ts`

**MCP** — Composio as an external tool server:

- [Composio Connect](https://docs.composio.dev/docs/composio-connect) (`https://connect.composio.dev/mcp`)
- Useful for Cursor/Claude Desktop during development; can also feed a server-side MCP client later.

### 4. Planned wiring in this repo

- **Env:** `COMPOSIO_API_KEY` in `.env.local` / Vercel
- **User mapping:** `user_id` = Supabase `auth.users.id`
- **UI:** extend `/connections` or a new Integrations section to trigger Composio auth links
- **Tools:** register Composio actions alongside existing handlers in `lib/tools/handlers.ts`
- **Trust:** keep Phase 3 confirmation pattern for writes (send email, create events, etc.)

### References

- [Quickstart](https://docs.composio.dev/docs/quickstart)
- [Composio Connect (MCP)](https://docs.composio.dev/docs/composio-connect)

## Database tables
- `users`, `conversations`, `messages`
- `memories` — long-term facts with `memory_type` (fact/preference/routine/episodic/goal/relationship/skill), `salience`, `embedding` (vector 1536), `is_pinned`, `is_archived`, `confidence`, `valid_from`
- `memory_links` — typed relationships between memories (related/contradicts/refines/context_of/part_of)
- `workouts` (structured exercise logs)
- `reminders` (tasks with optional due times)
- `google_oauth_tokens` (encrypted Google refresh tokens per user, per-service flags)
- `youtube_taste_cache` (cached YouTube taste profile metadata)
- `push_subscriptions` (browser Web Push endpoints per user)
- `user_preferences` (proactive tier, daily brief time, quiet hours, timezone)
- `proactive_notifications` (briefs, nudges, follow-ups; in-app notification center)

**Supabase RPCs (Phase 4D):**
- `search_memories_by_vector(user_id, embedding, limit)` — cosine similarity search via HNSW index
- `increment_memory_access(memory_ids[])` — batch access count + timestamp update

---

## Phase 2 (complete)

Phase 2A–2I shipped. One brain at the experience layer; structured tables underneath.

| Sub-phase | Status | Summary |
|-----------|--------|---------|
| 2A | done | Reminder lifecycle, `completed_at`, 24h cleanup cron |
| 2B | done | Auto-save memory with dedup/merge |
| 2C | done | Unified pre-retrieval + Reminders tab |
| 2C-b | done | Minimal browser push for due reminders |
| 2D | done | Personality routing (mode, mood, easter eggs) |
| 2E | done | Multiple chat threads + shared memory |
| 2F | done | Ephemeral images (vision, not stored) |
| 2G | done | Memory Manager at `/memory` |
| 2H | done | Supabase Auth, RLS, Google Calendar OAuth + tools |
| 2I | done | Gmail + YouTube taste/search/recommend |

### Phase 2I — Gmail + YouTube (shipped)

**Tools:** `search_gmail`, `get_gmail_message`, `create_gmail_draft`, `get_youtube_taste_profile`, `search_youtube`, `recommend_youtube`

**Connections:** per-service OAuth on `/connections`; soft disconnect; YouTube taste refresh button

**Pre-retrieval:** Gmail unread highlights when the message is email-related; compact YouTube taste summary when connected

**Limits:** Gmail send requires UI confirmation on draft receipt; no attachments in v1; no YouTube home-feed API; taste from subscriptions/likes/playlists only

### Phase 2 done checklist

- [x] Completed reminders auto-delete after 24h
- [x] Assistant saves durable facts automatically and mentions when it does
- [x] Reminders tab shows pending/due tasks and supports mark-done without chat
- [x] Due reminders notify via browser push (opt-in on Reminders tab)
- [x] Assistant collates facts, workouts, and reminders in natural replies
- [x] Friendly, personality-aware tone
- [x] Sidebar supports multiple threads with shared memory
- [x] Images can be read but are not stored
- [x] Memory Manager for facts, workouts, and reminders
- [x] Google Calendar linked; chat can list/create/update/delete events
- [x] Gmail linked; search, summarize, draft from chat; send via in-chat confirmation
- [x] YouTube linked; taste-aware recommendations from chat

### Manual test checklists

#### Auth + session
- Visit `/` unauthenticated → redirected to `/login`
- Magic link login → lands on chat; sign out works
- Expired session on API call → redirected to `/login`

#### Reminders + push
- Create reminder with due time in the past → run `npm run cron:reminders` → push notification (after enabling on `/reminders`)
- Mark done → removed from pending list; deleted 24h after completion via cron

#### Connections (Calendar / Gmail / YouTube)
- Link each service on `/connections`; disconnect clears access
- OAuth errors show actionable hints (e.g. `no_refresh_token`)

#### Chat cross-source
- “What do I have coming up?” → reminders + calendar in one answer
- “Summarize my unread email” → concise summary (Gmail connected)
- “What should I watch?” → YouTube recommendations with reasons

#### Phase 2C–2G spot checks
- Memory across threads; image attach + refresh (text only persists)
- `/memory` search, edit, dedupe; Reminders tab independent task management

---

## Phase 2 reference (sub-phase detail)

### Phase 2A — Reminder lifecycle (done)
- Migration `003_reminder_lifecycle.sql`: `completed_at` on reminders
- Tools: `list_reminders`, `complete_reminder`
- Cron: push dispatch + delete completed reminders older than 24h

### Phase 2B — Auto-save memory (done)
- `save_memory` with dedup/merge; assistant notes saves in reply

### Phase 2C — Unified recall + Reminders tab (done)
- Pre-retrieval every turn; `/reminders` tab for pending tasks

### Phase 2C-b — Browser push (done)
- `push_subscriptions` table (`008_push_subscriptions.sql`)
- Service worker at `/sw.js`; opt-in on Reminders tab
- Cron dispatches due reminders (`notified_at`, `notification_channel = push`)

### Phase 2D — Personality (done)
- `lib/chat/personality.ts` + `buildSystemPrompt(hints)` per turn

### Phase 2E — Multiple chat threads (done)
- Sidebar, `/?thread=<id>`, shared user-level memory

### Phase 2F — Ephemeral images (done)
- Vision for one turn; text-only persistence

### Phase 2G — Memory Manager (done)
- `/memory` unified search and CRUD

### Phase 2H — Google Calendar (done)
- Auth + RLS; OAuth; calendar read/write tools; pre-retrieval

### Phase 2I — Gmail + YouTube (done)
- Gmail search/summarize; draft + UI-confirmed send (Phase 3E); YouTube taste cache + search/recommend tools

---

## Phase 3 (complete)

Phase 3A–3F shipped. Trust layer, Gmail draft/send, rich text, and polish pass included.

### Theme
Make the assistant feel finished, calm, premium, and easy to trust.

Better UX directly affects retention, especially for a product that handles
memory, reminders, email, and calendar.

### Suggested implementation order
1. Phase 3A — Design system
2. Phase 3C — Trust and control
3. Phase 3B — Core UX polish
4. Phase 3D — Information architecture
5. Phase 3E — Gmail draft + confirmed send
6. Phase 3F — Assistant rich text

### Current Phase 3 status
- Phase 3A — done
- Phase 3B — done
- Phase 3C — done
- Phase 3D — done
- Phase 3E — done
- Phase 3F — done

### Phase 3A — Design system
- Define visual foundations: typography, spacing, color tokens, elevations
- Standardize primitives: cards, inputs, buttons, badges, pills, notices
- Unify shell/layout across chat, memory, reminders, and connections
- Improve dark mode contrast and responsive mobile behavior
- Add interaction rules for hover/focus/active/disabled/loading states

### Phase 3B — Core UX polish
- Improve onboarding + first-run empty states
- Improve loading/streaming/skeleton/error states
- Refine compose box, attachment UI, thread switching, and reminder interactions
- Reduce visual clutter and smooth transitions for faster perceived chat
- Tighten copy/labels so actions and outcomes are obvious
- Status: done
- Shipped highlights:
  - chat onboarding/error/compose/thread polish
  - shared retry/dismiss error patterns
  - memory/reminders/connections UX copy and action-state consistency
  - lint/build validation pass

### Phase 3C — Trust and control
- Clarify what is stored vs temporary vs connected
- Add action receipts (for example: saved memory, read Gmail, created event)
- Add undo/edit surfaces for recent assistant actions
- Improve permissions and connection-health feedback
- have an annimation when information is stored to memory (make it smooth simple and nice).
- Status: done
- Shipped highlights:
  - trust tags in chat (`Temporary`, `Stored`, service-use markers)
  - structured action receipts rendered inline per assistant response
  - undo for recent reversible actions (memory delete + reminder restore-to-pending)
  - YouTube permission-health messaging and reconnect/re-consent path in Connections
  - reduced-motion-safe memory-save highlight animation
  - stronger proactive auto-memory behavior (assistant saves durable profile/context facts without asking each time, with dedupe/merge)

### Phase 3D — Information architecture
- Rework sidebar and chat metadata so navigation feels coherent
- Improve memory/reminder/calendar surfaces as one unified product
- Improve source grouping in answers without table/database jargon
- Add better search/filtering across Memory Manager and threads
- Keep information hierarchy simple and scannable
- have a threads section for side convos and a "main chat" section as well where most convos will occur.
- Status: done

### Phase 3E — Gmail draft + confirmed send (done)
- OAuth scope upgraded to `gmail.compose` (reconnect required for existing Gmail links)
- Tool: `create_gmail_draft` only (model never sends directly)
- In-chat draft receipt with **Send** and **Dismiss** buttons
- `POST /api/google/gmail/drafts/[id]/send` for UI-confirmed send
- Connections shows send-capable status and reconnect hint when scope is missing

### Phase 3F — Assistant rich text
- Render assistant replies as structured markdown (headings, bold, italic, lists, callouts, code, links, tables)
- Add formatting rules to the system prompt (no `***` clutter, minimal em dashes, structure only when useful)
- Preserve streaming typewriter, plain-text DB storage, and user-message plain text
- Status: done
- Shipped highlights:
  - `AssistantMessageContent` with `react-markdown` + `remark-gfm`
  - `.app-message-prose` typography in chat bubbles
  - `FORMATTING_PROMPT` with good/bad examples in system prompt
  - streaming-safe markdown normalization during typewriter reveal

### Phase 3 quality bar (across all sub-phases)
- Accessibility baseline (keyboard + focus + contrast) — partial pass; spot-check recommended on mobile
- Consistent empty/loading/error states in all primary views
- Clear action feedback for calendar, Gmail, YouTube, reminders, memory, and workouts
- Smooth mobile UX on chat, reminders, memory, and connections
- No ambiguous assistant outcomes for sensitive actions (Gmail send requires UI tap)
- Assistant message metadata persisted (`messages.metadata`) for trust tags and action receipts across refresh

### Phase 3G — Polish (done)
- Dedicated action receipts for calendar, YouTube, and workout tools
- Persist `actionReceipts` / `trustTags` on assistant messages (`011_message_metadata.sql`)
- `PATCH /api/messages/[id]/metadata` for receipt updates after send/dismiss/undo
- YouTube `canUse` on status API (Connections reconnect hint, same pattern as Gmail `canSend`)
- `highlightStored` fix on main-chat rotation path

### Phase 3A implementation notes
- Black/grey shell styles in `components/shell/app-shell.css` (imported from `app/globals.css`)
- Home chat UI: `HomeScreen`, `HeroPanel`, `ConversationPanel`, `AppHeader`
- Tab pages use `PageShell`; navigation uses `AppDock` (Aceternity floating dock)
- Shared form primitives in `components/ui/primitives.tsx`
- Thread list/switch/delete via `ThreadPicker` in the conversation header

---

---

## Phase 4 (planned)

### Theme
Move from **smart chat assistant** to **multimodal, proactive operator**.

Modern assistants become more useful when they add voice, automation, personalization,
and deeper cross-tool orchestration — while keeping the Phase 3 trust layer (receipts,
confirmations, connection health) as the safety floor.

### What Phase 4 builds on
- Tool calling across memory, reminders, calendar, Gmail, YouTube
- Pre-retrieval + intent routing (`context-intent`, `thread-context`)
- Action receipts, trust tags, persisted `messages.metadata`
- Browser push + cron (`/api/cron/reminders`, Web Push)
- OAuth per-service Connections with scope health (`canSend`, `canUse`)
- Main/side threads, 24h main-chat rotation, runtime clock/timezone context

### Recommended implementation order
Phase 4 has dependencies. Suggested sequence balances user value vs risk:

1. **4D (hybrid memory)** — improves every other sub-phase; start with embeddings + typed memories before heavy automation
2. **4G (settings + quiet hours)** — opt-in controls required before proactive features
3. **4C (agentic workflows, small)** — extend tool loop + bundled confirmations; reuses existing tools
4. **4B (proactive assistant)** — daily brief + nudges on existing cron/push rail
5. **4F (Gmail real-time)** — optional accelerator for inbox triage and 4B email nudges
6. **4A (voice)** — push-to-talk web MVP first; native quality voice ties to 4E
7. **4E (Mac helper)** — last; highest trust and platform risk

Voice-first is a valid *UX* north star, but **proactive + agentic layers should land before hands-free voice** so spoken commands have something reliable to orchestrate.

### Current Phase 4 status
| Sub-phase | Status | Summary |
|-----------|--------|---------|
| 4A | **shipped (4A.3)** | PTT, conversation, wake word, barge-in, streaming TTS, voice overlay UI |
| 4B | **shipped (4B.1–4B.4)** | Daily brief cron, nudges, follow-ups, `/settings`, `/notifications` |
| 4C | **shipped** | Multi-step cross-tool workflows, plan-first UI, web search/fetch, per-step streaming receipts |
| 4D | **shipped** | pgvector hybrid memory, 7 types, salience, decay, memory_links, Memory Manager UI overhaul |
| 4E | planned | Native Mac helper: menu bar voice, OS actions, background/cross-app audio |
| 4F | planned | Gmail Pub/Sub + inbox awareness |
| 4G | **partial (bundled in 4B)** | Proactive settings on `/settings`; full settings page deferred |
| 4H | planned | Activity audit log for sensitive actions |

---

### Phase 4A — Voice (shipped 4A.3)

**Goal:** Talk to the assistant with speech input; hear spoken replies in voice mode.

**How it works**
- **STT providers:** OpenAI (`gpt-4o-mini-transcribe`) or Google Cloud Speech-to-Text via `POST /api/voice/transcribe`
- **TTS providers:** OpenAI (`tts-1` / `tts-1-hd`) or Google Cloud Neural2 via `POST /api/voice/synthesize`
- **Streaming voice replies:** voice turns use SSE from `POST /api/chat`; TTS prefetches the next sentence while the current one plays
- **Push-to-talk:** hold mic → record → release → transcribe → send → hear reply
- **Conversation mode:** tap mic to toggle; auto-send after silence; mic resumes after each reply
- **Wake word:** say **Hey Nova** while this tab is open (browser speech recognition — Chrome, Edge, Safari; no API key)
- **Barge-in:** speak during TTS or hold mic while assistant is talking to interrupt; optional speech-detect monitor ducks audio first
- **Stop:** cancels mic, chat request, and audio playback immediately
- **Voice overlay:** waveform, state labels, recording timer, contextual hints above the composer

**Voice settings**
- Voice mode: Off (PTT only), Conversation, or Wake word
- STT / TTS provider (OpenAI or Google Cloud)
- Speak replies aloud, barge-in, instant “Got it” ack while thinking
- Reply voice, speech speed, high-quality OpenAI TTS (optional)
- Wake word match sensitivity (browser speech recognition)
- Silence before send (conversation / wake turns)

**Environment variables**

```bash
OPENAI_API_KEY=              # OpenAI STT/TTS
GCP_PROJECT_ID=              # Google Cloud Speech + TTS
GOOGLE_APPLICATION_CREDENTIALS=./gcp-service-account.json   # local dev (recommended)
GCP_SERVICE_ACCOUNT_JSON=    # Vercel: entire JSON on ONE line
```

**Important:** `.env` parsers only read the first line of a value. Do **not** paste multi-line JSON into `.env.local` — save the key to `gcp-service-account.json` (gitignored) and point `GOOGLE_APPLICATION_CREDENTIALS` at it instead.

**Google Cloud setup (one-time)**
1. Create a GCP project and enable billing (trial credits apply)
2. Enable **Cloud Speech-to-Text API** and **Cloud Text-to-Speech API**
3. Create a service account with Speech Client access (or Editor for dev)
4. Download JSON key → `gcp-service-account.json` locally (`GOOGLE_APPLICATION_CREDENTIALS`) or single-line `GCP_SERVICE_ACCOUNT_JSON` on Vercel
5. In voice settings, set STT/TTS provider to **Google Cloud**

**Wake word**
- Uses the browser **Web Speech API** (no API key, no domain registration)
- Set mode to **Wake word** in settings — listening starts **automatically in the chat view** (no mic tap needed)
- Configure one or more phrases in settings (default: **Hey Nova**)
- Say the wake phrase from chat → voice overlay opens and the mic captures your command
- Supported in **Chrome, Edge, and Safari** with this tab in the foreground

**Not in scope (deferred)**
- ElevenLabs TTS
- Background wake when tab is closed (Phase 4E)
- Voice while another tab or window is focused — hear replies and keep listening without the chat tab active (Phase 4E; browsers throttle background Web Audio)
- Text chat SSE streaming (voice-only today)

**Builds on:** existing `runTurn` / `runTurnStream`, tool loop, reminders. Voice disabled while an image is attached.

**Manual test matrix (4A.3)**
- Hold mic during TTS → speech stops, new utterance captured
- Speak during TTS in conversation mode (no Stop button) → barge-in
- Wake word: “Hey Nova” → listening without tap (Chrome / Edge / Safari)
- Reminder voice command → hear “Setting that reminder…” then confirmation
- Stop mid-stream → no ghost mic resume
- First sentence plays before reply finishes (streaming TTS prefetch)
- Conversation mode: mic resumes after TTS queue drains
- Google STT/TTS with GCP env configured; OpenAI fallback when Google not set

**Limitations**
- **Long replies** are chunked for TTS (≤4096 chars per API call) and played sequentially.
- **Wake word** uses browser speech recognition while this tab is open (Chrome, Edge, Safari).
- **TTS and listening** require the chat tab to be in the foreground for reliable behavior; background/cross-tab voice is Phase 4E.
- **Hands-free in pocket** needs Phase 4E native helper.
- **Max recording:** 2 minutes per turn (`MAX_RECORDING_MS = 120_000`); stuck-mic watchdog at 45s of unbroken audio (`STUCK_OPEN_MS = 45_000`).
- **Privacy:** audio is sent to OpenAI/Google for transcription and synthesis; wake-word listening uses the browser’s speech recognition service (e.g. Google in Chrome). Clips are not stored server-side.
- **Claude has no built-in audio** — STT/TTS are separate from the chat model.

**Feasibility:** Push-to-talk + conversation + wake word + barge-in on web is **shipped**.

---

### Phase 4B — Proactive assistant (shipped 4B.1–4B.4)

**Goal:** The assistant reaches out at the right time — not just when you open chat.

**Shipped**
- **`/settings`** — proactive tier (off / reminders only / full), daily brief time, timezone, quiet hours, push toggle (default **off**)
- **`/notifications`** — in-app center with open, snooze (1h), dismiss
- **`/api/cron/proactive`** — every 5 min: daily brief (Haiku + `preRetrieveContext`), deadline/overdue/conflict nudges, post-meeting follow-ups
- **Push** — typed payloads (`daily_brief`, nudge types) via extended `sw.js`
- **DB** — `user_preferences`, `proactive_notifications` (migrations `012`, `013`)

**Features**
- **Daily brief** (opt-in, user-chosen time): calendar highlights, pending reminders, key unread emails, suggested priorities
- **Gentle nudges:** before deadlines, calendar conflicts, or overdue reminders
- **Follow-ups:** post-meeting (“want a summary note?”), post-important-email (“draft a reply?”)
- **Delivery channels:** browser push (extend existing), in-app notification center, optional email digest (separate from Gmail API send)
- **Snooze / dismiss** per nudge; never spam — respect quiet hours (4G)

**Builds on:** `CRON_SECRET` cron, `push_subscriptions`, `preRetrieveContext`, calendar/Gmail tools, runtime timezone from memories

**Suggested first slice:** morning brief push for users who opted in — cron job + one LLM summarization turn + push payload.

**Limitations**
- **Cron granularity:** Vercel cron is ~1–5 min resolution; not true real-time. Fine for briefs; marginal for “meeting starts in 2 minutes.”
- **Gmail awareness without Pub/Sub** requires polling `search_gmail` on a schedule — API quota + staleness. Real-time needs 4F.
- **LLM cost scales with user count** if every brief is a full Sonnet turn; use Haiku + templated context, cache briefs per day.
- **Notification fatigue** kills trust fast; default off, easy mute, quiet hours required.
- **iOS Safari push** limitations may require PWA install for reliable delivery.

**Feasibility:** **High** for daily brief on existing infra. **Medium** for smart follow-ups (need event/email triggers + good ranking).

**Manual test matrix (4B)**
- `/settings` → enable Full + daily brief + save; confirm defaults are off for new users
- `npm run cron:proactive` with brief time within ±5 min → notification row + push
- Same local date → second cron run does not duplicate brief
- Quiet hours (e.g. 11pm local) → no brief/nudge
- Overdue reminder → `overdue_nudge` (max 3 nudges/user/day)
- Calendar overlap → `conflict_nudge`
- Post-meeting window → follow-up with prefilled composer via `/?prompt=...`
- `npm run test:brief-schedule` passes

---

### Phase 4C — Agentic workflows

**Goal:** One request → multiple coordinated actions across tools, with clear confirmation before anything irreversible.

**Features**
- **Workflow planner:** decompose “reschedule my meeting, email Alex, and remind me to prep” into ordered tool steps
- web searches be able to open a new tab on the browser and conduct simple tasks
- **Cross-tool examples:** reschedule calendar event + draft Gmail reply + create reminder + save memory
- **Confirmation layer:** extend Phase 3 receipts to **workflow bundles** — review all steps, approve once or step-through
- **High-impact gates:** send email, delete events, bulk reminder changes always require explicit UI confirm (same philosophy as Gmail Send)
- **Workflow state:** track pending multi-step runs; resume after refresh (persist in DB like `messages.metadata` or `workflow_runs` table)
- **Failure recovery:** if step 3 fails, report what completed and offer retry/rollback where possible

**Builds on:** `executeTool`, `buildReceipt`, `MAX_TOOL_ITERATIONS` (today: 3), action confirm pattern from Gmail draft

**Suggested first slice:** raise tool iteration budget + “workflow receipt” UI for 2–3 step plans with per-step status. No autonomous loops.

**Limitations**
- **Today `MAX_TOOL_ITERATIONS = 3`** in `run-turn.ts` — complex workflows need a dedicated orchestration loop with a higher cap and step budget.
- **Rollback is hard** — calendar update can be reverted; sent email cannot. Design confirmations per action class.
- **Latency stacks** — 5 tool calls = 5 round trips; show progressive receipts, consider parallel read steps.
- **Model drift** — long plans need structured plan-then-execute prompting, not ad-hoc chaining.
- **Trust:** one-tap “approve all” is convenient but dangerous; separate “read steps” from “write steps.”

**Feasibility:** **Medium–high** for bounded workflows (2–5 steps). **Low** for open-ended autonomous agents without scope creep.

---

### Phase 4D — Better memory system (shipped)

**Goal:** Recall the right thing at the right time — not just keyword overlap.

**Shipped**
- **pgvector + HNSW index** — `text-embedding-3-small` (1536-dim) via raw `fetch`; fire-and-forget on every `save_memory`; backfill script for existing rows
- **Hybrid retrieval** — vector cosine similarity + `pg_trgm` ILIKE merged via Reciprocal Rank Fusion (RRF); pinned memories always included; type-aware retrieval weights
- **7 memory types** — `fact`, `preference`, `routine`, `episodic`, `goal`, `relationship`, `skill`; auto-classified on save (pattern matching → Haiku LLM fallback)
- **Salience scoring** — per-type defaults (fact/relationship: 0.85, routine: 0.80, preference/goal/skill: 0.70, episodic: 0.65); displayed as a visual bar in the UI
- **Memory links** — `memory_links` table with types: `related`, `contradicts`, `refines`, `context_of`, `part_of`; auto-detected fire-and-forget on save
- **Decay cron** — episodic: −0.04/week after 14 days; goal: −0.02/week after 30 days idle; archive when salience < 0.15 AND access ≤ 2 AND not pinned; runs Sunday 3am UTC
- **Memory Manager UI overhaul** — type tabs, salience bars, `TypeBadge`, pin/archive actions, “needs review” filter (confidence < 0.7), episodic date field, archive tab
- **Migrations:** `014_memory_v2.sql` (schema), `015_memory_v2_rpc.sql` (`search_memories_by_vector`, `increment_memory_access` RPCs)
- **Scripts:** `npm run db:classify-memories`, `npm run db:backfill-embeddings`

**Architecture decisions**
- Embeddings never block saves (fire-and-forget); missing ones caught by backfill
- `save.ts` dynamically imports `relationships.ts` to break circular dep (save → relationships → search → save)
- `embedding` column excluded from all list/search queries (prevents transferring 6KB of floats per row)
- HNSW index (not IVFFlat) — appropriate for < ~10k rows; switch to IVFFlat at scale with `lists = sqrt(row_count)`

**Limitations**
- **Embedding cost** — one `text-embedding-3-small` call per new memory (~$0.00002 each)
- **Hybrid tuning** is empirical — vector-only misses exact matches (names, dates); keyword-only misses paraphrases; RRF weights are a starting point
- **Classification accuracy** — pattern matching is ~82%+ confident; Haiku fallback has 4s timeout; misclassification propagates to salience defaults
- **Decay/archive** is one-way via cron; restore via Memory Manager archive tab

**Obsidian as memory store?** Possible as a **sync/export layer**, not as the primary database for this app.

| | Supabase `memories` (current + 4D) | Obsidian vault |
|--|-----------------------------------|----------------|
| **Latency** | Single query at chat time; ms on Vercel | File I/O + parse markdown; slow on serverless unless local helper |
| **Multi-device / auth** | RLS per user; works in browser | Vault is local or iCloud/Dropbox; no per-user RLS in a web app |
| **Dedup / merge** | `lib/memory/merge.ts`, reconcile on save | Manual wikilinks; conflict-prone if app and you edit same note |
| **Pre-retrieval** | `pg_trgm` today; pgvector in 4D | Would need to index vault (embed files or grep) on every deploy |
| **Best fit** | Source of truth for the assistant | Human-readable archive; optional **export target** or Mac-helper read |

**Recommendation:** Keep Postgres as source of truth. If you want Obsidian in the loop, use **Phase 4E Mac helper** or a cron job to mirror `memories` → markdown files in a vault folder — not replace Supabase. That gives you editable notes without sacrificing chat latency, RLS, or merge logic.

---

### Phase 4E — Native / device helper (Mac)

**Goal:** Local context and OS-level actions — explicitly gated because device automation changes the trust model.

**Features**
- **Menu bar app** (Swift or Tauri) — always-available voice, quick capture, brief notifications
- **Background / cross-app voice** — hear spoken replies and use wake word or conversation while another tab, window, or app is focused (native audio session; not limited by browser background throttling)
- **App launching, focus management** — “open Calendar”, “start Focus mode”
- **File actions (read-first):** reveal in Finder, open recent downloads, read clipboard — **no destructive ops by default**
- **Local context:** frontmost app, selected text (with permission), calendar/reminder sync offline cache
- **Optional later:** file cleanup suggestions — **review queue only**, never silent delete
- **Secure bridge:** localhost API or signed token to web app; helper never stores Google refresh tokens independently

**Builds on:** Phase 4A voice (better STT via native APIs), 4B push delivery, 4C workflows

**Suggested first slice:** menu bar app that authenticates to the web session, holds the mic/audio session in the background, and sends push-to-talk or wake-word transcripts to `/api/chat` with native TTS playback.

**Limitations**
- **macOS TCC permissions** — Accessibility, Microphone, Automation (AppleScript) each need user approval; fragile UX.
- **Notarization + distribution** outside App Store is its own workstream.
- **Security surface expands** — local API must bind to localhost, use short-lived tokens, resist CSRF from malicious sites.
- **File cleanup is high risk** — treat as Phase 4E-b optional, separate consent, trash-only not permanent delete.
- **Windows/Linux** out of scope unless helper is rewritten.

**Feasibility:** **Medium** for read-only helper + voice. **Low–medium** for file mutation / cleanup.

---

### Phase 4F — Gmail real-time awareness (recommended add-on)

**Goal:** Inbox triage and proactive email nudges without polling Gmail every N minutes.

**Features**
- **Gmail Pub/Sub push** via Google Cloud Pub/Sub → webhook → store unread signal / thread highlights
- **In-chat awareness:** “you got an email from X” nudge (opt-in) with link to summarize in chat
- **Triage queue:** surface starred/important unread in daily brief (4B)

**Limitations**
- Requires **Google Cloud project**, Pub/Sub topic, verified domain or push endpoint, renewal of Gmail `watch` every 7 days.
- Webhook must be always-on (not pure serverless cold start) or use a queue worker.
- Still read-only until user confirms send via existing draft receipt flow.

**Feasibility:** **Medium** — well-documented Google pattern, but ops-heavy. Polling is acceptable fallback for 4B v1.

---

### Phase 4G — Assistant settings & proactive controls (recommended add-on)

**Goal:** Personalization and safety rails for 4A/4B — users control when the assistant acts.

**Features**
- **Settings page:** briefing time, timezone override, voice on/off, TTS voice selection
- **Quiet hours:** no proactive push 10pm–8am (default sensible, user editable)
- **Proactive tiers:** off / reminders only / full brief + nudges
- **Per-channel toggles:** push, in-app, voice readout

**Feasibility:** **High** — mostly UI + `user_preferences` table. Do before 4B ships broadly.

---

### Phase 4H — Activity audit log (recommended add-on)

**Goal:** Transparency for agentic and proactive behavior — aligns with Phase 3 trust theme.

**Features**
- **Timeline:** “created reminder”, “drafted email”, “calendar updated”, “brief sent”, “memory saved”
- **Filter by source** (Gmail, Calendar, etc.) and undo where still possible
- **Export / delete** for privacy compliance

**Builds on:** `actionReceipts`, `messages.metadata`, tool handler results

**Feasibility:** **High** once 4C workflows exist; **medium** now with existing receipts only.

---

### Phase 4 cross-cutting concerns

**Trust & safety (non-negotiable)**
- Extend Phase 3 confirm pattern: **writes need confirmation**, reads can be automatic
- Proactive messages must be **opt-in**, **snoozable**, and **labeled** (“Daily brief”, “Follow-up suggestion”)
- Mac helper (4E) requires **separate permission manifest** from web OAuth

**Cost model**
| Area | Cost driver |
|------|-------------|
| 4A Voice | STT/TTS API per minute |
| 4B Proactive | LLM brief generation per user per day |
| 4C Agentic | Multiplied tool + model turns per request |
| 4D Memory | Embedding API per memory + storage |

Mitigation: Haiku for briefs/routing, cache briefs, batch embeddings, cap proactive frequency.

**Platform constraints**
- **Vercel serverless:** long voice sessions and workflow loops may need streaming endpoints or background workers (Inngest, Trigger.dev, or self-hosted worker).
- **Supabase:** pgvector and cron-friendly tables scale well; watch row growth for audit log.
- **Browser push:** extend `sw.js` for brief/nudge notification types with action buttons (“Open”, “Snooze”).

### Phase 4 quality bar
- [x] Proactive features default **off**; one-screen opt-in with preview
- [x] Voice mode works in Chrome desktop push-to-talk without hands-free
- [x] Hybrid memory beats keyword-only on paraphrase recall (vector + RRF shipped)
- [x] Daily brief delivers in user timezone within 15 minutes of chosen time
- [ ] Multi-step workflow shows per-step receipts before any write
- [ ] Mac helper v1 is read-only + voice capture; no silent file changes
- [ ] Audit log captures every write action across tools

### Phase 4 out of scope (explicit)
- Full autonomous agent with unbounded tool loops
- Sending email without UI confirmation (chat “yes send it” path)
- Silent file deletion or bulk inbox modify
- Replacing Google apps (native calendar/email clients)
- Multi-user / team / shared workspaces

---

## Future roadmap (notes)

Personal north-star items beyond current Phase 4 scope. Ordered roughly by theme; implementation order TBD.

### 1. Faster voice pipeline (STT + TTS)

**Goal:** Voice should feel instant — not “wait for transcription, wait for synthesis.”

**Directions to explore:**
- **Faster STT** — streaming partial transcripts (OpenAI Realtime, Deepgram, AssemblyAI, or native macOS Speech) instead of record-then-transcribe
- **Faster TTS** — lower-latency voices (OpenAI `gpt-4o-mini-tts`, Cartesia, ElevenLabs Flash, Google Chirp 3 HD) and **smaller first-chunk latency** (shorter `firstChunkMinChars`, parallel synth)
- **End-to-end streaming** — pipe STT deltas into chat while the user is still speaking; start TTS on first sentence before the full reply arrives
- **Model routing for voice** — Haiku for voice turns by default; reserve Sonnet for complex tool-heavy asks
- **On-device options** — Apple Speech / Core ML for wake word + STT on Mac (ties to 4E)

**Status:** Phase 4A.3 shipped PTT, conversation, wake word, barge-in, and streaming TTS — but latency is still a top pain point. Treat speed as an ongoing workstream, not a one-time feature.

---

### 2. Browser control

**Goal:** The assistant can operate the browser on your behalf — not just chat about it.

**Examples:**
- Open, close, and focus tabs
- Group / organise tabs (by topic, project, or “clean up duplicates”)
- Navigate URLs, run simple in-page tasks where safe

**Approach options:**
- **Chrome extension** or **Safari Web Extension** with explicit permissions (recommended for trust)
- **Composio browser toolkits** (if/when integrated — see [Composio](#composio-optional))
- **Playwright / Puppeteer** only in a local helper (4E) — not on Vercel serverless

**Trust:** read/navigation can be automatic; closing tabs or bulk changes need confirmation receipts (Phase 3 pattern).

**Related:** Phase 4C (“web searches open a new tab”) — fold browser control into agentic workflows.

---

### 3. Native device control + global wake word

**Goal:** Local OS integration and **always-on** “Hey Jarvis” — wake the assistant without focusing the chat tab.

**Native actions (Mac first, 4E):**
- Organise, launch, move, and delete files (delete → trash by default, never silent permanent delete)
- Reveal in Finder, open apps, clipboard / selected text (with permission)
- File cleanup **suggestions** with a review queue — not autonomous deletion

**Global wake word:**
- Requires **native helper** (menu bar app) — browsers cannot listen in the background reliably (Phase 4A defers this to 4E)
- System-wide hotkey or wake phrase → capture audio → send to `/api/chat` → native TTS playback
- Optional: low-power always-listening on device vs push-to-talk fallback

**Related:** Phase 4E — extend with file CRUD and background audio session.

---

### 4. Anthropic prompt caching (cost)

**Goal:** Reduce recurring API cost on long system prompts, tool definitions, and stable context.

**Directions:**
- Use Anthropic **prompt caching** on system prompt blocks, tool schemas, and semi-static pre-retrieval context
- Cache breakpoints on: `buildSystemPrompt`, `TOOL_DEFINITIONS`, repeated memory/calendar snippets within a session
- Measure cache hit rate and $/turn before/after in production

**Status:** Not implemented. Add when monthly token spend justifies the integration work.

---

### 5. Alfred voice profile & personality

**Goal:** A distinct assistant persona — calm, witty, loyal, subtly formal — in the vein of **Alfred Pennyworth** (Batman).

**Directions:**
- Dedicated **voice profile** preset: TTS voice + speed + prosody tuned for “butler” delivery
- Personality module extension beyond Phase 2D: dry humour, understated confidence, occasional light jokes, never cheesy
- **Spoken vs written tone** — voice replies shorter and more conversational; chat can stay slightly more structured
- User toggle: personality intensity (subtle / full Alfred)

**Builds on:** `lib/chat/personality.ts`, voice settings, system prompt.

---

### 6. Composio — broader integrations (Google Docs, etc.)

**Goal:** One integration layer for many apps instead of hand-rolling each OAuth flow.

**Targets:** Google Docs, Sheets, Slack, Notion, GitHub, Linear, and others via Composio toolkits.

**Status:** [Composio section](#composio-optional) documents setup; **not wired yet**. Google Calendar / Gmail / YouTube remain direct OAuth.

**Planned wiring:** `COMPOSIO_API_KEY`, user id = Supabase auth id, extend `/connections`, merge tools in `lib/tools/handlers.ts`, keep Phase 3 confirm pattern for writes.

---

### 7. School section

**Goal:** A dedicated area for coursework — separate from general chat and memory, but still one brain underneath.

**Ideas:**
- **`/school` tab** (or thread section): assignments, deadlines, project notes, study plans
- **School-scoped memory** — courses, syllabi, prof names, extension dates (category or RAG partition)
- **Document-aware help** — upload or link briefs, rubrics, lecture notes; Q&A and draft feedback
- **Proactive nudges** — deadline reminders, “exam in 3 days” (extends 4B)
- **Obsidian / folder sync** (optional) — export school memories to markdown for your own notes; Postgres stays source of truth (see 4D Obsidian discussion)

**Not:** replacing LMS or doing graded submissions autonomously.

---

### 8. Omni-channel consistency

**Goal:** Every surface feels like **one product** — same brain, same trust patterns, same visual language.

**Principles:**
- Shared design tokens, components, and interaction patterns across chat, memory, reminders, connections, settings, notifications, school
- **Consistent mechanisms:** action receipts, confirm-before-write, connection health, undo, trust tags — everywhere tools run
- **Cross-surface context:** something saved in memory appears in briefs; a reminder created in chat shows in `/reminders`; school deadlines in notifications
- **Single navigation model** — dock, header, thread sections aligned; no “orphan” pages with different UX rules

**Related:** Phase 3A design system + Phase 3D IA — extend as new tabs ship.

---

### 9. Mobile (iOS)

**Goal:** Native or PWA experience on phone — chat, voice, push, memory on the go.

**Options:**
- **PWA first** — installable web app + Web Push (limited on iOS Safari)
- **Native iOS** — SwiftUI shell, shared Supabase auth, push via APNs, background audio for voice
- **Mac helper parity** — handoff between Mac menu bar and iPhone

**Status:** Phase 4 out of scope listed native mobile; this is explicit future intent (iOS priority).

---

### 10. Pluggable architecture (models, voices, features)

**Goal:** Swap components quickly as better models and providers ship — no rewrite per change.

**Directions:**
- **Model registry** — config-driven routing (`ANTHROPIC_MODEL_*`, per-task overrides); add new Claude/GPT models via env + one registry file
- **Voice provider adapter** — unified `STTProvider` / `TTSProvider` interface (partially exists); add Cartesia/ElevenLabs/native in one place
- **Feature flags** — enable/disable subsystems (school, proactive, Composio) without ripping out code
- **Tool registry** — register Composio + custom tools dynamically; deprecate tools without breaking chat
- **Migrations + RLS** as the only hard coupling — keep business logic in `lib/` modules

**Principle:** new model or voice = config + adapter, not a fork.

---

### 11. Proactive productivity & deep memory

**Goal:** The assistant **speaks first** — surfaces what matters before you ask — and **continuously learns** you.

**Proactive (extends 4B):**
- “You have a meeting in 20 minutes” / “Three emails need replies” / “Assignment due tomorrow” without opening chat
- **AI-initiated voice** — optional spoken brief or nudge when appropriate (quiet hours, user tier)
- Rank nudges by salience; cap frequency; always snooze/dismiss

**Deep integrated memory:**
- **Proactive learning** — assistant saves durable facts from conversation without being asked (Phase 3C started this); extend with confidence, user review queue for sensitive facts
- **Phase 4D** — embeddings, routines, episodic memory, decay
- **Cross-source profile** — calendar + Gmail + school + workouts form a unified “what Aryav cares about this week”
- **Memory-driven briefs** — daily brief references your goals, not just inbox/calendar

**Trust:** proactive memory saves should be visible (receipt + Memory Manager); user can delete or “don’t remember this.”

---

## Later (beyond Phase 4)

Items that overlap the [Future roadmap](#future-roadmap-notes) above; kept for quick reference.

- Multi-device push sync and per-device management (410 auto-resubscribe)
- Windows/Linux native helpers
- Wearable / CarPlay / Siri Shortcuts integration
- Shared family calendar / delegate sending
- On-device local LLM for offline voice commands
