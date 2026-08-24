#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:a8b03557f6e4aa2b38cd17b58d1d62704e126619f1a7378348b72c0fde74734a",
  acceptance: "sha256:343042fba22a804f882717c8c6119408cb5a3e5839c6feb124ca6c090ba3e387",
  preflight: "sha256:a628e630428a0256eab05112c181ab598d579446485179e0a65497a17f9ec1b5",
  max1: "sha256:c68a4c2c2e4a14a3f9ed85e47fe33e3893886dba3040af7245261d198160c63b",
  max2: "sha256:fcb2c2b62072eb182a0c8833f2aa30b33bfff581be4006c41225dca962a88eed",
  control: "a49f7578e0a03677366560defa30493f1c975b56",
  orchestrator: "sha256:52d37b01230b4e5532266717c174e514f74fd05c37a4137a2b36e6d20b44e518",
  qualification: "sha256:fb1a0514262f048131559ef1d4c456c5fd9dff5879307465f3a16dc26a8ff833",
  reconciliation: "sha256:33f5ad2874bd6fb51591c40486ddff2ea7cc27157003c9b98f3fe45bb97b3f8b",
  marker: "sha256:6eb196247a9154ecb1110d74a2c0254855bcff9f4ec01a6377c30f6352a4dff7",
  canonical: "sha256:858ebe43ef8ad6558825d6b1c756311a8944cd2ef27e58f42651d793ab191da9",
  handler: "sha256:3a2559dd363bdf5032b019dab3cb8fe45cba6ed4308464f860a1965cfd18f1da",
};

const fail = (code) => {
  throw new Error(`V207_ATTEMPT49_${code}`);
};
const eq = (actual, wanted, code) => {
  if (actual !== wanted) fail(code);
};
const yes = (value, code) => {
  if (!value) fail(code);
};
const bytes = (file) => fs.readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha = (file) =>
  `sha256:${crypto.createHash("sha256").update(bytes(file)).digest("hex")}`;

const proposalPath = path.join(dir, "combined-live-proposal.json");
const acceptancePath = path.join(dir, "acceptance.json");
const preflightPath = path.join(dir, "read-only-preflight.json");
const max1Path = path.join(dir, "staged-config-max1.json");
const max2Path = path.join(dir, "staged-config-max2.json");
eq(sha(proposalPath), expected.proposal, "PROPOSAL_HASH");
eq(sha(acceptancePath), expected.acceptance, "ACCEPTANCE_HASH");
eq(sha(preflightPath), expected.preflight, "PREFLIGHT_HASH");
eq(sha(max1Path), expected.max1, "MAX1_HASH");
eq(sha(max2Path), expected.max2, "MAX2_HASH");

