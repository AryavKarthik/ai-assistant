# Phase 4E — Native Mac Helper ("Nova") Design

> **Status:** Approved design. Next step: implementation plan via `writing-plans`.
> **Date:** 2026-06-30

## Goal

Move Nova off the browser and onto the Mac as a standalone, always-on, **voice-first** native helper. Triggered by a "Hey Jarvis" wake word from anywhere on the system, screen-aware by default, capable of acting on the Mac (file management + full computer-use automation), and visually native to macOS. The existing Next.js web app is unchanged and continues to serve the browser client; both clients sync through the same Supabase database.

## Non-Goals

- Replacing the web app (it remains the browser client).
- Gmail Pub/Sub real-time awareness (Phase 4F).
- iOS / cross-platform — this is macOS-only (Apple Silicon primary, Intel best-effort).
- Cloud relay of screen captures — screen data never leaves the device.

---

## 1. App Architecture

A **new Electron application** in a sibling package, `apps/mac/` (monorepo) or a standalone repo `nova-mac/`. It is a fresh React UI inside Electron — it does **not** wrap or iframe the existing Next.js app. It talks **directly to the Anthropic API** (bypassing Vercel) and **directly to Supabase** for data sync.

```
nova-mac/
├── electron/                  # MAIN PROCESS — all system access lives here
│   ├── main.ts                # App lifecycle, window mgmt, tray, global hotkey
│   ├── preload.ts             # contextBridge IPC surface (no nodeIntegration)
│   ├── ipc.ts                 # Typed IPC channel definitions + handlers
│   ├── claude.ts              # Anthropic SDK client (chat + computer-use)
│   ├── agent.ts               # Computer-use loop: screenshot → Claude → action → loop
│   ├── wakeword/
│   │   ├── engine.ts          # onnxruntime-node: mel → embedding → wakeword models
│   │   ├── framing.ts         # 16kHz mono audio framing/buffering (ported logic)
│   │   └── models/            # hey_jarvis.onnx, melspectrogram.onnx, embedding_model.onnx
│   ├── audio.ts               # Mic capture (naudiodon/ffi) → frames for wakeword + STT
│   ├── voice.ts               # STT + TTS bridge (reuses existing Deepgram/OpenAI flow)
│   ├── screen.ts              # desktopCapturer, compression, password-field suppression
│   ├── computer.ts            # @nut-tree/nut-js input simulation
│   ├── filesystem.ts          # Node fs wrappers for file tools
│   └── permissions.ts         # macOS permission checks + System Settings deep links
├── src/                       # RENDERER — pure React UI, no system access
│   ├── components/
│   │   ├── orb/               # Orb (5 states), waveform, shimmer ring
│   │   ├── sheet/             # Chat sheet (swipe-up secondary surface)
│   │   ├── chat/              # Message rendering, streaming text, receipts
│   │   ├── cards/             # WorkflowCard, WorkingChip, ActionReceipt
│   │   └── onboarding/        # Permission flow cards
│   ├── hooks/
│   │   ├── useOrb.ts          # Orb state machine (dormant→listening→processing→responding→working)
│   │   ├── useAgent.ts        # Drives computer-use loop via IPC
│   │   ├── useVoice.ts        # Wake word + STT/TTS events via IPC
│   │   └── useSupabase.ts     # Data sync
│   └── lib/
│       ├── supabase.ts        # @supabase/supabase-js client
│       └── ipc.ts             # Typed renderer-side IPC wrappers
├── shared/                    # Types shared between main + renderer + (optionally) web
│   └── types.ts
├── electron-builder.json      # .dmg/.app packaging, signing, notarization
└── package.json
```

### Process model

- **Main process** owns every privileged capability: mic capture, wake word, screen capture, input simulation, file ops, shell, and all Anthropic API calls.
- **Renderer** is a pure React view layer. It receives state and events over **typed IPC** and sends user intents back. `nodeIntegration: false`, `contextIsolation: true`; the **preload** `contextBridge` is the only surface.
- Computer-use tools are **never exposed to the renderer** — the agent loop runs entirely in main; the renderer only observes progress and shows the Stop button.

### Models

- **Chat turns:** `claude-sonnet-4-6` (matches web app default; complex asks can still escalate).
- **Computer-use loop:** `claude-opus-4-8` with the `computer-use-2024-10-22` beta header — Opus handles long tool loops more reliably.
- Shared system-prompt construction is **ported from `lib/chat/system-prompt.ts`** and adapted; we do not import the Next.js runtime.

### Code reuse strategy

