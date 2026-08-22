import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const liveRoot = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification",
);
const candidateRoot = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt31-terminal-snapshot-stabilization-candidate",
);

const expected = Object.freeze({
  proposal:
    "sha256:ace01c82b5eaa9e45c177e7c41b908b1f384fe13ae6ff6bd3f8e04cf8ecb98ea",
  authority:
    "sha256:02b91db639ddf6e612c7103d38f9c5c1bae3ff0072afaeebb124274db1e3eab5",
  closure:
    "sha256:76c9dec453b5670c0dff73c1857cbbb5e9b43a460599c81a24455404f634c490",
  cleanup:
    "sha256:61185a893499ab0634458fe472af21cb47385923e2fd05af60658ec97d1f54bc",
  max1:
    "sha256:29b3c4ed8d05b91cf5f7fda0b9055a95f3a553dfc65dec8a5b5540c9b7e0e006",
  max2:
    "sha256:4013c7b9887994b6de2dfd947f13ea74e622dfc0fe5b5e429c29fffedc69ef9b",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  control: "f513ac807c6d5e2298092a936495e3c4fc0e6a28",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest:
    "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume:
    "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  imageConfig:
    "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  imageLayer:
    "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  imageManifest:
    "sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageBase:
    "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  imageParentConfig:
    "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  authorityCommit: "b8c626b02ed00f8581742f9852e39d904afb8db5",
  rawLive:
    "sha256:0453bc2a5338339f6c719aa6ccfea7d238d84a2126faa260aecde41d4530d584",
  rawOrchestrator:
    "sha256:d279f826d55ea842ab1097c1df12a2a2559b08e7d9d826d02fafe24a2013900e",
  settledSpend: 0.05512650031596422,
});