const proposal = json(proposalPath);
const acceptance = json(acceptancePath);
const preflight = json(preflightPath);
const max1 = json(max1Path);
const max2 = json(max2Path);
eq(proposal.attempt, 49, "ATTEMPT");
eq(proposal.authority_mode, "PENDING_FRESH_EXACT_APPROVAL_AND_POSITIVE_NUMERIC_CAP", "AUTHORITY_MODE");
eq(proposal.approval_request.exact_proposal_approved, false, "NOT_APPROVED");
eq(proposal.approval_request.maximum_cumulative_finite_spend_usd, null, "CAP_NOT_NULL");
eq(proposal.approval_request.anchor_refresh_authorized_if_approved, true, "REFRESH_NOT_REQUESTED");
eq(proposal.approval_request.exact_launcher_activation_if_approved, "V207_ROLLBACK_ANCHOR_REFRESH=two-phase-v1", "ACTIVATION");
eq(proposal.provider_free_lineage.control_source_commit, expected.control, "CONTROL");
eq(proposal.provider_free_lineage.orchestrator_source_sha256, expected.orchestrator, "ORCHESTRATOR");
eq(proposal.provider_free_lineage.live_qualification_source_sha256, expected.qualification, "QUALIFICATION");
eq(proposal.provider_free_lineage.readonly_reconciliation_source_sha256, expected.reconciliation, "RECONCILIATION");
eq(proposal.provider_free_lineage.canonical_activation_source_sha256, expected.canonical, "CANONICAL");
eq(proposal.immutable_runtime.volume_mount, "/runpod-volume", "VOLUME_MOUNT");
eq(proposal.immutable_runtime.model_root, "/runpod-volume/mage-model", "MODEL_ROOT");
eq(proposal.immutable_runtime.volume_write_policy, "APPLICATION_READ_ONLY", "VOLUME_POLICY");
eq(proposal.scratch_contract.scratch_root, "/tmp/videoforge-jobs", "SCRATCH_ROOT");
eq(proposal.scratch_contract.exact_job_path, "/tmp/videoforge-jobs/jobs/${job_id}", "JOB_SCRATCH");
eq(proposal.fresh_read_only_preflight.sha256, expected.preflight, "PROPOSAL_PREFLIGHT");
eq(proposal.staged_endpoint_configs[0].definition_sha256, expected.max1, "PROPOSAL_MAX1");
eq(proposal.staged_endpoint_configs[0].workers_min, 0, "MAX1_MIN");
eq(proposal.staged_endpoint_configs[0].workers_max, 1, "MAX1_MAX");
eq(proposal.staged_endpoint_configs[1].definition_sha256, expected.max2, "PROPOSAL_MAX2");
eq(proposal.staged_endpoint_configs[1].workers_min, 0, "MAX2_MIN");
eq(proposal.staged_endpoint_configs[1].workers_max, 2, "MAX2_MAX");
eq(proposal.cost.baseline_endpoint_spend_usd, 1.6217972798040137, "BASELINE_SPEND");
eq(proposal.cost.finite_action_estimate_usd, 3.95, "ESTIMATE");
eq(proposal.cost.proposed_finite_cap_usd, null, "PROPOSED_CAP");
eq(proposal.cost.serverless_flex_rtx4090_usd_per_gpu_hour, 1.1, "FLEX_RATE");
eq(proposal.cost.secure_rtx4090_reference_usd_per_gpu_hour, 0.74, "SECURE_RATE");
eq(proposal.acceptance_contract.complete_batches_only, true, "COMPLETE_BATCHES");
eq(proposal.acceptance_contract.provider_status_output_receipt_reconciliation_required, true, "OUTPUT_RECONCILIATION");
eq(proposal.acceptance_contract.at_most_one_acceptance_per_unit, true, "AT_MOST_ONE");
eq(proposal.acceptance_contract.duplicate_compute_and_cost_visibility_required, true, "DUPLICATE_COST");
eq(proposal.acceptance_contract.terminal_workers_zero_required, true, "WORKERS_ZERO");
eq(proposal.v2_08_authorized, false, "V208");

eq(acceptance.candidate.proposal_sha256, expected.proposal, "ACCEPTANCE_PROPOSAL");
eq(acceptance.candidate.read_only_preflight_sha256, expected.preflight, "ACCEPTANCE_PREFLIGHT");
eq(acceptance.candidate.max1_sha256, expected.max1, "ACCEPTANCE_MAX1");
eq(acceptance.candidate.max2_sha256, expected.max2, "ACCEPTANCE_MAX2");
eq(acceptance.candidate.authority_recorded, false, "ACCEPTANCE_AUTHORITY");
eq(acceptance.candidate.maximum_cumulative_finite_spend_usd, null, "ACCEPTANCE_CAP");
eq(acceptance.provider_boundary.provider_calls_authorized, false, "PROVIDER_OFF");
eq(acceptance.provider_boundary.gpu_use_authorized, false, "GPU_OFF");
eq(acceptance.provider_boundary.external_spend_usd, 0, "SPEND_ZERO");
eq(acceptance.provider_boundary.v2_08_authorized, false, "ACCEPTANCE_V208");

