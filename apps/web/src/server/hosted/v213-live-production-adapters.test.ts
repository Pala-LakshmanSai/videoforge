import { canonicalSha256, type TransactionalSqlExecutor } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  createV213SqlBridgeCallLoader,
  createV213SqlCleanupReceiptFinalizer,
  createV213HostedAcceptanceProductionFactory,
  createV213SqlJitMaterializer,
  createV213SqlReleaseFactMaterializer,
  createV213SqlReleaseCertifier,
  V213SqlAttemptStore,
} from "./v213-live-production-adapters.js";
import {
  hashV213ReleaseIdentity,
  V213_RELEASE_GATES,
  type V213ReleaseEvidenceFact,
  type V213ReleaseGate,
  type V213ReleaseIdentity,
} from "../runtime/v213-release-certification.js";

function database(query: ReturnType<typeof vi.fn>): TransactionalSqlExecutor {
  return {
    transaction: (work) => work({ query } as never),
  } as TransactionalSqlExecutor;
}

function releaseGateFact(gate: V213ReleaseGate): V213ReleaseEvidenceFact {
  const facts = ((): Pick<V213ReleaseEvidenceFact, "claims" | "evidenceClass" | "metrics"> => {
    switch (gate) {
      case "mage_certified_ledger":
      case "soulx_certified_ledger":
        return {
          evidenceClass: "LIVE_PROVIDER" as const,
          claims: [
            "certified_ledger_qualified",
            "lineage_current",
            "billing_settled",
            "terminal_jobs",
            "zero_workers",
          ],
          metrics: { qualified: true, billingSettled: true, terminalJobs: 0, activeWorkers: 0 },
        };
      case "v209_short_e2e":
        return {
          evidenceClass: "LIVE_HOSTED" as const,
          claims: [
            "real_hosted_chrome",
            "private_output_readback",
            "no_manual_media_edit",
            "terminal_jobs",
            "zero_workers",
          ],
          metrics: {
            durationSeconds: 45,
            chromeAccepted: true,
            privateReadbackPassed: true,
            terminalJobs: 0,
            totalActiveWorkers: 0,
          },
        };
      case "v210_automatic_pilot":
        return {
          evidenceClass: "LIVE_HOSTED" as const,
          claims: [
            "automatic_3_to_5_minute_output",
            "every_cut_reviewed",
            "user_visual_decision_accepted",
            "settled_itemized_cost",
            "zero_workers",
          ],
          metrics: {
            durationSeconds: 240,
            everyCutReviewed: true,
            userVisualDecisionAccepted: true,
            variableCostSettled: true,
            terminalJobs: 0,
            totalActiveWorkers: 0,
          },
        };
      case "v211_two_account_queue":
        return {
          evidenceClass: "LIVE_HOSTED" as const,
          claims: [
            "two_distinct_accounts",
            "one_active_per_account",
            "two_active_globally",
            "fair_wait_and_promotion",
            "tenant_private",
            "two_readers_per_lane",
            "config_restored",
            "zero_jobs_zero_workers",
          ],
          metrics: {
            distinctAccounts: 2,
            maxActivePerAccount: 1,
            maxActiveGlobal: 2,
            maxGpuWorkers: 4,
            fairPromotionPassed: true,
            foreignAccessCount: 0,
            twoReadersPerLanePassed: true,
            volumesUnchanged: true,
            configRestored: true,
            terminalJobs: 0,
            endpointJobs: 0,
            totalActiveWorkers: 0,
          },
        };
      case "v212_production_length_economics":
        return {
          evidenceClass: "LIVE_HOSTED" as const,
          claims: [
            "automatic_29_to_31_minute_output",
            "quality_accepted",
            "user_decision_accepted",
            "settled_cost_under_hard_ceiling",
            "terminal_jobs",
            "zero_workers",
          ],
          metrics: {
            durationSeconds: 1800,
            qualityAccepted: true,
            userDecisionAccepted: true,
            billingSettled: true,
            variableCostMicroUsd: 1_000_000,
            terminalJobs: 0,
            totalActiveWorkers: 0,
          },
        };
      case "release_identity_current":
        return {
          evidenceClass: "INDEPENDENT_RELEASE_AUDIT" as const,
          claims: [
            "source_current",
            "deployment_current",
            "contracts_current",
            "lane_identities_current",
            "production_url_verified",
          ],
          metrics: {
            sourceCurrent: true,
            deploymentCurrent: true,
            contractsCurrent: true,
            laneIdentitiesCurrent: true,
            productionUrlVerified: true,
          },
        };
      case "fresh_bounded_two_lane_smoke":
        return {
          evidenceClass: "LIVE_PROVIDER" as const,
          claims: [
            "one_mage_dispatch",
            "one_soulx_dispatch",
            "bounded_spend",
            "durable_readback",
            "exact_release_identity",
          ],
          metrics: {
            mageDispatchCount: 1,
            soulxDispatchCount: 1,
            maximumSpendMicroUsd: 500_000,
            mageReadbackPassed: true,
            soulxReadbackPassed: true,
          },
        };
      case "independent_zero_drain":
        return {
          evidenceClass: "LIVE_PROVIDER" as const,
          claims: [
            "independent_observation",
            "zero_endpoint_jobs",
            "zero_mage_workers",
            "zero_soulx_workers",
            "no_unknown_liability",
          ],
          metrics: { endpointJobs: 0, mageWorkers: 0, soulxWorkers: 0, unknownLiabilities: 0 },
        };
      case "settled_billing":
        return {
          evidenceClass: "LIVE_PROVIDER" as const,
          claims: [
            "all_variable_billing_settled",
            "duplicate_cost_visible",
            "recurring_charges_disclosed",
          ],
          metrics: {
            billingSettled: true,
            unsettledItems: 0,
            totalVariableCostMicroUsd: 500_000,
            possibleDuplicateCostMicroUsd: 0,
            recurringChargesDisclosed: true,
          },
        };
      case "rollback_ready":
        return {
          evidenceClass: "INDEPENDENT_RELEASE_AUDIT" as const,
          claims: [
            "rollback_identity_pinned",
            "rollback_readback_passed",
            "release_current_restored",
          ],
          metrics: {
            rollbackIdentityPinned: true,
            rollbackReadbackPassed: true,
            releaseCurrentRestored: true,
          },
        };
      case "operations_runbooks_ready":
        return {
          evidenceClass: "INDEPENDENT_RELEASE_AUDIT" as const,
          claims: [
            "stuck_job_runbook",
            "provider_outage_runbook",
            "billing_runbook",
            "rollback_runbook",
          ],
          metrics: {
            stuckJobRunbookSha256: canonicalSha256({ runbook: "stuck" }),
            providerOutageRunbookSha256: canonicalSha256({ runbook: "provider" }),
            billingRunbookSha256: canonicalSha256({ runbook: "billing" }),
            rollbackRunbookSha256: canonicalSha256({ runbook: "rollback" }),
          },
        };
      case "backup_restore_ready":
        return {
          evidenceClass: "INDEPENDENT_RELEASE_AUDIT" as const,
          claims: [
            "backup_readback_passed",
            "restore_evidence_accepted",
            "schema_migration_disposition_recorded",
          ],
          metrics: {
            backupReadbackPassed: true,
            restoreEvidenceAccepted: true,
            schemaMigrationDisposition: "DISPOSABLE_RESTORE_COMPLETED",
          },
        };
      case "security_clear":
        return {
          evidenceClass: "INDEPENDENT_RELEASE_AUDIT" as const,
          claims: [
            "p0_zero",
            "p1_zero",
            "auth_tenant_boundary_passed",
            "ssrf_path_upload_boundary_passed",
            "secret_log_scan_passed",
            "cost_amplification_guards_passed",
            "legacy_runtime_bundle_scan_passed",
          ],
          metrics: {
            p0Count: 0,
            p1Count: 0,
            authTenantPassed: true,
            ssrfPathUploadPassed: true,
            secretLogScanPassed: true,
            costAmplificationGuardsPassed: true,
            legacyRuntimeBundleScanPassed: true,
          },
        };
      case "production_transport_real":
        return {
          evidenceClass: "INDEPENDENT_RELEASE_AUDIT" as const,
          claims: [
            "hosted_client_api_truth",
            "fixture_controls_absent",
            "fake_gpu_absent",
            "fake_transport_absent",
            "manual_pod_controls_absent",
            "legacy_dispatch_exports_absent",
          ],
          metrics: {
            hostedClientApiTruth: true,
            fixtureControlsInBundle: false,
            fakeGpuProfileInBundle: false,
            fakeTransportInBundle: false,
            manualPodControlsInBundle: false,
            legacyDispatchExportsInBundle: false,
          },
        };
    }
  })();
  const observedAt =
    gate === "fresh_bounded_two_lane_smoke"
      ? "2026-08-28T09:59:00.000Z"
      : gate === "independent_zero_drain"
        ? "2026-08-28T10:00:00.000Z"
        : gate === "settled_billing"
          ? "2026-08-28T10:01:00.000Z"
          : "2026-08-28T09:58:00.000Z";
  return {
    gate,
    sourceEvidenceSha256: canonicalSha256({ source: gate }),
    observerId: `current-run-${gate}`,
    evidencePath: `project-context/evidence/acceptance/VF-10-13/${gate}.json`,
    observedAt,
    fixtureOrFakeTransportUsed: false,
    ...facts,
  };
}

