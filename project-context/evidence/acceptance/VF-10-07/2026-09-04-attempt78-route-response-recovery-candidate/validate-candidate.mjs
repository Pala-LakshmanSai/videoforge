import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const candidateDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(candidateDir, "../../../../..");
const candidatePath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt78-route-response-recovery-candidate";

const expected = Object.freeze({
  proposalSha256: "sha256:2cb0188a05b033b1519101767654cbd2f94e8eed4a10fd353bfeb7483618d0a2",
  preapprovalAcceptanceSha256:
    "sha256:c6c4e764bcd85399a2006b243c20356f6ee2471a17cff5733fcf4720bc8ed1a4",
  acceptanceSha256: "sha256:de4aaf34f2d93c4f5f1727b1013f6d02f97ae723d6e62e8757a1f49b33dfbeac",
  auditSha256: "sha256:8d03d9c9ea55dfd9d4a07fb0012d7e14835fe624b60a720fd20d791d2542585c",
  authoritySha256: "sha256:8b3b6259cfb6dab49fbc7ce0b07d92f51df5c647c72d7ebbbb29cf27b3788c8e",
  activationSourceSha256:
    "sha256:9165a963508b67cbac0921b7fa1937c1d888df19a96620f88dacc9603a4b1b4c",
  activationTestSha256:
    "sha256:9a15133089b73d086d7b2823e6f9807b2e3a5a5abf0e6bce21fb70d62d46b43b",
  activationCanonicalSha256:
    "sha256:c77159105167a901c278a95ea5a5e6b657a8b88bb479b83a8c9d94121bdd6bf3",
  authorizedAt: "2026-09-04T23:14:00+05:30",
  exactUserApproval:
    "I approve V2-07 Attempt78 proposal sha256:2cb0188a05b033b1519101767654cbd2f94e8eed4a10fd353bfeb7483618d0a2, control source 429ff015eb6502394e042e8c3623608726dce3c4, image source 51d7de6cb3c0d88ddcb06df533864bf319a1210f, reuse without republication of Mage image digest sha256:8d29829130b3efcc1eb1c5daf189f6caeeb65236eeb263cf643d3c692f01e37d, the $4.50 cumulative finite cap, RTX 4090 EU-RO-1 at $1.116/GPU-hour, workersMin zero and temporary max two workers, bounded distinct-version route propagation including only the established pre-first-match 404 V207_ROUTE_DISABLED distinct-predecessor allowance and pre-first-match unreachable or exact-version S5XX recovery within 30 reads/60 seconds/2-second sleeps, the exact pre-GPU Python urllib upload/finalize/readback/delete probe with bounded redaction-safe route/R2-stage diagnostics, disposable output/endpoint/template/worker/route deletion, signal-safe cleanup, three final zero-compute reads, continued $7/month volume retention, no GPU fallback, no rollback-anchor refresh, and no V2-08 execution.",
  controlSourceCommit: "429ff015eb6502394e042e8c3623608726dce3c4",
  imageSourceCommit: "51d7de6cb3c0d88ddcb06df533864bf319a1210f",
  imageDigest: "sha256:8d29829130b3efcc1eb1c5daf189f6caeeb65236eeb263cf643d3c692f01e37d",
  publicationSha256: "sha256:02fb25196188fcaf9927ece504011d3f1e931d1f87053e88971b4e6b75126677",
  predecessorClosureSha256:
    "sha256:f87d3ab60c1efc07aa59963b790c6bfc2be2fd8b8fa5bc6f53378ddc94c96e43",
  predecessorOrchestratorSha256:
    "sha256:c9eaf439807aadeb1cca429087c9480524684a39ec17a130533310469ae45ad8",
  predecessorReconciliationSha256:
    "sha256:8a54c77082eb734f3d4e7ca56477055a069635ad9c174971009646c40fa1124b",
  sourceHashes: Object.freeze({
    disposable_orchestrator: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/providers/v207-disposable-live-orchestrator.ts",
      sha256: "sha256:218820b794502d4c5267854139611974acf28d9edef2de6374bb2416c35cf702",
    }),
    disposable_orchestrator_test: Object.freeze({
      commit: "control",
      path: "apps/web/src/server/providers/v207-disposable-live-orchestrator.test.ts",
      sha256: "sha256:5c2f9ff259d7e5d08ba1f30a387799256b705726d7aac24e11a2ea2ed3186bdd",
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

function fail(label) {
  throw new Error(`V207_ATTEMPT78_${label}`);
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

const proposalPath = `${candidatePath}/combined-live-proposal.json`;
const acceptancePath = `${candidatePath}/acceptance.json`;
const auditPath = `${candidatePath}/independent-audit.json`;
const authorityPath = `${candidatePath}/approved-authority.json`;
const activationSourcePath = "apps/web/src/server/providers/v207-activation-authority.ts";
const activationTestPath = "apps/web/src/server/providers/v207-activation-authority.test.ts";
const publicationPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt75-urllib-pregpu-candidate/image-publication.json";
const predecessorClosurePath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/failed-attempt-77.json";
const predecessorOrchestratorPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/attempt77-live-orchestrator.json";
const predecessorReconciliationPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/attempt77-readonly-reconciliation.json";

assert(sha256(read(proposalPath)) === expected.proposalSha256, "PROPOSAL_HASH");
assert(sha256(read(acceptancePath)) === expected.acceptanceSha256, "ACCEPTANCE_HASH");
assert(sha256(read(auditPath)) === expected.auditSha256, "AUDIT_HASH");
assert(existsSync(resolve(repoRoot, authorityPath)), "APPROVED_AUTHORITY_REQUIRED");
assert(sha256(read(authorityPath)) === expected.authoritySha256, "AUTHORITY_HASH");
assert(sha256(read(activationSourcePath)) === expected.activationSourceSha256, "ACTIVATION_SOURCE_HASH");
assert(sha256(read(activationTestPath)) === expected.activationTestSha256, "ACTIVATION_TEST_HASH");
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
const authority = parseJson(authorityPath);

assert(proposal.attempt === 78 && proposal.checkpoint === "V2-07", "PROPOSAL_IDENTITY");
assert(proposal.qualification_status === "NOT_QUALIFIED", "PROPOSAL_QUALIFICATION");
assert(
  proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_NO_EXECUTABLE_AUTHORITY",
  "PROPOSAL_AUTHORITY_MODE",
);
assert(proposal.control_source_commit === expected.controlSourceCommit, "PROPOSAL_CONTROL");
assert(proposal.image_source_commit === expected.imageSourceCommit, "PROPOSAL_IMAGE_SOURCE");
assert(proposal.image.endsWith(`@${expected.imageDigest}`), "PROPOSAL_IMAGE");
assert(
  proposal.image_publication_state === "PUBLISHED_IMMUTABLE_REUSED_WITHOUT_REPUBLICATION" &&
    proposal.image_publication_evidence?.sha256 === expected.publicationSha256,
  "PROPOSAL_PUBLICATION",
);

for (const [key, source] of Object.entries(expected.sourceHashes)) {
  const commit = source.commit === "image" ? expected.imageSourceCommit : expected.controlSourceCommit;
  assert(sha256(readAtCommit(commit, source.path)) === source.sha256, `SOURCE_HASH_${key}`);
  assert(proposal.source_hashes?.[key] === source.sha256, `PROPOSAL_SOURCE_${key}`);
  assert(acceptance.source_hashes?.[key] === source.sha256, `ACCEPTANCE_SOURCE_${key}`);
}
for (const key of ["mage_handler", "mage_publication_workflow"]) {
  const source = expected.sourceHashes[key];
  assert(
    sha256(readAtCommit(expected.controlSourceCommit, source.path)) === source.sha256,
    `IMAGE_UNCHANGED_AT_CONTROL_${key}`,
  );
}

const orchestrator = readAtCommit(
  expected.controlSourceCommit,
  expected.sourceHashes.disposable_orchestrator.path,
).toString("utf8");
for (const sourceFragment of [
  "const ROUTE_RESPONSE_MAX_BYTES = 4_096;",
  "V207_DISPOSABLE_ROUTE_RESPONSE_",
  'error.code === "V207_DISPOSABLE_ROUTE_UNREACHABLE"',
  'error.statusClass === "S5XX"',
  'error.versionState === "VMATCHED"',
  "if (firstExactMatchSeen || !isRetryableActiveRoutePreMatch(error)) throw error;",
  'observed.status === 404',
  'observed.code === "V207_ROUTE_DISABLED"',
  "observed.workerVersionId !== expectedWorkerVersionId",
  "const ROUTE_PROPAGATION_MAX_ATTEMPTS = 30;",
  "const ROUTE_PROPAGATION_MAX_MILLISECONDS = 60_000;",
  "const ROUTE_PROPAGATION_RETRY_MILLISECONDS = 2_000;",
  "if (result.exitCode !== 2)",
  "Buffer.byteLength(result.stderr) !== 0",
  "V207_OUTPUT_PREWRITE_HEAD_FAILED",
  "V207_OUTPUT_BODY_READ_FAILED",
  "V207_OUTPUT_BUCKET_WRITE_FAILED",
  "V207_OUTPUT_POSTWRITE_HEAD_FAILED",
]) {
  assert(orchestrator.includes(sourceFragment), "ORCHESTRATOR_SOURCE_CONTRACT");
}

const orchestratorTest = readAtCommit(
  expected.controlSourceCommit,
  expected.sourceHashes.disposable_orchestrator_test.path,
).toString("utf8");
for (const testFragment of [
  "recovers from one pre-match unreachable read",
  "recovers from one exact-version pre-match S5XX response diagnostic",
  "bounds persistent exact-version pre-match S5XX diagnostics",
  "terminal after the first exact active match",
  "keeps a pre-match S5XX diagnostic with %s version metadata immediately terminal",
  'call.command === "python3"',
]) {
  assert(orchestratorTest.includes(testFragment), "ORCHESTRATOR_TEST_CONTRACT");
}

assert(
  proposal.independent_audit?.result === "PASS_ZERO_P0_ZERO_P1_ZERO_P2" &&
    proposal.independent_audit?.artifact_sha256 === expected.auditSha256 &&
    proposal.independent_audit?.materialization_pending === false,
  "PROPOSAL_AUDIT",
);
assert(
  audit.result === "PASS_ZERO_P0_ZERO_P1_ZERO_P2" &&
    audit.findings?.p0 === 0 &&
    audit.findings?.p1 === 0 &&
    audit.findings?.p2 === 0 &&
    audit.provider_activity?.provider_calls === 0 &&
    audit.provider_activity?.provider_mutations === 0 &&
    audit.provider_activity?.gpu_jobs_submitted === 0 &&
    audit.verified_contract
      ?.established_disabled_predecessor_allowance_requires_404_disabled_code_and_distinct_valid_uuid ===
      true &&
    audit.authority?.granted === false,
  "AUDIT_RESULT",
);
assert(
  proposal.repair?.active_route_retry_policy.includes("404 V207_ROUTE_DISABLED") &&
    proposal.repair?.active_route_retry_policy.includes("distinct valid predecessor UUID") &&
    acceptance.repair
      ?.pre_first_match_structured_404_disabled_distinct_valid_predecessor_uuid_allowance_preserved ===
      true,
  "ESTABLISHED_PREDECESSOR_ALLOWANCE",
);
assert(
  acceptance.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    acceptance.proposal_sha256 === expected.proposalSha256 &&
    acceptance.independent_reaudit?.artifact_sha256 === expected.auditSha256,
  "ACCEPTANCE_STATE",
);
assert(
  acceptance.authority_materialization?.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    acceptance.authority_materialization?.preapproval_acceptance_sha256 ===
      expected.preapprovalAcceptanceSha256 &&
    acceptance.authority_materialization?.authority_path === "approved-authority.json" &&
    acceptance.authority_materialization?.authority_sha256 === expected.authoritySha256 &&
    acceptance.authority_materialization?.activation_source_canonical_sha256 ===
      expected.activationCanonicalSha256,
  "ACCEPTANCE_AUTHORITY_MATERIALIZATION",
);
assert(
  acceptance.authority?.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    acceptance.authority?.provider_calls_authorized === true &&
    acceptance.authority?.provider_mutations_authorized === true &&
    acceptance.authority?.credential_access_authorized === true &&
    acceptance.authority?.image_publication_authorized === false &&
    acceptance.authority?.image_republication_authorized === false &&
    acceptance.authority?.reuse_published_image_authorized === true &&
    acceptance.authority?.gpu_use_authorized === true &&
    acceptance.authority?.maximum_cumulative_finite_spend_usd === 4.5 &&
    acceptance.authority?.executable_finite_cap_usd === 4.5 &&
    acceptance.authority?.anchor_refresh_authorized === false &&
    acceptance.authority?.v2_08_authorized === false &&
    acceptance.authority?.consumed === false &&
    acceptance.authority?.reusable === false &&
    acceptance.authority?.single_use === true &&
    acceptance.authority?.authority_path === "approved-authority.json" &&
    acceptance.authority?.authority_sha256 === expected.authoritySha256,
  "ACCEPTANCE_AUTHORITY",
);
assert(
  authority.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    authority.authorized_at === expected.authorizedAt &&
    authority.exact_user_approval === expected.exactUserApproval &&
    authority.proposal_sha256 === expected.proposalSha256 &&
    authority.control_source_commit === expected.controlSourceCommit &&
    authority.image_source_commit === expected.imageSourceCommit &&
    authority.image.endsWith(`@${expected.imageDigest}`) &&
    authority.reuse_published_image_authorized === true &&
    authority.image_republication_authorized === false &&
    authority.pre_first_match_structured_disabled_distinct_predecessor_allowance_required === true &&
    authority.pre_first_match_unreachable_recovery_required === true &&
    authority.pre_first_match_exact_version_s5xx_recovery_required === true &&
    authority.route_propagation_max_reads === 30 &&
    authority.route_propagation_max_seconds === 60 &&
    authority.route_propagation_sleep_seconds === 2 &&
    authority.post_first_match_retry_authorized === false &&
    authority.other_route_response_diagnostic_retry_authorized === false &&
    authority.maximum_cumulative_finite_spend_usd === 4.5 &&
    authority.serverless_flex_usd_per_gpu_hour === 1.116 &&
    authority.gpu === "NVIDIA GeForce RTX 4090" &&
    authority.region === "EU-RO-1" &&
    authority.workers_min === 0 &&
    authority.workers_max_initial === 1 &&
    authority.workers_max_temporary === 2 &&
    authority.anchor_refresh_authorized === false &&
    authority.automatic_gpu_fallback_authorized === false &&
    authority.retained_volume_charge_usd_per_month === 7 &&
    authority.retained_volume_mutation_authorized === false &&
    authority.signal_safe_cleanup_required === true &&
    authority.final_zero_compute_disposable_reconciliation_reads === 3 &&
    authority.v2_08_authorized === false &&
    authority.single_use === true &&
    authority.preapproval_acceptance_sha256 === expected.preapprovalAcceptanceSha256 &&
    authority.independent_audit_sha256 === expected.auditSha256,
  "AUTHORITY_SCOPE",
);
assert(
  proposal.placement_and_cost?.maximum_cumulative_finite_spend_usd === 4.5 &&
    proposal.placement_and_cost?.serverless_flex_usd_per_gpu_hour === 1.116 &&
    proposal.placement_and_cost?.retained_volume_charge_usd_per_month === 7 &&
    proposal.placement_and_cost?.gpu_fallback === false,
  "PROPOSAL_COST",
);
assert(
  proposal.operation_contract?.workers_min === 0 &&
    proposal.operation_contract?.workers_max_initial === 1 &&
    proposal.operation_contract?.workers_max_temporary === 2 &&
    proposal.operation_contract?.publish_exact_immutable_mage_image === false &&
    proposal.operation_contract?.image_republication_authorized === false &&
    proposal.operation_contract?.anchor_refresh_authorized === false &&
    proposal.operation_contract?.v2_08_authorized === false,
  "PROPOSAL_BOUNDARIES",
);
assert(
  proposal.predecessor?.closure_sha256 === expected.predecessorClosureSha256 &&
    proposal.predecessor?.orchestrator_sha256 === expected.predecessorOrchestratorSha256 &&
    proposal.predecessor?.reconciliation_sha256 === expected.predecessorReconciliationSha256 &&
    proposal.predecessor?.authority_status === "CONSUMED_FAILED_CLEAN_NON_REUSABLE",
  "PROPOSAL_PREDECESSOR",
);
assert(
  acceptance.predecessor?.closure_sha256 === expected.predecessorClosureSha256 &&
    acceptance.predecessor?.orchestrator_sha256 === expected.predecessorOrchestratorSha256 &&
    acceptance.predecessor?.reconciliation_sha256 === expected.predecessorReconciliationSha256,
  "ACCEPTANCE_PREDECESSOR",
);

console.log("PASS V2-07 Attempt78 route-response recovery authority approved and unconsumed");
