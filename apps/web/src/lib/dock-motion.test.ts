import { describe, expect, it } from "vitest";

import { dockMotionTarget, dockSpringSettled, stepDockSpring } from "./dock-motion";

describe("dockMotionTarget", () => {
  it("produces a macOS-like center, neighbor, and far curve", () => {
    const center = dockMotionTarget(0);
    expect(center.scale).toBeCloseTo(1.88, 8);
    expect(center).toMatchObject({ liftPx: -32, shiftPx: 0 });
    expect(dockMotionTarget(100).scale).toBeCloseTo(1.45, 2);
    expect(dockMotionTarget(100).shiftPx).toBeLessThan(-13);
    expect(dockMotionTarget(-100).shiftPx).toBeGreaterThan(13);
    expect(dockMotionTarget(200).scale).toBeCloseTo(1.23, 2);
    expect(dockMotionTarget(340)).toEqual({
      influence: 0,
      liftPx: 0,
      scale: 1,
      shiftPx: 0,
    });
  });

  it("clamps invalid distances and disables movement for reduced motion", () => {
    const left = dockMotionTarget(-20);
    const right = dockMotionTarget(20);
    expect(left.influence).toBe(right.influence);
    expect(left.liftPx).toBe(right.liftPx);
    expect(left.scale).toBe(right.scale);
    expect(left.shiftPx).toBe(-right.shiftPx);
    expect(dockMotionTarget(Number.NaN)).toEqual({
      influence: 0,
      liftPx: 0,
      scale: 1,
      shiftPx: 0,
    });
    expect(dockMotionTarget(0, false)).toEqual({
      influence: 0,
      liftPx: 0,
      scale: 1,
      shiftPx: 0,
    });
  });
});

describe("dock spring", () => {
  it("approaches a new target with continuous velocity instead of jumping", () => {
    const first = stepDockSpring({ value: 1, velocity: 0 }, 1.88, 1 / 60);
    expect(first.value).toBeGreaterThan(1);
    expect(first.value).toBeLessThan(1.88);
    expect(first.velocity).toBeGreaterThan(0);

    const redirected = stepDockSpring(first, 1.1, 1 / 60);
    expect(redirected.value).not.toBe(1.1);
    expect(Math.abs(redirected.value - first.value)).toBeLessThan(0.2);
  });

  it("settles snappily at the target after repeated animation frames", () => {
    let spring = { value: 1, velocity: 0 };
    for (let frame = 0; frame < 120; frame += 1) {
      spring = stepDockSpring(spring, 1.88, 1 / 60);
    }
    expect(spring.value).toBeCloseTo(1.88, 3);
    expect(dockSpringSettled(spring, 1.88)).toBe(true);
  });

  it("fails closed to a finite neutral value for invalid timing", () => {
    expect(stepDockSpring({ value: 1, velocity: 0 }, 1.5, Number.NaN)).toEqual({
      value: 1.5,
      velocity: 0,
    });
  });
});
