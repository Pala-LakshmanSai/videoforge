import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const liveDir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification",
);
const candidateDir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt40-item-lineage-candidate",
);
const paths = {
  publication: resolve(liveDir, "attempt40-image-publication.json"),
  closure: resolve(liveDir, "failed-attempt-40.json"),
  cleanup: resolve(liveDir, "attempt40-cleanup-observation.json"),
  reconciliation: resolve(liveDir, "attempt40-reconciliation-observation.json"),
  proposal: resolve(candidateDir, "combined-live-proposal.json"),
  authority: resolve(candidateDir, "approved-authority.json"),
  acceptance: resolve(candidateDir, "acceptance.json"),
  max1: resolve(candidateDir, "staged-config-max1.json"),
  max2: resolve(candidateDir, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
};
const expected = {
  proposal: "sha256:56cd650b61a56fb17a9abd602839992990d3a985a952eafc30afa60e82e02ae8",
  authority: "sha256:5691eb5bb3a9009fd1a010c74b7c04bc47d15c0ce580ff47f6183c105a563736",
  acceptance: "sha256:def791c571e6266a85486982a95ad139e7baa52a2d646a178df1c7ad0939c645",
  max1: "sha256:391dd6b208b4b6c2e045058295f03e47937da7f9361b6bf27e7b225dbb51432e",
  max2: "sha256:fee8426ec819aa4e742fd9e36e0e16113786fd773f66e9e46f29104b78ed044e",
  publication: "sha256:c4e0363b3b37cb0bc0bb0678ce174085669cfe77a504f2af9fdf5c338814cdb7",
  closure: "sha256:a80a70ece72d4ff08eccfa210257e267b41a2f924f061ec8740d589edd22d32b",
  cleanup: "sha256:30daf998cf53eb2a476b44a907e2d6de6da9d73f4397a50840abae731cdd5398",
  reconciliation: "sha256:4bddde16156ba76d48449265583e417309fded6c2a6f99de35825c6813927fbb",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  manifest: "sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  config: "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6",
  layer: "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a",
  diffId: "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  modelManifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  mageVolume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  source: "a7b7a937d08dc9032b8922cca71c602195f3094c",
  control: "b811cdfd677775558aa79452a4930b50a07b7b1a",
};

const fail = (code) => {
  throw new Error(`V207_ATTEMPT40_CLOSURE_${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const bytes = (path) => readFileSync(path);
const text = (path) => bytes(path).toString("utf8");
const json = (path) => JSON.parse(text(path));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;
const has = (value, needle, code) => assert(value.includes(needle), `${code}_${needle}`);

for (const name of [
  "proposal",
  "authority",
  "acceptance",
  "max1",
  "max2",
  "publication",
  "closure",
  "cleanup",
  "reconciliation",
]) {
  assert(sha(paths[name]) === expected[name], `${name.toUpperCase()}_HASH`);
}

const proposal = json(paths.proposal);
const authority = json(paths.authority);
const publication = json(paths.publication);
const closure = json(paths.closure);
const cleanup = json(paths.cleanup);
const reconciliation = json(paths.reconciliation);
const max1 = json(paths.max1);
const max2 = json(paths.max2);

assert(proposal.attempt === 40 && proposal.checkpoint === "V2-07", "PROPOSAL_SCOPE");
assert(
  proposal.lineage?.final_image === expected.image &&
    proposal.lineage?.image_manifest_sha256 === expected.manifest &&
    proposal.lineage?.image_config_sha256 === expected.config &&
    proposal.lineage?.image_layer_sha256 === expected.layer &&
    proposal.lineage?.image_layer_diff_id === expected.diffId &&
    proposal.lineage?.model === expected.model &&
    proposal.lineage?.model_manifest_sha256 === expected.modelManifest &&
    proposal.lineage?.image_source_commit === expected.source &&
    proposal.lineage?.control_source_commit === expected.control &&
    proposal.lineage?.volume_id_sha256 === expected.mageVolume &&
    proposal.lineage?.volume_mount === "/runpod-volume" &&
    proposal.lineage?.volume_region === "EU-RO-1" &&
    proposal.lineage?.volume_size_gb === 50,
  "PROPOSAL_LINEAGE",
);
assert(
  proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 &&
    proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2,
  "PROPOSAL_CONFIGS",
);
for (const [config, workers, code] of [
  [max1, 1, "MAX1"],
  [max2, 2, "MAX2"],
]) {
  assert(
    config.workers_min === 0 &&
      config.workers_max === workers &&
      config.flashboot === true &&
      config.flex_only === true &&
      config.compute_type === "GPU" &&
      config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090" &&
      config.region === "EU-RO-1" &&
      config.network_volume_id_sha256 === expected.mageVolume &&
      config.image === expected.image,
    `${code}_IDENTITY`,
  );
}
assert(
  authority.attempt === 40 &&
    authority.proposal?.sha256 === expected.proposal &&
    authority.approval?.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval?.flashboot_true_accepted === true &&
    authority.approval?.minimum_approved_availability === "LOW",
  "AUTHORITY_IMMUTABLE",
);

assert(
  publication.attempt === 40 &&
    publication.result === "PASS_EXACT_IMMUTABLE_CANDIDATE_PUBLISHED" &&
    publication.workflow?.conclusion === "success" &&
    publication.registry?.immutable_image === expected.image &&
    publication.registry?.manifest_digest === expected.manifest &&
    publication.registry?.config_digest === expected.config &&
    publication.registry?.layer_digest === expected.layer &&
    publication.registry?.layer_diff_id === expected.diffId &&
    publication.registry?.digest_readback_exact === true &&
    publication.provider_boundary?.runpod_mutation === false &&
    publication.provider_boundary?.gpu_allocation === false &&
    publication.provider_boundary?.external_spend_usd === 0,
  "PUBLICATION",
);
assert(
  closure.attempt === 40 &&
    closure.result === "NOT_QUALIFIED_LIVE_RUNNER_FAILED_CLEAN" &&
    closure.qualification_status === "NOT_QUALIFIED" &&
    closure.proposal?.sha256 === expected.proposal &&
    closure.authority?.sha256 === expected.authority &&
    closure.authority?.state === "CONSUMED_CLOSED_DO_NOT_REUSE",
  "CLOSURE_SCOPE",
);
assert(
  closure.lineage?.image === expected.image &&
    closure.lineage?.image_source_commit === expected.source &&
    closure.lineage?.control_source_commit === expected.control &&
    closure.lineage?.model === expected.model &&
    closure.lineage?.model_manifest_sha256 === expected.modelManifest &&
    closure.lineage?.mage_volume_id_sha256 === expected.mageVolume &&
    closure.lineage?.mage_volume_mount === "/runpod-volume" &&
    JSON.stringify(closure.lineage?.gpu_allowlist) ===
      JSON.stringify(["NVIDIA GeForce RTX 4090"]),
  "CLOSURE_LINEAGE",
);
assert(
  closure.execution?.live_runner_started === true &&
    closure.execution?.live_result_checkpoint_reached === false &&
    closure.execution?.provider_job_count === 0 &&
    closure.execution?.gpu_jobs_submitted === 0 &&
    closure.execution?.failure_stage === "before_live_result_checkpoint" &&
    closure.execution?.failure_code === "V207_LIVE_RUNNER_FAILED" &&
    closure.execution?.accepted_batches === 0 &&
    closure.execution?.durable_output_readbacks === 0 &&
    closure.execution?.v3_receipts === 0 &&
    closure.execution?.duplicate_compute === false &&
    closure.execution?.qualification_claim_allowed === false &&
    closure.execution?.peak_vram_bytes === null &&
    closure.execution?.timings?.timing_contract_fulfilled === false,
  "EXECUTION_STOP",
);
assert(
  closure.raw_evidence?.live_result_checkpoint_present === false &&
    closure.raw_evidence?.raw_provider_ids_urls_bodies_or_secrets_retained === false &&
    closure.billing?.incremental_spend_usd === 0 &&
    closure.billing?.within_approved_cap === true &&
    closure.billing?.settlement === "THREE_STABLE_READS",
  "EVIDENCE_AND_BILLING",
);
assert(
  cleanup.result === "RUNPOD_CLEAN_CLOUDFLARE_ROUTE_RESTORED" &&
    cleanup.runpod_cleanup?.deletion_not_needed === true &&
    cleanup.runpod_cleanup?.final_disposable_resources_absent === true &&
    cleanup.runpod_cleanup?.gpu_jobs_submitted === 0 &&
    cleanup.cloudflare_cleanup?.ephemeral_signer_secret_deleted === true &&
    cleanup.cloudflare_cleanup?.worker_version_restored === true &&
    cleanup.cloudflare_cleanup?.exact_captured_fingerprint_restored === true &&
    cleanup.cloudflare_cleanup?.restored_route_status === 404 &&
    cleanup.cloudflare_cleanup?.restored_route_code === "V207_ROUTE_DISABLED" &&
    cleanup.cloudflare_cleanup?.cleanup_uncertain === false,
  "CLEANUP",
);
assert(
  reconciliation.stable_read_count === 3 &&
    reconciliation.inventory?.pods === 0 &&
    reconciliation.inventory?.endpoints === 0 &&
    reconciliation.inventory?.private_templates === 0 &&
    reconciliation.inventory?.active_serverless_workers === 0 &&
    reconciliation.inventory?.running_pods === 0 &&
    reconciliation.inventory?.intended_volume_count === 2 &&
    reconciliation.inventory?.final_disposable_resources_absent === true,
  "RECONCILIATION_INVENTORY",
);
const volumes = new Map(
  (reconciliation.inventory?.retained_volumes ?? []).map((volume) => [volume.purpose, volume]),
);
assert(
  volumes.get("Mage")?.id_sha256 === expected.mageVolume &&
    volumes.get("Mage")?.size_gb === 50 &&
    volumes.get("Mage")?.region === "EU-RO-1" &&
    volumes.get("SoulX")?.id_sha256 === expected.soulxVolume &&
    volumes.get("SoulX")?.size_gb === 50 &&
    volumes.get("SoulX")?.region === "EU-RO-1",
  "RETAINED_VOLUMES",
);
assert(
  reconciliation.billing?.baseline_endpoint_spend_usd === 1.5246469744015485 &&
    reconciliation.billing?.final_endpoint_spend_usd === 1.5246469744015485 &&
    reconciliation.billing?.settled_incremental_spend_usd === 0 &&
    reconciliation.billing?.maximum_cumulative_finite_spend_usd === 4 &&
    reconciliation.billing?.within_approved_cap === true &&
    reconciliation.billing?.settlement === "THREE_STABLE_READS" &&
    reconciliation.mutation_boundary?.new_gpu_jobs === 0 &&
    reconciliation.mutation_boundary?.model_volume_writes === 0 &&
    reconciliation.mutation_boundary?.volume_mutation_called === false,
  "RECONCILIATION_BOUNDARY",
);

const state = text(paths.state);
const gates = text(paths.gates);
const start = text(paths.start);
const task = text(paths.task);
for (const [value, code] of [
  [state, "STATE"],
  [gates, "GATES"],
  [start, "START"],
  [task, "TASK"],
]) {
  has(value, "failed-attempt-40.json", code);
  has(value, expected.closure, code);
  has(value, "V2-08", code);
}
assert(
  state.includes("phase: serverless_v2_v2_07_attempt40_closed_not_qualified") ||
    state.includes("phase: serverless_v2_v2_07_attempt41_candidate_pending_exact_approval"),
  "STATE_PHASE",
);
has(state, "provider_calls_authorized: false", "STATE");
has(state, "remote_or_cloud_mutations_authorized: false", "STATE");
has(state, "gpu_use_authorized: false", "STATE");
has(state, "maximum_external_spend_usd: 0", "STATE");
has(state, "current_authority: null", "STATE");
has(gates, "NOT_QUALIFIED_LIVE_RUNNER_FAILED_CLEAN", "GATES");
has(gates, "pending_authority: null", "GATES");
assert(
  !state.includes("attempt40_approved_pending_execution") &&
    !gates.includes("attempt40_approved_pending_execution") &&
    !task.includes("Attempt40 approved bounded execution"),
  "NO_STALE_ACTIVE_ATTEMPT40",
);

console.log(
  "V2-07 Attempt40 closure validation PASS (pre-checkpoint live-runner failure; exact Cloudflare rollback; zero RunPod jobs/resources; three stable reads; zero incremental spend)",
);
