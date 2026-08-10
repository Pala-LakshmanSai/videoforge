import assert from "node:assert/strict";
import test from "node:test";

import {
  registerRepositoryContractSuite,
  REPOSITORY_CONTRACT_BEHAVIORS,
} from "../dist/src/index.js";
import { IDS } from "./support/fixtures.mjs";

function createFixture() {
  return Object.freeze({
    primaryScope: Object.freeze({ workspaceId: IDS.workspaceA, actorUserId: IDS.userA }),
    secondaryScope: Object.freeze({ workspaceId: IDS.workspaceB, actorUserId: IDS.userB }),
    ids: Object.freeze({ primaryProject: IDS.projectA, secondaryProject: IDS.projectB }),
  });
}

test("the reusable repository contract registry is complete, unique, and adapter-neutral", async () => {
  const ids = REPOSITORY_CONTRACT_BEHAVIORS.map((behavior) => behavior.id);
  assert.equal(ids.length, 13);
  assert.equal(new Set(ids).size, ids.length);

  const registrations = [];
  const created = [];
  const disposed = [];
  const exercised = [];
  const registrar = {
    test(name, run) {
      registrations.push({ name, run });
    },
  };
  const factory = {
    async create(behavior) {
      created.push(behavior.id);
      return {
        repositories: Object.freeze({ adapter: "owned-synthetic" }),
        fixture: createFixture(),
        async dispose() {
          disposed.push(behavior.id);
        },
      };
    },
  };
  const scenarios = REPOSITORY_CONTRACT_BEHAVIORS.map((behavior) => ({
    behaviorId: behavior.id,
    async run(context) {
      assert.equal(context.behavior.id, behavior.id);
      assert.equal(context.fixture.primaryScope.workspaceId, IDS.workspaceA);
      exercised.push(behavior.id);
    },
  }));

  registerRepositoryContractSuite(registrar, factory, scenarios, { name: "owned adapter" });
  assert.deepEqual(
    registrations.map((registration) => registration.name),
    ids.map((id) => `owned adapter: ${id}`),
  );
  for (const registration of registrations) {
    await registration.run();
  }
  assert.deepEqual(created, ids);
  assert.deepEqual(exercised, ids);
  assert.deepEqual(disposed, ids);
});

test("the repository contract registrar rejects missing and duplicate behavior coverage", () => {
  const registrar = { test() {} };
  const factory = { async create() {} };
  const first = REPOSITORY_CONTRACT_BEHAVIORS[0];
  const scenario = { behaviorId: first.id, async run() {} };

  assert.throws(
    () => registerRepositoryContractSuite(registrar, factory, []),
    /repository contract suite is missing behaviors/,
  );
  assert.throws(
    () => registerRepositoryContractSuite(registrar, factory, [scenario, scenario]),
    /duplicate repository contract scenario/,
  );
});

test("the repository contract harness always disposes a fresh failing adapter", async () => {
  const registrations = [];
  let disposed = 0;
  const registrar = {
    test(name, run) {
      registrations.push({ name, run });
    },
  };
  const factory = {
    async create() {
      return {
        repositories: Object.freeze({ adapter: "owned-synthetic" }),
        fixture: createFixture(),
        async dispose() {
          disposed += 1;
        },
      };
    },
  };
  const behaviorId = REPOSITORY_CONTRACT_BEHAVIORS[0].id;
  registerRepositoryContractSuite(
    registrar,
    factory,
    [{ behaviorId, async run() { throw new Error("owned scenario failure"); } }],
    { requireCompleteCoverage: false },
  );

  assert.equal(registrations.length, 1);
  await assert.rejects(registrations[0].run(), /owned scenario failure/);
  assert.equal(disposed, 1);
});
