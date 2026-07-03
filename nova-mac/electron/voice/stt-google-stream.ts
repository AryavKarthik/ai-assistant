/**
 * Google Cloud Speech streaming STT session (V1 streamingRecognize).
 *
 * The renderer already ships 16 kHz mono Int16 PCM frames to the main process
 * continuously for wake-word detection; during a voice turn main tees those
 * same frames into an open recognize stream (see main.ts), so Google is
 * transcribing WHILE the user talks. When the renderer's VAD detects silence
 * it calls stop() and the final transcript is ready within a few hundred ms —
 * versus the 1.5–3 s of the record-then-upload batch path.
 *
 * One session at a time (voice turns are serial). Batch STT remains the
 * fallback whenever streaming is unconfigured or errors mid-turn.
 */

import { getGcpSpeechClient, isGcpVoiceConfigured } from "../gcp/client";

interface Session {
  stream: NodeJS.WritableStream & { end(): void; destroy?(err?: Error): void };
  finals: string[];
  interim: string;
  error: Error | null;
  ended: boolean;
  onEnd: (() => void)[];
}

let session: Session | null = null;

export function sttStreamConfigured(): boolean {
  return isGcpVoiceConfigured();
}

export function sttStreamActive(): boolean {
  return session !== null;
}

/** Opens a streaming recognizer. Returns false when GCP voice isn't configured. */
export function startSttStream(): boolean {
  if (!isGcpVoiceConfigured()) return false;
  abortSttStream(); // never leak a previous session

  const client = getGcpSpeechClient();
  const s: Session = {
    stream: null as unknown as Session["stream"],
    finals: [],
    interim: "",
    error: null,
    ended: false,
    onEnd: [],
  };

  const stream = client
    .streamingRecognize({
      config: {
        encoding: "LINEAR16",
        sampleRateHertz: 16000,
        audioChannelCount: 1,
        languageCode: "en-AU",
        alternativeLanguageCodes: ["en-US", "en-GB"],
        enableAutomaticPunctuation: true,
        // latest_short finalizes segments aggressively — exactly what a
        // low-latency command/chat turn wants; long utterances just produce
        // several finals which we join.
        model: "latest_short",
        useEnhanced: true,
      },
      interimResults: true,
    })
    .on("data", (data: {
      results?: Array<{
        isFinal?: boolean;
        alternatives?: Array<{ transcript?: string }>;
      }>;
    }) => {
      for (const result of data.results ?? []) {
        const text = result.alternatives?.[0]?.transcript ?? "";
        if (!text) continue;
        if (result.isFinal) {
          s.finals.push(text.trim());
          s.interim = "";
        } else {
          s.interim = text.trim();
        }
      }
    })
    .on("error", (err: Error) => {
      s.error = err;
      finish(s);
    })
    .on("end", () => finish(s));

  s.stream = stream as unknown as Session["stream"];
  session = s;
  return true;
}

function finish(s: Session): void {
  if (s.ended) return;
  s.ended = true;
  for (const cb of s.onEnd) cb();
  s.onEnd = [];
}

/** Feeds one PCM frame (Int16 LE bytes) into the active session, if any. */
export function pushSttAudio(buf: ArrayBuffer): void {
  const s = session;
  if (!s || s.ended || s.error) return;
  try {
    s.stream.write(Buffer.from(buf));
  } catch (err) {
    s.error = err instanceof Error ? err : new Error(String(err));
  }
}

function transcriptOf(s: Session): string {
  const parts = [...s.finals];
  // A trailing interim that never finalized (stream cut) still beats nothing.
  if (s.interim && !parts.join(" ").includes(s.interim)) parts.push(s.interim);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Half-closes the audio and waits (bounded) for Google to flush the final
 * results. Throws when the stream errored and produced nothing usable, so the
 * caller can fall back to batch STT.
 */
export async function stopSttStream(timeoutMs = 2000): Promise<string> {
  const s = session;
  session = null;
  if (!s) return "";

  try {
    s.stream.end();
  } catch {
    // already destroyed
  }

  if (!s.ended) {
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      s.onEnd.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  const transcript = transcriptOf(s);
  if (s.error && !transcript) {
    throw new Error(`Google streaming STT failed: ${s.error.message}`);
  }
  return transcript;
}

/** Tears the session down without waiting (barge-in, cancel, turn error). */
export function abortSttStream(): void {
  const s = session;
  session = null;
  if (!s) return;
  try {
    s.stream.destroy?.();
  } catch {
    // ignore
  }
  finish(s);
}
