import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt35-low-availability-candidate");
const expected = Object.freeze({
  proposal: "sha256:1df762844058f78db8171adcad3943ecfc03157c225070fcbc6506088169c87c",
  acceptance: "sha256:fa701d3ef9f5619c585c6fc964007f660f19d5c92a3912d9af49e5d05bf7277d",
  authority: "sha256:fc173408635e6af48f824188dad878cd6259526f407e655941848f092732ef37",
  max1: "sha256:d31a518831b9a978295047310800a34eaf81ed56dde58eea46918dc581563ca2",
  max2: "sha256:11665ee88f09c6cbe498026cacd8505b0fe02ee7f19ac8b4d3f68aa534f3435c",
  priorProposal: "sha256:83cebe85da4a60862ccf981b72cec9bc8ae6673a3757852d0c63b93c2f38ae12",
  priorAuthority: "sha256:3157147f85ecea86b6d01ce489dbfff2dc0d7bc51a833749d96a9cecd99314ff",
  priorClosure: "sha256:cf207d45228bf2754803ce56187129dde229b0abdbeb1bd834e7e83dad34b980",
  control: "96f5e16cf03be7e31049478ce7f6b0c134a8108c",
});
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const assert = (value, code) => { if (!value) throw new Error(`V207_ATTEMPT35_PROPOSAL_INVALID:${code}`); };
const paths = {
  proposal: resolve(dir, "combined-live-proposal.json"), acceptance: resolve(dir, "acceptance.json"),
  authority: resolve(dir, "approved-authority.json"),
  max1: resolve(dir, "staged-config-max1.json"), max2: resolve(dir, "staged-config-max2.json"),
  closure: resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-21-live-qualification/blocked-attempt-34-capacity-drift.json"),
};
const bytes = Object.fromEntries(await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(path)])));
for (const key of ["proposal", "acceptance", "authority", "max1", "max2"]) assert(sha(bytes[key]) === expected[key], `${key.toUpperCase()}_HASH`);
assert(sha(bytes.closure) === expected.priorClosure, "CLOSURE_HASH");
const proposal = JSON.parse(bytes.proposal);
const acceptance = JSON.parse(bytes.acceptance);
const authority = JSON.parse(bytes.authority);
const closure = JSON.parse(bytes.closure);
assert(proposal.attempt === 35 && proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" && proposal.provider_mutation === false && proposal.gpu_use === false && proposal.spend_usd === 0, "SCOPE");
assert(proposal.lineage?.control_source_commit === expected.control && proposal.lineage?.prior_attempt === 34 && proposal.lineage?.prior_proposal_sha256 === expected.priorProposal && proposal.lineage?.prior_authority_sha256 === expected.priorAuthority && proposal.lineage?.prior_closure_evidence_sha256 === expected.priorClosure, "LINEAGE");
assert(proposal.user_approval?.minimum_approved_availability_requested === "LOW" && proposal.user_approval?.observed_availability === "LOW" && proposal.user_approval?.maximum_cumulative_finite_spend_usd === null, "APPROVAL_BOUNDARY");
assert(proposal.rates_cost_and_retention?.availability_threshold === "LOW_OR_BETTER" && proposal.rates_cost_and_retention?.current_rtx4090_eu_ro_1_availability === "LOW" && proposal.rates_cost_and_retention?.maximum_cumulative_finite_spend_usd === null, "AVAILABILITY_COST");
assert(proposal.staged_endpoint_configs?.[0]?.definition_sha256 === expected.max1 && proposal.staged_endpoint_configs?.[1]?.definition_sha256 === expected.max2, "CONFIGS");
assert(closure.result === "NOT_QUALIFIED_PREEXECUTION_CAPACITY_DRIFT" && closure.provider_boundary?.runpod_mutations === 0 && closure.provider_boundary?.gpu_jobs === 0 && closure.provider_boundary?.external_spend_usd === 0 && closure.authority_state === "CLOSED_PREEXECUTION_CAPACITY_DRIFT_DO_NOT_REUSE", "PRIOR_CLOSURE");
assert(acceptance.attempt === 35 && acceptance.result === "APPROVED_SINGLE_USE_PENDING_EXECUTION" && acceptance.candidate?.proposal_sha256 === expected.proposal && acceptance.candidate?.authority_recorded === true && acceptance.candidate?.authority_sha256 === expected.authority && acceptance.candidate?.maximum_cumulative_finite_spend_usd === 4 && acceptance.provider_boundary?.authority_active === true && acceptance.provider_boundary?.cap_usd === 4 && acceptance.provider_boundary?.external_spend_usd === 0, "ACCEPTANCE");
assert(authority.attempt === 35 && authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" && authority.proposal?.sha256 === expected.proposal && authority.approval?.exact_proposal_approved === true && authority.approval?.flashboot_true_accepted === true && authority.approval?.low_or_better_eu_ro_1_availability_approved === true && authority.approval?.minimum_approved_availability === "LOW" && authority.approval?.maximum_cumulative_finite_spend_usd === 4 && authority.lineage?.control_source_commit === expected.control && authority.lineage?.initial_config_sha256 === expected.max1 && authority.lineage?.concurrent_reader_config_sha256 === expected.max2 && authority.execution_boundary?.retained_volume_mutation_authorized === false && authority.execution_boundary?.v2_08_authorized === false, "AUTHORITY");
const context = (await Promise.all(["project-context/CURRENT_STATE.yaml", "project-context/GATES.yaml", "project-context/00_START_HERE.md", "project-context/tasks/VF-10-07.md", "apps/web/src/server/providers/v207-activation-authority.ts"].map((path) => readFile(resolve(root, path), "utf8")))).join("\n");
for (const value of [expected.proposal, expected.acceptance, expected.authority, expected.max1, expected.max2, expected.priorAuthority, expected.priorClosure, "V207_APPROVED_FINITE_CAP_USD: number | null = null", "no_live_authority_attempt35_consumed", "V2-08"]) assert(context.includes(value), `CONTEXT_${value.slice(-8)}`);
process.stdout.write("V2-07 Attempt35 LOW-availability historical authority validation PASS (consumed)\n");
