import { ensureAudioPlaybackUnlocked } from "./audio-unlock";
import { SentenceBuffer } from "./sentence-buffer";
import { prepareSpeechChunks } from "./tts-text";
import { nova } from "../lib/ipc";

async function synthesizeChunk(
  text: string,
  options: {
    voice: string;
    speed: number;
    hd?: boolean;
    provider?: import("@shared/types").TtsProvider;
    deepgramTtsVoice?: string;
    openAiTtsModel?: import("@shared/types").OpenAiTtsModel;
    googleTtsQuality?: import("@shared/types").GoogleVoiceQuality;
    signal?: AbortSignal;
  },
): Promise<Blob> {
  const provider = options.provider ?? "openai";
  const voice =
    provider === "deepgram"
      ? (options.deepgramTtsVoice ?? "aura-asteria-en")
      : options.voice;
  const { audioBase64 } = await nova().synthesize({
    text,
    voice,
    speed: options.speed,
    hd: provider === "openai" ? options.hd === true : undefined,
    provider,
  });
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: "audio/mpeg" });
}

export interface VoicePlayerOptions {
  voice: string;
  speed: number;
  hd?: boolean;
  provider?: import("@shared/types").TtsProvider;
  openAiTtsModel?: import("@shared/types").OpenAiTtsModel;
  googleTtsQuality?: import("@shared/types").GoogleVoiceQuality;
  deepgramTtsVoice?: string;
}

export interface StreamingVoiceSession {
  feed(delta: string): void;
  finish(): Promise<void>;
  stop(): void;
}

export class VoicePlayer {

  private audioContext: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private scheduledEnd = 0;
  private activeSources: AudioBufferSourceNode[] = [];
  private abortController: AbortController | null = null;
  private playing = false;
  private streamingSession: StreamingVoiceSession | null = null;
  private baseVolume = 1;

  isPlaying(): boolean {
    if (this.playing) return true;
    if (this.activeSources.length > 0) return true;
    if (this.audioContext?.state === "suspended") return true;
    if (
      this.audioContext &&
      this.scheduledEnd > this.audioContext.currentTime + 0.05
    ) {
      return true;
    }
    return false;
  }

  setVolume(volume: number): void {
    this.baseVolume = Math.max(0, Math.min(1, volume));
    if (this.gainNode) {
      this.gainNode.gain.value = this.baseVolume;
    }
  }

  pause(): void {
    if (this.gainNode) {
      this.gainNode.gain.value = 0;
    }
  }

  resume(): void {
    if (this.gainNode) {
      this.gainNode.gain.value = this.baseVolume;
    }
    if (this.audioContext?.state === "suspended") {
      void this.audioContext.resume();
    }
  }

  async suspendPlayback(): Promise<void> {
    const ctx = this.audioContext;
    if (ctx && ctx.state === "running") {
      await ctx.suspend();
    }
  }

  async resumePlayback(): Promise<void> {
    const ctx = this.audioContext;
    if (ctx && ctx.state === "suspended") {
      await ctx.resume();
    }
    this.resume();
  }

  isSuspended(): boolean {
    return this.audioContext?.state === "suspended";
  }

  stop(): void {
    if (this.audioContext?.state === "suspended") {
      void this.audioContext.resume();
    }
    const session = this.streamingSession;
    this.streamingSession = null;
    session?.stop();
    this.safeAbort(this.abortController);
    this.abortController = null;
    this.playing = false;
    this.baseVolume = 1;
    this.stopAllSources();
  }

  private safeAbort(controller: AbortController | null | undefined): void {
    if (!controller || controller.signal.aborted) return;
    try {
      controller.abort(new DOMException("Playback stopped", "AbortError"));
    } catch {
      // Some runtimes throw on repeated abort calls.
    }
  }

  private stopAllSources(): void {
    for (const source of this.activeSources) {
      try {
        source.stop();
      } catch {
        // ignore
      }
    }
    this.activeSources = [];
    this.scheduledEnd = 0;
  }

