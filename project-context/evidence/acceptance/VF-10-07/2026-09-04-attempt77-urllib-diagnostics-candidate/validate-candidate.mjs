import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const candidateDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(candidateDir, "../../../../..");

const expected = Object.freeze({
  proposalSha256: "sha256:a84068163041879cc8616052eaf67a668f1aa46e0b186b53395524b5a02e816a",
  acceptanceSha256: "sha256:d7008a7a85a91ccfa1f96e1dd5a9303c1d2bc96c1bfe57a9e11b384e82e0d2d0",
  auditSha256: "sha256:430dbe267fef38524af94f43e67b6a7ca70e6f36de1cf8992b69b2d122b0ecc8",
  controlSourceCommit: "20c1fb9eb34b76c860c404705cf7d582350daa17",
  imageSourceCommit: "51d7de6cb3c0d88ddcb06df533864bf319a1210f",
  imageDigest: "sha256:8d29829130b3efcc1eb1c5daf189f6caeeb65236eeb263cf643d3c692f01e37d",
  imageConfigDigest: "sha256:316ebc9e5c7e1d3441e72f29d4edc51a33512d4ae157b7f38a84d1423b4269c7",
  imageLayerDigest: "sha256:46d4cf6d25a5aedbc78da9ff80b536551172324bdcbf1c9df81519ef9d5fa075",
  imageLayerDiffId: "sha256:20c726c4ca56883589f423efcc6b0def4495aee2a56ea07988895effbbbdb84f",
  publicationSha256: "sha256:02fb25196188fcaf9927ece504011d3f1e931d1f87053e88971b4e6b75126677",
  predecessorClosureSha256: "sha256:601134bc4f7eab8057f466d541ea561f50ac0b9dc0b1d39abe17d387142d9a98",
  predecessorOrchestratorSha256:
    "sha256:3f1ce9ae9c2d84f331cbc3f29db8efebfb98110c99e75981760703f4e2ad9fc3",
  predecessorReconciliationSha256:
    "sha256:90467c8e768c134382c3915240a8e8d669a6b7ad0255061e0c0bc2164812d0b1",
  sourceHashes: Object.freeze({
    disposable_orchestrator: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/providers/v207-disposable-live-orchestrator.ts",
      sha256: "sha256:106ba0ffa4125cd34bd2fbe55e8971146cff24ec870b7734f7f14f8fad0ef4b0",
    }),
    disposable_orchestrator_test: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/providers/v207-disposable-live-orchestrator.test.ts",
      sha256: "sha256:8cae5f9efdb0ef480aeb7357dae8491a4b1903e96f0b4cd12ab148f5d6920cdc",
    }),
    disposable_output_ports: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/hosted/v207-disposable-output-ports.ts",
      sha256: "sha256:fa4d9954af19a2ae14853185da44a94d00120f48edeb24568bac126326b901b5",
    }),
    disposable_output_ports_test: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/hosted/v207-disposable-output-ports.test.ts",
      sha256: "sha256:720b6210c274fadef9232237b1b397428d8b9827d04428f77d36b27eeba5c853",
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

const candidatePath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt77-urllib-diagnostics-candidate";
const proposalPath = `${candidatePath}/combined-live-proposal.json`;
const acceptancePath = `${candidatePath}/acceptance.json`;
const auditPath = `${candidatePath}/independent-audit.json`;
const prohibitedAuthorityPath = `${candidatePath}/approved-authority.json`;
const publicationPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt75-urllib-pregpu-candidate/image-publication.json";
const predecessorClosurePath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/failed-attempt-76.json";
const predecessorOrchestratorPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/attempt76-live-orchestrator.json";
const predecessorReconciliationPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/attempt76-readonly-reconciliation.json";

