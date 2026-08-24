#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const root = path.resolve(dir, "../../../../../");
const E = {
  proposal: "sha256:739aa53d398c223a690758e66f03fed437c5eaf51526ea52a33283fa1918c3fe",
  acceptance: "sha256:be67953bc6189adcacff5c06b265f340cbbcdb045f19efbfc426bc4d695a856b",
  max1: "sha256:c2c31282f991c08677d9b49c1b6a367ba945c3fa232b48354e8913e14889ba5e",
  max2: "sha256:e1b23717ccf3b4b03a281936602e3b0f36ef19345a4ba22db9afc78585cb7f8c",
  canonical: "sha256:04df0f5e8640cb6063089bb933d932be501fd2d3bb8876f94cfabf9b106d3617",
  control: "f4054ed4865ed8fac1af53bd766cf2c5153c7e29",
  orchestrator: "sha256:57e81e3bc75704156f0cba191d987ce89c32428a91e34ea80954b4dc7159b4e0",
  qualification: "sha256:861f8cd507c694a0d3ca48ddff8717e166a0bd327f0217114857b7e4eabd6d86",
  harness: "sha256:367e9c0aa57909b8b91e8bfd9aade181a2c849f43356e1e123f39882e25f2821",
  reconciliation: "sha256:33f5ad2874bd6fb51591c40486ddff2ea7cc27157003c9b98f3fe45bb97b3f8b",
};
const bytes = (f) => fs.readFileSync(f);
const text = (f) => bytes(f).toString("utf8");
const json = (f) => JSON.parse(text(f));
const sha = (f) => `sha256:${crypto.createHash("sha256").update(bytes(f)).digest("hex")}`;
const eq = (a, b, c) => { if (a !== b) throw new Error(`V207_ATTEMPT51_${c}`); };
const yes = (v, c) => { if (!v) throw new Error(`V207_ATTEMPT51_${c}`); };
const replaceOne = (source, pattern, replacement, code) => {
  eq((source.match(pattern) ?? []).length, 1, code);
  return source.replace(pattern, replacement);
};
const canonicalActivation = (source) => {
  let result = replaceOne(source, /^export\s+const\s+V207_PENDING_PROPOSAL_SHA256\s*=\s*"sha256:[a-f0-9]{64}"\s+as\s+const\s*;/gmu, `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${"0".repeat(64)}" as const;`, "CANONICAL_PROPOSAL");
  result = replaceOne(result, /^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*(?:"sha256:[a-f0-9]{64}"|null)\s*;/gmu, "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;", "CANONICAL_AUTHORITY");
  result = replaceOne(result, /^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)\s*;/gmu, "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;", "CANONICAL_CAP");
  return replaceOne(result, /^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*(?:true|false|null)\s*;/gmu, "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;", "CANONICAL_REFRESH");
};

for (const [file, hash] of [
  ["combined-live-proposal.json", E.proposal],
  ["acceptance.json", E.acceptance],
  ["staged-config-max1.json", E.max1],
  ["staged-config-max2.json", E.max2],
]) eq(sha(path.join(dir, file)), hash, `${file}_HASH`);
yes(!fs.existsSync(path.join(dir, "approved-authority.json")), "NO_AUTHORITY_FILE");

const proposal = json(path.join(dir, "combined-live-proposal.json"));
const acceptance = json(path.join(dir, "acceptance.json"));
const max1 = json(path.join(dir, "staged-config-max1.json"));
const max2 = json(path.join(dir, "staged-config-max2.json"));
eq(proposal.attempt, 51, "ATTEMPT");
eq(proposal.authority_mode, "PENDING_FRESH_EXACT_APPROVAL_AND_POSITIVE_NUMERIC_CAP", "AUTHORITY_MODE");
eq(proposal.provider_calls_authorized, false, "PROVIDER_CALLS");
eq(proposal.provider_mutation_authorized, false, "PROVIDER_MUTATION");
eq(proposal.gpu_use_authorized, false, "GPU");
eq(proposal.spend_usd, 0, "SPEND");
eq(proposal.approval_request.exact_proposal_approved, false, "UNAPPROVED");
eq(proposal.approval_request.executable_cap_binding, null, "NULL_CAP");
eq(proposal.approval_request.anchor_refresh_authorized, null, "NULL_REFRESH");
eq(proposal.approval_request.attempt50_authority_or_cap_reuse_forbidden, true, "NO_REUSE");
eq(proposal.provider_free_lineage.control_source_commit, E.control, "CONTROL");
eq(proposal.provider_free_lineage.qualification_harness_source_sha256, E.harness, "HARNESS");
eq(proposal.provider_free_lineage.live_qualification_source_sha256, E.qualification, "QUALIFICATION");
eq(proposal.provider_free_lineage.canonical_activation_source_sha256, E.canonical, "CANONICAL");
eq(proposal.provider_free_lineage.orchestrator_source_sha256, E.orchestrator, "ORCHESTRATOR");
eq(proposal.last_terminal_read_only_truth.cumulative_endpoint_spend_usd, 1.645446196460398, "FRESH_BILLING");
eq(proposal.approval_request.last_observed_availability, "LOW", "FRESH_AVAILABILITY");
eq(proposal.fresh_cloudflare_read_only_truth.active_version_id_sha256, "sha256:05478fd7e83a2886edd70ed3558d29d253f2a37b7d0dbe100d5a30b97ad42c52", "FRESH_ANCHOR_VERSION");
eq(proposal.fresh_cloudflare_read_only_truth.active_record_sha256, "sha256:64fef83e5b77393eeb9d2d6e91a7e0f6b56a0a941d0ebe535707d1ef9e12e969", "FRESH_ANCHOR_RECORD");
eq(proposal.fresh_cloudflare_read_only_truth.active_anchor_retained, true, "FRESH_ANCHOR_RETAINED");
eq(proposal.immutable_runtime.image_rebuild_or_republication, false, "NO_IMAGE_REBUILD");
eq(proposal.immutable_runtime.volume_mount, "/runpod-volume", "MOUNT");
eq(proposal.scratch_contract.exact_job_path, "/tmp/videoforge-jobs/jobs/${attempt_id}", "SCRATCH");
eq(proposal.staged_endpoint_configs[0].definition_sha256, E.max1, "MAX1");
eq(proposal.staged_endpoint_configs[1].definition_sha256, E.max2, "MAX2");
eq(proposal.staged_endpoint_configs[0].workers_min, 0, "MAX1_MIN");
eq(proposal.staged_endpoint_configs[0].workers_max, 1, "MAX1_MAX");
eq(proposal.staged_endpoint_configs[1].workers_min, 0, "MAX2_MIN");
eq(proposal.staged_endpoint_configs[1].workers_max, 2, "MAX2_MAX");
eq(proposal.acceptance_contract.complete_batches_only, true, "COMPLETE_BATCH");
eq(proposal.acceptance_contract.at_most_one_acceptance_per_unit, true, "AT_MOST_ONE");
eq(proposal.acceptance_contract.duplicate_compute_and_cost_visibility_required, true, "DUPLICATE_COST");
eq(proposal.projected_liability_cap_fence.stop_before_new_paid_work_if_headroom_insufficient, true, "CAP_FENCE");
eq(proposal.retained_volume_mutation_authorized, false, "VOLUME_READONLY");
eq(proposal.v2_08_authorized, false, "V208");

