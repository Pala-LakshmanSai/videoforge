import { describe, expect, it } from "vitest";

import { dockMotionTarget } from "./dock-motion";

describe("dockMotionTarget", () => {
  it("produces a macOS-like center, neighbor, and far curve", () => {
    expect(dockMotionTarget(0)).toMatchObject({ scale: 1.42, liftPx: -14 });
    expect(dockMotionTarget(100).scale).toBeCloseTo(1.18, 1);
    expect(dockMotionTarget(200).scale).toBeCloseTo(1.08, 1);
    expect(dockMotionTarget(300)).toEqual({ influence: 0, liftPx: 0, scale: 1 });
  });

  it("clamps invalid distances and disables movement for reduced motion", () => {
    expect(dockMotionTarget(-20)).toEqual(dockMotionTarget(20));
    expect(dockMotionTarget(Number.NaN)).toEqual({ influence: 0, liftPx: 0, scale: 1 });
    expect(dockMotionTarget(0, false)).toEqual({ influence: 0, liftPx: 0, scale: 1 });
  });
});
