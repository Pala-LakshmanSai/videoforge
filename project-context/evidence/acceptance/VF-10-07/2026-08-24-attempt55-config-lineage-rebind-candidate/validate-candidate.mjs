import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const dir = import.meta.dirname;
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:d3481231340fb7a4a22ae1047103024ca37e6b75c70c37d36c3bfb2a9baaff1f",
  preflight: "sha256:46883e09bd784dd05a4017a6519d0935f02b29b861d9cb2b9b9cd0037b29353e",
  max1: "sha256:62167243073a7c35c9b7b0d2701971fae2da1366a56aa1b6a303b67c1f2fa368",
  max2: "sha256:551b30c3e669d4127390bf5cb9b7c6c1a3ce9cb76a9bd9b400350a6f4e2d48ee",
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

for (const [name, wanted] of [["combined-live-proposal.json", expected.proposal], ["read-only-preflight.json", expected.preflight], ["staged-config-max1.json", expected.max1], ["staged-config-max2.json", expected.max2]]) eq(sha(path.join(dir, name)), wanted, `${name}_HASH`);
const proposal = json(path.join(dir, "combined-live-proposal.json"));
const preflight = json(path.join(dir, "read-only-preflight.json"));
const configs = [json(path.join(dir, "staged-config-max1.json")), json(path.join(dir, "staged-config-max2.json"))];
eq(proposal.approval_request.requested_maximum_cumulative_finite_spend_usd, 4, "CAP");
eq(proposal.approval_request.executable_cap_binding, null, "NULL_CAP");
eq(proposal.approval_request.anchor_refresh_authorized, null, "NULL_REFRESH");
eq(proposal.approval_request.attempt54_authority_or_cap_reuse_forbidden, true, "NO_REUSE");
eq(proposal.provider_free_lineage.control_source_commit, expected.control, "PROPOSAL_CONTROL");
eq(proposal.provider_free_lineage.orchestrator_source_sha256, expected.orchestrator, "PROPOSAL_ORCHESTRATOR");
eq(proposal.provider_free_lineage.canonical_activation_source_sha256, expected.canonical, "PROPOSAL_CANONICAL");
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
eq(`sha256:${crypto.createHash("sha256").update(canonicalActivation(activation), "utf8").digest("hex")}`, expected.canonical, "CANONICAL_BYTES");
console.log("PASS validate-v207-attempt55-config-lineage-rebind-candidate");
