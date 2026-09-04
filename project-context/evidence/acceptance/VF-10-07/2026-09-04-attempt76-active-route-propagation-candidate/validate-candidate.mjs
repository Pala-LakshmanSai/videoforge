import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const candidateDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(candidateDir, "../../../../..");

const expected = Object.freeze({
  proposalSha256: "sha256:da59afdc9ea272c7201215d890741202f5e8f8152ba5765f6172332b1cd51bc6",
  acceptanceSha256: "sha256:5acf32e3e826e9d8764a3e18119e16c319ddfc6364baa4197eda8fefcb93d57a",
  controlSourceCommit: "6454405d817fe174b2add1d502a31b241b6a0234",
  imageSourceCommit: "51d7de6cb3c0d88ddcb06df533864bf319a1210f",
  imageDigest: "sha256:8d29829130b3efcc1eb1c5daf189f6caeeb65236eeb263cf643d3c692f01e37d",
  imageConfigDigest: "sha256:316ebc9e5c7e1d3441e72f29d4edc51a33512d4ae157b7f38a84d1423b4269c7",
  imageLayerDigest: "sha256:46d4cf6d25a5aedbc78da9ff80b536551172324bdcbf1c9df81519ef9d5fa075",
  imageLayerDiffId: "sha256:20c726c4ca56883589f423efcc6b0def4495aee2a56ea07988895effbbbdb84f",
  publicationSha256: "sha256:02fb25196188fcaf9927ece504011d3f1e931d1f87053e88971b4e6b75126677",
  predecessorClosureSha256: "sha256:d69c5e9ec60376e0718bc3e6d17a35a9f1754efab93b7ebb8c263b23e2c3414a",
  reconciliationSha256: "sha256:4552919cd586f1df94c9f62697428cbf46f8e9bef251a9f9000aaf1064e80d2d",
  auditSha256: "sha256:4b1c8a921c13079dcdb230c495887faa8d962c4123ee79158f7a162ea09a9c49",
  sourceHashes: Object.freeze({
    disposable_orchestrator: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/providers/v207-disposable-live-orchestrator.ts",
      sha256: "sha256:6efc098d88edf4ec2c401ea1b37466bb4cb35d22eb1a2be99791ad3a2c3f1613",
    }),
    disposable_orchestrator_test: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/providers/v207-disposable-live-orchestrator.test.ts",
      sha256: "sha256:7da2b24ecaa62a90c3def948fe15d3b5d6dfebbb834d3ba2164fde1d2dd61355",
    }),
    disposable_output_ports: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/hosted/v207-disposable-output-ports.ts",
      sha256: "sha256:c83e805f71bacbc80e893b6db08e6df17fe8920fd203d248ededbcba6236cd40",
    }),
    disposable_worker_entry: Object.freeze({
      commit: "control",
      path: "apps/web/worker/v207-qualification-output.ts",
      sha256: "sha256:264c4e08bcf8a413660f96144ecebbdcf6c0eaedf64e92755ae489ef50c162ba",
    }),
    disposable_wrangler_config: Object.freeze({
      commit: "control",
      path: "deploy/v2-07/v207-disposable-output.wrangler.jsonc",
      sha256: "sha256:22e1cf0318f683a4e56e836f8fcc446bf755416481f5b13b5aa4d52ca2f89084",
    }),
    harness: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/providers/runpod-v207-qualification-harness.ts",
      sha256: "sha256:39da9a77290aa9a61a109578edb285279a058e4d38ec1e55f599943052eaa18d",
    }),
    qualification: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/providers/v207-live-qualification.ts",
      sha256: "sha256:13e7d1581358fa660726d36989355daca8b964a9c61fbc91ad18cb5ef580f121",
    }),
    reconciliation: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts",
      sha256: "sha256:33f5ad2874bd6fb51591c40486ddff2ea7cc27157003c9b98f3fe45bb97b3f8b",
    }),
    shared_live_orchestrator: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/providers/v207-live-orchestrator.ts",
      sha256: "sha256:20850aae064d955dbc097af630f30b7ac5c50fb61e628bc856d4f74a2d4e8414",
    }),
    mage_handler: Object.freeze({
      commit: "image",
      path: "workers/image-media/mage_serverless.py",
      sha256: "sha256:c4945aabfa9cdb9f18aa9b514d2ec1dfc533865857ac0ee280019cb643961e3c",
    }),
    mage_publication_workflow: Object.freeze({
      commit: "image",
      path: ".github/workflows/mage-image.yml",
      sha256: "sha256:1d21e41ab3f5de2bc3a077bdcce799548b70c5dfa9ad0107191c8cff39c38a09",
    }),
  }),
});

const proposalPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt76-active-route-propagation-candidate/combined-live-proposal.json";
const acceptancePath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt76-active-route-propagation-candidate/acceptance.json";
const auditPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt76-active-route-propagation-candidate/independent-audit.json";
const authorityPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt76-active-route-propagation-candidate/approved-authority.json";
const publicationPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt75-urllib-pregpu-candidate/image-publication.json";
const predecessorClosurePath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/failed-attempt-75.json";
const reconciliationPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/attempt75-readonly-reconciliation.json";

function fail(label) {
  throw new Error(`V207_ATTEMPT76_${label}`);
}

function assert(condition, label) {
  if (!condition) fail(label);
}

function read(relativePath) {
  return readFileSync(resolve(repoRoot, relativePath));
}

function readAtCommit(commit, relativePath) {
  return execFileSync("git", ["show", `${commit}:${relativePath}`], {
    cwd: repoRoot,
    encoding: null,
  });
}

function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function parseJson(relativePath) {
  return JSON.parse(read(relativePath).toString("utf8"));
}

assert(sha256(read(proposalPath)) === expected.proposalSha256, "PROPOSAL_HASH");
assert(sha256(read(acceptancePath)) === expected.acceptanceSha256, "ACCEPTANCE_HASH");
assert(sha256(read(auditPath)) === expected.auditSha256, "AUDIT_HASH");
assert(
  sha256(readAtCommit(expected.controlSourceCommit, publicationPath)) === expected.publicationSha256,
  "PUBLICATION_HASH",
);
assert(
  sha256(readAtCommit(expected.controlSourceCommit, predecessorClosurePath)) === expected.predecessorClosureSha256,
  "PREDECESSOR_CLOSURE_HASH",
);
assert(
  sha256(readAtCommit(expected.controlSourceCommit, reconciliationPath)) === expected.reconciliationSha256,
  "RECONCILIATION_HASH",
);

execFileSync("git", ["merge-base", "--is-ancestor", expected.imageSourceCommit, expected.controlSourceCommit], {
  cwd: repoRoot,
  stdio: "ignore",
});

const proposal = parseJson(proposalPath);
const acceptance = parseJson(acceptancePath);
const audit = parseJson(auditPath);

assert(proposal.attempt === 76 && proposal.checkpoint === "V2-07", "PROPOSAL_IDENTITY");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL", "PROPOSAL_AUTHORITY_MODE");
assert(proposal.control_source_commit === expected.controlSourceCommit, "PROPOSAL_CONTROL_SOURCE");
assert(proposal.image_source_commit === expected.imageSourceCommit, "PROPOSAL_IMAGE_SOURCE");
assert(proposal.image.endsWith(`@${expected.imageDigest}`), "PROPOSAL_IMAGE");
assert(
  proposal.image_publication_state === "PUBLISHED_IMMUTABLE_REUSED_WITHOUT_REPUBLICATION",
  "PROPOSAL_PUBLICATION_STATE",
);
assert(proposal.image_publication_evidence?.sha256 === expected.publicationSha256, "PROPOSAL_PUBLICATION");
assert(proposal.deterministic_image?.manifest_digest === expected.imageDigest, "PROPOSAL_MANIFEST");
assert(
  proposal.deterministic_image?.config_digest === expected.imageConfigDigest &&
    proposal.deterministic_image?.layer_digest === expected.imageLayerDigest &&
    proposal.deterministic_image?.layer_diff_id === expected.imageLayerDiffId,
  "PROPOSAL_OCI_LINEAGE",
);

for (const [proposalKey, source] of Object.entries(expected.sourceHashes)) {
  const commit = source.commit === "image" ? expected.imageSourceCommit : expected.controlSourceCommit;
  assert(sha256(readAtCommit(commit, source.path)) === source.sha256, `SOURCE_HASH_${proposalKey}`);
  assert(proposal.source_hashes?.[proposalKey] === source.sha256, `PROPOSAL_SOURCE_HASH_${proposalKey}`);
  assert(acceptance.source_hashes?.[proposalKey] === source.sha256, `ACCEPTANCE_SOURCE_HASH_${proposalKey}`);
}

