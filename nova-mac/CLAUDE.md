# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`nova-mac` is the native macOS Electron companion to the Next.js web app one level up
(`../CLAUDE.md`). It is a tray-only voice assistant with an always-on-top orb window and a
full-featured app window. It shares the **same Supabase backend and schema** as the web app
(auth, `conversations`, `messages`, `memories`, `user_preferences`, `reminders`,
`google_oauth_tokens`) but is a completely separate codebase, build system, and runtime.

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
| renderer | `index.html` → `src/main.tsx` | `out/renderer/` | React 19 + Tailwind v4 + framer-motion. Single bundle for both windows. |

`onnxruntime-node` and `ws` are marked **`external`** in the main rollup config: they load
native `.node` bindings via dynamic `require` at runtime and cannot be statically bundled.

The `@shared/*` path alias (→ `shared/`) is declared in **three** places that must stay in
sync: `tsconfig.json`, `electron.vite.config.ts`, and `vitest.config.ts`.

## Two-window model

The app has two distinct windows that share a single renderer bundle:

| Window | Size | Style | Purpose |
|--------|------|-------|---------|
| Orb (`orbWin`) | 380×520 always (collapsed = orb only, rest click-through) | frameless, transparent, always-on-top (screen-saver level) | Persistent Siri-style orb, user-draggable; expands into the chat panel |
| App (`appWin`) | 920×680 | framed, hiddenInset title bar, vibrancy | Settings / Reminders / Memory / Connections tabs |

`src/main.tsx` calls `nova().getWindowMode()` at mount → renders `<App />` (orb) or
`<AppShell />` (app window). `GetWindowMode` IPC compares the sender's `webContents.id` to the
orb window's id: orb → `"orb"`, anything else → `"app"`.

- **Open app window**: orb ⚙ button → `nova().appOpen()` → hides orb, shows/creates app window.
- **Back to orb**: AppDock home icon → `nova().appClose()` → hides app, shows orb.
- **Tray**: "Open Nova" menu item creates/shows app window independently.

**Siri-style orb lifecycle**: the orb window (`Orb.tsx`, transparent) is **hidden by
default** and only appears when something activates it — never shown just because it finished
loading (`createOrbWindow` in `window.ts` does not auto-show in dev or prod). Main tracks this
with `orbArmedForAutoHide` in `main.ts`:
- **System activation** (wake word, timer fire) → `activateOrb()` shows the mini orb and arms
  auto-hide. Once the voice turn ends (`VoiceTurnEnded`) with the panel still collapsed, or a
  system-driven collapse lands via `OrbSetExpanded(false)` while still armed, the window is
  hidden outright (not just shrunk).
- **Manual activation** (orb click, `Cmd+Shift+Space`, tray "Open Nova", closing the Settings
  window) → disarms auto-hide and force-shows the window; collapsing afterward only shrinks it
  back to the mini orb, it does not vanish.
`IpcChannel.OrbSetExpanded(on, manual?)` carries this distinction from the renderer; main
broadcasts `IpcChannel.OrbExpandedChanged`.

**Expand/collapse never resizes the window.** The orb window is always panel-sized (380×520,
positioned via `positionOrbTopRight` in `window.ts`); the orb itself lives in a fixed box
pinned to the window's top-right corner in *both* modes (`Orb.tsx` — one always-mounted WebGL
orb that only scales around its own center), and the chat chrome fades/scales in around it via
AnimatePresence. That is what makes the transition flicker-free with the orb pixel-stationary:
no window resize, no component remount, no reposition. Clicking the orb toggles: expand when
collapsed, collapse when expanded. While collapsed, everything except the orb box must not eat
clicks meant for windows beneath — the renderer drives `IpcChannel.OrbSetMouseIgnore` →
`setIgnoreMouseEvents(ignore, { forward: true })`; forwarding keeps mousemove observable so
hover over the orb box re-enables interactivity (never toggled mid-drag). Main force-clears the
ignore whenever the panel expands.

