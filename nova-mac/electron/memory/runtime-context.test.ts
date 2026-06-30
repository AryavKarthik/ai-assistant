import { describe, it, expect } from "vitest";
import { buildClockForZone, formatRuntimeClockForPrompt } from "./runtime-context";

describe("buildClockForZone", () => {
  it("returns structured clock for a valid timezone", () => {
    const date = new Date("2026-07-01T09:00:00Z");
    const clock = buildClockForZone("Australia/Sydney", date);
    expect(clock.timezone).toBe("Australia/Sydney");
    expect(clock.iso).toBe(date.toISOString());
    expect(clock.localDate).toBeTruthy();
    expect(clock.localTime).toBeTruthy();
  });
});

describe("formatRuntimeClockForPrompt", () => {
  it("produces a runtime_context XML block", () => {
    const date = new Date("2026-07-01T09:00:00Z");
    const clock = buildClockForZone("UTC", date);
    const prompt = formatRuntimeClockForPrompt(clock);
    expect(prompt).toContain("<runtime_context>");
    expect(prompt).toContain("</runtime_context>");
    expect(prompt).toContain("Now:");
  });
});
