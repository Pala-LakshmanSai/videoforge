#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const evidence = path.join(root, "project-context/evidence/acceptance/VF-10-07");
const candidate = path.join(evidence, "2026-08-23-attempt47-terminal-pod-identity-repair-candidate");
const live = path.join(evidence, "2026-08-21-live-qualification");
const expected = {
  proposal: "sha256:e0e0e62014a770678485d780dbb2c852ae7e1786162fc58594f6d08afaa0ee53",
  acceptance: "sha256:be3f2c5bca77f90a2470f4e2f165f47b2811501a6cc9febee911edeb24b758e6",
  authority: "sha256:aae6dfd8a282333a8a5caa3149e520e58a858c93b0730e4529d599f7d078a254",
  closure: "sha256:6f3204b9eee5a10eaa64f4f80fa3bd7fa6cf16e3fc2dc0eda2e6d2a63de08472",
  cleanup: "sha256:90ef9ccc517b545f64adba62e07615d4041121763a3015da51981d41b950abd1",
  reconciliation: "sha256:d9f6dd526a347653eae2cb7a67e1bacc4dbeab77200d4a533c13e42edda84a65",
  orchestrator: "sha256:4a98fc25527196f4b36bfbd58fcee55c966bb773de80173f3e95dbdaebf024e7",
  max1: "sha256:624dafe2f1a5fdfbf0435b87e3eecaca997281386d4a6c41339bfb5e78eb457a",
  max2: "sha256:9774e90daf86cfa8f7f8f17c4bd9319475ac5881d0c2667ca61f0a7412a9bfcb",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:79fe7e40b69c011c15cc31b2d84b356cd2c755ea338976172cd78cc581304d59",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  protectedConfig: "sha256:da8c9232c9f6fe0f745a16f56f0855d726092df205e08eda6725fc0a146db774",
};
const fail = (code) => { throw new Error(`V207_ATTEMPT47_CLOSURE_${code}`); };
const eq = (actual, wanted, code) => { if (actual !== wanted) fail(code); };
const yes = (value, code) => { if (!value) fail(code); };
const bytes = (file) => fs.readFileSync(file);
const text = (file) => bytes(file).toString("utf8");
const json = (file) => JSON.parse(text(file));
const sha = (file) => `sha256:${crypto.createHash("sha256").update(bytes(file)).digest("hex")}`;

const proposalPath = path.join(candidate, "combined-live-proposal.json");
const acceptancePath = path.join(candidate, "acceptance.json");
const authorityPath = path.join(candidate, "approved-authority.json");
const closurePath = path.join(live, "failed-attempt-47.json");
const cleanupPath = path.join(live, "attempt47-cleanup-observation.json");
const reconciliationPath = path.join(live, "attempt47-reconciliation-observation.json");
const orchestratorPath = path.join(live, "attempt47-live-orchestrator.json");
eq(sha(proposalPath), expected.proposal, "PROPOSAL_HASH");
eq(sha(acceptancePath), expected.acceptance, "ACCEPTANCE_HASH");
eq(sha(authorityPath), expected.authority, "AUTHORITY_HASH");
eq(sha(closurePath), expected.closure, "CLOSURE_HASH");
eq(sha(cleanupPath), expected.cleanup, "CLEANUP_HASH");
eq(sha(reconciliationPath), expected.reconciliation, "RECONCILIATION_HASH");
eq(sha(orchestratorPath), expected.orchestrator, "DURABLE_ORCHESTRATOR_HASH");

