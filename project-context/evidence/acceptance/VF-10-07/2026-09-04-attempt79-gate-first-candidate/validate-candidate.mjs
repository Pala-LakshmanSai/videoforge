import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const candidateDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(candidateDir, "../../../../..");
const candidatePath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt79-gate-first-candidate";
const control = "fb884fedf86c5ff5ec3e5bb4274c4a1e3db41fd6";
const imageSource = "51d7de6cb3c0d88ddcb06df533864bf319a1210f";
const imageDigest = "sha256:8d29829130b3efcc1eb1c5daf189f6caeeb65236eeb263cf643d3c692f01e37d";
const proposalHash = "sha256:72f72a2de48841194233218c2f84d343c0c236ed36d5ff33a0c6dc682312d22a";
const preapprovalAcceptanceHash =
  "sha256:9a41b52f8b49dca410fc5a7219ff3a773b416253a976b975a2cae3f4a82aefff";
const approvedAcceptanceBeforeAuthorityAuditHash =
  "sha256:9fdbae3d5ccc68649c1545bb28a225acc25dbb40c029297d8cfa1d928cd52a99";
const acceptanceHash = "sha256:44b9b8eaf4e3309fcf11ee784681ce9cad2981932a6c77fddcdb7799834216b0";
const auditHash = "sha256:c98f3d3d2a4b2e37cff700b8e7b2e04d200e4b97731d2056da2871ffbac81987";
const authorityHash = "sha256:fe0ccd5c3165488bc206f6a159637ad34af9ab994f19dfbcf374ae53629090da";
const authorityAuditHash =
  "sha256:9bc27ff8ebc95d9aa80fd6790ffe59030a53da2d421fbbcf0fdb1049d1acf465";
const exactApprovalHash =
  "sha256:9e237e93c5fb1bf2941fa7a229d7d0680f0d6b0186d34c8b395b8ba0529b5247";
const activationSourceHash =
  "sha256:b1f4bcec51a8f254528a1814a8da15acd53c2a8fb896a71508c537d1df090c56";
const activationTestHash =
  "sha256:e108b79429ab6b6ee82ba3bfa4b076b8b7f0b24d0c02b29358dc6dba47bcc848";
const activationCanonicalHash =
  "sha256:08423e8d254543893ef87a05790f0eb9ed252d55831d54edf20f70efe4c5005c";
const authorizedAt = "2026-09-04T23:57:07+05:30";
const exactUserApproval =
  "I approve V2-07 Attempt79 proposal sha256:72f72a2de48841194233218c2f84d343c0c236ed36d5ff33a0c6dc682312d22a, control source fb884fedf86c5ff5ec3e5bb4274c4a1e3db41fd6, image source 51d7de6cb3c0d88ddcb06df533864bf319a1210f, reuse without republication of Mage image digest sha256:8d29829130b3efcc1eb1c5daf189f6caeeb65236eeb263cf643d3c692f01e37d, the $4.50 cumulative finite cap, RTX 4090 EU-RO-1 at $1.116/GPU-hour, workersMin zero and temporary max two workers, fresh inventory/catalog/billing/rate/capacity/disposable-worker-absence preflight, three exact active-route fingerprints, three distinct fully cleaned pre-GPU Python urllib upload/finalize/get/readback/delete cycles, RESERVE-only maximum three attempts with 250-millisecond waits for transport loss or version-missing S5XX, fixed redaction-safe stage/version/status diagnostics, RunPod Stage 6 qualification only after all three cycles pass, disposable output/endpoint/template/worker/route deletion, signal-safe cleanup, three final zero-compute reads, continued $7/month volume retention, no GPU fallback, no rollback-anchor refresh, no retained-volume mutation, and no V2-08 execution.";
const publicationHash =
  "sha256:02fb25196188fcaf9927ece504011d3f1e931d1f87053e88971b4e6b75126677";
