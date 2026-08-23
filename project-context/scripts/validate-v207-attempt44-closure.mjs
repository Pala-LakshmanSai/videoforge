import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const live = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification",
);
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt44-version-metadata-probe-candidate",
);
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  authority: resolve(candidate, "approved-authority.json"),
  closure: resolve(live, "failed-attempt-44.json"),
  cleanup: resolve(live, "attempt44-cleanup-observation.json"),
  reconciliation: resolve(live, "attempt44-reconciliation-observation.json"),
};
const expected = {
  proposal: "a5c57dab66673cce1878c38aceff50b9f5341a4c3b069b250aeeac099dfeaa0e",
  acceptance: "f8abbd1acaf111d8c0986d0de2569ee5598bfb9b62c5f27c87da082d00fb94b1",
  authority: "a376fb6782c1512e50c8586b060bf57d030685dba3df4b5a69650e195595ab5f",
  closure: "695f438b4e2908a181d668a608588659f05075e2d6aa19d6bcfcca1a87d75be4",
  cleanup: "da05bd6a40812a3c59dbcdb5ec629646ae41d28cc763b18303dcb04aa57cb8a6",
  reconciliation: "32070d0044349e52aa8e0f27baf1eb9394a2afa8189f45afa8b4279529f11357",
  image: "sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  max1: "sha256:fcd591f6ad384ad5ab20ae6ab24bbec6d1e3940f07ffbc3cb33bc3be6664973c",
  max2: "sha256:8c1d60cc939c3e01f95533733259ce8de5a2a8345429327af2fd869b2dd32a2c",
  config: "sha256:da8c9232c9f6fe0f745a16f56f0855d726092df205e08eda6725fc0a146db774",
};
const hash = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const assert = (condition, code) => {
  if (!condition) throw new Error(`V207_ATTEMPT44_CLOSURE_${code}`);
};

for (const [name, path] of Object.entries(paths)) {
  assert(hash(path) === expected[name], `${name.toUpperCase()}_HASH`);
}

const proposal = json(paths.proposal);
const authority = json(paths.authority);
const closure = json(paths.closure);
const cleanup = json(paths.cleanup);
const reconciliation = json(paths.reconciliation);

assert(authority.proposal.sha256 === `sha256:${expected.proposal}`, "AUTHORITY_PROPOSAL");
assert(authority.approval.maximum_cumulative_finite_spend_usd === 4, "AUTHORITY_CAP");
assert(authority.approval.flashboot_true_accepted === true, "AUTHORITY_FLASHBOOT");
assert(authority.approval.minimum_approved_availability === "LOW-or-better", "AUTHORITY_AVAILABILITY");
assert(authority.approved_operations.v2_08_authorized === false, "AUTHORITY_V208");
assert(proposal.lineage.image.includes(expected.image), "PROPOSAL_IMAGE");
assert(proposal.lineage.model === expected.model, "PROPOSAL_MODEL");
assert(proposal.lineage.model_manifest_sha256 === expected.manifest, "PROPOSAL_MANIFEST");
assert(proposal.lineage.volume_id_sha256 === expected.volume, "PROPOSAL_VOLUME");
assert(proposal.staged_endpoint_configs[0]?.definition_sha256 === expected.max1, "PROPOSAL_MAX1");
assert(proposal.staged_endpoint_configs[1]?.definition_sha256 === expected.max2, "PROPOSAL_MAX2");

