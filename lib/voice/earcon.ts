/** Short acknowledgement tone when wake word is detected. */

let audioContext: AudioContext | null = null;

export function playWakeEarcon(): void {
  playTone(880, 660, 0.12, 0.15);
}

/** Short tick while the model is thinking (instant ack). */
export function playThinkingEarcon(): void {
  playTone(520, 520, 0.08, 0.1);
}

/** Soft two-note chime when a memory is silently stored. */
export function playMemoryEarcon(): void {
  try {
    audioContext ??= new AudioContext();
    const ctx = audioContext;
    // First note: gentle mid tone
    playToneOnContext(ctx, 660, 660, 0.055, 0.18, 0);
    // Second note: step up, slightly quieter
    playToneOnContext(ctx, 880, 880, 0.038, 0.22, 0.14);
  } catch {
    // non-critical
  }
}

function playToneOnContext(
  ctx: AudioContext,
  startHz: number,
  endHz: number,
  volume: number,
  durationSec: number,
  delayStart: number,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.setValueAtTime(startHz, ctx.currentTime + delayStart);
  osc.frequency.exponentialRampToValueAtTime(endHz, ctx.currentTime + delayStart + durationSec * 0.5);
  gain.gain.setValueAtTime(0.001, ctx.currentTime + delayStart);
  gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + delayStart + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delayStart + durationSec);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(ctx.currentTime + delayStart);
  osc.stop(ctx.currentTime + delayStart + durationSec + 0.01);
}

function playTone(
  startHz: number,
  endHz: number,
  volume: number,
  durationSec: number,
): void {
  try {
    audioContext ??= new AudioContext();
    playToneOnContext(audioContext, startHz, endHz, volume, durationSec, 0);
  } catch {
    // non-critical
  }
}
