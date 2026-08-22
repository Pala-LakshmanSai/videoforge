import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const liveRoot = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification");
const candidateRoot = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt33-max-two-terminal-reader-drain-candidate");
const expected = Object.freeze({
  proposal: "sha256:0a417ca023895a02b8ce0e0f2e86b3f3e81b38624819a4abc473695602637925",
  authority: "sha256:002ee1529b7b2173a51bd7ccedec5bc25bd9945ea8d4f03be02f202c7462f328",
  acceptance: "sha256:145408f7e2a5d33512a5458af98012097d65e363446e48a618d126f8008f8fb5",
  max1: "sha256:5c3651673d93829535a450a88b99bcea697ed817e9f4ceba0536523e606f73a7",
  max2: "sha256:051863d9b131aab22502de85b57553adc924c5bb8f4a3ceee0e6b9d5991e78d2",
  closure: "sha256:44ce85620744650b48ad4cf7397b1cfa6e2173302c9b35311ff01e7d76aa42d8",
  cleanup: "sha256:f2bff0bd293172ea851db26b2c14f8edc3d50074dfc89beccbb7d26e4e93c059",
  live: "sha256:884128a05d9c8d262e9ccce352652d7c51f5ef930b382547affdb686956c0558",
  orchestrator: "sha256:7aef86b952fbc6d308a3f413314a9d440bb6a6a2505cd5258140e4102c6e892f",
  reconciliation: "sha256:d808eb38b5130cc5b5fd193c705b90494d73eec6ccd9e639758eb78bf1a6e676",
  mageVolume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  baseline: 1.1340842194622383,
  cap: 4,
});
const paths = Object.freeze({
  closure: resolve(liveRoot, "failed-attempt-33.json"),
  cleanup: resolve(liveRoot, "attempt33-cleanup-observation.json"),
  proposal: resolve(candidateRoot, "combined-live-proposal.json"),
  authority: resolve(candidateRoot, "approved-authority.json"),
  acceptance: resolve(candidateRoot, "acceptance.json"),
  max1: resolve(candidateRoot, "staged-config-max1.json"),
  max2: resolve(candidateRoot, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
});
const fail = (code) => { throw new Error(`V207_ATTEMPT33_CLOSURE_INVALID:${code}`); };
const assert = (condition, code) => { if (!condition) fail(code); };
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const parse = (bytes, code) => { try { return JSON.parse(bytes.toString("utf8")); } catch { fail(`${code}_JSON`); } };
const entries = await Promise.all(Object.entries(paths).map(async ([name, path]) => [name, await readFile(path)]));
const bytes = Object.fromEntries(entries);
for (const [name, hash] of Object.entries({
  closure: expected.closure,
  cleanup: expected.cleanup,
  proposal: expected.proposal,
  authority: expected.authority,
  acceptance: expected.acceptance,
  max1: expected.max1,
  max2: expected.max2,
})) assert(sha256(bytes[name]) === hash, `${name.toUpperCase()}_HASH`);

const closure = parse(bytes.closure, "CLOSURE");
const cleanup = parse(bytes.cleanup, "CLEANUP");
const proposal = parse(bytes.proposal, "PROPOSAL");
const authority = parse(bytes.authority, "AUTHORITY");
assert(closure.attempt === 33 && closure.result === "NOT_QUALIFIED" && closure.v2_08_authorized === false, "SCOPE");
assert(closure.proposal_sha256 === expected.proposal && closure.authority_sha256 === expected.authority && closure.authority_state === "CONSUMED_SINGLE_BOUNDED_EXECUTION_DO_NOT_REUSE", "AUTHORITY");
assert(closure.raw_redacted_evidence?.live_result_sha256 === expected.live && closure.raw_redacted_evidence?.orchestrator_sha256 === expected.orchestrator && closure.raw_redacted_evidence?.reconciliation_sha256 === expected.reconciliation && closure.raw_redacted_evidence?.secrets_or_raw_provider_ids_retained === false, "RAW_EVIDENCE");
assert(closure.lineage?.control_source_commit === "bbc3e40b8519ebee8d6ccdaaf29e1ede6215ac37" && closure.lineage?.max1_definition_sha256 === expected.max1 && closure.lineage?.max2_definition_sha256 === expected.max2 && closure.lineage?.mage_volume_id_sha256 === expected.mageVolume && closure.lineage?.region === "EU-RO-1" && closure.lineage?.mount === "/runpod-volume" && closure.lineage?.gpu === "NVIDIA GeForce RTX 4090" && closure.lineage?.flashboot === true, "LINEAGE");
assert(Array.isArray(closure.accepted_batches) && closure.accepted_batches.length === 3 && closure.accepted_batches.map((batch) => batch.kind).join(",") === "owned_probe,cold,warm", "BATCHES");
for (const batch of closure.accepted_batches) assert(batch.item_count === 32 && batch.durable_readback_count === 32 && batch.replay_confirmed_v3_receipt_count === 32 && batch.status === "COMPLETED" && batch.output_status === "SUCCEEDED" && Number.isFinite(batch.peak_vram_used_bytes) && Number.isFinite(batch.timings?.total_ms), `BATCH_${batch.kind}`);
assert(closure.batch_totals?.complete_batches === 3 && closure.batch_totals?.item_count === 96 && closure.batch_totals?.durable_readback_count === 96 && closure.batch_totals?.replay_confirmed_v3_receipt_count === 96, "TOTALS");
assert(closure.duplicate_delivery?.same_job === true && closure.duplicate_delivery?.second_provider_dispatch === false && closure.duplicate_delivery?.duplicate_compute === false, "DUPLICATE");
const readers = closure.concurrent_reader_proof;
assert(readers?.workers_max === 2 && readers?.two_jobs_dispatched === true && readers?.two_simultaneous_read_only_workers === true && readers?.both_provider_terminal_completed === true && readers?.accepted_reader_batch_count === 0 && readers?.drain_proof === "CONFIRMED" && readers?.stable_terminal_snapshot_count === 2 && readers?.queue_proof_read_count === 4, "READERS");
const failure = closure.failure;
assert(failure?.error === "MAGE_OUTPUT_NOT_SUCCEEDED" && failure?.category === "output_contract" && failure?.stage === "output_finalization" && failure?.code === "V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID" && failure?.output_status === "SUCCEEDED" && failure?.finalize_response_diagnostic?.attempt_number === 3 && failure?.finalize_response_diagnostic?.http_status === 503 && failure?.finalize_response_diagnostic?.content_type_value === "text/html" && failure?.finalize_response_diagnostic?.failure_category === "json_parse" && failure?.stop_condition_obeyed === true && failure?.no_retry_or_duplicate_compute === true, "FAILURE");
assert(closure.unreached_live_proofs?.cancellation === true && closure.unreached_live_proofs?.timeout === true && closure.sealed_volume?.manifest_unchanged_for_accepted_batches === true && closure.sealed_volume?.reader_receipt_identity_verified_before_finalization_failure === true && closure.sealed_volume?.model_volume_writes_observed === false && closure.sealed_volume?.runtime_download_or_quantization_observed === false && closure.sealed_volume?.cache_escape_observed === false, "UNREACHED_AND_SEALED");
assert(closure.cleanup?.disposable_endpoint_deleted === true && closure.cleanup?.disposable_template_deleted === true && closure.cleanup?.final_disposable_resources_absent === true && closure.cleanup?.active_workers === 0 && closure.cleanup?.running_pods === 0 && closure.cleanup?.signer_secret_deleted === true && closure.cleanup?.worker_version_rolled_back === true && closure.cleanup?.route_restored === true && closure.cleanup?.generated_output_rollback === "CONFIRMED", "CLEANUP");
const reconciliation = closure.final_reconciliation;
assert(reconciliation?.stable_read_count === 3 && reconciliation?.pods === 0 && reconciliation?.endpoints === 0 && reconciliation?.private_templates === 0 && reconciliation?.active_serverless_workers === 0 && reconciliation?.running_pods === 0 && reconciliation?.retained_volume_count === 2 && reconciliation?.retained_volumes?.some((volume) => volume.id_sha256 === expected.mageVolume && volume.size_gb === 50 && volume.region === "EU-RO-1") && reconciliation?.retained_volumes?.some((volume) => volume.id_sha256 === expected.soulxVolume && volume.size_gb === 50 && volume.region === "EU-RO-1"), "RECONCILIATION");
assert(closure.billing?.baseline_endpoint_spend_usd === expected.baseline && closure.billing?.final_endpoint_spend_usd === expected.baseline && closure.billing?.incremental_spend_usd === 0 && closure.billing?.maximum_cumulative_finite_spend_usd === expected.cap && closure.billing?.within_approved_cap === true && closure.billing?.settlement === "THREE_STABLE_READS", "BILLING");
assert(cleanup.attempt === 33 && cleanup.proposal_sha256 === expected.proposal && cleanup.authority_sha256 === expected.authority && cleanup.cleanup?.terminal_reader_drain_confirmed === true && cleanup.cleanup?.endpoint_deleted === true && cleanup.cleanup?.template_deleted === true && cleanup.cleanup?.final_disposable_resources_absent === true && cleanup.cloudflare_cleanup?.signer_secret_deleted === true && cleanup.cloudflare_cleanup?.worker_version_rolled_back === true && cleanup.cloudflare_cleanup?.pre_mutation_route_restored === true && cleanup.retention?.sealed_mage_volume_retained === true && cleanup.retention?.soulx_volume_retained === true && cleanup.retention?.volume_mutation_called === false && cleanup.secrets_or_raw_provider_ids_retained === false, "CLEANUP_RECORD");
assert(authority.attempt === 33 && authority.proposal?.sha256 === expected.proposal && authority.approval?.maximum_cumulative_finite_spend_usd === expected.cap && authority.approval?.observed_availability_at_proposal === "MEDIUM" && authority.approval?.flashboot_true_accepted === true, "AUTHORITY_RECORD");
assert(proposal.attempt === 33 && proposal.lineage?.control_source_commit === "bbc3e40b8519ebee8d6ccdaaf29e1ede6215ac37", "PROPOSAL_RECORD");
const context = [bytes.state, bytes.gates, bytes.task, bytes.start].map((value) => value.toString("utf8")).join("\n");
for (const value of [expected.proposal, expected.authority, expected.closure, expected.cleanup, "failed-attempt-33.json", "attempt33-cleanup-observation.json", "V207_OUTPUT_PORT_FINALIZE_RESPONSE_INVALID", "NOT_QUALIFIED", "V2-08"]) assert(context.includes(value), `CONTEXT_${value}`);
process.stdout.write("V2-07 Attempt33 closure validation PASS (96 durable outputs; reader drain proven; failed closed at transient FINALIZE 503)\n");
