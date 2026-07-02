import { describe, it, expect, vi } from "vitest";

const displays = [
  { bounds: { x: 0, y: 0, width: 1440, height: 900 } },
  { bounds: { x: 1440, y: 0, width: 1920, height: 1080 } },
];

vi.mock("electron", () => ({
  screen: {
    getAllDisplays: () => displays,
  },
  BrowserWindow: class {},
}));

import { isPointOnAnyDisplay } from "./window";

describe("isPointOnAnyDisplay", () => {
  it("is true for a point inside the primary display", () => {
    expect(isPointOnAnyDisplay({ x: 100, y: 100 })).toBe(true);
  });

  it("is true for a point inside a secondary display", () => {
    expect(isPointOnAnyDisplay({ x: 2000, y: 500 })).toBe(true);
  });

  it("is false for a point off every display (e.g. unplugged monitor)", () => {
    expect(isPointOnAnyDisplay({ x: 5000, y: 5000 })).toBe(false);
    expect(isPointOnAnyDisplay({ x: -100, y: -100 })).toBe(false);
  });

  it("treats the right/bottom edge as exclusive", () => {
    expect(isPointOnAnyDisplay({ x: 1440, y: 0 })).toBe(true); // start of display 2
    expect(isPointOnAnyDisplay({ x: 3360, y: 0 })).toBe(false); // exactly past display 2's right edge
  });
});
