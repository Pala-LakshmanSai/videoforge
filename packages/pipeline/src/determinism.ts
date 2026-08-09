/** A caller-owned clock whose value is fixed or replayable for one pipeline operation. */
export interface PipelineClock {
  nowIso(): string;
}

/** Derives stable IDs from explicit inputs rather than global randomness or call order. */
export interface DeterministicIdFactory {
  idFor(namespace: string, stableKey: string): string;
}

/** Every nondeterministic input available to pure pipeline code. */
export interface DeterminismPorts {
  readonly clock: PipelineClock;
  readonly ids: DeterministicIdFactory;
}