const predecessorHashes = Object.freeze({
  closure: "sha256:6ae6b03b0e3e3cdb309da4e123b1ca746745289e407341388b986e9818be5003",
  orchestrator: "sha256:eeba93083e40c83552fc5d3b5204a464b33cb0eaa1042b40f8b6778a4ab0f500",
  reconciliation:
    "sha256:5e0134097e0552a53b748db28a1e44fbcace5e865297ae152c0c7ba4610f943e",
});
const sources = Object.freeze({
  disposable_orchestrator: [
    "control",
    "apps/web/src/server/providers/v207-disposable-live-orchestrator.ts",
    "sha256:9d878abecee387cca7cc0f1c8906791559c9476d2769693d669bdef3551de52b",
  ],
  disposable_orchestrator_test: [
    "control",
    "apps/web/src/server/providers/v207-disposable-live-orchestrator.test.ts",
    "sha256:310f3246069d8dbd412fb03acf9de1d2c6a14f1e983159bcfbf6c7765f1bac53",
  ],
  disposable_output_ports: [
    "control",
    "apps/web/src/server/hosted/v207-disposable-output-ports.ts",
    "sha256:fa4d9954af19a2ae14853185da44a94d00120f48edeb24568bac126326b901b5",
  ],
  disposable_output_ports_test: [
    "control",
    "apps/web/src/server/hosted/v207-disposable-output-ports.test.ts",
    "sha256:720b6210c274fadef9232237b1b397428d8b9827d04428f77d36b27eeba5c853",
  ],
  disposable_worker_entry: [
    "control",
    "apps/web/worker/v207-qualification-output.ts",
    "sha256:264c4e08bcf8a413660f96144ecebbdcf6c0eaedf64e92755ae489ef50c162ba",
  ],
  disposable_wrangler_config: [
    "control",
    "deploy/v2-07/v207-disposable-output.wrangler.jsonc",
    "sha256:22e1cf0318f683a4e56e836f8fcc446bf755416481f5b13b5aa4d52ca2f89084",
  ],
  harness: [
    "control",
    "apps/web/src/server/providers/runpod-v207-qualification-harness.ts",
    "sha256:39da9a77290aa9a61a109578edb285279a058e4d38ec1e55f599943052eaa18d",
  ],
  qualification: [
    "control",
    "apps/web/src/server/providers/v207-live-qualification.ts",
    "sha256:13e7d1581358fa660726d36989355daca8b964a9c61fbc91ad18cb5ef580f121",
  ],
  reconciliation: [
    "control",
    "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts",
    "sha256:33f5ad2874bd6fb51591c40486ddff2ea7cc27157003c9b98f3fe45bb97b3f8b",
  ],
  shared_live_orchestrator: [
    "control",
    "apps/web/src/server/providers/v207-live-orchestrator.ts",
    "sha256:20850aae064d955dbc097af630f30b7ac5c50fb61e628bc856d4f74a2d4e8414",
  ],
  mage_handler: [
    "image",
    "workers/image-media/mage_serverless.py",
    "sha256:c4945aabfa9cdb9f18aa9b514d2ec1dfc533865857ac0ee280019cb643961e3c",
  ],
  mage_publication_workflow: [
    "image",
    ".github/workflows/mage-image.yml",
    "sha256:1d21e41ab3f5de2bc3a077bdcce799548b70c5dfa9ad0107191c8cff39c38a09",
  ],
});

function fail(label) {
  throw new Error(`V207_ATTEMPT79_${label}`);
}
function assert(condition, label) {
  if (!condition) fail(label);
}
function read(path) {
  return readFileSync(resolve(repoRoot, path));
}
function readAtCommit(commit, path) {
  return execFileSync("git", ["show", `${commit}:${path}`], { cwd: repoRoot, encoding: null });
}
function sha256(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
function json(path) {
  return JSON.parse(read(path).toString("utf8"));
}

function canonicalActivationSource(source) {
  return source
    .replace(
      /^export\s+const\s+V207_PENDING_PROPOSAL_SHA256\s*=\s*"sha256:[a-f0-9]{64}"\s+as\s+const\s*;/gmu,
      `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${"0".repeat(64)}" as const;`,
    )
    .replace(
      /^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*(?:"sha256:[a-f0-9]{64}"|null)\s*;/gmu,
      "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;",
    )
    .replace(
      /^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)\s*;/gmu,
      "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;",
    )
    .replace(
      /^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*(?:true|false|null)\s*;/gmu,
      "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;",
    );
}

