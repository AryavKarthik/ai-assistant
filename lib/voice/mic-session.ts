import { openMicStream } from "@/lib/voice/mic-analyser";

/** Shared mic stream reused across recording and barge-in within a voice session. */
export class MicSession {
  private stream: MediaStream | null = null;
  private noiseFloor = 0;

  async acquire(): Promise<MediaStream> {
    if (!this.stream?.active) {
      this.release();
      this.stream = await openMicStream();
    }
    return this.stream;
  }

  getStream(): MediaStream | null {
    return this.stream?.active ? this.stream : null;
  }

  getNoiseFloor(): number {
    return this.noiseFloor;
  }

  rememberNoiseFloor(floor: number): void {
    if (floor > 0) {
      this.noiseFloor = floor;
    }
  }

  hasWarmCalibration(): boolean {
    return this.noiseFloor > 0;
  }

  /** Returns an active stream, opening the mic if needed. */
  async ensureStream(): Promise<MediaStream> {
    return this.acquire();
  }

  release(): void {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
}