const proposal = json(proposalPath);
const authority = json(authorityPath);
const closure = json(closurePath);
const cleanup = json(cleanupPath);
const reconciliation = json(reconciliationPath);
eq(proposal.attempt, 47, "PROPOSAL_ATTEMPT");
eq(authority.proposal.sha256, expected.proposal, "AUTHORITY_PROPOSAL");
eq(authority.approval.maximum_cumulative_finite_spend_usd, 4, "AUTHORITY_CAP");
eq(authority.approval.flashboot_true_accepted, true, "AUTHORITY_FLASHBOOT");
eq(authority.approval.minimum_approved_availability, "LOW-or-better", "AUTHORITY_AVAILABILITY");
eq(closure.result, "NOT_QUALIFIED_ATTEMPT47_ROLLBACK_ANCHOR_NOT_RETAINED_CLEAN", "CLOSURE_RESULT");
eq(closure.qualification_status, "NOT_QUALIFIED", "CLOSURE_STATUS");
eq(closure.authority_sha256, expected.authority, "CLOSURE_AUTHORITY");
eq(closure.proposal_sha256, expected.proposal, "CLOSURE_PROPOSAL");
eq(closure.acceptance_sha256, expected.acceptance, "CLOSURE_ACCEPTANCE");
eq(closure.staged_max1_sha256, expected.max1, "CLOSURE_MAX1");
eq(closure.staged_max2_sha256, expected.max2, "CLOSURE_MAX2");
eq(closure.authority_state, "CONSUMED_CLOSED_DO_NOT_REUSE", "CLOSURE_CONSUMED");
eq(closure.failure.code, "V207_WORKER_ROLLBACK_ANCHOR_NOT_RETAINED", "FAILURE_CODE");
eq(closure.failure.rollback_anchor_diagnostic.detail_retained, false, "DIAGNOSTIC_REDACTION_LIMIT");
eq(closure.failure.stopped_before_mutation, true, "STOP_BEFORE_MUTATION");
eq(closure.failure.stopped_before_runpod, true, "STOP_BEFORE_RUNPOD");
eq(closure.failure.stopped_before_gpu, true, "STOP_BEFORE_GPU");
eq(closure.failure.stopped_before_spend, true, "STOP_BEFORE_SPEND");
eq(closure.execution.orchestrator_sha256, expected.orchestrator, "ORCHESTRATOR_HASH");
eq(closure.execution.live_execution_runpod_calls_reached, false, "RUNPOD_CALLS");
eq(closure.execution.read_only_runpod_reconciliation_completed, true, "READ_ONLY_RECONCILIATION");
eq(closure.execution.runpod_jobs_submitted, 0, "RUNPOD_JOBS");
eq(closure.execution.gpu_use, false, "GPU_USE");
eq(closure.lineage.model, expected.model, "MODEL");
eq(closure.lineage.model_manifest_sha256, expected.manifest, "MANIFEST");
eq(closure.lineage.image, expected.image, "IMAGE");
eq(closure.lineage.image_source_commit, "a7b7a937d08dc9032b8922cca71c602195f3094c", "IMAGE_SOURCE");
eq(closure.lineage.image_config_sha256, "sha256:b6c43cb1f2782540f52ac1f2f4584fea763237f1c75c8c7c1341ea70bcc915e6", "IMAGE_CONFIG");
eq(closure.lineage.image_layer_sha256, "sha256:f31fc51513e3573eb859897b7bcacd4b28bb525567b7523af1c98e4f370c8c3a", "IMAGE_LAYER");
eq(closure.lineage.image_layer_diff_id, "sha256:9f759e3f49c84816de71246f51f9aca275fc080c7c9c082aaa39ce81e8b049e1", "IMAGE_DIFF_ID");
eq(closure.lineage.volume_id_sha256, expected.volume, "VOLUME");
eq(closure.lineage.volume_mount, "/runpod-volume", "VOLUME_MOUNT");
eq(closure.lineage.volume_size_gb, 50, "VOLUME_SIZE");
eq(closure.lineage.volume_region, "EU-RO-1", "VOLUME_REGION");
eq(closure.lineage.gpu, "NVIDIA GeForce RTX 4090", "GPU");
eq(closure.lineage.flashboot, true, "FLASHBOOT");
eq(closure.lineage.minimum_availability, "LOW-or-better", "AVAILABILITY");
eq(closure.protected_config.sha256, expected.protectedConfig, "PROTECTED_CONFIG_HASH");
eq(closure.protected_config.mode, "0600", "PROTECTED_CONFIG_MODE");
eq(closure.protected_config.unchanged, true, "PROTECTED_CONFIG_UNCHANGED");
eq(closure.cleanup.sha256, expected.cleanup, "CLOSURE_CLEANUP");
eq(closure.reconciliation.sha256, expected.reconciliation, "CLOSURE_RECONCILIATION");
eq(cleanup.result, "CLEAN_NO_MUTATION_CONFIRMED", "CLEANUP_RESULT");
eq(cleanup.cloudflare.build_started, false, "BUILD_STARTED");
eq(cleanup.cloudflare.deploy_started, false, "DEPLOY_STARTED");
eq(cleanup.cloudflare.signer_secret_created, false, "SIGNER_CREATED");
eq(cleanup.cloudflare.worker_mutated, false, "WORKER_MUTATED");
eq(cleanup.cloudflare.route_activated, false, "ROUTE_ACTIVATED");
eq(cleanup.cloudflare.rollback_required, false, "ROLLBACK_REQUIRED");
eq(cleanup.cloudflare.rollback_skipped_no_mutation, true, "ROLLBACK_SKIPPED");
eq(cleanup.cloudflare.disabled_route_probe_skipped_no_mutation, true, "ROUTE_PROBE_SKIPPED");
eq(cleanup.cloudflare.rollback_anchor_refresh_authorized, false, "ANCHOR_REFRESH_NOT_AUTHORIZED");
eq(cleanup.cloudflare.rollback_anchor_refresh_attempted, false, "ANCHOR_REFRESH_NOT_ATTEMPTED");
eq(cleanup.cloudflare.rollback_anchor_diagnostic_detail_retained, false, "ANCHOR_DIAGNOSTIC_LIMIT");
eq(cleanup.runpod.live_execution_calls_reached, false, "CLEANUP_RUNPOD_CALLS");
eq(cleanup.runpod.read_only_reconciliation_completed, true, "CLEANUP_READ_ONLY_RECONCILIATION");
eq(cleanup.runpod.jobs_submitted, 0, "CLEANUP_RUNPOD_JOBS");
eq(cleanup.runpod.final_disposable_resources_absent, true, "DISPOSABLE_ABSENT");
eq(cleanup.cleanup_uncertain, false, "CLEANUP_CERTAIN");
eq(reconciliation.result, "PASS_THREE_STABLE_READS_ZERO_DISPOSABLE_RESOURCES", "RECON_RESULT");
eq(reconciliation.stable_read_count, 3, "STABLE_READS");
eq(reconciliation.read_only, true, "RECON_READ_ONLY");
eq(reconciliation.final_disposable_resources_absent, true, "RECON_DISPOSABLE_ABSENT");
eq(reconciliation.retained_volume_count, 2, "RECON_VOLUME_COUNT");
for (const key of ["pods", "endpoints", "private_templates", "active_serverless_workers", "running_pods"]) {
  eq(reconciliation.inventory[key], 0, `INVENTORY_${key.toUpperCase()}`);
}
eq(reconciliation.inventory.retained_volumes.length, 2, "VOLUME_COUNT");
yes(reconciliation.inventory.retained_volumes.every((volume) => volume.size_gb === 50 && volume.region === "EU-RO-1"), "VOLUME_IDENTITY");
yes(reconciliation.inventory.retained_volumes.some((volume) => volume.purpose === "mage_retained" && volume.id_sha256 === expected.volume && volume.application_mount === "/runpod-volume"), "MAGE_VOLUME_IDENTITY");
eq(reconciliation.billing.incremental_spend_usd, 0, "INCREMENTAL_SPEND");
eq(reconciliation.billing.baseline_endpoint_spend_usd, reconciliation.billing.final_endpoint_spend_usd, "BASELINE_FINAL_SPEND");
eq(reconciliation.billing.within_approved_cap, true, "WITHIN_CAP");
eq(reconciliation.retention.volume_mutation_observed, false, "VOLUME_MUTATION");
eq(reconciliation.retention.mage_volume_retained, true, "MAGE_RETAINED");
eq(reconciliation.retention.soulx_volume_retained, true, "SOULX_RETAINED");

