import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:2fb475cca07fa9f76a0d6f724726d6d15a5214bea47931c1463dcfd14ef1f1d0",
  authority: "sha256:932cd239e3352a14b042cf2b165a677406a62acfb157965ac42b7abba0924191",
  acceptance: "sha256:99713e1e12fa8ee1b3e47894ab19ba3a401c4408315c3d015f6869d8d636d804",
  preflight: "sha256:4318a0dd24a4f68f9adbc5f0149270c81c1cb43bd13f3c30c0e3455a8ab9049a",
  max1: "sha256:d0c1ab6b2ebe0d8c09e9a6c39853271ecaaa6c04de4abc84521b6a93a430c1bc",
  max2: "sha256:4a0a516098b79af713d79318ef83da5c347e9e087a11eeececc0ed56de44a7c5",
  orchestrator: "sha256:6dd76f832911f3b26002e18f45b1acf17cba4cfcbf7da8c575d10eb433d8a515",
  qualification: "sha256:3ed15af77a48436b9864a29a03cf7a80f1d6cd4daf0ab10d2372d74f67598d43",
  harness: "sha256:f910d46dcb5a0149515e52e8d7967733a251c5b7ea58bc68b5ead1e6a5e99205",
  canonicalActivation: "sha256:3569bc480f2084a9d04a94b8b47507cc8f4e6183a67308aa9039c2b485108323",
  version: "sha256:00a52163eee4d61bec6bea3459397328f5157d1a5e34dcd838f127cad11cbafc",
  record: "sha256:37864db71b2ebc843495b330915d98f74582014f3861e6c417da2c71810dfb41",
  repair: "3921f6bb4a02723073566cf46bc9353d0e46e97b",
  anchorRebind: "0b4b2d5b1edf31893daba54f08ecb1515aea589b",
  consumedAuthority: "sha256:18b78f0611052937ecb53535e6efdca34eab42a43227e3729b88eb7805ca5ebb",
  closure: "sha256:902ac9f71b2d90ac80d74a6a747181ae56cd199cda2de7942dbc7b319cb9d7e5",
  reconciliation: "sha256:b44f6a9ca90281e9356db3cd1d1aea422ff58d29af4a2f7716f552130f496a75",
  attempt62Closure: "sha256:3c3a4332dd1f0bbf2753b3ba9689f697bc38538fb99127bba47a803e94bf0aaf",
  attempt62Orchestrator: "sha256:c0d50234319cd4cf16e37b66e20dc19380e697752377059eaf62e375bc8f0b42",
  attempt62Summary: "sha256:a596a6447e9e7da02d5a666e645a30fff9c2e1b74f183e1dea25f9e5b3a52a57",
  attempt62Reconciliation: "sha256:ea0678ce17f3b6489fb06c6d49653838c56f20982f563060b2dc72f0e6dfdbc6",
};
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const yes = (value, code) => {
  if (!value) throw new Error(code);
};
const json = async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"));
const fileSha = async (name) => sha(await readFile(path.join(dir, name)));
const rootBytes = async (name) => readFile(path.join(root, name));
const rootSha = async (name) => sha(await rootBytes(name));

const [proposal, authority, acceptance, preflight, max1, max2, activation, orchestrator, harness, harnessTest] =
  await Promise.all([
    json("combined-live-proposal.json"),
    json("approved-authority.json"),
    json("acceptance.json"),
    json("read-only-preflight.json"),
    json("staged-config-max1.json"),
    json("staged-config-max2.json"),
    rootBytes("apps/web/src/server/providers/v207-activation-authority.ts").then(String),
    rootBytes("apps/web/src/server/providers/v207-live-orchestrator.ts").then(String),
    rootBytes("apps/web/src/server/providers/runpod-v207-qualification-harness.ts").then(String),
    rootBytes("apps/web/src/server/providers/runpod-v207-qualification-harness.test.ts").then(String),
  ]);

