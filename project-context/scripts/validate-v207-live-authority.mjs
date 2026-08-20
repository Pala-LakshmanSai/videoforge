import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const projectContextRoot = fileURLToPath(new URL("..", import.meta.url));
const proposalPath = `${projectContextRoot}/evidence/acceptance/VF-10-07/2026-08-20-provider-free-repair-handoff/combined-live-proposal.json`;
const authorityPath = `${projectContextRoot}/evidence/acceptance/VF-10-07/2026-08-20-live-qualification/authority.json`;

const [proposalBytes, authorityBytes] = await Promise.all([
  readFile(proposalPath),
  readFile(authorityPath),
]);
const proposal = JSON.parse(proposalBytes.toString("utf8"));
const authority = JSON.parse(authorityBytes.toString("utf8"));
const proposalSha256 = `sha256:${createHash("sha256").update(proposalBytes).digest("hex")}`;

const assert = (condition, message) => {
  if (!condition) throw new Error(`V207_LIVE_AUTHORITY_INVALID:${message}`);
};

assert(authority.schema_version === "videoforge.v2-07-live-authority/v1", "schema");
assert(authority.checkpoint === "V2-07" && authority.task_id === "VF-10-07", "checkpoint");
assert(authority.proposal.sha256 === proposalSha256, "proposal_hash");
assert(authority.approval.exact_proposal_approved === true, "proposal_approval");
assert(authority.approval.maximum_cumulative_finite_spend_usd === 4, "cap");
assert(authority.approval.historical_cap_reused === false, "historical_cap_reuse");
assert(authority.approval.recurring_retained_volume_charge_usd_per_month === 7, "retention_rate");
assert(authority.lineage.repaired_source_commit === proposal.lineage.repaired_source_commit, "source");
assert(authority.lineage.base_image_digest === proposal.lineage.base_image_digest, "base_image");
assert(authority.lineage.final_repaired_image_digest === null, "unpublished_digest");
assert(authority.lineage.model === proposal.lineage.model, "model");
assert(authority.lineage.model_manifest_sha256 === proposal.lineage.model_manifest_sha256, "manifest");
assert(authority.lineage.volume_id_sha256 === proposal.lineage.volume_id_sha256, "volume");
assert(authority.lineage.volume_size_gb === 50, "volume_size");
assert(authority.lineage.volume_region === "EU-RO-1", "region");
assert(authority.lineage.volume_mount === "/runpod-volume", "mount");
assert(authority.lineage.gpu === "NVIDIA GeForce RTX 4090", "gpu");
assert(
  JSON.stringify(authority.approved_operations) === JSON.stringify(proposal.qualification_operations),
  "operations",
);
assert(authority.rates_at_proposal.serverless_flex_rtx4090_usd_per_hour === 1.1, "rate");
assert(authority.rates_at_proposal.finite_variable_compute_estimate_usd === 2.2, "estimate");
assert(authority.status === "ACTIVE_PREPUBLICATION_PREFLIGHT", "status");

process.stdout.write("V2-07 live authority validation PASS\n");
