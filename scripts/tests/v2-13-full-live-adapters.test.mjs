import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  closeSync,
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import test from "node:test";

import {
  closedTrustedTimeCommand,
  cleanupPartialDatabaseRoleCredentials,
  databaseCredentialStagingPath,
  createConcreteFullLiveAdapters,
  createPrequalificationDatabaseBootstrapAdapter,
  createGitReleaseAdapters,
  createGuardedActivationAdapter,
  createDurablePromotionFileJournal,
  createPromotionAwareCleanupAdapter,
  createQualifiedProductionCleanupProof,
  createRecoverableQualifiedPromotionTransport,
  createWorkflowStartAuthorityAdapter,
  createProtectedWorkflowStartAuthorityAdapter,
  createPostConsumptionMaterializationProducer,
  postConsumptionResponseHmac,
  createProtectedInputMaterializer,
  createStagedQualificationAdapters,
  createTypeScriptBridgeAdapters,
  createReleaseCertificationAdapter,
  createV213AcceptanceAdapters,
  createV213DurableStageStore,
  createGithubDispatchAdapters,
  createGithubVerificationAdapters,
  hashV213DryOutputBundle,
  PREQUALIFICATION_OPERATOR_FUNCTIONS,
  readAuthenticatedGithubTime,
  resolveSourceBoundBridgeLaunch,
  SUCCESSOR_RELEASE_SOURCE_COMMIT,
  SUCCESSOR_TAG,
  TAG,
  validateSoulxWorkflowRegistrationEvidence,
  verifyPrequalificationDatabaseReceipt,
} from "../../deploy/v2-13/full-live-adapters.mjs";
import {
  MEDIA_WORKER_RELEASE_HTML_URL,
  MEDIA_WORKER_RELEASE_MANIFEST,
  MEDIA_WORKER_RELEASE_MANIFEST_NAME,
  MEDIA_WORKER_RELEASE_MANIFEST_SHA256,
  MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES,
  MEDIA_WORKER_RELEASE_MANIFEST_URL,
  MEDIA_WORKER_RELEASE_PUBLISHED_AT,
  MEDIA_WORKER_RELEASE_READBACK_SCHEMA,
  MEDIA_WORKER_RELEASE_REPOSITORY,
  MEDIA_WORKER_RELEASE_TAG,
  MEDIA_WORKER_RELEASE_TARGET_COMMIT,
} from "../../deploy/v2-13/media-worker-release-readback.mjs";
import { materializationSeedFixture } from "./fixtures/v2-13-materialization-seed.mjs";
import { EXACT_PREDECESSOR_RELEASE_ATTEMPT } from "../../deploy/v2-13/validate-full-live-approval.mjs";

const sourceCommit = "4".repeat(40);
const state = {
  release_source_commit: sourceCommit,
  approved_at: "2026-01-01T00:00:00Z",
  expires_at: "2099-01-01T00:00:00Z",
  release_ref: {
    exact_tag_name: TAG,
    exact_target_commit: sourceCommit,
    state: "VERIFIED_EXACT_REMOTE",
  },
};
const result = (status = 0, stdout = "", stderr = "") => ({ status, stdout, stderr });
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalJson = (value) =>
  Array.isArray(value)
    ? `[${value.map((item) => canonicalJson(item)).join(",")}]`
    : value !== null && typeof value === "object"
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const soulxWorkflowRegistrationEvidenceFixture = (overrides = {}) => {
  const unsigned = {
    schema_version: "videoforge.v213-soulx-workflow-registration-evidence/v1",
    repository: "Pala-LakshmanSai/videoforge",
    default_branch: "main",
    default_branch_commit: "5".repeat(40),
    workflow_file: "avatar-primary-serverless-image.yml",
    workflow_name: "avatar-primary-serverless-image",
    workflow_path: ".github/workflows/avatar-primary-serverless-image.yml",
    default_branch_workflow_sha256: hash(Buffer.from("avatar-primary-serverless-image.yml")),
    release_source_commit: sourceCommit,
    release_source_workflow_sha256: hash(Buffer.from("avatar-primary-serverless-image.yml")),
    registration_state: "REGISTERED_EXACT_DEFAULT_BRANCH",
    materialized: true,
    bound_to_release_source: true,
    ...overrides,
  };
  return {
    ...unsigned,
    evidence_sha256: hash(Buffer.from(canonicalJson(unsigned))),
  };
};
const stateWithSoulxWorkflowRegistration = (evidence) => ({
  ...state,
  predecessor_release_attempt: EXACT_PREDECESSOR_RELEASE_ATTEMPT,
  static_release_descriptor_schema_version: "videoforge.v213-static-release-descriptor/v2",
  soulx_workflow_registration_evidence_sha256: evidence.evidence_sha256,
  soulx_workflow_registration_evidence: evidence,
});
const successorSoulxMainBytes = Buffer.from("successor SoulX main workflow\n");
const successorSoulxReleaseBytes = Buffer.from("successor SoulX release workflow\n");
const successorSoulxWorkflowRegistrationEvidenceFixture = (overrides = {}) => {
  const unsigned = {
    schema_version: "videoforge.v213-soulx-workflow-registration-evidence/v2",
    repository: "Pala-LakshmanSai/videoforge",
    default_branch: "main",
    default_branch_commit: "9".repeat(40),
    workflow_id: 102,
    workflow_file: "avatar-primary-serverless-image.yml",
    workflow_name: "avatar-primary-serverless-image",
    workflow_path: ".github/workflows/avatar-primary-serverless-image.yml",
    workflow_state: "active",
    default_branch_workflow_sha256: hash(successorSoulxMainBytes),
    release_source_commit: SUCCESSOR_RELEASE_SOURCE_COMMIT,
    release_source_workflow_sha256: hash(successorSoulxReleaseBytes),
    default_branch_matches_release_source: false,
    registration_state: "REGISTERED_ACTIVE_DEFAULT_BRANCH_RELEASE_REF_BOUND",
    materialized: true,
    default_branch_registration_only: true,
    ...overrides,
  };
  return {
    ...unsigned,
    evidence_sha256: hash(Buffer.from(canonicalJson(unsigned))),
  };
};
const successorStateWithSoulxWorkflowRegistration = (evidence) => ({
  ...state,
  release_source_commit: SUCCESSOR_RELEASE_SOURCE_COMMIT,
  release_ref: {
    exact_tag_name: SUCCESSOR_TAG,
    exact_target_commit: SUCCESSOR_RELEASE_SOURCE_COMMIT,
    state: "VERIFIED_EXACT_REMOTE",
  },
  predecessor_release_attempt: EXACT_PREDECESSOR_RELEASE_ATTEMPT,
  static_release_descriptor_schema_version: "videoforge.v213-static-release-descriptor/v3",
  soulx_workflow_registration_evidence_sha256: evidence.evidence_sha256,
  soulx_workflow_registration_evidence: evidence,
});

function workflowDispatchRunner({
  evidence,
  workflowName,
  newRuns,
  defaultBranch = "main",
  mainCommit = evidence.default_branch_commit,
  missingWorkflow = null,
  inactiveWorkflow = null,
  driftWorkflow = null,
  mainWorkflowBytes = {},
  releaseWorkflowBytes = {},
  workflowIds = {},
} = {}) {
  const calls = [];
  let listCalls = 0;
  const bytes = {
    "mage-image.yml": Buffer.from("mage-image workflow\n"),
    "avatar-primary-serverless-image.yml": Buffer.from("avatar-primary-serverless-image.yml"),
  };
  const run = (command, args) => {
    calls.push([command, args]);
    if (args[0] === "run" && args[1] === "list") {
      listCalls += 1;
      return result(0, JSON.stringify(listCalls === 1 ? [] : newRuns));
    }
    if (args[0] === "run" && args[1] === "view")
      return result(
        0,
        JSON.stringify(
          newRuns[0] ?? {
            databaseId: Number(EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id),
            headSha: sourceCommit,
            workflowName,
            status: "completed",
            conclusion: "success",
          },
        ),
      );
    if (args[0] === "workflow") return result(0);
    const endpoint = args.at(-1);
    if (endpoint === "repos/Pala-LakshmanSai/videoforge")
      return result(0, JSON.stringify({ default_branch: defaultBranch }));
    if (endpoint === "repos/Pala-LakshmanSai/videoforge/commits/main")
      return result(0, JSON.stringify({ sha: mainCommit }));
    const registration = endpoint?.match(/actions\/workflows\/(.+)$/u);
    if (registration) {
      const file = decodeURIComponent(registration[1]);
      if (file === missingWorkflow) return result(1, "", "not found");
      const expectedName =
        file === "mage-image.yml" ? "mage-image" : "avatar-primary-serverless-image";
      return result(
        0,
        JSON.stringify({
          id: workflowIds[file] ?? (file === "mage-image.yml" ? 101 : 102),
          name: expectedName,
          path: `.github/workflows/${file}`,
          state: file === inactiveWorkflow ? "disabled_manually" : "active",
        }),
      );
    }
    const content = endpoint?.match(/contents\/.github\/workflows\/([^?]+)\?ref=(.+)$/u);
    if (content) {
      const file = decodeURIComponent(content[1]);
      const ref = decodeURIComponent(content[2]);
      const baseBytes = bytes[file];
      const branchBytes = mainWorkflowBytes[file] ?? baseBytes;
      const releaseBytes = releaseWorkflowBytes[file] ?? baseBytes;
      const body = ref === mainCommit ? branchBytes : releaseBytes;
      const readBytes =
        file === driftWorkflow && ref === mainCommit
          ? Buffer.concat([body, Buffer.from("drift")])
          : body;
      return result(
        0,
        JSON.stringify({
          type: "file",
          encoding: "base64",
          content: readBytes.toString("base64"),
          sha: file === "mage-image.yml" ? "6".repeat(40) : "7".repeat(40),
          size: readBytes.length,
        }),
      );
    }
    throw new Error(`unexpected workflow fixture command: ${command} ${args.join(" ")}`);
  };
  return { calls, run, workflowName };
}
const mediaWorkerReleaseReadback = ({ state: currentState, outerStateSha256 }) => {
  const unsigned = {
    actualUsd: 0,
    schemaVersion: MEDIA_WORKER_RELEASE_READBACK_SCHEMA,
    state: "VERIFIED_EXACT_PUBLIC_GITHUB_RELEASE",
    authorityId: currentState.authority_id,
    outerStateSha256,
    repository: MEDIA_WORKER_RELEASE_REPOSITORY,
    tagName: MEDIA_WORKER_RELEASE_TAG,
    targetCommit: MEDIA_WORKER_RELEASE_TARGET_COMMIT,
    releaseHtmlUrl: MEDIA_WORKER_RELEASE_HTML_URL,
    publishedAt: MEDIA_WORKER_RELEASE_PUBLISHED_AT,
    draft: false,
    prerelease: false,
    immutable: true,
    manifestAsset: {
      name: MEDIA_WORKER_RELEASE_MANIFEST_NAME,
      sizeBytes: MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES,
      digest: MEDIA_WORKER_RELEASE_MANIFEST_SHA256,
      state: "uploaded",
      contentType: "application/json",
      browserDownloadUrl: MEDIA_WORKER_RELEASE_MANIFEST_URL,
    },
    manifestUrl: MEDIA_WORKER_RELEASE_MANIFEST_URL,
    finalDownloadUrl: MEDIA_WORKER_RELEASE_MANIFEST_URL,
    redirectCount: 0,
    manifestSizeBytes: MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES,
    manifestSha256: MEDIA_WORKER_RELEASE_MANIFEST_SHA256,
    manifest: MEDIA_WORKER_RELEASE_MANIFEST,
    binaryDownloads: 0,
    credentialsUsed: false,
    providerMutations: 0,
    gpuUse: false,
    externalSpendUsd: 0,
  };
  return { ...unsigned, reconciliationSha256: hash(Buffer.from(canonicalJson(unsigned))) };
};
const preEndpointSecrets = () => ({
  schemaVersion: "videoforge.v213-full-live-pre-endpoint-secrets/v1",
  stageAuthoritySigningKeyBase64: Buffer.alloc(32, 1).toString("base64"),
  provenanceReceiptHmacKeyBase64: Buffer.alloc(32, 2).toString("base64"),
  provenanceReceiptKeyId: "receipt-key",
  acceptanceEvidenceSigningKeyBase64: Buffer.alloc(32, 3).toString("base64"),
  pairDispatchTokenKeyBase64: Buffer.alloc(32, 4).toString("base64"),
  pairDispatchTokenKeyId: "dispatch-key",
  pairEnvelopeSigningKeyHex: Buffer.alloc(32, 5).toString("hex"),
  pairEnvelopeSigningKeyId: "envelope-key",
  pairProviderProofKeyHex: Buffer.alloc(32, 6).toString("hex"),
  pairProviderProofKeyId: "proof-key",
});

const staticReleaseDescriptorFixture = () => {
  const fact = (gate, claims, metrics) => ({
    gate,
    sourceEvidenceSha256: hash(Buffer.from(`static-source-${gate}`)),
    observerId: `independent-auditor-${gate}`,
    evidencePath: `project-context/evidence/acceptance/VF-10-13/${gate}.json`,
    evidenceClass: "INDEPENDENT_RELEASE_AUDIT",
    observedAt: "2026-08-28T09:55:00.000Z",
    fixtureOrFakeTransportUsed: false,
    claims,
    metrics,
  });
  const unsigned = {
    schemaVersion: "videoforge.v213-static-release-descriptor/v1",
    sourceCommit,
    productionUrlSha256: hash(Buffer.from("production-url")),
    contractBundleSha256: hash(Buffer.from("contract-bundle")),
    auditFacts: {
      operations_runbooks_ready: fact(
        "operations_runbooks_ready",
        ["stuck_job_runbook", "provider_outage_runbook", "billing_runbook", "rollback_runbook"],
        {
          stuckJobRunbookSha256: hash(Buffer.from("stuck-runbook")),
          providerOutageRunbookSha256: hash(Buffer.from("provider-runbook")),
          billingRunbookSha256: hash(Buffer.from("billing-runbook")),
          rollbackRunbookSha256: hash(Buffer.from("rollback-runbook")),
        },
      ),
      backup_restore_ready: fact(
        "backup_restore_ready",
        [
          "backup_readback_passed",
          "restore_evidence_accepted",
          "schema_migration_disposition_recorded",
        ],
        {
          backupReadbackPassed: true,
          restoreEvidenceAccepted: true,
          schemaMigrationDisposition: "DISPOSABLE_RESTORE_COMPLETED",
        },
      ),
      security_clear: fact(
        "security_clear",
        [
          "p0_zero",
          "p1_zero",
          "auth_tenant_boundary_passed",
          "ssrf_path_upload_boundary_passed",
          "secret_log_scan_passed",
          "cost_amplification_guards_passed",
          "legacy_runtime_bundle_scan_passed",
        ],
        {
          p0Count: 0,
          p1Count: 0,
          authTenantPassed: true,
          ssrfPathUploadPassed: true,
          secretLogScanPassed: true,
          costAmplificationGuardsPassed: true,
          legacyRuntimeBundleScanPassed: true,
        },
      ),
      production_transport_real: fact(
        "production_transport_real",
        [
          "hosted_client_api_truth",
          "fixture_controls_absent",
          "fake_gpu_absent",
          "fake_transport_absent",
          "manual_pod_controls_absent",
          "legacy_dispatch_exports_absent",
        ],
        {
          hostedClientApiTruth: true,
          fixtureControlsInBundle: false,
          fakeGpuProfileInBundle: false,
          fakeTransportInBundle: false,
          manualPodControlsInBundle: false,
          legacyDispatchExportsInBundle: false,
        },
      ),
    },
  };
  return { ...unsigned, descriptorSha256: hash(Buffer.from(canonicalJson(unsigned))) };
};

const workflowMaterializationFixture = () => {
  const staticReleaseDescriptor = staticReleaseDescriptorFixture();
  const materializationState = {
    ...state,
    authority_id: "outer-authority",
    state: "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
    authority_sha256: hash(Buffer.from("outer-authority-record")),
    proposal_sha256: hash(Buffer.from("proposal")),
    approval_sha256: hash(Buffer.from("approval")),
    full_live_executor_sha256: hash(Buffer.from("executor")),
    static_release_descriptor_sha256: staticReleaseDescriptor.descriptorSha256,
  };
  const outerStateSha256 = hash(Buffer.from("outer-state"));
  const fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
  const workflowAuthorityId = "22222222-2222-4222-8222-222222222222";
  const tokenSha256 = hash(Buffer.from("workflow-token"));
  const identity = {
    accountId: "10000000-0000-4000-8000-000000000001",
    workspaceId: "10000000-0000-4000-8000-000000000002",
    projectId: "10000000-0000-4000-8000-000000000003",
    projectRevisionId: "10000000-0000-4000-8000-000000000004",
    generationRequestId: "10000000-0000-4000-8000-000000000005",
  };
  const secondaryIdentity = {
    accountId: "20000000-0000-4000-8000-000000000001",
    workspaceId: "20000000-0000-4000-8000-000000000002",
    projectId: "20000000-0000-4000-8000-000000000003",
    projectRevisionId: "20000000-0000-4000-8000-000000000004",
    generationRequestId: "20000000-0000-4000-8000-000000000005",
  };
  const fairnessProbeIdentity = {
    accountId: "30000000-0000-4000-8000-000000000001",
    workspaceId: "30000000-0000-4000-8000-000000000002",
    projectId: "30000000-0000-4000-8000-000000000003",
    projectRevisionId: "30000000-0000-4000-8000-000000000004",
    generationRequestId: "30000000-0000-4000-8000-000000000005",
  };
  const sameAccountWaiterIdentity = {
    accountId: identity.accountId,
    workspaceId: identity.workspaceId,
    projectId: identity.projectId,
    projectRevisionId: identity.projectRevisionId,
    generationRequestId: "10000000-0000-4000-8000-000000000006",
  };
  const materialization = {
    schemaVersion: "videoforge.v213-post-consumption-materialization/v4",
    fullLiveAuthorityId,
    materializedAfterOuterConsumption: true,
    outerStateSha256,
    sourceCommit,
    proposalSha256: materializationState.proposal_sha256,
    approvalSha256: materializationState.approval_sha256,
    staticReleaseDescriptorSha256: staticReleaseDescriptor.descriptorSha256,
    workerOperatorBearerSha256: hash(Buffer.from("worker-operator-bearer")),
    roleScopedIdentities: {
      primary: identity,
      sameAccountWaiter: sameAccountWaiterIdentity,
      secondary: secondaryIdentity,
      fairnessProbe: fairnessProbeIdentity,
    },
    workflowStartAuthority: {
      workflowAuthorityId,
      authorityId: fullLiveAuthorityId,
      tokenSha256,
      expiresAt: materializationState.expires_at,
    },
  };
  materialization.materializationSha256 = hash(Buffer.from(canonicalJson(materialization)));
  return {
    materialization,
    materializationState,
    outerStateSha256,
    staticReleaseDescriptor,
    workflowAuthorityId,
  };
};

const workflowAuthorityDatabase = ({
  fixture,
  replayRow,
  throwInsert = false,
  dynamicAuthority = false,
}) => {
  const calls = [];
  let startReads = 0;
  let startInserts = 0;
  let insertedAuthority;
  const database = {
    async query(sql, parameters = []) {
      calls.push({ sql, parameters });
      if (sql.startsWith('SELECT id::text AS "workflowAuthorityId"')) {
        startReads += 1;
        if (startReads === 1 && replayRow === undefined) return { rows: [] };
        return {
          rows: [
            replayRow ??
              insertedAuthority ?? {
                workflowAuthorityId: fixture.workflowAuthorityId,
                authorityId: fixture.materialization.fullLiveAuthorityId,
                tokenSha256: fixture.materialization.workflowStartAuthority.tokenSha256,
                expiresAt: fixture.materialization.workflowStartAuthority.expiresAt,
              },
          ],
        };
      }
      if (sql.startsWith("SELECT public.videoforge_record_v213_workflow_start_authority")) {
        startInserts += 1;
        insertedAuthority = dynamicAuthority
          ? {
              workflowAuthorityId: parameters[0],
              authorityId: parameters[1],
              tokenSha256: parameters[2],
              expiresAt: parameters[3],
            }
          : undefined;
        if (throwInsert) throw new Error("transport lost after commit");
        return {
          rows: [
            {
              authority: {
                authorityId: insertedAuthority?.workflowAuthorityId ?? fixture.workflowAuthorityId,
                tokenSha256:
                  insertedAuthority?.tokenSha256 ??
                  fixture.materialization.workflowStartAuthority.tokenSha256,
                expiresAt:
                  insertedAuthority?.expiresAt ??
                  fixture.materialization.workflowStartAuthority.expiresAt,
              },
            },
          ],
        };
      }
      if (sql.startsWith("SELECT public.videoforge_record_v213_static_release_descriptor")) {
        const supplied = JSON.parse(parameters[0]);
        return { rows: [{ descriptor: { descriptorSha256: supplied.descriptorSha256 } }] };
      }
      assert.equal(
        sql,
        "SELECT public.videoforge_record_v213_acceptance_authority($1::jsonb) AS authority",
      );
      const supplied = JSON.parse(parameters[0]);
      return {
        rows: [
          {
            authority: {
              checkpoint: supplied.document.checkpoint,
              requestSha256: supplied.document.requestSha256,
              expiresAt: supplied.expiresAt,
            },
          },
        ],
      };
    },
  };
  return {
    database,
    calls,
    get startReads() {
      return startReads;
    },
    get startInserts() {
      return startInserts;
    },
  };
};

const producerFactsFixture = (fixture) => {
  const cumulativeLedgerSha256 = hash(Buffer.from("cumulative-ledger"));
  const facts = {
    fullLiveAuthorityId: fixture.materialization.fullLiveAuthorityId,
    roleScopedIdentities: structuredClone(fixture.materialization.roleScopedIdentities),
  };
  const { fairnessProbe, primary, sameAccountWaiter, secondary } = facts.roleScopedIdentities;
  return {
    facts,
    factsSha256: hash(Buffer.from(canonicalJson(facts))),
    selection: {
      primary: {
        accountId: primary.accountId,
        workspaceId: primary.workspaceId,
        projectId: primary.projectId,
        projectRevisionId: primary.projectRevisionId,
      },
      sameAccountWaiter: {
        accountId: sameAccountWaiter.accountId,
        workspaceId: sameAccountWaiter.workspaceId,
        projectId: sameAccountWaiter.projectId,
        projectRevisionId: sameAccountWaiter.projectRevisionId,
      },
      secondary: {
        accountId: secondary.accountId,
        workspaceId: secondary.workspaceId,
        projectId: secondary.projectId,
        projectRevisionId: secondary.projectRevisionId,
      },
      fairnessProbe: {
        accountId: fairnessProbe.accountId,
        workspaceId: fairnessProbe.workspaceId,
        projectId: fairnessProbe.projectId,
        projectRevisionId: fairnessProbe.projectRevisionId,
      },
    },
    cumulativeLedgerSha256,
  };
};

const producerEnvironment = (fixture, directory) => {
  const materializationPath = resolve(directory, "post-consumption.json");
  const bearerPath = resolve(directory, "worker-bearer");
  const productionInputPath = resolve(directory, "production-input.json");
  const chainPath = resolve(directory, "materialization-chain.json");
  const staticReleaseDescriptorPath = resolve(directory, "static-release-descriptor.json");
  writeFileSync(bearerPath, "worker-operator-bearer", { mode: 0o600 });
  writeFileSync(
    productionInputPath,
    `${canonicalJson({
      schemaVersion: "videoforge.v213-full-live-outer-input/v1",
      fullLiveAuthorityId: fixture.materialization.fullLiveAuthorityId,
      authorityDocument: {
        staticReleaseDescriptorSha256: fixture.staticReleaseDescriptor.descriptorSha256,
      },
      dualLaneInput: {
        mage: { volumeIdSha256: hash(Buffer.from("mage-volume")) },
        soulx: { volumeIdSha256: hash(Buffer.from("soulx-volume")) },
      },
      commandPayloads: {},
    })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    staticReleaseDescriptorPath,
    `${canonicalJson(fixture.staticReleaseDescriptor)}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    chainPath,
    `${canonicalJson(
      materializationChainFixture(
        fixture.materializationState.authority_id,
        fixture.outerStateSha256,
      ),
    )}\n`,
    { mode: 0o600 },
  );
  return {
    VIDEOFORGE_V2_13_POST_CONSUMPTION_MATERIALIZATION_FILE: materializationPath,
    VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE: bearerPath,
    VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: productionInputPath,
    VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE: chainPath,
    VIDEOFORGE_V2_13_STATIC_RELEASE_DESCRIPTOR_FILE: staticReleaseDescriptorPath,
  };
};

