#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const root = path.resolve(dir, "../../../../../");
const E = {
  proposal: "sha256:5c2023d6451284b9ccdf64112e3bee6d8417ed6b0fa796520875ea080eead75f",
  acceptance: "sha256:a04962398607efcd8350e14417f86c185f2c2e5b8146286edf8843712d433b99",
  authority: "sha256:d8087eb316fd9d0f32d77db6343457a836a56f1d40c5d51cb2a2d89e98ceeefb",
  preflight: "sha256:86befdc3eee48ec030b73848fb2133f1be9f7ed2f76023bbc9b7d920b2a4fb55",
  max1: "sha256:2b9f6a9f5d3220491996c5b910205cdb18f21655735fcd1c8a1e40b14a032d1e",
  max2: "sha256:f897321d10e9d4a839f9bc675c24351fbc8b73c98bfb93a64c261a5359db0ff4",
  priorClosure: "sha256:267918ea297d63e614107815a01f2a45192be85495752008c375c229db98dec0",
  control: "3b40fd36767acde51ed979155a67ec4555a76400",
  orchestrator: "sha256:358a5b7c18c7985bd9e1f14cd73449715d1e00671df51f613080efa3ae4f1d9c",
  qualification: "sha256:861f8cd507c694a0d3ca48ddff8717e166a0bd327f0217114857b7e4eabd6d86",
  harness: "sha256:772249e8feab2c58600807d35844693baaa02d3706eb72d86773637061560cd4",
  reconciliation: "sha256:33f5ad2874bd6fb51591c40486ddff2ea7cc27157003c9b98f3fe45bb97b3f8b",
  canonical: "sha256:ce890309588c82408c4d5f5e9bf239bd6fa03e53ce10bf6b3814ac0f6b6f63aa",
  anchorVersion: "sha256:c0c3303f78987b630da7a425117b2587aeca563266458f6f4b0b20db6b014f33",
  anchorRecord: "sha256:1612a0d0582a9af311a5395f1920dde197ddad89f109ed396f35f3b4ef3840ad",
};
const bytes = (file) => fs.readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha = (file) => `sha256:${crypto.createHash("sha256").update(bytes(file)).digest("hex")}`;
const eq = (actual, expected, code) => {
  if (actual !== expected) throw new Error(`V207_ATTEMPT53_${code}`);
};
const yes = (value, code) => {
  if (!value) throw new Error(`V207_ATTEMPT53_${code}`);
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
  ["read-only-preflight.json", E.preflight],
  ["staged-config-max1.json", E.max1],
  ["staged-config-max2.json", E.max2],
]) {
  eq(sha(path.join(dir, file)), hash, `${file}_HASH`);
}
eq(
  sha(path.join(dir, "../2026-08-21-live-qualification/failed-attempt-52.json")),
  E.priorClosure,
  "PRIOR_CLOSURE_HASH",
);

const proposal = json(path.join(dir, "combined-live-proposal.json"));
const acceptance = json(path.join(dir, "acceptance.json"));
const authority = json(path.join(dir, "approved-authority.json"));
const preflight = json(path.join(dir, "read-only-preflight.json"));
const max1 = json(path.join(dir, "staged-config-max1.json"));
const max2 = json(path.join(dir, "staged-config-max2.json"));
eq(proposal.attempt, 53, "ATTEMPT");
eq(proposal.authority_mode, "PENDING_FRESH_EXACT_APPROVAL_AND_POSITIVE_NUMERIC_CAP", "AUTHORITY_MODE");
eq(proposal.provider_calls_authorized, false, "PROVIDER_CALLS");
eq(proposal.provider_mutation_authorized, false, "PROVIDER_MUTATION");
eq(proposal.gpu_use_authorized, false, "GPU");
eq(proposal.spend_usd, 0, "SPEND");
eq(proposal.approval_request.exact_proposal_approved, false, "UNAPPROVED");
eq(proposal.approval_request.executable_cap_binding, null, "NULL_CAP");
eq(proposal.approval_request.anchor_refresh_authorized, null, "NULL_REFRESH");
eq(proposal.approval_request.attempt52_authority_or_cap_reuse_forbidden, true, "NO_REUSE");
eq(proposal.provider_free_lineage.control_source_commit, E.control, "CONTROL");
eq(proposal.provider_free_lineage.canonical_activation_source_sha256, E.canonical, "CANONICAL");
eq(proposal.provider_free_preflight.sha256, E.preflight, "PREFLIGHT");
eq(proposal.fresh_cloudflare_read_only_truth.active_version_id_sha256, E.anchorVersion, "ANCHOR_VERSION");
eq(proposal.fresh_cloudflare_read_only_truth.active_record_sha256, E.anchorRecord, "ANCHOR_RECORD");
eq(proposal.staged_endpoint_configs[0].definition_sha256, E.max1, "MAX1");
eq(proposal.staged_endpoint_configs[1].definition_sha256, E.max2, "MAX2");
eq(proposal.retained_volume_mutation_authorized, false, "VOLUME_READONLY");
eq(proposal.v2_08_authorized, false, "V208");

