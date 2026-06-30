// openWakeWord streaming dimensions (the melspectrogram/embedding/wakeword ONNX pipeline).
// SAMPLES_PER_FRAME lives in shared/wake-constants so the renderer can import it
// without pulling in any main-process code.
export { SAMPLES_PER_FRAME } from "@shared/wake-constants";
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