assert(closure.attempt === 44 && closure.qualification_status === "NOT_QUALIFIED", "RESULT");
assert(closure.authority_state === "CONSUMED_CLOSED_DO_NOT_REUSE", "CONSUMED");
assert(closure.execution.provider_job_count === 1, "JOB_COUNT");
assert(closure.execution.provider_job_status === "COMPLETED", "JOB_STATUS");
assert(closure.execution.failure_stage === "output_finalization_replay", "FAILURE_STAGE");
assert(closure.execution.failure_code === "V207_OUTPUT_PORT_400", "FAILURE_CODE");
assert(closure.execution.generated_output_rollback === "CONFIRMED", "OUTPUT_ROLLBACK");
assert(closure.execution.retry_or_redispatch_performed === false, "NO_RETRY");
assert(closure.execution.duplicate_compute === false, "NO_DUPLICATE_COMPUTE");
assert(closure.execution.accepted_batches === 0, "NO_ACCEPTED_BATCH");
assert(closure.provider_free_diagnosis.actual_failure_stage === "output_resume_readback", "DIAGNOSIS_STAGE");
assert(closure.provider_free_diagnosis.requested_resume_get_lifetime_seconds === 7200, "DIAGNOSIS_REQUESTED_TTL");
assert(closure.provider_free_diagnosis.hosted_get_max_lifetime_seconds === 900, "DIAGNOSIS_MAX_TTL");
assert(closure.provider_free_diagnosis.repair_commit === "1a8a12de10869d163ddf7bb4dfa3f329407ba566", "DIAGNOSIS_REPAIR_COMMIT");
assert(closure.lineage.image.includes(expected.image), "CLOSURE_IMAGE");
assert(closure.lineage.model === expected.model, "CLOSURE_MODEL");
assert(closure.lineage.model_manifest_sha256 === expected.manifest, "CLOSURE_MANIFEST");
assert(closure.lineage.mage_volume_id_sha256 === expected.volume, "CLOSURE_VOLUME");
assert(closure.lineage.volume_size_gb === 50, "VOLUME_SIZE");
assert(closure.lineage.volume_region === "EU-RO-1", "VOLUME_REGION");
assert(closure.lineage.volume_mount === "/runpod-volume", "VOLUME_MOUNT");
assert(closure.lineage.gpu === "NVIDIA GeForce RTX 4090", "GPU");
assert(closure.lineage.flashboot === true, "FLASHBOOT");
assert(closure.rollback.protected_config_baseline_sha256 === expected.config, "CONFIG_HASH");
assert(closure.rollback.protected_config_mode === "0600", "CONFIG_MODE");
assert(closure.rollback.protected_config_marker_state === "DISABLED", "MARKER");
assert(closure.cleanup.sha256 === `sha256:${expected.cleanup}`, "CLEANUP_POINTER");
assert(closure.reconciliation.sha256 === `sha256:${expected.reconciliation}`, "RECON_POINTER");
assert(closure.qualification.v2_08_authorized === false, "CLOSURE_V208");

assert(cleanup.runpod_cleanup.endpoint_deleted === true, "ENDPOINT_DELETE");
assert(cleanup.runpod_cleanup.template_deleted === true, "TEMPLATE_DELETE");
assert(cleanup.runpod_cleanup.final_disposable_resources_absent === true, "DISPOSABLE_ABSENT");
assert(cleanup.cloudflare_cleanup.ephemeral_signer_secret_deleted === true, "SIGNER_DELETE");
assert(cleanup.cloudflare_cleanup.worker_version_rolled_back === true, "WORKER_ROLLBACK");
assert(cleanup.cloudflare_cleanup.route_restored_status === 404, "ROUTE_STATUS");
assert(cleanup.cloudflare_cleanup.route_restored_code === "V207_ROUTE_DISABLED", "ROUTE_CODE");
assert(cleanup.retention.retained_volume_write_delete_rebuild_or_cross_mount === false, "VOLUME_UNTOUCHED");

assert(reconciliation.stable_read_count === 3, "STABLE_READS");
for (const key of ["pods", "endpoints", "private_templates", "active_serverless_workers", "running_pods"]) {
  assert(reconciliation.inventory[key] === 0, `FINAL_${key.toUpperCase()}`);
}
assert(reconciliation.inventory.intended_volume_count === 2, "TWO_VOLUMES");
assert(reconciliation.inventory.retained_volumes.every((volume) => volume.size_gb === 50 && volume.region === "EU-RO-1"), "VOLUME_IDENTITIES");
assert(reconciliation.billing.incremental_spend_usd === 0, "SPEND_ZERO");
assert(reconciliation.billing.baseline_endpoint_spend_usd === reconciliation.billing.final_endpoint_spend_usd, "SPEND_SETTLED");
assert(reconciliation.billing.within_approved_cap === true, "CAP");

const surfaces = [
  "project-context/CURRENT_STATE.yaml",
  "project-context/GATES.yaml",
  "project-context/00_START_HERE.md",
  "project-context/tasks/VF-10-07.md",
].map((path) => readFileSync(resolve(root, path), "utf8"));
for (const surface of surfaces) {
  assert(surface.includes("failed-attempt-44.json"), "SURFACE_CLOSURE");
  assert(surface.includes(`sha256:${expected.closure}`), "SURFACE_CLOSURE_HASH");
  assert(surface.includes("V2-08"), "SURFACE_V208");
}
const state = surfaces[0];
assert(state.includes("provider_calls_authorized: false"), "STATE_PROVIDER_OFF");
assert(state.includes("maximum_external_spend_usd: 0"), "STATE_CAP_ZERO");
assert(state.includes("authority_state: CONSUMED_CLOSED_DO_NOT_REUSE"), "STATE_CONSUMED");

console.log("V2-07 Attempt44 failed-closed validation PASS (resume GET 7200>900; cleanup/reconciliation clean; authority consumed; V2-08 forbidden)");
