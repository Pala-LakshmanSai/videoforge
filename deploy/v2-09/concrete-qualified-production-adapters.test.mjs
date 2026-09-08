import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  REQUIRED_CONCRETE_PORTS,
  concreteAdapterIdentity,
  createConcreteQualifiedProductionDeploymentAdaptersForTest,
  createConcreteQualifiedProductionAdaptersForTest,
  createConcreteQualifiedProductionResumedAdaptersForTest,
  createConcreteQualifiedProductionStagingAdaptersForTest,
  hasV209InnerFailedClean,
  readV209InnerSucceededClean,
} from "./concrete-qualified-production-adapters.mjs";
import { SECRET_NAMES } from "../v2-13/guarded-activation.mjs";
import {
  BRANCH,
  CLEANUP_OPERATIONS,
  COMBINED_EXECUTION_MARKER,
  COMBINED_PRECOMPLETED_OPERATION_IDS,
  COMBINED_RESUME_SCHEMA,
  OPERATION_IDS,
  PUSH_REF,
  QUALIFIED_LANES,
} from "./execute-qualified-production.mjs";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const SOURCE = "a".repeat(40);
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const createConcreteQualifiedProductionAdapters = (configuration, overrides) =>
  createConcreteQualifiedProductionAdaptersForTest(configuration, { ...overrides, testOnly: true });
const createConcreteQualifiedProductionStagingAdapters = (configuration, overrides) =>
  createConcreteQualifiedProductionStagingAdaptersForTest(configuration, {
    ...overrides,
    testOnly: true,
  });
const createConcreteQualifiedProductionDeploymentAdapters = (configuration, overrides) =>
  createConcreteQualifiedProductionDeploymentAdaptersForTest(configuration, {
    ...overrides,
    testOnly: true,
  });
const createConcreteQualifiedProductionResumedAdapters = (configuration, overrides) =>
  createConcreteQualifiedProductionResumedAdaptersForTest(configuration, {
    ...overrides,
    testOnly: true,
  });

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v209-concrete-test-"));
  chmodSync(directory, 0o700);
  const privateFile = (name, value = "fixture") => {
    const path = resolve(directory, name);
    writeFileSync(path, value, { mode: 0o600 });
    return path;
  };
  const chromeAuthStateFile = privateFile("chrome-auth.json", '{"cookies":[],"origins":[]}');
  const voiceoverBytes = Buffer.from("fixture-voiceover");
  const voiceoverFile = privateFile("voiceover.wav", voiceoverBytes);
  const chromeVerifiedOutputFile = resolve(directory, "verified-output.mp4");
  const reconcilerUrl =
    "postgresql://videoforge_reconciler:reconciler-secret@db.example.test:5432/videoforge?sslmode=require&channel_binding=require";
  const databaseReconcilerUrlFile = privateFile("database-reconciler.url", reconcilerUrl);
  const cloudflareReconcilerUrlFile = privateFile(
    "cloudflare-database-reconciler.url",
    reconcilerUrl,
  );
  const databaseRuntimeUrlFile = privateFile(
    "database-runtime.url",
    "postgresql://videoforge_runtime:runtime-secret@db.example.test:5432/videoforge?sslmode=require&channel_binding=require",
  );
  const qualifiedBindingFile = privateFile(
    "binding.json",
    JSON.stringify({
      schema_version: "videoforge-v2-09-qualified-production-config-preparation/v1",
      authority: {
        mode: "PROVIDER_FREE_CONFIG_PREPARATION",
        credential_access_authorized: false,
        deployment_authorized: false,
        provider_calls_authorized: false,
        external_spend_usd: 0,
      },
      release: { source_commit: SOURCE, media_worker_release_manifest_sha256: hash("{}") },
      production: {
        account_id: "1".repeat(32),
        worker_name: "videoforge-production-runtime",
        assets_binding: "ASSETS",
        r2_binding: "PRIVATE_ARTIFACTS",
        r2_bucket_name: "videoforge-private-artifacts",
        video_workflow_binding: "VIDEO_WORKFLOW",
        video_workflow_name: "videoforge-video-workflow",
        pair_workflow_binding: "HOSTED_PAIR_WORKFLOW",
        pair_workflow_name: "videoforge-pair-workflow",
        provenance_receipt_secret_binding: "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
        provenance_receipt_key_id_binding: "VIDEOFORGE_PROVIDER_PROOF_KEY_ID",
        public_origin: "https://videoforge.example",
      },
      lanes: {
        mage_image: {
          qualification_record_sha256: QUALIFIED_LANES[0].acceptance_sha256,
          worker_image_digest: QUALIFIED_LANES[0].image_sha256,
          endpoint_id_sha256: hash("static-mage-endpoint"),
        },
        soulx_avatar: {
          qualification_record_sha256: QUALIFIED_LANES[1].acceptance_sha256,
          worker_image_digest: QUALIFIED_LANES[1].image_sha256,
          endpoint_id_sha256: hash("static-soulx-endpoint"),
        },
      },
    }),
  );
  const chromeRequestFile = privateFile(
    "chrome-request.json",
    JSON.stringify({
      schemaVersion: "videoforge.v2-09-real-chrome-production-request/v1",
      authStatePath: chromeAuthStateFile,
      productionOrigin: "https://videoforge.example",
      voiceoverPath: voiceoverFile,
      verifiedOutputPath: chromeVerifiedOutputFile,
      request: {
        schemaVersion: "videoforge.v2-09-real-chrome-operator-request/v1",
        source: "HOSTED_V209_ORDINARY",
        accountId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        prepared: {
          title: "V2-09 production E2E",
          voiceoverFilename: "voiceover.wav",
          voiceoverContentType: "audio/wav",
          voiceoverContentLength: voiceoverBytes.length,
          voiceoverSha256: hash(voiceoverBytes),
          voiceoverDurationMs: 45_000,
          avatarProfileVersionId: "avatar-profile-version-fixture",
          imageStyleVersionId: "image-style-version-fixture",
        },
        maxProgressReads: 10,
        pollIntervalMs: 0,
        stopAt: "2026-09-06T12:30:00.000Z",
      },
    }),
  );
  return {
    directory,
    configuration: {
      root: ROOT,
      sourceCommit: SOURCE,
      branch: BRANCH,
      pushRef: PUSH_REF,
      remote: "origin",
      migrationMode: "APPLY_0074_0086",
      runtimeRole: "videoforge_runtime",
      operatorRole: "videoforge_operator",
      reconcilerRole: "videoforge_reconciler",
      journalPath: resolve(directory, "journal.json"),
      runpodApiKeyFile: privateFile("runpod.key", "test-runpod-key-never-returned"),
      runpodWorkerEnvironmentFile: privateFile(
        "runpod-worker.json",
        JSON.stringify({
          envelopeSigningKeyId: "v209-envelope",
          envelopeSigningKeyHex: "1".repeat(64),
          receiptKeyId: "v209-receipt",
          receiptSigningKeyHex: "2".repeat(64),
          mageWorkerTokenHex: "3".repeat(64),
        }),
      ),
      databaseOwnerUrlFile: privateFile(
        "database-owner.url",
        "postgresql://owner:owner-secret@db.example.test:5432/videoforge?sslmode=require&channel_binding=require",
      ),
      databaseOperatorUrlFile: privateFile(
        "database-operator.url",
        "postgresql://videoforge_operator:operator-secret@db.example.test:5432/videoforge?sslmode=require&channel_binding=require",
      ),
      databaseReconcilerUrlFile,
      chromeRequestFile,
      chromeAuthStateFile,
      qualifiedBindingFile,
      mediaReleaseManifestFile: privateFile("release.json", "{}"),
      qualifiedConfigOutputFile: resolve(directory, "qualified.toml"),
      qualifiedConfigReceiptFile: resolve(directory, "qualified-receipt.json"),
      environment: {},
      mediaWorker: {},
      cloudflare: {
        secretFiles: {
          DATABASE_URL: databaseRuntimeUrlFile,
          VIDEOFORGE_RECONCILER_DATABASE_URL: cloudflareReconcilerUrlFile,
        },
      },
    },
  };
}

function portSet(calls = []) {
  return Object.fromEntries(
    REQUIRED_CONCRETE_PORTS.map((name) => [
      name,
      {
        source_sha256: hash(name),
        run: async (context) => {
          calls.push({ name, context });
          if (name === "readbackCloudflareQualified")
            return {
              schema_version: "videoforge.v2-09-qualified-readback-result/v1",
              operation_id: context.operationId,
              worker: context.authority.production.worker_name,
              config_sha256: context.authority.production.config_sha256,
              worker_bundle_sha256: context.authority.production.worker_bundle_sha256,
              deployment_id_sha256: hash("cloudflare-deployment"),
              gpu_transport: "QUALIFIED_EXACT",
              effective_gpu_transport:
                context.activationImported === true ? "QUALIFIED_EXACT" : "DISABLED_UNQUALIFIED",
              exact_pair_bound: true,
            };
          if (name === "reconcileCloudflareSafety")
            return {
              safety_verified: true,
              gpu_transport: "DISABLED_UNQUALIFIED",
              retained_r2_deleted: false,
            };
          return { operation_id: context.operationId };
        },
      },
    ]),
  );
}

