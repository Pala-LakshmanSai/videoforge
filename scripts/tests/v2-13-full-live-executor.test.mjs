import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  assertResult,
  certificationPredecessorEvidence,
  cleanupProofEvidence,
  createDurableCancellationSource,
  executeFullLive as executeFullLiveRaw,
  missingConcreteTools,
  OPERATIONS,
  runPodMutationBoundaryReached,
  readDurableCancellationRecord,
  validateFullLiveSourceClosure,
} from "../../deploy/v2-13/full-live-executor.mjs";
import {
  enterCleanupOnly,
  initialConsumptionRecord,
  writeExclusive,
} from "../../deploy/v2-13/full-live-orchestration-authority.mjs";
import { EXACT_PREDECESSOR_RELEASE_ATTEMPT } from "../../deploy/v2-13/validate-full-live-approval.mjs";

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const proof = (letter) => `sha256:${letter.repeat(64)}`;
const canonicalJson = (value) =>
  Array.isArray(value)
    ? `[${value.map((item) => canonicalJson(item)).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const workflowRegistrationEvidenceFixture = (sourceCommit = "a".repeat(40)) => {
  const unsigned = {
    schema_version: "videoforge.v213-soulx-workflow-registration-evidence/v1",
    repository: "Pala-LakshmanSai/videoforge",
    default_branch: "main",
    default_branch_commit: "5".repeat(40),
    workflow_file: "avatar-primary-serverless-image.yml",
    workflow_name: "avatar-primary-serverless-image",
    workflow_path: ".github/workflows/avatar-primary-serverless-image.yml",
    default_branch_workflow_sha256: proof("5"),
    release_source_commit: sourceCommit,
    release_source_workflow_sha256: proof("5"),
    registration_state: "REGISTERED_EXACT_DEFAULT_BRANCH",
    materialized: true,
    bound_to_release_source: true,
  };
  return { ...unsigned, evidence_sha256: hash(Buffer.from(canonicalJson(unsigned))) };
};

const freshWorkflowReadbackFixture = (state) => {
  const unsigned = {
    schemaVersion: "videoforge.v213-fresh-default-branch-workflow-readback/v1",
    repository: "Pala-LakshmanSai/videoforge",
    defaultBranch: "main",
    defaultBranchCommit: state.soulx_workflow_registration_evidence.default_branch_commit,
    releaseSourceCommit: state.release_source_commit,
    workflows: [
      {
        workflowId: 101,
        workflowFile: "mage-image.yml",
        workflowName: "mage-image",
        workflowSha256: proof("4"),
      },
      {
        workflowId: 102,
        workflowFile: "avatar-primary-serverless-image.yml",
        workflowName: "avatar-primary-serverless-image",
        workflowSha256: state.soulx_workflow_registration_evidence.default_branch_workflow_sha256,
      },
    ],
    exactBothRegisteredAndByteIdentical: true,
  };
  return { ...unsigned, proofSha256: hash(Buffer.from(canonicalJson(unsigned))) };
};
const retainedVolumesFixture = Object.freeze([
  Object.freeze({
    lane: "mage",
    volumeIdSha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
    volumeManifestSha256: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
    sizeGb: 50,
    region: "EU-RO-1",
  }),
  Object.freeze({
    lane: "soulx",
    volumeIdSha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    volumeManifestSha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
    sizeGb: 50,
    region: "EU-RO-1",
  }),
]);
const endpointBindingsFixture = Object.freeze(
  retainedVolumesFixture.map((volume, index) =>
    Object.freeze({
      lane: volume.lane,
      endpointIdSha256: proof(index === 0 ? "1" : "2"),
      templateIdSha256: proof(index === 0 ? "3" : "4"),
      imageSha256: proof(index === 0 ? "5" : "6"),
      deploymentSha256: proof(index === 0 ? "7" : "8"),
      volumeIdSha256: volume.volumeIdSha256,
      volumeManifestSha256: volume.volumeManifestSha256,
      region: "EU-RO-1",
      gpu: "NVIDIA GeForce RTX 4090",
      gpuCount: 1,
      workersMin: 0,
      workersMax: 1,
    }),
  ),
);
function mutationAdmissionFixture({ operation, priorResults, outerStateSha256, trustedTime }) {
  const production = priorResults.get("create-exact-max-one-endpoints")?.materialization
    ?.production;
  const endpointBindings = operation.id.startsWith("v2-")
    ? [structuredClone(production.mage), structuredClone(production.soulx)]
    : [];
  const unsigned = {
    schemaVersion: "videoforge.v213-runpod-per-mutation-admission/v2",
    operationId: operation.id,
    outerStateSha256BeforeAuthorization: outerStateSha256,
    checkedAt: trustedTime,
    authenticatedAccountSha256:
      "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c",
    exactGpu: "NVIDIA GeForce RTX 4090",
    region: "EU-RO-1",
    availability: "LOW",
    serverlessFlexRateUsdPerSecond: 0.00031,
    serverlessFlexRateUsdPerGpuHour: 1.116,
    serverlessFlexRateAuthenticatedCatalogSha256: proof("9"),
    serverlessFlexRateSource: "https://docs.runpod.io/serverless/endpoints/endpoint-configurations",
    serverlessFlexRateSourceCheckedAt: trustedTime,
    serverlessFlexRateSourceSha256: proof("a"),
    noFallback: true,
    activeWorkers: 0,
    runningPods: 0,
    endpointBindings,
    retainedVolumes: structuredClone(retainedVolumesFixture),
    serverlessCatalogSha256: proof("9"),
  };
  return { ...unsigned, proofSha256: hash(Buffer.from(canonicalJson(unsigned))) };
}
const qualifiedProductionCleanupProof = (
  fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111",
) => {
  const unsigned = {
    schemaVersion: "videoforge.v213-qualified-production-cleanup-proof/v1",
    fullLiveAuthorityId,
    promotionId: "22222222-2222-4222-8222-222222222222",
    state: "DISABLED_UNQUALIFIED",
    enabled: false,
    gpuDispatchPerformed: false,
    productionRedispatched: false,
    providerReadbackPassed: true,
    routeStatus: 503,
    disabledConfigSha256: proof("4"),
    disabledVersionSha256: proof("5"),
    databasePromotionAttempted: true,
    databasePromotionSha256: proof("7"),
    databaseRollbackRecorded: true,
    databaseRollbackSha256: proof("6"),
  };
  return { ...unsigned, proofSha256: hash(Buffer.from(canonicalJson(unsigned))) };
};
const promotionCleanupAbsenceProof = () => {
  const authorityId = "33333333-3333-4333-8333-333333333333";
  const unsigned = {
    schemaVersion: "videoforge.v213-promotion-cleanup-absence-proof/v1",
    authorityId,
    fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
    promotionWorkId: `${authorityId}:promote-qualified-production`,
    promotionRecordMaterialized: false,
    promotionJournalMaterialized: false,
    databaseMutationPossible: false,
    cloudflareMutationPossible: false,
  };
  return { ...unsigned, proofSha256: hash(Buffer.from(canonicalJson(unsigned))) };
};
let currentAuthorizedOuterStateSha256;
const executeFullLive = (options) => {
  const runOperation = options.runOperation;
  return executeFullLiveRaw({
    trustedTime: async () => "2026-08-26T12:00:00.000Z",
    verifyMaterializationSeed: async () => true,
    verifyStaticReleaseDescriptor: async () => true,
    readMutationAdmission: async (input) => mutationAdmissionFixture(input),
    ...options,
    runOperation: async (...args) => {
      currentAuthorizedOuterStateSha256 = args[3];
      try {
        const result = await runOperation(...args);
        const mutationAdmission = args[4]?.mutationAdmission;
        return mutationAdmission === undefined
          ? result
          : {
              ...result,
              mutationAdmission,
              mutationAdmissionProofSha256: mutationAdmission.proofSha256,
              mutationAdmissionCheckedAt: mutationAdmission.checkedAt,
            };
      } finally {
        currentAuthorizedOuterStateSha256 = undefined;
      }
    },
  });
};

test("production source closure rejects any covered byte drift before execution", () => {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-source-closure-"));
  const sourcePath = join(directory, "production.ts");
  const manifestPath = join(directory, "closure.json");
  try {
    writeFileSync(sourcePath, "export const production = true;\n");
    writeFileSync(
      manifestPath,
      `${JSON.stringify({
        schema_version: "videoforge.v2-13-full-live-source-closure/v1",
        entries: [{ path: "production.ts", sha256: hash(readFileSync(sourcePath)) }],
      })}\n`,
    );
    assert.equal(
      validateFullLiveSourceClosure({ root: directory, manifestPath: "closure.json" }),
      1,
    );
    writeFileSync(sourcePath, "export const production = false;\n");
    assert.throws(
      () => validateFullLiveSourceClosure({ root: directory, manifestPath: "closure.json" }),
      /V2_13_FULL_LIVE_SOURCE_CLOSURE_DRIFT:production\.ts/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function stateFixture() {
  const directory = mkdtempSync(join(tmpdir(), "videoforge-full-live-executor-"));
  chmodSync(directory, 0o700);
  const path = join(directory, "state.json");
  const authority = {
    authority_id: "v2-13-test-executor-0001",
    full_live_authority_id: "11111111-1111-4111-8111-111111111111",
    materialization_seed_sha256: proof("a"),
    static_release_descriptor: {
      path: "project-context/evidence/acceptance/VF-10-13/static-release-descriptor.json",
      sha256: proof("d"),
    },
    outer_orchestration: {
      full_live_executor_path: "deploy/v2-13/full-live-executor.mjs",
      full_live_executor_sha256: hash(readFileSync("deploy/v2-13/full-live-executor.mjs")),
    },
  };
  const authorityBytes = Buffer.from('{"authority":"test"}\n');
  const validated = {
    proposalSha256: proof("1"),
    approvalSha256: proof("2"),
    proposalRecordCommit: "b".repeat(40),
    authorityRecordCommit: "c".repeat(40),
    approvalRecordPath: "evidence/user-approval.json",
    authorityRecordPath: "evidence/approved-authority.json",
    releaseSourceCommit: "a".repeat(40),
    executionControlCommit: "d".repeat(40),
    proposalSchema: "videoforge.v2-13-full-live-completion-proposal/v4",
    predecessorReleaseAttempt: EXACT_PREDECESSOR_RELEASE_ATTEMPT,
    fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
    approvedAt: "2026-08-26T00:00:00.000Z",
    expiresAt: "2026-08-27T00:00:00.000Z",
    staticReleaseDescriptorPath:
      "project-context/evidence/acceptance/VF-10-13/static-release-descriptor.json",
    staticReleaseDescriptorSha256: proof("d"),
  };
  const workflowRegistrationEvidence = workflowRegistrationEvidenceFixture(
    validated.releaseSourceCommit,
  );
  writeExclusive(
    path,
    initialConsumptionRecord(authority, authorityBytes, validated, {
      schemaVersion: "videoforge.v213-static-release-descriptor/v2",
      workflowRegistrationEvidence,
    }),
  );
  return { directory, path, sha256: hash(readFileSync(path)) };
}

function fakeResult(operation, state, priorResults, authorizedOuterStateSha256) {
  const result = { actualUsd: operation.reserveUsd };
  if (operation.id === "bootstrap-prequalification-database")
    Object.assign(result, {
      schema_version: "videoforge.v213-prequalification-database-bootstrap-result/v3",
      full_live_authority_id: state.full_live_authority_id,
      outer_state_sha256:
        authorizedOuterStateSha256 ?? currentAuthorizedOuterStateSha256 ?? proof("0"),
      materialization_seed_sha256: state.materialization_seed_sha256,
      database_identity_sha256:
        "sha256:7f2c802c531f4e5630d6a15b2f26bf65ea04f599b28c19fc3daa5d741c7567d7",
      ledger_before_count: 36,
      ledger_before_sha256: proof("1"),
      ledger_after_sha256: proof("2"),
      operator_acl_sha256: proof("3"),
      operator_database_url_sha256: proof("6"),
      runtime_database_url_sha256: proof("7"),
      reconciler_database_url_sha256: proof("8"),
      database_role_credential_bundle_sha256: proof("9"),
      credential_bootstrap_receipt_sha256: proof("a"),
      production_secret_bootstrap_sha256: proof("b"),
      production_secrets_sha256: proof("c"),
      production_secret_file_sha256s: {
        DATABASE_URL: proof("d"),
        BETTER_AUTH_SECRET: proof("d"),
        GOOGLE_CLIENT_ID: proof("d"),
        GOOGLE_CLIENT_SECRET: proof("d"),
        R2_ACCESS_KEY_ID: proof("d"),
        R2_SECRET_ACCESS_KEY: proof("d"),
        WORKFLOW_CALLBACK_SECRET: proof("d"),
        MEDIA_WORKER_TOKEN_SECRET: proof("d"),
        VIDEOFORGE_RECONCILER_DATABASE_URL: proof("d"),
        VIDEOFORGE_DISPATCH_TOKEN_KEY: proof("d"),
        VIDEOFORGE_DISPATCH_TOKEN_KEY_ID: proof("d"),
        VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: proof("d"),
        VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: proof("d"),
        VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: proof("d"),
        VIDEOFORGE_PROVIDER_PROOF_KEY_ID: proof("d"),
        RUNPOD_API_KEY: proof("d"),
        RUNPOD_API_BASE_URL: proof("d"),
        VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: proof("d"),
      },
      internal_credential_key_ids: {
        pairDispatchTokenKeyId: "v213-dispatch-key",
        pairEnvelopeSigningKeyId: "v213-envelope-key",
        pairProviderProofKeyId: "v213-provider-proof-key",
        provenanceReceiptKeyId: "v213-provenance-receipt-key",
      },
      pgcrypto_sha256: proof("4"),
      prequalification_database_bootstrap_sha256: proof("5"),
      recovery_mode: "FRESH_36_TO_46",
      runpod_calls: 0,
      cloudflare_calls: 0,
      application_secret_reads: 5,
      gpu_use: false,
      external_spend_usd: 0,
    });
  if (operation.id === "release-tag-readback")
    Object.assign(result, {
      tagName: state.release_ref.exact_tag_name,
      targetCommit: state.release_ref.exact_target_commit,
      mutationPerformed: false,
    });
  if (operation.id === "release-tag-create")
    Object.assign(result, {
      exactTagReady: true,
      targetCommit: state.release_source_commit,
      created: false,
      mutationPerformed: false,
    });
  if (operation.id === "release-tag-push")
    Object.assign(result, {
      tagName: state.release_ref.exact_tag_name,
      targetCommit: state.release_source_commit,
      pushPerformed: false,
      mutationPerformed: false,
      forceUsed: false,
    });
  if (operation.id === "approval-commit-push")
    Object.assign(result, {
      commit: state.authority_record_commit,
      exactRemoteReadback: true,
      branch: "codex/serverless-v2-roadmap-v4",
    });
  if (operation.id.endsWith("image-workflow-dispatch")) {
    const freshWorkflowReadback = freshWorkflowReadbackFixture(state);
    Object.assign(result, {
      runId: operation.id.startsWith("mage") ? "1001" : "1002",
      headSha: state.release_source_commit,
      dispatchAccepted: true,
      freshWorkflowReadback,
      freshWorkflowReadbackSha256: freshWorkflowReadback.proofSha256,
      workflowRegistrationEvidenceSha256: state.soulx_workflow_registration_evidence_sha256,
    });
  }
  if (operation.id.endsWith("image-workflow-verification")) {
    const dispatchId = operation.id.replace("verification", "dispatch");
    Object.assign(result, {
      runId: priorResults.get(dispatchId).runId,
      headSha: state.release_source_commit,
      imageDigest: proof("3"),
      evidenceSha256: proof("4"),
      publicManifestSha256: proof("5"),
      publicAllBlobsVerified: true,
      conclusion: "success",
    });
  }
  if (operation.id === "fresh-live-preflight")
    Object.assign(result, {
      exactGpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability: "LOW",
      flexUsdPerGpuHour: 1.116,
      noFallback: true,
      inventorySha256: proof("6"),
      billingBaselineSha256: proof("7"),
    });
  if (operation.id.includes("live-qualification"))
    Object.assign(result, {
      qualified: true,
      evidenceSha256: proof("8"),
      deploymentSha256: proof("9"),
      zeroWorkersAfter: true,
    });
  if (operation.id === "guarded-activation-once")
    Object.assign(result, { executedOnce: true, evidenceSha256: proof("f") });
  if (operation.id === "promote-qualified-production")
    Object.assign(result, {
      enabled: true,
      state: "QUALIFIED_EXACT",
      gpuDispatchPerformed: false,
      cloudflareMutationPerformed: true,
      evidenceSha256: proof("1"),
      versionSha256: proof("2"),
      databasePromotionSha256: proof("3"),
    });
  if (operation.id === "record-workflow-start-authority")
    Object.assign(result, {
      authorityId: "11111111-1111-4111-8111-111111111111",
      tokenSha256: proof("6"),
      expiresAt: "2026-08-27T00:00:00.000Z",
    });
  if (operation.id === "create-exact-max-one-endpoints")
    Object.assign(result, {
      createdExactTwoEndpoints: true,
      distinctEndpointIds: true,
      bothMaxWorkersOne: true,
      bothWorkersMinZero: true,
      evidenceSha256: proof("f"),
      materialization: {
        production: {
          mage: structuredClone(endpointBindingsFixture[0]),
          soulx: structuredClone(endpointBindingsFixture[1]),
        },
      },
    });
  if (operation.id.startsWith("v2-"))
    Object.assign(result, {
      accepted: true,
      terminal: true,
      evidenceSha256: proof("a"),
      zeroWorkersAfter: true,
    });
  if (operation.id === "v2-09-short-hosted-project") result.durationSeconds = 40;
  if (operation.id === "v2-10-operator-free-ranga-pilot")
    Object.assign(result, { durationSeconds: 240, operatorIntervention: false });
  if (operation.id === "v2-11-two-concurrent-owned-projects")
    Object.assign(result, { projectCount: 2, concurrent: true, ownershipIsolated: true });
  if (operation.id === "v2-12-long-output") result.durationSeconds = 1800;
  if (operation.id === "v2-13-final-two-lane-smoke")
    Object.assign(result, {
      schemaVersion: "videoforge.v213-fresh-two-lane-smoke-result/v1",
      twoLaneSmoke: true,
      smokeOnly: true,
      releaseCertified: false,
      signedSmokeEvidenceSha256: result.evidenceSha256,
    });
  if (operation.id === "restore-endpoints-max-one") {
    const promotionCleanup = qualifiedProductionCleanupProof(state.full_live_authority_id);
    Object.assign(result, {
      proofSha256: proof("b"),
      productionCleanupState: "EXACT_MAX_ONE_PAIR_RETAINED",
      productionResourcesAbsent: false,
      bothEndpointsMaxWorkersOne: true,
      retainedProductionEndpoints: 2,
      qualifiedProductionCleanup: promotionCleanup,
      promotionCleanupEvidenceSha256: promotionCleanup.proofSha256,
    });
  }
  if (operation.id === "prove-zero-workers")
    Object.assign(result, { proofSha256: proof("c"), zeroWorkers: true });
  if (operation.id === "read-settled-billing")
    Object.assign(result, { proofSha256: proof("d"), withinCumulativeCap: true });
  if (operation.id === "reconcile-exact-resources") {
    const promotionCleanup = qualifiedProductionCleanupProof(state.full_live_authority_id);
    Object.assign(result, {
      proofSha256: proof("e"),
      onlyApprovedRetainedVolumes: true,
      qualifiedProductionCleanup: promotionCleanup,
      promotionCleanupEvidenceSha256: promotionCleanup.proofSha256,
    });
  }
  if (operation.id === "certify-v2-13-release") {
    const predecessorEvidenceSha256s = certificationPredecessorEvidence(priorResults);
    Object.assign(result, {
      schemaVersion: "videoforge.v213-final-release-certification-result/v1",
      externalSpendUsd: 0,
      gpuUse: false,
      providerMutationPerformed: false,
      currentRunEvidence: true,
      certified: true,
      releaseStatus: "release_certified",
      gateCount: 15,
      missingGateCount: 0,
      invalidGateCount: 0,
      liveReleaseAuthorized: false,
      requiresExplicitReleaseAuthority: true,
      releaseIdentitySha256: proof("f"),
      ledgerSha256: proof("0"),
      evidenceSha256: proof("0"),
      predecessorEvidenceSha256s,
    });
  }
  return result;
}

function bootstrapPartialCleanupResult(operation, state, priorResults) {
  const result = fakeResult(operation, state, priorResults);
  if (operation.id === "restore-endpoints-max-one")
    Object.assign(result, {
      productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
      productionResourcesAbsent: true,
      bothEndpointsMaxWorkersOne: false,
      retainedProductionEndpoints: 0,
    });
  if (operation.id !== "reconcile-exact-resources") return result;
  const cleanupBody = {
    schemaVersion: "videoforge.v213-database-role-credential-cleanup/v1",
    fullLiveAuthorityId: state.full_live_authority_id,
    cleanupState: "ALREADY_ABSENT",
    operatorRoleAbsent: true,
    runtimeAndReconcilerRolesAbsent: true,
    credentialBundleSha256: null,
    removedArtifactCount: 0,
  };
  const cleanupSha256 = hash(Buffer.from(canonicalJson(cleanupBody)));
  result.evidenceSha256 = proof("e");
  result.localDatabaseCredentialCleanup = { ...cleanupBody, cleanupSha256 };
  result.proofSha256 = hash(
    Buffer.from(
      canonicalJson({
        providerCleanupEvidenceSha256: result.evidenceSha256,
        localDatabaseCredentialCleanupSha256: cleanupSha256,
      }),
    ),
  );
  return result;
}

test("the resealed graph has exactly 26 operations and certifies only after reconciliation", () => {
  assert.equal(OPERATIONS.length, 26);
  assert.deepEqual(
    OPERATIONS.slice(-6).map(({ id, reserveUsd }) => [id, reserveUsd]),
    [
      ["v2-13-final-two-lane-smoke", 2],
      ["restore-endpoints-max-one", 0],
      ["prove-zero-workers", 0],
      ["read-settled-billing", 0],
      ["reconcile-exact-resources", 0],
      ["certify-v2-13-release", 0],
    ],
  );
  assert.equal(OPERATIONS.at(-1).phase, "cleanup_and_reconciliation");
});

function certificationPredecessorFixture() {
  const promotionCleanup = qualifiedProductionCleanupProof();
  return new Map([
    [
      "v2-13-final-two-lane-smoke",
      {
        schemaVersion: "videoforge.v213-fresh-two-lane-smoke-result/v1",
        smokeOnly: true,
        releaseCertified: false,
        twoLaneSmoke: true,
        evidenceSha256: proof("a"),
        signedSmokeEvidenceSha256: proof("a"),
      },
    ],
    [
      "restore-endpoints-max-one",
      {
        proofSha256: proof("b"),
        productionCleanupState: "EXACT_MAX_ONE_PAIR_RETAINED",
        productionResourcesAbsent: false,
        bothEndpointsMaxWorkersOne: true,
        retainedProductionEndpoints: 2,
        qualifiedProductionCleanup: promotionCleanup,
        promotionCleanupEvidenceSha256: promotionCleanup.proofSha256,
      },
    ],
    ["prove-zero-workers", { proofSha256: proof("c"), zeroWorkers: true }],
    ["read-settled-billing", { proofSha256: proof("d"), withinCumulativeCap: true }],
    [
      "reconcile-exact-resources",
      {
        proofSha256: proof("e"),
        onlyApprovedRetainedVolumes: true,
        qualifiedProductionCleanup: promotionCleanup,
        promotionCleanupEvidenceSha256: promotionCleanup.proofSha256,
      },
    ],
  ]);
}

test("final certification requires the exact five current-run predecessor receipts", () => {
  const results = certificationPredecessorFixture();
  assert.deepEqual(certificationPredecessorEvidence(results), {
    "v2-13-final-two-lane-smoke": proof("a"),
    "restore-endpoints-max-one": proof("b"),
    "prove-zero-workers": proof("c"),
    "read-settled-billing": proof("d"),
    "reconcile-exact-resources": proof("e"),
  });
  results.delete("read-settled-billing");
  assert.throws(
    () => certificationPredecessorEvidence(results),
    /CERTIFICATION_PREDECESSOR:read-settled-billing/u,
  );
});

test("production resource absence is explicit at every cleanup and certification boundary", () => {
  const results = certificationPredecessorFixture();
  delete results.get("restore-endpoints-max-one").productionResourcesAbsent;
  assert.throws(
    () => certificationPredecessorEvidence(results),
    /CERTIFICATION_PREDECESSOR_STATE/u,
  );
  assert.throws(() => cleanupProofEvidence(results), /CLEANUP_PROOF_READBACK/u);

  const operation = OPERATIONS.find(({ id }) => id === "restore-endpoints-max-one");
  const restoration = {
    actualUsd: 0,
    proofSha256: proof("b"),
    productionCleanupState: "EXACT_MAX_ONE_PAIR_RETAINED",
    bothEndpointsMaxWorkersOne: true,
    retainedProductionEndpoints: 2,
  };
  assert.throws(
    () => assertResult(operation, restoration, {}, new Map()),
    /CLEANUP_PRODUCTION_STATE/u,
  );
});

test("final certification rejects a ledger bound to an extra or different receipt", () => {
  const operation = OPERATIONS.at(-1);
  const results = certificationPredecessorFixture();
  const result = fakeResult(operation, {}, results);
  result.predecessorEvidenceSha256s = {
    ...result.predecessorEvidenceSha256s,
    "unexpected-future-operation": proof("9"),
  };
  assert.throws(
    () => assertResult(operation, result, {}, results),
    /RELEASE_CERTIFICATION_READBACK/u,
  );
});

test("the smoke operation cannot claim release certification", () => {
  const operation = OPERATIONS.find(({ id }) => id === "v2-13-final-two-lane-smoke");
  const priorResults = new Map([
    [
      "create-exact-max-one-endpoints",
      {
        materialization: {
          production: {
            mage: structuredClone(endpointBindingsFixture[0]),
            soulx: structuredClone(endpointBindingsFixture[1]),
          },
        },
      },
    ],
  ]);
  const outerStateSha256 = proof("c");
  const checkedAt = "2026-08-26T12:00:00.000Z";
  const mutationAdmission = mutationAdmissionFixture({
    operation,
    priorResults,
    outerStateSha256,
    trustedTime: checkedAt,
  });
  const authorityId = "v2-13-test-executor-0001";
  const workId = `${authorityId}:${operation.id}`.toLowerCase();
  const state = {
    authority_id: authorityId,
    approved_at: "2026-08-26T00:00:00.000Z",
    expires_at: "2026-08-27T00:00:00.000Z",
    phases: {
      [operation.phase]: {
        work: {
          [workId]: {
            authorization_event_id: `${workId}:reserved-${mutationAdmission.proofSha256.slice(7)}`,
          },
        },
      },
    },
  };
  const result = {
    actualUsd: 2,
    accepted: true,
    terminal: true,
    zeroWorkersAfter: true,
    evidenceSha256: proof("a"),
    schemaVersion: "videoforge.v213-fresh-two-lane-smoke-result/v1",
    twoLaneSmoke: true,
    smokeOnly: true,
    releaseCertified: true,
    signedSmokeEvidenceSha256: proof("a"),
    mutationAdmission,
    mutationAdmissionProofSha256: mutationAdmission.proofSha256,
    mutationAdmissionCheckedAt: checkedAt,
  };
  assert.throws(
    () =>
      assertResult(operation, result, state, priorResults, {
        authorizedOuterStateSha256: outerStateSha256,
        mutationAdmission,
      }),
    /V2_13_SCOPE/u,
  );
});

test("default command performs zero actions and reports every concrete tooling gap", () => {
  const result = spawnSync(process.execPath, ["deploy/v2-13/full-live-executor.mjs"], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(
    { state: output.state, external_calls: output.external_calls, mutations: output.mutations },
    { state: "NO_ACTION", external_calls: 0, mutations: 0 },
  );
  assert.deepEqual(output.missing_concrete_tools, missingConcreteTools());
  assert.equal(output.ordered_operations.length, OPERATIONS.length);
  assert.equal(output.ordered_operations.length, 26);
  assert.equal(output.ordered_operations.at(-1).id, "certify-v2-13-release");
});

test("approval commit result requires the exact v4 branch and rejects the stale branch", () => {
  const operation = OPERATIONS.find(({ id }) => id === "approval-commit-push");
  const state = { authority_record_commit: "3".repeat(40) };
  const accepted = {
    actualUsd: 0,
    commit: state.authority_record_commit,
    exactRemoteReadback: true,
    branch: "codex/serverless-v2-roadmap-v4",
  };

  assert.equal(assertResult(operation, accepted, state, new Map()), accepted);
  assert.throws(
    () =>
      assertResult(
        operation,
        { ...accepted, branch: "codex/serverless-v2-roadmap" },
        state,
        new Map(),
      ),
    /APPROVAL_COMMIT_READBACK/u,
  );
});

test("workflow dispatch result durably binds the full canonical fresh dual-workflow proof", () => {
  const operation = OPERATIONS.find(({ id }) => id === "mage-image-workflow-dispatch");
  const registration = workflowRegistrationEvidenceFixture();
  const state = {
    release_source_commit: "a".repeat(40),
    soulx_workflow_registration_evidence: registration,
    soulx_workflow_registration_evidence_sha256: registration.evidence_sha256,
  };
  const accepted = fakeResult(operation, state, new Map());
  assert.equal(assertResult(operation, accepted, state, new Map()), accepted);

  const tampered = [
    { ...accepted, freshWorkflowReadback: undefined },
    {
      ...accepted,
      freshWorkflowReadback: {
        ...accepted.freshWorkflowReadback,
        releaseSourceCommit: "b".repeat(40),
      },
    },
    {
      ...accepted,
      freshWorkflowReadback: {
        ...accepted.freshWorkflowReadback,
        workflows: accepted.freshWorkflowReadback.workflows.toReversed(),
      },
    },
    {
      ...accepted,
      freshWorkflowReadback: {
        ...accepted.freshWorkflowReadback,
        workflows: accepted.freshWorkflowReadback.workflows.map((workflow, index) =>
          index === 1 ? { ...workflow, workflowSha256: proof("6") } : workflow,
        ),
      },
    },
    { ...accepted, freshWorkflowReadbackSha256: proof("7") },
    { ...accepted, workflowRegistrationEvidenceSha256: proof("8") },
  ];
  for (const result of tampered)
    assert.throws(
      () => assertResult(operation, result, state, new Map()),
      /WORKFLOW_FRESH_READBACK/u,
    );
});

test("fresh preflight rejects a Serverless Flex rate above the exact current snapshot", () => {
  const operation = OPERATIONS.find(({ id }) => id === "fresh-live-preflight");
  assert.throws(
    () =>
      assertResult(
        operation,
        {
          actualUsd: 0,
          exactGpu: "NVIDIA GeForce RTX 4090",
          region: "EU-RO-1",
          availability: "LOW",
          flexUsdPerGpuHour: 1.116001,
          noFallback: true,
          inventorySha256: proof("6"),
          billingBaselineSha256: proof("7"),
        },
        {},
        new Map(),
      ),
    /PREFLIGHT_READBACK/u,
  );
});

test("all attributable production absent closes cleanup-only but never certifies normal release", async () => {
  const fixture = stateFixture();
  try {
    let certificationCalls = 0;
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          if (operation.id === "certify-v2-13-release") certificationCalls += 1;
          const value = fakeResult(operation, state, priorResults);
          if (operation.id === "restore-endpoints-max-one")
            Object.assign(value, {
              productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
              productionResourcesAbsent: true,
              bothEndpointsMaxWorkersOne: false,
              retainedProductionEndpoints: 0,
            });
          return value;
        },
      }),
      /CERTIFICATION_PREDECESSOR_STATE/u,
    );
    const interrupted = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(interrupted.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.notEqual(interrupted.cleanup_proof, null);
    assert.equal(interrupted.release_certification, null);
    assert.equal(certificationCalls, 0);

    const resumedCalls = [];
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async (operation) => {
        resumedCalls.push(operation.id);
        throw new Error("settled cleanup must not rerun");
      },
    });
    assert.deepEqual(resumedCalls, []);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(resumed.state.cleanup_proof.cleanup_work_ids.length, 4);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("cleanup proof rejects a production cleanup state that disagrees with retained resources", () => {
  const operation = OPERATIONS.find(({ id }) => id === "restore-endpoints-max-one");
  assert.throws(
    () =>
      assertResult(
        operation,
        {
          actualUsd: 0,
          proofSha256: proof("b"),
          productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
          productionResourcesAbsent: true,
          bothEndpointsMaxWorkersOne: false,
          retainedProductionEndpoints: 1,
        },
        {},
        new Map(),
      ),
    /CLEANUP_PRODUCTION_STATE/u,
  );
  assert.throws(
    () =>
      assertResult(
        operation,
        {
          actualUsd: 0,
          proofSha256: proof("b"),
          productionCleanupState: "UNEXPECTED_STATE",
          bothEndpointsMaxWorkersOne: true,
          retainedProductionEndpoints: 2,
        },
        {},
        new Map(),
      ),
    /CLEANUP_PRODUCTION_STATE/u,
  );
});

test("bootstrap partial cleanup accepts the adapter maximum and rejects overflow", () => {
  const operation = OPERATIONS.find(({ id }) => id === "reconcile-exact-resources");
  const state = {
    authority_id: "v2-13-test-executor-0001",
    operator_role_verified: false,
    state: "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
    phases: {
      bootstrap_prequalification_database: {
        work: {
          "v2-13-test-executor-0001:bootstrap-prequalification-database": {
            state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE",
          },
        },
      },
    },
  };
  const base = bootstrapPartialCleanupResult(operation, state, new Map());
  const withRemovedArtifactCount = (removedArtifactCount) => {
    const cleanup = {
      ...base.localDatabaseCredentialCleanup,
      cleanupState: "REMOVED_AUTHORITY_BOUND_FILES",
      credentialBundleSha256: proof("a"),
      removedArtifactCount,
    };
    const cleanupBody = { ...cleanup };
    delete cleanupBody.cleanupSha256;
    cleanup.cleanupSha256 = hash(Buffer.from(canonicalJson(cleanupBody)));
    const result = {
      ...base,
      localDatabaseCredentialCleanup: cleanup,
    };
    result.proofSha256 = hash(
      Buffer.from(
        canonicalJson({
          providerCleanupEvidenceSha256: result.evidenceSha256,
          localDatabaseCredentialCleanupSha256: cleanup.cleanupSha256,
        }),
      ),
    );
    return result;
  };

  assert.doesNotThrow(() =>
    assertResult(operation, withRemovedArtifactCount(26), state, new Map()),
  );
  assert.doesNotThrow(() =>
    assertResult(operation, withRemovedArtifactCount(56), state, new Map()),
  );
  const secretOnly = withRemovedArtifactCount(44);
  secretOnly.localDatabaseCredentialCleanup.credentialBundleSha256 = null;
  const secretOnlyBody = { ...secretOnly.localDatabaseCredentialCleanup };
  delete secretOnlyBody.cleanupSha256;
  secretOnly.localDatabaseCredentialCleanup.cleanupSha256 = hash(
    Buffer.from(canonicalJson(secretOnlyBody)),
  );
  secretOnly.proofSha256 = hash(
    Buffer.from(
      canonicalJson({
        providerCleanupEvidenceSha256: secretOnly.evidenceSha256,
        localDatabaseCredentialCleanupSha256:
          secretOnly.localDatabaseCredentialCleanup.cleanupSha256,
      }),
    ),
  );
  assert.throws(
    () => assertResult(operation, secretOnly, state, new Map()),
    /PREQUALIFICATION_PARTIAL_CLEANUP_READBACK/u,
  );
  assert.throws(
    () => assertResult(operation, withRemovedArtifactCount(57), state, new Map()),
    /PREQUALIFICATION_PARTIAL_CLEANUP_READBACK/u,
  );
});

test("execute mode has a closed concrete catalog and requires exact state binding", () => {
  const result = spawnSync(
    process.execPath,
    [
      "deploy/v2-13/full-live-executor.mjs",
      "--execute",
      "--confirm",
      "EXECUTE_EXACT_V2_13_FULL_LIVE_ONCE",
    ],
    { encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /EXPECTED_STATE_SHA256/u);
  assert.doesNotMatch(result.stderr, /STATE_FILE|ENOENT/u);
});

test("global protected-input preflight enters endpoint-free cleanup before normal operations", async () => {
  const fixture = stateFixture();
  let calls = 0;
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      preflight: async (_state, _sha256, mode) => {
        if (mode.initial) throw new Error("PROTECTED_INPUT_MISSING");
      },
      runOperation: async () => {
        calls += 1;
        throw new Error("must not run");
      },
      runCleanupOperation: async (operation, state, priorResults) =>
        fakeResult(operation, state, priorResults),
    });
    assert.equal(calls, 0);
    assert.equal(result.failed, true);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("durable cancellation before initial work authorizes no normal operation and completes cleanup", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      isCancelled: () => true,
      runOperation: async (operation, state, priorResults) => {
        called.push(operation.id);
        assert.equal(operation.phase, "cleanup_and_reconciliation");
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(result.failed, true);
    assert.equal(result.state.failure_boundary, "CANCELLATION_REQUESTED");
    assert.equal(result.state.failure_code, "CANCELLATION_REQUESTED");
    assert.deepEqual(called, [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("cancellation after one settled operation never authorizes the next normal operation", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      isCancelled: (state) =>
        Object.values(state.phases.publication.work).some(
          (work) => work.state === "SETTLED_TERMINAL",
        ),
      runOperation: async (operation, state, priorResults) => {
        called.push(operation.id);
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(result.failed, true);
    assert.equal(called[0], "release-tag-create");
    assert.equal(called.includes("release-tag-push"), false);
    assert.deepEqual(called.slice(1), [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("durable cancellation record survives restart and remains authority-bound", () => {
  const fixture = stateFixture();
  const recordPath = `${fixture.path}.cancellation.json`;
  try {
    const source = createDurableCancellationSource({
      statePath: fixture.path,
      recordPath,
      now: () => new Date("2026-08-26T12:00:00.000Z"),
    });
    const record = source.request("INJECTED_SOURCE");
    assert.equal(record.source, "INJECTED_SOURCE");
    assert.equal(record.fullLiveAuthorityId, "11111111-1111-4111-8111-111111111111");
    assert.equal(source.signal.aborted, true);
    const restarted = createDurableCancellationSource({ statePath: fixture.path, recordPath });
    assert.equal(restarted.isCancelled(), true);
    assert.equal(restarted.signal.aborted, true);
    assert.equal(
      readDurableCancellationRecord({
        path: recordPath,
        authorityId: "v2-13-test-executor-0001",
        fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      }).recordSha256,
      record.recordSha256,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("cancellation during an external wait enters cleanup-only without settling or redispatch", async () => {
  const fixture = stateFixture();
  const cancellation = createDurableCancellationSource({
    statePath: fixture.path,
    recordPath: `${fixture.path}.cancellation.json`,
    now: () => new Date("2026-08-26T12:00:00.000Z"),
  });
  const normal = [];
  const cleanup = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      cancellationSignal: cancellation.signal,
      isCancelled: cancellation.isCancelled,
      recordCancellation: () => cancellation.record() ?? cancellation.request("INJECTED_SOURCE"),
      runOperation: async (operation, _state, _priorResults, _outerStateSha256, context) => {
        normal.push(operation.id);
        assert.equal(context.cancellationSignal instanceof AbortSignal, true);
        assert.equal(context.cancellationSignal.aborted, false);
        setImmediate(() => cancellation.request("INJECTED_SOURCE"));
        return new Promise((_resolve, reject) => {
          context.cancellationSignal.addEventListener(
            "abort",
            () => reject(new Error("cancelled external wait")),
            { once: true },
          );
        });
      },
      runCleanupOperation: async (operation, state, priorResults) => {
        cleanup.push(operation.id);
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(normal, ["release-tag-create"]);
    assert.deepEqual(cleanup, [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
    assert.equal(result.state.failure_boundary, "CANCELLATION_REQUESTED");
    assert.equal(result.state.failure_code, "CANCELLATION_REQUESTED");
    const publicationWork = Object.values(result.state.phases.publication.work);
    assert.equal(publicationWork.length, 1);
    assert.equal(publicationWork[0].state, "AUTHORIZED_ONCE_NOT_REDISPATCHABLE");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("post-promotion op22/op25 reject missing, non-503, or unbound rollback evidence", () => {
  const state = { full_live_authority_id: "11111111-1111-4111-8111-111111111111" };
  const results = new Map([["promote-qualified-production", { state: "QUALIFIED_EXACT" }]]);
  for (const operationId of ["restore-endpoints-max-one", "reconcile-exact-resources"]) {
    const operation = OPERATIONS.find(({ id }) => id === operationId);
    const exact = fakeResult(operation, state, results);
    const missing = { ...exact };
    delete missing.qualifiedProductionCleanup;
    delete missing.promotionCleanupEvidenceSha256;
    assert.throws(
      () => assertResult(operation, missing, state, results),
      /PROMOTION_CLEANUP_CLOSURE_MISSING/u,
    );
    const routeDrift = {
      ...exact,
      qualifiedProductionCleanup: {
        ...exact.qualifiedProductionCleanup,
        routeStatus: 200,
      },
    };
    assert.throws(
      () => assertResult(operation, routeDrift, state, results),
      /QUALIFIED_PRODUCTION_CLEANUP_PROOF/u,
    );
    assert.throws(
      () =>
        assertResult(
          operation,
          { ...exact, promotionCleanupEvidenceSha256: proof("9") },
          state,
          results,
        ),
      /QUALIFIED_PRODUCTION_CLEANUP_EVIDENCE/u,
    );
  }
});

test("cleanup proof accepts exact promotion absence only when rollback is not required", () => {
  const absence = promotionCleanupAbsenceProof();
  const results = new Map([
    [
      "restore-endpoints-max-one",
      {
        proofSha256: proof("b"),
        productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
        productionResourcesAbsent: true,
        bothEndpointsMaxWorkersOne: false,
        retainedProductionEndpoints: 0,
        promotionCleanupAbsence: absence,
        promotionCleanupAbsenceEvidenceSha256: absence.proofSha256,
      },
    ],
    ["prove-zero-workers", { proofSha256: proof("c"), zeroWorkers: true }],
    ["read-settled-billing", { proofSha256: proof("d"), withinCumulativeCap: true }],
    [
      "reconcile-exact-resources",
      {
        proofSha256: proof("e"),
        onlyApprovedRetainedVolumes: true,
        promotionCleanupAbsence: absence,
        promotionCleanupAbsenceEvidenceSha256: absence.proofSha256,
      },
    ],
  ]);
  assert.doesNotThrow(() =>
    cleanupProofEvidence(results, { requireQualifiedProductionCleanup: true }),
  );
  results.set("promote-qualified-production", { state: "QUALIFIED_EXACT" });
  assert.throws(
    () => cleanupProofEvidence(results, { requireQualifiedProductionCleanup: true }),
    /PROMOTION_CLEANUP_ABSENCE_INVALID/u,
  );
});

test("early cleanup is selected only when no RunPod mutation operation has history", async () => {
  const fixture = stateFixture();
  const selected = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      preflight: async (_state, _sha256, mode) => {
        if (mode.initial) throw new Error("PROTECTED_INPUT_MISSING");
      },
      runOperation: async () => {
        throw new Error("must not run");
      },
      runCleanupOperation: async (operation, state, priorResults) => {
        selected.push("normal");
        return fakeResult(operation, state, priorResults);
      },
      runEarlyCleanupOperation: async (
        operation,
        state,
        priorResults,
        _outerStateSha256,
        context,
      ) => {
        selected.push("early");
        assert.equal(context.cleanupMode, "EARLY_NO_DATABASE_CLEANUP");
        assert.equal(context.providerDispatchForbidden, true);
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(selected, ["early", "early", "early", "early"]);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("early cleanup provider-proof failure cannot mark cleanup complete", async () => {
  const fixture = stateFixture();
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        preflight: async (_state, _sha256, mode) => {
          if (mode.initial) throw new Error("PROTECTED_INPUT_MISSING");
        },
        runOperation: async () => {
          throw new Error("must not run");
        },
        runEarlyCleanupOperation: async (_operation, _state, _prior, _outer, context) => {
          assert.equal(context.providerDispatchForbidden, true);
          throw new Error("RUNPOD_READBACK_UNAVAILABLE");
        },
      }),
      /RUNPOD_READBACK_UNAVAILABLE/u,
    );
    const persisted = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(persisted.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.equal(persisted.cleanup_proof, null);
    assert.notEqual(persisted.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("authorized bootstrap crash resumes exactly one readback-only reconciliation", async () => {
  const fixture = stateFixture();
  const crashStatePath = join(fixture.directory, "bootstrap-committed-crash-state.json");
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults, outerStateSha256) => {
          if (operation.id === "bootstrap-prequalification-database") {
            assert.equal(outerStateSha256, hash(readFileSync(fixture.path)));
            writeFileSync(crashStatePath, readFileSync(fixture.path), { mode: 0o600 });
            throw new Error("simulated hard crash after atomic bootstrap commit");
          }
          if (operation.id === "restore-endpoints-max-one")
            throw new Error("stop abandoned in-process cleanup");
          return fakeResult(operation, state, priorResults);
        },
      }),
      /stop abandoned in-process cleanup/u,
    );
    const crashed = JSON.parse(readFileSync(crashStatePath, "utf8"));
    const bootstrapWork =
      crashed.phases.bootstrap_prequalification_database.work[
        `${crashed.authority_id}:bootstrap-prequalification-database`
      ];
    assert.equal(crashed.state, "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS");
    assert.equal(bootstrapWork.state, "AUTHORIZED_ONCE_NOT_REDISPATCHABLE");
    assert.equal(crashed.operator_role_verified, false);

    let reconciliationCalls = 0;
    let reconciliationPreflights = 0;
    const resumed = await executeFullLive({
      statePath: crashStatePath,
      expectedStateSha256: hash(readFileSync(crashStatePath)),
      preflight: async (_state, _sha256, mode) => {
        if (mode.bootstrapOnly) {
          reconciliationPreflights += 1;
          assert.equal(mode.bootstrapReconciliation, true);
        }
      },
      runOperation: async (operation, state, priorResults, outerStateSha256, context) => {
        if (operation.id === "bootstrap-prequalification-database") {
          reconciliationCalls += 1;
          assert.equal(context.resumed, true);
          assert.equal(context.authorizedUnsettled, true);
          assert.equal(context.reconciliationOnly, true);
          assert.equal(context.providerDispatchForbidden, true);
          const value = fakeResult(operation, state, priorResults);
          value.outer_state_sha256 = outerStateSha256;
          value.ledger_before_count = 46;
          value.recovery_mode = "VERIFIED_EXISTING_46";
          return value;
        }
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(reconciliationPreflights, 1);
    assert.equal(reconciliationCalls, 1);
    assert.equal(resumed.state.operator_role_verified, true);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_COMPLETE");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("lost bootstrap transaction acknowledgement reconciles before cleanup-only becomes irreversible", async () => {
  const fixture = stateFixture();
  let bootstrapCalls = 0;
  let earlyCleanupCalls = 0;
  try {
    const completed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      runOperation: async (operation, state, priorResults, _outerStateSha256, context) => {
        if (operation.id === "bootstrap-prequalification-database") {
          bootstrapCalls += 1;
          if (bootstrapCalls === 1) throw new Error("simulated lost psql commit acknowledgement");
          assert.equal(context.resumed, true);
          assert.equal(context.authorizedUnsettled, true);
          assert.equal(context.reconciliationOnly, true);
          assert.equal(context.providerDispatchForbidden, true);
          const reconciled = fakeResult(operation, state, priorResults);
          reconciled.ledger_before_count = 46;
          reconciled.recovery_mode = "VERIFIED_EXISTING_46";
          return reconciled;
        }
        return fakeResult(operation, state, priorResults);
      },
      runEarlyCleanupOperation: async () => {
        earlyCleanupCalls += 1;
        throw new Error("cleanup must not run after an exact bootstrap readback");
      },
    });
    assert.equal(bootstrapCalls, 2);
    assert.equal(earlyCleanupCalls, 0);
    assert.equal(completed.failed, false);
    assert.equal(completed.state.state, "CONSUMED_SINGLE_EXECUTION_COMPLETE");
    assert.equal(completed.state.operator_role_verified, true);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("absent-role bootstrap crash enters distinct owner-readback partial cleanup mode", async () => {
  const fixture = stateFixture();
  const crashStatePath = join(fixture.directory, "bootstrap-absent-role-crash-state.json");
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          if (operation.id === "bootstrap-prequalification-database") {
            writeFileSync(crashStatePath, readFileSync(fixture.path), { mode: 0o600 });
            throw new Error("simulated hard crash before role transaction");
          }
          if (operation.id === "restore-endpoints-max-one")
            throw new Error("stop abandoned in-process cleanup");
          return fakeResult(operation, state, priorResults);
        },
      }),
      /stop abandoned in-process cleanup/u,
    );

    const cleanupModes = [];
    let bootstrapReconciliationCalls = 0;
    const resumed = await executeFullLive({
      statePath: crashStatePath,
      expectedStateSha256: hash(readFileSync(crashStatePath)),
      preflight: async (_state, _sha256, mode) => {
        assert.equal(mode.bootstrapOnly, true);
        assert.equal(mode.bootstrapReconciliation, true);
      },
      runOperation: async (operation, _state, _priorResults, _outerStateSha256, context) => {
        assert.equal(operation.id, "bootstrap-prequalification-database");
        bootstrapReconciliationCalls += 1;
        assert.equal(context.reconciliationOnly, true);
        throw new Error("readback proves operator role absent");
      },
      runEarlyCleanupOperation: async (
        operation,
        state,
        priorResults,
        _outerStateSha256,
        context,
      ) => {
        cleanupModes.push(context.cleanupMode);
        assert.equal(context.cleanupOnly, true);
        assert.equal(context.earlyFailure, true);
        assert.equal(context.endpointFree, true);
        assert.equal(context.providerDispatchForbidden, true);
        return bootstrapPartialCleanupResult(operation, state, priorResults);
      },
    });
    assert.equal(bootstrapReconciliationCalls, 1);
    assert.deepEqual(cleanupModes, Array(4).fill("BOOTSTRAP_PARTIAL_CLEANUP"));
    assert.equal(resumed.failed, true);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.deepEqual(resumed.results.get("failure"), {
      failure_boundary: "BOOTSTRAP_RECONCILIATION",
      failure_code: "FULL_LIVE_OPERATION_FAILED",
    });
    assert.equal(
      resumed.results.get("reconcile-exact-resources").localDatabaseCredentialCleanup
        .operatorRoleAbsent,
      true,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("an authorized RunPod mutation operation disables the fabricated early proof", () => {
  const fixture = stateFixture();
  try {
    const state = JSON.parse(readFileSync(fixture.path, "utf8"));
    const workId = `${state.authority_id}:mage-live-qualification`.toLowerCase();
    state.phases.mage_qualification.work[workId] = {
      state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE",
    };
    assert.equal(runPodMutationBoundaryReached(state), true);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("read-only history does not cross the RunPod mutation boundary", () => {
  const fixture = stateFixture();
  try {
    const state = JSON.parse(readFileSync(fixture.path, "utf8"));
    const workId = `${state.authority_id}:fresh-live-preflight`.toLowerCase();
    state.phases.mage_qualification.work[workId] = {
      state: "SETTLED_TERMINAL",
    };
    assert.equal(runPodMutationBoundaryReached(state), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("expired authenticated time enters cleanup-only before any normal mutation operation", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      trustedTime: async () => "2026-08-27T00:00:01.000Z",
      verifyMaterializationSeed: async () => true,
      verifyStaticReleaseDescriptor: async () => true,
      runOperation: async (operation, current, prior) => {
        called.push(operation.id);
        return fakeResult(operation, current, prior);
      },
    });
    assert.deepEqual(called, [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
    assert.equal(called.includes("certify-v2-13-release"), false);
    assert.equal(result.failed, true);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(result.state.failure_boundary, "PHASE_MUTATION_TRUSTED_TIME");
    assert.equal(result.state.failure_code, "TRUSTED_TIME_EXPIRED_OR_FORGED");
    assert.equal(result.state.cleanup_failure_code, result.state.failure_code);
    assert.equal(result.state.phases.publication.state, "FAILED_CLEANUP_ONLY");
    assert.deepEqual(
      Object.values(result.state.phases)
        .flatMap((phase) => Object.keys(phase.work))
        .filter(
          (id) =>
            !id.includes(":restore-endpoints-max-one") &&
            !id.includes(":prove-zero-workers") &&
            !id.includes(":read-settled-billing") &&
            !id.includes(":reconcile-exact-resources"),
        ),
      [],
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("initial preflight failure records only a bounded diagnostic and enters early cleanup", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      preflight: async (_state, _sha256, mode) => {
        assert.equal(mode.initial, true);
        throw new Error("V2_13_FULL_LIVE_ADAPTER_PREFLIGHT_CONTRACT:/private/credential/path");
      },
      runOperation: async (operation, state, priorResults) => {
        called.push(operation.id);
        if (operation.phase !== "cleanup_and_reconciliation")
          throw new Error("unexpected normal work");
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(result.failed, true);
    assert.equal(result.state.failure_boundary, "INITIAL_PREFLIGHT");
    assert.equal(result.state.failure_code, "PREFLIGHT_CONTRACT");
    assert.deepEqual(result.results.get("failure"), {
      failure_boundary: "INITIAL_PREFLIGHT",
      failure_code: "PREFLIGHT_CONTRACT",
    });
    assert.doesNotMatch(JSON.stringify(result.results.get("failure")), /credential|private|path/u);
    assert.doesNotMatch(readFileSync(fixture.path, "utf8"), /\/private\/credential\/path/u);
    assert.deepEqual(called, [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("initial seed failure records its exact safe code without retaining exception text", async () => {
  const fixture = stateFixture();
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      verifyMaterializationSeed: async () => {
        throw new Error(
          "V2_13_FULL_LIVE_ORCHESTRATION_MATERIALIZATION_SEED_HASH:/private/seed-secret",
        );
      },
      runOperation: async (operation, state, priorResults) =>
        fakeResult(operation, state, priorResults),
    });
    assert.equal(result.failed, true);
    assert.equal(result.state.failure_boundary, "INITIAL_MATERIALIZATION_SEED");
    assert.equal(result.state.failure_code, "MATERIALIZATION_SEED_HASH");
    assert.equal(result.state.cleanup_failure_code, "MATERIALIZATION_SEED_HASH");
    assert.doesNotMatch(readFileSync(fixture.path, "utf8"), /seed-secret|private/u);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("cleanup-only restart skips every publication, qualification, and acceptance operation", async () => {
  const fixture = stateFixture();
  try {
    const state = enterCleanupOnly(JSON.parse(readFileSync(fixture.path, "utf8")), {
      failureBoundary: "TEST_OPERATION_EXECUTION",
      failureCode: "TEST_RESTART",
      eventId: "v2-13-test-executor-0001:cleanup-entry:failed",
    });
    writeFileSync(fixture.path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    const called = [];
    let seedVerifierCalls = 0;
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      verifyMaterializationSeed: async () => {
        seedVerifierCalls += 1;
        throw new Error("V2_13_FULL_LIVE_ORCHESTRATION_MATERIALIZATION_SEED_HASH");
      },
      verifyStaticReleaseDescriptor: async () => {
        throw new Error("V2_13_FULL_LIVE_ORCHESTRATION_STATIC_RELEASE_DESCRIPTOR_HASH");
      },
      runOperation: async (operation, current, prior) => {
        called.push(operation.id);
        return fakeResult(operation, current, prior);
      },
    });
    assert.deepEqual(called, [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
    assert.equal(seedVerifierCalls, 0);
    assert.equal(called.includes("certify-v2-13-release"), false);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("authority-bound executor source drift fails the state contract before the fake runner", async () => {
  const fixture = stateFixture();
  try {
    const state = JSON.parse(readFileSync(fixture.path, "utf8"));
    state.full_live_executor_sha256 = proof("0");
    writeFileSync(fixture.path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    let calls = 0;
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: hash(readFileSync(fixture.path)),
        runOperation: async () => {
          calls += 1;
          return {};
        },
      }),
      /STATE_CONTRACT/u,
    );
    assert.equal(calls, 0);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("fake command integration preserves the exact graph and terminal cleanup proof", async () => {
  const fixture = stateFixture();
  const called = [];
  const preflights = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      preflight: async (_state, _sha256, mode, priorResults) => {
        preflights.push({ mode, priorOperationIds: [...priorResults.keys()] });
      },
      runOperation: async (operation, state, priorResults) => {
        called.push(operation.id);
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(
      called,
      OPERATIONS.map(({ id }) => id),
    );
    assert.equal(result.failed, false);
    assert.equal(
      result.state.state,
      "CONSUMED_SINGLE_EXECUTION_COMPLETE",
      JSON.stringify(result.results.get("failure") ?? null),
    );
    assert.equal(result.state.total_reserved_usd, 17.5);
    assert.equal(result.state.total_settled_usd, 17.5);
    assert.equal(result.state.cleanup_proof.zero_worker_proof_sha256, proof("c"));
    assert.deepEqual(result.state.cleanup_proof.cleanup_work_ids, [
      "v2-13-test-executor-0001:prove-zero-workers",
      "v2-13-test-executor-0001:read-settled-billing",
      "v2-13-test-executor-0001:reconcile-exact-resources",
      "v2-13-test-executor-0001:restore-endpoints-max-one",
    ]);
    assert.equal(
      result.state.release_certification.work_id,
      "v2-13-test-executor-0001:certify-v2-13-release",
    );
    assert.equal(result.state.release_certification.state, "SETTLED_TERMINAL");
    assert.equal(
      result.state.work_ids.includes("v2-13-test-executor-0001:certify-v2-13-release"),
      true,
    );
    assert.equal(result.state.work_ids.length, 26);
    assert.equal(called.at(-1), "certify-v2-13-release");
    assert.equal(preflights.length, 2);
    assert.equal(preflights[0].mode.initial, true);
    assert.deepEqual(preflights[0].priorOperationIds, []);
    assert.equal(preflights[1].mode.staged, true);
    assert.equal(
      preflights[1].priorOperationIds.includes("bootstrap-prequalification-database"),
      true,
    );
    assert.equal(preflights[1].priorOperationIds.includes("fresh-live-preflight"), true);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("prequalification receipt checks keep the execution and live identities bound on both paths", async () => {
  const executorSource = readFileSync("deploy/v2-13/full-live-executor.mjs", "utf8");
  assert.match(
    executorSource,
    /if \(mode\.staged === true\)[\s\S]{0,240}verifyPrequalificationDatabaseReceipt\(\{[\s\S]{0,120}environment: process\.env,[\s\S]{0,80}state,[\s\S]{0,80}priorResults,/u,
  );
  assert.match(
    executorSource,
    /verifyPrequalificationReceipt: async \(state,[\s\S]{0,180}verifyPrequalificationDatabaseReceipt\(\{[\s\S]{0,120}environment: process\.env,[\s\S]{0,80}state,[\s\S]{0,80}priorResults,/u,
  );
  const fixture = stateFixture();
  const expectedAuthorityId = "v2-13-test-executor-0001";
  const expectedFullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
  const exactReceipt = Object.freeze({
    schema_version: "videoforge.v213-prequalification-database-bootstrap-result/v3",
    full_live_authority_id: expectedFullLiveAuthorityId,
    prequalification_database_bootstrap_sha256: proof("5"),
  });
  const verificationPaths = [];
  const verifyExactReceipt = async (state, _outerStateSha256, mode, priorResults) => {
    verificationPaths.push(mode.cleanupOnly === true ? "cleanup" : "staged");
    if (
      state.authority_id !== expectedAuthorityId ||
      state.full_live_authority_id !== expectedFullLiveAuthorityId
    )
      throw new Error("PREQUALIFICATION_RECEIPT_IDENTITY_DRIFT");
    assert.notEqual(state.authority_id, state.full_live_authority_id);
    const bootstrap = priorResults.get("bootstrap-prequalification-database");
    assert.equal(bootstrap.full_live_authority_id, state.full_live_authority_id);
    assert.equal(
      bootstrap.prequalification_database_bootstrap_sha256,
      exactReceipt.prequalification_database_bootstrap_sha256,
    );
    assert.deepEqual(
      {
        schema_version: bootstrap.schema_version,
        full_live_authority_id: state.full_live_authority_id,
        prequalification_database_bootstrap_sha256:
          bootstrap.prequalification_database_bootstrap_sha256,
      },
      exactReceipt,
    );
    return exactReceipt;
  };
  try {
    let qualificationFailed = false;
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      preflight: async (state, outerStateSha256, mode, priorResults) => {
        if (mode.staged === true)
          await verifyExactReceipt(state, outerStateSha256, mode, priorResults);
      },
      verifyPrequalificationReceipt: verifyExactReceipt,
      runOperation: async (operation, state, priorResults) => {
        if (operation.id === "mage-live-qualification" && !qualificationFailed) {
          qualificationFailed = true;
          throw new Error("force receipt cleanup path");
        }
        return fakeResult(operation, state, priorResults);
      },
      runCleanupOperation: async (operation, state, priorResults) =>
        fakeResult(operation, state, priorResults),
    });
    assert.equal(result.failed, true);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.deepEqual(verificationPaths, ["staged", "cleanup"]);

    await assert.rejects(
      verifyExactReceipt(
        {
          authority_id: expectedAuthorityId,
          full_live_authority_id: "22222222-2222-4222-8222-222222222222",
        },
        proof("0"),
        { cleanupOnly: false },
        new Map([
          [
            "bootstrap-prequalification-database",
            {
              full_live_authority_id: expectedFullLiveAuthorityId,
              prequalification_database_bootstrap_sha256:
                exactReceipt.prequalification_database_bootstrap_sha256,
            },
          ],
        ]),
      ),
      /PREQUALIFICATION_RECEIPT_IDENTITY_DRIFT/u,
    );
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("invalid final certification evidence leaves the run non-certified and cleanup-only", async () => {
  const fixture = stateFixture();
  let certificationCalls = 0;
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          const result = fakeResult(operation, state, priorResults);
          if (operation.id === "certify-v2-13-release") {
            certificationCalls += 1;
            result.predecessorEvidenceSha256s = {
              ...result.predecessorEvidenceSha256s,
              "read-settled-billing": proof("9"),
            };
          }
          return result;
        },
      }),
      /RELEASE_CERTIFICATION_READBACK/u,
    );
    const state = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(certificationCalls, 1);
    assert.equal(state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.notEqual(state.cleanup_proof, null);
    assert.equal(state.cleanup_proof.cleanup_work_ids.length, 4);
    assert.equal(state.release_certification.state, "AUTHORIZED_ONCE_RECONCILIATION_ONLY");

    let resumedCertificationCalls = 0;
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async (operation, state, priorResults) => {
        if (operation.id === "certify-v2-13-release") resumedCertificationCalls += 1;
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(resumedCertificationCalls, 0);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(resumed.state.cleanup_proof.cleanup_work_ids.length, 4);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("throwing local certification preserves cleanup proof and restart completes without retry", async () => {
  const fixture = stateFixture();
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          if (operation.id === "certify-v2-13-release")
            throw new Error("local certification interrupted");
          return fakeResult(operation, state, priorResults);
        },
      }),
      /local certification interrupted/u,
    );
    const interrupted = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(interrupted.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.equal(interrupted.cleanup_proof.cleanup_work_ids.length, 4);
    assert.equal(interrupted.release_certification.state, "AUTHORIZED_ONCE_RECONCILIATION_ONLY");

    let calls = 0;
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async () => {
        calls += 1;
        throw new Error("no operation may restart after certification ambiguity");
      },
    });
    assert.equal(calls, 0);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("crash after certification side effect resumes one exact readback and never persists again", async () => {
  const fixture = stateFixture();
  const crashStatePath = join(fixture.directory, "certification-crash-state.json");
  let initialCertificationCalls = 0;
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults, _sha256, context) => {
          if (operation.id === "certify-v2-13-release") {
            initialCertificationCalls += 1;
            assert.equal(context.reconciliationOnly, false);
            assert.equal(state.release_certification.state, "AUTHORIZED_ONCE_RECONCILIATION_ONLY");
            writeFileSync(crashStatePath, readFileSync(fixture.path), { mode: 0o600 });
            throw new Error("simulated process death after certification persistence");
          }
          return fakeResult(operation, state, priorResults);
        },
      }),
      /simulated process death/u,
    );
    assert.equal(initialCertificationCalls, 1);

    let reconciliationReads = 0;
    const resumed = await executeFullLive({
      statePath: crashStatePath,
      expectedStateSha256: hash(readFileSync(crashStatePath)),
      runOperation: async (operation, state, priorResults, _sha256, context) => {
        assert.equal(operation.id, "certify-v2-13-release");
        reconciliationReads += 1;
        assert.equal(context.resumed, true);
        assert.equal(context.authorizedUnsettled, true);
        assert.equal(context.reconciliationOnly, true);
        assert.equal(context.providerDispatchForbidden, true);
        assert.equal(context.persistenceForbidden, true);
        assert.equal(context.dispatchForbidden, true);
        assert.equal(state.release_certification.state, "AUTHORIZED_ONCE_RECONCILIATION_ONLY");
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(initialCertificationCalls, 1);
    assert.equal(reconciliationReads, 1);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_COMPLETE");
    assert.equal(resumed.state.release_certification.state, "SETTLED_TERMINAL");
    assert.equal(resumed.state.cleanup_proof.cleanup_work_ids.length, 4);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("trusted time is checked immediately before local certification", async () => {
  const fixture = stateFixture();
  const events = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      verifyMaterializationSeed: async (_state, _sha256, context) => {
        if (context?.localCertification === true) events.push("certification-seed");
        return true;
      },
      verifyStaticReleaseDescriptor: async () => true,
      trustedTime: async () => {
        events.push("trusted-time");
        return "2026-08-26T12:00:00.000Z";
      },
      runOperation: async (operation, state, priorResults, outerStateSha256) => {
        if (operation.id === "certify-v2-13-release") events.push("certification-call");
        return fakeResult(operation, state, priorResults, outerStateSha256);
      },
    });
    assert.equal(
      result.state.state,
      "CONSUMED_SINGLE_EXECUTION_COMPLETE",
      JSON.stringify(result.results.get("failure") ?? null),
    );
    assert.deepEqual(events.slice(-3), [
      "certification-seed",
      "trusted-time",
      "certification-call",
    ]);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("expiry immediately before certification closes release and preserves cleanup completion", async () => {
  const fixture = stateFixture();
  let trustedReads = 0;
  let certificationCalls = 0;
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        verifyMaterializationSeed: async () => true,
        verifyStaticReleaseDescriptor: async () => true,
        trustedTime: async (state) => {
          trustedReads += 1;
          return state.cleanup_proof !== null
            ? "2026-08-27T00:00:00.001Z"
            : "2026-08-26T12:00:00.000Z";
        },
        runOperation: async (operation, state, priorResults, outerStateSha256) => {
          if (operation.id === "certify-v2-13-release") certificationCalls += 1;
          return fakeResult(operation, state, priorResults, outerStateSha256);
        },
      }),
      /TRUSTED_TIME_EXPIRED_OR_FORGED/u,
    );
    const interrupted = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.ok(trustedReads >= 2);
    assert.equal(certificationCalls, 0);
    assert.equal(interrupted.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.equal(interrupted.cleanup_proof.cleanup_work_ids.length, 4);
    assert.equal(interrupted.release_certification, null);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("operation failure enters cleanup-only and never dispatches later paid work", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      runOperation: async (operation, state, priorResults) => {
        called.push(operation.id);
        if (operation.id === "mage-live-qualification") throw new Error("fake provider failure");
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.equal(result.failed, true);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(result.state.cleanup_proof.cleanup_work_ids.length, 4);
    assert.equal(called.includes("soulx-live-qualification"), false);
    assert.deepEqual(called.slice(-4), [
      "restore-endpoints-max-one",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
    ]);
    assert.equal(called.includes("certify-v2-13-release"), false);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("authorized cleanup ambiguity resumes reconciliation only and never normal work", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          called.push(operation.id);
          if (operation.id === "prove-zero-workers") throw new Error("fake cleanup transport gap");
          return fakeResult(operation, state, priorResults);
        },
      }),
      /fake cleanup transport gap/u,
    );
    const state = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.equal(
      state.phases.cleanup_and_reconciliation.work["v2-13-test-executor-0001:prove-zero-workers"]
        .state,
      "AUTHORIZED_ONCE_NOT_REDISPATCHABLE",
    );
    assert.equal(called.filter((id) => id === "prove-zero-workers").length, 1);
    assert.equal(called.includes("read-settled-billing"), false);

    const reconciled = [];
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async () => {
        throw new Error("normal runner forbidden during cleanup reconciliation");
      },
      runCleanupOperation: async (operation, state, priorResults, _sha256, mode) => {
        reconciled.push({ id: operation.id, mode });
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(
      reconciled.map(({ id }) => id),
      ["prove-zero-workers", "read-settled-billing", "reconcile-exact-resources"],
    );
    assert.equal(reconciled[0].mode.authorizedUnsettled, true);
    assert.equal(reconciled[0].mode.reconciliationOnly, true);
    assert.equal(reconciled[0].mode.providerDispatchForbidden, true);
    assert.equal(
      reconciled.slice(1).every(({ mode }) => mode.cleanupOnly === true),
      true,
    );
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(resumed.state.cleanup_proof.cleanup_work_ids.length, 4);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("restart hydrates settled cleanup evidence and runs only unsettled cleanup work", async () => {
  const fixture = stateFixture();
  const firstCalled = [];
  let interruptAfterBilling = true;
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          firstCalled.push(operation.id);
          return fakeResult(operation, state, priorResults);
        },
        verifyChain: async (_state, _prior, context) => {
          if (interruptAfterBilling && context.operation.id === "read-settled-billing") {
            interruptAfterBilling = false;
            throw new Error("lost cleanup acknowledgement");
          }
        },
      }),
      /lost cleanup acknowledgement/u,
    );
    const interrupted = JSON.parse(readFileSync(fixture.path, "utf8"));
    const restore =
      interrupted.phases.cleanup_and_reconciliation.work[
        "v2-13-test-executor-0001:restore-endpoints-max-one"
      ];
    const prove =
      interrupted.phases.cleanup_and_reconciliation.work[
        "v2-13-test-executor-0001:prove-zero-workers"
      ];
    const billing =
      interrupted.phases.cleanup_and_reconciliation.work[
        "v2-13-test-executor-0001:read-settled-billing"
      ];
    assert.equal(restore.state, "SETTLED_TERMINAL");
    assert.equal(typeof restore.settled_result_sha256, "string");
    assert.equal(prove.state, "SETTLED_TERMINAL");
    assert.equal(billing.state, "SETTLED_TERMINAL");

    const resumedCalled = [];
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      runOperation: async (operation, state, priorResults) => {
        resumedCalled.push(operation.id);
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(resumedCalled, ["reconcile-exact-resources"]);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
    assert.equal(resumed.failed, true);
    assert.equal(firstCalled.includes("restore-endpoints-max-one"), true);
    assert.equal(firstCalled.includes("prove-zero-workers"), true);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("non-early cleanup restart verifies the bootstrap receipt before operator preflight", async () => {
  const fixture = stateFixture();
  let failQualification = true;
  let failCleanup = true;
  try {
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: fixture.sha256,
        runOperation: async (operation, state, priorResults) => {
          if (operation.id === "mage-live-qualification" && failQualification) {
            failQualification = false;
            throw new Error("stop before cleanup restart test");
          }
          if (operation.id === "restore-endpoints-max-one" && failCleanup) {
            failCleanup = false;
            throw new Error("stop with verified operator");
          }
          return fakeResult(operation, state, priorResults);
        },
      }),
      /stop with verified operator/u,
    );
    const interrupted = JSON.parse(readFileSync(fixture.path, "utf8"));
    assert.equal(interrupted.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY");
    assert.equal(interrupted.operator_role_verified, true);
    const bootstrapWork =
      interrupted.phases.bootstrap_prequalification_database.work[
        "v2-13-test-executor-0001:bootstrap-prequalification-database"
      ];
    assert.equal(bootstrapWork.state, "SETTLED_TERMINAL");

    const events = [];
    const resumed = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: hash(readFileSync(fixture.path)),
      verifyPrequalificationReceipt: async (_state, _sha256, mode, priorResults) => {
        events.push("receipt-db-reverify");
        assert.equal(mode.cleanupOnly, true);
        assert.equal(mode.earlyFailure, false);
        assert.equal(priorResults.has("bootstrap-prequalification-database"), true);
      },
      preflight: async (_state, _sha256, mode, priorResults) => {
        events.push("operator-runpod-protected-read");
        assert.equal(mode.operatorOnly, true);
        assert.equal(priorResults.has("bootstrap-prequalification-database"), true);
      },
      runOperation: async () => {
        throw new Error("normal runner forbidden during cleanup-only restart");
      },
      runCleanupOperation: async (operation, state, priorResults, _sha256, mode) => {
        assert.equal(mode.cleanupOnly, true);
        if (operation.id === "restore-endpoints-max-one") {
          assert.equal(mode.reconciliationOnly, true);
          assert.equal(mode.authorizedUnsettled, true);
        }
        return fakeResult(operation, state, priorResults);
      },
    });
    assert.deepEqual(events, ["receipt-db-reverify", "operator-runpod-protected-read"]);
    assert.equal(resumed.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("replay cannot reopen a consumed execution", async () => {
  const fixture = stateFixture();
  try {
    const first = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      runOperation: async (operation, state, priorResults) =>
        fakeResult(operation, state, priorResults),
    });
    let calls = 0;
    await assert.rejects(
      executeFullLive({
        statePath: fixture.path,
        expectedStateSha256: first.sha256,
        runOperation: async () => {
          calls += 1;
          return {};
        },
      }),
      /NOT_IN_PROGRESS|PHASE_ORDER|PHASE_ALREADY_STARTED/u,
    );
    assert.equal(calls, 0);
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("reported cost above an exact reservation stops all later paid work", async () => {
  const fixture = stateFixture();
  const called = [];
  try {
    const result = await executeFullLive({
      statePath: fixture.path,
      expectedStateSha256: fixture.sha256,
      runOperation: async (operation, state, priorResults) => {
        called.push(operation.id);
        const value = fakeResult(operation, state, priorResults);
        if (operation.id === "mage-live-qualification") value.actualUsd = 4.500001;
        return value;
      },
    });
    assert.equal(result.failed, true);
    assert.deepEqual(result.results.get("failure"), {
      failure_boundary: "OPERATION_RESULT_VALIDATION",
      failure_code: "RESULT_COST",
    });
    assert.equal(called.filter((id) => id === "mage-live-qualification").length, 1);
    assert.equal(called.includes("soulx-live-qualification"), false);
    assert.equal(result.state.state, "CONSUMED_SINGLE_EXECUTION_CLEANUP_COMPLETE_NO_RETRY");
  } finally {
    rmSync(fixture.directory, { recursive: true, force: true });
  }
});
