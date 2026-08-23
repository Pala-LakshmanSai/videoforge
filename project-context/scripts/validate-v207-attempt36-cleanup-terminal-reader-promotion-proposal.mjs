import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const dir = resolve(root, "project-context/evidence/acceptance/VF-10-07/2026-08-22-attempt36-cleanup-terminal-reader-promotion-candidate");
const expected = {
  proposal: "sha256:362427a13f16b9df3d80c33e26b461222a82bbc699b3e7bdeb84400e987c8262",
  acceptance: "sha256:8ed8dd91c0500ecdfeda6fae0d220f0616a0f7bb5fdfd5643310445dfc45b162",
  max1: "sha256:44d407385cf3614f5fdb874669f840e96f0f0479c24f8a3141e10bf0959515e3",
  max2: "sha256:910bd161419dc77a03763e7edfed81a5bade01725298061c3dacc2003f2ebbac",
  control: "f0e73c7d2e5961c8c0e72d4103457a680f4a97b4",
  priorProposal: "sha256:1df762844058f78db8171adcad3943ecfc03157c225070fcbc6506088169c87c",
  priorAuthority: "sha256:fc173408635e6af48f824188dad878cd6259526f407e655941848f092732ef37",
  priorClosure: "sha256:d0278822d001fe2639d47920f6923c565882bdbbf6ff11c174b30e72aba6d6fa",
  priorCleanup: "sha256:ab3c5d668c7d2817bd0a9b3e40dbeab6bd3623ae92e9439292d1d32662ba57e1",
};
const fail = (code) => { throw new Error(`V207_ATTEMPT36_PROPOSAL_${code}`); };
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
assert(proposal.attempt === 36 && proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" && proposal.provider_mutation === false && proposal.gpu_use === false && proposal.spend_usd === 0, "BOUNDARY");
assert(proposal.lineage.control_source_commit === expected.control && proposal.lineage.prior_proposal_sha256 === expected.priorProposal && proposal.lineage.prior_authority_sha256 === expected.priorAuthority && proposal.lineage.prior_closure_evidence_sha256 === expected.priorClosure && proposal.lineage.prior_cleanup_evidence_sha256 === expected.priorCleanup, "LINEAGE");
assert(proposal.lineage.model === "Comfy-Org/Mage-Flow@d8c99241f6fa80fbd453014234af2bf337ea21e6#int8-convrot" && proposal.lineage.volume_mount === "/runpod-volume" && proposal.lineage.volume_write_policy === "APPLICATION_READ_ONLY", "MODEL_VOLUME");
assert(proposal.cleanup_terminal_reader_promotion_repair?.same_owned_job_id_required === true && proposal.cleanup_terminal_reader_promotion_repair?.terminal_statuses_only === true && proposal.cleanup_terminal_reader_promotion_repair?.no_provider_redispatch === true && proposal.cleanup_terminal_reader_promotion_repair?.no_retry_of_run === true, "REPAIR");
assert(proposal.staged_endpoint_configs[0].definition_sha256 === expected.max1 && proposal.staged_endpoint_configs[1].definition_sha256 === expected.max2, "CONFIG_HASHES");
for (const [index, config] of configs.entries()) {
  assert(config.control_source_commit === expected.control && config.workers_min === 0 && config.workers_max === index + 1 && config.gpu_type_ids?.length === 1 && config.gpu_type_ids[0] === "NVIDIA GeForce RTX 4090" && config.compute_type === "GPU" && config.flex_only === true && config.flashboot === true, `CONFIG_${index}`);
  assert(config.network_volume_mount === "/runpod-volume" && config.volume_write_policy === "APPLICATION_READ_ONLY" && config.cleanup_terminal_reader_promotion_repair?.no_provider_redispatch === true, `CONFIG_SAFETY_${index}`);
}
assert(acceptance.result === "PROVIDER_FREE_CANDIDATE_AWAITING_FRESH_EXACT_APPROVAL_AND_NUMERIC_CAP" && acceptance.candidate.proposal_sha256 === expected.proposal && acceptance.candidate.authority_recorded === false && acceptance.candidate.maximum_cumulative_finite_spend_usd === null, "ACCEPTANCE");
const context = ["project-context/CURRENT_STATE.yaml", "project-context/GATES.yaml", "project-context/00_START_HERE.md", "project-context/tasks/VF-10-07.md", "apps/web/src/server/providers/v207-activation-authority.ts"].map((path) => String(readFileSync(resolve(root, path)))).join("\n");
for (const value of [expected.proposal, expected.acceptance, expected.max1, expected.max2, expected.control, expected.priorClosure, "V207_APPROVED_FINITE_CAP_USD: number | null = null", "V2-08"]) assert(context.includes(value), `CONTEXT_${value.slice(-8)}`);
console.log("V2-07 Attempt36 provider-free proposal validation PASS");