function childRunner(
  calls = [],
  {
    databaseMoneyRounded = false,
    executionTimeMs = 1_000,
    executionTimeMsByLane = {},
    ceilingUsdByLane = {},
    successfulDatabaseSettled = false,
    successCostsInitiallySettled = successfulDatabaseSettled,
    chromeFailureStage = null,
    renderedWorkerBundleSha256 = `sha256:${"9".repeat(64)}`,
    noAttempts = false,
    unassigned = false,
    unassignedWithRate = false,
  } = {},
) {
  let inventoryRead = 0;
  let databaseSettled = successfulDatabaseSettled;
  let costsSettled = successCostsInitiallySettled;
  let settledCosts = successCostsInitiallySettled ? { mage: 0.2, soulx: 0.3 } : null;
  let terminalFactsByLane = successCostsInitiallySettled
    ? Object.fromEntries(
        [
          ["mage", 0.2],
          ["soulx", 0.3],
        ].map(([lane, settledCostUsd]) => [
          lane,
          {
            costBasis: "exact_execution",
            executionTimeMs: lane === "mage" ? 645_161 : 967_741,
            observedAt: "2026-09-06T12:29:58Z",
            proofSha256: hash(`${lane}-terminal-proof`),
            providerState: "COMPLETED",
            rateCheckedAt: "2026-09-06T12:00:00Z",
            settledCostUsd,
          },
        ]),
      )
    : null;
  return async (input) => {
    calls.push(input);
    let stdout = "";
    if (
      input.command === "psql" &&
      input.options?.input?.includes("videoforge.v2-09-migration-result/v1")
    ) {
      const verified = input.options.input.includes("VERIFIED_EXISTING_0086");
      stdout = JSON.stringify({
        schemaVersion: "videoforge.v2-09-migration-result/v1",
        mode: verified ? "VERIFIED_EXISTING_0086" : "APPLIED_0074_0086",
        fromVersion: verified ? 86 : 73,
        toVersion: 86,
      });
    }
    if (input.command === "git" && input.args.join(" ") === "rev-parse HEAD") stdout = SOURCE;
    if (input.command === "git" && input.args[0] === "ls-remote")
      stdout = `${SOURCE}\t${PUSH_REF}\n`;
    if (input.args.some((value) => String(value).endsWith("read-only-preflight.mjs"))) {
      stdout = JSON.stringify({
        checkedAt: "2026-09-06T11:59:00Z",
        runpod: {
          billing: { cumulativeEndpointBillingUsd: 3.5 },
          inventory: { retainedVolumes: [{}, {}] },
          offering: {
            catalogSha256: hash("catalog"),
            gpu: "NVIDIA GeForce RTX 4090",
            region: "EU-RO-1",
            availability: "LOW",
            serverlessFlexRateUsdPerGpuHour: 1.116,
          },
        },
      });
    }
    if (
      input.args.some((value) => String(value).endsWith("render-qualified-production-config.mjs"))
    ) {
      const bindingPath = input.args[input.args.indexOf("--binding") + 1];
      const binding = JSON.parse(readFileSync(bindingPath, "utf8"));
      stdout = JSON.stringify({
        schema_version: "videoforge-v2-09-qualified-production-config-preparation-receipt/v1",
        source_commit: SOURCE,
        binding_sha256: hash(readFileSync(bindingPath)),
        config_sha256: `sha256:${"8".repeat(64)}`,
        worker_bundle_sha256: renderedWorkerBundleSha256,
        media_worker_release: { version: "0.1.15", manifest_sha256: hash("{}") },
        lanes: binding.lanes,
        gpu_transport: "QUALIFIED_EXACT",
        production_build_verified: true,
        wrangler_dry_run_succeeded: true,
        deployment_attempted: false,
        provider_calls: 0,
        external_spend_usd: 0,
      });
    }
    if (input.args.some((value) => String(value).endsWith("v209-runpod-production-bridge.ts"))) {
      const request = JSON.parse(input.options.input);
      if (request.command !== "CREATE_OR_READ_LANE") {
        const second = inventoryRead;
        inventoryRead += 1;
        stdout = JSON.stringify({
          schema_version: "videoforge.v2-09-runpod-production-bridge-result/v1",
          command: request.command,
          terminal_jobs: request.jobs.map((job) => ({
            lane: job.lane,
            job_id_sha256: hash(job.job_id),
            status: "COMPLETED",
            execution_time_ms: Object.hasOwn(executionTimeMsByLane, job.lane)
              ? executionTimeMsByLane[job.lane]
              : executionTimeMs,
          })),
          inventory: {
            checkedAt: `2026-09-06T12:30:${String(second).padStart(2, "0")}Z`,
            runningPods: 0,
            activeWorkers: 0,
            queuedJobs: 0,
            endpointIdSha256s:
              request.command === "DELETE_ATTRIBUTABLE_PAIR"
                ? []
                : request.deployments.map((deployment) => deployment.endpointIdSha256),
            templateIdSha256s:
              request.command === "DELETE_ATTRIBUTABLE_PAIR"
                ? []
                : request.deployments.map((deployment) => deployment.templateIdSha256),
            volumes: QUALIFIED_LANES.map((lane) => ({
              idSha256: lane.volume_id_sha256,
              sizeGb: lane.volume_size_gb,
              region: lane.region,
              manifestSha256: lane.volume_manifest_sha256,
            })),
          },
        });
        return { status: 0, signal: null, stdout, stderr: "" };
      }
      const lane = QUALIFIED_LANES.find((item) => item.lane === request.lane);
      stdout = JSON.stringify({
        schema_version: "videoforge.v2-09-runpod-production-bridge-result/v1",
        deployment: {
          lane: lane.lane,
          purpose: "production",
          endpointId: `${lane.lane}-endpoint-id`,
          templateId: `${lane.lane}-template-id`,
          endpointIdSha256: hash(`${lane.lane}-endpoint-id`),
          templateIdSha256: hash(`${lane.lane}-template-id`),
          deploymentSha256: hash(`${lane.lane}-deployment`),
          image:
            lane.lane === "mage"
              ? `ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@${lane.image_sha256}`
              : `ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@${lane.image_sha256}`,
          sourceCommit: SOURCE,
          volumeIdSha256: lane.volume_id_sha256,
          volumeManifestSha256: lane.volume_manifest_sha256,
          volumeSizeGb: 50,
          volumeMount: "/runpod-volume",
          region: "EU-RO-1",
          gpu: "NVIDIA GeForce RTX 4090",
          gpuCount: 1,
          workersMin: 0,
          workersMax: 1,
          handlerConcurrency: 1,
          idleTimeoutSeconds: 5,
          scalerType: "REQUEST_COUNT",
          scalerValue: 1,
          initTimeoutSeconds: 800,
        },
      });
    }
    if (input.args.some((value) => String(value).endsWith("neon-read-v209-cleanup-state.sql"))) {
      const encoded = input.args.find((value) => String(value).startsWith("payload_base64="));
      const payload = JSON.parse(Buffer.from(encoded.slice("payload_base64=".length), "base64"));
      stdout = JSON.stringify({
        schemaVersion: "videoforge.v2-09-cleanup-state-result/v1",
        generationRequestId: noAttempts ? null : "33333333-3333-4333-8333-333333333333",
        generationRequestState: noAttempts
          ? null
          : databaseSettled
            ? successfulDatabaseSettled
              ? "SUCCEEDED"
              : "FAILED"
            : "ACTIVE",
        runtimeStage: noAttempts
          ? null
          : databaseSettled
            ? successfulDatabaseSettled
              ? "COMPLETE"
              : "FAILED"
            : "AVATAR",
        pairPhase: noAttempts ? null : databaseSettled ? "SETTLED" : "ACTIVE",
        activeLeaseCount: noAttempts ? 0 : databaseSettled ? 0 : 1,
        releasedLeaseCount: noAttempts ? 0 : databaseSettled ? 1 : 0,
        assignmentCount: noAttempts || unassigned ? 0 : 2,
        providerTerminalEvidenceCount: databaseSettled && !unassigned ? 2 : 0,
        sentOrUnknownOutboxCount: 0,
        exactPairTerminalCount: databaseSettled && !successfulDatabaseSettled ? 2 : 0,
        failedLaneCount: databaseSettled && !successfulDatabaseSettled ? 2 : 0,
        settledEventCount: costsSettled ? 2 : 0,
        terminalOutboxCount: databaseSettled ? 2 : 0,
        terminalTaskCount: databaseSettled ? 2 : 0,
        zeroCostSettlementCount: costsSettled && unassigned ? 2 : 0,
        nonzeroCostSettlementCount: costsSettled && !unassigned ? 2 : 0,
        totalSettledCostUsd: costsSettled
          ? (() => {
              const total = Object.values(settledCosts ?? {}).reduce(
                (sum, value) => sum + value,
                0,
              );
              return databaseMoneyRounded ? Number(total.toFixed(6)) : total;
            })()
          : 0,
        exactItemizedCostUsd: Object.values(terminalFactsByLane ?? {})
          .filter(({ costBasis }) => costBasis === "exact_execution")
          .reduce((sum, { settledCostUsd }) => sum + settledCostUsd, 0),
        conservativeLiabilityUsd: Object.values(terminalFactsByLane ?? {})
          .filter(({ costBasis }) => costBasis === "conservative_reservation")
          .reduce((sum, { settledCostUsd }) => sum + settledCostUsd, 0),
        deployments: QUALIFIED_LANES.map((lane, index) => ({
          deploymentId: payload.deploymentIds[index],
          lane: lane.lane,
          endpointId: `${lane.lane}-endpoint-id`,
          endpointIdSha256: hash(`${lane.lane}-endpoint-id`),
          templateId: `${lane.lane}-template-id`,
          templateIdSha256: hash(`${lane.lane}-template-id`),
          deploymentSha256: hash(`${lane.lane}-deployment`),
          imageSha256: lane.image_sha256,
          volumeIdSha256: lane.volume_id_sha256,
          volumeManifestSha256: lane.volume_manifest_sha256,
          active: true,
        })),
        jobs: noAttempts
          ? []
          : QUALIFIED_LANES.map((lane) => {
              const terminal = terminalFactsByLane?.[lane.lane] ?? null;
              return {
                lane: lane.lane,
                jobId: unassigned ? null : `${lane.lane}-job-id`,
                jobIdSha256: unassigned ? null : hash(`${lane.lane}-job-id`),
                status:
                  terminal?.providerState ??
                  (databaseSettled && unassigned ? "CANCELLED" : unassigned ? null : "COMPLETED"),
                ceilingUsd: ceilingUsdByLane[lane.lane] ?? 1,
                rateSource:
                  unassigned && !unassignedWithRate
                    ? null
                    : "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR",
                rateCheckedAt: unassigned && !unassignedWithRate ? null : "2026-09-06T12:00:00Z",
                terminalProofSha256:
                  terminal?.proofSha256 ??
                  (databaseSettled && !unassigned ? hash(`${lane.lane}-cleanup-proof`) : null),
                terminalObservedAt:
                  terminal?.observedAt ??
                  (databaseSettled && !unassigned ? "2026-09-06T12:29:58Z" : null),
                terminalCostBasis: terminal?.costBasis ?? null,
                terminalExecutionTimeMs: terminal?.executionTimeMs ?? null,
                terminalCostUsd: terminal?.settledCostUsd ?? null,
                terminalRateCheckedAt: terminal?.rateCheckedAt ?? null,
                terminalCostConfidence:
                  terminal === null
                    ? null
                    : terminal.costBasis === "exact_execution"
                      ? "PROVIDER_REPORTED"
                      : "ESTIMATED",
                costUsd: unassigned ? 0 : (settledCosts?.[lane.lane] ?? 0),
                duplicateCostUsd: 0,
                possibleDuplicateExecutions: 0,
                outputPrefix: `tenant/fixture/${lane.lane}`,
              };
            }),
        readAt: "2026-09-06T12:29:59Z",
      });
    }
    if (
      input.args.some((value) => String(value).endsWith("neon-reconcile-v209-staged-click.sql"))
    ) {
      const encoded = input.args.find((value) => String(value).startsWith("payload_base64="));
      const payload = JSON.parse(Buffer.from(encoded.slice("payload_base64=".length), "base64"));
      const materialized = ["PROJECT_CREATED", "GENERATION_CREATED"].includes(payload.stage);
      const generationMaterialized = payload.stage === "GENERATION_CREATED";
      const terminalGeneration = generationMaterialized && databaseSettled;
      const stagedAction = terminalGeneration
        ? successfulDatabaseSettled
          ? "PROVIDER_SUCCESS_PRESERVED"
          : "PROVIDER_FAILURE_TERMINAL_PROJECT_ARCHIVED"
        : generationMaterialized
          ? "PROVIDER_PAIR_IDENTIFIED"
          : materialized
            ? "PROJECT_WITHOUT_GENERATION_PROJECT_ARCHIVED"
            : payload.stage === "CREATE_REQUESTED"
              ? "REQUEST_NOT_MATERIALIZED"
              : "CLAIM_ONLY_NO_REQUEST";
      const stagedReceipt = {
        schemaVersion: "videoforge.v2-09-staged-click-reconciliation-result/v2",
        stage: payload.stage,
        action: stagedAction,
        requestMaterialized: materialized,
        projectId: materialized ? payload.projectId : null,
        projectRevisionId: materialized ? payload.projectRevisionId : null,
        generationRequestId: generationMaterialized ? payload.generationRequestId : null,
        generationAttemptCount: generationMaterialized ? 2 : 0,
        terminalGenerationAttemptCount: terminalGeneration ? 2 : 0,
        generationRequestState: generationMaterialized
          ? terminalGeneration
            ? successfulDatabaseSettled
              ? "SUCCEEDED"
              : "FAILED"
            : "ACTIVE"
          : null,
        pairPhase: generationMaterialized
          ? terminalGeneration
            ? "SETTLED"
            : "BOTH_ASSIGNED"
          : null,
        runtimeStage: generationMaterialized
          ? terminalGeneration
            ? successfulDatabaseSettled
              ? "COMPLETE"
              : "FAILED"
            : "GENERATING_IMAGES"
          : null,
        activeLeaseCount: generationMaterialized && !terminalGeneration ? 1 : 0,
        releasedLeaseCount: terminalGeneration ? 1 : 0,
        activeCpuWorkCount: 0,
        activeUpstreamWork: [],
        providerMayHaveCharged: generationMaterialized,
        upstreamReconciliationPending: false,
        upstreamDispatchingCount: 0,
        upstreamUnknownCount: 0,
        providerActiveAttemptCount: generationMaterialized && !terminalGeneration ? 2 : 0,
        providerAssignmentCount: generationMaterialized ? 2 : 0,
        providerSentOrUnknownCount: generationMaterialized && !terminalGeneration ? 2 : 0,
        providerPairIdentified: generationMaterialized,
        cpuCancelPending: false,
        queueAuditCount: 0,
        runtimeEventCount: 0,
        cpuEventCount: 0,
        releaseReason: terminalGeneration
          ? successfulDatabaseSettled
            ? "HOSTED_PAIR_OUTPUTS_ACCEPTED"
            : "HOSTED_PAIR_PROVIDER_TERMINAL"
          : null,
        safeToArchive: terminalGeneration && !successfulDatabaseSettled,
        projectState: materialized
          ? generationMaterialized && !terminalGeneration
            ? "ACTIVE"
            : successfulDatabaseSettled
              ? "ACTIVE"
              : "ARCHIVED"
          : null,
        projectArchived:
          materialized &&
          (!generationMaterialized || (terminalGeneration && !successfulDatabaseSettled)),
        replayed: false,
        reconciledAt: "2026-09-06T12:30:00Z",
      };
      stdout = JSON.stringify({ ...stagedReceipt, receiptSha256: hash(canonical(stagedReceipt)) });
    }
    if (input.args.some((value) => String(value).endsWith("neon-deactivate-v209-production.sql"))) {
      stdout = JSON.stringify({
        schemaVersion: "videoforge.v2-09-deactivate-production-result/v1",
        matchedCount: 2,
        deactivatedCount: 2,
        allInactive: true,
      });
    }
    if (
      input.args.some((value) =>
        String(value).endsWith("neon-reconcile-v209-unassigned-attempts.sql"),
      )
    ) {
      databaseSettled = true;
      costsSettled = true;
      settledCosts = { mage: 0, soulx: 0 };
      stdout = JSON.stringify({
        schemaVersion: "videoforge.v2-09-unassigned-reconciliation-result/v2",
        reconciledPairCount: 1,
        cancelledAttemptCount: 2,
        deadLetterOutboxCount: 2,
        failedTaskCount: 2,
        failedLaneCount: 2,
        releasedLeaseCount: 1,
        activeLeaseCount: 0,
        providerAssignmentCount: 0,
        sentOrUnknownOutboxCount: 0,
        zeroCostSettlementCount: 2,
        nonzeroCostSettlementCount: 0,
        generationRequestState: "FAILED",
        runtimeStage: "FAILED",
        pairPhase: "SETTLED",
        reconciledAt: "2026-09-06T12:30:00Z",
      });
    }
    if (input.args.some((value) => String(value).endsWith("neon-settle-v209-terminal-pair.sql"))) {
      const encoded = input.args.find((value) => String(value).startsWith("payload_base64="));
      const payload = JSON.parse(Buffer.from(encoded.slice("payload_base64=".length), "base64"));
      settledCosts = Object.fromEntries(
        payload.terminalFacts.map((fact) => [
          fact.lane === "mage_image" ? "mage" : "soulx",
          fact.settledCostUsd,
        ]),
      );
      terminalFactsByLane = Object.fromEntries(
        payload.terminalFacts.map((fact) => [fact.lane === "mage_image" ? "mage" : "soulx", fact]),
      );
      databaseSettled = true;
      costsSettled = true;
      const rawTotalSettledCostUsd = Object.values(settledCosts).reduce(
        (sum, value) => sum + value,
        0,
      );
      const totalSettledCostUsd = databaseMoneyRounded
        ? Number(rawTotalSettledCostUsd.toFixed(6))
        : rawTotalSettledCostUsd;
      const zeroCostSettlementCount = Object.values(settledCosts).filter(
        (value) => value === 0,
      ).length;
      const exactItemizedCostUsd = payload.terminalFacts
        .filter(({ costBasis }) => costBasis === "exact_execution")
        .reduce((sum, { settledCostUsd }) => sum + settledCostUsd, 0);
      const conservativeLiabilityUsd = payload.terminalFacts
        .filter(({ costBasis }) => costBasis === "conservative_reservation")
        .reduce((sum, { settledCostUsd }) => sum + settledCostUsd, 0);
      stdout = JSON.stringify({
        schemaVersion: "videoforge.v2-09-terminal-pair-settlement-result/v1",
        exactPairTerminalCount: 2,
        activeLeaseCount: 0,
        releasedLeaseCount: 1,
        assignmentCount: 2,
        providerTerminalEvidenceCount: 2,
        settledEventCount: 2,
        terminalOutboxCount: 2,
        terminalTaskCount: 2,
        zeroWorkerProofCount: 2,
        zeroCostSettlementCount,
        nonzeroCostSettlementCount: 2 - zeroCostSettlementCount,
        totalSettledCostUsd,
        exactItemizedCostUsd,
        conservativeLiabilityUsd,
        generationRequestState: "FAILED",
        runtimeStage: "FAILED",
        failedLaneCount: 2,
        pairPhase: "SETTLED",
        reconciledAt: "2026-09-06T12:30:00Z",
      });
    }
    if (input.args.some((value) => String(value).endsWith("neon-settle-v209-success-costs.sql"))) {
      const encoded = input.args.find((value) => String(value).startsWith("payload_base64="));
      const payload = JSON.parse(Buffer.from(encoded.slice("payload_base64=".length), "base64"));
      const attempts = {
        mage_image: "44444444-4444-4444-8444-444444444441",
        soulx_avatar: "44444444-4444-4444-8444-444444444442",
      };
      const eventIds = {
        mage_image: [
          "55555555-5555-4555-8555-555555555551",
          "55555555-5555-4555-8555-555555555552",
        ],
        soulx_avatar: [
          "55555555-5555-4555-8555-555555555553",
          "55555555-5555-4555-8555-555555555554",
        ],
      };
      const lanes = payload.terminalFacts.map((fact) => {
        const costMicroUsd = Math.ceil((fact.executionTimeMs * 1.116 * 1_000_000) / 3_600_000);
        return {
          attemptId: attempts[fact.lane],
          costMicroUsd,
          executionTimeMs: fact.executionTimeMs,
          lane: fact.lane,
          providerJobIdSha256: fact.providerJobIdSha256,
          providerProofSha256: fact.proofSha256,
          providerReportEventId: eventIds[fact.lane][0],
          rateCheckedAt: fact.rateCheckedAt,
          rateSource: fact.rateSource,
          settledEventId: eventIds[fact.lane][1],
        };
      });
      settledCosts = Object.fromEntries(
        lanes.map((lane) => [
          lane.lane === "mage_image" ? "mage" : "soulx",
          lane.costMicroUsd / 1_000_000,
        ]),
      );
      terminalFactsByLane = Object.fromEntries(
        payload.terminalFacts.map((fact) => [
          fact.lane === "mage_image" ? "mage" : "soulx",
          {
            costBasis: "exact_execution",
            executionTimeMs: fact.executionTimeMs,
            observedAt: fact.observedAt,
            proofSha256: fact.proofSha256,
            providerState: fact.providerState,
            rateCheckedAt: fact.rateCheckedAt,
            settledCostUsd: lanes.find(({ lane }) => lane === fact.lane).costMicroUsd / 1_000_000,
          },
        ]),
      );
      databaseSettled = true;
      costsSettled = true;
      stdout = JSON.stringify({
        schemaVersion: "videoforge.hosted-v209-success-cost-settlement/v1",
        generationRequestId: payload.generationRequestId,
        projectRevisionId: "11111111-1111-4111-8111-111111111111",
        genericProjectRevisionNetCostIncluded: false,
        exactGpuCostMicroUsd: lanes.reduce((sum, lane) => sum + lane.costMicroUsd, 0),
        conservativeGpuLiabilityMicroUsd: 0,
        lanes,
        replayed: false,
        settledAt: "2026-09-06T12:30:01.000Z",
      });
    }
    if (
      input.args.some((value) => String(value).endsWith("neon-persist-qualified-production.sql"))
    ) {
      const encoded = input.args.find((value) => String(value).startsWith("payload_base64="));
      const payload = JSON.parse(Buffer.from(encoded.slice("payload_base64=".length), "base64"));
      stdout = JSON.stringify({
        schemaVersion: "videoforge.v2-09-qualified-production-persistence-result/v1",
        rows: payload.rows.map((row) => ({
          deploymentId: row.deploymentId,
          deploymentRowIdSha256: hash(row.deploymentId),
          lane: row.lane === "mage_image" ? "mage" : "soulx",
          deploymentSha256: row.deploymentSha256,
          endpointIdSha256: row.endpointIdSha256,
          templateIdSha256: row.templateIdSha256,
        })),
      });
    }
    if (
      input.args.some((value) => String(value).endsWith("neon-import-qualified-activation.sql"))
    ) {
      const encoded = input.args.find((value) => String(value).startsWith("payload_base64="));
      const payload = JSON.parse(Buffer.from(encoded.slice("payload_base64=".length), "base64"));
      stdout = JSON.stringify({
        imported: {
          schemaVersion: "videoforge.hosted-v209-qualified-activation-result/v1",
          activationId: payload.activationId,
          evidenceSha256: hash("activation-evidence"),
          replayed: false,
        },
        loaded: {
          evidence: {
            deployedConfigSha256: payload.deployedConfigSha256,
            cloudflareVersionIdSha256: payload.cloudflareVersionIdSha256,
          },
          verification: {
            accepted: true,
            signatureVerified: true,
            sourceCommit: payload.sourceCommit,
          },
        },
      });
    }
    if (input.args.some((value) => String(value).endsWith("v209-real-chrome-bridge.ts"))) {
      const request = JSON.parse(input.options.input);
      const bytes = Buffer.from("fixture-private-mp4-bytes");
      const requestSha256 = hash(canonical(request.request));
      const claimId = hash(`${request.authorityId}:${requestSha256}`);
      const createIdentity = {
        schemaVersion: "videoforge.v2-09-create-request-identity/v1",
        source: "HOSTED_V209_ORDINARY",
        accountId: request.request.accountId,
        workspaceId: request.request.workspaceId,
        claimId,
        clickOrdinal: 1,
        idempotencyKey: "browser-project-11111111-1111-4111-8111-111111111111",
        createRequestSha256: hash("fixture-create-request"),
        voiceoverSha256: request.request.prepared.voiceoverSha256,
      };
      const projectIdentity = {
        ...createIdentity,
        schemaVersion: "videoforge.v2-09-project-identity/v1",
        projectId: "44444444-4444-4444-8444-444444444444",
        projectRevisionId: "11111111-1111-4111-8111-111111111111",
        generationRequestId: null,
      };
      const generationIdentity = {
        ...projectIdentity,
        schemaVersion: "videoforge.v2-09-generate-click-identity/v1",
        generationRequestId: "33333333-3333-4333-8333-333333333333",
        generateClickCount: 1,
      };
      writeFileSync(
        `${request.clickIdentityPath}.claim.json`,
        `${canonical({
          schema_version: "videoforge.v2-09-click-claim-file/v1",
          authority_id: request.authorityId,
          request_sha256: requestSha256,
          claim: {
            claimId,
            source: "HOSTED_V209_ORDINARY",
            accountId: request.request.accountId,
            workspaceId: request.request.workspaceId,
            clickOrdinal: 1,
            voiceoverSha256: request.request.prepared.voiceoverSha256,
          },
        })}\n`,
        { mode: 0o600 },
      );
      writeFileSync(
        `${request.clickIdentityPath}.create-request.json`,
        `${canonical({
          schema_version: "videoforge.v2-09-click-create-request-file/v1",
          authority_id: request.authorityId,
          request_sha256: requestSha256,
          identity: createIdentity,
        })}\n`,
        { mode: 0o600 },
      );
      writeFileSync(
        `${request.clickIdentityPath}.project.json`,
        `${canonical({
          schema_version: "videoforge.v2-09-click-project-identity-file/v1",
          authority_id: request.authorityId,
          request_sha256: requestSha256,
          lookup: {
            idempotencyKey: createIdentity.idempotencyKey,
            createRequestSha256: createIdentity.createRequestSha256,
          },
          identity: projectIdentity,
        })}\n`,
        { mode: 0o600 },
      );
      if (chromeFailureStage === "PROJECT_CREATED")
        return { status: 1, signal: null, stdout: "", stderr: "fixture browser failure" };
      writeFileSync(
        request.clickIdentityPath,
        `${canonical({
          schema_version: "videoforge.v2-09-click-generation-identity-file/v1",
          authority_id: request.authorityId,
          request_sha256: requestSha256,
          identity: generationIdentity,
        })}\n`,
        { mode: 0o600 },
      );
      if (chromeFailureStage === "GENERATION_CREATED")
        return { status: 1, signal: null, stdout: "", stderr: "fixture browser failure" };
      writeFileSync(request.verifiedOutputPath, bytes, { mode: 0o600 });
      stdout = JSON.stringify({
        schema_version: "videoforge.v2-09-real-chrome-bridge-result/v1",
        evidence: {
          schemaVersion: "videoforge.v2-09-real-chrome-operator-evidence/v1",
          browser: "chrome",
          source: "HOSTED_V209_ORDINARY",
          generateClickCount: 1,
          projectId: "44444444-4444-4444-8444-444444444444",
          projectRevisionId: "11111111-1111-4111-8111-111111111111",
          generationRequestId: "33333333-3333-4333-8333-333333333333",
          outputId: "output-fixture",
          outputSha256: hash(bytes),
          durationSeconds: 45,
          playbackPrivateAccess: { objectKey: "tenant/fixture/output.mp4" },
        },
      });
    }
    if (input.command.endsWith("Google Chrome")) stdout = "Google Chrome 140.0.7339.81";
    if (input.args.some((value) => String(value).endsWith("neon-read-v209-e2e-cost.sql"))) {
      stdout = JSON.stringify({
        schemaVersion: "videoforge.v2-09-e2e-cost-readback/v1",
        projectRevisionId: "11111111-1111-4111-8111-111111111111",
        genericProjectRevisionNetCostMicroUsd: 500000,
      });
    }
    if (input.command === "ffprobe") {
      stdout = JSON.stringify({
        format: { duration: "45.000000" },
        streams: [
          { codec_type: "video", codec_name: "h264" },
          { codec_type: "audio", codec_name: "aac" },
        ],
      });
    }
    return { status: 0, signal: null, stdout, stderr: "" };
  };
}

