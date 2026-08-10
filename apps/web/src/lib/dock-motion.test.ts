import { describe, expect, it } from "vitest";

import { dockMotionTarget, dockSpringSettled, stepDockSpring } from "./dock-motion";

describe("dockMotionTarget", () => {
  it("produces a macOS-like center, neighbor, and far curve", () => {
    const center = dockMotionTarget(0);
    expect(center).toEqual({ influence: 1, scale: 1.75 });
    expect(dockMotionTarget(80).scale).toBeCloseTo(1.5625, 8);
    expect(dockMotionTarget(160).scale).toBeCloseTo(1.1875, 8);
    expect(dockMotionTarget(240)).toEqual({
      influence: 0,
      scale: 1,
    });
  });

  it("is symmetric and exposes scale only, with no translation channel", () => {
    const left = dockMotionTarget(-20);
    const right = dockMotionTarget(20);
    expect(left).toEqual(right);
    expect(Object.keys(left)).toEqual(["influence", "scale"]);
  });

  it("decreases monotonically to an exact neutral far-field scale", () => {
    const samples = [0, 40, 80, 120, 160, 200, 240].map(
      (distance) => dockMotionTarget(distance).scale,
    );
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]).toBeLessThan(samples[index - 1] ?? Number.POSITIVE_INFINITY);
    }
    expect(dockMotionTarget(1_000)).toEqual({ influence: 0, scale: 1 });
  });

  it("clamps invalid distances and disables magnification for reduced motion", () => {
    expect(dockMotionTarget(Number.NaN)).toEqual({
      influence: 0,
      scale: 1,
    });
    expect(dockMotionTarget(0, false)).toEqual({
      influence: 0,
      scale: 1,
    });
  });
});

describe("dock spring", () => {
  it("approaches a new target with continuous velocity instead of jumping", () => {
    const first = stepDockSpring({ value: 1, velocity: 0 }, 1.75, 1 / 60);
    expect(first.value).toBeGreaterThan(1);
    expect(first.value).toBeLessThan(1.75);
    expect(first.velocity).toBeGreaterThan(0);

    const redirected = stepDockSpring(first, 1.1, 1 / 60);
    expect(redirected.value).not.toBe(1.1);
    expect(Math.abs(redirected.value - first.value)).toBeLessThan(0.2);
  });

  it("settles snappily at the target after repeated animation frames", () => {
    let spring = { value: 1, velocity: 0 };
    for (let frame = 0; frame < 120; frame += 1) {
      spring = stepDockSpring(spring, 1.75, 1 / 60);
    }
    expect(spring.value).toBeCloseTo(1.75, 3);
    expect(dockSpringSettled(spring, 1.75)).toBe(true);
  });

  it("fails closed to a finite neutral value for invalid timing", () => {
    expect(stepDockSpring({ value: 1, velocity: 0 }, 1.5, Number.NaN)).toEqual({
      value: 1.5,
      velocity: 0,
    });
  });
});
