import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isAttempt28Activation, isAttempt28Gate, isAttempt28State } from "./v207-attempt28-compat.mjs";

const root = resolve(import.meta.dirname, "../..");
const closurePath = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-22.json",
);
const authorityPath = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt22-template-environment-readback-candidate/approved-authority.json",
);
const proposalPath = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-21-attempt22-template-environment-readback-candidate/combined-live-proposal.json",
);
const expected = {
  closure: "sha256:43f9db51e67a39e4a837614be5af14299d91c4fbdd446b9d78ecc51260da517a",
  authority: "sha256:fecdfa6dee640d483a1787a726723bef08cdeaf455f5b7df0a2fbcdf3c3699f6",
  proposal: "sha256:96ead6591874229d93537af46a3159002e2fe86c93cc2905c42bbb1326ccece7",
};
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`V207_ATTEMPT22_CLOSURE_INVALID:${label}`);
};

const [closureBytes, authorityBytes, proposalBytes, state, gates, task, start, activation] =
  await Promise.all([
    readFile(closurePath),
    readFile(authorityPath),
    readFile(proposalPath),
    readFile(resolve(root, "project-context/CURRENT_STATE.yaml"), "utf8"),
    readFile(resolve(root, "project-context/GATES.yaml"), "utf8"),
    readFile(resolve(root, "project-context/tasks/VF-10-07.md"), "utf8"),
    readFile(resolve(root, "project-context/00_START_HERE.md"), "utf8"),
    readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
]);
const closure = JSON.parse(closureBytes.toString("utf8"));
const attempt26ClosedGate =
  gates.includes("authority_mode: none_attempt26_consumed") &&
  gates.includes('result: "NOT_QUALIFIED_attempt26_closed_finalize_response_invalid"');
const attempt27CandidateGate =
  gates.includes("authority_mode: none_attempt27_pending_fresh_approval") &&
  gates.includes('result: "NOT_QUALIFIED_attempt27_hosted_png_crc32_repair_candidate_ready"') &&
  gates.includes(
    'pending_proposal_sha256: "sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae"',
  );
const attempt27AuthorizedState =
  state.includes("phase: serverless_v2_v2_07_attempt27_hosted_png_crc32_repair_authorized") &&
  state.includes("task_stage: bounded_mutation") &&
  state.includes("provider_calls_authorized: true") &&
  state.includes("maximum_external_spend_usd: 4");
const attempt27AuthorizedGate =
  gates.includes("authority_mode: attempt27_bounded_mutation_authorized") &&
  gates.includes('result: "NOT_QUALIFIED_attempt27_authorized_preexecution"') &&
  gates.includes(
    'pending_proposal_sha256: "sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae"',
  );
const attempt27ClosedGate =
  gates.includes("authority_mode: none_attempt27_consumed") &&
  gates.includes('result: "NOT_QUALIFIED_attempt27_closed_warm_idle_failure"') &&
  gates.includes(
    'latest_closed_proposal_sha256: "sha256:5cb96aa79a4bb6f1fda3e6dadba7d6997421cc87cd2ed27f6a8ed92bee9fe7ae"',
  ) &&
  gates.includes(
    'latest_closed_authority_sha256: "sha256:3bf923fb59df2ab0a0ff648ad8773ed549b2296aba66e82db9635c9fa7b66b10"',
  ) &&
  gates.includes("pending_numeric_cap_usd: null");
const attempt28Gate = isAttempt28Gate(gates);

