# Nova — native macOS companion

A tray-only Electron app that brings the Nova AI assistant to your desktop as an always-on-top voice orb. Say "Hey Jarvis" (or press `Cmd+Shift+Space`) to start a conversation. Open the full app window from the tray for settings, reminders, memory, and Google account connections.

Shares the same Supabase backend (auth, conversations, memories, preferences) as the Nova web app.

## What it does

- **Voice orb** — always-on-top canvas orb; wake word ("Hey Jarvis"), barge-in, earcon, continuous conversation mode. The conversation stays open turn-to-turn and ends when you fall silent or say a dismissal — strong kill phrases ("that will be all", "stop listening", "goodbye", …) work anywhere in a sentence ("thanks Jarvis, that'll be all for today"), softer ones ("that's enough", "I'm done") when the sentence ends with them. Plain "stop"/"cancel" only dismiss on their own, so "stop the timer" still works as a command.
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

**Google OAuth setup (one-time):** Create an OAuth 2.0 client of type **Desktop app** at [console.cloud.google.com](https://console.cloud.google.com) (APIs & Services → Credentials) and put its id/secret in `.env.local`. **No redirect URI is registered** — the console rejects custom schemes like `nova://` as "not a valid URL", so Nova uses the loopback flow instead: connecting starts a one-shot local server on `127.0.0.1` and Google redirects there, which Desktop-app clients accept without any configuration.

**"Access blocked: app has not completed verification":** Google blocks consent for unverified OAuth apps. In [console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → OAuth consent screen → Audience, add your own Google account under **Test users** (or set Publishing status to *In production*). Also make sure the **Gmail API** and **Google Calendar API** are enabled under APIs & Services → Library. Reconnect from the Connections tab afterwards — failures now show the exact error there instead of failing silently.

## Streaming voice (Google Cloud)

With the GCP service account configured, Nova transcribes **while you speak** (Speech-to-Text V1 `streamingRecognize` fed by the same 16 kHz PCM frames the wake-word engine uses), so the reply starts a few hundred ms after you stop talking instead of after a full upload round-trip. If the stream fails or GCP isn't configured, the recorded audio falls back to the batch STT provider selected in Settings.

## macOS permissions

Nova asks for **Microphone** access once at launch (required for the wake word and voice turns). If you denied it earlier, nothing will prompt again — enable Nova manually in System Settings → Privacy & Security → Microphone and relaunch. When the mic is unavailable the orb shows an error and retries for a short while instead of failing silently. Packaged builds ship the required Info.plist usage descriptions and entitlements automatically (`npm run dist`).

## Mac automation

Beyond volume/brightness/app-launching, the assistant can drive apps and browsers via `run_applescript` (AppleScript incl. System Events UI scripting) and `run_shortcut` (macOS Shortcuts). First use will trigger macOS permission prompts:

- **Accessibility** (System Settings → Privacy & Security → Accessibility) — needed for simulated keys/clicks and brightness key fallback (or `brew install brightness` to avoid it)
- **Automation** (System Settings → Privacy & Security → Automation) — per-app consent when Nova scripts Safari, Chrome, Notes, etc.

## Composio setup (Google Docs & friends)

1. Create an account at [app.composio.dev](https://app.composio.dev) and copy an API key from Settings → API Keys.
2. Put it in `.env.local` as `COMPOSIO_API_KEY=...` and restart Nova.
3. In the Composio dashboard, go to **Apps** → pick *Google Docs* (or Notion, Slack, ...) → **Connect account** and complete the OAuth flow. Leave the entity/user id as `default` (or set `COMPOSIO_USER_ID` to match a custom one).
4. That's it — ask Nova e.g. *"create a Google Doc called Meeting notes and add today's agenda"*. The assistant discovers actions with `composio_search_tools` and runs them with `composio_execute`.

## Windows support (Phase 1)

The core assistant runs on Windows: wake word, voice turns (STT/TTS/streaming), chat + memory, reminders, timers, proactive announcements, Google connections, Composio, and the tray/orb UI. **Not yet available on Windows** (macOS-only automation, pending a Phase-2 port): AppleScript/Shortcuts, app launching/quitting, volume/brightness control, media transport, screen capture (`see_screen`/`take_screenshot`), Spotlight file search, System Settings panes, and Chrome tab control — these tools are automatically hidden from the assistant on Windows so it says so instead of failing.

- Build: `npm run dist:win` (NSIS installer). Unsigned Phase-1 builds trigger a SmartScreen warning — "More info → Run anyway".
- Microphone: allow it under Windows Settings → Privacy & security → Microphone (plus "Let desktop apps access your microphone").
- Deep links (`nova://` magic-link / OAuth) are delivered through the single-instance relaunch mechanism; if a login link doesn't land in dev, use the paste-callback fallback on the sign-in screen.
- Win11 renders the app window with acrylic translucency; Win10 falls back to the solid dark background.

Smoke-test checklist after installing on Windows: app appears in the system tray → `Ctrl+Shift+Space` shows the orb → mic permission granted → "Hey Jarvis" fires → a voice turn completes end-to-end → links in replies open in the browser → dragging the orb persists its spot across restart → collapsed orb doesn't block clicks on windows beneath it → clicking a `nova://auth-callback` link reaches the running app.

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
