import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isAttempt29CandidateGate, isAttempt29CandidateState } from "./v207-attempt28-compat.mjs";

const root = resolve(import.meta.dirname, "../..");
const evidenceRoot = resolve(root, "project-context/evidence/acceptance/VF-10-07");
const candidate = resolve(evidenceRoot, "2026-08-21-attempt28-post-job-terminal-scale-zero-candidate");
const liveRoot = resolve(evidenceRoot, "2026-08-21-live-qualification");
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  authority: resolve(candidate, "approved-authority.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  closure: resolve(liveRoot, "failed-attempt-28.json"),
  cleanup: resolve(liveRoot, "attempt28-cleanup-observation.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  activationTest: resolve(root, "apps/web/src/server/providers/v207-activation-authority.test.ts"),
};

const expected = Object.freeze({
  proposal: "sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf",
  authority: "sha256:455d5102618a14595aabb9f38236a7fd4d8ddb59ba063c48b03b4c6dd0a85326",
  max1: "sha256:acef5c48b6059fa2401b88bb40ed81e648c9ed795e5fcb3208e117d936f4196d",
  max2: "sha256:45d067e5d7e1b152d25c62eb7e185898bbedd30797d5d9aacc83bb9a48e41836",
  closure: "sha256:9d95a32f66a563db2c74dedd608067dbcc4b3ed989125ca4d2696b22943ef1bb",
  cleanup: "sha256:a8c7b12731fd8b6b72a4bdce38c2b03de51e50cdc255d9f0fb96639507174049",
  orchestrator: "sha256:af0aaf066158804ba0f823703cb108d2dd1712e15b9d129e6bfb3debbb045813",
  live: "sha256:17055f20e3043a749e7debacfd2a799e6a1aa9db1c5b19e81b2cba7d0e38791d",
  endpoint: "sha256:dfb45157d4f110e46414a97c26ee9c94ead46d3452c7ca3f1cba6ef4da39602e",
  template: "sha256:d0e8ccab05d6b841906bc32deb0c0977884185a08c859757b457e39e93bd4d64",
  control: "0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  imageConfig: "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  imageLayer: "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  imageBase: "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig: "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  max1Definition: "sha256:f16ec355d2d5dbf67f489ad2807b9010edd601ecd20f9c423f46c3804df765c5",
});

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V207_ATTEMPT28_CLOSURE_INVALID:${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${code}_JSON`);
  }
};
const hasSha256 = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
const includesAll = (text, values, code) => values.forEach((value) => assert(text.includes(value), `${code}_${value}`));

const entries = await Promise.all(Object.entries(paths).map(async ([label, path]) => [label, await readFile(path)]));
const bytes = Object.fromEntries(entries);
for (const [label, value] of Object.entries({
  proposal: expected.proposal,
  authority: expected.authority,
  max1: expected.max1,
  max2: expected.max2,
  closure: expected.closure,
  cleanup: expected.cleanup,
})) {
  assert(sha256(bytes[label]) === value, `${label}_HASH`);
}

const proposal = parse(bytes.proposal, "PROPOSAL");
const authority = parse(bytes.authority, "AUTHORITY");
const max1 = parse(bytes.max1, "MAX1");
const max2 = parse(bytes.max2, "MAX2");
const closure = parse(bytes.closure, "CLOSURE");
const cleanup = parse(bytes.cleanup, "CLEANUP");
const state = bytes.state.toString("utf8");
const gates = bytes.gates.toString("utf8");
const task = bytes.task.toString("utf8");
const start = bytes.start.toString("utf8");
const activation = bytes.activation.toString("utf8");
const activationTest = bytes.activationTest.toString("utf8");

assert(closure.schema_version === "videoforge.v2-07-failed-attempt-closure/v1", "CLOSURE_SCHEMA");
assert(closure.checkpoint === "V2-07" && closure.task_id === "VF-10-07" && closure.attempt === 28, "CLOSURE_SCOPE");
assert(closure.result === "NOT_QUALIFIED", "CLOSURE_RESULT");
assert(closure.proposal_sha256 === expected.proposal && closure.authority_sha256 === expected.authority, "CLOSURE_AUTHORITY");
assert(closure.authority_state === "CONSUMED_SINGLE_BOUNDED_EXECUTION_DO_NOT_REUSE", "AUTHORITY_CONSUMED");
assert(closure.control_source_commit === expected.control && closure.post_job_terminal_scale_zero_repair_commit === expected.control, "CONTROL_LINEAGE");

const lineage = closure.lineage;
assert(
  lineage?.image === expected.image &&
    lineage?.image_source_commit === expected.imageSource &&
    lineage?.image_config_sha256 === expected.imageConfig &&
    lineage?.image_layer_sha256 === expected.imageLayer &&
    lineage?.image_base_sha256 === expected.imageBase &&
    lineage?.image_parent_config_sha256 === expected.parentConfig &&
    lineage?.model === expected.model &&
    lineage?.model_manifest_sha256 === expected.manifest &&
    lineage?.mage_volume_id_sha256 === expected.volume &&
    lineage?.region === "EU-RO-1" &&
    lineage?.gpu === "NVIDIA GeForce RTX 4090" &&
    lineage?.flashboot === true &&
    lineage?.workers_min === 0 &&
    lineage?.workers_max === 1 &&
    lineage?.staged_max_one_sha256 === expected.max1 &&
    lineage?.staged_max_two_sha256 === expected.max2 &&
    lineage?.provider_applied_initial_config_sha256 === expected.max1Definition &&
    lineage?.volume_mount === "/runpod-volume" &&
    lineage?.model_root === "/runpod-volume/mage-model" &&
    lineage?.volume_size_gb === 50,
  "CLOSURE_LINEAGE",
);

const live = closure.live_result;
assert(
  live?.source_path === "/tmp/videoforge-v207-live-result.json" &&
    live?.source_sha256 === expected.live &&
    live?.stop_reason === "RUNPOD_QUIESCENT_NOT_CONFIRMED" &&
    live?.stopped_phase === "cold-terminal" &&
    live?.provider_status === "COMPLETED" &&
    live?.output_status === "SUCCEEDED" &&
    live?.output_failure_stage === "post_job_terminal_scale_zero" &&
    live?.output_failure_code === "RUNPOD_QUIESCENT_NOT_CONFIRMED" &&
    live?.accepted_batches === 2 &&
    live?.accepted_outputs === 64 &&
    live?.accepted_receipts === 64 &&
    live?.generated_output_rollback === "CONFIRMED" &&
    live?.unplanned_duplicate_compute === false &&
    live?.duplicate_delivery_same_job === true &&
    live?.intermediate_cleanup_error === "RUNPOD_CLEANUP_UNCERTAIN" &&
    live?.intermediate_failure_reconciliation_error === "V207_RECONCILIATION_INVENTORY_MISMATCH" &&
    live?.approved_finite_spend_cap_usd === 4 &&
    live?.measured_spend_usd === 0,
  "LIVE_RESULT",
);
for (const [label, batch] of [["owned", closure.owned_probe], ["cold", closure.cold_batch]]) {
  assert(batch?.status === "COMPLETED" && batch?.item_count === 32 && hasSha256(batch.provider_job_id_hash), `${label}_BATCH`);
  assert(Array.isArray(batch.readbacks) && batch.readbacks.length === 32, `${label}_READBACK_COUNT`);
  assert(Array.isArray(batch.commit_receipts) && batch.commit_receipts.length === 32, `${label}_RECEIPT_COUNT`);
  batch.readbacks.forEach((item, index) => assert(Number.isInteger(item?.bytes) && item.bytes > 0 && hasSha256(item?.sha256), `${label}_READBACK_${index}`));
  batch.commit_receipts.forEach((item, index) => assert(hasSha256(item?.receipt_sha256) && item?.reservation_id === "[REDACTED]" && item?.replay_confirmed === true, `${label}_RECEIPT_${index}`));
}
assert(closure.duplicate_delivery?.same_job === true && closure.duplicate_delivery?.disposition === "STOP_FAIL_CLOSED_NO_RETRY", "DUPLICATE_BOUNDARY");

assert(cleanup.schema_version === "videoforge.v2-07-failed-cleanup-observation/v1" && cleanup.attempt === 28, "CLEANUP_SCHEMA");
assert(cleanup.result?.schema_version === "videoforge.v2-07-failed-cleanup/v1", "CLEANUP_RESULT_SCHEMA");
assert(
  cleanup.result?.endpoint_id_sha256 === expected.endpoint &&
    cleanup.result?.template_id_sha256 === expected.template &&
    cleanup.result?.retained_mage_volume_id_sha256 === expected.volume &&
    cleanup.result?.stable_terminal_snapshot_count === 2 &&
    cleanup.result?.endpoint_worker_record_count === 1 &&
    cleanup.result?.terminal_pod_record_count === 1 &&
    cleanup.result?.endpoint_deleted === true &&
    cleanup.result?.template_deleted === true &&
    cleanup.result?.final_disposable_resources_absent === true,
  "CLEANUP_RESULT",
);
const exact = closure.exact_failed_cleanup;
assert(
  exact?.observation_path === "attempt28-cleanup-observation.json" &&
    exact?.observation_sha256 === expected.cleanup &&
    exact?.raw_stdout_retained === false &&
    exact?.endpoint_id_sha256 === expected.endpoint &&
    exact?.template_id_sha256 === expected.template &&
    exact?.retained_mage_volume_id_sha256 === expected.volume &&
    exact?.stable_terminal_snapshot_count === 2 &&
    exact?.endpoint_worker_record_count === 1 &&
    exact?.terminal_pod_record_count === 1 &&
    exact?.endpoint_deleted === true &&
    exact?.template_deleted === true &&
    exact?.final_disposable_resources_absent === true,
  "EXACT_CLEANUP",
);

assert(
  closure.orchestrator?.source_path === "/tmp/videoforge-v207-attempt28-orchestrator.json" &&
    closure.orchestrator?.source_sha256 === expected.orchestrator &&
    closure.orchestrator?.result === "FAILED" &&
    closure.orchestrator?.signer_secret_deleted === true &&
    closure.orchestrator?.captured_worker_version_restored === true &&
    closure.orchestrator?.route_restoration?.status === 404 &&
    closure.orchestrator?.route_restoration?.code === "V207_ROUTE_DISABLED" &&
    closure.orchestrator?.route_restoration?.stable_fingerprint_window_confirmed === true,
  "ORCHESTRATOR_ROLLBACK",
);
const reconciliation = closure.final_reconciliation;
assert(
  reconciliation?.schema_version === "videoforge.v2-07-readonly-reconciliation/v2" &&
    reconciliation?.checked_at === "2026-08-21T19:29:07.445Z" &&
    reconciliation?.stable_read_count === 3 &&
    reconciliation?.pods === 0 &&
    reconciliation?.endpoints === 0 &&
    reconciliation?.private_templates === 0 &&
    reconciliation?.active_serverless_workers === 0 &&
    reconciliation?.running_pods === 0 &&
    reconciliation?.baseline_endpoint_spend_usd === 0.3379560004686937 &&
    reconciliation?.final_endpoint_spend_usd === 0.3379560004686937 &&
    reconciliation?.incremental_spend_usd === 0 &&
    reconciliation?.maximum_cumulative_finite_spend_usd === 4 &&
    reconciliation?.within_approved_cap === true &&
    reconciliation?.settlement === "THREE_STABLE_READS",
  "RECONCILIATION",
);
assert(
  reconciliation.retained_volumes?.some((item) => item?.purpose === "Mage" && item?.id_sha256 === expected.volume && item?.size_gb === 50 && item?.region === "EU-RO-1") &&
    reconciliation.retained_volumes?.some((item) => item?.purpose === "SoulX" && item?.id_sha256 === expected.soulxVolume && item?.size_gb === 50 && item?.region === "EU-RO-1"),
  "RETAINED_VOLUMES",
);
assert(closure.retained_storage_charge_usd_per_month === 7, "RETAINED_CHARGE");
assert(closure.qualification_boundaries?.v2_07 === "NOT_QUALIFIED" && closure.qualification_boundaries?.v2_08 === "FORBIDDEN", "BOUNDARIES");

assert(proposal.attempt === 28 && proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "PROPOSAL_SCOPE");
assert(proposal.lineage?.final_image === expected.image && proposal.lineage?.model === expected.model && proposal.lineage?.model_manifest_sha256 === expected.manifest && proposal.lineage?.volume_id_sha256 === expected.volume, "PROPOSAL_LINEAGE");
assert(authority.attempt === 28 && authority.proposal?.sha256 === expected.proposal && authority.approval?.maximum_cumulative_finite_spend_usd === 4, "AUTHORITY_BINDING");
for (const [label, definition, workersMax, hash] of [["max1", max1, 1, expected.max1], ["max2", max2, 2, expected.max2]]) {
  assert(sha256(bytes[label]) === hash && definition.image === expected.image && definition.control_source_commit === expected.control && definition.network_volume_id_sha256 === expected.volume && definition.region === "EU-RO-1" && definition.workers_min === 0 && definition.workers_max === workersMax && definition.flashboot === true, `${label}_DEFINITION`);
}

if (isAttempt29CandidateState(state) && isAttempt29CandidateGate(gates)) {
  includesAll(
    state,
    [
      expected.closure,
      expected.cleanup,
      expected.proposal,
      expected.authority,
      "phase: serverless_v2_v2_07_attempt29_terminal_replay_queue_proof_candidate_ready",
      "task_stage: provider_free",
      "provider_calls_authorized: false",
      "remote_or_cloud_mutations_authorized: false",
      "gpu_use_authorized: false",
      "maximum_external_spend_usd: 0",
      "current_authority: null",
      "current_authority_sha256: null",
      "mutation_authorized: false",
      "spend_authorized_usd: 0",
    ],
    "STATE_ATTEMPT29_SUCCESSOR",
  );
  includesAll(
    gates,
    [
      expected.closure,
      expected.cleanup,
      "authority_mode: none_attempt29_unapproved",
      "pending_numeric_cap_usd: null",
      'result: "NOT_QUALIFIED_attempt29_provider_free_candidate_ready"',
    ],
    "GATES_ATTEMPT29_SUCCESSOR",
  );
} else {
  includesAll(state, [
    expected.closure,
    expected.cleanup,
    expected.proposal,
    expected.authority,
    "phase: serverless_v2_v2_07_attempt28_closed_quiescence_failure",
    "task_stage: provider_free",
    "provider_calls_authorized: false",
    "remote_or_cloud_mutations_authorized: false",
    "gpu_use_authorized: false",
    "maximum_external_spend_usd: 0",
    "current_authority: null",
    "current_authority_sha256: null",
    "mutation_authorized: false",
    "spend_authorized_usd: 0",
  ], "STATE");
  includesAll(gates, [
    expected.closure,
    expected.cleanup,
    "authority_mode: none_attempt28_consumed",
    "pending_numeric_cap_usd: null",
    'result: "NOT_QUALIFIED_attempt28_closed_quiescence_failure"',
  ], "GATES");
}
includesAll(task, [expected.closure, expected.cleanup, "RUNPOD_QUIESCENT_NOT_CONFIRMED", "it is consumed", "V2-07 remains `NOT_QUALIFIED`", "V2-08 remains forbidden"], "TASK");
includesAll(start, [expected.closure, expected.cleanup, "RUNPOD_QUIESCENT_NOT_CONFIRMED", "consumed and non-reusable", "V2-07 remains NOT_QUALIFIED", "V2-08"], "START");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"), "ACTIVATION_CAP_CLOSED");
assert(activationTest.includes("V207_APPROVED_FINITE_CAP_USD).toBeNull()") && activationTest.includes('toThrow("V207_FRESH_AUTHORITY_REQUIRED")'), "ACTIVATION_TEST_CLOSED");

process.stdout.write(`V2-07 Attempt28 closure validation PASS (${expected.closure}; cleanup ${expected.cleanup}; RUNPOD_QUIESCENT_NOT_CONFIRMED; 64 durable outputs/receipts; duplicate fail-closed; three stable zero-resource reads; authority consumed)\n`);
