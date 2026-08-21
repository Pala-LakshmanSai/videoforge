import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt29-terminal-replay-queue-proof-candidate",
);
const expected = Object.freeze({
  proposal: "sha256:d29ab29956e00ebf15595943297564286a685fef0f796b5c8a6cb2a34183d8f6",
  acceptance: "sha256:0123141d53c7652a538d690f2425f8447570b7b46d6ee8c850e22853058a9ed2",
  max1: "sha256:115a413d11be895638d3742a512f1a1f2d21a6f613617559c5816aa70bd840aa",
  max2: "sha256:f375c3d4d4f67b7021b92d46b01c1e24b44c269280b697430191539a51155a0d",
  control: "7ba8e9181fe210858c23a3ba7c5c9aca768ac24b",
  closure: "sha256:9d95a32f66a563db2c74dedd608067dbcc4b3ed989125ca4d2696b22943ef1bb",
  cleanup: "sha256:a8c7b12731fd8b6b72a4bdce38c2b03de51e50cdc255d9f0fb96639507174049",
  priorProposal: "sha256:12bb46d0d6403c888bc5ba7c965174f681baa5f45f320a90a4b1d4f0cf7f56cf",
  priorAuthority: "sha256:455d5102618a14595aabb9f38236a7fd4d8ddb59ba063c48b03b4c6dd0a85326",
  image:
    "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:bc662a182b2a874c6aeffb05f65cc3ffbdff6b5130c6a75c214618e86cf208b5",
  model: "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot",
  manifest: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
  volume: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
});

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const fail = (code) => {
  throw new Error(`V207_ATTEMPT29_PROPOSAL_INVALID:${code}`);
};
const assert = (condition, code) => {
  if (!condition) fail(code);
};
const parse = (bytes, code) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${code}_JSON`);
  }
};
const hasAll = (text, values) => values.every((value) => text.includes(value));

const files = Object.freeze({
  proposal: resolve(candidate, "combined-live-proposal.json"),
  acceptance: resolve(candidate, "acceptance.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
});
const [proposalBytes, acceptanceBytes, max1Bytes, max2Bytes] = await Promise.all(
  Object.values(files).map((path) => readFile(path)),
);
assert(sha256(proposalBytes) === expected.proposal, "PROPOSAL_HASH");
assert(sha256(acceptanceBytes) === expected.acceptance, "ACCEPTANCE_HASH");
assert(sha256(max1Bytes) === expected.max1, "MAX1_HASH");
assert(sha256(max2Bytes) === expected.max2, "MAX2_HASH");
try {
  await access(resolve(candidate, "approved-authority.json"));
  fail("AUTHORITY_FILE_MUST_BE_ABSENT");
} catch (error) {
  if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const proposal = parse(proposalBytes, "PROPOSAL");
const acceptance = parse(acceptanceBytes, "ACCEPTANCE");
const max1 = parse(max1Bytes, "MAX1");
const max2 = parse(max2Bytes, "MAX2");
assert(
  proposal.schema_version ===
    "videoforge.v2-07-terminal-replay-queue-proof-combined-live-proposal/v1" &&
    proposal.checkpoint === "V2-07" &&
    proposal.task_id === "VF-10-07" &&
    proposal.attempt === 29,
  "SCOPE",
);
assert(
  proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" &&
    proposal.user_approval?.exact_proposal_approved === false &&
    proposal.user_approval?.provider_mutation_or_gpu_use_authorized === false &&
    proposal.user_approval?.maximum_cumulative_finite_spend_usd === null &&
    proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null,
  "UNAPPROVED_NULL_CAP",
);
const lineage = proposal.lineage;
assert(
  lineage?.control_source_commit === expected.control &&
    lineage?.terminal_replay_queue_fence_commit === expected.control &&
    lineage?.final_image === expected.image &&
    lineage?.model === expected.model &&
    lineage?.model_manifest_sha256 === expected.manifest &&
    lineage?.volume_id_sha256 === expected.volume &&
    lineage?.volume_mount === "/runpod-volume" &&
    lineage?.volume_size_gb === 50 &&
    lineage?.volume_region === "EU-RO-1" &&
    lineage?.failed_attempt_evidence_sha256 === expected.closure &&
    lineage?.prior_cleanup_evidence_sha256 === expected.cleanup &&
    lineage?.prior_proposal_sha256 === expected.priorProposal &&
    lineage?.prior_authority_sha256 === expected.priorAuthority,
  "LINEAGE",
);
const replay = proposal.terminal_replay_queue_fence;
assert(
  replay?.commit === expected.control &&
    replay?.terminal_request_key_cannot_reenter_owned_jobs === true &&
    replay?.second_provider_run_post_forbidden === true &&
    replay?.duplicate_compute === false,
  "REPLAY_FENCE",
);
const queue = proposal.post_job_queue_empty_fallback;
assert(
  queue?.commit === expected.control &&
    queue?.owned_jobs_must_be_zero === true &&
    queue?.queue_read_max_attempts === 12 &&
    queue?.queue_read_poll_interval_ms === 250 &&
    queue?.queue_reads_bracket_two_stable_terminal_inventory_snapshots === true &&
    queue?.queued_running_malformed_active_nonterminal_mismatched_or_unstable_state_fails_closed ===
      true,
  "QUEUE_FALLBACK",
);
assert(
  proposal.proposed_operations_in_order?.some((value) =>
    value.includes(
      "accept_exact_direct_warm_idle_or_only_after_RUNPOD_WARM_IDLE_NOT_CONFIRMED",
    ),
  ) &&
    proposal.cleanup_rollback_and_stop_conditions?.stop_if?.some((value) =>
      value.includes("duplicate delivery that is not the exact same-job replay"),
    ),
  "OPERATIONS",
);
assert(
  proposal.read_only_provider_snapshot?.pods === 0 &&
    proposal.read_only_provider_snapshot?.endpoints === 0 &&
    proposal.read_only_provider_snapshot?.private_templates === 0 &&
    proposal.read_only_provider_snapshot?.active_serverless_workers === 0 &&
    proposal.read_only_provider_snapshot?.running_pods === 0 &&
    proposal.read_only_provider_snapshot?.retained_volume_count === 2 &&
    proposal.read_only_provider_snapshot?.rtx4090_availability === "LOW" &&
    proposal.rates_cost_and_retention?.serverless_flex_rtx4090_usd_per_gpu_hour === 1.1 &&
    proposal.rates_cost_and_retention?.estimated_finite_serverless_compute_usd_ceiling === 2.2 &&
    proposal.rates_cost_and_retention?.existing_two_volume_charge_usd_per_month_total === 7,
  "PREFLIGHT_RATE_COST",
);
for (const [label, definition, workersMax, hash] of [
  ["max1", max1, 1, expected.max1],
  ["max2", max2, 2, expected.max2],
]) {
  const gpuCount = definition.gpu_count ?? definition.gpu_count_per_worker;
  assert(
    definition.control_source_commit === expected.control &&
      definition.image === expected.image &&
      definition.network_volume_id_sha256 === expected.volume &&
      definition.network_volume_mount === "/runpod-volume" &&
      definition.region === "EU-RO-1" &&
      definition.compute_type === "GPU" &&
      definition.gpu_type_ids?.length === 1 &&
      definition.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" &&
      gpuCount === 1 &&
      definition.flex_only === true &&
      definition.flashboot === true &&
      definition.workers_min === 0 &&
      definition.workers_max === workersMax &&
      definition.execution_timeout_seconds === 2400 &&
      definition.init_timeout_seconds === 800 &&
      definition.request_authority_ttl_seconds === 7200 &&
      proposal.staged_endpoint_configs?.some(
        (item) => item.definition_sha256 === hash && item.workers_max === workersMax,
      ),
    `${label.toUpperCase()}_CONFIG`,
  );
}
assert(
  acceptance.candidate?.proposal_sha256 === expected.proposal &&
    acceptance.candidate?.max1_sha256 === expected.max1 &&
    acceptance.candidate?.max2_sha256 === expected.max2 &&
    acceptance.candidate?.control_source_commit === expected.control &&
    acceptance.candidate?.authority_path === null &&
    acceptance.candidate?.authority_sha256 === null &&
    acceptance.candidate?.maximum_cumulative_finite_spend_usd === null,
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
  assert(hasAll(text, [expected.proposal, expected.control]), `${label.toUpperCase()}_POINTERS`);
}
assert(
  hasAll(state, [
    expected.acceptance,
    expected.max1,
    expected.max2,
    "phase: serverless_v2_v2_07_attempt29_terminal_replay_queue_proof_candidate_ready",
    "task_stage: provider_free",
    "provider_calls_authorized: false",
    "maximum_external_spend_usd: 0",
    "authority_recorded: false",
    "authority_sha256: null",
  ]),
  "STATE_BOUNDARY",
);
assert(
  hasAll(gates, [
    expected.acceptance,
    "authority_mode: none_attempt29_unapproved",
    "pending_authority: null",
    "pending_authority_sha256: null",
    "pending_numeric_cap_usd: null",
    'result: "NOT_QUALIFIED_attempt29_provider_free_candidate_ready"',
  ]),
  "GATE_BOUNDARY",
);
assert(
  activation.includes("V207_APPROVED_AUTHORITY_SHA256: string | null = null") &&
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") &&
    activationTest.includes("V207_APPROVED_AUTHORITY_SHA256).toBeNull()") &&
    activationTest.includes("V207_APPROVED_FINITE_CAP_USD).toBeNull()") &&
    activationTest.includes('toThrow("V207_FRESH_AUTHORITY_REQUIRED")'),
  "ACTIVATION_BOUNDARY",
);
assert(!state.includes("TODO_ATTEMPT29") && !gates.includes("TODO_ATTEMPT29"), "NO_TODO");

process.stdout.write(
  `V2-07 Attempt29 proposal validation PASS (${expected.proposal}; max1 ${expected.max1}; max2 ${expected.max2}; acceptance ${expected.acceptance}; fresh authority and cap required)\n`,
);
