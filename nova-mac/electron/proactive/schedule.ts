import type { LoopSchedule } from "@shared/types";

/** Pure next-run math for agent loops, tested in isolation.
 *  Returns epoch ms of the next run at/after `fromMs`, or null when the
 *  schedule is exhausted (a "once" whose time has already been consumed). */
export function computeNextRun(schedule: LoopSchedule, fromMs: number): number | null {
  switch (schedule.kind) {
    case "once": {
      const at = Date.parse(schedule.at);
      if (Number.isNaN(at)) return null;
      // A once-loop keeps its time even if it's slightly in the past when
      // created (e.g. "at 10:30" saved at 10:30:20) — the runner's staleness
      // window decides whether it still fires.
      return at;
    }
    case "daily": {
      const m = /^(\d{1,2}):(\d{2})$/.exec(schedule.timeLocal.trim());
      if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
      const target = new Date(fromMs);
      target.setHours(Number(m[1]), Number(m[2]), 0, 0);
      if (target.getTime() < fromMs) target.setDate(target.getDate() + 1);
      return target.getTime();
    }
    case "interval": {
      const every = Math.max(1, Math.round(schedule.everyMinutes));
      return fromMs + every * 60_000;
    }
  }
}

/** Human-readable schedule summary for UI/prompt use. */
export function describeSchedule(schedule: LoopSchedule): string {
  switch (schedule.kind) {
    case "once": {
      const at = new Date(schedule.at);
      return Number.isNaN(at.getTime()) ? "once" : `once at ${at.toLocaleString()}`;
    }
    case "daily":
      return `daily at ${schedule.timeLocal}`;
    case "interval":
      return `every ${schedule.everyMinutes} min`;
  }
}
