import { describe, it, expect } from "vitest";
import { velocityToWiggle, NEUTRAL_WIGGLE } from "./useOrbDragWiggle";

describe("velocityToWiggle", () => {
  it("is neutral at zero velocity", () => {
    expect(velocityToWiggle(0, 0)).toEqual(NEUTRAL_WIGGLE);
  });

  it("stretches along the axis of motion and squashes perpendicular", () => {
    const horizontal = velocityToWiggle(0.5, 0);
    expect(horizontal.scaleX).toBeGreaterThan(1);
    expect(horizontal.scaleY).toBeLessThan(1);

    const vertical = velocityToWiggle(0, 0.5);
    expect(vertical.scaleY).toBeGreaterThan(1);
    expect(vertical.scaleX).toBeLessThan(1);
  });

  it("never rotates — atan2 flapping between ±180° on leftward drags used to spin the orb", () => {
    expect(velocityToWiggle(-0.5, 0.001).rotate).toBe(0);
    expect(velocityToWiggle(-0.5, -0.001).rotate).toBe(0);
    expect(velocityToWiggle(0.3, 0.4).rotate).toBe(0);
  });

  it("is symmetric for opposite directions along the same axis", () => {
    expect(velocityToWiggle(-0.5, 0)).toEqual(velocityToWiggle(0.5, 0));
    expect(velocityToWiggle(0, -0.5)).toEqual(velocityToWiggle(0, 0.5));
  });

  it("caps stretch so the orb never grows enough to clip its window", () => {
    const extreme = velocityToWiggle(50, 0);
    expect(extreme.scaleX).toBeLessThanOrEqual(1.16);
    const extremeDiag = velocityToWiggle(50, 50);
    expect(extremeDiag.scaleX).toBeLessThanOrEqual(1.16);
    expect(extremeDiag.scaleY).toBeLessThanOrEqual(1.16);
  });

  it("scales up smoothly with speed below the cap", () => {
    const slow = velocityToWiggle(0.001, 0);
    const fast = velocityToWiggle(0.002, 0);
    expect(fast.scaleX).toBeGreaterThan(slow.scaleX);
    expect(fast.scaleX).toBeLessThan(1.16);
  });
});
