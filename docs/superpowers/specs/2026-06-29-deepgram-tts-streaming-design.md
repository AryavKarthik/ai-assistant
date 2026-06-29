# Deepgram Aura TTS Streaming — Design Spec

**Date:** 2026-06-29
**Status:** Approved

## Goal

Add Deepgram Aura as a third TTS provider option alongside OpenAI and Google. Use Deepgram's streaming HTTP response to eliminate server-side audio buffering, reducing latency to first audio. The rest of the voice pipeline (Claude as AI brain, sentence buffering, VoicePlayer scheduling) is unchanged.

## Architecture

### Current flow (OpenAI / Google)
```
SentenceBuffer → synthesizeChunk() → POST /api/voice/synthesize
  → synthesizeWithOpenAi/Google() → Buffer in memory
  → NextResponse(Uint8Array) → response.blob() → scheduleBlob() → AudioContext
```

### New flow (Deepgram)
```
SentenceBuffer → synthesizeChunk() → POST /api/voice/synthesize
  → synthesizeWithDeepgramStream() → Deepgram API (streams MP3)
  → NextResponse(ReadableStream) → read stream chunks → Uint8Array → Blob
  → scheduleBlob() → AudioContext  (unchanged)
```

The server pipes Deepgram's response body directly to the HTTP response — no server-side memory buffering. The client reads the stream and accumulates chunks into a `Uint8Array`, then converts to a `Blob` before decoding. `VoicePlayer` is untouched.

## Section 1: Provider Integration

**`lib/voice/types.ts`**
- `TtsProvider = "openai" | "google" | "deepgram"`
- Add `deepgramTtsVoice: string` to `VoicePreferences`
- Add `deepgramTtsVoice: "aura-asteria-en"` to `DEFAULT_VOICE_PREFERENCES`

**`lib/voice/tts/types.ts`**
- Add `DEEPGRAM_TTS_VOICES` constant: `["aura-asteria-en", "aura-luna-en", "aura-zeus-en", "aura-orion-en"]`
- Update `parseTtsProvider` to accept `"deepgram"`

**`lib/voice/preferences.ts`**
- Bump `PREFS_VERSION` to `11`
- Validate `deepgramTtsVoice` in `loadVoicePreferences` (fallback to default if invalid)

**Environment**
- `DEEPGRAM_API_KEY=...` in `.env.local`

## Section 2: Streaming End-to-End

**`lib/voice/tts/deepgram-server.ts`** — new file
```ts
export async function synthesizeWithDeepgram(text: string, voice: string): Promise<ReadableStream<Uint8Array>>
```
- `POST https://api.deepgram.com/v1/speak?model=<voice>`
- Headers: `Authorization: Token ${process.env.DEEPGRAM_API_KEY}`, `Content-Type: application/json`
- Body: `{ text }`
- Returns `response.body` (the raw stream from Deepgram)
- Throws if `DEEPGRAM_API_KEY` is not set or response is not ok

**`app/api/voice/synthesize/route.ts`**
- For `provider === "deepgram"`: call `synthesizeWithDeepgram`, return `new NextResponse(stream, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } })`
- Other providers unchanged

**`lib/voice/tts/client.ts`**
- For Deepgram: after `fetch`, read `response.body` stream with a `ReadableStreamDefaultReader`, accumulate chunks into `Uint8Array`, return `new Blob([accumulated], { type: "audio/mpeg" })`
- All other providers: existing `response.blob()` path unchanged
- Return type stays `Promise<Blob>` — `VoicePlayer` needs no changes

## Section 3: Settings UI

**`components/voice/VoiceSettingsPanel.tsx`**
- TTS provider `<select>`: add `<option value="deepgram">Deepgram (Aura)</option>`
- When Deepgram selected: show voice picker with `DEEPGRAM_TTS_VOICES`
- Speed slider: disabled when provider is Deepgram, with note "Speed control not supported by Deepgram"
- HD checkbox: disabled when provider is Deepgram (no equivalent)

**`lib/voice/tts/client.ts`**
- Pass `deepgramTtsVoice` as `voice` when `provider === "deepgram"`

## Constraints

- No new npm packages — use `fetch` directly for the Deepgram API call
- TypeScript strict mode — all changes must pass `npx tsc --noEmit`
- `VoicePlayer` is not modified
- Deepgram speed parameter is not supported — UI disables the slider when Deepgram is active
- Graceful error: if `DEEPGRAM_API_KEY` is missing, route returns `503` (same pattern as Google TTS)

## Out of Scope

- True progressive playback via MediaSource Extensions (future enhancement)
- Deepgram STT (this spec covers TTS only)
- Voice cloning or custom Deepgram voices
