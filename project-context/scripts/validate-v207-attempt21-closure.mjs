import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const evidencePath = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-21.json",
);
const candidate = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt21-diagnostic-readback-candidate",
);
const paths = {
  evidence: evidencePath,
  proposal: resolve(candidate, "combined-live-proposal.json"),
  authority: resolve(candidate, "approved-authority.json"),
  max1: resolve(candidate, "staged-config-max1.json"),
  max2: resolve(candidate, "staged-config-max2.json"),
  state: resolve(root, "project-context/CURRENT_STATE.yaml"),
  gates: resolve(root, "project-context/GATES.yaml"),
  task: resolve(root, "project-context/tasks/VF-10-07.md"),
  start: resolve(root, "project-context/00_START_HERE.md"),
  activation: resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  activationTest: resolve(root, "apps/web/src/server/providers/v207-activation-authority.test.ts"),
};

const EXPECTED = {
  evidence:
    "sha256:cd7200aca5f532a3e9062b37c296cf412bce974605f44278156c23674710bd68",
  priorEvidence:
    "sha256:82aae2abf02041620c18d6a016719bab0f92ef41ed77430c2239ebfab005a37d",
  proposal:
    "sha256:13acabaed3c21b3a15fcca203072c211f9002057453d4cd9b0fb5a765444d2d4",
  authority:
    "sha256:bc7580ad3f4782504587904115abb76738da72e3f2a048314a959475ef7316ec",
  max1:
    "sha256:39de7cd6c3905c5482bd5eb2b47a8af5d683286bf8f4b4df5df0ddb0cb3ddfcd",
  max2:
    "sha256:7dd4b98be49c06095af3cf04ae01d96860a803ec3fe9811531cc397f9214884e",
  orchestrator:
    "sha256:80ff4c9fdc810612a31e3d1f1082163b5799bdc82ed31757cdd97c263c5a257d",
  qualification:
    "sha256:cc5905d4be7b4470e19285e7d63ce7a5918cad61ab6aecb8ca4c8ab829630de5",
  endpoint:
    "sha256:2ad220e2b0ef6aafbf7031693edce8089df8d345806b665d47e261714905a685",
  template:
    "sha256:0bc863bc8c4f19714354c10e1fbc0c3d4bbdec4e5fbfa16381e04843967b3ca9",
  control: "8d62be71b9b10585ea99d0583a4a4267ed9a5a79",
};

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const parse = (bytes, label) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`V207_ATTEMPT21_CLOSURE_INVALID:${label}_json`);
  }
};
const assert = (condition, label) => {
  if (!condition) throw new Error(`V207_ATTEMPT21_CLOSURE_INVALID:${label}`);
};

const entries = await Promise.all(
  Object.entries(paths).map(async ([label, path]) => [label, await readFile(path)]),
);
const bytes = Object.fromEntries(entries);
const evidence = parse(bytes.evidence, "evidence");
const proposal = parse(bytes.proposal, "proposal");
const authority = parse(bytes.authority, "authority");

assert(hash(bytes.evidence) === EXPECTED.evidence, "evidence_hash");
assert(hash(bytes.proposal) === EXPECTED.proposal, "proposal_hash");
assert(hash(bytes.authority) === EXPECTED.authority, "authority_hash");
assert(hash(bytes.max1) === EXPECTED.max1 && hash(bytes.max2) === EXPECTED.max2, "config_hashes");

