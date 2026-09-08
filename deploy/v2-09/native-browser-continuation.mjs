import { createHash } from "node:crypto";
import {
  constants,
  openSync,
  closeSync,
  fstatSync,
  lstatSync,
  readFileSync,
  writeFileSync,
  fsyncSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { STAGED_OPERATION_IDS } from "./execute-combined-qualified-production.mjs";
const HASH = /^sha256:[a-f0-9]{64}$/u,
  COMMIT = /^[a-f0-9]{40}$/u;
const fail = (c) => {
  throw Error("V2_09_NATIVE_BROWSER_" + c);
};
export const canonicalNativeBrowser = (v) =>
  Array.isArray(v)
    ? "[" + v.map(canonicalNativeBrowser).join(",") + "]"
    : v && typeof v === "object"
      ? "{" +
        Object.keys(v)
          .sort()
          .map((k) => JSON.stringify(k) + ":" + canonicalNativeBrowser(v[k]))
          .join(",") +
        "}"
      : JSON.stringify(v);
export const hashNativeBrowser = (v) =>
  "sha256:" + createHash("sha256").update(canonicalNativeBrowser(v)).digest("hex");
const exact = (v, keys) =>
  v &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).sort().join(",") === [...keys].sort().join(",");
const equal = (a, b) => canonicalNativeBrowser(a) === canonicalNativeBrowser(b);
const instant = (v) =>
  typeof v === "string" && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const origin = (v) => {
  try {
    return new URL(v).origin === v && v.startsWith("https://");
  } catch {
    return false;
  }
};

export const NATIVE_REPLACEMENT_OPERATIONS = Object.freeze([
  "claim-qualified-replacement",
  "read-exact-predecessor",
  "apply-migration-0087",
  "render-replacement-qualified-config",
  "deploy-qualified-replacement-once",
  "readback-qualified-replacement",
  "import-replacement-qualified-activation",
  "readback-effective-qualified-replacement",
]);

function validateReplacement(r, a, p, s, old, activation) {
  if (
    !exact(r, [
      "schema_version",
      "prior_authority_sha256",
      "prior_state_sha256",
      "prior_deployment_sha256",
      "prior_production_inputs_sha256",
      "frozen_lanes_sha256",
      "media_worker_inputs_sha256",
      "source_commit",
      "migration",
      "new_deployment",
      "previous_activation_id_sha256",
      "activation_id_sha256",
      "operations",
      "mutation_counts",
      "caps",
    ]) ||
    r.schema_version !== "videoforge.v2-09-native-qualified-replacement/v1" ||
    a.replacement_receipt_sha256 !== hashNativeBrowser(r) ||
    r.prior_authority_sha256 !== a.prior_authority_sha256 ||
    r.prior_state_sha256 !== a.prior_state_sha256 ||
    r.source_commit !== a.source_commit ||
    r.prior_production_inputs_sha256 !== hashNativeBrowser(p.production_inputs) ||
    r.frozen_lanes_sha256 !== hashNativeBrowser(p.frozen_lanes) ||
    r.media_worker_inputs_sha256 !== hashNativeBrowser(p.media_worker_inputs) ||
    !equal(r.caps, a.caps)
  )
    fail("REPLACEMENT_BINDING");
  const prior = {
    source_commit: p.source_commit,
    config_sha256: old.config_sha256,
    worker_bundle_sha256: old.worker_bundle_sha256,
    deployment_id_sha256: old.deployment_id_sha256,
    deployment_row_id_sha256s: activation.deployment_row_id_sha256s,
  };
  if (
    r.prior_deployment_sha256 !== hashNativeBrowser(prior) ||
    !exact(r.migration, ["version", "sha256", "before", "after", "applied_versions"]) ||
    r.migration.version !== "0087" ||
    !HASH.test(r.migration.sha256) ||
    r.migration.before !== 86 ||
    r.migration.after !== 87 ||
    !equal(r.migration.applied_versions, ["0087"])
  )
    fail("REPLACEMENT_MIGRATION");
  if (
    !Array.isArray(r.operations) ||
    r.operations.length !== NATIVE_REPLACEMENT_OPERATIONS.length ||
    r.operations.some(
      (op, i) =>
        !exact(op, ["id", "status", "result", "result_sha256"]) ||
        op.id !== NATIVE_REPLACEMENT_OPERATIONS[i] ||
        op.status !== "COMPLETED" ||
        op.result_sha256 !== hashNativeBrowser(op.result),
    ) ||
    !equal(r.mutation_counts, {
      cloudflare_deployments: 1,
      migrations: 1,
      activation_imports: 1,
      secret_writes: 0,
      lane_creations: 0,
      media_installs: 0,
      provider_posts: 0,
      generate_clicks: 0,
      redispatches: 0,
    })
  )
    fail("REPLACEMENT_OPERATIONS");
  const n = r.new_deployment;
  if (
    !exact(n, [
      "source_commit",
      "config_sha256",
      "worker_bundle_sha256",
      "deployment_id_sha256",
      "deployment_row_id_sha256s",
      "effective_gpu_transport",
      "database_migration_version",
      "activation_id_sha256",
    ]) ||
    n.source_commit !== r.source_commit ||
    ["config_sha256", "worker_bundle_sha256", "deployment_id_sha256", "activation_id_sha256"].some(
      (k) => !HASH.test(n[k]),
    ) ||
    n.deployment_id_sha256 === old.deployment_id_sha256 ||
    !equal(n.deployment_row_id_sha256s, activation.deployment_row_id_sha256s) ||
    n.effective_gpu_transport !== "QUALIFIED_EXACT" ||
    n.database_migration_version !== "0087" ||
    !HASH.test(r.previous_activation_id_sha256) ||
    !HASH.test(r.activation_id_sha256) ||
    r.previous_activation_id_sha256 === r.activation_id_sha256 ||
    n.activation_id_sha256 !== r.activation_id_sha256
  )
    fail("REPLACEMENT_LINEAGE");
  if (!equal(r.operations[2].result, r.migration) || !equal(r.operations[7].result, n))
    fail("REPLACEMENT_RESULT");
  return n;
}

