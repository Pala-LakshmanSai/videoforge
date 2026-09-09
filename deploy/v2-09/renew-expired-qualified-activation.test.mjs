import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import {
  canonicalRenewalJson,
  executeRenewExpiredQualifiedActivation,
  renewalSha256,
} from "./renew-expired-qualified-activation.mjs";

const H = (character) => `sha256:${character.repeat(64)}`;
const U = (character) =>
  `${character.repeat(8)}-${character.repeat(4)}-4${character.repeat(3)}-8${character.repeat(3)}-${character.repeat(12)}`;
const NOW = new Date("2026-09-09T12:00:00.000Z");
const volume = {
  mage_image: {
    volumeIdSha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
    volumeManifestSha256: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  },
  soulx_avatar: {
    volumeIdSha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    volumeManifestSha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
  },
};

function documentSha256(value) {
  return renewalSha256(canonicalRenewalJson(value));
}

function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "v209-renewal-"));
  chmodSync(root, 0o700);
  const credentialPath = resolve(root, "database.url");
  writeFileSync(
    credentialPath,
    "postgresql://operator:secret@db.example.test/videoforge?sslmode=require&channel_binding=require\n",
    { mode: 0o600 },
  );
  const observedAt = "2026-09-09T11:58:00.000Z";
  const lane = (deploymentId, snapshot) => ({
    deploymentId,
    deploymentSnapshotSha256: snapshot,
    isActive: true,
    retainedActiveWorkers: 0,
    workerCountMax: 1,
    workerCountMin: 0,
  });
  const inventoryEvidence = {
    cloudflareVersionIdSha256: H("b"),
    deployedConfigSha256: H("c"),
    lanes: {
      mage_image: lane(U("4"), H("d")),
      soulx_avatar: lane(U("5"), H("e")),
    },
    observationKind: "READ_ONLY_PROVIDER_INVENTORY",
    observedAt,
    providerActionsCreated: 0,
    providerMutationObserved: false,
    readbackSha256: H("f"),
    schemaVersion: "videoforge.hosted-v209-read-only-provider-inventory/v1",
    sourceCommit: "a".repeat(40),
  };
  const payload = {
    activationId: U("3"),
    cloudflareVersionIdSha256: H("b"),
    deployedConfigSha256: H("c"),
    inventoryEvidence,
    inventoryEvidenceSha256: documentSha256(inventoryEvidence),
    lanes: {
      mage_image: {
        deploymentId: U("4"),
        previousQualificationId: U("6"),
        qualificationId: U("7"),
      },
      soulx_avatar: {
        deploymentId: U("5"),
        previousQualificationId: U("8"),
        qualificationId: U("9"),
      },
    },
    previousActivationId: U("2"),
    readbackSha256: H("f"),
    refreshId: U("1"),
    schemaVersion: "videoforge.hosted-v209-expired-qualification-refresh/v1",
    sourceCommit: "a".repeat(40),
  };
  const cloudflareReadback = {
    deployedConfigSha256: H("c"),
    observedAt,
    readbackSha256: H("f"),
    sourceCommit: "a".repeat(40),
    sourceSha256: H("a"),
    versionIdSha256: H("b"),
    workerName: "videoforge-production-runtime",
  };
  const retainedBindings = Object.fromEntries(
    Object.entries(volume).map(([name, identity]) => [
      name,
      {
        deploymentId: payload.lanes[name].deploymentId,
        deploymentSnapshotSha256: inventoryEvidence.lanes[name].deploymentSnapshotSha256,
        ...identity,
      },
    ]),
  );
  const input = {
    cloudflareReadback,
    cloudflareReadbackSha256: documentSha256(cloudflareReadback),
    databaseCredentialPath: credentialPath,
    expiresAt: "2026-09-10T11:55:00.000Z",
    issuedAt: "2026-09-09T11:57:00.000Z",
    journalPath: resolve(root, "renewal-journal.jsonl"),
    payload,
    retainedBindings,
    schemaVersion: "videoforge.v2-09-expired-qualified-activation-renewal-operator/v1",
  };
  const inputPath = resolve(root, "input.json");
  const save = () => {
    writeFileSync(inputPath, `${JSON.stringify(input)}\n`, { mode: 0o600 });
    return renewalSha256(readFileSync(inputPath));
  };
  const result = {
    activationId: payload.activationId,
    inventoryEvidenceSha256: payload.inventoryEvidenceSha256,
    mageQualificationId: payload.lanes.mage_image.qualificationId,
    providerActionsCreated: 0,
    qualificationExpiresAt: "2026-09-10T12:00:00.000Z",
    refreshId: payload.refreshId,
    replayed: false,
    schemaVersion: "videoforge.hosted-v209-expired-qualification-refresh-result/v1",
    soulxQualificationId: payload.lanes.soulx_avatar.qualificationId,
  };
  return { input, inputPath, result, save };
}

