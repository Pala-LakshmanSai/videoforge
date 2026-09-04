import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const candidateDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(candidateDir, "../../../../..");
const candidatePath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-05-attempt80-urllib-user-agent-candidate";
const control = "d530320af723e33c6ce32552743fd00dc063eedc";
const imageSource = control;
const imageDigest = "sha256:91ef608fbb15bc69213c73a598a8915fa4dfa938d02c619454e42319a6475f62";
const proposalHash = "sha256:2f38c58468d1183c0cf50c98b0ec123740b7fa74c0733d8167d35e650881e99b";
const preapprovalAcceptanceHash =
  "sha256:0faf8ef24bec614df4281c99d9f1ca7d12380bc19ddb682d89ce4532d0cb68f6";
const approvedAcceptanceBeforeAuthorityAuditHash =
  "sha256:4842af5514e885518e314093f5acaa4af1acbd1bc52f342f22de6ccb7bcf2b0e";
const acceptanceHash = "sha256:48cc956d04a85de6727294223de4f9b05eaf5535435b6f5c3850fc6e6e09ce55";
const auditHash = "sha256:1177c5389749bbdaf355a125625d01b48ef4559c9e49393cbf4bf292cd561058";
const authorityHash = "sha256:ad16101ee8d1dc33cc5237e6ff57ef7762a6b4b77b1b98e46e38a7fa53d4af7f";
const authorityAuditHash =
  "sha256:4bf581dc12ce48c43df5abbf186a6e5a8282a8aa29cfe4e24dec2d3af35a6e5d";
const exactApprovalHash =
  "sha256:898a6a6793c972295f23d2c8feab31ba54da0a03d1affb41f338ba06f018041e";
const activationSourceHash =
  "sha256:c1da826aa2765eefd31f23be0a130fcde78d8c6e09db30a777acf547fb6f4ac6";
const activationTestHash =
  "sha256:deaaa394c375fa8429366bba9d4c5cc8bc23a89ce551814c31a4cc24cbed97ac";
const activationCanonicalHash =
  "sha256:61a7c899c29a5eaf1cfe86112cf58d46e39e5733defb5d92a22904c220adf4d3";
const authorizedAt = "2026-09-05T00:39:25+05:30";
const identityHash = "sha256:435dc655487986903c57a500c5f3a365ee5893bbb3ba47a3ec224aaef0d3c614";
const verificationHash = "sha256:f0d76e61167704cefbd26deca6067b68117b14741c2210762055654e1f0c8c3a";
const sources = Object.freeze({
  disposable_orchestrator: [
    "apps/web/src/server/providers/v207-disposable-live-orchestrator.ts",
    "sha256:ec457d09ff9ea2f17b978fe51c575e0b32366d7942520665459ccabe4916fb3d",
  ],
  disposable_orchestrator_test: [
    "apps/web/src/server/providers/v207-disposable-live-orchestrator.test.ts",
    "sha256:5c3db52f514dabf15311df513d0f123508c26e3f8bec048b3d2a635b871367a6",
  ],
  disposable_output_ports: [
    "apps/web/src/server/hosted/v207-disposable-output-ports.ts",
    "sha256:fa4d9954af19a2ae14853185da44a94d00120f48edeb24568bac126326b901b5",
  ],
  disposable_output_ports_test: [
    "apps/web/src/server/hosted/v207-disposable-output-ports.test.ts",
    "sha256:720b6210c274fadef9232237b1b397428d8b9827d04428f77d36b27eeba5c853",
  ],
  disposable_worker_entry: [
    "apps/web/worker/v207-qualification-output.ts",
    "sha256:264c4e08bcf8a413660f96144ecebbdcf6c0eaedf64e92755ae489ef50c162ba",
  ],
  disposable_wrangler_config: [
    "deploy/v2-07/v207-disposable-output.wrangler.jsonc",
    "sha256:22e1cf0318f683a4e56e836f8fcc446bf755416481f5b13b5aa4d52ca2f89084",
  ],
  harness: [
    "apps/web/src/server/providers/runpod-v207-qualification-harness.ts",
    "sha256:39da9a77290aa9a61a109578edb285279a058e4d38ec1e55f599943052eaa18d",
  ],
  qualification: [
    "apps/web/src/server/providers/v207-live-qualification.ts",
    "sha256:13e7d1581358fa660726d36989355daca8b964a9c61fbc91ad18cb5ef580f121",
  ],
  reconciliation: [
    "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts",
    "sha256:33f5ad2874bd6fb51591c40486ddff2ea7cc27157003c9b98f3fe45bb97b3f8b",
  ],
  shared_live_orchestrator: [
    "apps/web/src/server/providers/v207-live-orchestrator.ts",
    "sha256:20850aae064d955dbc097af630f30b7ac5c50fb61e628bc856d4f74a2d4e8414",
  ],
  mage_handler: [
    "workers/image-media/mage_serverless.py",
    "sha256:8fd7e47308b64865b117bca3bfb3ee41d269935e13660f13a23a15b90d83f96c",
  ],
  serverless_envelope: [
    "workers/common/serverless_envelope.py",
    "sha256:34949be02521ec896c27794ad382cfa4d2bd6f1b799615716a5dc2b9ce2e41d0",
  ],
  execution_subset_schema: [
    "packages/contracts/python/videoforge_contracts/_schema_documents.py",
    "sha256:08fd73862b7d79f685dfaf1b72dd6b1e41468f3f581ad766ffea1f85c9dbf66f",
  ],
  mage_publication_workflow: [
    ".github/workflows/mage-image.yml",
    "sha256:4ac55208ee9a76f781cb09471d32f033f468484d6a4e56a70984e80974d24508",
  ],
  overlay_builder: [
    "workers/image-media/build_mage_oci_overlay.py",
    "sha256:a5f1c829b4b0a8491d9613df74d0d0349f78b2b819f9478ca64d222c91f437ab",
  ],
  overlay_publisher: [
    "workers/image-media/publish_mage_oci_overlay.py",
    "sha256:f263329cdf89d5f47548410390983cb8df5e63d8489f75fa94ab30e3aedc80d2",
  ],
  overlay_verifier: [
    "workers/image-media/verify_mage_oci_overlay.py",
    "sha256:14ad4b1d3b7018ea80efc2ece9fcafca494069e663108f4b9a50afffba811776",
  ],
});

