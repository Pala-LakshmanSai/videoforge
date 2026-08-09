export interface DockMotionTarget {
  influence: number;
  liftPx: number;
  scale: number;
}

const MAX_DISTANCE_PX = 300;

export function dockMotionTarget(distancePx: number, motionEnabled = true): DockMotionTarget {
  if (!motionEnabled || !Number.isFinite(distancePx)) {
    return { influence: 0, liftPx: 0, scale: 1 };
  }
  const distance = Math.max(0, Math.abs(distancePx));
  if (distance >= MAX_DISTANCE_PX) return { influence: 0, liftPx: 0, scale: 1 };
  const influence = Math.exp(-distance / 118);
  return {
    influence,
    liftPx: -14 * influence,
    scale: 1 + 0.42 * influence,
  };
}
