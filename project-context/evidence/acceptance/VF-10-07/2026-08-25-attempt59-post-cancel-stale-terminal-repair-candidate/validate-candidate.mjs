import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:8a40ae38c44362039ee9f271108b41b9f55c5457256944ea98bf1a322cb4d647",
  acceptance: "sha256:553178c5015567a6ee2ddad2465face27352f9308bb2d8c36dc3b233d2eccdfb",
  authority: "sha256:9c8790c89c01b0b152405c59290985c20b7f07ec56ce922fc6a4fb836db558fc",
  preflight: "sha256:be881595ac8493bab67d3a176e86bda42fb77e1fbb6ea9027b46501c9b1c63bf",
  max1: "sha256:977825dd9be925e886f91a50cebb5e8023a2d39114c63bb1ab7fc5779cdc07b9",
  max2: "sha256:162a40415bfb7ed0bd447a59e89fd947385b1297602a430f209699390dfe512c",
  orchestrator: "sha256:65fd5b85caf575aeb4cac13537753db553a90e0304fded64e12b5195903ae2fe",
  qualification: "sha256:3ed15af77a48436b9864a29a03cf7a80f1d6cd4daf0ab10d2372d74f67598d43",
  harness: "sha256:7995f0519d61538633b005c529835b7c3864bb4378fd6a3aa010e1e67947b233",
  canonicalActivation: "sha256:fcef15d69622c8d796d32ce7001adccb8da2ff53d999a3293d3dff884fdedba7",
  version: "sha256:1d830477cfdc2d91240f1226bc3556ec73067018f115b06dcc7fc4137fe9028f",
  record: "sha256:05054aeac4e1f20213f873463f29a19da3910ad674a65c59f13d04b0cb601b50",
  anchorCommit: "74fbe8d81bc1670065e5a08a19f1d449cb94471f",
  readbackRepair: "61919013c74f71995cf1631ce6ac56e633708dce",
  postCancelRepair: "8bb6583012569e595630deb3d7fe104a923dcc58",
  postCancelTest: "sha256:5c44885d23b563c8d33e1b5227657112cfdbe73d265245c57745c28b5607fd10",
  billingBaseline: 1.8568953356298152,
  closure: "sha256:e617cb65f890bee0fadf538af204077f2c4e1ac46859150bf613a715ea6289f6",
  cleanup: "sha256:21f3c49505bf3b58ee14f1b4ebbac91ce6d21c3c6723bfa6c1417b6988f76058",
  reconciliation: "sha256:006e64b73754ff24309572900ce88c30d502b5493862ef08ca06e756d7074106",
};
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const yes = (value, code) => {
  if (!value) throw new Error(code);
};
const json = async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"));
const fileSha = async (name) => sha(await readFile(path.join(dir, name)));
const rootBytes = async (name) => readFile(path.join(root, name));
const rootSha = async (name) => sha(await rootBytes(name));

