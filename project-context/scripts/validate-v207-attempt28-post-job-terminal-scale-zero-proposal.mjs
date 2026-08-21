import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const candidate = join(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt28-post-job-terminal-scale-zero-candidate",
);
const expected = Object.freeze({
  proposal: "sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf",
  max1: "sha256:acef5c48b6059fa2401b88bb40ed81e648c9ed795e5fcb3208e117d936f4196d",
  max2: "sha256:45d067e5d7e1b152d25c62eb7e185898bbedd30797d5d9aacc83bb9a48e41836",
  control: "0084f6a13fdaa5a6d4b704e32e8b6cc22cecce14",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  priorProposal: "sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae",
  priorAuthority: "sha256:3bf923fb59df2ab0a0ff648ad8773ed549b2296aba66e82db9635c9fa7b66b10",
  closure: "sha256:ffd622c4ee0a6a37311a51f191ce9c3ccbb0ae91620e51f64a03dfef932fb20d",
  cleanup: "sha256:9aa51ccb29b6a9568534c6f79eaa07b46fbcdf1fd9137f9b21cb87404ac3686d",
});

const assert = (condition, code) => {
  if (!condition) throw new Error(`V207_ATTEMPT28_${code}`);
};
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const readJson = async (path) => JSON.parse(await readFile(path, "utf8"));
const hasAll = (text, values) => values.every((value) => text.includes(value));

const proposalPath = join(candidate, "combined-live-proposal.json");
const max1Path = join(candidate, "staged-config-max1.json");
const max2Path = join(candidate, "staged-config-max2.json");
const [proposalBytes, max1Bytes, max2Bytes] = await Promise.all([
  readFile(proposalPath),
  readFile(max1Path),
  readFile(max2Path),
]);
assert(sha256(proposalBytes) === expected.proposal, "PROPOSAL_HASH_DRIFT");
assert(sha256(max1Bytes) === expected.max1, "MAX1_HASH_DRIFT");
assert(sha256(max2Bytes) === expected.max2, "MAX2_HASH_DRIFT");

const [proposal, max1, max2] = await Promise.all([
  readJson(proposalPath),
  readJson(max1Path),
  readJson(max2Path),
]);
assert(proposal.attempt === 28, "ATTEMPT");
assert(proposal.provider_mutation === false && proposal.gpu_use === false, "PROVIDER_BOUNDARY");
assert(proposal.spend_usd === 0, "SPEND_BOUNDARY");
assert(proposal.user_approval?.exact_proposal_approved === false, "APPROVAL_BOUNDARY");
assert(proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "CAP_MUST_BE_NULL");
assert(proposal.user_approval?.fresh_numeric_cap_required === true, "FRESH_CAP_REQUIRED");
assert(proposal.lineage?.model === expected.model, "MODEL");
assert(proposal.lineage?.model_manifest_sha256 === expected.manifest, "MANIFEST");
assert(proposal.lineage?.final_image === expected.image, "IMAGE");
assert(proposal.lineage?.volume_id_sha256 === expected.volume, "VOLUME");
assert(proposal.lineage?.volume_mount === "/runpod-volume", "MOUNT");
assert(proposal.lineage?.volume_size_gb === 50 && proposal.lineage?.volume_region === "EU-RO-1", "VOLUME_PLACEMENT");
assert(proposal.lineage?.control_source_commit === expected.control, "CONTROL");
assert(proposal.lineage?.prior_proposal_sha256 === expected.priorProposal, "PRIOR_PROPOSAL");
assert(proposal.lineage?.prior_authority_sha256 === expected.priorAuthority, "PRIOR_AUTHORITY");
assert(proposal.lineage?.prior_closure_evidence_sha256 === expected.closure, "PRIOR_CLOSURE");
assert(proposal.lineage?.prior_cleanup_evidence_sha256 === expected.cleanup, "PRIOR_CLEANUP");
assert(proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1, "MAX1_REF");
assert(proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2, "MAX2_REF");

