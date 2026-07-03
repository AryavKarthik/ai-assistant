/**
 * Synthesized audio cues (no assets — pure Web Audio oscillators).
 *
 * wake     — bright rising two-tone: "I'm listening"
 * gotIt    — short soft tick: recording captured, thinking now
 * reply    — subtle low blip right before TTS starts
 * bargeIn  — quick muted tick: interruption registered
 * error    — low double buzz
 * timer    — three-note chime
 */

export type CueName = "wake" | "gotIt" | "reply" | "bargeIn" | "error" | "timer";

let ctx: AudioContext | null = null;

async function ensureCtx(): Promise<AudioContext> {
  if (!ctx || ctx.state === "closed") ctx = new AudioContext();
  // Await the resume: scheduling against a suspended context computes note
  // times from a frozen currentTime, so by the time the context actually
  // resumes those times are already in the past and the cue plays clipped or
  // not at all — which is exactly what made cues inconsistent after idle.
  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      // fall through — scheduling is still best-effort
    }
  }
  return ctx;
}

interface Note {
  freq: number;
  /** seconds after cue start */
  at: number;
  duration: number;
  gain: number;
  type?: OscillatorType;
}

const CUES: Record<CueName, Note[]> = {
  wake: [
    { freq: 660, at: 0, duration: 0.09, gain: 0.16 },
    { freq: 990, at: 0.08, duration: 0.14, gain: 0.18 },
  ],
  gotIt: [{ freq: 880, at: 0, duration: 0.06, gain: 0.1 }],
  reply: [{ freq: 520, at: 0, duration: 0.07, gain: 0.08 }],
  bargeIn: [{ freq: 740, at: 0, duration: 0.05, gain: 0.12, type: "triangle" }],
  error: [
    { freq: 220, at: 0, duration: 0.12, gain: 0.14, type: "square" },
    { freq: 180, at: 0.15, duration: 0.16, gain: 0.12, type: "square" },
  ],
  timer: [
    { freq: 784, at: 0, duration: 0.16, gain: 0.2 },
    { freq: 988, at: 0.18, duration: 0.16, gain: 0.2 },
    { freq: 1175, at: 0.36, duration: 0.28, gain: 0.22 },
  ],
};

export function playCue(name: CueName): void {
  void ensureCtx()
    .then((audio) => scheduleCue(audio, name))
    .catch(() => {
      // cues are best-effort
    });
}

function scheduleCue(audio: AudioContext, name: CueName): void {
  try {
    const now = audio.currentTime + 0.01;
    for (const note of CUES[name]) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = note.type ?? "sine";
      osc.frequency.value = note.freq;
      // Fast attack, exponential release — keeps cues soft, no clicks.
      gain.gain.setValueAtTime(0.0001, now + note.at);
      gain.gain.exponentialRampToValueAtTime(note.gain, now + note.at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + note.duration);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now + note.at);
      osc.stop(now + note.at + note.duration + 0.05);
    }
  } catch {
    // cues are best-effort
  }
}

/** Back-compat: the original single ack earcon maps to the wake cue. */
export async function playEarcon(): Promise<void> {
  playCue("wake");
}