function authority(adapterIdentitySha256) {
  return {
    authority_id: "v2-09-concrete-test",
    proposal_sha256: hash("proposal"),
    source_commit: SOURCE,
    adapter_set_sha256: adapterIdentitySha256,
    caps: {
      billing_baseline_usd: 3.5,
      completion_baseline_usd: 4,
      completion_stop_usd: 6,
      incremental_cap_usd: 2,
    },
    offering: {
      offering_id_sha256: hash("offering"),
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      max_rate_usd_per_gpu_hour: 1.116,
    },
    issued_at: "2026-09-06T12:00:00Z",
    expires_at: "2026-09-07T12:00:00Z",
    media_worker: { release: "0.1.15", release_manifest_sha256: hash("{}") },
    production: {
      config_sha256: `sha256:${"8".repeat(64)}`,
      worker_bundle_sha256: `sha256:${"9".repeat(64)}`,
    },
    scope: { lanes: QUALIFIED_LANES },
  };
}

function stagedPriorResults() {
  const created = QUALIFIED_LANES.map((lane) => {
    const operationId = `create-${lane.lane}-production-lane-max-one`;
    return {
      schema_version: "videoforge.v2-09-production-lane-result/v1",
      operation_id: operationId,
      lane: lane.lane,
      gpu: lane.gpu,
      region: lane.region,
      workers_min: lane.workers_min,
      workers_max: lane.workers_max,
      handler_concurrency: lane.handler_concurrency,
      retained_volume_size_gb: lane.volume_size_gb,
      image_sha256: lane.image_sha256,
      image_source_commit: lane.image_source_commit,
      image_config_sha256: lane.image_config_sha256,
      anonymous_proof_sha256: lane.anonymous_proof_sha256,
      acceptance_sha256: lane.acceptance_sha256,
      volume_id_sha256: lane.volume_id_sha256,
      volume_manifest_sha256: lane.volume_manifest_sha256,
      endpoint_id_sha256: hash(`${lane.lane}-observed-endpoint`),
      template_id_sha256: hash(`${lane.lane}-observed-template`),
      deployment_sha256: hash(`${lane.lane}-observed-deployment`),
    };
  });
  const persistence = {
    schema_version: "videoforge.v2-09-deployment-persistence-result/v1",
    operation_id: "persist-qualified-production-deployments",
    persisted_deployment_count: 2,
    deployments: created.map((result) => ({
      lane: result.lane,
      deployment_sha256: result.deployment_sha256,
      endpoint_id_sha256: result.endpoint_id_sha256,
      template_id_sha256: result.template_id_sha256,
      deployment_row_id_sha256: hash(`${result.lane}-observed-row`),
    })),
  };
  return [
    [created[0].operation_id, created[0]],
    [created[1].operation_id, created[1]],
    [persistence.operation_id, persistence],
  ];
}

test("adapter identity seals this source and every exact narrow port", () => {
  const ports = portSet();
  const identity = concreteAdapterIdentity(ports);
  assert.match(identity, /^sha256:[0-9a-f]{64}$/u);
  const changed = portSet();
  changed.deployCloudflareDisabled = {
    ...changed.deployCloudflareDisabled,
    source_sha256: hash("changed-create-lane"),
  };
  assert.notEqual(concreteAdapterIdentity(changed), identity);
  assert.throws(
    () => concreteAdapterIdentity({ ...ports, forbiddenV210: ports.createProductionLane }),
    /V2_09_CONCRETE_PORT_SET_INVALID/u,
  );
});

test("all live factory phases hydrate one bound operator URL snapshot and reject static secrets", () => {
  const { configuration } = fixture();
  configuration.mediaWorker = {
    databaseCredentialPath: configuration.databaseOperatorUrlFile,
    heartbeatCredentialPath: configuration.databaseOwnerUrlFile,
    environment: { PATH: "/usr/bin:/bin" },
  };
  for (const create of [
    createConcreteQualifiedProductionStagingAdapters,
    createConcreteQualifiedProductionDeploymentAdapters,
    createConcreteQualifiedProductionAdapters,
    createConcreteQualifiedProductionResumedAdapters,
  ]) {
    let hydrated;
    let heartbeat;
    const adapters = create(configuration, {
      hydrateMediaWorker: true,
      portsFromHydratedConfiguration: (snapshot) => {
        hydrated = snapshot.mediaWorker.environment;
        heartbeat = snapshot.mediaWorker.heartbeatEnvironment;
        return portSet();
      },
    });
    assert.deepEqual(configuration.mediaWorker.environment, { PATH: "/usr/bin:/bin" });
    assert.equal(hydrated.PGHOST, "db.example.test");
    assert.equal(hydrated.PGPORT, "5432");
    assert.equal(hydrated.PGDATABASE, "videoforge");
    assert.equal(hydrated.PGUSER, "videoforge_operator");
    assert.equal(heartbeat.PGUSER, "owner");
    assert.equal(heartbeat.PGPASSWORD, "owner-secret");
    assert.equal(heartbeat.PGSSLMODE, "require");
    assert.equal(heartbeat.PGCHANNELBINDING, "require");
    assert.equal(JSON.stringify(adapters).includes("owner-secret"), false);
    assert.equal(hydrated.PGPASSWORD, "operator-secret");
    assert.equal(hydrated.PGSSLMODE, "require");
    assert.equal(hydrated.PGCHANNELBINDING, "require");
    assert.equal(JSON.stringify(adapters).includes("operator-secret"), false);
  }

  for (const invalidHeartbeat of [
    { heartbeatCredentialPath: configuration.databaseOperatorUrlFile },
    { heartbeatEnvironment: { PGPASSWORD: "injected-owner" } },
  ]) {
    const original = configuration.mediaWorker;
    configuration.mediaWorker = { ...original, ...invalidHeartbeat };
    assert.throws(
      () =>
        createConcreteQualifiedProductionStagingAdapters(configuration, {
          hydrateMediaWorker: true,
          portsFromHydratedConfiguration: () => portSet(),
        }),
      /V2_09_CONCRETE_MEDIA_WORKER_CONFIGURATION_INVALID/u,
    );
    configuration.mediaWorker = original;
  }

  configuration.mediaWorker.databaseCredentialPath = configuration.databaseOwnerUrlFile;
  assert.throws(
    () =>
      createConcreteQualifiedProductionStagingAdapters(configuration, {
        hydrateMediaWorker: true,
        portsFromHydratedConfiguration: () => portSet(),
      }),
    /V2_09_CONCRETE_MEDIA_WORKER_CONFIGURATION_INVALID/u,
  );

  configuration.mediaWorker.databaseCredentialPath = configuration.databaseOperatorUrlFile;
  for (const environment of [
    { PGPASSWORD: "must-not-be-in-plan" },
    { RUNPOD_API_KEY: "must-not-be-in-plan" },
    { API_TOKEN: "must-not-be-in-plan" },
  ]) {
    configuration.mediaWorker.environment = environment;
    assert.throws(
      () =>
        createConcreteQualifiedProductionStagingAdapters(configuration, {
          hydrateMediaWorker: true,
          portsFromHydratedConfiguration: () => portSet(),
        }),
      /V2_09_CONCRETE_MEDIA_WORKER_CONFIGURATION_INVALID/u,
    );
  }
});

