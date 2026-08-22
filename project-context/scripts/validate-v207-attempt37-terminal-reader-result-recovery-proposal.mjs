import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-23-attempt37-terminal-reader-result-recovery-candidate");
const expected = {
  proposal: "sha256:6ff97af22dd025e9298a830a9bcd946f18fe376745f39ed6e5c15b791e3f390e",
  acceptance: "sha256:af760f96c17c8b880dbeeee4eab3aababee410886e55ddcc9daabb3be543ceaa",
  max1: "sha256:e6f3d746959b3a5633fd9b7d6035a0dca44cee9f886b1c045e9d55b6dc1e86f0",
  max2: "sha256:1a5ba973d3d97b76efa7ffb0a6f5cfa9427fb830e7fbfc8831659ea910f8e9d5",
  control: "6632c4508a1f4127491a598d52157dece41a0560",
  priorProposal: "sha256:1df762844058f78db8171adcad3943ecfc03157c225070fcbc6506088169c87c",
  priorAuthority: "sha256:fc173408635e6af48f824188dad878cd6259526f407e655941848f092732ef37",
  priorClosure: "sha256:d0278822d001fe2639d47920f6923c565882bdbbf6ff11c174b30e72aba6d6fa",
  priorCleanup: "sha256:ab3c5d668c7d2817bd0a9b3e40dbeab6bd3623ae92e9439292d1d32662ba57e1",
};
const fail = (code) => { throw new Error(`V207_ATTEMPT37_PROPOSAL_${code}`); };
const assert = (value, code) => { if (!value) fail(code); };
const bytes = (path) => readFileSync(resolve(dir, path));
const json = (path) => JSON.parse(String(bytes(path)));
const sha = (path) => `sha256:${createHash("sha256").update(bytes(path)).digest("hex")}`;

assert(sha("combined-live-proposal.json") === expected.proposal, "PROPOSAL_HASH");
assert(sha("acceptance.json") === expected.acceptance, "ACCEPTANCE_HASH");
assert(sha("staged-config-max1.json") === expected.max1, "MAX1_HASH");
assert(sha("staged-config-max2.json") === expected.max2, "MAX2_HASH");
const proposal = json("combined-live-proposal.json");
const acceptance = json("acceptance.json");
const configs = [json("staged-config-max1.json"), json("staged-config-max2.json")];
assert(proposal.attempt === 37 && proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" && proposal.provider_mutation === false && proposal.gpu_use === false && proposal.spend_usd === 0, "BOUNDARY");
assert(proposal.lineage.control_source_commit === expected.control && proposal.lineage.prior_proposal_sha256 === expected.priorProposal && proposal.lineage.prior_authority_sha256 === expected.priorAuthority && proposal.lineage.prior_closure_evidence_sha256 === expected.priorClosure && proposal.lineage.prior_cleanup_evidence_sha256 === expected.priorCleanup, "LINEAGE");
assert(proposal.lineage.model === "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot" && proposal.lineage.volume_mount === "/runpod-volume" && proposal.lineage.volume_write_policy === "APPLICATION_READ_ONLY", "MODEL_VOLUME");
assert(proposal.cleanup_terminal_reader_promotion_repair?.same_owned_job_id_required === true && proposal.cleanup_terminal_reader_promotion_repair?.terminal_statuses_only === true && proposal.cleanup_terminal_reader_promotion_repair?.no_provider_redispatch === true && proposal.cleanup_terminal_reader_promotion_repair?.no_retry_of_run === true, "PRIOR_CLEANUP_REPAIR");
const recovery = proposal.terminal_reader_result_recovery;
assert(recovery?.repair_commit === expected.control && recovery?.exact_dispatch_order_job_tuple_required === true && recovery?.single_bounded_recovery_phase === true && recovery?.status_reads_only === true && recovery?.run_redispatch_forbidden === true && recovery?.completed_results_return_to_existing_full_application_verifier === true && recovery?.output_bytes_durable_readbacks_and_v3_receipts_still_required === true && recovery?.nonterminal_failed_cancelled_timed_out_mismatched_or_malformed_result_fails_closed === true && recovery?.owned_nonterminal_jobs_cancelled_before_failure === true, "RECOVERY_REPAIR");
assert(proposal.staged_endpoint_configs[0].definition_sha256 === expected.max1 && proposal.staged_endpoint_configs[1].definition_sha256 === expected.max2, "CONFIG_HASHES");
for (const [index, config] of configs.entries()) {
  assert(config.control_source_commit === expected.control && config.workers_min === 0 && config.workers_max === index + 1 && config.gpu_type_ids?.length === 1 && config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" && config.compute_type === "GPU" && config.flex_only === true && config.flashboot === true, `CONFIG_${index}`);
  assert(config.network_volume_mount === "/runpod-volume" && config.volume_write_policy === "APPLICATION_READ_ONLY" && config.cleanup_terminal_reader_promotion_repair?.no_provider_redispatch === true && config.terminal_reader_result_recovery?.repair_commit === expected.control && config.terminal_reader_result_recovery?.exact_reader_job_ids_required === 2 && config.terminal_reader_result_recovery?.run_redispatch_forbidden === true, `CONFIG_SAFETY_${index}`);
}
assert(acceptance.result === "PROVIDER_FREE_CANDIDATE_AWAITING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" && acceptance.candidate.proposal_sha256 === expected.proposal && acceptance.candidate.authority_recorded === false && acceptance.candidate.maximum_cumulative_finite_spend_usd === null, "ACCEPTANCE");
assert(proposal.read_only_provider_snapshot?.inventory_checked_at === "2026-08-22T18:38:05.635Z" && proposal.read_only_provider_snapshot?.pods === 0 && proposal.read_only_provider_snapshot?.endpoints === 0 && proposal.read_only_provider_snapshot?.private_templates === 0 && proposal.read_only_provider_snapshot?.active_serverless_workers === 0 && proposal.read_only_provider_snapshot?.running_pods === 0 && proposal.read_only_provider_snapshot?.network_volumes === 2, "FRESH_INVENTORY");
assert(proposal.rates_cost_and_retention?.rate_checked_at === "2026-08-22T18:38:24.525Z" && proposal.rates_cost_and_retention?.current_rtx4090_eu_ro_1_availability === "LOW" && proposal.rates_cost_and_retention?.secure_rtx4090_reference_usd_per_gpu_hour === 0.74 && proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "FRESH_RATE");
const harnessSource = String(readFileSync(resolve(root, "apps/web/src/server/providers/runpod-v207-qualification-harness.ts")));
assert(harnessSource.includes("return await this.recoverConcurrentReadersAfterTimeout(jobIds, verify)") && harnessSource.includes("RUNPOD_CONCURRENT_READER_JOB_ID_MISMATCH") && harnessSource.includes("RUNPOD_CONCURRENT_READER_RECOVERY_UNCONFIRMED"), "CONTROL_SOURCE");
const context = ["project-context/CURRENT_STATE.yaml", "project-context/GATES.yaml", "project-context/00_START_HERE.md", "project-context/tasks/VF-10-07.md", "apps/web/src/server/providers/v207-activation-authority.ts"].map((path) => String(readFileSync(resolve(root, path)))).join("\n");
for (const value of [expected.proposal, expected.acceptance, expected.max1, expected.max2, expected.control, expected.priorClosure, "no_live_authority_attempt37_provider_free_candidate", "V207_APPROVED_FINITE_CAP_USD: number | null = null", "V2-08"]) assert(context.includes(value), `CONTEXT_${value.slice(-8)}`);
console.log("V2-07 Attempt37 provider-free proposal validation PASS");
