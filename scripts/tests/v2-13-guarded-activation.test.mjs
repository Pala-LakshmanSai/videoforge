import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { EXPECTED_RUNTIME_FUNCTIONS } from "../../deploy/v2-06/apply-migrations-and-grants.mjs";
import {
  assertDisabledVersionReadback,
  CONFIRMATION,
  extractSingleActiveVersion,
  SECRET_NAMES,
  plan,
  protectedSecrets,
  rolePrecheckQuery,
  safeEnvironment,
  secretMutationTransaction,
  validateSoulxApprovalRecords,
  validateAuthority,
} from "../../deploy/v2-13/guarded-activation.mjs";

const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const fingerprint = `sha256:${"a".repeat(64)}`;
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
    authority: {
      mode: "APPROVED_EXECUTE",
      execute_authorized: true,
      credential_access_authorized: true,
      database_mutation_authorized: true,
      cloudflare_secret_mutation_authorized: true,
      deployment_authorized: true,
      provider_calls_authorized: true,
      gpu_use_authorized: false,
      maximum_cumulative_finite_external_spend_usd: 0,
      new_retained_resources_authorized: false,
      approved_at: "2026-08-26T00:00:00.000Z",
      confirmation_sha256: hash(CONFIRMATION),
    },
    release: {
      commit: "1".repeat(40),
      migration_manifest_sha256: fingerprint,
      production_config_activation_sha256: fingerprint,
      media_worker_release_manifest_sha256: fingerprint,
    },
    database: {
      host: "example.neon.tech",
      database: "videoforge",
      owner_role: "videoforge_owner",
      runtime_role: "videoforge_runtime",
      reconciler_role: "videoforge_reconciler",
      pgcrypto_required: true,
      first_migration: 37,
      last_migration: 44,
      exact_manifest_ledger_required: true,
    },
    cloudflare: {
      account_id: "1".repeat(32),
      worker_name: "videoforge-production-runtime",
      preexisting_worker_required: true,
      preexisting_secret_set_must_be_empty: true,
      r2_bucket_name: "videoforge-production-private",
      workflow_name: "videoforge-production-video",
      public_origin: "https://videoforge.example",
      api_token_sha256: fingerprint,
      pre_mutation_active_commit: "2".repeat(40),
      pre_mutation_active_version_id: "11111111-1111-4111-8111-111111111111",
      pre_mutation_deployments_status_sha256: fingerprint,
      pre_mutation_active_version_readback_sha256: fingerprint,
      pre_mutation_route_readback_sha256: fingerprint,
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
  assert.equal(SECRET_NAMES.length, 21);
  assert.deepEqual(Object.keys(value.secret_sha256).sort(), [...SECRET_NAMES].sort());
  const result = plan(value);
  assert.equal(result.secret_values_in_plan, false);
  assert.equal(result.new_retained_resources, 0);
  assert.deepEqual(result.migration_range, [37, 44]);
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
});

test("invalid authority fails before credential seams or mutation commands are reached", () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-v2-13-invalid-authority-"));
  chmodSync(directory, 0o700);
  const activation = join(directory, "activation.json");
  const config = join(directory, "config.json");
  const release = join(directory, "release.json");
  try {
    writeFileSync(activation, JSON.stringify({ ...authority(), authority: { mode: "DENIED" } }), {
      mode: 0o600,
    });
    writeFileSync(config, "{}", { mode: 0o600 });
    writeFileSync(release, "{}", { mode: 0o600 });
    const result = spawnSync(
      process.execPath,
      [
        "deploy/v2-13/guarded-activation.mjs",
        "--execute",
        "--activation-record",
        activation,
        "--config-activation-record",
        config,
        "--release-manifest-file",
        release,
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
          "postgresql://videoforge_runtime:runtime-password@example.neon.tech/videoforge?sslmode=require&channel_binding=require";
      if (name === "VIDEOFORGE_RECONCILER_DATABASE_URL")
        secret =
          "postgresql://videoforge_reconciler:reconciler-password@example.neon.tech/videoforge?sslmode=require&channel_binding=require";
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
    assert.equal(secrets.size, 21);
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
      "PRIVATE_ARTIFACTS",
      "VIDEO_WORKFLOW",
      "HOSTED_PAIR_WORKFLOW",
      value.cloudflare.r2_bucket_name,
      value.cloudflare.workflow_name,
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

test("runtime post-check allowlist exactly covers granted 0038-0044 runtime functions", () => {
  const required = [
    "videoforge_append_hosted_canonical_timing(uuid,uuid,uuid,uuid,uuid,uuid,jsonb)",
    "videoforge_append_hosted_render_plan(uuid,uuid,uuid,uuid,text,jsonb,text)",
    "videoforge_begin_hosted_pair_send(uuid,uuid,uuid,text,uuid,text)",
    "videoforge_commit_hosted_atomic_pair_predispatch(uuid,text,uuid,uuid,uuid,uuid,uuid,uuid,text,uuid,jsonb,numeric,timestamp with time zone,jsonb)",
    "videoforge_finish_hosted_pair_send(uuid,uuid,uuid,text,text,text,uuid,text)",
    "videoforge_inspect_hosted_pair_runtime(uuid,uuid,uuid)",
    "videoforge_load_hosted_pair_activation(uuid,uuid,uuid)",
    "videoforge_load_hosted_pair_activation_v2(uuid,uuid,uuid)",
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
