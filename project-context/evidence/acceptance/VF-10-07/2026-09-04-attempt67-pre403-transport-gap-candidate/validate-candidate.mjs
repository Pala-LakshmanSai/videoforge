import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, "../../../../../");
const sha = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const bytes = (name) => readFile(path.join(directory, name));
const json = async (name) => JSON.parse(await bytes(name));
const yes = (value, code) => {
  if (!value) throw new Error(code);
};
const expectedFiles = [
  "acceptance.json",
  "approved-authority.json",
  "combined-live-proposal.json",
  "image-publication.json",
  "read-only-preflight.json",
  "staged-config-max1.json",
  "staged-config-max2.json",
  "validate-candidate.mjs",
];
yes(
  JSON.stringify((await readdir(directory)).sort()) === JSON.stringify(expectedFiles),
  "EXACT_FILE_SET",
);
const [proposal, acceptance, authority, publication, preflight, max1, max2] = await Promise.all([
  json("combined-live-proposal.json"),
  json("acceptance.json"),
  json("approved-authority.json"),
  json("image-publication.json"),
  json("read-only-preflight.json"),
  json("staged-config-max1.json"),
  json("staged-config-max2.json"),
]);
const control = "f870d40af0992752ebc70d540f0f74ed7bf1c1c6";
const imageSource = "095e1642562e4370c89425292428eb474ba190f1";
const image =
  "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a92e4345c111d60fc197cbc0fd3adf7d907a64d49547507fe68a089d5ed2247";
const proposalSha = "sha256:5c98649b60a6ad07507a2f5fc01c5501a011aed14f662f1126eab8fa7da4465b";
yes(sha(await bytes("combined-live-proposal.json")) === proposalSha, "PROPOSAL_HASH");
yes(proposal.attempt === 67 && proposal.control_source_commit === control, "CONTROL");
yes(proposal.image_source_commit === imageSource && proposal.image === image, "IMAGE");
yes(proposal.placement_and_cost.maximum_cumulative_finite_spend_usd === 4.5, "CAP");
yes(proposal.placement_and_cost.serverless_flex_usd_per_gpu_hour === 1.116, "RATE");
yes(proposal.placement_and_cost.gpu === "NVIDIA GeForce RTX 4090" && proposal.placement_and_cost.region === "EU-RO-1", "PLACEMENT");
yes(proposal.operation_contract.workers_min === 0 && proposal.operation_contract.workers_max_initial === 1 && proposal.operation_contract.workers_max_temporary === 2, "WORKERS");
yes(proposal.placement_and_cost.gpu_fallback === false && proposal.operation_contract.anchor_refresh_authorized === false && proposal.operation_contract.v2_08_authorized === false, "FORBIDDEN_SCOPE");
yes(max1.workers_min === 0 && max1.workers_max === 1 && max2.workers_max === 2 && max2.restore_workers_max_one === true, "CONFIGS");
yes(publication.reuses_existing_immutable_image === true && publication.publication_action_required === false, "PUBLICATION");
yes(preflight.fresh_inventory_catalog_billing_read_required_before_mutation === true && preflight.endpoints === 0 && preflight.pods === 0, "PREFLIGHT");
yes(acceptance.status === "APPROVED_SEALED_AWAITING_EXECUTION" && acceptance.proposal_sha256 === proposalSha, "ACCEPTANCE");
yes(acceptance.authority.exact_approval_recorded === true && acceptance.authority.fresh_exact_approval_required === false && acceptance.authority.provider_mutations_authorized === true && acceptance.authority.gpu_use_authorized === true && acceptance.authority.v2_08_authorized === false, "AUTHORITY_APPROVED");
yes(authority.status === "APPROVED_SINGLE_USE_UNCONSUMED" && authority.attempt === 67 && authority.control_source_commit === control && authority.image_source_commit === imageSource && authority.image === image, "AUTHORITY_IDENTITY");
yes(authority.proposal_sha256 === proposalSha && authority.acceptance_sha256 === "sha256:48f417029afe64e0cdead4502f2b2f8b4ff46b190fb6219a30dfa991c05a23ab", "AUTHORITY_LINEAGE");
yes(authority.maximum_cumulative_finite_spend_usd === 4.5 && authority.serverless_flex_usd_per_gpu_hour === 1.116 && authority.gpu === "NVIDIA GeForce RTX 4090" && authority.region === "EU-RO-1" && authority.workers_min === 0 && authority.workers_max_initial === 1 && authority.workers_max_temporary === 2, "AUTHORITY_COST_WORKERS");
yes(authority.automatic_gpu_fallback_authorized === false && authority.anchor_refresh_authorized === false && authority.retained_volume_charge_usd_per_month === 7 && authority.retained_volume_mutation_authorized === false && authority.final_zero_compute_disposable_reconciliation_reads === 3 && authority.v2_08_authorized === false && authority.single_use === true, "AUTHORITY_SCOPE");
yes(JSON.stringify(authority.success_cleanup_required) === JSON.stringify(["generated_outputs", "endpoint", "template", "signer", "temporary_route"]), "AUTHORITY_CLEANUP");
for (const [name, expected] of Object.entries(proposal.source_hashes)) {
  const sources = {
    qualification: "apps/web/src/server/providers/v207-live-qualification.ts",
    harness: "apps/web/src/server/providers/runpod-v207-qualification-harness.ts",
    reconciliation: "apps/web/src/server/providers/runpod-v207-readonly-reconciliation.ts",
    orchestrator: "apps/web/src/server/providers/v207-live-orchestrator.ts",
  };
  yes(sha(await readFile(path.join(root, sources[name]))) === expected, `SOURCE_${name}`);
}
const activation = await readFile(
  path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"),
  "utf8",
);
yes(activation.includes(proposalSha), "PROPOSAL_BINDING");
yes(activation.includes("sha256:e89fbe293238d6e6719efac9c7c813e4be5ce484013487453a51e9efed2dd77d"), "AUTHORITY_BINDING");
yes(/V207_APPROVED_FINITE_CAP_USD: number \| null = 4\.5;/u.test(activation), "CAP_BINDING");
yes(/V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null = false;/u.test(activation), "ANCHOR_BINDING");
yes(sha(await bytes("acceptance.json")) === authority.acceptance_sha256, "ACCEPTANCE_HASH");
yes(sha(await bytes("approved-authority.json")) === "sha256:e89fbe293238d6e6719efac9c7c813e4be5ce484013487453a51e9efed2dd77d", "AUTHORITY_HASH");
process.stdout.write("PASS validate-v207-attempt67-pre403-transport-gap-candidate\n");
