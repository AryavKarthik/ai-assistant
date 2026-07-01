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

# Optional
DEEPGRAM_API_KEY=              # Deepgram TTS provider
ANTHROPIC_MODEL_LIGHT=         # default: claude-haiku-4-5-20251001
OPENAI_STT_MODEL=              # default: gpt-4o-transcribe
```

**Google OAuth setup (one-time):** Add `nova://connections-callback` as an authorized redirect URI in your OAuth 2.0 client at [console.cloud.google.com](https://console.cloud.google.com). Client type must be "Desktop app" or allow custom URI schemes.

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
