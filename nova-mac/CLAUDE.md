# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`nova-mac` is the native macOS Electron companion to the Next.js web app one level up
(`../CLAUDE.md`). It is a tray-only, always-on-top "orb" voice assistant. It shares the
**same Supabase backend and schema** as the web app (auth, `conversations`, `memories`,
`user_preferences`) but is a completely separate codebase, build system, and runtime.

## Commands

```bash
npm run dev          # electron-vite dev (main + preload + renderer with HMR)
npm run build        # tsc --noEmit  +  electron-vite build  (THIS is the type/lint gate)
npm test             # vitest run (all *.test.ts)
npm run test:watch   # vitest watch
npm run dist         # build + electron-builder --mac (signed/notarized .dmg)
npm run wake:models  # download the openWakeWord ONNX models into electron/wakeword/models

npx tsc --noEmit                          # type-check only
npx vitest run electron/wakeword/framing.test.ts   # run one test file
npx vitest run -t "AudioRingBuffer"                # run tests matching a name
```

There is **no ESLint / no lint script**. TypeScript strict mode is the only static gate;
`npm run build` (or `npx tsc --noEmit`) is what catches errors before commit. Tests are
colocated `*.test.ts` files run by Vitest in a Node environment.

## Three-process / three-build architecture

electron-vite produces three independent bundles (`electron.vite.config.ts`):

| Target | Entry | Output | Notes |
|--------|-------|--------|-------|
| main | `electron/main.ts` **and** `electron/wakeword/worker.ts` | `out/main/` | Two entries — the wake worker must be its own file because it runs in a `worker_threads` Worker. |
| preload | `electron/preload.ts` | `out/preload/` | Forced to **CJS** (`format: "cjs"`) — Electron's sandbox rejects ESM preload, and `"type":"module"` would otherwise emit `.mjs`. |
| renderer | `index.html` → `src/main.tsx` | `out/renderer/` | React 19 + framer-motion. |

`onnxruntime-node` and `ws` are marked **`external`** in the main rollup config: they load
native `.node` bindings via dynamic `require` at runtime and cannot be statically bundled.

The `@shared/*` path alias (→ `shared/`) is declared in **three** places that must stay in
sync: `tsconfig.json`, `electron.vite.config.ts`, and `vitest.config.ts`.

## The IPC contract (single source of truth)

`shared/types.ts` defines the `IpcChannel` enum plus every request/response type. The contract
has three layers that must always agree when you add or change a channel:

1. `shared/types.ts` — add the `IpcChannel` member + payload types.
2. `electron/preload.ts` — expose a method on `window.nova` (typed in `src/lib/ipc.ts`).
3. `electron/ipc.ts` — register the handler. Note the split:
   - `registerIpcHandlers` → request/response via `ipcMain.handle` (auth, sync, transcribe, synthesize, prefs).
   - `registerChatBridge` / `registerWakeBridge` → fire-and-forget + push events via `ipcMain.on` / `webContents.send` (chat streaming deltas, wake audio frames, wake-detected).

Actual handler implementations are wired in `main.ts` `app.whenReady()`, mostly via lazy
`import()` so heavy modules don't load at startup.

## App lifecycle & windowing (`electron/main.ts`)

- `dotenv` loads `.env.local` then `.env` **at the very top** before anything reads
  `process.env` — electron-vite does not auto-load env for the main process.
- Tray-only: `app.dock?.hide()`, `window-all-closed` is a no-op (app keeps running).
- Global hotkey `Cmd+Shift+Space` toggles the orb window.
- `nova://` is registered as a deep-link protocol; `open-url` delivers the Supabase magic-link
  auth callback.
- The native probe (`electron/native-probe`) is loaded lazily via `bindings` and is **expected
  to fail in dev** (no compiled addon) — that failure is swallowed to one warn line.

## Auth & Supabase

- Magic-link OTP (`auth.signInWithOtp`) with `emailRedirectTo: nova://auth-callback`.
  `handleAuthCallback` tolerates both hash-token and `?code=` (PKCE) callback shapes.
- Sessions are persisted **encrypted** via Electron `safeStorage` (Keychain) to
  `userData/session.bin` — see `electron/session-store.ts`. Supabase client itself runs with
  `persistSession: false`; we restore manually on boot via `restoreSession()`.
