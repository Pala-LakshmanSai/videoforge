import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// This validator is deliberately tied to the single approved Attempt32.  It
// validates the redacted closure record and the two provider-side cleanup
// records; it never calls RunPod or reads a provider secret.
const root = resolve(import.meta.dirname, "../..");
const liveRoot = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification",
);
const candidateRoot = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt32-finalize-response-diagnostics-candidate",
);

const expected = Object.freeze({
  proposal:
    "sha256:7c5370668ae06487729775f082cd981164d3e4a1634f20a77beb08bba2ea6b6a",
  acceptance:
    "sha256:7ed0bd6c9d064133e9409b79be099184a4b80444d4da66759fa47082d7a66080",
  max1:
    "sha256:2663f06af19ceb11470e0ddac86ac74dae00d25a7b128970376dca2a3d1343d2",
  max2:
    "sha256:969816bd9546a81d08f1b725480ad17839d6bd067451ed3074dac3a102cc9e7a",
  authority:
    "sha256:a2f2519e6cc5f00ec804adea07b431d155e9fc88a566d7f9ef05396beca99114",
  closure:
    "sha256:5e2cf1f73e03673b9f350352fa2bfbb91566d9e9a695566fdc08f3b1d84c9f75",
  cleanup:
    "sha256:01d91e1216a77ea4d6ac7130c2add5800f67043b3ba34d26ecbecf9422acc51d",
  live:
    "sha256:a1895020150c1532e7ae4707fb903dea29761dd74982ed60d34a00d8cd915b67",
  orchestrator:
    "sha256:7891302407658f2b263a0b51ece7b2e0b5d7909f76081680038e9b31746fb9eb",
  cleanupSource:
    "sha256:a41c901e1f2b5daee133a5ffd20b65730012c6c917e6c82c52315b92edfdaeb4",
  reconciliationSource:
    "sha256:ea0818c6f4522e8217825d53a563e3ee322978efe9c8e19477c6a33976bb26ca",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  control: "a1da27192c567823f9508ecd6f146f8667e1daac",
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
  authorityCommit: "3c50afe63e59115c39d2da2681699e531ec30c59",
  baselineSpend: 0.9174736385466531,
  finalSpend: 0.9174736385466531,
  incrementalSpend: 0,
  cap: 4,
});