const materializationChainFixture = (authorityId, outerStateSha256) => {
  let priorChainSha256 = hash(
    Buffer.from("videoforge.v213-full-live-materialization-chain/v1:genesis"),
  );
  const entries = [
    "prequalification-descriptor",
    "production-input",
    "media-worker-release-readback",
    "max-one-endpoint-bindings",
    "activation-record",
    "promotion-record",
  ].map((kind) => {
    const unsigned = {
      kind,
      authority_id: authorityId,
      prior_chain_sha256: priorChainSha256,
      outer_state_sha256: outerStateSha256,
      ordered_prior_operation_evidence_sha256s: [],
      ordered_output_sha256s: [[`${kind}-sha256`, hash(Buffer.from(kind))]],
    };
    const entry_sha256 = hash(Buffer.from(`${canonicalJson(unsigned)}\n`));
    priorChainSha256 = entry_sha256;
    return { ...unsigned, entry_sha256 };
  });
  return { schema_version: "videoforge.v213-full-live-materialization-chain/v1", entries };
};

test("git release adapters create an absent lightweight tag, push non-force, and read it back", async () => {
  const calls = [];
  const replies = [
    result(1),
    result(0),
    result(0),
    result(0, `${sourceCommit}\n`),
    result(0, `${sourceCommit}\n`),
    result(0, ""),
    result(0, "ok\n"),
    result(0, `${sourceCommit}\trefs/tags/${TAG}\n`),
  ];
  const adapters = createGitReleaseAdapters({
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  const created = await adapters["release-tag-create"]({}, state);
  assert.equal(created.created, true);
  assert.equal(created.exactTagReady, true);
  assert.equal((await adapters["release-tag-push"]({}, state)).forceUsed, false);
  assert.equal((await adapters["release-tag-readback"]({}, state)).targetCommit, sourceCommit);
  assert.deepEqual(calls[0][1], ["show-ref", "--verify", "--quiet", `refs/tags/${TAG}`]);
  assert.deepEqual(calls[6][1], [
    "push",
    "--porcelain",
    "origin",
    `refs/tags/${TAG}:refs/tags/${TAG}`,
  ]);
  assert.equal(replies.length, 0);
});

test("git release push performs zero mutation when the predecessor tag is already exact", async () => {
  const calls = [];
  const replies = [
    result(0, `${sourceCommit}\n`),
    result(0, `${sourceCommit}\trefs/tags/${TAG}\n`),
  ];
  const adapters = createGitReleaseAdapters({
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  const reconciled = await adapters["release-tag-push"]({}, state);
  assert.equal(reconciled.pushPerformed, false);
  assert.equal(reconciled.reconciledExistingExact, true);
  assert.equal(reconciled.forceUsed, false);
  assert.equal(
    calls.some(([, args]) => args[0] === "push"),
    false,
  );
  assert.equal(replies.length, 0);
});

test("git release adapter rejects mismatched local or remote tags", async () => {
  const localReplies = [result(0), result(0, `${"5".repeat(40)}\n`)];
  const local = createGitReleaseAdapters({ run: () => localReplies.shift() });
  await assert.rejects(local["release-tag-create"]({}, state), /LOCAL_TAG_COLLISION/u);

  const replies = [result(1), result(0, `${"5".repeat(40)}\trefs/tags/${TAG}\n`)];
  const remote = createGitReleaseAdapters({ run: () => replies.shift() });
  await assert.rejects(remote["release-tag-create"]({}, state), /REMOTE_TAG_READBACK/u);
});

test("git release adapter reconciles the exact predecessor tag without retarget or force", async () => {
  const reconciliationState = {
    ...state,
    release_ref: { ...state.release_ref, state: "AUTHORIZED_PENDING_RECONCILIATION" },
  };
  const exactReplies = [result(1), result(0, `${sourceCommit}\trefs/tags/${TAG}\n`)];
  const calls = [];
  const exactRemote = createGitReleaseAdapters({
    run: (command, args) => {
      calls.push([command, args]);
      return exactReplies.shift();
    },
  });
  const reconciled = await exactRemote["release-tag-create"]({}, reconciliationState);
  assert.equal(reconciled.created, false);
  assert.equal(reconciled.verifiedExistingExact, true);
  assert.equal(reconciled.exactTagReady, true);
  assert.equal(reconciled.mutationPerformed, false);
  assert.equal(
    calls.some(([, args]) => args[0] === "tag"),
    false,
  );
  assert.equal(exactReplies.length, 0);
});

test("predecessor reconciliation hard-stops when the exact remote tag is absent", async () => {
  const reconciliationState = {
    ...state,
    release_ref: { ...state.release_ref, state: "AUTHORIZED_PENDING_RECONCILIATION" },
  };
  const replies = [result(1), result(0, "")];
  const calls = [];
  const adapters = createGitReleaseAdapters({
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  await assert.rejects(
    adapters["release-tag-create"]({}, reconciliationState),
    /PREDECESSOR_REMOTE_TAG_ABSENT/u,
  );
  assert.equal(
    calls.some(([, args]) => ["tag", "push"].includes(args[0])),
    false,
  );
});

test("successor release tag is accepted only at the exact repaired source commit", async () => {
  const successorState = {
    ...state,
    release_source_commit: SUCCESSOR_RELEASE_SOURCE_COMMIT,
    release_ref: {
      exact_tag_name: SUCCESSOR_TAG,
      exact_target_commit: SUCCESSOR_RELEASE_SOURCE_COMMIT,
      state: "VERIFIED_EXACT_REMOTE",
    },
  };
  const adapters = createGitReleaseAdapters({
    run: () => result(0, `${SUCCESSOR_RELEASE_SOURCE_COMMIT}\trefs/tags/${SUCCESSOR_TAG}\n`),
  });
  assert.equal(
    (await adapters["release-tag-readback"]({}, successorState)).targetCommit,
    SUCCESSOR_RELEASE_SOURCE_COMMIT,
  );
  await assert.rejects(
    adapters["release-tag-readback"](
      {},
      {
        ...successorState,
        release_ref: { ...successorState.release_ref, exact_target_commit: "a".repeat(40) },
      },
    ),
    /RELEASE_LINEAGE/u,
  );
});

test("approval publication pushes the exact authority-record commit with FF and tree-byte proof", async () => {
  const approval = '{"approval":true}\n';
  const authority = '{"authority":true}\n';
  const proposalCommit = "2".repeat(40);
  const authorityCommit = "3".repeat(40);
  const remoteCommit = "1".repeat(40);
  const publicationState = {
    ...state,
    proposal_record_commit: proposalCommit,
    authority_record_commit: authorityCommit,
    approval_record_path: "evidence/user-approval.json",
    authority_record_path: "evidence/approved-authority.json",
    approval_sha256: hash(approval),
    authority_sha256: hash(authority),
  };
  const replies = [
    result(0, "commit\n"),
    result(0, `${proposalCommit}\n`),
    result(0, approval),
    result(0, authority),
    result(0, `${remoteCommit}\trefs/heads/codex/serverless-v2-roadmap-v4\n`),
    result(0),
    result(0, "ok\n"),
    result(0, `${authorityCommit}\trefs/heads/codex/serverless-v2-roadmap-v4\n`),
  ];
  const calls = [];
  const adapters = createGitReleaseAdapters({
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  const published = await adapters["approval-commit-push"]({}, publicationState);
  assert.equal(published.commit, authorityCommit);
  assert.equal(published.branch, "codex/serverless-v2-roadmap-v4");
  assert.deepEqual(calls[4][1], [
    "ls-remote",
    "--heads",
    "origin",
    "refs/heads/codex/serverless-v2-roadmap-v4",
  ]);
  assert.deepEqual(calls[7][1], [
    "ls-remote",
    "--heads",
    "origin",
    "refs/heads/codex/serverless-v2-roadmap-v4",
  ]);
  assert.deepEqual(calls[6][1], [
    "push",
    "--porcelain",
    "origin",
    `${authorityCommit}:refs/heads/codex/serverless-v2-roadmap-v4`,
  ]);
  assert.deepEqual(calls[5][1], ["merge-base", "--is-ancestor", remoteCommit, authorityCommit]);
  assert.equal(replies.length, 0);
});

test("approval publication rejects a readback from the stale v3 branch", async () => {
  const approval = '{"approval":true}\n';
  const authority = '{"authority":true}\n';
  const proposalCommit = "2".repeat(40);
  const authorityCommit = "3".repeat(40);
  const remoteCommit = "1".repeat(40);
  const publicationState = {
    ...state,
    proposal_record_commit: proposalCommit,
    authority_record_commit: authorityCommit,
    approval_record_path: "evidence/user-approval.json",
    authority_record_path: "evidence/approved-authority.json",
    approval_sha256: hash(approval),
    authority_sha256: hash(authority),
  };
  const calls = [];
  const adapters = createGitReleaseAdapters({
    run: (command, args) => {
      calls.push([command, args]);
      if (calls.length === 1) return result(0, "commit\n");
      if (calls.length === 2) return result(0, `${proposalCommit}\n`);
      if (calls.length === 3) return result(0, approval);
      if (calls.length === 4) return result(0, authority);
      return result(0, `${remoteCommit}\trefs/heads/codex/serverless-v2-roadmap\n`);
    },
  });
  await assert.rejects(
    adapters["approval-commit-push"]({}, publicationState),
    /APPROVAL_BRANCH_READBACK/u,
  );
  assert.deepEqual(calls[4][1], [
    "ls-remote",
    "--heads",
    "origin",
    "refs/heads/codex/serverless-v2-roadmap-v4",
  ]);
  assert.equal(
    calls.some(([, args]) => args[0] === "push"),
    false,
  );
});

test("approval publication creates the absent exact v4 branch without force", async () => {
  const approval = '{"approval":true}\n';
  const authority = '{"authority":true}\n';
  const proposalCommit = "2".repeat(40);
  const authorityCommit = "3".repeat(40);
  const publicationState = {
    ...state,
    proposal_record_commit: proposalCommit,
    authority_record_commit: authorityCommit,
    approval_record_path: "evidence/user-approval.json",
    authority_record_path: "evidence/approved-authority.json",
    approval_sha256: hash(approval),
    authority_sha256: hash(authority),
  };
  const replies = [
    result(0, "commit\n"),
    result(0, `${proposalCommit}\n`),
    result(0, approval),
    result(0, authority),
    result(0, ""),
    result(0, "ok\n"),
    result(0, `${authorityCommit}\trefs/heads/codex/serverless-v2-roadmap-v4\n`),
  ];
  const calls = [];
  const adapters = createGitReleaseAdapters({
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  const published = await adapters["approval-commit-push"]({}, publicationState);
  assert.equal(published.priorBranchState, "ABSENT_CREATED");
  assert.equal(published.exactRemoteReadback, true);
  assert.equal(
    calls.some(([, args]) => args[0] === "merge-base"),
    false,
  );
  assert.equal(
    calls.some(([, args]) => args.some((arg) => arg.includes("--force"))),
    false,
  );
  assert.equal(replies.length, 0);
});

test("Mage workflow operation reconciles the exact predecessor run without redispatch", async () => {
  const evidence = soulxWorkflowRegistrationEvidenceFixture();
  const newRun = {
    databaseId: Number(EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id),
    headSha: sourceCommit,
    workflowName: "mage-image",
    status: "completed",
    conclusion: "success",
  };
  const fixture = workflowDispatchRunner({
    evidence,
    workflowName: "mage-image",
    newRuns: [newRun],
  });
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: fixture.run,
  });
  const dispatched = await adapters["mage-image-workflow-dispatch"](
    {},
    stateWithSoulxWorkflowRegistration(evidence),
  );
  assert.equal(dispatched.runId, EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id);
  assert.equal(dispatched.dispatchAccepted, false);
  assert.equal(dispatched.reconciledExistingExact, true);
  assert.equal(dispatched.mutationPerformed, false);
  assert.equal(dispatched.imageDigest, EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_image_digest);
  assert.equal(dispatched.evidenceSha256, EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_evidence_sha256);
  assert.equal(
    fixture.calls.filter(([command, args]) => command === "gh" && args[0] === "workflow").length,
    0,
  );
  assert.deepEqual(fixture.calls.find(([, args]) => args[0] === "run" && args[1] === "view")[1], [
    "run",
    "view",
    EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id,
    "--json",
    "databaseId,headSha,workflowName,status,conclusion",
  ]);
  assert.equal(
    fixture.calls.filter(([, args]) => args.at(-1)?.includes("actions/workflows/")).length,
    2,
  );
});

test("SoulX workflow dispatch fails closed before any GitHub command without registration evidence", async () => {
  const calls = [];
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: (command, args) => {
      calls.push([command, args]);
      return result(0, "[]");
    },
  });
  await assert.rejects(
    adapters["soulx-image-workflow-dispatch"]({}, state),
    /SOULX_WORKFLOW_REGISTRATION_REQUIRED/u,
  );
  assert.deepEqual(calls, []);
});

test("SoulX workflow dispatch fails closed on a mismatched bound registration hash", async () => {
  const evidence = soulxWorkflowRegistrationEvidenceFixture();
  const calls = [];
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: (command, args) => {
      calls.push([command, args]);
      return result(0, "[]");
    },
  });
  await assert.rejects(
    adapters["soulx-image-workflow-dispatch"](
      {},
      {
        ...stateWithSoulxWorkflowRegistration(evidence),
        soulx_workflow_registration_evidence_sha256: hash(Buffer.from("different")),
      },
    ),
    /SOULX_WORKFLOW_REGISTRATION_BINDING_MISMATCH/u,
  );
  assert.deepEqual(calls, []);
});

test("SoulX workflow dispatch accepts only an exact materialized default-branch registration", async () => {
  const evidence = soulxWorkflowRegistrationEvidenceFixture();
  const stateWithEvidence = stateWithSoulxWorkflowRegistration(evidence);
  assert.equal(
    validateSoulxWorkflowRegistrationEvidence(evidence, stateWithEvidence).evidence_sha256,
    evidence.evidence_sha256,
  );
  const newRun = {
    databaseId: 12,
    headSha: sourceCommit,
    workflowName: "avatar-primary-serverless-image",
    status: "queued",
  };
  const fixture = workflowDispatchRunner({
    evidence,
    workflowName: "avatar-primary-serverless-image",
    newRuns: [newRun],
  });
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: fixture.run,
  });
  const dispatched = await adapters["soulx-image-workflow-dispatch"]({}, stateWithEvidence);
  assert.equal(dispatched.runId, "12");
  assert.equal(dispatched.workflowRegistrationEvidenceSha256, evidence.evidence_sha256);
  assert.equal(
    dispatched.freshWorkflowReadbackSha256,
    dispatched.freshWorkflowReadback.proofSha256,
  );
  assert.deepEqual(
    dispatched.freshWorkflowReadback.workflows.map(
      ({
        workflowFile,
        workflowName,
        defaultBranchWorkflowSha256,
        releaseSourceWorkflowSha256,
        defaultBranchMatchesReleaseSource,
      }) => ({
        workflowFile,
        workflowName,
        defaultBranchWorkflowSha256,
        releaseSourceWorkflowSha256,
        defaultBranchMatchesReleaseSource,
      }),
    ),
    [
      {
        workflowFile: "mage-image.yml",
        workflowName: "mage-image",
        defaultBranchWorkflowSha256: hash(Buffer.from("mage-image workflow\n")),
        releaseSourceWorkflowSha256: hash(Buffer.from("mage-image workflow\n")),
        defaultBranchMatchesReleaseSource: true,
      },
      {
        workflowFile: "avatar-primary-serverless-image.yml",
        workflowName: "avatar-primary-serverless-image",
        defaultBranchWorkflowSha256: evidence.default_branch_workflow_sha256,
        releaseSourceWorkflowSha256: evidence.release_source_workflow_sha256,
        defaultBranchMatchesReleaseSource: true,
      },
    ],
  );
  const unsignedReadback = { ...dispatched.freshWorkflowReadback };
  delete unsignedReadback.proofSha256;
  assert.equal(
    dispatched.freshWorkflowReadback.proofSha256,
    hash(Buffer.from(canonicalJson(unsignedReadback))),
  );
  assert.equal(
    fixture.calls.filter(([command, args]) => command === "gh" && args[0] === "workflow").length,
    1,
  );
});

test("successor SoulX dispatch accepts exact separate active-main and release-ref workflow bytes", async () => {
  const evidence = successorSoulxWorkflowRegistrationEvidenceFixture();
  const successorState = successorStateWithSoulxWorkflowRegistration(evidence);
  const fixture = workflowDispatchRunner({
    evidence,
    workflowName: "avatar-primary-serverless-image",
    newRuns: [
      {
        databaseId: 120,
        headSha: SUCCESSOR_RELEASE_SOURCE_COMMIT,
        workflowName: "avatar-primary-serverless-image",
        status: "queued",
      },
    ],
    mainWorkflowBytes: {
      "avatar-primary-serverless-image.yml": successorSoulxMainBytes,
    },
    releaseWorkflowBytes: {
      "avatar-primary-serverless-image.yml": successorSoulxReleaseBytes,
    },
  });
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: fixture.run,
  });
  const dispatched = await adapters["soulx-image-workflow-dispatch"]({}, successorState);
  assert.equal(dispatched.runId, "120");
  assert.equal(dispatched.headSha, SUCCESSOR_RELEASE_SOURCE_COMMIT);
  const soulxReadback = dispatched.freshWorkflowReadback.workflows[1];
  assert.equal(soulxReadback.defaultBranchWorkflowSha256, hash(successorSoulxMainBytes));
  assert.equal(soulxReadback.releaseSourceWorkflowSha256, hash(successorSoulxReleaseBytes));
  assert.equal(soulxReadback.defaultBranchMatchesReleaseSource, false);
  assert.deepEqual(
    fixture.calls.find(([, args]) => args[0] === "workflow" && args[1] === "run")[1].slice(0, 5),
    ["workflow", "run", "avatar-primary-serverless-image.yml", "--ref", SUCCESSOR_TAG],
  );
});

test("successor workflow registration rejects any active-main or release-ref binding drift", async () => {
  const evidence = successorSoulxWorkflowRegistrationEvidenceFixture();
  const cases = [
    { mainWorkflowBytes: { "avatar-primary-serverless-image.yml": Buffer.from("wrong main") } },
    {
      releaseWorkflowBytes: {
        "avatar-primary-serverless-image.yml": Buffer.from("wrong release"),
      },
    },
    { workflowIds: { "avatar-primary-serverless-image.yml": 999 } },
  ];
  for (const fixtureOverrides of cases) {
    const fixture = workflowDispatchRunner({
      evidence,
      workflowName: "avatar-primary-serverless-image",
      newRuns: [],
      mainWorkflowBytes: {
        "avatar-primary-serverless-image.yml": successorSoulxMainBytes,
      },
      releaseWorkflowBytes: {
        "avatar-primary-serverless-image.yml": successorSoulxReleaseBytes,
      },
      ...fixtureOverrides,
    });
    const adapters = createGithubDispatchAdapters({
      maximumPolls: 1,
      pollIntervalMs: 0,
      run: fixture.run,
    });
    await assert.rejects(
      adapters["soulx-image-workflow-dispatch"](
        {},
        successorStateWithSoulxWorkflowRegistration(evidence),
      ),
      /SOULX_WORKFLOW_REGISTRATION_STALE/u,
    );
    assert.equal(
      fixture.calls.some(([, args]) => args[0] === "workflow" && args[1] === "run"),
      false,
    );
  }
});

test("successor Mage reconciliation keeps the exact historical head and never redispatches", async () => {
  const evidence = successorSoulxWorkflowRegistrationEvidenceFixture();
  const fixture = workflowDispatchRunner({
    evidence,
    workflowName: "mage-image",
    newRuns: [
      {
        databaseId: Number(EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id),
        headSha: EXACT_PREDECESSOR_RELEASE_ATTEMPT.exact_tag_target_commit,
        workflowName: "mage-image",
        status: "completed",
        conclusion: "success",
      },
    ],
    mainWorkflowBytes: {
      "avatar-primary-serverless-image.yml": successorSoulxMainBytes,
    },
    releaseWorkflowBytes: {
      "avatar-primary-serverless-image.yml": successorSoulxReleaseBytes,
    },
  });
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: fixture.run,
  });
  const reconciled = await adapters["mage-image-workflow-dispatch"](
    {},
    successorStateWithSoulxWorkflowRegistration(evidence),
  );
  assert.equal(reconciled.headSha, EXACT_PREDECESSOR_RELEASE_ATTEMPT.exact_tag_target_commit);
  assert.equal(reconciled.dispatchAccepted, false);
  assert.equal(
    fixture.calls.some(([, args]) => args[0] === "workflow" && args[1] === "run"),
    false,
  );
});

test("successor Mage reconciliation rejects a run falsely attributed to the new SoulX source", async () => {
  const evidence = successorSoulxWorkflowRegistrationEvidenceFixture();
  const fixture = workflowDispatchRunner({
    evidence,
    workflowName: "mage-image",
    newRuns: [
      {
        databaseId: Number(EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id),
        headSha: SUCCESSOR_RELEASE_SOURCE_COMMIT,
        workflowName: "mage-image",
        status: "completed",
        conclusion: "success",
      },
    ],
    mainWorkflowBytes: {
      "avatar-primary-serverless-image.yml": successorSoulxMainBytes,
    },
    releaseWorkflowBytes: {
      "avatar-primary-serverless-image.yml": successorSoulxReleaseBytes,
    },
  });
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: fixture.run,
  });
  await assert.rejects(
    adapters["mage-image-workflow-dispatch"](
      {},
      successorStateWithSoulxWorkflowRegistration(evidence),
    ),
    /MAGE_PREDECESSOR_RUN_READBACK/u,
  );
});

test("Mage default-branch drift is recorded without blocking predecessor reconciliation", async () => {
  const evidence = soulxWorkflowRegistrationEvidenceFixture();
  const fixture = workflowDispatchRunner({
    evidence,
    workflowName: "mage-image",
    newRuns: [],
    driftWorkflow: "mage-image.yml",
  });
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: fixture.run,
  });
  const reconciled = await adapters["mage-image-workflow-dispatch"](
    {},
    stateWithSoulxWorkflowRegistration(evidence),
  );
  const proof = reconciled.freshWorkflowReadback;
  assert.equal(proof.schemaVersion, "videoforge.v213-fresh-default-branch-workflow-readback/v2");
  assert.equal(proof.bothWorkflowsRegisteredActive, true);
  assert.equal(proof.releaseSourceContentsVerified, true);
  assert.equal(proof.workflows[0].defaultBranchMatchesReleaseSource, false);
  assert.notEqual(
    proof.workflows[0].defaultBranchWorkflowSha256,
    proof.workflows[0].releaseSourceWorkflowSha256,
  );
  assert.equal(proof.workflows[1].defaultBranchMatchesReleaseSource, true);
  assert.equal(reconciled.dispatchAccepted, false);
  assert.equal(reconciled.reconciledExistingExact, true);
  assert.equal(
    fixture.calls.some(([command, args]) => command === "gh" && args[0] === "workflow"),
    false,
  );
});

test("historical descriptor v1 cannot dispatch even when supplied copied registration bytes", async () => {
  const evidence = soulxWorkflowRegistrationEvidenceFixture();
  const calls = [];
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: (command, args) => {
      calls.push([command, args]);
      return result(0, "[]");
    },
  });
  await assert.rejects(
    adapters["mage-image-workflow-dispatch"](
      {},
      {
        ...state,
        static_release_descriptor_schema_version: "videoforge.v213-static-release-descriptor/v1",
        soulx_workflow_registration_evidence: evidence,
        soulx_workflow_registration_evidence_sha256: evidence.evidence_sha256,
      },
    ),
    /WORKFLOW_REGISTRATION_DESCRIPTOR_VERSION_REQUIRED/u,
  );
  assert.deepEqual(calls, []);
});

test("fresh dual-workflow gate stops before dispatch on moved main missing inactive byte drift or stale evidence", async () => {
  const evidence = soulxWorkflowRegistrationEvidenceFixture();
  const cases = [
    [{ defaultBranch: "trunk" }, /WORKFLOW_DEFAULT_BRANCH_DRIFT/u],
    [{ missingWorkflow: "mage-image.yml" }, /COMMAND/u],
    [{ inactiveWorkflow: "avatar-primary-serverless-image.yml" }, /REGISTRATION/u],
    [
      { driftWorkflow: "avatar-primary-serverless-image.yml" },
      /WORKFLOW_DEFAULT_BRANCH_RELEASE_DRIFT/u,
    ],
    [{ mainCommit: "8".repeat(40) }, /SOULX_WORKFLOW_REGISTRATION_STALE/u],
  ];
  for (const [drift, expected] of cases) {
    const fixture = workflowDispatchRunner({
      evidence,
      workflowName: "mage-image",
      newRuns: [],
      ...drift,
    });
    const adapters = createGithubDispatchAdapters({
      maximumPolls: 1,
      pollIntervalMs: 0,
      run: fixture.run,
    });
    await assert.rejects(
      adapters["mage-image-workflow-dispatch"]({}, stateWithSoulxWorkflowRegistration(evidence)),
      expected,
    );
    assert.equal(
      fixture.calls.some(([, args]) => args[0] === "workflow" && args[1] === "run"),
      false,
    );
  }
});

