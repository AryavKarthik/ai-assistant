import { describe, it, expect } from "vitest";
import { velocityToWiggle, NEUTRAL_WIGGLE } from "./useOrbDragWiggle";

describe("velocityToWiggle", () => {
  it("is neutral at zero velocity", () => {
    expect(velocityToWiggle(0, 0)).toEqual(NEUTRAL_WIGGLE);
  });

  it("stretches along the axis of motion and squashes perpendicular", () => {
    const w = velocityToWiggle(0.5, 0);
    expect(w.scaleX).toBeGreaterThan(1);
    expect(w.scaleY).toBeLessThan(1);
    expect(w.rotate).toBeCloseTo(0);
  });

  it("rotate tracks the direction of motion", () => {
    const down = velocityToWiggle(0, 0.5);
    expect(down.rotate).toBeCloseTo(90);
    const left = velocityToWiggle(-0.5, 0);
    expect(Math.abs(left.rotate)).toBeCloseTo(180);
  });

  it("caps stretch so the orb never grows enough to clip its window", () => {
    const extreme = velocityToWiggle(50, 50);
    expect(extreme.scaleX).toBeLessThanOrEqual(1.16);
    expect(extreme.scaleY).toBeGreaterThanOrEqual(1 - 0.16 * 0.6 - 1e-9);
  });

  it("scales up smoothly with speed below the cap", () => {
    const slow = velocityToWiggle(0.001, 0);
    const fast = velocityToWiggle(0.002, 0);
    expect(fast.scaleX).toBeGreaterThan(slow.scaleX);
    expect(fast.scaleX).toBeLessThan(1.16);
  });
});
