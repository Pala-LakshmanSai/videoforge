import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt33-max-two-terminal-reader-drain-candidate",
);
const expected = Object.freeze({
  proposal: "sha256:0a417ca023895a02b8ce0e0f2e86b3f3e81b38624819a4abc473695602637925",
  acceptance: "sha256:7a47a7a8ec39c1aa8c8ed943378a5584785cc00cb7b5ee7666b974a5686df048",
  max1: "sha256:5c3651673d93829535a450a88b99bcea697ed817e9f4ceba0536523e606f73a7",
  max2: "sha256:051863d9b131aab22502de85b57553adc924c5bb8f4a3ceee0e6b9d5991e78d2",
  control: "bbc3e40b8519ebee8d6ccdaaf29e1ede6215ac37",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  soulxVolume: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
  priorProposal: "sha256:7c5370668ae06487729775f082cd981164d3e4a1634f20a77beb08bba2ea6b6a",
  priorAuthority: "sha256:a2f2519e6cc5f00ec804adea07b431d155e9fc88a566d7f9ef05396beca99114",
  priorClosure: "sha256:5e2cf1f73e03673b9f350352fa2bfbb91566d9e9a695566fdc08f3b1d84c9f75",
  priorCleanup: "sha256:01d91e1216a77ea4d6ac7130c2add5800f67043b3ba34d26ecbecf9422acc51d",
});
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => { throw new Error(`V207_ATTEMPT33_CANDIDATE_INVALID:${code}`); };
const assert = (condition, code) => { if (!condition) fail(code); };
const parse = (bytes, code) => { try { return JSON.parse(bytes); } catch { fail(`${code}_JSON`); } };
const read = (path) => readFile(resolve(root, path));

const [proposalBytes, acceptanceBytes, max1Bytes, max2Bytes, state, gates, start, task, activation] =
  await Promise.all([
    readFile(resolve(dir, "combined-live-proposal.json")),
    readFile(resolve(dir, "acceptance.json")),
    readFile(resolve(dir, "staged-config-max1.json")),
    readFile(resolve(dir, "staged-config-max2.json")),
    read("project-context/CURRENT_STATE.yaml"),
    read("project-context/GATES.yaml"),
    read("project-context/00_START_HERE.md"),
    read("project-context/tasks/VF-10-07.md"),
    read("apps/web/src/server/providers/v207-activation-authority.ts"),
  ]);
assert(sha(proposalBytes) === expected.proposal, "PROPOSAL_HASH");
assert(sha(acceptanceBytes) === expected.acceptance, "ACCEPTANCE_HASH");
assert(sha(max1Bytes) === expected.max1, "MAX1_HASH");
assert(sha(max2Bytes) === expected.max2, "MAX2_HASH");
const proposal = parse(proposalBytes, "PROPOSAL");
const acceptance = parse(acceptanceBytes, "ACCEPTANCE");
const configs = [parse(max1Bytes, "MAX1"), parse(max2Bytes, "MAX2")];

assert(proposal.attempt === 33 && proposal.status.includes("PROVIDER_FREE"), "STATUS");
assert(proposal.provider_mutation === false && proposal.gpu_use === false && proposal.spend_usd === 0, "BOUNDARY");
assert(proposal.user_approval?.exact_proposal_approved === false, "APPROVAL");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "CAP");
assert(proposal.user_approval?.observed_availability === "MEDIUM", "AVAILABILITY");
const lineage = proposal.lineage;
assert(lineage?.control_source_commit === expected.control, "CONTROL");
assert(lineage?.final_image === expected.image && lineage?.model === expected.model, "MODEL_IMAGE");
assert(lineage?.model_manifest_sha256 === expected.manifest, "MANIFEST");
assert(lineage?.volume_id_sha256 === expected.volume && lineage?.volume_size_gb === 50, "VOLUME");
assert(lineage?.volume_region === "EU-RO-1" && lineage?.volume_mount === "/runpod-volume", "PLACEMENT");
assert(lineage?.model_root === "/runpod-volume/mage-model", "MODEL_ROOT");
assert(lineage?.prior_proposal_sha256 === expected.priorProposal, "PRIOR_PROPOSAL");
assert(lineage?.prior_consumed_authority_sha256 === expected.priorAuthority, "PRIOR_AUTHORITY");
assert(lineage?.prior_closure_evidence_sha256 === expected.priorClosure, "PRIOR_CLOSURE");
assert(lineage?.prior_cleanup_evidence_sha256 === expected.priorCleanup, "PRIOR_CLEANUP");
assert(lineage?.max_two_reader_terminal_drain_repair_commit === expected.control, "REPAIR_LINEAGE");