function fail(label) {
  throw new Error(`V207_ATTEMPT80_${label}`);
}
function assert(condition, label) {
  if (!condition) fail(label);
}
function read(path) {
  return readFileSync(resolve(repoRoot, path));
}
function readAtCommit(path) {
  return execFileSync("git", ["show", `${control}:${path}`], { cwd: repoRoot, encoding: null });
}
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function json(path) {
  return JSON.parse(read(path).toString("utf8"));
}

const proposalPath = `${candidatePath}/combined-live-proposal.json`;
const acceptancePath = `${candidatePath}/acceptance.json`;
const auditPath = `${candidatePath}/independent-audit.json`;
const identityPath = `${candidatePath}/local-image-identity.json`;
const verificationPath = `${candidatePath}/local-image-verification.json`;
const authorityPath = `${candidatePath}/approved-authority.json`;
const authorityAuditPath = `${candidatePath}/authority-independent-audit.json`;
const activationSourcePath = "apps/web/src/server/providers/v207-activation-authority.ts";
const activationTestPath = "apps/web/src/server/providers/v207-activation-authority.test.ts";

assert(sha256(read(proposalPath)) === proposalHash, "PROPOSAL_HASH");
assert(sha256(read(acceptancePath)) === acceptanceHash, "ACCEPTANCE_HASH");
assert(sha256(read(auditPath)) === auditHash, "AUDIT_HASH");
assert(sha256(read(identityPath)) === identityHash, "IDENTITY_HASH");
assert(sha256(read(verificationPath)) === verificationHash, "VERIFICATION_HASH");
assert(existsSync(resolve(repoRoot, authorityPath)), "APPROVED_AUTHORITY_REQUIRED");
assert(sha256(read(authorityPath)) === authorityHash, "AUTHORITY_HASH");
assert(existsSync(resolve(repoRoot, authorityAuditPath)), "AUTHORITY_AUDIT_REQUIRED");
assert(sha256(read(authorityAuditPath)) === authorityAuditHash, "AUTHORITY_AUDIT_HASH");
assert(sha256(read(activationSourcePath)) === activationSourceHash, "ACTIVATION_SOURCE_HASH");
assert(sha256(read(activationTestPath)) === activationTestHash, "ACTIVATION_TEST_HASH");

const proposal = json(proposalPath);
const acceptance = json(acceptancePath);
const audit = json(auditPath);
const identity = json(identityPath);
const verification = json(verificationPath);
const authority = json(authorityPath);
const authorityAudit = json(authorityAuditPath);

