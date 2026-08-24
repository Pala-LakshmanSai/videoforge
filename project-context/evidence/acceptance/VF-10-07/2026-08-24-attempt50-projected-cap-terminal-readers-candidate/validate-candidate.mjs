#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const root = path.resolve(dir, "../../../../../");
const E = {
  proposal: "sha256:1a7dd058e81dc172440a5457db8c5f81ae099dc99c56d3bc36357f1dcd97badb",
  acceptance: "sha256:33fb4f18b1e1663b58b6334d1a371fc2c352d050635721378ad1cee4ff109561",
  max1: "sha256:6a70f6c1373f3525a9d6fb7cdb9eaaa11763322635d860a5512a7b1a6b477005",
  max2: "sha256:88e878b0cd1d041abd1a31b798c43305565da5873e4bb096736431b72b96143c",
  canonical: "sha256:c9295043d008a3622034a16e91ff30522a7bd19e5e10c7d40befe7cd42a48248",
  control: "9afbdca73b64209899a84555d771a3e7e81f51f6",
  orchestrator: "sha256:52d37b01230b4e5532266717c174e514f74fd05c37a4137a2b36e6d20b44e518",
  qualification: "sha256:82f3e2741a5e4bc415169d5d8ae1e2313eb145f89958a2bc74b7ec1ef9a98d7d",
  harness: "sha256:36325e2d156baf3a774fff710ed3ead2810b75c1c8c79e8be0f19b7621a0b12d",
  reconciliation: "sha256:33f5ad2874bd6fb51591c40486ddff2ea7cc27157003c9b98f3fe45bb97b3f8b",
  attempt49NoGo: "sha256:6eb7575c6cd96ddd04f27e5f672038c482cd32db2861d97c0b4d939960bd65ba",
};
const bytes = (f) => fs.readFileSync(f);
const text = (f) => bytes(f).toString("utf8");
const json = (f) => JSON.parse(text(f));
const sha = (f) => `sha256:${crypto.createHash("sha256").update(bytes(f)).digest("hex")}`;
const eq = (a, b, c) => { if (a !== b) throw new Error(`V207_ATTEMPT50_${c}`); };
const yes = (v, c) => { if (!v) throw new Error(`V207_ATTEMPT50_${c}`); };
const replaceExactlyOne = (source, pattern, replacement, code) => {
  const matches = source.match(pattern) ?? [];
  eq(matches.length, 1, code);
  return source.replace(pattern, replacement);
};
const canonicalActivation = (source) => {
  let canonical = replaceExactlyOne(
    source,
    /^export\s+const\s+V207_PENDING_PROPOSAL_SHA256\s*=\s*"sha256:[a-f0-9]{64}"\s+as\s+const\s*;/gmu,
    `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${"0".repeat(64)}" as const;`,
    "CANONICAL_PROPOSAL_DECLARATION",
  );
  canonical = replaceExactlyOne(
    canonical,
    /^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*(?:"sha256:[a-f0-9]{64}"|null)\s*;/gmu,
    "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;",
    "CANONICAL_AUTHORITY_DECLARATION",
  );
  canonical = replaceExactlyOne(
    canonical,
    /^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)\s*;/gmu,
    "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;",
    "CANONICAL_CAP_DECLARATION",
  );
  return replaceExactlyOne(
    canonical,
    /^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*(?:true|false|null)\s*;/gmu,
    "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;",
    "CANONICAL_REFRESH_DECLARATION",
  );
};

