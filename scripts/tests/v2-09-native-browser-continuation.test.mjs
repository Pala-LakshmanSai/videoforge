import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { STAGED_OPERATION_IDS } from "../../deploy/v2-09/execute-combined-qualified-production.mjs";
import {
  validateV209NativeBrowserContinuation as validate,
  createV209NativeBrowserJournal,
  hashNativeBrowser as hash,
} from "../../deploy/v2-09/native-browser-continuation.mjs";
const H = (x) => "sha256:" + x.repeat(64),
  source = "a".repeat(40),
  oldSource = "b".repeat(40),
  now = new Date("2026-09-08T10:00:00.000Z");
function fixture() {
  const caps = { max_completion_usd: 17.5, max_incremental_usd: 2 },
    jobs = {
      chrome_e2e_runs: 1,
      generation_requests: 1,
      redispatches: 0,
      stage_6_jobs: 0,
      stage_7_jobs: 0,
    };
  const priorAuthority = {
    authority_id: "v2-09-prior123456",
    source_commit: oldSource,
    proposal_sha256: H("1"),
    single_use: true,
    caps,
    job_limits: jobs,
    expires_at: "2026-09-09T10:00:00.000Z",
    media_worker_inputs: { execution_bundle_sha256: H("2") },
  };
  const common = {
    config_sha256: H("3"),
    worker_bundle_sha256: H("4"),
    deployment_id_sha256: H("5"),
  };
  const results = {
    "deploy-cloudflare-qualified-production": common,
    "readback-qualified-production": common,
    "import-v209-qualified-activation": {
      ...common,
      cloudflare_deployment_id_sha256: H("5"),
      qualified_activation_active: true,
      effective_gpu_transport: "QUALIFIED_EXACT",
      deployment_row_id_sha256s: [H("6"), H("7")],
    },
    "install-media-worker-0.1.15": {
      release: "0.1.15",
      online: true,
      execution_bundle_sha256: H("2"),
    },
  };
  const priorState = {
    status: "AWAITING_INTERACTIVE_CHROME_LOGIN",
    consumed_once: true,
    inner_authority_id: null,
    inner_authority_sha256: null,
    outer_authority_id: priorAuthority.authority_id,
    source_commit: oldSource,
    proposal_sha256: H("1"),
    operations: STAGED_OPERATION_IDS.map((id, i) => ({
      id,
      status: i < 22 ? "COMPLETED" : i === 22 ? "STARTED" : "PENDING",
      ...(i < 22 ? { result: results[id] ?? {}, result_sha256: hash(results[id] ?? {}) } : {}),
    })),
  };
  const deployment = {
    schema_version: "videoforge.v2-09-native-deployment-readback/v1",
    observed_at: now.toISOString(),
    source_commit: oldSource,
    ...common,
    deployment_row_id_sha256s: [H("6"), H("7")],
    gpu_transport: "QUALIFIED_EXACT",
    installed_release: "0.1.15",
    media_worker_bundle_sha256: H("2"),
    paid_compute_zero: true,
    completion_total_usd: 3.5,
    incremental_spend_usd: 0,
  };
  const nativeAuthReceipt = {
    schema_version: "videoforge.v2-09-native-auth/v1",
    observed_at: now.toISOString(),
    browser: "chrome",
    tab_id: "tab-12",
    origin: "https://example.test",
    account_id_sha256: H("8"),
    workspace_id_sha256: H("9"),
    approved_account_sha256: H("8"),
    paired_worker_account_sha256: H("8"),
    avatar_profile_version_sha256: H("b"),
    image_style_version_sha256: H("c"),
    tenant_authenticated: true,
    catalog_ready: true,
    worker_online: true,
    generate_clicks: 0,
    cookies_exported: false,
    profile_read: false,
  };
  const authority = {
    schema_version: "videoforge.v2-09-native-browser-authority/v1",
    authority_id: "v2-09-native-12345678",
    source_commit: source,
    issued_at: now.toISOString(),
    expires_at: "2026-09-08T11:00:00.000Z",
    single_use: true,
    prior_authority_sha256: hash(priorAuthority),
    prior_state_sha256: hash(priorState),
    completed_prefix_sha256: hash(priorState.operations.slice(0, 22)),
    deployment_sha256: hash(deployment),
    native_auth_sha256: hash(nativeAuthReceipt),
    caps,
    job_limits: jobs,
    browser_mode: "EXISTING_CHROME_NATIVE",
    production_origin: "https://example.test",
    success_horizon_seconds: 1660,
  };
  return {
    authority,
    priorAuthority,
    priorState,
    deployment,
    nativeAuthReceipt,
    sourceCommit: source,
    now,
  };
}
test("accepts exact22-operation handoff without cookie state", () => {
  const f = fixture();
  assert.equal(validate(f).tab_id, "tab-12");
});
test("rejects altered completed result, replayedprefix and widenedcaps", () => {
  for (const kind of ["result", "prefix", "caps"]) {
    const f = fixture();
    if (kind === "result") f.priorState.operations[0].result = { changed: true };
    if (kind === "prefix") f.priorState.operations[22].status = "COMPLETED";
    if (kind === "caps") f.authority.caps = { max_completion_usd: 18, max_incremental_usd: 2 };
    assert.throws(() => validate(f), /PREDECESSOR|PREFIX|CAPS/);
  }
});
test("rejects freshreceipt wrong deployedversion and foreignpairedaccount even when resealed", () => {
  const f = fixture();
  f.deployment.deployment_id_sha256 = H("d");
  f.authority.deployment_sha256 = hash(f.deployment);
  assert.throws(() => validate(f), /DEPLOYMENT_LINEAGE/);
  const g = fixture();
  g.nativeAuthReceipt.paired_worker_account_sha256 = H("e");
  g.authority.native_auth_sha256 = hash(g.nativeAuthReceipt);
  assert.throws(() => validate(g), /NATIVE_AUTH/);
});
test("durable oneGenerate intent prohibits retries after unknown outcome and duplicate claim", (t) => {
  const f = fixture(),
    root = mkdtempSync(join(tmpdir(), "native-v209-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const journal = createV209NativeBrowserJournal(root + "/journal.json"),
    transfer = {
      schema_version: "videoforge.v2-09-native-transfer/v1",
      prior_authority_sha256: f.authority.prior_authority_sha256,
      prior_state_sha256: f.authority.prior_state_sha256,
      native_authority_sha256: hash(f.authority),
      normal_resume_disabled: true,
    };
  journal.claim(f, transfer);
  assert.throws(() => journal.claim(f, transfer));
  const click = { tab_id: "tab-12", project_id_sha256: H("d"), revision_id_sha256: H("e") };
  journal.beginGenerate(f.authority, click, now);
  journal.markUnknown(f.authority, now);
  assert.throws(() => journal.beginGenerate(f.authority, click, now), /CLICK_REPLAY/);
  assert.equal(
    createV209NativeBrowserJournal(root + "/journal.json").read().status,
    "CLICK_OUTCOME_UNKNOWN",
  );
});
test("generationidentity must match reserved project and revision", (t) => {
  const f = fixture(),
    root = mkdtempSync(join(tmpdir(), "native-v209-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const j = createV209NativeBrowserJournal(root + "/j.json");
  j.claim(f, {
    schema_version: "videoforge.v2-09-native-transfer/v1",
    prior_authority_sha256: f.authority.prior_authority_sha256,
    prior_state_sha256: f.authority.prior_state_sha256,
    native_authority_sha256: hash(f.authority),
    normal_resume_disabled: true,
  });
  j.beginGenerate(
    f.authority,
    { tab_id: "tab-12", project_id_sha256: H("d"), revision_id_sha256: H("e") },
    now,
  );
  assert.throws(
    () =>
      j.recordGeneration(
        f.authority,
        {
          project_id_sha256: H("a"),
          revision_id_sha256: H("e"),
          generation_request_sha256: H("f"),
        },
        now,
      ),
    /GENERATION_IDENTITY/,
  );
});

test("approved account UUID hash and full remaining horizon required", () => {
  const f = fixture();
  f.nativeAuthReceipt.approved_account_sha256 = H("a");
  f.authority.native_auth_sha256 = hash(f.nativeAuthReceipt);
  assert.throws(() => validate(f), /NATIVE_AUTH/);
  const g = fixture();
  g.authority.expires_at = new Date(now.getTime() + 1000).toISOString();
  assert.throws(() => validate(g), /EXPIRY/);
});

function replacementFixture() {
  const f = fixture();
  f.priorAuthority.production_inputs = { sealed: "prior" };
  f.priorAuthority.frozen_lanes = { exact: "same-pair" };
  f.authority.prior_authority_sha256 = hash(f.priorAuthority);
  const previous = {
    source_commit: oldSource,
    config_sha256: H("3"),
    worker_bundle_sha256: H("4"),
    deployment_id_sha256: H("5"),
    deployment_row_id_sha256s: [H("6"), H("7")],
  };
  const migration = {
    version: "0087",
    sha256: H("d"),
    before: 86,
    after: 87,
    applied_versions: ["0087"],
  };
  const next = {
    source_commit: source,
    config_sha256: H("a"),
    worker_bundle_sha256: H("b"),
    deployment_id_sha256: H("c"),
    deployment_row_id_sha256s: [H("6"), H("7")],
    effective_gpu_transport: "QUALIFIED_EXACT",
    database_migration_version: "0087",
    activation_id_sha256: H("e"),
  };
  const ids = [
    "claim-qualified-replacement",
    "read-exact-predecessor",
    "apply-migration-0087",
    "render-replacement-qualified-config",
    "deploy-qualified-replacement-once",
    "readback-qualified-replacement",
    "import-replacement-qualified-activation",
    "readback-effective-qualified-replacement",
  ];
  const r = {
    schema_version: "videoforge.v2-09-native-qualified-replacement/v1",
    prior_authority_sha256: f.authority.prior_authority_sha256,
    prior_state_sha256: f.authority.prior_state_sha256,
    prior_deployment_sha256: hash(previous),
    prior_production_inputs_sha256: hash(f.priorAuthority.production_inputs),
    frozen_lanes_sha256: hash(f.priorAuthority.frozen_lanes),
    media_worker_inputs_sha256: hash(f.priorAuthority.media_worker_inputs),
    source_commit: source,
    migration,
    new_deployment: next,
    previous_activation_id_sha256: H("f"),
    activation_id_sha256: H("e"),
    operations: ids.map((id, i) => {
      const result = i === 2 ? migration : i === 7 ? next : {};
      return { id, status: "COMPLETED", result, result_sha256: hash(result) };
    }),
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
    caps: f.authority.caps,
  };
  f.replacementReceipt = r;
  f.authority.replacement_receipt_sha256 = hash(r);
  Object.assign(f.deployment, {
    source_commit: source,
    config_sha256: next.config_sha256,
    worker_bundle_sha256: next.worker_bundle_sha256,
    deployment_id_sha256: next.deployment_id_sha256,
  });
  f.authority.deployment_sha256 = hash(f.deployment);
  return f;
}
test("explicit replacement binds0087 and newdeployment while retainingold22proof", () => {
  assert.equal(validate(replacementFixture()).tab_id, "tab-12");
});
test("replacement cannot widen operations, changepair, skipmigration or silently alterolddeployment", () => {
  for (const mode of ["jobs", "pair", "migration", "old"]) {
    const f = replacementFixture(),
      r = f.replacementReceipt;
    if (mode === "jobs") r.mutation_counts.provider_posts = 1;
    if (mode === "pair") r.new_deployment.deployment_row_id_sha256s = [H("a"), H("b")];
    if (mode === "migration") r.migration.after = 88;
    if (mode === "old") r.prior_deployment_sha256 = H("a");
    f.authority.replacement_receipt_sha256 = hash(r);
    assert.throws(() => validate(f), /REPLACEMENT/);
  }
  const f = replacementFixture();
  delete f.replacementReceipt;
  delete f.authority.replacement_receipt_sha256;
  assert.throws(() => validate(f), /DEPLOYMENT/);
});

test("ordinary create reserves without invented IDs then binds actual server identity once", (t) => {
  const f = fixture(),
    root = mkdtempSync(join(tmpdir(), "native-create-v209-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const j = createV209NativeBrowserJournal(root + "/j.json");
  j.claim(f, {
    schema_version: "videoforge.v2-09-native-transfer/v1",
    prior_authority_sha256: f.authority.prior_authority_sha256,
    prior_state_sha256: f.authority.prior_state_sha256,
    native_authority_sha256: hash(f.authority),
    normal_resume_disabled: true,
  });
  const reservation = { tab_id: "tab-12", prepared_sha256: H("a"), claim_id_sha256: H("b") };
  const intent = j.beginCreateGenerate(f.authority, reservation, now);
  assert.equal(intent.status, "CREATE_CLICK_INTENT");
  assert.equal(Object.hasOwn(intent.click, "project_id_sha256"), false);
  const identity = {
    ...reservation,
    idempotency_key_sha256: H("c"),
    create_request_sha256: H("d"),
    project_id_sha256: H("e"),
    revision_id_sha256: H("f"),
    generation_request_sha256: H("1"),
  };
  for (const field of ["tab_id", "prepared_sha256", "claim_id_sha256"]) {
    assert.throws(
      () =>
        j.recordCreatedGeneration(
          f.authority,
          { ...identity, [field]: field === "tab_id" ? "other" : H("9") },
          now,
        ),
      /GENERATION_IDENTITY/,
    );
  }
  assert.throws(
    () =>
      j.recordCreatedGeneration(f.authority, identity, new Date(Date.parse(intent.click.stop_at))),
    /GENERATION_IDENTITY|JOURNAL_BINDING/,
  );
  assert.equal(j.recordCreatedGeneration(f.authority, identity, now).status, "GENERATION_CREATED");
  assert.throws(() => j.recordCreatedGeneration(f.authority, identity, now), /GENERATION_IDENTITY/);
  assert.throws(() => j.beginCreateGenerate(f.authority, reservation, now), /CLICK_REPLAY/);
});

test("unknown ordinary create prohibits both create and known-project click paths after restart", (t) => {
  const f = fixture(),
    root = mkdtempSync(join(tmpdir(), "native-create-unknown-v209-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = root + "/j.json",
    j = createV209NativeBrowserJournal(path);
  j.claim(f, {
    schema_version: "videoforge.v2-09-native-transfer/v1",
    prior_authority_sha256: f.authority.prior_authority_sha256,
    prior_state_sha256: f.authority.prior_state_sha256,
    native_authority_sha256: hash(f.authority),
    normal_resume_disabled: true,
  });
  const reservation = { tab_id: "tab-12", prepared_sha256: H("a"), claim_id_sha256: H("b") };
  j.beginCreateGenerate(f.authority, reservation, now);
  j.markUnknown(f.authority, now);
  const restarted = createV209NativeBrowserJournal(path);
  assert.throws(() => restarted.beginCreateGenerate(f.authority, reservation, now), /CLICK_REPLAY/);
  assert.throws(
    () =>
      restarted.beginGenerate(
        f.authority,
        { tab_id: "tab-12", project_id_sha256: H("a"), revision_id_sha256: H("b") },
        now,
      ),
    /CLICK_REPLAY/,
  );
  assert.equal(restarted.read().generate_intents, 1);
});
