import { describe, it, expect, vi, afterEach } from "vitest";
import { SpeechGate, measureSpeechBandLevel } from "./vad";

afterEach(() => vi.useRealTimers());

describe("measureSpeechBandLevel", () => {
  it("averages the speech band bins and normalizes to 0..1", () => {
    const data = new Uint8Array(32).fill(255);
    expect(measureSpeechBandLevel(data)).toBeCloseTo(1, 5);
  });
  it("returns 0 for silence", () => {
    expect(measureSpeechBandLevel(new Uint8Array(32))).toBe(0);
  });
});

describe("SpeechGate", () => {
  it("calibrates then confirms sustained speech and reports silence", () => {
    vi.useFakeTimers();
    const gate = new SpeechGate({ calibrateMs: 100, speechHoldMs: 200 });
    // During calibration, no confirmation.
    expect(gate.push(0.02)).toBe(false);
    vi.advanceTimersByTime(120);
    expect(gate.push(0.02)).toBe(false); // ends calibration on this push
    expect(gate.isCalibrated()).toBe(true);
    // Sustained loud speech above threshold for >= speechHoldMs confirms.
    gate.push(0.9);
    vi.advanceTimersByTime(250);
    expect(gate.push(0.9)).toBe(true);
    expect(gate.confirmed).toBe(true);
    // After confirmation, msSinceLastSound grows once input drops.
    vi.advanceTimersByTime(300);
    expect(gate.msSinceLastSound()).toBeGreaterThan(0);
  });
});