describe("V213 hosted live production adapters", () => {
  it("claims cleanup receipt intent and idempotently reconciles the DB suffix", async () => {
    const fullLiveAuthorityId = "11111111-1111-4111-8111-111111111111";
    const summary = Object.freeze({
      zeroWorkers: true,
      reads: [{ activeWorkers: 0 }, { activeWorkers: 0 }, { activeWorkers: 0 }],
    });
    const request = Object.freeze({
      fullLiveAuthorityId,
      operationId: "prove-zero-workers" as const,
      outerStateSha256: canonicalSha256({ outer: "cleanup" }),
      providerCleanupEvidenceSha256: canonicalSha256(summary),
      summary,
      readbackOnly: false,
      failureCleanup: false,
    });
    let signedEvidence: Record<string, unknown> | undefined;
    let operationReceipt: Record<string, unknown> | undefined;
    let intentClaimed = false;
    const sqlCalls: string[] = [];
    const query = vi.fn(async (sql: string, values: readonly unknown[]) => {
      sqlCalls.push(sql);
      const supplied = JSON.parse(String(values[0])) as Record<string, unknown>;
      if (sql.includes("claim_v213_cleanup_receipt_intent")) {
        const intentDocument = {
          schemaVersion: "videoforge.v213-cleanup-receipt-intent/v1",
          fullLiveAuthorityId: supplied.fullLiveAuthorityId,
          operationId: supplied.operationId,
          outerStateSha256: supplied.outerStateSha256,
          providerCleanupEvidenceSha256: supplied.providerCleanupEvidenceSha256,
          receiptArtifactSha256: supplied.receiptArtifactSha256,
          receiptDocument: supplied.document,
        };
        const intentState = intentClaimed ? "ACK_UNKNOWN" : "NO_ATTEMPT";
        intentClaimed = true;
        return {
          rows: [
            {
              value: {
                intentSha256: canonicalSha256(intentDocument),
                intentState,
                receiptArtifactSha256: supplied.receiptArtifactSha256,
              },
            },
          ],
          rowCount: 1,
        };
      }
      if (sql.includes("record_v213_signed_evidence")) {
        signedEvidence = supplied;
        return { rows: [{ value: supplied.artifactSha256 }], rowCount: 1 };
      }
      if (sql.includes("load_v213_signed_evidence"))
        return { rows: [{ value: signedEvidence }], rowCount: 1 };
      if (sql.includes("record_v213_operation_receipt")) {
        operationReceipt = {
          artifactSha256: supplied.artifactSha256,
          operationId: supplied.operationId,
          document: supplied.document,
        };
        return { rows: [{ value: supplied.artifactSha256 }], rowCount: 1 };
      }
      if (sql.includes("read_v213_operation_receipt"))
        return { rows: [{ value: operationReceipt }], rowCount: 1 };
      if (
        sql.includes("materialize_v213_release_facts") ||
        sql.includes("read_v213_release_fact_materialization")
      ) {
        const unsigned = {
          schemaVersion: "videoforge.v213-release-fact-materialization/v1" as const,
          fullLiveAuthorityId: supplied.fullLiveAuthorityId,
          completedOperationId: supplied.completedOperationId,
          completedEvidenceSha256: supplied.completedEvidenceSha256,
          releaseIdentitySha256: null,
          gateFactSha256s: {},
        };
        return {
          rows: [{ value: { ...unsigned, materializationSha256: canonicalSha256(unsigned) } }],
          rowCount: 1,
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    });
    const finalize = createV213SqlCleanupReceiptFinalizer({
      database: database(query),
      evidenceSigningKey: Buffer.alloc(32, 7),
    });

    const initial = await finalize(request);
    expect(initial).toMatchObject({
      schemaVersion: "videoforge.v213-cleanup-receipt-finalization-result/v1",
      fullLiveAuthorityId,
      operationId: "prove-zero-workers",
      providerCleanupEvidenceSha256: request.providerCleanupEvidenceSha256,
      readbackOnly: false,
    });
    expect(signedEvidence?.document).toMatchObject({
      providerCleanupEvidenceSha256: request.providerCleanupEvidenceSha256,
      summary,
    });
    expect(sqlCalls.some((sql) => sql.includes("record_v213_signed_evidence"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("record_v213_operation_receipt"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("materialize_v213_release_facts"))).toBe(true);

    sqlCalls.length = 0;
    await expect(finalize({ ...request, readbackOnly: true })).resolves.toEqual({
      ...initial,
      readbackOnly: true,
    });
    expect(sqlCalls.some((sql) => sql.includes("claim_v213_cleanup_receipt_intent"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("record_v213_operation_receipt"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("materialize_v213_release_facts"))).toBe(true);

    sqlCalls.length = 0;
    await expect(
      finalize({ ...request, readbackOnly: true, failureCleanup: true }),
    ).resolves.toEqual({
      ...initial,
      releaseFactMaterializationSha256: null,
      readbackOnly: true,
    });
    expect(sqlCalls.some((sql) => sql.includes("record_v213_operation_receipt"))).toBe(true);
    expect(sqlCalls.some((sql) => sql.includes("materialize_v213_release_facts"))).toBe(false);
  });

  it("materializes source-owned release facts and requires exact append-only readback", async () => {
    const request = {
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      completedOperationId: "v2-12-long-output",
      completedEvidenceSha256: canonicalSha256({ v212: "current-run" }),
    };
    const unsigned = {
      schemaVersion: "videoforge.v213-release-fact-materialization/v1" as const,
      ...request,
      releaseIdentitySha256: canonicalSha256({ release: "identity" }),
      gateFactSha256s: {
        v212_production_length_economics: canonicalSha256({ gate: "v212" }),
        release_identity_current: canonicalSha256({ gate: "identity" }),
      },
    };
    const value = { ...unsigned, materializationSha256: canonicalSha256(unsigned) };
    const query = vi.fn(async (sql: string) => {
      expect(sql).toMatch(/videoforge_(?:materialize|read)_v213_release_fact/u);
      return { rows: [{ value }], rowCount: 1 };
    });
    await expect(createV213SqlReleaseFactMaterializer(database(query))(request)).resolves.toEqual(
      value,
    );
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("claims the exact execution through the SECURITY DEFINER store before transport", async () => {
    const claim = {
      requestSha256: canonicalSha256({ request: 1 }),
      promotionVersion: "V3",
      promotionState: "CONSUMED_CURRENT",
    };
    const query = vi.fn(async (...arguments_: unknown[]) => {
      expect(arguments_.length).toBeGreaterThan(0);
      return { rows: [{ value: claim }], rowCount: 1 };
    });
    const store = new V213SqlAttemptStore(database(query));
    await expect(
      store.claimOnce(claim.requestSha256, { checkpoint: "V2-10" } as never),
    ).resolves.toBe(claim);
    expect(query.mock.calls[0]?.[0]).toContain("videoforge_claim_v213_live_acceptance");
  });

  it("signs, stores, reloads, and verifies DB-owned receipt evidence", async () => {
    let stored: Record<string, unknown> | undefined;
    const query = vi.fn(async (sql: string, values: readonly unknown[]) => {
      const input = JSON.parse(String(values[0])) as Record<string, unknown>;
      if (sql.includes("record_v213_signed_evidence")) {
        stored = input;
        return { rows: [{ value: input.artifactSha256 }], rowCount: 1 };
      }
      return { rows: [{ value: stored }], rowCount: 1 };
    });
    const transport = {
      kind: "CLOUDFLARE_HOSTED_RUNPOD_SERVERLESS" as const,
      execute: vi.fn(),
      cancelAndReconcile: vi.fn(),
    };
    const factory = createV213HostedAcceptanceProductionFactory({
      database: database(query),
      evidenceSigningKey: new TextEncoder().encode("a".repeat(32)),
      transport,
      now: () => new Date("2026-08-26T00:00:00.000Z"),
    });
    const document = {
      verifierId: "videoforge-v213-live-execution-receipt-verifier-v1",
      accepted: true,
    };
    const artifactSha256 = canonicalSha256({ receipt: "current-run" });
    const finalized = await factory.evidence.finalizeVerifierDocument(
      "RECEIPT",
      artifactSha256,
      document,
    );
    const reference = await factory.evidence.signAndStore("RECEIPT", finalized, artifactSha256);
    await expect(factory.receiptVerifier.verify(reference)).resolves.toEqual(finalized);
    await expect(
      factory.evidence.finalizeVerifierDocument("RECEIPT", artifactSha256, {
        ...document,
        verifierSignatureSha256: canonicalSha256({ forged: true }),
      }),
    ).rejects.toThrow("V213_VERIFIER_DOCUMENT_INVALID");
    stored = {
      ...stored,
      document: {
        ...(stored?.document as Record<string, unknown>),
        verifierSignatureSha256: canonicalSha256({ forged: true }),
      },
    };
    await expect(factory.receiptVerifier.verify(reference)).rejects.toThrow(
      "V213_SIGNED_EVIDENCE_INVALID",
    );
    await expect(
      factory.receiptVerifier.verify({ artifactSha256: canonicalSha256({ foreign: true }) }),
    ).rejects.toThrow("V213_SIGNED_EVIDENCE_INVALID");
  });

  it("loads a bridge call only through the exact consumed-authority SECURITY DEFINER function", async () => {
    const query = vi.fn(async (sql: string, parameters: readonly unknown[]) => {
      void sql;
      void parameters;
      return {
        rows: [
          {
            value: {
              checkpoint: "V2-10",
              fullLiveAuthorityId: "authority-id",
              call: { request: {} },
            },
          },
        ],
        rowCount: 1,
      };
    });
    const load = createV213SqlBridgeCallLoader(database(query));
    await expect(
      load({
        schemaVersion: "videoforge.v213-full-live-command/v1",
        commandId: "command-1",
        stageAuthorityId: "stage-1",
        command: "v2-10-operator-free-ranga-pilot",
        input: {
          requestSha256: canonicalSha256({ request: 1 }),
          outerStateSha256: canonicalSha256({ outer: 1 }),
        },
      }),
    ).resolves.toMatchObject({ checkpoint: "V2-10" });
    expect(query.mock.calls[0]?.[0]).toContain("videoforge_load_v213_bridge_acceptance_call");
  });

  it("materializes one exact V2-11 candidate and requires durable persist/readback before return", async () => {
    const hash = (label: string) => canonicalSha256({ label });
    const now = new Date("2026-08-26T00:02:00.000Z");
    const request = {
      checkpoint: "V2-11",
      executionId: "execution-v211",
      proposalSha256: hash("proposal"),
      authoritySha256: hash("authority"),
      approvalRecordSha256: hash("approval"),
      cumulativeLedgerSha256: hash("ledger"),
      executorSha256: hash("executor"),
      promotionDecisionSha256: hash("promotion"),
      sourceCommit: "a".repeat(40),
      scopes: [
        {
          accountId: "account-a",
          workspaceId: "workspace-a",
          projectId: "project-a",
          projectRevisionId: "revision-a",
          requestSha256: hash("request-a"),
          attemptId: "attempt-a",
        },
        {
          accountId: "account-b",
          workspaceId: "workspace-b",
          projectId: "project-b",
          projectRevisionId: "revision-b",
          requestSha256: hash("request-b"),
          attemptId: "attempt-b",
        },
      ],
      maximumVariableCostMicroUsd: 4_000_000,
      maximumCumulativeVariableCostMicroUsd: 17_500_000,
      billingBaselineMicroUsd: 0,
      cumulativeLedgerSpentBeforeMicroUsd: 2_000_000,
      retainedVolumeIdSha256s: { mage: hash("mage-volume"), soulx: hash("soulx-volume") },
      noRedispatch: true,
    };
    const candidate = { request };
    const predecessorEvidenceSha256s = {
      "v2-09-short-hosted-project": hash("v209"),
      "v2-10-operator-free-ranga-pilot": hash("v210"),
    };
    let persisted: Record<string, unknown> | undefined;
    const query = vi.fn(async (sql: string, parameters: readonly unknown[]) => {
      const value = JSON.parse(String(parameters[0])) as Record<string, unknown>;
      if (sql.includes("project_v213_jit_operation"))
        return {
          rows: [
            {
              value: {
                schemaVersion: "videoforge.v213-jit-operation-projection/v2",
                operationId: "v2-11-two-concurrent-owned-projects",
                checkpoint: "V2-11",
                fullLiveAuthorityId: "authority-id",
                commandId: "command-id",
                stageAuthorityId: "production-stage-id",
                outerStateSha256: hash("outer"),
                workloadDeadlineAt: "2026-08-26T00:35:00.000Z",
                predecessorEvidenceSha256s,
                candidateSha256: canonicalSha256(candidate),
                candidate,
                authorityBinding: {
                  directParentAuthorityId: "authority-id",
                  productionStageAuthorityId: "production-stage-id",
                  tokenSha256: hash("token"),
                  issuedAt: "2026-08-26T00:01:00.000Z",
                  expiresAt: "2026-08-26T00:10:00.000Z",
                },
              },
            },
          ],
          rowCount: 1,
        };
      if (sql.includes("persist_v213_jit_materialization")) {
        persisted = value;
        return { rows: [{ value: value.materializationSha256 }], rowCount: 1 };
      }
      return {
        rows: [
          {
            value: {
              operationId: persisted?.operationId,
              checkpoint: persisted?.checkpoint,
              materializationSha256: persisted?.materializationSha256,
              requestDocument: persisted?.requestDocument,
              executionDocument: persisted?.executionDocument,
              callDocument: persisted?.callDocument,
            },
          },
        ],
        rowCount: 1,
      };
    });
    const materialize = createV213SqlJitMaterializer({
      database: database(query),
      factory: {} as never,
      laneTransports: {} as never,
      loadResolvedRenderManifest: vi.fn(),
      readV209Observation: vi.fn(),
      now: () => now,
    });
    await expect(
      materialize({
        fullLiveAuthorityId: "authority-id",
        operationId: "v2-11-two-concurrent-owned-projects",
        commandId: "command-id",
        stageAuthorityId: "production-stage-id",
        outerStateSha256: hash("outer"),
      }),
    ).resolves.toMatchObject({
      operationId: "v2-11-two-concurrent-owned-projects",
      checkpoint: "V2-11",
    });
    expect(query.mock.calls.map((call) => String(call[0]))).toEqual([
      expect.stringContaining("project_v213_jit_operation"),
      expect.stringContaining("persist_v213_jit_materialization"),
      expect.stringContaining("read_v213_jit_materialization"),
    ]);
  });

  it("rejects an extra predecessor before persisting or dispatching", async () => {
    const candidate = { request: {} };
    const query = vi.fn(async () => ({
      rows: [
        {
          value: {
            schemaVersion: "videoforge.v213-jit-operation-projection/v2",
            operationId: "v2-11-two-concurrent-owned-projects",
            checkpoint: "V2-11",
            fullLiveAuthorityId: "authority-id",
            commandId: "command-id",
            stageAuthorityId: "production-stage-id",
            outerStateSha256: canonicalSha256({ outer: true }),
            workloadDeadlineAt: "2026-08-26T00:35:00.000Z",
            predecessorEvidenceSha256s: {
              "v2-09-short-hosted-project": canonicalSha256({ v209: true }),
              "v2-10-operator-free-ranga-pilot": canonicalSha256({ v210: true }),
              future: canonicalSha256({ future: true }),
            },
            candidateSha256: canonicalSha256(candidate),
            candidate,
            authorityBinding: {
              directParentAuthorityId: "authority-id",
              productionStageAuthorityId: "production-stage-id",
              tokenSha256: canonicalSha256({ token: true }),
              issuedAt: "2026-08-26T00:01:00.000Z",
              expiresAt: "2026-08-26T00:10:00.000Z",
            },
          },
        },
      ],
      rowCount: 1,
    }));
    const materialize = createV213SqlJitMaterializer({
      database: database(query),
      factory: {} as never,
      laneTransports: {} as never,
      loadResolvedRenderManifest: vi.fn(),
      readV209Observation: vi.fn(),
      now: () => new Date("2026-08-26T00:02:00.000Z"),
    });
    await expect(
      materialize({
        fullLiveAuthorityId: "authority-id",
        operationId: "v2-11-two-concurrent-owned-projects",
        commandId: "command-id",
        stageAuthorityId: "production-stage-id",
        outerStateSha256: canonicalSha256({ outer: true }),
      }),
    ).rejects.toThrow("V213_JIT_PREDECESSOR_SET_INVALID");
    expect(query).toHaveBeenCalledOnce();
  });

  it("persists certification once and makes crash recovery one exact readback only", async () => {
    const hash = (label: string) => canonicalSha256({ label });
    const predecessorEvidenceSha256s = {
      "v2-13-final-two-lane-smoke": hash("smoke"),
      "restore-endpoints-max-one": hash("restore"),
      "prove-zero-workers": hash("zero"),
      "read-settled-billing": hash("billing"),
      "reconcile-exact-resources": hash("resources"),
    };
    const releaseIdentity: V213ReleaseIdentity = {
      schemaVersion: "videoforge-v213-release-identity/v1",
      sourceCommit: "a".repeat(40),
      deployedSourceCommit: "a".repeat(40),
      deployedExecutableSha256: hash("executable"),
      productionUrlSha256: hash("url"),
      deploymentConfigSha256: hash("config"),
      contractBundleSha256: hash("contracts"),
      mageImageDigest: `sha256:${"1".repeat(64)}`,
      soulxImageDigest: `sha256:${"2".repeat(64)}`,
      mageEndpointConfigSha256: hash("mage-endpoint"),
      soulxEndpointConfigSha256: hash("soulx-endpoint"),
      mageCertificationLedgerSha256: hash("mage-ledger"),
      soulxCertificationLedgerSha256: hash("soulx-ledger"),
      v209AcceptanceSha256: hash("v209"),
      v210AcceptanceSha256: hash("v210"),
      v211AcceptanceSha256: hash("v211"),
      v212AcceptanceSha256: hash("v212"),
    };
    const releaseIdentitySha256 = hashV213ReleaseIdentity(releaseIdentity);
    const requestBase = {
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      workId: "outer-authority:certify-v2-13-release",
      outerStateSha256: hash("outer"),
      predecessorEvidenceSha256s,
      providerDispatchForbidden: true as const,
    };
    const certificationIdentitySha256 = canonicalSha256({
      fullLiveAuthorityId: requestBase.fullLiveAuthorityId,
      workId: requestBase.workId,
      outerStateSha256: requestBase.outerStateSha256,
      predecessorEvidenceSha256s,
    });
    const releaseIdentityFacts = {
      deployedSourceCommit: releaseIdentity.deployedSourceCommit,
      deployedExecutableSha256: releaseIdentity.deployedExecutableSha256,
      productionUrlSha256: releaseIdentity.productionUrlSha256,
      deploymentConfigSha256: releaseIdentity.deploymentConfigSha256,
      contractBundleSha256: releaseIdentity.contractBundleSha256,
      mageImageDigest: releaseIdentity.mageImageDigest,
      soulxImageDigest: releaseIdentity.soulxImageDigest,
      mageEndpointConfigSha256: releaseIdentity.mageEndpointConfigSha256,
      soulxEndpointConfigSha256: releaseIdentity.soulxEndpointConfigSha256,
      mageCertificationLedgerSha256: releaseIdentity.mageCertificationLedgerSha256,
      soulxCertificationLedgerSha256: releaseIdentity.soulxCertificationLedgerSha256,
      v209AcceptanceSha256: releaseIdentity.v209AcceptanceSha256,
      v210AcceptanceSha256: releaseIdentity.v210AcceptanceSha256,
      v211AcceptanceSha256: releaseIdentity.v211AcceptanceSha256,
      v212AcceptanceSha256: releaseIdentity.v212AcceptanceSha256,
    };
    const gateFacts = Object.fromEntries(
      V213_RELEASE_GATES.map((gate) => [gate, releaseGateFact(gate)]),
    );
    const chromeArtifact = { rawEvidence: { artifactSha256: hash("chrome") } };
    const projectionBase = {
      schemaVersion: "videoforge.v213-final-release-certification-projection/v2",
      fullLiveAuthorityId: requestBase.fullLiveAuthorityId,
      workId: requestBase.workId,
      outerStateSha256: requestBase.outerStateSha256,
      certificationIdentitySha256,
      sourceCommit: releaseIdentity.sourceCommit,
      predecessorEvidenceSha256s,
      releaseIdentityFacts,
      releaseIdentitySha256,
      scope: {
        accountId: "account-id",
        workspaceId: "workspace-id",
        projectId: "project-id",
        projectRevisionId: "revision-id",
        requestSha256: hash("scope-request"),
        attemptId: "attempt-id",
      },
      gateFacts,
      chromeArtifact,
    };
    const projection = {
      ...projectionBase,
      projectionSha256: canonicalSha256(projectionBase),
    };
    const ledgerSha256 = hash("ledger");
    let persistedResult: Record<string, unknown> | undefined;
    const sqlCalls: string[] = [];
    const query = vi.fn(async (sql: string, parameters: readonly unknown[]) => {
      sqlCalls.push(sql);
      if (sql.includes("project_v213_release_certification"))
        return { rows: [{ value: projection }], rowCount: 1 };
      const value = JSON.parse(String(parameters[0])) as Record<string, unknown>;
      if (sql.includes("record_v213_signed_evidence"))
        return { rows: [{ value: value.artifactSha256 }], rowCount: 1 };
      if (sql.includes("persist_v213_release_certification")) {
        persistedResult = value.result as Record<string, unknown>;
        return { rows: [{ value: ledgerSha256 }], rowCount: 1 };
      }
      return { rows: [{ value: persistedResult }], rowCount: 1 };
    });
    const certifyFromCurrentRun = vi.fn(async () => ({
      ledger: {
        schemaVersion: "videoforge-v213-release-certification-ledger/v1",
        evaluatedAt: "2026-08-28T10:02:00.000Z",
        releaseIdentitySha256,
        reusableGates: V213_RELEASE_GATES,
        invalidGates: [],
        missingGates: [],
        releaseStatus: "release_certified",
        liveReleaseAuthorized: false,
        requiresExplicitReleaseAuthority: true,
        ledgerSha256,
      },
      chrome: {},
      predecessorEvidenceSha256s,
      certificationSha256: hash("certification"),
    })) as never;
    const certify = createV213SqlReleaseCertifier({
      database: database(query),
      evidenceSigningKey: new Uint8Array(32).fill(7),
      now: () => new Date("2026-08-28T10:02:00.000Z"),
      certifyFromCurrentRun,
    });
    const initial = await certify({
      ...requestBase,
      resumed: false,
      authorizedUnsettled: false,
      reconciliationOnly: false,
      persistenceForbidden: false,
      dispatchForbidden: false,
    });
    expect(initial.ledgerSha256).toBe(ledgerSha256);
    expect(sqlCalls[0]).toContain("project_v213_release_certification");
    expect(sqlCalls.filter((sql) => sql.includes("record_v213_signed_evidence"))).toHaveLength(
      V213_RELEASE_GATES.length,
    );
    expect(sqlCalls.slice(-2)).toEqual([
      expect.stringContaining("persist_v213_release_certification"),
      expect.stringContaining("read_v213_release_certification"),
    ]);
    const callsBeforeRecovery = sqlCalls.length;
    await expect(
      certify({
        ...requestBase,
        resumed: true,
        authorizedUnsettled: true,
        reconciliationOnly: true,
        persistenceForbidden: true,
        dispatchForbidden: true,
      }),
    ).resolves.toEqual(initial);
    expect(sqlCalls.slice(callsBeforeRecovery)).toEqual([
      expect.stringContaining("read_v213_release_certification"),
    ]);
    expect(certifyFromCurrentRun).toHaveBeenCalledOnce();
    expect(
      sqlCalls.filter((sql) => sql.includes("persist_v213_release_certification")),
    ).toHaveLength(1);
  });
});
