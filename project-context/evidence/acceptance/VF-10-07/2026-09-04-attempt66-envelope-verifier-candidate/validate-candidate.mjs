import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const files = [
  "image-publication.json",
  "read-only-preflight.json",
  "staged-config-max1.json",
  "staged-config-max2.json",
  "combined-live-proposal.json",
  "acceptance.json",
  "approved-authority.json",
  "validate-candidate.mjs",
];
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const bytes = (name) => readFile(path.join(dir, name));
const json = async (name) => JSON.parse(await bytes(name));
const yes = (value, code) => {
  if (!value) throw new Error(code);
};
const [entries, publication, preflight, max1, max2, proposal, acceptance, authority] = await Promise.all([
  readdir(dir),
  json("image-publication.json"),
  json("read-only-preflight.json"),
  json("staged-config-max1.json"),
  json("staged-config-max2.json"),
  json("combined-live-proposal.json"),
  json("acceptance.json"),
  json("approved-authority.json"),
]);
yes(JSON.stringify([...entries].sort()) === JSON.stringify([...files].sort()), "EXACT_FILE_SET");
const image = "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:8a92e4345c111d60fc197cbc0fd3adf7d907a64d49547507fe68a089d5ed2247";
const source = "095e1642562e4370c89425292428eb474ba190f1";
const control = "11a0eb6b07f6ab8584190d5d9a79a33b7cc21ba7";
const runners = ["7b980ec5bfe7da7491340f20547dac4e9d542afb", "b22c2cd704f67be4900b4f4072de67700faa68b4"];
yes(publication.attempt === 66 && publication.image.immutable === image, "IMAGE_IDENTITY");
yes(publication.workflow.run_id === 33841048200, "WORKFLOW_RUN");
yes(publication.workflow.artifact_sha256 === "sha256:c19d1b949e7cf15f474a4bf36434275eb0986384c643d84145438da982c31e04", "ARTIFACT_HASH");
yes(publication.workflow.source_commit === source && publication.image.source_commit === source, "IMAGE_SOURCE");
yes(publication.image.config_sha256 === "sha256:af05d38128fc75d14aefc4856e661e28e7369f7df90c90beb2875c569605c436", "IMAGE_CONFIG");
yes(publication.image.layer_sha256 === "sha256:e28e45eee00f52ccd5d1d9ff8d5a432a757c91ad4fdd7687cd6defb9a62c9112", "IMAGE_LAYER");
yes(publication.image.layer_diff_id === "sha256:885b0adf0c57ab1e27553e58297a8f261dab8f60db668acb6376d12b2d5848e2", "IMAGE_DIFF_ID");
yes(publication.image.handler_sha256 === "sha256:e61786748d321124ab39267622ccb647f614e8fac0d560d2e72c6d2a158b528d", "HANDLER_HASH");
yes(publication.image.envelope_sha256 === "sha256:34949be02521ec896c27794ad382cfa4d2bd6f1b799615716a5dc2b9ce2e41d0", "ENVELOPE_HASH");
yes(publication.image.schema_sha256 === "sha256:08fd73862b7d79f685dfaf1b72dd6b1e41468f3f581ad766ffea1f85c9dbf66f", "SCHEMA_HASH");
yes(publication.lineage.control_head === control && JSON.stringify(publication.lineage.clean_runner_commits) === JSON.stringify(runners), "CONTROL_LINEAGE");
yes(preflight.attempt === 66 && preflight.checked_at === "2026-09-04T06:44:00.894Z", "PREFLIGHT_TIME");
yes(preflight.runpod.pods === 0 && preflight.runpod.endpoints === 0 && preflight.runpod.private_templates === 0 && preflight.runpod.active_serverless_workers === 0 && preflight.runpod.running_pods === 0, "PREFLIGHT_ZERO");
yes(preflight.runpod.stable_read_count === 3 && preflight.runpod.billing_baseline_usd === 2.214659276913153 && preflight.runpod.billing_final_usd === 2.214659276913153 && preflight.runpod.billing_incremental_usd === 0, "PREFLIGHT_SETTLED");
yes(preflight.runpod.retained_volumes.length === 2 && preflight.preflight_contract.fresh_inventory_and_catalog_required_before_mutation === true, "PREFLIGHT_VOLUMES_REFRESH");
yes(preflight.placement.region === "EU-RO-1" && preflight.placement.gpu === "NVIDIA GeForce RTX 4090" && preflight.placement.rate_usd_per_gpu_hour === 1.116 && preflight.placement.workers_min === 0 && preflight.placement.workers_max_initial === 1 && preflight.placement.workers_max_temporary === 2 && preflight.placement.gpu_fallback === false, "PLACEMENT");
for (const [config, workers] of [[max1, 1], [max2, 2]]) {
  yes(config.attempt === 66 && config.workers_min === 0 && config.workers_max === workers && config.gpu === "NVIDIA GeForce RTX 4090" && config.region === "EU-RO-1" && config.cleanup.delete_generated_outputs === true && config.cleanup.delete_endpoint === true && config.cleanup.delete_template === true, `CONFIG_${workers}`);
}
yes(max2.cleanup.restore_max_one === true && max2.anchor_refresh === false && max2.v2_08 === false, "MAX2_RESTORE_SCOPE");
yes(proposal.attempt === 66 && proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL" && proposal.placement_and_cost.maximum_cumulative_finite_spend_usd === 4.5 && proposal.placement_and_cost.serverless_flex_usd_per_gpu_hour === 1.116 && proposal.operation_contract.anchor_refresh_authorized === false && proposal.operation_contract.v2_08_authorized === false, "PROPOSAL_SCOPE");
yes(proposal.control_lineage.control_head === control && JSON.stringify(proposal.control_lineage.runner_commits) === JSON.stringify(runners), "PROPOSAL_CONTROL");
yes(acceptance.status === "APPROVED_SEALED_AWAITING_EXECUTION" && acceptance.authority.exact_approval_recorded === true && acceptance.authority.fresh_exact_approval_required === false && acceptance.authority.provider_mutations_authorized === true && acceptance.authority.gpu_use_authorized === true && acceptance.authority.v2_08_authorized === false, "ACCEPTANCE_APPROVED");
yes(acceptance.authority.requested_maximum_cumulative_finite_spend_usd === 4.5 && acceptance.authority.serverless_flex_usd_per_gpu_hour === 1.116 && acceptance.cleanup_contract.final_zero_compute_disposable_reconciliation_reads === 3, "ACCEPTANCE_COST_CLEANUP");
yes(authority.attempt === 66 && authority.status === "APPROVED_SINGLE_USE_UNCONSUMED" && authority.control_source_commit === control && authority.image_source_commit === source && authority.image === image, "AUTHORITY_IDENTITY");
yes(authority.proposal_sha256 === "sha256:a90c44b9b2cf37383c15c633f7de19dd2b6fbbe1b17abffd227d79a09a95c3f8" && authority.acceptance_sha256 === "sha256:a9cbaffbf7f46c4b56e231618b339c6c08386c5b28ba23d5a15bae112a023a73", "AUTHORITY_LINEAGE");
yes(authority.maximum_cumulative_finite_spend_usd === 4.5 && authority.serverless_flex_usd_per_gpu_hour === 1.116 && authority.gpu === "NVIDIA GeForce RTX 4090" && authority.region === "EU-RO-1", "AUTHORITY_COST_PLACEMENT");
yes(authority.workers_min === 0 && authority.workers_max_initial === 1 && authority.workers_max_temporary === 2 && authority.automatic_gpu_fallback_authorized === false, "AUTHORITY_WORKERS");
yes(authority.anchor_refresh_authorized === false && authority.retained_volume_charge_usd_per_month === 7 && authority.retained_volume_mutation_authorized === false && authority.final_zero_compute_disposable_reconciliation_reads === 3 && authority.v2_08_authorized === false && authority.single_use === true, "AUTHORITY_SCOPE");
yes(JSON.stringify(authority.success_cleanup_required) === JSON.stringify(["generated_outputs", "endpoint", "template", "signer", "temporary_route"]), "AUTHORITY_CLEANUP");
const serialized = JSON.stringify({ publication, preflight, max1, max2, proposal, acceptance, authority });
yes(!/(?:seed|resume|retained_disposable)/iu.test(serialized), "REMOVED_LEGACY_PATHS");
const activation = await readFile(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8");
yes(activation.includes("sha256:a90c44b9b2cf37383c15c633f7de19dd2b6fbbe1b17abffd227d79a09a95c3f8"), "PROPOSAL_BINDING");
yes(/V207_APPROVED_AUTHORITY_SHA256: string \| null = null;/u.test(activation), "AUTHORITY_CLOSED");
yes(/V207_APPROVED_FINITE_CAP_USD: number \| null = null;/u.test(activation), "CAP_CLOSED");
yes(/V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null = null;/u.test(activation), "ANCHOR_CLOSED");
for (const name of files.slice(0, -1)) yes((await bytes(name)).length > 0, `NONEMPTY_${name}`);
yes(sha(await bytes("combined-live-proposal.json")) === acceptance.proposal_sha256, "PROPOSAL_HASH");
yes(sha(await bytes("read-only-preflight.json")) === acceptance.preflight_sha256, "PREFLIGHT_HASH");
yes(sha(await bytes("staged-config-max1.json")) === acceptance.max1_sha256, "MAX1_HASH");
yes(sha(await bytes("staged-config-max2.json")) === acceptance.max2_sha256, "MAX2_HASH");
yes(sha(await bytes("acceptance.json")) === authority.acceptance_sha256, "ACCEPTANCE_HASH");
yes(sha(await bytes("approved-authority.json")) === "sha256:6ec529ed633f28b54a8d5649d7aa2c68ca8f32b2bf5898db6de0261f917f39fd", "AUTHORITY_HASH");
process.stdout.write("PASS validate-v207-attempt66-envelope-verifier-candidate\n");