yes((await fileSha("combined-live-proposal.json")) === expected.proposal, "PROPOSAL_HASH");
yes((await fileSha("approved-authority.json")) === expected.authority, "AUTHORITY_HASH");
yes((await fileSha("acceptance.json")) === expected.acceptance, "ACCEPTANCE_HASH");
yes((await fileSha("read-only-preflight.json")) === expected.preflight, "PREFLIGHT_HASH");
yes((await fileSha("staged-config-max1.json")) === expected.max1, "MAX1_HASH");
yes((await fileSha("staged-config-max2.json")) === expected.max2, "MAX2_HASH");
yes(
  (await rootSha("apps/web/src/server/providers/v207-live-orchestrator.ts")) === expected.orchestrator &&
    (await rootSha("apps/web/src/server/providers/v207-live-qualification.ts")) === expected.qualification &&
    (await rootSha("apps/web/src/server/providers/runpod-v207-qualification-harness.ts")) === expected.harness,
  "SOURCE_HASH",
);
yes(
  proposal.attempt === 62 &&
    proposal.qualification_status === "NOT_QUALIFIED" &&
    proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_POSITIVE_NUMERIC_CAP" &&
    proposal.provider_calls_authorized === false &&
    proposal.provider_mutations_authorized === false &&
    proposal.gpu_use_authorized === false &&
    proposal.v2_08_authorized === false,
  "PROPOSAL_SCOPE",
);
yes(
  proposal.approval_request.requested_maximum_cumulative_finite_spend_usd === 4 &&
    proposal.approval_request.executable_cap_binding === null &&
    proposal.approval_request.anchor_refresh_authorized === null &&
    proposal.approval_request.flashboot === true &&
    proposal.approval_request.minimum_availability === "LOW-or-better" &&
    proposal.approval_request.continued_retention_of_two_existing_volumes_at_usd_per_month === 7 &&
    proposal.cost.finite_action_estimate_usd_ceiling === 3.95 &&
    proposal.cost.existing_two_volumes_usd_per_month === 7,
  "APPROVAL_AND_COST",
);
yes(
  proposal.source_lineage.identity_classification_repair_commit === expected.repair &&
    proposal.source_lineage.anchor_rebind_commit === expected.anchorRebind &&
    proposal.source_lineage.orchestrator_source_sha256 === expected.orchestrator &&
    proposal.source_lineage.qualification_harness_source_sha256 === expected.harness &&
    proposal.source_lineage.canonical_activation_source_sha256 === expected.canonicalActivation,
  "SOURCE_LINEAGE",
);
yes(
  proposal.identity_diagnostic_contract.same_signed_pod_remains_rejected === true &&
    proposal.identity_diagnostic_contract.distinct_signed_pod_required === true &&
    proposal.identity_diagnostic_contract.failure_event_contains_only_fixed_predicates === true &&
    proposal.identity_diagnostic_contract.raw_identity_hashes_in_failure_event === false &&
    proposal.identity_diagnostic_contract.acceptance_relaxed === false &&
    proposal.identity_diagnostic_contract.redispatch === false,
  "IDENTITY_CONTRACT",
);
yes(
  preflight.attempt === 62 &&
    preflight.fresh_provider_read === true &&
    preflight.provider_mutations === 0 &&
    preflight.gpu_jobs_submitted === 0 &&
    preflight.runpod.pods === 0 &&
    preflight.runpod.endpoints === 0 &&
    preflight.runpod.private_templates === 0 &&
    preflight.runpod.active_workers === 0 &&
    preflight.runpod.running_pods === 0 &&
    preflight.runpod.retained_volumes.length === 2 &&
    preflight.runpod.selected_gpu.availability === "LOW" &&
    preflight.runpod.selected_gpu.flashboot === true &&
    preflight.runpod.selected_gpu.serverless_flex_rate_usd_per_gpu_hour === 1.1 &&
    preflight.cloudflare.active_version_id_sha256 === expected.version &&
    preflight.cloudflare.active_record_sha256 === expected.record &&
    preflight.cloudflare.route_status === 404 &&
    preflight.cloudflare.route_code === "V207_ROUTE_DISABLED" &&
    preflight.cloudflare.all_route_version_hashes_match_active === true &&
    preflight.cloudflare.signer_present === false &&
    preflight.local_disk.headroom_gate_satisfied === true &&
    preflight.attempt61.consumed_authority_sha256 === expected.consumedAuthority &&
    preflight.attempt61.closure_sha256 === expected.closure &&
    preflight.attempt61.reconciliation_sha256 === expected.reconciliation,
  "PREFLIGHT_TRUTH",
);
for (const [config, workers] of [
  [max1, 1],
  [max2, 2],
]) {
  yes(
    config.attempt === 62 &&
      config.workers_min === 0 &&
      config.workers_max === workers &&
      config.flashboot === true &&
      config.gpu === "NVIDIA GeForce RTX 4090" &&
      config.region === "EU-RO-1" &&
      config.volume.mount === "/runpod-volume" &&
      config.volume.application_read_only === true &&
      config.source.control_commit === "3921f6b" &&
      config.source.anchor_rebind_commit === "0b4b2d5" &&
      config.source.canonical_activation_sha256 === expected.canonicalActivation &&
      config.expected_old_anchor.version_id_sha256 === expected.version &&
      config.expected_old_anchor.record_sha256 === expected.record,
    `CONFIG_${workers}`,
  );
}
yes(max2.restore_after_proof === "staged-config-max1.json", "MAX2_RESTORE");
yes(
  acceptance.attempt === 62 &&
    acceptance.proposal_sha256 === expected.proposal &&
    acceptance.preflight_sha256 === expected.preflight &&
    acceptance.max1_sha256 === expected.max1 &&
    acceptance.max2_sha256 === expected.max2 &&
    acceptance.authority.exact_proposal_approved === false &&
    acceptance.authority.maximum_cumulative_finite_spend_usd === null &&
    acceptance.authority.v2_08_authorized === false,
  "ACCEPTANCE",
);
yes(activation.includes(`"${expected.proposal}" as const`), "ACTIVATION_PROPOSAL_POINTER");
yes(/V207_APPROVED_AUTHORITY_SHA256: string \| null = null;/u.test(activation), "AUTHORITY_NULL");
yes(/V207_APPROVED_FINITE_CAP_USD: number \| null = null;/u.test(activation), "CAP_NULL");
yes(/V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null = null;/u.test(activation), "REFRESH_NULL");
const canonical = activation
  .replace(/^export\s+const\s+V207_PENDING_PROPOSAL_SHA256\s*=\s*"sha256:[a-f0-9]{64}"\s+as\s+const\s*;/mu, `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${"0".repeat(64)}" as const;`)
  .replace(/^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*(?:"sha256:[a-f0-9]{64}"|null)\s*;/mu, "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;")
  .replace(/^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)\s*;/mu, "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;")
  .replace(/^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*(?:true|false|null)\s*;/mu, "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;");
