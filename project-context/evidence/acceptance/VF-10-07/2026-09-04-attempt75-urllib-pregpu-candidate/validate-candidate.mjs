import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const candidateDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(candidateDir, "../../../../..");

const expected = Object.freeze({
  proposalSha256: "sha256:dfb527133ad3bfdb20bbb8d9649ca56bcd63eff243e2108f8f32a4861593f533",
  acceptanceSha256: "sha256:8b5f0b6635eff6f4c3e5c95c914d8d2d8d513f4abf62119d5560107ccbb7f123",
  auditSha256: "sha256:94da55ecbb8aba6b674fd4f5d5c8facad00a9d980b3d012dc70eaa62b8018e77",
  sourceCommit: "51d7de6cb3c0d88ddcb06df533864bf319a1210f",
  imageDigest: "sha256:8d29829130b3efcc1eb1c5daf189f6caeeb65236eeb263cf643d3c692f01e37d",
  imageConfigDigest: "sha256:316ebc9e5c7e1d3441e72f29d4edc51a33512d4ae157b7f38a84d1423b4269c7",
  imageLayerDigest: "sha256:46d4cf6d25a5aedbc78da9ff80b536551172324bdcbf1c9df81519ef9d5fa075",
  imageLayerDiffId: "sha256:20c726c4ca56883589f423efcc6b0def4495aee2a56ea07988895effbbbdb84f",
  sourceHashes: Object.freeze({
    "apps/web/src/server/providers/v207-disposable-live-orchestrator.ts":
      "sha256:072d0f764e55e5a8cd15f78d9608d1fe1e2e6284531956f8fbd2dff6755ea6e1",
    "apps/web/src/server/hosted/v207-disposable-output-ports.ts":
      "sha256:c83e805f71bacbc80e893b6db08e6df17fe8920fd203d248ededbcba6236cd40",
    "deploy/v2-07/v207-disposable-output.wrangler.jsonc":
      "sha256:22e1cf0318f683a4e56e836f8fcc446bf755416481f5b13b5aa4d52ca2f89084",
    "apps/web/src/server/providers/runpod-v207-qualification-harness.ts":
      "sha256:39da9a77290aa9a61a109578edb285279a058e4d38ec1e55f599943052eaa18d",
    "apps/web/src/server/providers/v207-live-qualification.ts":
      "sha256:13e7d1581358fa660726d36989355daca8b964a9c61fbc91ad18cb5ef580f121",
    "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts":
      "sha256:33f5ad2874bd6fb51591c40486ddff2ea7cc27157003c9b98f3fe45bb97b3f8b",
    "workers/image-media/mage_serverless.py":
      "sha256:c4945aabfa9cdb9f18aa9b514d2ec1dfc533865857ac0ee280019cb643961e3c",
    ".github/workflows/mage-image.yml":
      "sha256:1d21e41ab3f5de2bc3a077bdcce799548b70c5dfa9ad0107191c8cff39c38a09",
  }),
});

function fail(label) {
  throw new Error(`V207_ATTEMPT75_${label}`);
}

function assert(condition, label) {
  if (!condition) fail(label);
}

function read(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath));
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseJson(relativePath) {
  return JSON.parse(read(relativePath).toString("utf8"));
}

const proposalPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt75-urllib-pregpu-candidate/combined-live-proposal.json";
const acceptancePath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt75-urllib-pregpu-candidate/acceptance.json";
const auditPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt75-urllib-pregpu-candidate/independent-audit.json";

assert(sha256(read(proposalPath)) === expected.proposalSha256, "PROPOSAL_HASH");
assert(sha256(read(acceptancePath)) === expected.acceptanceSha256, "ACCEPTANCE_HASH");
assert(sha256(read(auditPath)) === expected.auditSha256, "AUDIT_HASH");

const proposal = parseJson(proposalPath);
const acceptance = parseJson(acceptancePath);
const audit = parseJson(auditPath);

assert(proposal.attempt === 75 && proposal.checkpoint === "V2-07", "PROPOSAL_IDENTITY");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL", "PROPOSAL_AUTHORITY_MODE");
assert(proposal.control_source_commit === expected.sourceCommit, "PROPOSAL_CONTROL_SOURCE");
assert(proposal.image_source_commit === expected.sourceCommit, "PROPOSAL_IMAGE_SOURCE");
assert(proposal.image.endsWith(`@${expected.imageDigest}`), "PROPOSAL_IMAGE");
assert(proposal.deterministic_image?.manifest_digest === expected.imageDigest, "PROPOSAL_MANIFEST");
assert(
  proposal.deterministic_image?.config_digest === expected.imageConfigDigest &&
    proposal.deterministic_image?.layer_digest === expected.imageLayerDigest &&
    proposal.deterministic_image?.layer_diff_id === expected.imageLayerDiffId,
  "PROPOSAL_OCI_LINEAGE",
);
assert(proposal.image_publication_state === "EXPECTED_DETERMINISTIC_DIGEST_NOT_YET_PUBLISHED", "PROPOSAL_UNPUBLISHED");
assert(proposal.placement_and_cost?.maximum_cumulative_finite_spend_usd === 4.5, "PROPOSAL_REQUESTED_CAP");
assert(proposal.operation_contract?.workers_min === 0, "PROPOSAL_WORKERS_MIN");
assert(proposal.operation_contract?.workers_max_temporary === 2, "PROPOSAL_WORKERS_MAX");
assert(proposal.operation_contract?.run_pre_gpu_urllib_compatibility_probe === true, "PROPOSAL_PRE_GPU_PROBE");
assert(proposal.operation_contract?.v2_08_authorized === false, "PROPOSAL_V208_BOUNDARY");

