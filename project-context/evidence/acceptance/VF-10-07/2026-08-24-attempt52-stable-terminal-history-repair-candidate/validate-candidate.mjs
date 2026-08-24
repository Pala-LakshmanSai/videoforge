#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const root = path.resolve(dir, "../../../../../");
const E = {
  proposal: "sha256:af1c2da86886bc3b4d077a30bf9ab720de6a39aa9fe4e8ec351697df5b224e77",
  acceptance: "sha256:193f1066714e2e778cf2266564c0bfd0c6b65976d4f85ea862416033febea300",
  authority: "sha256:3b15fca048ba4eb570a27b5a6e6d521a415e27c556c230757b6702e0c1017453",
  max1: "sha256:6a227655b4ed8b6e36bacc3d373c6de12be5c53ff68fb7a0c97accde4fcd60f2",
  max2: "sha256:c293dd01d90d2b587a263cfe0729271b25e4f76cf88469f1d6912b019865def7",
  priorClosure: "sha256:c2ac52ad7b5600c472be09be6d1ba5376194c9a4e1f192242ec281b686eab02a",
  control: "ec39d091745394f4ebb84362d1c2a9fc1e18b1c3",
  orchestrator: "sha256:57e81e3bc75704156f0cba191d987ce89c32428a91e34ea80954b4dc7159b4e0",
  qualification: "sha256:861f8cd507c694a0d3ca48ddff8717e166a0bd327f0217114857b7e4eabd6d86",
  harness: "sha256:772249e8feab2c58600807d35844693baaa02d3706eb72d86773637061560cd4",
  reconciliation: "sha256:33f5ad2874bd6fb51591c40486ddff2ea7cc27157003c9b98f3fe45bb97b3f8b",
  canonical: "sha256:c79cc35c2e41ca0cce06caf6913c4154a3ae9799ecf875d84b027cbbda706248",
};
const bytes = (file) => fs.readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha = (file) =>
  `sha256:${crypto.createHash("sha256").update(bytes(file)).digest("hex")}`;
const eq = (actual, expected, code) => {
  if (actual !== expected) throw new Error(`V207_ATTEMPT52_${code}`);
};
const yes = (value, code) => {
  if (!value) throw new Error(`V207_ATTEMPT52_${code}`);
};
const replaceOne = (source, pattern, replacement, code) => {
  eq((source.match(pattern) ?? []).length, 1, code);
  return source.replace(pattern, replacement);
};
const canonicalActivation = (source) => {
  let result = replaceOne(
    source,
    /^export\s+const\s+V207_PENDING_PROPOSAL_SHA256\s*=\s*"sha256:[a-f0-9]{64}"\s+as\s+const\s*;/gmu,
    `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${"0".repeat(64)}" as const;`,
    "CANONICAL_PROPOSAL",
  );
  result = replaceOne(
    result,
    /^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*(?:"sha256:[a-f0-9]{64}"|null)\s*;/gmu,
    "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;",
    "CANONICAL_AUTHORITY",
  );
  result = replaceOne(
    result,
    /^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)\s*;/gmu,
    "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;",
    "CANONICAL_CAP",
  );
  return replaceOne(
    result,
    /^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*(?:true|false|null)\s*;/gmu,
    "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;",
    "CANONICAL_REFRESH",
  );
};

for (const [file, hash] of [
  ["combined-live-proposal.json", E.proposal],
  ["acceptance.json", E.acceptance],
  ["approved-authority.json", E.authority],
  ["staged-config-max1.json", E.max1],
  ["staged-config-max2.json", E.max2],
]) {
  eq(sha(path.join(dir, file)), hash, `${file}_HASH`);
}
eq(
  sha(path.join(dir, "../2026-08-21-live-qualification/failed-attempt-51.json")),
  E.priorClosure,
  "PRIOR_CLOSURE_HASH",
);

const proposal = json(path.join(dir, "combined-live-proposal.json"));
const acceptance = json(path.join(dir, "acceptance.json"));
const authority = json(path.join(dir, "approved-authority.json"));
const max1 = json(path.join(dir, "staged-config-max1.json"));
const max2 = json(path.join(dir, "staged-config-max2.json"));
eq(proposal.attempt, 52, "ATTEMPT");
eq(proposal.authority_mode, "PENDING_FRESH_EXACT_APPROVAL_AND_POSITIVE_NUMERIC_CAP", "AUTHORITY_MODE");
eq(proposal.provider_calls_authorized, false, "PROVIDER_CALLS");
eq(proposal.provider_mutation_authorized, false, "PROVIDER_MUTATION");
eq(proposal.gpu_use_authorized, false, "GPU");
eq(proposal.spend_usd, 0, "SPEND");
eq(proposal.approval_request.exact_proposal_approved, false, "UNAPPROVED");
eq(proposal.approval_request.executable_cap_binding, null, "NULL_CAP");
eq(proposal.approval_request.anchor_refresh_authorized, null, "NULL_REFRESH");
eq(proposal.approval_request.attempt51_authority_or_cap_reuse_forbidden, true, "NO_REUSE");
eq(proposal.provider_free_lineage.control_source_commit, E.control, "CONTROL");
eq(proposal.provider_free_lineage.qualification_harness_source_sha256, E.harness, "HARNESS");
eq(proposal.provider_free_lineage.canonical_activation_source_sha256, E.canonical, "CANONICAL");
eq(proposal.staged_endpoint_configs[0].definition_sha256, E.max1, "MAX1");
eq(proposal.staged_endpoint_configs[1].definition_sha256, E.max2, "MAX2");
eq(proposal.projected_liability_cap_fence.stop_before_new_paid_work_if_headroom_insufficient, true, "CAP_FENCE");
eq(proposal.retained_volume_mutation_authorized, false, "VOLUME_READONLY");
eq(proposal.v2_08_authorized, false, "V208");

