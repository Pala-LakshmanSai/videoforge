import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt42-get-readback-authority-candidate",
);
const paths = {
  proposal: resolve(dir, "combined-live-proposal.json"),
  acceptance: resolve(dir, "acceptance.json"),
  preflight: resolve(dir, "read-only-preflight.json"),
  max1: resolve(dir, "staged-config-max1.json"),
  max2: resolve(dir, "staged-config-max2.json"),
  authority: resolve(dir, "approved-authority.json"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  activationTest: resolve(root, "apps/web/src/server/providers/v207-activation-authority.test.ts"),
  outputPorts: resolve(root, "apps/web/src/server/hosted/v207-output-ports.ts"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
};
const expected = {
  proposal: "sha256:1b3a75d67ff6ebff875e0ffb42e11d0bb0544c566670847f7748755c490681de",
  acceptance: "sha256:589dbe9cb24dde5dfa4277ea38e061a0a4de9e924112742cee791017d9319e41",
  preflight: "sha256:c4180d5862f574953fede7fa5905c0b06d6df3689916043f2ab3039a27d84298",
  max1: "sha256:14a70d3861a7810792e226478037d865ff47425d20f5440b6f54fe0a9c54f50e",
  max2: "sha256:44fad1bfde2e4ba6ee08040e5296bb3a95924728ed322c639cd146c8a66bb2f1",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  imageSource: "a7b7a937d08dc9032b8922cca71c602195f3094c",
  control: "78062a729fd2e321fbe3b71dc9e7e57b5c8b3fe6",
  controlSource:
    "sha256:5226ff6a2a4d78080fc1853245098771d9a7d8c12ba77b19f7eddb89ba194030",
  authorityClose: "f9a0baae7fc281d3508b33e92e307afb492c5d18",
  closureCommit: "4a64e086edd11e10f31a40e90890ea9c28b5abc2",
  priorProposal:
    "sha256:3ce00d81d161e43a2d6a1610b6f9a7c9b7ceaa1fcb3bbbe44339fa478605eb18",
  priorAuthority:
    "sha256:2aec5d4846bfe8d6d1e658af9db7cf354a25611838f725472477b443d6291f9d",
  priorClosure:
    "sha256:ecfc252b04cc8daa9c4ee85fb5991d7e8874d6cf2fcfd5321d99abf343731187",
  priorCleanup:
    "sha256:caaf90bc41ad65ecb8407c280f125e3317e86e386299220a317b5028f5bcab54",
  priorReconciliation:
    "sha256:2d86e63bdaa5029cc6f13495d68a38d7603c49e4830a614e466e971dd706d61e",
  mageVolume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume:
    "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
};
const fail = (code) => {
  throw new Error("V207_ATTEMPT42_CANDIDATE_" + code);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) =>
  "sha256:" + createHash("sha256").update(bytes(path)).digest("hex");

for (const name of ["proposal", "acceptance", "preflight", "max1", "max2"]) {
  assert(sha(paths[name]) === expected[name], name.toUpperCase() + "_HASH");
}
assert(!existsSync(paths.authority), "UNAPPROVED_AUTHORITY_FILE_PRESENT");
assert(sha(paths.outputPorts) === expected.controlSource, "OUTPUT_PORT_SOURCE_HASH");

const proposal = json(paths.proposal);
const acceptance = json(paths.acceptance);
const preflight = json(paths.preflight);
const max1 = json(paths.max1);
const max2 = json(paths.max2);

assert(
  proposal.attempt === 42 &&
    proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.provider_mutation === false &&
    proposal.gpu_use === false &&
    proposal.spend_usd === 0 &&
    proposal.publication_required === false &&
    proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null &&
    proposal.execution_boundary?.authority_file_present === false,
  "PROPOSAL_BOUNDARY",
);
assert(
  proposal.lineage?.final_image === expected.image &&
    proposal.lineage?.image_source_commit === expected.imageSource &&
    proposal.lineage?.control_source_commit === expected.control &&
    proposal.lineage?.control_repair?.commit === expected.control &&
    proposal.lineage?.volume_id_sha256 === expected.mageVolume &&
    proposal.lineage?.volume_size_gb === 50 &&
    proposal.lineage?.volume_region === "EU-RO-1" &&
    proposal.lineage?.volume_mount === "/runpod-volume" &&
    proposal.lineage?.control_repair?.get_readback_authority?.source_sha256 ===
      expected.controlSource &&
    proposal.lineage?.control_repair?.get_readback_authority?.authority_schema ===
      "artifact-transfer-port/v3" &&
    proposal.lineage?.control_repair?.get_readback_authority?.capability_handle ===
      "NONCE_HMAC_OVER_CANONICAL_AUTHORITY_FACTS" &&
    proposal.lineage?.control_repair?.get_readback_authority?.malformed_or_drifted_authority ===
      "FAIL_CLOSED" &&
    proposal.lineage?.consumed_attempt41_authority_close_commit === expected.authorityClose &&
    proposal.lineage?.attempt41_closure_context_commit === expected.closureCommit,
  "PROPOSAL_LINEAGE",
);
assert(
  proposal.lineage?.prior_attempt?.proposal_sha256 === expected.priorProposal &&
    proposal.lineage?.prior_attempt?.authority_sha256 === expected.priorAuthority &&
    proposal.lineage?.prior_attempt?.closure_sha256 === expected.priorClosure &&
    proposal.lineage?.prior_attempt?.cleanup_sha256 === expected.priorCleanup &&
    proposal.lineage?.prior_attempt?.reconciliation_sha256 === expected.priorReconciliation &&
    proposal.lineage?.prior_attempt?.authority_consumed === true &&
    proposal.lineage?.prior_attempt?.settled_incremental_spend_usd ===
      0.046342222136445343,
  "PRIOR_ATTEMPT",
);
assert(
  proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 &&
    proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2 &&
    proposal.read_only_preflight?.evidence_sha256 === expected.preflight &&
    proposal.read_only_preflight?.availability_observed === "HIGH" &&
    proposal.read_only_preflight?.stable_final_reconciliation?.billing_baseline_usd ===
      1.5709891965379938 &&
    proposal.read_only_preflight?.stable_final_reconciliation?.incremental_spend_usd === 0,
  "PROPOSAL_PREFLIGHT",
);
assert(
  proposal.cost_estimate?.finite_action_estimate_usd === 3.7 &&
    proposal.cost_estimate?.proposed_finite_cap_usd === null &&
    proposal.cost_estimate?.current_provider_rate_usd_per_gpu_hour === 1.1 &&
    proposal.cost_estimate?.secure_reference_rate_usd_per_hour === 0.74 &&
    proposal.cost_estimate?.ongoing_retained_volume_charge_usd_per_month === 7 &&
    proposal.cost_estimate?.ongoing_volume_charge_separate_from_finite_cap === true &&
    proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.user_approval?.prior_authority_or_cap_reuse_forbidden === true,
  "PROPOSAL_COST_AUTHORITY",
);
for (const fragment of [
  "reuse the already-published exact immutable image",
  "create or update one private EU-RO-1 endpoint",
  "submit one seed job",
  "status-read seed until terminal",
  "submit one replacement job",
  "apply separately hashed max2 definition",
  "status-read both readers",
  "observe owned cancel CANCELED and timeout TIMED_OUT",
  "reconcile endpoint/template/worker/pod/volume identities",
  "retain exact endpoint and both intended 50GB volumes",
  "delete only disposable endpoint/template",
  "delete the ephemeral signer",
  "stop before V2-08",
]) {
  assert(
    proposal.approved_operations_to_be_proposed_once?.some((operation) =>
      operation.includes(fragment),
    ),
    "PROPOSAL_OPERATION_" + fragment.replaceAll(/[^A-Z0-9]+/gi, "_").toUpperCase(),
  );
}
assert(
  proposal.qualification_runs?.complete_image_batch === true &&
    proposal.qualification_runs?.cold_and_warm === true &&
    proposal.qualification_runs?.duplicate_delivery_same_job_no_second_run === true &&
    proposal.qualification_runs?.two_simultaneous_read_only_workers?.uses_max2_only === true &&
    proposal.qualification_runs?.two_simultaneous_read_only_workers?.restore_max1 === true &&
    proposal.qualification_runs?.durable_outputs_before_provider_expiry === true &&
    proposal.qualification_runs?.v3_authority_provenance_receipts === true &&
    proposal.negative_tests_and_stop_conditions?.length === 8,
  "PROPOSAL_QUALIFICATION_STOP_CONTRACT",
);
for (const [config, workers, hash] of [
  [max1, 1, expected.max1],
  [max2, 2, expected.max2],
]) {
  assert(
    sha(workers === 1 ? paths.max1 : paths.max2) === hash &&
      config.image === expected.image &&
      config.image_source_commit === expected.imageSource &&
      config.control_source_commit === expected.control &&
      config.network_volume_id_sha256 === expected.mageVolume &&
      config.network_volume_size_gb === 50 &&
      config.network_volume_region === "EU-RO-1" &&
      config.network_volume_mount === "/runpod-volume" &&
      config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090" &&
      (config.gpu_count === 1 || config.gpu_count_per_worker === 1) &&
      config.compute_type === "GPU" &&
      config.flex_only === true &&
      config.flashboot === true &&
      config.workers_min === 0 &&
      config.workers_max === workers &&
      config.get_readback_authority_repair?.source_sha256 === expected.controlSource &&
      config.get_readback_authority_repair?.max_uses === 1,
    "CONFIG_" + workers,
  );
}
assert(
  preflight.attempt === 42 &&
    preflight.read_only === true &&
    preflight.provider_mutations === 0 &&
    preflight.gpu_jobs_submitted === 0 &&
    preflight.external_spend_usd === 0 &&
    preflight.inventory?.pods === 0 &&
    preflight.inventory?.endpoints === 0 &&
    preflight.inventory?.private_templates === 0 &&
    preflight.inventory?.active_serverless_workers === 0 &&
    preflight.inventory?.running_pods === 0 &&
    preflight.inventory?.retained_volumes?.length === 2 &&
    preflight.selected_gpu?.offering_id === "NVIDIA GeForce RTX 4090" &&
    preflight.selected_gpu?.region === "EU-RO-1" &&
    preflight.selected_gpu?.availability === "HIGH" &&
    preflight.serverless_flex_rate?.usd_per_gpu_hour === 1.1 &&
    preflight.selected_gpu?.secure_reference_rate_usd_per_hour === 0.74 &&
    preflight.billing?.baseline_endpoint_spend_usd === 1.5709891965379938 &&
    preflight.reconciliation?.billing_final_usd === 1.5709891965379938 &&
    preflight.reconciliation?.incremental_spend_usd === 0 &&
    preflight.quota_lookup?.no_quota_claim_inferred === true,
  "PREFLIGHT",
);
const volumes = new Map(preflight.inventory.retained_volumes.map((volume) => [volume.purpose, volume]));
assert(
  volumes.get("Mage")?.id_sha256 === expected.mageVolume &&
    volumes.get("Mage")?.identity_unchanged === true &&
    volumes.get("SoulX")?.id_sha256 === expected.soulxVolume &&
    volumes.get("SoulX")?.identity_unchanged === true,
  "VOLUMES",
);
assert(
  acceptance.result ===
    "PROVIDER_FREE_CANDIDATE_PENDING_FRESH_APPROVAL_AND_NUMERIC_CAP" &&
    acceptance.qualification_status === "NOT_QUALIFIED_PENDING_EXECUTION" &&
    acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.max1_sha256 === expected.max1 &&
    acceptance.candidate?.max2_sha256 === expected.max2 &&
    acceptance.candidate?.authority_path === null &&
    acceptance.candidate?.authority_recorded === false &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === null &&
    acceptance.provider_boundary?.provider_calls === false &&
    acceptance.provider_boundary?.provider_mutations === false &&
    acceptance.provider_boundary?.gpu_use === false &&
    acceptance.provider_boundary?.authority_active === false &&
    acceptance.provider_boundary?.cap_usd === null,
  "ACCEPTANCE",
);

const activation = text(paths.activation);
const activationTest = text(paths.activationTest);
assert(
  activation.includes(expected.proposal) &&
    activation.includes(expected.control) &&
    activation.includes("V207_APPROVED_AUTHORITY_SHA256: string | null = null") &&
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") &&
    activationTest.includes(expected.priorProposal),
  "ACTIVATION",
);
for (const [name, path] of Object.entries({
  state: paths.state,
  gates: paths.gates,
  start: paths.start,
  task: paths.task,
})) {
  const surface = text(path);
  assert(surface.includes(expected.proposal) && surface.includes("V2-08"), name.toUpperCase() + "_POINTER");
}
const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
for (const surface of [state, gates]) {
  for (const value of [expected.acceptance, expected.preflight, expected.max1, expected.max2, expected.image, expected.control]) {
    assert(surface.includes(value), "CONTROL_POINTER");
  }
}
assert(start.includes(expected.preflight) && start.includes(expected.control), "START_LINEAGE");
assert(
  task.includes(expected.preflight) &&
    task.includes(expected.max1) &&
    task.includes(expected.max2) &&
    task.includes(expected.control),
  "TASK_LINEAGE",
);
assert(
  state.includes("phase: serverless_v2_v2_07_attempt42_candidate_pending_exact_approval") &&
    state.includes("provider_calls_authorized: false") &&
    state.includes("remote_or_cloud_mutations_authorized: false") &&
    state.includes("gpu_use_authorized: false") &&
    state.includes("maximum_external_spend_usd: 0"),
  "STATE_BOUNDARY",
);
assert(
  gates.includes("authority_mode: pending_attempt42_exact_approval_and_fresh_numeric_cap") &&
    gates.includes("pending_authority: null") &&
    gates.includes("pending_numeric_cap_usd: null") &&
    gates.includes("provider_calls_authorized: false") &&
    gates.includes("gpu_use_authorized: false"),
  "GATES_BOUNDARY",
);

console.log(
  "V2-07 Attempt42 candidate validation PASS (exact GET authority repair; clean fresh baseline; no authority/cap/provider mutation)",
);