eq(preflight.read_only, true, "PREFLIGHT_READ_ONLY");
eq(preflight.provider_mutations, 0, "PREFLIGHT_MUTATION");
eq(preflight.gpu_jobs_submitted, 0, "PREFLIGHT_JOBS");
eq(preflight.inventory.pods, 0, "PREFLIGHT_PODS");
eq(preflight.inventory.endpoints, 0, "PREFLIGHT_ENDPOINTS");
eq(preflight.inventory.private_templates, 0, "PREFLIGHT_TEMPLATES");
eq(preflight.inventory.active_serverless_workers, 0, "PREFLIGHT_WORKERS");
eq(preflight.inventory.running_pods, 0, "PREFLIGHT_RUNNING_PODS");
eq(preflight.inventory.retained_volume_count, 2, "PREFLIGHT_VOLUMES");
eq(preflight.selected_gpu.availability, "MEDIUM", "PREFLIGHT_AVAILABILITY");
eq(preflight.selected_gpu.serverless_flex_published_rate_usd_per_gpu_hour, 1.1, "PREFLIGHT_FLEX_RATE");
eq(preflight.selected_gpu.secure_reference_rate_usd_per_gpu_hour, 0.74, "PREFLIGHT_SECURE_RATE");
eq(preflight.billing.incremental_spend_usd, 0, "PREFLIGHT_SPEND");
eq(preflight.cloudflare.active_anchor_retained, false, "ANCHOR_RETAINED");
eq(preflight.cloudflare.anchor_refresh_required_before_qualification, true, "REFRESH_REQUIRED");
eq(preflight.cloudflare.protected_signer_secret_present, false, "STALE_SIGNER");
eq(preflight.cloudflare.exact_route_probe.method, "POST", "ROUTE_METHOD");
eq(preflight.cloudflare.exact_route_probe.status, 404, "ROUTE_STATUS");
eq(preflight.cloudflare.exact_route_probe.code, "V207_ROUTE_DISABLED", "ROUTE_CODE");
eq(preflight.cloudflare.non_contract_get_probe.authoritative_for_route_fingerprint, false, "GET_AUTHORITY");

for (const [definition, max] of [[max1, 1], [max2, 2]]) {
  eq(definition.control_source_commit, expected.control, `CONFIG_${max}_CONTROL`);
  eq(definition.workers_min, 0, `CONFIG_${max}_MIN`);
  eq(definition.workers_max, max, `CONFIG_${max}_MAX`);
  eq(definition.gpu_type_ids.length, 1, `CONFIG_${max}_GPU_COUNT`);
  eq(definition.gpu_type_ids[0], "NVIDIA GeForce RTX 4090", `CONFIG_${max}_GPU`);
  eq(definition.template_environment.VIDEOFORGE_JOB_SCRATCH_ROOT, "/tmp/videoforge-jobs", `CONFIG_${max}_SCRATCH_ENV`);
  eq(definition.runtime_execution_contract.job_local_scratch, "/tmp/videoforge-jobs/jobs/${job_id}", `CONFIG_${max}_JOB_SCRATCH`);
  eq(definition.network_volume_mount, "/runpod-volume", `CONFIG_${max}_MOUNT`);
  eq(definition.volume_write_policy, "APPLICATION_READ_ONLY", `CONFIG_${max}_VOLUME_POLICY`);
}
eq(max2.terminal_contract.restore_definition, "staged-config-max1.json", "MAX1_RESTORE");
eq(max2.terminal_contract.workers_zero_after_drain, true, "MAX2_DRAIN");

eq(sha(path.join(root, "apps/web/src/server/providers/v207-live-orchestrator.ts")), expected.orchestrator, "ORCHESTRATOR_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/v207-live-qualification.ts")), expected.qualification, "QUALIFICATION_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts")), expected.reconciliation, "RECONCILIATION_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/v207-anchor-refresh-marker.ts")), expected.marker, "MARKER_BYTES");
eq(sha(path.join(root, "workers/image-media/mage_serverless.py")), expected.handler, "HANDLER_BYTES");

const activation = text(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"));
yes(activation.includes(expected.proposal), "ACTIVATION_PROPOSAL_POINTER");
yes(activation.includes("export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;"), "ACTIVATION_AUTHORITY_NOT_NULL");
yes(activation.includes("export const V207_APPROVED_FINITE_CAP_USD: number | null = null;"), "ACTIVATION_CAP_NOT_NULL");
yes(activation.includes("export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;"), "ACTIVATION_REFRESH_NOT_NULL");

console.log("PASS validate-v207-attempt49-authority-bound-lineage-candidate", JSON.stringify(expected));