Logic that is pure TypeScript and framework-agnostic is **copied into `shared/` or re-implemented**, not imported from the Next app (no Next runtime in Electron):
- Receipt/trust-tag shapes, workflow step types, memory types.
- Tool schema *shapes* are re-declared for the local tool set (the Mac tool set differs — adds computer-use + filesystem, drops nothing essential).
Anything DB-bound (memories, reminders, conversations, workflow_runs) is reached via the **same Supabase tables** using `@supabase/supabase-js`.

---

## 2. Voice-First UX — The Orb

The primary surface is a floating **Liquid Glass orb**. Chat is a **secondary** surface reached by swiping up. The mental model is closer to Siri-on-Mac than to a chat window.

### Five orb states (state machine in `useOrb.ts`)

| State | Trigger | Visual |
|-------|---------|--------|
| **Dormant** | default | 12px low-opacity glowing dot, bottom-right of screen above the Dock, always-on-top |
| **Listening** | "Hey Jarvis" or click | expands to ~120px glass orb with live audio waveform; auto-submits ~1.5s after silence |
| **Processing** | command submitted | waveform fades to a slow rotating shimmer ring; no text |
| **Responding** | Claude responding | orb breathes (subtle scale pulse) while TTS plays; a minimal frosted card slides up with 1–2 lines of response text |
| **Working** | computer-use approved | morphs into a compact pill chip, bottom-right, with current step label + **Stop** button |

### Chat sheet (secondary)

Swipe up on the orb or response card → a macOS-style **sheet** rises from the bottom showing full conversation history, workflow cards, and receipts. Swipe down or `Esc` dismisses. This looks like a standard macOS sheet (not a glass slab).

### Wake / summon paths

- **"Hey Jarvis"** (primary) — works from any app, system-wide (see §3).
- **Global hotkey** `Cmd+Shift+Space` — opens straight to Listening.
- **Click the dormant dot** — opens to Listening.

---

## 3. Wake Word — openWakeWord via onnxruntime-node

**Decision:** openWakeWord (not Picovoice — which is org-only; not native `SFSpeechRecognizer` — which has a 1-minute session cap and no keyword-spotting mode). openWakeWord is Apache-2.0 code with a **free pretrained "hey jarvis" model** (model weights are CC-BY-NC-SA 4.0, which is fine for this personal/non-commercial app).

**Integration: in-process, no Python (Option 2).**

The main process loads openWakeWord's three ONNX models with `onnxruntime-node` and runs the pipeline directly:

```
mic (16kHz mono) → framing.ts (80ms frames, ring buffer)
                  → melspectrogram.onnx
                  → embedding_model.onnx
                  → hey_jarvis.onnx → score
                  → score > threshold (default 0.5, configurable) ⇒ emit "wake"
```

- **Audio capture:** `naudiodon`(PortAudio) or a small native mic addon, downsampled to 16kHz mono. The same capture feeds STT once awake.
- **Framing logic** (`framing.ts`): the ~150 lines of buffering openWakeWord normally does in Python, ported to TS. This is the one piece of genuinely custom work and is unit-testable against recorded audio fixtures.
- **Debounce:** after a detection, suppress re-triggers for 2s and require the score to drop below threshold before re-arming, to avoid double-fires.
- **CPU:** inference runs on a cadence (~every 80ms) on a worker thread; target <2% CPU at idle.
- **Custom wake words (future):** openWakeWord's free Colab produces a new `.onnx` we drop into `models/`; the wake word is selectable in settings.

**Caveat captured:** wake-word accuracy from a pretrained community model is good but not Siri-grade. Threshold is user-adjustable in settings; a "test wake word" button in onboarding lets the user calibrate.

---

## 4. Screen Context — Always-On, First-Class

Screen awareness is a default behavior, not a toggle.

### Per-message screenshot (baseline)

On every command, `screen.ts` captures the active display, compresses to **1280×800 max, JPEG ~60% (~80KB)**, and prepends it to the Claude message as a vision image. Claude always knows what you're looking at.

### Rolling passive buffer (ambient, default on, toggleable)

A screenshot is captured every **8s** and the **last 5 frames** are held in memory (no disk, no Supabase). On send, the most recent frame is used so context is never stale. Buffer pauses during Working mode (the agent loop captures per-action anyway).

### Privacy safeguards

- **Password-field suppression:** before sending any frame, the macOS Accessibility API checks whether the frontmost focused element is an `AXSecureTextField`. If so, the frame is discarded and a blank placeholder is sent. Automatic and silent.
- **Privacy indicator:** a small dot in the input bar shows capture is active; clicking it pauses screen context for the session.
- Screen frames **never** touch Vercel or Supabase — they go straight from main process to the Anthropic API.

