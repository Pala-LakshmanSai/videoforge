import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:d3481231340fb7a4a22ae1047103024ca37e6b75c70c37d36c3bfb2a9baaff1f",
  preflight: "sha256:46883e09bd784dd05a4017a6519d0935f02b29b861d9cb2b9b9cd0037b29353e",
  acceptance: "sha256:8b28f952c517de1fc11d0e1a41811a97364e7acc99c62fede13b8a71ce674028",
  max1: "sha256:62167243073a7c35c9b7b0d2701971fae2da1366a56aa1b6a303b67c1f2fa368",
  max2: "sha256:551b30c3e669d4127390bf5cb9b7c6c1a3ce9cb76a9bd9b400350a6f4e2d48ee",
  approvedAuthority: "sha256:966159fc2afa2cf0a6365c5e3b017041effbf5b1f4f312aa4fde310f3d921c0d",
  authority: "sha256:47e06a69ece45babed6e8c1c32544d13033680901995ba77cdfc70e4cbd70818",
  blocker: "sha256:7efb0aa952bf03ed24e2e141993e38891d36fd4dbda04bf3bf956840e527dbbd",
  control: "85391b130673200e2d1f74fea4ea2581d5d83c1a",
  orchestrator: "sha256:5298ec25000e42affb7e36b518b778fa692e65b72d868087d58fbd81e6cfc42c",
  canonical: "sha256:36a23948ce41b7344af81a8a8abfd44e7d356d9a12c10731aefed1f3ce36a6b3",
};
const bytes = (file) => fs.readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha = (file) => `sha256:${crypto.createHash("sha256").update(bytes(file)).digest("hex")}`;
const eq = (actual, wanted, code) => {
  if (actual !== wanted) throw new Error(`V207_ATTEMPT55_${code}`);
};
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