test("workflow gate rejects evidence and verifier injection options", () => {
  const evidence = soulxWorkflowRegistrationEvidenceFixture();
  assert.throws(
    () => createGithubDispatchAdapters({ workflowRegistrationEvidence: evidence }),
    /WORKFLOW_DISPATCH_OPTIONS/u,
  );
  assert.throws(
    () =>
      createGithubDispatchAdapters({
        verifyFreshWorkflowRegistration: () => ({ proofSha256: hash(Buffer.from("forged")) }),
      }),
    /WORKFLOW_DISPATCH_OPTIONS/u,
  );
});

test("trusted time uses credential-free bounded HTTPS and one exact Date header", () => {
  const trusted = readAuthenticatedGithubTime({
    run: (command, args) => {
      assert.equal(command, "curl");
      assert.deepEqual(args, [
        "--disable",
        "--silent",
        "--show-error",
        "--head",
        "--proto",
        "=https",
        "--tlsv1.2",
        "--connect-timeout",
        "5",
        "--max-time",
        "10",
        "https://api.github.com/",
      ]);
      return result(0, "HTTP/2 200\r\ndate: Wed, 26 Aug 2026 12:00:00 GMT\r\n\r\n");
    },
  });
  assert.equal(trusted, "2026-08-26T12:00:00.000Z");
  closedTrustedTimeCommand("curl", ["--disable"], 12_000, (command, args, options) => {
    assert.equal(command, "curl");
    assert.deepEqual(args, ["--disable"]);
    assert.deepEqual(Object.keys(options.env).sort(), ["NO_PROXY", "PATH", "no_proxy"]);
    assert.equal(options.env.NO_PROXY, "*");
    assert.equal(options.env.no_proxy, "*");
    assert.equal(options.timeout, 12_000);
    return result(0);
  });
});

test("trusted time retries bounded credential-free read failures before returning one exact Date", () => {
  let calls = 0;
  const trusted = readAuthenticatedGithubTime({
    run: () => {
      calls += 1;
      if (calls === 1) return result(6, "", "temporary DNS failure");
      if (calls === 2) return result(0, "HTTP/2 200\r\n\r\n");
      return result(0, "HTTP/2 200\r\ndate: Wed, 26 Aug 2026 12:00:00 GMT\r\n\r\n");
    },
  });
  assert.equal(calls, 3);
  assert.equal(trusted, "2026-08-26T12:00:00.000Z");
});

test("trusted time stops after the exact bounded attempt count", () => {
  let calls = 0;
  assert.throws(
    () =>
      readAuthenticatedGithubTime({
        run: () => {
          calls += 1;
          return result(6, "", "temporary DNS failure");
        },
      }),
    /V2_13_FULL_LIVE_ADAPTER_COMMAND/u,
  );
  assert.equal(calls, 3);
});

test("GitHub dispatch rejects ambiguous new runs and never redispatches", async () => {
  const evidence = soulxWorkflowRegistrationEvidenceFixture();
  const makeRun = (databaseId) => ({
    databaseId,
    headSha: sourceCommit,
    workflowName: "avatar-primary-serverless-image",
    status: "queued",
  });
  const fixture = workflowDispatchRunner({
    evidence,
    workflowName: "avatar-primary-serverless-image",
    newRuns: [makeRun(20), makeRun(21)],
  });
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: fixture.run,
  });
  await assert.rejects(
    adapters["soulx-image-workflow-dispatch"]({}, stateWithSoulxWorkflowRegistration(evidence)),
    /GITHUB_DISPATCH_AMBIGUOUS/u,
  );
  assert.equal(
    fixture.calls.filter(([command, args]) => command === "gh" && args[0] === "workflow").length,
    1,
  );
});

test("GitHub verification binds exact successful run and immutable deployability artifact", async () => {
  const digest = `sha256:${"6".repeat(64)}`;
  const configDigest = `sha256:${"7".repeat(64)}`;
  const layerDigest = `sha256:${"8".repeat(64)}`;
  const anonymousProof = {
    schema_version: "videoforge-anonymous-ghcr-publication-proof/v1",
    registry: "ghcr.io",
    repository: "pala-lakshmansai/videoforge-soulx-serverless-v2-08",
    authentication: "GHCR_ANONYMOUS_PULL_TOKEN",
    workflow_repository: "Pala-LakshmanSai/videoforge",
    workflow_name: "avatar-primary-serverless-image",
    workflow_ref: `refs/tags/${TAG}`,
    workflow_commit: sourceCommit,
    workflow_run_id: "11",
    registry_observed_at: "2026-08-26T12:00:00Z",
    manifest: {
      digest,
      header_digest: digest,
      content_sha256: digest,
      media_type: "application/vnd.docker.distribution.manifest.v2+json",
      response_content_type: "application/vnd.docker.distribution.manifest.v2+json",
      size_bytes: 123,
      http_status: 200,
    },
    config: {
      kind: "config",
      index: 0,
      digest: configDigest,
      media_type: "application/vnd.docker.container.image.v1+json",
      declared_size_bytes: 11,
      observed_size_bytes: 11,
      content_sha256: configDigest,
      http_status: 200,
      registry_observed_at: "2026-08-26T12:00:00Z",
    },
    layers: [
      {
        kind: "layer",
        index: 0,
        digest: layerDigest,
        media_type: "application/vnd.docker.image.rootfs.diff.tar.gzip",
        declared_size_bytes: 22,
        observed_size_bytes: 22,
        content_sha256: layerDigest,
        http_status: 200,
        registry_observed_at: "2026-08-26T12:00:01Z",
      },
    ],
    all_blobs_verified: true,
  };
  anonymousProof.proof_sha256 = hash(Buffer.from(canonicalJson(anonymousProof)));
  const evidence = {
    schema_version: "videoforge-image-deployability/v2",
    checkpoint: "V2-08",
    lane: "soulx_avatar",
    source_commit: sourceCommit,
    registry_repository: "pala-lakshmansai/videoforge-soulx-serverless-v2-08",
    publication_requested: true,
    published: true,
    publication_state: "PUBLISHED_NEW_DIGEST",
    status: "PUBLISHED_IMMUTABLE_IMAGE",
    qualification_status: "REQUIRES_FRESH_LIVE_REQUALIFICATION",
    prior_qualification_reused: false,
    platform: "linux/amd64",
    model_volume: "/runpod-volume",
    model_download_performed: false,
    provider_endpoint_mutation_performed: false,
    immutable_image: `ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@${digest}`,
    image_digest: digest,
    config_digest: configDigest,
    layer_digest: layerDigest,
    anonymous_publication_proof: anonymousProof,
  };
  const statuses = ["queued", "in_progress", "completed"];
  let viewCalls = 0;
  const adapters = createGithubVerificationAdapters({
    maximumPolls: 3,
    pollIntervalMs: 0,
    trustedTime: async () => "2026-08-26T12:00:00Z",
    run: (_command, args) => {
      if (args[1] === "view") {
        const status = statuses[viewCalls++];
        return result(
          0,
          JSON.stringify({
            databaseId: 11,
            headSha: sourceCommit,
            workflowName: "avatar-primary-serverless-image",
            status,
            conclusion: status === "completed" ? "success" : null,
          }),
        );
      }
      const directory = args.at(-1);
      writeFileSync(
        resolve(directory, "soulx-serverless-v2-08.json"),
        `${JSON.stringify(evidence)}\n`,
      );
      return result(0);
    },
  });
  const prior = new Map([["soulx-image-workflow-dispatch", { runId: "11" }]]);
  const verified = await adapters["soulx-image-workflow-verification"]({}, state, prior);
  assert.equal(verified.imageDigest, digest);
  assert.equal(viewCalls, 3);
  assert.equal(verified.publicAllBlobsVerified, true);
  assert.equal(verified.anonymousPublicationProofSha256, anonymousProof.proof_sha256);
  assert.match(verified.evidenceSha256, /^sha256:[0-9a-f]{64}$/u);
});

test("GitHub verification never redispatches and fails closed on bounded terminal timeout", async () => {
  let calls = 0;
  const adapters = createGithubVerificationAdapters({
    maximumPolls: 2,
    pollIntervalMs: 0,
    trustedTime: async () => "2026-08-26T12:00:00Z",
    run: (_command, args) => {
      calls += 1;
      assert.deepEqual(args.slice(0, 3), ["run", "view", "11"]);
      return result(
        0,
        JSON.stringify({
          databaseId: 11,
          headSha: sourceCommit,
          workflowName: "avatar-primary-serverless-image",
          status: "in_progress",
          conclusion: null,
        }),
      );
    },
  });
  const prior = new Map([["soulx-image-workflow-dispatch", { runId: "11" }]]);
  await assert.rejects(
    adapters["soulx-image-workflow-verification"]({}, state, prior),
    /WORKFLOW_RUN_TERMINAL_TIMEOUT/u,
  );
  assert.equal(calls, 2);
});

test("Mage verification accepts only the exact predecessor run before any provider read", async () => {
  const calls = [];
  const adapters = createGithubVerificationAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: (command, args) => {
      calls.push([command, args]);
      return result(0, "{}");
    },
  });
  await assert.rejects(
    adapters["mage-image-workflow-verification"](
      {},
      { ...state, predecessor_release_attempt: EXACT_PREDECESSOR_RELEASE_ATTEMPT },
      new Map([["mage-image-workflow-dispatch", { runId: "11" }]]),
    ),
    /MAGE_PREDECESSOR_RUN_BINDING/u,
  );
  assert.deepEqual(calls, []);
});

test("successor verification assigns the historical head only to Mage and the new head to SoulX", async () => {
  const evidence = successorSoulxWorkflowRegistrationEvidenceFixture();
  const successorState = successorStateWithSoulxWorkflowRegistration(evidence);
  const lanes = [
    {
      operationId: "mage-image-workflow-verification",
      dispatchId: "mage-image-workflow-dispatch",
      runId: EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id,
      workflowName: "mage-image",
      headSha: EXACT_PREDECESSOR_RELEASE_ATTEMPT.exact_tag_target_commit,
    },
    {
      operationId: "soulx-image-workflow-verification",
      dispatchId: "soulx-image-workflow-dispatch",
      runId: "33290000000",
      workflowName: "avatar-primary-serverless-image",
      headSha: SUCCESSOR_RELEASE_SOURCE_COMMIT,
    },
  ];
  for (const lane of lanes) {
    const calls = [];
    const adapters = createGithubVerificationAdapters({
      maximumPolls: 1,
      pollIntervalMs: 0,
      trustedTime: async () => "2026-08-26T12:00:00Z",
      run: (_command, args) => {
        calls.push(args);
        if (args[1] === "view")
          return result(
            0,
            JSON.stringify({
              databaseId: Number(lane.runId),
              headSha: lane.headSha,
              workflowName: lane.workflowName,
              status: "completed",
              conclusion: "success",
            }),
          );
        return result(1, "", "bounded artifact stop");
      },
    });
    await assert.rejects(
      adapters[lane.operationId](
        {},
        successorState,
        new Map([[lane.dispatchId, { runId: lane.runId }]]),
      ),
      /V2_13_FULL_LIVE_ADAPTER_COMMAND/u,
    );
    assert.equal(
      calls.some((args) => args[1] === "download"),
      true,
    );
  }

  const wrongMageCalls = [];
  const wrongMage = createGithubVerificationAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    trustedTime: async () => "2026-08-26T12:00:00Z",
    run: (_command, args) => {
      wrongMageCalls.push(args);
      return result(
        0,
        JSON.stringify({
          databaseId: Number(EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id),
          headSha: SUCCESSOR_RELEASE_SOURCE_COMMIT,
          workflowName: "mage-image",
          status: "completed",
          conclusion: "success",
        }),
      );
    },
  });
  await assert.rejects(
    wrongMage["mage-image-workflow-verification"](
      {},
      successorState,
      new Map([
        [
          "mage-image-workflow-dispatch",
          { runId: EXACT_PREDECESSOR_RELEASE_ATTEMPT.mage_workflow_run_id },
        ],
      ]),
    ),
    /WORKFLOW_RUN_READBACK/u,
  );
  assert.equal(
    wrongMageCalls.some((args) => args[1] === "download"),
    false,
  );
});

test("GitHub verification enforces one monotonic 1800000ms deadline across subprocess time", async () => {
  let clock = 0;
  let timeoutSeen = null;
  const adapters = createGithubVerificationAdapters({
    deadlineNow: () => clock,
    maximumPolls: 180,
    pollIntervalMs: 10_000,
    trustedTime: async (timeoutMs) => {
      assert.ok(timeoutMs <= 12_000);
      clock += 1_000;
      return "2026-08-26T12:00:00Z";
    },
    run: (_command, _args, timeoutMs) => {
      timeoutSeen = timeoutMs;
      clock = 1_800_001;
      return result(
        0,
        JSON.stringify({
          databaseId: 11,
          headSha: sourceCommit,
          workflowName: "avatar-primary-serverless-image",
          status: "in_progress",
          conclusion: null,
        }),
      );
    },
  });
  const prior = new Map([["soulx-image-workflow-dispatch", { runId: "11" }]]);
  await assert.rejects(
    adapters["soulx-image-workflow-verification"]({}, state, prior),
    /WORKFLOW_RUN_TERMINAL_TIMEOUT/u,
  );
  assert.ok(timeoutSeen > 0 && timeoutSeen <= 60_000);
});

test("guarded adapter calls the existing executor once and authenticates its durable evidence", async () => {
  const environment = Object.fromEntries(
    [
      "ACTIVATION_RECORD",
      "CONFIG_ACTIVATION_RECORD",
      "PROPOSAL_FILE",
      "RELEASE_MANIFEST_FILE",
      "USER_APPROVAL_FILE",
      "WRANGLER_OAUTH_CONFIG_FILE",
      "ACTIVATION_EVIDENCE_OUTPUT",
      "POSTGRES_INPUT_DIR",
      "SECRET_INPUT_DIR",
    ].map((suffix) => [`VIDEOFORGE_V2_13_${suffix}`, `/private/${suffix.toLowerCase()}`]),
  );
  const evidence = Buffer.from(
    `${JSON.stringify({
      schema_version: "videoforge-v2-13-guarded-activation-evidence/v1",
      commit: sourceCommit,
      outcome: "SUCCEEDED",
      disabled_version_id: "11111111-1111-4111-8111-111111111111",
      disabled_version_sha256: hash("11111111-1111-4111-8111-111111111111"),
      external_spend_cap_usd: 0,
      new_paid_retained_resources_authorized: false,
    })}\n`,
  );
  let calls = 0;
  const adapter = createGuardedActivationAdapter({
    environment,
    readEvidence: () => evidence,
    preflight: () => true,
    prepareSource: () => ({ root: "/isolated-release-source", cleanup: () => {} }),
    run: (command, args) => {
      calls += 1;
      assert.equal(command, process.execPath);
      assert.equal(args[0], "/isolated-release-source/deploy/v2-13/guarded-activation.mjs");
      assert.equal(args.filter((value) => value === "--execute").length, 1);
      assert.equal(args.at(-1), "EXECUTE_EXACT_GUARDED_V2_13_ACTIVATION");
      return result(
        0,
        JSON.stringify({
          schema_version: "videoforge-v2-13-guarded-activation-result/v1",
          state: "DISABLED_UNQUALIFIED",
          commit: sourceCommit,
        }),
      );
    },
  });
  const value = await adapter({}, state);
  assert.equal(calls, 1);
  assert.equal(value.executedOnce, true);
  assert.match(value.evidenceSha256, /^sha256:[0-9a-f]{64}$/u);

  const executionControlCommit = "5".repeat(40);
  const v4Adapter = createGuardedActivationAdapter({
    environment,
    readEvidence: () => evidence,
    preflight: () => true,
    prepareSource: (targetCommit) => {
      assert.equal(targetCommit, executionControlCommit);
      return { root: "/isolated-release-source", cleanup: () => {} };
    },
    run: (command, args) => {
      assert.equal(command, process.execPath);
      assert.equal(args[0], "/isolated-release-source/deploy/v2-13/guarded-activation.mjs");
      return result(
        0,
        JSON.stringify({
          schema_version: "videoforge-v2-13-guarded-activation-result/v1",
          state: "DISABLED_UNQUALIFIED",
          commit: sourceCommit,
        }),
      );
    },
  });
  const v4Value = await v4Adapter(
    {},
    {
      ...state,
      schema_version: "videoforge.v2-13-full-live-orchestration-consumption/v3",
      execution_control_commit: executionControlCommit,
      release_ref: { ...state.release_ref, mode: "PREDECESSOR_BOUND_RECONCILIATION_ONLY" },
    },
  );
  assert.equal(v4Value.executedOnce, true);
});

