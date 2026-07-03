import { SAMPLES_PER_FRAME } from "@shared/wake-constants";

/**
 * Mic capture for wake word + streaming STT.
 *
 * Runs the AudioContext at the mic's NATIVE sample rate (typically 48 kHz on
 * macOS) and produces two streams from one AudioWorklet:
 *
 *  - wake frames: 16 kHz Int16 mono, SAMPLES_PER_FRAME per frame, produced by
 *    a windowed-sinc anti-aliasing FIR + integer decimation. The previous
 *    design forced the whole AudioContext to 16 kHz and let Chromium resample
 *    the mic — that resampled audio is noticeably degraded, which is exactly
 *    why genuine "hey jarvis" activations scored ~0.2–0.3 instead of the
 *    0.7–1.0 a healthy openWakeWord pipeline produces.
 *  - STT frames: FULL native-rate Int16 mono (80 ms per frame) for Google
 *    streaming — no resampling at all, so streaming transcription hears the
 *    same fidelity the batch (MediaRecorder/opus) path does.
 *
 * If the worklet fails or the native rate isn't an integer multiple of 16 kHz
 * (e.g. 44.1 kHz hardware), falls back to the old forced-16 kHz
 * ScriptProcessor path (wake only; STT then uses the batch fallback).
 *
 * Returns a stop function that tears down the audio graph.
 */

const WAKE_RATE = 16_000;
const STT_FRAME_SECONDS = 0.08;

let activeCaptureRate = 0;

/** Native sample rate of the STT frames currently being produced (0 = none —
 *  streaming STT should not be attempted). */
export function getCaptureSampleRate(): number {
  return activeCaptureRate;
}

export function startWakeCapture(
  stream: MediaStream,
  sendWake: (buf: ArrayBuffer) => void,
  sendStt?: (buf: ArrayBuffer) => void,
): () => void {
  const ctx = new AudioContext(); // native rate — do NOT force 16 kHz
  const source = ctx.createMediaStreamSource(stream);
  let workletNode: AudioWorkletNode | null = null;
  let fallback: { ctx: AudioContext; node: ScriptProcessorNode; source: MediaStreamAudioSourceNode } | null = null;
  let stopped = false;

  // A suspended context produces NO frames — wake word and streaming STT both
  // go silently dead. Resume eagerly and whenever the state flips.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  ctx.onstatechange = () => {
    if (!stopped && ctx.state === "suspended") void ctx.resume().catch(() => {});
  };

  const rate = ctx.sampleRate;
  const decim = rate / WAKE_RATE;

  function startFallback() {
    void ctx.close();
    if (stopped) return;
    console.warn("[wake-capture] using forced-16kHz ScriptProcessor fallback (wake only)");
    activeCaptureRate = 0; // no native-rate STT frames — streaming STT disabled
    fallback = startScriptProcessorFallback(stream, sendWake);
  }

  if (!Number.isInteger(decim)) {
    // 44.1 kHz-family hardware — integer decimation impossible; keep it simple.
    startFallback();
  } else {
    const workletUrl = URL.createObjectURL(
      new Blob([captureWorkletSource()], { type: "application/javascript" }),
    );
    ctx.audioWorklet
      .addModule(workletUrl)
      .then(() => {
        if (stopped) return;
        workletNode = new AudioWorkletNode(ctx, "nova-pcm-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          processorOptions: {
            decim,
            firTaps: designLowpassFir(rate),
            wakeFrameSamples: SAMPLES_PER_FRAME,
            sttFrameSamples: Math.round(rate * STT_FRAME_SECONDS),
          },
        });
        workletNode.port.onmessage = (e: MessageEvent<{ kind: string; buf: ArrayBuffer }>) => {
          if (e.data.kind === "wake") sendWake(e.data.buf);
          else if (e.data.kind === "stt") sendStt?.(e.data.buf);
        };
        source.connect(workletNode);
        workletNode.connect(ctx.destination);
        activeCaptureRate = rate;
        console.log(`[wake-capture] AudioWorklet capture active @ ${rate} Hz (wake decim ×${decim})`);
      })
      .catch((err) => {
        console.warn("[wake-capture] AudioWorklet unavailable:", err);
        startFallback();
      })
      .finally(() => URL.revokeObjectURL(workletUrl));
  }

  return () => {
    stopped = true;
    activeCaptureRate = 0;
    workletNode?.port.close();
    workletNode?.disconnect();
    source.disconnect();
    void ctx.close();
    if (fallback) {
      fallback.node.disconnect();
      fallback.source.disconnect();
      void fallback.ctx.close();
    }
  };
}

