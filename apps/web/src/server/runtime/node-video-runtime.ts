import { createHash } from "node:crypto";

import {
  FakeServerlessEndpoint,
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  ServerlessDispatchService,
  VideoRuntimeService,
  providerFreeV2Authority,
  type ProvenanceReceipt,
  type ServerlessLane,
  type Sha256,
  type TransactionalSqlExecutor,
  type VideoRuntimeView,
  type WorkspaceScope,
} from "@videoforge/control-plane";

import { buildProviderFreeProjectBundle } from "../provider-free-foundations";
import type { FixtureTenantScope } from "../shared-app-fixture";
import type { NodeFairAdmission } from "./node-fair-admission";

/**
 * The V2-05 application runtime.
 *
 * One admitted video is carried through tenant-private CPU preparation, two independent exact lane
 * batches, the asset barrier, and render, using the provider-free Serverless v3 contracts and the
 * in-process fake transports. No credential, provider call, worker, GPU, or spend exists here, and
 * every state the application reports is a durable observation rather than a simulated live signal.
 */
const LANES: readonly ServerlessLane[] = Object.freeze(["mage_image", "soulx_avatar"]);

const RATE_SOURCE = "https://docs.runpod.io/serverless/pricing";

function sha256(label: string): Sha256 {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function uuid(label: string): string {
  const hex = createHash("sha256").update(`videoforge-v2-05:${label}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20)}`;
}

function deployment(lane: ServerlessLane) {
  return Object.freeze({
    deploymentId: uuid(`deployment:${lane}`),
    lane,
    endpointProfileId: `${lane}-serverless-v1`,
    endpointIdSha256: sha256(`endpoint:${lane}`),
    endpointConfigSha256: sha256(`endpoint-config:${lane}`),
    workerImageDigest: sha256(`worker-image:${lane}`),
    modelManifestSha256: sha256(`model-manifest:${lane}`),
    volumeIdSha256: sha256(`volume-id:${lane}`),
    volumeManifestSha256: sha256(`volume-manifest:${lane}`),
    idleTimeoutSeconds: 5,
    initTimeoutSeconds: 900,
    executionTimeoutSeconds: 2400,
    requestTtlSeconds: 3600,
    reconciliationDeadlineSeconds: 1500,
    pollingIntervalSeconds: 5,
    maxReplacementAttempts: 1,
    timeoutEvidence: {
      source: "PROVISIONAL_PROVIDER_FREE_BOUND",
      measured_at: new Date(0).toISOString(),
      evidence_path:
        "project-context/evidence/acceptance/VF-10-05/2026-08-16-provider-free-cutover/acceptance.json",
      provider_defaults_accepted: false,
    },
    deploymentVersion: 1,
    createdAt: new Date(0).toISOString(),
  });
}

const DEPLOYMENTS = Object.freeze({
  mage_image: deployment("mage_image"),
  soulx_avatar: deployment("soulx_avatar"),
});

export interface VideoRuntimeStageView {
  readonly publicProjectId: string;
  readonly stage: VideoRuntimeView["stage"];
  readonly terminalReason: VideoRuntimeView["terminalReason"];
  readonly lanes: VideoRuntimeView["lanes"];
  readonly finalOutputSha256: string | null;
  readonly providerCallsAuthorized: false;
  readonly authorizedSpendUsd: 0;
  readonly settledCostUsd: 0;
}

export class NodeVideoRuntime {
  readonly #admission: NodeFairAdmission;
  readonly #signer = new ProvenanceReceiptSigner("videoforge-v2-05-worker", Buffer.alloc(32, 5));
  readonly #endpoints = new Map<ServerlessLane, FakeServerlessEndpoint>();
  #prepared: Promise<void> | null = null;

  constructor(admission: NodeFairAdmission) {
    this.#admission = admission;
  }

  async #services(): Promise<{
    readonly executor: TransactionalSqlExecutor;
    readonly dispatch: ServerlessDispatchService;
    readonly runtime: VideoRuntimeService;
  }> {
    const { executor } = await this.#admission.access();
    const dispatch = new ServerlessDispatchService(executor, this.#signer);
    const runtime = new VideoRuntimeService(executor);
    this.#prepared ??= (async () => {
      // Endpoint deployments are operator configuration and survive tenant resets, so publishing is
      // idempotent: an already published lane is reused rather than duplicated on restart.
      for (const lane of LANES) {
        const existing = await dispatch
          .activeDeployment(lane)
          .then((row) => row.id)
          .catch(() => null);
        if (existing === DEPLOYMENTS[lane].deploymentId) continue;
        await dispatch.publishEndpointDeployment(DEPLOYMENTS[lane]);
      }
    })();
    await this.#prepared;
    return { executor, dispatch, runtime };
  }

  #endpoint(lane: ServerlessLane): FakeServerlessEndpoint {
    const existing = this.#endpoints.get(lane);
    if (existing !== undefined) return existing;
    const created = new FakeServerlessEndpoint({
      endpointIdSha256: DEPLOYMENTS[lane].endpointIdSha256,
      callbackTokenSha256: sha256(`callback:${lane}`),
      jobIdPrefix: lane === "mage_image" ? "mage" : "soulx",
    });
    this.#endpoints.set(lane, created);
    return created;
  }

  /** Registers the durable runtime of one enqueued video. A queued video stays completely inert. */
  async register(tenant: FixtureTenantScope, publicProjectId: string): Promise<void> {
    const { runtime } = await this.#services();
    const value = this.#admission.identifiers(tenant, publicProjectId);
    await runtime.register(this.#admission.tenantScope(tenant), {
      runtimeId: uuid(`runtime:${value.requestId}`),
      projectId: value.projectId,
      projectRevisionId: value.revisionId,
      generationRequestId: value.requestId,
      now: new Date().toISOString(),
    });
  }

  /**
   * Advances one admitted video by exactly one durable step and returns its factual state. The
   * caller drives progress; nothing here invents a state the database has not accepted.
   */
  async advance(
    tenant: FixtureTenantScope,
    publicProjectId: string,
  ): Promise<VideoRuntimeStageView> {
    const { executor, dispatch, runtime } = await this.#services();
    const scope = this.#admission.tenantScope(tenant);
    const value = this.#admission.identifiers(tenant, publicProjectId);
    const runtimeId = uuid(`runtime:${value.requestId}`);
    const now = () => new Date().toISOString();
    let view = await runtime.view(scope, runtimeId);

    if (view.stage === "QUEUED") {
      view = await runtime.beginPreparation(scope, { runtimeId, now: now() });
      return this.#project(publicProjectId, view);
    }
    if (view.stage === "PREPARING") {
      const bundle = await buildProviderFreeProjectBundle(publicProjectId);
      view = await runtime.completePreparation(scope, {
        runtimeId,
        preparationManifestSha256: bundle.receipts.generationWorkManifestSha256 as Sha256,
        lanes: LANES.map((lane) => {
          const itemIds = this.#itemIds(bundle, lane);
          return {
            lane,
            itemsManifestSha256: sha256(`${lane}:${itemIds.join("|")}`),
            itemIds,
          };
        }),
        now: now(),
      });
      return this.#project(publicProjectId, view);
    }

    const pendingLane = view.lanes.find(
      (lane) => lane.state !== "SUCCEEDED" && lane.state !== "CANCELED" && lane.state !== "FAILED",
    );
    if (pendingLane !== undefined) {
      const bundle = await buildProviderFreeProjectBundle(publicProjectId);
      const plannedItemIds = this.#itemIds(bundle, pendingLane.lane);
      const remaining = await runtime.remainingUnits(
        scope,
        runtimeId,
        pendingLane.lane,
        plannedItemIds,
      );
      view = await this.#runLane({
        executor,
        dispatch,
        runtime,
        scope,
        runtimeId,
        lane: pendingLane.lane,
        attemptOrdinal: pendingLane.attemptOrdinal + 1,
        itemIds: remaining,
        itemsManifestSha256:
          pendingLane.itemsManifestSha256 ??
          sha256(`${pendingLane.lane}:${plannedItemIds.join("|")}`),
        projectId: value.projectId,
        revisionId: value.revisionId,
        requestId: value.requestId,
      });
      return this.#project(publicProjectId, view);
    }

    if (view.stage !== "RENDERING") {
      const bundle = await buildProviderFreeProjectBundle(publicProjectId);
      view = await runtime.beginRender(scope, {
        runtimeId,
        renderManifestSha256: bundle.renderManifest.sha256 as Sha256,
        now: now(),
      });
      return this.#project(publicProjectId, view);
    }

    const bundle = await buildProviderFreeProjectBundle(publicProjectId);
    view = await runtime.completeRender(scope, {
      runtimeId,
      finalOutputSha256: bundle.renderManifest.sha256 as Sha256,
      now: now(),
    });
    return this.#project(publicProjectId, view);
  }

  async cancel(
    tenant: FixtureTenantScope,
    publicProjectId: string,
  ): Promise<VideoRuntimeStageView> {
    const { runtime } = await this.#services();
    const scope = this.#admission.tenantScope(tenant);
    const value = this.#admission.identifiers(tenant, publicProjectId);
    const view = await runtime.cancel(scope, {
      runtimeId: uuid(`runtime:${value.requestId}`),
      requestedBy: "OWNER_ACCOUNT",
      now: new Date().toISOString(),
    });
    return this.#project(publicProjectId, view);
  }

  /**
   * The durable state of each named owned video, keyed back to its public project identifier. A
   * foreign account is never revealed, not even as a count, and a video without a durable runtime
   * row is absent rather than reported with an invented stage.
   */
  async listOwned(
    tenant: FixtureTenantScope,
    publicProjectIds: readonly string[],
  ): Promise<readonly VideoRuntimeStageView[]> {
    const { runtime } = await this.#services();
    const scope = this.#admission.tenantScope(tenant);
    const owned = await runtime.listOwned(scope);
    const byRuntimeId = new Map(owned.map((view) => [view.runtimeId, view]));
    const resolved: VideoRuntimeStageView[] = [];
    for (const publicProjectId of publicProjectIds) {
      const value = this.#admission.identifiers(tenant, publicProjectId);
      const view = byRuntimeId.get(uuid(`runtime:${value.requestId}`));
      if (view !== undefined) resolved.push(this.#project(publicProjectId, view));
    }
    return Object.freeze(resolved);
  }

  /** Zero live attempts and zero fake workers must remain once every owned video drains. */
  async drainProof(): Promise<{
    readonly liveAttempts: number;
    readonly acceptedJobs: number;
    readonly settledCostUsd: 0;
  }> {
    const { executor } = await this.#services();
    const live = await executor.query<{ count: string } & Record<string, unknown>>(
      `SELECT count(*)::text AS count FROM serverless_attempts
        WHERE state NOT IN ('SUCCEEDED', 'PERMANENT_FAILED', 'CANCELLED')`,
    );
    let acceptedJobs = 0;
    for (const lane of LANES) acceptedJobs += this.#endpoint(lane).acceptedJobCount();
    return Object.freeze({
      liveAttempts: Number(live.rows[0]?.count ?? "0"),
      acceptedJobs,
      settledCostUsd: 0 as const,
    });
  }

  #itemIds(
    bundle: Awaited<ReturnType<typeof buildProviderFreeProjectBundle>>,
    lane: ServerlessLane,
  ): readonly string[] {
    const artifacts = lane === "mage_image" ? bundle.mage.artifacts : bundle.echo.artifacts;
    return artifacts
      .filter((artifact) => artifact.kind === "IMAGE" || artifact.kind === "AVATAR_FRAME")
      .map((artifact) => artifact.artifactId);
  }

  async #runLane(input: {
    readonly executor: TransactionalSqlExecutor;
    readonly dispatch: ServerlessDispatchService;
    readonly runtime: VideoRuntimeService;
    readonly scope: WorkspaceScope;
    readonly runtimeId: string;
    readonly lane: ServerlessLane;
    readonly attemptOrdinal: number;
    readonly itemIds: readonly string[];
    readonly itemsManifestSha256: Sha256;
    readonly projectId: string;
    readonly revisionId: string;
    readonly requestId: string;
  }): Promise<VideoRuntimeView> {
    const { dispatch, runtime, scope, lane } = input;
    const bound = DEPLOYMENTS[lane];
    const endpoint = this.#endpoint(lane);
    const attemptId = uuid(`attempt:${input.runtimeId}:${lane}:${String(input.attemptOrdinal)}`);
    const laneSegment = lane === "mage_image" ? "mage-image" : "soulx-avatar";
    const outputPrefix = `tenant/${scope.accountId}/workspace/${scope.workspaceId}/project/${input.projectId}/revision/${input.revisionId}/lane/${laneSegment}/job/${attemptId}`;
    const now = new Date().toISOString();

    const commit = await dispatch.commitPredispatch(scope, {
      attemptId,
      authorityId: uuid(`authority:${attemptId}`),
      outboxId: uuid(`outbox:${attemptId}`),
      ledgerId: uuid(`ledger:${attemptId}`),
      costEventId: uuid(`cost:${attemptId}`),
      projectId: input.projectId,
      projectRevisionId: input.revisionId,
      generationRequestId: input.requestId,
      taskId: uuid(`task:${attemptId}`),
      lane,
      attemptOrdinal: input.attemptOrdinal,
      itemsManifestSha256: input.itemsManifestSha256,
      itemCount: input.itemIds.length,
      inputManifestSha256: sha256(`inputs:${attemptId}`),
      outputPrefix,
      maxInputBytes: 268_435_456,
      maxOutputBytes: 2_147_483_648,
      requestBody: { lane, items: input.itemIds.length, manifest: input.itemsManifestSha256 },
      // Provider-free: the ceiling bounds a future paid checkpoint; nothing is reserved or spent.
      spendCeilingUsd: 0.5,
      reservationUsd: 0,
      rateSource: RATE_SOURCE,
      rateCheckedAt: now,
      now,
      checkpointAuthority: providerFreeV2Authority("V2-05"),
    });

    await dispatch.dispatchOnce(scope, {
      commit,
      endpoint,
      endpointIdSha256: bound.endpointIdSha256,
      envelope: { schema: "serverless-worker-job-envelope/v3" },
      requestBodySha256: commit.requestBodySha256,
      assignmentId: uuid(`assignment:${attemptId}`),
      leaseId: uuid(`lease:${attemptId}`),
      holderSha256: sha256(`holder:${attemptId}`),
      now,
    });
    await runtime.bindLaneAttempt(scope, {
      runtimeId: input.runtimeId,
      lane,
      attemptId,
      attemptOrdinal: input.attemptOrdinal,
      now,
    });
    await runtime.observeLaneProgress(scope, {
      runtimeId: input.runtimeId,
      lane,
      observed: "INITIALIZING",
      now: new Date().toISOString(),
    });

    const assignment = await dispatch.currentAssignment(attemptId);
    if (assignment === null) throw new Error("provider-free dispatch produced no assignment");
    let signed: ProvenanceReceipt | undefined;
    endpoint.execute(assignment.provider_job_id, () => {
      signed = this.#sign({
        commit,
        lane,
        scope,
        itemIds: input.itemIds,
        providerJobId: assignment.provider_job_id,
        outputPrefix,
      });
      return signed;
    });
    if (signed === undefined) throw new Error("the fake worker produced no signed receipt");
    await runtime.observeLaneProgress(scope, {
      runtimeId: input.runtimeId,
      lane,
      observed: "GENERATING",
      now: new Date().toISOString(),
    });

    const commitHashes = await this.#persistCommitReceipts(input.executor, attemptId, signed);
    await dispatch.acceptOutput(scope, {
      outputReceiptId: uuid(`output:${attemptId}`),
      provenanceRowId: uuid(`provenance:${attemptId}`),
      attemptId,
      receipt: signed,
      artifactCommitReceiptSha256s: commitHashes,
      now: new Date().toISOString(),
    });
    await dispatch.recordCost(scope, {
      costEventId: uuid(`settled:${attemptId}`),
      attemptId,
      kind: "SETTLED",
      amountUsd: 0,
      rateSource: RATE_SOURCE,
      rateCheckedAt: now,
      now: new Date().toISOString(),
    });
    return runtime.acceptLaneUnits(scope, {
      runtimeId: input.runtimeId,
      lane,
      attemptId,
      units: signed.items.map((item) => ({
        itemId: item.item_id,
        objectKey: item.output_object_key ?? `${outputPrefix}/artifact/${item.item_id}`,
        checksumSha256: item.output_sha256 as Sha256,
        contentLength: item.output_bytes,
      })),
      now: new Date().toISOString(),
    });
  }

  #sign(input: {
    readonly commit: { readonly dispatchToken: string; readonly attemptId: string };
    readonly lane: ServerlessLane;
    readonly scope: WorkspaceScope;
    readonly itemIds: readonly string[];
    readonly providerJobId: string;
    readonly outputPrefix: string;
  }): ProvenanceReceipt {
    const bound = DEPLOYMENTS[input.lane];
    return this.#signer.sign({
      schema_version: "serverless-provenance-receipt/v1",
      receipt_id: `provenance-${input.commit.attemptId}`,
      attestation_scope: PROVENANCE_ATTESTATION_SCOPE,
      dispatch_token: input.commit.dispatchToken,
      attempt_id: input.commit.attemptId,
      provider_job_id: input.providerJobId,
      worker_id: `worker-${input.providerJobId}`,
      tenant: { account_id: input.scope.accountId, workspace_id: input.scope.workspaceId },
      lane: input.lane,
      deployment: {
        deployment_id: bound.deploymentId,
        endpoint_id_sha256: bound.endpointIdSha256,
        container_digest: bound.workerImageDigest,
        intended_region: "EU-RO-1",
        intended_volume_id_sha256: bound.volumeIdSha256,
        model_manifest_sha256: bound.modelManifestSha256,
      },
      runtime_probe: {
        gpu_name: "NVIDIA GeForce RTX 4090",
        gpu_count: 1,
        gpu_uuid_sha256: sha256(`gpu:${input.lane}`),
        driver_version: "550.90.07",
        cuda_version: "12.4",
        probe_source: "WORKER_RUNTIME_SELF_REPORT",
      },
      volume_verification: {
        manifest_sha256_before: bound.volumeManifestSha256,
        manifest_sha256_after: bound.volumeManifestSha256,
        mutation_detected: false,
        cross_mount_detected: false,
      },
      model_ready_evidence: {
        state: "MODEL_READY",
        warmup_completed: true,
        warmup_output_sha256: sha256(`warmup:${input.lane}`),
      },
      timings: {
        allocation_ms: 1200,
        container_ready_ms: 8000,
        volume_verified_ms: 900,
        model_load_ms: 41_000,
        warmup_ms: 6000,
        first_inference_ms: 2100,
        upload_ms: 3000,
        total_ms: 62_200,
      },
      items: input.itemIds.map((itemId, index) => ({
        item_id: itemId,
        state: "SUCCEEDED",
        output_object_key: `${input.outputPrefix}/artifact/${itemId}`,
        output_sha256: sha256(`${input.commit.attemptId}:${itemId}`),
        output_bytes: 512_345 + index,
        probe: { width: 1280, height: 720, unit: index + 1 },
      })),
      scratch_cleanup: {
        terminal_reason: "SUCCESS",
        removed: true,
        scratch_on_model_volume: false,
      },
      receipt_nonce: 1,
      issued_at: new Date().toISOString(),
    });
  }

  /** Commits the tenant-private artifact receipts the fake worker's upload produced. */
  async #persistCommitReceipts(
    executor: TransactionalSqlExecutor,
    attemptId: string,
    receipt: ProvenanceReceipt,
  ): Promise<readonly Sha256[]> {
    const attempt = await executor.query<
      {
        account_id: string;
        workspace_id: string;
        project_id: string;
        project_revision_id: string;
        lane: ServerlessLane;
      } & Record<string, unknown>
    >(
      `SELECT account_id, workspace_id, project_id, project_revision_id, lane
         FROM serverless_attempts WHERE id = $1`,
      [attemptId],
    );
    const bound = attempt.rows[0];
    if (bound === undefined) throw new Error("the dispatched attempt is missing");
    const hashes: Sha256[] = [];
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 60 * 60_000).toISOString();
    for (const item of receipt.items) {
      const reservationId = uuid(`reservation:${attemptId}:${item.item_id}`);
      const receiptId = uuid(`receipt:${attemptId}:${item.item_id}`);
      const receiptSha256 = sha256(`commit:${attemptId}:${item.item_id}`);
      await executor.transaction(async (transaction) => {
        await transaction.query(`SELECT set_config('videoforge.account_id', $1, true)`, [
          bound.account_id,
        ]);
        await transaction.query(
          `INSERT INTO artifact_reservations (
             id, account_id, workspace_id, project_id, project_revision_id, lane, job_id,
             artifact_id, object_key, method, content_type, content_length, checksum_sha256,
             expires_at, max_uses, used_count, state, retention_class, deletion_owner_account_id,
             created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PUT', 'image/png', $10, $11, $12, 1, 1,
                     'COMMITTED', 'PROJECT', $2, $13, $13)
           ON CONFLICT (id) DO NOTHING`,
          [
            reservationId,
            bound.account_id,
            bound.workspace_id,
            bound.project_id,
            bound.project_revision_id,
            bound.lane === "mage_image" ? "MAGE_IMAGE" : "SOULX_AVATAR",
            attemptId,
            item.item_id,
            item.output_object_key,
            item.output_bytes,
            item.output_sha256,
            expiresAt,
            now,
          ],
        );
        await transaction.query(
          `INSERT INTO artifact_receipts (
             id, account_id, workspace_id, reservation_id, callback_id, object_key, content_type,
             content_length, checksum_sha256, probe, receipt_sha256, committed_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'image/png', $7, $8, $9::jsonb, $10, $11)
           ON CONFLICT (id) DO NOTHING`,
          [
            receiptId,
            bound.account_id,
            bound.workspace_id,
            reservationId,
            `callback:${attemptId}:${item.item_id}`,
            item.output_object_key,
            item.output_bytes,
            item.output_sha256,
            JSON.stringify(item.probe),
            receiptSha256,
            now,
          ],
        );
      });
      hashes.push(receiptSha256);
    }
    return hashes;
  }

  #project(publicProjectId: string, view: VideoRuntimeView): VideoRuntimeStageView {
    return Object.freeze({
      publicProjectId,
      stage: view.stage,
      terminalReason: view.terminalReason,
      lanes: view.lanes,
      finalOutputSha256: view.finalOutputSha256,
      providerCallsAuthorized: false as const,
      authorizedSpendUsd: 0 as const,
      settledCostUsd: 0 as const,
    });
  }
}
