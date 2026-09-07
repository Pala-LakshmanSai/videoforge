import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { SECRET_NAMES } from "../v2-13/guarded-activation.mjs";
import {
  cleanupV209ProtectedInputs,
  deriveOwnerDatabaseUrl,
  hasV209ProtectedInputCleanup,
  materializeV209EndpointSecrets,
  materializeV209ProtectedInputs,
} from "./protected-input-materializer.mjs";

const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const AUTHORITY_ID = "v2-09-materializer-test-authority";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "vf-v209-materializer-"));
  chmodSync(directory, 0o700);
  const file = (name, value) => {
    const path = join(directory, name);
    if (value !== undefined) writeFileSync(path, value, { mode: 0o600 });
    return path;
  };
  const owner = file(
    "owner.url",
    "postgresql://owner:owner-password@db.example.test:5432/videoforge?sslmode=require",
  );
  const secretFiles = Object.fromEntries(
    SECRET_NAMES.map((name) => [name, file(`secret-${name}`)]),
  );
  const reusableSecretFiles = Object.fromEntries(
    [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "RUNPOD_API_KEY",
    ].map((name) => [name, file(`source-${name}`, `${name}-source-value-0123456789`)]),
  );
  const configuration = {
    operatorRole: `videoforge_v209_operator_${hash(AUTHORITY_ID).slice(7, 15)}`,
    runtimeRole: `videoforge_v209_runtime_${hash(AUTHORITY_ID).slice(7, 15)}`,
    reconcilerRole: `videoforge_v209_reconciler_${hash(AUTHORITY_ID).slice(7, 15)}`,
    databaseOwnerUrlFile: file("materialized-owner.url"),
    databaseOperatorUrlFile: file("materialized-operator.url"),
    databaseReconcilerUrlFile: secretFiles.VIDEOFORGE_RECONCILER_DATABASE_URL,
    runpodWorkerEnvironmentFile: file("runpod-worker.json"),
    runpodApiKeyFile: file("runpod.key"),
    cloudflare: { secretFiles },
  };
  return {
    directory,
    configuration,
    materialization: {
      databaseOwner: { mode: "EXACT_URL_FILE", urlFile: owner },
      reusableSecretFiles,
      roleJournalPath: file("roles.journal"),
    },
  };
}

test("derives an exact owner URL from one service and pgpass match", () => {
  const directory = mkdtempSync(join(tmpdir(), "vf-v209-pg-"));
  chmodSync(directory, 0o700);
  const service = join(directory, "owner.pg_service.conf");
  const pass = join(directory, "owner.pgpass");
  writeFileSync(
    service,
    "[vf]\nhost=db.example.test\nport=5432\ndbname=videoforge\nuser=owner\nsslmode=require\n",
    { mode: 0o600 },
  );
  writeFileSync(pass, "db.example.test:5432:videoforge:owner:p%40ssword\n", { mode: 0o600 });
  const value = new URL(
    deriveOwnerDatabaseUrl({
      mode: "PG_SERVICE_PGPASS",
      serviceName: "vf",
      serviceFile: service,
      passFile: pass,
    }),
  );
  assert.equal(value.username, "owner");
  assert.equal(value.hostname, "db.example.test");
  assert.equal(value.searchParams.get("sslmode"), "require");
});

test("materializes fresh role credentials and pre-endpoint secrets without returning values", async () => {
  const value = fixture();
  const calls = [];
  let counter = 0;
  const receipt = await materializeV209ProtectedInputs({
    authorityId: AUTHORITY_ID,
    configuration: value.configuration,
    materialization: value.materialization,
    randomBytesImpl: (size) => Buffer.alloc(size, ++counter),
    runPsql: async (request) => calls.push(request),
  });
  assert.equal(receipt.role_mutation_count, 1);
  assert.equal(receipt.generated_secret_count, 10);
  assert.equal(receipt.reused_secret_count, 5);
  assert.equal(receipt.deferred_endpoint_secret_count, 4);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /CREATE ROLE/u);
  assert.doesNotMatch(calls[0].sql, /ALTER ROLE/u);
  assert.equal(statSync(value.configuration.databaseOperatorUrlFile).mode & 0o777, 0o600);
  assert.equal(
    readFileSync(value.materialization.roleJournalPath, "utf8").includes("COMPLETED"),
    true,
  );
  assert.equal(JSON.stringify(receipt).includes("password"), false);
  for (const name of [
    "VIDEOFORGE_MAGE_ENDPOINT_ID",
    "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
    "VIDEOFORGE_SOULX_ENDPOINT_ID",
    "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
  ])
    assert.equal(
      statSync(value.configuration.cloudflare.secretFiles[name], { throwIfNoEntry: false }),
      undefined,
    );
});

