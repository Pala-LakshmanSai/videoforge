import { describe, expect, it } from "vitest";

import { dockMotionTarget } from "./dock-motion";

describe("dockMotionTarget", () => {
  it("produces a macOS-like center, neighbor, and far curve", () => {
    const center = dockMotionTarget(0);
    expect(center.scale).toBeCloseTo(1.68, 8);
    expect(center).toMatchObject({ liftPx: -26, shiftPx: 0 });
    expect(dockMotionTarget(100).scale).toBeCloseTo(1.35, 2);
    expect(dockMotionTarget(100).shiftPx).toBeLessThan(-12);
    expect(dockMotionTarget(-100).shiftPx).toBeGreaterThan(12);
    expect(dockMotionTarget(200).scale).toBeCloseTo(1.18, 2);
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