test("media-worker hydration and adapter binding share one descriptor-bound operator snapshot", () => {
  const { configuration } = fixture();
  configuration.mediaWorker = {
    databaseCredentialPath: configuration.databaseOperatorUrlFile,
    heartbeatCredentialPath: configuration.databaseOwnerUrlFile,
    environment: {},
  };
  let hydratedPassword;
  const adapters = createConcreteQualifiedProductionStagingAdapters(configuration, {
    hydrateMediaWorker: true,
    portsFromHydratedConfiguration: (snapshot) => {
      hydratedPassword = snapshot.mediaWorker.environment.PGPASSWORD;
      writeFileSync(
        configuration.databaseOperatorUrlFile,
        "postgresql://videoforge_operator:changed-after-snapshot@db.example.test:5432/videoforge?sslmode=require",
        { mode: 0o600 },
      );
      return portSet();
    },
  });
  assert.equal(hydratedPassword, "operator-secret");
  assert.equal(JSON.stringify(adapters).includes("operator-secret"), false);
  assert.equal(JSON.stringify(adapters).includes("changed-after-snapshot"), false);
});

test("factory exposes the exact coordinator graph and fixed low-level lane context", async () => {
  const { configuration } = fixture();
  const portCalls = [];
  const childCalls = [];
  const ports = portSet(portCalls);
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports,
    runChild: childRunner(childCalls),
  });
  assert.notEqual(adapters.identity_sha256, concreteAdapterIdentity(ports));
  assert.equal(
    adapters.source_identity.implementation_sha256,
    concreteAdapterIdentity(ports, configuration),
  );
  assert.deepEqual(Object.keys(adapters.operations).sort(), [...OPERATION_IDS].sort());
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });
  await adapters.operations["create-mage-production-lane-max-one"]({
    authority: value,
    cleanupOnly: false,
    operation: {},
    priorResults: [],
  });
  assert.equal(portCalls.length, 0);
  assert.equal(
    childCalls.some(({ args }) =>
      args.some((value) => String(value).endsWith("v209-runpod-production-bridge.ts")),
    ),
    true,
  );
});

test("staging factory needs neither Chrome inputs nor deferred endpoint secrets", async () => {
  const { configuration, directory } = fixture();
  unlinkSync(configuration.chromeRequestFile);
  unlinkSync(configuration.chromeAuthStateFile);
  for (const name of [
    "VIDEOFORGE_MAGE_ENDPOINT_ID",
    "VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256",
    "VIDEOFORGE_SOULX_ENDPOINT_ID",
    "VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256",
  ])
    configuration.cloudflare.secretFiles[name] = resolve(directory, `${name}.missing`);
  const calls = [];
  const adapters = createConcreteQualifiedProductionStagingAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(calls),
  });
  assert.deepEqual(Object.keys(adapters.operations), [
    "push-clean-source",
    "readback-clean-source",
    "apply-migrations-0074-0086",
    "apply-v209-grants",
    "publish-media-worker-0.1.15",
    "readback-media-worker-0.1.15",
    "fresh-read-only-admission",
    "create-mage-production-lane-max-one",
    "create-soulx-production-lane-max-one",
    "persist-qualified-production-deployments",
    "render-qualified-production-config",
  ]);
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });
  const priorResults = {};
  for (const operationId of [
    "create-mage-production-lane-max-one",
    "create-soulx-production-lane-max-one",
    "persist-qualified-production-deployments",
  ]) {
    await adapters.state.beginNormalOperation({
      authorityId: value.authority_id,
      operationId,
      redispatchAllowed: false,
    });
    const result = await adapters.operations[operationId]({
      authority: value,
      operation: {},
      priorResults: Object.entries(priorResults),
    });
    priorResults[operationId] = result;
    await adapters.state.completeNormalOperation({
      authorityId: value.authority_id,
      operationId,
      result,
    });
  }
  const bindings = adapters.readPersistedDeploymentBindings({
    authority: value,
    priorResults,
  });
  assert.deepEqual(Object.keys(bindings), ["mage", "soulx"]);
  assert.equal(bindings.mage.endpointIdSha256, hash(bindings.mage.endpointId));
  assert.equal(bindings.soulx.endpointIdSha256, hash(bindings.soulx.endpointId));
  await assert.rejects(
    async () =>
      adapters.readPersistedDeploymentBindings({
        authority: value,
        priorResults: {
          ...priorResults,
          "create-mage-production-lane-max-one": {
            ...priorResults["create-mage-production-lane-max-one"],
            endpoint_id_sha256: hash("tampered"),
          },
        },
      }),
    /V2_09_STAGING_DEPLOYMENT_BINDING_INVALID/u,
  );
  const journalBeforeCleanup = JSON.parse(readFileSync(configuration.journalPath, "utf8"));
  for (const lane of ["mage", "soulx"]) {
    assert.equal(Object.hasOwn(journalBeforeCleanup.resources[lane], "resourceKey"), false);
    assert.equal(Object.keys(journalBeforeCleanup.resources[lane]).length, 23);
  }
  const cleanup = await adapters.cleanupStagedRunPod({ authority: value });
  const cleanupRequest = JSON.parse(
    calls.find(({ options }) => options?.input?.includes('"command":"DELETE_ATTRIBUTABLE_PAIR"'))
      .options.input,
  );
  for (const deployment of cleanupRequest.deployments) {
    assert.equal(Object.keys(deployment).length, 24);
    assert.equal(deployment.resourceKey, `${value.authority_id}-${deployment.lane}-production`);
  }
  assert.equal(cleanup.endpoint_count, 0);
  assert.equal(cleanup.database_deactivated, true);
  assert.equal(
    calls.some(({ args = [] }) =>
      args.some((entry) => String(entry).endsWith("neon-deactivate-v209-production.sql")),
    ),
    true,
  );
  assert.equal(
    calls.some(({ options }) => options?.input?.includes('"command":"DELETE_ATTRIBUTABLE_PAIR"')),
    true,
  );
  for (const key of ["foreign-authority-mage-production", null]) {
    const tampered = structuredClone(journalBeforeCleanup);
    tampered.resources.mage.resourceKey = key;
    writeFileSync(configuration.journalPath, JSON.stringify(tampered), { mode: 0o600 });
    const before = calls.filter(({ options }) =>
      options?.input?.includes('"command":"DELETE_ATTRIBUTABLE_PAIR"'),
    ).length;
    await assert.rejects(
      adapters.cleanupStagedRunPod({ authority: value }),
      /V2_09_STAGING_CLEANUP_INCOMPLETE/u,
    );
    assert.equal(
      calls.filter(({ options }) =>
        options?.input?.includes('"command":"DELETE_ATTRIBUTABLE_PAIR"'),
      ).length,
      before,
    );
  }
});

test("deployment factory binds all secrets and rehydrates the persisted pair without Chrome", async () => {
  const { configuration, directory } = fixture();
  unlinkSync(configuration.chromeRequestFile);
  unlinkSync(configuration.chromeAuthStateFile);
  for (const name of SECRET_NAMES) {
    if (configuration.cloudflare.secretFiles[name] !== undefined) continue;
    const path = resolve(directory, `deployment-secret-${name}`);
    writeFileSync(path, `${name}-fixture`, { mode: 0o600 });
    configuration.cloudflare.secretFiles[name] = path;
  }
  const childCalls = [];
  const staging = createConcreteQualifiedProductionStagingAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls),
  });
  const value = authority(staging.identity_sha256);
  await staging.state.claimAuthority({ authority: value });
  const priorResults = {};
  for (const operationId of [
    "create-mage-production-lane-max-one",
    "create-soulx-production-lane-max-one",
    "persist-qualified-production-deployments",
  ]) {
    await staging.state.beginNormalOperation({
      authorityId: value.authority_id,
      operationId,
      redispatchAllowed: false,
    });
    const result = await staging.operations[operationId]({
      authority: value,
      operation: {},
      priorResults: Object.entries(priorResults),
    });
    priorResults[operationId] = result;
    await staging.state.completeNormalOperation({
      authorityId: value.authority_id,
      operationId,
      result,
    });
  }
  for (const operationId of COMBINED_PRECOMPLETED_OPERATION_IDS) {
    if (priorResults[operationId] !== undefined) continue;
    const result = { operation_id: operationId };
    await staging.state.beginNormalOperation({
      authorityId: value.authority_id,
      operationId,
      redispatchAllowed: false,
    });
    await staging.state.completeNormalOperation({
      authorityId: value.authority_id,
      operationId,
      result,
    });
    priorResults[operationId] = result;
  }
  const preflightProof = hash("deployment-handoff-preflight");
  const stagedReceiptsSha256 = hash("deployment-handoff-staged-receipts");
  const innerAuthorityId = `v2-09-inner-${hash(
    canonical({
      outerAuthorityId: value.authority_id,
      preflightProof,
      stagedReceiptsSha256,
    }),
  ).slice(7, 31)}`;
  const inner = { ...value, authority_id: innerAuthorityId };
  const combinedUnsigned = {
    schema_version: COMBINED_RESUME_SCHEMA,
    execution_marker: COMBINED_EXECUTION_MARKER,
    outer_authority_id: value.authority_id,
    preflight_proof_sha256: preflightProof,
    staged_receipts_sha256: stagedReceiptsSha256,
    inner_authority_sha256: hash(canonical(inner)),
    operations: COMBINED_PRECOMPLETED_OPERATION_IDS.map((operationId) => ({
      operation_id: operationId,
      result: priorResults[operationId],
      result_sha256: hash(canonical(priorResults[operationId])),
    })),
  };
  const combinedExecution = {
    ...combinedUnsigned,
    receipt_sha256: hash(canonical(combinedUnsigned)),
  };
  const deployment = createConcreteQualifiedProductionDeploymentAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls),
    rehydration: {
      combinedExecution,
      executionAuthority: inner,
      journalAuthorityId: value.authority_id,
      priorResults,
    },
  });
  assert.deepEqual(Object.keys(deployment.operations), [
    "render-qualified-production-config",
    "deploy-cloudflare-disabled-bootstrap",
    "upload-cloudflare-production-secrets",
    "deploy-cloudflare-qualified-production",
    "readback-qualified-production",
    "install-media-worker-0.1.15",
    "import-v209-qualified-activation",
  ]);
  assert.throws(
    () =>
      createConcreteQualifiedProductionAdapters(configuration, {
        ports: portSet(),
        runChild: childRunner(),
        rehydration: { authority: value, priorResults },
      }),
    /ENOENT|V2_09_CONCRETE_PROTECTED_INPUT_INVALID/u,
  );
  assert.equal(
    (await deployment.state.claimAuthority({ authority: inner })).authority_id,
    innerAuthorityId,
  );
  const journalBeforeAdoption = readFileSync(configuration.journalPath, "utf8");
  const adoptedOperationId = COMBINED_PRECOMPLETED_OPERATION_IDS[0];
  const adoptedStart = await deployment.state.beginNormalOperation({
    authorityId: innerAuthorityId,
    operationId: adoptedOperationId,
    redispatchAllowed: false,
  });
  assert.equal(adoptedStart.status, "STARTED");
  const adoptedComplete = await deployment.state.completeNormalOperation({
    authorityId: innerAuthorityId,
    operationId: adoptedOperationId,
    result: priorResults[adoptedOperationId],
  });
  assert.equal(adoptedComplete.status, "COMPLETED");
  assert.equal(readFileSync(configuration.journalPath, "utf8"), journalBeforeAdoption);
  const imported = await deployment.operations["import-v209-qualified-activation"]({
    authority: inner,
    operation: {},
    priorResults: [
      [
        "readback-qualified-production",
        {
          config_sha256: value.production.config_sha256,
          deployment_id_sha256: hash("cloudflare-deployment"),
        },
      ],
    ],
  });
  assert.equal(imported.import_count, 1);
  const cleaned = await deployment.cleanupDeploymentSuffix({ authority: inner });
  const resumedCleanup = JSON.parse(
    childCalls.find(({ options }) =>
      options?.input?.includes('"command":"DELETE_ATTRIBUTABLE_PAIR"'),
    ).options.input,
  );
  assert.notEqual(inner.authority_id, value.authority_id);
  assert.equal(resumedCleanup.authority_id, value.authority_id);
  assert.deepEqual(
    resumedCleanup.deployments.map(({ resourceKey, lane }) => ({ resourceKey, lane })),
    ["mage", "soulx"].map((lane) => ({
      lane,
      resourceKey: `${value.authority_id}-${lane}-production`,
    })),
  );
  assert.throws(
    () =>
      createConcreteQualifiedProductionDeploymentAdapters(configuration, {
        ports: portSet(),
        runChild: childRunner(),
        rehydration: {
          combinedExecution,
          executionAuthority: inner,
          journalAuthorityId: "v2-09-foreign-authority",
          priorResults,
        },
      }),
    /V2_09_CONCRETE_REHYDRATION_INVALID/u,
  );
  assert.equal(cleaned.cloudflare_disabled, true);
  assert.equal(cleaned.database_deactivated, true);
  assert.equal(cleaned.endpoint_count, 0);

  const untouchedPorts = portSet();
  untouchedPorts.reconcileCloudflareSafety = {
    ...untouchedPorts.reconcileCloudflareSafety,
    run: async () => ({
      safety_verified: true,
      gpu_transport: "UNTOUCHED_NO_MUTATIONS",
      secret_count: null,
    }),
  };
  const untouched = createConcreteQualifiedProductionDeploymentAdapters(configuration, {
    ports: untouchedPorts,
    runChild: childRunner(),
    rehydration: {
      combinedExecution,
      executionAuthority: inner,
      journalAuthorityId: value.authority_id,
      priorResults,
    },
  });
  const journalWithCloudflare = readFileSync(configuration.journalPath, "utf8");
  await assert.rejects(
    untouched.cleanupDeploymentSuffix({ authority: inner }),
    /V2_09_DEPLOYMENT_SUFFIX_CLEANUP_INCOMPLETE/u,
  );
  const noCloudflareJournal = JSON.parse(journalWithCloudflare);
  for (const id of [
    "deploy-cloudflare-disabled-bootstrap",
    "upload-cloudflare-production-secrets",
    "deploy-cloudflare-qualified-production",
    "readback-qualified-production",
    "import-v209-qualified-activation",
  ])
    delete noCloudflareJournal.normal[id];
  writeFileSync(configuration.journalPath, `${canonical(noCloudflareJournal)}\n`);
  const untouchedCleanup = await untouched.cleanupDeploymentSuffix({ authority: inner });
  assert.equal(untouchedCleanup.cloudflare_disabled, false);
  assert.equal(untouchedCleanup.cloudflare_untouched, true);
  assert.equal(untouchedCleanup.database_deactivated, true);
  const preIntentBootstrap = structuredClone(noCloudflareJournal);
  preIntentBootstrap.normal["deploy-cloudflare-disabled-bootstrap"] = { status: "STARTED" };
  writeFileSync(configuration.journalPath, `${canonical(preIntentBootstrap)}\n`);
  const preIntentCleanup = await untouched.cleanupDeploymentSuffix({ authority: inner });
  assert.equal(preIntentCleanup.cloudflare_untouched, true);
  assert.equal(preIntentCleanup.cloudflare_disabled, false);
  assert.equal(preIntentCleanup.database_deactivated, true);
  for (const bootstrap of [
    { status: "COMPLETED", result_sha256: hash("completed-bootstrap") },
    { status: "UNKNOWN" },
    { status: "STARTED", result_sha256: hash("unexpected-receipt") },
  ]) {
    const rejected = structuredClone(preIntentBootstrap);
    rejected.normal["deploy-cloudflare-disabled-bootstrap"] = bootstrap;
    writeFileSync(configuration.journalPath, `${canonical(rejected)}\n`);
    await assert.rejects(
      untouched.cleanupDeploymentSuffix({ authority: inner }),
      /V2_09_DEPLOYMENT_SUFFIX_CLEANUP_INCOMPLETE/u,
    );
  }
  for (const id of [
    "upload-cloudflare-production-secrets",
    "deploy-cloudflare-qualified-production",
    "readback-qualified-production",
    "import-v209-qualified-activation",
  ]) {
    const rejected = structuredClone(preIntentBootstrap);
    rejected.normal[id] = { status: "STARTED" };
    writeFileSync(configuration.journalPath, `${canonical(rejected)}\n`);
    await assert.rejects(
      untouched.cleanupDeploymentSuffix({ authority: inner }),
      /V2_09_DEPLOYMENT_SUFFIX_CLEANUP_INCOMPLETE/u,
    );
  }
  writeFileSync(configuration.journalPath, journalWithCloudflare);

  const exhaustiveCalls = [];
  const failingPorts = portSet();
  failingPorts.reconcileCloudflareSafety = {
    ...failingPorts.reconcileCloudflareSafety,
    run: async () => {
      throw new Error("simulated cloudflare outage");
    },
  };
  const exhaustive = createConcreteQualifiedProductionDeploymentAdapters(configuration, {
    ports: failingPorts,
    runChild: childRunner(exhaustiveCalls),
    rehydration: {
      combinedExecution,
      executionAuthority: inner,
      journalAuthorityId: value.authority_id,
      priorResults,
    },
  });
  await assert.rejects(
    exhaustive.cleanupDeploymentSuffix({ authority: inner }),
    /V2_09_DEPLOYMENT_SUFFIX_CLEANUP_INCOMPLETE/u,
  );
  assert.equal(
    exhaustiveCalls.some(({ args = [] }) =>
      args.some((entry) => String(entry).endsWith("neon-deactivate-v209-production.sql")),
    ),
    true,
  );
  assert.equal(
    exhaustiveCalls.some(({ options }) =>
      options?.input?.includes('"command":"DELETE_ATTRIBUTABLE_PAIR"'),
    ),
    true,
  );

  const proofInput = {
    configuration,
    executionAuthority: inner,
    journalAuthorityId: value.authority_id,
    combinedExecution,
    priorResults,
  };
  assert.equal(hasV209InnerFailedClean(proofInput), false);
  assert.equal(readV209InnerSucceededClean(proofInput), null);
  await deployment.state.loadCleanupAuthority({ authority: inner });
  for (const operation of CLEANUP_OPERATIONS.slice(0, 2)) {
    await deployment.state.recordCleanupOperation({
      authorityId: inner.authority_id,
      operationId: operation.id,
      outcome: "SUCCESS",
      result: { operation_id: operation.id },
    });
  }
  for (const operation of CLEANUP_OPERATIONS) {
    await deployment.state.recordCleanupOperation({
      authorityId: inner.authority_id,
      operationId: operation.id,
      outcome: "FAILURE",
      result: { operation_id: operation.id },
    });
  }
  await deployment.state.completeCleanup({ authorityId: inner.authority_id });
  assert.equal(hasV209InnerFailedClean(proofInput), true);
  const tampered = JSON.parse(readFileSync(configuration.journalPath, "utf8"));
  tampered.cleanup.at(-1).outcome = "SUCCESS";
  writeFileSync(configuration.journalPath, `${canonical(tampered)}\n`, { mode: 0o600 });
  assert.throws(() => hasV209InnerFailedClean(proofInput), /V2_09_INNER_CLEANUP_PROOF_INVALID/u);

  const succeeded = structuredClone(tampered);
  succeeded.status = "SUCCEEDED_CLEAN";
  succeeded.normal["run-one-v209-chrome-e2e"] = {
    status: "COMPLETED",
    result_sha256: hash("chrome-result"),
  };
  succeeded.normal["verify-private-mp4-lineage"] = {
    status: "COMPLETED",
    result_sha256: hash("lineage-result"),
  };
  succeeded.cleanup = CLEANUP_OPERATIONS.map((operation) => ({
    operation_id: operation.id,
    outcome: "SUCCESS",
    result_sha256: hash(`success-${operation.id}`),
  }));
  writeFileSync(configuration.journalPath, `${canonical(succeeded)}\n`, { mode: 0o600 });
  assert.deepEqual(readV209InnerSucceededClean(proofInput), {
    schema_version: "videoforge.v2-09-qualified-production-execution/v1",
    authority_id: inner.authority_id,
    status: "SUCCEEDED_CLEAN",
    operations: [...OPERATION_IDS],
    paid_dispatch_count: 1,
    redispatch_count: 0,
  });
  delete succeeded.normal["verify-private-mp4-lineage"];
  writeFileSync(configuration.journalPath, `${canonical(succeeded)}\n`, { mode: 0o600 });
  assert.throws(
    () => readV209InnerSucceededClean(proofInput),
    /V2_09_INNER_SUCCESS_PROOF_INVALID/u,
  );
});

