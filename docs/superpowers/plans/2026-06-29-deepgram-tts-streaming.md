# Deepgram Aura TTS Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Deepgram Aura as a third selectable TTS provider with server-side streaming to eliminate audio buffering latency.

**Architecture:** The server pipes Deepgram's streaming HTTP response body directly to the Next.js response, skipping server-side buffering. The client reads the stream chunk-by-chunk, accumulates into a `Uint8Array`, then converts to a `Blob` — keeping the existing `VoicePlayer.scheduleBlob()` interface untouched. The provider is user-selectable in Voice Settings.

**Tech Stack:** TypeScript, Next.js App Router route handlers, Web Streams API (`ReadableStream`), Deepgram Aura REST API (`fetch`).

## Global Constraints

- No new npm packages — use `fetch` directly for Deepgram API calls
- TypeScript strict mode — every task must pass `cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit 2>&1 | head -30`
- Follow existing patterns: named exports, no default exports on lib files
- `VoicePlayer` (`lib/voice/player.ts`) must not be modified
- Deepgram speed parameter is not supported — UI disables speed slider when Deepgram is active
- If `DEEPGRAM_API_KEY` is missing, route returns HTTP 503 (same pattern as Google TTS)

---

### Task 1: Type system and preferences

**Files:**
- Modify: `lib/voice/types.ts`
- Modify: `lib/voice/tts/types.ts`
- Modify: `lib/voice/preferences.ts`

**Interfaces:**
- Produces: `TtsProvider = "openai" | "google" | "deepgram"`, `DEEPGRAM_TTS_VOICES`, `VoicePreferences.deepgramTtsVoice`, preferences version `11` — consumed by Tasks 2, 3, 4

- [ ] **Step 1: Add `"deepgram"` to `TtsProvider` and `deepgramTtsVoice` to `VoicePreferences`**

Open `lib/voice/types.ts`. Change:

```ts
export type TtsProvider = "openai" | "google";
```

to:

```ts
export type TtsProvider = "openai" | "google" | "deepgram";
```

In the `VoicePreferences` interface, add after `googleTtsVoice: string;`:

```ts
  deepgramTtsVoice: string;
```

In `DEFAULT_VOICE_PREFERENCES`, add after `googleTtsVoice: "en-AU-Chirp3-HD-Kore",`:

```ts
  deepgramTtsVoice: "aura-asteria-en",
```

- [ ] **Step 2: Add `DEEPGRAM_TTS_VOICES` and update `parseTtsProvider`**

Open `lib/voice/tts/types.ts`. Add after the `OPENAI_TTS_VOICES` block:

```ts
export const DEEPGRAM_TTS_VOICES = [
  "aura-asteria-en",
  "aura-luna-en",
  "aura-zeus-en",
  "aura-orion-en",
] as const;

export type DeepgramTtsVoice = (typeof DEEPGRAM_TTS_VOICES)[number];
```

Change `parseTtsProvider`:

```ts
export function parseTtsProvider(value: unknown): TtsProvider {
  return value === "google" ? "google" : value === "deepgram" ? "deepgram" : "openai";
}
```

- [ ] **Step 3: Bump preferences version and validate `deepgramTtsVoice`**

Open `lib/voice/preferences.ts`. Change:

```ts
const PREFS_VERSION = 10;
```

to:

```ts
const PREFS_VERSION = 11;
```

Add after the existing `ALLOWED_GOOGLE_VOICES` line:

```ts
const ALLOWED_DEEPGRAM_VOICES = new Set<string>(DEEPGRAM_TTS_VOICES);
```

Add the import for `DEEPGRAM_TTS_VOICES` to the existing import from `"@/lib/voice/tts/types"`:

```ts
import {
  OPENAI_TTS_VOICES,
  parseOpenAiTtsModel,
  parseTtsProvider,
  DEEPGRAM_TTS_VOICES,
} from "@/lib/voice/tts/types";
```

In `loadVoicePreferences`, inside `const merged: VoicePreferences = { ... }`, add after `googleTtsVoice: normalizeGoogleTtsVoice(...)`:

```ts
      deepgramTtsVoice:
        typeof parsed.deepgramTtsVoice === "string" &&
        ALLOWED_DEEPGRAM_VOICES.has(parsed.deepgramTtsVoice)
          ? parsed.deepgramTtsVoice
          : DEFAULT_VOICE_PREFERENCES.deepgramTtsVoice,
```

