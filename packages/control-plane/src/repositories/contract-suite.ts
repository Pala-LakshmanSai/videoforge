import type { EntityId, WorkspaceActorScope } from "./types.js";
import type { ControlPlaneRepositories } from "./unit-of-work.js";

export const REPOSITORY_CONTRACT_BEHAVIORS = [
  {
    id: "explicit-workspace-isolation",
    description: "Cross-workspace reads and parent/child bindings never leak or attach records.",
  },
  {
    id: "membership-authorization",
    description: "Authentication lookup resolves only a membership in the explicit workspace.",
  },
  {
    id: "avatar-publication-immutability",
    description:
      "Only READY publication moves the active pointer and the published payload is immutable.",
  },
  {
    id: "style-publication-immutability",
    description:
      "Only PUBLISHED publication moves the active pointer and the published payload is immutable.",
  },
  {
    id: "revision-lock-immutability",
    description: "Lock validates every pinned hash and rejects later revision mutation.",
  },
  {
    id: "content-address-binding",
    description: "Binary and canonical-document hashes remain distinct and workspace scoped.",
  },
  {
    id: "atomic-task-attempt-reservation",
    description: "Task, attempt, reservation, and dispatch outbox commit together or not at all.",
  },
  {
    id: "reservation-idempotency",
    description:
      "Stable retry keys replay identical writes and reject different input fingerprints.",
  },
  {
    id: "dispatch-ambiguity-is-not-completion",
    description: "Acknowledged or unknown dispatch never becomes an accepted task result.",
  },
  {
    id: "one-accepted-result",
    description:
      "Duplicate attempts remain visible while exactly one successful result may be accepted.",
  },
  {
    id: "append-only-monotonic-events",
    description: "Workflow and cost ledgers reject mutation and non-monotonic sequences.",
  },
  {
    id: "unit-of-work-rollback",
    description: "Typed failures and thrown faults leave no orphan durable rows.",
  },
  {
    id: "archive-preserves-lineage",
    description: "Soft archive removes new selection without destroying historical lineage.",
  },
] as const;

export type RepositoryContractBehavior = (typeof REPOSITORY_CONTRACT_BEHAVIORS)[number];
export type RepositoryContractBehaviorId = RepositoryContractBehavior["id"];

/** Each adapter factory returns fresh, pre-seeded, synthetic workspace state for one scenario. */
export interface RepositoryContractFixture {
  readonly primaryScope: WorkspaceActorScope;
  readonly secondaryScope: WorkspaceActorScope;
  readonly ids: Readonly<Record<string, EntityId>>;
}

export interface RepositoryContractAdapter {
  readonly repositories: ControlPlaneRepositories;
  readonly fixture: RepositoryContractFixture;
  dispose(): Promise<void>;
}

export interface RepositoryContractAdapterFactory {
  create(behavior: RepositoryContractBehavior): Promise<RepositoryContractAdapter>;
}

export interface RepositoryContractScenarioContext {
  readonly behavior: RepositoryContractBehavior;
  readonly repositories: ControlPlaneRepositories;
  readonly fixture: RepositoryContractFixture;
}

export interface RepositoryContractScenario {
  readonly behaviorId: RepositoryContractBehaviorId;
  run(context: RepositoryContractScenarioContext): Promise<void>;
}

/** Compatible with node:test, Vitest, or any runner that can register an async test callback. */
export interface RepositoryContractRegistrar {
  test(name: string, run: () => Promise<void>): void;
}

export interface RepositoryContractSuiteOptions {
  readonly name?: string;
  /** Keep true for adapter acceptance; false is useful for an intentionally focused local subset. */
  readonly requireCompleteCoverage?: boolean;
}

/**
 * Registers the same scenario functions against any adapter factory. A fresh adapter is created
 * and disposed for every behavior, so PGlite and Neon implementations cannot share accidental
 * state or silently skip a required semantic.
 */
export function registerRepositoryContractSuite(
  registrar: RepositoryContractRegistrar,
  adapterFactory: RepositoryContractAdapterFactory,
  scenarios: readonly RepositoryContractScenario[],
  options: RepositoryContractSuiteOptions = {},
): void {
  const scenarioById = new Map<RepositoryContractBehaviorId, RepositoryContractScenario>();
  for (const scenario of scenarios) {
    if (scenarioById.has(scenario.behaviorId)) {
      throw new Error(`duplicate repository contract scenario: ${scenario.behaviorId}`);
    }
    scenarioById.set(scenario.behaviorId, scenario);
  }

  const requireCompleteCoverage = options.requireCompleteCoverage ?? true;
  if (requireCompleteCoverage) {
    const missing = REPOSITORY_CONTRACT_BEHAVIORS.filter(
      (behavior) => !scenarioById.has(behavior.id),
    );
    if (missing.length > 0) {
      throw new Error(
        `repository contract suite is missing behaviors: ${missing
          .map((behavior) => behavior.id)
          .join(", ")}`,
      );
    }
  }

  const suiteName = options.name ?? "repository contract";
  for (const behavior of REPOSITORY_CONTRACT_BEHAVIORS) {
    const scenario = scenarioById.get(behavior.id);
    if (scenario === undefined) {
      continue;
    }
    registrar.test(`${suiteName}: ${behavior.id}`, async () => {
      const adapter = await adapterFactory.create(behavior);
      try {
        await scenario.run({
          behavior,
          repositories: adapter.repositories,
          fixture: adapter.fixture,
        });
      } finally {
        await adapter.dispose();
      }
    });
  }
}
