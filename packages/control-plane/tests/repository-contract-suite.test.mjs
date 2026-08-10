import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_REPOSITORY_CONTRACT_SCENARIOS,
  registerRepositoryContractSuite,
  REPOSITORY_CONTRACT_BEHAVIORS,
  RepositoryContractAssertionError,
} from "../dist/src/index.js";
import { IDS } from "./support/fixtures.mjs";

const REVISION_LOOKUP = Object.freeze({
  projectId: IDS.projectA,
  revisionId: IDS.projectRevisionA,
});

function createWorkspaceIsolationFixture() {
  return Object.freeze({
    behaviorId: "explicit-workspace-isolation",
    primaryScope: Object.freeze({ workspaceId: IDS.workspaceA, actorUserId: IDS.userA }),
    secondaryScope: Object.freeze({ workspaceId: IDS.workspaceB, actorUserId: IDS.userB }),
    revisionLookup: REVISION_LOOKUP,
  });
}

function createRevision(workspaceId) {
  return Object.freeze({
    projectId: IDS.projectA,
    revisionId: IDS.projectRevisionA,
    workspaceId,
  });
}

function createWorkspaceRepositories(observedScopes = []) {
  return Object.freeze({
    projects: Object.freeze({
      async resolveExactRevision(scope, lookup) {
        observedScopes.push(scope.workspaceId);
        assert.deepEqual(lookup, REVISION_LOOKUP);
        if (scope.workspaceId === IDS.workspaceA) {
          return { ok: true, value: createRevision(IDS.workspaceA) };
        }
        return {
          ok: false,
          kind: "NOT_FOUND",
          entity: "PROJECT_REVISION",
          id: lookup.revisionId,
        };
      },
    }),
  });
}

function registerSuite(factory, name = "owned adapter") {
  const registrations = [];
  registerRepositoryContractSuite(
    {
      test(testName, run) {
        registrations.push({ name: testName, run });
      },
    },
    factory,
    { name },
  );
  return registrations;
}

test("the exported canonical repository scenarios are complete, unique, and immutable", () => {
  const behaviorIds = REPOSITORY_CONTRACT_BEHAVIORS.map((behavior) => behavior.id);
  const scenarioIds = CANONICAL_REPOSITORY_CONTRACT_SCENARIOS.map(
    (scenario) => scenario.behaviorId,
  );

  assert.equal(behaviorIds.length, 13);
  assert.equal(new Set(behaviorIds).size, behaviorIds.length);
  assert.deepEqual(scenarioIds, behaviorIds);
  assert.equal(new Set(scenarioIds).size, scenarioIds.length);
  assert.equal(Object.isFrozen(REPOSITORY_CONTRACT_BEHAVIORS), true);
  assert.equal(REPOSITORY_CONTRACT_BEHAVIORS.every((behavior) => Object.isFrozen(behavior)), true);
  assert.equal(Object.isFrozen(CANONICAL_REPOSITORY_CONTRACT_SCENARIOS), true);
  assert.equal(
    CANONICAL_REPOSITORY_CONTRACT_SCENARIOS.every((scenario) => Object.isFrozen(scenario)),
    true,
  );
  assert.equal(registerRepositoryContractSuite.length, 2);
});

test("the harness registers and runs the canonical workspace-isolation body unchanged", async () => {
  const created = [];
  const disposed = [];
  const observedScopes = [];
  const factory = {
    async create(behavior) {
      created.push(behavior.id);
      return {
        repositories: createWorkspaceRepositories(observedScopes),
        fixture: createWorkspaceIsolationFixture(),
        async dispose() {
          disposed.push(behavior.id);
        },
      };
    },
  };

  const registrations = registerSuite(factory);
  assert.deepEqual(
    registrations.map((registration) => registration.name),
    REPOSITORY_CONTRACT_BEHAVIORS.map((behavior) => `owned adapter: ${behavior.id}`),
  );
  assert.equal(registrations.length, 13);

  await registrations[0].run();
  assert.deepEqual(created, ["explicit-workspace-isolation"]);
  assert.deepEqual(observedScopes, [IDS.workspaceA, IDS.workspaceB]);
  assert.deepEqual(disposed, ["explicit-workspace-isolation"]);
});

test("every fixed canonical runner has wiring/dispatch coverage and is disposed", async () => {
  // Full semantic execution begins when VF-1-02 supplies the first concrete repository adapter.
  const disposed = [];
  const registrations = registerSuite(
    {
      async create(behavior) {
        return {
          repositories: createWorkspaceRepositories(),
          fixture: createWorkspaceIsolationFixture(),
          async dispose() {
            disposed.push(behavior.id);
          },
        };
      },
    },
    "binding proof",
  );

  await registrations[0].run();
  for (const registration of registrations.slice(1)) {
    await assert.rejects(
      registration.run(),
      (error) =>
        error instanceof RepositoryContractAssertionError &&
        /fixture behavior ID/.test(error.message),
    );
  }
  assert.deepEqual(
    disposed,
    REPOSITORY_CONTRACT_BEHAVIORS.map((behavior) => behavior.id),
  );
});

test("a leaking adapter fails the canonical assertion and is still disposed", async () => {
  let disposed = 0;
  const factory = {
    async create() {
      return {
        repositories: Object.freeze({
          projects: Object.freeze({
            async resolveExactRevision() {
              return { ok: true, value: createRevision(IDS.workspaceA) };
            },
          }),
        }),
        fixture: createWorkspaceIsolationFixture(),
        async dispose() {
          disposed += 1;
        },
      };
    },
  };

  const registrations = registerSuite(factory, "leaking adapter");
  await assert.rejects(
    registrations[0].run(),
    (error) =>
      error instanceof RepositoryContractAssertionError &&
      /cross-workspace revision lookup unexpectedly succeeded/.test(error.message),
  );
  assert.equal(disposed, 1);
});
