import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt40-item-lineage-candidate",
);
const candidatePath =
  "evidence/acceptance/VF-10-07/2026-08-23-attempt40-item-lineage-candidate";
const expected = {
  proposal:
    "sha256:56cd650b61a56fb17a9abd602839992990d3a985a952eafc30afa60e82e02ae8",
  authority:
    "sha256:5691eb5bb3a9009fd1a010c74b7c04bc47d15c0ce580ff47f6183c105a563736",
  acceptance:
    "sha256:def791c571e6266a85486982a95ad139e7baa52a2d646a178df1c7ad0939c645",
  max1:
    "sha256:391dd6b208b4b6c2e045058295f03e47937da7f9361b6bf27e7b225dbb51432e",
  max2:
    "sha256:fee8426ec819aa4e742fd9e36e0e16113786fd773f66e9e46f29104b78ed044e",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  source: "a7b7a937d08dc9032b8922cca71c602195f3094c",
  control: "b811cdfd677775558aa79452a4930b50a07b7b1a",
  model:
    "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest:
    "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume:
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
};
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  authority: resolve(candidate, "approved-authority.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  successorProposal: resolve(
    root,
    "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt42-get-readback-authority-candidate/combined-live-proposal.json",
  ),
};
const fail = (code) => { throw new Error(`V207_ATTEMPT40_AUTHORITY_${code}`); };
const assert = (condition, code) => { if (!condition) fail(code); };
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;
for (const [name, hash] of Object.entries({
  proposal: expected.proposal,
  authority: expected.authority,
  acceptance: expected.acceptance,
  max1: expected.max1,
  max2: expected.max2,
})) assert(existsSync(paths[name]) && sha(paths[name]) === hash, `${name.toUpperCase()}_HASH`);

