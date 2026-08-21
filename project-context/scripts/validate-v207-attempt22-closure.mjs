import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

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
      state.includes("maximum_external_spend_usd: 4")),
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
    gates.includes("none_attempt25_pending_fresh_approval")) &&
    (gates.includes("NOT_QUALIFIED_attempt22") || gates.includes("NOT_QUALIFIED_attempt23") || gates.includes("NOT_QUALIFIED_attempt24") || gates.includes("NOT_QUALIFIED_attempt25") || gates.includes("APPROVED_PREEXECUTION_attempt23")),
  "gate_open",
);
assert(
  activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null") ||
    activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = 4"),
  "compiled_authority_closed",
);

process.stdout.write(`V2-07 Attempt22 closure validation PASS (${expected.closure}; one completed job rejected; zero disposable compute)\n`);