const paths = Object.freeze({
  closure: resolve(liveRoot, "failed-attempt-31.json"),
  cleanup: resolve(liveRoot, "attempt31-cleanup-observation.json"),
  proposal: resolve(candidateRoot, "combined-live-proposal.json"),
  authority: resolve(candidateRoot, "approved-authority.json"),
  max1: resolve(candidateRoot, "staged-config-max1.json"),
  max2: resolve(candidateRoot, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
});

const sha256 = (bytes) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V207_ATTEMPT31_CLOSURE_INVALID:${code}`);
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
const equalFields = (object, fields, code) => {
  for (const [key, value] of Object.entries(fields)) {
    assert(object?.[key] === value, `${code}_${key}`);
  }
};
const includesAll = (text, values, code) => {
  assert(values.every((value) => text.includes(value)), code);
};
const hasItem = (array, predicate) =>
  Array.isArray(array) && array.some(predicate);

const fileBytes = await Promise.all(
  Object.entries(paths).map(async ([label, path]) => [label, await readFile(path)]),
);
const bytes = Object.fromEntries(fileBytes);
for (const [label, expectedHash] of Object.entries({
  closure: expected.closure,
  cleanup: expected.cleanup,
  proposal: expected.proposal,
  authority: expected.authority,
  max1: expected.max1,
  max2: expected.max2,
})) {
  assert(sha256(bytes[label]) === expectedHash, `${label.toUpperCase()}_HASH`);
}

const closure = parse(bytes.closure, "CLOSURE");
const cleanup = parse(bytes.cleanup, "CLEANUP");
const proposal = parse(bytes.proposal, "PROPOSAL");
const authority = parse(bytes.authority, "AUTHORITY");
const max1 = parse(bytes.max1, "MAX1");
const max2 = parse(bytes.max2, "MAX2");

assert(
  closure.schema_version === "videoforge.v2-07-live-failure/v1" &&
    closure.checkpoint === "V2-07" &&
    closure.task_id === "VF-10-07" &&
    closure.attempt === 31 &&
    closure.result === "NOT_QUALIFIED",
  "SCOPE",
);
assert(
  closure.proposal_sha256 === expected.proposal &&
    closure.authority_sha256 === expected.authority &&
    closure.authority_state ===
      "CONSUMED_SINGLE_BOUNDED_EXECUTION_DO_NOT_REUSE" &&
    closure.authority_commit === expected.authorityCommit,
  "AUTHORITY_BINDING",
);
assert(
  closure.raw_redacted_evidence?.live_result_path ===
      "/tmp/videoforge-v207-live-result.json" &&
    closure.raw_redacted_evidence?.live_result_sha256 === expected.rawLive &&
    closure.raw_redacted_evidence?.orchestrator_path ===
      "/tmp/videoforge-v207-attempt31-orchestrator.json" &&
    closure.raw_redacted_evidence?.orchestrator_sha256 ===
      expected.rawOrchestrator &&
    closure.raw_redacted_evidence?.secrets_or_raw_provider_ids_retained === false,
  "RAW_EVIDENCE",
);

const lineage = closure.lineage;
assert(
  lineage?.model === expected.model &&
    lineage?.model_manifest_sha256 === expected.manifest &&
    lineage?.image === expected.image &&
    lineage?.image_source_commit === expected.imageSource &&
    lineage?.control_source_commit === expected.control &&
    lineage?.max1_definition_sha256 === expected.max1 &&
    lineage?.max2_definition_sha256 === expected.max2 &&
    lineage?.mage_volume_id_sha256 === expected.volume &&
    lineage?.volume_size_gb === 50 &&
    lineage?.region === "EU-RO-1" &&
    lineage?.mount === "/runpod-volume" &&
    lineage?.model_root === "/runpod-volume/mage-model" &&
    lineage?.gpu === "NVIDIA GeForce RTX 4090" &&
    lineage?.flashboot === true &&
    lineage?.volume_write_policy === "APPLICATION_READ_ONLY",
  "LINEAGE",
);

assert(
  proposal.schema_version ===
      "videoforge.v2-07-terminal-snapshot-stabilization-combined-live-proposal/v1" &&
    proposal.checkpoint === "V2-07" &&
    proposal.task_id === "VF-10-07" &&
    proposal.attempt === 31 &&
    proposal.provider_mutation === false &&
    proposal.publication === false &&
    proposal.gpu_use === false &&
    proposal.spend_usd === 0 &&
    proposal.lineage?.model === expected.model &&
    proposal.lineage?.model_manifest_sha256 === expected.manifest &&
    proposal.lineage?.volume_id_sha256 === expected.volume &&
    proposal.lineage?.volume_size_gb === 50 &&
    proposal.lineage?.volume_region === "EU-RO-1" &&
    proposal.lineage?.volume_mount === "/runpod-volume" &&
    proposal.lineage?.model_root === "/runpod-volume/mage-model" &&
    proposal.lineage?.image_source_commit === expected.imageSource &&
    proposal.lineage?.control_source_commit === expected.control &&
    proposal.lineage?.image_config_sha256 === expected.imageConfig &&
    proposal.lineage?.image_layer_sha256 === expected.imageLayer &&
    proposal.lineage?.image_manifest_sha256 === expected.imageManifest &&
    proposal.lineage?.image_base_sha256 === expected.imageBase &&
    proposal.lineage?.image_parent_config_sha256 === expected.imageParentConfig &&
    proposal.lineage?.final_image === expected.image,
  "PROPOSAL_LINEAGE",
);
assert(
  proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null &&
    proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null,
  "PROPOSAL_IMMUTABLE_CAP",
);

for (const [label, definition, workersMax, hash] of [
  ["MAX1", max1, 1, expected.max1],
  ["MAX2", max2, 2, expected.max2],
]) {
  const gpuCount = definition.gpu_count ?? definition.gpu_count_per_worker;
  assert(
    definition.schema_version === "videoforge.v2-07-staged-endpoint-definition/v8" &&
      definition.region === "EU-RO-1" &&
      definition.image === expected.image &&
      definition.image_source_commit === expected.imageSource &&
      definition.control_source_commit === expected.control &&
      definition.network_volume_id_sha256 === expected.volume &&
      definition.network_volume_size_gb === 50 &&
      definition.network_volume_region === "EU-RO-1" &&
      definition.network_volume_mount === "/runpod-volume" &&
      definition.model_root === "/runpod-volume/mage-model" &&
      definition.gpu_type_ids?.length === 1 &&
      definition.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" &&
      gpuCount === 1 &&
      definition.compute_type === "GPU" &&
      definition.flex_only === true &&
      definition.workers_min === 0 &&
      definition.workers_max === workersMax &&
      definition.flashboot === true &&
      definition.volume_write_policy === "APPLICATION_READ_ONLY" &&
      sha256(bytes[label.toLowerCase()]) === hash,
    `${label}_DEFINITION`,
  );
}

const authorityLineage = authority.lineage;
assert(
  authority.schema_version ===
      "videoforge.v2-07-attempt31-terminal-snapshot-stabilization-authority/v1" &&
    authority.checkpoint === "V2-07" &&
    authority.task_id === "VF-10-07" &&
    authority.attempt === 31 &&
    authority.authority_mode === "bounded_mutation" &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.approval?.exact_proposal_approved === true &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.minimum_approved_availability === "LOW" &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval?.fresh_numeric_cap === true &&
    authority.approval?.historical_cap_reused === false &&
    authority.approval?.prior_authority_reused === false &&
    authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.execution_boundary?.v2_08_authorized === false &&
    authorityLineage?.model === expected.model &&
    authorityLineage?.model_manifest_sha256 === expected.manifest &&
    authorityLineage?.volume_id_sha256 === expected.volume &&
    authorityLineage?.volume_size_gb === 50 &&
    authorityLineage?.volume_region === "EU-RO-1" &&
    authorityLineage?.volume_mount === "/runpod-volume" &&
    authorityLineage?.model_root === "/runpod-volume/mage-model" &&
    authorityLineage?.final_image === expected.image &&
    authorityLineage?.image_config_sha256 === expected.imageConfig &&
    authorityLineage?.image_layer_sha256 === expected.imageLayer &&
    authorityLineage?.image_manifest_sha256 === expected.imageManifest &&
    authorityLineage?.image_base_sha256 === expected.imageBase &&
    authorityLineage?.image_parent_config_sha256 === expected.imageParentConfig &&
    authorityLineage?.initial_config_sha256 === expected.max1 &&
    authorityLineage?.concurrent_reader_config_sha256 === expected.max2,
  "AUTHORITY_RECORD",
);

const expectedBatches = [
  {
    kind: "owned_probe",
    item_count: 32,
    durable_readback_count: 32,
    replay_confirmed_v3_receipt_count: 32,
    queue_delay_ms: 92147,
    provider_execution_ms: 161944,
    peak_vram_used_bytes: 14177206272,
    model_load_ms: 11804,
    warmup_ms: 12089,
    first_inference_ms: 1046,
    upload_ms: 30430,
    worker_total_ms: 105692,
  },
  {
    kind: "cold",
    item_count: 32,
    durable_readback_count: 32,
    replay_confirmed_v3_receipt_count: 32,
    queue_delay_ms: 1441,
    provider_execution_ms: 61412,
    peak_vram_used_bytes: 13640335360,
    model_load_ms: 11804,
    warmup_ms: 12089,
    first_inference_ms: 511,
    upload_ms: 11558,
    worker_total_ms: 60056,
  },
  {
    kind: "warm",
    item_count: 32,
    durable_readback_count: 32,
    replay_confirmed_v3_receipt_count: 32,
    queue_delay_ms: 1435,
    provider_execution_ms: 86019,
    peak_vram_used_bytes: 13640335360,
    model_load_ms: 11804,
    warmup_ms: 12089,
    first_inference_ms: 492,
    upload_ms: 34593,
    worker_total_ms: 84659,
  },
];
assert(
  Array.isArray(closure.accepted_batches) &&
    closure.accepted_batches.length === expectedBatches.length,
  "BATCH_COUNT",
);
closure.accepted_batches.forEach((batch, index) =>
  equalFields(batch, expectedBatches[index], `BATCH_${index}`),
);

assert(
  closure.duplicate_delivery?.same_job === true &&
    closure.duplicate_delivery?.second_provider_dispatch === false &&
    closure.duplicate_delivery?.duplicate_compute === false,
  "DUPLICATE_DELIVERY",
);
assert(
  closure.concurrent_reader_proof?.workers_max === 2 &&
    closure.concurrent_reader_proof?.two_jobs_dispatched === true &&
    closure.concurrent_reader_proof?.both_provider_terminal_completed === true &&
    closure.concurrent_reader_proof?.accepted_reader_batch_count === 0 &&
    closure.concurrent_reader_proof?.failure_before_acceptance === true &&
    closure.concurrent_reader_proof?.reader_a_queue_delay_ms === 10298 &&
    closure.concurrent_reader_proof?.reader_a_execution_ms === 314389 &&
    closure.concurrent_reader_proof?.reader_b_queue_delay_ms === 11445 &&
    closure.concurrent_reader_proof?.reader_b_execution_ms === 313006,
  "CONCURRENT_READERS",
);
assert(
  closure.failure?.error === "MAGE_OUTPUT_NOT_SUCCEEDED" &&
    closure.failure?.category === "output_contract" &&
    closure.failure?.stage === "output_finalization" &&
    closure.failure?.code === "V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID" &&
    closure.failure?.provider_terminal_status === "COMPLETED" &&
    closure.failure?.worker_output_status === "SUCCEEDED" &&
    closure.failure?.output_shape_kind === "object" &&
    JSON.stringify(closure.failure?.output_shape_keys) ===
      JSON.stringify(["items", "provenance_receipt", "status"]) &&
    closure.failure?.stop_condition_obeyed === true &&
    closure.failure?.no_retry_or_duplicate_compute === true,
  "FINALIZE_FAILURE",
);
assert(
  closure.unreached_live_proofs?.cancellation === true &&
    closure.unreached_live_proofs?.timeout === true &&
    closure.unreached_live_proofs?.two_reader_durable_acceptance === true &&
    closure.unreached_live_proofs?.retained_success_endpoint_and_template === true,
  "UNREACHED_PROOFS",
);
assert(
  closure.sealed_volume?.manifest_unchanged === true &&
    closure.sealed_volume?.model_volume_writes_observed === false &&
    closure.sealed_volume?.runtime_download_or_quantization_observed === false &&
    closure.sealed_volume?.cache_escape_observed === false &&
    closure.sealed_volume?.volume_mutation_authorized === false,
  "SEALED_VOLUME",
);

const finalReconciliation = cleanup.final_reconciliation;
assert(
  cleanup.schema_version ===
      "videoforge.v2-07-attempt31-cleanup-observation/v1" &&
    cleanup.checkpoint === "V2-07" &&
    cleanup.task_id === "VF-10-07" &&
    cleanup.attempt === 31 &&
    cleanup.proposal_sha256 === expected.proposal &&
    cleanup.authority_sha256 === expected.authority &&
    cleanup.cleanup?.stable_terminal_snapshot_count === 2 &&
    cleanup.cleanup?.endpoint_worker_record_count === 5 &&
    cleanup.cleanup?.terminal_pod_record_count === 5 &&
    cleanup.cleanup?.endpoint_deleted === true &&
    cleanup.cleanup?.template_deleted === true &&
    cleanup.cleanup?.final_disposable_resources_absent === true &&
    cleanup.cleanup?.network_volume_delete_called === false,
  "CLEANUP_OBSERVATION",
);
assert(
  closure.cleanup?.observation_path === "attempt31-cleanup-observation.json" &&
    closure.cleanup?.disposable_endpoint_deleted === true &&
    closure.cleanup?.disposable_template_deleted === true &&
    closure.cleanup?.final_disposable_resources_absent === true &&
    closure.cleanup?.active_workers === 0 &&
    closure.cleanup?.running_pods === 0 &&
    closure.cleanup?.intended_volume_count === 2 &&
    closure.cleanup?.signer_secret_deleted === true &&
    closure.cleanup?.worker_version_rolled_back === true &&
    closure.cleanup?.route_restored === true &&
    closure.cleanup?.generated_output_rollback === "CONFIRMED",
  "CLEANUP_RESULT",
);
assert(
  finalReconciliation?.stable_read_count === 3 &&
    finalReconciliation?.pods === 0 &&
    finalReconciliation?.endpoints === 0 &&
    finalReconciliation?.private_templates === 0 &&
    finalReconciliation?.active_serverless_workers === 0 &&
    finalReconciliation?.running_pods === 0 &&
    finalReconciliation?.retained_volume_count === 2 &&
    finalReconciliation?.retained_volumes?.length === 2 &&
    hasItem(
      finalReconciliation.retained_volumes,
      (volume) =>
        volume.id_sha256 === expected.volume &&
        volume.size_gb === 50 &&
        volume.region === "EU-RO-1",
    ) &&
    hasItem(
      finalReconciliation.retained_volumes,
      (volume) =>
        volume.id_sha256 === expected.soulxVolume &&
        volume.size_gb === 50 &&
        volume.region === "EU-RO-1",
    ),
  "FINAL_RECONCILIATION",
);
assert(
  cleanup.billing?.baseline_endpoint_spend_usd === 0.6305554735008627 &&
    cleanup.billing?.final_endpoint_spend_usd === 0.6856819738168269 &&
    cleanup.billing?.incremental_spend_usd === expected.settledSpend &&
    cleanup.billing?.maximum_cumulative_finite_spend_usd === 4 &&
    cleanup.billing?.within_approved_cap === true &&
    cleanup.billing?.settlement === "THREE_STABLE_READS",
  "CLEANUP_BILLING",
);
assert(
  closure.billing?.baseline_endpoint_spend_usd === 0.6305554735008627 &&
    closure.billing?.final_endpoint_spend_usd === 0.6856819738168269 &&
    closure.billing?.incremental_spend_usd === expected.settledSpend &&
    closure.billing?.maximum_cumulative_finite_spend_usd === 4 &&
    closure.billing?.within_approved_cap === true &&
    closure.billing?.settlement === "THREE_STABLE_READS" &&
    closure.billing?.existing_two_volume_charge_usd_per_month_total === 7 &&
    closure.billing?.volume_charge_outside_finite_cap === true,
  "CLOSURE_BILLING",
);
assert(
  cleanup.cloudflare_cleanup?.signer_secret_deleted === true &&
    cleanup.cloudflare_cleanup?.worker_version_rolled_back === true &&
    cleanup.cloudflare_cleanup?.pre_mutation_route_restored === true &&
    cleanup.cloudflare_cleanup?.generated_output_rollback === "CONFIRMED" &&
    cleanup.retention?.sealed_mage_volume_retained === true &&
    cleanup.retention?.soulx_volume_retained === true &&
    cleanup.retention?.existing_two_volume_charge_usd_per_month_total === 7 &&
    cleanup.retention?.recurring_charge_outside_attempt31_finite_cap === true &&
    cleanup.secrets_or_raw_provider_ids_retained === false &&
    cleanup.v2_08_authorized === false,
  "ROLLBACK_RETENTION",
);

assert(
  closure.v2_08_authorized === false &&
    closure.next_boundary?.includes("fresh exact approval") &&
    closure.next_boundary?.includes("fresh positive numeric cumulative finite spend cap"),
  "BOUNDARY",
);

// The durable handoff surfaces are read here rather than treated as a second
// evidence source. Once the closure is recorded, every available surface must
// point at the same consumed Attempt31 evidence and open qualification gate.
const contextPointers = [
  expected.proposal,
  expected.authority,
  expected.closure,
  expected.cleanup,
  "MAGE_OUTPUT_NOT_SUCCEEDED",
  "V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID",
  "NOT_QUALIFIED",
  "V2-08",
];
for (const label of ["state", "gates", "task", "start"]) {
  includesAll(bytes[label].toString("utf8"), contextPointers, `${label.toUpperCase()}_POINTERS`);
}

process.stdout.write(
  `V2-07 Attempt31 closure validation PASS (closure ${expected.closure}; cleanup ${expected.cleanup}; settled finite spend $${expected.settledSpend})\n`,
);
