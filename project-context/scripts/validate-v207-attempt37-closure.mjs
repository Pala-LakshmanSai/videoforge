import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidateDir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt37-terminal-reader-result-recovery-candidate",
);
const evidenceDir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification",
);
const closurePath = resolve(evidenceDir, "failed-attempt-37.json");
const cleanupPath = resolve(evidenceDir, "attempt37-cleanup-observation.json");
const expected = {
  proposal:
    "sha256:6ff97af22dd025e9298a830a9bcd946f18fe376745f39ed6e5c15b791e3f390e",
  authority:
    "sha256:812899db3d2225224ea231112d2eba150ffbbd254148e71f94c81a44de32cadf",
  acceptance:
    "sha256:ba830728d81fbe31739e6aa73c16bb06ddb6ede95adf605f990c42e2540861cf",
  max1: "sha256:e6f3d746959b3a5633fd9b7d6035a0dca44cee9f886b1c045e9d55b6dc1e86f0",
  max2: "sha256:1a5ba973d3d97b76efa7ffb0a6f5cfa9427fb830e7fbfc8831659ea910f8e9d5",
  closure:
    "sha256:0a3d9f62f656a7e069f88335cfe09ad5ce94010b7fb2a85b514fb79d38775318",
  cleanup:
    "sha256:af1c8d3c1c1f8808c5cb94dda49c09c521b3f853c4560e28365af4a078617054",
  rawOrchestrator:
    "sha256:786aa70f4a36e0e9588bd6d62d82b74d91fad653a7dff1fbab34d513e8404734",
  rawLiveResult:
    "sha256:e3fcac2bc9479397f897b82680ea4d97532845bbee3e77f7e7370fc49ebabd30",
  control: "6632c4508a1f4127491a598d52157dece41a0560",
  source: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  handler:
    "sha256:be050e3c1db8eae65c32e68c1d70ef01aa9b9f74b6079f2386fd4dbce37efe68",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageBase:
    "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  imageConfig:
    "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  imageLayer:
    "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  imageParentConfig:
    "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  parent:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  model:
    "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest:
    "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume:
    "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  endpoint:
    "sha256:7546acc6339d19553806befb55b49a845aab50112b60b9ec25caf1fcaab724ea",
  template:
    "sha256:2565775c831169d144255a84e484aa22d961ba8bc5960e34bee253db6138b9d6",
  workerVersion:
    "sha256:0ca150f857bbbbd63b474e220a008511805daf337ae7d0154489046e57419e53",
};

