import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt31-terminal-snapshot-stabilization-candidate",
);

const expected = Object.freeze({
  authority:
    "sha256:02b91db639ddf6e612c7103d38f9c5c1bae3ff0072afaeebb124274db1e3eab5",
  proposal:
    "sha256:ace01c82b5eaa9e45c177e7c41b908b1f384fe13ae6ff6bd3f8e04cf8ecb98ea",
  max1:
    "sha256:29b3c4ed8d05b91cf5f7fda0b9055a95f3a553dfc65dec8a5b5540c9b7e0e006",
  max2:
    "sha256:4013c7b9887994b6de2dfd947f13ea74e622dfc0fe5b5e429c29fffedc69ef9b",
  closure:
    "sha256:9846e19ee4348e73ef880202ecff5463bd076c5b1a2bd209e2815cba0500043c",
  cleanup:
    "sha256:112f7038d162613ebdde2176a7c257de24f629fdb3914b876a6edc490f46dbb0",
  control: "f513ac807c6d5e2298092a936495e3c4fc0e6a28",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  imageSource: "79f123268b6ade640c02dd20616a89d16b43a5e6",
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
  finalizeReplay: "bf26c3a86ec6a48f619c39613d425da816eeae4d",
  terminalReplay: "7ba8e9181fe210858c23a3ba7c5c9aca768ac24b",
  scaleZero: "0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14",
  crc32: "1960ea9307bb7fcb591c842b84fc1c622aec49eb",
});

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V207_ATTEMPT31_AUTHORITY_INVALID:${code}`);
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
const hasAll = (text, values) => values.every((value) => text.includes(value));
const hasAny = (text, values) => values.some((value) => text.includes(value));
const includesOperation = (operations, fragment) =>
  Array.isArray(operations) && operations.some((operation) => operation.includes(fragment));

const paths = Object.freeze({
  proposal: resolve(candidate, "combined-live-proposal.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  authority: resolve(candidate, "approved-authority.json"),
  closure: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/failed-attempt-30.json",
  ),
  cleanup: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/attempt30-cleanup-observation.json",
  ),
});

const contextPaths = Object.freeze({
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  activationTest: resolve(root, "apps/web/src/server/providers/v207-activation-authority.test.ts"),
});

const bytes = await Promise.all(Object.values(paths).map((path) => readFile(path)));
const [proposalBytes, acceptanceBytes, max1Bytes, max2Bytes, authorityBytes, closureBytes, cleanupBytes] =
  bytes;
assert(sha256(proposalBytes) === expected.proposal, "PROPOSAL_HASH");
assert(sha256(max1Bytes) === expected.max1, "MAX1_HASH");
assert(sha256(max2Bytes) === expected.max2, "MAX2_HASH");
assert(sha256(authorityBytes) === expected.authority, "AUTHORITY_HASH");
assert(sha256(closureBytes) === expected.closure, "CLOSURE_HASH");
assert(sha256(cleanupBytes) === expected.cleanup, "CLEANUP_HASH");
const acceptanceHash = sha256(acceptanceBytes);

const proposal = parse(proposalBytes, "PROPOSAL");
const acceptance = parse(acceptanceBytes, "ACCEPTANCE");
const max1 = parse(max1Bytes, "MAX1");
const max2 = parse(max2Bytes, "MAX2");
const authority = parse(authorityBytes, "AUTHORITY");
const closure = parse(closureBytes, "CLOSURE");
const cleanup = parse(cleanupBytes, "CLEANUP");

assert(
  authority.schema_version ===
    "videoforge.v2-07-attempt31-terminal-snapshot-stabilization-authority/v1" &&
    authority.checkpoint === "V2-07" &&
    authority.task_id === "VF-10-07" &&
    authority.attempt === 31 &&
    authority.authority_mode === "bounded_mutation" &&
    authority.status === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING",
  "AUTHORITY_SCOPE",
);
assert(
  authority.proposal?.path === "combined-live-proposal.json" &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.approval?.exact_proposal_approved === true &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.low_eu_ro_1_availability_approved === true &&
    authority.approval?.minimum_approved_availability === "LOW" &&
    authority.approval?.observed_availability_at_approval === "HIGH" &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval?.fresh_numeric_cap === true &&
    authority.approval?.historical_cap_reused === false &&
    authority.approval?.prior_authority_reused === false &&
    authority.approval?.recurring_retained_volume_charge_usd_per_month === 7 &&
    authority.approval?.recurring_charge_is_outside_finite_cap === true,
  "AUTHORITY_APPROVAL",
);

const lineage = authority.lineage;
assert(
  lineage?.model === expected.model &&
    lineage?.model_manifest_sha256 === expected.manifest &&
    lineage?.volume_id_sha256 === expected.volume &&
    lineage?.volume_size_gb === 50 &&
    lineage?.volume_region === "EU-RO-1" &&
    lineage?.volume_mount === "/runpod-volume" &&
    lineage?.model_root === "/runpod-volume/mage-model" &&
    lineage?.volume_write_policy === "APPLICATION_READ_ONLY" &&
    lineage?.image_source_commit === expected.imageSource &&
    lineage?.control_source_commit === expected.control &&
    lineage?.finalize_transport_repair_commit === "b8666dd8b8bc12578ffae8925f6ce73dbf53a841" &&
    lineage?.image_config_sha256 === expected.imageConfig &&
    lineage?.image_layer_sha256 === expected.imageLayer &&
    lineage?.image_manifest_sha256 === expected.imageManifest &&
    lineage?.image_base_sha256 === expected.imageBase &&
    lineage?.image_parent_config_sha256 === expected.imageParentConfig &&
    lineage?.final_image === expected.image &&
    lineage?.failed_attempt_evidence_sha256 === expected.closure &&
    lineage?.prior_closure_evidence_sha256 === expected.closure &&
    lineage?.prior_cleanup_evidence_sha256 === expected.cleanup &&
    lineage?.prior_proposal_sha256 ===
      "sha256:2cb3d2a2ab73e968da1e964018fd2c100bf9e8cc7b277e9c5739b69355896c2a" &&
    lineage?.prior_authority_sha256 ===
      "sha256:6fd4560fcba507dbae51da056d09c309fe0c93ed65e713e3526ad3aa2f978131" &&
    lineage?.prior_authority_state === "CLOSED_EXACT_ATTEMPT30_CONSUMED_DO_NOT_REUSE" &&
    lineage?.prior_attempt === 30 &&
    lineage?.terminal_snapshot_stabilization_commit === expected.control &&
    lineage?.attempt30_closure_commit === "64f0122276fbfe56dbc1302a89a69289259bec7d" &&
    lineage?.initial_config_path === "staged-config-max1.json" &&
    lineage?.initial_config_sha256 === expected.max1 &&
    lineage?.concurrent_reader_config_path === "staged-config-max2.json" &&
    lineage?.concurrent_reader_config_sha256 === expected.max2,
  "AUTHORITY_LINEAGE",
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
    authority.execution_boundary?.v2_08_authorized === false,
  "AUTHORITY_BOUNDARY",
);

assert(
  authority.rate_snapshot?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1 &&
    authority.rate_snapshot?.secure_rtx4090_reference_usd_per_gpu_hour === 0.74 &&
    authority.rate_snapshot?.network_volume_usd_per_gb_month === 0.07 &&
    authority.rate_snapshot?.availability === "HIGH" &&
    authority.rate_snapshot?.minimum_approved_availability === "LOW" &&
    authority.rate_snapshot?.region === "EU-RO-1" &&
    authority.rate_snapshot?.estimated_cumulative_gpu_hours_ceiling === 2 &&
    authority.rate_snapshot?.estimated_finite_serverless_compute_usd_ceiling === 2.2 &&
    authority.rate_snapshot?.maximum_cumulative_finite_spend_usd === 4,
  "AUTHORITY_RATES",
);

const snapshot = authority.read_only_provider_snapshot;
assert(
  snapshot?.account_identity_verified === true &&
    snapshot?.pods === 0 &&
    snapshot?.endpoints === 0 &&
    snapshot?.private_templates === 0 &&
    snapshot?.active_serverless_workers === 0 &&
    snapshot?.running_pods === 0 &&
    snapshot?.retained_volume_count === 2 &&
    snapshot?.rtx4090_region === "EU-RO-1" &&
    snapshot?.rtx4090_availability === "HIGH" &&
    snapshot?.provider_mutations === 0 &&
    snapshot?.gpu_jobs_submitted === 0 &&
    snapshot?.external_spend_usd === 0 &&
    snapshot?.serverless_flex_usd_per_gpu_hour === 1.1,
  "AUTHORITY_READ_ONLY_SNAPSHOT",
);
assert(
  Array.isArray(snapshot?.retained_volumes) &&
    snapshot.retained_volumes.length === 2 &&
    snapshot.retained_volumes.some(
      (volume) => volume.id_sha256 === expected.volume && volume.size_gb === 50 && volume.region === "EU-RO-1",
    ) &&
    snapshot.retained_volumes.some(
      (volume) => volume.id_sha256 === expected.soulxVolume && volume.size_gb === 50 && volume.region === "EU-RO-1",
    ),
  "AUTHORITY_RETAINED_VOLUMES",
);

const authorizedOperations = authority.authorized_operations;
for (const operation of [
  "create_exact_private_template",
  "create_initial_flashboot_true_max_one_endpoint_in_eu_ro_1_on_exact_mage_volume",
  "submit_one_complete_32_image_batch_warm_and_reconcile_outputs",
  "submit_two_simultaneous_read_only_complete_batches",
  "restore_flashboot_true_workers_max_one_and_wait_for_independent_workers_zero_with_health_first_quiescence",
  "retain_endpoint_private_template_mage_volume_and_soulx_volume_on_success",
  "cancel_only_owned_jobs_and_delete_only_disposable_endpoint_and_private_template_if_failed",
]) {
  assert(includesOperation(authorizedOperations, operation), `AUTHORITY_OPERATION_${operation}`);
}
for (const forbidden of [
  "image republication or tag mutation",
  "model download preparation quantization or volume mutation",
  "retained volume rebuild delete cross-mount or write",
  "GPU or region fallback",
  "V2-08 or successor work",
]) {
  assert(Array.isArray(authority.forbidden) && authority.forbidden.includes(forbidden), `AUTHORITY_FORBIDDEN_${forbidden}`);
}

assert(
  proposal.schema_version ===
    "videoforge.v2-07-terminal-snapshot-stabilization-combined-live-proposal/v1" &&
    proposal.checkpoint === "V2-07" &&
    proposal.task_id === "VF-10-07" &&
    proposal.attempt === 31 &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null &&
    proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null &&
    proposal.provider_mutation === false &&
    proposal.gpu_use === false &&
    proposal.spend_usd === 0,
  "PROPOSAL_BYTES_IMMUTABLE_NULL_CAP",
);
assert(
  acceptance.schema_version ===
    "videoforge.v2-07-terminal-snapshot-stabilization-candidate-handoff/v1" &&
    acceptance.checkpoint === "V2-07" &&
    acceptance.task_id === "VF-10-07" &&
    acceptance.attempt === 31 &&
    acceptance.result === "APPROVED_PREEXECUTION_PROVIDER_EXECUTION_PENDING" &&
    acceptance.qualification_status === "NOT_QUALIFIED" &&
    acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.max1_sha256 === expected.max1 &&
    acceptance.candidate?.max2_sha256 === expected.max2 &&
    acceptance.candidate?.authority_path === "approved-authority.json" &&
    acceptance.candidate?.authority_sha256 === expected.authority &&
    acceptance.candidate?.authority_recorded === true &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === 4 &&
    acceptance.candidate?.provider_calls_authorized === true &&
    acceptance.candidate?.provider_mutations_authorized === true &&
    acceptance.candidate?.gpu_use_authorized === true &&
    acceptance.candidate?.image_republication_authorized === false &&
    acceptance.candidate?.model_download_or_volume_mutation_authorized === false &&
    acceptance.candidate?.v2_08_authorized === false &&
    acceptance.provider_boundary?.provider_calls === false &&
    acceptance.provider_boundary?.provider_mutations === false &&
    acceptance.provider_boundary?.gpu_use === false &&
    acceptance.provider_boundary?.external_spend_usd === 0 &&
    acceptance.next_boundary?.includes("Execute only the exact approved Attempt31 proposal"),
  "ACCEPTANCE_BINDING",
);

assert(
  closure.schema_version === "videoforge.v2-07-failed-attempt-closure/v1" &&
    closure.attempt === 30 &&
    closure.authority_state === "CONSUMED_SINGLE_BOUNDED_EXECUTION_DO_NOT_REUSE" &&
    cleanup.attempt === 30 &&
    cleanup.result?.endpoint_deleted === true &&
    cleanup.result?.template_deleted === true &&
    cleanup.result?.final_disposable_resources_absent === true,
  "PRIOR_CLOSED_EVIDENCE",
);

const context = await Promise.all(
  Object.entries(contextPaths).map(async ([label, path]) => [label, await readFile(path, "utf8")]),
);
const files = Object.fromEntries(context);
const attempt32Closed =
  files.state.includes("mode: closed_consumed_attempt32_concurrent_reader_drain_failure") &&
  files.gates.includes("authority_mode: attempt32_consumed_closed") &&
  files.gates.includes("failed-attempt-32.json");
const authorityRelativePath =
  "evidence/acceptance/VF-10-07/2026-08-22-attempt31-terminal-snapshot-stabilization-candidate/approved-authority.json";
const documentationPointers = [
  expected.proposal,
  expected.max1,
  expected.max2,
  expected.control,
  expected.authority,
  acceptanceHash,
];
for (const label of ["state", "gates", "task", "start"]) {
  assert(
    (attempt32Closed && label === "gates") || hasAll(files[label], documentationPointers),
    `${label.toUpperCase()}_POINTERS`,
  );
}
for (const label of ["activation", "activationTest"]) {
  assert(
    hasAll(files[label], [expected.proposal, expected.control, expected.authority]),
    `${label.toUpperCase()}_POINTERS`,
  );
}

assert(
  hasAll(files.state, [
    "pending_v2_07_attempt31_proposal:",
    "mode: closed_consumed_attempt31_output_finalization_failure",
    expected.closure,
    expected.cleanup,
    expected.authority,
    "result: NOT_QUALIFIED_attempt31_closed_output_finalization_failure",
  ]),
  "STATE_HISTORICAL_CLOSURE",
);
assert(
  files.activation.includes("V207_CONSUMED_ATTEMPT31_AUTHORITY_SHA256") &&
    files.activation.includes(expected.authority) &&
    files.activationTest.includes(expected.authority) &&
    files.activationTest.includes("rejects the consumed Attempt31 proposal after closure"),
  "ACTIVATION_CONSUMED_BINDING",
);

const gateStart = files.gates.indexOf("GATE_SERVERLESS_MAGE_001:");
assert(gateStart >= 0, "MAGE_GATE_MISSING");
const gate = files.gates.slice(gateStart);
assert(
  attempt32Closed ||
    (gate.includes(authorityRelativePath) &&
    gate.includes(`latest_closed_authority_sha256: "${expected.authority}"`) &&
    gate.includes(`closure_evidence_sha256: "sha256:76c9dec453b5670c0dff73c1857cbbb5e9b43a460599c81a24455404f634c490"`) &&
    gate.includes(`cleanup_evidence_sha256: "sha256:61185a893499ab0634458fe472af21cb47385923e2fd05af60658ec97d1f54bc"`)),
  "GATE_HISTORICAL_CLOSURE",
);

process.stdout.write(
  `V2-07 Attempt31 authority validation PASS (authority ${expected.authority}; proposal ${expected.proposal}; acceptance ${acceptanceHash}; cap $4)\n`,
);
