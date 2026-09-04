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
const acceptanceHash = "sha256:9a41b52f8b49dca410fc5a7219ff3a773b416253a976b975a2cae3f4a82aefff";
const auditHash = "sha256:c98f3d3d2a4b2e37cff700b8e7b2e04d200e4b97731d2056da2871ffbac81987";
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

const proposalPath = `${candidatePath}/combined-live-proposal.json`;
const acceptancePath = `${candidatePath}/acceptance.json`;
const auditPath = `${candidatePath}/independent-audit.json`;
const authorityPath = `${candidatePath}/approved-authority.json`;
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
assert(!existsSync(resolve(repoRoot, authorityPath)), "APPROVED_AUTHORITY_FORBIDDEN");
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
  acceptance.status === "SEALED_AWAITING_FRESH_EXACT_APPROVAL" &&
    acceptance.proposal_sha256 === proposalHash &&
    acceptance.authority?.status === "NOT_GRANTED_AWAITING_FRESH_EXACT_APPROVAL" &&
    acceptance.authority?.provider_calls_authorized === false &&
    acceptance.authority?.provider_mutations_authorized === false &&
    acceptance.authority?.credential_access_authorized === false &&
    acceptance.authority?.reuse_published_image_authorized === false &&
    acceptance.authority?.gpu_use_authorized === false &&
    acceptance.authority?.maximum_cumulative_finite_spend_usd === 0 &&
    acceptance.authority?.executable_finite_cap_usd === null &&
    acceptance.authority?.authority_path === null &&
    acceptance.authority?.authority_sha256 === null &&
    acceptance.authority?.v2_08_authorized === false,
  "NO_EXECUTABLE_AUTHORITY",
);

console.log("PASS V2-07 Attempt79 gate-first candidate awaiting exact approval");