for (const imageSource of ["mage_handler", "mage_publication_workflow"]) {
  const source = expected.sourceHashes[imageSource];
  assert(
    sha256(readAtCommit(expected.controlSourceCommit, source.path)) === source.sha256,
    `IMAGE_UNCHANGED_AT_CONTROL_${imageSource}`,
  );
}

const orchestrator = readAtCommit(
  expected.controlSourceCommit,
  expected.sourceHashes.disposable_orchestrator.path,
).toString("utf8");
for (const exactSourceFragment of [
  "const ROUTE_PROPAGATION_MAX_ATTEMPTS = 30;",
  "const ROUTE_PROPAGATION_MAX_MILLISECONDS = 60_000;",
  "!firstExactMatchSeen &&",
  "observed.status === 404 &&",
  'observed.code === "V207_ROUTE_DISABLED" &&',
  "observed.workerVersionId !== expectedWorkerVersionId",
  "if (consecutiveMatches === reads) return;",
  "Math.min(15_000, remainingMilliseconds)",
]) {
  assert(orchestrator.includes(exactSourceFragment), "ROUTE_PROPAGATION_SOURCE_CONTRACT");
}

const orchestratorTest = readAtCommit(
  expected.controlSourceCommit,
  expected.sourceHashes.disposable_orchestrator_test.path,
).toString("utf8");
for (const exactTestName of [
  "allows a transient disabled predecessor before three exact active fingerprints",
  "rejects a disabled fingerprint carrying the expected active version",
  "fails immediately when a disabled predecessor returns after the first exact active match",
  "fails immediately on %s predecessor version metadata",
  "caps active-route propagation at the 60-second deadline",
  "aborts during active-route propagation and still cleans up",
]) {
  assert(orchestratorTest.includes(exactTestName), "ROUTE_PROPAGATION_TEST_CONTRACT");
}

assert(proposal.independent_audit?.result === "PASS", "PROPOSAL_AUDIT_RESULT");
assert(
  proposal.independent_audit?.findings?.p0 === 0 &&
    proposal.independent_audit?.findings?.p1 === 0 &&
    proposal.independent_audit?.findings?.p2 === 0,
  "PROPOSAL_AUDIT_FINDINGS",
);
assert(
  proposal.independent_audit?.artifact_path === "independent-audit.json" &&
    proposal.independent_audit?.artifact_sha256 === expected.auditSha256 &&
    proposal.independent_audit?.materialization_pending === false,
  "PROPOSAL_AUDIT_ARTIFACT",
);
assert(proposal.placement_and_cost?.gpu === "NVIDIA GeForce RTX 4090", "PROPOSAL_GPU");
assert(proposal.placement_and_cost?.region === "EU-RO-1", "PROPOSAL_REGION");
assert(proposal.placement_and_cost?.serverless_flex_usd_per_gpu_hour === 1.116, "PROPOSAL_RATE");
assert(proposal.placement_and_cost?.maximum_cumulative_finite_spend_usd === 4.5, "PROPOSAL_CAP");
assert(proposal.placement_and_cost?.retained_volume_charge_usd_per_month === 7, "PROPOSAL_RETENTION");
assert(proposal.operation_contract?.workers_min === 0, "PROPOSAL_WORKERS_MIN");
assert(proposal.operation_contract?.workers_max_temporary === 2, "PROPOSAL_WORKERS_MAX");
assert(proposal.operation_contract?.publish_exact_immutable_mage_image === false, "PROPOSAL_NO_PUBLICATION");
assert(proposal.operation_contract?.run_pre_gpu_urllib_compatibility_probe === true, "PROPOSAL_PRE_GPU_PROBE");
assert(proposal.operation_contract?.three_final_zero_compute_disposable_reads === true, "PROPOSAL_FINAL_READS");
assert(
  proposal.operation_contract?.anchor_refresh_authorized === false &&
    proposal.operation_contract?.v2_08_authorized === false,
  "PROPOSAL_BOUNDARY",
);
assert(proposal.last_observed_provider_truth?.evidence_sha256 === expected.reconciliationSha256, "PROPOSAL_RECONCILIATION");
assert(proposal.last_observed_provider_truth?.baseline_endpoint_spend_usd === 2.266709277551854, "PROPOSAL_BASELINE");
assert(proposal.predecessor?.closure_sha256 === expected.predecessorClosureSha256, "PROPOSAL_PREDECESSOR");