yes(sha(canonical) === expected.canonicalActivation, "CANONICAL_ACTIVATION_HASH");
yes(orchestrator.includes(`"${expected.version}" as const`) && orchestrator.includes(`"${expected.record}" as const`), "ANCHOR_CONSTANTS");
const rejectionBlock = harness.slice(
  harness.indexOf('this.mark("process_replacement_identity_not_distinct"'),
  harness.indexOf('throw new RunPodControlError("RUNPOD_PROCESS_REPLACEMENT_IDENTITY_NOT_DISTINCT")'),
);
yes(
  rejectionBlock.includes("seed_replacement_worker_hash_equal") &&
    rejectionBlock.includes("seed_replacement_pod_hash_equal") &&
    !rejectionBlock.includes("_sha256"),
  "REDACTED_PREDICATES",
);
yes(
  harnessTest.includes("rejects a replacement that reuses either signed worker or process identity") &&
    harnessTest.includes("accepts a distinct signed Pod without recording an identity rejection") &&
    harnessTest.includes("expect(JSON.stringify(rejection)).not.toContain(seedPodHash)"),
  "FOCUSED_TEST_SURFACE",
);
let authorityExists = true;
try {
  await access(path.join(dir, "approved-authority.json"));
} catch {
  authorityExists = false;
}
yes(authorityExists === true, "AUTHORITY_FILE_REQUIRED");
yes(
  authority.attempt === 62 &&
    authority.status === "CONSUMED_NON_REUSABLE_ATTEMPT62_PROCESS_REPLACEMENT_IDENTITY_NOT_DISTINCT" &&
    authority.proposal.sha256 === expected.proposal &&
    authority.acceptance.sha256 === expected.acceptance &&
    authority.approval.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval.flashboot_true_accepted === true &&
    authority.approval.low_or_better_eu_ro_1_availability_approved === true &&
    authority.approval.anchor_refresh_authorized === false &&
    authority.approval.consumed === true &&
    authority.execution_boundary.v2_08_authorized === false,
  "AUTHORITY_CONTRACT",
);
const liveEvidenceDir = path.join(root, "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification");
const [closure, liveOrchestrator, summary, reconciliation] = await Promise.all([
  readFile(path.join(liveEvidenceDir, "failed-attempt-62.json")),
  readFile(path.join(liveEvidenceDir, "attempt62-live-orchestrator.json")),
  readFile(path.join(liveEvidenceDir, "attempt62-live-qualification-summary.json")),
  readFile(path.join(liveEvidenceDir, "attempt62-reconciliation-observation.json")),
]);
yes(
  sha(closure) === expected.attempt62Closure &&
    sha(liveOrchestrator) === expected.attempt62Orchestrator &&
    sha(summary) === expected.attempt62Summary &&
    sha(reconciliation) === expected.attempt62Reconciliation,
  "ATTEMPT62_CLOSURE_HASHES",
);
const closureJson = JSON.parse(closure);
const summaryJson = JSON.parse(summary);
const reconciliationJson = JSON.parse(reconciliation);
yes(
  closureJson.failure_code === "RUNPOD_PROCESS_REPLACEMENT_IDENTITY_NOT_DISTINCT" &&
    closureJson.execution.redispatch === false &&
    closureJson.execution.later_batches_dispatched === false &&
    summaryJson.probe.status === "COMPLETED" &&
    summaryJson.probe.item_count === 1 &&
    summaryJson.replacement.status === "COMPLETED" &&
    summaryJson.replacement.accepted_units === 0 &&
    summaryJson.replacement.identity_rejection_predicates.seed_replacement_worker_hash_equal === true &&
    summaryJson.replacement.identity_rejection_predicates.seed_replacement_pod_hash_equal === true &&
    reconciliationJson.paid_compute_shutdown_proven === true &&
    reconciliationJson.stable_read_count === 3 &&
    reconciliationJson.runpod.pods === 0 &&
    reconciliationJson.runpod.endpoints === 0 &&
    reconciliationJson.runpod.private_templates === 0 &&
    reconciliationJson.runpod.active_serverless_workers === 0 &&
    reconciliationJson.runpod.running_pods === 0 &&
    reconciliationJson.runpod.retained_volumes.length === 2 &&
    reconciliationJson.billing.observed_incremental_spend_usd === 0 &&
    reconciliationJson.cloudflare.signer_present === false,
  "ATTEMPT62_CLOSURE_TRUTH",
);
process.stdout.write(`PASS validate-v207-attempt62-candidate ${JSON.stringify(expected)}\n`);