test("interactive Chrome pause and resume preserve the unstarted Generate operation", async () => {
  const { configuration } = fixture();
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(),
  });
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });
  for (const operationId of [
    "deploy-cloudflare-disabled-bootstrap",
    "upload-cloudflare-production-secrets",
    "deploy-cloudflare-qualified-production",
    "readback-qualified-production",
    "install-media-worker-0.1.15",
    "import-v209-qualified-activation",
  ]) {
    await adapters.state.beginNormalOperation({
      authorityId: value.authority_id,
      operationId,
      redispatchAllowed: false,
    });
    await adapters.state.completeNormalOperation({
      authorityId: value.authority_id,
      operationId,
      result: { operation_id: operationId },
    });
  }
  assert.equal(
    (await adapters.state.pauseInteractiveChromeLogin({ authorityId: value.authority_id })).status,
    "AWAITING_INTERACTIVE_CHROME_LOGIN",
  );
  let journal = JSON.parse(readFileSync(configuration.journalPath));
  assert.equal(journal.normal["run-one-v209-chrome-e2e"], undefined);
  assert.equal(
    (await adapters.state.resumeInteractiveChromeLogin({ authorityId: value.authority_id })).status,
    "CLAIMED",
  );
  journal = JSON.parse(readFileSync(configuration.journalPath));
  assert.equal(journal.normal["run-one-v209-chrome-e2e"], undefined);
});

test("fsynced mode-0600 journal consumes once, forbids normal replay, and permits cleanup-only", async () => {
  const { configuration } = fixture();
  const ports = portSet();
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports,
    runChild: childRunner(),
  });
  const value = authority(adapters.identity_sha256);
  assert.equal((await adapters.state.claimAuthority({ authority: value })).consumed_once, true);
  assert.equal(lstatSync(configuration.journalPath).mode & 0o777, 0o600);
  const started = await adapters.state.beginNormalOperation({
    authorityId: value.authority_id,
    operationId: "push-clean-source",
    redispatchAllowed: false,
  });
  assert.equal(started.first_start, true);
  await assert.rejects(
    adapters.state.beginNormalOperation({
      authorityId: value.authority_id,
      operationId: "push-clean-source",
      redispatchAllowed: false,
    }),
    /V2_09_CONCRETE_NORMAL_REENTRY_FORBIDDEN/u,
  );
  await adapters.state.completeNormalOperation({
    authorityId: value.authority_id,
    operationId: "push-clean-source",
    result: { operation_id: "push-clean-source" },
  });
  await adapters.state.enterCleanupOnly({ authorityId: value.authority_id });
  await adapters.state.loadCleanupAuthority({ authority: value });
  await adapters.state.recordCleanupOperation({
    authorityId: value.authority_id,
    operationId: "read-settled-billing",
    outcome: "FAILURE",
    result: { operation_id: "read-settled-billing" },
  });
  await adapters.state.completeCleanup({ authorityId: value.authority_id });
  assert.equal(JSON.parse(readFileSync(configuration.journalPath)).status, "FAILED_CLEAN");
  await assert.rejects(
    adapters.state.claimAuthority({ authority: value }),
    /V2_09_CONCRETE_AUTHORITY_ALREADY_CONSUMED/u,
  );
});

test("cleanup-only atomically recovers a crashed claimed authority without normal replay", async () => {
  const { configuration } = fixture();
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(),
  });
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });
  await adapters.state.beginNormalOperation({
    authorityId: value.authority_id,
    operationId: "push-clean-source",
    redispatchAllowed: false,
  });

  assert.deepEqual(await adapters.state.loadCleanupAuthority({ authority: value }), {
    authority_id: value.authority_id,
    status: "CLEANUP_ONLY",
  });
  assert.equal(JSON.parse(readFileSync(configuration.journalPath)).status, "CLEANUP_ONLY");
  assert.deepEqual(await adapters.state.loadCleanupAuthority({ authority: value }), {
    authority_id: value.authority_id,
    status: "CLEANUP_ONLY",
  });
  await assert.rejects(
    adapters.state.beginNormalOperation({
      authorityId: value.authority_id,
      operationId: "readback-clean-source",
      redispatchAllowed: false,
    }),
    /V2_09_CONCRETE_NORMAL_REENTRY_FORBIDDEN/u,
  );
});

test("source push/readback and database commands are closed, exact child invocations", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls),
  });
  const value = authority(adapters.identity_sha256);
  await adapters.operations["push-clean-source"]({ authority: value });
  await adapters.operations["readback-clean-source"]({ authority: value });
  const migration = await adapters.operations["apply-migrations-0074-0086"]({ operation: {} });
  const grants = await adapters.operations["apply-v209-grants"]({});
  assert.equal(migration.mode, "APPLIED_0074_0086");
  assert.equal(grants.migration_head, 86);
  assert.deepEqual(
    childCalls.find(({ command, args }) => command === "git" && args[0] === "push")?.args,
    ["push", "--porcelain", "origin", `${SOURCE}:${PUSH_REF}`],
  );
  assert.deepEqual(
    childCalls.find(({ command, args }) => command === "git" && args[0] === "ls-remote")?.args,
    ["ls-remote", "--heads", "origin", PUSH_REF],
  );
  assert.equal(childCalls.filter(({ command }) => command === "psql").length, 4);
  const migrationCall = childCalls.find(
    ({ command, options }) =>
      command === "psql" && options?.input?.includes("videoforge.v2-09-migration-result/v1"),
  );
  assert.ok(migrationCall);
  assert.match(migrationCall.options.input, /0084_hosted_v209_staged_click_cleanup/u);
  assert.match(migrationCall.options.input, /0085_hosted_v209_completion_baseline/u);
  assert.match(migrationCall.options.input, /0086_hosted_unlimited_project_cost/u);
  assert.doesNotMatch(migrationCall.options.input, /neon-runtime-grants|v213_/u);
  assert.equal(
    childCalls.some(({ args }) => args.some((arg) => /v2-1[0-3]/u.test(arg))),
    false,
  );
});

test("fresh admission and config rendering translate only existing bounded V2-09 helpers", async () => {
  const { configuration } = fixture();
  const instants = [new Date("2026-09-06T11:59:00Z"), new Date("2026-09-06T11:59:01Z")];
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(),
    now: () => instants.shift(),
    readRunPod: async () => ({
      billing: { cumulativeEndpointBillingUsd: 3.5 },
      inventory: { retainedVolumes: [{}, {}] },
      offering: {
        catalogSha256: hash("catalog"),
        gpu: "NVIDIA GeForce RTX 4090",
        region: "EU-RO-1",
        availability: "LOW",
        serverlessFlexRateUsdPerGpuHour: 1.116,
      },
    }),
  });
  const value = authority(adapters.identity_sha256);
  const admission = await adapters.operations["fresh-read-only-admission"]({ authority: value });
  assert.equal(admission.operation_id, "fresh-read-only-admission");
  assert.equal(admission.billing_baseline_usd, 3.5);
  assert.equal(admission.zero_compute, true);
  assert.equal(admission.retained_volume_count, 2);
  const rendered = await adapters.operations["render-qualified-production-config"]({
    authority: value,
  });
  assert.equal(rendered.config_sha256, value.production.config_sha256);
  assert.equal(rendered.worker_bundle_sha256, value.production.worker_bundle_sha256);
});