const fail = (code) => {
  throw new Error(`V207_ATTEMPT37_CLOSURE_${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const bytes = (path) => readFileSync(path);
const text = (path) => String(bytes(path));
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;
const has = (value, expectedValue) => value === expectedValue;
const blockBetween = (value, start, end) => {
  const startIndex = value.indexOf(start);
  assert(startIndex >= 0, `CONTEXT_MISSING_${start.replace(/[^A-Za-z0-9]+/gu, "_")}`);
  const endIndex = end === undefined ? value.length : value.indexOf(end, startIndex + start.length);
  assert(endIndex < 0 || endIndex > startIndex, `CONTEXT_ORDER_${start.replace(/[^A-Za-z0-9]+/gu, "_")}`);
  return value.slice(startIndex, endIndex < 0 ? value.length : endIndex);
};

const proposalPath = resolve(candidateDir, "combined-live-proposal.json");
const authorityPath = resolve(candidateDir, "approved-authority.json");
const acceptancePath = resolve(candidateDir, "acceptance.json");
const max1Path = resolve(candidateDir, "staged-config-max1.json");
const max2Path = resolve(candidateDir, "staged-config-max2.json");
const proposal = json(proposalPath);
const authority = json(authorityPath);
const acceptance = json(acceptancePath);
const max1 = json(max1Path);
const max2 = json(max2Path);
const closure = json(closurePath);
const cleanup = json(cleanupPath);

for (const [path, expectedHash, code] of [
  [proposalPath, expected.proposal, "PROPOSAL_HASH"],
  [authorityPath, expected.authority, "AUTHORITY_HASH"],
  [acceptancePath, expected.acceptance, "ACCEPTANCE_HASH"],
  [max1Path, expected.max1, "MAX1_HASH"],
  [max2Path, expected.max2, "MAX2_HASH"],
  [closurePath, expected.closure, "CLOSURE_HASH"],
  [cleanupPath, expected.cleanup, "CLEANUP_HASH"],
]) {
  assert(sha(path) === expectedHash, code);
}

assert(proposal.attempt === 37 && proposal.checkpoint === "V2-07", "PROPOSAL_SCOPE");
assert(proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null, "PROPOSAL_CAP_NULL");
assert(proposal.execution_boundary?.provider_calls_completed === false, "PROPOSAL_PROVIDER_BOUNDARY");
assert(proposal.execution_boundary?.runpod_mutation_authorized_pending_execution === false, "PROPOSAL_MUTATION_BOUNDARY");
assert(proposal.execution_boundary?.gpu_use_authorized_pending_execution === false, "PROPOSAL_GPU_BOUNDARY");
assert(proposal.execution_boundary?.v2_08_authorized === false, "PROPOSAL_V2_08");

const proposalLineage = proposal.lineage;
assert(
  proposalLineage?.control_source_commit === expected.control &&
    proposalLineage?.image_source_commit === expected.source &&
    proposalLineage?.final_image === expected.image &&
    proposalLineage?.image_manifest_sha256 === expected.image.split("@")[1] &&
    proposalLineage?.image_base_sha256 === expected.imageBase &&
    proposalLineage?.image_config_sha256 === expected.imageConfig &&
    proposalLineage?.image_layer_sha256 === expected.imageLayer &&
    proposalLineage?.image_parent_config_sha256 === expected.imageParentConfig &&
    proposalLineage?.image_parent === expected.parent &&
    proposalLineage?.model === expected.model &&
    proposalLineage?.model_manifest_sha256 === expected.manifest &&
    proposalLineage?.model_root === "/runpod-volume/mage-model" &&
    proposalLineage?.volume_id_sha256 === expected.volume &&
    proposalLineage?.volume_mount === "/runpod-volume" &&
    proposalLineage?.volume_region === "EU-RO-1" &&
    proposalLineage?.volume_size_gb === 50 &&
    proposalLineage?.volume_write_policy === "APPLICATION_READ_ONLY",
  "PROPOSAL_LINEAGE",
);
assert(
  proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 &&
    proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2,
  "PROPOSAL_CONFIG_HASHES",
);

const validateConfig = (config, workersMax, code) => {
  assert(
    config.control_source_commit === expected.control &&
      config.image === expected.image &&
      config.image_source_commit === expected.source &&
      config.network_volume_id_sha256 === expected.volume &&
      config.network_volume_mount === "/runpod-volume" &&
      config.network_volume_region === "EU-RO-1" &&
      config.network_volume_size_gb === 50 &&
      config.model_root === "/runpod-volume/mage-model" &&
      config.volume_write_policy === "APPLICATION_READ_ONLY" &&
      config.region === "EU-RO-1" &&
      config.compute_type === "GPU" &&
      config.flex_only === true &&
      config.flashboot === true &&
      config.workers_min === 0 &&
      config.workers_max === workersMax &&
      config.gpu_type_ids?.length === 1 &&
      config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" &&
      (config.gpu_count ?? config.gpu_count_per_worker) === 1,
    code,
  );
};
validateConfig(max1, 1, "MAX1_IDENTITY");
validateConfig(max2, 2, "MAX2_IDENTITY");

assert(
  acceptance.attempt === 37 &&
    acceptance.result === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    acceptance.qualification_status === "NOT_QUALIFIED_PENDING_EXECUTION" &&
    acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.authority_sha256 === expected.authority &&
    acceptance.candidate?.max1_sha256 === expected.max1 &&
    acceptance.candidate?.max2_sha256 === expected.max2 &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === 4,
  "ACCEPTANCE_BINDING",
);

assert(
  authority.attempt === 37 &&
    authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.approval?.consumed === false &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.minimum_approved_availability === "LOW" &&
    authority.approval?.prior_authority_reused === false &&
    authority.authorized_operations?.retained_volume_mutation_authorized === false &&
    authority.authorized_operations?.v2_08_authorized === false,
  "AUTHORITY_PREEXECUTION_BINDING",
);

assert(closure.schema_version === "videoforge.v2-07-attempt37-prequalification-safety-stop/v1", "CLOSURE_SCHEMA");
assert(
  closure.attempt === 37 &&
    closure.checkpoint === "V2-07" &&
    closure.task_id === "VF-10-07" &&
    closure.result === "NOT_QUALIFIED_PREQUALIFICATION_ACCEPTANCE_GAP_AND_INTERRUPTED_ORCHESTRATION" &&
    closure.qualification_status === "NOT_QUALIFIED",
  "CLOSURE_RESULT",
);
assert(
  closure.authority?.sha256 === expected.authority &&
    closure.authority?.state === "CONSUMED_CLOSED_DO_NOT_REUSE" &&
    closure.authority?.maximum_cumulative_finite_spend_usd === 4 &&
    closure.authority?.flashboot === true &&
    closure.authority?.minimum_availability === "LOW" &&
    closure.authority?.region === "EU-RO-1" &&
    closure.proposal?.sha256 === expected.proposal,
  "CLOSURE_AUTHORITY",
);

assert(
  closure.lineage?.control_source_commit === expected.control &&
    closure.lineage?.handler_source_sha256_at_control_commit === expected.handler &&
    closure.lineage?.image === expected.image &&
    closure.lineage?.image_source_commit === expected.source &&
    closure.lineage?.model === expected.model &&
    closure.lineage?.model_manifest_sha256 === expected.manifest &&
    closure.lineage?.mage_volume_id_sha256 === expected.volume &&
    closure.lineage?.mage_volume_mount === "/runpod-volume" &&
    closure.lineage?.mage_volume_region === "EU-RO-1" &&
    closure.lineage?.mage_volume_size_gb === 50 &&
    JSON.stringify(closure.lineage?.gpu_allowlist) === JSON.stringify(["NVIDIA GeForce RTX 4090"]),
  "CLOSURE_LINEAGE",
);
assert(
  closure.orchestration?.last_durable_orchestrator_event === "live_preflight_completed" &&
    closure.orchestration?.live_preflight_completed === true &&
    closure.orchestration?.full_runner_started === true &&
    closure.orchestration?.full_runner_terminal_result_recorded === false &&
    closure.orchestration?.accepted_batches === 0 &&
    closure.orchestration?.durable_output_readbacks === 0 &&
    closure.orchestration?.v3_receipts === 0 &&
    closure.orchestration?.gpu_job_count === undefined &&
    closure.orchestration?.owned_job_dispatch === "UNPROVEN_DUE_TO_INCOMPLETE_LIVE_RESULT" &&
    closure.orchestration?.qualification_claim_forbidden === true &&
    closure.orchestration?.redacted_orchestrator_sha256 === expected.rawOrchestrator &&
    closure.orchestration?.incomplete_live_result_sha256 === expected.rawLiveResult,
  "CLOSURE_ORCHESTRATION_NO_FALSE_JOB_COUNT",
);
assert(
  closure.acceptance_gap?.durable_per_unit_resume?.implemented_in_executed_image === false &&
    closure.acceptance_gap?.durable_per_unit_resume?.required === true &&
    closure.acceptance_gap?.timing_provenance?.allocation_ms_in_executed_image === 0 &&
    closure.acceptance_gap?.timing_provenance?.container_ready_ms_in_executed_image === 0 &&
    closure.acceptance_gap?.timing_provenance?.truthful_provider_delay_preserved === false,
  "CLOSURE_P1_GAPS",
);
assert(
  closure.provider_result?.disposable_endpoint_created === true &&
    closure.provider_result?.disposable_private_template_created === true &&
    closure.provider_result?.cleanup_endpoint_worker_record_count === 1 &&
    closure.provider_result?.cleanup_terminal_pod_record_count === 1 &&
    closure.provider_result?.gpu_job_count === "UNPROVEN" &&
    closure.provider_result?.settled_incremental_spend_usd === 0.21460066991858184 &&
    closure.provider_result?.within_approved_cap === true,
  "CLOSURE_PROVIDER_RESULT",
);
assert(
  closure.cleanup?.endpoint_deleted === true &&
    closure.cleanup?.private_template_deleted === true &&
    closure.cleanup?.signer_secret_deleted === true &&
    closure.cleanup?.captured_worker_version_restored === true &&
    closure.cleanup?.route_cleanup_uncertain === true &&
    closure.cleanup?.route_rollback_exact === false &&
    closure.cleanup?.v2_08_authorized === false,
  "CLOSURE_CLEANUP_BOUNDARY",
);

assert(cleanup.schema_version === "videoforge.v2-07-attempt37-cleanup-observation/v1", "CLEANUP_SCHEMA");
assert(cleanup.attempt === 37 && cleanup.task_id === "VF-10-07", "CLEANUP_SCOPE");
assert(cleanup.result === "RUNPOD_CLEAN_CLOUDFLARE_ROUTE_FINGERPRINT_UNCERTAIN", "CLEANUP_RESULT");
assert(
  cleanup.runpod_cleanup?.endpoint_deleted === true &&
    cleanup.runpod_cleanup?.template_deleted === true &&
    cleanup.runpod_cleanup?.final_disposable_resources_absent === true &&
    cleanup.runpod_cleanup?.endpoint_id_sha256 === expected.endpoint &&
    cleanup.runpod_cleanup?.template_id_sha256 === expected.template &&
    cleanup.runpod_cleanup?.endpoint_worker_record_count === 1 &&
    cleanup.runpod_cleanup?.terminal_pod_record_count === 1 &&
    cleanup.runpod_cleanup?.stable_terminal_snapshots_before_delete === 2,
  "RUNPOD_CLEANUP",
);

const inventory = cleanup.final_inventory;
assert(
  inventory?.pods === 0 &&
    inventory?.endpoints === 0 &&
    inventory?.private_templates === 0 &&
    inventory?.active_serverless_workers === 0 &&
    inventory?.running_pods === 0 &&
    inventory?.stable_reads === 3 &&
    Array.isArray(inventory.retained_volumes) &&
    inventory.retained_volumes.length === 2,
  "FINAL_INVENTORY_ZERO_DISPOSABLE",
);
const retainedVolumes = new Map(inventory.retained_volumes.map((volume) => [volume.purpose, volume]));
const mageVolume = retainedVolumes.get("Mage");
const soulxVolume = retainedVolumes.get("SoulX");
assert(
  mageVolume?.id_sha256 === expected.volume &&
    mageVolume?.region === "EU-RO-1" &&
    mageVolume?.size_gb === 50 &&
    soulxVolume?.id_sha256 === expected.soulxVolume &&
    soulxVolume?.region === "EU-RO-1" &&
    soulxVolume?.size_gb === 50,
  "FINAL_RETAINED_VOLUMES",
);

const billing = cleanup.billing;
const computedIncrement = billing.final_endpoint_spend_usd - billing.baseline_endpoint_spend_usd;
assert(
  billing?.baseline_endpoint_spend_usd === 1.3100463044829667 &&
    billing?.final_endpoint_spend_usd === 1.5246469744015485 &&
    billing?.settled_incremental_spend_usd === 0.21460066991858184 &&
    Math.abs(computedIncrement - billing.settled_incremental_spend_usd) < 1e-15 &&
    billing?.maximum_cumulative_finite_spend_usd === 4 &&
    billing?.settlement === "THREE_STABLE_READS" &&
    billing?.within_approved_cap === true,
  "BILLING_ARITHMETIC",
);
assert(
  cleanup.retention?.mage_volume_retained === true &&
    cleanup.retention?.soulx_volume_retained === true &&
    cleanup.retention?.retained_volume_write_delete_rebuild_or_cross_mount === false &&
    cleanup.retention?.ongoing_two_volume_charge_usd_per_month === 7,
  "RETENTION_POLICY",
);

const cloudflare = cleanup.cloudflare_cleanup;
assert(
  cloudflare?.active_worker_version_exact_match === true &&
    cloudflare?.active_worker_version_sha256 === expected.workerVersion &&
    cloudflare?.captured_worker_version_sha256 === expected.workerVersion &&
    cloudflare?.ephemeral_signer_secret_deleted === true &&
    cloudflare?.captured_route_status === 404 &&
    cloudflare?.captured_route_code === "V207_ROUTE_DISABLED" &&
    cloudflare?.post_rollback_observed_status === 503 &&
    cloudflare?.post_rollback_observed_code === "HOSTED_ROUTE_NOT_COMPOSED" &&
    cloudflare?.post_rollback_observed_content_type === "application/json" &&
    cloudflare?.exact_captured_fingerprint_restored === false &&
    cloudflare?.minimum_bounded_route_reads === 63 &&
    cloudflare?.cleanup_uncertain === true,
  "CLOUDFLARE_ROUTE_UNCERTAIN",
);
assert(
  cleanup.provider_boundary?.authority_consumed === true &&
    cleanup.provider_boundary?.cap_consumed === true &&
    cleanup.provider_boundary?.provider_calls_authorized === false &&
    cleanup.provider_boundary?.provider_mutations_authorized === false &&
    cleanup.provider_boundary?.gpu_use_authorized === false &&
    cleanup.provider_boundary?.retained_volume_mutation_authorized === false &&
    cleanup.provider_boundary?.v2_08_authorized === false,
  "CLEANUP_BOUNDARY_CONSUMED",
);

const source = text(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"));
assert(
  source.includes("export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;") &&
    source.includes("export const V207_APPROVED_FINITE_CAP_USD: number | null = null;"),
  "ACTIVATION_CONSTANTS_CLOSED",
);
const handlerAtControl = execFileSync(
  "git",
  ["show", `${expected.control}:workers/image-media/mage_serverless.py`],
  { cwd: root },
);
assert(
  `sha256:${createHash("sha256").update(handlerAtControl).digest("hex")}` === expected.handler,
  "CONTROL_HANDLER_SOURCE_HASH",
);
assert(execFileSync("git", ["cat-file", "-e", `${expected.control}^{commit}`], { cwd: root }), "CONTROL_COMMIT");

const currentState = text(resolve(root, "project-context/CURRENT_STATE.yaml"));
const gates = text(resolve(root, "project-context/GATES.yaml"));
const startHere = text(resolve(root, "project-context/00_START_HERE.md"));
const task = text(resolve(root, "project-context/tasks/VF-10-07.md"));
const currentAttempt = blockBetween(
  currentState,
  "pending_v2_07_attempt37_proposal:",
  "pending_v2_07_attempt24_proposal:",
);
assert(
  currentAttempt.includes("mode: closed_consumed_acceptance_gap_and_interrupted_orchestration") &&
    currentAttempt.includes(`closure_evidence_sha256: \"${expected.closure}\"`) &&
    currentAttempt.includes(`cleanup_evidence_sha256: \"${expected.cleanup}\"`) &&
    currentAttempt.includes("maximum_cumulative_finite_spend_usd: null") &&
    currentAttempt.includes("authority_recorded: false") &&
    currentAttempt.includes("provider_calls_authorized: false") &&
    currentAttempt.includes("provider_mutations_authorized: false") &&
    currentAttempt.includes("gpu_use_authorized: false") &&
    currentAttempt.includes("v2_08_authorized: false"),
  "CURRENT_STATE_ATTEMPT37_POINTERS",
);
const mageEvidence = blockBetween(
  currentState,
  "model_runtime_evidence:\n  mage:\n",
  "\n  v2_07_attempt33_candidate_acceptance_sha256",
);
assert(
  mageEvidence.includes(`v2_07_evidence_sha256: \"${expected.closure}\"`) &&
    mageEvidence.includes(`v2_07_cleanup_evidence_sha256: \"${expected.cleanup}\"`),
  "CURRENT_STATE_MAGE_POINTERS",
);
const providerTruth = blockBetween(currentState, "last_known_provider_resource_truth:", "\nrecommended_next_task:");
assert(
  providerTruth.includes("checked_at: \"2026-08-22T22:33:19.059Z\"") &&
    providerTruth.includes(`evidence_sha256: \"${expected.cleanup}\"`) &&
    providerTruth.includes("pods: 0") &&
    providerTruth.includes("private_templates: 0") &&
    providerTruth.includes("endpoints: 0") &&
    providerTruth.includes("network_volumes: 2"),
  "CURRENT_STATE_PROVIDER_TRUTH",
);
const durablePointers = currentState.slice(currentState.lastIndexOf("  v2_07_attempt37_closed_authority:"));
assert(
  durablePointers.includes(`v2_07_attempt37_closed_authority_sha256: \"${expected.authority}\"`) &&
    durablePointers.includes(`v2_07_attempt37_closure_sha256: \"${expected.closure}\"`) &&
    durablePointers.includes(`v2_07_attempt37_cleanup_sha256: \"${expected.cleanup}\"`),
  "CURRENT_STATE_DURABLE_POINTERS",
);
const gate = blockBetween(gates, "  GATE_SERVERLESS_MAGE_001:\n", "\n  GATE_SERVERLESS_SOULX_001:");
assert(
    gate.includes('status: open') &&
    gate.includes('last_run: "evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-37.json"') &&
    gate.includes(`last_run_sha256: \"${expected.closure}\"`) &&
    gate.includes('last_run_at: "2026-08-22T22:34:34.293Z"') &&
    gate.includes(`closure_evidence_sha256: \"${expected.closure}\"`) &&
    gate.includes(`cleanup_evidence_sha256: \"${expected.cleanup}\"`) &&
    gate.includes("pending_proposal: null") &&
    gate.includes("pending_authority: null") &&
    gate.includes("provider_calls_authorized: false") &&
    gate.includes("provider_mutations_authorized: false") &&
    gate.includes("gpu_use_authorized: false") &&
    gate.includes('latest_closed_result: "NOT_QUALIFIED_PREQUALIFICATION_ACCEPTANCE_GAP_AND_INTERRUPTED_ORCHESTRATION_CLEANUP_UNCERTAIN"'),
  "GATE_POINTERS_AND_BOUNDARY",
);
const startHeader = blockBetween(startHere, "# VideoForge: start here", "\n## ");
assert(
  startHeader.includes(`failed-attempt-37.json`)
    && startHeader.includes(expected.closure)
    && startHeader.includes(expected.cleanup)
    && startHeader.includes("NOT_QUALIFIED")
    && startHeader.includes("HOSTED_ROUTE_NOT_COMPOSED")
    && startHeader.includes("V2-08 is forbidden"),
  "START_POINTERS",
);
const taskHeader = blockBetween(
  task,
  "## Attempt37 closed prequalification acceptance gap and interrupted orchestration",
  "\n## Historical Attempt37",
);
assert(
  taskHeader.includes(expected.closure) &&
    taskHeader.includes(expected.cleanup) &&
    taskHeader.includes("NOT_QUALIFIED") &&
    taskHeader.includes("HOSTED_ROUTE_NOT_COMPOSED") &&
    taskHeader.includes("V2-08 remains forbidden"),
  "TASK_POINTERS",
);

assert(
  currentState.startsWith('schema_version: "2.0"') &&
    /^provider_calls_authorized: false$/mu.test(currentState) &&
    /^remote_or_cloud_mutations_authorized: false$/mu.test(currentState) &&
    /^gpu_use_authorized: false$/mu.test(currentState) &&
    /^maximum_external_spend_usd: 0$/mu.test(currentState),
  "CURRENT_STATE_NO_ACTIVE_AUTHORITY",
);

console.log("V2-07 Attempt37 closure validation PASS");