/** Windowed-sinc low-pass for decimation to 16 kHz: cutoff ~7.2 kHz
 *  (0.45 × target rate), 49 taps, Hamming window. */
function designLowpassFir(inputRate: number): Float32Array {
  const numTaps = 49;
  const fc = (0.45 * WAKE_RATE) / inputRate; // normalized (0..0.5)
  const taps = new Float32Array(numTaps);
  const mid = (numTaps - 1) / 2;
  let sum = 0;
  for (let i = 0; i < numTaps; i++) {
    const n = i - mid;
    const sinc = n === 0 ? 2 * Math.PI * fc : Math.sin(2 * Math.PI * fc * n) / n;
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (numTaps - 1));
    taps[i] = sinc * window;
    sum += taps[i]!;
  }
  for (let i = 0; i < numTaps; i++) taps[i]! /= sum; // unity DC gain
  return taps;
}

/** Worklet source, inlined as a blob so no bundler asset plumbing is needed.
 *  Emits native-rate STT frames and FIR-decimated 16 kHz wake frames. */
function captureWorkletSource(): string {
  return `
class NovaPcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const o = options.processorOptions;
    this.decim = o.decim;
    this.taps = o.firTaps;
    this.wakeFrameSamples = o.wakeFrameSamples;
    this.sttFrameSamples = o.sttFrameSamples;

    this.sttBuf = new Float32Array(this.sttFrameSamples);
    this.sttFilled = 0;

    this.wakeBuf = new Int16Array(this.wakeFrameSamples);
    this.wakeFilled = 0;

    // FIR input queue: contiguous history of input samples awaiting decimation.
    this.fir = new Float32Array(16384);
    this.firLen = 0;
    this.firRead = 0; // next convolution start index
  }

  toInt16(s) {
    const c = Math.max(-1, Math.min(1, s));
    return c < 0 ? c * 32768 : c * 32767;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    // ── STT: native-rate passthrough frames ──
    let off = 0;
    while (off < ch.length) {
      const take = Math.min(ch.length - off, this.sttFrameSamples - this.sttFilled);
      this.sttBuf.set(ch.subarray(off, off + take), this.sttFilled);
      this.sttFilled += take;
      off += take;
      if (this.sttFilled === this.sttFrameSamples) {
        const out = new Int16Array(this.sttFrameSamples);
        for (let i = 0; i < this.sttFrameSamples; i++) out[i] = this.toInt16(this.sttBuf[i]);
        this.port.postMessage({ kind: "stt", buf: out.buffer }, [out.buffer]);
        this.sttFilled = 0;
      }
    }

    // ── Wake: FIR low-pass + decimate to 16 kHz ──
    if (this.firLen + ch.length > this.fir.length) {
      // compact consumed samples to the front
      this.fir.copyWithin(0, this.firRead, this.firLen);
      this.firLen -= this.firRead;
      this.firRead = 0;
    }
    this.fir.set(ch, this.firLen);
    this.firLen += ch.length;

    const taps = this.taps;
    const nTaps = taps.length;
    while (this.firRead + nTaps <= this.firLen) {
      let acc = 0;
      const base = this.firRead;
      for (let k = 0; k < nTaps; k++) acc += taps[k] * this.fir[base + k];
      this.firRead += this.decim;
      this.wakeBuf[this.wakeFilled++] = this.toInt16(acc);
      if (this.wakeFilled === this.wakeFrameSamples) {
        const out = new Int16Array(this.wakeFrameSamples);
        out.set(this.wakeBuf);
        this.port.postMessage({ kind: "wake", buf: out.buffer }, [out.buffer]);
        this.wakeFilled = 0;
      }
    }
    return true;
  }
}
registerProcessor("nova-pcm-capture", NovaPcmCapture);
`;
}

function startScriptProcessorFallback(
  stream: MediaStream,
  send: (buf: ArrayBuffer) => void,
): { ctx: AudioContext; node: ScriptProcessorNode; source: MediaStreamAudioSourceNode } {
  const ctx = new AudioContext({ sampleRate: WAKE_RATE });
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  const source = ctx.createMediaStreamSource(stream);
  // 2048 samples @ 16 kHz = 128 ms per callback.
  const node = ctx.createScriptProcessor(2048, 1, 1);
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
  return { ctx, node, source };
}
