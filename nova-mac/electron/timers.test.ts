import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TimerManager, type ActiveTimer } from "./timers";

describe("TimerManager", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires the callback with the timer after the duration", () => {
    const fired: ActiveTimer[] = [];
    const mgr = new TimerManager((t) => fired.push(t));
    mgr.set("Pasta", 5000);

    vi.advanceTimersByTime(4999);
    expect(fired).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(fired).toHaveLength(1);
    expect(fired[0]!.label).toBe("Pasta");
    expect(mgr.list()).toHaveLength(0);
  });

  it("lists timers sorted by fire time", () => {
    const mgr = new TimerManager(() => {});
    mgr.set("Later", 10_000);
    mgr.set("Soon", 1000);
    expect(mgr.list().map((t) => t.label)).toEqual(["Soon", "Later"]);
  });

  it("cancel removes one timer and prevents its firing", () => {
    const fired: ActiveTimer[] = [];
    const mgr = new TimerManager((t) => fired.push(t));
    const t = mgr.set("Nope", 1000);
    expect(mgr.cancel(t.id)).toBe(true);
    expect(mgr.cancel(t.id)).toBe(false);
    vi.advanceTimersByTime(2000);
    expect(fired).toHaveLength(0);
  });

  it("cancelAll clears everything and reports the count", () => {
    const mgr = new TimerManager(() => {});
    mgr.set("a", 1000);
    mgr.set("b", 2000);
    expect(mgr.cancelAll()).toBe(2);
    expect(mgr.list()).toHaveLength(0);
  });
});