assert(evidence.schema_version === "videoforge.v2-07-live-failed-attempt/v1", "schema");
assert(evidence.checkpoint === "V2-07" && evidence.task_id === "VF-10-07" && evidence.attempt === 21, "scope");
assert(evidence.authority_status === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "authority_closed");
assert(evidence.authority_proposal_sha256 === EXPECTED.proposal, "authority_proposal");
assert(evidence.approved_authority?.sha256 === EXPECTED.authority, "authority_record");
assert(evidence.failure?.code === "RUNPOD_ENDPOINT_ID_BINDING_READBACK_UNCONFIRMED", "failure_code");
assert(evidence.failure?.error_category === "environment", "error_category");
assert(evidence.failure?.job_dispatch_reached === false, "no_dispatch");
assert(evidence.failure?.gpu_jobs_submitted === 0 && evidence.failure?.batch_count === 0, "no_compute");
assert(evidence.failure?.outputs_created === 0 && evidence.failure?.inference_completed === false, "no_outputs");
assert(evidence.failure?.measured_spend_usd === 0, "measured_spend");
assert(evidence.runpod_cleanup?.endpoint_id_sha256 === EXPECTED.endpoint, "endpoint_hash");
assert(evidence.runpod_cleanup?.template_id_sha256 === EXPECTED.template, "template_hash");
assert(evidence.runpod_cleanup?.stable_terminal_snapshot_count === 2, "terminal_snapshots");
assert(evidence.runpod_cleanup?.endpoint_deleted === true && evidence.runpod_cleanup?.template_deleted === true, "deleted_disposable");
assert(evidence.runpod_cleanup?.final_disposable_resources_absent === true, "disposable_absent");
assert(evidence.runpod_cleanup?.pods === 0 && evidence.runpod_cleanup?.endpoints === 0, "zero_endpoints");
assert(evidence.runpod_cleanup?.private_templates === 0 && evidence.runpod_cleanup?.active_serverless_workers === 0, "zero_workers");
assert(evidence.runpod_cleanup?.running_pods === 0 && evidence.runpod_cleanup?.network_volumes === 2, "zero_pods_volumes");
assert(evidence.billing?.baseline_endpoint_spend_usd === evidence.billing?.final_endpoint_spend_usd, "billing_equal");
assert(evidence.billing?.attempt_increment_usd_settled === 0, "billing_increment");
assert(evidence.billing?.settlement_state === "STABLE_THREE_READS", "billing_settled");
assert(evidence.billing?.within_approved_cap === true && evidence.billing?.maximum_cumulative_finite_spend_usd === 4, "billing_cap");
assert(evidence.cloudflare_cleanup?.signer_secret_deleted === true, "signer_deleted");
assert(evidence.cloudflare_cleanup?.worker_version_restored === true, "worker_restored");
assert(evidence.cloudflare_cleanup?.route_restoration?.startsWith("CONFIRMED_16_CONSECUTIVE"), "route_restored");
assert(evidence.raw_local_evidence?.orchestrator_sha256 === EXPECTED.orchestrator && evidence.raw_local_evidence?.orchestrator_bytes === 2679, "orchestrator_evidence");
assert(evidence.raw_local_evidence?.qualification_sha256 === EXPECTED.qualification && evidence.raw_local_evidence?.qualification_bytes === 2823, "qualification_evidence");
assert(evidence.authority_closure?.proposal_reusable === false && evidence.authority_closure?.authority_reusable === false, "no_reuse");
assert(evidence.authority_closure?.fresh_proposal_required === true && evidence.authority_closure?.fresh_numeric_cap_required === true, "fresh_retry");
assert(evidence.qualification_boundaries?.v2_07 === "NOT_QUALIFIED" && evidence.qualification_boundaries?.v2_08_authorized === false, "qualification_boundary");

assert(proposal.lineage?.control_source_commit === EXPECTED.control, "proposal_control");
assert(proposal.lineage?.failed_attempt_evidence_sha256 === EXPECTED.priorEvidence, "proposal_evidence_lineage");
assert(authority.proposal?.sha256 === EXPECTED.proposal, "authority_proposal_lineage");
assert(authority.execution_boundary?.maximum_cumulative_finite_spend_usd === 4, "authority_cap");

const state = bytes.state.toString("utf8");
const gates = bytes.gates.toString("utf8");
const task = bytes.task.toString("utf8");
const start = bytes.start.toString("utf8");
const activation = bytes.activation.toString("utf8");
const activationTest = bytes.activationTest.toString("utf8");
assert(
  state.includes("phase: serverless_v2_v2_07_attempt22_closed_output_contract_diagnosis_required") ||
  state.includes("phase: serverless_v2_v2_07_attempt23_output_contract_diagnostic_pending") ||
    state.includes("phase: serverless_v2_v2_07_attempt23_authorized") ||
    state.includes("phase: serverless_v2_v2_07_attempt23_closed") ||
    state.includes("phase: serverless_v2_v2_07_attempt24_verification_stage_diagnostic_authorized") ||
    state.includes("phase: serverless_v2_v2_07_attempt24_verification_stage_diagnostic_pending") ||
    state.includes("phase: serverless_v2_v2_07_attempt24_closed") ||
    state.includes("phase: serverless_v2_v2_07_attempt25_startup_terminal_inventory_candidate") ||
    state.includes("phase: serverless_v2_v2_07_attempt25_startup_terminal_inventory_authorized") ||
    state.includes("phase: serverless_v2_v2_07_attempt25_closed"),
  "state_phase",
);
assert(state.includes("historical_v2_07_attempt21_authority:") && state.includes("consumed: true"), "state_closed");
assert(state.includes(`authority_sha256: "${EXPECTED.authority}"`), "state_no_authority");
assert(state.includes("failed-attempt-21.json") && state.includes(EXPECTED.evidence), "state_evidence");
assert(state.includes(EXPECTED.proposal) && state.includes(EXPECTED.authority), "state_lineage");
assert(
  (gates.includes("previous_attempt: \"evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-21.json\"") ||
    gates.includes("failed-attempt-23.json") ||
    gates.includes("failed-attempt-24.json")) &&
    state.includes(EXPECTED.evidence),
  "gate_evidence",
);
assert(
  state.includes(`v2_07_attempt21_closed_authority_sha256: "${EXPECTED.authority}"`) &&
    state.includes(EXPECTED.evidence),
  "gate_closed",
);
assert(task.includes("## Attempt 21 closure") && task.includes(EXPECTED.evidence), "task_closure");
assert(start.includes("failed-attempt-21.json") && start.includes(EXPECTED.evidence), "start_closure");
assert(activation.includes("V207_APPROVED_FINITE_CAP_USD"), "activation_closed");
assert(activationTest.includes("V207_APPROVED_FINITE_CAP_USD"), "activation_test_closed");

process.stdout.write(`V2-07 Attempt21 closure validation PASS (${EXPECTED.evidence}; no GPU/dispatch/spend)\n`);