for (const [definition, workersMax] of [
  [max1, 1],
  [max2, 2],
]) {
  assert(definition.control_source_commit === expected.control, "STAGED_CONTROL");
  assert(definition.image === expected.image, "STAGED_IMAGE");
  assert(definition.network_volume_id_sha256 === expected.volume, "STAGED_VOLUME");
  assert(definition.network_volume_mount === "/runpod-volume", "STAGED_MOUNT");
  assert(definition.region === "EU-RO-1", "STAGED_REGION");
  assert(definition.gpu_type_ids?.length === 1 && definition.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090", "STAGED_GPU");
  assert(definition.compute_type === "GPU" && definition.flex_only === true, "STAGED_COMPUTE");
  assert(definition.workers_min === 0 && definition.workers_max === workersMax, "STAGED_WORKERS");
  assert(definition.flashboot === true, "STAGED_FLASHBOOT");
  const repair = definition.post_job_terminal_scale_zero_fallback;
  assert(repair?.repair_commit === expected.control, "STAGED_REPAIR");
  assert(repair?.trigger_error_exact === "RUNPOD_WARM_IDLE_NOT_CONFIRMED", "STAGED_TRIGGER");
  assert(repair?.health_first_quiescence_required === true, "HEALTH_FIRST");
  assert(repair?.stable_exact_inventory_snapshots_required === 2, "TWO_SNAPSHOTS");
  assert(repair?.active_malformed_mismatched_or_unstable_state_fails_closed === true, "FAIL_CLOSED");
  assert(repair?.fallback_marks_scale_zero_not_warm_idle === true, "ZERO_NOT_WARM");
}

const repair = proposal.post_job_terminal_scale_zero_repair;
assert(repair?.commit === expected.control, "PROPOSAL_REPAIR");
assert(repair?.health_first_quiescence_required === true, "PROPOSAL_HEALTH_FIRST");
assert(repair?.stable_exact_inventory_snapshots_required === 2, "PROPOSAL_TWO_SNAPSHOTS");
assert(repair?.active_malformed_mismatched_nonterminal_or_unstable_state_fails_closed === true, "PROPOSAL_FAIL_CLOSED");
assert(repair?.dispatch_remains_blocked_after_failure === true, "DISPATCH_FENCE");
assert(proposal.read_only_provider_snapshot?.pods === 0, "PREFLIGHT_PODS");
assert(proposal.read_only_provider_snapshot?.endpoints === 0, "PREFLIGHT_ENDPOINTS");
assert(proposal.read_only_provider_snapshot?.private_templates === 0, "PREFLIGHT_TEMPLATES");
assert(proposal.read_only_provider_snapshot?.active_serverless_workers === 0, "PREFLIGHT_WORKERS");
assert(proposal.read_only_provider_snapshot?.running_pods === 0, "PREFLIGHT_RUNNING");
assert(proposal.read_only_provider_snapshot?.retained_volume_count === 2, "PREFLIGHT_VOLUMES");
assert(proposal.read_only_provider_snapshot?.rtx4090_availability === "MEDIUM", "AVAILABILITY");
assert(proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1, "SERVERLESS_RATE");
assert(proposal.rates_cost_and_retention?.estimated_finite_serverless_compute_usd_ceiling === 2.2, "ESTIMATE");
assert(proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7, "VOLUME_RATE");

const [state, gates, task, start, activation, activationTest] = await Promise.all([
  readFile(join(root, "project-context/CURRENT_STATE.yaml"), "utf8"),
  readFile(join(root, "project-context/GATES.yaml"), "utf8"),
  readFile(join(root, "project-context/tasks/VF-10-07.md"), "utf8"),
  readFile(join(root, "project-context/00_START_HERE.md"), "utf8"),
  readFile(join(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
  readFile(join(root, "apps/web/src/server/providers/v207-activation-authority.test.ts"), "utf8"),
]);
for (const [name, text] of Object.entries({ state, gates, task, start, activation, activationTest })) {
  assert(hasAll(text, [expected.proposal, expected.control]), `${name.toUpperCase()}_POINTERS`);
}
assert(hasAll(state, [expected.max1, expected.max2, "maximum_cumulative_finite_spend_usd: null", "provider_calls_authorized: false"]), "STATE_BOUNDARY");
assert(hasAll(gates, ["authority_mode: none_attempt28_unapproved", "pending_numeric_cap_usd: null"]), "GATE_BOUNDARY");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"), "ACTIVATION_CLOSED");

process.stdout.write(
  `V2-07 Attempt28 proposal validation PASS (${expected.proposal}; max1 ${expected.max1}; max2 ${expected.max2}; authority absent; cap null)\n`,
);