for (const [file, hash] of [["combined-live-proposal.json", E.proposal], ["acceptance.json", E.acceptance], ["staged-config-max1.json", E.max1], ["staged-config-max2.json", E.max2]]) eq(sha(path.join(dir, file)), hash, `${file}_HASH`);
const proposal = json(path.join(dir, "combined-live-proposal.json"));
const acceptance = json(path.join(dir, "acceptance.json"));
const max1 = json(path.join(dir, "staged-config-max1.json"));
const max2 = json(path.join(dir, "staged-config-max2.json"));
eq(proposal.attempt, 50, "ATTEMPT");
eq(proposal.authority_mode, "PENDING_FRESH_EXACT_APPROVAL_AND_POSITIVE_NUMERIC_CAP", "AUTHORITY_MODE");
eq(proposal.approval_request.requested_maximum_cumulative_finite_spend_usd, 4, "REQUESTED_CAP");
eq(proposal.approval_request.executable_cap_binding, null, "EXECUTABLE_CAP");
eq(proposal.approval_request.prior_attempt49_authority_or_cap_reuse_forbidden, true, "ATTEMPT49_REUSE");
eq(proposal.prior_attempt49.pre_activation_no_go_sha256, E.attempt49NoGo, "ATTEMPT49_NO_GO");
eq(proposal.provider_free_lineage.control_source_commit, E.control, "CONTROL");
eq(proposal.provider_free_lineage.qualification_harness_source_sha256, E.harness, "HARNESS");
eq(proposal.staged_endpoint_configs[0].definition_sha256, E.max1, "MAX1");
eq(proposal.staged_endpoint_configs[1].definition_sha256, E.max2, "MAX2");
eq(proposal.staged_endpoint_configs[0].workers_min, 0, "MAX1_MIN");
eq(proposal.staged_endpoint_configs[0].workers_max, 1, "MAX1_MAX");
eq(proposal.staged_endpoint_configs[1].workers_min, 0, "MAX2_MIN");
eq(proposal.staged_endpoint_configs[1].workers_max, 2, "MAX2_MAX");
eq(proposal.immutable_runtime.volume_mount, "/runpod-volume", "MOUNT");
eq(proposal.scratch_contract.exact_job_path, "/tmp/videoforge-jobs/jobs/${attempt_id}", "SCRATCH");
eq(proposal.provider_free_lineage.canonical_activation_source_sha256, E.canonical, "CANONICAL");
eq(proposal.projected_liability_cap_fence.completion_conditional_on_measured_durations_fitting_cap, true, "CONDITIONAL");
eq(proposal.projected_liability_cap_fence.stop_before_new_paid_work_if_headroom_insufficient, true, "HEADROOM");
eq(proposal.projected_liability_cap_fence.provider_final_invoice_absolute_guarantee, false, "NO_INVOICE_GUARANTEE");
yes(proposal.projected_liability_cap_fence.null_cancelled_narrowing_exception.includes("two consecutive exact zero queue/worker observations at least 100ms apart"), "CANCEL_TWO_ZERO");
yes(proposal.projected_liability_cap_fence.null_cancelled_narrowing_exception.includes("monotonic dispatch-to-second-zero"), "CANCEL_MONOTONIC");
yes(proposal.projected_liability_cap_fence.null_cancelled_narrowing_anomaly_policy.includes("retain full reservation"), "CANCEL_ANOMALY");
eq(proposal.acceptance_contract.complete_batches_only, true, "COMPLETE_BATCH");
eq(proposal.acceptance_contract.provider_status_output_receipt_reconciliation_required, true, "RECONCILIATION");
eq(proposal.acceptance_contract.at_most_one_acceptance_per_unit, true, "AT_MOST_ONE");
eq(proposal.acceptance_contract.duplicate_compute_and_cost_visibility_required, true, "DUPLICATE_COST");
eq(proposal.v2_08_authorized, false, "V208");
eq(acceptance.candidate.proposal_sha256, E.proposal, "ACCEPTANCE_PROPOSAL");
eq(acceptance.candidate.authority_recorded, false, "ACCEPTANCE_AUTHORITY");
eq(acceptance.candidate.executable_maximum_cumulative_finite_spend_usd, null, "ACCEPTANCE_CAP");
eq(acceptance.candidate.canonical_activation_source_sha256, E.canonical, "ACCEPTANCE_CANONICAL");
eq(acceptance.scratch_contract.exact_job_path, "/tmp/videoforge-jobs/jobs/${attempt_id}", "ACCEPTANCE_SCRATCH");
eq(acceptance.provider_boundary.provider_calls_authorized, false, "PROVIDER_OFF");
eq(acceptance.provider_boundary.external_spend_usd, 0, "SPEND_ZERO");
yes(acceptance.cap_truth.null_cancelled_narrowing_exception.includes("two exact zero queue/worker reads at least 100ms apart"), "ACCEPTANCE_CANCEL");
for (const [config, max] of [[max1, 1], [max2, 2]]) {
  eq(config.control_source_commit, E.control, `CONFIG_${max}_CONTROL`);
  eq(config.source_hashes.qualification_harness_sha256, E.harness, `CONFIG_${max}_HARNESS`);
  eq(config.source_hashes.canonical_activation_sha256, E.canonical, `CONFIG_${max}_CANONICAL`);
  eq(config.runtime_execution_contract.job_local_scratch, "/tmp/videoforge-jobs/jobs/${attempt_id}", `CONFIG_${max}_SCRATCH`);
  eq(config.workers_min, 0, `CONFIG_${max}_MIN`);
  eq(config.workers_max, max, `CONFIG_${max}_MAX`);
}
eq(sha(path.join(root, "apps/web/src/server/providers/v207-live-orchestrator.ts")), E.orchestrator, "ORCHESTRATOR_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/v207-live-qualification.ts")), E.qualification, "QUALIFICATION_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/runpod-v207-qualification-harness.ts")), E.harness, "HARNESS_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts")), E.reconciliation, "RECONCILIATION_BYTES");
const activation = text(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"));
yes(activation.includes(E.proposal), "ACTIVATION_POINTER");
yes(activation.includes(E.control), "ACTIVATION_CONTROL_POINTER");
yes(/^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*null\s*;/mu.test(activation), "ACTIVATION_AUTHORITY_NULL");
yes(/^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*null\s*;/mu.test(activation), "ACTIVATION_CAP_NULL");
yes(/^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*null\s*;/mu.test(activation), "ACTIVATION_REFRESH_NULL");
eq(
  `sha256:${crypto.createHash("sha256").update(canonicalActivation(activation), "utf8").digest("hex")}`,
  E.canonical,
  "CANONICAL_ACTIVATION_BYTES",
);
for (const f of ["project-context/CURRENT_STATE.yaml", "project-context/GATES.yaml", "project-context/tasks/VF-10-07.md"]) yes(text(path.join(root, f)).includes(E.proposal), `${f}_POINTER`);
console.log("PASS validate-v207-attempt50-projected-cap-terminal-readers-candidate", JSON.stringify(E));