---

## 5. Computer-Use Agent Loop

When Claude determines a request needs to act on the Mac, it follows the **plan-first pattern** (same model as Phase 4C `WorkflowCard`), extended to screen + input + file actions.

### Flow

```
User command
  → Claude (sonnet) classifies intent → needs computer/file actions
  → plan_task tool call → WorkflowCard floats above orb (steps + risk levels)
  → User taps Approve  [blanket consent honored — see Safety §7]
  → Orb → Working chip
  → agent loop (main process, opus):
        1. screenshot (desktopCapturer)
        2. send image + history to Claude (computer-use beta)
        3. Claude returns tool_use blocks
        4. execute each action (nut-js / fs / shell)
        5. loop until Claude returns a text completion
  → Orb → Responding (result), then chat sheet has full trace
```

### Computer-use tools (main process only)

| Tool | Args | Risk | Implementation |
|------|------|------|----------------|
| `screenshot` | `display_id?` | read | `desktopCapturer.getSources()` |
| `left_click` / `right_click` / `double_click` | `x, y` | write | nut-js mouse |
| `type_text` | `text` | write | nut-js keyboard |
| `key_press` | `keys[]` | write | nut-js (e.g. Cmd+C) |
| `scroll` | `x, y, direction, amount` | write | nut-js |
| `bash` | `command` | irreversible | `child_process` (timeout + output cap) |

### Cancellation

`agent.ts` checks a `stopSignal` before each action. **Stop** sets it true; the loop exits cleanly after the in-flight action (no mid-action teardown), and partial progress is shown in the chat sheet.

### Iteration cap

`MAX_AGENT_ITERATIONS = 25` for computer-use loops (vs. 10 for plain tool turns in the web app), with a hard wall-clock timeout (e.g. 5 min) after which the loop halts and reports.

---

## 6. File System Agent

File tools (`filesystem.ts`) are callable in a normal chat turn (no screenshot loop needed) or inside the agent loop.

| Tool | Risk | Notes |
|------|------|-------|
| `list_directory` | read | name, size, modified, kind |
| `read_file` | read | text only, ≤100KB, binary rejected |
| `search_files` | read | glob via `fast-glob` (`*.mp4`, `**/*.log`) |
| `get_disk_info` | read | `df -h` + top-20 largest under a path |
| `move_file` | write | requires plan approval |
| `write_file` | write | create/overwrite; plan approval |
| `trash_file` | write | macOS Trash (recoverable); plan approval; **gated** |
| `delete_file` | irreversible | permanent; red in WorkflowCard; **gated** |
| `create_directory` | write | `mkdir -p` |
| `open_file` | read | `shell.openPath()` |

**Autonomous file cleanup (gated):** `trash_file` and `delete_file` are unavailable unless the user enables **"Autonomous file cleanup"** in settings (off by default, with a warning). Even when enabled, they only ever run inside an approved plan.

---

## 7. Safety & Consent Model

The user has given **blanket standing consent** for Nova to act without per-action prompts where it is permitted. The model honors this as follows:

- **Plan-first, then autonomous execution.** Claude proposes a plan (`WorkflowCard`); the user approves the *plan* once, and the steps then execute autonomously without further taps — including write actions. This is the standing default.
- **No per-action confirmation** during an approved plan. The **Stop** button is the live escape hatch.
- **Irreversible actions** (`delete_file`, `bash` that is destructive, Gmail send) are still **shown distinctly (red)** inside the plan so the user sees them before approving, but they do not require a *second* tap after approval.
- **Gated capabilities** (autonomous file cleanup) require a one-time settings opt-in, then follow the same plan-first flow.
- An **Activity log** (in the chat sheet) records every action with timestamp and result, so anything autonomous is auditable after the fact.

---

## 8. Auth, Data Sync & Permissions

### Auth

Supabase magic-link, opened in the system browser via `shell.openExternal()`. The returned session (access + refresh tokens) is stored in the **macOS Keychain** via Electron `safeStorage`. Sessions restore silently on relaunch; token refresh handled by `@supabase/supabase-js`.

### Data sync

Direct `@supabase/supabase-js` against the existing tables — `conversations`, `messages`, `memories`, `memory_links`, `reminders`, `workflow_runs`, `user_preferences`. Conversations started in the browser appear in the Mac app and vice versa. No schema changes required for core sync; an optional `client` column on `messages` (values `web` | `mac`) may be added to distinguish origin (nice-to-have, not required).

