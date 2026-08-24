import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:f28c0ceb4c39ce7c74c1a63d918c00acb078e8cb8c63d0728e00f9d4d2126cd4",
  acceptance: "sha256:6e3e2e0e3b8739a4dbf8365c263fd6e2229dd760b0dad424a18e16cbde618d36",
  authority: "sha256:7ab262a878e0447002f417ea3af49ffa376cea307296ea8d24681ff8492bc015",
  preflight: "sha256:0af5ef859fd4b75c3abc66ca0ca8886071bd115bd09ff196a5a07c9b1a9b959c",
  max1: "sha256:a97d961fc1e85cc5eb76fd4d9f6d7535876fb675df5c9ebfb734f7ed882c19b7",
  max2: "sha256:e0be79500f54ab7e18c497a479afd9f3a45ae6ee7e6ac01c2fd7936320f340f9",
  orchestrator: "sha256:ed2b9f4edb3cac623055cbf14998c51aeba0b27d6d496c6a74e9cc302997bf62",
  qualification: "sha256:afa9567e922f19256a47137336c6d573ec1be2e8765648812aa6d3fa96123fe1",
  harness: "sha256:3c5f6207eead02fc197bec3ec3b85d7dc31052d25c1ea694efba7326a92ac512",
  canonicalActivation: "sha256:36a23948ce41b7344af81a8a8abfd44e7d356d9a12c10731aefed1f3ce36a6b3",
  version: "sha256:0fbd792eb0ce3a906a57b1bcf55bfa2fbf12485eae0efd0d7881479f8609002a",
  record: "sha256:94b40dd4ba2b681a2f9aff554685b1206065ee5a61874ebae3e9ce1e7a1eb0ba",
};
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const yes = (value, code) => {
  if (!value) throw new Error(code);
};
const json = async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"));
const fileSha = async (name) => sha(await readFile(path.join(dir, name)));
const rootSha = async (name) => sha(await readFile(path.join(root, name)));

const [proposal, preflight, max1, max2, acceptance, authority, activation] = await Promise.all([
  json("combined-live-proposal.json"),
  json("read-only-preflight.json"),
  json("staged-config-max1.json"),
  json("staged-config-max2.json"),
  json("acceptance.json"),
  json("approved-authority.json"),
  readFile(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
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
yes(proposal.attempt === 57 && proposal.qualification_status === "NOT_QUALIFIED", "PROPOSAL_SCOPE");
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
  proposal.queue_poll_contract.billing_retry_delays_ms.join(",") === "250,1000,2000" &&
    proposal.queue_poll_contract.maximum_polls === 180 &&
    proposal.queue_poll_contract.poll_interval_ms === 10000 &&
    proposal.queue_poll_contract.redispatch_on_poll_failure === false,
  "QUEUE_CONTRACT",
);
yes(
  preflight.fresh_provider_read === true &&
    preflight.provider_mutations === 0 &&
    preflight.gpu_jobs_submitted === 0 &&
    preflight.runpod.pods === 0 &&
    preflight.runpod.endpoints === 0 &&
    preflight.runpod.private_templates === 0 &&
    preflight.runpod.active_serverless_workers === 0 &&
    preflight.runpod.running_pods === 0 &&
    preflight.runpod.retained_volume_count === 2 &&
    preflight.runpod.billing_settlement === "THREE_STABLE_READS" &&
    preflight.runpod.selected_gpu.availability === "LOW" &&
    preflight.cloudflare.active_version_id_sha256 === expected.version &&
    preflight.cloudflare.active_record_sha256 === expected.record &&
    preflight.cloudflare.exact_route_probe.matches_active_version === true,
  "PREFLIGHT_TRUTH",
);
for (const [config, workers] of [[max1, 1], [max2, 2]]) {
  yes(
    config.region === "EU-RO-1" &&
      config.workers_min === 0 &&
      config.workers_max === workers &&
      config.flashboot === true &&
      config.network_volume_mount === "/runpod-volume" &&
      config.network_volume_size_gb === 50 &&
      config.network_volume_region === "EU-RO-1" &&
      config.cloudflare_anchor_refresh_contract.expected_old_active_version_id_sha256 === expected.version &&
      config.cloudflare_anchor_refresh_contract.expected_old_active_record_sha256 === expected.record,
    `CONFIG_${workers}`,
  );
}
yes(
  acceptance.proposal_sha256 === expected.proposal &&
    acceptance.preflight_sha256 === expected.preflight &&
    acceptance.max1_sha256 === expected.max1 &&
    acceptance.max2_sha256 === expected.max2 &&
    acceptance.authority.maximum_cumulative_finite_spend_usd === null &&
    acceptance.authority.v2_08_authorized === false,
  "ACCEPTANCE",
);
yes(
  authority.attempt === 57 &&
    authority.status === "APPROVED_SINGLE_USE_PENDING_EXECUTION" &&
    authority.proposal.sha256 === expected.proposal &&
    authority.acceptance.sha256 === expected.acceptance &&
    authority.approval.exact_proposal_approved === true &&
    authority.approval.maximum_cumulative_finite_spend_usd === 4 &&
    authority.approval.anchor_refresh_authorized === true &&
    authority.approval.single_use === true &&
    authority.approval.consumed === false &&
    authority.queue_poll_contract.poll_interval_ms === 10000 &&
    authority.queue_poll_contract.maximum_polls === 180 &&
    authority.queue_poll_contract.billing_retry_delays_ms.join(",") === "250,1000,2000" &&
    authority.queue_poll_contract.redispatch_on_poll_failure === false &&
    authority.execution_boundary.v2_08_authorized === false,
  "AUTHORITY",
);
yes(activation.includes(`"${expected.proposal}" as const`), "ACTIVATION_PROPOSAL_POINTER");
yes(activation.includes(`"${expected.authority}";`), "AUTHORITY_BINDING");
yes(/V207_APPROVED_FINITE_CAP_USD: number \| null =\s*4;/u.test(activation), "CAP_BINDING");
yes(/V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null =\s*true;/u.test(activation), "REFRESH_BINDING");
let authorityExists = true;
try {
  await access(path.join(dir, "approved-authority.json"));
} catch {
  authorityExists = false;
}
yes(authorityExists === true, "AUTHORITY_FILE_REQUIRED");
process.stdout.write(`PASS validate-v207-attempt57-candidate ${JSON.stringify(expected)}\n`);
