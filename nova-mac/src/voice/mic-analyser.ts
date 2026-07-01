import { measureSpeechBandLevel } from "./vad";

export const MIC_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

export async function openMicStream(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
  } catch {
    throw new Error("Microphone permission denied.");
  }
}

/** rAF loop that emits speech-band levels from a mic stream. */
export class MicAnalyser {
  private audioContext: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private raf = 0;
  private disposed = false;

  start(stream: MediaStream, onLevel: (level: number) => void): void {
    this.stopLoop();
    this.disposed = false;

    if (!this.audioContext || this.audioContext.state === "closed") {
      this.audioContext = new AudioContext();
    }

    // Resume suspended context (common after user gesture / TTS plays)
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume();
    }

    const ctx = this.audioContext;
    this.source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    this.source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      if (this.disposed) return;
      if (ctx.state === "suspended") {
        void ctx.resume().catch(() => {});
        this.raf = requestAnimationFrame(tick);
        return;
      }
      analyser.getByteFrequencyData(data);
      onLevel(measureSpeechBandLevel(data));
      this.raf = requestAnimationFrame(tick);
    };

    this.raf = requestAnimationFrame(tick);
  }

  stop(): void {
    this.stopLoop();
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }

  private stopLoop(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.source?.disconnect();
    this.source = null;
  }
}
