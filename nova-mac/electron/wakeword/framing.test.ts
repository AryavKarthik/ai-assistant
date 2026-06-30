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
  it("keeps Int16 at raw int16 scale (openWakeWord melspectrogram expects this) and yields exactly the requested window", () => {
    const ring = new AudioRingBuffer();
    const frame = new Int16Array(SAMPLES_PER_FRAME).fill(16384); // half of full scale
    expect(ring.take(SAMPLES_PER_FRAME)).toBeNull(); // nothing pushed yet
    ring.pushInt16(frame);
    const win = ring.take(SAMPLES_PER_FRAME);
    expect(win).not.toBeNull();
    expect(win!.length).toBe(SAMPLES_PER_FRAME);
    expect(win![0]).toBe(16384); // raw int16 magnitude, NOT normalized to [-1, 1]
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