/** Pure validation; no browser, credential, provider or mutation calls. */
export function validateV209NativeBrowserContinuation({
  authority,
  priorAuthority,
  priorState,
  deployment,
  nativeAuthReceipt,
  replacementReceipt,
  sourceCommit,
  now = new Date(),
}) {
  const a = authority,
    p = priorAuthority,
    s = priorState,
    d = deployment,
    n = nativeAuthReceipt;
  if (
    !exact(a, [
      "schema_version",
      "authority_id",
      "source_commit",
      "issued_at",
      "expires_at",
      "single_use",
      "prior_authority_sha256",
      "prior_state_sha256",
      "completed_prefix_sha256",
      "deployment_sha256",
      "native_auth_sha256",
      "caps",
      "job_limits",
      "browser_mode",
      "production_origin",
      "success_horizon_seconds",
      ...(replacementReceipt === undefined ? [] : ["replacement_receipt_sha256"]),
    ]) ||
    a.schema_version !== "videoforge.v2-09-native-browser-authority/v1" ||
    !/^v2-09-native-[a-z0-9-]{8,80}$/u.test(a.authority_id ?? "") ||
    !COMMIT.test(sourceCommit ?? "") ||
    a.source_commit !== sourceCommit ||
    a.single_use !== true ||
    a.browser_mode !== "EXISTING_CHROME_NATIVE" ||
    a.success_horizon_seconds !== 1660 ||
    !origin(a.production_origin)
  )
    fail("AUTHORITY");
  const time = now instanceof Date ? now.getTime() : NaN;
  if (
    !Number.isFinite(time) ||
    !instant(a.issued_at) ||
    !instant(a.expires_at) ||
    Date.parse(a.issued_at) > time ||
    Date.parse(a.expires_at) - time < 1660000 ||
    Date.parse(a.expires_at) - Date.parse(a.issued_at) > 86400000 ||
    !instant(p?.expires_at) ||
    Date.parse(a.expires_at) > Date.parse(p?.expires_at ?? "")
  )
    fail("EXPIRY");
  if (
    !equal(a.caps, p?.caps) ||
    !equal(a.caps, { max_completion_usd: 17.5, max_incremental_usd: 2 }) ||
    !equal(a.job_limits, p?.job_limits) ||
    !equal(a.job_limits, {
      chrome_e2e_runs: 1,
      generation_requests: 1,
      redispatches: 0,
      stage_6_jobs: 0,
      stage_7_jobs: 0,
    })
  )
    fail("CAPS");
  if (
    p?.single_use !== true ||
    !COMMIT.test(p.source_commit ?? "") ||
    !HASH.test(p.proposal_sha256 ?? "") ||
    p.authority_id === a.authority_id ||
    a.prior_authority_sha256 !== hashNativeBrowser(p) ||
    a.prior_state_sha256 !== hashNativeBrowser(s)
  )
    fail("PREDECESSOR");
  if (
    s?.status !== "AWAITING_INTERACTIVE_CHROME_LOGIN" ||
    s.consumed_once !== true ||
    s.inner_authority_id !== null ||
    s.inner_authority_sha256 !== null ||
    s.outer_authority_id !== p.authority_id ||
    s.source_commit !== p.source_commit ||
    s.proposal_sha256 !== p.proposal_sha256 ||
    s.operations?.length !== 26 ||
    s.operations.some(
      (op, i) =>
        op.id !== STAGED_OPERATION_IDS[i] ||
        op.status !== (i < 22 ? "COMPLETED" : i === 22 ? "STARTED" : "PENDING"),
    ) ||
    s.operations.slice(0, 22).some((op) => op.result_sha256 !== hashNativeBrowser(op.result))
  )
    fail("PREFIX");
  if (a.completed_prefix_sha256 !== hashNativeBrowser(s.operations.slice(0, 22)))
    fail("PREFIX_HASH");
  const result = (id) => s.operations.find((op) => op.id === id).result;
  const deployed = result("deploy-cloudflare-qualified-production"),
    readback = result("readback-qualified-production"),
    activation = result("import-v209-qualified-activation"),
    installed = result("install-media-worker-0.1.15");
  const replacement =
    replacementReceipt === undefined
      ? null
      : validateReplacement(replacementReceipt, a, p, s, deployed, activation);
  const expectedDeployment = replacement ?? deployed;
  if (
    !exact(d, [
      "schema_version",
      "observed_at",
      "source_commit",
      "config_sha256",
      "worker_bundle_sha256",
      "deployment_id_sha256",
      "deployment_row_id_sha256s",
      "gpu_transport",
      "installed_release",
      "media_worker_bundle_sha256",
      "paid_compute_zero",
      "completion_total_usd",
      "incremental_spend_usd",
    ]) ||
    d.schema_version !== "videoforge.v2-09-native-deployment-readback/v1" ||
    a.deployment_sha256 !== hashNativeBrowser(d) ||
    !instant(d.observed_at) ||
    time - Date.parse(d.observed_at) < 0 ||
    time - Date.parse(d.observed_at) > 90000 ||
    d.source_commit !== (replacement?.source_commit ?? p.source_commit) ||
    d.gpu_transport !== "QUALIFIED_EXACT" ||
    d.paid_compute_zero !== true ||
    !Number.isFinite(d.completion_total_usd) ||
    d.completion_total_usd < 0 ||
    d.completion_total_usd > 15.5 ||
    !Number.isFinite(d.incremental_spend_usd) ||
    d.incremental_spend_usd < 0 ||
    d.incremental_spend_usd > 2
  )
    fail("DEPLOYMENT");
  for (const key of ["config_sha256", "worker_bundle_sha256"])
    if (
      !HASH.test(d[key]) ||
      d[key] !== expectedDeployment[key] ||
      (!replacement && (d[key] !== readback[key] || d[key] !== activation[key]))
    )
      fail("DEPLOYMENT_LINEAGE");
  if (
    !HASH.test(d.deployment_id_sha256) ||
    d.deployment_id_sha256 !== expectedDeployment.deployment_id_sha256 ||
    (!replacement &&
      (d.deployment_id_sha256 !== readback.deployment_id_sha256 ||
        d.deployment_id_sha256 !== activation.cloudflare_deployment_id_sha256)) ||
    activation.qualified_activation_active !== true ||
    activation.effective_gpu_transport !== "QUALIFIED_EXACT" ||
    !equal(d.deployment_row_id_sha256s, activation.deployment_row_id_sha256s) ||
    !Array.isArray(d.deployment_row_id_sha256s) ||
    d.deployment_row_id_sha256s.length !== 2 ||
    new Set(d.deployment_row_id_sha256s).size !== 2 ||
    d.deployment_row_id_sha256s.some((v) => !HASH.test(v)) ||
    d.installed_release !== "0.1.15" ||
    installed.release !== "0.1.15" ||
    installed.online !== true ||
    d.media_worker_bundle_sha256 !== p.media_worker_inputs.execution_bundle_sha256 ||
    d.media_worker_bundle_sha256 !== installed.execution_bundle_sha256
  )
    fail("DEPLOYMENT_LINEAGE");
  if (
    !exact(n, [
      "schema_version",
      "observed_at",
      "browser",
      "tab_id",
      "origin",
      "account_id_sha256",
      "workspace_id_sha256",
      "approved_account_sha256",
      "paired_worker_account_sha256",
      "avatar_profile_version_sha256",
      "image_style_version_sha256",
      "tenant_authenticated",
      "catalog_ready",
      "worker_online",
      "generate_clicks",
      "cookies_exported",
      "profile_read",
    ]) ||
    n.schema_version !== "videoforge.v2-09-native-auth/v1" ||
    a.native_auth_sha256 !== hashNativeBrowser(n) ||
    !instant(n.observed_at) ||
    time - Date.parse(n.observed_at) < 0 ||
    time - Date.parse(n.observed_at) > 90000 ||
    n.browser !== "chrome" ||
    typeof n.tab_id !== "string" ||
    !n.tab_id ||
    n.tab_id.length > 256 ||
    n.origin !== a.production_origin ||
    n.tenant_authenticated !== true ||
    n.catalog_ready !== true ||
    n.worker_online !== true ||
    n.generate_clicks !== 0 ||
    n.cookies_exported !== false ||
    n.profile_read !== false ||
    n.account_id_sha256 !== n.paired_worker_account_sha256 ||
    n.account_id_sha256 !== n.approved_account_sha256 ||
    [
      "account_id_sha256",
      "workspace_id_sha256",
      "approved_account_sha256",
      "paired_worker_account_sha256",
      "avatar_profile_version_sha256",
      "image_style_version_sha256",
    ].some((k) => !HASH.test(n[k]))
  )
    fail("NATIVE_AUTH");
  return Object.freeze({
    authority_sha256: hashNativeBrowser(a),
    prior_state_sha256: a.prior_state_sha256,
    tab_id: n.tab_id,
    account_id_sha256: n.account_id_sha256,
    workspace_id_sha256: n.workspace_id_sha256,
    expires_at: a.expires_at,
  });
}