const paths = Object.freeze({
  closure: resolve(liveRoot, "failed-attempt-32.json"),
  cleanup: resolve(liveRoot, "attempt32-cleanup-observation.json"),
  proposal: resolve(candidateRoot, "combined-live-proposal.json"),
  acceptance: resolve(candidateRoot, "acceptance.json"),
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
  throw new Error(`V207_ATTEMPT32_CLOSURE_INVALID:${code}`);
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
const hasItem = (value, predicate) =>
  Array.isArray(value) && value.some(predicate);
const firstDefined = (...values) => values.find((value) => value !== undefined);

const entries = await Promise.all(
  Object.entries(paths).map(async ([name, path]) => [name, await readFile(path)]),
);
const bytes = Object.fromEntries(entries);
for (const [name, hash] of Object.entries({
  closure: expected.closure,
  cleanup: expected.cleanup,
  proposal: expected.proposal,
  acceptance: expected.acceptance,
  authority: expected.authority,
  max1: expected.max1,
  max2: expected.max2,
})) {
  assert(sha256(bytes[name]) === hash, `${name.toUpperCase()}_HASH`);
}

const closure = parse(bytes.closure, "CLOSURE");
const cleanup = parse(bytes.cleanup, "CLEANUP");
const proposal = parse(bytes.proposal, "PROPOSAL");
const acceptance = parse(bytes.acceptance, "ACCEPTANCE");
const authority = parse(bytes.authority, "AUTHORITY");
const max1 = parse(bytes.max1, "MAX1");
const max2 = parse(bytes.max2, "MAX2");

assert(
  closure.schema_version === "videoforge.v2-07-live-failure/v1" &&
    closure.checkpoint === "V2-07" &&
    closure.task_id === "VF-10-07" &&
    closure.attempt === 32 &&
    closure.result === "NOT_QUALIFIED",
  "SCOPE",
);
assert(
    closure.proposal_sha256 === expected.proposal &&
    closure.authority_sha256 === expected.authority &&
    closure.authority_commit === expected.authorityCommit &&
    closure.authority_state ===
      "CONSUMED_SINGLE_BOUNDED_EXECUTION_DO_NOT_REUSE" &&
    closure.v2_08_authorized === false,
  "AUTHORITY_BINDING",
);

const raw = firstDefined(closure.raw_redacted_evidence, closure.raw_evidence, {});
assert(
  raw.live_result_path === "/tmp/videoforge-v207-live-result.json" &&
    raw.live_result_sha256 === expected.live &&
    raw.orchestrator_path === "/tmp/videoforge-v207-attempt32-orchestrator.json" &&
    raw.orchestrator_sha256 === expected.orchestrator &&
    raw.cleanup_path === "/tmp/videoforge-v207-attempt32-failed-cleanup.json" &&
    raw.cleanup_sha256 === expected.cleanupSource &&
    raw.reconciliation_path === "/tmp/videoforge-v207-attempt32-reconciliation.json" &&
    raw.reconciliation_sha256 === expected.reconciliationSource &&
    raw.secrets_or_raw_provider_ids_retained === false,
  "RAW_EVIDENCE",
);

const lineage = closure.lineage ?? {};
for (const [key, value] of Object.entries({
  model: expected.model,
  model_manifest_sha256: expected.manifest,
  image: expected.image,
  image_source_commit: expected.imageSource,
  control_source_commit: expected.control,
  mage_volume_id_sha256: expected.volume,
  volume_id_sha256: expected.volume,
  volume_size_gb: 50,
  region: "EU-RO-1",
  mount: "/runpod-volume",
  volume_mount: "/runpod-volume",
  model_root: "/runpod-volume/mage-model",
  gpu: "NVIDIA GeForce RTX 4090",
  flashboot: true,
  volume_write_policy: "APPLICATION_READ_ONLY",
  max1_definition_sha256: expected.max1,
  max2_definition_sha256: expected.max2,
})) {
  const actual =
    key === "volume_id_sha256"
      ? firstDefined(lineage.volume_id_sha256, lineage.mage_volume_id_sha256)
      : key === "mount" || key === "volume_mount"
        ? firstDefined(lineage.mount, lineage.volume_mount)
        : lineage[key];
  assert(actual === value, `LINEAGE_${key}`);
}
for (const key of ["image_config_sha256", "image_layer_sha256", "image_manifest_sha256", "image_base_sha256", "image_parent_config_sha256"]) {
  const expectedValue = {
    image_config_sha256: expected.imageConfig,
    image_layer_sha256: expected.imageLayer,
    image_manifest_sha256: expected.imageManifest,
    image_base_sha256: expected.imageBase,
    image_parent_config_sha256: expected.imageParentConfig,
  }[key];
  assert(lineage[key] === expectedValue, `LINEAGE_${key}`);
}

const acceptedBatches = firstDefined(
  closure.accepted_batches,
  closure.accepted_batch_summaries,
  closure.batches,
);
assert(Array.isArray(acceptedBatches) && acceptedBatches.length === 5, "BATCH_COUNT");
const expectedKinds = ["owned_probe", "cold", "warm", "reader_a", "reader_b"];
assert(
  acceptedBatches.map((batch) => batch.kind).join(",") === expectedKinds.join(","),
  "BATCH_ORDER",
);
for (const batch of acceptedBatches) {
  assert(
    batch.status === "COMPLETED" &&
      batch.item_count === 32 &&
      firstDefined(batch.durable_readback_count, batch.readbacks_count, batch.readbacks?.length) === 32 &&
      firstDefined(
        batch.replay_confirmed_receipt_count,
        batch.replay_confirmed_v3_receipt_count,
        batch.commit_receipt_count,
        batch.receipts_count,
        batch.commit_receipts?.length,
      ) === 32 &&
      true,
    `BATCH_${batch.kind}`,
  );
  const timings = firstDefined(batch.timings_ms, batch.timings);
  assert(
    timings &&
      Number.isFinite(timings.model_load ?? timings.model_load_ms) &&
      Number.isFinite(timings.warmup ?? timings.warmup_ms) &&
      Number.isFinite(timings.first_inference ?? timings.first_inference_ms) &&
      Number.isFinite(timings.upload ?? timings.upload_ms) &&
      Number.isFinite(timings.total ?? timings.total_ms),
    `TIMINGS_${batch.kind}`,
  );
  assert(Number.isFinite(batch.peak_vram_used_bytes), `VRAM_${batch.kind}`);
}
const totalOutputs = acceptedBatches.reduce(
  (sum, batch) => sum + firstDefined(batch.durable_readback_count, batch.readbacks_count, batch.readbacks?.length),
  0,
);
const totalReceipts = acceptedBatches.reduce(
  (sum, batch) =>
    sum +
    firstDefined(
      batch.replay_confirmed_receipt_count,
      batch.replay_confirmed_v3_receipt_count,
      batch.commit_receipt_count,
      batch.receipts_count,
      batch.commit_receipts?.length,
    ),
  0,
);
assert(totalOutputs === 160 && totalReceipts === 160, "TOTAL_DURABLE_OUTPUTS");

const duplicate = firstDefined(closure.duplicate_delivery, closure.duplicateDelivery, {});
assert(
  duplicate.same_job === true &&
    firstDefined(duplicate.no_new_provider_dispatch, duplicate.second_provider_dispatch === false ? true : undefined) === true &&
    duplicate.duplicate_compute === false,
  "DUPLICATE_DELIVERY",
);
const readers = firstDefined(closure.concurrent_reader_proof, closure.concurrent_readers, {});
assert(
  readers.workers_max === 2 &&
    firstDefined(readers.two_jobs_dispatched, readers.jobs_dispatched === 2 ? true : undefined) === true &&
    firstDefined(readers.both_provider_terminal_completed, readers.both_terminal_completed) === true &&
    firstDefined(readers.accepted_reader_batch_count, readers.accepted_batches) === 2 &&
    firstDefined(
      readers.durable_reader_readback_count,
      readers.durable_readback_count,
      readers.accepted_reader_item_count,
      readers.reader_a_durable_readback_count + readers.reader_b_durable_readback_count,
    ) === 64,
  "CONCURRENT_READERS",
);

const failure = firstDefined(closure.failure, closure.stop, {});
assert(
  firstDefined(closure.stop_code, failure.error, closure.error) ===
      "RUNPOD_CONCURRENT_READER_DRAIN_UNCERTAIN" &&
    ["cleanup_drain_uncertain", "cleanup_reconciliation", "reconciliation"].includes(
      firstDefined(closure.failure_category, failure.category),
    ),
  "STOP_CONDITION",
);
const unreached = firstDefined(closure.unreached_live_proofs, closure.unreached_proofs, {});
assert(
  firstDefined(unreached.cancellation, closure.cancel_timeout_proof?.cancellation) === true &&
    firstDefined(unreached.timeout, closure.cancel_timeout_proof?.timeout) === true,
  "CANCEL_TIMEOUT_UNPROVEN",
);
const sealed = firstDefined(closure.sealed_volume, closure.sealed_manifest, {});
assert(
  firstDefined(sealed.manifest_unchanged, sealed.manifest_before_after_equal) === true &&
    firstDefined(sealed.model_volume_writes_observed, sealed.model_volume_writes) === false &&
    firstDefined(sealed.runtime_download_or_quantization_observed, sealed.runtime_download_or_quantization) === false &&
    firstDefined(sealed.cache_escape_observed, sealed.cache_escape) === false,
  "SEALED_VOLUME",
);

assert(
  cleanup.schema_version === "videoforge.v2-07-attempt32-cleanup-observation/v1" &&
    cleanup.checkpoint === "V2-07" &&
    cleanup.task_id === "VF-10-07" &&
    cleanup.attempt === 32 &&
    cleanup.proposal_sha256 === expected.proposal &&
    cleanup.authority_sha256 === expected.authority &&
    cleanup.raw_redacted_evidence?.live_result_sha256 === expected.live &&
    cleanup.raw_redacted_evidence?.orchestrator_sha256 === expected.orchestrator &&
    cleanup.raw_redacted_evidence?.cleanup_sha256 === expected.cleanupSource &&
    cleanup.raw_redacted_evidence?.reconciliation_sha256 === expected.reconciliationSource &&
    cleanup.cleanup?.stable_terminal_snapshot_count === 2 &&
    cleanup.cleanup?.endpoint_worker_record_count === 5 &&
    cleanup.cleanup?.terminal_pod_record_count === 5 &&
    cleanup.cleanup?.endpoint_deleted === true &&
    cleanup.cleanup?.template_deleted === true &&
    cleanup.cleanup?.final_disposable_resources_absent === true &&
    cleanup.cleanup?.network_volume_delete_called === false &&
    cleanup.cleanup?.owned_jobs_cancelled === false,
  "CLEANUP_OBSERVATION",
);

const finalReconciliation = firstDefined(
  closure.final_reconciliation,
  closure.reconciliation,
  cleanup.final_reconciliation,
);
assert(
  finalReconciliation?.read_interval_seconds === 10 &&
    finalReconciliation?.provider_mutations_after_cleanup === 0 &&
    finalReconciliation?.gpu_jobs_submitted_during_reconciliation === 0,
  "RECONCILIATION_SIDE_EFFECTS",
);
assert(
  finalReconciliation?.stable_read_count === 3 &&
    finalReconciliation?.pods === 0 &&
    finalReconciliation?.endpoints === 0 &&
    finalReconciliation?.private_templates === 0 &&
    finalReconciliation?.active_serverless_workers === 0 &&
    finalReconciliation?.running_pods === 0 &&
    finalReconciliation?.retained_volume_count === 2 &&
    hasItem(
      finalReconciliation.retained_volumes,
      (volume) =>
        firstDefined(volume.id_sha256, volume.idHash) === expected.volume &&
        firstDefined(volume.size_gb, volume.sizeGb) === 50 &&
        firstDefined(volume.region, volume.dataCenterId) === "EU-RO-1",
    ) &&
    hasItem(
      finalReconciliation.retained_volumes,
      (volume) =>
        firstDefined(volume.id_sha256, volume.idHash) === expected.soulxVolume &&
        firstDefined(volume.size_gb, volume.sizeGb) === 50 &&
        firstDefined(volume.region, volume.dataCenterId) === "EU-RO-1",
    ),
  "FINAL_RECONCILIATION",
);
const billing = firstDefined(closure.billing, cleanup.billing, finalReconciliation.billing, {});
assert(
  billing.baseline_endpoint_spend_usd === expected.baselineSpend &&
    billing.final_endpoint_spend_usd === expected.finalSpend &&
    billing.incremental_spend_usd === expected.incrementalSpend &&
    billing.maximum_cumulative_finite_spend_usd === expected.cap &&
    billing.within_approved_cap === true &&
    billing.settlement === "THREE_STABLE_READS",
  "BILLING",
);
assert(
  closure.cleanup?.disposable_endpoint_deleted === true &&
    closure.cleanup?.disposable_template_deleted === true &&
    closure.cleanup?.final_disposable_resources_absent === true &&
    closure.cleanup?.active_workers === 0 &&
    closure.cleanup?.running_pods === 0 &&
    closure.cleanup?.signer_secret_deleted === true &&
    closure.cleanup?.worker_version_rolled_back === true &&
    closure.cleanup?.route_restored === true &&
    closure.cleanup?.generated_output_rollback === "CONFIRMED" &&
    cleanup.cloudflare_cleanup?.signer_secret_deleted === true &&
    cleanup.cloudflare_cleanup?.worker_version_rolled_back === true &&
    cleanup.cloudflare_cleanup?.pre_mutation_route_restored === true &&
    cleanup.cloudflare_cleanup?.restored_route_status === 404 &&
    cleanup.cloudflare_cleanup?.restored_route_code === "V207_ROUTE_DISABLED" &&
    cleanup.retention?.sealed_mage_volume_retained === true &&
    cleanup.retention?.soulx_volume_retained === true &&
    cleanup.retention?.volume_mutation_called === false &&
    cleanup.secrets_or_raw_provider_ids_retained === false,
  "ROLLBACK_RETENTION",
);
const runtime = closure.runtime_contract ?? {};
assert(
  runtime.offline_sealed_manifest_verification === true &&
    runtime.real_initialization_warmup === true &&
    runtime.application_read_only_model_files === true &&
    runtime.job_local_scratch === "/tmp/videoforge-v2-07/${job_id}" &&
    runtime.scoped_r2_output_ports === true &&
    runtime.durable_per_unit_resume === true &&
    runtime.runtime_download_or_quantization === false &&
    runtime.cache_escape_forbidden === true &&
    runtime.finalize_retry_attempts === 3 &&
    runtime.finalize_timeout_seconds === 30 &&
    runtime.finalize_only_retry === true &&
    runtime.provider_response_body_url_ids_or_secrets_retained === false,
  "RUNTIME_CONTRACT",
);
assert(
  closure.batch_totals?.complete_batches === 5 &&
    closure.batch_totals?.item_count === 160 &&
    closure.batch_totals?.durable_readback_count === 160 &&
    closure.batch_totals?.replay_confirmed_v3_receipt_count === 160 &&
    closure.batch_totals?.all_outputs_durable_before_provider_expiry === true,
  "BATCH_TOTALS",
);
assert(
  failure.error === "RUNPOD_CONCURRENT_READER_DRAIN_UNCERTAIN" &&
    failure.category === "cleanup_reconciliation" &&
    failure.stage === "reader-terminal" &&
    failure.code === "V207_RECONCILIATION_INVENTORY_MISMATCH" &&
    failure.stop_condition_obeyed === true &&
    failure.no_retry_or_duplicate_compute === true &&
    failure.generated_output_rollback === "CONFIRMED" &&
    failure.reader_drain_uncertain === true &&
    failure.cleanup_drain_uncertain === true,
  "FAILURE_RECORD",
);
assert(
  typeof closure.next_boundary === "string" &&
    closure.next_boundary.includes("fresh exact approval") &&
    closure.next_boundary.includes("fresh positive numeric"),
  "NEXT_BOUNDARY",
);

assert(
  authority.attempt === 32 &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.approval?.exact_proposal_approved === true &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.minimum_approved_availability === "LOW" &&
    authority.approval?.maximum_cumulative_finite_spend_usd === expected.cap &&
    authority.approval?.fresh_numeric_cap === true &&
    authority.execution_boundary?.maximum_cumulative_finite_spend_usd === expected.cap &&
    authority.execution_boundary?.v2_08_authorized === false,
  "AUTHORITY_RECORD",
);
const authorityLineage = authority.lineage ?? {};
assert(
  authorityLineage.control_source_commit === expected.control &&
    authorityLineage.image === expected.image &&
    authorityLineage.image_source_commit === expected.imageSource &&
    authorityLineage.image_config_sha256 === expected.imageConfig &&
    authorityLineage.image_layer_sha256 === expected.imageLayer &&
    authorityLineage.image_parent_sha256 === expected.imageBase &&
    authorityLineage.image_parent_config_sha256 === expected.imageParentConfig &&
    authorityLineage.model === expected.model &&
    authorityLineage.model_manifest_sha256 === expected.manifest &&
    authorityLineage.volume_id_sha256 === expected.volume &&
    authorityLineage.volume_size_gb === 50 &&
    authorityLineage.volume_region === "EU-RO-1" &&
    authorityLineage.volume_mount === "/runpod-volume" &&
    authorityLineage.model_root === "/runpod-volume/mage-model" &&
    authorityLineage.initial_config_sha256 === expected.max1 &&
    authorityLineage.concurrent_reader_config_sha256 === expected.max2,
  "AUTHORITY_LINEAGE",
);
assert(
  authority.staged_endpoint_configs?.length === 2 &&
    authority.staged_endpoint_configs[0]?.definition_sha256 === expected.max1 &&
    authority.staged_endpoint_configs[0]?.workers_min === 0 &&
    authority.staged_endpoint_configs[0]?.workers_max === 1 &&
    authority.staged_endpoint_configs[0]?.gpu === "NVIDIA GeForce RTX 4090" &&
    authority.staged_endpoint_configs[0]?.compute_type === "GPU" &&
    authority.staged_endpoint_configs[0]?.flex_only === true &&
    authority.staged_endpoint_configs[0]?.flashboot === true &&
    authority.staged_endpoint_configs[0]?.region === "EU-RO-1" &&
    authority.staged_endpoint_configs[1]?.definition_sha256 === expected.max2 &&
    authority.staged_endpoint_configs[1]?.workers_min === 0 &&
    authority.staged_endpoint_configs[1]?.workers_max === 2 &&
    authority.staged_endpoint_configs[1]?.gpu === "NVIDIA GeForce RTX 4090" &&
    authority.staged_endpoint_configs[1]?.compute_type === "GPU" &&
    authority.staged_endpoint_configs[1]?.flex_only === true &&
    authority.staged_endpoint_configs[1]?.flashboot === true &&
    authority.staged_endpoint_configs[1]?.region === "EU-RO-1",
  "AUTHORITY_STAGED_CONFIGS",
);
assert(
  proposal.attempt === 32 &&
    proposal.lineage?.final_image === expected.image &&
    proposal.lineage?.model === expected.model &&
    proposal.lineage?.model_manifest_sha256 === expected.manifest &&
    proposal.lineage?.volume_id_sha256 === expected.volume &&
    proposal.lineage?.volume_size_gb === 50 &&
    proposal.lineage?.volume_region === "EU-RO-1" &&
    proposal.lineage?.volume_mount === "/runpod-volume" &&
    proposal.lineage?.model_root === "/runpod-volume/mage-model" &&
    proposal.lineage?.image_config_sha256 === expected.imageConfig &&
    proposal.lineage?.image_layer_sha256 === expected.imageLayer &&
    proposal.lineage?.image_manifest_sha256 === expected.imageManifest &&
    proposal.lineage?.image_base_sha256 === expected.imageBase &&
    proposal.lineage?.image_parent_config_sha256 === expected.imageParentConfig,
  "PROPOSAL_LINEAGE",
);
for (const [name, config, workersMax, hash] of [
  ["MAX1", max1, 1, expected.max1],
  ["MAX2", max2, 2, expected.max2],
]) {
  const gpuCount = config.gpu_count ?? config.gpu_count_per_worker;
  assert(
    sha256(bytes[name.toLowerCase()]) === hash &&
      config.image === expected.image &&
      config.control_source_commit === expected.control &&
      config.network_volume_id_sha256 === expected.volume &&
      config.network_volume_mount === "/runpod-volume" &&
      config.model_root === "/runpod-volume/mage-model" &&
      config.network_volume_size_gb === 50 &&
      config.network_volume_region === "EU-RO-1" &&
      config.gpu_type_ids?.length === 1 &&
      config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" &&
      gpuCount === 1 &&
      config.compute_type === "GPU" &&
      config.flex_only === true &&
      config.workers_min === 0 &&
      config.workers_max === workersMax &&
      config.flashboot === true &&
      config.volume_write_policy === "APPLICATION_READ_ONLY",
    `${name}_CONFIG`,
  );
}

assert(
  acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.max1_sha256 === expected.max1 &&
    acceptance.candidate?.max2_sha256 === expected.max2 &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === null &&
    acceptance.provider_boundary?.provider_calls === false &&
    acceptance.provider_boundary?.gpu_use === false,
  "ACCEPTANCE_BINDING",
);

const contextText = [bytes.state, bytes.gates, bytes.task, bytes.start]
  .map((value) => value.toString("utf8"))
  .join("\n");
for (const value of [
  expected.proposal,
  expected.authority,
  expected.closure,
  expected.cleanup,
  "failed-attempt-32.json",
  "attempt32-cleanup-observation.json",
  "RUNPOD_CONCURRENT_READER_DRAIN_UNCERTAIN",
  "NOT_QUALIFIED",
  "V2-08",
]) {
  assert(contextText.includes(value), `CONTEXT_${value.replaceAll(/[^A-Za-z0-9]+/gu, "_")}`);
}

process.stdout.write(
  `V2-07 Attempt32 closure validation PASS (160 durable outputs; settled finite spend $${expected.incrementalSpend})\n`,
);
