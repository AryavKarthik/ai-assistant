import { randomUUID } from "node:crypto";

export interface ActiveTimer {
  id: string;
  label: string;
  firesAt: number;
}

export interface TimerRecord extends ActiveTimer {
  handle: ReturnType<typeof setTimeout>;
}

type TimerFireHandler = (timer: ActiveTimer) => void;

/**
 * In-process timer manager. Timers live only for the app session — they are
 * announced via macOS notification + orb popup when they fire (see main.ts).
 */
export class TimerManager {
  private timers = new Map<string, TimerRecord>();
  private onFire: TimerFireHandler;

  constructor(onFire: TimerFireHandler) {
    this.onFire = onFire;
  }

  set(label: string, durationMs: number): ActiveTimer {
    const id = randomUUID();
    const firesAt = Date.now() + durationMs;
    const handle = setTimeout(() => {
      this.timers.delete(id);
      this.onFire({ id, label, firesAt });
    }, durationMs);
    this.timers.set(id, { id, label, firesAt, handle });
    return { id, label, firesAt };
  }

  list(): ActiveTimer[] {
    return [...this.timers.values()]
      .map(({ id, label, firesAt }) => ({ id, label, firesAt }))
      .sort((a, b) => a.firesAt - b.firesAt);
  }

  cancel(id: string): boolean {
    const timer = this.timers.get(id);
    if (!timer) return false;
    clearTimeout(timer.handle);
    this.timers.delete(id);
    return true;
  }

  cancelAll(): number {
    const count = this.timers.size;
    for (const t of this.timers.values()) clearTimeout(t.handle);
    this.timers.clear();
    return count;
  }
}

let manager: TimerManager | null = null;

export function initTimerManager(onFire: TimerFireHandler): TimerManager {
  manager = new TimerManager(onFire);
  return manager;
}

export function getTimerManager(): TimerManager {
  if (!manager) throw new Error("Timer manager not initialized");
  return manager;
}
