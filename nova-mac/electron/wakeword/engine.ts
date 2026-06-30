import * as ort from "onnxruntime-node";
import { join } from "node:path";
import {
  AudioRingBuffer,
  WindowAccumulator,
  SAMPLES_PER_FRAME,
  MEL_BINS,
  MEL_FRAMES_PER_EMBEDDING,
  EMBEDDINGS_PER_PREDICTION,
} from "./framing";

// The melspectrogram model uses a 640-sample (40 ms) STFT window with a 160-sample
// (10 ms) hop, so it produces frames(N) = N/160 - 3 frames and consumes the first
// 3 hops (480 samples) as warmup. Feeding isolated 1280-sample chunks therefore
// yields only 5 frames each (instead of the 8 a continuous stream produces) AND
// distorts the timing — the 76-frame embedding window ends up spanning the wrong
// duration and the wake phrase never matches the trained pattern. To stream
// correctly we prepend the previous chunk's trailing 480 samples as context so each
// 1280-sample chunk yields exactly 8 frames that align continuously (verified to
// match the full-buffer mel to within float32 noise).
const MEL_CONTEXT_SAMPLES = 480; // 3 hops of STFT warmup
const EMBEDDING_HOP = 8; // mel frames between embeddings (openWakeWord window=76, step=8)

export class WakeWordEngine {
  private mel!: ort.InferenceSession;
  private embed!: ort.InferenceSession;
  private wake!: ort.InferenceSession;
  private ring = new AudioRingBuffer();
  private melWindow = new WindowAccumulator(MEL_FRAMES_PER_EMBEDDING, MEL_BINS);
  private embWindow = new WindowAccumulator(EMBEDDINGS_PER_PREDICTION, 96);
  /** Trailing samples of the previous chunk, prepended as STFT context (zeros at startup). */
  private melContext = new Float32Array(MEL_CONTEXT_SAMPLES);
  /** Counts full-window mel frames so we emit one embedding every EMBEDDING_HOP frames. */
  private embStep = 0;
  private loggedFirstFrame = false;

  constructor(private readonly modelsDir: string) {}

  async init(): Promise<void> {
    this.mel = await ort.InferenceSession.create(join(this.modelsDir, "melspectrogram.onnx"));
    this.embed = await ort.InferenceSession.create(join(this.modelsDir, "embedding_model.onnx"));
    this.wake = await ort.InferenceSession.create(join(this.modelsDir, "hey_jarvis_v0.1.onnx"));
  }

  /** Push one ~80ms Int16 frame; returns a wake score when a full prediction window is ready. */
  async process(frame: Int16Array): Promise<number | null> {
    this.ring.pushInt16(frame);
    const samples = this.ring.take(SAMPLES_PER_FRAME);
    if (!samples) return null;

    // Prepend the previous chunk's trailing 480 samples so the STFT has warmup
    // context and this 1280-sample chunk yields exactly 8 continuously-aligned frames.
    const melInput = new Float32Array(MEL_CONTEXT_SAMPLES + samples.length);
    melInput.set(this.melContext, 0);
    melInput.set(samples, MEL_CONTEXT_SAMPLES);
    this.melContext = samples.slice(samples.length - MEL_CONTEXT_SAMPLES);

    // 1) raw audio → mel frames (shape [1, N] → [1, melFrames, MEL_BINS])
    const melIn = new ort.Tensor("float32", melInput, [1, melInput.length]);
    const melOut = await this.mel.run({ [this.mel.inputNames[0]!]: melIn });
    const melTensor = melOut[this.mel.outputNames[0]!]!;
    // Apply openWakeWord normalization: matches Python `spec = (spec / 10) + 2`
    // Raw log-mel values are in ~[-60, 0] dB; this maps them to ~[-4, 2] for the embedding model.
    const melData = Float32Array.from(melTensor.data as Float32Array, (v) => v / 10 + 2);
    const melFrames = melData.length / MEL_BINS;

    if (!this.loggedFirstFrame) {
      this.loggedFirstFrame = true;
      const raw = melTensor.data as Float32Array;
      console.log("[nova] mel inputNames:", this.mel.inputNames, "outputNames:", this.mel.outputNames);
      console.log("[nova] mel output dims:", melTensor.dims, "frames:", melFrames, "bins:", MEL_BINS);
      console.log("[nova] mel raw range:", Math.min(...raw).toFixed(2), "to", Math.max(...raw).toFixed(2));
      console.log("[nova] mel normalized range:", Math.min(...melData).toFixed(2), "to", Math.max(...melData).toFixed(2));
      console.log("[nova] embed inputNames:", this.embed.inputNames, "outputNames:", this.embed.outputNames);
      console.log("[nova] wake inputNames:", this.wake.inputNames, "outputNames:", this.wake.outputNames);
    }

    let lastScore: number | null = null;
    for (let f = 0; f < melFrames; f++) {
      const row = new Float32Array(melData.buffer, melData.byteOffset + f * MEL_BINS * 4, MEL_BINS);
      const melWin = this.melWindow.push(row);
      if (!melWin) continue;

      // openWakeWord computes embeddings with window=76, step=8 — i.e. ONE embedding
      // per 80 ms chunk (8 mel frames), not one per frame. Emitting one per frame would
      // make the 16-embedding wake window span only ~160 ms of stride instead of the
      // ~1.3 s the wake model was trained on, so the phrase pattern never appears and
      // scores stay pinned near zero. Gate the embedding to every EMBEDDING_HOP frames.
      if (this.embStep++ % EMBEDDING_HOP !== 0) continue;

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
