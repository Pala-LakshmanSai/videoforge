import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-get-readback-optional-fields-candidate",
);
const expectedProposal =
  "sha256:9e9675dcf6943dce35b4bf6155fdfc39f8dade5e9775bcc3ee9a427980d39e02";
const expectedAuthority =
  "sha256:ac8f45bdb3d5429fa3b93e9624f62242f026ced07f19f28d740503dccfd8f56d";
const expectedAttempt20 =
  "sha256:82aae2abf02041620c18d6a016719bab0f92ef41ed77430c2239ebfab005a37d";
const expectedControl = "b35f4a60fe99d6b5649797c7aaaae7af4ef1368d";
const expectedConfigs = [
  "sha256:76a2b5406115f1060cd72b1fccda9e02a2fdccb17450c8e4b1aae73cbea67f13",
  "sha256:3d53d9d44540575d164cc33e2faa73587245812d9ad9002965f8fa50ad34aae8",
];
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`V207_GET_READBACK_PROPOSAL_INVALID:${label}`);
};

const [
  proposalBytes,
  authorityBytes,
  attempt20Bytes,
  attemptBytes,
  publicationBytes,
  state,
  gate,
  task,
  activation,
  control,
  tests,
] =
  await Promise.all([
    readFile(resolve(candidate, "combined-live-proposal.json")),
    readFile(resolve(candidate, "approved-authority.json")),
    readFile(
      resolve(
        root,
        "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-20.json",
      ),
    ),
    readFile(
      resolve(
        root,
        "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-19.json",
      ),
    ),
    readFile(
      resolve(
        root,
        "project-context/evidence/acceptance/VF-10-07/2026-08-20-diagnostic-endpoint-bound-candidate/image-publication.json",
      ),
    ),
    readFile(resolve(root, "project-context/CURRENT_STATE.yaml"), "utf8"),
    readFile(resolve(root, "project-context/GATES.yaml"), "utf8"),
    readFile(resolve(root, "project-context/tasks/VF-10-07.md"), "utf8"),
    readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
    readFile(resolve(root, "apps/web/src/server/providers/runpod-control.ts"), "utf8"),
    readFile(resolve(root, "apps/web/src/server/providers/runpod-control.test.ts"), "utf8"),
  ]);
const proposal = JSON.parse(proposalBytes.toString("utf8"));
const authority = JSON.parse(authorityBytes.toString("utf8"));
const attempt20 = JSON.parse(attempt20Bytes.toString("utf8"));
const attempt = JSON.parse(attemptBytes.toString("utf8"));

