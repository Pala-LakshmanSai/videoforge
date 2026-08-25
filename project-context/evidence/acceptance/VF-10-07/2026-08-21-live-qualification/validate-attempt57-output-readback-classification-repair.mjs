import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dir, "../../../../../");
const candidateDir = path.resolve(
  dir,
  "../2026-08-24-attempt57-queue-poll-classification-candidate",
);
const expected = {
  diagnosis: "sha256:87dcfe9b9ed5a2db71e142417f2d030fca051d7a50387e7f8c4df9c4ce2a2217",
  source: "sha256:3ed15af77a48436b9864a29a03cf7a80f1d6cd4daf0ab10d2372d74f67598d43",
  test: "sha256:df4edea0050c5b3c0daf0a8a19a7d7bfd6b53d87ac5ce743b1b299945ec46555",
  closure: "sha256:6847f2c4f596705910c33d26581fab3b2c2c3ce5f9bb6d4e0a9c8103df052135",
  cleanup: "sha256:af01054a4b0c16fe43f4ace6a9036763e20966ac20842fb6d40210029421eae0",
  reconciliation: "sha256:5895fe18b8143282e397d372b30fa56028f5003bc2ce258b5ef61cce2d1db8c6",
  authority: "sha256:16bfca4ceb5a673f391fad9b1fe95b30d9c8c7eac335df3cc7464960baa17dd8",
};
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const yes = (condition, code) => {
  if (!condition) throw new Error(code);
};
const bytes = async (base, name) => readFile(path.join(base, name));
const [diagnosisBytes, sourceBytes, testBytes, closureBytes, cleanupBytes, reconciliationBytes, authorityBytes, activation] =
  await Promise.all([
    bytes(dir, "attempt57-output-readback-classification-repair.json"),
    bytes(root, "apps/web/src/server/providers/v207-live-qualification.ts"),
    bytes(root, "apps/web/src/server/providers/v207-live-qualification.test.ts"),
    bytes(dir, "failed-attempt-57.json"),
    bytes(dir, "attempt57-cleanup-observation.json"),
    bytes(dir, "attempt57-reconciliation-observation.json"),
    bytes(candidateDir, "approved-authority.json"),
    readFile(path.join(root, "apps/web/src/server/providers/v207-activation-authority.ts"), "utf8"),
  ]);

yes(sha(diagnosisBytes) === expected.diagnosis, "DIAGNOSIS_HASH");
yes(sha(sourceBytes) === expected.source, "SOURCE_HASH");
yes(sha(testBytes) === expected.test, "TEST_HASH");
yes(sha(closureBytes) === expected.closure, "CLOSURE_HASH");
yes(sha(cleanupBytes) === expected.cleanup, "CLEANUP_HASH");
yes(sha(reconciliationBytes) === expected.reconciliation, "RECONCILIATION_HASH");
yes(sha(authorityBytes) === expected.authority, "AUTHORITY_HASH");

const diagnosis = JSON.parse(diagnosisBytes.toString("utf8"));
const closure = JSON.parse(closureBytes.toString("utf8"));
const cleanup = JSON.parse(cleanupBytes.toString("utf8"));
const reconciliation = JSON.parse(reconciliationBytes.toString("utf8"));
const authority = JSON.parse(authorityBytes.toString("utf8"));

yes(
  diagnosis.result === "PASS_PROVIDER_FREE_OUTPUT_READBACK_CLASSIFICATION_REPAIR" &&
    diagnosis.qualification_status === "NOT_QUALIFIED" &&
    diagnosis.immutable_failure.error === "MAGE_OUTPUT_NOT_SUCCEEDED" &&
    diagnosis.immutable_failure.failure_stage === "output_readback" &&
    diagnosis.immutable_failure.observed_output_status === "SUCCEEDED" &&
    diagnosis.immutable_failure.observed_failure_code === "UNKNOWN" &&
    diagnosis.immutable_failure.exact_remote_transport_or_response_root_cause === "UNPROVEN",
  "DIAGNOSIS_SCOPE",
);
yes(
  diagnosis.repair.stable_codes.generated_output_port_get_transport ===
    "V207_OUTPUT_PORT_GET_TRANSPORT" &&
    diagnosis.repair.stable_codes.generated_output_port_get_response_invalid ===
      "V207_OUTPUT_PORT_GET_RESPONSE_INVALID" &&
    diagnosis.repair.stable_codes.signed_artifact_readback_transport ===
      "MAGE_OUTPUT_READBACK_TRANSPORT" &&
    diagnosis.repair.generated_output_port_get_attempts === 1 &&
    diagnosis.repair.generated_output_port_get_503_retried === false &&
    diagnosis.repair.response_body_url_headers_nonce_or_error_cause_retained === false &&
    diagnosis.repair.reconciliation_behavior_changed === false &&
    diagnosis.validation.focused_tests_passed === 39 &&
    diagnosis.validation.typescript_exit_code === 0,
  "REPAIR_CONTRACT",
);
yes(
  closure.qualification_status === "NOT_QUALIFIED" &&
    cleanup.runpod.final_disposable_resources_absent === true &&
    reconciliation.inventory.pods === 0 &&
    reconciliation.inventory.endpoints === 0 &&
    reconciliation.inventory.private_templates === 0 &&
    reconciliation.inventory.active_serverless_workers === 0 &&
    reconciliation.inventory.running_pods === 0 &&
    reconciliation.inventory.retained_volumes.length === 2,
  "IMMUTABLE_CLEAN_CLOSURE",
);
yes(
  authority.status === "CONSUMED_NON_REUSABLE_ATTEMPT57_REPLACEMENT_OUTPUT_CONTRACT_FAILURE" &&
    authority.approval.consumed === true &&
    authority.execution_boundary.maximum_cumulative_finite_spend_usd === null &&
    diagnosis.provider_state.provider_calls === 0 &&
    diagnosis.provider_state.provider_mutations === 0 &&
    diagnosis.provider_state.gpu_jobs_submitted === 0 &&
    diagnosis.provider_state.external_spend_usd === 0 &&
    diagnosis.provider_state.current_authority_sha256 === null &&
    diagnosis.provider_state.executable_cap_usd === 0 &&
    diagnosis.v2_08_authorized === false,
  "NO_AUTHORITY_OR_PROVIDER_ACTION",
);
yes(
  /V207_APPROVED_AUTHORITY_SHA256: string \| null =\s*null;/u.test(activation) &&
    /V207_APPROVED_FINITE_CAP_USD: number \| null =\s*null;/u.test(activation) &&
    /V207_APPROVED_ANCHOR_REFRESH_AUTHORIZED: boolean \| null =\s*null;/u.test(activation),
  "ACTIVATION_NULL",
);

process.stdout.write(
  `PASS validate-attempt57-output-readback-classification-repair ${JSON.stringify(expected)}\n`,
);
