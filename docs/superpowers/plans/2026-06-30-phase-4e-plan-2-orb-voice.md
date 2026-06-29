# Phase 4E — Plan 2: Orb UI + Voice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Plan 1 shell into a voice-first assistant: a five-state Liquid-Glass orb, a "Hey Jarvis" wake word running on-device, and the full pipeline **wake → speak → streamed Claude reply → spoken TTS → barge-in → re-arm**, reusing the web app's barge-in/VAD/sentence-buffer logic and leaving a stubbed seam for future live speech-to-speech models.

**Architecture:** The **renderer** owns the UI (orb state machine as a pure reducer + React components) and all Web-Audio work (one `getUserMedia` stream at 16 kHz feeds wake-word framing, STT recording, and barge-in). The **main process** owns the privileged/secret work: it runs openWakeWord ONNX inference in a `worker_thread`, calls STT/TTS provider APIs (keys never reach the renderer), and streams Claude replies. A single mic capture path streams Int16 frames to main for wake detection and is reused for the active turn — no second native mic dependency, no two-consumer contention. A `VoiceMode` interface (`pipeline` today, `live` stubbed) sits below the orb so a later phase can drop in a direct-speech model without touching the UI.

**Tech Stack:** Electron 33+ renderer (Chromium Web Audio), React 19, `framer-motion` ^11, `onnxruntime-node` ^1.20, `@anthropic-ai/sdk` ^0.105, `@supabase/supabase-js` (Plan 1), Vitest (node env, pure-logic tests only).

## Global Constraints

