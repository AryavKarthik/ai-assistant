import { describe, it, expect } from "vitest";
import { parseHHMM, isWithinQuietHours } from "./quiet-hours";

describe("parseHHMM", () => {
  it("parses valid times", () => {
    expect(parseHHMM("00:00")).toBe(0);
    expect(parseHHMM("08:30")).toBe(510);
    expect(parseHHMM("23:59")).toBe(1439);
    expect(parseHHMM(" 9:05 ")).toBe(545);
  });

  it("rejects malformed input", () => {
    expect(parseHHMM("24:00")).toBeNull();
    expect(parseHHMM("12:60")).toBeNull();
    expect(parseHHMM("noon")).toBeNull();
    expect(parseHHMM("")).toBeNull();
  });
});

describe("isWithinQuietHours", () => {
  it("handles a same-day window", () => {
    expect(isWithinQuietHours(13 * 60, "12:00", "14:00")).toBe(true);
    expect(isWithinQuietHours(12 * 60, "12:00", "14:00")).toBe(true); // start inclusive
    expect(isWithinQuietHours(14 * 60, "12:00", "14:00")).toBe(false); // end exclusive
    expect(isWithinQuietHours(11 * 60, "12:00", "14:00")).toBe(false);
  });

  it("handles a window wrapping midnight", () => {
    expect(isWithinQuietHours(23 * 60, "22:00", "08:00")).toBe(true);
    expect(isWithinQuietHours(3 * 60, "22:00", "08:00")).toBe(true);
    expect(isWithinQuietHours(8 * 60, "22:00", "08:00")).toBe(false);
    expect(isWithinQuietHours(12 * 60, "22:00", "08:00")).toBe(false);
  });

  it("treats equal start/end and malformed values as never quiet", () => {
    expect(isWithinQuietHours(600, "10:00", "10:00")).toBe(false);
    expect(isWithinQuietHours(600, "bad", "08:00")).toBe(false);
  });
});
