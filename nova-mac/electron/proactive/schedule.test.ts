import { describe, it, expect } from "vitest";
import { computeNextRun, describeSchedule } from "./schedule";

describe("computeNextRun", () => {
  it("once: returns the scheduled instant (even slightly past)", () => {
    const at = new Date("2026-07-05T10:30:00").getTime();
    expect(computeNextRun({ kind: "once", at: new Date(at).toISOString() }, at - 60_000)).toBe(at);
    expect(computeNextRun({ kind: "once", at: new Date(at).toISOString() }, at + 60_000)).toBe(at);
  });

  it("once: null for garbage dates", () => {
    expect(computeNextRun({ kind: "once", at: "not a date" }, Date.now())).toBeNull();
  });

  it("daily: today when the time is still ahead, tomorrow otherwise", () => {
    const from = new Date(2026, 6, 5, 9, 0, 0, 0).getTime(); // 09:00 local
    const today = computeNextRun({ kind: "daily", timeLocal: "10:30" }, from);
    expect(new Date(today!).getHours()).toBe(10);
    expect(new Date(today!).getDate()).toBe(5);

    const tomorrow = computeNextRun({ kind: "daily", timeLocal: "08:00" }, from);
    expect(new Date(tomorrow!).getHours()).toBe(8);
    expect(new Date(tomorrow!).getDate()).toBe(6);
  });

  it("daily: exact-time boundary runs now, not in 24h", () => {
    const from = new Date(2026, 6, 5, 10, 30, 0, 0).getTime();
    expect(computeNextRun({ kind: "daily", timeLocal: "10:30" }, from)).toBe(from);
  });

  it("daily: null for malformed times", () => {
    expect(computeNextRun({ kind: "daily", timeLocal: "25:99" }, Date.now())).toBeNull();
  });

  it("interval: adds the period, clamped to at least a minute", () => {
    const from = 1_000_000;
    expect(computeNextRun({ kind: "interval", everyMinutes: 30 }, from)).toBe(from + 30 * 60_000);
    expect(computeNextRun({ kind: "interval", everyMinutes: 0 }, from)).toBe(from + 60_000);
  });
});

describe("describeSchedule", () => {
  it("summarizes each kind", () => {
    expect(describeSchedule({ kind: "daily", timeLocal: "08:00" })).toBe("daily at 08:00");
    expect(describeSchedule({ kind: "interval", everyMinutes: 15 })).toBe("every 15 min");
    expect(describeSchedule({ kind: "once", at: "garbage" })).toBe("once");
  });
});