- **Carried from Plan 1 (still binding):** macOS only; Node 20+ / Electron 33+; renderer sandboxed (`nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`) with the preload `contextBridge` as the only renderer↔main surface; **no Next.js runtime in Electron** — reused web-app logic is **copied** into `nova-mac/`, never imported from `../`; env names match the web app; TypeScript strict + `noUnusedLocals`/`noUnusedParameters`; `npm run build` (tsc) passes with zero errors; one commit per task minimum.
- **Default chat model:** `claude-haiku-4-5`. The Plan 2 streamer is text-only (no tools, no ported system prompt — those land in Plan 3).
- **Single mic path:** exactly one `getUserMedia`/`AudioContext` capture exists at a time. The AudioContext is created with `{ sampleRate: 16000 }` so Chromium resamples to 16 kHz for us. While dormant it feeds wake framing; during a turn the same stream feeds the recorder + barge-in. Main pauses wake scoring for the duration of a turn and re-arms on `voice:turnEnded`.
- **Native inference off the UI/main thread:** openWakeWord ONNX models run in a `worker_thread` owned by main; `.node` binaries stay outside the asar (`asarUnpack` already set in Plan 1's `electron-builder.json`).
- **Secrets never enter the renderer:** `OPENAI_API_KEY`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY` are read only in main. STT/TTS/chat all cross IPC.
- **Never select the `memories.embedding` column** (carried from Plan 1) — not exercised in this plan but still binding.
- **Liquid Glass recipe (orb + floating cards ONLY — verbatim from spec §9):** `backdrop-filter: blur(40px) saturate(180%)`; 0.5px rim light `rgba(255,255,255,0.18)`; inset top highlight; radii 22–28px (orb fully round). The chat sheet is a plain macOS sheet, **not** glass.
- **Typography (verbatim):** `-apple-system, 'SF Pro Display', 'SF Pro Text'` — system stack, no font imports.
- **Motion (verbatim from spec §9):** `framer-motion` springs tuned to Apple's `response ~0.4 / dampingFraction ~0.8`; transitions use scale + opacity + blur, never edge slides.
- **Wake word defaults:** detection threshold `0.5` (user-adjustable later); after a detection, **2 s debounce** and the score must drop below threshold before re-arming.
- **VoicePreferences are ported verbatim** from `lib/voice/types.ts` `DEFAULT_VOICE_PREFERENCES` (Task 1) and are the single source of voice config.
- **Test runner:** Vitest, `environment: "node"`. Pure-logic modules (reducer, VAD, sentence buffer, framing, dispatchers, message building) get real unit tests. React components and Web-Audio / ONNX / mic integration are verified by launching the app and observing documented output.

---

## File Structure

**Shared (`nova-mac/shared/`)**
- Modify `types.ts` — extend `IpcChannel`; add `OrbStateName`, `WakeFrame`, chat-stream payload types, and ported `VoicePreferences` + `DEFAULT_VOICE_PREFERENCES`.

**Renderer UI (`nova-mac/src/`)**
- `orb/orb-machine.ts` (+ `.test.ts`) — pure reducer: `OrbState`, `OrbEvent`, `orbReducer`.
- `hooks/useOrb.ts` — React wrapper over the reducer.
- `styles/glass.css` — design tokens + Liquid Glass recipe.
- `components/orb/Orb.tsx`, `Waveform.tsx`, `ShimmerRing.tsx`, `WorkingChip.tsx`.
- `components/cards/ResponseCard.tsx`.
- `components/sheet/ChatSheet.tsx`.
- `motion/springs.ts` — the Apple spring token.

**Renderer voice runtime (`nova-mac/src/voice/`, ported)**
- `vad.ts` (+ `.test.ts`), `sentence-buffer.ts` (+ `.test.ts`), `tts-text.ts` — copied from `lib/voice/`.
- `mic-analyser.ts`, `mic-session.ts`, `recorder.ts`, `tts-barge-in.ts`, `player.ts` — copied + adapted (TTS via IPC).
- `wake-capture.ts` — 16 kHz AudioWorklet → Int16 frames → IPC.
- `useVoice.ts` (in `hooks/`) — the end-to-end loop orchestrator.

**Main (`nova-mac/electron/`)**
- `voice/stt.ts` (+ `.test.ts`) — transcribe dispatcher + OpenAI provider (ported).
- `voice/tts.ts` (+ `.test.ts`) — synthesize dispatcher + OpenAI/Deepgram providers + Google stub (ported).
- `voice/voice-mode.ts` (+ `.test.ts`) — `VoiceMode` interface, `PipelineVoiceMode`, `LiveVoiceProvider` registry (stub).
- `voice/preferences.ts` — read voice prefs from `user_preferences` (falls back to defaults).
- `chat.ts` (+ `.test.ts`) — minimal Anthropic streamer over IPC.
- `wakeword/framing.ts` (+ `.test.ts`) — ring buffer + mel/embedding windowing.
- `wakeword/engine.ts` — ONNX session pipeline (runs inside the worker).
- `wakeword/worker.ts` — `worker_thread` entry: frames in → score out.
- `wakeword/index.ts` — main-side controller: spawns worker, debounce/re-arm, emits `wake:detected`.
- `wakeword/models/` — `melspectrogram.onnx`, `embedding_model.onnx`, `hey_jarvis_v0.1.onnx` (downloaded).
- Modify `ipc.ts`, `preload.ts`, `main.ts`, `window.ts`, `src/lib/ipc.ts`, `package.json`, `.env.example`.

---

### Task 1: Shared types — IPC channels, orb/wake/chat payloads, ported VoicePreferences

**Files:**
- Modify: `nova-mac/shared/types.ts`
- Test: `nova-mac/shared/types.test.ts` (extend existing)

**Interfaces:**
- Consumes: existing `IpcChannel`, `AuthState`, etc. (Plan 1).
- Produces: new `IpcChannel` members; `OrbStateName`; `WakeFrame`; `ChatStreamDelta`/`ChatStreamDone`/`ChatStreamError`; `ChatMessage`; `VoicePreferences` + `DEFAULT_VOICE_PREFERENCES`; `SttProvider`/`TtsProvider` unions. All later tasks consume these.

- [ ] **Step 1: Extend the failing test in `shared/types.test.ts`**

Append to the existing file:
```ts
import { DEFAULT_VOICE_PREFERENCES } from "./types";

describe("IpcChannel — Plan 2 voice/wake/chat channels", () => {
  it("defines the new channels", () => {
    expect(IpcChannel.WakeAudioFrame).toBe("wake:audioFrame");
    expect(IpcChannel.WakeDetected).toBe("wake:detected");
    expect(IpcChannel.WakeSetEnabled).toBe("wake:setEnabled");
    expect(IpcChannel.VoiceTranscribe).toBe("voice:transcribe");
    expect(IpcChannel.VoiceSynthesize).toBe("voice:synthesize");
    expect(IpcChannel.VoiceGetPreferences).toBe("voice:getPreferences");
    expect(IpcChannel.VoiceTurnEnded).toBe("voice:turnEnded");
    expect(IpcChannel.ChatSend).toBe("chat:send");
    expect(IpcChannel.ChatDelta).toBe("chat:delta");
    expect(IpcChannel.ChatDone).toBe("chat:done");
    expect(IpcChannel.ChatError).toBe("chat:error");
    expect(IpcChannel.ChatCancel).toBe("chat:cancel");
  });
});

describe("DEFAULT_VOICE_PREFERENCES", () => {
  it("defaults to wake-word mode with openai providers", () => {
    expect(DEFAULT_VOICE_PREFERENCES.interactionMode).toBe("wake_word");
    expect(DEFAULT_VOICE_PREFERENCES.sttProvider).toBe("openai");
    expect(DEFAULT_VOICE_PREFERENCES.ttsProvider).toBe("openai");
    expect(DEFAULT_VOICE_PREFERENCES.silenceMs).toBe(1500);
    expect(DEFAULT_VOICE_PREFERENCES.bargeInEnabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nova-mac && npm run test -- types`
Expected: FAIL — `IpcChannel.WakeAudioFrame` is `undefined` / `DEFAULT_VOICE_PREFERENCES` not exported.

- [ ] **Step 3: Extend `IpcChannel` in `shared/types.ts`**

Add these members to the existing `enum IpcChannel` (keep the Plan 1 members):
```ts
  // Wake word
  WakeAudioFrame = "wake:audioFrame",   // renderer → main (one-way Int16 frames)
  WakeDetected = "wake:detected",       // main → renderer (event)
  WakeSetEnabled = "wake:setEnabled",   // renderer → main
  // Voice (STT/TTS)
  VoiceTranscribe = "voice:transcribe", // renderer → main (invoke)
  VoiceSynthesize = "voice:synthesize", // renderer → main (invoke)
  VoiceGetPreferences = "voice:getPreferences", // renderer → main (invoke)
  VoiceTurnEnded = "voice:turnEnded",   // renderer → main (one-way: re-arm wake)
  // Chat streaming
  ChatSend = "chat:send",               // renderer → main (one-way: start a stream)
  ChatDelta = "chat:delta",             // main → renderer (event)
  ChatDone = "chat:done",               // main → renderer (event)
  ChatError = "chat:error",             // main → renderer (event)
  ChatCancel = "chat:cancel",           // renderer → main (one-way)
```

- [ ] **Step 4: Add the orb/wake/chat/voice domain types**

Append to `shared/types.ts`:
```ts
export type OrbStateName =
  | "dormant"
  | "listening"
  | "processing"
  | "responding"
  | "working";

/** Int16 PCM, 16 kHz mono, one ~80ms frame (1280 samples). */
export interface WakeFrame {
  /** Transferable ArrayBuffer of Int16 little-endian samples. */
  samples: ArrayBuffer;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSendRequest {
  requestId: string;
  messages: ChatMessage[];
}

export interface ChatStreamDelta {
  requestId: string;
  delta: string;
}
export interface ChatStreamDone {
  requestId: string;
  text: string;
}
export interface ChatStreamError {
  requestId: string;
  message: string;
}

export interface TranscribeRequest {
  /** base64-encoded audio bytes. */
  audioBase64: string;
  mimeType: string;
}

export interface SynthesizeRequest {
  text: string;
  voice: string;
  speed: number;
  hd?: boolean;
  provider?: TtsProvider;
}
export interface SynthesizeResult {
  /** base64-encoded MP3 bytes. */
  audioBase64: string;
}
```

- [ ] **Step 5: Port `VoicePreferences` + `DEFAULT_VOICE_PREFERENCES` (subset) into `shared/types.ts`**

Copy these from `lib/voice/types.ts` verbatim (the Mac app uses the same shape; trim nothing — keeping the full shape avoids drift with the web app):
```ts
export type VoiceInteractionMode =
  | "off"
  | "push_to_talk"
  | "conversation"
  | "wake_word";

export type SttProvider = "openai" | "google";
export type TtsProvider = "openai" | "google" | "deepgram";

export type OpenAiSttModel =
  | "gpt-4o-transcribe"
  | "gpt-4o-mini-transcribe"
  | "whisper-1";
export type OpenAiTtsModel = "gpt-4o-mini-tts" | "tts-1" | "tts-1-hd";
export type GoogleVoiceQuality = "low" | "medium" | "high";
export type GoogleSttModel = "latest_long" | "latest_short" | "chirp_2";

export interface VoicePreferences {
  interactionMode: VoiceInteractionMode;
  autoSendOnEndOfTurn: boolean;
  silenceMs: number;
  spokenReplies: boolean;
  bargeInEnabled: boolean;
  bargeInSilenceMs: number;
  bargeInAbortMs: number;
  bargeInSensitivity: number;
  instantAck: boolean;
  instantAckMode: "off" | "earcon" | "spoken";
  listeningSensitivity: number;
  wakeWordSensitivity: number;
  wakePhrases: string[];
  sttProvider: SttProvider;
  openAiSttModel: OpenAiSttModel;
  googleSttModel: GoogleSttModel;
  googleSttQuality: GoogleVoiceQuality;
  ttsProvider: TtsProvider;
  googleTtsQuality: GoogleVoiceQuality;
  openAiTtsModel: OpenAiTtsModel;
  ttsVoice: string;
  googleTtsVoice: string;
  deepgramTtsVoice: string;
  ttsSpeed: number;
  ttsHd: boolean;
}

export const DEFAULT_VOICE_PREFERENCES: VoicePreferences = {
  interactionMode: "wake_word",
  autoSendOnEndOfTurn: true,
  silenceMs: 1500,
  spokenReplies: true,
  bargeInEnabled: true,
  bargeInSilenceMs: 1400,
  bargeInAbortMs: 3000,
  bargeInSensitivity: 0.45,
  instantAck: false,
  instantAckMode: "earcon",
  listeningSensitivity: 0.55,
  wakeWordSensitivity: 0.5,
  wakePhrases: ["hey jarvis"],
  sttProvider: "openai",
  openAiSttModel: "gpt-4o-transcribe",
  googleSttModel: "latest_long",
  googleSttQuality: "medium",
  ttsProvider: "openai",
  googleTtsQuality: "high",
  openAiTtsModel: "gpt-4o-mini-tts",
  ttsVoice: "coral",
  googleTtsVoice: "en-AU-Chirp3-HD-Kore",
  deepgramTtsVoice: "aura-orion-en",
  ttsSpeed: 1.1,
  ttsHd: true,
};
```
> Note the one deliberate difference from the web default: `wakePhrases: ["hey jarvis"]` (the Mac wake word), not `["hey nova"]`.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd nova-mac && npm run test -- types && npx tsc --noEmit`
Expected: PASS; zero type errors.

- [ ] **Step 7: Commit**

```bash
git add nova-mac/shared/types.ts nova-mac/shared/types.test.ts
git commit -m "feat(mac): shared IPC channels + orb/wake/chat payloads + ported VoicePreferences"
```

---

### Task 2: Orb state machine (pure reducer)

**Files:**
- Create: `nova-mac/src/orb/orb-machine.ts`
- Test: `nova-mac/src/orb/orb-machine.test.ts`

**Interfaces:**
- Consumes: `OrbStateName` from `@shared/types`.
- Produces:
  - `interface OrbState { name: OrbStateName; transcript: string; responseText: string; workingStep: string | null; error: string | null }`
  - `type OrbEvent` (discriminated union, `type` field).
  - `const INITIAL_ORB_STATE: OrbState`.
  - `function orbReducer(state: OrbState, event: OrbEvent): OrbState`.

- [ ] **Step 1: Write the failing test**

`src/orb/orb-machine.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { orbReducer, INITIAL_ORB_STATE, type OrbState } from "./orb-machine";

const at = (name: OrbState["name"]): OrbState => ({ ...INITIAL_ORB_STATE, name });

describe("orbReducer", () => {
  it("starts dormant", () => {
    expect(INITIAL_ORB_STATE.name).toBe("dormant");
  });

  it("summon: dormant → listening", () => {
    expect(orbReducer(at("dormant"), { type: "summon" }).name).toBe("listening");
  });

  it("submit: listening → processing and stores the transcript", () => {
    const next = orbReducer(at("listening"), { type: "submit", transcript: "what's the weather" });
    expect(next.name).toBe("processing");
    expect(next.transcript).toBe("what's the weather");
  });

  it("responseStart: processing → responding", () => {
    expect(orbReducer(at("processing"), { type: "responseStart" }).name).toBe("responding");
  });

  it("responseDelta accumulates text while responding", () => {
    let s = at("responding");
    s = orbReducer(s, { type: "responseDelta", delta: "Hello" });
    s = orbReducer(s, { type: "responseDelta", delta: " world" });
    expect(s.responseText).toBe("Hello world");
  });

  it("responseEnd: responding → dormant", () => {
    expect(orbReducer(at("responding"), { type: "responseEnd" }).name).toBe("dormant");
  });

  it("bargeIn: responding → listening and clears response text", () => {
    const next = orbReducer({ ...at("responding"), responseText: "abc" }, { type: "bargeIn" });
    expect(next.name).toBe("listening");
    expect(next.responseText).toBe("");
  });

  it("startWorking: → working with a step label", () => {
    const next = orbReducer(at("responding"), { type: "startWorking", step: "Opening Finder" });
    expect(next.name).toBe("working");
    expect(next.workingStep).toBe("Opening Finder");
  });

  it("workingStep updates the label without leaving working", () => {
    const next = orbReducer(at("working"), { type: "workingStep", step: "Selecting files" });
    expect(next.name).toBe("working");
    expect(next.workingStep).toBe("Selecting files");
  });

  it("stop: working → responding (shows partial result)", () => {
    expect(orbReducer(at("working"), { type: "stop" }).name).toBe("responding");
  });

  it("dismiss: any state → dormant and resets transient fields", () => {
    const busy: OrbState = { name: "responding", transcript: "x", responseText: "y", workingStep: "z", error: null };
    const next = orbReducer(busy, { type: "dismiss" });
    expect(next).toEqual(INITIAL_ORB_STATE);
  });

  it("error: → dormant with an error message", () => {
    const next = orbReducer(at("processing"), { type: "error", message: "STT failed" });
    expect(next.name).toBe("dormant");
    expect(next.error).toBe("STT failed");
  });

  it("ignores summon when not dormant", () => {
    expect(orbReducer(at("processing"), { type: "summon" }).name).toBe("processing");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nova-mac && npm run test -- orb-machine`
Expected: FAIL — `Cannot find module './orb-machine'`.

- [ ] **Step 3: Implement `src/orb/orb-machine.ts`**

```ts
import type { OrbStateName } from "@shared/types";

export interface OrbState {
  name: OrbStateName;
  transcript: string;
  responseText: string;
  workingStep: string | null;
  error: string | null;
}

export type OrbEvent =
  | { type: "summon" }
  | { type: "submit"; transcript: string }
  | { type: "responseStart" }
  | { type: "responseDelta"; delta: string }
  | { type: "responseEnd" }
  | { type: "bargeIn" }
  | { type: "startWorking"; step: string }
  | { type: "workingStep"; step: string }
  | { type: "stop" }
  | { type: "dismiss" }
  | { type: "error"; message: string };

export const INITIAL_ORB_STATE: OrbState = {
  name: "dormant",
  transcript: "",
  responseText: "",
  workingStep: null,
  error: null,
};

export function orbReducer(state: OrbState, event: OrbEvent): OrbState {
  switch (event.type) {
    case "summon":
      return state.name === "dormant"
        ? { ...INITIAL_ORB_STATE, name: "listening" }
        : state;

    case "submit":
      return state.name === "listening"
        ? { ...state, name: "processing", transcript: event.transcript, error: null }
        : state;

    case "responseStart":
      return state.name === "processing"
        ? { ...state, name: "responding", responseText: "" }
        : state;

    case "responseDelta":
      return state.name === "responding"
        ? { ...state, responseText: state.responseText + event.delta }
        : state;

    case "responseEnd":
      return state.name === "responding"
        ? { ...INITIAL_ORB_STATE, name: "dormant" }
        : state;

    case "bargeIn":
      return state.name === "responding"
        ? { ...INITIAL_ORB_STATE, name: "listening" }
        : state;

    case "startWorking":
      return { ...state, name: "working", workingStep: event.step };

    case "workingStep":
      return state.name === "working" ? { ...state, workingStep: event.step } : state;

    case "stop":
      return state.name === "working" ? { ...state, name: "responding" } : state;

    case "dismiss":
      return INITIAL_ORB_STATE;

    case "error":
      return { ...INITIAL_ORB_STATE, name: "dormant", error: event.message };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nova-mac && npm run test -- orb-machine`
Expected: PASS (13 tests).

- [ ] **Step 5: Commit**

```bash
git add nova-mac/src/orb/orb-machine.ts nova-mac/src/orb/orb-machine.test.ts
git commit -m "feat(mac): orb five-state machine as a pure reducer"
```

---

### Task 3: Orb component + design language + useOrb hook (dev-driven, launch-verified)

**Files:**
- Create: `nova-mac/src/styles/glass.css`, `nova-mac/src/motion/springs.ts`, `nova-mac/src/hooks/useOrb.ts`, `nova-mac/src/components/orb/Orb.tsx`, `Waveform.tsx`, `ShimmerRing.tsx`, `WorkingChip.tsx`
- Modify: `nova-mac/src/App.tsx` (mount the orb + a dev keyboard harness), `nova-mac/package.json` (add `framer-motion`), `nova-mac/electron/window.ts` (`backgroundThrottling: false`), `nova-mac/index.html` (load `glass.css`)

**Interfaces:**
- Consumes: `orbReducer`, `INITIAL_ORB_STATE`, `OrbState`, `OrbEvent` (Task 2).
- Produces:
  - `useOrb(): { state: OrbState; dispatch: (e: OrbEvent) => void }`
  - `<Orb state={OrbState} level={number} onSummon={() => void} onStop={() => void} />`
  - `appleSpring` motion token.

- [ ] **Step 1: Add `framer-motion` to `package.json` dependencies**

```json
    "framer-motion": "^11.11.0"
```
Run: `cd nova-mac && npm install`

- [ ] **Step 2: Create `src/motion/springs.ts`**

Apple's spring math for `response 0.4 / dampingFraction 0.8` → `stiffness = (2π/response)² ≈ 247`, `damping = 4π·dampingFraction/response ≈ 25`:
```ts
import type { Transition } from "framer-motion";

/** Apple system spring: response ~0.4s, dampingFraction ~0.8 (spec §9). */
export const appleSpring: Transition = { type: "spring", stiffness: 247, damping: 25 };
```

- [ ] **Step 3: Create `src/styles/glass.css` (design tokens + Liquid Glass recipe)**

```css
:root {
  --nova-font: -apple-system, "SF Pro Display", "SF Pro Text", system-ui, sans-serif;
  --nova-radius-card: 24px;            /* spec §9: 22–28px */
  --nova-rim: rgba(255, 255, 255, 0.18);
}

html, body, #root {
  margin: 0;
  height: 100%;
  background: transparent;
  overflow: hidden;
  font-family: var(--nova-font);
  -webkit-font-smoothing: antialiased;
  color: white;
}

/* Liquid Glass — orb + floating cards ONLY (spec §9). */
.nova-glass {
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  background: rgba(40, 40, 45, 0.28);
  box-shadow:
    inset 0 0.5px 0 0 var(--nova-rim),          /* rim light */
    inset 0 8px 24px -12px rgba(255, 255, 255, 0.25), /* inset top highlight */
    0 12px 40px -8px rgba(0, 0, 0, 0.45);
  border: 0.5px solid var(--nova-rim);
}

.nova-orb { border-radius: 999px; }
.nova-card { border-radius: var(--nova-radius-card); }
```

- [ ] **Step 4: Reference `glass.css` from `index.html`**

In `nova-mac/index.html`, add inside `<head>`:
```html
    <link rel="stylesheet" href="/src/styles/glass.css" />
```

- [ ] **Step 5: Disable background throttling so the always-on orb keeps capturing**

In `nova-mac/electron/window.ts`, inside the `webPreferences` object of `createOrbWindow`, add:
```ts
      backgroundThrottling: false,
```

- [ ] **Step 6: Create `src/hooks/useOrb.ts`**

```ts
import { useReducer } from "react";
import { orbReducer, INITIAL_ORB_STATE, type OrbEvent } from "../orb/orb-machine";

export function useOrb() {
  const [state, dispatch] = useReducer(orbReducer, INITIAL_ORB_STATE);
  return { state, dispatch: (e: OrbEvent) => dispatch(e) };
}
```

- [ ] **Step 7: Create the sub-components**

`src/components/orb/ShimmerRing.tsx`:
```tsx
import { motion } from "framer-motion";

export function ShimmerRing() {
  return (
    <motion.div
      aria-hidden
      style={{
        position: "absolute", inset: 0, borderRadius: "999px",
        border: "2px solid transparent",
        background:
          "conic-gradient(from 0deg, rgba(255,255,255,0.0), rgba(255,255,255,0.6), rgba(255,255,255,0.0)) border-box",
        WebkitMask:
          "linear-gradient(#000 0 0) padding-box, linear-gradient(#000 0 0)",
        WebkitMaskComposite: "xor", maskComposite: "exclude",
      }}
      animate={{ rotate: 360 }}
      transition={{ repeat: Infinity, ease: "linear", duration: 2.4 }}
    />
  );
}
```

`src/components/orb/Waveform.tsx` (live mic level 0..1 → bars):
```tsx
export function Waveform({ level }: { level: number }) {
  const bars = 5;
  return (
    <div style={{ display: "flex", gap: 4, alignItems: "center", height: 40 }}>
      {Array.from({ length: bars }).map((_, i) => {
        const center = 1 - Math.abs(i - (bars - 1) / 2) / bars;
        const h = 6 + Math.min(1, level * 2) * center * 30;
        return (
          <div key={i} style={{
            width: 4, height: h, borderRadius: 2,
            background: "rgba(255,255,255,0.9)", transition: "height 80ms linear",
          }} />
        );
      })}
    </div>
  );
}
```

`src/components/orb/WorkingChip.tsx`:
```tsx
import { motion } from "framer-motion";
import { appleSpring } from "../../motion/springs";

export function WorkingChip({ step, onStop }: { step: string | null; onStop: () => void }) {
  return (
    <motion.div
      className="nova-glass nova-card"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={appleSpring}
      style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px" }}
    >
      <span style={{ fontSize: 13, opacity: 0.9 }}>{step ?? "Working…"}</span>
      <button
        onClick={onStop}
        style={{
          fontSize: 12, padding: "4px 10px", borderRadius: 999, border: "none",
          background: "rgba(255,69,58,0.9)", color: "white", cursor: "pointer",
        }}
      >
        Stop
      </button>
    </motion.div>
  );
}
```

- [ ] **Step 8: Create `src/components/orb/Orb.tsx` (the five-state visual)**

```tsx
import { motion, AnimatePresence } from "framer-motion";
import type { OrbState } from "../../orb/orb-machine";
import { appleSpring } from "../../motion/springs";
import { Waveform } from "./Waveform";
import { ShimmerRing } from "./ShimmerRing";
import { WorkingChip } from "./WorkingChip";

const SIZE: Record<OrbState["name"], number> = {
  dormant: 12, listening: 120, processing: 120, responding: 120, working: 0,
};

export function Orb({
  state, level, onSummon, onStop,
}: {
  state: OrbState; level: number; onSummon: () => void; onStop: () => void;
}) {
  if (state.name === "working") {
    return (
      <div style={{ position: "fixed", right: 24, bottom: 24 }}>
        <WorkingChip step={state.workingStep} onStop={onStop} />
      </div>
    );
  }

  const size = SIZE[state.name];
  const breathing = state.name === "responding";

  return (
    <div style={{ position: "fixed", right: 24, bottom: 24 }}>
      <motion.div
        className="nova-glass nova-orb"
        onClick={state.name === "dormant" ? onSummon : undefined}
        animate={{
          width: size, height: size,
          opacity: state.name === "dormant" ? 0.55 : 1,
          scale: breathing ? [1, 1.06, 1] : 1,
        }}
        transition={
          breathing
            ? { scale: { repeat: Infinity, duration: 2.4, ease: "easeInOut" }, ...appleSpring }
            : appleSpring
        }
        style={{
          position: "relative", display: "flex",
          alignItems: "center", justifyContent: "center",
          cursor: state.name === "dormant" ? "pointer" : "default",
        }}
      >
        {state.name === "listening" && <Waveform level={level} />}
        {state.name === "processing" && <ShimmerRing />}
      </motion.div>

      <AnimatePresence>
        {state.name === "responding" && state.responseText && (
          <motion.div
            className="nova-glass nova-card"
            initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, filter: "blur(6px)" }}
            transition={appleSpring}
            style={{ marginTop: 12, padding: "12px 16px", maxWidth: 320, fontSize: 14 }}
          >
            {state.responseText.slice(0, 200)}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 9: Mount the orb + a dev keyboard harness in `src/App.tsx`**

Keep the Plan 1 auth gate; when signed in, render the orb and a dev harness that drives the reducer with keys (so states are verifiable before voice exists). Replace the signed-in branch's return with:
```tsx
  // signed-in branch:
  return <OrbHarness email={auth.email} />;
```
And add this component to `src/App.tsx` (or a new `src/components/OrbHarness.tsx` imported here):
```tsx
import { useEffect, useState } from "react";
import { useOrb } from "./hooks/useOrb";
import { Orb } from "./components/orb/Orb";

function OrbHarness({ email }: { email: string | null }) {
  const { state, dispatch } = useOrb();
  const [level, setLevel] = useState(0);

  // DEV ONLY: drive states from the keyboard until voice (Task 12) is wired.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "1") dispatch({ type: "summon" });
      if (e.key === "2") dispatch({ type: "submit", transcript: "demo command" });
      if (e.key === "3") { dispatch({ type: "responseStart" });
        dispatch({ type: "responseDelta", delta: "This is a demo response from Nova." }); }
      if (e.key === "4") dispatch({ type: "responseEnd" });
      if (e.key === "5") dispatch({ type: "startWorking", step: "Opening Finder" });
      if (e.key === "Escape") dispatch({ type: "dismiss" });
    };
    window.addEventListener("keydown", onKey);
    const t = setInterval(() => setLevel(Math.random() * 0.6), 120);
    return () => { window.removeEventListener("keydown", onKey); clearInterval(t); };
  }, [dispatch]);

  return (
    <>
      <div style={{ position: "fixed", top: 8, left: 8, fontSize: 10, opacity: 0.4 }}>
        {email} · keys 1–5 / Esc
      </div>
      <Orb
        state={state}
        level={level}
        onSummon={() => dispatch({ type: "summon" })}
        onStop={() => dispatch({ type: "stop" })}
      />
    </>
  );
}
```
> The keyboard harness is dev scaffolding that Task 12 replaces with the real voice loop. Leave it; Task 12 swaps `OrbHarness` for `useVoice`-driven rendering.

- [ ] **Step 10: Launch and verify all five states render**

Run: `cd nova-mac && npm run dev` (sign in if needed).
Expected (manual): a dim 12px dot bottom-right; pressing `1` expands to a ~120px glass orb; `2` shows a rotating shimmer ring; `3` shows a breathing orb + a frosted response card with text; `5` morphs to a bottom-right pill chip with a red **Stop** button; `Esc` returns to the dot. Motion is spring-based scale/opacity/blur, no edge slides.

- [ ] **Step 11: Verify build + typecheck**

Run: `cd nova-mac && npm run test && npx tsc --noEmit`
Expected: existing tests still PASS; zero type errors.

- [ ] **Step 12: Commit**

```bash
git add nova-mac/src/styles nova-mac/src/motion nova-mac/src/hooks/useOrb.ts \
  nova-mac/src/components/orb nova-mac/src/App.tsx nova-mac/index.html \
  nova-mac/electron/window.ts nova-mac/package.json nova-mac/package-lock.json
git commit -m "feat(mac): five-state Liquid Glass orb + Apple-spring motion + design tokens"
```

---

### Task 4: Response card detail + swipe-up chat sheet

**Files:**
- Create: `nova-mac/src/components/cards/ResponseCard.tsx`, `nova-mac/src/components/sheet/ChatSheet.tsx`
- Modify: `nova-mac/src/App.tsx` (wire the sheet open/close into `OrbHarness`)

**Interfaces:**
- Consumes: `OrbState`, `appleSpring`, `ChatMessage` (`@shared/types`).
- Produces:
  - `<ResponseCard text={string} onExpand={() => void} />`
  - `<ChatSheet open={boolean} messages={ChatMessage[]} onClose={() => void} />`

- [ ] **Step 1: Create `src/components/cards/ResponseCard.tsx`**

Extract the responding card from `Orb.tsx` into a reusable component with an expand affordance:
```tsx
import { motion } from "framer-motion";
import { appleSpring } from "../../motion/springs";

export function ResponseCard({ text, onExpand }: { text: string; onExpand: () => void }) {
  return (
    <motion.div
      className="nova-glass nova-card"
      initial={{ opacity: 0, y: 8, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      exit={{ opacity: 0, filter: "blur(6px)" }}
      transition={appleSpring}
      onClick={onExpand}
      style={{ marginTop: 12, padding: "12px 16px", maxWidth: 320, fontSize: 14, cursor: "pointer" }}
    >
      {text.slice(0, 200)}
      <div style={{ marginTop: 6, fontSize: 11, opacity: 0.5 }}>Swipe up / click for full chat ↑</div>
    </motion.div>
  );
}
```
Then in `Orb.tsx`, replace the inline `<motion.div … responseText …>` block with `<ResponseCard text={state.responseText} onExpand={onExpand} />` and add an `onExpand: () => void` prop to `Orb`.

- [ ] **Step 2: Create `src/components/sheet/ChatSheet.tsx` (plain macOS sheet — NOT glass)**

```tsx
import { motion, AnimatePresence } from "framer-motion";
import { appleSpring } from "../../motion/springs";
import type { ChatMessage } from "@shared/types";

export function ChatSheet({
  open, messages, onClose,
}: { open: boolean; messages: ChatMessage[]; onClose: () => void }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={appleSpring}
          style={{
            position: "fixed", left: 0, right: 0, bottom: 0, height: "70%",
            background: "rgba(28,28,30,0.98)", borderTopLeftRadius: 16, borderTopRightRadius: 16,
            boxShadow: "0 -8px 40px rgba(0,0,0,0.5)", display: "flex", flexDirection: "column",
          }}
        >
          <div
            onClick={onClose}
            style={{ alignSelf: "center", width: 40, height: 5, borderRadius: 3,
              background: "rgba(255,255,255,0.3)", margin: "10px 0", cursor: "pointer" }}
          />
          <div style={{ overflowY: "auto", padding: "0 20px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
            {messages.length === 0 && <div style={{ opacity: 0.4, fontSize: 14 }}>No messages yet.</div>}
            {messages.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
                <div style={{
                  padding: "8px 12px", borderRadius: 14, fontSize: 14,
                  background: m.role === "user" ? "rgba(10,132,255,0.9)" : "rgba(58,58,60,0.9)",
                }}>{m.content}</div>
              </div>
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
```

- [ ] **Step 3: Wire the sheet into `OrbHarness`**

In `src/App.tsx`, add sheet state and an `Escape`/swipe close, and a mock message list:
```tsx
  const [sheetOpen, setSheetOpen] = useState(false);
  // …in the keydown handler add: if (e.key === "Escape") setSheetOpen(false);
  // pass onExpand to Orb:
  //   onExpand={() => setSheetOpen(true)}
  // render alongside <Orb>:
  //   <ChatSheet open={sheetOpen} messages={[{role:"user",content:"demo command"},{role:"assistant",content:"This is a demo response from Nova."}]} onClose={() => setSheetOpen(false)} />
```

- [ ] **Step 4: Launch and verify**

Run: `cd nova-mac && npm run dev`
Expected (manual): in the responding state (`3`), clicking the response card raises a bottom sheet (spring, from the bottom edge) showing the user/assistant bubbles; clicking the grabber or `Esc` dismisses it. The sheet is opaque dark (not glass/blur), confirming the material distinction in spec §9.

- [ ] **Step 5: Verify build + typecheck**

Run: `cd nova-mac && npm run test && npx tsc --noEmit`
Expected: PASS; zero type errors.

- [ ] **Step 6: Commit**

```bash
git add nova-mac/src/components/cards nova-mac/src/components/sheet \
  nova-mac/src/components/orb/Orb.tsx nova-mac/src/App.tsx
git commit -m "feat(mac): response card + swipe-up macOS chat sheet"
```

---

### Task 5: Port VAD + sentence buffer + tts-text (renderer pure logic)

**Files:**
- Create: `nova-mac/src/voice/vad.ts`, `nova-mac/src/voice/sentence-buffer.ts`, `nova-mac/src/voice/tts-text.ts`
- Test: `nova-mac/src/voice/vad.test.ts`, `nova-mac/src/voice/sentence-buffer.test.ts`

**Interfaces:**
- Consumes: nothing (self-contained ports).
- Produces:
  - From `vad.ts`: `class SpeechGate`, `class FixedSpeechDetector`, `measureSpeechBandLevel`, and constants `BARGE_IN_SPEECH_THRESHOLD`, `BARGE_IN_SPEECH_HOLD_MS`, `BARGE_IN_COOLDOWN_MS`, `MAX_RECORDING_MS`, `STUCK_OPEN_MS`, `MIN_AUDIO_BLOB_BYTES`.
  - From `sentence-buffer.ts`: `class SentenceBuffer`.
  - From `tts-text.ts`: `plainTextForSpeech`, `prepareSpeechChunks`.

- [ ] **Step 1: Copy the three source files verbatim, fixing import paths**

Copy `lib/voice/vad.ts` → `nova-mac/src/voice/vad.ts` **unchanged** (it has no imports).
Copy `lib/voice/tts-text.ts` → `nova-mac/src/voice/tts-text.ts` **unchanged** (verify it has no `@/` imports; if any exist, rewrite them to relative paths within `src/voice/`).
Copy `lib/voice/sentence-buffer.ts` → `nova-mac/src/voice/sentence-buffer.ts`, and change its first line from:
```ts
import { plainTextForSpeech } from "@/lib/voice/tts-text";
```
to:
```ts
import { plainTextForSpeech } from "./tts-text";
```

- [ ] **Step 2: Write the failing test for the VAD gate**

`src/voice/vad.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { SpeechGate, measureSpeechBandLevel } from "./vad";

afterEach(() => vi.useRealTimers());

describe("measureSpeechBandLevel", () => {
  it("averages the speech band bins and normalizes to 0..1", () => {
    const data = new Uint8Array(32).fill(255);
    expect(measureSpeechBandLevel(data)).toBeCloseTo(1, 5);
  });
  it("returns 0 for silence", () => {
    expect(measureSpeechBandLevel(new Uint8Array(32))).toBe(0);
  });
});

describe("SpeechGate", () => {
  it("calibrates then confirms sustained speech and reports silence", () => {
    vi.useFakeTimers();
    const gate = new SpeechGate({ calibrateMs: 100, speechHoldMs: 200 });
    // During calibration, no confirmation.
    expect(gate.push(0.02)).toBe(false);
    vi.advanceTimersByTime(120);
    expect(gate.push(0.02)).toBe(false); // ends calibration on this push
    expect(gate.isCalibrated()).toBe(true);
    // Sustained loud speech above threshold for >= speechHoldMs confirms.
    gate.push(0.9);
    vi.advanceTimersByTime(250);
    expect(gate.push(0.9)).toBe(true);
    expect(gate.confirmed).toBe(true);
    // After confirmation, msSinceLastSound grows once input drops.
    vi.advanceTimersByTime(300);
    expect(gate.msSinceLastSound()).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Write the failing test for the sentence buffer**

`src/voice/sentence-buffer.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { SentenceBuffer } from "./sentence-buffer";

describe("SentenceBuffer", () => {
  it("emits a complete first sentence once enough text streams in", () => {
    const buf = new SentenceBuffer();
    const out: string[] = [];
    out.push(...buf.push("Hello there, this is Nova. "));
    expect(out.join(" ")).toContain("Hello there");
  });

  it("flush returns the trailing partial text", () => {
    const buf = new SentenceBuffer();
    buf.push("A short tail without a terminator");
    expect(buf.flush()).toContain("tail");
  });

  it("reset clears all buffered state", () => {
    const buf = new SentenceBuffer();
    buf.push("Some text. ");
    buf.reset();
    expect(buf.flush()).toBeNull();
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail, then pass after the copy**

Run: `cd nova-mac && npm run test -- voice/`
Expected: the tests run against the copied modules and PASS. (If `tts-text.ts` had unexpected `@/` imports, fix them to relative and re-run.)

- [ ] **Step 5: Verify typecheck**

Run: `cd nova-mac && npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add nova-mac/src/voice/vad.ts nova-mac/src/voice/sentence-buffer.ts \
  nova-mac/src/voice/tts-text.ts nova-mac/src/voice/vad.test.ts nova-mac/src/voice/sentence-buffer.test.ts
git commit -m "feat(mac): port VAD gate, sentence buffer, and speech-text helpers"
```

---

### Task 6: STT bridge in main (OpenAI provider + dispatcher + IPC)

**Files:**
- Create: `nova-mac/electron/voice/stt.ts`
- Modify: `nova-mac/electron/ipc.ts`, `nova-mac/electron/preload.ts`, `nova-mac/src/lib/ipc.ts`, `nova-mac/electron/main.ts`, `nova-mac/.env.example`
- Test: `nova-mac/electron/voice/stt.test.ts`

**Interfaces:**
- Consumes: `SttProvider`, `TranscribeRequest` (`@shared/types`).
- Produces:
  - `transcribeWithOpenAi(audio: Buffer, mimeType: string, model?: OpenAiSttModel): Promise<string>` (ported).
  - `transcribe(req: TranscribeRequest, provider: SttProvider): Promise<string>` — decodes base64, dispatches by provider; Google throws "not yet wired on Mac".
  - IPC: renderer `nova.transcribe(req): Promise<string>`.

- [ ] **Step 1: Add STT env keys to `.env.example`**

Append:
```
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DEEPGRAM_API_KEY=
```

- [ ] **Step 2: Write the failing test (mock fetch)**

`electron/voice/stt.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { transcribe } from "./stt";

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  vi.restoreAllMocks();
});

describe("transcribe", () => {
  it("decodes base64 audio and returns the OpenAI transcript text", async () => {
    const fetchMock = vi.fn(async () => new Response(
      JSON.stringify({ text: "  hello nova  " }), { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchMock);
    const out = await transcribe(
      { audioBase64: Buffer.from("fakeaudio").toString("base64"), mimeType: "audio/webm" },
      "openai",
    );
    expect(out).toBe("hello nova");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("rejects google until it is wired on the Mac", async () => {
    await expect(
      transcribe({ audioBase64: "", mimeType: "audio/webm" }, "google"),
    ).rejects.toThrow(/not yet wired/i);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd nova-mac && npm run test -- stt`
Expected: FAIL — `Cannot find module './stt'`.

- [ ] **Step 4: Create `electron/voice/stt.ts` (port the OpenAI provider + add a dispatcher)**

```ts
import type { OpenAiSttModel, SttProvider, TranscribeRequest } from "@shared/types";

const DEFAULT_TRANSCRIBE_MODEL: OpenAiSttModel = "gpt-4o-transcribe";
const TRANSCRIBE_PROMPT =
  "Casual spoken commands and questions to a personal AI assistant.";

export async function transcribeWithOpenAi(
  audio: Buffer,
  mimeType: string,
  model: OpenAiSttModel = DEFAULT_TRANSCRIBE_MODEL,
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenAI STT is not configured (OPENAI_API_KEY).");

  const selectedModel =
    process.env.OPENAI_STT_MODEL?.trim() || model || DEFAULT_TRANSCRIBE_MODEL;

  const blob = new Blob([new Uint8Array(audio)], { type: mimeType });
  const form = new FormData();
  form.append("file", blob, `audio.${mimeType.includes("webm") ? "webm" : "mp4"}`);
  form.append("model", selectedModel);
  form.append("response_format", "json");
  form.append("language", "en");
  if (selectedModel !== "whisper-1") form.append("prompt", TRANSCRIBE_PROMPT);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message)
        : "Transcription failed";
    throw new Error(message);
  }
  const text =
    data && typeof data === "object" && "text" in data
      ? String((data as { text: unknown }).text)
      : "";
  return text.trim();
}

export async function transcribe(
  req: TranscribeRequest,
  provider: SttProvider,
): Promise<string> {
  if (provider === "google") {
    // Seam: Google STT requires the GCP client + creds; wired in a later plan.
    throw new Error("Google STT is not yet wired on the Mac app.");
  }
  const audio = Buffer.from(req.audioBase64, "base64");
  return transcribeWithOpenAi(audio, req.mimeType);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd nova-mac && npm run test -- stt`
Expected: PASS (2 tests).

- [ ] **Step 6: Add the IPC channel (invoke) to `electron/ipc.ts`**

Add to the `IpcHandlers` interface:
```ts
  transcribe(req: import("@shared/types").TranscribeRequest, provider: import("@shared/types").SttProvider): Promise<string>;
```
Add to `registerIpcHandlers` body:
```ts
  ipcMain.handle(IpcChannel.VoiceTranscribe, (_e, req, provider) => handlers.transcribe(req, provider));
```

- [ ] **Step 7: Expose it in `preload.ts` and `src/lib/ipc.ts`**

`preload.ts` — add inside `exposeInMainWorld`:
```ts
  transcribe: (req: unknown, provider: unknown) =>
    ipcRenderer.invoke(IpcChannel.VoiceTranscribe, req, provider),
```
`src/lib/ipc.ts` — add to `NovaBridge`:
```ts
  transcribe(
    req: import("@shared/types").TranscribeRequest,
    provider: import("@shared/types").SttProvider,
  ): Promise<string>;
```

- [ ] **Step 8: Wire the handler in `main.ts`**

Add to the `registerIpcHandlers({...})` object:
```ts
  transcribe: (req, provider) => import("./voice/stt").then((m) => m.transcribe(req, provider)),
```

- [ ] **Step 9: Verify tests + typecheck**

Run: `cd nova-mac && npm run test && npx tsc --noEmit`
Expected: PASS; zero type errors.

- [ ] **Step 10: Commit**

```bash
git add nova-mac/electron/voice/stt.ts nova-mac/electron/voice/stt.test.ts \
  nova-mac/electron/ipc.ts nova-mac/electron/preload.ts nova-mac/src/lib/ipc.ts \
  nova-mac/electron/main.ts nova-mac/.env.example
git commit -m "feat(mac): STT bridge in main (OpenAI provider + IPC, Google seam)"
```

---

### Task 7: TTS bridge in main + VoiceMode/LiveVoiceProvider seam (+ IPC)

**Files:**
- Create: `nova-mac/electron/voice/tts.ts`, `nova-mac/electron/voice/voice-mode.ts`
- Modify: `nova-mac/electron/ipc.ts`, `nova-mac/electron/preload.ts`, `nova-mac/src/lib/ipc.ts`, `nova-mac/electron/main.ts`
- Test: `nova-mac/electron/voice/tts.test.ts`, `nova-mac/electron/voice/voice-mode.test.ts`

**Interfaces:**
- Consumes: `TtsProvider`, `SynthesizeRequest`, `SynthesizeResult` (`@shared/types`).
- Produces:
  - `synthesizeWithOpenAi(text, voice, speed, useHd, model?): Promise<Buffer>` (ported).
  - `synthesizeWithDeepgram(text, voice): Promise<Buffer>` (ported, buffered).
  - `synthesize(req: SynthesizeRequest): Promise<SynthesizeResult>` — dispatches; Google throws "not yet wired".
  - `voice-mode.ts`: `type VoiceModeName = "pipeline" | "live"`; `interface VoiceMode { name; start(); stop() }`; `class PipelineVoiceMode`; `type LiveVoiceProvider = "google-native" | "openai-realtime"`; `registerLiveVoiceProvider` / `getVoiceMode` registry that defaults to `pipeline` and throws for unimplemented live providers.
  - IPC: renderer `nova.synthesize(req): Promise<SynthesizeResult>`.

- [ ] **Step 1: Write the failing test for the TTS dispatcher (mock fetch)**

`electron/voice/tts.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { synthesize } from "./tts";

beforeEach(() => {
  process.env.OPENAI_API_KEY = "sk-test";
  process.env.DEEPGRAM_API_KEY = "dg-test";
  vi.restoreAllMocks();
});

function audioResponse(): Response {
  return new Response(new Uint8Array([1, 2, 3]).buffer, { status: 200 });
}

describe("synthesize", () => {
  it("returns base64 MP3 from the OpenAI provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => audioResponse()));
    const out = await synthesize({ text: "hi", voice: "coral", speed: 1.1, hd: true, provider: "openai" });
    expect(Buffer.from(out.audioBase64, "base64")).toEqual(Buffer.from([1, 2, 3]));
  });

  it("rejects google until it is wired on the Mac", async () => {
    await expect(
      synthesize({ text: "hi", voice: "x", speed: 1, provider: "google" }),
    ).rejects.toThrow(/not yet wired/i);
  });
});
```

- [ ] **Step 2: Write the failing test for the VoiceMode registry**

`electron/voice/voice-mode.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getVoiceMode } from "./voice-mode";

describe("VoiceMode registry", () => {
  it("defaults to the pipeline mode", () => {
    expect(getVoiceMode("pipeline").name).toBe("pipeline");
  });
  it("throws for unimplemented live providers", () => {
    expect(() => getVoiceMode("live")).toThrow(/not implemented/i);
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `cd nova-mac && npm run test -- voice/tts voice/voice-mode`
Expected: FAIL — modules not found.

- [ ] **Step 4: Create `electron/voice/tts.ts` (port OpenAI + Deepgram, dispatcher)**

```ts
import type { OpenAiTtsModel, SynthesizeRequest, SynthesizeResult } from "@shared/types";

const OPENAI_TTS_VOICES = new Set([
  "marin", "cedar", "coral", "shimmer", "sage", "ash", "ballad",
  "verse", "nova", "alloy", "echo", "fable", "onyx",
]);
const DEFAULT_VOICE = "coral";
const MAX_TTS_CHARS = 4096;
const TTS_INSTRUCTIONS_STANDARD =
  "Speak naturally and clearly, like a helpful human assistant in a casual conversation. Warm tone, natural pacing, not robotic.";
const TTS_INSTRUCTIONS_HD =
  "Speak with rich, warm expressiveness like a thoughtful human companion. Natural rhythm, subtle emphasis, and relaxed pacing — never stiff or synthetic.";

export async function synthesizeWithOpenAi(
  text: string, voice: string, speed: number, useHd: boolean,
  model: OpenAiTtsModel = "gpt-4o-mini-tts",
): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OpenAI TTS is not configured (OPENAI_API_KEY).");
  if (!text) throw new Error("text is required");
  if (text.length > MAX_TTS_CHARS) throw new Error(`text exceeds ${MAX_TTS_CHARS} characters`);

  const selectedVoice = OPENAI_TTS_VOICES.has(voice) ? voice : DEFAULT_VOICE;
  const isModern = model === "gpt-4o-mini-tts";
  const body = isModern
    ? { model, input: text, voice: selectedVoice, speed, response_format: "mp3",
        instructions: useHd ? TTS_INSTRUCTIONS_HD : TTS_INSTRUCTIONS_STANDARD }
    : { model, input: text, voice: selectedVoice, speed, response_format: "mp3" };

  const send = (b: Record<string, unknown>) =>
    fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(b),
    });

  let response = await send(body);
  if (!response.ok && isModern) {
    response = await send({
      model: useHd ? "tts-1-hd" : "tts-1", input: text, voice: selectedVoice,
      speed, response_format: "mp3",
    });
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error?: { message?: string } }).error?.message)
        : "Speech synthesis failed";
    throw new Error(message);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function synthesizeWithDeepgram(text: string, voice: string): Promise<Buffer> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) throw new Error("Deepgram TTS is not configured (DEEPGRAM_API_KEY).");
  const url = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(voice)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      data && typeof data === "object" && "err_msg" in data
        ? String((data as { err_msg: unknown }).err_msg)
        : "Deepgram speech synthesis failed";
    throw new Error(message);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function synthesize(req: SynthesizeRequest): Promise<SynthesizeResult> {
  const provider = req.provider ?? "openai";
  let audio: Buffer;
  if (provider === "google") {
    throw new Error("Google TTS is not yet wired on the Mac app.");
  } else if (provider === "deepgram") {
    audio = await synthesizeWithDeepgram(req.text, req.voice);
  } else {
    audio = await synthesizeWithOpenAi(req.text, req.voice, req.speed, req.hd === true);
  }
  return { audioBase64: audio.toString("base64") };
}
```

- [ ] **Step 5: Create `electron/voice/voice-mode.ts` (the live-model seam)**

```ts
export type VoiceModeName = "pipeline" | "live";
export type LiveVoiceProvider = "google-native" | "openai-realtime";

export interface VoiceMode {
  readonly name: VoiceModeName;
}

/**
 * Today's architecture: STT → Claude → TTS. The orb state machine, barge-in,
 * and wake word sit ABOVE this interface so a future `live` mode reuses them.
 */
export class PipelineVoiceMode implements VoiceMode {
  readonly name = "pipeline" as const;
}

type LiveFactory = () => VoiceMode;
const liveRegistry = new Map<LiveVoiceProvider, LiveFactory>();

/** A later phase registers a real bidirectional speech-native provider here. */
export function registerLiveVoiceProvider(provider: LiveVoiceProvider, factory: LiveFactory): void {
  liveRegistry.set(provider, factory);
}

export function getVoiceMode(mode: VoiceModeName, live?: LiveVoiceProvider): VoiceMode {
  if (mode === "pipeline") return new PipelineVoiceMode();
  const factory = live ? liveRegistry.get(live) : undefined;
  if (!factory) throw new Error("Live voice mode is not implemented in this build.");
  return factory();
}
```

- [ ] **Step 6: Run both tests to verify they pass**

Run: `cd nova-mac && npm run test -- voice/tts voice/voice-mode`
Expected: PASS (3 tests total).

- [ ] **Step 7: Add the synthesize IPC channel (mirror Task 6 Steps 6–8)**

`ipc.ts` — add to `IpcHandlers`:
```ts
  synthesize(req: import("@shared/types").SynthesizeRequest): Promise<import("@shared/types").SynthesizeResult>;
```
and to the body:
```ts
  ipcMain.handle(IpcChannel.VoiceSynthesize, (_e, req) => handlers.synthesize(req));
```
`preload.ts` — inside `exposeInMainWorld`:
```ts
  synthesize: (req: unknown) => ipcRenderer.invoke(IpcChannel.VoiceSynthesize, req),
```
`src/lib/ipc.ts` — add to `NovaBridge`:
```ts
  synthesize(
    req: import("@shared/types").SynthesizeRequest,
  ): Promise<import("@shared/types").SynthesizeResult>;
```
`main.ts` — add to `registerIpcHandlers({...})`:
```ts
  synthesize: (req) => import("./voice/tts").then((m) => m.synthesize(req)),
```

- [ ] **Step 8: Verify tests + typecheck**

Run: `cd nova-mac && npm run test && npx tsc --noEmit`
Expected: PASS; zero type errors.

- [ ] **Step 9: Commit**

```bash
git add nova-mac/electron/voice/tts.ts nova-mac/electron/voice/voice-mode.ts \
  nova-mac/electron/voice/tts.test.ts nova-mac/electron/voice/voice-mode.test.ts \
  nova-mac/electron/ipc.ts nova-mac/electron/preload.ts nova-mac/src/lib/ipc.ts nova-mac/electron/main.ts
git commit -m "feat(mac): TTS bridge (OpenAI+Deepgram) + VoiceMode/LiveVoiceProvider seam"
```

---

### Task 8: Minimal Anthropic streaming chat in main (IPC stream events)

**Files:**
- Create: `nova-mac/electron/chat.ts`
- Modify: `nova-mac/electron/ipc.ts`, `nova-mac/electron/preload.ts`, `nova-mac/src/lib/ipc.ts`, `nova-mac/electron/main.ts`, `nova-mac/package.json`
- Test: `nova-mac/electron/chat.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `ChatSendRequest`, `IpcChannel` (`@shared/types`).
- Produces:
  - `buildAnthropicMessages(messages: ChatMessage[]): { role: "user" | "assistant"; content: string }[]` — trims empties, coalesces consecutive same-role turns.
  - `streamChat(req: ChatSendRequest, emit: (channel: IpcChannel, payload: unknown) => void, signal: AbortSignal): Promise<void>` — streams `ChatDelta`, then `ChatDone`, or `ChatError`.
  - `cancelChat(requestId: string): void`.
  - One-way IPC: renderer `nova.chatSend(req)`, `nova.chatCancel(requestId)`; `nova.onChatDelta/onChatDone/onChatError(cb): () => void`.

- [ ] **Step 1: Add the Anthropic SDK to `package.json` dependencies**

```json
    "@anthropic-ai/sdk": "^0.105.0"
```
Run: `cd nova-mac && npm install`

- [ ] **Step 2: Write the failing test for message building (pure)**

`electron/chat.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { buildAnthropicMessages } from "./chat";

describe("buildAnthropicMessages", () => {
  it("drops empty-content messages", () => {
    const out = buildAnthropicMessages([
      { role: "user", content: "hi" },
      { role: "assistant", content: "   " },
    ]);
    expect(out).toEqual([{ role: "user", content: "hi" }]);
  });

  it("coalesces consecutive same-role turns", () => {
    const out = buildAnthropicMessages([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
    expect(out).toEqual([{ role: "user", content: "a\nb" }]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd nova-mac && npm run test -- chat`
Expected: FAIL — `Cannot find module './chat'`.

- [ ] **Step 4: Create `electron/chat.ts`**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { IpcChannel, type ChatMessage, type ChatSendRequest } from "@shared/types";

const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL_LIGHT?.trim() || "claude-haiku-4-5";
const MAX_TOKENS = 1024;
const SYSTEM_PROMPT =
  "You are Nova, a concise, friendly voice assistant on the user's Mac. " +
  "Replies are spoken aloud, so keep them short and natural — usually 1–3 sentences.";

let anthropic: Anthropic | null = null;
function client(): Anthropic {
  if (!anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY");
    anthropic = new Anthropic({ apiKey });
  }
  return anthropic;
}

const inFlight = new Map<string, AbortController>();

/** Trim empties, coalesce consecutive same-role turns (Anthropic requires alternation tolerance). */
export function buildAnthropicMessages(
  messages: ChatMessage[],
): { role: "user" | "assistant"; content: string }[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of messages) {
    const content = m.content.trim();
    if (!content) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += "\n" + content;
    else out.push({ role: m.role, content });
  }
  return out;
}

export function cancelChat(requestId: string): void {
  inFlight.get(requestId)?.abort();
  inFlight.delete(requestId);
}

export async function streamChat(
  req: ChatSendRequest,
  emit: (channel: IpcChannel, payload: unknown) => void,
): Promise<void> {
  const controller = new AbortController();
  inFlight.set(req.requestId, controller);
  let text = "";
  try {
    const stream = client().messages.stream(
      {
        model: DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        messages: buildAnthropicMessages(req.messages),
      },
      { signal: controller.signal },
    );
    stream.on("text", (delta: string) => {
      text += delta;
      emit(IpcChannel.ChatDelta, { requestId: req.requestId, delta });
    });
    await stream.finalMessage();
    emit(IpcChannel.ChatDone, { requestId: req.requestId, text });
  } catch (err) {
    emit(IpcChannel.ChatError, {
      requestId: req.requestId,
      message: err instanceof Error ? err.message : "Chat failed",
    });
  } finally {
    inFlight.delete(req.requestId);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd nova-mac && npm run test -- chat`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire one-way IPC in `ipc.ts`**

Chat is event-streamed, not request/response, so register `.on` listeners rather than `.handle`. Add a second registration helper in `ipc.ts` (keep `registerIpcHandlers` for invoke channels):
```ts
import { ipcMain, type WebContents } from "electron";
// …existing imports…

export interface ChatBridge {
  start(req: import("@shared/types").ChatSendRequest, sender: WebContents): void;
  cancel(requestId: string): void;
}

export function registerChatBridge(bridge: ChatBridge): void {
  ipcMain.on(IpcChannel.ChatSend, (e, req) => bridge.start(req, e.sender));
  ipcMain.on(IpcChannel.ChatCancel, (_e, requestId: string) => bridge.cancel(requestId));
}
```

- [ ] **Step 7: Expose chat in `preload.ts` and `src/lib/ipc.ts`**

`preload.ts` — add inside `exposeInMainWorld` (events return an unsubscribe fn, matching Plan 1's `onAuthChanged` fix):
```ts
  chatSend: (req: unknown) => ipcRenderer.send(IpcChannel.ChatSend, req),
  chatCancel: (requestId: string) => ipcRenderer.send(IpcChannel.ChatCancel, requestId),
  onChatDelta: (cb: (p: unknown) => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.ChatDelta, h);
    return () => ipcRenderer.removeListener(IpcChannel.ChatDelta, h);
  },
  onChatDone: (cb: (p: unknown) => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.ChatDone, h);
    return () => ipcRenderer.removeListener(IpcChannel.ChatDone, h);
  },
  onChatError: (cb: (p: unknown) => void) => {
    const h = (_e: Electron.IpcRendererEvent, p: unknown) => cb(p);
    ipcRenderer.on(IpcChannel.ChatError, h);
    return () => ipcRenderer.removeListener(IpcChannel.ChatError, h);
  },
```
`src/lib/ipc.ts` — add to `NovaBridge`:
```ts
  chatSend(req: import("@shared/types").ChatSendRequest): void;
  chatCancel(requestId: string): void;
  onChatDelta(cb: (p: import("@shared/types").ChatStreamDelta) => void): () => void;
  onChatDone(cb: (p: import("@shared/types").ChatStreamDone) => void): () => void;
  onChatError(cb: (p: import("@shared/types").ChatStreamError) => void): () => void;
```

- [ ] **Step 8: Wire the chat bridge in `main.ts`**

Add the import and register after `registerIpcHandlers(...)`:
```ts
import { registerChatBridge } from "./ipc";
import { streamChat, cancelChat } from "./chat";
// …inside whenReady, after registerIpcHandlers:
registerChatBridge({
  start: (req, sender) =>
    void streamChat(req, (channel, payload) => sender.send(channel, payload)),
  cancel: cancelChat,
});
```

- [ ] **Step 9: Verify tests + typecheck**

Run: `cd nova-mac && npm run test && npx tsc --noEmit`
Expected: PASS; zero type errors.

- [ ] **Step 10: Manual stream verification (devtools console)**

Run `cd nova-mac && npm run dev` (signed in). In the renderer devtools console:
```js
nova.onChatDelta(p => console.log("delta", p.delta));
nova.onChatDone(p => console.log("done", p.text));
nova.chatSend({ requestId: "t1", messages: [{ role: "user", content: "Say hi in five words." }] });
```
Expected: deltas log incrementally, then a final `done` with the full text — confirming end-to-end streaming from the real Anthropic API (requires `ANTHROPIC_API_KEY` in `.env`).

- [ ] **Step 11: Commit**

```bash
git add nova-mac/electron/chat.ts nova-mac/electron/chat.test.ts nova-mac/electron/ipc.ts \
  nova-mac/electron/preload.ts nova-mac/src/lib/ipc.ts nova-mac/electron/main.ts \
  nova-mac/package.json nova-mac/package-lock.json
git commit -m "feat(mac): minimal Anthropic streaming chat over IPC (haiku default)"
```

---

### Task 9: Renderer voice runtime port (mic, recorder, barge-in, player via IPC)

**Files:**
- Create: `nova-mac/src/voice/mic-analyser.ts`, `nova-mac/src/voice/mic-session.ts`, `nova-mac/src/voice/recorder.ts`, `nova-mac/src/voice/tts-barge-in.ts`, `nova-mac/src/voice/player.ts`

**Interfaces:**
- Consumes: `SpeechGate`/constants (Task 5), `SentenceBuffer` (Task 5), `prepareSpeechChunks` (Task 5), `nova().synthesize` (Task 7).
- Produces (ports, same public shapes as the web app):
  - `mic-analyser.ts`: `MIC_CONSTRAINTS`, `openMicStream()`, `class MicAnalyser`.
  - `mic-session.ts`: `class MicSession`.
  - `recorder.ts`: `class VoiceRecorder` + its handler interfaces.
  - `tts-barge-in.ts`: `class TtsBargeInListener`, `ttsBargeInConfigFromSensitivity`.
  - `player.ts`: `class VoicePlayer` — adapted so TTS goes through IPC (`nova().synthesize`) instead of `fetch('/api/voice/synthesize')`.

- [ ] **Step 1: Copy the web-audio ports, fixing `@/` imports to relative**

Copy these from `lib/voice/` into `nova-mac/src/voice/`, rewriting any `@/lib/voice/...` import to a relative `./...` path:
- `mic-analyser.ts` (no app imports — copy verbatim)
- `mic-session.ts` (imports `openMicStream` from `./mic-analyser`)
- `tts-barge-in.ts` (imports `MicAnalyser` from `./mic-analyser`)
- `recorder.ts` (rewrite its `@/lib/voice/...` imports to `./...`)

- [ ] **Step 2: Open `audio-unlock` dependency for the player**

`player.ts` imports `ensureAudioPlaybackUnlocked` from `@/lib/voice/audio-unlock`. Copy `lib/voice/audio-unlock.ts` → `nova-mac/src/voice/audio-unlock.ts` (verify it has no app imports; rewrite if any) so the player port resolves.

- [ ] **Step 3: Port `player.ts`, replacing the fetch-based synth with IPC**

Copy `lib/voice/player.ts` → `nova-mac/src/voice/player.ts`. Rewrite imports:
- `@/lib/voice/audio-unlock` → `./audio-unlock`
- `@/lib/voice/sentence-buffer` → `./sentence-buffer`
- `@/lib/voice/tts-text` → `./tts-text`
- Remove the `import { synthesizeChunk } from "@/lib/voice/tts";` line.

Then add a local `synthesizeChunk` that calls IPC and returns a `Blob` (the rest of `VoicePlayer` consumes a `Blob`/`ArrayBuffer` exactly as before):
```ts
import { nova } from "../lib/ipc";
import type { VoicePlayerOptions } from "./player"; // (self-type; or inline the option fields)

async function synthesizeChunk(text: string, options: {
  voice: string; speed: number; hd?: boolean;
  provider?: import("@shared/types").TtsProvider; deepgramTtsVoice?: string;
}): Promise<Blob> {
  const provider = options.provider ?? "openai";
  const voice = provider === "deepgram"
    ? (options.deepgramTtsVoice ?? "aura-asteria-en")
    : options.voice;
  const { audioBase64 } = await nova().synthesize({
    text, voice, speed: options.speed, hd: provider === "openai" ? options.hd === true : undefined,
    provider,
  });
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "audio/mpeg" });
}
```
> Keep `VoicePlayer`'s decode/scheduling logic unchanged — only the source of the audio `Blob` moved from HTTP to IPC. If the ported `VoicePlayer` referenced `synthesizeChunk` with the old options object, confirm the call sites still pass `voice/speed/hd/provider/deepgramTtsVoice`.

- [ ] **Step 4: Verify the ports typecheck (no React/Web-Audio unit tests here)**

Run: `cd nova-mac && npx tsc --noEmit`
Expected: zero errors. (These modules use `MediaStream`, `AudioContext`, `MediaRecorder`, `atob` — all present in the renderer's Chromium + DOM lib. Ensure `tsconfig` includes `"dom"` in `lib`; if missing, add `"lib": ["ES2022", "DOM", "DOM.Iterable"]` to `compilerOptions`.)

- [ ] **Step 5: Smoke-test playback from devtools (manual)**

Run `cd nova-mac && npm run dev` (signed in). In the renderer console:
```js
const { VoicePlayer } = await import("/src/voice/player.ts");
const p = new VoicePlayer();
const s = p.startStreaming?.({ voice: "coral", speed: 1.1, hd: true, provider: "openai" })
  ?? p; // depending on the ported API surface
```
Expected: feeding a sentence triggers `nova.synthesize` (Network/main logs) and audio plays through the speakers. (Exact call surface depends on the ported `VoicePlayer` API; the goal is to confirm IPC→audio works.)

- [ ] **Step 6: Commit**

```bash
git add nova-mac/src/voice/mic-analyser.ts nova-mac/src/voice/mic-session.ts \
  nova-mac/src/voice/recorder.ts nova-mac/src/voice/tts-barge-in.ts \
  nova-mac/src/voice/audio-unlock.ts nova-mac/src/voice/player.ts nova-mac/tsconfig.json
git commit -m "feat(mac): port renderer voice runtime (mic, recorder, barge-in, IPC player)"
```

---

### Task 10: Wake-word framing (pure ring-buffer + mel/embedding windowing)

**Files:**
- Create: `nova-mac/electron/wakeword/framing.ts`
- Test: `nova-mac/electron/wakeword/framing.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `const SAMPLES_PER_FRAME = 1280` (80 ms @ 16 kHz), `const MEL_FRAMES_PER_EMBEDDING = 76`, `const EMBEDDINGS_PER_PREDICTION = 16`, `const MEL_BINS = 32`.
  - `class AudioRingBuffer` — accumulates Int16 frames into Float32 windows.
    - `pushInt16(frame: Int16Array): void`
    - `take(n: number): Float32Array | null` — returns the oldest `n` samples once available and advances by `hop`, else null.
  - `class WindowAccumulator<T>` — fixed-size sliding window of vectors:
    - `push(vec: Float32Array): Float32Array | null` — returns a flattened window of the last `size` vectors once full.

- [ ] **Step 1: Write the failing test**

`electron/wakeword/framing.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import {
  AudioRingBuffer, WindowAccumulator, SAMPLES_PER_FRAME, MEL_BINS, MEL_FRAMES_PER_EMBEDDING,
} from "./framing";

describe("constants", () => {
  it("matches openWakeWord's expected dimensions", () => {
    expect(SAMPLES_PER_FRAME).toBe(1280);
    expect(MEL_BINS).toBe(32);
    expect(MEL_FRAMES_PER_EMBEDDING).toBe(76);
  });
});

describe("AudioRingBuffer", () => {
  it("normalizes Int16 to Float32 [-1,1] and yields exactly the requested window", () => {
    const ring = new AudioRingBuffer();
    const frame = new Int16Array(SAMPLES_PER_FRAME).fill(16384); // 0.5 of full scale
    expect(ring.take(SAMPLES_PER_FRAME)).toBeNull(); // nothing pushed yet
    ring.pushInt16(frame);
    const win = ring.take(SAMPLES_PER_FRAME);
    expect(win).not.toBeNull();
    expect(win!.length).toBe(SAMPLES_PER_FRAME);
    expect(win![0]).toBeCloseTo(0.5, 2);
  });
});

describe("WindowAccumulator", () => {
  it("returns a flattened window only once `size` vectors have arrived", () => {
    const acc = new WindowAccumulator(3, 2); // size=3 vectors, each width 2
    expect(acc.push(Float32Array.from([1, 1]))).toBeNull();
    expect(acc.push(Float32Array.from([2, 2]))).toBeNull();
    const out = acc.push(Float32Array.from([3, 3]));
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual([1, 1, 2, 2, 3, 3]);
    // slides by one on the next push
    const out2 = acc.push(Float32Array.from([4, 4]));
    expect(Array.from(out2!)).toEqual([2, 2, 3, 3, 4, 4]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd nova-mac && npm run test -- framing`
Expected: FAIL — `Cannot find module './framing'`.

- [ ] **Step 3: Implement `electron/wakeword/framing.ts`**

```ts
// openWakeWord streaming dimensions (the melspectrogram/embedding/wakeword ONNX pipeline).
export const SAMPLES_PER_FRAME = 1280;        // 80 ms @ 16 kHz
export const MEL_BINS = 32;                    // melspectrogram output bins
export const MEL_FRAMES_PER_EMBEDDING = 76;    // embedding model input frames
export const EMBEDDINGS_PER_PREDICTION = 16;   // wakeword model input embeddings

/** Accumulates Int16 frames; hands out Float32 windows normalized to [-1, 1]. */
export class AudioRingBuffer {
  private buf: number[] = [];

  pushInt16(frame: Int16Array): void {
    for (let i = 0; i < frame.length; i++) this.buf.push(frame[i]! / 32768);
  }

  /** Returns the oldest `n` samples and consumes them, or null if not enough buffered. */
  take(n: number): Float32Array | null {
    if (this.buf.length < n) return null;
    const out = Float32Array.from(this.buf.slice(0, n));
    this.buf = this.buf.slice(n);
    return out;
  }

  available(): number {
    return this.buf.length;
  }
}

/** Fixed-size sliding window of equal-width vectors, flattened on output. */
export class WindowAccumulator {
  private readonly frames: Float32Array[] = [];

  constructor(private readonly size: number, private readonly width: number) {}

  push(vec: Float32Array): Float32Array | null {
    if (vec.length !== this.width) {
      throw new Error(`expected width ${this.width}, got ${vec.length}`);
    }
    this.frames.push(vec);
    if (this.frames.length > this.size) this.frames.shift();
    if (this.frames.length < this.size) return null;
    const out = new Float32Array(this.size * this.width);
    for (let i = 0; i < this.size; i++) out.set(this.frames[i]!, i * this.width);
    return out;
  }

  reset(): void {
    this.frames.length = 0;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd nova-mac && npm run test -- framing`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add nova-mac/electron/wakeword/framing.ts nova-mac/electron/wakeword/framing.test.ts
git commit -m "feat(mac): wake-word audio framing + sliding window (pure, unit-tested)"
```

---

### Task 11: Wake-word engine (onnxruntime-node worker) + 16 kHz mic capture + detection

**Files:**
- Create: `nova-mac/electron/wakeword/engine.ts`, `nova-mac/electron/wakeword/worker.ts`, `nova-mac/electron/wakeword/index.ts`, `nova-mac/src/voice/wake-capture.ts`, `nova-mac/scripts/download-wake-models.mjs`
- Create (downloaded): `nova-mac/electron/wakeword/models/{melspectrogram,embedding_model,hey_jarvis_v0.1}.onnx`
- Modify: `nova-mac/electron/ipc.ts` (frame `.on` + wake enable), `nova-mac/electron/preload.ts`, `nova-mac/src/lib/ipc.ts`, `nova-mac/electron/main.ts`, `nova-mac/package.json` (`onnxruntime-node`), `nova-mac/electron-builder.json` (bundle models), `nova-mac/.gitignore` (ignore downloaded models)

**Interfaces:**
- Consumes: `AudioRingBuffer`, `WindowAccumulator`, framing constants (Task 10); `WakeFrame`, `IpcChannel` (`@shared/types`).
- Produces:
  - `engine.ts`: `class WakeWordEngine { constructor(modelsDir: string); init(): Promise<void>; process(frame: Int16Array): Promise<number | null> }` — returns a wake score (0..1) when a full prediction window is ready, else null.
  - `worker.ts`: a `worker_thread` that loads the engine and posts `{ score }` per frame.
  - `index.ts`: `class WakeWordController { start(onWake: () => void): void; pushFrame(buf: ArrayBuffer): void; setEnabled(on: boolean): void; pauseForTurn(): void; resume(): void }` — debounce + re-arm + threshold.
  - `wake-capture.ts` (renderer): `startWakeCapture(stream: MediaStream, send: (buf: ArrayBuffer) => void): () => void` — 16 kHz Int16 frames of `SAMPLES_PER_FRAME`.

- [ ] **Step 1: Add `onnxruntime-node` to `package.json` dependencies**

```json
    "onnxruntime-node": "^1.20.0"
```
Run: `cd nova-mac && npm install`

- [ ] **Step 2: Create the model download script `scripts/download-wake-models.mjs`**

These are the verified openWakeWord v0.5.1 ONNX release assets:
```js
import { mkdirSync, createWriteStream, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "..", "electron", "wakeword", "models");
mkdirSync(dir, { recursive: true });

const BASE = "https://github.com/dscripka/openWakeWord/releases/download/v0.5.1";
const files = ["melspectrogram.onnx", "embedding_model.onnx", "hey_jarvis_v0.1.onnx"];

for (const f of files) {
  const dest = join(dir, f);
  if (existsSync(dest)) { console.log("exists", f); continue; }
  const res = await fetch(`${BASE}/${f}`);
  if (!res.ok || !res.body) throw new Error(`download failed for ${f}: ${res.status}`);
  await pipeline(res.body, createWriteStream(dest));
  console.log("downloaded", f);
}
```
Add to `package.json` scripts: `"wake:models": "node scripts/download-wake-models.mjs"`.
Run: `cd nova-mac && npm run wake:models`
Expected: three files appear in `electron/wakeword/models/` (~1.1 MB, ~1.3 MB, ~1.3 MB).

- [ ] **Step 3: Ignore the downloaded models in `.gitignore`**

Add to `nova-mac/.gitignore`:
```
electron/wakeword/models/*.onnx
```
(They are fetched at setup/CI time via `npm run wake:models`; the script is committed, the binaries are not.)

- [ ] **Step 4: Implement `electron/wakeword/engine.ts`**

The melspectrogram model maps raw audio → mel frames; openWakeWord applies the `mel/10 + 2` transform. The embedding model maps 76×32 mel frames → a 96-d embedding; the wakeword model maps 16×96 embeddings → a score. Read input/output names from each session so we do not hardcode them.
```ts
import * as ort from "onnxruntime-node";
import { join } from "node:path";
import {
  AudioRingBuffer, WindowAccumulator,
  SAMPLES_PER_FRAME, MEL_BINS, MEL_FRAMES_PER_EMBEDDING, EMBEDDINGS_PER_PREDICTION,
} from "./framing";

export class WakeWordEngine {
  private mel!: ort.InferenceSession;
  private embed!: ort.InferenceSession;
  private wake!: ort.InferenceSession;
  private ring = new AudioRingBuffer();
  private melWindow = new WindowAccumulator(MEL_FRAMES_PER_EMBEDDING, MEL_BINS);
  private embWindow = new WindowAccumulator(EMBEDDINGS_PER_PREDICTION, 96);

  constructor(private readonly modelsDir: string) {}

  async init(): Promise<void> {
    this.mel = await ort.InferenceSession.create(join(this.modelsDir, "melspectrogram.onnx"));
    this.embed = await ort.InferenceSession.create(join(this.modelsDir, "embedding_model.onnx"));
    this.wake = await ort.InferenceSession.create(join(this.modelsDir, "hey_jarvis_v0.1.onnx"));
  }

  /** Push one ~80ms Int16 frame; returns a wake score when a full window is ready. */
  async process(frame: Int16Array): Promise<number | null> {
    this.ring.pushInt16(frame);
    const samples = this.ring.take(SAMPLES_PER_FRAME);
    if (!samples) return null;

    // 1) raw audio → mel frames (shape [1, N] → [1, melFrames, MEL_BINS])
    const melIn = new ort.Tensor("float32", samples, [1, samples.length]);
    const melOut = await this.mel.run({ [this.mel.inputNames[0]!]: melIn });
    const melTensor = melOut[this.mel.outputNames[0]!]!;
    const melData = melTensor.data as Float32Array;
    const melFrames = melData.length / MEL_BINS;

    let lastScore: number | null = null;
    for (let f = 0; f < melFrames; f++) {
      const row = new Float32Array(MEL_BINS);
      for (let b = 0; b < MEL_BINS; b++) row[b] = melData[f * MEL_BINS + b]! / 10 + 2;
      const melWin = this.melWindow.push(row);
      if (!melWin) continue;

      // 2) 76×32 mel window → 96-d embedding
      const embIn = new ort.Tensor("float32", melWin, [1, MEL_FRAMES_PER_EMBEDDING, MEL_BINS, 1]);
      const embOut = await this.embed.run({ [this.embed.inputNames[0]!]: embIn });
      const emb = Float32Array.from((embOut[this.embed.outputNames[0]!]!.data as Float32Array));
      const embWin = this.embWindow.push(emb);
      if (!embWin) continue;

      // 3) 16×96 embeddings → wake score
      const wakeIn = new ort.Tensor("float32", embWin, [1, EMBEDDINGS_PER_PREDICTION, 96]);
      const wakeOut = await this.wake.run({ [this.wake.inputNames[0]!]: wakeIn });
      lastScore = (wakeOut[this.wake.outputNames[0]!]!.data as Float32Array)[0]!;
    }
    return lastScore;
  }
}
```
> If `init()` or `process()` throws a shape error at runtime, the input/output names are read dynamically (`inputNames[0]`) so only the tensor *shapes* above may need adjusting to the actual model metadata — verify against the launch test in Step 11.

- [ ] **Step 5: Implement the worker `electron/wakeword/worker.ts`**

```ts
import { parentPort, workerData } from "node:worker_threads";
import { WakeWordEngine } from "./engine";

const engine = new WakeWordEngine(workerData.modelsDir as string);
let ready = false;
engine.init().then(() => { ready = true; parentPort?.postMessage({ type: "ready" }); });

parentPort?.on("message", async (msg: { type: "frame"; buf: ArrayBuffer }) => {
  if (msg.type !== "frame" || !ready) return;
  const frame = new Int16Array(msg.buf);
  const score = await engine.process(frame);
  if (score != null) parentPort?.postMessage({ type: "score", score });
});
```

- [ ] **Step 6: Implement the controller `electron/wakeword/index.ts`**

```ts
import { Worker } from "node:worker_threads";
import { join } from "node:path";

const DEBOUNCE_MS = 2000;

export class WakeWordController {
  private worker: Worker | null = null;
  private enabled = true;
  private pausedForTurn = false;
  private lastFireAt = 0;
  private armed = true; // require score to drop below threshold before re-firing
  private onWake: (() => void) | null = null;

  constructor(
    private readonly modelsDir = join(import.meta.dirname, "models"),
    private readonly threshold = 0.5,
  ) {}

  start(onWake: () => void): void {
    this.onWake = onWake;
    this.worker = new Worker(join(import.meta.dirname, "worker.js"), {
      workerData: { modelsDir: this.modelsDir },
    });
    this.worker.on("message", (msg: { type: string; score?: number }) => {
      if (msg.type !== "score" || msg.score == null) return;
      this.handleScore(msg.score);
    });
    this.worker.on("error", (e) => console.error("[nova] wake worker error", e));
  }

  private handleScore(score: number): void {
    if (!this.enabled || this.pausedForTurn) return;
    if (score < this.threshold) { this.armed = true; return; }
    const now = Date.now();
    if (this.armed && now - this.lastFireAt >= DEBOUNCE_MS) {
      this.armed = false;
      this.lastFireAt = now;
      this.onWake?.();
    }
  }

  pushFrame(buf: ArrayBuffer): void {
    if (!this.enabled || this.pausedForTurn) return;
    this.worker?.postMessage({ type: "frame", buf }, [buf]);
  }

  setEnabled(on: boolean): void { this.enabled = on; }
  pauseForTurn(): void { this.pausedForTurn = true; }
  resume(): void { this.pausedForTurn = false; this.armed = true; }
}
```

- [ ] **Step 7: Implement the renderer capture `src/voice/wake-capture.ts`**

Use an AudioContext pinned to 16 kHz so Chromium resamples the mic for us; a `ScriptProcessorNode` collects `SAMPLES_PER_FRAME` Int16 samples per frame.
```ts
import { SAMPLES_PER_FRAME } from "@shared/wake-constants";

/** Starts 16 kHz Int16 framing from a mic stream; returns a stop fn. */
export function startWakeCapture(
  stream: MediaStream,
  send: (buf: ArrayBuffer) => void,
): () => void {
  const ctx = new AudioContext({ sampleRate: 16000 });
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(4096, 1, 0);
  let acc: number[] = [];

  node.onaudioprocess = (e) => {
    const input = e.inputBuffer.getChannelData(0);
    for (let i = 0; i < input.length; i++) acc.push(input[i]!);
    while (acc.length >= SAMPLES_PER_FRAME) {
      const chunk = acc.slice(0, SAMPLES_PER_FRAME);
      acc = acc.slice(SAMPLES_PER_FRAME);
      const i16 = new Int16Array(SAMPLES_PER_FRAME);
      for (let i = 0; i < SAMPLES_PER_FRAME; i++) {
        const s = Math.max(-1, Math.min(1, chunk[i]!));
        i16[i] = s < 0 ? s * 32768 : s * 32767;
      }
      send(i16.buffer);
    }
  };

  source.connect(node);
  node.connect(ctx.destination);
  return () => { node.disconnect(); source.disconnect(); void ctx.close(); };
}
```
> `SAMPLES_PER_FRAME` is shared between main (`framing.ts`) and renderer. To avoid importing main code into the renderer, add `nova-mac/shared/wake-constants.ts` exporting `export const SAMPLES_PER_FRAME = 1280;` and have `electron/wakeword/framing.ts` re-export it (`export { SAMPLES_PER_FRAME } from "@shared/wake-constants";`) so there is one source of truth. Update Task 10's import accordingly when implementing this task.

- [ ] **Step 8: Add wake IPC (one-way frame + enable) to `ipc.ts`**

Extend the chat-style one-way bridge (or add a `registerWakeBridge`):
```ts
export interface WakeBridge {
  pushFrame(buf: ArrayBuffer): void;
  setEnabled(on: boolean): void;
}
export function registerWakeBridge(bridge: WakeBridge): void {
  ipcMain.on(IpcChannel.WakeAudioFrame, (_e, buf: ArrayBuffer) => bridge.pushFrame(buf));
  ipcMain.on(IpcChannel.WakeSetEnabled, (_e, on: boolean) => bridge.setEnabled(on));
}
```

- [ ] **Step 9: Expose wake in `preload.ts` + `src/lib/ipc.ts`**

`preload.ts` — inside `exposeInMainWorld`:
```ts
  sendWakeFrame: (buf: ArrayBuffer) => ipcRenderer.send(IpcChannel.WakeAudioFrame, buf),
  setWakeEnabled: (on: boolean) => ipcRenderer.send(IpcChannel.WakeSetEnabled, on),
  onWakeDetected: (cb: () => void) => {
    const h = () => cb();
    ipcRenderer.on(IpcChannel.WakeDetected, h);
    return () => ipcRenderer.removeListener(IpcChannel.WakeDetected, h);
  },
```
`src/lib/ipc.ts` — add to `NovaBridge`:
```ts
  sendWakeFrame(buf: ArrayBuffer): void;
  setWakeEnabled(on: boolean): void;
  onWakeDetected(cb: () => void): () => void;
```

- [ ] **Step 10: Wire the controller in `main.ts`**

```ts
import { registerWakeBridge } from "./ipc";
import { WakeWordController } from "./wakeword/index";
// …inside whenReady, after the chat bridge:
const wake = new WakeWordController();
wake.start(() => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(IpcChannel.WakeDetected);
});
registerWakeBridge({
  pushFrame: (buf) => wake.pushFrame(buf),
  setEnabled: (on) => wake.setEnabled(on),
});
// expose pause/resume to the turn lifecycle (Task 12 calls these via voice:turnEnded):
// store `wake` where the VoiceTurnEnded handler can reach it.
```
Also handle `VoiceTurnEnded` (registered as a one-way `ipcMain.on`) to call `wake.resume()`, and call `wake.pauseForTurn()` when `WakeDetected` fires (before sending the event) so frames during a turn are ignored.

- [ ] **Step 11: Bundle models in `electron-builder.json`**

Ensure packaged builds include the models and keep `.onnx`/`.node` unpacked:
```json
  "files": ["out/**", "build/**", "package.json"],
  "extraResources": [{ "from": "electron/wakeword/models", "to": "wakeword-models" }],
  "asarUnpack": ["**/*.node"]
```
> In packaged mode, `WakeWordController`'s `modelsDir` must resolve to `process.resourcesPath/wakeword-models`. Pass that path in `main.ts` when `app.isPackaged`, else the dev `electron/wakeword/models` dir.

- [ ] **Step 12: Build + typecheck + launch wake test**

Run: `cd nova-mac && npm run test && npx tsc --noEmit && npm run dev`
Expected (manual): grant mic permission; with the orb dormant, say **"Hey Jarvis"**. The main-process terminal logs the worker `ready`, and within ~1–2s of the phrase the renderer receives `wake:detected` (log it temporarily in the console). Background noise/normal speech should not trigger it. If the score never crosses 0.5, verify the engine tensor shapes (Step 4 note) and that models downloaded (Step 2).

- [ ] **Step 13: Commit**

```bash
git add nova-mac/electron/wakeword/engine.ts nova-mac/electron/wakeword/worker.ts \
  nova-mac/electron/wakeword/index.ts nova-mac/electron/wakeword/framing.ts \
  nova-mac/shared/wake-constants.ts nova-mac/src/voice/wake-capture.ts \
  nova-mac/scripts/download-wake-models.mjs nova-mac/electron/ipc.ts \
  nova-mac/electron/preload.ts nova-mac/src/lib/ipc.ts nova-mac/electron/main.ts \
  nova-mac/electron-builder.json nova-mac/package.json nova-mac/package-lock.json nova-mac/.gitignore
git commit -m "feat(mac): on-device 'Hey Jarvis' wake word (onnxruntime worker + 16kHz capture)"
```

---

### Task 12: Wire the full voice loop (useVoice) — wake → speak → reply → TTS → barge-in → re-arm

**Files:**
- Create: `nova-mac/src/hooks/useVoice.ts`
- Modify: `nova-mac/src/App.tsx` (replace the dev `OrbHarness` body with the `useVoice`-driven loop), `nova-mac/electron/preload.ts` + `src/lib/ipc.ts` (expose `voiceTurnEnded`, `getVoicePreferences`), `nova-mac/electron/ipc.ts` + `main.ts` (`VoiceGetPreferences` handler + `VoiceTurnEnded` listener), `nova-mac/electron/voice/preferences.ts`

**Interfaces:**
- Consumes: `useOrb`/`orbReducer` (Tasks 2–3), `MicSession`/`VoiceRecorder`/`TtsBargeInListener`/`VoicePlayer`/`SpeechGate` (Tasks 5, 9), `startWakeCapture` (Task 11), all IPC bridges (Tasks 6–8, 11), `DEFAULT_VOICE_PREFERENCES` (Task 1).
- Produces:
  - `electron/voice/preferences.ts`: `getVoicePreferences(): Promise<VoicePreferences>` — reads `user_preferences` for the signed-in user; merges over `DEFAULT_VOICE_PREFERENCES`.
  - `useVoice(): { state: OrbState; level: number }` — the orchestrated loop, driving the orb and owning the single mic stream.

- [ ] **Step 1: Create `electron/voice/preferences.ts`**

```ts
import { getSupabase } from "../supabase";
import { DEFAULT_VOICE_PREFERENCES, type VoicePreferences } from "@shared/types";

export async function getVoicePreferences(): Promise<VoicePreferences> {
  try {
    const { data } = await getSupabase()
      .from("user_preferences")
      .select("voice")
      .maybeSingle();
    const stored = (data?.voice ?? {}) as Partial<VoicePreferences>;
    return { ...DEFAULT_VOICE_PREFERENCES, ...stored };
  } catch {
    return DEFAULT_VOICE_PREFERENCES;
  }
}
```
> The web app stores voice prefs in `user_preferences`; the exact column name may differ. If `voice` is not the column, adjust the `.select(...)` to the actual JSONB column. Falling back to defaults keeps the loop working regardless.

- [ ] **Step 2: Add the prefs + turn-ended IPC**

`ipc.ts` — add to `IpcHandlers`:
```ts
  getVoicePreferences(): Promise<import("@shared/types").VoicePreferences>;
```
and to the body:
```ts
  ipcMain.handle(IpcChannel.VoiceGetPreferences, () => handlers.getVoicePreferences());
```
Add a one-way listener in `registerWakeBridge` (or a small dedicated registration) for turn end:
```ts
  ipcMain.on(IpcChannel.VoiceTurnEnded, () => bridge.resume());
```
and extend `WakeBridge` with `resume(): void`. Wire `resume: () => wake.resume()` in `main.ts`, and `getVoicePreferences` in the `registerIpcHandlers({...})` object:
```ts
  getVoicePreferences: () => import("./voice/preferences").then((m) => m.getVoicePreferences()),
```
`preload.ts` — inside `exposeInMainWorld`:
```ts
  getVoicePreferences: () => ipcRenderer.invoke(IpcChannel.VoiceGetPreferences),
  voiceTurnEnded: () => ipcRenderer.send(IpcChannel.VoiceTurnEnded),
```
`src/lib/ipc.ts` — add to `NovaBridge`:
```ts
  getVoicePreferences(): Promise<import("@shared/types").VoicePreferences>;
  voiceTurnEnded(): void;
```

- [ ] **Step 3: Implement `src/hooks/useVoice.ts` (the orchestrator)**

This connects every piece. It owns ONE mic stream: while dormant, it feeds `startWakeCapture`; on wake it records the command, transcribes, streams the reply (driving orb `responseDelta`), speaks it sentence-by-sentence via `VoicePlayer`, listens for barge-in during playback, and re-arms wake on turn end.
```tsx
import { useEffect, useReducer, useRef, useState } from "react";
import { orbReducer, INITIAL_ORB_STATE } from "../orb/orb-machine";
import { MicSession } from "../voice/mic-session";
import { VoiceRecorder } from "../voice/recorder";
import { TtsBargeInListener, ttsBargeInConfigFromSensitivity } from "../voice/tts-barge-in";
import { VoicePlayer } from "../voice/player";
import { startWakeCapture } from "../voice/wake-capture";
import { nova } from "../lib/ipc";
import { DEFAULT_VOICE_PREFERENCES } from "@shared/types";

export function useVoice() {
  const [state, dispatch] = useReducer(orbReducer, INITIAL_ORB_STATE);
  const [level, setLevel] = useState(0);
  const mic = useRef(new MicSession());
  const player = useRef(new VoicePlayer());
  const prefs = useRef(DEFAULT_VOICE_PREFERENCES);
  const reqId = useRef(0);

  useEffect(() => {
    let stopWake: (() => void) | null = null;
    let cancelled = false;

    async function boot() {
      prefs.current = await nova().getVoicePreferences();
      const stream = await mic.current.acquire();
      // Feed wake-word framing while dormant.
      stopWake = startWakeCapture(stream, (buf) => nova().sendWakeFrame(buf));
    }
    void boot();

    const offWake = nova().onWakeDetected(() => { if (!cancelled) void runTurn(); });

    async function runTurn() {
      dispatch({ type: "summon" });
      const stream = await mic.current.acquire();

      // 1) Record the command until silence (reuses web recorder + VAD).
      const recorder = new VoiceRecorder();
      const audio = await new Promise<Blob>((resolve) => {
        recorder.start(stream, {
          silenceMs: prefs.current.silenceMs,
          onLevel: (l) => setLevel(l),
          onSilence: () => recorder.stop(),
          onStop: (blob) => resolve(blob),
        } as any); // handler shape per ported VoiceRecorderStartOptions
      });

      // 2) STT.
      const audioBase64 = await blobToBase64(audio);
      const transcript = await nova().transcribe(
        { audioBase64, mimeType: audio.type || "audio/webm" },
        prefs.current.sttProvider,
      );
      if (!transcript) { endTurn(); return; }
      dispatch({ type: "submit", transcript });

      // 3) Stream the reply → drive orb + sentence-by-sentence TTS.
      dispatch({ type: "responseStart" });
      const id = `turn-${++reqId.current}`;
      const speaker = player.current.startStreaming({
        voice: prefs.current.ttsVoice, speed: prefs.current.ttsSpeed,
        hd: prefs.current.ttsHd, provider: prefs.current.ttsProvider,
        deepgramTtsVoice: prefs.current.deepgramTtsVoice,
      });

      // Barge-in: interrupt playback when the user speaks over the reply.
      const barge = new TtsBargeInListener(
        ttsBargeInConfigFromSensitivity(prefs.current.bargeInSensitivity),
      );
      if (prefs.current.bargeInEnabled) {
        barge.start(stream, () => {
          player.current.stop();
          nova().chatCancel(id);
          dispatch({ type: "bargeIn" });
          void runTurn();
        });
      }

      const offDelta = nova().onChatDelta((p) => {
        if (p.requestId !== id) return;
        dispatch({ type: "responseDelta", delta: p.delta });
        if (prefs.current.spokenReplies) speaker.feed(p.delta);
      });
      const offDone = nova().onChatDone(async (p) => {
        if (p.requestId !== id) return;
        offDelta(); offDone();
        if (prefs.current.spokenReplies) await speaker.finish();
        barge.stop();
        dispatch({ type: "responseEnd" });
        endTurn();
      });
      const offErr = nova().onChatError((p) => {
        if (p.requestId !== id) return;
        offDelta(); offErr(); barge.stop();
        dispatch({ type: "error", message: p.message });
        endTurn();
      });

      nova().chatSend({ requestId: id, messages: [{ role: "user", content: transcript }] });
    }

    function endTurn() {
      setLevel(0);
      nova().voiceTurnEnded(); // main re-arms wake scoring
    }

    return () => {
      cancelled = true;
      offWake();
      stopWake?.();
      player.current.stop();
      mic.current.release();
    };
  }, []);

  return { state, level };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
  return btoa(bin);
}
```
> The exact method names on the ported `VoiceRecorder` and `VoicePlayer` (e.g. `start`/`stop`/`startStreaming`/`feed`/`finish`) must match what Task 9 produced. When implementing, read the ported files and align the calls; the contract is: record→Blob, then a streaming speaker with `feed(delta)` + `finish()` + `stop()`. Adjust the option/handler shapes to the ported `VoiceRecorderStartOptions` and `VoicePlayerOptions` rather than the `as any` placeholder.

- [ ] **Step 4: Replace the dev harness in `src/App.tsx` with the real loop**

Swap `OrbHarness`'s keyboard-driven body for `useVoice`, keeping the orb + chat sheet rendering:
```tsx
function VoiceApp({ email }: { email: string | null }) {
  const { state, level } = useVoice();
  const [sheetOpen, setSheetOpen] = useState(false);
  return (
    <>
      <div style={{ position: "fixed", top: 8, left: 8, fontSize: 10, opacity: 0.4 }}>{email}</div>
      <Orb
        state={state} level={level}
        onSummon={() => { /* click summon handled by wake/hotkey; optional manual trigger */ }}
        onStop={() => { /* Plan 3 computer-use stop */ }}
        onExpand={() => setSheetOpen(true)}
      />
      <ChatSheet
        open={sheetOpen}
        messages={state.transcript ? [
          { role: "user", content: state.transcript },
          { role: "assistant", content: state.responseText },
        ] : []}
        onClose={() => setSheetOpen(false)}
      />
    </>
  );
}
```
Keep the dev keyboard harness only if useful behind a `import.meta.env.DEV` guard; otherwise remove it. The signed-in branch now returns `<VoiceApp email={auth.email} />`.

- [ ] **Step 5: Verify tests + typecheck**

Run: `cd nova-mac && npm run test && npx tsc --noEmit`
Expected: all unit tests PASS; zero type errors.

- [ ] **Step 6: End-to-end launch verification**

Run: `cd nova-mac && npm run dev` (signed in, mic granted, `.env` has `ANTHROPIC_API_KEY` + `OPENAI_API_KEY`).
Expected (manual):
1. Dormant dot. Say **"Hey Jarvis"** → orb expands to Listening with a live waveform.
2. Ask a short question ("What's two plus two?") → ~1.5s after you stop, orb goes to Processing (shimmer), then Responding (breathing + frosted card with streaming text) and you **hear** the reply.
3. While it's speaking, talk over it → playback stops immediately and the orb returns to Listening (barge-in).
4. After the reply finishes, the orb returns to Dormant and "Hey Jarvis" works again (wake re-armed).
5. Clicking the response card raises the chat sheet showing the turn.

- [ ] **Step 7: Commit**

```bash
git add nova-mac/src/hooks/useVoice.ts nova-mac/src/App.tsx nova-mac/electron/voice/preferences.ts \
  nova-mac/electron/ipc.ts nova-mac/electron/preload.ts nova-mac/src/lib/ipc.ts nova-mac/electron/main.ts
git commit -m "feat(mac): end-to-end voice loop — Hey Jarvis → speak → streamed reply → TTS → barge-in"
```

---

## Self-Review

**Spec coverage (Plan 2 scope = §11 phases 3, 4, 5; §2 orb; §3 wake word; §3a voice pipeline):**
- §2 five orb states (dormant/listening/processing/responding/working) → Task 2 (reducer) + Task 3 (visuals) ✓
- §2 chat sheet (swipe-up secondary surface, plain macOS sheet) → Task 4 ✓
- §2 summon paths: "Hey Jarvis" → Tasks 11–12; global hotkey → Plan 1 Task 2 (already); click dormant dot → Task 3 `onSummon` ✓
- §3 openWakeWord via onnxruntime-node, three-model pipeline, framing port, debounce 2s + re-arm, threshold 0.5 → Tasks 10–11 ✓
- §3 in-process, no Python; worker thread for inference → Task 11 ✓
- §3a barge-in + VAD reuse (tts-barge-in, vad, mic-session, sentence-buffer, player) → Tasks 5, 9, 12 ✓
- §3a SttProvider/TtsProvider abstractions carried over (openai + deepgram live; google seam) → Tasks 6, 7 ✓
- §3a VoiceMode (`pipeline` now, `live` stubbed) + LiveVoiceProvider registry → Task 7 ✓
- §9 design language: glass recipe (orb/cards only), SF Pro stack, Apple springs, scale/opacity/blur transitions, radii 22–28 → Tasks 3, 4 ✓
- Default model claude-haiku-4-5, text-only streamer → Task 8 ✓

Deferred to later plans (correctly out of scope here): screen context capture (Plan 3, §4); chat tools + ported full system prompt + memory-write pipeline (Plan 3, §5–6); computer-use agent loop + WorkflowCard + real Stop wiring (Plan 3, §5); Google STT/TTS providers (seam left in Tasks 6–7); gated file cleanup + settings + wake-word settings UI + "test wake word" calibration (Plan 4, §6, §8); onboarding permission flow + auto-update (Plan 4, §8). The `working` orb state ships visually in Plan 2 but is driven by real computer-use only in Plan 3.

**Placeholder scan:** No "TBD"/"handle edge cases". Three spots defer concrete detail to *the ported source file's actual API*, by design, not as placeholders: Task 9 Step 3 (align `VoicePlayer`'s synth call sites), Task 12 Step 3 (align `VoiceRecorder`/`VoicePlayer` method names + replace the `as any`), and Task 12 Step 1 (confirm the `user_preferences` voice column). Each names exactly what to read and the contract to satisfy. Task 11 Step 4 flags that ONNX tensor *shapes* may need adjusting against real model metadata, with the launch test as the verification gate — this is honest de-risking of an external artifact, not an unfinished step.

**Type consistency:** `OrbStateName` (shared) ↔ `OrbState["name"]` (reducer) ↔ `SIZE` keys (Orb.tsx) are aligned. `IpcChannel` members added in Task 1 are consumed verbatim in Tasks 6–12. `ChatMessage`/`ChatSendRequest`/`ChatStreamDelta`/`ChatStreamDone`/`ChatStreamError` shapes are consistent across `chat.ts`, preload, `src/lib/ipc.ts`, and `useVoice.ts`. `SttProvider`/`TtsProvider` unions (shared) are used by `transcribe`/`synthesize` and prefs. `SynthesizeRequest`/`SynthesizeResult` match between `tts.ts`, the IPC layer, and the renderer player. `SAMPLES_PER_FRAME` has a single source of truth in `@shared/wake-constants` (Task 11 Step 7), consumed by both `framing.ts` (main) and `wake-capture.ts` (renderer). `VoicePreferences` field names (`silenceMs`, `ttsVoice`, `ttsSpeed`, `ttsHd`, `ttsProvider`, `bargeInSensitivity`, `bargeInEnabled`, `spokenReplies`, `sttProvider`, `deepgramTtsVoice`) match the ported type and every `useVoice` read site.
