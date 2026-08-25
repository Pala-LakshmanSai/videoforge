import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:6693da1e345ce579ea9c7896b238e3f8bd44fcd2abee92d8e46650436c80d4c0",
  authority: "sha256:18b78f0611052937ecb53535e6efdca34eab42a43227e3729b88eb7805ca5ebb",
  acceptance: "sha256:a4696155bb9fd2f7087aed116ae19d7cf5b22e9a0893b8dd343aa8b0d0d9a5b3",
  preflight: "sha256:60f4c7587144ec98abcde4a3b6ca84546b44db28439215416cea62b17248b7a7",
  max1: "sha256:8252181cc2dec27f5303f3e2cc18cd0f8a95f99d2f28948981889be77d0206de",
  max2: "sha256:ae93148b3f4f8680295e7a37bf18779b73d35cbdbc618efe0050851e65b6c478",
  orchestrator: "sha256:ababaea25cca2e5406d669b26d8c2a267247d0a1b8f3726bf0c8327c0cdb8400",
  qualification: "sha256:3ed15af77a48436b9864a29a03cf7a80f1d6cd4daf0ab10d2372d74f67598d43",
  harness: "sha256:7995f0519d61538633b005c529835b7c3864bb4378fd6a3aa010e1e67947b233",
  canonicalActivation: "sha256:3569bc480f2084a9d04a94b8b47507cc8f4e6183a67308aa9039c2b485108323",
  version: "sha256:1d830477cfdc2d91240f1226bc3556ec73067018f115b06dcc7fc4137fe9028f",
  record: "sha256:05054aeac4e1f20213f873463f29a19da3910ad674a65c59f13d04b0cb601b50",
  anchorCommit: "74fbe8d81bc1670065e5a08a19f1d449cb94471f",
  controlRepair: "42a5a522402e71aef1cee9b714e4cb54c571ceb3",
  readbackRepair: "61919013c74f71995cf1631ce6ac56e633708dce",
  preRouteRepair: "42a5a522402e71aef1cee9b714e4cb54c571ceb3",
  preRouteTest: "sha256:9c5e4057089eea350d7c3dea184216f75ec1812870ba5e2147e44b69dd0e5136",
  postCancelRepair: "8bb6583012569e595630deb3d7fe104a923dcc58",
  postCancelTest: "sha256:5c44885d23b563c8d33e1b5227657112cfdbe73d265245c57745c28b5607fd10",
  billingBaseline: 1.9971928337181453,
  closure: "sha256:2cc0c249826356f69e507589fd74893f16dace1a27ba281ae1b17030cc100bdf",
  consumedAuthority: "sha256:1999d19e9538e98213339e023d68505c4b4b69cfebb413692ac306495a9c388f",
  reconciliation: "sha256:d012e06b2af2794992b2e61e72e05f4dcf20c400304934a1d08147185aeb3cc4",
};
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const yes = (value, code) => {
  if (!value) throw new Error(code);
};
const json = async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"));
const fileSha = async (name) => sha(await readFile(path.join(dir, name)));
const rootBytes = async (name) => readFile(path.join(root, name));
const rootSha = async (name) => sha(await rootBytes(name));

