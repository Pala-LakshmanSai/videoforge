import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt30-finalize-replay-fast-path-candidate",
);
const expected = Object.freeze({
  proposal: "sha256:2cb3d2a2ab73e968da1e964018fd2c100bf9e8cc7b277e9c5739b69355896c2a",
  acceptance: "sha256:d7b0648e0de3e7c80fb8f83300feafb8c03aac0d198e8dabd8a7b6b281b1dfd1",
  max1: "sha256:3ecd3f8f0d2ba49a7b1464bd3ff4a03f0866e371d9be0371db692fadc42a23f8",
  max2: "sha256:5c43f8c1499b8f8f3fbbed2cc7cf6b778e978bc61869cbdf79a680d26985e304",
  repair: "bf26c3a86ec6a48f619c39613d425da816eeae4d",
  priorProposal: "sha256:d29ab29956e00ebf15595943297564286a685fef0f796b5c8a6cb2a34183d8f6",
  priorAuthority: "sha256:46bf0ba614b4210f56fd745057e8ebc6f5be4c69c672fe885d6d36de185f1572",
  closure: "sha256:ba6aab6bc71726c1690ae80161a7c22c9f3f50444efd14efc396bf556ae72678",
  cleanup: "sha256:96a7660bb19f0db5e88cec60269647b2101fd2ef5114f78efeecacec022c8a24",
  image: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
});
const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => { throw new Error(`V207_ATTEMPT30_PROPOSAL_INVALID:${code}`); };
const assert = (value, code) => { if (!value) fail(code); };
const parse = (bytes, code) => {
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail(`${code}_JSON`); }
};
const paths = {
  proposal: resolve(candidate, "combined-live-proposal.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
};
const [proposalBytes, acceptanceBytes, max1Bytes, max2Bytes] = await Promise.all(
  Object.values(paths).map((path) => readFile(path)),
);
assert(sha256(proposalBytes) === expected.proposal, "PROPOSAL_HASH");
assert(sha256(acceptanceBytes) === expected.acceptance, "ACCEPTANCE_HASH");
assert(sha256(max1Bytes) === expected.max1, "MAX1_HASH");
assert(sha256(max2Bytes) === expected.max2, "MAX2_HASH");
try {
  await access(resolve(candidate, "approved-authority.json"));
  fail("UNEXPECTED_AUTHORITY_FILE");
} catch (error) {
  if (error instanceof Error && error.message.includes("V207_ATTEMPT30")) throw error;
}
const proposal = parse(proposalBytes, "PROPOSAL");
const acceptance = parse(acceptanceBytes, "ACCEPTANCE");
const max1 = parse(max1Bytes, "MAX1");
const max2 = parse(max2Bytes, "MAX2");
assert(
  proposal.schema_version === "videoforge.v2-07-finalize-replay-fast-path-combined-live-proposal/v1" &&
    proposal.checkpoint === "V2-07" && proposal.task_id === "VF-10-07" && proposal.attempt === 30,
  "SCOPE",
);
assert(
  proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.user_approval?.provider_mutation_or_gpu_use_authorized === false &&
    proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null &&
    proposal.execution_boundary?.maximum_cumulative_finite_spend_usd === null &&
    proposal.provider_mutation === false && proposal.gpu_use === false && proposal.spend_usd === 0,
  "NO_AUTHORITY_OR_CAP",
);
const lineage = proposal.lineage;
assert(
  lineage?.control_source_commit === expected.repair &&
    lineage?.finalize_replay_fast_path_commit === expected.repair &&
    lineage?.final_image === expected.image && lineage?.model === expected.model &&
    lineage?.model_manifest_sha256 === expected.manifest &&
    lineage?.volume_id_sha256 === expected.volume && lineage?.volume_mount === "/runpod-volume" &&
    lineage?.volume_size_gb === 50 && lineage?.volume_region === "EU-RO-1" &&
    lineage?.prior_proposal_sha256 === expected.priorProposal &&
    lineage?.prior_authority_sha256 === expected.priorAuthority &&
    lineage?.prior_closure_evidence_sha256 === expected.closure &&
    lineage?.prior_cleanup_evidence_sha256 === expected.cleanup &&
    lineage?.prior_authority_state === "CLOSED_EXACT_ATTEMPT29_CONSUMED_DO_NOT_REUSE",
  "LINEAGE",
);
const replay = proposal.finalize_replay_fast_path;
assert(
  replay?.repair_commit === expected.repair &&
    replay?.expensive_png_probe_skipped_only_for_verified_existing_receipt === true &&
    replay?.first_finalize_full_png_probe_required === true &&
    replay?.local_realistic_high_entropy_1280x720_replay_under_ms === 1000 &&
    replay?.receipt_identity_callback_content_checksum_and_hash_conflict_fences_preserved === true,
  "FAST_PATH",
);
assert(
  proposal.read_only_provider_snapshot?.pods === 0 &&
    proposal.read_only_provider_snapshot?.endpoints === 0 &&
    proposal.read_only_provider_snapshot?.private_templates === 0 &&
    proposal.read_only_provider_snapshot?.active_serverless_workers === 0 &&
    proposal.read_only_provider_snapshot?.running_pods === 0 &&
    proposal.read_only_provider_snapshot?.retained_volume_count === 2 &&
    proposal.read_only_provider_snapshot?.rtx4090_availability === "HIGH" &&
    proposal.read_only_provider_snapshot?.cumulative_endpoint_spend_usd === 0.5883426677901298 &&
    proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1 &&
    proposal.rates_cost_and_retention?.secure_rtx4090_reference_usd_per_gpu_hour === 0.74 &&
    proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7 &&
    proposal.rates_cost_and_retention?.estimated_finite_serverless_compute_usd_ceiling === 2.2 &&
    proposal.rates_cost_and_retention?.minimum_requested_availability === "LOW" &&
    proposal.rates_cost_and_retention?.availability_requirement_satisfied === true,
  "PREFLIGHT_RATE_COST",
);
for (const [label, definition, workersMax, hash] of [
  ["MAX1", max1, 1, expected.max1],
  ["MAX2", max2, 2, expected.max2],
]) {
  const gpuCount = definition.gpu_count ?? definition.gpu_count_per_worker;
  assert(
    definition.control_source_commit === expected.repair &&
      definition.finalize_replay_fast_path_commit === expected.repair &&
      definition.image === expected.image &&
      definition.network_volume_id_sha256 === expected.volume &&
      definition.network_volume_mount === "/runpod-volume" &&
      definition.model_root === "/runpod-volume/mage-model" &&
      definition.volume_write_policy === "APPLICATION_READ_ONLY" &&
      definition.region === "EU-RO-1" && definition.compute_type === "GPU" &&
      definition.gpu_type_ids?.length === 1 &&
      definition.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" &&
      gpuCount === 1 && definition.flex_only === true && definition.flashboot === true &&
      definition.workers_min === 0 && definition.workers_max === workersMax &&
      definition.idle_timeout_seconds === 5 && definition.init_timeout_seconds === 800 &&
      definition.execution_timeout_seconds === 2400 &&
      definition.request_authority_ttl_seconds === 7200 &&
      proposal.staged_endpoint_configs?.some(
        (item) => item.definition_sha256 === hash && item.workers_max === workersMax,
      ),
    `${label}_CONFIG`,
  );
}
assert(
  acceptance.result === "PROVIDER_FREE_CANDIDATE_PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.max1_sha256 === expected.max1 &&
    acceptance.candidate?.max2_sha256 === expected.max2 &&
    acceptance.candidate?.control_source_commit === expected.repair &&
    acceptance.candidate?.finalize_replay_fast_path_commit === expected.repair &&
    acceptance.candidate?.authority_path === null &&
    acceptance.candidate?.authority_sha256 === null &&
    acceptance.candidate?.authority_recorded === false &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === null &&
    acceptance.candidate?.provider_calls_authorized === false &&
    acceptance.candidate?.provider_mutations_authorized === false &&
    acceptance.candidate?.gpu_use_authorized === false,
  "ACCEPTANCE",
);
const [state, gates, task, start, activation, activationTest] = await Promise.all([
  readFile(resolve(root, "project-context/CURRENT_STATE.yaml"), "utf8"),
  readFile(resolve(root, "project-context/GATES.yaml"), "utf8"),
  readFile(resolve(root, "project-context/tasks/VF-10-07.md"), "utf8"),
  readFile(resolve(root, "project-context/00_START_HERE.md"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.test.ts"), "utf8"),
]);
for (const [label, text] of Object.entries({ state, gates, task, start, activation, activationTest })) {
  assert(text.includes(expected.proposal) && text.includes(expected.repair), `${label.toUpperCase()}_POINTERS`);
}
assert(
  state.includes("phase: serverless_v2_v2_07_attempt29_closed_finalize_replay_failure") &&
    state.includes("task_stage: provider_free") &&
    state.includes("provider_calls_authorized: false") &&
    state.includes("maximum_external_spend_usd: 0"),
  "STATE_BOUNDARY",
);
assert(
  gates.includes("authority_mode: none_attempt29_consumed") &&
    gates.includes("pending_numeric_cap_usd: null") &&
    gates.includes('result: "NOT_QUALIFIED_attempt29_closed_output_finalization_replay_failure"'),
  "GATE_BOUNDARY",
);
assert(
  activation.includes("V207_APPROVED_AUTHORITY_SHA256: string | null = null") &&
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") &&
    activationTest.includes("V207_APPROVED_AUTHORITY_SHA256).toBeNull()") &&
    activationTest.includes("V207_APPROVED_FINITE_CAP_USD).toBeNull()") &&
    activationTest.includes("rejects the consumed Attempt29 proposal"),
  "ACTIVATION_BOUNDARY",
);
process.stdout.write(
  `V2-07 Attempt30 provider-free proposal validation PASS (${expected.proposal}; max1 ${expected.max1}; max2 ${expected.max2}; acceptance ${expected.acceptance}; no authority/cap)\n`,
);
