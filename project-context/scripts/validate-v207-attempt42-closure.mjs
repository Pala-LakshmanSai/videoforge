import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const liveDir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification",
);
const candidateDir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt42-get-readback-authority-candidate",
);
const paths = {
  closure: resolve(liveDir, "failed-attempt-42.json"),
  cleanup: resolve(liveDir, "attempt42-cleanup-observation.json"),
  reconciliation: resolve(liveDir, "attempt42-reconciliation-observation.json"),
  proposal: resolve(candidateDir, "combined-live-proposal.json"),
  authority: resolve(candidateDir, "approved-authority.json"),
  acceptance: resolve(candidateDir, "acceptance.json"),
  max1: resolve(candidateDir, "staged-config-max1.json"),
  max2: resolve(candidateDir, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  activationTest: resolve(
    root,
    "apps/web/src/server/providers/v207-activation-authority.test.ts",
  ),
};

const expected = {
  proposal:
    "sha256:1b3a75d67ff6ebff875e0ffb42e11d0bb0544c566670847f7748755c490681de",
  authority:
    "sha256:ea0c638e8e68c48538954717aaa2eb49695ee702e2c98d000e9190e36aa54b53",
  acceptance:
    "sha256:64d5e3aa1e81a26afe564a43a60e3ef2b9cbc28efd735401d707f1099d8ca2bd",
  max1:
    "sha256:14a70d3861a7810792e226478037d865ff47425d20f5440b6f54fe0a9c54f50e",
  max2:
    "sha256:44fad1bfde2e4ba6ee08040e5296bb3a95924728ed322c639cd146c8a66bb2f1",
  closure:
    "sha256:ca9d1ba45cdaf028acc92f07bfe278b7ae6c4bf2cf182dae0e4ed51696435dbc",
  cleanup:
    "sha256:4d30c80b9ba2d42916c358a0768ddca71b876d8b1225d5223114152065550f81",
  reconciliation:
    "sha256:a73ffbf9fe0960d94027970f4036599f080d02e0b32359eeeabedd6bb266beac",
  orchestrator:
    "sha256:25afc6caf005c54b98de89e1db026e869d0159d11b055a12d498c624c0cc63150e",
  mageVolume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume:
    "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  activeVersion:
    "sha256:534524220d7e478d7178a6a51a7cf1b3d77ff0bca3de3a57736c8fad1d90bf48",
};

const fail = (code) => {
  throw new Error(`V207_ATTEMPT42_CLOSURE_${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) =>
  `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;

for (const name of [
  "proposal",
  "authority",
  "acceptance",
  "max1",
  "max2",
  "closure",
  "cleanup",
  "reconciliation",
]) {
  assert(sha(paths[name]) === expected[name], `${name.toUpperCase()}_HASH`);
}

const proposal = json(paths.proposal);
const authority = json(paths.authority);
const acceptance = json(paths.acceptance);
const closure = json(paths.closure);
const cleanup = json(paths.cleanup);
const reconciliation = json(paths.reconciliation);

assert(proposal.attempt === 42 && proposal.checkpoint === "V2-07", "PROPOSAL_SCOPE");
assert(
  closure.proposal?.sha256 === expected.proposal &&
    closure.authority?.sha256 === expected.authority &&
    closure.acceptance?.sha256 === expected.acceptance,
  "CLOSURE_LINEAGE_HASHES",
);
assert(
  authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.execution_boundary?.provider_calls_completed === false &&
    authority.execution_boundary?.external_spend_usd === 0,
  "IMMUTABLE_AUTHORITY_BOUNDARY",
);
assert(
  acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.authority_sha256 === expected.authority &&
    acceptance.provider_boundary?.authority_active === true,
  "ACCEPTANCE_BINDING",
);
assert(
  closure.result === "NOT_QUALIFIED_ROLLBACK_ANCHOR_NOT_RETAINED_CLEAN" &&
    closure.qualification_status === "NOT_QUALIFIED" &&
    closure.execution?.failure_stage === "pre_mutation_rollback_anchor_retention" &&
    closure.execution?.failure_code === "V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED" &&
    closure.execution?.provider_job_count === 0 &&
    closure.execution?.gpu_jobs_submitted === 0 &&
    closure.execution?.provider_mutation_count === 0 &&
    closure.execution?.cloudflare_mutation_count === 0 &&
    closure.execution?.qualification_claim_allowed === false,
  "FAILURE_BOUNDARY",
);
assert(
  closure.execution?.rollback_anchor_diagnostic?.versions_entry_count === 10 &&
    JSON.stringify(closure.execution.rollback_anchor_diagnostic.version_number_range) ===
      JSON.stringify([163, 172]) &&
    closure.execution.rollback_anchor_diagnostic.order === "oldest_to_newest" &&
    closure.execution.rollback_anchor_diagnostic.active_version_index === 0 &&
    closure.execution.rollback_anchor_diagnostic.active_version_id_sha256 === expected.activeVersion &&
    closure.execution.rollback_anchor_diagnostic.newest_retention_window_count === 7 &&
    closure.execution.rollback_anchor_diagnostic.anchor_retained_for_bounded_mutation === false,
  "ROLLBACK_RETENTION_DIAGNOSTIC",
);
assert(
  closure.lineage?.image_identity_check === "NOT_RUN_PREMUTATION_GUARD" &&
    closure.lineage?.model_manifest_check === "NOT_RUN_PREMUTATION_GUARD" &&
    closure.lineage?.sealed_volume_hash_check === "NOT_RUN_PREMUTATION_GUARD",
  "NO_UNPROVEN_MODEL_HASH_CLAIM",
);
assert(
  closure.billing?.baseline_cumulative_endpoint_spend_usd === 1.5709891965379938 &&
    closure.billing?.final_cumulative_endpoint_spend_usd === 1.5709891965379938 &&
    closure.billing?.incremental_spend_usd === 0 &&
    closure.billing?.approved_cap_usd === 4 &&
    closure.billing?.within_approved_cap === true &&
    closure.billing?.settlement === "THREE_STABLE_READS",
  "BILLING_BOUNDARY",
);
assert(
  cleanup.result === "NO_MUTATION_CLEAN" &&
    cleanup.cleanup_required === false &&
    cleanup.runpod_cleanup?.endpoint_created === false &&
    cleanup.runpod_cleanup?.private_template_created === false &&
    cleanup.runpod_cleanup?.gpu_jobs_submitted === 0 &&
    cleanup.runpod_cleanup?.final_disposable_resources_absent === true &&
    cleanup.cloudflare_cleanup?.worker_deployed === false &&
    cleanup.cloudflare_cleanup?.route_probe_performed === false &&
    cleanup.cloudflare_cleanup?.cleanup_uncertain === false,
  "NO_MUTATION_CLEANUP",
);
assert(
  reconciliation.stable_read_count === 3 &&
    reconciliation.read_only === true &&
    reconciliation.inventory?.pods === 0 &&
    reconciliation.inventory?.endpoints === 0 &&
    reconciliation.inventory?.private_templates === 0 &&
    reconciliation.inventory?.active_serverless_workers === 0 &&
    reconciliation.inventory?.running_pods === 0 &&
    reconciliation.inventory?.intended_volume_count === 2 &&
    reconciliation.inventory?.final_disposable_resources_absent === true &&
    reconciliation.billing?.baseline_endpoint_spend_usd === 1.5709891965379938 &&
    reconciliation.billing?.final_endpoint_spend_usd === 1.5709891965379938 &&
    reconciliation.billing?.settled_incremental_spend_usd === 0 &&
    reconciliation.mutation_boundary?.new_gpu_jobs === 0 &&
    reconciliation.mutation_boundary?.model_volume_writes === 0 &&
    reconciliation.mutation_boundary?.volume_mutation_called === false &&
    reconciliation.mutation_boundary?.cloudflare_mutation_called === false,
  "RECONCILIATION_BOUNDARY",
);
const volumes = new Map(
  (reconciliation.inventory?.retained_volumes ?? []).map((volume) => [volume.purpose, volume]),
);
assert(
  volumes.get("Mage")?.id_sha256 === expected.mageVolume &&
    volumes.get("Mage")?.size_gb === 50 &&
    volumes.get("Mage")?.region === "EU-RO-1" &&
    volumes.get("Mage")?.mount === "/runpod-volume" &&
    volumes.get("Mage")?.identity_unchanged === true &&
    volumes.get("SoulX")?.id_sha256 === expected.soulxVolume &&
    volumes.get("SoulX")?.size_gb === 50 &&
    volumes.get("SoulX")?.region === "EU-RO-1" &&
    volumes.get("SoulX")?.identity_unchanged === true,
  "RETAINED_VOLUMES",
);

const activation = text(paths.activation);
const activationTest = text(paths.activationTest);
assert(
  activation.includes("V207_APPROVED_AUTHORITY_SHA256: string | null = null") &&
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") &&
    activationTest.includes("expect(V207_APPROVED_AUTHORITY_SHA256).toBeNull()") &&
    activationTest.includes("expect(V207_APPROVED_FINITE_CAP_USD).toBeNull()"),
  "ACTIVATION_CONSUMED",
);

const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
for (const [value, code] of [
  [state, "STATE"],
  [gates, "GATES"],
  [start, "START"],
  [task, "TASK"],
]) {
  assert(value.includes("NOT_QUALIFIED"), `${code}_NOT_QUALIFIED`);
  assert(value.includes("V2-08"), `${code}_V2_08_FENCE`);
  assert(value.includes("failed-attempt-42.json"), `${code}_CLOSURE_POINTER`);
}
assert(
  state.includes("phase: serverless_v2_v2_07_attempt42_closed_not_qualified") &&
    state.includes("current_authority: null") &&
    state.includes("execution_status: attempt42_closed_before_mutation") &&
    state.includes("provider_calls_authorized: false"),
  "STATE_CLOSED",
);
assert(
  gates.includes('last_run: "evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-42.json"') &&
    gates.includes("authority_mode: closed_consumed_attempt42_rollback_anchor_not_retained") &&
    gates.includes("pending_authority: null") &&
    gates.includes("provider_calls_authorized: false"),
  "GATES_CLOSED",
);
for (const [value, code] of [
  [state, "STATE"],
  [gates, "GATES"],
  [start, "START"],
  [task, "TASK"],
]) {
  assert(!value.includes("attempt42_approved_single_use_pending_execution"), `${code}_NO_STALE_AUTHORITY`);
  assert(!value.includes("NOT_QUALIFIED_PENDING_EXECUTION_attempt42"), `${code}_NO_STALE_RESULT`);
}

console.log(
  "V2-07 Attempt42 closure validation PASS (rollback anchor not retained before mutation; no provider/GPU/spend; three stable reconciliation reads)",
);