test("config rendering binds static authority to observed hashes and supports staged observation", async () => {
  const { configuration } = fixture();
  const valueFor = (adapters) => authority(adapters.identity_sha256);
  const staticAdapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(),
  });
  const staticAuthority = valueFor(staticAdapters);
  staticAuthority.production.worker_bundle_sha256 = hash("wrong-worker-bundle");
  await assert.rejects(
    staticAdapters.operations["render-qualified-production-config"]({
      authority: staticAuthority,
    }),
    /V2_09_CONCRETE_RENDER_CONFIG_DRIFT/u,
  );

  const stagedFixture = fixture();
  const stagedTemplate = JSON.parse(
    readFileSync(stagedFixture.configuration.qualifiedBindingFile, "utf8"),
  );
  stagedTemplate.lanes.mage_image.endpoint_id_sha256 = "__V2_09_OBSERVED_MAGE_ENDPOINT__";
  stagedTemplate.lanes.soulx_avatar.endpoint_id_sha256 = "__V2_09_OBSERVED_SOULX_ENDPOINT__";
  writeFileSync(stagedFixture.configuration.qualifiedBindingFile, JSON.stringify(stagedTemplate), {
    mode: 0o600,
  });
  const stagedChildCalls = [];
  const stagedAdapters = createConcreteQualifiedProductionAdapters(stagedFixture.configuration, {
    ports: portSet(),
    runChild: childRunner(stagedChildCalls),
  });
  const stagedAuthority = valueFor(stagedAdapters);
  stagedAuthority.execution = "V2_09_PREFLIGHT_THEN_QUALIFIED_PRODUCTION_ONCE";
  delete stagedAuthority.production.config_sha256;
  delete stagedAuthority.production.worker_bundle_sha256;
  const staged = await stagedAdapters.operations["render-qualified-production-config"]({
    authority: stagedAuthority,
    priorResults: stagedPriorResults(),
    receiptBindingMode: "STAGED_OBSERVED",
  });
  assert.equal(staged.config_sha256, `sha256:${"8".repeat(64)}`);
  assert.equal(staged.worker_bundle_sha256, `sha256:${"9".repeat(64)}`);
  const renderCall = stagedChildCalls.find(({ args }) =>
    args.some((value) => String(value).endsWith("render-qualified-production-config.mjs")),
  );
  const observedBinding = JSON.parse(
    readFileSync(renderCall.args[renderCall.args.indexOf("--binding") + 1], "utf8"),
  );
  assert.equal(observedBinding.lanes.mage_image.endpoint_id_sha256, hash("mage-observed-endpoint"));
  assert.equal(
    observedBinding.lanes.soulx_avatar.endpoint_id_sha256,
    hash("soulx-observed-endpoint"),
  );
  assert.equal(observedBinding.release.media_worker_release_manifest_sha256, hash("{}"));
  assert.equal(observedBinding.release.source_commit, SOURCE);
  assert.equal(observedBinding.production.worker_name, "videoforge-production-runtime");
  const inconsistentPriorResults = stagedPriorResults();
  inconsistentPriorResults[2][1].deployments[0].endpoint_id_sha256 = hash("tampered-endpoint");
  await assert.rejects(
    stagedAdapters.operations["render-qualified-production-config"]({
      authority: stagedAuthority,
      priorResults: inconsistentPriorResults,
      receiptBindingMode: "STAGED_OBSERVED",
    }),
    /V2_09_CONCRETE_STAGED_BINDING_INPUT_INVALID/u,
  );
  await assert.rejects(
    stagedAdapters.operations["render-qualified-production-config"]({
      authority: stagedAuthority,
      priorResults: stagedPriorResults(),
      receiptBindingMode: "UNBOUNDED",
    }),
    /V2_09_CONCRETE_RENDER_CONFIG_BINDING_MODE_INVALID/u,
  );

  const invalidFixture = fixture();
  const invalidAdapters = createConcreteQualifiedProductionAdapters(invalidFixture.configuration, {
    ports: portSet(),
    runChild: childRunner([], { renderedWorkerBundleSha256: "not-a-hash" }),
  });
  const invalidAuthority = valueFor(invalidAdapters);
  invalidAuthority.execution = "V2_09_PREFLIGHT_THEN_QUALIFIED_PRODUCTION_ONCE";
  await assert.rejects(
    invalidAdapters.operations["render-qualified-production-config"]({
      authority: invalidAuthority,
      priorResults: stagedPriorResults(),
      receiptBindingMode: "STAGED_OBSERVED",
    }),
    /V2_09_CONCRETE_RENDER_CONFIG_DRIFT/u,
  );
});

test("persists and imports the exact created pair through protected database roles", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  const portCalls = [];
  const ports = portSet(portCalls);
  const readActivated = ports.readbackCloudflareQualified.run;
  let activatedOverride = {};
  ports.readbackCloudflareQualified.run = async (context) => {
    assert.ok(
      childCalls.some(({ args }) =>
        args.some((arg) => String(arg).endsWith("neon-import-qualified-activation.sql")),
      ),
    );
    return { ...(await readActivated(context)), ...activatedOverride };
  };
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports,
    runChild: childRunner(childCalls),
    now: () => new Date("2026-09-06T12:00:00Z"),
  });
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });
  const priorResults = [];
  for (const lane of ["mage", "soulx"]) {
    const operationId = `create-${lane}-production-lane-max-one`;
    const result = await adapters.operations[operationId]({
      authority: value,
      operation: {},
      priorResults,
    });
    priorResults.push([operationId, result]);
  }
  const persisted = await adapters.operations["persist-qualified-production-deployments"]({
    authority: value,
    operation: {},
    priorResults,
  });
  priorResults.push(["persist-qualified-production-deployments", persisted]);
  assert.equal(persisted.persisted_deployment_count, 2);
  assert.deepEqual(
    persisted.deployments.map(({ lane }) => lane),
    ["mage", "soulx"],
  );
  priorResults.push([
    "readback-qualified-production",
    {
      operation_id: "readback-qualified-production",
      config_sha256: value.production.config_sha256,
      deployment_id_sha256: hash("cloudflare-deployment"),
    },
  ]);
  const imported = await adapters.operations["import-v209-qualified-activation"]({
    authority: value,
    operation: {},
    priorResults,
  });
  assert.equal(imported.import_count, 1);
  assert.equal(imported.qualified_activation_active, true);
  assert.equal(imported.effective_gpu_transport, "QUALIFIED_EXACT");
  assert.equal(portCalls.at(-1).context.activationImported, true);
  assert.deepEqual(
    imported.deployment_row_id_sha256s,
    persisted.deployments.map(({ deployment_row_id_sha256 }) => deployment_row_id_sha256),
  );
  const databaseCalls = childCalls.filter(
    ({ command, args }) =>
      command === "psql" && args.some((arg) => /neon-(persist|import)-qualified/u.test(arg)),
  );
  assert.equal(databaseCalls.length, 2);
  assert.equal(
    databaseCalls.every(({ args }) => args.every((arg) => !arg.includes("secret"))),
    true,
  );
  assert.equal(databaseCalls[0].options.env.PGUSER, "owner");
  assert.equal(databaseCalls[1].options.env.PGUSER, "videoforge_operator");
  for (const drift of [
    { effective_gpu_transport: "DISABLED_UNQUALIFIED" },
    { deployment_id_sha256: hash("different-version") },
    { config_sha256: hash("different-config") },
    { worker_bundle_sha256: hash("different-bundle") },
  ]) {
    activatedOverride = drift;
    await assert.rejects(
      adapters.operations["import-v209-qualified-activation"]({
        authority: value,
        operation: {},
        priorResults,
      }),
      /V2_09_CONCRETE_ACTIVATION_ROUTE_INVALID/u,
    );
  }
});

test("runs one source-bound Chrome click and verifies its preserved private MP4", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  const baseRunner = childRunner(childCalls);
  let ffprobeUsedSealedBytes = false;
  let chromeTimeoutMs = null;
  const runChild = async (input) => {
    if (input.args.some((value) => String(value).endsWith("v209-real-chrome-bridge.ts")))
      chromeTimeoutMs = input.timeoutMs;
    if (input.command === "ffprobe") {
      writeFileSync(
        JSON.parse(readFileSync(configuration.chromeRequestFile, "utf8")).verifiedOutputPath,
        "substituted-after-hash",
        { mode: 0o600 },
      );
      ffprobeUsedSealedBytes =
        input.args.at(-1) === "pipe:0" &&
        Buffer.isBuffer(input.options.input) &&
        input.options.input.equals(Buffer.from("fixture-private-mp4-bytes"));
    }
    return baseRunner(input);
  };
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild,
    now: () => new Date("2026-09-06T12:00:00Z"),
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4.25 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  value.production.chrome_request_sha256 = hash(readFileSync(configuration.chromeRequestFile));
  value.production.chrome_auth_state_sha256 = hash(readFileSync(configuration.chromeAuthStateFile));
  await adapters.state.claimAuthority({ authority: value });
  for (const lane of ["mage", "soulx"])
    await adapters.operations[`create-${lane}-production-lane-max-one`]({
      authority: value,
      operation: {},
      priorResults: [],
    });
  const chrome = await adapters.operations["run-one-v209-chrome-e2e"]({
    authority: value,
    operation: {},
  });
  assert.equal(chrome.submission_count, 1);
  assert.equal(chrome.redispatch_count, 0);
  assert.equal(chrome.completion_total_usd, 4.5);
  assert.equal(chrome.generic_project_revision_net_cost_usd, 0.5);
  assert.equal(chromeTimeoutMs, 1_800_000);
  const costReadbackCall = childCalls.find(({ args }) =>
    args.some((value) => String(value).endsWith("neon-read-v209-e2e-cost.sql")),
  );
  assert.equal(costReadbackCall.options.env.PGUSER, "videoforge_reconciler");
  const lineage = await adapters.operations["verify-private-mp4-lineage"]({
    authority: value,
    operation: {},
  });
  assert.equal(lineage.mp4_sha256, chrome.mp4_sha256);
  assert.equal(lineage.ffprobe_verified, true);
  assert.equal(lineage.duration_seconds, 45);
  assert.equal(ffprobeUsedSealedBytes, true);
});

test("failure after project creation reconciles only the fsynced staged identity before endpoint deletion", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls, { chromeFailureStage: "PROJECT_CREATED", noAttempts: true }),
    now: () => new Date("2026-09-06T12:00:00Z"),
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  value.production.chrome_request_sha256 = hash(readFileSync(configuration.chromeRequestFile));
  value.production.chrome_auth_state_sha256 = hash(readFileSync(configuration.chromeAuthStateFile));
  await adapters.state.claimAuthority({ authority: value });
  await assert.rejects(
    adapters.operations["run-one-v209-chrome-e2e"]({ authority: value, operation: {} }),
    /REAL_CHROME_E2E/u,
  );
  const result = await adapters.operations["reconcile-attributable-runpod-work"]({
    authority: value,
    cleanupOnly: true,
    operation: { id: "reconcile-attributable-runpod-work" },
    operationId: "reconcile-attributable-runpod-work",
    outcome: "FAILURE",
    failureOperationId: "run-one-v209-chrome-e2e",
    priorResults: [],
  });
  assert.equal(result.production_pair_retained, false);
  const stagedIndex = childCalls.findIndex(({ args }) =>
    args.some((value) => String(value).endsWith("neon-reconcile-v209-staged-click.sql")),
  );
  const deleteIndex = childCalls.findIndex(({ options }) =>
    options?.input?.includes("DELETE_ATTRIBUTABLE_PAIR"),
  );
  assert.ok(stagedIndex >= 0 && deleteIndex > stagedIndex);
  const stagedPayload = JSON.parse(
    Buffer.from(
      childCalls[stagedIndex].args
        .find((value) => String(value).startsWith("payload_base64="))
        .slice("payload_base64=".length),
      "base64",
    ),
  );
  assert.equal(stagedPayload.stage, "PROJECT_CREATED");
  assert.equal(stagedPayload.projectId, "44444444-4444-4444-8444-444444444444");
  assert.equal(stagedPayload.generationRequestId, null);
  assert.equal(childCalls[stagedIndex].options.env.PGUSER, "videoforge_reconciler");
  assert.equal(
    childCalls.some(({ args }) =>
      args.some((value) => String(value).endsWith("neon-reconcile-v209-unassigned-attempts.sql")),
    ),
    false,
  );
  const billing = await adapters.operations["read-settled-billing"]({
    authority: value,
    operation: { id: "read-settled-billing" },
    outcome: "FAILURE",
    priorResults: [],
  });
  assert.equal(billing.generic_project_revision_net_cost_usd, 0.5);
  assert.equal(billing.completion_total_usd, 4.5);
});

test("generation-stage failure settles provider facts before the exact failed project archive", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls, { chromeFailureStage: "GENERATION_CREATED" }),
    now: () => new Date("2026-09-06T12:00:00Z"),
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  value.production.chrome_request_sha256 = hash(readFileSync(configuration.chromeRequestFile));
  value.production.chrome_auth_state_sha256 = hash(readFileSync(configuration.chromeAuthStateFile));
  await adapters.state.claimAuthority({ authority: value });
  await assert.rejects(
    adapters.operations["run-one-v209-chrome-e2e"]({ authority: value, operation: {} }),
    /REAL_CHROME_E2E/u,
  );
  await adapters.operations["reconcile-attributable-runpod-work"]({
    authority: value,
    cleanupOnly: true,
    operation: { id: "reconcile-attributable-runpod-work" },
    operationId: "reconcile-attributable-runpod-work",
    outcome: "FAILURE",
    failureOperationId: "run-one-v209-chrome-e2e",
    priorResults: [],
  });
  const stagedCalls = childCalls.filter(({ args }) =>
    args.some((value) => String(value).endsWith("neon-reconcile-v209-staged-click.sql")),
  );
  assert.equal(stagedCalls.length, 2);
  for (const call of stagedCalls) {
    const encoded = call.args.find((value) => String(value).startsWith("payload_base64="));
    const payload = JSON.parse(Buffer.from(encoded.slice("payload_base64=".length), "base64"));
    assert.equal(payload.stage, "GENERATION_CREATED");
    assert.equal(payload.generationRequestId, "33333333-3333-4333-8333-333333333333");
  }
  const settlementIndex = childCalls.findIndex(({ args }) =>
    args.some((value) => String(value).endsWith("neon-settle-v209-terminal-pair.sql")),
  );
  const secondStagedIndex = childCalls.indexOf(stagedCalls[1]);
  const deleteIndex = childCalls.findIndex(({ options }) =>
    options?.input?.includes("DELETE_ATTRIBUTABLE_PAIR"),
  );
  assert.ok(
    settlementIndex >= 0 && settlementIndex < secondStagedIndex && secondStagedIndex < deleteIndex,
  );
});