**Dragging**: the orb (`Orb.tsx`) implements dragging *manually* — pointer capture on the orb
box streams screen-space deltas over `IpcChannel.OrbDragMove` and main moves the window with
`setPosition`. It must NOT use a CSS `-webkit-app-region: drag` region: on macOS a mousedown
in a drag region is handed to the OS window-drag session and the mouseup never reaches the
page, which silently breaks click-to-open (this happened once — the movement-threshold
click/drag disambiguation only works with manual dragging). The expanded panel's icon-button
strip is still a native drag region (fine there: its buttons are `no-drag` children) — but its
own geometry is shrunk to stop short of the orb's box (`width: calc(100% - ORB_BOX_RIGHT -
ORB_BOX)`), NOT left full-width. Chromium computes `-webkit-app-region:"drag"` hit-test regions
purely from an element's own CSS box geometry across the DOM tree; it does **not** consult
paint/z-order. A drag rectangle swallows mousedowns for anything visually on top of it too — a
later sibling painting over that rectangle (like the orb, pinned in the same corner the header
row spans) does not "win" the click just because it's on top in the DOM/paint order. Only actual
`no-drag` *descendants* of a drag element carve out exceptions; an unrelated overlapping sibling
does not. This broke click-to-collapse once (orb painted over the header row, clicks fell into
the OS drag session instead of the orb) — the fix is shrinking the drag element's own box so it
never geometrically overlaps the orb's box, not relying on stacking order.
Both manual drag handlers carry a **phantom-drag guard** (`e.buttons === 0` → clear the drag
ref, plus `onLostPointerCapture`): if a pointerup is ever lost (window hidden mid-drag, hotkey,
Mission Control), the drag ref survived the release, and every subsequent *hover* over the orb
moved the window by the cursor's delta — the orb visibly chasing/"running away from" the cursor
until the next click. No buttons down can never be a drag.
`main.ts` listens for the window's native `moved` event to detect *real* user drags —
`orbMoveIsProgrammatic` + `moveOrbProgrammatically()` suppress the `moved` events our own
`positionOrbTopRight`/`setPosition` calls trigger, since Electron fires `moved`
for programmatic changes too and there's no other way to tell them apart. `OrbDragMove`'s
`setPosition` calls are deliberately *not* suppressed — they're user drags, so `move`/`moved`
firing for them is what drives the wiggle and persistence below. Once a real
drag is detected, `orbUserPositioned` flips on and the spot is persisted via
`electron/orb-position-store.ts` (versioned JSON under `userData` — v2, since the window-origin
semantics changed when the window became always-panel-sized; v1 files are ignored once);
`positionOrb()` becomes a no-op as long as `isPointOnAnyDisplay` says that spot is still on
some connected display. `watchDisplayChanges` (called once on `orbWin` in `main.ts`) falls back
to the default top-right corner and clears `orbUserPositioned` if a monitor change leaves the
saved spot off-screen.

**Jelly wiggle while dragging**: separately from `moved`, `main.ts` also listens to the
cross-platform `move` event (fires continuously *during* a drag, unlike `moved`) to compute
live velocity and broadcast it as `IpcChannel.OrbDragVelocity`. `useOrbDragWiggle`
(`src/hooks/useOrbDragWiggle.ts`) turns that into a squash-and-stretch transform — pure math in
`velocityToWiggle()` (tested in isolation, no React/DOM needed) stretches the orb along the
direction of motion and squashes it perpendicular, capped so it can't grow enough to clip its
window; the hook self-decays back to neutral if no new velocity tick arrives within 140ms.
`Orb.tsx` wraps `VoiceOrb` in a `motion.div` driven by this hook with `jellySpring`
(`src/motion/springs.ts`) for the bouncy settle.

Voice turns (listening/thinking/speaking/barge-in) **never**
auto-expand the panel — the orb's own color is the only feedback while it stays a corner orb;
only a timer notice auto-expands (`hasNotice` effect in `src/App.tsx`), collapsing itself again
~2.5s after the notice clears. The reducer's `settle` event ends a turn while keeping the
conversation text visible in the panel; typed messages go through `useVoice().sendText` (no
TTS, no barge-in) so replies stream in even when opened manually.

**Links in replies**: reply text in the orb panel is rendered through `linkifyText`
(`src/lib/linkify.tsx`) so URLs are clickable, and `openLinksExternally` in `window.ts`
(both windows) routes `window.open`/`will-navigate` to `shell.openExternal`. Both halves are
required: without the main-side handlers an anchor click navigates the Electron window itself
away from the app, and without linkify a URL in a reply (e.g. a YouTube link) is dead plain
text — each reads as "the link doesn't work".

## The IPC contract (single source of truth)

`shared/types.ts` defines the `IpcChannel` enum plus every request/response type. The contract
has three layers that must always agree when you add or change a channel:

1. `shared/types.ts` — add the `IpcChannel` member + payload types.
2. `electron/preload.ts` — expose a method on `window.nova` (typed in `src/lib/ipc.ts`).
3. Handler registration — note the split:
   - `electron/ipc.ts` → `registerIpcHandlers` (auth, sync, transcribe, synthesize), `registerChatBridge`, `registerWakeBridge`.
   - `electron/main.ts` `app.whenReady()` → all other handlers registered directly via `ipcMain.handle`: window management, prefs, reminders, memory, connections.

Actual handler implementations are wired in `main.ts` via lazy `import()` so heavy modules
don't load at startup.

## App lifecycle & windowing (`electron/main.ts`)

- `dotenv` loads `.env.local` then `.env` **at the very top** before anything reads
  `process.env` — electron-vite does not auto-load env for the main process.
- Tray-only: `app.dock?.hide()`, `window-all-closed` is a no-op (app keeps running).
- Global hotkey `Cmd+Shift+Space` toggles the orb window.
- `nova://` deep-link protocol: `open-url` routes:
  - `nova://auth-callback` → `handleAuthCallback` (Supabase magic-link)
  - `nova://connections-callback` → `handleConnectionsCallback` (Google OAuth token exchange)
  - Registration (`app.setAsDefaultProtocolClient`) branches on `process.defaultApp` (true only
    when unpackaged/dev, i.e. `npm run dev` → `electron .`): passing just `"nova"` in dev
    registers the scheme against the bare Electron binary with no argument for which app to
    load, so macOS relaunches plain `.../Electron.app/Contents/MacOS/Electron` with no path when
    a magic-link/OAuth deep link is clicked — that falls back to Electron's own bundled default
    app (or its CLI usage text), which silently looks like the login link is broken. Dev mode
    must pass `process.execPath` + `[resolve(process.argv[1])]` explicitly (Electron's own
    documented fix for this).
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
wake word fires (main)  ──activateOrb + IPC WakeDetected──▶  useVoice.runTurn()
  orb: summon → listening          (wake cue plays unless instantAckMode === "off")
  recordUntilSilence(stream)       // MediaRecorder until VAD silence (prefs.silenceMs)
  ──IPC transcribe──▶ electron/voice/stt.ts (OpenAI Whisper/gpt-4o-transcribe, or Google via
    electron/voice/stt-google.ts — V2/Chirp 2 with a V1 fallback, quality tiers in
    shared/google-voices.ts, ported from the web app's lib/voice/stt/google*.ts)
  streaming STT (when GCP voice is configured): sttStreamStart at recording start — main
    tees the SAME wake-capture PCM frames into a Google Speech V1 streamingRecognize session
    (electron/voice/stt-google-stream.ts, model latest_short, one session at a time), so the
    transcript is ready ~instantly when VAD fires; sttStreamStop resolves it, and the
    MediaRecorder blob + batch transcribe below stay as the fallback whenever the stream
    errors or returns empty. sttStreamAbort on every early-exit path (endTurn calls it
    idempotently).
  sanitizeTranscript() + isVoiceStopPhrase()   // drop hallucinated noise / kill words silently
  orb: submit(transcript) → processing
  ──IPC chatSend──▶ electron/chat.ts (Anthropic streaming) ──ChatDelta/Done/Error──▶
  orb: responseStart → responseDelta…    // color/text update, panel stays collapsed unless opened
  VoicePlayer.playStreaming()            // sentence-by-sentence TTS, prefetched
  barge-in: TtsBargeInListener stops playback + chatCancel + restarts a turn (orb: bargeIn, orange)
  endTurn() ──IPC voiceTurnEnded──▶ main re-arms wake scoring, auto-hides the orb if unopened
  (if interactionMode === "conversation": runTurn() instead of endTurn())
```

- **Orb UI is a pure reducer**: `src/orb/orb-machine.ts` states: `dormant → listening →
  processing → responding`, plus `working`/`error`/`bargeIn`. `summon` from `"bargeIn"` stays
  `"bargeIn"` (not `"listening"`) — `runTurn()` dispatches `bargeIn` then `summon` in the same
  tick, and React 18 batches both into one render, so resetting to `"listening"` here would
  make the orange barge-in color never actually paint. `submit` accepts both `"listening"` and
  `"bargeIn"` so the follow-up utterance after an interrupt still reaches `"processing"`.
- **Barge-in probe MUST use the sttRing pre-roll** (`onBarge` in `useVoice.ts` opens a
  streaming STT session and flushes the ring before listening, same as a main turn). This is
  not a latency optimization: the barge listener needs ~250-380ms of *sustained* speech before
  it fires, so a short kill word ("stop", "that's all") is usually already finished when the
  probe's recorder starts. Batch-only probing heard silence, judged the interrupt a false
  alarm, and RESUMED the reply + re-listened — "keeps listening/talking after I said stop".
  The ring (12 × 80ms ≈ 1s of native-rate PCM, sized to cover listener hold + stream-start
  latency) is the only place the interrupting utterance still exists. The resume path also
  re-arms the barge listener (resetting `bargeCommitted`, with `finishTurn` guarded on it) so
  an interrupt during the *resumed* playback is heard too, instead of falling dead until the
  next listen window.
- **Kill words / noise filtering** (`src/voice/stop-phrases.ts`, `transcript-filter.ts`,
  ported from the web app): every transcript from `recordUntilSilence` is run through
  `sanitizeTranscript()` in `useVoice.ts` before it ever reaches Claude. An empty result means
  STT hallucinated on background noise/silence — dropped silently, no sound, no chat call.
  `isVoiceStopPhrase()` catches dismissals ("stop", "that'll be all", "thank you very much",
  etc.) — acknowledged with the `gotIt` cue and the turn ends without calling Claude at all.
  Matching is tiered (`stop-phrases.test.ts` covers all three): exact phrases with leading/
  trailing-filler stripping; `CONTAINED_STOP_PHRASES` — dismissals unambiguous enough to end
  the conversation when they appear *anywhere* in the sentence ("thanks Jarvis, that will be
  all for today"), which exact-only matching used to miss entirely; and
  `END_ANCHORED_STOP_PHRASES` — phrases like "that's enough" / "i'm done" that dismiss only at
  the *end* of the utterance, because mid-sentence they're usually part of a real request
  ("i'm done with the report so email it"). Bare "stop"/"cancel" stay exact-only on purpose —
  contained matching would swallow commands like "stop the timer".
  This only stops *listening* (orb-machine `dismiss` → back to idle grey); it deliberately does
  NOT let a system-triggered popup auto-hide itself afterward the way a natural turn completion
  would (`nova().orbDisarmAutoHide()` → `IpcChannel.OrbDisarmAutoHide` in `main.ts` clears the
  hide timer) — saying a kill phrase is the user actively engaging with the orb, not walking
  away from an unopened wake-word popup, so the orb should stay put.
- **WebGL VoiceOrb** (`src/components/orb/webgl-voice-orb.ts` + `VoiceOrb.tsx` wrapper): a
  fluid-noise plasma sphere (ported from a user-supplied reference), 5 color states — idle=grey
  (at rest), listening=blue, thinking=purple, speaking=green, bargein=orange — smoothly lerped
  (rate 0.45/frame — raised from an original 0.22 that still read as sluggish against the
  actual voice stage). `listening` used to collapse onto idle (reading as the same grey/blue as
  "just sitting there"); it's now its own distinct color precisely so the orb visibly changes
  the instant Nova starts actually hearing you, and idle/speaking are pushed to opposite ends of
  the blue↔green hue range (`STATE_COLORS` in `webgl-voice-orb.ts`) so listening vs. speaking
  don't wash into each other under the rim/glow's white-mix. `VoiceOrb`'s 6-value `visualMode`
  collapses onto these 5 (only `processing` folds into `thinking`). Same external API as the
  old Canvas2D orb it replaced.
- **Streaming TTS** (`src/voice/player.ts`): a `SentenceBuffer` chunks the streamed reply into
  sentences; chunks are synthesized ahead (prefetch depth 2) and scheduled gaplessly on a
  Web Audio timeline. `stop()`/barge-in aborts in-flight synth + sources. TTS provider fan-out
  (`electron/voice/tts.ts`) covers OpenAI, Deepgram, and Google (`electron/voice/tts-google.ts`,
  quality tiers + voice lists in `shared/google-voices.ts`) — `googleTtsQuality`/`googleTtsVoice`
  and `googleSttQuality` used to be saved prefs with a Settings picker but no code ever actually
  read them (`stt.ts`/`tts.ts` threw "not yet wired" for the `google` provider unconditionally);
  they're now threaded end-to-end from `useVoice.ts` through `VoicePlayerOptions`/
  `TranscribeRequest`/`SynthesizeRequest` to the real GCP calls.
- **Voice preferences** come from Supabase `user_preferences.voice` (JSONB) merged over
  `DEFAULT_VOICE_PREFERENCES` in `shared/types.ts`. Default interaction mode is `wake_word`.
- **Error states**: mic unavailable, recording failure, empty transcript, and chat errors all
  dispatch `{ type: "error", message }` → 2.5s auto-dismiss (not silent).
- **Audio cues** (`src/voice/earcon.ts`): oscillator-synthesized cues (`wake`, `gotIt`,
  `reply`, `bargeIn`, `error`, `timer`) played at each turn stage; gated by
  `prefs.audioCuesEnabled`.
- **Tool progress**: main emits `IpcChannel.ChatToolUse` `{requestId, toolName, step}` before
  each tool round; `useVoice` dispatches `startWorking` so the orb shows the friendly step label
  (labels in `TOOL_STEP_LABELS`, `electron/chat-turn.ts`). The next `ChatDelta` auto-returns
  the reducer from `working` to `responding`.
- **Recording**: `recordUntilSilence` gives up after `prefs.noSpeechTimeoutMs` (Settings →
  Conversation → "Give up after", default 5s) of no speech (empty blob → "Nothing heard"
  without an STT round-trip, and the turn ends outright rather than retrying); speech threshold
  derives from `listeningSensitivity`. Its `SpeechGate` gets
  `confirmedDecayMs: silenceMs + 2000` — with the gate's default 2s decay, any `silenceMs`
  ≥ 2000 cleared `confirmed` *before* the silence timer fired, and after that a single ambient
  blip above threshold cleared the timer with nothing able to re-arm it (re-arming requires
  `gate.confirmed`), so recording silently ran to the 30s hard cap instead of stopping after
  the configured silence window. `consecutiveNoiseTurns` (the "quietly re-listen a couple of
  times before ending the conversation" counter) is reset at the top of every fresh — non-
  `followup` — `runTurn`: it used to survive the previous conversation's ending at its limit,
  making the next wake activation dismiss itself on the first quiet moment. STT requests deliberately send **no** `prompt` hint to
  OpenAI (`electron/voice/stt.ts`) — an earlier "casual spoken commands and questions to a
  personal AI assistant" prompt biased the model's hallucinations on silence/background noise
  toward exactly that genre (fabricated "what's the weather" / "play music on Spotify" style
  text), which combined with `interactionMode: "conversation"` auto-re-listening after every
  reply into a self-talking loop with no real user input.

## Proactive engine (`electron/proactive/`)

`ProactiveScheduler` (`scheduler.ts`, started from `main.ts`) ticks every 30s and drives
everything Nova says without being woken:

- **Reminder/calendar pre-alerts**: announced at configurable lead times (`AlertPrefs` in
  `shared/types.ts`, stored device-locally by `alert-prefs.ts`, edited in Settings → Proactive).
  Reminders gate on `proactiveMode !== "off"`, calendar on `proactiveMode === "full"` + a
  connected Google Calendar. Dedup is persisted per `(item, lead)` key in `announce-store.ts`
  so restarts don't re-announce; stale alerts (Mac was asleep) are skipped, with a longer grace
  for lead-0 reminders. "Remind me 10 min before X" needs no special machinery — the system
  prompt tells Claude to set `due_at` 10 minutes before X.
- **Agent loops** (`loops-store.ts` + `loop-runner.ts`): user-scheduled autonomous prompts
  (once / daily / every N min, userData JSON) run as a full tool-enabled turn
  (`getToolDefinitions()`, MAX 8 iterations) whose final text is announced. Created via the
  `create_agent_loop` / `list_agent_loops` / `delete_agent_loop` tools ("email me at 10:30
  with…") or Settings → Loops (`LoopsSection.tsx`). Once-loops disable themselves after
  running; loops run regardless of `proactiveMode` (each is an explicit user artifact), but
  speech still respects DND. The runner persists the run into the main conversation (real
  message ids keep FK-backed tool inserts working).
- **Timer completions**: `initTimerManager`'s callback also calls
  `proactive.announceTimerDone()` — chime + notice come from the existing `TimerFired` path,
  the spoken "timer's done" from the scheduler so it shares DND/toggle rules.
- **Delivery**: quiet hours (`quiet-hours.ts`, `ProactivePrefs.quietHoursStart/End` +
  `AlertPrefs.quietHoursEnabled`) turn announcements into silent notifications. Otherwise main
  `activateOrb()`s and broadcasts `IpcChannel.ProactiveSpeak`; `useVoice` queues events behind
  any in-flight turn (never talks over itself), dispatches the orb-machine `announce` event
  (green speaking state without a voice turn), plays TTS via the normal `VoicePlayer`, then
  `announceEnd` + `voiceTurnEnded` so the popup auto-hides.

## Personality (learned traits, `electron/personality/store.ts`)

Style feedback ("swear less", "more banter") is captured by the `adjust_personality` tool and
stored as trait lines in userData JSON, injected into the **cached** system-prompt block every
turn (`getPersonalityBlock()` in `chat-turn.ts` — cache only invalidates when traits change).
Settings → Personality lists/edits/deletes traits. The store does NOT import electron — the
data dir is injected via `initPersonalityStore(app.getPath("userData"))` in `main.ts`, because
chat-turn (and its vitest suite, which runs in plain Node) imports the store statically.

## Mac control tools

`electron/tools/mac-control.ts` (volume via `osascript` — set is **verified by reading the
level back** and throws when the OS didn't apply it; brightness via the optional `brightness`
CLI with a System Events key-code fallback whose permission failures are rewritten into
actionable "grant Accessibility / brew install brightness" errors; `open -a` for apps;
`shell.openExternal` for URLs; plus general automation: `runAppleScript` (arbitrary
AppleScript via a single execFile `-e` arg, macOS Automation/Accessibility errors rewritten
to fix instructions) and `runShortcut`/`listShortcuts` (`shortcuts` CLI) — the `electron`
import is lazy so vitest can load the module)
plus `electron/timers.ts` (session-scoped `TimerManager`, initialized in `main.ts` with an
on-fire callback that shows a Notification, summons the orb, and broadcasts
`IpcChannel.TimerFired`). Exposed to Claude as: `set_timer` / `list_timers` / `cancel_timer`,
`open_app` / `quit_app` / `open_url`, `set_system_volume` / `get_system_volume`,
`set_screen_brightness`, `run_applescript` / `run_shortcut` / `list_shortcuts` (in-app and
browser navigation — "open Clock and set a 30-minute timer" composes AppleScript).
`electron/tools/composio.ts` adds `composio_search_tools` / `composio_execute` (Composio REST
v3 bridge for Google Docs/Notion/etc.); these two are stripped from the tool list by
`getToolDefinitions()` in `definitions.ts` unless `COMPOSIO_API_KEY` is set — chat-turn.ts
must always use `getToolDefinitions()`, never raw `TOOL_DEFINITIONS`. The system prompt
carries a hard tool-result honesty rule (never claim success unless the tool result confirms
it; relay error fix steps verbatim) because Haiku used to narrate volume/brightness changes
that had actually failed.

## Chat turn — memory + history (`electron/chat.ts`)

`runTurn` / `runTurnStream` orchestrate the full chat turn with memory parity to the web app:

- Loads last N messages from the active conversation (`electron/memory/client.ts`)
- Runs `preRetrieveContext` — hybrid pgvector + `pg_trgm` memory search, calendar, Gmail, reminders
- Builds system prompt with dynamic memory injection
- Calls Claude with `MAX_TOOL_ITERATIONS = 3`; tool results feed back into Claude
- Persists user + assistant messages to Supabase after each turn (the user-message persist
  runs in parallel with history/retrieval/timezone, deduped by id; `updated_at` bump is
  fire-and-forget)
- `prewarmTurn()` is called from main.ts the moment the wake word fires — warms the
  userId/conversation/timezone caches while the user is still speaking
- Voice turns route through `inferComplexity` like text (no longer pinned to the light model)
- **Never `select("embedding")`** — memory queries always use an explicit column list

## App window — tabs (`src/AppShell.tsx`)

Auth-gated. 28 px draggable title bar inset. Tab state via `useState<Tab>`. AppDock fixed at bottom.

| Tab | Page | Main-process module |
|-----|------|-------------------|
| Settings | `src/pages/SettingsPage.tsx` (macOS System Settings style: sidebar sections General / Voice & Speech / Conversation / Sounds / Proactive / Account; toggles+selects save immediately, sliders debounce 500ms) | `electron/voice/save-preferences.ts` |
| Reminders | `src/pages/RemindersPage.tsx` | `electron/memory/reminders.ts` |
| Memory | `src/pages/MemoryPage.tsx` | `electron/memory/manage.ts` |
| Connections | `src/pages/ConnectionsPage.tsx` | `electron/google/connections.ts` |

**Preferences IPC**: `PrefsGet` returns `AllPrefs` (`voice` + `proactive`). After `PrefsSet`,
main broadcasts `IpcChannel.PrefsChanged` with `updated.voice` to **all** windows so the orb's
`useVoice` stays in sync without a reload.

**Proactive prefs** map camelCase `ProactivePrefs` ↔ snake_case DB columns: `proactiveMode` →
`proactive_tier`, `dailyBriefEnabled` → `brief_enabled` (see `save-preferences.ts`).

## Google OAuth (`electron/google/connections.ts`)

One row per user in `google_oauth_tokens`. Columns: `encrypted_refresh` (AES-256-GCM via
`electron/google/crypto.ts`), `scopes text[]`, `calendar_connected`, `gmail_connected`,
`youtube_connected`, `connected_email`. **Not** per-service rows.

Flow: `startOAuthFlow` → `shell.openExternal(url)` → user authenticates → macOS delivers
`nova://connections-callback` → `handleConnectionsCallback` exchanges code, encrypts refresh
token, upserts row, sends `IpcChannel.ConnectionsCallback` **with a
`ConnectionsCallbackPayload` (`{ok, service?, error?, hint?}`)** to the app window →
`ConnectionsPage` refreshes status and surfaces failures in a red banner. Google's
`?error=access_denied` redirect (user cancelled OR unverified-app block) used to be silently
swallowed — it now maps to a hint telling the user to add themselves as a Test user /
publish the app and enable the Gmail+Calendar APIs in console.cloud.google.com.

**One-time setup**: add `nova://connections-callback` as an authorized redirect URI in your
Google OAuth 2.0 client at console.cloud.google.com. Requires `GOOGLE_CLIENT_ID`,
`GOOGLE_CLIENT_SECRET`, and `GOOGLE_TOKEN_ENCRYPTION_KEY` (32-byte key) in `.env.local`.

## Design system

- **Tailwind v4** via `@tailwindcss/postcss` (not the v3 direct plugin). Config in
  `tailwind.config.ts`; PostCSS in `postcss.config.cjs` (`.cjs` because `"type":"module"`).
  `src/styles/global.css` must use the v4 `@import "tailwindcss";` directive — the old v3
  `@tailwind base/components/utilities` at-rules are **silently no-ops** under
  `@tailwindcss/postcss` (no build error, just almost no CSS output), which is exactly what
  happened once and made every Tailwind-classed component render as unstyled default HTML
  while inline-styled components (which don't depend on Tailwind) looked fine. If a page ever
  looks suspiciously plain/unstyled again, check this first before assuming it's a design issue.
- **CSS tokens** in `src/styles/glass.css`: `--nova-bg`, `--nova-surface`, `--nova-border`,
  `--nova-text`, `--nova-text-secondary`, `--nova-accent`, `--nova-radius-card`, `.nova-glass`,
  `.nova-slider` (pill-track range input styling used by Settings sliders).
- **UI primitives**: `src/components/ui/Button.tsx`, `Card.tsx`, `Select.tsx` (pill-shaped,
  `rounded-full`, with a custom chevron since it uses `appearance-none`).
- **`cn()`** helper in `src/lib/utils.ts` (clsx + tailwind-merge).
- **Settings page** (`src/pages/SettingsPage.tsx`) uses a black/grey pill design language:
  `rounded-full` sidebar nav with a soft `bg-white/[0.09]` highlight + small accent dot for the
  active section (not a solid accent fill), `Group` cards at `rounded-[22px]` with a low-contrast
  border and faint tinted row dividers instead of hard 1px lines, and pill-shaped selects/kbd
  chips/time inputs/buttons throughout.

## Wake word pipeline (openWakeWord, "Hey Jarvis")

Capture (renderer) → ONNX inference (main worker thread). Getting any step wrong silently
produces near-zero scores rather than an error, so the exact contract matters:

- `src/voice/wake-capture.ts`: an `AudioContext` at the mic's **native** rate feeds an
  AudioWorklet that FIR-decimates to **Int16, 16 kHz mono, 1280-sample (~80 ms) frames**
  (`SAMPLES_PER_FRAME` in `shared/wake-constants.ts`) over `IpcChannel.WakeAudioFrame`, and
  tees full native-rate frames for streaming STT. (Forcing the whole context to 16 kHz and
  letting Chromium resample audibly degraded the audio and halved genuine wake scores.)
  Non-integer decimation (44.1 kHz hardware) or worklet failure falls back to a forced-16 kHz
  ScriptProcessor, wake-only. Mic acquisition in `useVoice.boot()` retries with backoff and
  surfaces an error pointing at System Settings → Microphone — it used to reject unhandled,
  leaving wake capture silently never started ("wake word randomly doesn't work").
- `electron/wakeword/index.ts` (`WakeWordController`, main thread): forwards frames to the
  worker, applies a fire threshold (default `0.35`, mutable via `setThreshold` — main.ts derives
  it from `VoicePreferences.wakeWordSensitivity` via `wakeThresholdFromSensitivity` at startup
  and on every `PrefsSet`; this preference used to be saved from Settings but never actually
  read anywhere, so the slider had zero effect on real-world detection consistency), debounce,
  and an arm/re-arm gate; pauses during a voice turn and resumes on `voiceTurnEnded`.
  **Resume must reset the engine's scoring state** (`resume()`/re-`setEnabled` post
  `{type:"reset"}` → worker chains `engine.reset()` on its frame queue): the embedding window
  spans ~1.3s and is never naturally flushed while frames are dropped, so on resume it still
  held the "hey jarvis" that started the paused turn and the first predictions re-fired on
  that stale phrase — the orb re-activating itself right after a kill word ended the turn.
  The reset also acts as a built-in cooldown: no score exists until the window refills with
  ~1.3s of genuinely new audio.
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

## Platform layer (`electron/platform/` — Windows Phase 1)

The app boots and runs its core (voice, chat, memory, connections, proactive, tray/orb) on
Windows; the macOS automation layer is gated, not ported. ALL per-OS behavior lives behind
the `PlatformAdapter` interface in `electron/platform/index.ts` — **`mac.ts` holds every
macOS-specific behavior, `windows.ts` every Windows behavior** (and doubles as the Linux
fallback). Don't scatter new `process.platform` checks around the codebase: add a field to
the adapter instead. Two hard rules, both load-bearing:

1. These modules are imported by vitest-loaded code (`definitions.ts`, `system-prompt.ts`,
   `mac-control.ts`), so **no top-level `electron` value imports** — type-only imports,
   instance parameters, or lazy `await import("electron")` inside functions.
2. Consumers resolve the adapter **per call** via `currentPlatform()`, never snapshotting it
   at module load — tests stub `process.platform` at runtime (`system-prompt.ts` is the one
   sanctioned load-time consumer, for prompt-cache stability).

What the adapter covers (and where it's consumed):

- **Tools**: `unavailableTools` (`MAC_ONLY_TOOLS` in `windows.ts`) — every AppleScript/
  mdfind/screencapture-backed tool, filtered by `getToolDefinitions()` (which remains the
  only sanctioned tool list — never raw `TOOL_DEFINITIONS`). Covered by
  `definitions.test.ts`. Phase 2: implement a tool on win32 → remove its name from the set.
- **System prompt**: `controlPromptBlock` (mac automation guidance vs. a Windows block that
  names what ISN'T available; shared lines in `platform/shared-prompt.ts`) baked into
  `BASE_SYSTEM_PROMPT` at module load.
- **Mic permission**: `ensureMicPermission()` — macOS TCC prompt at launch (denied → pointer
  notification); no-op on Windows (Settings toggle, surfaced by the renderer's error path).
- **Windows chrome**: `appWindowOptions()` (vibrancy+hiddenInset vs Win11 acrylic) and
  `setupOrbWindow()` (Spaces visibility) in `window.ts`; `prepareTrayIcon()` (template
  tinting vs 16×16 resize) in `tray.ts`. The `"screen-saver"` always-on-top level arg is
  ignored on Windows (plain topmost applies — fine).
- **Orb position persistence**: `hasNativeMovedEvent` — Electron's `moved` (drag finished) is
  macOS-only; without it, `main.ts` synthesizes it from 400ms of stillness after the last
  non-programmatic `move`, running the same `persistUserOrbPosition()`.
- **Shell tool**: `shellForCommands` — zsh on darwin, Node's default (cmd.exe) elsewhere.

Outside the adapter: deep links (macOS `open-url`; Windows/Linux relaunch the exe with the
URL in argv — `requestSingleInstanceLock()` + the `second-instance` handler in `main.ts`
forward to the shared `routeDeepLink()`; don't add deep-link handling anywhere else) and the
renderer's `window.nova.platform` (static, from `preload.ts` — drives the Settings hotkey
chip and mic-error wording). Packaging: `npm run dist:win` → NSIS (unsigned in Phase 1;
SmartScreen warning expected). `asarUnpack`/wake-model `extraResources` apply to both
platforms unchanged.

## macOS permissions

Every layer below must be in place or mic access fails *silently* (dead stream, no error):

- **TCC prompt** (`main.ts`, top of `whenReady`): `systemPreferences.askForMediaAccess("microphone")`
  is called at launch when status isn't `granted`, so the OS prompt is deterministic instead of
  racing the renderer's first `getUserMedia`. If the user previously denied it,
  `askForMediaAccess` resolves `false` *without prompting* — a Notification then points them at
  System Settings → Privacy & Security → Microphone.
- **Session handlers** (`window.ts`, `createOrbWindow`): both a `setPermissionRequestHandler`
  *and* a `setPermissionCheckHandler` granting `media` — sandboxed renderers consult the check
  handler synchronously, and without it permission checks can report denied even though
  requests succeed. Both windows share the default session, so registering once covers both.
- **Info.plist usage descriptions** (`electron-builder.json` → `mac.extendInfo`):
  `NSMicrophoneUsageDescription`, `NSAppleEventsUsageDescription`,
  `NSSpeechRecognitionUsageDescription`. Packaged apps without these are denied (or killed)
  by macOS on first TCC access — dev builds work because Electron.app carries its own.
- **Entitlements** (`build/entitlements.mac.plist`): `com.apple.security.device.audio-input`
  + `com.apple.security.automation.apple-events` for the hardened runtime.
- **Accessibility / Automation** (AppleScript, brightness key fallback) are per-feature TCC
  prompts on first use; `electron/tools/mac-control.ts` rewrites their opaque failures into
  actionable "grant X in System Settings" tool errors.

## Packaging notes (`electron-builder.json`)

- `asarUnpack: ["**/*.node"]` keeps native addons outside the asar so they load post-sign.
- `hardenedRuntime` + `notarize` + `build/entitlements.mac.plist` — a successful install logs
  `[nova] native probe: native-ok` on first launch, confirming the addon survived
  signing/notarization. Signing needs `CSC_LINK`/`CSC_KEY_PASSWORD` and
  `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID` in the environment (see `README.md`).

## Environment variables

Local dev minimum (`.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` (STT + TTS). Google Calendar/Gmail/YouTube *connections*
need `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` (OAuth — see
"Google OAuth" above) — these are **unrelated** to Google Cloud Speech/TTS, which uses a
service-account instead: `GCP_PROJECT_ID` + either `GCP_SERVICE_ACCOUNT_JSON` (raw single-line
JSON) or `GOOGLE_APPLICATION_CREDENTIALS`/`GCP_SERVICE_ACCOUNT_JSON_PATH` pointing at a key
file — same precedence and same "don't paste multi-line JSON into `.env.local`, save it to a
file instead" guidance as the web app one level up. Optional `GCP_SPEECH_V2_LOCATION` (default
`asia-southeast1`, used for the Chirp 2 STT tier only). `DEEPGRAM_API_KEY` only if using
Deepgram TTS. Model overrides: `ANTHROPIC_MODEL_LIGHT` (default `claude-haiku-4-5-20251001`),
`OPENAI_STT_MODEL`.