- `electron/supabase.ts` builds the client with a Node `ws` realtime transport.
- `electron/sync.ts`: read-only list of conversations/memories. **Never `select("embedding")`**
  on `memories` — it is ~6 KB of floats per row.

## Voice turn — the core flow

A full interaction is orchestrated in `src/hooks/useVoice.ts` (renderer). The mic stream and
Web Audio live in the renderer; STT/TTS/chat calls cross IPC to the main process (which holds
the API keys).

```
wake word fires (main)  ──IPC WakeDetected──▶  useVoice.runTurn()
  orb: summon → listening
  recordUntilSilence(stream)            // MediaRecorder until VAD silence (prefs.silenceMs)
  ──IPC transcribe──▶ electron/voice/stt.ts (OpenAI Whisper/gpt-4o-transcribe)
  orb: submit(transcript) → processing
  ──IPC chatSend──▶ electron/chat.ts (Anthropic streaming) ──ChatDelta/Done/Error──▶
  orb: responseStart → responseDelta…    // text streams into the orb
  VoicePlayer.playStreaming()            // sentence-by-sentence TTS, prefetched
  barge-in: TtsBargeInListener stops playback + chatCancel + restarts a turn
  endTurn() ──IPC voiceTurnEnded──▶ main re-arms wake scoring
```

- **Orb UI is a pure reducer**: `src/orb/orb-machine.ts` (`dormant → listening → processing →
  responding`, plus `working`/`error`/`bargeIn`). All UI state transitions go through it.
- **Streaming TTS** (`src/voice/player.ts`): a `SentenceBuffer` chunks the streamed reply into
  sentences; chunks are synthesized ahead (prefetch depth 2) and scheduled gaplessly on a
  Web Audio timeline (`scheduledEnd`). `stop()`/barge-in aborts in-flight synth + sources.
- **Voice preferences** come from Supabase `user_preferences.voice` (JSON) merged over
  `DEFAULT_VOICE_PREFERENCES` in `shared/types.ts`. Default interaction mode is `wake_word`.

### Known stubs / current limitations (do not assume these exist)
- `electron/chat.ts` is a **bare** Anthropic stream: fixed system prompt, **no memory
  retrieval, no tools, and only the latest turn** (no conversation history). The web app's
  memory/tool system is *not* ported here.
- Google STT and Google TTS throw "not yet wired" — only OpenAI (STT+TTS) and Deepgram (TTS)
  are implemented in `electron/voice/`.

## Wake word pipeline (openWakeWord, "Hey Jarvis")

Capture (renderer) → ONNX inference (main worker thread). Getting any step wrong silently
produces near-zero scores rather than an error, so the exact contract matters:

- `src/voice/wake-capture.ts`: an `AudioContext({sampleRate:16000})` resamples the mic and
  emits **Int16, 16 kHz mono, 1280-sample (~80 ms) frames** (`SAMPLES_PER_FRAME` in
  `shared/wake-constants.ts`) over `IpcChannel.WakeAudioFrame`.
- `electron/wakeword/index.ts` (`WakeWordController`, main thread): forwards frames to the
  worker, applies a fire threshold (default `0.05`), debounce, and an arm/re-arm gate; pauses
  during a voice turn and resumes on `voiceTurnEnded`.
- `electron/wakeword/worker.ts` + `engine.ts`: three-stage ONNX pipeline
  `melspectrogram.onnx → embedding_model.onnx → hey_jarvis_v0.1.onnx`. **Preprocessing the
  models were trained on (all four are required or scores flatline near 0):**
  1. Feed the mel model **raw int16-scale** float32 (≈±32768), **not** normalized [-1,1].
  2. Normalize the mel **output** with `value/10 + 2` before the embedding model.
  3. Stream mel with a **480-sample (3-hop) context prefix** so each 1280-sample chunk yields
     8 continuously-aligned frames (window=640/40 ms, hop=160/10 ms, `frames(N)=N/160−3`).
  4. Emit **one embedding per 8 mel frames** (openWakeWord window=76, step=8) so the
     16-embedding wake input spans ~1.3 s — not one embedding per frame.
- Models live in `electron/wakeword/models/` (fetch with `npm run wake:models`) and are bundled
  for production via `extraResources` → `wakeword-models` in `electron-builder.json`.

## Packaging notes (`electron-builder.json`)

