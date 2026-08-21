import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt27-hosted-png-crc32-repair-candidate",
);
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  authority: resolve(candidate, "approved-authority.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  closure: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-26.json",
  ),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  outputPort: resolve(root, "apps/web/src/server/hosted/v207-output-ports.ts"),
  outputPortTest: resolve(root, "apps/web/src/server/hosted/v207-output-ports.test.ts"),
};
const EXPECTED = {
  proposal: "sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae",
  authority: "sha256:3bf923fb59df2ab0a0ff648ad8773ed549b2296aba66e82db9635c9fa7b66b10",
  max1: "sha256:07749793fe28e158bad4314dbec128c30c6dcb3df52e7912837ec6dd10e27372",
  max2: "sha256:1673a27538aef7796a364e125e812c26dc22c2c9a2b7c7671f615fa5af603a25",
  closure: "sha256:f2839fefaafbe507ce447a4e374d502a971e75653b466f6703caa1a1f8e7c9ec",
  priorProposal: "sha256:0112b0b72254ef286643fc63bee0176fce327edc401ce40de4a3a860a5e68632",
  priorAuthority: "sha256:bad94e64eab6fcbc03edf6521f02159ddb2f1c49407a6ca30dfc027fecad2d05",
  hostedRepair: "1960ea9307bb7fcb591c842b84fc1c622aec49eb",
  runpodControl: "b8666dd8b8bc12578ffae8925f6ce73dbf53a841",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageManifest: "sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
  imageConfig: "sha256:8e11a42cb91fa1d0d6a4e19fc6b4a6cfd5f77116c49a8516b6435813dfaab1de",
  imageLayer: "sha256:befafc2ec3d32a73b632f769069c9c02645d3fac049ebd2478fbf8ad3d5cdf38",
  imageBase: "sha256:8a5b8f453c694b2eeee097e3d958b08c5e47c15290b5cdc17a4fb7e5e3e4f497",
  parentConfig: "sha256:de5c854ae5aa9e611e218b89d29a250eb03a0a316f0ac92d584d53a038d06ff2",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
};
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const sameJson = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = (label) => {
  throw new Error(`V207_ATTEMPT27_HOSTED_PNG_CRC32_PROPOSAL_INVALID:${label}`);
};
const assert = (condition, label) => {
  if (!condition) fail(label);
};
const parse = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label}_json`);
  }
};

const [
  proposalBytes,
  authorityBytes,
  max1Bytes,
  max2Bytes,
  closureBytes,
  stateBytes,
  gatesBytes,
  taskBytes,
  startBytes,
  activationBytes,
  outputPortBytes,
  outputPortTestBytes,
] = await Promise.all(Object.values(paths).map((path) => readFile(path)));
for (const [label, bytes, expected] of [
  ["proposal", proposalBytes, EXPECTED.proposal],
  ["authority", authorityBytes, EXPECTED.authority],
  ["max1", max1Bytes, EXPECTED.max1],
  ["max2", max2Bytes, EXPECTED.max2],
  ["closure", closureBytes, EXPECTED.closure],
]) {
  assert(hash(bytes) === expected, `${label}_hash`);
}

const proposal = parse(proposalBytes, "proposal");
const authority = parse(authorityBytes, "authority");
const max1 = parse(max1Bytes, "max1");
const max2 = parse(max2Bytes, "max2");
const closure = parse(closureBytes, "closure");
const state = stateBytes.toString("utf8");
const gates = gatesBytes.toString("utf8");
const task = taskBytes.toString("utf8");
const start = startBytes.toString("utf8");
const activation = activationBytes.toString("utf8");
const outputPort = outputPortBytes.toString("utf8");
const outputPortTest = outputPortTestBytes.toString("utf8");

assert(
  proposal.schema_version ===
    "videoforge.v2-07-attempt27-hosted-png-crc32-repair-combined-live-proposal/v1" &&
    proposal.checkpoint === "V2-07" &&
    proposal.task_id === "VF-10-07" &&
    proposal.attempt === 27,
  "proposal_scope",
);
assert(
  proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.provider_mutation === false &&
    proposal.publication === false &&
    proposal.gpu_use === false &&
    proposal.spend_usd === 0,
  "provider_free_boundary",
);
assert(
  proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval?.fresh_numeric_cap_required === true &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.user_approval?.minimum_approved_availability_requested === "LOW" &&
    proposal.user_approval?.flashboot_true_requested === true &&
    proposal.user_approval?.provider_mutation_or_gpu_use_authorized === false,
  "approval_boundary",
);

const lineage = proposal.lineage;
assert(
  lineage?.final_image === EXPECTED.image &&
    lineage?.image_source_commit === EXPECTED.imageSource &&
    lineage?.image_config_sha256 === EXPECTED.imageConfig &&
    lineage?.image_layer_sha256 === EXPECTED.imageLayer &&
    lineage?.image_base_sha256 === EXPECTED.imageBase &&
    lineage?.image_parent_config_sha256 === EXPECTED.parentConfig,
  "image_lineage",
);
assert(
  lineage?.model === EXPECTED.model &&
    lineage?.model_manifest_sha256 === EXPECTED.manifest &&
    lineage?.volume_id_sha256 === EXPECTED.volume &&
    lineage?.volume_size_gb === 50 &&
    lineage?.volume_region === "EU-RO-1" &&
    lineage?.volume_mount === "/runpod-volume" &&
    lineage?.model_root === "/runpod-volume/mage-model" &&
    lineage?.volume_write_policy === "APPLICATION_READ_ONLY",
  "model_volume_lineage",
);
assert(
  lineage?.control_source_commit === EXPECTED.runpodControl &&
    lineage?.finalize_transport_repair_commit === EXPECTED.runpodControl &&
    lineage?.hosted_png_crc32_repair_commit === EXPECTED.hostedRepair &&
    lineage?.failed_attempt_evidence_sha256 === EXPECTED.closure &&
    lineage?.prior_proposal_sha256 === EXPECTED.priorProposal &&
    lineage?.prior_authority_sha256 === EXPECTED.priorAuthority &&
    lineage?.prior_authority_state === "CLOSED_EXACT_ATTEMPT26_CONSUMED_DO_NOT_REUSE",
  "attempt26_lineage",
);

const repair = proposal.hosted_png_crc32_repair;
assert(
  repair?.commit === EXPECTED.hostedRepair &&
    repair?.commit_full === EXPECTED.hostedRepair &&
    repair?.algorithm === "IEEE_CRC32_0xEDB88320" &&
    repair?.implementation === "256-entry lookup table replacing bit-at-a-time per-byte CRC loop" &&
    repair?.scope === "hosted generated-output FINALIZE PNG chunk validation only" &&
    repair?.local_proof?.realistic_dimensions === "1280x720" &&
    repair?.local_proof?.bounded_probe_ms === 3000 &&
    repair?.no_image_republication === true &&
    repair?.no_model_or_volume_mutation === true,
  "hosted_repair",
);
assert(
  outputPort.includes("const PNG_CRC32_TABLE = new Uint32Array(256)") &&
    outputPort.includes("crc = (crc >>> 8) ^ PNG_CRC32_TABLE[(crc ^ byte) & 0xff]!") &&
    !outputPort.includes("for (let bit = 0; bit < 8; bit += 1) {\n      crc =") &&
    outputPortTest.includes("123456789") &&
    outputPortTest.includes("realistic high-entropy 1280x720 PNG within the bounded probe time") &&
    outputPortTest.includes("expect(elapsedMs).toBeLessThan(3_000)"),
  "repair_source_and_test",
);

for (const [label, config, expectedHash, workersMax] of [
  ["max1", max1, EXPECTED.max1, 1],
  ["max2", max2, EXPECTED.max2, 2],
]) {
  assert(
    config.schema_version === "videoforge.v2-07-staged-endpoint-definition/v6" &&
      config.image === EXPECTED.image &&
      config.image_source_commit === EXPECTED.imageSource &&
      config.control_source_commit === EXPECTED.runpodControl &&
      config.finalize_transport_repair_commit === EXPECTED.runpodControl &&
      config.hosted_png_crc32_repair_commit === EXPECTED.hostedRepair,
    `${label}_lineage`,
  );
  assert(
    config.region === "EU-RO-1" &&
      config.network_volume_id_sha256 === EXPECTED.volume &&
      config.network_volume_size_gb === 50 &&
      config.network_volume_region === "EU-RO-1" &&
      config.network_volume_mount === "/runpod-volume" &&
      config.model_root === "/runpod-volume/mage-model" &&
      config.volume_write_policy === "APPLICATION_READ_ONLY",
    `${label}_volume`,
  );
  assert(
    config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090" &&
      (config.gpu_count === 1 || config.gpu_count_per_worker === 1) &&
      config.compute_type === "GPU" &&
      config.flex_only === true &&
      config.workers_min === 0 &&
      config.workers_max === workersMax &&
      config.flashboot === true &&
      config.scaler_type === "REQUEST_COUNT" &&
      config.scaler_value === 1 &&
      config.handler_concurrency === 1 &&
      config.idle_timeout_seconds === 5 &&
      config.init_timeout_seconds === 800 &&
      config.execution_timeout_seconds === 2400,
    `${label}_gpu_workers`,
  );
  const stage = proposal.staged_endpoint_configs?.find(
    (item) => item.definition_path === `staged-config-${label}.json`,
  );
  assert(
    stage?.definition_sha256 === expectedHash &&
      stage?.workers_min === 0 &&
      stage?.workers_max === workersMax &&
      stage?.gpu === "NVIDIA GeForce RTX 4090" &&
      stage?.compute_type === "GPU" &&
      stage?.flex_only === true &&
      stage?.flashboot === true &&
      stage?.control_source_commit === EXPECTED.runpodControl &&
      stage?.hosted_png_crc32_repair_commit === EXPECTED.hostedRepair,
    `${label}_proposal_binding`,
  );
  const authorityStage = authority.staged_endpoint_configs?.find(
    (item) => item.definition_path === `staged-config-${label}.json`,
  );
  assert(
    authorityStage?.stage ===
      (workersMax === 1 ? "initial_qualification" : "bounded_concurrent_reader_proof_only") &&
      authorityStage?.definition_sha256 === expectedHash &&
      authorityStage?.path === `staged-config-${label}.json` &&
      authorityStage?.sha256 === expectedHash &&
      authorityStage?.workers_min === 0 &&
      authorityStage?.workers_max === workersMax &&
      authorityStage?.gpu === "NVIDIA GeForce RTX 4090" &&
      (authorityStage?.gpu_count === 1 || authorityStage?.gpu_count_per_worker === 1) &&
      authorityStage?.compute_type === "GPU" &&
      authorityStage?.flex_only === true &&
      authorityStage?.flashboot === true &&
      authorityStage?.control_source_commit === EXPECTED.runpodControl &&
      authorityStage?.region === "EU-RO-1" &&
      authorityStage?.volume_id_sha256 === EXPECTED.volume &&
      authorityStage?.volume_mount === "/runpod-volume" &&
      authorityStage?.model_root === "/runpod-volume/mage-model" &&
      authorityStage?.hosted_png_crc32_repair_commit === EXPECTED.hostedRepair &&
      authorityStage?.finalize_transport_repair_commit === EXPECTED.runpodControl,
    `${label}_authority_binding`,
  );
}

for (const operation of [
  `provider_free_validate_hosted_png_crc32_repair_commit_${EXPECTED.hostedRepair}_and_unchanged_runpod_control_commit_${EXPECTED.runpodControl}_full_resolution`,
  "create_initial_flashboot_true_max_one_endpoint_in_eu_ro_1_on_exact_mage_volume",
  "submit_one_complete_32_image_batch_warm_and_reconcile_outputs",
  "apply_separately_hashed_flashboot_true_max_two_reader_configuration",
  "submit_two_simultaneous_read_only_complete_batches",
  "restore_flashboot_true_workers_max_one_and_wait_for_independent_workers_zero_with_health_first_quiescence",
  "retain_both_existing_volumes_in_all_outcomes",
]) {
  assert(proposal.proposed_operations_in_order?.includes(operation), `operation_${operation}`);
}
assert(
  proposal.negative_tests_required?.includes("wrong image bytes") &&
    proposal.negative_tests_required?.includes("wrong path") &&
    proposal.negative_tests_required?.includes("wrong volume") &&
    proposal.negative_tests_required?.includes("wrong GPU") &&
    proposal.negative_tests_required?.includes("wrong region") &&
    proposal.negative_tests_required?.includes("writes") &&
    proposal.negative_tests_required?.includes("cache escape") &&
    proposal.negative_tests_required?.includes("malformed authority") &&
    proposal.negative_tests_required?.includes("duplicate delivery") &&
    proposal.negative_tests_required?.includes("cancel") &&
    proposal.negative_tests_required?.includes("timeout") &&
    proposal.negative_tests_required?.includes("two readers"),
  "negative_tests",
);
assert(
  proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1 &&
    proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7 &&
    proposal.rates_cost_and_retention?.estimated_cumulative_gpu_hours_ceiling === 2 &&
    proposal.rates_cost_and_retention?.estimated_finite_serverless_compute_usd_ceiling === 2.2 &&
    proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null &&
    proposal.rates_cost_and_retention?.numeric_cap_must_be_supplied_by_user === true,
  "rates_and_cap",
);
assert(
  proposal.execution_boundary?.image_republication_authorized === false &&
    proposal.execution_boundary?.runpod_mutation_authorized_pending_execution === false &&
    proposal.execution_boundary?.cloudflare_mutation_authorized_pending_execution === false &&
    proposal.execution_boundary?.gpu_use_authorized_pending_execution === false &&
    proposal.execution_boundary?.provider_calls_completed === false &&
    proposal.execution_boundary?.external_spend_usd === 0 &&
    proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null &&
    proposal.execution_boundary?.v2_08_authorized === false,
  "execution_boundary",
);

assert(
  authority.schema_version ===
    "videoforge.v2-07-attempt27-hosted-png-crc32-repair-authority/v1" &&
    authority.checkpoint === "V2-07" &&
    authority.task_id === "VF-10-07" &&
    authority.attempt === 27 &&
    authority.authority_mode === "bounded_mutation" &&
    authority.status === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING",
  "authority_scope",
);
assert(
  authority.proposal?.path === "combined-live-proposal.json" &&
    authority.proposal?.sha256 === EXPECTED.proposal &&
    authority.approval?.exact_proposal_approved === true &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.low_eu_ro_1_availability_approved === true &&
    authority.approval?.minimum_approved_availability === "LOW" &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval?.fresh_numeric_cap === true &&
    authority.approval?.historical_cap_reused === false &&
    authority.approval?.prior_authority_reused === false &&
    authority.approval?.recurring_charge_is_outside_finite_cap === true,
  "authority_approval",
);
const authorityLineage = authority.lineage;
assert(
  authorityLineage?.final_image === EXPECTED.image &&
    authorityLineage?.image_manifest_sha256 === EXPECTED.imageManifest &&
    authorityLineage?.image_source_commit === EXPECTED.imageSource &&
    authorityLineage?.image_config_sha256 === EXPECTED.imageConfig &&
    authorityLineage?.image_layer_sha256 === EXPECTED.imageLayer &&
    authorityLineage?.image_base_sha256 === EXPECTED.imageBase &&
    authorityLineage?.image_parent_config_sha256 === EXPECTED.parentConfig &&
    authorityLineage?.control_source_commit === EXPECTED.runpodControl &&
    authorityLineage?.finalize_transport_repair_commit === EXPECTED.runpodControl &&
    authorityLineage?.hosted_png_crc32_repair_commit === EXPECTED.hostedRepair,
  "authority_image_lineage",
);
assert(
  authorityLineage?.model === EXPECTED.model &&
    authorityLineage?.model_manifest_sha256 === EXPECTED.manifest &&
    authorityLineage?.volume_id_sha256 === EXPECTED.volume &&
    authorityLineage?.volume_size_gb === 50 &&
    authorityLineage?.volume_region === "EU-RO-1" &&
    authorityLineage?.volume_mount === "/runpod-volume" &&
    authorityLineage?.model_root === "/runpod-volume/mage-model" &&
    authorityLineage?.volume_write_policy === "APPLICATION_READ_ONLY" &&
    authorityLineage?.image_publication_state ===
      "ALREADY_PUBLISHED_EXACT_DIGEST_READBACK_PASS_NO_REPUBLICATION" &&
    authorityLineage?.failed_attempt_evidence_sha256 === EXPECTED.closure &&
    authorityLineage?.prior_proposal_sha256 === EXPECTED.priorProposal &&
    authorityLineage?.prior_authority_sha256 === EXPECTED.priorAuthority &&
    authorityLineage?.prior_authority_state ===
      "CLOSED_EXACT_ATTEMPT26_CONSUMED_DO_NOT_REUSE" &&
    authorityLineage?.initial_config_sha256 === EXPECTED.max1 &&
    authorityLineage?.concurrent_reader_config_sha256 === EXPECTED.max2,
  "authority_model_volume_lineage",
);
assert(
  authority.finalize_transport_repair?.commit === EXPECTED.runpodControl &&
    sameJson(authority.finalize_transport_repair, proposal.finalize_transport_repair) &&
    sameJson(authority.hosted_png_crc32_repair, proposal.hosted_png_crc32_repair),
  "authority_repair_binding",
);
assert(
  sameJson(authority.authorized_operations, proposal.proposed_operations_in_order) &&
    sameJson(authority.allowed_operations, proposal.proposed_operations_in_order) &&
    sameJson(authority.forbidden, proposal.forbidden) &&
    sameJson(
      authority.cleanup_rollback_and_stop_conditions,
      proposal.cleanup_rollback_and_stop_conditions,
    ) &&
    sameJson(
      authority.stop_conditions,
      proposal.cleanup_rollback_and_stop_conditions?.stop_if,
    ),
  "authority_operations_forbidden_cleanup_stop",
);
assert(
  authority.execution_boundary?.image_republication_authorized === false &&
    authority.execution_boundary?.publication_authorized_pending_execution === false &&
    authority.execution_boundary?.runpod_mutation_authorized_pending_execution === true &&
    authority.execution_boundary?.cloudflare_mutation_authorized_pending_execution === true &&
    authority.execution_boundary?.gpu_use_authorized_pending_execution === true &&
    authority.execution_boundary?.provider_calls_completed === false &&
    authority.execution_boundary?.external_spend_usd === 0 &&
    authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.execution_boundary?.provider_calls_only_after_authority_commit === true &&
    authority.execution_boundary?.v2_08_authorized === false,
  "authority_execution_boundary",
);
assert(
  authority.retention?.retain_both_volumes_all_outcomes === true &&
    authority.retention?.volume_mutation_authorized === false &&
    authority.retention?.retain_endpoint_private_template_on_success === true &&
    authority.retention?.retained_resources?.some(
      (item) =>
        item.purpose === "Mage" &&
        item.id_sha256 === EXPECTED.volume &&
        item.size_gb === 50 &&
        item.region === "EU-RO-1" &&
        item.mount === "/runpod-volume" &&
        item.model_root === "/runpod-volume/mage-model",
    ) &&
    authority.retention?.retained_resources?.some(
      (item) =>
        item.purpose === "SoulX" &&
        item.id_sha256 ===
          "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be" &&
        item.size_gb === 50 &&
        item.region === "EU-RO-1",
    ),
  "authority_retention",
);
assert(
  closure.attempt === 26 &&
    closure.proposal_sha256 === EXPECTED.priorProposal &&
    closure.authority_sha256 === EXPECTED.priorAuthority &&
    closure.authority_state === "CONSUMED_SINGLE_BOUNDED_EXECUTION_DO_NOT_REUSE" &&
    closure.final_reconciliation?.incremental_spend_usd === 0,
  "closure_binding",
);

const candidateReady = state.includes(
  "phase: serverless_v2_v2_07_attempt27_hosted_png_crc32_repair_candidate_ready",
);
const authorizedPreExecution = state.includes(
  "phase: serverless_v2_v2_07_attempt27_hosted_png_crc32_repair_authorized",
);
if (candidateReady) {
  assert(
    state.includes("task_stage: provider_free_repair") &&
      state.includes("provider_calls_authorized: false") &&
      state.includes("remote_or_cloud_mutations_authorized: false") &&
      state.includes("gpu_use_authorized: false") &&
      state.includes("maximum_external_spend_usd: 0") &&
      state.includes(EXPECTED.proposal) &&
      state.includes(EXPECTED.hostedRepair),
    "state_boundary",
  );
  assert(
    gates.includes(`pending_proposal_sha256: "${EXPECTED.proposal}"`) &&
      gates.includes("authority_mode: none_attempt27_pending_fresh_approval") &&
      gates.includes("pending_numeric_cap_usd: null"),
    "gates_boundary",
  );
  for (const [label, value] of [
    ["task", task],
    ["start", start],
  ]) {
    assert(value.includes(EXPECTED.proposal) && value.includes(EXPECTED.hostedRepair), `${label}_pointer`);
  }
  assert(
    activation.includes(EXPECTED.proposal) &&
      activation.includes(EXPECTED.hostedRepair) &&
      activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"),
    "activation_boundary",
  );
} else if (authorizedPreExecution) {
  assert(
    state.includes("task_stage: bounded_mutation") &&
      state.includes("provider_calls_authorized: true") &&
      state.includes("remote_or_cloud_mutations_authorized: true") &&
      state.includes("gpu_use_authorized: true") &&
      state.includes("maximum_external_spend_usd: 4") &&
      state.includes(EXPECTED.proposal) &&
      state.includes(EXPECTED.authority) &&
      state.includes("2026-08-21-attempt27-hosted-png-crc32-repair-candidate/approved-authority.json") &&
      state.includes(EXPECTED.hostedRepair),
    "authorized_state_boundary",
  );
  assert(
    gates.includes(
      `pending_proposal_sha256: "${EXPECTED.proposal}"`,
    ) &&
      gates.includes(
        `pending_authority: "evidence/acceptance/VF-10-07/2026-08-21-attempt27-hosted-png-crc32-repair-candidate/approved-authority.json"`,
      ) &&
      gates.includes(`pending_authority_sha256: "${EXPECTED.authority}"`) &&
      gates.includes("authority_mode: attempt27_bounded_mutation_authorized") &&
      gates.includes("pending_numeric_cap_usd: 4"),
    "authorized_gates_boundary",
  );
  for (const [label, value] of [
    ["task", task],
    ["start", start],
  ]) {
    assert(
      value.includes(EXPECTED.proposal) &&
        value.includes(EXPECTED.authority) &&
        value.includes("2026-08-21-attempt27-hosted-png-crc32-repair-candidate/approved-authority.json") &&
        value.includes(EXPECTED.hostedRepair) &&
        value.includes("$4"),
      `${label}_authorized_pointer`,
    );
  }
  assert(
    activation.includes(EXPECTED.proposal) &&
      activation.includes(EXPECTED.hostedRepair) &&
      activation.includes(EXPECTED.runpodControl) &&
      activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4"),
    "authorized_activation_boundary",
  );
} else {
  fail("state_mode");
}

process.stdout.write(
  `V2-07 Attempt27 hosted PNG CRC32 proposal validation PASS (${EXPECTED.proposal}; authority ${EXPECTED.authority}; max1 ${EXPECTED.max1}; max2 ${EXPECTED.max2}; ${authorizedPreExecution ? "authorized cap 4" : "candidate cap null"})\n`,
);
