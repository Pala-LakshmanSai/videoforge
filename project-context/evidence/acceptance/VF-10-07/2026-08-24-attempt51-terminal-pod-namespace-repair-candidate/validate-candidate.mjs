#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const root = path.resolve(dir, "../../../../../");
const E = {
  proposal: "sha256:5530958cae5413ac5dbd32b37567a717ee503ba1f154f8cc988b2c0ea51fdbd8",
  acceptance: "sha256:76e1c5b9b811647815660fbf50ac54087737b3492be812d7df503ee44a264885",
  max1: "sha256:cce816d3028c0e0e439f74f59ffbdc0319bf678893e3f4ebaf75cc1f9034c995",
  max2: "sha256:b84a15675471a6bffba23243e5d026604e1da9789d57e87d9946db5964ca42aa",
  canonical: "sha256:04df0f5e8640cb6063089bb933d932be501fd2d3bb8876f94cfabf9b106d3617",
  control: "f4054ed4865ed8fac1af53bd766cf2c5153c7e29",
  orchestrator: "sha256:52d37b01230b4e5532266717c174e514f74fd05c37a4137a2b36e6d20b44e518",
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