const proposalPath = `${candidatePath}/combined-live-proposal.json`;
const acceptancePath = `${candidatePath}/acceptance.json`;
const auditPath = `${candidatePath}/independent-audit.json`;
const authorityPath = `${candidatePath}/approved-authority.json`;
const authorityAuditPath = `${candidatePath}/authority-independent-audit.json`;
const activationSourcePath = "apps/web/src/server/providers/v207-activation-authority.ts";
const activationTestPath = "apps/web/src/server/providers/v207-activation-authority.test.ts";
const publicationPath =
  "project-context/evidence/acceptance/VF-10-07/2026-09-04-attempt75-urllib-pregpu-candidate/image-publication.json";
const predecessorPaths = Object.freeze({
  closure:
    "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/failed-attempt-78.json",
  orchestrator:
    "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/attempt78-live-orchestrator.json",
  reconciliation:
    "project-context/evidence/acceptance/VF-10-07/2026-09-04-live-qualification/attempt78-readonly-reconciliation.json",
});

assert(sha256(read(proposalPath)) === proposalHash, "PROPOSAL_HASH");
assert(sha256(read(acceptancePath)) === acceptanceHash, "ACCEPTANCE_HASH");
assert(sha256(read(auditPath)) === auditHash, "AUDIT_HASH");
assert(existsSync(resolve(repoRoot, authorityPath)), "APPROVED_AUTHORITY_REQUIRED");
assert(sha256(read(authorityPath)) === authorityHash, "AUTHORITY_HASH");
assert(existsSync(resolve(repoRoot, authorityAuditPath)), "AUTHORITY_AUDIT_REQUIRED");
assert(sha256(read(authorityAuditPath)) === authorityAuditHash, "AUTHORITY_AUDIT_HASH");
assert(sha256(read(activationSourcePath)) === activationSourceHash, "ACTIVATION_SOURCE_HASH");
assert(sha256(read(activationTestPath)) === activationTestHash, "ACTIVATION_TEST_HASH");
assert(sha256(readAtCommit(control, publicationPath)) === publicationHash, "PUBLICATION_HASH");
for (const [key, path] of Object.entries(predecessorPaths)) {
  assert(sha256(readAtCommit(control, path)) === predecessorHashes[key], `PREDECESSOR_${key}`);
}
execFileSync("git", ["merge-base", "--is-ancestor", imageSource, control], {
  cwd: repoRoot,
  stdio: "ignore",
});

const proposal = json(proposalPath);
const acceptance = json(acceptancePath);
const audit = json(auditPath);
const authority = json(authorityPath);
const authorityAudit = json(authorityAuditPath);
assert(
  proposal.attempt === 79 &&
    proposal.checkpoint === "V2-07" &&
    proposal.qualification_status === "NOT_QUALIFIED" &&
    proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_NO_EXECUTABLE_AUTHORITY",
  "PROPOSAL_IDENTITY",
);
assert(
  proposal.control_source_commit === control &&
    proposal.image_source_commit === imageSource &&
    proposal.image.endsWith(`@${imageDigest}`) &&
    proposal.image_publication_state === "PUBLISHED_IMMUTABLE_REUSED_WITHOUT_REPUBLICATION",
  "PROPOSAL_LINEAGE",
);
for (const [key, [sourceKind, path, hash]] of Object.entries(sources)) {
  const sourceCommit = sourceKind === "image" ? imageSource : control;
  assert(sha256(readAtCommit(sourceCommit, path)) === hash, `SOURCE_HASH_${key}`);
  assert(proposal.source_hashes?.[key] === hash, `PROPOSAL_SOURCE_${key}`);
  assert(acceptance.source_hashes?.[key] === hash, `ACCEPTANCE_SOURCE_${key}`);
  if (sourceKind === "image") {
    assert(sha256(readAtCommit(control, path)) === hash, `IMAGE_UNCHANGED_${key}`);
  }
}