eq(acceptance.candidate.proposal_sha256, E.proposal, "ACCEPTANCE_PROPOSAL");
eq(acceptance.candidate.authority_recorded, false, "ACCEPTANCE_AUTHORITY");
eq(acceptance.candidate.executable_maximum_cumulative_finite_spend_usd, null, "ACCEPTANCE_CAP");
eq(acceptance.candidate.anchor_refresh_authorized, null, "ACCEPTANCE_REFRESH");
eq(acceptance.provider_boundary.provider_calls_authorized, false, "ACCEPTANCE_PROVIDER");
eq(acceptance.provider_boundary.external_spend_usd, 0, "ACCEPTANCE_SPEND");
yes(acceptance.remaining_p1.includes("NO_SINGLE_IMMUTABLE_PAID_RUN"), "P1_OPEN");
eq(acceptance.v2_08_authorized, false, "ACCEPTANCE_V208");

for (const [config, workersMax] of [[max1, 1], [max2, 2]]) {
  eq(config.control_source_commit, E.control, `CONFIG_${workersMax}_CONTROL`);
  eq(config.source_hashes.qualification_harness_sha256, E.harness, `CONFIG_${workersMax}_HARNESS`);
  eq(config.source_hashes.live_qualification_sha256, E.qualification, `CONFIG_${workersMax}_QUALIFICATION`);
  eq(config.source_hashes.canonical_activation_sha256, E.canonical, `CONFIG_${workersMax}_CANONICAL`);
  eq(config.workers_min, 0, `CONFIG_${workersMax}_MIN`);
  eq(config.workers_max, workersMax, `CONFIG_${workersMax}_MAX`);
  eq(config.runtime_execution_contract.job_local_scratch, "/tmp/videoforge-jobs/jobs/${attempt_id}", `CONFIG_${workersMax}_SCRATCH`);
}
eq(max1.process_replacement_contract.provider_worker_record_id_is_separate_namespace, true, "NAMESPACE");
eq(max1.process_replacement_contract.sole_worker_record_terminal_required, true, "TERMINAL_WORKER");
eq(max1.process_replacement_contract.redispatch_before_boundary, false, "NO_REDISPATCH");

eq(sha(path.join(root, "apps/web/src/server/providers/v207-live-orchestrator.ts")), E.orchestrator, "ORCHESTRATOR_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/v207-live-qualification.ts")), E.qualification, "QUALIFICATION_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/runpod-v207-qualification-harness.ts")), E.harness, "HARNESS_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts")), E.reconciliation, "RECONCILIATION_BYTES");
const activation = text(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"));
yes(activation.includes(E.proposal), "ACTIVATION_PROPOSAL");
yes(activation.includes(E.control), "ACTIVATION_CONTROL");
yes(/^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*null\s*;/mu.test(activation), "ACTIVATION_NO_AUTHORITY");
yes(/^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*null\s*;/mu.test(activation), "ACTIVATION_NO_CAP");
yes(/^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*null\s*;/mu.test(activation), "ACTIVATION_NO_REFRESH");
eq(`sha256:${crypto.createHash("sha256").update(canonicalActivation(activation), "utf8").digest("hex")}`, E.canonical, "CANONICAL_ACTIVATION_BYTES");
for (const file of ["project-context/CURRENT_STATE.yaml", "project-context/GATES.yaml", "project-context/00_START_HERE.md", "project-context/tasks/VF-10-07.md"]) {
  yes(text(path.join(root, file)).includes(E.proposal), `${file}_PROPOSAL_POINTER`);
}
console.log("PASS validate-v207-attempt51-terminal-pod-namespace-repair-candidate", JSON.stringify(E));
