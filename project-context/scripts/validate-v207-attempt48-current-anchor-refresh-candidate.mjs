#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const dir = path.join(root, "project-context/evidence/acceptance/VF-10-07/2026-08-24-attempt48-current-anchor-refresh-candidate");
const prior = path.join(root, "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt47-terminal-pod-identity-repair-candidate");
const expected = {
  proposal: "sha256:6ac58b154cd6d91b72f591128f5f9ed94af8ae3ad969bfce278c05d31f1c11c8",
  acceptance: "sha256:0a80c683aaa670ae8c11132e0601b56879d70e1857a6ad2e2c64cba6657c6384",
  authority: "sha256:1c2166d74fdb0a35271b50709720bd80fbbef7442dc28d35c16c534dc43760fa",
  orchestrator: "sha256:e2effd653c445a96eaea492c8578cf57d199972e5ddb1b38a734368c2139faad",
  canonical: "sha256:858ebe43ef8ad6558825d6b1c756311a8944cd2ef27e58f42651d793ab191da9",
  max1: "sha256:624dafe2f1a5fdfbf0435b87e3eecaca997281386d4a6c41339bfb5e78eb457a",
  max2: "sha256:9774e90daf86cfa8f7f8f17c4bd9319475ac5881d0c2667ca61f0a7412a9bfcb",
};
const fail = (code) => { throw new Error(`V207_ATTEMPT48_${code}`); };
const eq = (a, b, code) => { if (a !== b) fail(code); };
const yes = (v, code) => { if (!v) fail(code); };
const bytes = (file) => fs.readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha = (file) => `sha256:${crypto.createHash("sha256").update(bytes(file)).digest("hex")}`;

const proposalPath = path.join(dir, "combined-live-proposal.json");
const acceptancePath = path.join(dir, "acceptance.json");
const authorityPath = path.join(dir, "approved-authority.json");
eq(sha(proposalPath), expected.proposal, "PROPOSAL_HASH");
eq(sha(acceptancePath), expected.acceptance, "ACCEPTANCE_HASH");
eq(sha(authorityPath), expected.authority, "AUTHORITY_HASH");
const proposal = json(proposalPath);
const acceptance = json(acceptancePath);
const authority = json(authorityPath);
eq(proposal.attempt, 48, "ATTEMPT");
eq(proposal.authority_mode, "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP", "AUTHORITY_MODE");
eq(proposal.approval_request.exact_proposal_approved, false, "NOT_APPROVED");
eq(proposal.approval_request.maximum_cumulative_finite_spend_usd, null, "NO_CAP");
eq(proposal.approval_request.anchor_refresh_authorized, true, "REFRESH_REQUEST");
eq(proposal.approval_request.flashboot, true, "FLASHBOOT");
eq(proposal.approval_request.minimum_availability, "LOW-or-better", "AVAILABILITY");
eq(proposal.lineage.orchestrator_source_sha256, expected.orchestrator, "ORCHESTRATOR_LINEAGE");
eq(proposal.lineage.canonical_activation_source_sha256, expected.canonical, "CANONICAL_LINEAGE");
eq(proposal.lineage.volume_mount, "/runpod-volume", "MOUNT");
eq(proposal.lineage.volume_size_gb, 50, "VOLUME_SIZE");
eq(proposal.lineage.volume_region, "EU-RO-1", "REGION");
eq(proposal.lineage.gpu, "NVIDIA GeForce RTX 4090", "GPU");
eq(proposal.lineage.flex_only, true, "FLEX_ONLY");
eq(proposal.lineage.prior_attempt.authority_consumed, true, "PRIOR_CONSUMED");
eq(proposal.protected_config_anchor_refresh.baseline_sha256, "sha256:da8c9232c9f6fe0f745a16f56f0855d726092df205e08eda6725fc0a146db774", "CONFIG_BASELINE");
eq(proposal.protected_config_anchor_refresh.projected_marker_sha256, "sha256:c643af2fe7d6325396b2527bcbe92d9422c6126aa3328530b8dfaa36b7bc08e5", "CONFIG_PROJECTED");
eq(proposal.protected_config_anchor_refresh.mode, "0600", "CONFIG_MODE");
eq(proposal.protected_config_anchor_refresh.terminal_revert_required, true, "CONFIG_REVERT");
eq(proposal.cloudflare_anchor_refresh.expected_old_active_version_id_sha256, "sha256:ee4c0d1dd0e4c05cb4067f312ea7a4e656d27f1e96e678c815565c2ca2ff4ea0", "OLD_VERSION");
eq(proposal.cloudflare_anchor_refresh.expected_old_active_record_sha256, "sha256:5b2768ef36f1ad131b1838e2fb3ca7eb1329827b607a6bcd1fca6a9c443c3878", "OLD_RECORD");
eq(proposal.cloudflare_anchor_refresh.version_index_or_count_claimed, false, "NO_STALE_INDEX");
eq(proposal.cloudflare_anchor_refresh.qualification_may_start_only_after_refresh_proof, true, "REFRESH_FIRST");
eq(proposal.staged_endpoint_configs[0].definition_sha256, expected.max1, "MAX1");
eq(proposal.staged_endpoint_configs[1].definition_sha256, expected.max2, "MAX2");
eq(sha(path.join(prior, "staged-config-max1.json")), expected.max1, "MAX1_BYTES");
eq(sha(path.join(prior, "staged-config-max2.json")), expected.max2, "MAX2_BYTES");
eq(proposal.cost.baseline_endpoint_spend_usd, 1.6217972798040137, "BASELINE_SPEND");
eq(proposal.cost.finite_action_estimate_usd, 3.95, "ESTIMATE");
eq(proposal.cost.proposed_finite_cap_usd, null, "PROPOSED_CAP_NULL");
eq(proposal.cost.serverless_flex_rtx4090_usd_per_gpu_hour, 1.1, "RATE");
eq(proposal.cost.existing_two_volume_charge_usd_per_month, 7, "VOLUME_RATE");
eq(proposal.v2_08_authorized, false, "V208");
eq(acceptance.candidate.proposal_sha256, expected.proposal, "ACCEPTANCE_PROPOSAL");
eq(acceptance.candidate.authority_recorded, false, "ACCEPTANCE_NO_AUTHORITY");
eq(acceptance.provider_boundary.provider_calls_authorized, false, "PROVIDER_OFF");
eq(acceptance.provider_boundary.gpu_use_authorized, false, "GPU_OFF");
eq(authority.attempt, 48, "AUTHORITY_ATTEMPT");
eq(authority.status, "APPROVED_SINGLE_USE_PENDING_EXECUTION", "AUTHORITY_STATUS");
eq(authority.proposal.sha256, expected.proposal, "AUTHORITY_PROPOSAL");
eq(authority.acceptance.sha256, expected.acceptance, "AUTHORITY_ACCEPTANCE");
eq(authority.approval.exact_proposal_approved, true, "AUTHORITY_EXACT_APPROVAL");
eq(authority.approval.flashboot_true_accepted, true, "AUTHORITY_FLASHBOOT");
eq(authority.approval.minimum_approved_availability, "LOW-or-better", "AUTHORITY_AVAILABILITY");
eq(authority.approval.maximum_cumulative_finite_spend_usd, 4, "AUTHORITY_CAP");
eq(authority.approval.anchor_refresh_authorized, true, "AUTHORITY_REFRESH");
eq(authority.execution_boundary.retained_volume_mutation_authorized, false, "AUTHORITY_VOLUME_FENCE");
eq(authority.execution_boundary.v2_08_authorized, false, "AUTHORITY_V208_FENCE");
eq(JSON.stringify(authority.approved_operations), JSON.stringify(proposal.operations), "AUTHORITY_OPERATIONS");