const orchestrator = readAtCommit(
  control,
  "apps/web/src/server/providers/v207-disposable-live-orchestrator.ts",
).toString("utf8");
for (const fragment of [
  "const PROBE_RESERVE_MAX_ATTEMPTS = 3;",
  "const PROBE_RESERVE_RETRY_MILLISECONDS = 250;",
  "const PROBE_CLEAN_CYCLES = 3;",
  'error.code === "V207_DISPOSABLE_PROBE_RESERVE_TRANSPORT_FAILED"',
  'error.statusClass === "S5XX"',
  'error.versionFailure === "MISSING"',
  "V207_DISPOSABLE_PROBE_URLLIB_VERSION_MISSING_",
  "V207_DISPOSABLE_PROBE_URLLIB_VERSION_MALFORMED_",
  "V207_DISPOSABLE_PROBE_URLLIB_VERSION_WRONG_",
  'invalidProbeVersionError(stage, response, "WRONG")',
  'await record("pre_gpu_output_compatibility_probe_cycle_completed", { cycle });',
  'await record("pre_gpu_output_compatibility_probe_completed", {',
]) {
  assert(orchestrator.includes(fragment), "ORCHESTRATOR_CONTRACT");
}

assert(
  audit.result === "PASS_ZERO_P0_ZERO_P1_ZERO_P2" &&
    audit.findings?.p0 === 0 &&
    audit.findings?.p1 === 0 &&
    audit.findings?.p2 === 0 &&
    audit.validation?.focused_disposable_orchestrator_tests === "86/86 PASS" &&
    audit.authority?.granted === false,
  "AUDIT",
);
assert(
  proposal.independent_audit?.artifact_sha256 === auditHash &&
    acceptance.independent_reaudit?.artifact_sha256 === auditHash,
  "AUDIT_BINDING",
);
assert(
  proposal.predecessor?.attempt === 78 &&
    proposal.predecessor?.closure_sha256 === predecessorHashes.closure &&
    proposal.predecessor?.orchestrator_sha256 === predecessorHashes.orchestrator &&
    proposal.predecessor?.reconciliation_sha256 === predecessorHashes.reconciliation &&
    proposal.predecessor?.authority_status === "CONSUMED_FAILED_CLEAN_NON_REUSABLE",
  "PREDECESSOR_BINDING",
);
assert(
  proposal.operation_contract?.three_exact_active_route_fingerprints_required === true &&
    proposal.operation_contract?.three_distinct_fully_cleaned_pre_gpu_compatibility_cycles_required ===
      true &&
    proposal.operation_contract?.run_existing_bounded_runpod_stage6_qualification_only_after_gate ===
      true &&
    proposal.operation_contract?.volume_mutation_authorized === false,
  "GATE_FIRST_CONTRACT",
);
assert(
  proposal.placement_and_cost?.serverless_flex_usd_per_gpu_hour === 1.116 &&
    proposal.placement_and_cost?.baseline_endpoint_spend_usd === 2.266709277551854 &&
    proposal.placement_and_cost?.maximum_cumulative_finite_spend_usd === 4.5 &&
    proposal.placement_and_cost?.retained_volume_charge_usd_per_month === 7 &&
    proposal.placement_and_cost?.gpu_fallback === false,
  "COST_BOUNDARY",
);
assert(
  acceptance.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    acceptance.proposal_sha256 === proposalHash &&
    acceptance.authority_materialization?.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    acceptance.authority_materialization?.preapproval_acceptance_sha256 ===
      preapprovalAcceptanceHash &&
    acceptance.authority_materialization?.authority_sha256 === authorityHash &&
    acceptance.authority_materialization?.activation_source_canonical_sha256 ===
      activationCanonicalHash &&
    acceptance.authority_independent_audit?.result === "PASS_ZERO_P0_ZERO_P1_ZERO_P2" &&
    acceptance.authority_independent_audit?.artifact_path ===
      "authority-independent-audit.json" &&
    acceptance.authority_independent_audit?.artifact_sha256 === authorityAuditHash &&
    acceptance.authority_independent_audit?.audited_approved_acceptance_sha256 ===
      approvedAcceptanceBeforeAuthorityAuditHash &&
    acceptance.authority_independent_audit?.provider_calls === 0 &&
    acceptance.authority_independent_audit?.provider_mutations === 0 &&
    acceptance.authority_independent_audit?.credential_access === 0 &&
    acceptance.authority_independent_audit?.gpu_jobs_submitted === 0 &&
    acceptance.authority_independent_audit?.external_spend_usd === 0 &&
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
    acceptance.authority?.retained_volume_mutation_authorized === false &&
    acceptance.authority?.v2_08_authorized === false &&
    acceptance.authority?.consumed === false &&
    acceptance.authority?.reusable === false &&
    acceptance.authority?.single_use === true &&
    acceptance.authority?.authority_path === "approved-authority.json" &&
    acceptance.authority?.authority_sha256 === authorityHash,
  "APPROVED_ACCEPTANCE",
);

