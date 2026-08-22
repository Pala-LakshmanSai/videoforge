import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt32-finalize-response-diagnostics-candidate",
);
const expected = Object.freeze({
  proposal: "sha256:7c5370668ae06487729775f082cd981164d3e4a1634f20a77beb08bba2ea6b6a",
  acceptance: "sha256:7ed0bd6c9d064133e9409b79be099184a4b80444d4da66759fa47082d7a66080",
  max1: "sha256:2663f06af19ceb11470e0ddac86ac74dae00d25a7b128970376dca2a3d1343d2",
  max2: "sha256:969816bd9546a81d08f1b725480ad17839d6bd067451ed3074dac3a102cc9e7a",
  control: "a1da27192c567823f9508ecd6f146f8667e1daac",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  closure: "sha256:76c9dec453b5670c0dff73c1857cbbb5e9b43a460599c81a24455404f634c490",
  cleanup: "sha256:61185a893499ab0634458fe472af21cb47385923e2fd05af60658ec97d1f54bc",
  authority: "sha256:a2f2519e6cc5f00ec804adea07b431d155e9fc88a566d7f9ef05396beca99114",
});

const sha256 = (bytes) => "sha256:" + createHash("sha256").update(bytes).digest("hex");
const assert = (condition, code) => {
  if (!condition) throw new Error(`V207_ATTEMPT32_CANDIDATE_INVALID:${code}`);
};
const read = async (path) => readFile(resolve(root, path));
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`V207_ATTEMPT32_CANDIDATE_INVALID:${code}_JSON`);
  }
};

const [proposalBytes, max1Bytes, max2Bytes, acceptanceBytes, stateBytes, gatesBytes, startBytes, taskBytes, activationBytes] =
  await Promise.all([
    readFile(resolve(candidate, "combined-live-proposal.json")),
    readFile(resolve(candidate, "staged-config-max1.json")),
    readFile(resolve(candidate, "staged-config-max2.json")),
    readFile(resolve(candidate, "acceptance.json")),
    read("project-context/CURRENT_STATE.yaml"),
    read("project-context/GATES.yaml"),
    read("project-context/00_START_HERE.md"),
    read("project-context/tasks/VF-10-07.md"),
    read("apps/web/src/server/providers/v207-activation-authority.ts"),
  ]);

assert(sha256(proposalBytes) === expected.proposal, "PROPOSAL_HASH");
assert(sha256(max1Bytes) === expected.max1, "MAX1_HASH");
assert(sha256(max2Bytes) === expected.max2, "MAX2_HASH");
assert(sha256(acceptanceBytes) === expected.acceptance, "ACCEPTANCE_HASH");

const proposal = parse(proposalBytes, "PROPOSAL");
const acceptance = parse(acceptanceBytes, "ACCEPTANCE");
const configs = [parse(max1Bytes, "MAX1"), parse(max2Bytes, "MAX2")];
assert(proposal.attempt === 32 && proposal.status.includes("PROVIDER_FREE"), "ATTEMPT_STATUS");
assert(proposal.user_approval?.exact_proposal_approved === false, "APPROVAL_FALSE");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "CAP_NULL");
assert(proposal.provider_mutation === false && proposal.gpu_use === false && proposal.spend_usd === 0, "PROVIDER_BOUNDARY");
assert(proposal.lineage?.control_source_commit === expected.control, "CONTROL");
assert(proposal.lineage?.final_image === expected.image, "IMAGE");
assert(proposal.lineage?.model === expected.model && proposal.lineage?.model_manifest_sha256 === expected.manifest, "MODEL");
assert(proposal.lineage?.volume_id_sha256 === expected.volume, "VOLUME");
assert(proposal.lineage?.volume_mount === "/runpod-volume" && proposal.lineage?.model_root === "/runpod-volume/mage-model", "MOUNT");
assert(proposal.lineage?.volume_size_gb === 50 && proposal.lineage?.volume_region === "EU-RO-1", "VOLUME_IDENTITY");
assert(proposal.lineage?.runtime_execution_contract?.sealed_manifest_verification === "OFFLINE_EXACT_SHA256_BEFORE_MODEL_LOAD_AND_AFTER_FINAL_DRAIN", "SEALED_MANIFEST");
assert(proposal.lineage?.runtime_execution_contract?.real_initialization_warmup_required === true, "REAL_WARMUP");
assert(proposal.lineage?.runtime_execution_contract?.job_local_scratch === "/tmp/videoforge-v2-07/${job_id}", "JOB_SCRATCH");
assert(proposal.lineage?.runtime_execution_contract?.scoped_r2_output_ports?.startsWith("EXACT_PER_JOB_PER_UNIT"), "SCOPED_R2");
assert(proposal.lineage?.runtime_execution_contract?.durable_per_unit_resume?.includes("NEVER_REGENERATE_ACCEPTED_UNITS"), "UNIT_RESUME");
assert(proposal.lineage?.prior_closure_evidence_sha256 === expected.closure, "CLOSURE_LINEAGE");
assert(proposal.lineage?.prior_cleanup_evidence_sha256 === expected.cleanup, "CLEANUP_LINEAGE");
assert(proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1, "PROPOSAL_MAX1");
assert(proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2, "PROPOSAL_MAX2");
assert(proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "RATE");
assert(proposal.rates_cost_and_retention?.estimated_finite_serverless_compute_usd_ceiling === 2.2, "ESTIMATE");
assert(proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "RETENTION_RATE");