function fail(label) {
  throw new Error(`V207_ATTEMPT77_${label}`);
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
assert(!existsSync(resolve(repoRoot, prohibitedAuthorityPath)), "APPROVED_AUTHORITY_MUST_NOT_EXIST");
assert(
  sha256(readAtCommit(expected.controlSourceCommit, publicationPath)) ===
    expected.publicationSha256,
  "PUBLICATION_HASH",
);
assert(
  sha256(readAtCommit(expected.controlSourceCommit, predecessorClosurePath)) ===
    expected.predecessorClosureSha256,
  "PREDECESSOR_CLOSURE_HASH",
);
assert(
  sha256(readAtCommit(expected.controlSourceCommit, predecessorOrchestratorPath)) ===
    expected.predecessorOrchestratorSha256,
  "PREDECESSOR_ORCHESTRATOR_HASH",
);
assert(
  sha256(readAtCommit(expected.controlSourceCommit, predecessorReconciliationPath)) ===
    expected.predecessorReconciliationSha256,
  "PREDECESSOR_RECONCILIATION_HASH",
);

execFileSync(
  "git",
  ["merge-base", "--is-ancestor", expected.imageSourceCommit, expected.controlSourceCommit],
  { cwd: repoRoot, stdio: "ignore" },
);

const proposal = parseJson(proposalPath);
const acceptance = parseJson(acceptancePath);
const audit = parseJson(auditPath);

assert(proposal.attempt === 77 && proposal.checkpoint === "V2-07", "PROPOSAL_IDENTITY");
assert(proposal.qualification_status === "NOT_QUALIFIED", "PROPOSAL_QUALIFICATION");
assert(proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL", "PROPOSAL_AUTHORITY_MODE");
assert(proposal.control_source_commit === expected.controlSourceCommit, "PROPOSAL_CONTROL_SOURCE");
assert(proposal.image_source_commit === expected.imageSourceCommit, "PROPOSAL_IMAGE_SOURCE");
assert(proposal.image.endsWith(`@${expected.imageDigest}`), "PROPOSAL_IMAGE");
assert(
  proposal.image_publication_state === "PUBLISHED_IMMUTABLE_REUSED_WITHOUT_REPUBLICATION" &&
    proposal.image_publication_evidence?.sha256 === expected.publicationSha256,
  "PROPOSAL_PUBLICATION",
);
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
  assert(proposal.source_hashes?.[proposalKey] === source.sha256, `PROPOSAL_SOURCE_${proposalKey}`);
  assert(acceptance.source_hashes?.[proposalKey] === source.sha256, `ACCEPTANCE_SOURCE_${proposalKey}`);
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
  "const PYTHON_DIAGNOSTIC_MAX_BYTES = 4_096;",
  "raw=error.read(4097)",
  "if len(raw) <= 4096:",
  "if (result.exitCode !== 2)",
  "Buffer.byteLength(result.stderr) !== 0",
  "assertExpectedWorkerVersion(",
  "V207_OUTPUT_PREWRITE_HEAD_FAILED",
  "V207_OUTPUT_BODY_READ_FAILED",
  "V207_OUTPUT_BUCKET_WRITE_FAILED",
  "V207_OUTPUT_POSTWRITE_HEAD_FAILED",
  "const ROUTE_PROPAGATION_MAX_ATTEMPTS = 30;",
  "const ROUTE_PROPAGATION_MAX_MILLISECONDS = 60_000;",
]) {
  assert(orchestrator.includes(exactSourceFragment), "ORCHESTRATOR_SOURCE_CONTRACT");
}

const outputPorts = readAtCommit(
  expected.controlSourceCommit,
  expected.sourceHashes.disposable_output_ports.path,
).toString("utf8");
for (const exactSourceFragment of [
  'errorResponse("V207_OUTPUT_PREWRITE_HEAD_FAILED", 503)',
  'errorResponse("V207_OUTPUT_BODY_READ_FAILED", 503)',
  'errorResponse("V207_OUTPUT_BUCKET_WRITE_FAILED", 503)',
  'errorResponse("V207_OUTPUT_POSTWRITE_HEAD_FAILED", 503)',
  'errorResponse("V207_OUTPUT_WRITE_UNCONFIRMED", 503)',
]) {
  assert(outputPorts.includes(exactSourceFragment), "OUTPUT_PORT_SOURCE_CONTRACT");
}

const orchestratorTest = readAtCommit(
  expected.controlSourceCommit,
  expected.sourceHashes.disposable_orchestrator_test.path,
).toString("utf8");
for (const exactTestName of [
  "executes real python3 against loopback with exact Mage framing and version binding",
  "maps a Worker HTTP failure to one bounded code without retaining response material",
  "classifies actual capability PUT %s exceptions through real python3 without raw diagnostics",
  "rejects %s Worker version metadata before classifying an HTTP error",
  "rejects a known Worker error paired with the wrong HTTP status",
  "reduces a %s HTTP error body to a version-bound HTTP class without retaining it",
]) {
  assert(orchestratorTest.includes(exactTestName), "ORCHESTRATOR_TEST_CONTRACT");
}

const outputPortsTest = readAtCommit(
  expected.controlSourceCommit,
  expected.sourceHashes.disposable_output_ports_test.path,
).toString("utf8");
for (const exactTestName of [
  "returns a bounded 503 for capability PUT %s exceptions",
  "returns a bounded 503 when the capability PUT body stream throws",
]) {
  assert(outputPortsTest.includes(exactTestName), "OUTPUT_PORT_TEST_CONTRACT");
}