assert(hash(proposalBytes) === expectedProposal, "proposal_hash");
assert(hash(authorityBytes) === expectedAuthority, "authority_hash");
assert(hash(attempt20Bytes) === expectedAttempt20, "attempt20_hash");
assert(proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07", "scope");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "cap_null");
assert(proposal.user_approval?.exact_proposal_approved === false, "approval_pending");
assert(authority.checkpoint === "V2-07" && authority.task_id === "VF-10-07", "authority_scope");
assert(authority.proposal?.sha256 === expectedProposal, "authority_proposal");
assert(authority.approval?.exact_proposal_approved === true, "authority_approval");
assert(authority.approval?.flashboot_true_accepted === true, "authority_flashboot");
assert(authority.approval?.minimum_approved_availability === "LOW", "authority_availability");
assert(authority.approval?.maximum_cumulative_finite_spend_usd === 4, "authority_cap");
assert(authority.approval?.fresh_numeric_cap === true, "authority_fresh_cap");
assert(authority.approval?.historical_cap_reused === false, "authority_cap_not_reused");
assert(authority.lineage?.control_source_commit === expectedControl, "authority_control");
assert(authority.lineage?.initial_config_sha256 === expectedConfigs[0], "authority_max1");
assert(authority.lineage?.concurrent_reader_config_sha256 === expectedConfigs[1], "authority_max2");
assert(authority.execution_boundary?.image_republication_authorized === false, "authority_no_republish");
assert(authority.execution_boundary?.gpu_use_authorized_pending_execution === true, "authority_gpu");
assert(authority.execution_boundary?.v2_08_authorized === false, "authority_no_v208");
assert(attempt20.attempt === 20, "attempt20_number");
assert(attempt20.authority_status === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "attempt20_closed");
assert(attempt20.authority_proposal_sha256 === expectedProposal, "attempt20_proposal");
assert(attempt20.approved_authority?.sha256 === expectedAuthority, "attempt20_authority");
assert(attempt20.failure?.code === "RUNPOD_ENDPOINT_ID_BINDING_READBACK_UNCONFIRMED", "attempt20_failure");
assert(attempt20.failure?.gpu_jobs_submitted === 0, "attempt20_zero_gpu_jobs");
assert(attempt20.runpod_cleanup?.final_disposable_resources_absent === true, "attempt20_cleanup");
assert(attempt20.runpod_cleanup?.network_volumes === 2, "attempt20_volumes");
assert(attempt20.billing?.attempt_increment_usd_settled === 0, "attempt20_zero_spend");
assert(attempt20.billing?.settlement_state === "STABLE_THREE_READS", "attempt20_settlement");
assert(attempt20.cloudflare_cleanup?.worker_version_restored === true, "attempt20_worker_restore");
assert(attempt20.cloudflare_cleanup?.signer_secret_deleted === true, "attempt20_signer_cleanup");
assert(proposal.lineage?.control_source_commit === expectedControl, "control_commit");
assert(proposal.lineage?.failed_attempt_evidence_sha256 === hash(attemptBytes), "attempt_hash");
assert(attempt.attempt === 19 && attempt.billing?.attempt_increment_usd_settled === 0, "attempt19");
assert(attempt.runpod_cleanup?.final_disposable_resources_absent === true, "cleanup");
assert(proposal.lineage?.image_publication_evidence_sha256 === hash(publicationBytes), "publication_hash");
assert(
  proposal.lineage?.prior_proposal_sha256 ===
    "sha256:ce11e4efb3b97f47c9ca70f83451ce6535e8467ac506b682527466f9327dafde",
  "prior_proposal",
);
assert(
  proposal.lineage?.prior_authority_sha256 ===
    "sha256:b824bea61e30c4ad1b5eda4bf8113c390c0ae0eff0a03c6fb279210e81d9e5c2",
  "prior_authority",
);
assert(proposal.lineage?.prior_authority_state === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "prior_closed");
assert(proposal.staged_endpoint_configs?.length === 2, "two_configs");
assert(proposal.readback_alias_policy?.networkVolumeId === "MANDATORY_EXACT", "primary_volume_mandatory");
assert(
  proposal.readback_alias_policy?.networkVolumeIds ===
    "OPTIONAL_DUPLICATE_ALIAS_IF_OMITTED_EXACT_SINGLETON_IF_PRESENT",
  "duplicate_volume_alias",
);
for (const [index, config] of proposal.staged_endpoint_configs.entries()) {
  const bytes = await readFile(resolve(candidate, config.definition_path));
  const definition = JSON.parse(bytes.toString("utf8"));
  assert(hash(bytes) === expectedConfigs[index] && config.definition_sha256 === expectedConfigs[index], `config_hash_${index}`);
  assert(definition.schema_version === "videoforge.v2-07-staged-endpoint-definition/v6", `config_schema_${index}`);
  assert(definition.control_source_commit === expectedControl, `config_control_${index}`);
  assert(definition.flashboot === true && definition.region === "EU-RO-1", `placement_${index}`);
  assert(definition.compute_type === "GPU" && definition.flex_only === true, `compute_${index}`);
  assert(definition.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090", `gpu_${index}`);
  assert(definition.workers_min === 0 && definition.workers_max === index + 1, `workers_${index}`);
  assert(
    definition.endpoint_identity_binding
      ?.endpoint_get_readback_compute_type_and_data_center_ids_optional_if_omitted_exact_if_present ===
      true,
    `optional_read_fields_${index}`,
  );
  assert(
    definition.endpoint_identity_binding?.endpoint_get_readback_must_match_all_other_config_and_exact_environment ===
      true,
    `strict_other_read_fields_${index}`,
  );
}
assert(proposal.last_observed_provider_truth?.pods === 0, "zero_pods");
assert(proposal.last_observed_provider_truth?.endpoints === 0, "zero_endpoints");
assert(proposal.last_observed_provider_truth?.private_templates === 0, "zero_templates");
assert(proposal.last_observed_provider_truth?.active_serverless_workers === 0, "zero_workers");
assert(proposal.last_observed_provider_truth?.intended_volume_count === 2, "two_volumes");
assert(proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "rate");
assert(proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "retention");
assert(proposal.forbidden?.includes("V2-08 or successor work"), "v208_forbidden");
assert(control.includes('optionalExactString(value.computeType, "GPU")'), "optional_compute");
assert(
  control.includes("optionalExactStringArray(value.dataCenterIds, [V207_RUNPOD_REGION])"),
  "optional_region",
);
assert(tests.includes("omits provider-optional compute and data-center fields"), "omitted_fields_test");
assert(tests.includes("explicit GET drift in provider-optional compute and data-center fields"), "wrong_fields_test");
assert(state.includes(expectedProposal), "state_proposal");
assert(state.includes(expectedAuthority), "state_authority");
assert(state.includes(expectedAttempt20), "state_attempt20");
assert(state.includes("v2_07_attempt20_closure"), "state_closed");
assert(state.includes("v2_07_attempt20_closed_authority"), "state_zero_cap");
assert(gate.includes(expectedProposal.slice(7)), "gate_proposal");
assert(gate.includes(expectedAuthority), "gate_authority");
assert(task.includes(expectedProposal), "task_proposal");
assert(task.includes(expectedAuthority), "task_authority");
assert(activation.includes("sha256:96ead6591874229d93537af46a3159002e2fe86c93cc2905c42bbb1326ccece7"), "activation_successor_proposal");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD"), "activation_closed");

process.stdout.write(`V2-07 Attempt 20 closure validation PASS (${expectedAttempt20})\n`);
