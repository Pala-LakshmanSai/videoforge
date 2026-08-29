import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EXPECTED_RUNTIME_FUNCTIONS } from "../../deploy/v2-06/apply-migrations-and-grants.mjs";
import {
  APPROVED_WRANGLER_OAUTH_SCOPES,
  assertAbsentRouteReadback,
  assertDisabledVersionReadback,
  assertFullLiveActivationBinding,
  assertQualifiedRoute,
  assertTrustedAuthorityTime,
  assertWorkersDevOrigin,
  CONFIRMATION,
  consumeAuthorityOnce,
  deriveWorkersDevOrigin,
  extractSingleActiveVersion,
  readCloudflareWorkersDevOrigin,
  refreshWranglerOAuthReadback,
  SECRET_NAMES,
  plan,
  PREQUALIFICATION_OPERATOR_FUNCTIONS,
  PREQUALIFICATION_OPERATOR_GRANTS_SHA256,
  protectedSecrets,
  recoverQuarantineCreation,
  rolePrecheckQuery,
  safeEnvironment,
  secretMutationTransaction,
  validateAbsentInventoryReadbacks,
  validateAuthoritySourceFiles,
  validateSoulxApprovalRecords,
  validateAuthority,
  verifyPrequalificationDatabase,
  WORKFLOW_INVENTORY_PATH,
  workflowBootstrapConfig,
} from "../../deploy/v2-13/guarded-activation.mjs";

const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fingerprint = `sha256:${"a".repeat(64)}`;
const PREQUALIFICATION_SCHEMA_FOR_TEST =
  "videoforge.v213-prequalification-database-bootstrap-result/v3";
