# Nova — native macOS companion

A tray-only Electron app that brings the Nova AI assistant to your desktop as an always-on-top voice orb. Say "Hey Jarvis" (or press `Cmd+Shift+Space`) to start a conversation. Open the full app window from the tray for settings, reminders, memory, and Google account connections.

Shares the same Supabase backend (auth, conversations, memories, preferences) as the Nova web app.

## What it does

- **Voice orb** — always-on-top canvas orb; wake word ("Hey Jarvis"), barge-in, earcon, continuous conversation mode
- **Full app window** — Settings, Reminders, Memory, and Connections tabs
- **Memory-aware chat** — conversation history, hybrid memory retrieval (pgvector + pg_trgm), tool use (calendar, Gmail, reminders)
- **Google integrations** — Calendar, Gmail, YouTube taste profile via OAuth deep-link (`nova://connections-callback`)
- **Text input** — type alongside voice in the orb window

## Development

```bash
npm install
npm run dev          # electron-vite dev server with HMR
npm test             # vitest
npm run build        # tsc --noEmit + electron-vite build (type/lint gate)
npm run wake:models  # download openWakeWord ONNX models
```

## Environment variables

Create `.env.local` in this directory:

```env
# Required
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=          # STT (Whisper / gpt-4o-transcribe) + TTS

# Google integrations (Connections tab)
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_TOKEN_ENCRYPTION_KEY=   # 32-byte key as 64 hex chars or base64

# Google Cloud voice (streaming STT + Google TTS) — service account, NOT the OAuth client above
GCP_PROJECT_ID=
GOOGLE_APPLICATION_CREDENTIALS=./gcp-service-account.json   # or GCP_SERVICE_ACCOUNT_JSON (single-line)

# Composio (Google Docs, Notion, Slack, ... as assistant tools)
COMPOSIO_API_KEY=
COMPOSIO_USER_ID=              # optional, default "default"

# Optional
DEEPGRAM_API_KEY=              # Deepgram TTS provider
ANTHROPIC_MODEL_LIGHT=         # default: claude-haiku-4-5-20251001
OPENAI_STT_MODEL=              # default: gpt-4o-transcribe
```

**Google OAuth setup (one-time):** Add `nova://connections-callback` as an authorized redirect URI in your OAuth 2.0 client at [console.cloud.google.com](https://console.cloud.google.com). Client type must be "Desktop app" or allow custom URI schemes.

**"Access blocked: app has not completed verification":** Google blocks consent for unverified OAuth apps. In [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → OAuth consent screen → Audience, add your own Google account under **Test users** (or set Publishing status to *In production*). Also make sure the **Gmail API** and **Google Calendar API** are enabled under APIs & Services → Library. Reconnect from the Connections tab afterwards — failures now show the exact error there instead of failing silently.

## Streaming voice (Google Cloud)

With the GCP service account configured, Nova transcribes **while you speak** (Speech-to-Text V1 `streamingRecognize` fed by the same 16 kHz PCM frames the wake-word engine uses), so the reply starts a few hundred ms after you stop talking instead of after a full upload round-trip. If the stream fails or GCP isn't configured, the recorded audio falls back to the batch STT provider selected in Settings.

## Mac automation

Beyond volume/brightness/app-launching, the assistant can drive apps and browsers via `run_applescript` (AppleScript incl. System Events UI scripting) and `run_shortcut` (macOS Shortcuts). First use will trigger macOS permission prompts:

- **Accessibility** (System Settings → Privacy & Security → Accessibility) — needed for simulated keys/clicks and brightness key fallback (or `brew install brightness` to avoid it)
- **Automation** (System Settings → Privacy & Security → Automation) — per-app consent when Nova scripts Safari, Chrome, Notes, etc.

## Composio setup (Google Docs & friends)

1. Create an account at [app.composio.dev](https://app.composio.dev) and copy an API key from Settings → API Keys.
2. Put it in `.env.local` as `COMPOSIO_API_KEY=...` and restart Nova.
3. In the Composio dashboard, go to **Apps** → pick *Google Docs* (or Notion, Slack, ...) → **Connect account** and complete the OAuth flow. Leave the entity/user id as `default` (or set `COMPOSIO_USER_ID` to match a custom one).
4. That's it — ask Nova e.g. *"create a Google Doc called Meeting notes and add today's agenda"*. The assistant discovers actions with `composio_search_tools` and runs them with `composio_execute`.

## Build & distribute (macOS)

Requires an Apple Developer ID. Set in the shell or CI:

```env
CSC_LINK=                    # base64 or path to Developer ID Application .p12
CSC_KEY_PASSWORD=            # .p12 password
APPLE_ID=
APPLE_APP_SPECIFIC_PASSWORD=
APPLE_TEAM_ID=
```

```bash
npm run dist    # build + sign + notarize → .dmg
```

The native probe is bundled (`asarUnpack` keeps `.node` files outside the asar). A successful launch logs `[nova] native probe: native-ok`, confirming the addon survived signing and notarization.