test("success cleanup uses concrete reconcile, zero-read, billing, and retained-volume operations", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  let clock = new Date("2026-09-06T12:00:00Z");
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls, {
      successfulDatabaseSettled: true,
      successCostsInitiallySettled: false,
    }),
    sleep: async () => {},
    now: () => clock,
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  value.production.chrome_request_sha256 = hash(readFileSync(configuration.chromeRequestFile));
  value.production.chrome_auth_state_sha256 = hash(readFileSync(configuration.chromeAuthStateFile));
  await adapters.state.claimAuthority({ authority: value });
  const priorResults = [];
  for (const lane of ["mage", "soulx"]) {
    const operationId = `create-${lane}-production-lane-max-one`;
    const result = await adapters.operations[operationId]({
      authority: value,
      operation: {},
      priorResults,
    });
    priorResults.push([operationId, result]);
  }
  const chrome = await adapters.operations["run-one-v209-chrome-e2e"]({
    authority: value,
    operation: {},
  });
  priorResults.push(["run-one-v209-chrome-e2e", chrome]);
  clock = new Date("2026-09-06T12:30:05Z");
  const context = (operationId) => ({
    authority: value,
    cleanupOnly: true,
    operation: { id: operationId },
    operationId,
    outcome: "SUCCESS",
    failureOperationId: null,
    priorResults,
  });
  const safety = await adapters.operations["reconcile-v209-production-safety"](
    context("reconcile-v209-production-safety"),
  );
  assert.equal(safety.admission_state, "ACTIVE_QUALIFIED");
  const reconciled = await adapters.operations["reconcile-attributable-runpod-work"](
    context("reconcile-attributable-runpod-work"),
  );
  assert.equal(reconciled.production_pair_retained, true);
  const inventoryIndex = childCalls.findIndex(
    ({ args, options }) =>
      args.some((value) => String(value).endsWith("v209-runpod-production-bridge.ts")) &&
      options?.input?.includes("READ_INVENTORY"),
  );
  const costIndex = childCalls.findIndex(({ args }) =>
    args.some((value) => String(value).endsWith("neon-settle-v209-success-costs.sql")),
  );
  const postCostReadIndex = childCalls.findIndex(
    ({ args }, index) =>
      index > costIndex &&
      args.some((value) => String(value).endsWith("neon-read-v209-cleanup-state.sql")),
  );
  assert.ok(inventoryIndex >= 0 && costIndex > inventoryIndex && postCostReadIndex > costIndex);
  assert.equal(childCalls[costIndex].options.env.PGUSER, "videoforge_reconciler");
  assert.equal(childCalls[postCostReadIndex].options.env.PGUSER, "owner");
  assert.equal(
    (await adapters.operations["clean-v209-transient-r2"](context("clean-v209-transient-r2")))
      .transient_keys_absent,
    true,
  );
  const zero = await adapters.operations["prove-three-zero-compute-reads"](
    context("prove-three-zero-compute-reads"),
  );
  assert.equal(zero.zero_compute_read_count, 3);
  assert.equal(Date.parse(zero.reads[1].observed_at) - Date.parse(zero.reads[0].observed_at), 1000);
  const billing = await adapters.operations["read-settled-billing"](
    context("read-settled-billing"),
  );
  assert.deepEqual(
    billing.terminal_jobs.map(({ status }) => status),
    ["COMPLETED", "COMPLETED"],
  );
  assert.equal(billing.cost_itemization.total_usd, 0.00062);
  assert.equal(billing.generic_project_revision_net_cost_usd, 0.5);
  assert.equal(billing.completion_total_usd, 4.50062);
  const retained = await adapters.operations["verify-retained-resources"](
    context("verify-retained-resources"),
  );
  assert.equal(retained.retained_volume_count, 2);
  assert.equal(retained.production_pair_retained, true);
});

test("success billing refuses nonterminal database truth before any provider billing read", async () => {
  const { configuration } = fixture();
  let billingReads = 0;
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(),
    now: () => new Date("2026-09-06T12:30:05Z"),
    fetchImpl: async () => {
      billingReads += 1;
      return new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  const value = authority(adapters.identity_sha256);

  await assert.rejects(
    adapters.operations["read-settled-billing"]({
      authority: value,
      cleanupOnly: true,
      operation: { id: "read-settled-billing" },
      operationId: "read-settled-billing",
      outcome: "SUCCESS",
      priorResults: [
        [
          "run-one-v209-chrome-e2e",
          {
            schema_version: "videoforge.v2-09-one-chrome-e2e-result/v1",
            operation_id: "run-one-v209-chrome-e2e",
            browser_evidence_sha256: hash("browser-evidence"),
            generation_request_sha256: hash("33333333-3333-4333-8333-333333333333"),
            completion_total_usd: 4.5,
          },
        ],
      ],
    }),
    /V2_09_CONCRETE_SUCCESS_SETTLEMENT_NOT_DURABLE/u,
  );
  assert.equal(billingReads, 0);
});

test("failure cleanup disables Cloudflare and DB then deletes only attributable RunPod resources", async () => {
  const { configuration } = fixture();
  const portCalls = [];
  const childCalls = [];
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(portCalls),
    runChild: childRunner(childCalls),
    now: () => new Date("2026-09-06T12:30:05Z"),
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });
  const context = (operationId) => ({
    authority: value,
    cleanupOnly: true,
    operation: { id: operationId },
    operationId,
    outcome: "FAILURE",
    failureOperationId: "run-one-v209-chrome-e2e",
    priorResults: [],
  });
  const safety = await adapters.operations["reconcile-v209-production-safety"](
    context("reconcile-v209-production-safety"),
  );
  assert.equal(safety.admission_state, "DISABLED_CLEAN");
  assert.equal(
    portCalls.some(({ name }) => name === "reconcileCloudflareSafety"),
    true,
  );
  assert.equal(
    childCalls.some(({ args }) =>
      args.some((value) => String(value).endsWith("neon-deactivate-v209-production.sql")),
    ),
    true,
  );
  const reconciled = await adapters.operations["reconcile-attributable-runpod-work"](
    context("reconcile-attributable-runpod-work"),
  );
  assert.equal(reconciled.production_pair_retained, false);
  const terminalBridgeCall = childCalls.find(
    ({ args, options }) =>
      args.some((value) => String(value).endsWith("v209-runpod-production-bridge.ts")) &&
      options?.input?.includes("RECONCILE_TERMINAL_JOBS"),
  );
  const deleteBridgeCall = childCalls.find(
    ({ args, options }) =>
      args.some((value) => String(value).endsWith("v209-runpod-production-bridge.ts")) &&
      options?.input?.includes("DELETE_ATTRIBUTABLE_PAIR"),
  );
  assert.ok(terminalBridgeCall);
  assert.ok(deleteBridgeCall);
  assert.equal(JSON.parse(terminalBridgeCall.options.input).command, "RECONCILE_TERMINAL_JOBS");
  assert.equal(JSON.parse(deleteBridgeCall.options.input).command, "DELETE_ATTRIBUTABLE_PAIR");
  assert.deepEqual(JSON.parse(deleteBridgeCall.options.input).jobs, []);
  const terminalIndex = childCalls.indexOf(terminalBridgeCall);
  const settlementIndex = childCalls.findIndex(({ args }) =>
    args.some((value) => String(value).endsWith("neon-settle-v209-terminal-pair.sql")),
  );
  const deleteIndex = childCalls.indexOf(deleteBridgeCall);
  const postreadIndex = childCalls.findLastIndex(({ args }) =>
    args.some((value) => String(value).endsWith("neon-read-v209-cleanup-state.sql")),
  );
  assert.ok(
    terminalIndex >= 0 &&
      terminalIndex < settlementIndex &&
      settlementIndex < deleteIndex &&
      deleteIndex < postreadIndex,
  );
  const settlementPayload = JSON.parse(
    Buffer.from(
      childCalls[settlementIndex].args
        .find((value) => String(value).startsWith("payload_base64="))
        .slice("payload_base64=".length),
      "base64",
    ),
  );
  assert.equal(settlementPayload.terminalFacts[0].costBasis, "exact_execution");
  assert.equal(settlementPayload.terminalFacts[0].executionTimeMs, 1_000);
  assert.equal(settlementPayload.terminalFacts[0].settledCostUsd, 0.00031);
  assert.equal(
    settlementPayload.terminalFacts[0].rateSource,
    "V2-09_APPROVED_MAX_USD_1.116_GPU_HOUR",
  );
  const terminalCallCount = childCalls.filter(({ options }) =>
    options?.input?.includes("RECONCILE_TERMINAL_JOBS"),
  ).length;
  const settlementCallCount = childCalls.filter(({ args }) =>
    args.some((value) => String(value).endsWith("neon-settle-v209-terminal-pair.sql")),
  ).length;
  await adapters.operations["reconcile-attributable-runpod-work"](
    context("reconcile-attributable-runpod-work"),
  );
  assert.equal(
    childCalls.filter(({ options }) => options?.input?.includes("RECONCILE_TERMINAL_JOBS")).length,
    terminalCallCount,
  );
  assert.equal(
    childCalls.filter(({ args }) =>
      args.some((value) => String(value).endsWith("neon-settle-v209-terminal-pair.sql")),
    ).length,
    settlementCallCount,
  );
});

test("failure cleanup settles a never-sent pair before deleting attributable RunPod resources", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls, { unassigned: true }),
    now: () => new Date("2026-09-06T12:30:05Z"),
  });
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });
  const result = await adapters.operations["reconcile-attributable-runpod-work"]({
    authority: value,
    cleanupOnly: true,
    operation: { id: "reconcile-attributable-runpod-work" },
    operationId: "reconcile-attributable-runpod-work",
    outcome: "FAILURE",
    failureOperationId: "run-one-v209-chrome-e2e",
    priorResults: [],
  });
  assert.equal(result.production_pair_retained, false);
  const terminalIndex = childCalls.findIndex(({ options }) =>
    options?.input?.includes("RECONCILE_TERMINAL_JOBS"),
  );
  const settlementIndex = childCalls.findIndex(({ args }) =>
    args.some((value) => String(value).endsWith("neon-reconcile-v209-unassigned-attempts.sql")),
  );
  const deleteIndex = childCalls.findIndex(({ options }) =>
    options?.input?.includes("DELETE_ATTRIBUTABLE_PAIR"),
  );
  const postreadIndex = childCalls.findLastIndex(({ args }) =>
    args.some((value) => String(value).endsWith("neon-read-v209-cleanup-state.sql")),
  );
  assert.ok(
    terminalIndex >= 0 &&
      terminalIndex < settlementIndex &&
      settlementIndex < deleteIndex &&
      deleteIndex < postreadIndex,
  );
  assert.deepEqual(JSON.parse(childCalls[terminalIndex].options.input).jobs, []);
});

test("cleanup-only resume preserves an already-settled successful pair and deletes endpoints", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  let clock = new Date("2026-09-06T12:00:00Z");
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls, {
      successfulDatabaseSettled: true,
      successCostsInitiallySettled: true,
    }),
    now: () => clock,
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  value.production.chrome_request_sha256 = hash(readFileSync(configuration.chromeRequestFile));
  value.production.chrome_auth_state_sha256 = hash(readFileSync(configuration.chromeAuthStateFile));
  await adapters.state.claimAuthority({ authority: value });
  for (const lane of ["mage", "soulx"])
    await adapters.operations[`create-${lane}-production-lane-max-one`]({
      authority: value,
      operation: {},
      priorResults: [],
    });
  await adapters.operations["run-one-v209-chrome-e2e"]({ authority: value, operation: {} });
  clock = new Date("2026-09-06T12:30:05Z");
  const result = await adapters.operations["reconcile-attributable-runpod-work"]({
    authority: value,
    cleanupOnly: true,
    operation: { id: "reconcile-attributable-runpod-work" },
    operationId: "reconcile-attributable-runpod-work",
    outcome: "FAILURE",
    failureOperationId: "read-settled-billing",
    priorResults: [],
  });
  assert.equal(result.production_pair_retained, false);
  assert.equal(
    childCalls.some(({ options }) => options?.input?.includes("RECONCILE_TERMINAL_JOBS")),
    false,
  );
  assert.equal(
    childCalls.some(({ args }) =>
      args.some((value) => String(value).endsWith("neon-settle-v209-terminal-pair.sql")),
    ),
    false,
  );
  assert.equal(
    childCalls.some(({ options }) => options?.input?.includes("DELETE_ATTRIBUTABLE_PAIR")),
    true,
  );
  const billing = await adapters.operations["read-settled-billing"]({
    authority: value,
    operation: { id: "read-settled-billing" },
    outcome: "FAILURE",
    priorResults: [],
  });
  assert.equal(billing.generic_project_revision_net_cost_usd, 0.5);
  assert.equal(billing.completion_total_usd, 5);
});

test("cleanup-only resume durably settles terminal success costs before deleting endpoints", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  let clock = new Date("2026-09-06T12:00:00Z");
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls, {
      successfulDatabaseSettled: true,
      successCostsInitiallySettled: false,
    }),
    now: () => clock,
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  value.production.chrome_request_sha256 = hash(readFileSync(configuration.chromeRequestFile));
  value.production.chrome_auth_state_sha256 = hash(readFileSync(configuration.chromeAuthStateFile));
  await adapters.state.claimAuthority({ authority: value });
  for (const lane of ["mage", "soulx"])
    await adapters.operations[`create-${lane}-production-lane-max-one`]({
      authority: value,
      operation: {},
      priorResults: [],
    });
  await adapters.operations["run-one-v209-chrome-e2e"]({ authority: value, operation: {} });
  clock = new Date("2026-09-06T12:30:05Z");
  const result = await adapters.operations["reconcile-attributable-runpod-work"]({
    authority: value,
    cleanupOnly: true,
    operation: { id: "reconcile-attributable-runpod-work" },
    operationId: "reconcile-attributable-runpod-work",
    outcome: "FAILURE",
    failureOperationId: "read-settled-billing",
    priorResults: [],
  });
  assert.equal(result.production_pair_retained, false);
  const inventoryIndex = childCalls.findIndex(({ options }) =>
    options?.input?.includes("READ_INVENTORY"),
  );
  const settlementIndex = childCalls.findIndex(({ args }) =>
    args.some((value) => String(value).endsWith("neon-settle-v209-success-costs.sql")),
  );
  const deleteIndex = childCalls.findIndex(({ options }) =>
    options?.input?.includes("DELETE_ATTRIBUTABLE_PAIR"),
  );
  assert.ok(
    inventoryIndex >= 0 && settlementIndex > inventoryIndex && deleteIndex > settlementIndex,
  );
  assert.equal(
    childCalls.some(({ args }) =>
      args.some((value) => String(value).endsWith("neon-settle-v209-terminal-pair.sql")),
    ),
    false,
  );
});

test("never-sent cleanup accepts an exact sealed predispatch rate snapshot", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls, { unassigned: true, unassignedWithRate: true }),
    now: () => new Date("2026-09-06T12:30:05Z"),
  });
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });

  const result = await adapters.operations["reconcile-attributable-runpod-work"]({
    authority: value,
    cleanupOnly: true,
    operation: { id: "reconcile-attributable-runpod-work" },
    operationId: "reconcile-attributable-runpod-work",
    outcome: "FAILURE",
    priorResults: [],
  });

  assert.equal(result.production_pair_retained, false);
  assert.equal(
    childCalls.some(({ args }) =>
      args.some((value) => String(value).endsWith("neon-reconcile-v209-unassigned-attempts.sql")),
    ),
    true,
  );
});