test("promotion hashes closed dry-output bytes, independent of Wrangler stdout", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-dry-output-hash-test-"));
  try {
    mkdirSync(resolve(directory, "assets"), { mode: 0o700 });
    writeFileSync(
      resolve(directory, "index.js"),
      "export default {fetch(){return new Response('a')}};\n",
    );
    writeFileSync(resolve(directory, "assets", "manifest.json"), '{"version":1}\n');
    const first = hashV213DryOutputBundle(directory);
    // Console output is deliberately not an input to the helper.
    const withDifferentStdout = hashV213DryOutputBundle(directory);
    assert.equal(first, withDifferentStdout);
    writeFileSync(
      resolve(directory, "index.js"),
      "export default {fetch(){return new Response('b')}};\n",
    );
    assert.notEqual(first, hashV213DryOutputBundle(directory));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("promotion journal atomically persists exact restart entries and rejects same-key drift", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-promotion-journal-test-"));
  const journalDirectory = resolve(directory, "journal");
  try {
    const journal = createDurablePromotionFileJournal({ directory: journalDirectory });
    const entry = {
      schemaVersion: "videoforge.v213-qualified-promotion-journal-entry/v1",
      promotionId: "55555555-5555-4555-8555-555555555555",
      authorityId: "44444444-4444-4444-8444-444444444444",
      step: "CLOUDFLARE_DEPLOY",
      status: "INTENT",
      inputSha256: hash(Buffer.from("deploy-input")),
      input: { enabledConfigSha256: hash(Buffer.from("enabled")) },
      outputSha256: null,
      output: null,
    };
    assert.deepEqual(await journal.record(entry), entry);
    const restarted = createDurablePromotionFileJournal({ directory: journalDirectory });
    assert.deepEqual(
      await restarted.read({
        promotionId: entry.promotionId,
        step: entry.step,
        status: entry.status,
      }),
      entry,
    );
    await assert.rejects(
      restarted.record({ ...entry, inputSha256: hash(Buffer.from("drift")) }),
      /PROMOTION_JOURNAL_ENTRY_DRIFT/u,
    );
    assert.equal(lstatSync(journalDirectory).mode & 0o077, 0);
    const entryPath = resolve(
      journalDirectory,
      `${entry.promotionId}.${entry.step}.${entry.status}.json`,
    );
    assert.equal(lstatSync(entryPath).mode & 0o077, 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("qualified promotion transport reconciles durable intents without repeating provider deploy", async () => {
  const calls = [];
  const database = {
    query: async (sql, parameters) => {
      calls.push(["database", sql, parameters]);
      if (sql.includes("videoforge_promote_hosted_full_live"))
        return { rows: [{ decision_sha256: hash(Buffer.from("database-promotion")) }] };
      if (sql.includes("videoforge_record_v213_cloudflare_activation"))
        return {
          rows: [
            {
              activation: {
                versionIdSha256: hash(Buffer.from("enabled-version")),
                readbackSha256: hash(Buffer.from("activation-readback")),
              },
            },
          ],
        };
      if (sql.includes("videoforge_record_v213_cloudflare_rollback"))
        return {
          rows: [
            {
              rollback: {
                rollbackSha256: hash(Buffer.from("rollback-record")),
                disabledVersionIdSha256: hash(Buffer.from("disabled-version")),
                disabledConfigSha256: hash(Buffer.from("disabled-config")),
              },
            },
          ],
        };
      throw new Error("unexpected database query");
    },
  };
  let providerDeploys = 0;
  const recoveredDeployment = { versionSha256: hash(Buffer.from("enabled-version")) };
  const disabledDeployment = { versionSha256: hash(Buffer.from("disabled-version")) };
  const cloudflare = {
    dryRun: async () => ({}),
    deploy: async () => {
      providerDeploys += 1;
      return recoveredDeployment;
    },
    readback: async () => ({}),
    routeReadback: async () => ({}),
    rollback: async () => ({}),
    reconcileDeployment: async () => {
      calls.push(["cloudflare", "reconcile-deployment"]);
      return recoveredDeployment;
    },
    readDisabledDeployment: async () => disabledDeployment,
    reconcileRollback: async () => disabledDeployment,
  };
  const journal = { read: async () => null, record: async (entry) => entry };
  const transport = createRecoverableQualifiedPromotionTransport({
    database,
    cloudflare,
    journal,
  });
  assert.equal(transport.recovery.journal, journal);
  assert.equal(await transport.recovery.reconcileDeployment(), recoveredDeployment);
  assert.equal(providerDeploys, 0);
  assert.equal(await transport.recovery.readDisabledDeployment(), disabledDeployment);
  assert.equal(await transport.recovery.reconcileRollback(), disabledDeployment);
  assert.equal(providerDeploys, 0);
  const databasePromotionInput = {
    promotionId: "55555555-5555-4555-8555-555555555555",
    authorityId: "44444444-4444-4444-8444-444444444444",
    promotion: { exact: true },
  };
  assert.match(
    (await transport.recovery.reconcileDatabasePromotion(databasePromotionInput)).decision_sha256,
    /^sha256:[0-9a-f]{64}$/u,
  );
  const activation = await transport.recovery.reconcileActivation({
    activationId: "66666666-6666-4666-8666-666666666666",
    promotionId: databasePromotionInput.promotionId,
    sourceCommit,
    versionIdSha256: recoveredDeployment.versionSha256,
    deployedExecutableSha256: hash(Buffer.from("executable")),
    deployedConfigSha256: hash(Buffer.from("enabled-config")),
    productionUrlSha256: hash(Buffer.from("origin")),
    routeStatus: 200,
    routeBodySha256: hash(Buffer.from("route-body")),
    routeVersionSha256: recoveredDeployment.versionSha256,
    routeReadbackSha256: hash(Buffer.from("route-readback")),
    observedAt: "2026-08-29T00:00:00.000Z",
    evidenceSha256: hash(Buffer.from("evidence")),
  });
  assert.match(activation.readbackSha256, /^sha256:[0-9a-f]{64}$/u);
  const rollback = await transport.recovery.reconcileRollbackRecord({
    rollbackId: "77777777-7777-4777-8777-777777777777",
    activationId: "66666666-6666-4666-8666-666666666666",
    promotionId: databasePromotionInput.promotionId,
    disabledVersionIdSha256: disabledDeployment.versionSha256,
    disabledConfigSha256: hash(Buffer.from("disabled-config")),
    routeStatus: 503,
    routeVersionSha256: disabledDeployment.versionSha256,
    observedAt: "2026-08-29T00:01:00.000Z",
  });
  assert.match(rollback.rollbackSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(providerDeploys, 0);
  assert.deepEqual(
    calls.filter(([kind]) => kind === "cloudflare"),
    [["cloudflare", "reconcile-deployment"]],
  );
});

test("cleanup-only op22/op25 binds stable disabled-production and exact DB rollback proof", async () => {
  const record = {
    database: {
      full_live_authority_id: "44444444-4444-4444-8444-444444444444",
      promotion_id: "55555555-5555-4555-8555-555555555555",
    },
    release: { disabled_config_sha256: hash(Buffer.from("disabled-config")) },
    cloudflare: { disabled_version_sha256: hash(Buffer.from("disabled-version")) },
  };
  const reconciliation = {
    record,
    result: {
      state: "DISABLED_UNQUALIFIED",
      enabled: false,
      gpuDispatchPerformed: false,
      versionSha256: record.cloudflare.disabled_version_sha256,
      databasePromotionAttempted: true,
      databasePromotionSha256: hash(Buffer.from("database-promotion")),
      rollbackRecorded: true,
      rollbackSha256: hash(Buffer.from("rollback-record")),
    },
  };
  const proof = createQualifiedProductionCleanupProof(record, reconciliation.result);
  let reconciliations = 0;
  let observedContext;
  const wrapped = createPromotionAwareCleanupAdapter({
    operationId: "restore-endpoints-max-one",
    reconcilePromotionCleanup: async () => {
      reconciliations += 1;
      return reconciliation;
    },
    hasPromotionMaterialization: async () => true,
    adapter: async (context) => {
      observedContext = context;
      return {
        actualUsd: 0,
        proofSha256: hash(Buffer.from("cleanup-receipt")),
        bridgeSummary: { qualifiedProductionCleanup: context.qualifiedProductionCleanup },
      };
    },
  });
  const cleanup = await wrapped(
    { cleanupOnly: true, earlyFailure: false },
    {},
    new Map(),
    hash(Buffer.from("outer-state")),
  );
  assert.equal(reconciliations, 1);
  assert.deepEqual(observedContext.qualifiedProductionCleanup, proof);
  assert.deepEqual(cleanup.qualifiedProductionCleanup, proof);
  assert.equal(cleanup.promotionCleanupEvidenceSha256, proof.proofSha256);
  assert.equal(proof.productionRedispatched, false);
  assert.equal(proof.databaseRollbackRecorded, true);

  const normal = await wrapped(
    { cleanupOnly: false },
    {},
    new Map(),
    hash(Buffer.from("normal-outer-state")),
  );
  assert.deepEqual(normal.qualifiedProductionCleanup, proof);
  await wrapped(
    { cleanupOnly: true, earlyFailure: true },
    {},
    new Map(),
    hash(Buffer.from("early-outer-state")),
  );
  assert.equal(reconciliations, 2);
});

test("cleanup closes an authorized but never-materialized promotion without requiring op15 artifact", async () => {
  let reconciliations = 0;
  const state = {
    authority_id: "33333333-3333-4333-8333-333333333333",
    full_live_authority_id: "44444444-4444-4444-8444-444444444444",
  };
  const wrapped = createPromotionAwareCleanupAdapter({
    operationId: "reconcile-exact-resources",
    hasPromotionMaterialization: async () => false,
    reconcilePromotionCleanup: async () => {
      reconciliations += 1;
      assert.fail("promotion reconciliation requires materialized promotion bytes");
    },
    adapter: async () => ({ actualUsd: 0, proofSha256: hash(Buffer.from("resources")) }),
  });
  const result = await wrapped(
    { cleanupOnly: true, earlyFailure: false },
    state,
    new Map(),
    hash(Buffer.from("outer")),
  );
  assert.equal(reconciliations, 0);
  assert.equal(result.promotionCleanupAbsence.promotionRecordMaterialized, false);
  assert.equal(result.promotionCleanupAbsence.databaseMutationPossible, false);
  assert.equal(
    result.promotionCleanupAbsenceEvidenceSha256,
    result.promotionCleanupAbsence.proofSha256,
  );
});

test("staged qualification adapters preserve admission, Mage, SoulX, then max-one boundaries", async () => {
  const calls = [];
  const deployment = (lane, marker) => {
    const endpointId = `${lane}-endpoint`;
    const retained =
      lane === "mage"
        ? {
            volumeIdSha256:
              "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
            volumeManifestSha256:
              "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
          }
        : {
            volumeIdSha256:
              "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
            volumeManifestSha256:
              "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
          };
    return {
      lane,
      workersMin: 0,
      workersMax: 1,
      endpointId,
      endpointIdSha256: hash(endpointId),
      templateIdSha256: hash(`${lane}-template`),
      image: `ghcr.io/example/${lane}@sha256:${marker.repeat(64)}`,
      sourceCommit: "1".repeat(40),
      deploymentSha256: `sha256:${marker.repeat(64)}`,
      ...retained,
      region: "EU-RO-1",
      gpu: "NVIDIA GeForce RTX 4090",
      gpuCount: 1,
    };
  };
  const receipt = (marker, cost) => ({
    settledCostUsd: cost,
    deploymentSha256: `sha256:${marker.repeat(64)}`,
  });
  const input = { soulx: { deploymentSha256: `sha256:${"9".repeat(64)}` } };
  const transport = {};
  const api = {
    issueV213StageAuthority: async (_transport, _input, stage) => {
      calls.push(`authority-${stage}`);
      return { stage };
    },
    readV213DualLaneAdmission: async () => {
      calls.push("admission");
      return {
        schemaVersion: "videoforge.v213-admission-handoff/v1",
        handoffSha256: `sha256:${"1".repeat(64)}`,
        admission: {
          gpu: "NVIDIA GeForce RTX 4090",
          region: "EU-RO-1",
          availability: "LOW",
          flexRateUsdPerGpuHour: 1.116,
          cumulativeBillingUsd: 2,
        },
      };
    },
    runV213MageQualification: async () => {
      calls.push("mage");
      return {
        schemaVersion: "videoforge.v213-mage-qualification-handoff/v1",
        handoffSha256: `sha256:${"2".repeat(64)}`,
        threeStableZeroWorkerReads: true,
        receipt: receipt("3", 0.5),
      };
    },
    runV213SoulXQualification: async () => {
      calls.push("soulx");
      return {
        schemaVersion: "videoforge.v213-soulx-qualification-handoff/v1",
        handoffSha256: `sha256:${"4".repeat(64)}`,
        threeStableZeroWorkerReads: true,
        receipts: [receipt("5", 0.1), receipt("6", 0.1), receipt("7", 0.1), receipt("8", 0.1)],
      };
    },
    createV213Max1Deployments: async () => {
      calls.push("max-one");
      return {
        schemaVersion: "videoforge.v213-dual-lane-live/v1",
        qualified: true,
        production: { mage: deployment("mage", "a"), soulx: deployment("soulx", "b") },
        settled: { threeStableZeroWorkerReads: true },
      };
    },
  };
  const adapters = createStagedQualificationAdapters({ api, transport, input });
  assert.equal((await adapters["fresh-live-preflight"]()).noFallback, true);
  assert.equal((await adapters["mage-live-qualification"]()).actualUsd, 0.5);
  assert.equal((await adapters["soulx-live-qualification"]()).actualUsd, 0.4);
  const maxOne = await adapters["create-exact-max-one-endpoints"]();
  assert.equal(maxOne.createdExactTwoEndpoints, true);
  assert.equal(maxOne.materialization.production.mage.endpointId, "mage-endpoint");
  assert.match(
    maxOne.materialization.production.mage.deploymentSnapshotSha256,
    /^sha256:[0-9a-f]{64}$/u,
  );
  assert.notEqual(
    maxOne.materialization.production.mage.deploymentSnapshotSha256,
    `sha256:${"a".repeat(64)}`,
  );
  assert.deepEqual(calls, [
    "admission",
    "authority-mage",
    "mage",
    "authority-soulx",
    "soulx",
    "authority-production",
    "max-one",
  ]);
  await assert.rejects(adapters["soulx-live-qualification"](), /QUALIFICATION_STAGE_ORDER/u);
});

test("concrete catalog exposes publication, guarded activation, and the protected TS bridge", () => {
  const currentBridgePins = {
    expectedCliSha256: hash(
      readFileSync(resolve(process.cwd(), "apps/web/src/server/providers/v213-full-live-cli.ts")),
    ),
    expectedTransportSha256: hash(
      readFileSync(
        resolve(process.cwd(), "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts"),
      ),
    ),
  };
  assert.deepEqual(
    Object.keys(createConcreteFullLiveAdapters({ bridge: currentBridgePins })).sort(),
    [
      "approval-commit-push",
      "bootstrap-prequalification-database",
      "certify-v2-13-release",
      "create-exact-max-one-endpoints",
      "fresh-live-preflight",
      "guarded-activation-once",
      "mage-image-workflow-dispatch",
      "mage-image-workflow-verification",
      "mage-live-qualification",
      "promote-qualified-production",
      "prove-zero-workers",
      "read-settled-billing",
      "reconcile-exact-resources",
      "record-workflow-start-authority",
      "release-tag-create",
      "release-tag-push",
      "release-tag-readback",
      "restore-endpoints-max-one",
      "soulx-image-workflow-dispatch",
      "soulx-image-workflow-verification",
      "soulx-live-qualification",
      "v2-09-short-hosted-project",
      "v2-10-operator-free-ranga-pilot",
      "v2-11-two-concurrent-owned-projects",
      "v2-12-long-output",
      "v2-13-final-two-lane-smoke",
    ],
  );
});

test("workflow-start materializes only the four post-consumption role identities", async () => {
  const fixture = workflowMaterializationFixture();
  const databaseState = workflowAuthorityDatabase({ fixture });
  const adapter = createWorkflowStartAuthorityAdapter({
    database: databaseState.database,
    materialize: async () => fixture.materialization,
  });
  const resultValue = await adapter(
    {},
    fixture.materializationState,
    new Map(),
    fixture.outerStateSha256,
  );
  assert.equal(databaseState.calls.length, 2);
  assert.equal(databaseState.startReads, 1);
  assert.equal(databaseState.startInserts, 1);
  assert.deepEqual(resultValue, {
    actualUsd: 0,
    authorityId: fixture.workflowAuthorityId,
    tokenSha256: fixture.materialization.workflowStartAuthority.tokenSha256,
    expiresAt: fixture.materializationState.expires_at,
  });
  assert.equal(
    databaseState.calls.some(({ sql }) => sql.includes("record_v213_acceptance_authority")),
    false,
  );
});

test("workflow-start rejects role identities that reuse the primary account and project", async () => {
  const fixture = workflowMaterializationFixture();
  const invalid = structuredClone(fixture.materialization);
  const primary = invalid.roleScopedIdentities.primary;
  invalid.roleScopedIdentities.secondary = {
    ...invalid.roleScopedIdentities.secondary,
    accountId: primary.accountId,
    workspaceId: primary.workspaceId,
    projectId: primary.projectId,
  };
  const unsigned = { ...invalid };
  delete unsigned.materializationSha256;
  invalid.materializationSha256 = hash(Buffer.from(canonicalJson(unsigned)));
  const databaseState = workflowAuthorityDatabase({ fixture });
  const adapter = createWorkflowStartAuthorityAdapter({
    database: databaseState.database,
    materialize: async () => invalid,
  });
  await assert.rejects(
    adapter({}, fixture.materializationState, new Map(), fixture.outerStateSha256),
    /WORKFLOW_AUTHORITY_IDENTITIES/u,
  );
  assert.equal(databaseState.calls.length, 0);
});

test("workflow-start rejects a same-account waiter without a distinct request identity", async () => {
  const fixture = workflowMaterializationFixture();
  const invalid = structuredClone(fixture.materialization);
  invalid.roleScopedIdentities.sameAccountWaiter.generationRequestId =
    invalid.roleScopedIdentities.primary.generationRequestId;
  const unsigned = { ...invalid };
  delete unsigned.materializationSha256;
  invalid.materializationSha256 = hash(Buffer.from(canonicalJson(unsigned)));
  const databaseState = workflowAuthorityDatabase({ fixture });
  const adapter = createWorkflowStartAuthorityAdapter({
    database: databaseState.database,
    materialize: async () => invalid,
  });
  await assert.rejects(
    adapter({}, fixture.materializationState, new Map(), fixture.outerStateSha256),
    /WORKFLOW_AUTHORITY_IDENTITIES/u,
  );
  assert.equal(databaseState.calls.length, 0);
});

test("workflow-start authority reconciles an ambiguous insert without redispatch", async () => {
  const fixture = workflowMaterializationFixture();
  const databaseState = workflowAuthorityDatabase({ fixture, throwInsert: true });
  const adapter = createWorkflowStartAuthorityAdapter({
    database: databaseState.database,
    materialize: async () => fixture.materialization,
  });
  await assert.doesNotReject(
    adapter({}, fixture.materializationState, new Map(), fixture.outerStateSha256),
  );
  assert.equal(databaseState.startReads, 2);
  assert.equal(databaseState.startInserts, 1);
});

test("workflow-start authority stops on an existing replay drift", async () => {
  const fixture = workflowMaterializationFixture();
  const databaseState = workflowAuthorityDatabase({
    fixture,
    replayRow: {
      workflowAuthorityId: fixture.workflowAuthorityId,
      authorityId: "33333333-3333-4333-8333-333333333333",
      tokenSha256: fixture.materialization.workflowStartAuthority.tokenSha256,
      expiresAt: fixture.materializationState.expires_at,
    },
  });
  const adapter = createWorkflowStartAuthorityAdapter({
    database: databaseState.database,
    materialize: async () => fixture.materialization,
  });
  await assert.rejects(
    adapter({}, fixture.materializationState, new Map(), fixture.outerStateSha256),
    /DATABASE_WORKFLOW_AUTHORITY_REPLAY_DRIFT/u,
  );
  assert.equal(databaseState.startInserts, 0);
});

test("workflow-start authority requires a post-consumption materializer", async () => {
  const fixture = workflowMaterializationFixture();
  const databaseState = workflowAuthorityDatabase({ fixture });
  const adapter = createWorkflowStartAuthorityAdapter({ database: databaseState.database });
  await assert.rejects(
    adapter({}, fixture.materializationState, new Map(), fixture.outerStateSha256),
    /WORKFLOW_AUTHORITY_MATERIALIZER_REQUIRED/u,
  );
  assert.equal(databaseState.calls.length, 0);
});

test("post-consumption producer signs an app selection, reads DB facts, then writes exact materialization", async () => {
  const fixture = workflowMaterializationFixture();
  const factsBundle = producerFactsFixture(fixture);
  const directory = mkdtempSync(resolve(tmpdir(), "v213-post-consumption-producer-test-"));
  chmodSync(directory, 0o700);
  const environment = producerEnvironment(fixture, directory);
  const challengeIds = [];
  const selections = [];
  const producer = createPostConsumptionMaterializationProducer({
    environment,
    cumulativeLedgerSha256: factsBundle.cumulativeLedgerSha256,
    issueChallenge: async (challenge) => {
      const challengeId = "33333333-3333-4333-8333-333333333333";
      challengeIds.push(challenge);
      return {
        authoritySha256: challenge.authoritySha256,
        challengeId,
        challengeSha256: challenge.requestSha256,
      };
    },
    handshake: async (challenge) => {
      const response = {
        schemaVersion: "videoforge.v213-post-consumption-materialization-response/v1",
        challengeId: challenge.challengeId,
        challengeSha256: challenge.requestSha256,
        selection: factsBundle.selection,
        selectionSha256: hash(Buffer.from(canonicalJson(factsBundle.selection))),
      };
      return {
        ...response,
        responseHmacSha256: postConsumptionResponseHmac(
          response,
          Buffer.from("worker-operator-bearer"),
        ),
      };
    },
    loadFacts: async ({ selection }) => {
      selections.push(selection);
      return { facts: factsBundle.facts, factsSha256: factsBundle.factsSha256 };
    },
    readback: async ({ challenge, materialization, facts }) => ({
      readbackVerified: true,
      challengeId: challenge.challengeId,
      materializationSha256: materialization.materializationSha256,
      factsSha256: hash(Buffer.from(canonicalJson(facts))),
    }),
  });
  const databaseState = workflowAuthorityDatabase({ fixture, dynamicAuthority: true });
  const priorResults = new Map();
  try {
    const adapter = createWorkflowStartAuthorityAdapter({
      database: databaseState.database,
      producer,
    });
    const resultValue = await adapter(
      { id: "record-workflow-start-authority" },
      fixture.materializationState,
      priorResults,
      fixture.outerStateSha256,
    );
    assert.equal(resultValue.actualUsd, 0);
    assert.equal(challengeIds.length, 1);
    assert.deepEqual(selections, [factsBundle.selection]);
    assert.equal(databaseState.calls.length, 3);
    assert.match(databaseState.calls[0].sql, /record_v213_static_release_descriptor/u);
    const materializationPath = environment.VIDEOFORGE_V2_13_POST_CONSUMPTION_MATERIALIZATION_FILE;
    assert.equal(lstatSync(materializationPath).mode & 0o777, 0o600);
    assert.deepEqual(
      JSON.parse(readFileSync(materializationPath, "utf8")).roleScopedIdentities,
      factsBundle.facts.roleScopedIdentities,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(environment.VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE, "utf8"))
        .commandPayloads,
      {},
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("post-consumption producer rejects a mutated signed selection before any authority insert", async () => {
  const fixture = workflowMaterializationFixture();
  const factsBundle = producerFactsFixture(fixture);
  const directory = mkdtempSync(resolve(tmpdir(), "v213-post-consumption-mutation-test-"));
  chmodSync(directory, 0o700);
  const environment = producerEnvironment(fixture, directory);
  const databaseState = workflowAuthorityDatabase({ fixture, dynamicAuthority: true });
  const producer = createPostConsumptionMaterializationProducer({
    environment,
    cumulativeLedgerSha256: factsBundle.cumulativeLedgerSha256,
    issueChallenge: async (challenge) => ({
      authoritySha256: challenge.authoritySha256,
      challengeId: "33333333-3333-4333-8333-333333333333",
      challengeSha256: challenge.requestSha256,
    }),
    handshake: async (challenge) => {
      const selection = structuredClone(factsBundle.selection);
      selection.primary.projectId = "40000000-0000-4000-8000-000000000001";
      selection.sameAccountWaiter.projectId = selection.primary.projectId;
      const response = {
        schemaVersion: "videoforge.v213-post-consumption-materialization-response/v1",
        challengeId: challenge.challengeId,
        challengeSha256: challenge.requestSha256,
        selection,
        selectionSha256: hash(Buffer.from(canonicalJson(factsBundle.selection))),
      };
      return {
        ...response,
        responseHmacSha256: postConsumptionResponseHmac(
          response,
          Buffer.from("worker-operator-bearer"),
        ),
      };
    },
    loadFacts: async () => ({ facts: factsBundle.facts, factsSha256: factsBundle.factsSha256 }),
    readback: async () => ({ readbackVerified: true }),
  });
  try {
    const adapter = createWorkflowStartAuthorityAdapter({
      database: databaseState.database,
      producer,
    });
    await assert.rejects(
      adapter(
        { id: "record-workflow-start-authority" },
        fixture.materializationState,
        new Map(),
        fixture.outerStateSha256,
      ),
      /POST_CONSUMPTION_RESPONSE_HASH/u,
    );
    assert.equal(databaseState.startInserts, 0);
    assert.equal(
      databaseState.calls.some(({ sql }) => sql.includes("record_v213_workflow_start_authority")),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("default protected workflow adapter never consumes a prewritten materialization without the producer handshake", async () => {
  const fixture = workflowMaterializationFixture();
  const directory = mkdtempSync(resolve(tmpdir(), "v213-post-consumption-default-test-"));
  chmodSync(directory, 0o700);
  const environment = producerEnvironment(fixture, directory);
  writeFileSync(
    environment.VIDEOFORGE_V2_13_POST_CONSUMPTION_MATERIALIZATION_FILE,
    `${canonicalJson(fixture.materialization)}\n`,
    { mode: 0o600 },
  );
  const databaseState = workflowAuthorityDatabase({ fixture });
  try {
    const adapter = createProtectedWorkflowStartAuthorityAdapter({
      environment,
      databaseFactory: async () => ({ database: databaseState.database }),
    });
    await assert.rejects(
      adapter(
        { id: "record-workflow-start-authority" },
        fixture.materializationState,
        new Map(),
        fixture.outerStateSha256,
      ),
      /POST_CONSUMPTION_CHALLENGE_REJECTED/u,
    );
    assert.equal(databaseState.startInserts, 0);
    assert.equal(
      databaseState.calls.some(({ sql }) => sql.includes("record_v213_workflow_start_authority")),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("identity-only workflow materialization never injects future command payloads", async () => {
  const fixture = workflowMaterializationFixture();
  const directory = mkdtempSync(resolve(tmpdir(), "v213-workflow-materialization-test-"));
  chmodSync(directory, 0o700);
  const materializationPath = resolve(directory, "post-consumption.json");
  const bearerPath = resolve(directory, "worker-bearer");
  const productionInputPath = resolve(directory, "production-input.json");
  const chainPath = resolve(directory, "materialization-chain.json");
  writeFileSync(materializationPath, `${canonicalJson(fixture.materialization)}\n`, {
    mode: 0o600,
  });
  writeFileSync(bearerPath, "worker-operator-bearer", { mode: 0o600 });
  writeFileSync(
    productionInputPath,
    `${canonicalJson({
      schemaVersion: "videoforge.v213-full-live-outer-input/v1",
      fullLiveAuthorityId: fixture.materialization.fullLiveAuthorityId,
      authorityDocument: {},
      dualLaneInput: {},
      commandPayloads: {},
    })}\n`,
    { mode: 0o600 },
  );
  writeFileSync(
    chainPath,
    `${canonicalJson(
      materializationChainFixture(
        fixture.materializationState.authority_id,
        fixture.outerStateSha256,
      ),
    )}\n`,
    { mode: 0o600 },
  );
  const databaseState = workflowAuthorityDatabase({ fixture });
  try {
    const adapter = createWorkflowStartAuthorityAdapter({
      database: databaseState.database,
      materialize: async () => JSON.parse(readFileSync(materializationPath, "utf8")),
    });
    await assert.doesNotReject(
      adapter({}, fixture.materializationState, new Map(), fixture.outerStateSha256),
    );
    assert.deepEqual(JSON.parse(readFileSync(productionInputPath, "utf8")).commandPayloads, {});
    assert.equal(
      JSON.parse(readFileSync(chainPath, "utf8")).entries.at(-1).kind,
      "promotion-record",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("prequalification bootstrap executes the exact manifest tail through a locked fake-psql seam", async () => {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), "v213-prequalification-test-")));
  chmodSync(directory, 0o700);
  const secretInputDirectory = resolve(directory, "secret-input");
  mkdirSync(secretInputDirectory, { mode: 0o700 });
  const servicePath = resolve(directory, "owner.pg_service.conf");
  const passPath = resolve(directory, "owner.pgpass");
  const operatorPath = resolve(directory, "operator.database-url");
  const runtimePath = resolve(directory, "runtime.database-url");
  const reconcilerPath = resolve(directory, "reconciler.database-url");
  const productionSecretsPath = resolve(directory, "production-secrets.json");
  const productionSecretBootstrapPath = resolve(directory, "production-secret-bootstrap.json");
  const workerOriginPath = resolve(directory, "worker-origin");
  const workerBearerPath = resolve(directory, "worker-operator-bearer");
  const trackedInputDirectory = resolve(directory, "tracked-proposal-input");
  const trackedProposalPath = resolve(trackedInputDirectory, "combined-live-proposal.json");
  const materializationSeedPath = resolve(directory, "materialization-seed.json");
  const credentialReceiptPath = resolve(directory, "credential-bootstrap.json");
  const credentialSourceDirectory = resolve(directory, "credential-sources");
  mkdirSync(trackedInputDirectory, { mode: 0o755 });
  writeFileSync(trackedProposalPath, "{}\n", { mode: 0o644 });
  mkdirSync(credentialSourceDirectory, { mode: 0o700 });
  const syntheticSourceValues = Object.freeze({
    GOOGLE_CLIENT_ID: "fixture-google-client-id",
    GOOGLE_CLIENT_SECRET: "fixture-google-client-secret",
    R2_ACCESS_KEY_ID: "fixture-r2-access-key-id",
    R2_SECRET_ACCESS_KEY: "fixture-r2-secret-access-key",
    RUNPOD_API_KEY: "fixture-runpod-api-key-0123456789",
  });
  const syntheticSourcePaths = Object.fromEntries(
    Object.keys(syntheticSourceValues).map((name) => [
      name,
      resolve(credentialSourceDirectory, name),
    ]),
  );
  Object.entries(syntheticSourceValues).forEach(([name, value]) =>
    writeFileSync(syntheticSourcePaths[name], value, { mode: 0o600 }),
  );
  const syntheticSecretHashes = Object.fromEntries(
    Object.entries(syntheticSourceValues)
      .filter(([name]) => name !== "RUNPOD_API_KEY")
      .map(([name, value]) => [name, hash(Buffer.from(value))]),
  );
  const syntheticCredentialReceipt = {
    schema_version: "videoforge.v2-13-credential-bootstrap-result/v1",
    source_commit: sourceCommit,
    google_authenticated_account_sha256: hash(Buffer.from("fixture-account")),
    google_project_id: "fixture-project",
    google_project_id_sha256: hash(Buffer.from("fixture-project")),
    google_project_number_sha256: hash(Buffer.from("fixture-project-number")),
    google_oauth_client_id_sha256: syntheticSecretHashes.GOOGLE_CLIENT_ID,
    google_oauth_client_secret_sha256: syntheticSecretHashes.GOOGLE_CLIENT_SECRET,
    google_redirect_uris_canonical_sha256: hash(Buffer.from("[]")),
    google_javascript_origins_canonical_sha256: hash(Buffer.from("[]")),
    cloudflare_account_id_sha256: hash(Buffer.from("fixture-cloudflare-account")),
    r2_bucket_name_sha256: hash(Buffer.from("fixture-bucket")),
    r2_permission_group: "fixture-permission-group",
    r2_credential_type: "R2_S3_LONG_LIVED_ACCESS_KEY",
    r2_credential_lifetime: "LONG_LIVED",
    r2_credential_expiration_policy: "NO_EXPIRATION",
    r2_credential_expiration_at: null,
    r2_access_key_id_sha256: syntheticSecretHashes.R2_ACCESS_KEY_ID,
    r2_secret_access_key_sha256: syntheticSecretHashes.R2_SECRET_ACCESS_KEY,
    application_key_grammar: "fixture-key-grammar",
    runpod_calls: 0,
    gpu_hours: 0,
    external_spend_usd: 0,
  };
  const syntheticCredentialReceiptBytes = Buffer.from(
    `${canonicalJson(syntheticCredentialReceipt)}\n`,
  );
  writeFileSync(credentialReceiptPath, syntheticCredentialReceiptBytes, { mode: 0o600 });
  writeFileSync(
    servicePath,
    "[videoforge_v2_13_owner]\nhost=ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech\ndbname=neondb\nuser=neondb_owner\nsslmode=require\nchannel_binding=require\n",
    { mode: 0o600 },
  );
  writeFileSync(
    passPath,
    "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech:5432:neondb:neondb_owner:owner-password\n",
    {
      mode: 0o600,
    },
  );
  const manifest = JSON.parse(
    readFileSync("packages/control-plane/migrations/manifest.json", "utf8"),
  );
  const rows = (count) =>
    manifest.migrations
      .slice(0, count)
      .map(({ version, name, filename, sha256 }) => `${version}\t${name}\t${filename}\t${sha256}`)
      .join("\n");
  const role = {
    flags: {
      rolcanlogin: true,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolinherit: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconfig: null,
    },
    memberships: 0,
    ownership: 0,
    extension_ownership: 0,
    database_acl: 0,
    effective_database_dangerous_acl: 0,
    schema_acl: ["public:USAGE"],
    effective_schema_dangerous_acl: 0,
    table_acl: 0,
    effective_table_acl: 0,
    sequence_acl: 0,
    effective_sequence_acl: 0,
    default_acl: 0,
    function_acl: [...PREQUALIFICATION_OPERATOR_FUNCTIONS].sort(),
    public_function_acl: [],
    public_default_function_acl: 0,
  };
  const migrationSqls = [];
  const calls = [];
  let lockedLedgerReads = 0;
  let operatorCreated = false;
  const run = (command, args, options = {}) => {
    calls.push([command, args]);
    assert.equal(command, "psql");
    const fileIndex = args.indexOf("--file");
    if (fileIndex >= 0) {
      const path = args[fileIndex + 1];
      if (path.endsWith("neon-full-live-operator-grants.sql")) {
        assert.equal(typeof options.environment?.V2_13_OPERATOR_PASSWORD, "string");
        assert.notEqual(options.environment.V2_13_OPERATOR_PASSWORD, "");
        operatorCreated = true;
        return result();
      }
      const sql = readFileSync(path, "utf8");
      migrationSqls.push(sql);
      return result();
    }
    const sql = args[args.indexOf("--command") + 1] ?? "";
    if (sql.includes("CREATE EXTENSION IF NOT EXISTS pgcrypto")) return result();
    if (sql.includes("json_build_object('operator'"))
      return result(
        0,
        `${JSON.stringify({ operator: operatorCreated ? 1 : 0, runtime: 0, reconciler: 0 })}\n`,
      );
    if (sql.includes("BEGIN;") && sql.includes("pg_advisory_xact_lock")) {
      lockedLedgerReads += 1;
      return result(0, `${rows(lockedLedgerReads === 1 ? 36 : 49)}\n`);
    }
    if (sql.includes("rolname IN")) return result(0, "0\n");
    if (sql.includes("count(*)::text FROM pg_roles"))
      return result(0, `${operatorCreated ? 1 : 0}\n`);
    if (sql.includes("FROM pg_extension WHERE extname='pgcrypto'"))
      return result(0, '{"name":"pgcrypto","version":"1.3","schema":"public"}\n');
    if (sql.includes("json_build_object('flags'")) return result(0, `${JSON.stringify(role)}\n`);
    if (sql.includes("SELECT current_user WHERE")) return result(0, "videoforge_hosted_operator\n");
    throw new Error(`unexpected fake psql SQL: ${sql.slice(0, 120)}`);
  };
  const outerStateSha256 = `sha256:${"f".repeat(64)}`;
  const authorityId = "v2-13-bootstrap-execution-authority-0001";
  const fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
  const productionKeyId = (purpose) =>
    `v213-${purpose}-${hash(Buffer.from(`${fullLiveAuthorityId}\0${purpose}`)).slice(7, 31)}`;
  const materializationSeed = materializationSeedFixture();
  materializationSeed.production_input_base.fullLiveAuthorityId = fullLiveAuthorityId;
  materializationSeed.production_input_base.dualLaneInput.envelopeSigningKeyId =
    productionKeyId("envelope");
  writeFileSync(materializationSeedPath, `${canonicalJson(materializationSeed)}\n`, {
    mode: 0o600,
  });
  const materializationSeedSha256 = hash(Buffer.from(`${canonicalJson(materializationSeed)}\n`));
  const consumedState = {
    ...state,
    schema_version: "videoforge.v2-13-full-live-orchestration-consumption/v2",
    authority_id: authorityId,
    full_live_authority_id: fullLiveAuthorityId,
    state: "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
    operator_role_verified: false,
  };
  const environment = {
    VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: directory,
    VIDEOFORGE_V2_13_SECRET_INPUT_DIR: secretInputDirectory,
    VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE: runtimePath,
    VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE: reconcilerPath,
    VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: materializationSeedPath,
    VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE: productionSecretsPath,
    VIDEOFORGE_V2_13_PRODUCTION_SECRET_BOOTSTRAP_FILE: productionSecretBootstrapPath,
    VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE: workerOriginPath,
    VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE: workerBearerPath,
    VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE: credentialReceiptPath,
    VIDEOFORGE_V2_13_GOOGLE_CLIENT_ID_FILE: syntheticSourcePaths.GOOGLE_CLIENT_ID,
    VIDEOFORGE_V2_13_GOOGLE_CLIENT_SECRET_FILE: syntheticSourcePaths.GOOGLE_CLIENT_SECRET,
    VIDEOFORGE_V2_13_R2_ACCESS_KEY_ID_FILE: syntheticSourcePaths.R2_ACCESS_KEY_ID,
    VIDEOFORGE_V2_13_R2_SECRET_ACCESS_KEY_FILE: syntheticSourcePaths.R2_SECRET_ACCESS_KEY,
    VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE: syntheticSourcePaths.RUNPOD_API_KEY,
    VIDEOFORGE_V2_13_PROPOSAL_FILE: trackedProposalPath,
  };
  consumedState.materialization_seed_sha256 = materializationSeedSha256;
  const credentialBootstrapBinding = {
    receiptSchema: "videoforge.v2-13-credential-bootstrap-result/v1",
    receiptSha256: hash(syntheticCredentialReceiptBytes),
    secretHashes: syntheticSecretHashes,
  };
  let credentialGenerationCount = 0;
  try {
    const adapter = createPrequalificationDatabaseBootstrapAdapter({
      environment,
      run,
      credentialBootstrapBinding,
      credentialRandomBytes: (size) => {
        assert.equal(migrationSqls.length, 13);
        credentialGenerationCount += 1;
        return Buffer.alloc(size, credentialGenerationCount);
      },
    });
    assert.throws(() => lstatSync(operatorPath), /ENOENT/u);
    await assert.rejects(
      adapter(
        { operationId: "bootstrap-prequalification-database" },
        { ...consumedState, schema_version: "wrong" },
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_CONSUMED_AUTHORITY_REQUIRED/u,
    );
    assert.throws(() => lstatSync(operatorPath), /ENOENT/u);
    const callsBeforeFullLiveAuthorityDrift = calls.length;
    const generationsBeforeFullLiveAuthorityDrift = credentialGenerationCount;
    await assert.rejects(
      adapter(
        { operationId: "bootstrap-prequalification-database" },
        {
          ...consumedState,
          full_live_authority_id: "22222222-2222-4222-8222-222222222222",
        },
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_MATERIALIZATION_SEED_BINDING/u,
    );
    assert.equal(calls.length, callsBeforeFullLiveAuthorityDrift);
    assert.equal(credentialGenerationCount, generationsBeforeFullLiveAuthorityDrift);
    assert.throws(() => lstatSync(operatorPath), /ENOENT/u);
    const exactOwnerServiceBytes = readFileSync(servicePath);
    writeFileSync(
      servicePath,
      Buffer.from(
        "[videoforge_v2_13_owner]\nhost=ep-other.c-3.ap-southeast-1.aws.neon.tech\ndbname=neondb\nuser=neondb_owner\nsslmode=require\nchannel_binding=require\n",
      ),
      { mode: 0o600 },
    );
    const callsBeforeDatabaseIdentityDrift = calls.length;
    const generationsBeforeDatabaseIdentityDrift = credentialGenerationCount;
    await assert.rejects(
      adapter(
        { operationId: "bootstrap-prequalification-database" },
        consumedState,
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_DATABASE_IDENTITY/u,
    );
    assert.equal(calls.length, callsBeforeDatabaseIdentityDrift);
    assert.equal(credentialGenerationCount, generationsBeforeDatabaseIdentityDrift);
    for (const path of [
      operatorPath,
      runtimePath,
      reconcilerPath,
      productionSecretsPath,
      productionSecretBootstrapPath,
      workerOriginPath,
      workerBearerPath,
      resolve(directory, "database-role-credentials.json"),
    ])
      assert.throws(() => lstatSync(path), /ENOENT/u);
    writeFileSync(servicePath, exactOwnerServiceBytes, { mode: 0o600 });
    const driftedSeed = structuredClone(materializationSeed);
    driftedSeed.activation_record_base.database.database = "otherdb";
    const driftedSeedBytes = Buffer.from(`${canonicalJson(driftedSeed)}\n`);
    writeFileSync(materializationSeedPath, driftedSeedBytes, { mode: 0o600 });
    const callsBeforeSeedDatabaseIdentityDrift = calls.length;
    const generationsBeforeSeedDatabaseIdentityDrift = credentialGenerationCount;
    await assert.rejects(
      adapter(
        { operationId: "bootstrap-prequalification-database" },
        { ...consumedState, materialization_seed_sha256: hash(driftedSeedBytes) },
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_MATERIALIZATION_SEED_(?:BINDING|DATABASE_IDENTITY)/u,
    );
    assert.equal(calls.length, callsBeforeSeedDatabaseIdentityDrift);
    assert.equal(credentialGenerationCount, generationsBeforeSeedDatabaseIdentityDrift);
    writeFileSync(materializationSeedPath, Buffer.from(`${canonicalJson(materializationSeed)}\n`), {
      mode: 0o600,
    });
    const callsBeforeCollision = calls.length;
    await assert.rejects(
      createPrequalificationDatabaseBootstrapAdapter({
        environment: {
          ...environment,
          VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: runtimePath,
        },
        run,
      })(
        { operationId: "bootstrap-prequalification-database" },
        consumedState,
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_DATABASE_CREDENTIAL_RESERVED_PATH_COLLISION/u,
    );
    assert.equal(calls.length, callsBeforeCollision);
    assert.throws(() => lstatSync(operatorPath), /ENOENT/u);
    const secretAlias = resolve(directory, "secret-alias");
    symlinkSync(secretInputDirectory, secretAlias, "dir");
    const callsBeforeSymlinkAlias = calls.length;
    await assert.rejects(
      createPrequalificationDatabaseBootstrapAdapter({
        environment: {
          ...environment,
          VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: resolve(secretAlias, "DATABASE_URL"),
        },
        run,
      })(
        { operationId: "bootstrap-prequalification-database" },
        consumedState,
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_DATABASE_CREDENTIAL_RESERVED_PATH_DIRECTORY/u,
    );
    assert.equal(calls.length, callsBeforeSymlinkAlias);
    rmSync(secretAlias);
    const bundlePath = resolve(directory, "database-role-credentials.json");
    const staleAuthorityBundleStage = databaseCredentialStagingPath(
      bundlePath,
      "v2-13-prior-authority",
    );
    writeFileSync(staleAuthorityBundleStage, "stale", { mode: 0o600, flag: "wx" });
    const callsBeforeStaleStage = calls.length;
    await assert.rejects(
      adapter(
        { operationId: "bootstrap-prequalification-database" },
        consumedState,
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_DATABASE_CREDENTIAL_STAGING_AUTHORITY_DRIFT/u,
    );
    assert.equal(calls.length, callsBeforeStaleStage);
    rmSync(staleAuthorityBundleStage);
    const currentAuthorityBundleStage = databaseCredentialStagingPath(
      bundlePath,
      consumedState.authority_id,
    );
    writeFileSync(currentAuthorityBundleStage, '{"truncated":', { mode: 0o600, flag: "wx" });
    const callsBeforeCurrentStage = calls.length;
    await assert.rejects(
      adapter(
        { operationId: "bootstrap-prequalification-database" },
        consumedState,
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_INITIAL_STATE_NOT_FRESH/u,
    );
    assert.equal(calls.length, callsBeforeCurrentStage);
    rmSync(currentAuthorityBundleStage);
    const output = await adapter(
      { operationId: "bootstrap-prequalification-database" },
      consumedState,
      new Map(),
      outerStateSha256,
    );
    assert.equal(output.actualUsd, 0);
    assert.equal(
      output.schema_version,
      "videoforge.v213-prequalification-database-bootstrap-result/v4",
    );
    assert.equal(output.full_live_authority_id, consumedState.full_live_authority_id);
    assert.equal(output.outer_state_sha256, outerStateSha256);
    assert.equal(
      output.database_identity_sha256,
      "sha256:7f2c802c531f4e5630d6a15b2f26bf65ea04f599b28c19fc3daa5d741c7567d7",
    );
    assert.equal(output.recovery_mode, "FRESH_36_TO_49");
    assert.equal(output.ledger_before_count, 36);
    assert.equal(output.runpod_calls, 0);
    assert.equal(output.cloudflare_calls, 0);
    assert.equal(output.application_secret_reads, 5);
    assert.equal(output.gpu_use, false);
    assert.equal(output.external_spend_usd, 0);
    assert.equal(credentialGenerationCount, 13);
    assert.equal(
      new Set([
        output.operator_database_url_sha256,
        output.runtime_database_url_sha256,
        output.reconciler_database_url_sha256,
      ]).size,
      3,
    );
    assert.equal(lockedLedgerReads, 2);
    assert.equal(migrationSqls.length, 13);
    for (const [index, sql] of migrationSqls.entries()) {
      assert.match(sql, /BEGIN;/u);
      assert.match(sql, /pg_advisory_xact_lock\(1448494662,1\)/u);
      assert.match(sql, new RegExp(`version=${37 + index}`));
      assert.match(sql, /migration ledger prefix drift/u);
      assert.match(sql, /INSERT INTO public\.videoforge_schema_migrations/u);
    }
    const receiptPath = resolve(directory, "prequalification-database-bootstrap.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.recovery_mode, "FRESH_36_TO_49");
    assert.equal(receipt.ledger_before_count, 36);
    assert.equal(lstatSync(receiptPath).mode & 0o777, 0o600);
    for (const path of [
      operatorPath,
      runtimePath,
      reconcilerPath,
      resolve(secretInputDirectory, "DATABASE_URL"),
      resolve(secretInputDirectory, "VIDEOFORGE_RECONCILER_DATABASE_URL"),
      resolve(directory, "database-role-credentials.json"),
    ])
      assert.equal(lstatSync(path).mode & 0o777, 0o600);
    assert.equal(
      readFileSync(runtimePath, "utf8"),
      readFileSync(resolve(secretInputDirectory, "DATABASE_URL"), "utf8"),
    );
    assert.equal(
      readFileSync(reconcilerPath, "utf8"),
      readFileSync(resolve(secretInputDirectory, "VIDEOFORGE_RECONCILER_DATABASE_URL"), "utf8"),
    );
    assert.equal(
      output.credential_bootstrap_receipt_sha256,
      credentialBootstrapBinding.receiptSha256,
    );
    assert.match(output.production_secret_bootstrap_sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.match(output.production_secrets_sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(Object.keys(output.production_secret_file_sha256s).length, 18);
    assert.equal(Object.keys(output.internal_credential_key_ids).length, 4);
    assert.equal(
      output.internal_credential_key_ids.pairEnvelopeSigningKeyId,
      materializationSeed.production_input_base.dualLaneInput.envelopeSigningKeyId,
    );
    for (const name of [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
      "RUNPOD_API_KEY",
    ])
      assert.deepEqual(
        readFileSync(resolve(secretInputDirectory, name)),
        readFileSync(syntheticSourcePaths[name]),
        `${name} must be byte-equal to the receipt-bound source`,
      );
    assert.deepEqual(
      readFileSync(workerBearerPath),
      readFileSync(resolve(secretInputDirectory, "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN")),
    );
    const generationsBeforeForbiddenNormalReplay = credentialGenerationCount;
    await assert.rejects(
      adapter(
        { operationId: "bootstrap-prequalification-database" },
        consumedState,
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_INITIAL_STATE_NOT_FRESH/u,
    );
    assert.equal(credentialGenerationCount, generationsBeforeForbiddenNormalReplay);
    const generationCountBeforeRecovery = credentialGenerationCount;
    // Simulate a lost process after the atomic role+grants commit but before the local receipt.
    rmSync(receiptPath);
    const operatorStagePath = databaseCredentialStagingPath(
      operatorPath,
      consumedState.authority_id,
    );
    writeFileSync(operatorStagePath, readFileSync(operatorPath), { mode: 0o600, flag: "wx" });
    const callsBeforeRejectedStagedReconciliation = calls.length;
    await assert.rejects(
      adapter(
        {
          operationId: "bootstrap-prequalification-database",
          authorizedUnsettled: true,
          reconciliationOnly: true,
          providerDispatchForbidden: true,
        },
        consumedState,
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_RECONCILIATION_STAGING_PRESENT/u,
    );
    assert.equal(calls.length, callsBeforeRejectedStagedReconciliation);
    rmSync(operatorStagePath);
    const recovered = await adapter(
      {
        operationId: "bootstrap-prequalification-database",
        authorizedUnsettled: true,
        reconciliationOnly: true,
        providerDispatchForbidden: true,
      },
      consumedState,
      new Map(),
      outerStateSha256,
    );
    assert.equal(recovered.recovery_mode, "VERIFIED_EXISTING_49");
    assert.equal(recovered.ledger_before_count, 49);
    assert.equal(recovered.operator_database_url_sha256, output.operator_database_url_sha256);
    assert.equal(
      recovered.database_role_credential_bundle_sha256,
      output.database_role_credential_bundle_sha256,
    );
    assert.equal(credentialGenerationCount, generationCountBeforeRecovery);
    assert.equal(migrationSqls.length, 13);
    assert.equal(lstatSync(receiptPath).mode & 0o777, 0o600);
    const exactRecoveredReceiptBytes = readFileSync(receiptPath);
    const driftedDatabaseIdentityReceipt = JSON.parse(exactRecoveredReceiptBytes);
    driftedDatabaseIdentityReceipt.database_identity_sha256 = `sha256:${"0".repeat(64)}`;
    delete driftedDatabaseIdentityReceipt.prequalification_database_bootstrap_sha256;
    driftedDatabaseIdentityReceipt.prequalification_database_bootstrap_sha256 = hash(
      Buffer.from(`${canonicalJson(driftedDatabaseIdentityReceipt)}\n`),
    );
    writeFileSync(receiptPath, Buffer.from(`${canonicalJson(driftedDatabaseIdentityReceipt)}\n`), {
      mode: 0o600,
    });
    const callsBeforeReceiptIdentityDrift = calls.length;
    const generationsBeforeReceiptIdentityDrift = credentialGenerationCount;
    await assert.rejects(
      adapter(
        {
          operationId: "bootstrap-prequalification-database",
          authorizedUnsettled: true,
          reconciliationOnly: true,
          providerDispatchForbidden: true,
        },
        consumedState,
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_RECEIPT_CONTRACT/u,
    );
    assert.equal(calls.length, callsBeforeReceiptIdentityDrift);
    assert.equal(credentialGenerationCount, generationsBeforeReceiptIdentityDrift);
    writeFileSync(receiptPath, exactRecoveredReceiptBytes, { mode: 0o600 });

    const bundleBytes = readFileSync(bundlePath);
    rmSync(bundlePath);
    await assert.rejects(
      adapter(
        {
          operationId: "bootstrap-prequalification-database",
          authorizedUnsettled: true,
          reconciliationOnly: true,
          providerDispatchForbidden: true,
        },
        consumedState,
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_OPERATOR_CREDENTIAL_BINDING_MISSING/u,
    );
    assert.equal(credentialGenerationCount, generationCountBeforeRecovery);
    writeFileSync(bundlePath, bundleBytes, { mode: 0o600, flag: "wx" });
    const callsBeforeRejectedCas = calls.length;
    await assert.rejects(
      verifyPrequalificationDatabaseReceipt({
        environment,
        state: consumedState,
        priorResults: new Map([
          [
            "bootstrap-prequalification-database",
            { prequalification_database_bootstrap_sha256: `sha256:${"0".repeat(64)}` },
          ],
        ]),
        run,
        credentialBootstrapBinding,
      }),
      /PREQUALIFICATION_RECEIPT_OUTER_CAS/u,
    );
    assert.equal(calls.length, callsBeforeRejectedCas);
    const bridge = createTypeScriptBridgeAdapters({
      environment,
      requirePrequalificationReceipt: true,
      spawnBridge: async () => {
        throw new Error("bridge must not start before receipt CAS");
      },
    });
    await assert.rejects(
      bridge["fresh-live-preflight"](
        {},
        state,
        new Map([
          [
            "bootstrap-prequalification-database",
            { prequalification_database_bootstrap_sha256: `sha256:${"0".repeat(64)}` },
          ],
        ]),
        `sha256:${"f".repeat(64)}`,
      ),
      /PREQUALIFICATION_RECEIPT_CONTRACT/u,
    );
    const originalReceiptBytes = readFileSync(receiptPath);
    const mismatchedReceipt = {
      ...receipt,
      ledger_before_sha256: `sha256:${"0".repeat(64)}`,
    };
    const mismatchedBody = structuredClone(mismatchedReceipt);
    delete mismatchedBody.prequalification_database_bootstrap_sha256;
    mismatchedReceipt.prequalification_database_bootstrap_sha256 = hash(
      Buffer.from(`${canonicalJson(mismatchedBody)}\n`),
    );
    writeFileSync(receiptPath, `${canonicalJson(mismatchedReceipt)}\n`, { mode: 0o600 });
    await assert.rejects(
      verifyPrequalificationDatabaseReceipt({
        environment,
        state: consumedState,
        priorResults: new Map([
          ["bootstrap-prequalification-database", { ...output, ...mismatchedReceipt }],
        ]),
        run,
        credentialBootstrapBinding,
      }),
      /PREQUALIFICATION_VERIFY_LEDGER_BEFORE/u,
    );
    writeFileSync(receiptPath, originalReceiptBytes, { mode: 0o600 });
    const lockedLedgerReadsBeforeVerifiedReceipt = lockedLedgerReads;
    const verified = await verifyPrequalificationDatabaseReceipt({
      environment,
      state: consumedState,
      priorResults: new Map([["bootstrap-prequalification-database", recovered]]),
      run,
      credentialBootstrapBinding,
    });
    assert.equal(verified.ledger.length, 49);
    assert.equal(lockedLedgerReads, lockedLedgerReadsBeforeVerifiedReceipt + 1);
    assert.equal(
      calls.every(([command]) => command === "psql"),
      true,
    );
    const unexpectedOperatorHardLink = resolve(directory, "unexpected-operator-hard-link");
    linkSync(operatorPath, unexpectedOperatorHardLink);
    await assert.rejects(
      verifyPrequalificationDatabaseReceipt({
        environment,
        state: consumedState,
        priorResults: new Map([["bootstrap-prequalification-database", recovered]]),
        run,
        credentialBootstrapBinding,
      }),
      /PREQUALIFICATION_DATABASE_CREDENTIAL_FILE/u,
    );
    rmSync(unexpectedOperatorHardLink);

    const cleanupWorkId =
      `${consumedState.authority_id}:bootstrap-prequalification-database`.toLowerCase();
    const cleanupState = {
      ...consumedState,
      state: "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
      phases: {
        bootstrap_prequalification_database: {
          work: {
            [cleanupWorkId]: { state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE" },
          },
        },
      },
    };
    const credentialArtifacts = [
      operatorPath,
      runtimePath,
      reconcilerPath,
      resolve(secretInputDirectory, "DATABASE_URL"),
      resolve(secretInputDirectory, "VIDEOFORGE_RECONCILER_DATABASE_URL"),
      bundlePath,
    ];
    const bundleStagePath = databaseCredentialStagingPath(bundlePath, consumedState.authority_id);
    linkSync(bundlePath, bundleStagePath);
    credentialArtifacts.push(bundleStagePath);
    const artifactBytesBeforeRejectedCleanup = credentialArtifacts.map((path) =>
      readFileSync(path),
    );
    await assert.rejects(
      cleanupPartialDatabaseRoleCredentials({
        environment,
        run,
        state: cleanupState,
        credentialBootstrapBinding,
      }),
      /PREQUALIFICATION_PARTIAL_CLEANUP_ROLE_PRESENT/u,
    );
    credentialArtifacts.forEach((path, index) =>
      assert.deepEqual(readFileSync(path), artifactBytesBeforeRejectedCleanup[index]),
    );

    // Model the opposite atomic-transaction outcome: the process wrote its local authority-bound
    // credential files only partially, but the role+grants transaction did not commit. Cleanup may
    // remove only those exact files after the owner readback proves every target role absent.
    rmSync(resolve(secretInputDirectory, "DATABASE_URL"));
    operatorCreated = false;
    rmSync(receiptPath);
    const cleaned = await cleanupPartialDatabaseRoleCredentials({
      environment,
      run,
      state: cleanupState,
      credentialBootstrapBinding,
    });
    assert.equal(cleaned.cleanupState, "REMOVED_AUTHORITY_BOUND_FILES");
    assert.equal(cleaned.fullLiveAuthorityId, cleanupState.full_live_authority_id);
    assert.equal(cleaned.operatorRoleAbsent, true);
    assert.equal(cleaned.runtimeAndReconcilerRolesAbsent, true);
    // Five remaining database artifacts plus twenty-one authority-bound production-secret
    // artifacts are removed only after the owner role-absence proof.
    assert.equal(cleaned.removedArtifactCount, 26);
    assert.equal(cleaned.credentialBundleSha256, hash(bundleBytes));
    const { cleanupSha256, ...cleanupBody } = cleaned;
    assert.equal(cleanupSha256, hash(Buffer.from(canonicalJson(cleanupBody))));
    for (const path of credentialArtifacts) assert.throws(() => lstatSync(path), /ENOENT/u);
    const replayedCleanup = await cleanupPartialDatabaseRoleCredentials({
      environment,
      run,
      state: cleanupState,
      credentialBootstrapBinding,
    });
    assert.equal(replayedCleanup.cleanupState, "ALREADY_ABSENT");
    assert.equal(replayedCleanup.credentialBundleSha256, null);
    assert.equal(replayedCleanup.removedArtifactCount, 0);

    // A deterministic path is not proof of ownership. Truncated bundle stages now fail closed
    // before deletion; only exact authority-bound canonical bytes may be removed.
    writeFileSync(bundleStagePath, '{"truncated":', { mode: 0o600, flag: "wx" });
    await assert.rejects(
      cleanupPartialDatabaseRoleCredentials({
        environment,
        run,
        state: cleanupState,
        credentialBootstrapBinding,
      }),
      /PREQUALIFICATION_PARTIAL_CLEANUP_CREDENTIAL_BUNDLE/u,
    );
    assert.equal(readFileSync(bundleStagePath, "utf8"), '{"truncated":');
    rmSync(bundleStagePath);

    // A hard crash after link(2) but before stage unlink leaves both exact bundle copies.
    writeFileSync(bundleStagePath, bundleBytes, { mode: 0o600, flag: "wx" });
    linkSync(bundleStagePath, bundlePath);
    const linkedBundleCleanup = await cleanupPartialDatabaseRoleCredentials({
      environment,
      run,
      state: cleanupState,
      credentialBootstrapBinding,
    });
    assert.equal(linkedBundleCleanup.cleanupState, "REMOVED_AUTHORITY_BOUND_FILES");
    assert.equal(linkedBundleCleanup.credentialBundleSha256, hash(bundleBytes));
    assert.equal(linkedBundleCleanup.removedArtifactCount, 2);

    const credentialBundle = JSON.parse(bundleBytes);
    const databaseUrlTargets = [
      ["operator", operatorPath],
      ["runtime", runtimePath],
      ["runtime", resolve(secretInputDirectory, "DATABASE_URL")],
      ["reconciler", reconcilerPath],
      ["reconciler", resolve(secretInputDirectory, "VIDEOFORGE_RECONCILER_DATABASE_URL")],
    ];
    for (const [kind, target] of databaseUrlTargets) {
      const stage = databaseCredentialStagingPath(target, consumedState.authority_id);
      const expected = Buffer.from(credentialBundle.credentials[kind].database_url);

      // Before link, an incomplete per-copy stage is unauthenticated and must remain untouched.
      writeFileSync(bundlePath, bundleBytes, { mode: 0o600, flag: "wx" });
      writeFileSync(stage, "partial", { mode: 0o600, flag: "wx" });
      await assert.rejects(
        cleanupPartialDatabaseRoleCredentials({
          environment,
          run,
          state: cleanupState,
          credentialBootstrapBinding,
        }),
        /PREQUALIFICATION_PARTIAL_CLEANUP_CREDENTIAL_FILE_DRIFT/u,
      );
      assert.equal(readFileSync(stage, "utf8"), "partial");
      assert.deepEqual(readFileSync(bundlePath), bundleBytes);
      rmSync(stage);
      rmSync(bundlePath);

      // After link but before unlink: both exact copies are discoverable and removed, with the
      // database URL copies preceding the canonical bundle deletion.
      writeFileSync(bundlePath, bundleBytes, { mode: 0o600, flag: "wx" });
      writeFileSync(stage, expected, { mode: 0o600, flag: "wx" });
      linkSync(stage, target);
      const afterLink = await cleanupPartialDatabaseRoleCredentials({
        environment,
        run,
        state: cleanupState,
        credentialBootstrapBinding,
      });
      assert.equal(afterLink.cleanupState, "REMOVED_AUTHORITY_BOUND_FILES");
      assert.equal(afterLink.removedArtifactCount, 3);
      assert.equal(afterLink.credentialBundleSha256, hash(bundleBytes));
      assert.throws(() => lstatSync(target), /ENOENT/u);
      assert.throws(() => lstatSync(stage), /ENOENT/u);
    }

    writeFileSync(bundlePath, bundleBytes, { mode: 0o600, flag: "wx" });
    const unexpectedBundleHardLink = resolve(directory, "unexpected-bundle-hard-link");
    linkSync(bundlePath, unexpectedBundleHardLink);
    await assert.rejects(
      cleanupPartialDatabaseRoleCredentials({
        environment,
        run,
        state: cleanupState,
        credentialBootstrapBinding,
      }),
      /PREQUALIFICATION_PARTIAL_CLEANUP_CREDENTIAL_BUNDLE/u,
    );
    assert.deepEqual(readFileSync(bundlePath), bundleBytes);
    rmSync(unexpectedBundleHardLink);
    rmSync(bundlePath);

    const foreignStage = databaseCredentialStagingPath(bundlePath, "v2-13-foreign-authority");
    writeFileSync(foreignStage, "foreign", { mode: 0o600, flag: "wx" });
    await assert.rejects(
      cleanupPartialDatabaseRoleCredentials({
        environment,
        run,
        state: cleanupState,
        credentialBootstrapBinding,
      }),
      /PREQUALIFICATION_PARTIAL_CLEANUP_STAGING_AUTHORITY_DRIFT/u,
    );
    assert.equal(readFileSync(foreignStage, "utf8"), "foreign");
    rmSync(foreignStage);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bootstrap-partial cleanup rejects orphan secret-only remnants without the database bundle", async () => {
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), "v213-secret-only-cleanup-test-")));
  chmodSync(directory, 0o700);
  const secretInputDirectory = resolve(directory, "secret-input");
  mkdirSync(secretInputDirectory, { mode: 0o700 });
  const servicePath = resolve(directory, "owner.pg_service.conf");
  const passPath = resolve(directory, "owner.pgpass");
  const productionSecretsPath = resolve(directory, "production-secrets.json");
  const productionSecretBootstrapPath = resolve(directory, "production-secret-bootstrap.json");
  const workerOriginPath = resolve(directory, "worker-origin");
  const workerBearerPath = resolve(directory, "worker-bearer");
  const runtimePath = resolve(directory, "runtime.database-url");
  const reconcilerPath = resolve(directory, "reconciler.database-url");
  const sourcePath = (name) => resolve(directory, `source-${name}`);
  writeFileSync(
    servicePath,
    "[videoforge_v2_13_owner]\nhost=ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech\ndbname=neondb\nuser=neondb_owner\nsslmode=require\nchannel_binding=require\n",
    { mode: 0o600 },
  );
  writeFileSync(
    passPath,
    "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech:5432:neondb:neondb_owner:owner-password\n",
    { mode: 0o600 },
  );
  const authorityId = "v2-13-secret-only-cleanup-authority";
  const fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
  const workId = `${authorityId}:bootstrap-prequalification-database`.toLowerCase();
  const state = {
    authority_id: authorityId,
    full_live_authority_id: fullLiveAuthorityId,
    state: "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
    operator_role_verified: false,
    phases: {
      bootstrap_prequalification_database: {
        work: { [workId]: { state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE" } },
      },
    },
  };
  const environment = {
    VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: directory,
    VIDEOFORGE_V2_13_SECRET_INPUT_DIR: secretInputDirectory,
    VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE: runtimePath,
    VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE: reconcilerPath,
    VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE: productionSecretsPath,
    VIDEOFORGE_V2_13_PRODUCTION_SECRET_BOOTSTRAP_FILE: productionSecretBootstrapPath,
    VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE: workerOriginPath,
    VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE: workerBearerPath,
    VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE: sourcePath("credential-receipt"),
    VIDEOFORGE_V2_13_GOOGLE_CLIENT_ID_FILE: sourcePath("google-client-id"),
    VIDEOFORGE_V2_13_GOOGLE_CLIENT_SECRET_FILE: sourcePath("google-client-secret"),
    VIDEOFORGE_V2_13_R2_ACCESS_KEY_ID_FILE: sourcePath("r2-access-key"),
    VIDEOFORGE_V2_13_R2_SECRET_ACCESS_KEY_FILE: sourcePath("r2-secret-key"),
    VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE: sourcePath("runpod-api-key"),
  };
  const outerStateSha256 = hash(Buffer.from("secret-only-cleanup-outer-state"));
  const secretBundle = {
    schemaVersion: "videoforge.v213-production-secret-bootstrap/v1",
    fullLiveAuthorityId,
    outerStateSha256,
  };
  writeFileSync(productionSecretBootstrapPath, `${canonicalJson(secretBundle)}\n`, { mode: 0o600 });
  const run = (command, args) => {
    assert.equal(command, "psql");
    assert.match(args[args.indexOf("--command") + 1] ?? "", /json_build_object\('operator'/u);
    return result(0, `${JSON.stringify({ operator: 0, runtime: 0, reconciler: 0 })}\n`);
  };
  try {
    await assert.rejects(
      cleanupPartialDatabaseRoleCredentials({ environment, run, state }),
      /PREQUALIFICATION_PARTIAL_CLEANUP_SECRET_DATABASE_BINDING/u,
    );
    assert.doesNotThrow(() => lstatSync(productionSecretBootstrapPath));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("global preflight excludes future artifacts and stage adapters validate them at first use", () => {
  const source = readFileSync("deploy/v2-13/full-live-adapters.mjs", "utf8");
  const global = source.slice(
    source.indexOf("function preflightConcreteFullLiveInputs"),
    source.indexOf("function preflightPromotionInputs"),
  );
  assert.doesNotMatch(global, /PROMOTION_RECORD_FILE|GUARDED_INPUTS/u);
  const guarded = source.slice(
    source.indexOf("function createGuardedActivationAdapter"),
    source.indexOf("function createStagedQualificationAdapters"),
  );
  assert.match(guarded, /preflight\(\{ environment, state \}\)/u);
  const promotion = source.slice(
    source.indexOf("function createProtectedPromotionAdapter"),
    source.indexOf("function createV213DurableStageStore"),
  );
  assert.match(promotion, /preflightPromotionInputs\(\{ environment, state, spawn \}\)/u);
  assert.doesNotMatch(promotion, /CLOUDFLARE_API_TOKEN_FILE|CLOUDFLARE_API_TOKEN:/u);
  assert.match(promotion, /wranglerOAuthConfigPath|refreshWranglerOAuthReadback/u);
  assert.match(promotion, /oauthEnvironment/u);
  assert.ok(promotion.indexOf("preflightPromotionInputs") < promotion.indexOf("const runWrangler"));
  assert.ok(
    promotion.indexOf("refreshWranglerOAuthReadback") <
      promotion.indexOf("const result = await runCommand("),
  );
});

test("source-bound direct bridge launch preserves request and RunPod FDs", () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-bridge-fd-regression-"));
  chmodSync(directory, 0o700);
  const authorityId = "11111111-1111-4111-8111-111111111111";
  const request = {
    schemaVersion: "videoforge.v213-full-live-command/v1",
    commandId: "bridge-fd-regression",
    stageAuthorityId: authorityId,
    command: "restore-endpoints-max-one",
    input: {
      schemaVersion: "videoforge.v213-full-live-early-cleanup-input/v1",
      fullLiveAuthorityId: authorityId,
    },
  };
  const requestPath = resolve(directory, "request.json");
  const runpodKeyPath = resolve(directory, "runpod-key");
  writeFileSync(requestPath, `${JSON.stringify(request)}\n`, { mode: 0o600 });
  // The key is deliberately too short.  The child must read both descriptors and stop at its
  // protected-input validation seam, before constructing a provider transport or making a call.
  writeFileSync(runpodKeyPath, "short-key", { mode: 0o600 });
  const opened = [openSync(requestPath, "r"), openSync(runpodKeyPath, "r")];
  try {
    const launch = resolveSourceBoundBridgeLaunch();
    const child = spawnSync(
      launch.nodeExecutable,
      [
        "--import",
        launch.loaderPath,
        launch.bridgePath,
        "--execute",
        "EXECUTE_EXACT_V2_13_TYPESCRIPT_BRIDGE_COMMAND",
      ],
      {
        cwd: resolve(process.cwd()),
        encoding: "utf8",
        env: {
          PATH: process.env.PATH,
          VIDEOFORGE_V213_BRIDGE_COMMAND: request.command,
          VIDEOFORGE_V213_BRIDGE_REQUEST_FD: "3",
          VIDEOFORGE_V213_BRIDGE_RUNPOD_API_KEY_FD: "4",
        },
        stdio: ["ignore", "pipe", "pipe", ...opened],
      },
    );
    assert.notEqual(child.status, 0);
    assert.equal(child.stdout, "");
    assert.match(child.stderr, /EARLY_CLEANUP_PROTECTED_INPUT_INVALID/u);
    assert.throws(
      () =>
        resolveSourceBoundBridgeLaunch({
          loaderPath: resolve(directory, "not-the-pinned-loader.mjs"),
        }),
      /BRIDGE_LAUNCH_PATH_INVALID/u,
    );
  } finally {
    opened.forEach((fd) => closeSync(fd));
    rmSync(directory, { recursive: true, force: true });
  }
});

test("canonical materializer derives all first-use artifacts, survives restart, and hash-chains mode-0600 bytes", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-materializer-test-"));
  chmodSync(directory, 0o700);
  const seedPath = resolve(directory, "seed.json");
  const outputPath = resolve(directory, "cleanup-input.json");
  const chainPath = resolve(directory, "chain.json");
  const manifestPath = resolve(directory, "release-manifest.json");
  const configPath = resolve(directory, "config-activation.json");
  const disabledPath = resolve(directory, "disabled-config.json");
  const activationPath = resolve(directory, "activation.json");
  const promotionPath = resolve(directory, "promotion.json");
  const productionSecretsPath = resolve(directory, "production-secrets.json");
  const secretInputDirectory = resolve(directory, "secret-input");
  const postgresInputDirectory = resolve(directory, "postgres-input");
  mkdirSync(secretInputDirectory, { mode: 0o700 });
  mkdirSync(postgresInputDirectory, { mode: 0o700 });
  const staticSecretNames = [
    "DATABASE_URL",
    "BETTER_AUTH_SECRET",
    "GOOGLE_CLIENT_ID",
    "GOOGLE_CLIENT_SECRET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "WORKFLOW_CALLBACK_SECRET",
    "MEDIA_WORKER_TOKEN_SECRET",
    "VIDEOFORGE_RECONCILER_DATABASE_URL",
    "VIDEOFORGE_DISPATCH_TOKEN_KEY",
    "VIDEOFORGE_DISPATCH_TOKEN_KEY_ID",
    "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
    "VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID",
    "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
    "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
    "RUNPOD_API_KEY",
    "RUNPOD_API_BASE_URL",
    "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
  ];
  for (const [index, name] of staticSecretNames.entries())
    writeFileSync(resolve(secretInputDirectory, name), `static-${index}`, { mode: 0o600 });
  const seed = materializationSeedFixture();
  writeFileSync(seedPath, `${canonicalJson(seed)}\n`, { mode: 0o600 });
  const materializationSeedSha256 = hash(Buffer.from(`${canonicalJson(seed)}\n`));
  writeFileSync(productionSecretsPath, `${JSON.stringify(preEndpointSecrets())}\n`, {
    mode: 0o600,
  });
  const environment = {
    VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: seedPath,
    VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE: chainPath,
    VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: outputPath,
    VIDEOFORGE_V2_13_RELEASE_MANIFEST_FILE: manifestPath,
    VIDEOFORGE_V2_13_CONFIG_ACTIVATION_RECORD: configPath,
    VIDEOFORGE_V2_13_DISABLED_CONFIG_FILE: disabledPath,
    VIDEOFORGE_V2_13_ACTIVATION_RECORD: activationPath,
    VIDEOFORGE_V2_13_PROMOTION_RECORD_FILE: promotionPath,
    VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE: productionSecretsPath,
    VIDEOFORGE_V2_13_SECRET_INPUT_DIR: secretInputDirectory,
    VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: postgresInputDirectory,
  };
  const validated = { production: 0, guarded: 0, promotion: 0 };
  const factory = ({ readMediaWorkerRelease = mediaWorkerReleaseReadback } = {}) =>
    createProtectedInputMaterializer({
      environment,
      readMediaWorkerRelease,
      validateProduction: () => {
        validated.production += 1;
        return JSON.parse(readFileSync(outputPath, "utf8"));
      },
      validateGuarded: () => {
        validated.guarded += 1;
      },
      validatePromotion: () => {
        validated.promotion += 1;
      },
      renderDisabledConfig: () =>
        Buffer.from(
          `${JSON.stringify({ vars: { VIDEOFORGE_GPU_TRANSPORT: "DISABLED_UNQUALIFIED" } })}\n`,
        ),
    });
  const materialize = factory();
  const materialState = {
    ...state,
    state: "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
    authority_id: "v2-13-materializer-test-0001",
    full_live_authority_id: "11111111-1111-4111-8111-111111111111",
    proposal_sha256: `sha256:${"1".repeat(64)}`,
    approval_sha256: `sha256:${"2".repeat(64)}`,
    proposal_record_commit: "3".repeat(40),
    full_live_executor_sha256: `sha256:${"4".repeat(64)}`,
    materialization_seed_sha256: materializationSeedSha256,
    approval_record_path: "evidence/user-approval.json",
  };
  const prior = new Map([
    [
      "mage-image-workflow-verification",
      { evidenceSha256: `sha256:${"5".repeat(64)}`, imageDigest: `sha256:${"6".repeat(64)}` },
    ],
    [
      "soulx-image-workflow-verification",
      { evidenceSha256: `sha256:${"7".repeat(64)}`, imageDigest: `sha256:${"8".repeat(64)}` },
    ],
  ]);
  try {
    await materialize({
      operationId: "fresh-live-preflight",
      state: materialState,
      priorResults: prior,
      outerStateSha256: `sha256:${"9".repeat(64)}`,
    });
    assert.throws(() => readFileSync(outputPath), /ENOENT/u);
    const prequalificationChain = JSON.parse(readFileSync(chainPath, "utf8"));
    assert.equal(prequalificationChain.entries.length, 1);
    assert.equal(prequalificationChain.entries[0].kind, "prequalification-descriptor");
    assert.deepEqual(
      prequalificationChain.entries[0].ordered_output_sha256s.map(([name]) => name),
      ["prequalification_descriptor_sha256"],
    );
    prior.set("fresh-live-preflight", {
      evidenceSha256: `sha256:${"9".repeat(64)}`,
      bridgeSummary: { admission: { cumulativeBillingUsd: 10 } },
    });
    await materialize({
      operationId: "mage-live-qualification",
      state: materialState,
      priorResults: prior,
      outerStateSha256: `sha256:${"a".repeat(64)}`,
    });
    const output = JSON.parse(readFileSync(outputPath, "utf8"));
    const chain = JSON.parse(readFileSync(chainPath, "utf8"));
    assert.match(output.dualLaneInput.mage.publicImage, /@sha256:6{64}$/u);
    assert.equal(output.dualLaneInput.soulx.deploymentSha256, `sha256:${"7".repeat(64)}`);
    assert.equal(chain.entries.length, 2);
    assert.deepEqual(
      chain.entries.map((entry) => entry.kind),
      ["prequalification-descriptor", "production-input"],
    );
    assert.equal(chain.entries[1].prior_chain_sha256, chain.entries[0].entry_sha256);
    assert.equal(lstatSync(outputPath).mode & 0o777, 0o600);
    const later = new Map(prior);
    later.set("mage-live-qualification", {
      evidenceSha256: `sha256:${"a".repeat(64)}`,
      deploymentSha256: `sha256:${"b".repeat(64)}`,
    });
    later.set("soulx-live-qualification", {
      evidenceSha256: `sha256:${"c".repeat(64)}`,
      deploymentSha256: `sha256:${"d".repeat(64)}`,
    });
    later.set("create-exact-max-one-endpoints", {
      evidenceSha256: `sha256:${"e".repeat(64)}`,
      materialization: {
        production: {
          mage: {
            endpointId: "mage-endpoint",
            endpointIdSha256: hash("mage-endpoint"),
            deploymentSnapshotSha256: `sha256:${"e".repeat(64)}`,
          },
          soulx: {
            endpointId: "soulx-endpoint",
            endpointIdSha256: hash("soulx-endpoint"),
            deploymentSnapshotSha256: `sha256:${"f".repeat(64)}`,
          },
        },
      },
    });
    const operatorDatabaseUrl = Buffer.from(
      "postgresql://videoforge_hosted_operator:operator-password@db.example.invalid/videoforge?sslmode=require",
    );
    writeFileSync(resolve(postgresInputDirectory, "operator.database-url"), operatorDatabaseUrl, {
      mode: 0o600,
    });
    later.set("bootstrap-prequalification-database", {
      schema_version: "videoforge.v213-prequalification-database-bootstrap-result/v4",
      full_live_authority_id: materialState.full_live_authority_id,
      outer_state_sha256: `sha256:${"3".repeat(64)}`,
      materialization_seed_sha256: materialState.materialization_seed_sha256,
      database_identity_sha256:
        "sha256:7f2c802c531f4e5630d6a15b2f26bf65ea04f599b28c19fc3daa5d741c7567d7",
      operator_database_url_sha256: hash(operatorDatabaseUrl),
      runtime_database_url_sha256: hash(Buffer.from("static-0")),
      reconciler_database_url_sha256: hash(Buffer.from("static-8")),
      database_role_credential_bundle_sha256: `sha256:${"4".repeat(64)}`,
      credential_bootstrap_receipt_sha256:
        "sha256:35caf042a18f6f4b42f264d96e52926856bcc387890c4925f512f2bf2c6c1eab",
      production_secret_bootstrap_sha256: `sha256:${"6".repeat(64)}`,
      production_secrets_sha256: `sha256:${"7".repeat(64)}`,
      production_secret_file_sha256s: { DATABASE_URL: `sha256:${"8".repeat(64)}` },
      internal_credential_key_ids: { pairEnvelopeSigningKeyId: "v213-envelope-key" },
      prequalification_database_bootstrap_sha256: `sha256:${"5".repeat(64)}`,
    });
    await assert.rejects(
      factory({
        readMediaWorkerRelease: async (input) => ({
          ...mediaWorkerReleaseReadback(input),
          manifestSha256: `sha256:${"0".repeat(64)}`,
        }),
      })({
        operationId: "guarded-activation-once",
        state: materialState,
        priorResults: later,
        outerStateSha256: `sha256:${"f".repeat(64)}`,
      }),
      /MEDIA_WORKER_RELEASE_READBACK_CONTRACT/u,
    );
    assert.throws(() => readFileSync(manifestPath), /ENOENT/u);
    assert.equal(JSON.parse(readFileSync(chainPath, "utf8")).entries.length, 2);
    for (const name of [
      "VIDEOFORGE_MAGE_ENDPOINT_ID",
      "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
      "VIDEOFORGE_SOULX_ENDPOINT_ID",
      "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
    ])
      assert.throws(() => lstatSync(resolve(secretInputDirectory, name)), /ENOENT/u);
    await factory()({
      operationId: "guarded-activation-once",
      state: materialState,
      priorResults: later,
      outerStateSha256: `sha256:${"f".repeat(64)}`,
    });
    later.set("guarded-activation-once", {
      evidenceSha256: `sha256:${"0".repeat(64)}`,
      materialization: {
        disabledVersionId: "11111111-1111-4111-8111-111111111111",
        disabledVersionSha256: `sha256:${"1".repeat(64)}`,
      },
    });
    await factory()({
      operationId: "promote-qualified-production",
      state: materialState,
      priorResults: later,
      outerStateSha256: `sha256:${"2".repeat(64)}`,
    });
    const completeChain = JSON.parse(readFileSync(chainPath, "utf8"));
    assert.deepEqual(
      completeChain.entries.map((entry) => entry.kind),
      [
        "prequalification-descriptor",
        "production-input",
        "media-worker-release-readback",
        "max-one-endpoint-bindings",
        "activation-record",
        "promotion-record",
      ],
    );
    assert.equal(
      completeChain.entries[1].prior_chain_sha256,
      completeChain.entries[0].entry_sha256,
    );
    assert.equal(
      completeChain.entries[2].prior_chain_sha256,
      completeChain.entries[1].entry_sha256,
    );
    assert.equal(
      completeChain.entries[3].prior_chain_sha256,
      completeChain.entries[2].entry_sha256,
    );
    assert.equal(
      completeChain.entries[4].prior_chain_sha256,
      completeChain.entries[3].entry_sha256,
    );
    for (const path of [manifestPath, configPath, disabledPath, activationPath, promotionPath])
      assert.equal(lstatSync(path).mode & 0o777, 0o600);
    const promotion = JSON.parse(readFileSync(promotionPath, "utf8"));
    assert.equal(
      promotion.lanes.mage_image.qualification_record_sha256,
      `sha256:${"a".repeat(64)}`,
    );
    assert.equal(promotion.cloudflare.disabled_version_sha256, `sha256:${"1".repeat(64)}`);
    const finalSecrets = JSON.parse(readFileSync(productionSecretsPath, "utf8"));
    assert.equal(finalSecrets.mageEndpointId, "mage-endpoint");
    assert.equal(finalSecrets.soulxEndpointId, "soulx-endpoint");
    assert.equal(
      promotion.lanes.soulx_avatar.deployment_snapshot_sha256,
      `sha256:${"f".repeat(64)}`,
    );
    const activation = JSON.parse(readFileSync(activationPath, "utf8"));
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, "utf8")), MEDIA_WORKER_RELEASE_MANIFEST);
    assert.equal(Object.keys(activation.secret_sha256).length, 22);
    assert.equal(activation.secret_sha256.VIDEOFORGE_MAGE_ENDPOINT_ID, hash("mage-endpoint"));
    assert.deepEqual(validated, { production: 2, guarded: 1, promotion: 1 });
    await assert.rejects(
      factory()({
        operationId: "mage-live-qualification",
        state: materialState,
        priorResults: prior,
        outerStateSha256: `sha256:${"a".repeat(64)}`,
      }),
      /MATERIALIZATION_CHAIN_STAGE_ORDER/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("materializer rejects nested seed aliases, extra command payloads, and CAS replacement", async () => {
  const baseSeed = materializationSeedFixture();
  const runWith = async (seed, expectedHash, pattern) => {
    const directory = mkdtempSync(resolve(tmpdir(), "v213-materializer-seed-contract-test-"));
    const seedPath = resolve(directory, "seed.json");
    const chainPath = resolve(directory, "chain.json");
    const outputPath = resolve(directory, "production-input.json");
    writeFileSync(seedPath, `${JSON.stringify(seed)}\n`, { mode: 0o600 });
    const materialize = createProtectedInputMaterializer({
      environment: {
        VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: seedPath,
        VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE: chainPath,
        VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: outputPath,
      },
    });
    try {
      await assert.rejects(
        materialize({
          operationId: "fresh-live-preflight",
          state: {
            ...state,
            authority_id: "v2-13-seed-contract-0001",
            proposal_sha256: `sha256:${"1".repeat(64)}`,
            approval_sha256: `sha256:${"2".repeat(64)}`,
            proposal_record_commit: "3".repeat(40),
            full_live_executor_sha256: `sha256:${"4".repeat(64)}`,
            materialization_seed_sha256: expectedHash,
          },
          priorResults: new Map(),
          outerStateSha256: `sha256:${"5".repeat(64)}`,
        }),
        pattern,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  };
  const alias = structuredClone(baseSeed);
  alias.production_input_base.dualLaneInput.mage.DeploymentSnapshotSha256 = null;
  await runWith(
    alias,
    hash(Buffer.from(`${canonicalJson(alias)}\n`)),
    /MATERIALIZATION_SEED_CONTRACT/u,
  );
  const extraCommand = structuredClone(baseSeed);
  extraCommand.production_input_base.commandPayloads.mage = {};
  await runWith(
    extraCommand,
    hash(Buffer.from(`${canonicalJson(extraCommand)}\n`)),
    /MATERIALIZATION_SEED_CONTRACT/u,
  );
  const nestedCredential = structuredClone(baseSeed);
  nestedCredential.promotion_record_base = {
    approval: { googleClientSecret: "forbidden" },
  };
  await runWith(
    nestedCredential,
    hash(Buffer.from(`${canonicalJson(nestedCredential)}\n`)),
    /MATERIALIZATION_SEED_CONTRACT/u,
  );
  const replacement = structuredClone(baseSeed);
  replacement.production_input_base.fullLiveAuthorityId = "22222222-2222-4222-8222-222222222222";
  await runWith(
    replacement,
    hash(Buffer.from(`${canonicalJson(baseSeed)}\n`)),
    /MATERIALIZATION_SEED_CONTRACT/u,
  );
});

test("cleanup-only materializes and chains an endpoint-free descriptor without future provider IDs", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-cleanup-descriptor-test-"));
  chmodSync(directory, 0o700);
  const seedPath = resolve(directory, "seed.json");
  const outputPath = resolve(directory, "production-input.json");
  const chainPath = resolve(directory, "chain.json");
  const seed = materializationSeedFixture();
  writeFileSync(seedPath, `${JSON.stringify(seed)}\n`, { mode: 0o600 });
  const materializationSeedSha256 = hash(Buffer.from(`${canonicalJson(seed)}\n`));
  const materialize = createProtectedInputMaterializer({
    environment: {
      VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: seedPath,
      VIDEOFORGE_V2_13_MATERIALIZATION_CHAIN_FILE: chainPath,
      VIDEOFORGE_V2_13_CLEANUP_INPUT_FILE: outputPath,
    },
    validateProduction: () => JSON.parse(readFileSync(outputPath, "utf8")),
  });
  const cleanupState = {
    ...state,
    authority_id: "v2-13-cleanup-descriptor-0001",
    full_live_authority_id: "11111111-1111-4111-8111-111111111111",
    proposal_sha256: `sha256:${"1".repeat(64)}`,
    approval_sha256: `sha256:${"2".repeat(64)}`,
    proposal_record_commit: "3".repeat(40),
    full_live_executor_sha256: `sha256:${"4".repeat(64)}`,
    materialization_seed_sha256: materializationSeedSha256,
  };
  try {
    await materialize({
      operationId: "prove-zero-workers",
      state: cleanupState,
      priorResults: new Map(),
      outerStateSha256: `sha256:${"5".repeat(64)}`,
    });
    assert.equal(lstatSync(outputPath).mode & 0o777, 0o600);
    const chain = JSON.parse(readFileSync(chainPath, "utf8"));
    assert.equal(chain.entries.length, 1);
    assert.equal(chain.entries[0].kind, "cleanup-pre-endpoint-descriptor");
    assert.deepEqual(
      chain.entries[0].ordered_output_sha256s.map(([name]) => name),
      ["cleanup_input_sha256"],
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("protected TypeScript bridge chains only opaque qualification hashes across processes", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-bridge-adapter-test-"));
  chmodSync(directory, 0o700);
  const seedPath = resolve(directory, "materialization-seed.json");
  const inputPath = resolve(directory, "production-input.json");
  const seed = materializationSeedFixture();
  const seedBytes = Buffer.from(`${canonicalJson(seed)}\n`);
  writeFileSync(seedPath, seedBytes, { mode: 0o600 });
  writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: "videoforge.v213-full-live-outer-input/v1",
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      authorityDocument: { exact: true },
      dualLaneInput: {
        mage: { sourceCommit, deploymentSha256: `sha256:${"1".repeat(64)}` },
        soulx: { sourceCommit, deploymentSha256: `sha256:${"2".repeat(64)}` },
      },
      commandPayloads: {},
    }),
    { mode: 0o600 },
  );
  const requests = [];
  const spawnBridge = async ({ request }) => {
    requests.push(request);
    const summary =
      request.command === "fresh-live-preflight"
        ? {
            schemaVersion: "videoforge.v213-admission-handoff/v1",
            handoffSha256: `sha256:${"3".repeat(64)}`,
            admission: {
              gpu: "NVIDIA GeForce RTX 4090",
              region: "EU-RO-1",
              availability: "LOW",
              flexRateUsdPerGpuHour: 1,
              cumulativeBillingUsd: 10,
            },
          }
        : {
            handoffSha256: `sha256:${"4".repeat(64)}`,
            billingAfterUsd: 10.5,
            qualified: true,
            zeroWorkersAfter: true,
          };
    return {
      schemaVersion: "videoforge.v213-full-live-command-result/v1",
      commandId: request.commandId,
      command: request.command,
      state: "TERMINAL",
      evidenceSha256: summary.handoffSha256,
      summary,
    };
  };
  try {
    const bridgeState = {
      ...state,
      authority_id: "v2-13-bridge-adapter-test",
      full_live_authority_id: "11111111-1111-4111-8111-111111111111",
      proposal_sha256: `sha256:${"5".repeat(64)}`,
      approval_sha256: `sha256:${"6".repeat(64)}`,
      proposal_record_commit: "7".repeat(40),
      full_live_executor_sha256: `sha256:${"8".repeat(64)}`,
      materialization_seed_sha256: hash(seedBytes),
    };
    const adapters = createTypeScriptBridgeAdapters({
      environment: {
        VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: seedPath,
        VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: inputPath,
      },
      expectedCliSha256: hash(
        readFileSync(resolve(process.cwd(), "apps/web/src/server/providers/v213-full-live-cli.ts")),
      ),
      expectedTransportSha256: hash(
        readFileSync(
          resolve(
            process.cwd(),
            "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts",
          ),
        ),
      ),
      spawnBridge,
    });
    const prior = new Map();
    const preflight = await adapters["fresh-live-preflight"](
      {},
      bridgeState,
      prior,
      `sha256:${"a".repeat(64)}`,
    );
    prior.set("fresh-live-preflight", preflight);
    const mage = await adapters["mage-live-qualification"](
      {},
      bridgeState,
      prior,
      `sha256:${"b".repeat(64)}`,
    );
    assert.equal(mage.actualUsd, 0.5);
    assert.deepEqual(
      requests[1].input.commandPayload.admission,
      requests[0] ? preflight.bridgeSummary : null,
    );
    assert.equal(JSON.stringify(requests).includes("dispatch_token"), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("protected cleanup bridge returns the exact four outer proof contracts without prior deployments", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-cleanup-adapter-test-"));
  chmodSync(directory, 0o700);
  const inputPath = resolve(directory, "cleanup-input.json");
  writeFileSync(
    inputPath,
    JSON.stringify({
      schemaVersion: "videoforge.v213-full-live-cleanup-input/v1",
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      billingBaselineMode: "ESTABLISH_CURRENT_NO_RUNPOD_MUTATION",
      billingBaselineUsd: null,
      totalCapUsd: 17.5,
      retainedLanes: [
        {
          lane: "mage",
          volumeIdSha256: `sha256:${"1".repeat(64)}`,
          volumeManifestSha256: `sha256:${"2".repeat(64)}`,
        },
        {
          lane: "soulx",
          volumeIdSha256: `sha256:${"3".repeat(64)}`,
          volumeManifestSha256: `sha256:${"4".repeat(64)}`,
        },
      ],
    }),
    { mode: 0o600 },
  );
  const summaries = {
    "restore-endpoints-max-one": { bothEndpointsMaxWorkersOne: true },
    "prove-zero-workers": { zeroWorkers: true, reads: [{}, {}, {}] },
    "read-settled-billing": { withinCumulativeCap: true, cumulativeBillingUsd: 12 },
    "reconcile-exact-resources": { onlyApprovedRetainedVolumes: true },
  };
  try {
    const requests = [];
    const cleanupReceiptRequests = [];
    const receiptDocument = (request) => ({
      schemaVersion: "videoforge.v213-current-run-cleanup-receipt/v1",
      fullLiveAuthorityId: request.fullLiveAuthorityId,
      operationId: request.operationId,
      outerStateSha256: request.outerStateSha256,
      providerCleanupEvidenceSha256: request.providerCleanupEvidenceSha256,
      summary: request.summary,
    });
    const receiptArtifact = (request) => hash(Buffer.from(canonicalJson(receiptDocument(request))));
    const adapters = createTypeScriptBridgeAdapters({
      environment: { VIDEOFORGE_V2_13_CLEANUP_INPUT_FILE: inputPath },
      // Exercise the cleanup request contract while the sealed release pin intentionally remains
      // stale until final reseal.
      expectedCliSha256: hash(
        readFileSync(resolve(process.cwd(), "apps/web/src/server/providers/v213-full-live-cli.ts")),
      ),
      expectedTransportSha256: hash(
        readFileSync(
          resolve(
            process.cwd(),
            "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts",
          ),
        ),
      ),
      spawnBridge: async ({ request }) => {
        requests.push(request);
        const summary = summaries[request.command];
        return {
          schemaVersion: "videoforge.v213-full-live-command-result/v1",
          commandId: request.commandId,
          command: request.command,
          state: "TERMINAL",
          evidenceSha256: hash(Buffer.from(canonicalJson(summary))),
          summary,
        };
      },
      spawnCleanupReceipt: async ({ request }) => {
        cleanupReceiptRequests.push(request);
        const document = receiptDocument(request);
        return {
          schemaVersion: "videoforge.v213-cleanup-receipt-finalization-result/v1",
          fullLiveAuthorityId: request.fullLiveAuthorityId,
          operationId: request.operationId,
          providerCleanupEvidenceSha256: request.providerCleanupEvidenceSha256,
          receiptArtifactSha256: receiptArtifact(request),
          receiptDocument: document,
          releaseFactMaterializationSha256: hash(
            Buffer.from(canonicalJson({ operationId: request.operationId, facts: true })),
          ),
          readbackOnly: request.readbackOnly,
        };
      },
    });
    const prior = new Map();
    const outputs = [];
    for (const command of Object.keys(summaries))
      outputs.push(await adapters[command]({}, state, prior, `sha256:${"a".repeat(64)}`));
    assert.equal(
      outputs.every(
        (output, index) => output.proofSha256 === receiptArtifact(cleanupReceiptRequests[index]),
      ),
      true,
    );
    assert.equal(cleanupReceiptRequests.length, 4);
    assert.equal(
      cleanupReceiptRequests.every((request) => request.readbackOnly === false),
      true,
    );
    for (const request of cleanupReceiptRequests) {
      const { requestSha256, ...unsigned } = request;
      assert.equal(requestSha256, hash(Buffer.from(canonicalJson(unsigned))));
      assert.equal(
        request.providerCleanupEvidenceSha256,
        hash(Buffer.from(canonicalJson(request.summary))),
      );
    }
    const recovered = await adapters["prove-zero-workers"](
      {
        resumed: true,
        authorizedUnsettled: true,
        reconciliationOnly: true,
        providerDispatchForbidden: true,
      },
      state,
      prior,
      `sha256:${"b".repeat(64)}`,
    );
    assert.equal(cleanupReceiptRequests.at(-1).readbackOnly, true);
    assert.equal(recovered.proofSha256, receiptArtifact(cleanupReceiptRequests.at(-1)));
    assert.equal(outputs[0].bothEndpointsMaxWorkersOne, true);
    assert.equal(outputs[1].zeroWorkers, true);
    assert.equal(outputs[2].withinCumulativeCap, true);
    assert.equal(outputs[3].onlyApprovedRetainedVolumes, true);
    assert.equal(
      requests.every(
        (request) =>
          request.input.schemaVersion === "videoforge.v213-full-live-cleanup-input/v1" &&
          !("dualLaneInput" in request.input),
      ),
      true,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("bootstrap-partial cleanup runs owner-local preamble before exact provider readbacks", async () => {
  const authorityId = "v2-13-bootstrap-partial-cleanup-test";
  const fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
  const workId = `${authorityId}:bootstrap-prequalification-database`;
  const state = {
    authority_id: authorityId,
    full_live_authority_id: fullLiveAuthorityId,
    state: "CONSUMED_SINGLE_EXECUTION_CLEANUP_ONLY",
    operator_role_verified: false,
    phases: {
      bootstrap_prequalification_database: {
        work: { [workId]: { state: "AUTHORIZED_ONCE_NOT_REDISPATCHABLE" } },
      },
    },
  };
  const cleanupBody = {
    schemaVersion: "videoforge.v213-database-role-credential-cleanup/v1",
    fullLiveAuthorityId,
    cleanupState: "ALREADY_ABSENT",
    operatorRoleAbsent: true,
    runtimeAndReconcilerRolesAbsent: true,
    credentialBundleSha256: null,
    removedArtifactCount: 0,
  };
  const localCleanup = {
    ...cleanupBody,
    cleanupSha256: hash(Buffer.from(canonicalJson(cleanupBody))),
  };
  const summaries = {
    "restore-endpoints-max-one": {
      restorationPerformed: false,
      productionCleanupState: "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
      productionResourcesAbsent: true,
      bothEndpointsMaxWorkersOne: false,
      retainedProductionEndpoints: 0,
    },
    "prove-zero-workers": { zeroWorkers: true, reads: [{}, {}, {}] },
    "read-settled-billing": {
      cumulativeBillingUsd: 3,
      billingReads: [3, 3, 3],
      billingReadCount: 3,
      billingStable: true,
      withinCumulativeCap: true,
    },
    "reconcile-exact-resources": {
      checkedAt: "2026-08-28T10:00:00.000Z",
      runningPods: 0,
      activeWorkers: 0,
      queuedJobs: 0,
      endpointIdSha256s: [],
      templateIdSha256s: [],
      volumes: [],
      onlyApprovedRetainedVolumes: true,
    },
  };
  const providerEvidenceSha256 = hash(
    Buffer.from(canonicalJson(summaries["reconcile-exact-resources"])),
  );
  let cleanupCalls = 0;
  let bridgeCalls = 0;
  const adapters = createTypeScriptBridgeAdapters({
    expectedCliSha256: hash(
      readFileSync(resolve(process.cwd(), "apps/web/src/server/providers/v213-full-live-cli.ts")),
    ),
    expectedTransportSha256: hash(
      readFileSync(
        resolve(process.cwd(), "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts"),
      ),
    ),
    cleanupPartialDatabaseCredentials: async ({ state: supplied }) => {
      cleanupCalls += 1;
      assert.equal(supplied, state);
      return localCleanup;
    },
    spawnBridge: async ({ request }) => {
      bridgeCalls += 1;
      assert.equal(cleanupCalls, 1);
      const summary = summaries[request.command];
      assert.ok(summary);
      return {
        schemaVersion: "videoforge.v213-full-live-command-result/v1",
        commandId: request.commandId,
        command: request.command,
        state: "TERMINAL",
        evidenceSha256: hash(Buffer.from(canonicalJson(summary))),
        summary,
      };
    },
  });
  const context = {
    cleanupOnly: true,
    earlyFailure: true,
    endpointFree: true,
    providerDispatchForbidden: true,
    cleanupMode: "BOOTSTRAP_PARTIAL_CLEANUP",
  };
  const outputs = new Map();
  for (const [index, command] of [
    "restore-endpoints-max-one",
    "prove-zero-workers",
    "read-settled-billing",
    "reconcile-exact-resources",
  ].entries())
    outputs.set(
      command,
      await adapters[command](context, state, new Map(), `sha256:${String(index + 1).repeat(64)}`),
    );
  const output = outputs.get("reconcile-exact-resources");
  assert.equal(cleanupCalls, 1);
  assert.equal(bridgeCalls, 4);
  assert.equal(outputs.get("restore-endpoints-max-one").productionResourcesAbsent, true);
  assert.equal(outputs.get("prove-zero-workers").zeroWorkers, true);
  assert.equal(outputs.get("read-settled-billing").withinCumulativeCap, true);
  assert.deepEqual(output.localDatabaseCredentialCleanup, localCleanup);
  assert.equal(
    output.proofSha256,
    hash(
      Buffer.from(
        canonicalJson({
          providerCleanupEvidenceSha256: providerEvidenceSha256,
          localDatabaseCredentialCleanupSha256: localCleanup.cleanupSha256,
        }),
      ),
    ),
  );
  await assert.rejects(
    adapters["reconcile-exact-resources"](
      { ...context, cleanupMode: "UNKNOWN_CLEANUP" },
      state,
      new Map(),
      `sha256:${"b".repeat(64)}`,
    ),
    /BRIDGE_EARLY_CLEANUP_MODE/u,
  );
  assert.equal(cleanupCalls, 1);
  await assert.rejects(
    adapters["reconcile-exact-resources"](
      { ...context, providerDispatchForbidden: false },
      state,
      new Map(),
      `sha256:${"c".repeat(64)}`,
    ),
    /BRIDGE_EARLY_CLEANUP_PROVIDER_DISPATCH_FENCE/u,
  );
  assert.equal(cleanupCalls, 1);

  let failedPreambleCalls = 0;
  let failedBridgeCalls = 0;
  const missingRunPodAdapters = createTypeScriptBridgeAdapters({
    expectedCliSha256: hash(
      readFileSync(resolve(process.cwd(), "apps/web/src/server/providers/v213-full-live-cli.ts")),
    ),
    expectedTransportSha256: hash(
      readFileSync(
        resolve(process.cwd(), "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts"),
      ),
    ),
    cleanupPartialDatabaseCredentials: async () => {
      failedPreambleCalls += 1;
      return localCleanup;
    },
    spawnBridge: async () => {
      failedBridgeCalls += 1;
      assert.equal(failedPreambleCalls, 1);
      throw new Error("missing RunPod key");
    },
  });
  await assert.rejects(
    missingRunPodAdapters["restore-endpoints-max-one"](
      context,
      state,
      new Map(),
      `sha256:${"d".repeat(64)}`,
    ),
    /missing RunPod key/u,
  );
  assert.equal(failedPreambleCalls, 1);
  assert.equal(failedBridgeCalls, 1);
});

test("release certification uses a separate DB-only child and preserves recovery readback flags", async () => {
  const directory = mkdtempSync(resolve(tmpdir(), "v213-release-certification-adapter-test-"));
  chmodSync(directory, 0o700);
  const productionInputPath = resolve(directory, "production-input.json");
  const fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
  writeFileSync(
    productionInputPath,
    JSON.stringify({
      schemaVersion: "videoforge.v213-full-live-outer-input/v1",
      fullLiveAuthorityId,
      authorityDocument: { exact: true },
      dualLaneInput: { exact: true },
      commandPayloads: {},
    }),
    { mode: 0o600 },
  );
  const evidence = {
    "v2-13-final-two-lane-smoke": `sha256:${"1".repeat(64)}`,
    "restore-endpoints-max-one": `sha256:${"2".repeat(64)}`,
    "prove-zero-workers": `sha256:${"3".repeat(64)}`,
    "read-settled-billing": `sha256:${"4".repeat(64)}`,
    "reconcile-exact-resources": `sha256:${"5".repeat(64)}`,
  };
  const priorResults = new Map([
    [
      "v2-13-final-two-lane-smoke",
      { signedSmokeEvidenceSha256: evidence["v2-13-final-two-lane-smoke"] },
    ],
    ["restore-endpoints-max-one", { proofSha256: evidence["restore-endpoints-max-one"] }],
    ["prove-zero-workers", { proofSha256: evidence["prove-zero-workers"] }],
    ["read-settled-billing", { proofSha256: evidence["read-settled-billing"] }],
    ["reconcile-exact-resources", { proofSha256: evidence["reconcile-exact-resources"] }],
  ]);
  const authorityId = "v2-13-test-authority-0001";
  const workId = `${authorityId}:certify-v2-13-release`;
  const certificationState = {
    state: "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
    authority_id: authorityId,
    release_certification: {
      state: "AUTHORIZED_ONCE_RECONCILIATION_ONLY",
      work_id: workId,
    },
    cleanup_proof: { exact: true },
  };
  const ledgerSha256 = `sha256:${"8".repeat(64)}`;
  const resultValue = {
    schemaVersion: "videoforge.v213-final-release-certification-result/v1",
    actualUsd: 0,
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
    releaseIdentitySha256: `sha256:${"9".repeat(64)}`,
    ledgerSha256,
    evidenceSha256: ledgerSha256,
    predecessorEvidenceSha256s: evidence,
  };
  const requests = [];
  const adapter = createReleaseCertificationAdapter({
    environment: { VIDEOFORGE_V2_13_PRODUCTION_INPUT_FILE: productionInputPath },
    expectedCliSha256: hash(readFileSync("apps/web/src/server/providers/v213-full-live-cli.ts")),
    spawnCertification: async ({ request }) => {
      requests.push(request);
      return resultValue;
    },
  });
  const baseContext = {
    operationId: "certify-v2-13-release",
    cleanupOnly: false,
    earlyFailure: false,
    endpointFree: false,
    operatorRoleVerified: true,
    localCertification: true,
    providerDispatchForbidden: true,
  };
  try {
    assert.deepEqual(
      await adapter(
        {
          ...baseContext,
          resumed: false,
          authorizedUnsettled: false,
          reconciliationOnly: false,
        },
        certificationState,
        priorResults,
        `sha256:${"a".repeat(64)}`,
      ),
      resultValue,
    );
    assert.deepEqual(
      await adapter(
        {
          ...baseContext,
          resumed: true,
          authorizedUnsettled: true,
          reconciliationOnly: true,
          persistenceForbidden: true,
          dispatchForbidden: true,
        },
        certificationState,
        priorResults,
        `sha256:${"b".repeat(64)}`,
      ),
      resultValue,
    );
    assert.equal(requests.length, 2);
    assert.equal(requests[0].fullLiveAuthorityId, fullLiveAuthorityId);
    assert.equal(requests[0].providerDispatchForbidden, true);
    assert.equal(requests[0].reconciliationOnly, false);
    assert.equal(requests[1].resumed, true);
    assert.equal(requests[1].authorizedUnsettled, true);
    assert.equal(requests[1].reconciliationOnly, true);
    assert.equal(requests[1].persistenceForbidden, true);
    assert.equal(requests[1].dispatchForbidden, true);
    for (const request of requests) {
      const { requestSha256, ...unsigned } = request;
      assert.equal(requestSha256, hash(Buffer.from(canonicalJson(unsigned))));
      assert.deepEqual(request.predecessorEvidenceSha256s, evidence);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("durable stage-store adapter uses only the reviewed 0045 functions", async () => {
  const calls = [];
  const database = {
    async query(sql, parameters) {
      calls.push([sql, parameters]);
      if (sql.startsWith("SELECT to_char"))
        return { rows: [{ value: "2026-08-26T04:00:00.000Z" }] };
      if (sql.includes("record_v213_stage_authority"))
        return { rows: [{ value: JSON.parse(parameters[1]) }] };
      if (sql.includes("claim_v213_stage_authority"))
        return { rows: [{ value: { decision: "EXECUTE" } }] };
      if (sql.includes("claim_v213_operation")) return { rows: [{ value: { action: "EXECUTE" } }] };
      if (sql.includes("transition_v213_operation"))
        return { rows: [{ value: { state: "ACKED" } }] };
      return { rows: [{ value: null }] };
    },
  };
  const store = createV213DurableStageStore({
    database,
    fullLiveAuthorityId: "00000000-0000-4000-8000-000000000045",
    signAuthority: async () => "A".repeat(88),
    nonce: () => "n".repeat(32),
  });
  const authority = await store.issueStageAuthority({
    stage: "mage",
    inputSha256: `sha256:${"1".repeat(64)}`,
    predecessorHandoffSha256: `sha256:${"2".repeat(64)}`,
  });
  assert.equal(authority.stage, "mage");
  assert.equal((await store.claimStageAuthority(authority)).decision, "EXECUTE");
  assert.equal(
    (
      await store.claimOperation({
        operationId: "op",
        stageAuthorityId: authority.authorityId,
        kind: "create",
        requestSha256: `sha256:${"3".repeat(64)}`,
        resourceKey: "resource",
      })
    ).action,
    "EXECUTE",
  );
  assert.equal(
    (await store.transitionOperation({ operationId: "op", from: "IN_FLIGHT", to: "ACKED" })).state,
    "ACKED",
  );
  await store.completeStageAuthority(authority.authorityId, `sha256:${"4".repeat(64)}`);
  assert.ok(calls.some(([sql]) => sql.includes("complete_v213_stage_authority")));
});

test("acceptance adapter maps only redacted settled summaries into outer receipts", async () => {
  const summary = {
    settledCostUsd: 0.5,
    zeroWorkersAfter: true,
    terminal: true,
    evidenceSha256: `sha256:${"5".repeat(64)}`,
    durationSeconds: 240,
    operatorIntervention: false,
  };
  const adapter = Object.fromEntries(
    ["executeV210", "executeV211", "executeV212", "executeV213"].map((name) => [
      name,
      async () => ({ liveAcceptanceClaimed: true, summary }),
    ]),
  );
  const adapters = createV213AcceptanceAdapters({
    adapter,
    calls: { v210: {}, v211: {}, v212: {}, v213: {} },
    v209: async () => ({
      actualUsd: 0.1,
      accepted: true,
      terminal: true,
      zeroWorkersAfter: true,
      evidenceSha256: `sha256:${"6".repeat(64)}`,
      durationSeconds: 40,
    }),
  });
  const result = await adapters["v2-10-operator-free-ranga-pilot"]();
  assert.deepEqual(result, { actualUsd: 0.5, accepted: true, ...summary });
});

test("post-consumption production-secret bootstrap binds every protected copy and reconciles by CAS", async () => {
  // The fixture uses synthetic values and an injected expected-hash map; it never reads a
  // developer credential or calls a provider. Production defaults remain the sealed proposal
  // hashes. This seam lets this test exercise the complete file/CAS protocol without importing
  // the real Google, R2, or RunPod values.
  const directory = realpathSync(mkdtempSync(resolve(tmpdir(), "v213-production-secret-test-")));
  chmodSync(directory, 0o700);
  const postgresDirectory = resolve(directory, "postgres");
  const secretDirectory = resolve(directory, "secret-input");
  const sourceDirectory = resolve(directory, "credential-sources");
  mkdirSync(postgresDirectory, { mode: 0o700 });
  mkdirSync(secretDirectory, { mode: 0o700 });
  mkdirSync(sourceDirectory, { mode: 0o700 });
  const servicePath = resolve(postgresDirectory, "owner.pg_service.conf");
  const passPath = resolve(postgresDirectory, "owner.pgpass");
  writeFileSync(
    servicePath,
    "[videoforge_v2_13_owner]\nhost=ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech\ndbname=neondb\nuser=neondb_owner\nsslmode=require\nchannel_binding=require\n",
    { mode: 0o600 },
  );
  writeFileSync(
    passPath,
    "ep-sparkling-dew-azjhkwg6-pooler.c-3.ap-southeast-1.aws.neon.tech:5432:neondb:neondb_owner:owner-password\n",
    {
      mode: 0o600,
    },
  );
  const seedPath = resolve(directory, "materialization-seed.json");
  const productionSecretsPath = resolve(directory, "production-secrets.json");
  const productionSecretBootstrapPath = resolve(directory, "production-secret-bootstrap.json");
  const workerOriginPath = resolve(directory, "worker-origin");
  const workerBearerPath = resolve(directory, "worker-operator-bearer");
  const receiptPath = resolve(directory, "credential-bootstrap.json");
  const sourceValues = Object.freeze({
    GOOGLE_CLIENT_ID: "fixture-google-client-id",
    GOOGLE_CLIENT_SECRET: "fixture-google-client-secret",
    R2_ACCESS_KEY_ID: "fixture-r2-access-key-id",
    R2_SECRET_ACCESS_KEY: "fixture-r2-secret-access-key",
    RUNPOD_API_KEY: "fixture-runpod-api-key-0123456789",
  });
  const sourcePaths = Object.fromEntries(
    Object.keys(sourceValues).map((name) => [name, resolve(sourceDirectory, name)]),
  );
  Object.entries(sourceValues).forEach(([name, value]) =>
    writeFileSync(sourcePaths[name], value, { mode: 0o600 }),
  );
  const sourceHashes = Object.fromEntries(
    Object.entries(sourceValues)
      .filter(([name]) => name !== "RUNPOD_API_KEY")
      .map(([name, value]) => [name, hash(Buffer.from(value))]),
  );
  const credentialReceipt = {
    schema_version: "videoforge.v2-13-credential-bootstrap-result/v1",
    source_commit: sourceCommit,
    google_authenticated_account_sha256: hash(Buffer.from("fixture-account")),
    google_project_id: "fixture-project",
    google_project_id_sha256: hash(Buffer.from("fixture-project")),
    google_project_number_sha256: hash(Buffer.from("fixture-project-number")),
    google_oauth_client_id_sha256: sourceHashes.GOOGLE_CLIENT_ID,
    google_oauth_client_secret_sha256: sourceHashes.GOOGLE_CLIENT_SECRET,
    google_redirect_uris_canonical_sha256: hash(Buffer.from("[]")),
    google_javascript_origins_canonical_sha256: hash(Buffer.from("[]")),
    cloudflare_account_id_sha256: hash(Buffer.from("fixture-cloudflare-account")),
    r2_bucket_name_sha256: hash(Buffer.from("fixture-bucket")),
    r2_permission_group: "fixture-permission-group",
    r2_credential_type: "R2_S3_LONG_LIVED_ACCESS_KEY",
    r2_credential_lifetime: "LONG_LIVED",
    r2_credential_expiration_policy: "NO_EXPIRATION",
    r2_credential_expiration_at: null,
    r2_access_key_id_sha256: sourceHashes.R2_ACCESS_KEY_ID,
    r2_secret_access_key_sha256: sourceHashes.R2_SECRET_ACCESS_KEY,
    application_key_grammar: "fixture-key-grammar",
    runpod_calls: 0,
    gpu_hours: 0,
    external_spend_usd: 0,
  };
  const credentialReceiptBytes = Buffer.from(`${canonicalJson(credentialReceipt)}\n`);
  writeFileSync(receiptPath, credentialReceiptBytes, { mode: 0o600 });
  const authorityId = "v2-13-production-secret-bootstrap-test";
  const fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
  const outerStateSha256 = hash(Buffer.from("fixture-outer-state"));
  const productionKeyId = (purpose) =>
    `v213-${purpose}-${hash(Buffer.from(`${fullLiveAuthorityId}\0${purpose}`)).slice(7, 31)}`;
  const seed = materializationSeedFixture();
  seed.production_input_base.fullLiveAuthorityId = fullLiveAuthorityId;
  seed.production_input_base.dualLaneInput.envelopeSigningKeyId = productionKeyId("envelope");
  writeFileSync(seedPath, `${canonicalJson(seed)}\n`, { mode: 0o600 });
  const seedSha256 = hash(Buffer.from(`${canonicalJson(seed)}\n`));

  const manifest = JSON.parse(
    readFileSync("packages/control-plane/migrations/manifest.json", "utf8"),
  );
  const rows = (count) =>
    manifest.migrations
      .slice(0, count)
      .map(({ version, name, filename, sha256 }) => `${version}\t${name}\t${filename}\t${sha256}`)
      .join("\n");
  const role = {
    flags: {
      rolcanlogin: true,
      rolsuper: false,
      rolcreaterole: false,
      rolcreatedb: false,
      rolinherit: false,
      rolreplication: false,
      rolbypassrls: false,
      rolconfig: null,
    },
    memberships: 0,
    ownership: 0,
    extension_ownership: 0,
    database_acl: 0,
    effective_database_dangerous_acl: 0,
    schema_acl: ["public:USAGE"],
    effective_schema_dangerous_acl: 0,
    table_acl: 0,
    effective_table_acl: 0,
    sequence_acl: 0,
    effective_sequence_acl: 0,
    default_acl: 0,
    function_acl: [...PREQUALIFICATION_OPERATOR_FUNCTIONS].sort(),
    public_function_acl: [],
    public_default_function_acl: 0,
  };
  const calls = [];
  let lockedLedgerReads = 0;
  let operatorCreated = false;
  const run = (command, args, options = {}) => {
    calls.push([command, args, options]);
    assert.equal(command, "psql");
    const fileIndex = args.indexOf("--file");
    if (fileIndex >= 0) {
      const path = args[fileIndex + 1];
      if (path.endsWith("neon-full-live-operator-grants.sql")) {
        operatorCreated = true;
        return result();
      }
      return result();
    }
    const sql = args[args.indexOf("--command") + 1] ?? "";
    if (sql.includes("CREATE EXTENSION IF NOT EXISTS pgcrypto")) return result();
    if (sql.includes("json_build_object('operator'"))
      return result(
        0,
        `${JSON.stringify({ operator: operatorCreated ? 1 : 0, runtime: 0, reconciler: 0 })}\n`,
      );
    if (sql.includes("BEGIN;") && sql.includes("pg_advisory_xact_lock")) {
      lockedLedgerReads += 1;
      return result(0, `${rows(lockedLedgerReads === 1 ? 36 : 49)}\n`);
    }
    if (sql.includes("rolname IN")) return result(0, "0\n");
    if (sql.includes("count(*)::text FROM pg_roles"))
      return result(0, `${operatorCreated ? 1 : 0}\n`);
    if (sql.includes("FROM pg_extension WHERE extname='pgcrypto'"))
      return result(0, '{"name":"pgcrypto","version":"1.3","schema":"public"}\n');
    if (sql.includes("json_build_object('flags'")) return result(0, `${JSON.stringify(role)}\n`);
    if (sql.includes("SELECT current_user WHERE")) return result(0, "videoforge_hosted_operator\n");
    throw new Error(`unexpected fixture psql SQL: ${sql.slice(0, 120)}`);
  };
  const environment = {
    VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: postgresDirectory,
    VIDEOFORGE_V2_13_SECRET_INPUT_DIR: secretDirectory,
    VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE: resolve(postgresDirectory, "runtime.database-url"),
    VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE: resolve(
      postgresDirectory,
      "reconciler.database-url",
    ),
    VIDEOFORGE_V2_13_MATERIALIZATION_SEED_FILE: seedPath,
    VIDEOFORGE_V2_13_PRODUCTION_SECRETS_FILE: productionSecretsPath,
    VIDEOFORGE_V2_13_PRODUCTION_SECRET_BOOTSTRAP_FILE: productionSecretBootstrapPath,
    VIDEOFORGE_V2_13_WORKER_ORIGIN_FILE: workerOriginPath,
    VIDEOFORGE_V2_13_WORKER_OPERATOR_BEARER_FILE: workerBearerPath,
    VIDEOFORGE_V2_13_CREDENTIAL_BOOTSTRAP_RECEIPT_FILE: receiptPath,
    VIDEOFORGE_V2_13_GOOGLE_CLIENT_ID_FILE: sourcePaths.GOOGLE_CLIENT_ID,
    VIDEOFORGE_V2_13_GOOGLE_CLIENT_SECRET_FILE: sourcePaths.GOOGLE_CLIENT_SECRET,
    VIDEOFORGE_V2_13_R2_ACCESS_KEY_ID_FILE: sourcePaths.R2_ACCESS_KEY_ID,
    VIDEOFORGE_V2_13_R2_SECRET_ACCESS_KEY_FILE: sourcePaths.R2_SECRET_ACCESS_KEY,
    VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE: sourcePaths.RUNPOD_API_KEY,
  };
  const consumedState = {
    ...state,
    schema_version: "videoforge.v2-13-full-live-orchestration-consumption/v2",
    authority_id: authorityId,
    full_live_authority_id: fullLiveAuthorityId,
    state: "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
    operator_role_verified: false,
    materialization_seed_sha256: seedSha256,
  };
  let randomCalls = 0;
  const fixtureRandomBytes = (size) => {
    randomCalls += 1;
    return Buffer.alloc(size, randomCalls);
  };
  const credentialBootstrapExpected = {
    receiptSha256: hash(credentialReceiptBytes),
    secretHashes: sourceHashes,
  };
  const adapter = createPrequalificationDatabaseBootstrapAdapter({
    environment,
    run,
    credentialRandomBytes: fixtureRandomBytes,
    credentialBootstrapBinding: {
      receiptSchema: "videoforge.v2-13-credential-bootstrap-result/v1",
      receiptSha256: credentialBootstrapExpected.receiptSha256,
      secretHashes: credentialBootstrapExpected.secretHashes,
    },
  });
  try {
    const output = await adapter(
      { operationId: "bootstrap-prequalification-database" },
      consumedState,
      new Map(),
      outerStateSha256,
    );
    assert.equal(output.actualUsd, 0);
    assert.equal(output.runpod_calls, 0);
    assert.equal(output.cloudflare_calls, 0);
    assert.equal(output.application_secret_reads, 5);
    assert.equal(randomCalls, 13, "three DB credentials plus ten internal credentials");
    assert.equal(
      output.credential_bootstrap_receipt_sha256,
      credentialBootstrapExpected.receiptSha256,
    );
    assert.match(output.production_secret_bootstrap_sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.match(output.production_secrets_sha256, /^sha256:[0-9a-f]{64}$/u);
    assert.equal(Object.keys(output.production_secret_file_sha256s).length, 18);
    assert.equal(Object.keys(output.internal_credential_key_ids).length, 4);
    assert.equal(
      output.internal_credential_key_ids.pairEnvelopeSigningKeyId,
      seed.production_input_base.dualLaneInput.envelopeSigningKeyId,
    );
    const productionSecrets = JSON.parse(readFileSync(productionSecretsPath, "utf8"));
    const productionBundle = JSON.parse(readFileSync(productionSecretBootstrapPath, "utf8"));
    assert.equal(
      productionSecrets.schemaVersion,
      "videoforge.v213-full-live-pre-endpoint-secrets/v1",
    );
    assert.deepEqual(productionSecrets, {
      schemaVersion: productionSecrets.schemaVersion,
      stageAuthoritySigningKeyBase64: productionBundle.secrets.stageAuthoritySigningKeyBase64,
      provenanceReceiptHmacKeyBase64: productionBundle.secrets.provenanceReceiptHmacKeyBase64,
      provenanceReceiptKeyId: output.internal_credential_key_ids.provenanceReceiptKeyId,
      acceptanceEvidenceSigningKeyBase64:
        productionBundle.secrets.acceptanceEvidenceSigningKeyBase64,
      pairDispatchTokenKeyBase64: productionBundle.secrets.pairDispatchTokenKeyBase64,
      pairDispatchTokenKeyId: output.internal_credential_key_ids.pairDispatchTokenKeyId,
      pairEnvelopeSigningKeyHex: productionBundle.secrets.pairEnvelopeSigningKeyHex,
      pairEnvelopeSigningKeyId: output.internal_credential_key_ids.pairEnvelopeSigningKeyId,
      pairProviderProofKeyHex: productionBundle.secrets.pairProviderProofKeyHex,
      pairProviderProofKeyId: output.internal_credential_key_ids.pairProviderProofKeyId,
    });
    const copiedNames = [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ];
    for (const name of copiedNames)
      assert.deepEqual(
        readFileSync(resolve(secretDirectory, name)),
        readFileSync(sourcePaths[name]),
        `${name} must be byte-equal to the receipt-bound source`,
      );
    assert.deepEqual(
      readFileSync(resolve(secretDirectory, "RUNPOD_API_KEY")),
      readFileSync(sourcePaths.RUNPOD_API_KEY),
    );
    assert.deepEqual(
      readFileSync(workerBearerPath),
      readFileSync(resolve(secretDirectory, "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN")),
    );
    const prequalificationReceiptText = readFileSync(
      resolve(postgresDirectory, "prequalification-database-bootstrap.json"),
      "utf8",
    );
    for (const value of Object.values(sourceValues))
      assert.equal(
        prequalificationReceiptText.includes(value),
        false,
        "bootstrap receipt must remain secret-free",
      );
    assert.equal(
      readFileSync(workerOriginPath, "utf8"),
      seed.activation_record_base.cloudflare.public_origin,
    );
    for (const [name, digest] of Object.entries(output.production_secret_file_sha256s))
      assert.equal(digest, hash(readFileSync(resolve(secretDirectory, name))));
    for (const path of [
      productionSecretsPath,
      productionSecretBootstrapPath,
      workerOriginPath,
      workerBearerPath,
    ])
      assert.equal(lstatSync(path).mode & 0o777, 0o600);

    // A lost acknowledgement after all local files were linked is reconciled without a second
    // random generation. The receipt is the final CAS publication, not permission to regenerate.
    const receiptBytes = readFileSync(
      resolve(postgresDirectory, "prequalification-database-bootstrap.json"),
    );
    rmSync(resolve(postgresDirectory, "prequalification-database-bootstrap.json"));
    const beforeRecoveryRandomCalls = randomCalls;
    const recovered = await adapter(
      {
        operationId: "bootstrap-prequalification-database",
        authorizedUnsettled: true,
        reconciliationOnly: true,
        providerDispatchForbidden: true,
      },
      consumedState,
      new Map(),
      outerStateSha256,
    );
    assert.equal(randomCalls, beforeRecoveryRandomCalls);
    assert.equal(
      recovered.production_secret_bootstrap_sha256,
      output.production_secret_bootstrap_sha256,
    );
    const recoveredReceipt = JSON.parse(
      readFileSync(resolve(postgresDirectory, "prequalification-database-bootstrap.json"), "utf8"),
    );
    assert.notDeepEqual(
      Buffer.from(`${canonicalJson(recoveredReceipt)}\n`),
      receiptBytes,
      "reconciliation may change only recovery mode and receipt CAS",
    );
    assert.equal(
      recoveredReceipt.production_secret_bootstrap_sha256,
      output.production_secret_bootstrap_sha256,
    );
    assert.deepEqual(
      recoveredReceipt.production_secret_file_sha256s,
      output.production_secret_file_sha256s,
    );
    const stagePath = databaseCredentialStagingPath(productionSecretBootstrapPath, authorityId);
    writeFileSync(stagePath, "fixture-stage", { mode: 0o600, flag: "wx" });
    const callsBeforeStageDrift = calls.length;
    await assert.rejects(
      adapter(
        {
          operationId: "bootstrap-prequalification-database",
          authorizedUnsettled: true,
          reconciliationOnly: true,
          providerDispatchForbidden: true,
        },
        consumedState,
        new Map(),
        outerStateSha256,
      ),
      /PREQUALIFICATION_RECONCILIATION_STAGING_PRESENT/u,
    );
    assert.equal(calls.length, callsBeforeStageDrift);
    rmSync(stagePath);
    const reconciliationContext = {
      operationId: "bootstrap-prequalification-database",
      authorizedUnsettled: true,
      reconciliationOnly: true,
      providerDispatchForbidden: true,
    };
    const beforeDriftRandomCalls = randomCalls;
    for (const name of [
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "R2_ACCESS_KEY_ID",
      "R2_SECRET_ACCESS_KEY",
    ]) {
      const path = sourcePaths[name];
      const bytes = readFileSync(path);
      writeFileSync(path, Buffer.from(`${bytes}drift`), { mode: 0o600 });
      await assert.rejects(
        adapter(reconciliationContext, consumedState, new Map(), outerStateSha256),
        /PRODUCTION_SECRET_BOOTSTRAP_(GOOGLE_CLIENT_ID|GOOGLE_CLIENT_SECRET|R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY)_BINDING/u,
      );
      writeFileSync(path, bytes, { mode: 0o600 });
    }
    const sourceReceiptBytes = readFileSync(receiptPath);
    writeFileSync(receiptPath, Buffer.from(`${sourceReceiptBytes}drift`), {
      mode: 0o600,
    });
    await assert.rejects(
      adapter(reconciliationContext, consumedState, new Map(), outerStateSha256),
      /PRODUCTION_SECRET_BOOTSTRAP_CREDENTIAL_RECEIPT_HASH/u,
    );
    writeFileSync(receiptPath, sourceReceiptBytes, { mode: 0o600 });
    const generatedGoogleIdPath = resolve(secretDirectory, "GOOGLE_CLIENT_ID");
    const generatedGoogleIdBytes = readFileSync(generatedGoogleIdPath);
    writeFileSync(generatedGoogleIdPath, Buffer.from(`${generatedGoogleIdBytes}drift`), {
      mode: 0o600,
    });
    await assert.rejects(
      adapter(reconciliationContext, consumedState, new Map(), outerStateSha256),
      /MATERIALIZATION_OUTPUT_HASH_CAS|PRODUCTION_SECRET_BOOTSTRAP_COPY_BINDING|PRODUCTION_SECRET_BOOTSTRAP_RECONCILIATION_DRIFT/u,
    );
    writeFileSync(generatedGoogleIdPath, generatedGoogleIdBytes, { mode: 0o600 });
    assert.equal(randomCalls, beforeDriftRandomCalls);
    const bearerBytes = readFileSync(workerBearerPath);
    writeFileSync(workerBearerPath, Buffer.from(`${bearerBytes}drift`), { mode: 0o600 });
    await assert.rejects(
      adapter(reconciliationContext, consumedState, new Map(), outerStateSha256),
      /MATERIALIZATION_OUTPUT_HASH_CAS|PREQUALIFICATION_RECEIPT_REPLAY_DRIFT|PRODUCTION_SECRET_BOOTSTRAP_COPY_BINDING|PRODUCTION_SECRET_BOOTSTRAP_RECONCILIATION_DRIFT/u,
    );
    writeFileSync(workerBearerPath, bearerBytes, { mode: 0o600 });
    assert.equal(randomCalls, beforeRecoveryRandomCalls);
    assert.ok(calls.length > 0);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("production-secret bootstrap rejects pre-consumption invocation before protected inputs", async () => {
  const reads = [];
  const environment = new Proxy(
    {},
    {
      get(target, property) {
        if (typeof property === "string" && property.includes("FILE")) reads.push(property);
        return target[property];
      },
    },
  );
  const adapter = createPrequalificationDatabaseBootstrapAdapter({ environment });
  await assert.rejects(
    adapter(
      { operationId: "bootstrap-prequalification-database" },
      { schema_version: "wrong", state: "NOT_CONSUMED" },
      new Map(),
      hash(Buffer.from("fixture-outer-state")),
    ),
    /PREQUALIFICATION_CONSUMED_AUTHORITY_REQUIRED/u,
  );
  assert.deepEqual(reads, []);
});
