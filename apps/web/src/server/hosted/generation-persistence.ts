import type { HostedGenerationPersistence } from "./generation-coordinator";

/**
 * Hosted Neon does not yet implement the control-plane timing repositories used by
 * DurableLocalTranscriptionPersistence and DurableDeterministicTimelinePersistence.
 * Keep this boundary explicit and fail closed: generation timing must never be hidden in an audit
 * JSON blob or represented by a promotable queue row before canonical timing persistence exists.
 */
export class HostedCanonicalTimingPersistenceUnavailable extends Error {
  readonly code = "HOSTED_CANONICAL_TIMING_PERSISTENCE_UNAVAILABLE";

  constructor() {
    super("HOSTED_CANONICAL_TIMING_PERSISTENCE_UNAVAILABLE");
    this.name = "HostedCanonicalTimingPersistenceUnavailable";
  }
}

export function unavailableHostedGenerationPersistence(): HostedGenerationPersistence {
  return Object.freeze({
    async persistProviderInertPlan(): Promise<never> {
      throw new HostedCanonicalTimingPersistenceUnavailable();
    },
  });
}