- `asarUnpack: ["**/*.node"]` keeps native addons outside the asar so they load post-sign.
- `hardenedRuntime` + `notarize` + `build/entitlements.mac.plist` — a successful install logs
  `[nova] native probe: native-ok` on first launch, confirming the addon survived
  signing/notarization. Signing needs `CSC_LINK`/`CSC_KEY_PASSWORD` and
  `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` in the environment (see `README.md`).

## Environment variables

Local dev minimum (`.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (STT + TTS). `DEEPGRAM_API_KEY` only if using Deepgram
TTS. Model override: `ANTHROPIC_MODEL_LIGHT` (default `claude-haiku-4-5`), `OPENAI_STT_MODEL`.

## Roadmap — phase-4e plans 3 & 4 (not yet built)

Plans 1 (foundation) and 2 (orb-voice) shipped — full plan docs live in
`../docs/superpowers/plans/2026-06-30-phase-4e-plan-{1,2}-*.md`. Plans 3 and 4 are outlined
below for a fresh session to scope into full plan docs and implement. They are independent of
each other and can be done in either order, though **plan 3 is the higher-value gap**.

### Plan 3 — Memory + conversation context in chat

**Problem.** `electron/chat.ts` is currently a bare Anthropic stream: a fixed system prompt,
**no memory retrieval, no tools, and only the latest user turn** (no history). Nova-on-Mac has
zero recall, so it feels stateless compared to the web app.

**Goal.** Bring the Mac chat to rough parity with the web app's `runTurn`, reusing the shared
Supabase store rather than reimplementing memory.

Scope to define in the plan:
- **Conversation history**: thread prior turns into `buildAnthropicMessages` (persist/read
  `messages` for the active conversation; today only `messages: [{user}]` is sent).
- **Memory retrieval**: port/share the web app's `preRetrieveContext` (hybrid pgvector +
  `pg_trgm` search over `memories`) and inject results into the system prompt. Decide whether
  to call the web app's API or query Supabase directly from the main process (it already has an
  authed client in `electron/supabase.ts`). Remember: **never select `embedding`**.
- **Memory writes**: fire-and-forget save of new facts/preferences after a turn (mirror
  `../lib/memory/save.ts`).
- **Tools** (optional, larger): a tool-call loop akin to the web app's `executeTool`, exposed
  over the existing chat IPC. Keep `MAX_TOOL_ITERATIONS` bounded.
- **Dynamic model routing**: optional `inferComplexity`-style light/heavy selection.

Key constraints: keep API keys in the main process (never the renderer); preserve the existing
`ChatDelta` / `ChatDone` / `ChatError` streaming IPC shape so `useVoice.ts` is untouched.

### Plan 4 — Conversation polish: latency, barge-in, smooth turn-taking

**Problem.** Wake-to-listen feels slow and janky; failure paths dismiss silently; barge-in is
wired (`src/voice/tts-barge-in.ts`, `bargeInEnabled` pref) but under-tuned.

Scope to define in the plan:
- **Latency**: the wake window needs ~1.3 s of audio to fill before it can fire, and the orb
  only summons *after* threshold; profile and trim the post-wake mic handoff
  (`useVoice.runTurn` re-acquires the mic and `recordUntilSilence` waits to first hear speech).
  Consider an instant earcon/ack — `instantAck` / `instantAckMode` prefs already exist.
- **Barge-in tuning**: calibrate `bargeInSensitivity` / `bargeInSilenceMs` / `bargeInAbortMs`;
  confirm it actually interrupts TTS playback and restarts a clean turn.
- **Robustness**: the mic / STT / empty-transcript branches in `useVoice.ts` currently call
  `dismiss` silently — surface a brief orb error/feedback state instead of dead air.
- **Wake reliability**: optional threshold/gain tuning (default fire threshold `0.05` in
  `WakeWordController`) and verify the renderer's `AudioContext({sampleRate:16000})` is honored
  on the target hardware.
- **Continuous conversation mode**: optionally support `interactionMode: "conversation"`
  (already a type) so a follow-up doesn't require re-saying the wake word.

When starting these, use the project's planning workflow (`superpowers:brainstorming` then
`superpowers:writing-plans`) and write the result to
`../docs/superpowers/plans/2026-..-phase-4e-plan-{3,4}-*.md`.