const [proposal, authority, preflight, max1, max2, acceptance, activation, orchestrator] = await Promise.all([
  json("combined-live-proposal.json"),
  json("approved-authority.json"),
  json("read-only-preflight.json"),
  json("staged-config-max1.json"),
  json("staged-config-max2.json"),
  json("acceptance.json"),
  rootBytes("apps/web/src/server/providers/v207-activation-authority.ts").then(String),
  rootBytes("apps/web/src/server/providers/v207-live-orchestrator.ts").then(String),
]);
yes((await fileSha("combined-live-proposal.json")) === expected.proposal, "PROPOSAL_HASH");
yes((await fileSha("approved-authority.json")) === expected.authority, "AUTHORITY_HASH");
yes((await fileSha("acceptance.json")) === expected.acceptance, "ACCEPTANCE_HASH");
yes((await fileSha("read-only-preflight.json")) === expected.preflight, "PREFLIGHT_HASH");
yes((await fileSha("staged-config-max1.json")) === expected.max1, "MAX1_HASH");
yes((await fileSha("staged-config-max2.json")) === expected.max2, "MAX2_HASH");
yes(
  (await rootSha("apps/web/src/server/providers/v207-live-orchestrator.ts")) === expected.orchestrator &&
    (await rootSha("apps/web/src/server/providers/v207-live-qualification.ts")) === expected.qualification &&
    (await rootSha("apps/web/src/server/providers/runpod-v207-qualification-harness.ts")) === expected.harness,
  "SOURCE_HASH",
);
yes(proposal.attempt === 61 && proposal.qualification_status === "NOT_QUALIFIED", "PROPOSAL_SCOPE");
yes(
  proposal.authority_mode === "PENDING_FRESH_EXACT_APPROVAL_AND_POSITIVE_NUMERIC_CAP" &&
    proposal.provider_calls_authorized === false &&
    proposal.provider_mutation_authorized === false &&
    proposal.gpu_use_authorized === false &&
    proposal.v2_08_authorized === false,
  "PROPOSAL_AUTHORITY",
);
yes(
  proposal.approval_request.requested_maximum_cumulative_finite_spend_usd === 4 &&
    proposal.approval_request.executable_cap_binding === null &&
    proposal.approval_request.anchor_refresh_authorized === null &&
    proposal.approval_request.flashboot === true &&
    proposal.approval_request.minimum_availability === "LOW-or-better" &&
    proposal.approval_request.continued_retention_of_two_existing_volumes_at_usd_per_month === 7,
  "APPROVAL_REQUEST",
);
yes(
  proposal.post_cancel_terminal_inventory_repair_contract.repair_commit === expected.postCancelRepair &&
    proposal.post_cancel_terminal_inventory_repair_contract.test_sha256 === expected.postCancelTest &&
    proposal.post_cancel_terminal_inventory_repair_contract.owned_jobs_must_be_zero === true &&
    proposal.post_cancel_terminal_inventory_repair_contract.two_identical_terminal_inventory_snapshots_required === true &&
    proposal.post_cancel_terminal_inventory_repair_contract.redispatch === false,
  "POST_CANCEL_REPAIR",
);
yes(
  proposal.provider_free_lineage.pre_route_transport_gap_repair_commit === expected.preRouteRepair &&
    proposal.provider_free_lineage.pre_route_transport_gap_repair_test_sha256 === expected.preRouteTest &&
    proposal.provider_free_lineage.control_source_commit === expected.controlRepair,
  "PRE_ROUTE_REPAIR",
);
yes(
  preflight.attempt === 61 &&
    preflight.fresh_provider_read === true &&
    preflight.provider_mutations === 0 &&
    preflight.gpu_jobs_submitted === 0 &&
    preflight.runpod.pods === 0 &&
    preflight.runpod.endpoints === 0 &&
    preflight.runpod.private_templates === 0 &&
    preflight.runpod.active_serverless_workers === 0 &&
    preflight.runpod.running_pods === 0 &&
    preflight.runpod.retained_volume_count === 2 &&
    preflight.runpod.baseline_endpoint_spend_usd === expected.billingBaseline &&
    preflight.runpod.selected_gpu.availability === "MEDIUM" &&
    preflight.runpod.selected_gpu.serverless_flex_published_rate_usd_per_gpu_hour === 1.1 &&
    preflight.local_disk_headroom.exact_gate_satisfied === true &&
    preflight.local_disk_headroom.available_bytes >= preflight.local_disk_headroom.required_minimum_bytes &&
    preflight.cloudflare.active_version_id_sha256 === expected.version &&
    preflight.cloudflare.active_record_sha256 === expected.record &&
    preflight.cloudflare.fresh_provider_read === true &&
    preflight.must_reconfirm_provider_inventory_capacity_rates_anchor_route_config_and_billing_after_approval_before_mutation === true &&
    preflight.attempt60_clean_closure.closure_sha256 === expected.closure &&
    preflight.attempt60_clean_closure.consumed_authority_sha256 === expected.consumedAuthority &&
    preflight.attempt60_clean_closure.reconciliation_sha256 === expected.reconciliation,
  "PREFLIGHT_TRUTH",
);
for (const [config, workers] of [[max1, 1], [max2, 2]]) {
  yes(
    config.region === "EU-RO-1" &&
      config.workers_min === 0 &&
      config.workers_max === workers &&
      config.flashboot === true &&
      config.candidate_attempt === 61 &&
      config.network_volume_mount === "/runpod-volume" &&
      config.post_cancel_terminal_inventory_repair_commit === expected.postCancelRepair &&
      config.post_cancel_terminal_inventory_repair_test_sha256 === expected.postCancelTest &&
      config.pre_route_transport_gap_repair_commit === expected.preRouteRepair &&
      config.pre_route_transport_gap_repair_test_sha256 === expected.preRouteTest &&
      config.source_hashes.canonical_activation_sha256 === expected.canonicalActivation &&
      config.cloudflare_anchor_refresh_contract.expected_old_active_version_id_sha256 === expected.version &&
      config.cloudflare_anchor_refresh_contract.expected_old_active_record_sha256 === expected.record,
    `CONFIG_${workers}`,
  );
}
yes(
  acceptance.attempt === 61 &&
    acceptance.proposal_sha256 === expected.proposal &&
    acceptance.preflight_sha256 === expected.preflight &&
    acceptance.max1_sha256 === expected.max1 &&
    acceptance.max2_sha256 === expected.max2 &&
    acceptance.authority.maximum_cumulative_finite_spend_usd === null &&
    acceptance.authority.v2_08_authorized === false,
  "ACCEPTANCE",
);
yes(activation.includes(`"${expected.proposal}" as const`), "ACTIVATION_PROPOSAL_POINTER");
yes(activation.includes(`"${expected.controlRepair}" as const`), "ACTIVATION_CONTROL_SOURCE");
yes(/V207_APPROVED_AUTHORITY_SHA256: string \| null = null;/u.test(activation), "AUTHORITY_NULL");
yes(/V207_APPROVED_FINITE_CAP_USD: number \| null = null;/u.test(activation), "CAP_NULL");
yes(/V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null = null;/u.test(activation), "REFRESH_NULL");
const canonical = activation
  .replace(/^export\s+const\s+V207_PENDING_PROPOSAL_SHA256\s*=\s*"sha256:[a-f0-9]{64}"\s+as\s+const\s*;/mu, `export const V207_PENDING_PROPOSAL_SHA256 = "sha256:${"0".repeat(64)}" as const;`)
  .replace(/^export\s+const\s+V207_APPROVED_AUTHORITY_SHA256\s*:\s*string\s*\|\s*null\s*=\s*(?:"sha256:[a-f0-9]{64}"|null)\s*;/mu, "export const V207_APPROVED_AUTHORITY_SHA256: string | null = null;")
  .replace(/^export\s+const\s+V207_APPROVED_FINITE_CAP_USD\s*:\s*number\s*\|\s*null\s*=\s*(?:null|(?:0|[1-9]\d*)(?:\.\d+)?)\s*;/mu, "export const V207_APPROVED_FINITE_CAP_USD: number | null = null;")
  .replace(/^export\s+const\s+V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED\s*:\s*boolean\s*\|\s*null\s*=\s*(?:true|false|null)\s*;/mu, "export const V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean | null = null;");
yes(sha(canonical) === expected.canonicalActivation, "CANONICAL_ACTIVATION_HASH");
yes(orchestrator.includes(`"${expected.version}" as const`) && orchestrator.includes(`"${expected.record}" as const`), "ANCHOR_CONSTANTS");
let authorityExists = true;
try {
  await access(path.join(dir, "approved-authority.json"));
} catch {
  authorityExists = false;
}
yes(authorityExists === true, "AUTHORITY_FILE_REQUIRED");
yes(
  authority.attempt === 61 &&
    authority.status === "CONSUMED_NON_REUSABLE_ATTEMPT61_PROCESS_REPLACEMENT_IDENTITY_NOT_DISTINCT" &&
    authority.proposal.sha256 === expected.proposal &&
    authority.acceptance.sha256 === expected.acceptance &&
    authority.approval.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval.flashboot_true_accepted === true &&
    authority.approval.low_or_better_eu_ro_1_availability_approved === true &&
    authority.approval.anchor_refresh_authorized === false &&
    authority.approval.consumed === true &&
    authority.execution_boundary.v2_08_authorized === false,
  "AUTHORITY_CONTRACT",
);
process.stdout.write(`PASS validate-v207-attempt61-candidate ${JSON.stringify(expected)}\n`);