assert(
  proposal.attempt === 80 &&
    proposal.checkpoint === "V2-07" &&
    proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_NO_EXECUTABLE_AUTHORITY" &&
    proposal.control_source_commit === control &&
    proposal.image_source_commit === imageSource &&
    proposal.image.endsWith(`@${imageDigest}`) &&
    proposal.image_publication_state === "EXPECTED_DETERMINISTIC_DIGEST_NOT_YET_PUBLISHED",
  "PROPOSAL_IDENTITY",
);
for (const [key, [path, hash]] of Object.entries(sources)) {
  assert(sha256(readAtCommit(path)) === hash, `SOURCE_HASH_${key}`);
  assert(proposal.source_hashes?.[key] === hash, `PROPOSAL_SOURCE_${key}`);
  assert(acceptance.source_hashes?.[key] === hash, `ACCEPTANCE_SOURCE_${key}`);
}

for (const record of [identity, verification]) {
  assert(record.source_commit === imageSource, "IMAGE_SOURCE");
  assert(record.manifest_digest === imageDigest, "IMAGE_DIGEST");
  assert(
    record.config_digest ===
      "sha256:2aa6c2d124fe299502e3142e4f66d9d627855a3c63eda30b806febb588ec4bb2",
    "CONFIG_DIGEST",
  );
  assert(
    record.layer_digest ===
      "sha256:5c54508181bbdaf45691e7db0f4f907194ad7ff1cd38b0f86bfc0469bca0a334",
    "LAYER_DIGEST",
  );
}

const mage = readAtCommit("workers/image-media/mage_serverless.py").toString("utf8");
const orchestrator = readAtCommit(
  "apps/web/src/server/providers/v207-disposable-live-orchestrator.ts",
).toString("utf8");
for (const fragment of [
  '_HTTP_USER_AGENT = "VideoForge-Mage/V2-07"',
  '"accept": "application/json"',
  '"accept": "application/octet-stream"',
  '"user-agent": _HTTP_USER_AGENT',
]) {
  assert(mage.includes(fragment), "MAGE_HEADER_CONTRACT");
}
for (const fragment of [
  "'accept':'application/json'",
  "'user-agent':'VideoForge-Mage/V2-07'",
  "const PROBE_CLEAN_CYCLES = 3;",
  'await record("pre_gpu_output_compatibility_probe_completed", {',
  "const qualification = await run({",
]) {
  assert(orchestrator.includes(fragment), "ORCHESTRATOR_CONTRACT");
}
assert(
  orchestrator.indexOf('await record("pre_gpu_output_compatibility_probe_completed", {') <
    orchestrator.indexOf("const qualification = await run({"),
  "GATE_BEFORE_GPU",
);