const proposal = json(paths.proposal);
const authority = json(paths.authority);
const acceptance = json(paths.acceptance);
const max1 = json(paths.max1);
const max2 = json(paths.max2);
assert(proposal.attempt === 40 && proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "PROPOSAL_SCOPE");
assert(proposal.user_approval?.exact_proposal_approved === false && proposal.user_approval.maximum_cumulative_finite_spend_usd === null, "PROPOSAL_IMMUTABLE");
assert(authority.schema_version === "videoforge.v2-07-attempt40-item-lineage-authority/v1" && authority.attempt === 40 && authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION", "AUTHORITY_SCOPE");
assert(authority.proposal?.sha256 === expected.proposal && authority.approval?.exact_proposal_approved === true && authority.approval.flashboot_true_accepted === true && authority.approval.low_or_better_eu_ro_1_availability_approved === true && authority.approval.minimum_approved_availability === "LOW" && authority.approval.maximum_cumulative_finite_spend_usd === 4 && authority.approval.fresh_numeric_cap === true && authority.approval.single_use === true && authority.approval.consumed === false && authority.approval.prior_authority_reused === false, "AUTHORITY_APPROVAL");
assert(authority.lineage?.control_source_commit === expected.control && authority.lineage.image_source_commit === expected.source && authority.lineage.image === expected.image && authority.lineage.model === expected.model && authority.lineage.model_manifest_sha256 === expected.manifest && authority.lineage.volume_id_sha256 === expected.volume && authority.lineage.volume_size_gb === 50 && authority.lineage.volume_region === "EU-RO-1" && authority.lineage.volume_mount === "/runpod-volume" && authority.lineage.model_root === "/runpod-volume/mage-model" && authority.lineage.initial_config_sha256 === expected.max1 && authority.lineage.concurrent_reader_config_sha256 === expected.max2, "AUTHORITY_LINEAGE");
assert(authority.execution_boundary?.image_republication_authorized === true && authority.execution_boundary.runpod_mutation_authorized_pending_execution === true && authority.execution_boundary.gpu_use_authorized_pending_execution === true && authority.execution_boundary.external_spend_usd === 0 && authority.execution_boundary.maximum_cumulative_finite_spend_usd === 4 && authority.execution_boundary.retained_volume_mutation_authorized === false && authority.execution_boundary.v2_08_authorized === false, "AUTHORITY_BOUNDARY");
assert(authority.authorized_operations?.proposal_sha256 === expected.proposal && authority.authorized_operations.all_and_only_listed_operations_authorized === true && authority.authorized_operations.exact_immutable_image_publication_authorized === true && authority.authorized_operations.publication_or_tag_mutation_authorized === false && authority.authorized_operations.retained_volume_mutation_authorized === false && authority.authorized_operations.model_download_preparation_or_quantization_authorized === false && authority.authorized_operations.gpu_or_region_fallback_authorized === false && authority.authorized_operations.v2_08_authorized === false, "AUTHORIZED_OPERATIONS");
assert(acceptance.result === "APPROVED_SINGLE_USE_PENDING_EXECUTION" && acceptance.candidate?.proposal_sha256 === expected.proposal && acceptance.candidate.authority_recorded === true && acceptance.candidate.authority_path === "approved-authority.json" && acceptance.candidate.authority_sha256 === expected.authority && acceptance.candidate.maximum_cumulative_finite_spend_usd === 4 && acceptance.provider_boundary?.provider_calls === true && acceptance.provider_boundary.provider_mutations === true && acceptance.provider_boundary.authority_active === true && acceptance.provider_boundary.cap_usd === 4 && acceptance.provider_boundary.gpu_use === false && acceptance.provider_boundary.external_spend_usd === 0 && acceptance.provider_boundary.authority_file_present === true, "ACCEPTANCE_BINDING");
for (const [config, max] of [[max1, 1], [max2, 2]]) assert(config.image === expected.image && config.image_source_commit === expected.source && config.control_source_commit === expected.control && config.region === "EU-RO-1" && config.network_volume_id_sha256 === expected.volume && config.network_volume_mount === "/runpod-volume" && config.workers_min === 0 && config.workers_max === max && config.compute_type === "GPU" && config.flex_only === true && config.flashboot === true && config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090", `CONFIG_${max}`);
const activation = text(paths.activation);
const state = text(paths.state); const gates = text(paths.gates);
const successorAttempt41 =
  state.includes("phase: serverless_v2_v2_07_attempt41_candidate_pending_exact_approval") ||
  state.includes("phase: serverless_v2_v2_07_attempt41_closed_not_qualified");
const successorAttempt42 = state.includes(
  "phase: serverless_v2_v2_07_attempt42_candidate_pending_exact_approval",
);
const successor = successorAttempt41 || successorAttempt42;
if (successor) {
  assert(
    activation.includes(
      successorAttempt42
        ? sha(paths.successorProposal)
        : "sha256:3ce00d81d161e43a2d6a1610b6f9a7c9b7ceaa1fcb3bbbe44339fa478605eb18",
    ) &&
      activation.includes(
        successorAttempt42
          ? "78062a729fd2e321fbe3b71dc9e7e57b5c8b3fe6"
          : "6a4053f6fdde6e906e10b7cb297d253a7b9af140",
      ) &&
      activation.includes("V207_APPROVED_AUTHORITY_SHA256: string | null = null") &&
      activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") &&
      activation.includes(expected.image) &&
      activation.includes(expected.source),
    "SUCCESSOR_ACTIVATION_BINDING",
  );
} else {
  assert(activation.includes(`V207_PENDING_PROPOSAL_SHA256 =\n  \"${expected.proposal}\"`) && activation.includes(`V207_PENDING_CONTROL_SOURCE_COMMIT =\n  \"${expected.control}\"`) && activation.includes(`V207_APPROVED_AUTHORITY_SHA256 =\n  \"${expected.authority}\"`) && activation.includes(expected.image) && activation.includes(expected.source), "ACTIVATION_BINDING");
}
for (const [name, path] of Object.entries({ state: paths.state, gates: paths.gates, start: paths.start, task: paths.task })) {
  const surface = text(path);
  if (successor && (name === "gates" || name === "task")) continue;
  assert(
    surface.includes(expected.proposal) &&
      surface.includes(expected.acceptance) &&
      surface.includes(expected.max1) &&
      surface.includes(expected.max2) &&
      surface.includes(expected.image) &&
      surface.includes(expected.authority),
    `${name.toUpperCase()}_POINTERS`,
  );
}
const closed = state.includes("phase: serverless_v2_v2_07_attempt40_closed_not_qualified") || successor;
if (closed) {
  assert(state.includes("current_authority: null") && state.includes("maximum_external_spend_usd: 0") && state.includes(expected.authority), "STATE_CLOSED_BOUNDARY");
  if (successorAttempt42) {
    assert(
      gates.includes("authority_mode: pending_attempt42_exact_approval_and_fresh_numeric_cap") &&
        gates.includes("pending_numeric_cap_usd: null") &&
        gates.includes("pending_authority: null") &&
        gates.includes("provider_calls_authorized: false") &&
        gates.includes("gpu_use_authorized: false"),
      "GATE_SUCCESSOR_ATTEMPT42_BOUNDARY",
    );
  } else if (successorAttempt41) {
    assert(
      gates.includes("authority_mode: closed_consumed_attempt41_output_readback_authority_invalid") &&
        gates.includes("pending_numeric_cap_usd: null") &&
        gates.includes("pending_authority: null") &&
        gates.includes("provider_calls_authorized: false") &&
        gates.includes("gpu_use_authorized: false"),
      "GATE_CLOSED_BOUNDARY",
    );
  } else {
    assert(
      (gates.includes("authority_mode: closed_consumed_attempt40_live_runner_failed") ||
        gates.includes("authority_mode: pending_attempt41_exact_approval_and_fresh_numeric_cap")) &&
        gates.includes("pending_numeric_cap_usd: null") &&
        gates.includes(expected.authority),
      "GATE_CLOSED_BOUNDARY",
    );
  }
} else {
  assert(state.includes("phase: serverless_v2_v2_07_attempt40_approved_pending_execution") && state.includes("provider_calls_authorized: true") && state.includes("maximum_external_spend_usd: 4") && state.includes(expected.authority), "STATE_BOUNDARY");
  assert(gates.includes("authority_mode: attempt40_bounded_mutation_authorized") && gates.includes("pending_numeric_cap_usd: 4") && gates.includes(expected.authority), "GATE_BOUNDARY");
}
console.log(`V2-07 Attempt40 exact authority validation PASS (proposal immutable; authority bound; ${closed ? "consumed and closed" : "fresh $4 cap pending execution"})`);