test("commits exactly one guarded database call after an exclusive durable intent", () => {
  const f = fixture();
  let calls = 0;
  const actual = executeRenewExpiredQualifiedActivation({
    inputPath: f.inputPath,
    expectedInputSha256: f.save(),
    now: NOW,
    runDatabase({ sql, env }) {
      calls += 1;
      assert.match(sql, /videoforge_refresh_hosted_v209_expired_qualification/u);
      assert.equal(env.PGSSLMODE, "require");
      return { status: 0, stdout: JSON.stringify(f.result), stderr: "" };
    },
  });
  assert.deepEqual(actual, f.result);
  assert.equal(calls, 1);
  const journal = readFileSync(f.input.journalPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(
    journal.map(({ status }) => status),
    ["INTENT", "COMMITTED"],
  );
});

test("stale provider inventory fails before journal or database", () => {
  const f = fixture();
  f.input.payload.inventoryEvidence.observedAt = "2026-09-09T11:54:59.999Z";
  f.input.payload.inventoryEvidenceSha256 = documentSha256(f.input.payload.inventoryEvidence);
  let calls = 0;
  assert.throws(
    () =>
      executeRenewExpiredQualifiedActivation({
        inputPath: f.inputPath,
        expectedInputSha256: f.save(),
        now: NOW,
        runDatabase() {
          calls += 1;
        },
      }),
    /V2_09_QUALIFIED_RENEWAL_STALE_PROOF/u,
  );
  assert.equal(calls, 0);
});

test("retained volume drift fails closed before database", () => {
  const f = fixture();
  f.input.retainedBindings.mage_image.volumeIdSha256 = H("0");
  let calls = 0;
  assert.throws(
    () =>
      executeRenewExpiredQualifiedActivation({
        inputPath: f.inputPath,
        expectedInputSha256: f.save(),
        now: NOW,
        runDatabase() {
          calls += 1;
        },
      }),
    /V2_09_QUALIFIED_RENEWAL_RUNPOD_IDENTITY/u,
  );
  assert.equal(calls, 0);
});

test("Cloudflare identity drift, reused IDs, and overlong authority all fail pre-database", () => {
  const cases = [
    {
      code: "CLOUDFLARE_IDENTITY",
      mutate(input) {
        input.cloudflareReadback.versionIdSha256 = H("0");
        input.cloudflareReadbackSha256 = documentSha256(input.cloudflareReadback);
      },
    },
    {
      code: "NEW_IDS",
      mutate(input) {
        input.payload.lanes.mage_image.qualificationId =
          input.payload.lanes.soulx_avatar.previousQualificationId;
      },
    },
    {
      code: "DEADLINE",
      mutate(input) {
        input.expiresAt = "2026-09-10T11:57:00.001Z";
      },
    },
  ];
  for (const item of cases) {
    const f = fixture();
    item.mutate(f.input);
    let calls = 0;
    assert.throws(
      () =>
        executeRenewExpiredQualifiedActivation({
          inputPath: f.inputPath,
          expectedInputSha256: f.save(),
          now: NOW,
          runDatabase() {
            calls += 1;
          },
        }),
      new RegExp(`V2_09_QUALIFIED_RENEWAL_${item.code}`, "u"),
    );
    assert.equal(calls, 0);
  }
});

test("uncertain database boundary is journaled and can never be retried", () => {
  const f = fixture();
  let calls = 0;
  const run = () =>
    executeRenewExpiredQualifiedActivation({
      inputPath: f.inputPath,
      expectedInputSha256: expected,
      now: NOW,
      runDatabase() {
        calls += 1;
        return { status: 1, stdout: "", stderr: "connection lost" };
      },
    });
  const expected = f.save();
  assert.throws(run, /V2_09_QUALIFIED_RENEWAL_EXECUTION_UNCERTAIN/u);
  assert.throws(run, /EEXIST/u);
  assert.equal(calls, 1);
  const journal = readFileSync(f.input.journalPath, "utf8").trim().split("\n").map(JSON.parse);
  assert.deepEqual(
    journal.map(({ status }) => status),
    ["INTENT", "UNKNOWN_NO_RETRY"],
  );
});

test("a semantically uncertain response is also non-retriable", () => {
  const f = fixture();
  let calls = 0;
  const expectedInputSha256 = f.save();
  assert.throws(
    () =>
      executeRenewExpiredQualifiedActivation({
        inputPath: f.inputPath,
        expectedInputSha256,
        now: NOW,
        runDatabase() {
          calls += 1;
          return { status: 0, stdout: "{}", stderr: "" };
        },
      }),
    /V2_09_QUALIFIED_RENEWAL_RESULT_UNCERTAIN/u,
  );
  assert.equal(calls, 1);
  assert.match(readFileSync(f.input.journalPath, "utf8"), /UNKNOWN_NO_RETRY/u);
});
