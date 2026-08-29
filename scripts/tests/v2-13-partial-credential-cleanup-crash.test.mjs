import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { relative, resolve } from "node:path";
import test from "node:test";

import {
  cleanupPartialDatabaseRoleCredentials,
  databaseCredentialStagingPath,
} from "../../deploy/v2-13/full-live-adapters.mjs";
import { materializationSeedFixture } from "./fixtures/v2-13-materialization-seed.mjs";

const HOST = "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech";
const DATABASE = "neondb";
const FULL_LIVE_AUTHORITY_ID = "11111111-1111-4111-8111-111111111111";
const AUTHORITY_ID = "v2-13-partial-cleanup-crash-authority-0001";
const OUTER_STATE_SHA256 = `sha256:${"f".repeat(64)}`;
const GUARDED_SECRET_NAMES = Object.freeze([
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "WORKFLOW_CALLBACK_SECRET",
  "MEDIA_WORKER_TOKEN_SECRET",
  "VIDEOFORGE_RECONCILER_DATABASE_URL",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY",
  "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
  "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID",
  "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
  "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
  "RUNPOD_API_KEY",
  "RUNPOD_API_BASE_URL",
  "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
]);

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalJson = (value) =>
  Array.isArray(value)
    ? `[${value.map((item) => canonicalJson(item)).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const exists = (path) => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
};
const result = (stdout) => ({ status: 0, stdout, stderr: "" });
const keyId = (purpose) =>
  `v213-${purpose}-${hash(Buffer.from(`${FULL_LIVE_AUTHORITY_ID}\0${purpose}`)).slice(7, 31)}`;

function databaseUrl(role, byte) {
  const value = new URL("postgresql://placeholder:placeholder@localhost/database");
  value.username = role;
  value.password = Buffer.alloc(48, byte).toString("base64url");
  value.hostname = HOST;
  value.pathname = `/${DATABASE}`;
  value.searchParams.set("sslmode", "require");
  value.searchParams.set("channel_binding", "require");
  return value.toString();
}

function createFixture() {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), "v213-partial-cleanup-crash-")));
  chmodSync(directory, 0o700);
  const secretDirectory = resolve(directory, "secret-input");
  const sourceDirectory = resolve(directory, "credential-sources");
  mkdirSync(secretDirectory, { mode: 0o700 });
  mkdirSync(sourceDirectory, { mode: 0o700 });
  const protectedWrite = (path, bytes) => writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });

  protectedWrite(
    resolve(directory, "owner.pg_service.conf"),
    `[videoforge_v2_13_owner]\nhost=${HOST}\ndbname=${DATABASE}\nuser=neondb_owner\nsslmode=require\nchannel_binding=require\n`,
  );
  protectedWrite(
    resolve(directory, "owner.pgpass"),
    `${HOST}:5432:${DATABASE}:neondb_owner:fixture-owner-password\n`,
  );

  const sourceValues = Object.freeze({
    GOOGLE_CLIENT_ID: "fixture-google-client-id",
    GOOGLE_CLIENT_SECRET: "fixture-google-client-secret",
    R2_ACCESS_KEY_ID: "fixture-r2-access-key-id",
    R2_SECRET_ACCESS_KEY: "fixture-r2-secret-access-key",
    RUNPOD_API_KEY: "fixture-runpod-api-key-0123456789",
  });
  const sourcePaths = Object.fromEntries(
    Object.keys(sourceValues).map((name) => [name, resolve(sourceDirectory, name)]),
  );
  for (const [name, value] of Object.entries(sourceValues))
    protectedWrite(sourcePaths[name], Buffer.from(value));
  const secretHashes = Object.fromEntries(
    Object.entries(sourceValues)
      .filter(([name]) => name !== "RUNPOD_API_KEY")
      .map(([name, value]) => [name, hash(Buffer.from(value))]),
  );
  const credentialReceipt = {
    schema_version: "videoforge.v2-13-credential-bootstrap-result/v1",
    google_oauth_client_id_sha256: secretHashes.GOOGLE_CLIENT_ID,
    google_oauth_client_secret_sha256: secretHashes.GOOGLE_CLIENT_SECRET,
    r2_access_key_id_sha256: secretHashes.R2_ACCESS_KEY_ID,
    r2_secret_access_key_sha256: secretHashes.R2_SECRET_ACCESS_KEY,
    runpod_calls: 0,
    gpu_hours: 0,
    external_spend_usd: 0,
  };
  const credentialReceiptBytes = Buffer.from(`${canonicalJson(credentialReceipt)}\n`);
  const credentialReceiptPath = resolve(sourceDirectory, "credential-bootstrap.json");
  protectedWrite(credentialReceiptPath, credentialReceiptBytes);
  const credentialBootstrapBinding = {
    receiptSchema: credentialReceipt.schema_version,
    receiptSha256: hash(credentialReceiptBytes),
    secretHashes,
  };

  const seed = materializationSeedFixture();
  seed.production_input_base.fullLiveAuthorityId = FULL_LIVE_AUTHORITY_ID;
  seed.production_input_base.dualLaneInput.envelopeSigningKeyId = keyId("envelope");
  const seedBytes = Buffer.from(`${canonicalJson(seed)}\n`);
  const seedPath = resolve(sourceDirectory, "materialization-seed.json");
  protectedWrite(seedPath, seedBytes);
  const workId = `${AUTHORITY_ID}:bootstrap-prequalification-database`.toLowerCase();
  const state = {
    authority_id: AUTHORITY_ID,
    full_live_authority_id: FULL_LIVE_AUTHORITY_ID,
    materialization_seed_sha256: hash(seedBytes),
    state: "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
    operator_role_verified: false,
    phases: {
      bootstrap_prequalification_database: {
        work: { [workId]: { state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE" } },
      },
    },
  };

  const databaseUrls = Object.freeze({
    operator: databaseUrl("videoforge_hosted_operator", 1),
    runtime: databaseUrl("videoforge_hosted_runtime", 2),
    reconciler: databaseUrl("videoforge_hosted_reconciler", 3),
  });
  const databaseBundle = {
    schema_version: "videoforge.v213-database-role-credential-bundle/v1",
    full_live_authority_id: FULL_LIVE_AUTHORITY_ID,
    outer_state_sha256: OUTER_STATE_SHA256,
    database: { host: HOST, database: DATABASE },
    credentials: {
      operator: {
        role: "videoforge_hosted_operator",
        database_url: databaseUrls.operator,
      },
      runtime: { role: "videoforge_hosted_runtime", database_url: databaseUrls.runtime },
      reconciler: {
        role: "videoforge_hosted_reconciler",
        database_url: databaseUrls.reconciler,
      },
    },
  };

  const ids = Object.freeze({
    pairDispatchTokenKeyId: keyId("dispatch"),
    pairEnvelopeSigningKeyId: keyId("envelope"),
    pairProviderProofKeyId: keyId("provider-proof"),
    provenanceReceiptKeyId: keyId("provenance"),
  });
  const rawSecrets = Array.from({ length: 10 }, (_, index) => Buffer.alloc(32, index + 11));
  const secretBundle = {
    schemaVersion: "videoforge.v213-production-secret-bootstrap/v1",
    fullLiveAuthorityId: FULL_LIVE_AUTHORITY_ID,
    outerStateSha256: OUTER_STATE_SHA256,
    credentialBootstrapReceiptSha256: credentialBootstrapBinding.receiptSha256,
    keyIds: ids,
    secrets: {
      acceptanceEvidenceSigningKeyBase64: rawSecrets[0].toString("base64"),
      betterAuthSecret: rawSecrets[1].toString("base64"),
      mediaWorkerTokenSecret: rawSecrets[2].toString("base64"),
      pairDispatchTokenKeyBase64: rawSecrets[3].toString("base64"),
      pairEnvelopeSigningKeyHex: rawSecrets[4].toString("hex"),
      pairProviderProofKeyHex: rawSecrets[5].toString("hex"),
      provenanceReceiptHmacKeyBase64: rawSecrets[6].toString("base64"),
      stageAuthoritySigningKeyBase64: rawSecrets[7].toString("base64"),
      workerOperatorBearer: rawSecrets[8].toString("base64"),
      workflowCallbackSecret: rawSecrets[9].toString("base64"),
    },
  };

  const productionSecretsPath = resolve(directory, "production-secrets.json");
  const secretBundlePath = resolve(directory, "production-secret-bootstrap.json");
  const workerOriginPath = resolve(directory, "worker-origin");
  const workerBearerPath = resolve(directory, "worker-operator-bearer");
  const outputPaths = Object.fromEntries(
    GUARDED_SECRET_NAMES.map((name) => [name, resolve(secretDirectory, name)]),
  );
  const productionSecrets = {
    schemaVersion: "videoforge.v213-full-live-pre-endpoint-secrets/v1",
    stageAuthoritySigningKeyBase64: secretBundle.secrets.stageAuthoritySigningKeyBase64,
    provenanceReceiptHmacKeyBase64: secretBundle.secrets.provenanceReceiptHmacKeyBase64,
    provenanceReceiptKeyId: ids.provenanceReceiptKeyId,
    acceptanceEvidenceSigningKeyBase64: secretBundle.secrets.acceptanceEvidenceSigningKeyBase64,
    pairDispatchTokenKeyBase64: secretBundle.secrets.pairDispatchTokenKeyBase64,
    pairDispatchTokenKeyId: ids.pairDispatchTokenKeyId,
    pairEnvelopeSigningKeyHex: secretBundle.secrets.pairEnvelopeSigningKeyHex,
    pairEnvelopeSigningKeyId: ids.pairEnvelopeSigningKeyId,
    pairProviderProofKeyHex: secretBundle.secrets.pairProviderProofKeyHex,
    pairProviderProofKeyId: ids.pairProviderProofKeyId,
  };
  const secretValues = {
    DATABASE_URL: databaseUrls.runtime,
    BETTER_AUTH_SECRET: secretBundle.secrets.betterAuthSecret,
    GOOGLE_CLIENT_ID: sourceValues.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: sourceValues.GOOGLE_CLIENT_SECRET,
    R2_ACCESS_KEY_ID: sourceValues.R2_ACCESS_KEY_ID,
    R2_SECRET_ACCESS_KEY: sourceValues.R2_SECRET_ACCESS_KEY,
    WORKFLOW_CALLBACK_SECRET: secretBundle.secrets.workflowCallbackSecret,
    MEDIA_WORKER_TOKEN_SECRET: secretBundle.secrets.mediaWorkerTokenSecret,
    VIDEOFORGE_RECONCILER_DATABASE_URL: databaseUrls.reconciler,
    VIDEOFORGE_DISPATCH_TOKEN_KEY: secretBundle.secrets.pairDispatchTokenKeyBase64,
    VIDEOFORGE_DISPATCH_TOKEN_KEY_ID: ids.pairDispatchTokenKeyId,
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: secretBundle.secrets.pairEnvelopeSigningKeyHex,
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: ids.pairEnvelopeSigningKeyId,
    VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: secretBundle.secrets.pairProviderProofKeyHex,
    VIDEOFORGE_PROVIDER_PROOF_KEY_ID: ids.pairProviderProofKeyId,
    RUNPOD_API_KEY: sourceValues.RUNPOD_API_KEY,
    RUNPOD_API_BASE_URL: "https://api.runpod.ai/v2",
    VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: secretBundle.secrets.workerOperatorBearer,
  };

  const databaseBundlePath = resolve(directory, "database-role-credentials.json");
  const finalBytes = new Map([
    [databaseBundlePath, Buffer.from(`${canonicalJson(databaseBundle)}\n`)],
    [resolve(directory, "operator.database-url"), Buffer.from(databaseUrls.operator)],
    [resolve(directory, "runtime.database-url"), Buffer.from(databaseUrls.runtime)],
    [resolve(directory, "reconciler.database-url"), Buffer.from(databaseUrls.reconciler)],
    [secretBundlePath, Buffer.from(`${canonicalJson(secretBundle)}\n`)],
    [productionSecretsPath, Buffer.from(`${canonicalJson(productionSecrets)}\n`)],
    [workerOriginPath, Buffer.from(seed.activation_record_base.cloudflare.public_origin)],
    [workerBearerPath, Buffer.from(secretBundle.secrets.workerOperatorBearer)],
    ...Object.entries(secretValues).map(([name, value]) => [outputPaths[name], Buffer.from(value)]),
  ]);
  const artifactPathByLabel = new Map();
  const labelByArtifactPath = new Map();
  for (const [finalPath, bytes] of finalBytes) {
    const stagePath = databaseCredentialStagingPath(finalPath, AUTHORITY_ID);
    protectedWrite(stagePath, bytes);
    linkSync(stagePath, finalPath);
    const relativeFinal = relative(directory, finalPath);
    for (const [label, path] of [
      [`stage:${relativeFinal}`, stagePath],
      [`final:${relativeFinal}`, finalPath],
    ]) {
      artifactPathByLabel.set(label, path);
      labelByArtifactPath.set(path, label);
    }
  }

  const manifest = JSON.parse(
    readFileSync(resolve("packages/control-plane/migrations/manifest.json"), "utf8"),
  );
  const ledger = manifest.migrations
    .map(({ version, name, filename, sha256 }) => `${version}\t${name}\t${filename}\t${sha256}`)
    .join("\n");
  const run = (command, args) => {
    assert.equal(command, "psql");
    const sql = args[args.indexOf("--command") + 1] ?? "";
    if (sql.includes("json_build_object('operator'"))
      return result(`${JSON.stringify({ operator: 0, runtime: 0, reconciler: 0 })}\n`);
    if (sql.includes("videoforge_schema_migrations")) return result(`${ledger}\n`);
    throw new Error(`unexpected cleanup SQL: ${sql.slice(0, 120)}`);
  };
  const environment = {
    VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: directory,
    VIDEOFORGE_V2_13_SECRET_INPUT_DIR: secretDirectory,
    VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE: resolve(directory, "runtime.database-url"),
    VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE: resolve(directory, "reconciler.database-url"),
    VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: seedPath,
    VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE: productionSecretsPath,
    VIDEOFORGE_V2_13_PRODUCTION_SECRET_BOOTSTRAP_FILE: secretBundlePath,
    VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE: workerOriginPath,
    VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE: workerBearerPath,
    VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE: credentialReceiptPath,
    VIDEOFORGE_V2_13_GOOGLE_CLIENT_ID_FILE: sourcePaths.GOOGLE_CLIENT_ID,
    VIDEOFORGE_V2_13_GOOGLE_CLIENT_SECRET_FILE: sourcePaths.GOOGLE_CLIENT_SECRET,
    VIDEOFORGE_V2_13_R2_ACCESS_KEY_ID_FILE: sourcePaths.R2_ACCESS_KEY_ID,
    VIDEOFORGE_V2_13_R2_SECRET_ACCESS_KEY_FILE: sourcePaths.R2_SECRET_ACCESS_KEY,
    VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE: sourcePaths.RUNPOD_API_KEY,
  };
  const preservedSources = new Map([
    ["materialization-seed", seedPath],
    ["credential-receipt", credentialReceiptPath],
    ...Object.entries(sourcePaths),
  ]);
  const preservedSourceBytes = new Map(
    [...preservedSources].map(([label, path]) => [label, readFileSync(path)]),
  );
  return {
    directory,
    state,
    environment,
    run,
    credentialBootstrapBinding,
    databaseBundlePath,
    secretBundlePath,
    artifactPathByLabel,
    labelByArtifactPath,
    preservedSources,
    preservedSourceBytes,
  };
}

function cleanupInput(fixture, overrides = {}) {
  return {
    environment: fixture.environment,
    run: fixture.run,
    state: fixture.state,
    credentialBootstrapBinding: fixture.credentialBootstrapBinding,
    ...overrides,
  };
}

function assertSourcesPreserved(fixture) {
  for (const [label, path] of fixture.preservedSources) {
    assert.equal(exists(path), true, label);
    assert.deepEqual(readFileSync(path), fixture.preservedSourceBytes.get(label), label);
  }
}

test("partial credential cleanup resumes after a crash following every exact unlink", async () => {
  const baseline = createFixture();
  let deletionLabels;
  try {
    const deleted = [];
    const cleaned = await cleanupPartialDatabaseRoleCredentials(
      cleanupInput(baseline, {
        remove: (path) => {
          deleted.push(path);
          rmSync(path);
        },
      }),
    );
    deletionLabels = deleted.map((path) => baseline.labelByArtifactPath.get(path));
    assert.equal(deletionLabels.length, 52);
    assert.equal(new Set(deletionLabels).size, 52);
    assert.equal(deletionLabels.at(-1), "final:database-role-credentials.json");
    assert.equal(cleaned.cleanupState, "REMOVED_AUTHORITY_BOUND_FILES");
    assert.equal(cleaned.removedArtifactCount, 52);
    assert.equal(cleaned.removedArtifactCount <= 56, true);
    assertSourcesPreserved(baseline);
  } finally {
    rmSync(baseline.directory, { recursive: true, force: true });
  }

  for (let crashIndex = 0; crashIndex < deletionLabels.length; crashIndex += 1) {
    const fixture = createFixture();
    try {
      const firstPass = [];
      await assert.rejects(
        cleanupPartialDatabaseRoleCredentials(
          cleanupInput(fixture, {
            remove: (path) => {
              rmSync(path);
              firstPass.push(fixture.labelByArtifactPath.get(path));
              if (firstPass.length === crashIndex + 1)
                throw new Error(`INJECTED_AFTER_UNLINK_${crashIndex}`);
            },
          }),
        ),
        new RegExp(`INJECTED_AFTER_UNLINK_${crashIndex}`, "u"),
      );
      assert.deepEqual(firstPass, deletionLabels.slice(0, crashIndex + 1));
      assertSourcesPreserved(fixture);

      const resumedPass = [];
      const resumed = await cleanupPartialDatabaseRoleCredentials(
        cleanupInput(fixture, {
          remove: (path) => {
            resumedPass.push(fixture.labelByArtifactPath.get(path));
            rmSync(path);
          },
        }),
      );
      assert.deepEqual(resumedPass, deletionLabels.slice(crashIndex + 1));
      assert.equal(resumed.removedArtifactCount, deletionLabels.length - crashIndex - 1);
      assert.equal(
        resumed.cleanupState,
        crashIndex === deletionLabels.length - 1
          ? "ALREADY_ABSENT"
          : "REMOVED_AUTHORITY_BOUND_FILES",
      );
      for (const path of fixture.artifactPathByLabel.values()) assert.equal(exists(path), false);
      assertSourcesPreserved(fixture);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("partial credential cleanup rejects any corrupted surviving artifact or source before unlink", async () => {
  const labelsFixture = createFixture();
  const artifactLabels = [...labelsFixture.artifactPathByLabel.keys()];
  const sourceLabels = [...labelsFixture.preservedSources.keys()];
  rmSync(labelsFixture.directory, { recursive: true, force: true });

  for (const label of artifactLabels) {
    const fixture = createFixture();
    try {
      const path = fixture.artifactPathByLabel.get(label);
      writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("corrupt")]));
      let deletions = 0;
      await assert.rejects(
        cleanupPartialDatabaseRoleCredentials(
          cleanupInput(fixture, {
            remove: () => {
              deletions += 1;
            },
          }),
        ),
      );
      assert.equal(deletions, 0, label);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }

  for (const label of sourceLabels) {
    const fixture = createFixture();
    try {
      const path = fixture.preservedSources.get(label);
      writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from("corrupt")]));
      let deletions = 0;
      await assert.rejects(
        cleanupPartialDatabaseRoleCredentials(
          cleanupInput(fixture, {
            remove: () => {
              deletions += 1;
            },
          }),
        ),
      );
      assert.equal(deletions, 0, label);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("partial credential cleanup rejects cross-bundle drift and foreign stages with zero deletion", async () => {
  for (const scenario of ["cross-bundle-outer-state", "foreign-secret-stage"]) {
    const fixture = createFixture();
    try {
      if (scenario === "cross-bundle-outer-state") {
        const finalPath = fixture.secretBundlePath;
        const stagePath = databaseCredentialStagingPath(finalPath, AUTHORITY_ID);
        const value = JSON.parse(readFileSync(finalPath, "utf8"));
        value.outerStateSha256 = `sha256:${"0".repeat(64)}`;
        rmSync(stagePath);
        rmSync(finalPath);
        writeFileSync(stagePath, `${canonicalJson(value)}\n`, { mode: 0o600, flag: "wx" });
        linkSync(stagePath, finalPath);
      } else {
        const protectedFinal = fixture.environment.VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE;
        const foreign = databaseCredentialStagingPath(protectedFinal, "foreign-cleanup-authority");
        writeFileSync(foreign, readFileSync(protectedFinal), { mode: 0o600, flag: "wx" });
      }
      let deletions = 0;
      await assert.rejects(
        cleanupPartialDatabaseRoleCredentials(
          cleanupInput(fixture, {
            remove: () => {
              deletions += 1;
            },
          }),
        ),
      );
      assert.equal(deletions, 0, scenario);
    } finally {
      rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});
