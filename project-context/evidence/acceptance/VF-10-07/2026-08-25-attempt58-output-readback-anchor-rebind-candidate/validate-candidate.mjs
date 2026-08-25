import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const expected = {
  proposal: "sha256:7053157f0334d262af094be9f020285c9eabb4fef0c62991ec2f2cc60d705b24",
  acceptance: "sha256:599d28434a7b5dd63b93dfe8f6035f909ca3f1da03273582f2f9e7af6f1766a8",
  preflight: "sha256:2b1790d9b142fbf08afef6ca0a1697ebf33c77f19fcd55966b922a3f994ad83f",
  max1: "sha256:8638fc1c0b6259ad5b978a11af50fb13cebe3daba52b44c402d60ed8fa0e6d65",
  max2: "sha256:a4395f95d4f8fb6427a178c98d2e7ee2e2dd61b69aaf520eb2101934df6b3d79",
  orchestrator: "sha256:daf8b7956cff24252ae9c0edab053f26e4f95a9836dab5141cb43717affc2ccf",
  qualification: "sha256:3ed15af77a48436b9864a29a03cf7a80f1d6cd4daf0ab10d2372d74f67598d43",
  harness: "sha256:3c5f6207eead02fc197bec3ec3b85d7dc31052d25c1ea694efba7326a92ac512",
  canonicalActivation: "sha256:fcef15d69622c8d796d32ce7001adccb8da2ff53d999a3293d3dff884fdedba7",
  version: "sha256:5a50180c9772341817844ac140461cca335ba58b7e7e5f0f32c1cb64ebbe304c",
  record: "sha256:c64f4ec079b8f22fbe7f83db40e4db8a98bf3317adc7be61dc6d34f44f388324",
  readbackRepair: "61919013c74f71995cf1631ce6ac56e633708dce",
  billingBaseline: 1.8249728917435277,
  volumeHashes: [
    "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
  ],
};
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const yes = (value, code) => {
  if (!value) throw new Error(code);
};
const json = async (name) => JSON.parse(await readFile(path.join(dir, name), "utf8"));
const fileSha = async (name) => sha(await readFile(path.join(dir, name)));
const rootSha = async (name) => sha(await readFile(path.join(root, name)));

const [proposal, preflight, max1, max2, acceptance, activation] = await Promise.all([
  json("combined-live-proposal.json"),
  json("read-only-preflight.json"),
  json("staged-config-max1.json"),
  json("staged-config-max2.json"),
  json("acceptance.json"),
  readFile(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
]);
yes((await fileSha("combined-live-proposal.json")) === expected.proposal, "PROPOSAL_HASH");
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
yes(proposal.attempt === 58 && proposal.qualification_status === "NOT_QUALIFIED", "PROPOSAL_SCOPE");
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
  proposal.output_readback_classification_contract.generated_output_get_attempts === 1 &&
    proposal.output_readback_classification_contract.generated_output_get_transport_code ===
      "V207_OUTPUT_PORT_GET_TRANSPORT" &&
    proposal.output_readback_classification_contract.generated_output_get_invalid_response_code ===
      "V207_OUTPUT_PORT_GET_RESPONSE_INVALID" &&
    proposal.output_readback_classification_contract.signed_artifact_readback_transport_code ===
      "MAGE_OUTPUT_READBACK_TRANSPORT" &&
    proposal.output_readback_classification_contract.signed_artifact_non_2xx_code ===
      "MAGE_OUTPUT_READBACK_FAILED" &&
    proposal.output_readback_classification_contract
      .response_body_url_headers_nonce_exception_text_or_cause_retained === false &&
    proposal.provider_free_lineage.output_readback_classification_repair_commit ===
      expected.readbackRepair,
  "OUTPUT_READBACK_CLASSIFICATION",
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
    preflight.runpod.retained_volume_id_hashes.join(",") === expected.volumeHashes.join(",") &&
    preflight.runpod.baseline_endpoint_spend_usd === expected.billingBaseline &&
    preflight.runpod.final_endpoint_spend_usd === expected.billingBaseline &&
    preflight.runpod.incremental_spend_usd === 0 &&
    preflight.runpod.billing_settlement === "THREE_STABLE_READS" &&
    preflight.runpod.selected_gpu.availability === "MEDIUM" &&
    preflight.cloudflare.active_version_id_sha256 === expected.version &&
    preflight.cloudflare.active_record_sha256 === expected.record &&
    preflight.cloudflare.exact_route_probe.matches_active_version === true &&
    preflight.cloudflare.route_probe_reads.length === 3 &&
    preflight.cloudflare.route_probe_reads.every(
      (read) =>
        read.status === 404 &&
        read.code === "V207_ROUTE_DISABLED" &&
        read.worker_version_id_sha256 === expected.version &&
        read.matches_active_version === true,
    ) &&
    preflight.repaired_lineage.output_readback_classification_repair_commit ===
      expected.readbackRepair,
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
      config.candidate_attempt === 58 &&
      config.control_source_commit === expected.readbackRepair &&
      config.output_readback_classification_repair_commit === expected.readbackRepair &&
      config.source_hashes.canonical_activation_sha256 === expected.canonicalActivation &&
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
yes(activation.includes(`"${expected.proposal}" as const`), "ACTIVATION_PROPOSAL_POINTER");
yes(activation.includes(`"${expected.readbackRepair}" as const`), "ACTIVATION_CONTROL_SOURCE");
yes(/V207_APPROVED_AUTHORITY_SHA256: string \| null =\s*null;/u.test(activation), "AUTHORITY_NOT_NULL");
yes(/V207_APPROVED_FINITE_CAP_USD: number \| null =\s*null;/u.test(activation), "CAP_NOT_NULL");
yes(/V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null =\s*null;/u.test(activation), "REFRESH_NOT_NULL");
let authorityExists = true;
try {
  await access(path.join(dir, "approved-authority.json"));
} catch {
  authorityExists = false;
}
yes(authorityExists === false, "PREMATURE_AUTHORITY_FILE");
process.stdout.write(`PASS validate-v207-attempt58-candidate ${JSON.stringify(expected)}\n`);