assert(
  audit.result === "PASS_ZERO_P0_ZERO_P1_ZERO_P2" &&
    audit.findings?.p0 === 0 &&
    audit.findings?.p1 === 0 &&
    audit.findings?.p2 === 0 &&
    proposal.independent_audit?.artifact_sha256 === auditHash,
  "INDEPENDENT_AUDIT",
);
assert(
  proposal.operation_contract?.publish_exact_immutable_mage_image_once === true &&
    proposal.operation_contract?.direct_publication_without_github_actions_queue === true &&
    proposal.operation_contract?.three_exact_active_route_fingerprints_required === true &&
    proposal.operation_contract?.three_distinct_fully_cleaned_pre_gpu_compatibility_cycles_required ===
      true &&
    proposal.operation_contract?.run_existing_bounded_runpod_stage6_qualification_only_after_gate ===
      true &&
    proposal.operation_contract?.volume_mutation_authorized === false &&
    proposal.operation_contract?.anchor_refresh_authorized === false &&
    proposal.operation_contract?.v2_08_authorized === false,
  "OPERATION_CONTRACT",
);
assert(
  proposal.placement_and_cost?.serverless_flex_usd_per_gpu_hour === 1.116 &&
    proposal.placement_and_cost?.maximum_cumulative_finite_spend_usd === 4.5 &&
    proposal.placement_and_cost?.retained_volume_charge_usd_per_month === 7 &&
    proposal.placement_and_cost?.gpu_fallback === false,
  "COST_BOUNDARY",
);
assert(
  acceptance.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    acceptance.proposal_sha256 === proposalHash &&
    acceptance.image_published === false &&
    acceptance.image_publication_authorized === true &&
    acceptance.authority_materialization?.preapproval_acceptance_sha256 ===
      preapprovalAcceptanceHash &&
    acceptance.authority_materialization?.authority_sha256 === authorityHash &&
    acceptance.authority_materialization?.activation_source_canonical_sha256 ===
      activationCanonicalHash &&
    acceptance.authority_independent_audit?.artifact_sha256 === authorityAuditHash &&
    acceptance.authority_independent_audit?.audited_approved_acceptance_sha256 ===
      approvedAcceptanceBeforeAuthorityAuditHash &&
    acceptance.authority?.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    acceptance.authority?.provider_calls_authorized === true &&
    acceptance.authority?.provider_mutations_authorized === true &&
    acceptance.authority?.credential_access_authorized === true &&
    acceptance.authority?.image_publication_authorized === true &&
    acceptance.authority?.gpu_use_authorized === true &&
    acceptance.authority?.maximum_cumulative_finite_spend_usd === 4.5 &&
    acceptance.authority?.executable_finite_cap_usd === 4.5 &&
    acceptance.authority?.anchor_refresh_authorized === false &&
    acceptance.authority?.retained_volume_mutation_authorized === false &&
    acceptance.authority?.v2_08_authorized === false &&
    acceptance.authority?.consumed === false &&
    acceptance.authority?.reusable === false &&
    acceptance.authority?.single_use === true &&
    acceptance.authority?.authority_sha256 === authorityHash,
  "APPROVED_ACCEPTANCE",
);

assert(
  authority.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    authority.authorized_at === authorizedAt &&
    authority.exact_user_approval_sha256 === exactApprovalHash &&
    sha256(Buffer.from(authority.exact_user_approval)) === exactApprovalHash &&
    authority.proposal_sha256 === proposalHash &&
    authority.preapproval_acceptance_sha256 === preapprovalAcceptanceHash &&
    authority.independent_audit_sha256 === auditHash &&
    authority.control_source_commit === control &&
    authority.image_source_commit === imageSource &&
    authority.image.endsWith(`@${imageDigest}`) &&
    authority.image_publication_authorized === true &&
    authority.direct_publication_without_github_actions_queue_authorized === true &&
    authority.anonymous_full_image_readback_required === true &&
    authority.urllib_request_user_agent === "VideoForge-Mage/V2-07" &&
    authority.active_route_exact_fingerprints_required === 3 &&
    authority.pre_gpu_full_compatibility_cycles_required === 3 &&
    authority.each_pre_gpu_cycle_cleanup_required_before_next === true &&
    authority.reserve_retry_max_attempts === 3 &&
    authority.reserve_retry_wait_milliseconds === 250 &&
    authority.reserve_retry_transport_or_missing_version_s5xx_only === true &&
    authority.other_probe_retry_authorized === false &&
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
    authority.final_zero_compute_disposable_reconciliation_reads === 3 &&
    authority.v2_08_authorized === false &&
    authority.single_use === true,
  "AUTHORITY_SCOPE",
);
assert(
  authorityAudit.result === "PASS_ZERO_P0_ZERO_P1_ZERO_P2" &&
    authorityAudit.findings?.p0 === 0 &&
    authorityAudit.findings?.p1 === 0 &&
    authorityAudit.findings?.p2 === 0 &&
    authorityAudit.audited_artifacts?.approved_acceptance_before_audit_binding_sha256 ===
      approvedAcceptanceBeforeAuthorityAuditHash &&
    authorityAudit.audited_artifacts?.approved_authority_sha256 === authorityHash &&
    authorityAudit.audited_artifacts?.exact_user_approval_sha256 === exactApprovalHash &&
    authorityAudit.audited_artifacts?.activation_source_sha256 === activationSourceHash &&
    authorityAudit.audited_artifacts?.activation_test_sha256 === activationTestHash &&
    authorityAudit.audited_artifacts?.canonical_activation_source_sha256 ===
      activationCanonicalHash,
  "AUTHORITY_AUDIT",
);

const activationSource = read(activationSourcePath).toString("utf8");
for (const fragment of [proposalHash, control, authorityHash, "= 4.5;", "= false;"]) {
  assert(activationSource.includes(fragment), "ACTIVATION_BINDING");
}

console.log("PASS V2-07 Attempt80 authority approved and unconsumed");
