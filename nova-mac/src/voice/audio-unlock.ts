/** Unlock browser audio playback (must run during a user gesture). */
let unlocked = false;
let unlockPromise: Promise<boolean> | null = null;

const SILENT_MP3 =
  "data:audio/mp3;base64,SUQzBAAAAAAAI1RTU0UAAAAPAAADTGF2ZjU4Ljc2LjEwMAAAAAAAAAAAAAAA//tQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWGluZwAAAA8AAAACAAABhgC7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7u7//////////////////////////////////////////////////////////////////8AAAAATGF2YzU4LjEzAAAAAAAAAAAAAAAAJAAAAAAAAAAAAYYoRwmHAAAAAAD/+1DEAAAAGkAAGnAAAAAIAAANIAAAAQAAAaQAA0gAAAAABAAAA";

export function unlockAudioPlayback(): void {
  if (typeof window === "undefined" || unlocked) return;

  unlockPromise ??= (async () => {
    try {
      const audio = new Audio(SILENT_MP3);
      audio.volume = 0.01;
      await audio.play();
      unlocked = true;
      audio.pause();
      return true;
    } catch {
      return false;
    }
  })();
}

export async function ensureAudioPlaybackUnlocked(): Promise<boolean> {
  if (unlocked) return true;
  unlockAudioPlayback();
  if (!unlockPromise) return false;
  return unlockPromise;
}