test("assigned cleanup books the sealed reservation ceiling when provider timing is absent", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls, { executionTimeMs: null }),
    now: () => new Date("2026-09-06T12:30:05Z"),
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });
  await adapters.operations["reconcile-attributable-runpod-work"]({
    authority: value,
    cleanupOnly: true,
    operation: { id: "reconcile-attributable-runpod-work" },
    outcome: "FAILURE",
    priorResults: [],
  });
  const settlementCall = childCalls.find(({ args }) =>
    args.some((value) => String(value).endsWith("neon-settle-v209-terminal-pair.sql")),
  );
  const encoded = settlementCall.args.find((value) => String(value).startsWith("payload_base64="));
  const payload = JSON.parse(Buffer.from(encoded.slice("payload_base64=".length), "base64"));
  assert.deepEqual(
    payload.terminalFacts.map(({ costBasis, executionTimeMs, settledCostUsd }) => ({
      costBasis,
      executionTimeMs,
      settledCostUsd,
    })),
    [
      { costBasis: "conservative_reservation", executionTimeMs: null, settledCostUsd: 1 },
      { costBasis: "conservative_reservation", executionTimeMs: null, settledCostUsd: 1 },
    ],
  );
  assert.equal(
    childCalls.some(({ options }) => options?.input?.includes("DELETE_ATTRIBUTABLE_PAIR")),
    true,
  );
});

test("exact execution cost uses decimal micro-USD ceiling at a binary-float boundary", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls, { executionTimeMs: 700 }),
    now: () => new Date("2026-09-06T12:30:05Z"),
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });
  await adapters.operations["reconcile-attributable-runpod-work"]({
    authority: value,
    cleanupOnly: true,
    operation: { id: "reconcile-attributable-runpod-work" },
    outcome: "FAILURE",
    priorResults: [],
  });
  const settlementCall = childCalls.find(({ args }) =>
    args.some((value) => String(value).endsWith("neon-settle-v209-terminal-pair.sql")),
  );
  const encoded = settlementCall.args.find((value) => String(value).startsWith("payload_base64="));
  const payload = JSON.parse(Buffer.from(encoded.slice("payload_base64=".length), "base64"));

  assert.deepEqual(
    payload.terminalFacts.map(({ executionTimeMs, settledCostUsd }) => ({
      executionTimeMs,
      settledCostUsd,
    })),
    [
      { executionTimeMs: 700, settledCostUsd: 0.000217 },
      { executionTimeMs: 700, settledCostUsd: 0.000217 },
    ],
  );
});

test("mixed exact and conservative costs reconcile at integer micro-USD precision", async () => {
  const { configuration } = fixture();
  const childCalls = [];
  let clock = new Date("2026-09-06T12:00:00Z");
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(childCalls, {
      databaseMoneyRounded: true,
      executionTimeMsByLane: { mage: 440, soulx: null },
      ceilingUsdByLane: { soulx: 0.017465 },
      chromeFailureStage: "GENERATION_CREATED",
    }),
    now: () => clock,
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  value.production.chrome_request_sha256 = hash(readFileSync(configuration.chromeRequestFile));
  value.production.chrome_auth_state_sha256 = hash(readFileSync(configuration.chromeAuthStateFile));
  await adapters.state.claimAuthority({ authority: value });
  await assert.rejects(
    adapters.operations["run-one-v209-chrome-e2e"]({ authority: value, operation: {} }),
    /REAL_CHROME_E2E/u,
  );
  clock = new Date("2026-09-06T12:30:05Z");
  const context = (operationId) => ({
    authority: value,
    cleanupOnly: true,
    operation: { id: operationId },
    operationId,
    outcome: "FAILURE",
    priorResults: [],
  });

  await adapters.operations["reconcile-attributable-runpod-work"](
    context("reconcile-attributable-runpod-work"),
  );
  const settlement = await adapters.operations["read-settled-billing"](
    context("read-settled-billing"),
  );

  assert.equal(settlement.exact_itemized_usd, 0.000137);
  assert.equal(settlement.conservative_liability_usd, 0.017465);
  assert.equal(Math.round(settlement.cost_itemization.total_usd * 1_000_000), 17_602);
});

test("protected provider and database inputs cannot redirect after adapter construction", async () => {
  const { configuration } = fixture();
  let readCount = 0;
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner(),
    now: () => new Date("2026-09-06T12:00:00Z"),
    readRunPod: async () => {
      readCount += 1;
      return {};
    },
  });
  const value = authority(adapters.identity_sha256);
  writeFileSync(configuration.runpodApiKeyFile, "changed-runpod-key-never-used", { mode: 0o600 });
  await assert.rejects(
    adapters.operations["fresh-read-only-admission"]({ authority: value }),
    /V2_09_CONCRETE_PROTECTED_INPUT_DRIFT/u,
  );
  assert.equal(readCount, 0);
});

test("Cloudflare secret drift is rejected before any secret or deploy mutation", async () => {
  const { configuration } = fixture();
  const portCalls = [];
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(portCalls),
    runChild: childRunner(),
  });
  const value = authority(adapters.identity_sha256);
  writeFileSync(
    configuration.cloudflare.secretFiles.DATABASE_URL,
    "postgresql://videoforge_runtime:changed@db.example.test:5432/videoforge?sslmode=require",
    { mode: 0o600 },
  );
  await assert.rejects(
    adapters.operations["upload-cloudflare-production-secrets"]({
      authority: value,
      cleanupOnly: false,
      operation: { id: "upload-cloudflare-production-secrets" },
      operationId: "upload-cloudflare-production-secrets",
      outcome: "SUCCESS",
      priorResults: [],
    }),
    /V2_09_CONCRETE_PROTECTED_INPUT_DRIFT/u,
  );
  assert.deepEqual(portCalls, []);
});

test("all database credentials are role-bound to one exact database before any mutation", () => {
  for (const mutate of [
    (configuration) => delete configuration.databaseReconcilerUrlFile,
    (configuration) => {
      configuration.databaseReconcilerUrlFile = configuration.databaseOwnerUrlFile;
    },
    (configuration) => {
      configuration.cloudflare.secretFiles.VIDEOFORGE_RECONCILER_DATABASE_URL =
        configuration.databaseReconcilerUrlFile;
    },
    (configuration) => {
      writeFileSync(
        configuration.cloudflare.secretFiles.VIDEOFORGE_RECONCILER_DATABASE_URL,
        "postgresql://videoforge_reconciler:different-secret@db.example.test:5432/videoforge?sslmode=require&channel_binding=require",
        { mode: 0o600 },
      );
    },
    (configuration) => {
      writeFileSync(
        configuration.databaseReconcilerUrlFile,
        "postgresql://wrong_reconciler:secret@db.example.test:5432/videoforge?sslmode=require",
        { mode: 0o600 },
      );
    },
    (configuration) => {
      writeFileSync(
        configuration.databaseOwnerUrlFile,
        "postgresql://owner:secret@db.example.test:5432/wrong_database?sslmode=require",
        { mode: 0o600 },
      );
    },
    (configuration) => {
      writeFileSync(
        configuration.databaseOperatorUrlFile,
        "postgresql://videoforge_operator:secret@db.example.test:5433/videoforge?sslmode=require",
        { mode: 0o600 },
      );
    },
    (configuration) => {
      writeFileSync(
        configuration.cloudflare.secretFiles.DATABASE_URL,
        "postgresql://videoforge_runtime:secret@db.example.test:5432/videoforge?sslmode=disable",
        { mode: 0o600 },
      );
    },
    (configuration) => {
      writeFileSync(
        configuration.databaseOwnerUrlFile,
        "postgresql://videoforge_runtime:other-secret@db.example.test:5432/videoforge?sslmode=require",
        { mode: 0o600 },
      );
    },
  ]) {
    const { configuration } = fixture();
    mutate(configuration);
    let childCount = 0;
    assert.throws(
      () =>
        createConcreteQualifiedProductionAdapters(configuration, {
          ports: portSet(),
          runChild: async () => {
            childCount += 1;
            throw new Error("unexpected child");
          },
        }),
      /V2_09_CONCRETE_(?:CONFIGURATION|DATABASE_ROLE_BINDING|DATABASE_URL)_INVALID/u,
    );
    assert.equal(childCount, 0);
  }
});

test("all database URLs require exact TLS and channel-binding query parameters", () => {
  for (const query of [
    "sslmode=require",
    "sslmode=require&channel_binding=prefer",
    "sslmode=require&channel_binding=require&extra=1",
    "sslmode=require&channel_binding=require#fragment",
  ]) {
    const { configuration } = fixture();
    writeFileSync(
      configuration.databaseOwnerUrlFile,
      `postgresql://owner:owner-secret@db.example.test:5432/videoforge?${query}`,
      { mode: 0o600 },
    );
    assert.throws(
      () =>
        createConcreteQualifiedProductionAdapters(configuration, {
          ports: portSet(),
          runChild: async () => assert.fail("must reject malformed database URL"),
        }),
      /V2_09_CONCRETE_DATABASE_URL_INVALID/u,
    );
  }
});

test("pre-browser failure proves zero generic project cost from the untouched journal", async () => {
  const { configuration } = fixture();
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: childRunner([], { noAttempts: true }),
    fetchImpl: async () =>
      new Response(JSON.stringify([{ amount: 4 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  const value = authority(adapters.identity_sha256);
  await adapters.state.claimAuthority({ authority: value });
  const billing = await adapters.operations["read-settled-billing"]({
    authority: value,
    operation: { id: "read-settled-billing" },
    outcome: "FAILURE",
    priorResults: [],
  });
  assert.equal(billing.generic_project_revision_net_cost_usd, 0);
  assert.equal(billing.completion_total_usd, 4);
});

test("malformed Chrome tenant scope is rejected at construction before any mutation", () => {
  const { configuration } = fixture();
  const document = JSON.parse(readFileSync(configuration.chromeRequestFile, "utf8"));
  document.request.accountId = "not-a-uuid";
  writeFileSync(configuration.chromeRequestFile, JSON.stringify(document), { mode: 0o600 });
  let childCount = 0;
  assert.throws(
    () =>
      createConcreteQualifiedProductionAdapters(configuration, {
        ports: portSet(),
        runChild: async () => {
          childCount += 1;
          throw new Error("unexpected child");
        },
      }),
    /V2_09_CONCRETE_CHROME_REQUEST_INVALID/u,
  );
  assert.equal(childCount, 0);
});

test("Chrome execution refuses a remaining deadline below the sealed 800-second init bound", async () => {
  const { configuration } = fixture();
  const document = JSON.parse(readFileSync(configuration.chromeRequestFile, "utf8"));
  document.request.stopAt = "2026-09-06T12:10:00.000Z";
  writeFileSync(configuration.chromeRequestFile, JSON.stringify(document), { mode: 0o600 });
  let childCount = 0;
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild: async () => {
      childCount += 1;
      throw new Error("unexpected child");
    },
    now: () => new Date("2026-09-06T12:00:00.000Z"),
  });
  const value = authority(adapters.identity_sha256);
  value.production.chrome_request_sha256 = hash(readFileSync(configuration.chromeRequestFile));
  value.production.chrome_auth_state_sha256 = hash(readFileSync(configuration.chromeAuthStateFile));
  await assert.rejects(
    adapters.operations["run-one-v209-chrome-e2e"]({ authority: value, operation: {} }),
    /V2_09_CONCRETE_CHROME_DEADLINE_INVALID/u,
  );
  assert.equal(childCount, 0);
});

test("zero-compute proof records observed endpoints and rejects provider inventory drift", async () => {
  const { configuration } = fixture();
  const baseRunner = childRunner();
  const runChild = async (input) => {
    if (
      input.args.some((value) => String(value).endsWith("v209-runpod-production-bridge.ts")) &&
      JSON.parse(input.options.input).command === "READ_INVENTORY"
    ) {
      return {
        status: 0,
        signal: null,
        stderr: "",
        stdout: JSON.stringify({
          schema_version: "videoforge.v2-09-runpod-production-bridge-result/v1",
          command: "READ_INVENTORY",
          terminal_jobs: [],
          inventory: {
            checkedAt: "2026-09-06T12:30:00Z",
            runningPods: 0,
            activeWorkers: 0,
            queuedJobs: 0,
            endpointIdSha256s: [hash("unattributable-endpoint")],
            templateIdSha256s: [],
            volumes: [],
          },
        }),
      };
    }
    return baseRunner(input);
  };
  const adapters = createConcreteQualifiedProductionAdapters(configuration, {
    ports: portSet(),
    runChild,
    sleep: async () => {},
    now: () => new Date("2026-09-06T12:30:05Z"),
  });
  const value = authority(adapters.identity_sha256);
  await assert.rejects(
    adapters.operations["prove-three-zero-compute-reads"]({
      authority: value,
      operation: {},
      outcome: "FAILURE",
    }),
    /V2_09_CONCRETE_ZERO_COMPUTE_INVALID/u,
  );
});

test("render subprocess preserves only exact safe phase codes and never raw stderr", async () => {
  for (const [stderr, signal, expected] of [
    ["V2_09_RENDER_BUILD_FAILED\n", null, "V2_09_RENDER_BUILD_FAILED"],
    ["V2_09_RENDER_WRANGLER_DRY_RUN_FAILED", null, "V2_09_RENDER_WRANGLER_DRY_RUN_FAILED"],
    ["password=private-value", null, "V2_09_CONCRETE_RENDER_CONFIG_FAILED"],
    [
      "V2_09_RENDER_BUILD_FAILED\npassword=private-value",
      null,
      "V2_09_CONCRETE_RENDER_CONFIG_FAILED",
    ],
    ["V2_09_RENDER_BUILD_FAILED_SECRET", null, "V2_09_CONCRETE_RENDER_CONFIG_FAILED"],
    ["V2_09_RENDER_BUILD_FAILED", "SIGTERM", "V2_09_CONCRETE_RENDER_CONFIG_FAILED"],
  ]) {
    const { configuration } = fixture();
    const adapters = createConcreteQualifiedProductionAdapters(configuration, {
      ports: portSet(),
      runChild: async () => ({ status: 1, signal, stdout: "private-stdout", stderr }),
    });
    const value = authority(adapters.identity_sha256);
    await assert.rejects(
      adapters.operations["render-qualified-production-config"]({ authority: value }),
      (error) => error.message === expected && error.cause === undefined,
    );
  }
});