for (const [relativePath, digest] of Object.entries(expected.sourceHashes)) {
  assert(sha256(read(relativePath)) === digest, `SOURCE_HASH_${relativePath}`);
}
const proposalSourcePaths = Object.freeze({
  disposable_orchestrator: "apps/web/src/server/providers/v207-disposable-live-orchestrator.ts",
  disposable_output_ports: "apps/web/src/server/hosted/v207-disposable-output-ports.ts",
  disposable_wrangler_config: "deploy/v2-07/v207-disposable-output.wrangler.jsonc",
  harness: "apps/web/src/server/providers/runpod-v207-qualification-harness.ts",
  qualification: "apps/web/src/server/providers/v207-live-qualification.ts",
  reconciliation: "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts",
  mage_handler: "workers/image-media/mage_serverless.py",
  mage_publication_workflow: ".github/workflows/mage-image.yml",
});
for (const [proposalKey, relativePath] of Object.entries(proposalSourcePaths)) {
  assert(proposal.source_hashes?.[proposalKey] === expected.sourceHashes[relativePath], `PROPOSAL_SOURCE_HASH_${proposalKey}`);
}

assert(acceptance.status === "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL", "ACCEPTANCE_STATUS");
assert(acceptance.proposal_sha256 === expected.proposalSha256, "ACCEPTANCE_PROPOSAL");
assert(acceptance.control_source_commit === expected.sourceCommit, "ACCEPTANCE_CONTROL_SOURCE");
assert(acceptance.image_source_commit === expected.sourceCommit, "ACCEPTANCE_IMAGE_SOURCE");
assert(acceptance.image_published === false, "ACCEPTANCE_UNPUBLISHED");
assert(acceptance.authority?.maximum_cumulative_finite_spend_usd === 0, "ACCEPTANCE_ZERO_CAP");
assert(acceptance.authority?.provider_calls_authorized === false, "ACCEPTANCE_NO_PROVIDER");
assert(acceptance.authority?.gpu_use_authorized === false, "ACCEPTANCE_NO_GPU");

assert(audit.result === "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL", "AUDIT_RESULT");
assert(audit.audited_source_head === expected.sourceCommit, "AUDIT_SOURCE");
assert(audit.proposal?.sha256 === expected.proposalSha256, "AUDIT_PROPOSAL");
assert(audit.findings?.p0 === 0 && audit.findings?.p1 === 0 && audit.findings?.p2 === 0, "AUDIT_FINDINGS");

const activation = read("apps/web/src/server/providers/v207-activation-authority.ts").toString("utf8");
for (const value of [
  expected.proposalSha256,
  expected.sourceCommit,
  expected.imageDigest,
  expected.imageConfigDigest,
  expected.imageLayerDigest,
  expected.imageLayerDiffId,
  expected.sourceHashes["workers/image-media/mage_serverless.py"],
]) {
  assert(activation.includes(value), "ACTIVATION_POINTER");
}
assert(
  activation.includes(`export const V207_PENDING_CONTROL_SOURCE_COMMIT =\n  "${expected.sourceCommit}" as const;`),
  "ACTIVATION_CONTROL_SOURCE",
);
assert(
  activation.includes("export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;") &&
    activation.includes("export const V207_APPROVED_FINITE_CAP_USD: number | null = null;") &&
    activation.includes("export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;"),
  "ACTIVATION_NULL_AUTHORITY",
);

const currentState = read("project-context/CURRENT_STATE.yaml").toString("utf8");
const gates = read("project-context/GATES.yaml").toString("utf8");
for (const source of [currentState, gates]) {
  for (const value of [proposalPath.replace("project-context/", ""), expected.proposalSha256, expected.sourceCommit, expected.imageDigest]) {
    assert(source.includes(value), "CONTEXT_POINTER");
  }
}
assert(currentState.includes("authority_sha256: null"), "CURRENT_STATE_NULL_AUTHORITY");
assert(gates.includes("current_candidate_authority_sha256: null"), "GATES_NULL_AUTHORITY");
assert(gates.includes("current_candidate_executable_finite_cap_usd: 0"), "GATES_ZERO_EXECUTABLE_CAP");
assert(gates.includes("pending_authority_sha256: null"), "GATES_NULL_PENDING_AUTHORITY");

console.log("PASS V2-07 Attempt75 sealed candidate");