const activation = text(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"));
yes(activation.includes("export const V207_APPROVED_FINITE_CAP_USD: number | null = null;"), "ACTIVATION_CAP_RESET");
yes(activation.includes("export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;"), "ACTIVATION_REFRESH_RESET");
yes(!activation.includes(expected.authority), "ACTIVATION_AUTHORITY_RESET");
for (const surface of ["project-context/CURRENT_STATE.yaml", "project-context/GATES.yaml", "project-context/00_START_HERE.md", "project-context/tasks/VF-10-07.md"]) {
  const value = text(path.join(root, surface));
  yes(value.includes(expected.closure), `${surface}_CLOSURE`);
  yes(value.includes("NOT_QUALIFIED"), `${surface}_STATUS`);
  yes(value.includes("V2-08"), `${surface}_V208`);
}
const state = text(path.join(root, "project-context/CURRENT_STATE.yaml"));
yes(/^phase:\s*serverless_v2_v2_07_attempt47_[^\n]*closed/m.test(state), "STATE_PHASE");
yes(state.includes("authority_state: CONSUMED_CLOSED_DO_NOT_REUSE"), "STATE_AUTHORITY_CONSUMED");
yes(state.includes("maximum_external_spend_usd: 0"), "STATE_CAP_ZERO");
yes(state.includes("gpu_use_authorized: false"), "STATE_GPU_OFF");

console.log("PASS validate-v207-attempt47-closure", JSON.stringify(expected));