assert(
  authority.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    authority.authorized_at === authorizedAt &&
    authority.exact_user_approval === exactUserApproval &&
    authority.proposal_sha256 === proposalHash &&
    authority.preapproval_acceptance_sha256 === preapprovalAcceptanceHash &&
    authority.independent_audit_sha256 === auditHash &&
    authority.control_source_commit === control &&
    authority.image_source_commit === imageSource &&
    authority.image.endsWith(`@${imageDigest}`) &&
    authority.image_republication_authorized === false &&
    authority.reuse_published_image_authorized === true &&
    authority.fresh_inventory_catalog_billing_rate_capacity_and_disposable_worker_absence_preflight_required ===
      true &&
    authority.active_route_exact_fingerprints_required === 3 &&
    authority.pre_gpu_full_compatibility_cycles_required === 3 &&
    authority.each_pre_gpu_cycle_cleanup_required_before_next === true &&
    authority.distinct_deterministic_object_and_callback_identity_per_cycle_required === true &&
    authority.reserve_retry_max_attempts === 3 &&
    authority.reserve_retry_wait_milliseconds === 250 &&
    authority.reserve_retry_transport_or_missing_version_s5xx_only === true &&
    authority.other_probe_retry_authorized === false &&
    authority.fixed_redaction_safe_stage_version_status_diagnostics_required === true &&
    authority.runpod_stage6_qualification_before_all_pre_gpu_cycles_pass_authorized === false &&
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
    authority.single_use === true,
  "AUTHORITY_SCOPE",
);