eq(acceptance.candidate.proposal_sha256, E.proposal, "ACCEPTANCE_PROPOSAL");
eq(acceptance.candidate.authority_recorded, false, "ACCEPTANCE_AUTHORITY");
eq(acceptance.candidate.executable_maximum_cumulative_finite_spend_usd, null, "ACCEPTANCE_CAP");
eq(acceptance.anchor_rebind_proof.active_version_id_sha256, E.anchorVersion, "ACCEPTANCE_ANCHOR_VERSION");
eq(acceptance.anchor_rebind_proof.active_record_sha256, E.anchorRecord, "ACCEPTANCE_ANCHOR_RECORD");
eq(acceptance.stable_terminal_history_repair_proof.focused_stale_record_tests_passed, true, "STALE_TESTS");
eq(acceptance.provider_boundary.provider_calls_authorized, false, "ACCEPTANCE_PROVIDER");
eq(acceptance.provider_boundary.external_spend_usd, 0, "ACCEPTANCE_SPEND");
eq(acceptance.v2_08_authorized, false, "ACCEPTANCE_V208");

eq(authority.attempt, 53, "AUTHORITY_ATTEMPT");
eq(authority.status, "APPROVED_SINGLE_USE_PENDING_EXECUTION", "AUTHORITY_STATUS");
eq(authority.proposal.sha256, E.proposal, "AUTHORITY_PROPOSAL");
eq(authority.acceptance.sha256, E.acceptance, "AUTHORITY_ACCEPTANCE");
eq(authority.approval.maximum_cumulative_finite_spend_usd, 4, "AUTHORITY_CAP");
eq(authority.approval.anchor_refresh_authorized, true, "AUTHORITY_REFRESH");
eq(authority.approval.consumed, false, "AUTHORITY_UNCONSUMED");
eq(authority.lineage.control_source_commit, E.control, "AUTHORITY_CONTROL");
eq(authority.lineage.canonical_activation_source_sha256, E.canonical, "AUTHORITY_CANONICAL");
eq(authority.lineage.initial_config_sha256, E.max1, "AUTHORITY_MAX1");
eq(authority.lineage.concurrent_reader_config_sha256, E.max2, "AUTHORITY_MAX2");
eq(authority.execution_boundary.v2_08_authorized, false, "AUTHORITY_V208");

eq(preflight.authority.authority_recorded, false, "PREFLIGHT_AUTHORITY");
eq(preflight.authority.maximum_cumulative_finite_spend_usd, null, "PREFLIGHT_CAP");
eq(preflight.provider_mutations, 0, "PREFLIGHT_MUTATIONS");
eq(preflight.gpu_jobs_submitted, 0, "PREFLIGHT_GPU");
eq(preflight.cloudflare.active_version_id_sha256, E.anchorVersion, "PREFLIGHT_ANCHOR_VERSION");
eq(preflight.cloudflare.active_record_sha256, E.anchorRecord, "PREFLIGHT_ANCHOR_RECORD");

for (const [config, workersMax] of [
  [max1, 1],
  [max2, 2],
]) {
  eq(config.control_source_commit, E.control, `CONFIG_${workersMax}_CONTROL`);
  eq(config.source_hashes.canonical_activation_sha256, E.canonical, `CONFIG_${workersMax}_CANONICAL`);
  eq(config.workers_min, 0, `CONFIG_${workersMax}_MIN`);
  eq(config.workers_max, workersMax, `CONFIG_${workersMax}_MAX`);
  eq(config.cloudflare_anchor_refresh_contract.expected_old_active_version_id_sha256, E.anchorVersion, `CONFIG_${workersMax}_ANCHOR_VERSION`);
  eq(config.cloudflare_anchor_refresh_contract.expected_old_active_record_sha256, E.anchorRecord, `CONFIG_${workersMax}_ANCHOR_RECORD`);
}
eq(max1.process_replacement_contract.additional_distinct_terminal_pod_history_allowed, true, "HISTORY_ALLOWED");
eq(max1.process_replacement_contract.redispatch_before_boundary, false, "NO_REDISPATCH");

eq(sha(path.join(root, "apps/web/src/server/providers/v207-live-orchestrator.ts")), E.orchestrator, "ORCHESTRATOR_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/v207-live-qualification.ts")), E.qualification, "QUALIFICATION_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/runpod-v207-qualification-harness.ts")), E.harness, "HARNESS_BYTES");
eq(sha(path.join(root, "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts")), E.reconciliation, "RECONCILIATION_BYTES");
const activation = text(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"));
yes(activation.includes(E.proposal), "ACTIVATION_PROPOSAL");
yes(activation.includes(E.control), "ACTIVATION_CONTROL");
yes(activation.includes(E.authority), "ACTIVATION_AUTHORITY");
yes(/^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*4\s*;/mu.test(activation), "ACTIVATION_CAP");
yes(/^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*true\s*;/mu.test(activation), "ACTIVATION_REFRESH");
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
  "project-context/templates/CHECKPOINT_CHAT_PROMPTS.md",
]) {
  yes(text(path.join(root, file)).includes(E.proposal), `${file}_PROPOSAL_POINTER`);
}
console.log("PASS validate-v207-attempt53-active-anchor-rebind-candidate", JSON.stringify(E));