test("endpoint values materialize only from two exact persisted deployment bindings", async () => {
  const value = fixture();
  let counter = 0;
  await materializeV209ProtectedInputs({
    authorityId: AUTHORITY_ID,
    configuration: value.configuration,
    materialization: value.materialization,
    randomBytesImpl: (size) => Buffer.alloc(size, ++counter),
    runPsql: async () => {},
  });
  const mage = { endpointId: "mage-endpoint", endpointIdSha256: hash("mage-endpoint") };
  const soulx = { endpointId: "soulx-endpoint", endpointIdSha256: hash("soulx-endpoint") };
  const receipt = materializeV209EndpointSecrets({
    configuration: value.configuration,
    deployments: { mage, soulx },
  });
  assert.equal(receipt.endpoint_secret_count, 4);
  assert.equal(receipt.secret_count, 22);
  assert.match(receipt.secret_set_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(
    readFileSync(value.configuration.cloudflare.secretFiles.VIDEOFORGE_MAGE_ENDPOINT_ID, "utf8"),
    mage.endpointId,
  );
  assert.equal(JSON.stringify(receipt).includes(mage.endpointId), false);
});

test("an existing versioned role journal forbids replay", async () => {
  const value = fixture();
  writeFileSync(value.materialization.roleJournalPath, "claimed", { mode: 0o600 });
  await assert.rejects(
    materializeV209ProtectedInputs({
      authorityId: AUTHORITY_ID,
      configuration: value.configuration,
      materialization: value.materialization,
      runPsql: async () => assert.fail("must not mutate"),
    }),
    /ROLE_MUTATION_AMBIGUOUS_NO_REPLAY/u,
  );
});

test("authority cleanup drops only marked roles and removes outputs including endpoint partials", async () => {
  const value = fixture();
  assert.equal(
    hasV209ProtectedInputCleanup({
      authorityId: AUTHORITY_ID,
      configuration: value.configuration,
      materialization: value.materialization,
    }),
    false,
  );
  let counter = 0;
  const calls = [];
  await materializeV209ProtectedInputs({
    authorityId: AUTHORITY_ID,
    configuration: value.configuration,
    materialization: value.materialization,
    randomBytesImpl: (size) => Buffer.alloc(size, ++counter),
    runPsql: async (request) => calls.push(request),
  });
  const endpointPath = value.configuration.cloudflare.secretFiles.VIDEOFORGE_MAGE_ENDPOINT_ID;
  writeFileSync(endpointPath, "partial-endpoint", { mode: 0o600 });
  const sourcePath = value.materialization.reusableSecretFiles.RUNPOD_API_KEY;
  const result = await cleanupV209ProtectedInputs({
    authorityId: AUTHORITY_ID,
    configuration: value.configuration,
    materialization: value.materialization,
    runPsql: async (request) => calls.push(request),
  });
  assert.equal(result.role_cleanup_attempted, true);
  assert.equal(result.adopted_cleanup, false);
  assert.equal(existsSync(endpointPath), false);
  assert.equal(existsSync(value.configuration.runpodApiKeyFile), false);
  assert.equal(existsSync(value.materialization.roleJournalPath), false);
  assert.equal(existsSync(sourcePath), true);
  assert.match(calls[0].sql, /COMMENT ON ROLE/u);
  assert.match(calls[1].sql, /shobj_description/u);
  assert.match(calls[1].sql, /DROP OWNED BY/u);
  assert.match(calls[1].sql, /DROP ROLE/u);
  assert.match(calls[1].sql, new RegExp(AUTHORITY_ID, "u"));

  const adopted = await cleanupV209ProtectedInputs({
    authorityId: AUTHORITY_ID,
    configuration: value.configuration,
    materialization: value.materialization,
    runPsql: async () => assert.fail("durable cleanup must not replay database mutation"),
  });
  assert.equal(adopted.adopted_cleanup, true);
  assert.equal(adopted.role_cleanup_attempted, false);
  assert.equal(existsSync(`${value.materialization.roleJournalPath}.cleanup`), true);
  assert.equal(
    hasV209ProtectedInputCleanup({
      authorityId: AUTHORITY_ID,
      configuration: value.configuration,
      materialization: value.materialization,
    }),
    true,
  );
  await assert.rejects(
    materializeV209ProtectedInputs({
      authorityId: AUTHORITY_ID,
      configuration: value.configuration,
      materialization: value.materialization,
      runPsql: async () => assert.fail("cleaned authority must not rematerialize"),
    }),
    /ROLE_MUTATION_AMBIGUOUS_NO_REPLAY/u,
  );

  writeFileSync(`${value.materialization.roleJournalPath}.cleanup`, "{}\n", { mode: 0o600 });
  assert.throws(
    () =>
      hasV209ProtectedInputCleanup({
        authorityId: AUTHORITY_ID,
        configuration: value.configuration,
        materialization: value.materialization,
      }),
    /CLEANUP_TOMBSTONE_INVALID/u,
  );
});
