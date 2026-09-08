import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  lstatSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { createV209CloudflareQualifiedReplacement } from "./cloudflare-qualified-replacement.mjs";
import {
  canonicalNativeBrowser as canonical,
  hashNativeBrowser as hash,
  NATIVE_REPLACEMENT_OPERATIONS,
} from "./native-browser-continuation.mjs";
import {
  databaseBytesHash as bytesHash,
  renderNativeMigration87Sql,
  executeNativeDatabaseOnce,
} from "./native-replacement-database.mjs";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fail = (c) => {
  throw Error(`V2_09_NATIVE_REPLACEMENT_${c}`);
};
function privateBytes(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== process.getuid() ||
      (s.mode & 511) !== 384 ||
      s.size > 8388608
    )
      fail("PRIVATE_FILE");
    return readFileSync(fd);
  } finally {
    closeSync(fd);
  }
}
function durableNew(path, value) {
  const fd = openSync(
    path,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + "\n");
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  const dir = openSync(dirname(path), constants.O_RDONLY);
  try {
    fsyncSync(dir);
  } finally {
    closeSync(dir);
  }
}
function uuid(value) {
  const h = createHash("sha256").update(value).digest("hex").slice(0, 32).split("");
  h[12] = "5";
  h[16] = ["8", "9", "a", "b"][parseInt(h[16], 16) % 4];
  const s = h.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
/** A stopped, read-only predecessor claim may transfer forward; it can never resume. */
export function readStoppedNativeReplacementTransfer(plan, liveStateBytes) {
  const r = plan.transfer_recovery;
  const keys = [
    "root",
    "plan_sha256",
    "archive_sha256",
    "stop_sha256",
    "journal_sha256",
    "claim_sha256",
    "transfer_sha256",
    "operation_sha256",
  ];
  if (
    !r ||
    Object.keys(r).sort().join() !== keys.sort().join() ||
    !r.root ||
    resolve(r.root) !== r.root ||
    r.root === plan.output_root
  )
    fail("TRANSFER_RECOVERY");
  const read = (name, digest) => {
    const b = privateBytes(resolve(r.root, name));
    if (bytesHash(b) !== digest) fail("TRANSFER_RECOVERY_HASH");
    return JSON.parse(b);
  };
  const old = read("replacement-plan.json", r.plan_sha256);
  const archive = read("predecessor-state.json", r.archive_sha256);
  const stop = read("replacement-stop.json", r.stop_sha256);
  const journal = read("cloudflare-replacement-journal.json", r.journal_sha256);
  const claim = read("replacement-claim.json", r.claim_sha256);
  const transfer = read("transfer-receipt.json", r.transfer_sha256);
  const op = read("operation-1.json", r.operation_sha256);
  const live = JSON.parse(liveStateBytes);
  const expected = {
    schema_version: "videoforge.v2-09-predecessor-transferred/v1",
    prior_state_sha256: hash(archive),
    successor_plan_sha256: r.plan_sha256,
    normal_resume_disabled: true,
  };
  if (
    old.output_root !== r.root ||
    old.prior_root !== plan.prior_root ||
    old.prior_authority_sha256 !== plan.prior_authority_sha256 ||
    old.prior_state_sha256 !== plan.prior_state_sha256 ||
    old.authority.authority_id === plan.authority.authority_id ||
    canonical(old.predecessor) !== canonical(plan.predecessor) ||
    canonical(old.authority.caps) !== canonical(plan.authority.caps) ||
    canonical(live) !== canonical(expected) ||
    canonical(transfer) !== canonical(expected) ||
    claim.plan_sha256 !== r.plan_sha256 ||
    claim.single_use !== true ||
    canonical(stop) !==
      canonical({
        status: "STOPPED_NO_RETRY",
        containment: "NOT_DEPLOYED",
        error_code: "BOUNDED_OPERATION_FAILED",
        generate_clicks: 0,
      }) ||
    canonical(op) !==
      canonical({
        id: NATIVE_REPLACEMENT_OPERATIONS[0],
        status: "COMPLETED",
        result: expected,
        result_sha256: hash(expected),
      }) ||
    canonical(journal) !==
      canonical({
        schema_version: "videoforge.v2-09-qualified-replacement-journal/v1",
        authority_sha256: hash(old.authority),
        predecessor_sha256: hash(old.predecessor),
        state: "CLAIMED",
        events: [],
        inherited_secret_count: 22,
        introduced_secret_names: [],
        retained_r2_deleted: false,
      })
  )
    fail("TRANSFER_RECOVERY_EVIDENCE");
  for (const name of [
    "migration-journal.jsonl",
    "activation-journal.jsonl",
    "replacement-receipt.json",
    ...Array.from({ length: 7 }, (_, i) => `operation-${i + 2}.json`),
  ]) {
    try {
      lstatSync(resolve(r.root, name));
    } catch (e) {
      if (e.code === "ENOENT") continue;
      throw e;
    }
    fail("TRANSFER_RECOVERY_MUTATION");
  }
  return archive;
}

export async function executeNativeQualifiedReplacement({ planPath, expectedSha256 }) {
  const planBytes = privateBytes(planPath);
  if (bytesHash(planBytes) !== expectedSha256) fail("PLAN_HASH");
  const p = JSON.parse(planBytes);
  if (
    p.schema_version !== "videoforge.v2-09-native-replacement-plan/v1" ||
    p.source_commit !== p.authority?.source_commit ||
    p.configuration?.root !== ROOT ||
    resolve(p.output_root) !== p.output_root
  )
    fail("PLAN");
  const dir = lstatSync(p.output_root);
  if (
    !dir.isDirectory() ||
    dir.isSymbolicLink() ||
    dir.uid !== process.getuid() ||
    (dir.mode & 63) !== 0
  )
    fail("OUTPUT_ROOT");
  const check = () => {
    if (
      bytesHash(privateBytes(planPath)) !== expectedSha256 ||
      execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD"], { encoding: "utf8" }).trim() !==
        p.source_commit ||
      execFileSync("git", ["-C", ROOT, "status", "--porcelain", "--untracked-files=no"], {
        encoding: "utf8",
      }).trim()
    )
      fail("SOURCE_OR_PLAN_DRIFT");
    if (
      !Number.isFinite(Date.parse(p.authority.issued_at)) ||
      !Number.isFinite(Date.parse(p.authority.expires_at)) ||
      Date.now() < Date.parse(p.authority.issued_at) ||
      Date.parse(p.authority.expires_at) - Date.now() < 1660000
    )
      fail("AUTHORITY_DEADLINE");
  };
  check();
  const priorBytes = privateBytes(resolve(p.prior_root, "authority.json"));
  const statePath = resolve(p.prior_root, "combined-outer-state.json");
  const stateBytes = privateBytes(statePath);
  if (
    bytesHash(priorBytes) !== p.prior_authority_sha256 ||
    (!p.transfer_recovery && bytesHash(stateBytes) !== p.prior_state_sha256)
  )
    fail("PREDECESSOR_HASH");
  const prior = JSON.parse(priorBytes),
    state = p.transfer_recovery
      ? readStoppedNativeReplacementTransfer(p, stateBytes)
      : JSON.parse(stateBytes);
  if (
    state.status !== "AWAITING_INTERACTIVE_CHROME_LOGIN" ||
    state.outer_authority_id !== prior.authority_id ||
    state.source_commit !== prior.source_commit ||
    state.operations?.length !== 26 ||
    state.operations.some(
      (x, i) => x.status !== (i < 22 ? "COMPLETED" : i === 22 ? "STARTED" : "PENDING"),
    ) ||
    state.inner_authority_id !== null ||
    state.operations.slice(0, 22).some((x) => x.result_sha256 !== hash(x.result))
  )
    fail("PREDECESSOR_STATE");
  if (
    canonical(p.authority.caps) !== canonical(prior.caps) ||
    p.authority.caps.max_incremental_usd !== 2 ||
    p.authority.caps.max_completion_usd !== 17.5 ||
    Date.parse(p.authority.expires_at) > Date.parse(prior.expires_at) ||
    p.authority.source_commit === prior.source_commit
  )
    fail("SCOPE");
  const oldResult = (id) => state.operations.find((x) => x.id === id)?.result;
  const oldDeployment = oldResult("deploy-cloudflare-qualified-production"),
    oldActivation = oldResult("import-v209-qualified-activation");
  if (
    bytesHash(p.predecessor.versionId) !== oldDeployment.deployment_id_sha256 ||
    p.predecessor.sourceCommit !== prior.source_commit ||
    p.predecessor.qualifiedConfigSha256 !== oldDeployment.config_sha256 ||
    p.predecessor.workerBundleSha256 !== oldDeployment.worker_bundle_sha256
  )
    fail("PREDECESSOR_LINEAGE");
  const prepBytes = privateBytes(p.preparation_receipt_path);
  if (
    bytesHash(prepBytes) !== p.preparation_receipt_sha256 ||
    bytesHash(privateBytes(p.configuration.qualifiedConfigPath)) !==
      p.authority.production.config_sha256
  )
    fail("RENDER_HASH");
  const oldPayloadBytes = privateBytes(p.predecessor_activation_path);
  if (bytesHash(oldPayloadBytes) !== p.predecessor_activation_sha256) fail("ACTIVATION_TEMPLATE");
  const oldPayload = JSON.parse(oldPayloadBytes);
  if (
    oldPayload.schemaVersion !== "videoforge.hosted-v209-qualified-activation-import/v1" ||
    oldPayload.activationId !== uuid(`${prior.authority_id}:activation`) ||
    oldPayload.sourceCommit !== prior.source_commit ||
    oldPayload.deployedConfigSha256 !== oldDeployment.config_sha256 ||
    oldPayload.cloudflareVersionIdSha256 !== oldDeployment.deployment_id_sha256
  )
    fail("ACTIVATION_PREDECESSOR");
  for (const [lane, key] of [
    ["mage", "mage_image"],
    ["soulx", "soulx_avatar"],
  ]) {
    if (
      oldPayload.lanes?.[key]?.deploymentId !== uuid(`${prior.authority_id}:deployment:${lane}`) ||
      !oldActivation.deployment_row_id_sha256s.includes(
        bytesHash(oldPayload.lanes[key].deploymentId),
      )
    )
      fail("LANE_IDENTITY");
  }
  const sql = renderNativeMigration87Sql({
    migrationRoot: resolve(ROOT, "packages/control-plane/migrations"),
    manifestSha256: p.migration_manifest_sha256,
    migrationSha256: p.migration_sha256,
  });
  const cf = createV209CloudflareQualifiedReplacement({
    configuration: p.configuration,
    authority: p.authority,
    predecessor: p.predecessor,
  });
  const operations = [];
  const done = (i, result) => {
    const entry = {
      id: NATIVE_REPLACEMENT_OPERATIONS[i],
      status: "COMPLETED",
      result,
      result_sha256: hash(result),
    };
    durableNew(resolve(p.output_root, `operation-${i + 1}.json`), entry);
    operations.push(entry);
  };
  durableNew(resolve(p.output_root, "replacement-claim.json"), {
    plan_sha256: expectedSha256,
    claimed_at: new Date().toISOString(),
    single_use: true,
  });
  // Atomically replace the legacy resume state with an explicit tombstone. Original bytes remain
  // preserved under their exact hash, and no interval exists in which the legacy state is absent.
  const archived = resolve(p.output_root, "predecessor-state.json");
  durableNew(archived, state);
  const tombstone = {
    schema_version: "videoforge.v2-09-predecessor-transferred/v1",
    prior_state_sha256: hash(state),
    successor_plan_sha256: expectedSha256,
    normal_resume_disabled: true,
  };
  if (bytesHash(privateBytes(statePath)) !== bytesHash(stateBytes)) fail("TRANSFER_STATE_DRIFT");
  if (p.transfer_recovery) readStoppedNativeReplacementTransfer(p, privateBytes(statePath));
  const tmp = statePath + ".native-transfer";
  durableNew(tmp, tombstone);
  renameSync(tmp, statePath);
  const stateDirectory = openSync(dirname(statePath), constants.O_RDONLY);
  try {
    fsyncSync(stateDirectory);
  } finally {
    closeSync(stateDirectory);
  }
  if (canonical(JSON.parse(privateBytes(statePath))) !== canonical(tombstone))
    fail("TRANSFER_BARRIER");
  durableNew(resolve(p.output_root, "transfer-receipt.json"), tombstone);
  done(0, tombstone);
  try {
    check();
    done(1, await cf.verifyPredecessor());
    check();
    const result = executeNativeDatabaseOnce({
      credentialPath: p.database_owner_url_file,
      sql,
      journalPath: resolve(p.output_root, "migration-journal.jsonl"),
      operation: "APPLY_0087",
      expectedSqlSha256: bytesHash(sql),
    });
    const migrationResult = JSON.parse(result.trim());
    if (
      migrationResult.schema_version !== "videoforge.v2-09-native-migration-result/v1" ||
      migrationResult.from_version !== 86 ||
      migrationResult.to_version !== 87
    )
      fail("MIGRATION_RESULT");
    const migration = {
      version: "0087",
      sha256: p.migration_sha256,
      before: 86,
      after: 87,
      applied_versions: ["0087"],
    };
    done(2, migration);
    check();
    done(3, {
      receipt_sha256: p.preparation_receipt_sha256,
      config_sha256: p.authority.production.config_sha256,
      worker_bundle_sha256: p.authority.production.worker_bundle_sha256,
    });
    const version = await cf.deployOnce();
    done(4, { deployment_id_sha256: version.versionIdSha256, deploy_count: 1 });
    done(5, version);
    check();
    const payload = structuredClone(oldPayload);
    payload.activationId = uuid(`${p.authority.authority_id}:activation`);
    payload.sourceCommit = p.source_commit;
    payload.deployedConfigSha256 = p.authority.production.config_sha256;
    payload.cloudflareVersionIdSha256 = version.versionIdSha256;
    payload.observedAt = new Date().toISOString();
    payload.readbackSha256 = hash(version);
    // Reuse exact original qualification IDs and their existing expiry; this is not requalification.
    durableNew(resolve(p.output_root, "activation-payload.json"), payload);
    const importTemplate = readFileSync(
      resolve(ROOT, "deploy/v2-09/neon-import-qualified-activation.sql"),
      "utf8",
    );
    const importSql = importTemplate.replace(
      ":'payload_base64'",
      `'${Buffer.from(canonical(payload)).toString("base64")}'`,
    );
    const imported = JSON.parse(
      executeNativeDatabaseOnce({
        credentialPath: p.database_operator_url_file,
        sql: importSql,
        journalPath: resolve(p.output_root, "activation-journal.jsonl"),
        operation: "IMPORT_REPLACEMENT_ACTIVATION",
        expectedSqlSha256: bytesHash(importSql),
      }).trim(),
    );
    if (
      imported.imported?.activationId !== payload.activationId ||
      imported.imported.replayed !== false ||
      imported.loaded?.verification?.accepted !== true ||
      imported.loaded.verification.sourceCommit !== p.source_commit ||
      imported.loaded.evidence?.cloudflareVersionIdSha256 !== version.versionIdSha256 ||
      imported.loaded.evidence.deployedConfigSha256 !== p.authority.production.config_sha256
    )
      fail("IMPORT_READBACK");
    done(6, {
      activation_id_sha256: bytesHash(payload.activationId),
      import_count: 1,
      evidence_sha256: imported.imported.evidenceSha256,
    });
    const effective = await cf.readbackEffective();
    const next = {
      source_commit: p.source_commit,
      config_sha256: p.authority.production.config_sha256,
      worker_bundle_sha256: p.authority.production.worker_bundle_sha256,
      deployment_id_sha256: effective.versionIdSha256,
      deployment_row_id_sha256s: oldActivation.deployment_row_id_sha256s,
      effective_gpu_transport: "QUALIFIED_EXACT",
      database_migration_version: "0087",
      activation_id_sha256: bytesHash(payload.activationId),
    };
    done(7, next);
    const receipt = {
      schema_version: "videoforge.v2-09-native-qualified-replacement/v1",
      prior_authority_sha256: hash(prior),
      prior_state_sha256: hash(state),
      prior_deployment_sha256: hash({
        source_commit: prior.source_commit,
        config_sha256: oldDeployment.config_sha256,
        worker_bundle_sha256: oldDeployment.worker_bundle_sha256,
        deployment_id_sha256: oldDeployment.deployment_id_sha256,
        deployment_row_id_sha256s: oldActivation.deployment_row_id_sha256s,
      }),
      prior_production_inputs_sha256: hash(prior.production_inputs),
      frozen_lanes_sha256: hash(prior.frozen_lanes),
      media_worker_inputs_sha256: hash(prior.media_worker_inputs),
      source_commit: p.source_commit,
      migration,
      new_deployment: next,
      previous_activation_id_sha256: bytesHash(oldPayload.activationId),
      activation_id_sha256: bytesHash(payload.activationId),
      operations,
      mutation_counts: {
        cloudflare_deployments: 1,
        migrations: 1,
        activation_imports: 1,
        secret_writes: 0,
        lane_creations: 0,
        media_installs: 0,
        provider_posts: 0,
        generate_clicks: 0,
        redispatches: 0,
      },
      caps: prior.caps,
    };
    durableNew(resolve(p.output_root, "replacement-receipt.json"), receipt);
    return receipt;
  } catch (error) {
    let containment = "NOT_DEPLOYED";
    if (existsSync(p.configuration.journalPath)) {
      const journal = cf.read();
      if (
        [
          "DEPLOY_INTENT",
          "DEPLOY_UNKNOWN",
          "DEPLOY_COMMITTED",
          "QUALIFIED_DISABLED_VERIFIED",
          "QUALIFIED_EFFECTIVE_VERIFIED",
        ].includes(journal.state)
      ) {
        try {
          await cf.containFailure();
          containment = "SAFE_DISABLED_INHERITED_SECRETS_RETAINED";
        } catch {
          containment = "MANUAL_RECONCILIATION_REQUIRED";
        }
      }
    }
    durableNew(resolve(p.output_root, "replacement-stop.json"), {
      status: "STOPPED_NO_RETRY",
      containment,
      error_code:
        typeof error?.message === "string" && /^V2_09_[A-Z0-9_]+$/.test(error.message)
          ? error.message
          : "BOUNDED_OPERATION_FAILED",
      generate_clicks: 0,
    });
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  executeNativeQualifiedReplacement({ planPath: process.argv[2], expectedSha256: process.argv[3] })
    .then((r) =>
      console.log(
        JSON.stringify({
          status: "QUALIFIED_REPLACEMENT_VERIFIED",
          receipt_sha256: hash(r),
          generate_clicks: 0,
        }),
      ),
    )
    .catch((e) => {
      console.error(
        /^V2_09_[A-Z0-9_]+$/.test(e?.message || "")
          ? e.message
          : "V2_09_NATIVE_REPLACEMENT_STOPPED",
      );
      process.exitCode = 1;
    });
}