eq(acceptance.candidate.proposal_sha256, E.proposal, "ACCEPTANCE_PROPOSAL");
eq(acceptance.candidate.authority_recorded, false, "ACCEPTANCE_AUTHORITY");
eq(acceptance.candidate.executable_maximum_cumulative_finite_spend_usd, null, "ACCEPTANCE_CAP");
eq(acceptance.provider_boundary.provider_calls_authorized, false, "ACCEPTANCE_PROVIDER");
eq(acceptance.provider_boundary.external_spend_usd, 0, "ACCEPTANCE_SPEND");
eq(acceptance.repair_proof.signed_runtime_pod_must_match_exactly_once_among_endpoint_bound_terminal_history, true, "UNIQUE_MATCH");
eq(acceptance.repair_proof.additional_distinct_terminal_pod_history_is_not_receipt_identity, true, "STALE_HISTORY");
eq(acceptance.repair_proof.active_worker_and_running_pod_counts_must_be_zero, true, "ZERO_ACTIVE");
eq(acceptance.v2_08_authorized, false, "ACCEPTANCE_V208");

eq(authority.attempt, 52, "AUTHORITY_ATTEMPT");
eq(authority.status, "APPROVED_SINGLE_USE_PENDING_EXECUTION", "AUTHORITY_STATUS");
eq(authority.proposal.sha256, E.proposal, "AUTHORITY_PROPOSAL");
eq(authority.acceptance.sha256, E.acceptance, "AUTHORITY_ACCEPTANCE");
eq(authority.approval.maximum_cumulative_finite_spend_usd, 4, "AUTHORITY_CAP");
eq(authority.approval.anchor_refresh_authorized, true, "AUTHORITY_REFRESH");
eq(authority.approval.consumed, false, "AUTHORITY_UNCONSUMED");
eq(authority.lineage.control_source_commit, E.control, "AUTHORITY_CONTROL");
eq(authority.lineage.qualification_harness_source_sha256, E.harness, "AUTHORITY_HARNESS");
eq(authority.lineage.canonical_activation_source_sha256, E.canonical, "AUTHORITY_CANONICAL");
eq(authority.lineage.initial_config_sha256, E.max1, "AUTHORITY_MAX1");
eq(authority.lineage.concurrent_reader_config_sha256, E.max2, "AUTHORITY_MAX2");
eq(authority.execution_boundary.v2_08_authorized, false, "AUTHORITY_V208");

for (const [config, workersMax] of [
  [max1, 1],
  [max2, 2],
]) {
  eq(config.control_source_commit, E.control, `CONFIG_${workersMax}_CONTROL`);
  eq(config.source_hashes.qualification_harness_sha256, E.harness, `CONFIG_${workersMax}_HARNESS`);
  eq(config.source_hashes.canonical_activation_sha256, E.canonical, `CONFIG_${workersMax}_CANONICAL`);
  eq(config.workers_min, 0, `CONFIG_${workersMax}_MIN`);
  eq(config.workers_max, workersMax, `CONFIG_${workersMax}_MAX`);
}
eq(max1.process_replacement_contract.additional_distinct_terminal_pod_history_allowed, true, "HISTORY_ALLOWED");
eq(max1.process_replacement_contract.all_worker_and_pod_records_terminal_required, true, "ALL_TERMINAL");
eq(max1.process_replacement_contract.active_workers_and_running_pods_zero_required, true, "ZERO_ACTIVE_CONFIG");
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
eq(
  `sha256:${crypto.createHash("sha256").update(canonicalActivation(activation), "utf8").digest("hex")}`,
  E.canonical,
  "CANONICAL_ACTIVATION_BYTES",
);
for (const file of [
  "project-context/CURRENT_STATE.yaml",
  "project-context/GATES.yaml",
  "project-context/00_START_HERE.md",
  "project-context/tasks/VF-10-07.md",
]) {
  yes(text(path.join(root, file)).includes(E.proposal), `${file}_PROPOSAL_POINTER`);
}
console.log("PASS validate-v207-attempt52-stable-terminal-history-repair-candidate", JSON.stringify(E));