assert(hash(closureBytes) === expected.closure, "closure_hash");
assert(hash(authorityBytes) === expected.authority, "authority_hash");
assert(hash(proposalBytes) === expected.proposal, "proposal_hash");
assert(closure.result === "FAILED_POSTDISPATCH_COMPLETED_JOB_OUTPUT_CONTRACT_UNPROVEN_EXACT_CLEANUP_COMPLETE", "result");
assert(closure.authority_status === "CLOSED_EXACT_ATTEMPT_CONSUMED_DO_NOT_REUSE", "authority_closed");
assert(closure.failure?.provider_job_status === "COMPLETED", "provider_completed");
assert(closure.failure?.provider_execution_time_ms === 180546, "execution_time");
assert(closure.failure?.gpu_jobs_submitted === 1 && closure.failure?.accepted_batch_count === 0, "dispatch_boundary");
assert(closure.failure?.exact_rejected_output_contract_field === "UNPROVEN_REDACTION_SAFE_EVIDENCE_RETAINED_ONLY_GENERIC_CODE", "failure_field_unproven");
assert(closure.runpod_cleanup?.final_disposable_resources_absent === true, "cleanup");
assert(closure.runpod_cleanup?.pods === 0 && closure.runpod_cleanup?.endpoints === 0 && closure.runpod_cleanup?.private_templates === 0, "zero_resources");
assert(closure.runpod_cleanup?.active_serverless_workers === 0 && closure.runpod_cleanup?.running_pods === 0, "zero_compute");
assert(closure.runpod_cleanup?.retained_volumes?.length === 2, "retained_volumes");
assert(closure.billing?.attempt_increment_usd_settled === 0 && closure.billing?.settlement_state === "STABLE_THREE_READS", "billing");
assert(closure.cloudflare_cleanup?.signer_secret_deleted === true && closure.cloudflare_cleanup?.worker_version_restored === true, "cloudflare_cleanup");
assert(closure.output_cleanup?.generated_output_rollback === "CONFIRMED", "output_cleanup");
assert(closure.authority_closure?.proposal_reusable === false && closure.authority_closure?.fresh_numeric_cap_required === true, "fresh_authority");

for (const [label, value] of [
  ["state", state],
  ["gates", gates],
  ["task", task],
  ["start", start],
]) {
  assert(value.includes(expected.closure) && value.includes("failed-attempt-22.json"), `${label}_closure_pointer`);
  assert(value.includes(expected.proposal) && value.includes(expected.authority), `${label}_authority_lineage`);
}
assert(
  (state.includes("provider_calls_authorized: false") && state.includes("maximum_external_spend_usd: 0")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt23_authorized") && state.includes("maximum_external_spend_usd: 4")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt24_verification_stage_diagnostic_authorized") &&
      state.includes("maximum_external_spend_usd: 4")) ||
    (state.includes("phase: serverless_v2_v2_07_attempt25_startup_terminal_inventory_authorized") &&
      state.includes("maximum_external_spend_usd: 4")) ||
    attempt27AuthorizedState ||
    isAttempt28State(state),
  "state_closed",
);
assert(
  (gates.includes("none_attempt22_consumed") ||
    gates.includes("none_attempt23_pending_provider_free_candidate") ||
    gates.includes("attempt23_bounded_mutation_authorized") ||
    gates.includes("none_attempt23_consumed") ||
    gates.includes("none_attempt24_pending_provider_free_candidate") ||
    gates.includes("attempt24_bounded_mutation_authorized") ||
    gates.includes("none_attempt24_consumed") ||
    gates.includes("none_attempt25_pending_fresh_approval") ||
    gates.includes("attempt25_bounded_mutation_authorized") ||
    gates.includes("none_attempt25_consumed") ||
    gates.includes("none_attempt26_pending_fresh_approval") ||
    attempt26ClosedGate ||
    (attempt27CandidateGate || attempt27AuthorizedGate || attempt27ClosedGate || attempt28Gate)) &&
    (gates.includes("NOT_QUALIFIED_attempt22") || gates.includes("NOT_QUALIFIED_attempt23") || gates.includes("NOT_QUALIFIED_attempt24") || gates.includes("NOT_QUALIFIED_attempt25") || gates.includes("NOT_QUALIFIED_attempt26") || gates.includes("NOT_QUALIFIED_attempt27") || gates.includes("NOT_QUALIFIED_attempt28") || gates.includes("NOT_QUALIFIED_attempt29") || gates.includes("NOT_QUALIFIED_attempt30") || gates.includes("NOT_QUALIFIED_attempt25_authorized_pre_execution") || gates.includes("APPROVED_PREEXECUTION_attempt23")),
  "gate_open",
);
assert(
  activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") ||
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4") ||
    isAttempt28Activation(activation),
  "compiled_authority_closed",
);

process.stdout.write(`V2-07 Attempt22 closure validation PASS (${expected.closure}; one completed job rejected; zero disposable compute)\n`);