Add the version 11 migration block after the existing `storedVersion < 10` block:

```ts
      if (storedVersion < 11 && !parsed.deepgramTtsVoice) {
        merged.deepgramTtsVoice = DEFAULT_VOICE_PREFERENCES.deepgramTtsVoice;
      }
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only about `deepgramTtsVoice` not yet used in route/settings (not yet wired). Zero errors in the three files changed here.

- [ ] **Step 5: Commit**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant
git add lib/voice/types.ts lib/voice/tts/types.ts lib/voice/preferences.ts
git commit -m "feat: add Deepgram as TtsProvider type and preferences field"
```

---

### Task 2: Server-side Deepgram streaming

**Files:**
- Create: `lib/voice/tts/deepgram-server.ts`
- Modify: `app/api/voice/synthesize/route.ts`

**Interfaces:**
- Consumes: `DEEPGRAM_TTS_VOICES` from Task 1
- Produces: `synthesizeWithDeepgram(text, voice): Promise<ReadableStream<Uint8Array>>` — consumed by route

- [ ] **Step 1: Create `lib/voice/tts/deepgram-server.ts`**

```ts
const DEEPGRAM_API_URL = "https://api.deepgram.com/v1/speak";

export async function synthesizeWithDeepgram(
  text: string,
  voice: string,
): Promise<ReadableStream<Uint8Array>> {
  const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "Deepgram TTS is not configured. Set DEEPGRAM_API_KEY.",
    );
  }

  const response = await fetch(`${DEEPGRAM_API_URL}?model=${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: {
      Authorization: `Token ${apiKey}`,
      "Content-Type": "application/json",
    },
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

  if (!response.body) {
    throw new Error("Deepgram returned empty response body.");
  }

  return response.body as ReadableStream<Uint8Array>;
}
```

- [ ] **Step 2: Update the synthesize route to dispatch Deepgram**

Open `app/api/voice/synthesize/route.ts`. Add the import:

```ts
import { synthesizeWithDeepgram } from "@/lib/voice/tts/deepgram-server";
```

Replace the existing `try` block:

```ts
    try {
      if (provider === "google") {
        const audio = await synthesizeWithGoogle(text, voice, speed, googleTtsQuality);
        return new NextResponse(new Uint8Array(audio), {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      }

      if (provider === "deepgram") {
        const stream = await synthesizeWithDeepgram(text, voice);
        return new NextResponse(stream as unknown as BodyInit, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      }

      const audio = await synthesizeWithOpenAi(text, voice, speed, useHd, openAiTtsModel);
      return new NextResponse(new Uint8Array(audio), {
        status: 200,
        headers: {
          "Content-Type": "audio/mpeg",
          "Cache-Control": "no-store",
        },
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Speech synthesis failed";
      const status = message.includes("not configured") ? 503 : 500;
      return NextResponse.json({ error: message }, { status });
    }
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors in `deepgram-server.ts` and `route.ts`.

- [ ] **Step 4: Commit**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant
git add lib/voice/tts/deepgram-server.ts app/api/voice/synthesize/route.ts
git commit -m "feat: add Deepgram streaming TTS server-side handler"
```

---

### Task 3: Client-side stream reading

**Files:**
- Modify: `lib/voice/tts/client.ts`

**Interfaces:**
- Consumes: `TtsProvider` (now includes `"deepgram"`), `TtsSynthesizeOptions`
- Produces: `synthesizeChunk` still returns `Promise<Blob>` — `VoicePlayer` unchanged

- [ ] **Step 1: Update `synthesizeChunk` to read the stream for Deepgram**

Open `lib/voice/tts/client.ts`. Replace the full file content:

```ts
import type { TtsProvider, TtsSynthesizeOptions } from "@/lib/voice/tts/types";

async function readStreamToBlob(
  stream: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<Blob> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  try {
    while (true) {
      if (signal?.aborted) {
        reader.cancel().catch(() => undefined);
        throw new DOMException("Playback stopped", "AbortError");
      }
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      totalLength += value.length;
    }
  } finally {
    reader.releaseLock();
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.length;
  }

  return new Blob([combined], { type: "audio/mpeg" });
}

export async function synthesizeChunk(
  text: string,
  options: TtsSynthesizeOptions,
): Promise<Blob> {
  const provider: TtsProvider = options.provider ?? "openai";

  const voice =
    provider === "deepgram"
      ? (options.deepgramTtsVoice ?? "aura-asteria-en")
      : options.voice;

  const response = await fetch("/api/voice/synthesize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      voice,
      speed: options.speed,
      hd: provider === "openai" ? options.hd === true : undefined,
      openAiTtsModel: options.openAiTtsModel,
      googleTtsQuality: options.googleTtsQuality,
      provider,
    }),
    signal: options.signal,
  });

  if (response.status === 401) {
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message =
      data && typeof data === "object" && "error" in data
        ? String((data as { error: unknown }).error)
        : "Speech synthesis failed";
    throw new Error(message);
  }

  if (provider === "deepgram" && response.body) {
    return readStreamToBlob(response.body, options.signal);
  }

  return response.blob();
}
```

- [ ] **Step 2: Add `deepgramTtsVoice` to `TtsSynthesizeOptions`**

Open `lib/voice/tts/types.ts`. In the `TtsSynthesizeOptions` interface, add:

```ts
export interface TtsSynthesizeOptions {
  voice: string;
  speed: number;
  hd?: boolean;
  provider?: TtsProvider;
  openAiTtsModel?: OpenAiTtsModel;
  googleTtsQuality?: GoogleVoiceQuality;
  deepgramTtsVoice?: string;
  signal?: AbortSignal;
}
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors pointing to `VoicePlayerOptions` and `VoiceSettingsPanel` (not yet passing `deepgramTtsVoice` through). Zero errors in `client.ts` and `tts/types.ts`.

- [ ] **Step 4: Commit**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant
git add lib/voice/tts/client.ts lib/voice/tts/types.ts
git commit -m "feat: read Deepgram stream chunks into Blob on client"
```

---

### Task 4: Wire `deepgramTtsVoice` through player and settings UI

**Files:**
- Modify: `lib/voice/player.ts`
- Modify: `components/voice/VoiceSettingsPanel.tsx`
- Modify: `components/chat/useVoiceSession.ts` (or wherever `VoicePlayerOptions` is constructed — check this file)

**Interfaces:**
- Consumes: `deepgramTtsVoice` from `VoicePreferences` (Task 1), `TtsSynthesizeOptions.deepgramTtsVoice` (Task 3)
- Produces: full working Deepgram provider in the UI and voice session

- [ ] **Step 1: Add `deepgramTtsVoice` to `VoicePlayerOptions`**

Open `lib/voice/player.ts`. In `VoicePlayerOptions`, add:

```ts
export interface VoicePlayerOptions {
  voice: string;
  speed: number;
  hd?: boolean;
  provider?: "openai" | "google" | "deepgram";
  openAiTtsModel?: import("@/lib/voice/types").OpenAiTtsModel;
  googleTtsQuality?: import("@/lib/voice/types").GoogleVoiceQuality;
  deepgramTtsVoice?: string;
}
```

In both `playStreaming` and `play` methods, update `synthOptions` to include `deepgramTtsVoice`:

```ts
    const synthOptions = {
      voice: options.voice,
      speed: options.speed,
      hd: options.hd,
      provider: options.provider,
      openAiTtsModel: options.openAiTtsModel,
      googleTtsQuality: options.googleTtsQuality,
      deepgramTtsVoice: options.deepgramTtsVoice,
      signal: controller.signal,
    };
```

(This block appears in both `playStreaming` and `play` — update both.)

- [ ] **Step 2: Find where `VoicePlayerOptions` is constructed and pass `deepgramTtsVoice`**

```bash
grep -r "provider.*ttsProvider\|ttsVoice\|VoicePlayerOptions" /Users/aryavkarthik/Developer/ai_assistant/components --include="*.ts" --include="*.tsx" -l
```

Open `components/chat/useVoiceSession.ts` (or whatever file the grep finds). Find where `VoicePlayerOptions` is built (look for `voice: prefs.ttsVoice` or similar). Add `deepgramTtsVoice: prefs.deepgramTtsVoice` to that object.

- [ ] **Step 3: Update `VoiceSettingsPanel` with Deepgram option**

Open `components/voice/VoiceSettingsPanel.tsx`. Add `DEEPGRAM_TTS_VOICES` to imports:

```ts
import { OPENAI_TTS_VOICES, DEEPGRAM_TTS_VOICES } from "@/lib/voice/tts/types";
```

Add `isDeepgramTts` alongside the existing provider booleans:

```ts
  const isGoogleTts = preferences.ttsProvider === "google";
  const isDeepgramTts = preferences.ttsProvider === "deepgram";
```

In the TTS provider `<select>`, add the Deepgram option:

```tsx
            <select
              value={preferences.ttsProvider}
              onChange={(e) =>
                onChange({
                  ttsProvider: e.target.value === "google" ? "google" : e.target.value === "deepgram" ? "deepgram" : "openai",
                })
              }
              disabled={!preferences.spokenReplies}
            >
              <option value="openai">OpenAI (gpt-4o-mini-tts)</option>
              <option value="google">Google Cloud</option>
              <option value="deepgram">Deepgram (Aura)</option>
            </select>
```

After the Google TTS quality block, add a Deepgram voice picker:

```tsx
          {isDeepgramTts ? (
            <label className="app-voice-settings-field">
              <span>Deepgram voice</span>
              <select
                value={preferences.deepgramTtsVoice}
                onChange={(e) => onChange({ deepgramTtsVoice: e.target.value })}
                disabled={!preferences.spokenReplies}
              >
                {DEEPGRAM_TTS_VOICES.map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
```

Update the Reply voice picker to hide when Deepgram is active (it only applies to OpenAI/Google):

```tsx
          {!isDeepgramTts ? (
            <label className="app-voice-settings-field">
              <span>Reply voice</span>
              <select
                value={isGoogleTts ? preferences.googleTtsVoice : preferences.ttsVoice}
                onChange={(e) =>
                  onChange(
                    isGoogleTts
                      ? { googleTtsVoice: e.target.value }
                      : { ttsVoice: e.target.value },
                  )
                }
                disabled={!preferences.spokenReplies}
              >
                {(isGoogleTts ? googleTtsVoices : OPENAI_TTS_VOICES).map((voice) => (
                  <option key={voice} value={voice}>
                    {voice}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
```

Update the speed slider to disable when Deepgram is active:

```tsx
          <label className="app-voice-settings-field">
            <span>Speech speed{isDeepgramTts ? " (not supported by Deepgram)" : ""}</span>
            <input
              type="range"
              min={0.75}
              max={2.0}
              step={0.05}
              value={preferences.ttsSpeed}
              disabled={!preferences.spokenReplies || isDeepgramTts}
              onChange={(e) => onChange({ ttsSpeed: Number(e.target.value) })}
            />
          </label>
```

Update the HD checkbox to also disable for Deepgram:

```tsx
          <label className="app-voice-settings-check">
            <input
              type="checkbox"
              checked={preferences.ttsHd}
              onChange={(e) => onChange({ ttsHd: e.target.checked })}
              disabled={!preferences.spokenReplies || isGoogleTts || isDeepgramTts}
            />
            <span>Extra expressive voice (OpenAI only)</span>
          </label>
```

- [ ] **Step 4: Verify TypeScript compiles cleanly**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit 2>&1 | head -30
```

Expected: zero errors.

- [ ] **Step 5: Add `DEEPGRAM_API_KEY` to `.env.local`**

Open `.env.local` and add:

```
DEEPGRAM_API_KEY=your_key_here
```

Replace `your_key_here` with your actual key from [console.deepgram.com](https://console.deepgram.com).

- [ ] **Step 6: Commit**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant
git add lib/voice/player.ts components/voice/VoiceSettingsPanel.tsx
git add components/chat/useVoiceSession.ts  # or whichever file was updated in Step 2
git commit -m "feat: wire Deepgram TTS through player options and voice settings UI"
```

---

## Verification After All Tasks

- [ ] **Full TypeScript check:**

```bash
cd /Users/aryavkarthik/Developer/ai_assistant && npx tsc --noEmit
```

Expected: zero errors.

- [ ] **Manual smoke test:**

1. Open Voice Settings → set TTS provider to "Deepgram (Aura)"
2. Confirm speed slider is disabled, HD checkbox is disabled, Deepgram voice picker appears
3. Send a chat message with spoken replies enabled
4. Confirm audio plays back correctly
5. Check server logs — no `[cache-usage]` errors, no 503s from the synthesize route

- [ ] **Fallback test:**

Temporarily unset `DEEPGRAM_API_KEY` in `.env.local`, send a voice message → should get a 503 error response (not a crash).