for (const [index, config] of configs.entries()) {
  assert(config.control_source_commit === expected.control, `CONFIG_${index}_CONTROL`);
  assert(config.image === expected.image, `CONFIG_${index}_IMAGE`);
  assert(config.network_volume_id_sha256 === expected.volume, `CONFIG_${index}_VOLUME`);
  assert(config.network_volume_size_gb === 50 && config.network_volume_region === "EU-RO-1", `CONFIG_${index}_REGION`);
  assert(config.network_volume_mount === "/runpod-volume" && config.model_root === "/runpod-volume/mage-model", `CONFIG_${index}_PATH`);
  assert(config.volume_write_policy === "APPLICATION_READ_ONLY", `CONFIG_${index}_READONLY`);
  assert(config.gpu_type_ids?.[0] === "NVIDIA GeForce RTX 4090" && config.compute_type === "GPU", `CONFIG_${index}_GPU`);
  assert(config.flex_only === true && config.workers_min === 0 && config.workers_max === index + 1, `CONFIG_${index}_WORKERS`);
  assert(
    config.flashboot === true &&
      (index === 0 ? config.gpu_count === 1 : config.gpu_count_per_worker === 1),
    `CONFIG_${index}_FLASHBOOT_GPU_COUNT`,
  );
  const repair = config.max_two_reader_terminal_drain_repair;
  assert(repair?.repair_commit === expected.control && repair?.scope === "POST_CONCURRENT_READER_DRAIN_ONLY", `CONFIG_${index}_REPAIR`);
  assert(repair?.exact_reader_job_ids_required === 2 && repair?.all_reader_jobs_must_be_locally_observed_terminal === true, `CONFIG_${index}_TERMINAL_IDS`);
  assert(repair?.owned_jobs_must_be_zero_before_fallback === true, `CONFIG_${index}_OWNED_ZERO`);
  assert(repair?.health_queue_reads_required?.in_queue === 0 && repair?.health_queue_reads_required?.in_progress === 0, `CONFIG_${index}_QUEUE_ZERO`);
  assert(repair?.stable_terminal_inventory_snapshots_required === 2 && repair?.active_malformed_mismatched_or_unstable_state_fails_closed === true, `CONFIG_${index}_STABLE_FAIL_CLOSED`);
}
assert(proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1, "PROPOSAL_MAX1");
assert(proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2, "PROPOSAL_MAX2");
const snapshot = proposal.read_only_provider_snapshot;
assert(snapshot?.pods === 0 && snapshot?.endpoints === 0 && snapshot?.private_templates === 0, "INVENTORY_DISPOSABLE");
assert(snapshot?.active_serverless_workers === 0 && snapshot?.running_pods === 0, "INVENTORY_COMPUTE");
assert(snapshot?.network_volumes === 2 && snapshot?.retained_volumes?.length === 2, "INVENTORY_VOLUMES");
assert(snapshot.retained_volumes.some((v) => v.id_sha256 === expected.volume && v.size_gb === 50 && v.region === "EU-RO-1"), "MAGE_RETAINED");
assert(snapshot.retained_volumes.some((v) => v.id_sha256 === expected.soulxVolume && v.size_gb === 50 && v.region === "EU-RO-1"), "SOULX_RETAINED");
assert(snapshot.rtx4090_availability === "MEDIUM" && snapshot.secure_rtx4090_reference_usd_per_hour === 0.74, "RATE_AVAILABILITY");
assert(snapshot.cumulative_endpoint_spend_usd === 1.1340842194622383, "BILLING");
assert(proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "SERVERLESS_RATE");
assert(proposal.rates_cost_and_retention?.estimated_finite_serverless_compute_usd_ceiling === 2.2, "ESTIMATE");
assert(proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "RETENTION");
assert(acceptance.candidate?.proposal_sha256 === expected.proposal, "ACCEPTANCE_PROPOSAL");
assert(acceptance.candidate?.max1_sha256 === expected.max1 && acceptance.candidate?.max2_sha256 === expected.max2, "ACCEPTANCE_CONFIGS");
assert(acceptance.candidate?.authority_path === null && acceptance.candidate?.authority_sha256 === null, "ACCEPTANCE_AUTHORITY");
assert(acceptance.candidate?.maximum_cumulative_finite_spend_usd === null, "ACCEPTANCE_CAP");
assert(acceptance.provider_boundary?.provider_calls === false && acceptance.provider_boundary?.gpu_use === false, "ACCEPTANCE_BOUNDARY");

const context = [state, gates, start, task, activation].map(String).join("\n");
for (const value of [expected.proposal, expected.acceptance, expected.max1, expected.max2, expected.control]) {
  assert(context.includes(value), `CONTEXT_${value.slice(-8)}`);
}
assert(context.includes("attempt33_provider_free") || context.includes("Attempt33 provider-free"), "CONTEXT_STATE");
assert(String(activation).includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"), "ACTIVATION_CAP_NULL");
assert(!String(gates).includes("pending_authority: \"evidence/acceptance/VF-10-07/2026-08-22-attempt33"), "NO_AUTHORITY_PATH");

process.stdout.write(`V2-07 Attempt33 max-two terminal reader drain candidate validation PASS (${expected.proposal})\n`);