  private async ensureContext(): Promise<AudioContext> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      this.gainNode = this.audioContext.createGain();
      this.gainNode.gain.value = this.baseVolume;
      this.gainNode.connect(this.audioContext.destination);
    }

    if (this.audioContext.state === "suspended") {
      try {
        await this.audioContext.resume();
      } catch {
        const unlocked = await ensureAudioPlaybackUnlocked();
        if (unlocked) await this.audioContext.resume();
      }
    }

    return this.audioContext;
  }

  playStreaming(options: VoicePlayerOptions): StreamingVoiceSession {
    this.stop();

    const controller = new AbortController();
    this.abortController = controller;
    this.playing = true;

    const buffer = new SentenceBuffer({
      minChars: 32,
      clauseBreakAfter: 80,
      firstChunkMinChars: 12,
    });
    const pendingSentences: string[] = [];
    const prefetch = new Map<number, Promise<Blob>>();
    let playIndex = 0;
    let pumpRunning = false;
    let lastPlayedText = "";

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

    const ensurePrefetch = (depth: number) => {
      for (
        let i = playIndex;
        i < pendingSentences.length && i < playIndex + depth;
        i++
      ) {
        if (!prefetch.has(i)) {
          prefetch.set(
            i,
            synthesizeChunk(pendingSentences[i]!, synthOptions),
          );
        }
      }
    };

    let pumpChain: Promise<void> = Promise.resolve();

    const pump = (): Promise<void> => {
      if (pumpRunning) return pumpChain;

      pumpRunning = true;
      pumpChain = pumpChain.then(async () => {
        try {
          while (playIndex < pendingSentences.length) {
            if (controller.signal.aborted) return;

            ensurePrefetch(2);
            const text = pendingSentences[playIndex]!;
            if (text === lastPlayedText) {
              playIndex++;
              prefetch.delete(playIndex - 1);
              continue;
            }

            const blobPromise = prefetch.get(playIndex);
            if (!blobPromise) break;

            const blob = await blobPromise;
            prefetch.delete(playIndex);
            playIndex++;
            lastPlayedText = text;

            if (controller.signal.aborted || !blob) return;
            await this.scheduleBlob(blob, controller.signal);
          }
        } finally {
          pumpRunning = false;
          if (playIndex < pendingSentences.length && !controller.signal.aborted) {
            void pump();
          }
        }
      });

      return pumpChain;
    };

    const playSentence = (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (
        trimmed === lastPlayedText ||
        (pendingSentences.length > 0 &&
          pendingSentences[pendingSentences.length - 1] === trimmed)
      ) {
        return;
      }
      pendingSentences.push(trimmed);
      ensurePrefetch(2);
      void pump();
    };

    const session: StreamingVoiceSession = {
      feed: (delta: string) => {
        for (const sentence of buffer.push(delta)) {
          playSentence(sentence);
        }
      },
      finish: async () => {
        const tail = buffer.flush();
        if (tail) playSentence(tail);

        try {
          await pump();
        } catch (err) {
          if (!controller.signal.aborted) throw err;
        } finally {
          if (this.abortController === controller) {
            this.abortController = null;
          }
          this.playing = false;
          this.streamingSession = null;
          this.baseVolume = 1;
        }
      },
      stop: () => {
        this.safeAbort(controller);
        buffer.reset();
        pendingSentences.length = 0;
        prefetch.clear();
        playIndex = 0;
        pumpRunning = false;
        lastPlayedText = "";
        this.streamingSession = null;
        if (this.abortController === controller) {
          this.abortController = null;
        }
        this.playing = false;
        this.baseVolume = 1;
        this.stopAllSources();
      },
    };

    this.streamingSession = session;
    return session;
  }

  async play(markdown: string, options: VoicePlayerOptions): Promise<void> {
    this.stop();

    const chunks = prepareSpeechChunks(markdown);
    if (chunks.length === 0) return;

    const controller = new AbortController();
    this.abortController = controller;
    this.playing = true;

    try {
      const prefetches: Promise<Blob>[] = chunks.map((chunk) =>
        synthesizeChunk(chunk, {
          voice: options.voice,
          speed: options.speed,
          hd: options.hd,
          provider: options.provider,
          openAiTtsModel: options.openAiTtsModel,
          googleTtsQuality: options.googleTtsQuality,
          deepgramTtsVoice: options.deepgramTtsVoice,
          signal: controller.signal,
        }),
      );

      for (let i = 0; i < chunks.length; i++) {
        if (controller.signal.aborted) return;
        const blob = await prefetches[i]!;
        if (controller.signal.aborted) return;
        await this.scheduleBlob(blob, controller.signal);
      }
    } catch (err) {
      if (controller.signal.aborted) return;
      throw err;
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
      }
      this.playing = false;
      this.baseVolume = 1;
    }
  }

  private async scheduleBlob(
    blob: Blob,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) return;

    const ctx = await this.ensureContext();
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0));

    if (signal.aborted) return;

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(this.gainNode!);

    const startAt = Math.max(ctx.currentTime + 0.02, this.scheduledEnd);
    source.start(startAt);
    this.scheduledEnd = startAt + audioBuffer.duration;
    this.activeSources.push(source);

    await new Promise<void>((resolve) => {
      const onEnd = () => {
        cleanup();
        resolve();
      };
      const onAbort = () => {
        try {
          source.stop();
        } catch {
          // ignore
        }
        cleanup();
        resolve();
      };
      const cleanup = () => {
        source.removeEventListener("ended", onEnd);
        signal.removeEventListener("abort", onAbort);
        const idx = this.activeSources.indexOf(source);
        if (idx >= 0) this.activeSources.splice(idx, 1);
      };

      source.addEventListener("ended", onEnd);
      signal.addEventListener("abort", onAbort);
    });
  }
}