const canonicalJson = (value) =>
  Array.isArray(value)
    ? `[${value.map((item) => canonicalJson(item)).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const cropApproval = Object.freeze({
  approval_path:
    "project-context/evidence/acceptance/VF-10-08/2026-08-26-soulx-crop-profile-approval.json",
  approval_sha256: "sha256:c3aae03da3f0134e12c2f432951189bd205dcbb7ab26a65d44061cec82984c45",
  candidate_path: "project-context/evidence/candidates/VF-10-08/soulx-crop-profile-candidate.json",
  candidate_sha256: "sha256:f6c8dd219c07a26ab67fb13d8dbc103e110b4c045307f8c3e0c70aa3d805d442",
  profile_group_id: "soulx-pro-vf924u-full-split-v1",
  avatar_source_sha256: "sha256:37f07580badf2c459db496e0a74a15e524534b91432478d5e84e8f084e6b1e83",
  avatar_source_geometry: { width: 1672, height: 941 },
  native_sample_sha256: "sha256:db70cd410062572052313278f12d67393aba213ca607fa3a3b9e3f6aad948bf1",
  native_sample_geometry: { width: 512, height: 512, fps: 25 },
  full_profile_id: "soulx-pro-ranga-full-source-composite-v1",
  full_sample_sha256: "sha256:da31d87c2389769272733ff50a9114d4507a36aced1ebe48480c9ccf486de241",
  full_output_geometry: { width: 1920, height: 1080, fps: 30 },
  split_profile_id: "soulx-pro-ranga-split-composite-v1",
  split_sample_sha256: "sha256:f0b02351e38e2e8570e4e586b314da30813bb0a0eb09a567912bba9725b74993",
  split_output_geometry: { width: 1920, height: 1080, fps: 30 },
});

function authority() {
  return {
    schema_version: "videoforge-v2-13-guarded-activation/v1",
    checkpoint: "V2-13",
    full_live_authority_id: "11111111-1111-4111-8111-111111111111",
    authority: {
      mode: "APPROVED_EXECUTE",
      authority_id: "v2-13-test-authority-0001",
      proposal_path: "project-context/evidence/test-proposal.json",
      proposal_sha256: fingerprint,
      approval_path: "project-context/evidence/test-user-approval.txt",
      approval_sha256: `sha256:${"b".repeat(64)}`,
      single_use: true,
      execute_authorized: true,
      credential_access_authorized: true,
      database_mutation_authorized: true,
      cloudflare_secret_mutation_authorized: true,
      deployment_authorized: true,
      provider_calls_authorized: true,
      gpu_use_authorized: false,
      maximum_cumulative_finite_external_spend_usd: 0,
      exact_quarantine_creation_authorized: true,
      new_paid_retained_resources_authorized: false,
      other_resource_creation_authorized: false,
      plan_change_authorized: false,
      approved_at: "2026-08-26T00:00:00.000Z",
      expires_at: "2026-08-26T12:00:00.000Z",
      confirmation_sha256: hash(CONFIRMATION),
    },
    release: {
      commit: "1".repeat(40),
      migration_manifest_sha256: fingerprint,
      operator_grants_sha256: PREQUALIFICATION_OPERATOR_GRANTS_SHA256,
      production_config_activation_sha256: fingerprint,
      media_worker_release_manifest_sha256: fingerprint,
    },
    database: {
      host: "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech",
      database: "neondb",
      owner_role: "neondb_owner",
      operator_role: "videoforge_hosted_operator",
      operator_database_url_sha256: fingerprint,
      runtime_role: "videoforge_hosted_runtime",
      reconciler_role: "videoforge_hosted_reconciler",
      pgcrypto_required: true,
      first_migration: 37,
      last_migration: 46,
      exact_manifest_ledger_required: true,
    },
    cloudflare: {
      account_id: "1".repeat(32),
      worker_name: "videoforge-production-runtime",
      preexisting_worker_required: false,
      exact_quarantine_creation_authorized: true,
      failure_policy: "KEEP_EXACT_DISABLED_QUARANTINE_ELSE_DELETE_ATTRIBUTABLE",
      preexisting_secret_set_must_be_empty: true,
      r2_bucket_name: "videoforge-production-private",
      workflow_name: "videoforge-production-video",
      public_origin: "https://videoforge.example",
      wrangler_oauth_config_path_sha256: fingerprint,
      oauth_scopes: [...APPROVED_WRANGLER_OAUTH_SCOPES],
      workers_dev_subdomain: "lakshmansai121",
      workers_dev_subdomain_readback_sha256: fingerprint,
      pre_mutation_account_readback_sha256: fingerprint,
      pre_mutation_worker_absence_sha256: fingerprint,
      pre_mutation_workflow_inventory_sha256: fingerprint,
      pre_mutation_r2_inventory_sha256: fingerprint,
      pre_mutation_route_readback_sha256:
        "sha256:2000e6b28a1517ba1268e1649cd3163326ef839492edfdba31e8959830580976",
      pre_mutation_route_content_type: "text/html; charset=UTF-8",
      pre_mutation_route_body_length: 19984,
    },
    gates: {
      mage_qualification_sha256: fingerprint,
      soulx_qualification_sha256: fingerprint,
      mage_deployment_snapshot_sha256: fingerprint,
      soulx_deployment_snapshot_sha256: fingerprint,
      paid_dispatch_authority_sha256: fingerprint,
    },
    soulx_crop_approval: structuredClone(cropApproval),
    secret_sha256: Object.fromEntries(SECRET_NAMES.map((name) => [name, fingerprint])),
  };
}

test("default guarded activation is a provider-free zero-read dry run", () => {
  const result = spawnSync(process.execPath, ["deploy/v2-13/guarded-activation.mjs"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    schema_version: "videoforge-v2-13-guarded-activation-dry-run/v1",
    state: "DISABLED_UNQUALIFIED",
    credential_reads: 0,
    mutations: 0,
    provider_calls: 0,
    external_spend_usd: 0,
    new_retained_resources: 0,
  });
});

test("SoulX approval validator binds exact records, media bytes, statement, transforms, and fences", () => {
  const approvalBytes = readFileSync(cropApproval.approval_path);
  const candidateBytes = readFileSync(cropApproval.candidate_path);
  assert.equal(
    validateSoulxApprovalRecords(cropApproval, approvalBytes, candidateBytes, readFileSync),
    true,
  );
  const approval = JSON.parse(approvalBytes);
  for (const mutate of [
    (value) => (value.approval_statement = "generic approval"),
    (value) => (value.approved_profile.full.native_foreground_overlay.x = 421),
    (value) => (value.approved_profile.full.horizontal_alpha_feather_pixels_each_edge = 31),
    (value) => (value.approved_profile.split.avatar_crop.x = 31),
    (value) => (value.approved_profile.split.layout = "divider"),
    (value) => (value.activation.gpu_use_authorized = true),
  ]) {
    const drifted = structuredClone(approval);
    mutate(drifted);
    assert.throws(
      () =>
        validateSoulxApprovalRecords(
          cropApproval,
          Buffer.from(`${JSON.stringify(drifted, null, 2)}\n`),
          candidateBytes,
          readFileSync,
        ),
      /approval or candidate bytes do not match/u,
    );
  }
  assert.throws(
    () =>
      validateAuthority({
        ...authority(),
        soulx_crop_approval: { ...cropApproval, approval_sha256: fingerprint },
      }),
    /identity, media, or geometry pins/u,
  );
});

test("authority and plan are exact, zero-spend, and closed-world", () => {
  const value = validateAuthority(authority());
  assert.equal(SECRET_NAMES.length, 22);
  assert.deepEqual(Object.keys(value.secret_sha256).sort(), [...SECRET_NAMES].sort());
  const result = plan(value);
  assert.equal(result.secret_values_in_plan, false);
  assert.equal(result.new_paid_retained_resources, 0);
  assert.deepEqual(result.exact_product_resources_created, [
    "videoforge-production-runtime",
    "videoforge-production-video",
    "videoforge-production-video-pair",
  ]);
  assert.deepEqual(result.migration_range, [37, 46]);
  assert.throws(
    () =>
      validateAuthority({
        ...authority(),
        authority: { ...authority().authority, mode: "PROPOSAL_REQUIRED" },
      }),
    /authority is absent/u,
  );
  assert.throws(
    () => validateAuthority({ ...authority(), secret_sha256: { DATABASE_URL: fingerprint } }),
    /allowlist is not exact/u,
  );
  assert.throws(
    () =>
      validateAuthority({
        ...authority(),
        authority: { ...authority().authority, single_use: false },
      }),
    /authority is absent/u,
  );
  assert.throws(
    () =>
      validateAuthority({
        ...authority(),
        authority: {
          ...authority().authority,
          expires_at: "2026-08-28T00:00:00.000Z",
        },
      }),
    /authority is absent/u,
  );
});

test("trusted expiry and durable authority consumption are exact and non-replayable", () => {
  const value = validateAuthority(authority());
  assert.equal(assertTrustedAuthorityTime(value, "Wed, 26 Aug 2026 06:00:00 GMT"), true);
  assert.throws(
    () => assertTrustedAuthorityTime(value, "Wed, 26 Aug 2026 13:00:00 GMT"),
    /not current under trusted provider time/u,
  );
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-consumption-"));
  chmodSync(directory, 0o700);
  try {
    const bytes = Buffer.from(JSON.stringify(value));
    const path = consumeAuthorityOnce(value, bytes, directory);
    const record = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(record.authority_id, value.authority.authority_id);
    assert.equal(record.state, "CONSUMED_SINGLE_EXECUTION_NO_RETRY");
    assert.throws(() => consumeAuthorityOnce(value, bytes, directory), /already consumed/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("guarded activation rejects the superseded and now-stale V2 approval", () => {
  const proposal =
    "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-candidate/combined-live-proposal.json";
  const approval =
    "project-context/evidence/acceptance/VF-10-13/2026-08-26-full-activation-candidate/user-approval.json";
  const value = authority();
  value.authority.authority_id = "v2-13-full-live-20260826-033320z-e3bdabc";
  value.authority.proposal_path = proposal;
  value.authority.approval_path = approval;
  value.authority.proposal_sha256 = hash(readFileSync(proposal));
  value.authority.approval_sha256 = hash(readFileSync(approval));
  value.authority.approved_at = "2026-08-26T03:33:20Z";
  value.authority.expires_at = "2026-08-27T03:33:20Z";
  assert.throws(
    () => validateAuthoritySourceFiles(value, proposal, approval),
    /user approval does not satisfy the exact full-live schema/u,
  );
});

test("guarded activation binds exact V3 runtime and reconciler roles", () => {
  const value = authority();
  value.database.runtime_role = "videoforge_hosted_runtime";
  value.database.reconciler_role = "videoforge_hosted_reconciler";
  const validated = {
    proposalSchema: "videoforge.v2-13-full-live-completion-proposal/v3",
    exactRuntimeRole: "videoforge_hosted_runtime",
    exactReconcilerRole: "videoforge_hosted_reconciler",
  };
  assert.equal(assertFullLiveActivationBinding(value, validated), true);
  value.database.runtime_role = "videoforge_other_runtime";
  assert.throws(
    () => assertFullLiveActivationBinding(value, validated),
    /database roles do not match/u,
  );
});

test("guarded activation accepts only a distinct V4 successor authority and control commit", () => {
  const value = authority();
  value.database.runtime_role = "videoforge_hosted_runtime";
  value.database.reconciler_role = "videoforge_hosted_reconciler";
  const validated = {
    proposalSchema: "videoforge.v2-13-full-live-completion-proposal/v4",
    exactRuntimeRole: "videoforge_hosted_runtime",
    exactReconcilerRole: "videoforge_hosted_reconciler",
    releaseSourceCommit: "a".repeat(40),
    executionControlCommit: "b".repeat(40),
    authorityId: "v2-13-successor-authority",
    predecessorReleaseAttempt: { authority_id: "v2-13-predecessor-authority" },
  };
  assert.equal(assertFullLiveActivationBinding(value, validated), true);
  assert.throws(
    () =>
      assertFullLiveActivationBinding(value, {
        ...validated,
        executionControlCommit: validated.releaseSourceCommit,
      }),
    /replays the predecessor/u,
  );
  assert.throws(
    () =>
      assertFullLiveActivationBinding(value, {
        ...validated,
        authorityId: validated.predecessorReleaseAttempt.authority_id,
      }),
    /replays the predecessor/u,
  );
});

test("authority source paths and approval schema fail closed", () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-authority-sources-"));
  chmodSync(directory, 0o700);
  const proposal = join(directory, "proposal.json");
  const approval = join(directory, "approval.txt");
  const value = authority();
  try {
    writeFileSync(proposal, "exact proposal bytes\n");
    writeFileSync(approval, "exact user approval bytes\n");
    value.authority.proposal_path = proposal;
    value.authority.approval_path = approval;
    value.authority.proposal_sha256 = hash("exact proposal bytes\n");
    value.authority.approval_sha256 = hash("exact user approval bytes\n");
    assert.throws(
      () => validateAuthoritySourceFiles(value, proposal, approval),
      /safe repository-relative path/u,
    );
    value.authority.proposal_path = "evidence/proposal.json";
    value.authority.approval_path = "evidence/approval.json";
    assert.throws(
      () => validateAuthoritySourceFiles(value, proposal, approval),
      /not valid JSON|exact full-live schema/u,
    );
    writeFileSync(approval, "drifted approval bytes\n");
    assert.throws(
      () => validateAuthoritySourceFiles(value, proposal, approval),
      /user approval file bytes do not match/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid authority fails before credential seams or mutation commands are reached", () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-invalid-authority-"));
  chmodSync(directory, 0o700);
  const activation = join(directory, "activation.json");
  const config = join(directory, "config.json");
  const proposal = join(directory, "proposal.json");
  const release = join(directory, "release.json");
  const approval = join(directory, "approval.txt");
  try {
    writeFileSync(activation, JSON.stringify({ ...authority(), authority: { mode: "DENIED" } }), {
      mode: 0o600,
    });
    writeFileSync(config, "{}", { mode: 0o600 });
    writeFileSync(proposal, "proposal");
    writeFileSync(release, "{}", { mode: 0o600 });
    writeFileSync(approval, "approval");
    const result = spawnSync(
      process.execPath,
      [
        "deploy/v2-13/guarded-activation.mjs",
        "--execute",
        "--activation-record",
        activation,
        "--config-activation-record",
        config,
        "--proposal-file",
        proposal,
        "--release-manifest-file",
        release,
        "--user-approval-file",
        approval,
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /activation authority is absent/u);
    assert.doesNotMatch(result.stderr, /secret input directory|psql|wrangler/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("protected secret seam checks exact names, mode, hashes, and separate database roles", () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-secrets-"));
  chmodSync(directory, 0o700);
  const value = authority();
  try {
    for (const name of SECRET_NAMES) {
      let secret = `${name}-value`;
      if (name === "DATABASE_URL")
        secret =
          "postgresql://videoforge_hosted_runtime:runtime-password@ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
      if (name === "VIDEOFORGE_RECONCILER_DATABASE_URL")
        secret =
          "postgresql://videoforge_hosted_reconciler:reconciler-password@ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
      if (name === "VIDEOFORGE_OPERATOR_DATABASE_URL")
        secret =
          "postgresql://videoforge_hosted_operator:operator-password@ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require";
      if (name === "RUNPOD_API_BASE_URL") secret = "https://api.runpod.ai/v2";
      if (name === "VIDEOFORGE_MAGE_ENDPOINT_ID") secret = "mage-endpoint-1";
      if (name === "VIDEOFORGE_SOULX_ENDPOINT_ID") secret = "soulx-endpoint-1";
      if (name === "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256") secret = hash("mage-endpoint-1");
      if (name === "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256") secret = hash("soulx-endpoint-1");
      if (name === "VIDEOFORGE_DISPATCH_TOKEN_KEY") secret = "d".repeat(32);
      if (name === "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX") secret = "ab".repeat(32);
      if (name === "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY") secret = "cd".repeat(32);
      if (name === "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID") secret = "dispatch-key-v1";
      if (name === "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID") secret = "envelope-key-v1";
      if (name === "VIDEOFORGE_PROVIDER_PROOF_KEY_ID") secret = "proof-key-v1";
      writeFileSync(join(directory, name), secret, { mode: 0o600 });
      value.secret_sha256[name] = hash(secret);
    }
    const secrets = protectedSecrets(directory, validateAuthority(value));
    assert.equal(secrets.size, 22);
    assert.equal(JSON.stringify(secrets).includes("runtime-password"), false);
    const malformed = "postgresql://runtime:raw-password-that-must-not-leak@[";
    writeFileSync(join(directory, "DATABASE_URL"), malformed, { mode: 0o600 });
    value.secret_sha256.DATABASE_URL = hash(malformed);
    let thrown;
    try {
      protectedSecrets(directory, value);
    } catch (error) {
      thrown = String(error);
    }
    assert.match(thrown, /redacted valid URL/u);
    assert.doesNotMatch(thrown, /raw-password-that-must-not-leak/u);
    writeFileSync(join(directory, "UNALLOWLISTED"), "no", { mode: 0o600 });
    assert.throws(() => protectedSecrets(directory, value), /closed-world allowlist/u);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("partial secret failure removes only successfully introduced names and never deploys", async () => {
  const events = [];
  await assert.rejects(
    secretMutationTransaction({
      names: ["A", "B", "C"],
      async put(name) {
        events.push(`put:${name}`);
        if (name === "C") throw new Error("injected failure");
      },
      async verify() {
        events.push("verify");
      },
      async deploy() {
        events.push("deploy");
      },
      async remove(name) {
        events.push(`remove:${name}`);
      },
    }),
    /injected failure/u,
  );
  assert.deepEqual(events, ["put:A", "put:B", "put:C", "remove:B", "remove:A"]);
});

test("post-mutation readback failure still deletes the introduced secret", async () => {
  const events = [];
  await assert.rejects(
    secretMutationTransaction({
      names: ["A", "B"],
      async put(name) {
        events.push(`mutated:${name}`);
      },
      async afterPut(name) {
        events.push(`readback:${name}`);
        if (name === "A") throw new Error("readback failed after mutation");
      },
      async verify() {
        events.push("verify");
      },
      async deploy() {
        events.push("deploy");
      },
      async remove(name) {
        events.push(`remove:${name}`);
      },
    }),
    /readback failed after mutation/u,
  );
  assert.deepEqual(events, ["mutated:A", "readback:A", "remove:A"]);
});

test("stale, enabled, or split Cloudflare versions fail before secret mutation", () => {
  const value = authority();
  value.cloudflare.pre_mutation_active_version_id = "11111111-1111-4111-8111-111111111111";
  value.cloudflare.pre_mutation_active_commit = "2".repeat(40);
  const exact = JSON.stringify({
    versions: [{ version_id: value.cloudflare.pre_mutation_active_version_id, percentage: 100 }],
  });
  assert.equal(extractSingleActiveVersion(exact), value.cloudflare.pre_mutation_active_version_id);
  assert.throws(
    () =>
      extractSingleActiveVersion(
        JSON.stringify({
          versions: [
            { version_id: "11111111-1111-4111-8111-111111111111", percentage: 50 },
            { version_id: "22222222-2222-4222-8222-222222222222", percentage: 50 },
          ],
        }),
      ),
    /one exact 100-percent version/u,
  );
  const readback = {
    commit: value.cloudflare.pre_mutation_active_commit,
    vars: { VIDEOFORGE_GPU_TRANSPORT: "DISABLED_UNQUALIFIED" },
    worker: "videoforge-production-runtime",
    bindings: [
      { binding: "PRIVATE_ARTIFACTS", bucket_name: value.cloudflare.r2_bucket_name },
      { binding: "VIDEO_WORKFLOW", name: value.cloudflare.workflow_name },
      { binding: "HOSTED_PAIR_WORKFLOW", name: `${value.cloudflare.workflow_name}-pair` },
    ],
  };
  assert.equal(
    assertDisabledVersionReadback(
      JSON.stringify(readback),
      value,
      value.cloudflare.pre_mutation_active_commit,
    ),
    true,
  );
  assert.throws(
    () =>
      assertDisabledVersionReadback(
        JSON.stringify({ ...readback, commit: "3".repeat(40) }),
        value,
        value.cloudflare.pre_mutation_active_commit,
      ),
    /identity is incomplete/u,
  );
  assert.throws(
    () =>
      assertDisabledVersionReadback(
        JSON.stringify({ ...readback, vars: { VIDEOFORGE_GPU_TRANSPORT: "QUALIFIED_EXACT" } }),
        value,
        value.cloudflare.pre_mutation_active_commit,
      ),
    /identity is incomplete|enabled GPU/u,
  );
  assert.throws(
    () =>
      assertDisabledVersionReadback(
        JSON.stringify({
          ...readback,
          bindings: readback.bindings.map((binding) =>
            binding.binding === "HOSTED_PAIR_WORKFLOW"
              ? { ...binding, name: value.cloudflare.workflow_name }
              : binding,
          ),
        }),
        value,
        value.cloudflare.pre_mutation_active_commit,
      ),
    /HOSTED_PAIR_WORKFLOW binding is not the exact pair/u,
  );
  assert.throws(
    () =>
      assertDisabledVersionReadback(
        JSON.stringify({
          ...readback,
          bindings: readback.bindings.map((binding) =>
            binding.binding === "VIDEO_WORKFLOW"
              ? { ...binding, name: `${value.cloudflare.workflow_name}-wrong` }
              : binding,
          ),
        }),
        value,
        value.cloudflare.pre_mutation_active_commit,
      ),
    /VIDEO_WORKFLOW binding is not the exact primary/u,
  );
});

test("absent Worker preflight accepts only exact account, no Workflow collision, and existing R2", () => {
  const value = authority();
  const account = JSON.stringify({
    body: { result: { id: value.cloudflare.account_id }, success: true },
    status: 200,
  });
  const absence = JSON.stringify({ body: { success: false }, status: 404 });
  const workflows = JSON.stringify({
    body: {
      result: [{ name: "unrelated-workflow" }],
      result_info: { count: 1, page: 1, total_count: 1, total_pages: 1 },
      success: true,
    },
    status: 200,
  });
  const buckets = JSON.stringify({
    body: {
      result: { buckets: [{ name: value.cloudflare.r2_bucket_name }] },
      result_info: { count: 1, page: 1, total_count: 1, total_pages: 1 },
      success: true,
    },
    status: 200,
  });
  value.cloudflare.pre_mutation_account_readback_sha256 = hash(account);
  value.cloudflare.pre_mutation_worker_absence_sha256 = hash(absence);
  value.cloudflare.pre_mutation_workflow_inventory_sha256 = hash(workflows);
  value.cloudflare.pre_mutation_r2_inventory_sha256 = hash(buckets);
  assert.deepEqual(
    validateAbsentInventoryReadbacks(value, { account, absence, workflows, buckets }),
    {
      intendedWorkflows: [value.cloudflare.workflow_name, `${value.cloudflare.workflow_name}-pair`],
      workflowNames: ["unrelated-workflow"],
    },
  );
  const wrongAccount = JSON.stringify({
    body: { result: { id: "2".repeat(32) }, success: true },
    status: 200,
  });
  value.cloudflare.pre_mutation_account_readback_sha256 = hash(wrongAccount);
  assert.throws(
    () =>
      validateAbsentInventoryReadbacks(value, {
        account: wrongAccount,
        absence,
        workflows,
        buckets,
      }),
    /exact successful response/u,
  );
  value.cloudflare.pre_mutation_account_readback_sha256 = hash(account);
  const existing = JSON.stringify({ body: { success: true }, status: 200 });
  value.cloudflare.pre_mutation_worker_absence_sha256 = hash(existing);
  assert.throws(
    () =>
      validateAbsentInventoryReadbacks(value, {
        account,
        absence: existing,
        workflows,
        buckets,
      }),
    /unexpectedly exists/u,
  );
  const collision = JSON.stringify({
    body: {
      result: [{ name: value.cloudflare.workflow_name }],
      result_info: { count: 1, page: 1, total_count: 1, total_pages: 1 },
      success: true,
    },
    status: 200,
  });
  value.cloudflare.pre_mutation_worker_absence_sha256 = hash(absence);
  value.cloudflare.pre_mutation_workflow_inventory_sha256 = hash(collision);
  assert.throws(
    () =>
      validateAbsentInventoryReadbacks(value, {
        account,
        absence,
        workflows: collision,
        buckets,
      }),
    /name collision/u,
  );
  const paged = JSON.stringify({
    body: {
      result: [{ name: "unrelated-workflow" }],
      result_info: { count: 1, page: 1, total_count: 2, total_pages: 2 },
      success: true,
    },
    status: 200,
  });
  value.cloudflare.pre_mutation_workflow_inventory_sha256 = hash(paged);
  assert.throws(
    () =>
      validateAbsentInventoryReadbacks(value, {
        account,
        absence,
        workflows: paged,
        buckets,
      }),
    /pagination is incomplete/u,
  );
  const missingPagination = JSON.stringify({ body: { result: [], success: true }, status: 200 });
  value.cloudflare.pre_mutation_workflow_inventory_sha256 = hash(missingPagination);
  assert.throws(
    () =>
      validateAbsentInventoryReadbacks(value, {
        account,
        absence,
        workflows: missingPagination,
        buckets,
      }),
    /pagination metadata is missing or ambiguous/u,
  );
  const ambiguousPagination = JSON.stringify({
    body: {
      result: {
        result_info: { count: 0, page: 1, total_count: 0, total_pages: 1 },
      },
      result_info: { count: 0, page: 1, total_count: 0, total_pages: 1 },
      success: true,
    },
    status: 200,
  });
  value.cloudflare.pre_mutation_workflow_inventory_sha256 = hash(ambiguousPagination);
  assert.throws(
    () =>
      validateAbsentInventoryReadbacks(value, {
        account,
        absence,
        workflows: ambiguousPagination,
        buckets,
      }),
    /pagination metadata is missing or ambiguous/u,
  );
  const pagedBuckets = JSON.stringify({
    body: {
      result: { buckets: [{ name: value.cloudflare.r2_bucket_name }] },
      result_info: { count: 1, page: 1, total_count: 2, total_pages: 2 },
      success: true,
    },
    status: 200,
  });
  value.cloudflare.pre_mutation_workflow_inventory_sha256 = hash(workflows);
  value.cloudflare.pre_mutation_r2_inventory_sha256 = hash(pagedBuckets);
  assert.throws(
    () =>
      validateAbsentInventoryReadbacks(value, {
        account,
        absence,
        workflows,
        buckets: pagedBuckets,
      }),
    /pagination is incomplete/u,
  );
});

test("partial quarantine creation keeps only exact disabled state or deletes attributable names", async () => {
  const kept = [];
  assert.equal(
    await recoverQuarantineCreation({
      async verifyExactDisabled() {
        kept.push("verified-disabled");
      },
      async deleteWorker() {
        kept.push("unexpected-delete");
      },
      async deleteWorkflow() {},
      intendedWorkflows: ["a", "b"],
      async verifyAbsent() {},
    }),
    "KEPT_EXACT_DISABLED_QUARANTINE",
  );
  assert.deepEqual(kept, ["verified-disabled"]);
  const cleaned = [];
  assert.equal(
    await recoverQuarantineCreation({
      async verifyExactDisabled() {
        throw new Error("partial create");
      },
      async deleteWorker() {
        cleaned.push("worker");
      },
      async deleteWorkflow(name) {
        cleaned.push(name);
      },
      intendedWorkflows: ["workflow", "workflow-pair"],
      async verifyAbsent() {
        cleaned.push("absence");
      },
    }),
    "DELETED_ATTRIBUTABLE_AND_REVERIFIED_ABSENT",
  );
  assert.deepEqual(cleaned, ["worker", "workflow", "workflow-pair", "absence"]);
});

test("Cloudflare OAuth subdomain readback derives an exact origin without exporting the token", async () => {
  const directory = mkdtempSync(join(tmpdir(), "v213-cloudflare-oauth-test-"));
  const configPath = join(directory, "default.toml");
  writeFileSync(
    configPath,
    [
      'oauth_token = "oauth-test-token"',
      'expiration_time = "2099-01-01T00:00:00.000Z"',
      'refresh_token = "refresh-test-token"',
      'scopes = ["account:read", "workers_scripts:write"]',
      "",
    ].join("\n"),
    { mode: 0o600 },
  );
  const calls = [];
  const whoami = () => ({
    status: 0,
    stdout: JSON.stringify({
      loggedIn: true,
      authType: "OAuth Token",
      email: null,
      accounts: [{ id: "1".repeat(32) }],
      tokenPermissions: ["account:read", "workers_scripts:write"],
    }),
    stderr: "",
  });
  try {
    const origin = await readCloudflareWorkersDevOrigin({
      configPath,
      accountId: "1".repeat(32),
      workerName: "videoforge-production-runtime",
      expectedScopes: ["account:read", "workers_scripts:write"],
      spawn: whoami,
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return {
          status: 200,
          headers: { get: (name) => (name === "date" ? "2026-08-26T00:00:00.000Z" : null) },
          async json() {
            return {
              result: { subdomain: "account-subdomain" },
              success: true,
              errors: [],
              messages: [],
            };
          },
        };
      },
    });
    assert.deepEqual(Object.keys(origin).sort(), [
      "accountId",
      "accountSubdomain",
      "publicOrigin",
      "subdomainReadbackSha256",
      "trustedDate",
    ]);
    assert.equal(
      origin.publicOrigin,
      "https://videoforge-production-runtime.account-subdomain.workers.dev",
    );
    assert.equal(Object.hasOwn(origin, "token"), false);
    assert.equal(calls.length, 1);
    assert.match(
      calls[0].url,
      /\/accounts\/11111111111111111111111111111111\/workers\/subdomain$/u,
    );
    assert.equal(calls[0].options.method, "GET");
    assert.match(calls[0].options.headers.Authorization, /^Bearer oauth-test-token$/u);
    assert.equal(
      deriveWorkersDevOrigin({
        workerName: "videoforge-production-runtime",
        accountSubdomain: "account-subdomain",
      }),
      origin.publicOrigin,
    );
    assert.equal(
      assertWorkersDevOrigin(origin.publicOrigin, {
        workerName: "videoforge-production-runtime",
        accountSubdomain: "account-subdomain",
      }),
      true,
    );
    assert.throws(
      () =>
        assertWorkersDevOrigin(`${origin.publicOrigin}/api/v2/hosted/status`, {
          workerName: "videoforge-production-runtime",
          accountSubdomain: "account-subdomain",
        }),
      /exact account-bound origin/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Cloudflare pre-state binds exact absent 404 bytes while post-state accepts only disabled or qualified JSON", async () => {
  const value = authority();
  value.cloudflare.pre_mutation_route_readback_sha256 =
    "sha256:2000e6b28a1517ba1268e1649cd3163326ef839492edfdba31e8959830580976";
  assert.equal(
    assertAbsentRouteReadback(
      {
        status: 404,
        bodySha256: "sha256:2000e6b28a1517ba1268e1649cd3163326ef839492edfdba31e8959830580976",
        bodyLength: 19984,
        contentType: value.cloudflare.pre_mutation_route_content_type,
      },
      value,
    ),
    true,
  );
  assert.throws(
    () =>
      assertAbsentRouteReadback(
        {
          status: 503,
          bodySha256: fingerprint,
          bodyLength: 19984,
          contentType: "application/json",
        },
        value,
      ),
    /exact absent 404 readback/u,
  );
  assert.throws(
    () =>
      assertAbsentRouteReadback(
        { status: 404, bodySha256: fingerprint, bodyLength: 19984, contentType: "text/plain" },
        {
          ...value,
          cloudflare: { ...value.cloudflare, pre_mutation_route_readback_sha256: hash("other") },
        },
      ),
    /exact absent 404 readback/u,
  );
  const fetchImpl = async () => ({
    status: 200,
    async json() {
      return {
        schema_version: "videoforge-hosted-status/v1",
        commit: value.release.commit,
        gpu_transport: "QUALIFIED_EXACT",
      };
    },
  });
  assert.equal(await assertQualifiedRoute(value, { fetchImpl }), true);
  await assert.rejects(
    assertQualifiedRoute(value, {
      fetchImpl: async () => ({
        status: 200,
        async json() {
          return {
            schema_version: "videoforge-hosted-status/v1",
            commit: value.release.commit,
            gpu_transport: "DISABLED_UNQUALIFIED",
          };
        },
      }),
    }),
    /exact enabled status/u,
  );
});

test("Wrangler OAuth whoami refresh reopens the protected config and fails closed on failure or drift", () => {
  const directory = mkdtempSync(join(tmpdir(), "v213-cloudflare-oauth-refresh-test-"));
  const configPath = join(directory, "default.toml");
  const accountId = "2".repeat(32);
  const scopes = ["account:read", "workers_scripts:write"];
  const toml = (expiration) =>
    [
      'oauth_token = "oauth-refresh-test-token"',
      `expiration_time = "${expiration}"`,
      'refresh_token = "refresh-test-token"',
      `scopes = ${JSON.stringify(scopes)}`,
      "",
    ].join("\n");
  const whoami = (id = accountId, tokenPermissions = scopes) => ({
    status: 0,
    stdout: JSON.stringify({
      loggedIn: true,
      authType: "OAuth Token",
      email: null,
      accounts: [{ id }],
      tokenPermissions,
    }),
    stderr: "",
  });
  try {
    writeFileSync(configPath, toml("2000-01-01T00:00:00.000Z"), { mode: 0o600 });
    const refreshed = refreshWranglerOAuthReadback({
      configPath,
      environment: { HOME: directory, PATH: "/usr/bin:/bin" },
      accountId,
      expectedScopes: scopes,
      spawn: (_command, _args, options) => {
        assert.equal(options.env.CLOUDFLARE_API_TOKEN, undefined);
        writeFileSync(configPath, toml("2099-01-01T00:00:00.000Z"));
        return whoami();
      },
    });
    assert.equal(refreshed.accountId, accountId);
    assert.deepEqual(refreshed.scopes, scopes);
    assert.ok(refreshed.remainingMs > 60_000);
    writeFileSync(configPath, toml("2099-01-01T00:00:00.000Z"));
    assert.throws(
      () =>
        refreshWranglerOAuthReadback({
          configPath,
          environment: { HOME: directory, PATH: "/usr/bin:/bin" },
          accountId,
          expectedScopes: scopes,
          spawn: () => ({ status: 1, stdout: "", stderr: "redacted" }),
        }),
      /refresh\/readback failed/u,
    );
    assert.throws(
      () =>
        refreshWranglerOAuthReadback({
          configPath,
          environment: { HOME: directory, PATH: "/usr/bin:/bin" },
          accountId,
          expectedScopes: scopes,
          spawn: () => whoami("3".repeat(32)),
        }),
      /account or authentication drifted/u,
    );
    assert.throws(
      () =>
        refreshWranglerOAuthReadback({
          configPath,
          environment: { HOME: directory, PATH: "/usr/bin:/bin" },
          accountId,
          expectedScopes: scopes,
          spawn: () => whoami(accountId, ["account:read"]),
        }),
      /scopes drifted/u,
    );
    assert.throws(
      () =>
        refreshWranglerOAuthReadback({
          configPath,
          environment: { HOME: directory, PATH: "/usr/bin:/bin" },
          accountId,
          spawn: () => whoami(),
        }),
      /expected scopes are missing from the authority boundary/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Cloudflare post-preflight seams keep OAuth scope expectations authority-bound", () => {
  const source = readFileSync("deploy/v2-13/guarded-activation.mjs", "utf8");
  const activation = source.slice(source.indexOf("async function cloudflareActivation"));
  assert.doesNotMatch(source, /export\s*\{[^}]*readWranglerOAuthToken/su);
  assert.match(
    source,
    /function wrangler\([\s\S]*?authorityOAuthScopes\(authority, expectedScopes\)/u,
  );
  assert.match(
    source,
    /function wranglerResult\([\s\S]*?authorityOAuthScopes\(authority, expectedScopes\)/u,
  );
  assert.match(source, /function cloudflareSecretNames\(configPath, environment, authority/u);
  assert.match(activation, /expectedScopes: authorityOAuthScopes\(authority\)/u);
  assert.match(activation, /cloudflareSecretNames\([^,]+, environment, authority\)/u);
  const adapters = readFileSync("deploy/v2-13/full-live-adapters.mjs", "utf8");
  const promotion = adapters.slice(
    adapters.indexOf("function createProtectedPromotionAdapter"),
    adapters.indexOf("function createV213DurableStageStore"),
  );
  assert.match(promotion, /const expectedScopes = promotionPreflight\.expectedScopes/u);
  assert.match(promotion, /expectedScopes,\s*spawn/u);
  assert.match(
    adapters,
    /const expectedScopes = Object\.freeze\(\[\.\.\.APPROVED_WRANGLER_OAUTH_SCOPES\]\)/u,
  );
});

test("auto-create bootstrap can create only the exact Worker and two Workflows", () => {
  const full = {
    name: "videoforge-production-runtime",
    r2_buckets: [{ binding: "PRIVATE_ARTIFACTS", bucket_name: "existing-bucket" }],
    workflows: [
      { binding: "VIDEO_WORKFLOW", name: "video" },
      { binding: "HOSTED_PAIR_WORKFLOW", name: "video-pair" },
    ],
    assets: { binding: "ASSETS", directory: "dist" },
  };
  const bootstrap = workflowBootstrapConfig(full);
  assert.equal(Object.hasOwn(bootstrap, "r2_buckets"), false);
  assert.deepEqual(bootstrap.workflows, full.workflows);
  assert.deepEqual(full.r2_buckets, [
    { binding: "PRIVATE_ARTIFACTS", bucket_name: "existing-bucket" },
  ]);
  assert.throws(
    () => workflowBootstrapConfig({ ...full, workflows: [full.workflows[0]] }),
    /exact two Workflow bindings/u,
  );
  assert.throws(
    () =>
      workflowBootstrapConfig({
        ...full,
        workflows: [full.workflows[0], { ...full.workflows[1], name: "wrong-pair" }],
      }),
    /exact structural Workflow bindings/u,
  );
});

test("activation source orders exact readback and disabled quarantine before credentials and secrets", () => {
  const source = readFileSync("deploy/v2-13/guarded-activation.mjs", "utf8");
  const main = source.slice(source.indexOf("async function main"));
  assert.ok(main.indexOf("cloudflarePreflight(args") < main.indexOf("protectedSecrets("));
  assert.ok(main.indexOf("cloudflarePreflight(args") < main.indexOf("databaseActivation("));
  const activation = source.slice(source.indexOf("async function cloudflareActivation"));
  assert.ok(
    activation.indexOf("cloudflareReadOnlyPreflight(") <
      activation.indexOf("secretMutationTransaction"),
  );
  assert.ok(
    activation.indexOf("disabled-quarantine") < activation.indexOf("secretMutationTransaction"),
  );
  assert.ok(
    activation.indexOf("readBackDisabledQuarantine") <
      activation.indexOf("secretMutationTransaction"),
  );
  assert.ok(
    activation.indexOf("await databaseStage()") < activation.indexOf("secretMutationTransaction"),
  );
  assert.ok(
    activation.indexOf("disabled-quarantine") < activation.indexOf("await databaseStage()"),
  );
  assert.match(activation, /disabled-rollback/u);
  assert.match(activation, /--x-auto-create/u);
  const environment = safeEnvironment();
  for (const name of ["CLOUDFLARE_API_TOKEN", "DATABASE_URL", "RUNPOD_API_KEY", "PGPASSWORD"])
    assert.equal(Object.hasOwn(environment, name), false);
});

test("guarded activation creates and grants the narrow full-live operator role", () => {
  const source = readFileSync("deploy/v2-13/guarded-activation.mjs", "utf8");
  const grants = readFileSync("deploy/v2-13/neon-full-live-operator-grants.sql", "utf8");
  assert.match(source, /neon-full-live-operator-grants\.sql/u);
  assert.match(source, /operator\.database-url/u);
  for (const signature of [
    "videoforge_record_hosted_full_live_authority(uuid,jsonb)",
    "videoforge_promote_hosted_full_live(uuid,uuid,jsonb)",
    "videoforge_record_v213_cloudflare_activation(uuid,jsonb)",
    "videoforge_record_v213_cloudflare_rollback(uuid,jsonb)",
  ])
    assert.match(grants, new RegExp(signature.replaceAll(/[()]/gu, "\\$&"), "u"));
});

test("Workflow inventory readbacks request one explicit closed 100-item page", () => {
  const source = readFileSync("deploy/v2-13/guarded-activation.mjs", "utf8");
  assert.equal(WORKFLOW_INVENTORY_PATH, "/workflows?page=1&per_page=100");
  assert.equal(
    (source.match(/await cloudflareWorkflowInventoryReadback\(environment, authority\)/gu) ?? [])
      .length,
    1,
  );
  assert.equal(
    (source.match(/cloudflareApiReadback\(environment, authority, "\/workflows"\)/gu) ?? []).length,
    0,
  );
});

test("runtime post-check allowlist exactly covers granted 0038-0045 runtime functions", () => {
  const required = [
    "videoforge_append_hosted_canonical_timing(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)",
    "videoforge_append_hosted_render_plan(uuid,uuid,uuid,uuid,text,jsonb,text)",
    "videoforge_begin_hosted_pair_send(uuid,uuid,uuid,text,uuid,text)",
    "videoforge_commit_hosted_atomic_pair_predispatch(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamp with time zone,jsonb,jsonb)",
    "videoforge_finish_hosted_pair_send(uuid,uuid,uuid,text,text,text,uuid,text)",
    "videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)",
    "videoforge_load_hosted_pair_activation(uuid,uuid,uuid)",
    "videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid)",
    "videoforge_load_hosted_gpu_activation_v1()",
    "videoforge_claim_v213_workflow_start(jsonb)",
    "videoforge_complete_v213_workflow_start(jsonb)",
    "videoforge_load_v213_workflow_start(jsonb)",
    "videoforge_load_hosted_pair_workflow_schedule(uuid,uuid,uuid)",
    "videoforge_materialize_hosted_lane_batches(uuid,uuid,uuid,uuid,uuid,text,jsonb)",
    "videoforge_prepare_hosted_pair_send(uuid,uuid,uuid)",
    "videoforge_recover_hosted_atomic_pair_tokens(uuid,uuid,uuid)",
  ];
  for (const signature of required) assert.ok(EXPECTED_RUNTIME_FUNCTIONS.includes(signature));
  const source = readFileSync("deploy/v2-06/apply-migrations-and-grants.mjs", "utf8");
  assert.match(source, /applyGrants && !verifyOnly/u);
  assert.match(source, /V2_06_REQUIRED_LEDGER_PREFIX_VERSION/u);
  assert.match(source, /database must have exactly/u);
  assert.match(source, /runtime function grants do not exactly match/u);
});

test("role precheck rejects direct and dangerous effective privileges before password mutation", () => {
  const query = rolePrecheckQuery(authority());
  assert.match(query, /count\(\*\)=0 FROM pg_roles/u);
  for (const catalog of ["pg_database", "pg_namespace", "pg_class", "pg_proc", "pg_default_acl"])
    assert.match(query, new RegExp(catalog, "u"));
  for (const predicate of [
    "aclexplode(d.datacl)",
    "aclexplode(n.nspacl)",
    "aclexplode(c.relacl)",
    "aclexplode(p.proacl)",
    "has_database_privilege",
    "has_schema_privilege",
    "has_table_privilege",
    "has_sequence_privilege",
    "has_function_privilege",
  ])
    assert.ok(query.includes(predicate), `missing pre-mutation privilege predicate: ${predicate}`);
  for (const privilege of [
    "SELECT",
    "INSERT",
    "UPDATE",
    "DELETE",
    "TRUNCATE",
    "REFERENCES",
    "TRIGGER",
  ])
    assert.ok(
      query.includes(`has_table_privilege(r.oid,c.oid,'${privilege}')`),
      `missing table privilege check: ${privilege}`,
    );
  for (const privilege of ["USAGE", "SELECT", "UPDATE"])
    assert.ok(
      query.includes(`has_sequence_privilege(r.oid,c.oid,'${privilege}')`),
      `missing sequence privilege check: ${privilege}`,
    );
  const source = readFileSync("deploy/v2-13/guarded-activation.mjs", "utf8");
  assert.doesNotMatch(source, /ALTER ROLE %I LOGIN/u);
  assert.ok(
    source.indexOf("rolePrecheckQuery(authority)") < source.indexOf("CREATE ROLE %I LOGIN"),
  );
});

test("guarded prequalification verifier proves manifest, receipt CAS, pgcrypto, and effective operator ACL before any provider seam", async () => {
  const directory = mkdtempSync(join(tmpdir(), "v213-guarded-prequalification-test-"));
  chmodSync(directory, 0o700);
  const servicePath = join(directory, "owner.pg_service.conf");
  const passPath = join(directory, "owner.pgpass");
  const manifestBytes = readFileSync("packages/control-plane/migrations/manifest.json");
  const manifest = JSON.parse(manifestBytes);
  const ledger = manifest.migrations.map(({ version, name, filename, sha256 }) => ({
    version,
    name,
    filename,
    sha256,
  }));
  const role = {
    flags: {
      rolcanlogin: true,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolinherit: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconfig: null,
    },
    memberships: 0,
    ownership: 0,
    extension_ownership: 0,
    database_acl: 0,
    effective_database_dangerous_acl: 0,
    schema_acl: ["public:USAGE"],
    effective_schema_dangerous_acl: 0,
    table_acl: 0,
    effective_table_acl: 0,
    sequence_acl: 0,
    effective_sequence_acl: 0,
    default_acl: 0,
    function_acl: [...PREQUALIFICATION_OPERATOR_FUNCTIONS].sort(),
    public_function_acl: [],
    public_default_function_acl: 0,
  };
  const before = ledger.slice(0, 36);
  const pgcrypto = { name: "pgcrypto", version: "1.3", schema: "public" };
  const body = {
    schema_version: PREQUALIFICATION_SCHEMA_FOR_TEST,
    full_live_authority_id: "11111111-1111-4111-8111-111111111111",
    outer_state_sha256: `sha256:${"e".repeat(64)}`,
    materialization_seed_sha256: `sha256:${"a".repeat(64)}`,
    database_identity_sha256:
      "sha256:7f2c802c531f4e5630d6a15b2f26bf65ea04f599b28c19fc3daa5d741c7567d7",
    ledger_before_count: 36,
    ledger_before_sha256: hash(`${canonicalJson(before)}\n`),
    ledger_after_sha256: hash(`${canonicalJson(ledger)}\n`),
    operator_acl_sha256: hash(`${canonicalJson(role)}\n`),
    operator_database_url_sha256: fingerprint,
    runtime_database_url_sha256: `sha256:${"b".repeat(64)}`,
    reconciler_database_url_sha256: `sha256:${"c".repeat(64)}`,
    database_role_credential_bundle_sha256: `sha256:${"d".repeat(64)}`,
    credential_bootstrap_receipt_sha256: `sha256:${"1".repeat(64)}`,
    production_secret_bootstrap_sha256: `sha256:${"2".repeat(64)}`,
    production_secrets_sha256: `sha256:${"3".repeat(64)}`,
    production_secret_file_sha256s: {
      DATABASE_URL: `sha256:${"4".repeat(64)}`,
      BETTER_AUTH_SECRET: `sha256:${"4".repeat(64)}`,
      GOOGLE_CLIENT_ID: `sha256:${"4".repeat(64)}`,
      GOOGLE_CLIENT_SECRET: `sha256:${"4".repeat(64)}`,
      R2_ACCESS_KEY_ID: `sha256:${"4".repeat(64)}`,
      R2_SECRET_ACCESS_KEY: `sha256:${"4".repeat(64)}`,
      WORKFLOW_CALLBACK_SECRET: `sha256:${"4".repeat(64)}`,
      MEDIA_WORKER_TOKEN_SECRET: `sha256:${"4".repeat(64)}`,
      VIDEOFORGE_RECONCILER_DATABASE_URL: `sha256:${"4".repeat(64)}`,
      VIDEOFORGE_DISPATCH_TOKEN_KEY: `sha256:${"4".repeat(64)}`,
      VIDEOFORGE_DISPATCH_TOKEN_KEY_ID: `sha256:${"4".repeat(64)}`,
      VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: `sha256:${"4".repeat(64)}`,
      VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: `sha256:${"4".repeat(64)}`,
      VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: `sha256:${"4".repeat(64)}`,
      VIDEOFORGE_PROVIDER_PROOF_KEY_ID: `sha256:${"4".repeat(64)}`,
      RUNPOD_API_KEY: `sha256:${"4".repeat(64)}`,
      RUNPOD_API_BASE_URL: `sha256:${"4".repeat(64)}`,
      VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: `sha256:${"4".repeat(64)}`,
    },
    internal_credential_key_ids: {
      pairDispatchTokenKeyId: "v213-dispatch-key",
      pairEnvelopeSigningKeyId: "v213-envelope-key",
      pairProviderProofKeyId: "v213-provider-proof-key",
      provenanceReceiptKeyId: "v213-provenance-receipt-key",
    },
    pgcrypto_sha256: hash(`${canonicalJson(pgcrypto)}\n`),
    recovery_mode: "FRESH_36_TO_46",
    runpod_calls: 0,
    cloudflare_calls: 0,
    application_secret_reads: 5,
  };
  const receipt = {
    ...body,
    prequalification_database_bootstrap_sha256: hash(`${canonicalJson(body)}\n`),
  };
  writeFileSync(
    servicePath,
    "[videoforge_v2_13_owner]\nhost=ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech\ndbname=neondb\nuser=neondb_owner\nsslmode=require\nchannel_binding=require\n",
    { mode: 0o600 },
  );
  writeFileSync(
    passPath,
    "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech:5432:neondb:neondb_owner:owner-password\n",
    {
      mode: 0o600,
    },
  );
  const receiptPath = join(directory, "prequalification-database-bootstrap.json");
  writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  const currentAuthority = structuredClone(authority());
  currentAuthority.release.migration_manifest_sha256 = hash(manifestBytes);
  currentAuthority.secret_sha256["DATABASE_URL"] = body.runtime_database_url_sha256;
  currentAuthority.secret_sha256.VIDEOFORGE_RECONCILER_DATABASE_URL =
    body.reconciler_database_url_sha256;
  const calls = [];
  const runCommand = (_command, args) => {
    const sql = args[args.indexOf("--command") + 1] ?? "";
    calls.push(sql);
    if (sql.includes("current_user")) return "neondb_owner";
    if (sql.includes("BEGIN;") && sql.includes("pg_advisory_xact_lock"))
      return ledger
        .map((row) => `${row.version}\t${row.name}\t${row.filename}\t${row.sha256}`)
        .join("\n");
    if (sql.includes("FROM pg_extension WHERE extname='pgcrypto'")) return JSON.stringify(pgcrypto);
    if (sql.includes("json_build_object('flags'")) return JSON.stringify(role);
    throw new Error(`unexpected guarded fake psql SQL: ${sql.slice(0, 100)}`);
  };
  try {
    const verified = await verifyPrequalificationDatabase(currentAuthority, directory, {
      runCommand,
    });
    assert.equal(
      verified.receipt.prequalification_database_bootstrap_sha256,
      receipt.prequalification_database_bootstrap_sha256,
    );
    assert.equal(verified.ledger.length, 46);
    assert.equal(verified.pgcrypto.name, "pgcrypto");
    assert.equal(verified.role.function_acl.length, 19);
    assert.equal(lstatSync(receiptPath).mode & 0o777, 0o600);
    assert.equal(
      calls.every((sql) => !sql.includes("CLOUDFLARE") && !sql.includes("production_secrets")),
      true,
    );
    const callsBeforeAuthorityDrift = calls.length;
    const wrongAuthority = structuredClone(receipt);
    wrongAuthority.full_live_authority_id = "22222222-2222-4222-8222-222222222222";
    const wrongAuthorityBody = { ...wrongAuthority };
    delete wrongAuthorityBody.prequalification_database_bootstrap_sha256;
    wrongAuthority.prequalification_database_bootstrap_sha256 = hash(
      `${canonicalJson(wrongAuthorityBody)}\n`,
    );
    writeFileSync(receiptPath, `${canonicalJson(wrongAuthority)}\n`, { mode: 0o600 });
    await assert.rejects(
      verifyPrequalificationDatabase(currentAuthority, directory, { runCommand }),
      /credential receipt does not match guarded authority/u,
    );
    assert.equal(calls.length, callsBeforeAuthorityDrift);
    writeFileSync(receiptPath, `${canonicalJson(receipt)}\n`, { mode: 0o600 });
    const callsBeforeIdentityDrift = calls.length;
    const drifted = structuredClone(receipt);
    drifted.database_identity_sha256 = `sha256:${"0".repeat(64)}`;
    const driftedBody = { ...drifted };
    delete driftedBody.prequalification_database_bootstrap_sha256;
    drifted.prequalification_database_bootstrap_sha256 = hash(`${canonicalJson(driftedBody)}\n`);
    writeFileSync(receiptPath, `${canonicalJson(drifted)}\n`, { mode: 0o600 });
    await assert.rejects(
      verifyPrequalificationDatabase(currentAuthority, directory, { runCommand }),
      /receipt contract drifted/u,
    );
    assert.equal(calls.length, callsBeforeIdentityDrift);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