eq(sha(path.join(root, "apps/web/src/server/providers/v207-live-orchestrator.ts")), expected.orchestrator, "ORCHESTRATOR_BYTES");
const marker = text(path.join(root, "apps/web/src/server/providers/v207-anchor-refresh-marker.ts"));
yes(marker.includes(proposal.protected_config_anchor_refresh.baseline_sha256), "MARKER_BASELINE_BINDING");
yes(marker.includes(proposal.protected_config_anchor_refresh.projected_marker_sha256), "MARKER_PROJECTED_BINDING");
const activation = text(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"));
yes(activation.includes(expected.proposal), "ACTIVATION_PROPOSAL");
yes(activation.includes("export const V207_APPROVED_FINITE_CAP_USD: number | null = null;"), "ACTIVATION_CAP_CONSUMED");
yes(activation.includes("export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;"), "ACTIVATION_REFRESH_CONSUMED");
const gates = text(path.join(root, "project-context/GATES.yaml"));
yes(gates.includes(expected.proposal), "GATES_PROPOSAL");
yes(gates.includes(expected.acceptance), "GATES_ACCEPTANCE");
yes(gates.includes('pending_control_source_commit: "3bfeff00b62945936bdbfc1e7dede9037ef4a31e"'), "GATES_CONTROL");
yes(gates.includes(`pending_orchestrator_source_sha256: "${expected.orchestrator}"`), "GATES_ORCHESTRATOR");
yes(gates.includes(`pending_authority_sha256: "${expected.authority}"`), "GATES_AUTHORITY");
yes(gates.includes("pending_numeric_cap_usd: 0"), "GATES_CAP_CONSUMED");
yes(gates.includes("pending_old_active_index_oldest_to_newest: null"), "GATES_NO_STALE_INDEX");

console.log("PASS validate-v207-attempt48-current-anchor-refresh-candidate", JSON.stringify(expected));
