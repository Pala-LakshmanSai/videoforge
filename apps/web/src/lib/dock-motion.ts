export interface DockMotionTarget {
  influence: number;
  scale: number;
}

export interface DockSpringState {
  value: number;
  velocity: number;
}

export interface DockSpringConfig {
  damping: number;
  mass: number;
  stiffness: number;
}

export const dockSpringConfig: DockSpringConfig = {
  damping: 30,
  mass: 0.42,
  stiffness: 440,
};

const MAX_DISTANCE_PX = 240;
const MAX_SCALE = 1.75;

export function dockMotionTarget(distancePx: number, motionEnabled = true): DockMotionTarget {
  if (!motionEnabled || !Number.isFinite(distancePx)) {
    return { influence: 0, scale: 1 };
  }
  const distance = Math.max(0, Math.abs(distancePx));
  if (distance >= MAX_DISTANCE_PX) {
    return { influence: 0, scale: 1 };
  }

  // A raised-cosine curve gives the hovered icon, its immediate neighbors,
  // and the next neighbors progressively smaller magnification while all
  // farther icons remain exactly at their resting scale.
  const influence = (1 + Math.cos((Math.PI * distance) / MAX_DISTANCE_PX)) / 2;

  return {
    influence,
    scale: 1 + (MAX_SCALE - 1) * influence,
  };
}

export function stepDockSpring(
  state: DockSpringState,
  target: number,
  elapsedSeconds: number,
  config: DockSpringConfig = dockSpringConfig,
): DockSpringState {
  if (
    !Number.isFinite(state.value) ||
    !Number.isFinite(state.velocity) ||
    !Number.isFinite(target) ||
    !Number.isFinite(elapsedSeconds) ||
    elapsedSeconds <= 0
  ) {
    return { value: Number.isFinite(target) ? target : 0, velocity: 0 };
  }

  let value = state.value;
  let velocity = state.velocity;
  let remaining = Math.min(elapsedSeconds, 0.05);

  // Small semi-implicit substeps keep the physical response stable after a
  // briefly delayed animation frame without turning pointer movement into
  // layout work.
  while (remaining > 0) {
    const step = Math.min(remaining, 1 / 120);
    const acceleration =
      (config.stiffness * (target - value) - config.damping * velocity) / config.mass;
    velocity += acceleration * step;
    value += velocity * step;
    remaining -= step;
  }

  return { value, velocity };
}

export function dockSpringSettled(
  state: DockSpringState,
  target: number,
  positionTolerance = 0.002,
  velocityTolerance = 0.02,
): boolean {
  return (
    Math.abs(state.value - target) <= positionTolerance &&
    Math.abs(state.velocity) <= velocityTolerance
  );
}