for (const [name, wanted] of [["combined-live-proposal.json", expected.proposal], ["read-only-preflight.json", expected.preflight], ["acceptance.json", expected.acceptance], ["approved-authority.json", expected.authority], ["staged-config-max1.json", expected.max1], ["staged-config-max2.json", expected.max2]]) eq(sha(path.join(dir, name)), wanted, `${name}_HASH`);
const proposal = json(path.join(dir, "combined-live-proposal.json"));
const preflight = json(path.join(dir, "read-only-preflight.json"));
const acceptance = json(path.join(dir, "acceptance.json"));
const authority = json(path.join(dir, "approved-authority.json"));
const blockerPath = path.join(dir, "../2026-08-21-live-qualification/blocked-attempt-55-executable-anchor-lineage-mismatch.json");
const blocker = json(blockerPath);
const configs = [json(path.join(dir, "staged-config-max1.json")), json(path.join(dir, "staged-config-max2.json"))];
eq(proposal.approval_request.requested_maximum_cumulative_finite_spend_usd, 4, "CAP");
eq(proposal.approval_request.executable_cap_binding, null, "NULL_CAP");
eq(proposal.approval_request.anchor_refresh_authorized, null, "NULL_REFRESH");
eq(proposal.approval_request.attempt54_authority_or_cap_reuse_forbidden, true, "NO_REUSE");
eq(proposal.provider_free_lineage.control_source_commit, expected.control, "PROPOSAL_CONTROL");
eq(proposal.provider_free_lineage.orchestrator_source_sha256, expected.orchestrator, "PROPOSAL_ORCHESTRATOR");
eq(proposal.provider_free_lineage.canonical_activation_source_sha256, expected.canonical, "PROPOSAL_CANONICAL");
eq(acceptance.proposal_sha256, expected.proposal, "ACCEPTANCE_PROPOSAL");
eq(acceptance.lineage_acceptance.control_source_commit, expected.control, "ACCEPTANCE_CONTROL");
eq(acceptance.lineage_acceptance.orchestrator_source_sha256, expected.orchestrator, "ACCEPTANCE_ORCHESTRATOR");
eq(acceptance.lineage_acceptance.canonical_activation_source_sha256, expected.canonical, "ACCEPTANCE_CANONICAL");
eq(acceptance.v2_08_started, false, "ACCEPTANCE_V2_08");
eq(sha(blockerPath), expected.blocker, "BLOCKER_HASH");
eq(authority.status, "CONSUMED_NON_REUSABLE_ATTEMPT55_EXECUTABLE_ANCHOR_LINEAGE_MISMATCH", "AUTHORITY_STATUS");
eq(authority.proposal.sha256, expected.proposal, "AUTHORITY_PROPOSAL");
eq(authority.acceptance.sha256, expected.acceptance, "AUTHORITY_ACCEPTANCE");
eq(authority.approval.maximum_cumulative_finite_spend_usd, 4, "AUTHORITY_CAP");
eq(authority.approval.fresh_numeric_cap, true, "AUTHORITY_FRESH_CAP");
eq(authority.approval.historical_cap_reused, false, "AUTHORITY_HISTORICAL_CAP_REUSE");
eq(authority.approval.prior_authority_reused, false, "AUTHORITY_PRIOR_REUSE");
eq(authority.approval.single_use, true, "AUTHORITY_SINGLE_USE");
eq(authority.approval.consumed, true, "AUTHORITY_CONSUMED");
eq(authority.approval.anchor_refresh_authorized, true, "AUTHORITY_REFRESH");
eq(authority.approval.exact_launcher_activation, "V207_ROLLBACK_ANCHOR_REFRESH=two-phase-v1", "AUTHORITY_REFRESH_MODE");
eq(authority.lineage.control_source_commit, expected.control, "AUTHORITY_CONTROL");
eq(authority.lineage.orchestrator_source_sha256, expected.orchestrator, "AUTHORITY_ORCHESTRATOR");
eq(authority.lineage.canonical_activation_source_sha256, expected.canonical, "AUTHORITY_CANONICAL");
eq(authority.lineage.initial_config_path, "staged-config-max1.json", "AUTHORITY_MAX1_PATH");
eq(authority.lineage.initial_config_sha256, expected.max1, "AUTHORITY_MAX1");
eq(authority.lineage.concurrent_reader_config_path, "staged-config-max2.json", "AUTHORITY_MAX2_PATH");
eq(authority.lineage.concurrent_reader_config_sha256, expected.max2, "AUTHORITY_MAX2");
eq(authority.execution_boundary.maximum_cumulative_finite_spend_usd, 4, "BOUNDARY_CAP");
eq(authority.execution_boundary.anchor_refresh_authorized, true, "BOUNDARY_REFRESH");
eq(authority.execution_boundary.v2_08_authorized, false, "BOUNDARY_V2_08");
eq(authority.consumption.consumed_at, "2026-08-24T15:12:28Z", "CONSUMPTION_TIMESTAMP");
eq(authority.consumption.reusable, false, "CONSUMPTION_REUSABLE");
eq(authority.consumption.provider_jobs_submitted, 0, "CONSUMPTION_JOBS");
eq(authority.consumption.gpu_use_occurred, false, "CONSUMPTION_GPU");
for (const [index, config] of configs.entries()) {
  eq(config.control_source_commit, expected.control, `CONFIG_${index}_CONTROL`);
  eq(config.source_hashes.orchestrator_sha256, expected.orchestrator, `CONFIG_${index}_ORCHESTRATOR`);
  eq(config.source_hashes.canonical_activation_sha256, expected.canonical, `CONFIG_${index}_CANONICAL`);
  eq(config.cloudflare_anchor_refresh_contract.pre_and_post_refresh_route, "POST_404_V207_ROUTE_DISABLED_WITH_EXACT_EXPECTED_WORKER_VERSION", `CONFIG_${index}_ROUTE`);
}
eq(preflight.runpod.pods, 0, "PODS");
eq(preflight.runpod.endpoints, 0, "ENDPOINTS");
eq(preflight.runpod.retained_volume_count, 2, "VOLUMES");
eq(preflight.cloudflare.exact_route_probe.matches_active_version, true, "ROUTE_VERSION");
eq(sha(path.join(root, "apps/web/src/server/providers/v207-live-orchestrator.ts")), expected.orchestrator, "ORCHESTRATOR_BYTES");
const activation = text(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"));
if (!activation.includes(expected.proposal)) throw new Error("V207_ATTEMPT55_ACTIVATION_PROPOSAL");
eq(blocker.error_code, "V207_EXECUTABLE_ANCHOR_LINEAGE_MISMATCH", "BLOCKER_CODE");
eq(blocker.approved_preexecution_authority_sha256, expected.approvedAuthority, "BLOCKER_APPROVED_AUTHORITY");
eq(blocker.closed_authority_sha256, expected.authority, "BLOCKER_CLOSED_AUTHORITY");
eq(blocker.provider_state.provider_calls_after_approval, 0, "BLOCKER_PROVIDER_CALLS");
eq(blocker.provider_state.external_spend_usd, 0, "BLOCKER_SPEND");
if (!/^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*null\s*;/gmu.test(activation)) throw new Error("V207_ATTEMPT55_ACTIVATION_AUTHORITY");
if (!activation.includes(`V207_PENDING_CONTROL_SOURCE_COMMIT =\n  \"${expected.control}\"`)) throw new Error("V207_ATTEMPT55_ACTIVATION_CONTROL");
if (!/^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*null\s*;/gmu.test(activation)) throw new Error("V207_ATTEMPT55_ACTIVATION_CAP");
if (!/^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*null\s*;/gmu.test(activation)) throw new Error("V207_ATTEMPT55_ACTIVATION_REFRESH");
eq(`sha256:${crypto.createHash("sha256").update(canonicalActivation(activation), "utf8").digest("hex")}`, expected.canonical, "CANONICAL_BYTES");
console.log("PASS validate-v207-attempt55-config-lineage-rebind-candidate");