assert(
  proposal.independent_audit?.result === "PASS" &&
    proposal.independent_audit?.findings?.p0 === 0 &&
    proposal.independent_audit?.findings?.p1 === 0 &&
    proposal.independent_audit?.findings?.p2 === 0 &&
    proposal.independent_audit?.focused_tests === "66/66" &&
    proposal.independent_audit?.artifact_sha256 === expected.auditSha256,
  "PROPOSAL_AUDIT",
);
assert(proposal.placement_and_cost?.gpu === "NVIDIA GeForce RTX 4090", "PROPOSAL_GPU");
assert(proposal.placement_and_cost?.region === "EU-RO-1", "PROPOSAL_REGION");
assert(proposal.placement_and_cost?.serverless_flex_usd_per_gpu_hour === 1.116, "PROPOSAL_RATE");
assert(proposal.placement_and_cost?.baseline_endpoint_spend_usd === 2.266709277551854, "PROPOSAL_BASELINE");
assert(proposal.placement_and_cost?.maximum_cumulative_finite_spend_usd === 4.5, "PROPOSAL_CAP");
assert(proposal.placement_and_cost?.retained_volume_charge_usd_per_month === 7, "PROPOSAL_RETENTION");
assert(proposal.placement_and_cost?.gpu_fallback === false, "PROPOSAL_NO_FALLBACK");
assert(proposal.operation_contract?.publish_exact_immutable_mage_image === false, "PROPOSAL_NO_PUBLICATION");
assert(proposal.operation_contract?.reuse_exact_published_mage_image === true, "PROPOSAL_IMAGE_REUSE");
assert(proposal.operation_contract?.workers_min === 0, "PROPOSAL_WORKERS_MIN");
assert(proposal.operation_contract?.workers_max_initial === 1, "PROPOSAL_WORKERS_INITIAL");
assert(proposal.operation_contract?.workers_max_temporary === 2, "PROPOSAL_WORKERS_MAX");
assert(
  proposal.operation_contract?.prove_active_route_with_bounded_distinct_version_propagation ===
    true,
  "PROPOSAL_ROUTE_PROPAGATION",
);
assert(
  proposal.operation_contract?.run_exact_pre_gpu_python_urllib_probe_with_bounded_safe_diagnostics ===
    true,
  "PROPOSAL_PRE_GPU_PROBE",
);
assert(
  proposal.operation_contract?.delete_generated_outputs === true &&
    proposal.operation_contract?.delete_disposable_endpoint === true &&
    proposal.operation_contract?.delete_disposable_template === true &&
    proposal.operation_contract?.delete_disposable_output_worker_and_route === true &&
    proposal.operation_contract?.signal_safe_cleanup === true &&
    proposal.operation_contract?.three_final_zero_compute_disposable_reads === true,
  "PROPOSAL_CLEANUP",
);
assert(
  proposal.operation_contract?.shared_staging_worker_mutation === false &&
    proposal.operation_contract?.anchor_refresh_authorized === false &&
    proposal.operation_contract?.v2_08_authorized === false,
  "PROPOSAL_BOUNDARY",
);
assert(
  proposal.predecessor?.closure_sha256 === expected.predecessorClosureSha256 &&
    proposal.predecessor?.orchestrator_sha256 === expected.predecessorOrchestratorSha256 &&
    proposal.predecessor?.reconciliation_sha256 === expected.predecessorReconciliationSha256 &&
    proposal.predecessor?.authority_status === "CONSUMED_FAILED_CLEAN_NON_REUSABLE",
  "PROPOSAL_PREDECESSOR",
);
assert(
  proposal.last_observed_provider_truth?.evidence_sha256 ===
    expected.predecessorReconciliationSha256 &&
    proposal.last_observed_provider_truth?.stable_read_count === 3 &&
    proposal.last_observed_provider_truth?.pods === 0 &&
    proposal.last_observed_provider_truth?.endpoints === 0 &&
    proposal.last_observed_provider_truth?.private_templates === 0 &&
    proposal.last_observed_provider_truth?.active_serverless_workers === 0 &&
    proposal.last_observed_provider_truth?.running_pods === 0,
  "PROPOSAL_ZERO_COMPUTE_TRUTH",
);

