export interface DockMotionTarget {
  influence: number;
  liftPx: number;
  scale: number;
  shiftPx: number;
}

const MAX_DISTANCE_PX = 340;

function smoothstep(start: number, end: number, value: number): number {
  const normalized = Math.min(1, Math.max(0, (value - start) / (end - start)));
  return normalized * normalized * (3 - 2 * normalized);
}

export function dockMotionTarget(distancePx: number, motionEnabled = true): DockMotionTarget {
  if (!motionEnabled || !Number.isFinite(distancePx)) {
    return { influence: 0, liftPx: 0, scale: 1, shiftPx: 0 };
  }
  const distance = Math.max(0, Math.abs(distancePx));
  if (distance >= MAX_DISTANCE_PX) {
    return { influence: 0, liftPx: 0, scale: 1, shiftPx: 0 };
  }

  const edgeFade = 1 - smoothstep(240, MAX_DISTANCE_PX, distance);
  const influence = Math.exp(-distance / 150) * edgeFade;
  const direction = Math.sign(distancePx);
  const separation = Math.min(1, distance / 80);

  return {
    influence,
    liftPx: -26 * influence,
    scale: 1 + 0.68 * influence,
    shiftPx: direction === 0 ? 0 : -direction * 22 * influence ** 0.75 * separation,
  };
}