assert(
  authorityAudit.attempt === 79 &&
    authorityAudit.checkpoint === "V2-07" &&
    authorityAudit.result === "PASS_ZERO_P0_ZERO_P1_ZERO_P2" &&
    authorityAudit.findings?.p0 === 0 &&
    authorityAudit.findings?.p1 === 0 &&
    authorityAudit.findings?.p2 === 0,
  "AUTHORITY_AUDIT_RESULT",
);
assert(
  authorityAudit.audited_artifacts?.proposal_sha256 === proposalHash &&
    authorityAudit.audited_artifacts?.preapproval_acceptance_sha256 ===
      preapprovalAcceptanceHash &&
    authorityAudit.audited_artifacts?.approved_acceptance_before_audit_binding_sha256 ===
      approvedAcceptanceBeforeAuthorityAuditHash &&
    authorityAudit.audited_artifacts?.preapproval_independent_audit_sha256 === auditHash &&
    authorityAudit.audited_artifacts?.approved_authority_sha256 === authorityHash &&
    authorityAudit.audited_artifacts?.exact_user_approval_sha256 === exactApprovalHash &&
    authorityAudit.audited_artifacts?.activation_source_sha256 === activationSourceHash &&
    authorityAudit.audited_artifacts?.activation_test_sha256 === activationTestHash &&
    authorityAudit.audited_artifacts?.canonical_activation_source_sha256 ===
      activationCanonicalHash,
  "AUTHORITY_AUDIT_LINEAGE",
);
assert(
  authorityAudit.verified_authority?.status === "APPROVED_SINGLE_USE_UNCONSUMED" &&
    authorityAudit.verified_authority?.control_source_commit === control &&
    authorityAudit.verified_authority?.image_source_commit === imageSource &&
    authorityAudit.verified_authority?.image_digest === imageDigest &&
    authorityAudit.verified_authority?.reuse_without_republication === true &&
    authorityAudit.verified_authority
      ?.fresh_inventory_catalog_billing_rate_capacity_and_disposable_worker_absence_preflight_required ===
      true &&
    authorityAudit.verified_authority?.active_route_exact_fingerprints_required === 3 &&
    authorityAudit.verified_authority?.pre_gpu_full_compatibility_cycles_required === 3 &&
    authorityAudit.verified_authority?.each_pre_gpu_cycle_cleanup_required_before_next === true &&
    authorityAudit.verified_authority?.reserve_retry_max_attempts === 3 &&
    authorityAudit.verified_authority?.reserve_retry_wait_milliseconds === 250 &&
    authorityAudit.verified_authority?.reserve_retry_transport_or_missing_version_s5xx_only ===
      true &&
    authorityAudit.verified_authority?.all_other_probe_retries_authorized === false &&
    authorityAudit.verified_authority
      ?.runpod_stage6_before_all_pre_gpu_cycles_pass_authorized === false &&
    authorityAudit.verified_authority?.maximum_cumulative_finite_spend_usd === 4.5 &&
    authorityAudit.verified_authority?.baseline_endpoint_spend_usd === 2.266709277551854 &&
    authorityAudit.verified_authority?.gpu === "NVIDIA GeForce RTX 4090" &&
    authorityAudit.verified_authority?.region === "EU-RO-1" &&
    authorityAudit.verified_authority?.serverless_flex_usd_per_gpu_hour === 1.116 &&
    authorityAudit.verified_authority?.workers_min === 0 &&
    authorityAudit.verified_authority?.workers_max_initial === 1 &&
    authorityAudit.verified_authority?.workers_max_temporary === 2 &&
    authorityAudit.verified_authority?.signal_safe_cleanup_required === true &&
    authorityAudit.verified_authority?.final_zero_compute_disposable_reconciliation_reads === 3 &&
    authorityAudit.verified_authority?.retained_volume_charge_usd_per_month === 7 &&
    authorityAudit.verified_authority?.retained_volume_mutation_authorized === false &&
    authorityAudit.verified_authority?.image_republication_authorized === false &&
    authorityAudit.verified_authority?.automatic_gpu_fallback_authorized === false &&
    authorityAudit.verified_authority?.anchor_refresh_authorized === false &&
    authorityAudit.verified_authority?.v2_08_authorized === false &&
    authorityAudit.verified_authority?.single_use === true &&
    authorityAudit.verified_authority?.consumed === false &&
    authorityAudit.verified_authority?.reusable === false,
  "AUTHORITY_AUDIT_BOUNDARY",
);
assert(
  authorityAudit.verified_activation?.proposal_and_control_exactly_bound === true &&
    authorityAudit.verified_activation?.approved_authority_hash_exactly_bound === true &&
    authorityAudit.verified_activation?.finite_cap_usd === 4.5 &&
    authorityAudit.verified_activation?.anchor_refresh_authorized === false &&
    authorityAudit.verified_activation?.attempt78_and_older_proposals_rejected === true &&
    authorityAudit.verified_activation?.cap_drift_rejected === true &&
    authorityAudit.verified_activation?.image_and_image_source_drift_rejected === true &&
    authorityAudit.verified_activation?.noncyclic_sealed_control_source_preserved === true &&
    authorityAudit.validation?.candidate_validator_before_audit_binding === "PASS" &&
    authorityAudit.validation?.activation_authority_tests === "29/29 PASS" &&
    authorityAudit.validation?.context_validator === "PASS" &&
    authorityAudit.validation?.git_diff_check === "PASS" &&
    authorityAudit.validation?.provider_calls === 0 &&
    authorityAudit.validation?.provider_mutations === 0 &&
    authorityAudit.validation?.credential_access === 0 &&
    authorityAudit.validation?.image_publications === 0 &&
    authorityAudit.validation?.gpu_jobs_submitted === 0 &&
    authorityAudit.validation?.external_spend_usd === 0,
  "AUTHORITY_AUDIT_VALIDATION",
);

const activationSource = read(activationSourcePath).toString("utf8");
assert(sha256(Buffer.from(canonicalActivationSource(activationSource))) === activationCanonicalHash, "ACTIVATION_CANONICAL_HASH");
for (const fragment of [proposalHash, control, authorityHash, "= 4.5;", "= false;"]) {
  assert(activationSource.includes(fragment), "ACTIVATION_BINDING");
}

console.log("PASS V2-07 Attempt79 gate-first authority approved and unconsumed");