assert(acceptance.attempt === 77 && acceptance.checkpoint === "V2-07", "ACCEPTANCE_IDENTITY");
assert(acceptance.status === "SEALED_AWAITING_FRESH_EXACT_APPROVAL", "ACCEPTANCE_STATUS");
assert(acceptance.qualification_status === "NOT_QUALIFIED", "ACCEPTANCE_QUALIFICATION");
assert(acceptance.proposal_sha256 === expected.proposalSha256, "ACCEPTANCE_PROPOSAL");
assert(acceptance.control_source_commit === expected.controlSourceCommit, "ACCEPTANCE_CONTROL");
assert(acceptance.image_source_commit === expected.imageSourceCommit, "ACCEPTANCE_IMAGE_SOURCE");
assert(acceptance.image_digest === expected.imageDigest, "ACCEPTANCE_IMAGE");
assert(
  acceptance.image_published === true &&
    acceptance.image_republication_required === false &&
    acceptance.image_republication_authorized === false &&
    acceptance.image_reuse_proposed === true &&
    acceptance.image_reuse_authorized === false,
  "ACCEPTANCE_IMAGE_BOUNDARY",
);
assert(
  acceptance.validation?.focused_output_port_and_orchestrator_tests === "66/66" &&
    acceptance.validation?.web_dual_typecheck === "PASS" &&
    acceptance.validation?.candidate_validator === "PASS",
  "ACCEPTANCE_VALIDATION",
);
assert(
  acceptance.independent_reaudit?.result === "PASS_ZERO_P0_ZERO_P1_ZERO_P2" &&
    acceptance.independent_reaudit?.focused_tests === "66/66" &&
    acceptance.independent_reaudit?.artifact_sha256 === expected.auditSha256,
  "ACCEPTANCE_AUDIT",
);
assert(
  acceptance.predecessor?.closure_sha256 === expected.predecessorClosureSha256 &&
    acceptance.predecessor?.orchestrator_sha256 === expected.predecessorOrchestratorSha256 &&
    acceptance.predecessor?.reconciliation_sha256 === expected.predecessorReconciliationSha256,
  "ACCEPTANCE_PREDECESSOR",
);
assert(
  acceptance.proposed_authority?.maximum_cumulative_finite_spend_usd === 4.5 &&
    acceptance.proposed_authority?.baseline_endpoint_spend_usd === 2.266709277551854 &&
    acceptance.proposed_authority?.workers_min === 0 &&
    acceptance.proposed_authority?.workers_max_temporary === 2 &&
    acceptance.proposed_authority?.retained_volume_charge_usd_per_month === 7 &&
    acceptance.proposed_authority?.gpu_fallback === false &&
    acceptance.proposed_authority?.anchor_refresh === false &&
    acceptance.proposed_authority?.v2_08 === false,
  "ACCEPTANCE_PROPOSED_SCOPE",
);
assert(
  acceptance.authority?.status === "NOT_GRANTED" &&
    acceptance.authority?.fresh_exact_approval_required === true &&
    acceptance.authority?.provider_calls_authorized === false &&
    acceptance.authority?.provider_mutations_authorized === false &&
    acceptance.authority?.image_publication_authorized === false &&
    acceptance.authority?.image_republication_authorized === false &&
    acceptance.authority?.reuse_published_image_authorized === false &&
    acceptance.authority?.gpu_use_authorized === false &&
    acceptance.authority?.maximum_cumulative_finite_spend_usd === 0 &&
    acceptance.authority?.anchor_refresh_authorized === false &&
    acceptance.authority?.v2_08_authorized === false &&
    acceptance.authority?.consumed === false &&
    acceptance.authority?.reusable === false &&
    acceptance.authority?.single_use === false &&
    acceptance.authority?.authority_path === null &&
    acceptance.authority?.authority_sha256 === null,
  "ACCEPTANCE_NO_AUTHORITY",
);

assert(audit.result === "PASS_SEALED_AWAITING_FRESH_EXACT_APPROVAL", "AUDIT_RESULT");
assert(audit.audited_control_source_commit === expected.controlSourceCommit, "AUDIT_CONTROL");
assert(
  audit.findings?.p0 === 0 && audit.findings?.p1 === 0 && audit.findings?.p2 === 0,
  "AUDIT_FINDINGS",
);
assert(
  audit.validation?.focused_output_port_and_orchestrator_tests === "66/66 PASS" &&
    audit.validation?.provider_calls === 0 &&
    audit.validation?.provider_mutations === 0 &&
    audit.validation?.image_publications === 0 &&
    audit.validation?.gpu_jobs_submitted === 0 &&
    audit.validation?.external_spend_usd === 0,
  "AUDIT_PROVIDER_FREE",
);

const activation = readAtCommit(
  expected.controlSourceCommit,
  "apps/web/src/server/providers/v207-activation-authority.ts",
).toString("utf8");
assert(
  activation.includes("export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;") &&
    activation.includes("export const V207_APPROVED_FINITE_CAP_USD: number | null = null;") &&
    activation.includes(
      "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;",
    ),
  "SEALED_CONTROL_NULL_AUTHORITY",
);

const currentState = readAtCommit(
  expected.controlSourceCommit,
  "project-context/CURRENT_STATE.yaml",
).toString("utf8");
for (const exactBoundary of [
  "provider_calls_authorized: false",
  "read_only_provider_calls_authorized: false",
  "remote_or_cloud_mutations_authorized: false",
  "credential_access_authorized: false",
  "gpu_use_authorized: false",
  "maximum_external_spend_usd: 0",
]) {
  assert(currentState.includes(exactBoundary), "CONTEXT_NULL_AUTHORITY");
}

console.log("PASS V2-07 Attempt77 sealed provider-free preapproval candidate");
