import assert from "node:assert/strict";
import test from "node:test";

import { developmentOwnershipFailures, developmentOwnershipSchema } from "../dev-ownership.mjs";

function ownedSnapshot() {
  const health = {
    app: "videoforge",
    status: "ok",
    commit: "abc1234",
    mode: "fixture",
    provider_calls_authorized: false,
    authorized_spend_usd: 0,
  };
  return {
    state: {
      schemaVersion: developmentOwnershipSchema,
      repositoryRoot: process.cwd(),
      supervisorPid: 1200,
      commit: "abc1234",
      mode: "fixture",
    },
    supervisorAlive: true,
    supervisorCommand: "node scripts/dev.mjs",
    webOwner: { pid: 1201 },
    apiOwner: { pid: 1202 },
    webOwned: true,
    apiOwned: true,
    webHealth: health,
    apiHealth: { ...health },
  };
}

test("owned development pair is the only valid stop target", () => {
  assert.deepEqual(developmentOwnershipFailures(ownedSnapshot()), []);
});

test("foreign listener and stale health fail without selecting a stop target", () => {
  const snapshot = ownedSnapshot();
  snapshot.webOwned = false;
  snapshot.apiHealth = { ...snapshot.apiHealth, commit: "different" };
  assert.deepEqual(developmentOwnershipFailures(snapshot), [
    "port 4173 listener is outside the recorded process tree",
    "api health does not match recorded provider-free identity",
  ]);
});

test("stale supervisor identity and incomplete ports fail closed", () => {
  const snapshot = ownedSnapshot();
  snapshot.supervisorAlive = false;
  snapshot.supervisorCommand = "node foreign.mjs";
  snapshot.apiOwner = null;
  assert.deepEqual(developmentOwnershipFailures(snapshot), [
    "recorded supervisor is not running",
    "recorded supervisor command is not VideoForge dev",
    "strict port pair is incomplete",
  ]);
});