function privateRead(path) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const st = fstatSync(fd);
    if (
      !st.isFile() ||
      st.uid !== process.getuid() ||
      st.nlink !== 1 ||
      (st.mode & 511) !== 384 ||
      st.size > 8 * 1024 * 1024
    )
      fail("JOURNAL_PRIVATE");
    return JSON.parse(readFileSync(fd, "utf8"));
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
/** Caller first disables predecessor normal resume and supplies its exact durable transfer receipt. */
export function createV209NativeBrowserJournal(path) {
  if (typeof path !== "string" || resolve(path) !== path) fail("JOURNAL_PATH");
  const parent = lstatSync(dirname(path));
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    parent.uid !== process.getuid() ||
    (parent.mode & 63) !== 0
  )
    fail("JOURNAL_PARENT");
  const withLock = (fn) => {
    let lock;
    try {
      lock = openSync(path + ".lock", "wx", 384);
    } catch {
      fail("JOURNAL_LOCKED");
    }
    try {
      return fn();
    } finally {
      closeSync(lock);
      unlinkSync(path + ".lock");
    }
  };
  const write = (v, first = false) => {
    const destination = first ? path : path + ".next";
    let fd;
    try {
      fd = openSync(destination, "wx", 384);
      writeFileSync(fd, canonicalNativeBrowser(v) + "\n");
      fsyncSync(fd);
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
    if (!first) renameSync(destination, path);
    const dir = openSync(dirname(path), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
    return Object.freeze(v);
  };
  const current = (authority, now) => {
    const j = privateRead(path);
    if (
      j.schema_version !== "videoforge.v2-09-native-browser-journal/v1" ||
      j.authority_sha256 !== hashNativeBrowser(authority) ||
      !(now instanceof Date) ||
      !Number.isFinite(now.getTime()) ||
      !instant(authority.expires_at) ||
      Date.parse(authority.expires_at) <= now.getTime()
    )
      fail("JOURNAL_BINDING");
    return j;
  };
  return Object.freeze({
    claim(inputs, transferReceipt) {
      return withLock(() => {
        const valid = validateV209NativeBrowserContinuation(inputs);
        if (
          !exact(transferReceipt, [
            "schema_version",
            "prior_authority_sha256",
            "prior_state_sha256",
            "native_authority_sha256",
            "normal_resume_disabled",
          ]) ||
          transferReceipt.schema_version !== "videoforge.v2-09-native-transfer/v1" ||
          transferReceipt.prior_authority_sha256 !== inputs.authority.prior_authority_sha256 ||
          transferReceipt.prior_state_sha256 !== valid.prior_state_sha256 ||
          transferReceipt.native_authority_sha256 !== valid.authority_sha256 ||
          transferReceipt.normal_resume_disabled !== true
        )
          fail("TRANSFER");
        return write(
          {
            schema_version: "videoforge.v2-09-native-browser-journal/v1",
            authority_sha256: valid.authority_sha256,
            transfer_sha256: hashNativeBrowser(transferReceipt),
            status: "CLAIMED",
            generate_intents: 0,
            tab_id: valid.tab_id,
            click: null,
            generation: null,
          },
          true,
        );
      });
    },
    // Ordinary New Project creates its IDs only after the single UI click. Reserve the
    // prepared submission first; bind returned server identities without inventing IDs.
    beginCreateGenerate(authority, reservation, now = new Date()) {
      return withLock(() => {
        const j = current(authority, now);
        if (
          !exact(reservation, ["tab_id", "prepared_sha256", "claim_id_sha256"]) ||
          j.status !== "CLAIMED" ||
          j.generate_intents !== 0 ||
          reservation.tab_id !== j.tab_id ||
          !HASH.test(reservation.prepared_sha256) ||
          !HASH.test(reservation.claim_id_sha256)
        )
          fail("CLICK_REPLAY_OR_IDENTITY");
        return write({
          ...j,
          status: "CREATE_CLICK_INTENT",
          generate_intents: 1,
          click: {
            ...reservation,
            at: now.toISOString(),
            stop_at: new Date(
              Math.min(now.getTime() + 1660000, Date.parse(authority.expires_at)),
            ).toISOString(),
          },
        });
      });
    },
    recordCreatedGeneration(authority, identity, now = new Date()) {
      return withLock(() => {
        const j = current(authority, now);
        const keys = [
          "tab_id",
          "prepared_sha256",
          "claim_id_sha256",
          "idempotency_key_sha256",
          "create_request_sha256",
          "project_id_sha256",
          "revision_id_sha256",
          "generation_request_sha256",
        ];
        if (
          !exact(identity, keys) ||
          j.status !== "CREATE_CLICK_INTENT" ||
          now.getTime() >= Date.parse(j.click.stop_at) ||
          keys.filter((k) => k !== "tab_id").some((k) => !HASH.test(identity[k])) ||
          identity.tab_id !== j.click.tab_id ||
          identity.prepared_sha256 !== j.click.prepared_sha256 ||
          identity.claim_id_sha256 !== j.click.claim_id_sha256
        )
          fail("GENERATION_IDENTITY");
        return write({ ...j, status: "GENERATION_CREATED", generation: { ...identity } });
      });
    },
    beginGenerate(authority, { tab_id, project_id_sha256, revision_id_sha256 }, now = new Date()) {
      return withLock(() => {
        const j = current(authority, now);
        if (
          j.status !== "CLAIMED" ||
          j.generate_intents !== 0 ||
          tab_id !== j.tab_id ||
          !HASH.test(project_id_sha256) ||
          !HASH.test(revision_id_sha256)
        )
          fail("CLICK_REPLAY_OR_IDENTITY");
        return write({
          ...j,
          status: "CLICK_INTENT",
          generate_intents: 1,
          click: {
            tab_id,
            project_id_sha256,
            revision_id_sha256,
            at: now.toISOString(),
            stop_at: new Date(
              Math.min(now.getTime() + 1660000, Date.parse(authority.expires_at)),
            ).toISOString(),
          },
        });
      });
    },
    recordGeneration(
      authority,
      { project_id_sha256, revision_id_sha256, generation_request_sha256 },
      now = new Date(),
    ) {
      return withLock(() => {
        const j = current(authority, now);
        if (
          j.status !== "CLICK_INTENT" ||
          !HASH.test(generation_request_sha256) ||
          j.click.project_id_sha256 !== project_id_sha256 ||
          j.click.revision_id_sha256 !== revision_id_sha256
        )
          fail("GENERATION_IDENTITY");
        return write({
          ...j,
          status: "GENERATION_CREATED",
          generation: { project_id_sha256, revision_id_sha256, generation_request_sha256 },
        });
      });
    },
    markUnknown(authority, now = new Date()) {
      return withLock(() => {
        const j = current(authority, now);
        if (!["CLICK_INTENT", "CREATE_CLICK_INTENT"].includes(j.status)) fail("UNKNOWN_STATE");
        return write({ ...j, status: "CLICK_OUTCOME_UNKNOWN" });
      });
    },
    read() {
      return privateRead(path);
    },
  });
}