assert(acceptance.status === "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL", "ACCEPTANCE_STATUS");
assert(acceptance.qualification_status === "NOT_QUALIFIED", "ACCEPTANCE_QUALIFICATION");
assert(acceptance.proposal_sha256 === expected.proposalSha256, "ACCEPTANCE_PROPOSAL");
assert(acceptance.control_source_commit === expected.controlSourceCommit, "ACCEPTANCE_CONTROL_SOURCE");
assert(acceptance.image_source_commit === expected.imageSourceCommit, "ACCEPTANCE_IMAGE_SOURCE");
assert(acceptance.image_digest === expected.imageDigest, "ACCEPTANCE_IMAGE");
assert(acceptance.image_published === true && acceptance.image_republication_required === false, "ACCEPTANCE_PUBLICATION");
assert(acceptance.image_publication_sha256 === expected.publicationSha256, "ACCEPTANCE_PUBLICATION_HASH");
assert(acceptance.validation?.focused_orchestrator_tests === "31/31", "ACCEPTANCE_TESTS");
assert(acceptance.independent_reaudit?.result === "PASS_ZERO_P0_ZERO_P1_ZERO_P2", "ACCEPTANCE_AUDIT");
assert(
  acceptance.independent_reaudit?.artifact_path === "independent-audit.json" &&
    acceptance.independent_reaudit?.artifact_sha256 === expected.auditSha256 &&
    acceptance.independent_reaudit?.materialization_pending === false,
  "ACCEPTANCE_AUDIT_ARTIFACT",
);
assert(audit.result === "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL", "AUDIT_RESULT");
assert(audit.audited_control_source_commit === expected.controlSourceCommit, "AUDIT_CONTROL_SOURCE");
assert(
  audit.findings?.p0 === 0 && audit.findings?.p1 === 0 && audit.findings?.p2 === 0,
  "AUDIT_FINDINGS",
);
assert(acceptance.authority?.status === "NOT_MATERIALIZED", "ACCEPTANCE_AUTHORITY_STATUS");
assert(acceptance.authority?.maximum_cumulative_finite_spend_usd === 0, "ACCEPTANCE_ZERO_CAP");
assert(acceptance.authority?.provider_calls_authorized === false, "ACCEPTANCE_NO_PROVIDER");
assert(acceptance.authority?.gpu_use_authorized === false, "ACCEPTANCE_NO_GPU");
assert(acceptance.authority?.consumed === false, "ACCEPTANCE_UNCONSUMED");
assert(acceptance.authority?.authority_path === null && acceptance.authority?.authority_sha256 === null, "ACCEPTANCE_NULL_AUTHORITY");
assert(!existsSync(resolve(repoRoot, authorityPath)), "AUTHORITY_FILE_MUST_NOT_EXIST");

const activation = readAtCommit(
  expected.controlSourceCommit,
  "apps/web/src/server/providers/v207-activation-authority.ts",
).toString("utf8");
assert(
  activation.includes("export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;") &&
    activation.includes("export const V207_APPROVED_FINITE_CAP_USD: number | null = null;") &&
    activation.includes("export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;"),
  "SEALED_CONTROL_NULL_AUTHORITY",
);

const currentActivation = read(
  "apps/web/src/server/providers/v207-activation-authority.ts",
).toString("utf8");
assert(currentActivation.includes(expected.proposalSha256), "CURRENT_ACTIVATION_PROPOSAL");
assert(currentActivation.includes(expected.controlSourceCommit), "CURRENT_ACTIVATION_CONTROL_SOURCE");
assert(
  currentActivation.includes("export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;") &&
    currentActivation.includes("export const V207_APPROVED_FINITE_CAP_USD: number | null = null;") &&
    currentActivation.includes(
      "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;",
    ),
  "CURRENT_ACTIVATION_NULL_AUTHORITY",
);

const currentState = read("project-context/CURRENT_STATE.yaml").toString("utf8");
const gates = read("project-context/GATES.yaml").toString("utf8");
for (const source of [currentState, gates]) {
  for (const value of [expected.proposalSha256, expected.controlSourceCommit, expected.imageDigest]) {
    assert(source.includes(value), "CONTEXT_POINTER");
  }
}
assert(currentState.includes("current_goal_authority: null"), "CURRENT_STATE_NULL_AUTHORITY");
assert(gates.includes("current_candidate_authority_sha256: null"), "GATES_NULL_AUTHORITY");
assert(gates.includes("current_candidate_executable_finite_cap_usd: null"), "GATES_NULL_EXECUTABLE_CAP");

console.log("PASS V2-07 Attempt76 sealed provider-free candidate");