const [proposal, preflight, max1, max2, acceptance, authority, activation, orchestrator] = await Promise.all([
  json("combined-live-proposal.json"),
  json("read-only-preflight.json"),
  json("staged-config-max1.json"),
  json("staged-config-max2.json"),
  json("acceptance.json"),
  json("approved-authority.json"),
  rootBytes("apps/web/src/server/providers/v207-activation-authority.ts").then(String),
  rootBytes("apps/web/src/server/providers/v207-live-orchestrator.ts").then(String),
]);
yes((await fileSha("combined-live-proposal.json")) === expected.proposal, "PROPOSAL_HASH");
yes((await fileSha("acceptance.json")) === expected.acceptance, "ACCEPTANCE_HASH");
yes((await fileSha("approved-authority.json")) === expected.authority, "AUTHORITY_HASH");
yes((await fileSha("read-only-preflight.json")) === expected.preflight, "PREFLIGHT_HASH");
yes((await fileSha("staged-config-max1.json")) === expected.max1, "MAX1_HASH");
yes((await fileSha("staged-config-max2.json")) === expected.max2, "MAX2_HASH");
yes(
  (await rootSha("apps/web/src/server/providers/v207-live-orchestrator.ts")) === expected.orchestrator &&
    (await rootSha("apps/web/src/server/providers/v207-live-qualification.ts")) === expected.qualification &&
    (await rootSha("apps/web/src/server/providers/runpod-v207-qualification-harness.ts")) === expected.harness,
  "SOURCE_HASH",
);
yes(proposal.attempt === 59 && proposal.qualification_status === "NOT_QUALIFIED", "PROPOSAL_SCOPE");
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
  preflight.attempt === 59 &&
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
    preflight.cloudflare.active_version_id_sha256 === expected.version &&
    preflight.cloudflare.active_record_sha256 === expected.record &&
    preflight.cloudflare.fresh_provider_read === true &&
    preflight.must_reconfirm_provider_inventory_capacity_rates_anchor_route_config_and_billing_after_approval_before_mutation === true &&
    preflight.attempt58_clean_closure.closure_sha256 === expected.closure &&
    preflight.attempt58_clean_closure.cleanup_sha256 === expected.cleanup &&
    preflight.attempt58_clean_closure.reconciliation_sha256 === expected.reconciliation,
  "PREFLIGHT_TRUTH",
);
for (const [config, workers] of [[max1, 1], [max2, 2]]) {
  yes(
    config.region === "EU-RO-1" &&
      config.workers_min === 0 &&
      config.workers_max === workers &&
      config.flashboot === true &&
      config.candidate_attempt === 59 &&
      config.network_volume_mount === "/runpod-volume" &&
      config.post_cancel_terminal_inventory_repair_commit === expected.postCancelRepair &&
      config.post_cancel_terminal_inventory_repair_test_sha256 === expected.postCancelTest &&
      config.source_hashes.canonical_activation_sha256 === expected.canonicalActivation &&
      config.cloudflare_anchor_refresh_contract.expected_old_active_version_id_sha256 === expected.version &&
      config.cloudflare_anchor_refresh_contract.expected_old_active_record_sha256 === expected.record,
    `CONFIG_${workers}`,
  );
}
yes(
  acceptance.attempt === 59 &&
    acceptance.proposal_sha256 === expected.proposal &&
    acceptance.preflight_sha256 === expected.preflight &&
    acceptance.max1_sha256 === expected.max1 &&
    acceptance.max2_sha256 === expected.max2 &&
    acceptance.authority.maximum_cumulative_finite_spend_usd === null &&
    acceptance.authority.v2_08_authorized === false,
  "ACCEPTANCE",
);
yes(
  authority.attempt === 59 &&
    authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    authority.proposal.sha256 === expected.proposal &&
    authority.acceptance.sha256 === expected.acceptance &&
    authority.approval.exact_proposal_approved === true &&
    authority.approval.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval.anchor_refresh_authorized === true &&
    authority.approval.single_use === true &&
    authority.approval.consumed === false &&
    authority.lineage.post_cancel_terminal_inventory_repair_commit === expected.postCancelRepair &&
    authority.execution_boundary.maximum_cumulative_finite_spend_usd === 4 &&
    authority.execution_boundary.gpu_use_authorized_pending_execution === true &&
    authority.execution_boundary.v2_08_authorized === false,
  "APPROVED_AUTHORITY",
);
yes(activation.includes(`"${expected.proposal}" as const`), "ACTIVATION_PROPOSAL_POINTER");
yes(activation.includes(`"${expected.readbackRepair}" as const`), "ACTIVATION_CONTROL_SOURCE");
yes(activation.includes(`"${expected.authority}";`), "AUTHORITY_BINDING");
yes(/V207_APPROVED_FINITE_CAP_USD: number \| null = 4;/u.test(activation), "CAP_BINDING");
yes(/V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null = true;/u.test(activation), "REFRESH_BINDING");
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
process.stdout.write(`PASS validate-v207-attempt59-candidate ${JSON.stringify(expected)}\n`);