for (const [index, config] of configs.entries()) {
  assert(config.control_source_commit === expected.control, `CONFIG${index + 1}_CONTROL`);
  assert(config.image === expected.image, `CONFIG${index + 1}_IMAGE`);
  assert(config.network_volume_id_sha256 === expected.volume, `CONFIG${index + 1}_VOLUME`);
  assert(config.network_volume_mount === "/runpod-volume" && config.model_root === "/runpod-volume/mage-model", `CONFIG${index + 1}_MOUNT`);
  assert(config.network_volume_size_gb === 50 && config.network_volume_region === "EU-RO-1", `CONFIG${index + 1}_REGION`);
  assert(config.gpu_type_ids?.length === 1 && config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090", `CONFIG${index + 1}_GPU`);
  const gpuCount = index === 0 ? config.gpu_count : config.gpu_count_per_worker;
  assert(config.compute_type === "GPU" && config.flex_only === true && gpuCount === 1, `CONFIG${index + 1}_COMPUTE`);
  assert(config.workers_min === 0 && config.workers_max === index + 1 && config.flashboot === true, `CONFIG${index + 1}_WORKERS`);
  assert(config.volume_write_policy === "APPLICATION_READ_ONLY", `CONFIG${index + 1}_READ_ONLY`);
  assert(config.runtime_execution_contract?.sealed_manifest_verification === "OFFLINE_EXACT_SHA256_BEFORE_MODEL_LOAD_AND_AFTER_FINAL_DRAIN", `CONFIG${index + 1}_MANIFEST`);
  assert(config.runtime_execution_contract?.real_initialization_warmup_required === true, `CONFIG${index + 1}_WARMUP`);
  assert(config.runtime_execution_contract?.job_local_scratch === "/tmp/videoforge-v2-07/${job_id}", `CONFIG${index + 1}_SCRATCH`);
  assert(config.runtime_execution_contract?.runtime_download_or_quantization === false && config.runtime_execution_contract?.cache_escape_forbidden === true, `CONFIG${index + 1}_OFFLINE`);
  assert(config.finalize_response_diagnostics?.request_timeout_seconds === 30, `CONFIG${index + 1}_TIMEOUT`);
  assert(config.finalize_response_diagnostics?.max_attempts === 3, `CONFIG${index + 1}_ATTEMPTS`);
  assert(config.finalize_response_diagnostics?.retryable_operation_only === "FINALIZE", `CONFIG${index + 1}_RETRY_SCOPE`);
  assert(config.finalize_response_diagnostics?.body_retained === false, `CONFIG${index + 1}_BODY`);
  assert(config.finalize_response_diagnostics?.url_retained === false, `CONFIG${index + 1}_URL`);
  assert(config.finalize_response_diagnostics?.provider_ids_retained === false, `CONFIG${index + 1}_IDS`);
  assert(config.finalize_response_diagnostics?.secrets_retained === false, `CONFIG${index + 1}_SECRETS`);
}

assert(acceptance.candidate?.proposal_sha256 === expected.proposal, "ACCEPTANCE_PROPOSAL");
assert(acceptance.candidate?.max1_sha256 === expected.max1 && acceptance.candidate?.max2_sha256 === expected.max2, "ACCEPTANCE_CONFIGS");
assert(acceptance.candidate?.authority_path === null && acceptance.candidate?.authority_sha256 === null, "ACCEPTANCE_AUTHORITY_NULL");
assert(acceptance.candidate?.maximum_cumulative_finite_spend_usd === null, "ACCEPTANCE_CAP_NULL");
assert(acceptance.provider_boundary?.provider_calls === false && acceptance.provider_boundary?.gpu_use === false, "ACCEPTANCE_BOUNDARY");
assert(acceptance.candidate?.runtime_execution_contract?.success_measurements?.includes("init_load_warmup_inference_upload_total_ttl"), "ACCEPTANCE_MEASUREMENTS");
assert(proposal.cleanup_rollback_and_stop_conditions?.success?.some((item) => item.includes("settled spend baseline versus final across three stable reads")), "SUCCESS_SETTLED_COST");

const joinedContext = [stateBytes, gatesBytes, startBytes, taskBytes].map(String).join("\n");
for (const value of [expected.proposal, expected.acceptance, expected.max1, expected.max2, expected.control]) {
  assert(joinedContext.includes(value), `CONTEXT_${value.slice(-8)}`);
}
assert(String(stateBytes).includes("pending_v2_07_attempt32_proposal"), "STATE_ATTEMPT32");
assert(
  String(gatesBytes).includes("authority_mode: attempt32_bounded_mutation_authorized") ||
    String(gatesBytes).includes("authority_mode: attempt32_consumed_closed") ||
    String(gatesBytes).includes(
      "authority_mode: attempt33_provider_free_awaiting_fresh_exact_approval_and_positive_cap",
    ) ||
    String(gatesBytes).includes("authority_mode: attempt33_bounded_mutation_authorized") ||
    String(gatesBytes).includes("authority_mode: no_live_authority_attempt34_provider_free_candidate") ||
    String(gatesBytes).includes("authority_mode: exact_attempt34_single_use_authority_active") ||
    String(gatesBytes).includes("authority_mode: no_live_authority_attempt35_provider_free_candidate"),
  "GATE_AUTHORITY_LIFECYCLE",
);
assert(String(activationBytes).includes(expected.proposal), "ACTIVATION_HISTORICAL_PROPOSAL");
assert(
  String(activationBytes).includes(expected.control) ||
    String(activationBytes).includes("bbc3e40b8519ebee8d6ccdaaf29e1ede6215ac37") ||
    String(activationBytes).includes("96f5e16cf03be7e31049478ce7f6b0c134a8108c"),
  "ACTIVATION_CONTROL_LIFECYCLE",
);
assert(
  String(activationBytes).includes("V207_APPROVED_FINITE_CAP_USD = 4 as const") ||
    String(activationBytes).includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"),
  "ACTIVATION_CAP_LIFECYCLE",
);
assert(String(activationBytes).includes(expected.authority), "ACTIVATION_AUTHORITY");

const requiredNegatives = [
  "wrong bytes",
  "path",
  "volume",
  "GPU",
  "region",
  "write",
  "cache escape",
  "malformed authority",
  "duplicate delivery",
  "cancel",
  "timeout",
  "two readers",
  "body",
  "URL",
  "secret",
];
const negativeText = JSON.stringify([proposal.negative_tests_required, proposal.cleanup_rollback_and_stop_conditions, configs.map((item) => item.negative_contracts)]);
for (const value of requiredNegatives) assert(negativeText.toLowerCase().includes(value.toLowerCase()), `NEGATIVE_${value.replaceAll(" ", "_")}`);

process.stdout.write(`V2-07 Attempt32 candidate validation PASS (${expected.proposal})\n`);
