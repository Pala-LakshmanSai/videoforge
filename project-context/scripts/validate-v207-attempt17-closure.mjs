import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const evidencePath = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/failed-attempt-17.json",
);
const authorityPath = resolve(
  root,
  "project-context/evidence/acceptance/VF-10-07/2026-08-20-template-identity-requalification-candidate/approved-authority.json",
);
const [evidenceText, authorityBytes, state, gate, task, activation, control] = await Promise.all([
  readFile(evidencePath, "utf8"),
  readFile(authorityPath),
  readFile(resolve(root, "project-context/CURRENT_STATE.yaml"), "utf8"),
  readFile(resolve(root, "project-context/GATES.yaml"), "utf8"),
  readFile(resolve(root, "project-context/tasks/VF-10-07.md"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
  readFile(resolve(root, "apps/web/src/server/providers/runpod-control.ts"), "utf8"),
]);
const evidence = JSON.parse(evidenceText);
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const assert = (condition, label) => {
  if (!condition) throw new Error(`V207_ATTEMPT17_CLOSURE_INVALID:${label}`);
};

assert(evidence.attempt === 17, "attempt");
assert(evidence.qualification_boundaries?.v2_07 === "NOT_QUALIFIED", "checkpoint_open");
assert(evidence.qualification_boundaries?.v2_08_authorized === false, "v2_08_forbidden");
assert(evidence.stop_reason?.job_dispatch_reached === false, "no_dispatch");
assert(evidence.stop_reason?.gpu_job_started === false, "no_gpu_job");
assert(evidence.stop_reason?.batch_count === 0, "no_batch");
assert(evidence.billing?.attempt_increment_usd_settled === 0, "zero_spend");
assert(evidence.billing?.settlement_state === "STABLE_THREE_READS", "billing_settlement");
assert(evidence.runpod_cleanup?.pods === 0, "zero_pods");
assert(evidence.runpod_cleanup?.endpoints === 0, "zero_endpoints");
assert(evidence.runpod_cleanup?.private_templates === 0, "zero_templates");
assert(evidence.runpod_cleanup?.active_serverless_workers === 0, "zero_workers");
assert(evidence.runpod_cleanup?.network_volumes === 2, "two_volumes");
assert(evidence.cloudflare_cleanup?.route_restoration === "CONFIRMED", "route_restored");
assert(evidence.authority_closure?.fresh_proposal_required === true, "fresh_proposal");
assert(evidence.authority_closure?.fresh_cap_required === true, "fresh_cap");
assert(evidence.approved_authority?.sha256 === hash(authorityBytes), "authority_hash");
assert(
  state.includes("failed-attempt-17.json") &&
    state.includes("provider_calls_authorized: false") &&
    state.includes("cap_usd: 0"),
  "current_state_closed",
);
assert(gate.includes("failed-attempt-17.json"), "gate_pointer");
assert(task.includes("Attempt 17 — endpoint PATCH schema failure"), "task_handoff");
assert(
  activation.includes("V207_APPROVED_FINITE_CAP_USD: number | null = null"),
  "compiled_authority_closed",
);
const bindMethod = control.slice(
  control.indexOf("async bindV207EndpointIdentity("),
  control.indexOf("async createNetworkVolume("),
);
assert(bindMethod.length > 0, "bind_method_present");
assert(!bindMethod.includes('computeType: "GPU"'), "patch_compute_type_absent");
assert(bindMethod.includes('this.mutate("PATCH"'), "patch_present");

process.stdout.write("V2-07 Attempt 17 closure validation PASS\n");
