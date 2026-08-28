import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import {
  chmodSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
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
  TAG,
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
    "production-input",
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

test("git release adapters require absence, create one lightweight tag, push non-force, and read it back", async () => {
  const calls = [];
  const replies = [
    result(1),
    result(0),
    result(0),
    result(0, `${sourceCommit}\n`),
    result(0, `${sourceCommit}\n`),
    result(0, "ok\n"),
    result(0, `${sourceCommit}\trefs/tags/${TAG}\n`),
  ];
  const adapters = createGitReleaseAdapters({
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  assert.equal((await adapters["release-tag-create"]({}, state)).created, true);
  assert.equal((await adapters["release-tag-push"]({}, state)).forceUsed, false);
  assert.equal((await adapters["release-tag-readback"]({}, state)).targetCommit, sourceCommit);
  assert.deepEqual(calls[5][1], [
    "push",
    "--porcelain",
    "origin",
    `refs/tags/${TAG}:refs/tags/${TAG}`,
  ]);
  assert.equal(replies.length, 0);
});

test("git release adapter rejects either local or remote tag collision before creation", async () => {
  const local = createGitReleaseAdapters({
    run: () => result(0, `${sourceCommit} refs/tags/${TAG}\n`),
  });
  await assert.rejects(local["release-tag-create"]({}, state), /LOCAL_TAG_ALREADY_EXISTS/u);

  const replies = [result(1), result(0, `${"5".repeat(40)}\trefs/tags/${TAG}\n`)];
  const remote = createGitReleaseAdapters({ run: () => replies.shift() });
  await assert.rejects(remote["release-tag-create"]({}, state), /REMOTE_TAG_READBACK/u);

  const exactReplies = [result(1), result(0, `${sourceCommit}\trefs/tags/${TAG}\n`)];
  const exactRemote = createGitReleaseAdapters({ run: () => exactReplies.shift() });
  await assert.rejects(exactRemote["release-tag-create"]({}, state), /REMOTE_TAG_ALREADY_EXISTS/u);
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
    result(0, `${remoteCommit}\trefs/heads/codex/serverless-v2-roadmap\n`),
    result(0),
    result(0, "ok\n"),
    result(0, `${authorityCommit}\trefs/heads/codex/serverless-v2-roadmap\n`),
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
  assert.deepEqual(calls[5][1], ["merge-base", "--is-ancestor", remoteCommit, authorityCommit]);
  assert.equal(replies.length, 0);
});

test("GitHub workflow dispatch is single-shot and binds the one new exact-head run", async () => {
  const calls = [];
  const oldRun = {
    databaseId: 10,
    headSha: sourceCommit,
    workflowName: "mage-image",
    status: "completed",
  };
  const newRun = {
    databaseId: 11,
    headSha: sourceCommit,
    workflowName: "mage-image",
    status: "queued",
  };
  const replies = [
    result(0, JSON.stringify([oldRun])),
    result(0),
    result(0, JSON.stringify([newRun, oldRun])),
  ];
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  const dispatched = await adapters["mage-image-workflow-dispatch"]({}, state);
  assert.equal(dispatched.runId, "11");
  assert.equal(
    calls.filter(([command, args]) => command === "gh" && args[0] === "workflow").length,
    1,
  );
  assert.deepEqual(calls[1][1], [
    "workflow",
    "run",
    "mage-image.yml",
    "--ref",
    TAG,
    "--field",
    "publish=true",
  ]);
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
        "https://api.github.com/rate_limit",
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

test("GitHub dispatch rejects ambiguous new runs and never redispatches", async () => {
  const calls = [];
  const makeRun = (databaseId) => ({
    databaseId,
    headSha: sourceCommit,
    workflowName: "avatar-primary-serverless-image",
    status: "queued",
  });
  const replies = [
    result(0, "[]"),
    result(0),
    result(0, JSON.stringify([makeRun(20), makeRun(21)])),
  ];
  const adapters = createGithubDispatchAdapters({
    maximumPolls: 1,
    pollIntervalMs: 0,
    run: (command, args) => {
      calls.push([command, args]);
      return replies.shift();
    },
  });
  await assert.rejects(
    adapters["soulx-image-workflow-dispatch"]({}, state),
    /GITHUB_DISPATCH_AMBIGUOUS/u,
  );
  assert.equal(
    calls.filter(([command, args]) => command === "gh" && args[0] === "workflow").length,
    1,
  );
});

test("GitHub verification binds exact successful run and immutable deployability artifact", async () => {
  const digest = `sha256:${"6".repeat(64)}`;
  const evidence = {
    schema_version: "videoforge-image-deployability/v1",
    checkpoint: "V2-07",
    lane: "mage_image",
    source_commit: sourceCommit,
    registry_repository: "pala-lakshmansai/videoforge-mage-v2-07",
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
    immutable_image: `ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@${digest}`,
    manifest_digest: digest,
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
            workflowName: "mage-image",
            status,
            conclusion: status === "completed" ? "success" : null,
          }),
        );
      }
      const directory = args.at(-1);
      writeFileSync(
        resolve(directory, "mage-serverless-v2-07.json"),
        `${JSON.stringify(evidence)}\n`,
      );
      return result(0);
    },
  });
  const prior = new Map([["mage-image-workflow-dispatch", { runId: "11" }]]);
  const verified = await adapters["mage-image-workflow-verification"]({}, state, prior);
  assert.equal(verified.imageDigest, digest);
  assert.equal(viewCalls, 3);
  assert.equal(verified.publicAllBlobsVerified, true);
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
          workflowName: "mage-image",
          status: "in_progress",
          conclusion: null,
        }),
      );
    },
  });
  const prior = new Map([["mage-image-workflow-dispatch", { runId: "11" }]]);
  await assert.rejects(
    adapters["mage-image-workflow-verification"]({}, state, prior),
    /WORKFLOW_RUN_TERMINAL_TIMEOUT/u,
  );
  assert.equal(calls, 2);
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
          workflowName: "mage-image",
          status: "in_progress",
          conclusion: null,
        }),
      );
    },
  });
  const prior = new Map([["mage-image-workflow-dispatch", { runId: "11" }]]);
  await assert.rejects(
    adapters["mage-image-workflow-verification"]({}, state, prior),
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

test("staged qualification adapters preserve admission, Mage, SoulX, then max-one boundaries", async () => {
  const calls = [];
  const deployment = (lane, marker) => {
    const endpointId = `${lane}-endpoint`;
    return {
      lane,
      workersMin: 0,
      workersMax: 1,
      endpointId,
      endpointIdSha256: hash(endpointId),
      deploymentSha256: `sha256:${marker.repeat(64)}`,
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
  writeFileSync(
    servicePath,
    "[videoforge_v2_13_owner]\nhost=example.neon.tech\ndbname=videoforge\nuser=videoforge_owner\nsslmode=require\nchannel_binding=require\n",
    { mode: 0o600 },
  );
  writeFileSync(passPath, "example.neon.tech:5432:videoforge:videoforge_owner:owner-password\n", {
    mode: 0o600,
  });
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
      return result(0, `${rows(lockedLedgerReads === 1 ? 36 : 45)}\n`);
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
  const consumedState = {
    ...state,
    schema_version: "videoforge.v2-13-full-live-orchestration-consumption/v2",
    authority_id: "v2-13-bootstrap-test-authority",
    state: "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
    operator_role_verified: false,
  };
  const environment = {
    VIDEOFORGE_V2_13_POSTGRES_INPUT_DIR: directory,
    VIDEOFORGE_V2_13_SECRET_INPUT_DIR: secretInputDirectory,
    VIDEOFORGE_V2_13_RUNTIME_DATABASE_URL_FILE: runtimePath,
    VIDEOFORGE_V2_13_RECONCILER_DATABASE_URL_FILE: reconcilerPath,
  };
  let credentialGenerationCount = 0;
  try {
    const adapter = createPrequalificationDatabaseBootstrapAdapter({
      environment,
      run,
      credentialRandomBytes: (size) => {
        assert.equal(migrationSqls.length, 9);
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
      "videoforge.v213-prequalification-database-bootstrap-result/v2",
    );
    assert.equal(output.full_live_authority_id, consumedState.authority_id);
    assert.equal(output.outer_state_sha256, outerStateSha256);
    assert.equal(output.recovery_mode, "FRESH_36_TO_45");
    assert.equal(output.ledger_before_count, 36);
    assert.equal(output.runpod_calls, 0);
    assert.equal(output.cloudflare_calls, 0);
    assert.equal(output.application_secret_reads, 0);
    assert.equal(output.gpu_use, false);
    assert.equal(output.external_spend_usd, 0);
    assert.equal(credentialGenerationCount, 3);
    assert.equal(
      new Set([
        output.operator_database_url_sha256,
        output.runtime_database_url_sha256,
        output.reconciler_database_url_sha256,
      ]).size,
      3,
    );
    assert.equal(lockedLedgerReads, 2);
    assert.equal(migrationSqls.length, 9);
    for (const [index, sql] of migrationSqls.entries()) {
      assert.match(sql, /BEGIN;/u);
      assert.match(sql, /pg_advisory_xact_lock\(1448494662,1\)/u);
      assert.match(sql, new RegExp(`version=${37 + index}`));
      assert.match(sql, /migration ledger prefix drift/u);
      assert.match(sql, /INSERT INTO public\.videoforge_schema_migrations/u);
    }
    const receiptPath = resolve(directory, "prequalification-database-bootstrap.json");
    const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
    assert.equal(receipt.recovery_mode, "FRESH_36_TO_45");
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
    assert.equal(recovered.recovery_mode, "VERIFIED_EXISTING_45");
    assert.equal(recovered.ledger_before_count, 45);
    assert.equal(recovered.operator_database_url_sha256, output.operator_database_url_sha256);
    assert.equal(
      recovered.database_role_credential_bundle_sha256,
      output.database_role_credential_bundle_sha256,
    );
    assert.equal(credentialGenerationCount, generationCountBeforeRecovery);
    assert.equal(migrationSqls.length, 9);
    assert.equal(lstatSync(receiptPath).mode & 0o777, 0o600);

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
        priorResults: new Map([
          [
            "bootstrap-prequalification-database",
            { prequalification_database_bootstrap_sha256: `sha256:${"0".repeat(64)}` },
          ],
        ]),
        run,
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
      /BRIDGE_PREQUALIFICATION_RECEIPT/u,
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
        priorResults: new Map([
          ["bootstrap-prequalification-database", { ...output, ...mismatchedReceipt }],
        ]),
        run,
      }),
      /PREQUALIFICATION_VERIFY_LEDGER_BEFORE/u,
    );
    writeFileSync(receiptPath, originalReceiptBytes, { mode: 0o600 });
    const lockedLedgerReadsBeforeVerifiedReceipt = lockedLedgerReads;
    const verified = await verifyPrequalificationDatabaseReceipt({
      environment,
      priorResults: new Map([["bootstrap-prequalification-database", recovered]]),
      run,
    });
    assert.equal(verified.ledger.length, 45);
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
        priorResults: new Map([["bootstrap-prequalification-database", recovered]]),
        run,
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
      cleanupPartialDatabaseRoleCredentials({ environment, run, state: cleanupState }),
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
    });
    assert.equal(cleaned.cleanupState, "REMOVED_AUTHORITY_BOUND_FILES");
    assert.equal(cleaned.fullLiveAuthorityId, cleanupState.authority_id);
    assert.equal(cleaned.operatorRoleAbsent, true);
    assert.equal(cleaned.runtimeAndReconcilerRolesAbsent, true);
    assert.equal(cleaned.removedArtifactCount, 6);
    assert.equal(cleaned.credentialBundleSha256, hash(bundleBytes));
    const { cleanupSha256, ...cleanupBody } = cleaned;
    assert.equal(cleanupSha256, hash(Buffer.from(canonicalJson(cleanupBody))));
    for (const path of credentialArtifacts) assert.throws(() => lstatSync(path), /ENOENT/u);
    const replayedCleanup = await cleanupPartialDatabaseRoleCredentials({
      environment,
      run,
      state: cleanupState,
    });
    assert.equal(replayedCleanup.cleanupState, "ALREADY_ABSENT");
    assert.equal(replayedCleanup.credentialBundleSha256, null);
    assert.equal(replayedCleanup.removedArtifactCount, 0);

    // A hard crash can interrupt an exclusive write before link(2), leaving only a truncated,
    // deterministic current-authority bundle stage. Role-absence proof permits deleting exactly
    // that file without parsing its incomplete secret bytes.
    writeFileSync(bundleStagePath, '{"truncated":', { mode: 0o600, flag: "wx" });
    const truncatedBundleCleanup = await cleanupPartialDatabaseRoleCredentials({
      environment,
      run,
      state: cleanupState,
    });
    assert.equal(truncatedBundleCleanup.cleanupState, "REMOVED_INCOMPLETE_AUTHORITY_BOUND_STAGING");
    assert.equal(truncatedBundleCleanup.credentialBundleSha256, null);
    assert.equal(truncatedBundleCleanup.removedArtifactCount, 1);
    assert.throws(() => lstatSync(bundleStagePath), /ENOENT/u);

    // A hard crash after link(2) but before stage unlink leaves both exact bundle copies.
    writeFileSync(bundleStagePath, bundleBytes, { mode: 0o600, flag: "wx" });
    linkSync(bundleStagePath, bundlePath);
    const linkedBundleCleanup = await cleanupPartialDatabaseRoleCredentials({
      environment,
      run,
      state: cleanupState,
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

      // Before link: the deterministic per-copy stage may be incomplete, but a final canonical
      // bundle still proves which authority owns the cleanup scope.
      writeFileSync(bundlePath, bundleBytes, { mode: 0o600, flag: "wx" });
      writeFileSync(stage, "partial", { mode: 0o600, flag: "wx" });
      const beforeLink = await cleanupPartialDatabaseRoleCredentials({
        environment,
        run,
        state: cleanupState,
      });
      assert.equal(beforeLink.cleanupState, "REMOVED_AUTHORITY_BOUND_FILES");
      assert.equal(beforeLink.removedArtifactCount, 2);
      assert.equal(beforeLink.credentialBundleSha256, hash(bundleBytes));
      assert.throws(() => lstatSync(stage), /ENOENT/u);

      // After link but before unlink: both exact copies are discoverable and removed, with the
      // database URL copies preceding the canonical bundle deletion.
      writeFileSync(bundlePath, bundleBytes, { mode: 0o600, flag: "wx" });
      writeFileSync(stage, expected, { mode: 0o600, flag: "wx" });
      linkSync(stage, target);
      const afterLink = await cleanupPartialDatabaseRoleCredentials({
        environment,
        run,
        state: cleanupState,
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
      cleanupPartialDatabaseRoleCredentials({ environment, run, state: cleanupState }),
      /PREQUALIFICATION_PARTIAL_CLEANUP_CREDENTIAL_BUNDLE_LINK_TOPOLOGY/u,
    );
    assert.deepEqual(readFileSync(bundlePath), bundleBytes);
    rmSync(unexpectedBundleHardLink);
    rmSync(bundlePath);

    const foreignStage = databaseCredentialStagingPath(bundlePath, "v2-13-foreign-authority");
    writeFileSync(foreignStage, "foreign", { mode: 0o600, flag: "wx" });
    await assert.rejects(
      cleanupPartialDatabaseRoleCredentials({ environment, run, state: cleanupState }),
      /PREQUALIFICATION_PARTIAL_CLEANUP_STAGING_AUTHORITY_DRIFT/u,
    );
    assert.equal(readFileSync(foreignStage, "utf8"), "foreign");
    rmSync(foreignStage);
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
      promotion.indexOf('spawn("pnpm", ["--filter", "@videoforge/web", "exec", "wrangler"'),
  );
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
  writeFileSync(seedPath, `${JSON.stringify(seed)}\n`, { mode: 0o600 });
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
    assert.equal(chain.entries.length, 1);
    assert.equal(chain.entries[0].kind, "production-input");
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
      schema_version: "videoforge.v213-prequalification-database-bootstrap-result/v2",
      full_live_authority_id: materialState.authority_id,
      outer_state_sha256: `sha256:${"3".repeat(64)}`,
      operator_database_url_sha256: hash(operatorDatabaseUrl),
      runtime_database_url_sha256: hash(Buffer.from("static-0")),
      reconciler_database_url_sha256: hash(Buffer.from("static-8")),
      database_role_credential_bundle_sha256: `sha256:${"4".repeat(64)}`,
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
    assert.equal(JSON.parse(readFileSync(chainPath, "utf8")).entries.length, 1);
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
      /MATERIALIZATION_CHAIN_STAGE_REPLAY/u,
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
        return {
          schemaVersion: "videoforge.v213-cleanup-receipt-finalization-result/v1",
          fullLiveAuthorityId: request.fullLiveAuthorityId,
          operationId: request.operationId,
          providerCleanupEvidenceSha256: request.providerCleanupEvidenceSha256,
          receiptArtifactSha256: hash(
            Buffer.from(canonicalJson({ operationId: request.operationId, receipt: true })),
          ),
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
        (output, index) =>
          output.proofSha256 ===
          hash(
            Buffer.from(
              canonicalJson({ operationId: Object.keys(summaries)[index], receipt: true }),
            ),
          ),
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
    assert.equal(
      recovered.proofSha256,
      hash(Buffer.from(canonicalJson({ operationId: "prove-zero-workers", receipt: true }))),
    );
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
  const fullLiveAuthorityId = "v2-13-bootstrap-partial-cleanup-test";
  const workId = `${fullLiveAuthorityId}:bootstrap-prequalification-database`;
  const state = {
    authority_id: fullLiveAuthorityId,
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