### macOS permissions — onboarding flow (4 cards, in order)

1. **Microphone** *(required)* — always-on wake word; card states audio is processed on-device by openWakeWord, nothing sent to a server for detection. Opens Privacy → Microphone.
2. **Screen Recording** *(required)* — screen context + computer-use screenshots. Opens Privacy → Screen Recording.
3. **Accessibility** *(required for computer use)* — click/type/scroll and password-field detection. Opens Privacy → Accessibility.
4. **Full Disk Access** *(optional, skippable with warning)* — file ops beyond the home directory. Degrades to home-only if denied.

Each card: title, one-line rationale, "Grant" button that deep-links the exact System Settings pane via `x-apple.systempreferences:` URLs. The app polls `systemPreferences.getMediaAccessStatus()` / Accessibility trust and advances automatically once granted. A **"Test wake word"** step follows the mic grant to calibrate the threshold.

### Distribution

- **Code signing + notarization** via Apple Developer ID in CI (GitHub Actions on a macOS runner).
- `electron-builder` → signed `.dmg` + `.app`.
- **Auto-update** via `electron-updater` against GitHub Releases.
- Entitlements: `com.apple.security.device.audio-input`, screen capture usage, plus hardened-runtime exceptions required by `nut-js` / native addons.

---

## 9. Design Language (macOS-Native)

Native Apple design first; **Liquid Glass is one ingredient, not the whole UI.**

- **Materials:** standard macOS frosting (`vibrancy: 'under-window'`, `transparent: true`, `backgroundColor: '#00000000'`). Liquid Glass treatment is reserved for the **orb** and **floating cards**, not every surface. The chat sheet reads as a normal macOS sheet.
- **Liquid Glass recipe (orb/cards only):** `backdrop-filter: blur(40px) saturate(180%)`, 0.5px rim light `rgba(255,255,255,0.18)`, inset top highlight, subtle specular gradient; a faint wallpaper-sampled tint via `desktopCapturer` average color.
- **Typography:** `-apple-system, 'SF Pro Display', 'SF Pro Text'` (system stack; no font imports).
- **Color:** follows macOS system accent (`window.matchMedia`) and light/dark.
- **Radii:** 22–28px to match macOS 26 system sheets; orb fully round.
- **Motion:** `framer-motion` springs tuned to Apple's `response ~0.4 / dampingFraction ~0.8`; transitions use scale + opacity + blur (not edge slides). Fluid and smooth, not flashy.
- **Chrome:** no Dock icon, no menu bar menus; only a Tray icon (●) with "Open Nova" / "Quit". The dormant orb dot lives on the desktop layer.

---

## 10. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| openWakeWord framing port is fiddly | Unit tests against recorded WAV fixtures; threshold + "test wake word" calibration in onboarding |
| Wake-word false positives/negatives | User-adjustable threshold; 2s debounce + re-arm gate |
| Native addons (`nut-js`, audio) break notarization | Pin versions; verify hardened-runtime entitlements early in a signing spike before deep feature work |
| Computer-use loop runs away | 25-iteration cap, 5-min wall-clock timeout, always-visible Stop, Activity log |
| Screen captures leak sensitive data | On-device only (never to Vercel/Supabase); `AXSecureTextField` suppression; session pause toggle |
| Electron app + Next app code drift | Shared types in `shared/`; treat tool/receipt shapes as a small versioned contract |
| Intel Macs higher CPU for wake word | Documented as best-effort; Apple Silicon is the primary target |

---

## 11. Phased Build Order (for the implementation plan)

1. **Electron shell + signing spike** — bootable `.app`, tray, transparent always-on-top window, notarization proven with a native addon stub.
2. **Auth + Supabase sync** — magic-link, Keychain session, read existing conversations.
3. **Orb UI + state machine** — five states, chat sheet, motion, design language (mock data).
4. **Wake word** — onnxruntime-node pipeline, framing, mic capture, threshold calibration.
5. **Voice loop** — STT/TTS bridge reusing existing providers; full "Hey Jarvis → speak → response + TTS" path.
6. **Screen context** — capture, compression, password-field suppression, passive buffer.
7. **Chat + tools (non-computer)** — Anthropic client, ported system prompt, memory/reminder/calendar/file tools, receipts.
8. **Computer-use agent loop** — plan_task → WorkflowCard → opus loop → Stop → Activity log.
9. **Gated file cleanup + settings** — autonomous cleanup opt-in, wake-word settings, screen-context controls.
10. **Onboarding permission flow + polish + auto-update.**
