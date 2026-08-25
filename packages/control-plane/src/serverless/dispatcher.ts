import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import { TENANT_PRINCIPAL_SETTING } from "../database/vocabulary.js";
import type { Sha256, WorkspaceScope } from "../repositories/types.js";
import {
  buildPredispatchAuthority,
  canonicalSha256,
  digestUtf8,
  mintDispatchToken,
  type PredispatchAuthorityRecord,
  type PredispatchDeploymentBinding,
  type V2ProviderAuthority,
} from "./authority.js";
import {
  ReceiptVerificationError,
  verifyProvenanceReceipt,
  type ProvenanceReceipt,
  type ProvenanceReceiptSigner,
} from "./receipts.js";
import { assertDispatchableEnvelope } from "./quarantine.js";
import {
  FakeTransportError,
  ServerlessTransportError,
  type ServerlessProviderStatus,
  type ServerlessTransportPort,
  type FakeWebhookDelivery,
} from "./transport.js";

export type ServerlessLane = "mage_image" | "soulx_avatar";

export type ServerlessDispatchErrorCode =
  | "ASSIGNMENT_CONFLICT"
  | "ASSIGNMENT_REQUIRED"
  | "ARTIFACT_RECEIPT_MISMATCH"
  | "ATTEMPT_NOT_FOUND"
  | "CALLBACK_UNAUTHENTICATED"
  | "DEPLOYMENT_NOT_FOUND"
  | "DISPATCH_NOT_PERMITTED"
  | "ENDPOINT_BINDING_MISMATCH"
  | "OUTBOX_NOT_SENDABLE"
  | "REQUEST_BODY_MISMATCH"
  | "SPEND_CEILING_EXCEEDED"
  | "TENANT_SCOPE_MISMATCH";

export class ServerlessDispatchError extends Error {
  constructor(
    readonly code: ServerlessDispatchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ServerlessDispatchError";
  }
}

export interface EndpointDeploymentInput {
  readonly deploymentId: string;
  readonly lane: ServerlessLane;
  readonly endpointProfileId: string;
  readonly endpointIdSha256: Sha256;
  readonly endpointConfigSha256: Sha256;
  readonly workerImageDigest: Sha256;
  readonly modelManifestSha256: Sha256;
  readonly volumeIdSha256: Sha256;
  readonly volumeManifestSha256: Sha256;
  readonly idleTimeoutSeconds: number;
  readonly initTimeoutSeconds: number;
  readonly executionTimeoutSeconds: number;
  readonly requestTtlSeconds: number;
  readonly reconciliationDeadlineSeconds: number;
  readonly pollingIntervalSeconds: number;
  readonly maxReplacementAttempts: number;
  readonly timeoutEvidence: Readonly<Record<string, unknown>>;
  readonly deploymentVersion: number;
  readonly createdAt: string;
}

export interface EndpointDeploymentRow extends Record<string, unknown> {
  readonly id: string;
  readonly lane: ServerlessLane;
  readonly endpoint_profile_id: string;
  readonly endpoint_id_sha256: Sha256;
  readonly endpoint_config_sha256: Sha256;
  readonly worker_image_digest: Sha256;
  readonly model_manifest_sha256: Sha256;
  readonly volume_id_sha256: Sha256;
  readonly volume_manifest_sha256: Sha256;
  readonly init_timeout_seconds: number;
  readonly execution_timeout_seconds: number;
  readonly request_ttl_seconds: number;
  readonly reconciliation_deadline_seconds: number;
  readonly polling_interval_seconds: number;
}

export interface CommitPredispatchInput {
  readonly attemptId: string;
  readonly authorityId: string;
  readonly outboxId: string;
  readonly ledgerId: string;
  readonly costEventId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly taskId: string;
  readonly lane: ServerlessLane;
  readonly attemptOrdinal: number;
  readonly itemsManifestSha256: Sha256;
  readonly itemCount: number;
  readonly inputManifestSha256: Sha256;
  readonly outputPrefix: string;
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly requestBody: Readonly<Record<string, unknown>>;
  readonly spendCeilingUsd: number;
  readonly reservationUsd: number;
  readonly rateSource: string;
  readonly rateCheckedAt: string;
  readonly now: string;
  readonly checkpointAuthority: V2ProviderAuthority;
  /** Test/recovery injection proving the whole predispatch commit rolls back together. */
  readonly beforeCommit?: () => void | Promise<void>;
}

export interface PredispatchCommit {
  readonly attemptId: string;
  readonly dispatchToken: string;
  readonly dispatchTokenSha256: Sha256;
  readonly outboxId: string;
  readonly endpointIdSha256: Sha256;
  readonly requestBodySha256: Sha256;
  readonly outputPrefix: string;
  readonly authority: PredispatchAuthorityRecord;
  readonly deadlineAt: string;
  readonly reconciliationDeadlineAt: string;
  readonly requestTtlSeconds: number;
}

export type DispatchOutcome =
  | { readonly kind: "ASSIGNED"; readonly providerJobId: string; readonly assignmentId: string }
  | { readonly kind: "DISPATCH_ACK_UNKNOWN" };

export type ReconciliationOutcome =
  | "UNIQUE_ASSIGNMENT_PROVED"
  | "NO_ASSIGNMENT_PROVED"
  | "TERMINAL_CONFIRMED"
  | "AMBIGUOUS_STOP";

export type OutputAcceptance =
  | "ACCEPTED_CANONICAL"
  | "QUARANTINED_DUPLICATE"
  | "QUARANTINED_FOREIGN"
  | "QUARANTINED_SUPERSEDED"
  | "QUARANTINED_UNBOUND";

const PROVIDER_RESULT_WINDOW_SECONDS = 1800;
const TERMINAL_ATTEMPT_STATES = ["SUCCEEDED", "PERMANENT_FAILED", "CANCELLED"] as const;

function isoPlusSeconds(now: string, seconds: number): string {
  return new Date(Date.parse(now) + seconds * 1000).toISOString();
}

async function bindPrincipal(executor: SqlExecutor, accountId: string): Promise<void> {
  await executor.query(`SELECT set_config($1, $2, true)`, [TENANT_PRINCIPAL_SETTING, accountId]);
}

async function assertScope(executor: SqlExecutor, scope: WorkspaceScope): Promise<void> {
  const result = await executor.query<{ present: boolean } & Record<string, unknown>>(
    `SELECT EXISTS (
       SELECT 1 FROM workspaces
        WHERE account_id = $1 AND id = $2 AND status = 'ACTIVE' AND is_default
     ) AS present`,
    [scope.accountId, scope.workspaceId],
  );
  if (result.rows[0]?.present !== true) {
    throw new ServerlessDispatchError(
      "TENANT_SCOPE_MISMATCH",
      "The authenticated account does not own this active default workspace.",
    );
  }
  await bindPrincipal(executor, scope.accountId);
}

interface AttemptRow extends Record<string, unknown> {
  readonly id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly project_revision_id: string;
  readonly deployment_id: string;
  readonly lane: ServerlessLane;
  readonly state: string;
  readonly dispatch_token_sha256: Sha256;
  readonly item_count: number;
  readonly output_prefix: string;
  readonly deadline_at: string;
  readonly reconciliation_deadline_at: string;
  readonly possible_duplicate_executions: number;
  readonly possible_duplicate_cost_usd: string;
  readonly version: number;
  readonly created_at: string;
  readonly ttl_expires_at: string | null;
  readonly provider_terminal_observed_at: string | null;
  readonly provider_result_expires_at: string | null;
}

interface AssignmentRow extends Record<string, unknown> {
  readonly id: string;
  readonly provider_job_id: string;
  readonly worker_id: string | null;
  readonly is_current: boolean;
}

/**
 * Provider-free Serverless v3 dispatch, assignment, progress, acceptance, cancellation, and
 * reconciliation.
 *
 * The service guarantees at most one accepted canonical output per attempt. It never claims the
 * provider executed or billed exactly once, and it keeps any bounded duplicate compute visible.
 */
export class ServerlessDispatchService {
  readonly #database: TransactionalSqlExecutor;
  readonly #signer: ProvenanceReceiptSigner;

  constructor(database: TransactionalSqlExecutor, signer: ProvenanceReceiptSigner) {
    this.#database = database;
    this.#signer = signer;
  }

  async publishEndpointDeployment(input: EndpointDeploymentInput): Promise<void> {
    const record = {
      deployment_id: input.deploymentId,
      lane: input.lane,
      endpoint_id_sha256: input.endpointIdSha256,
      endpoint_config_sha256: input.endpointConfigSha256,
      worker_image_digest: input.workerImageDigest,
      model_manifest_sha256: input.modelManifestSha256,
      volume_id_sha256: input.volumeIdSha256,
      volume_manifest_sha256: input.volumeManifestSha256,
      deployment_version: input.deploymentVersion,
    };
    await this.#database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE serverless_endpoint_deployments
            SET is_active = false
          WHERE lane = $1 AND is_active`,
        [input.lane],
      );
      await transaction.query(
        `INSERT INTO serverless_endpoint_deployments (
           id, lane, endpoint_profile_id, endpoint_id_sha256, endpoint_config_sha256,
           worker_image_digest, model_manifest_sha256, region, volume_id_sha256,
           volume_manifest_sha256, volume_mount, volume_size_gb, gpu_allowlist,
           gpu_count_per_worker, worker_count_min, worker_count_max, worker_ceiling_scope,
           retained_active_workers, scaler_type, scaler_value, handler_concurrency,
           idle_timeout_seconds, init_timeout_seconds, execution_timeout_seconds,
           request_ttl_seconds, request_ttl_scope, reconciliation_deadline_seconds,
           provider_result_window_seconds, polling_interval_seconds, max_replacement_attempts,
           blind_resubmit_permitted, timeout_evidence, deployment_version, is_active,
           record_sha256, created_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, 'EU-RO-1', $8, $9, '/runpod-volume', 50,
           ARRAY['NVIDIA GeForce RTX 4090']::text[], 1, 0, 2, 'ACTIVE_PLUS_FLEX', 0,
           'REQUEST_COUNT', 1, 1, $10, $11, $12, $13,
           'PROVIDER_QUEUE_PLUS_EXECUTION_PLUS_OUTPUT_UPLOAD', $14, $15, $16, $17, false,
           $18::jsonb, $19, true, $20, $21
         )`,
        [
          input.deploymentId,
          input.lane,
          input.endpointProfileId,
          input.endpointIdSha256,
          input.endpointConfigSha256,
          input.workerImageDigest,
          input.modelManifestSha256,
          input.volumeIdSha256,
          input.volumeManifestSha256,
          input.idleTimeoutSeconds,
          input.initTimeoutSeconds,
          input.executionTimeoutSeconds,
          input.requestTtlSeconds,
          input.reconciliationDeadlineSeconds,
          PROVIDER_RESULT_WINDOW_SECONDS,
          input.pollingIntervalSeconds,
          input.maxReplacementAttempts,
          JSON.stringify(input.timeoutEvidence),
          input.deploymentVersion,
          canonicalSha256(record),
          input.createdAt,
        ],
      );
    });
  }

  async activeDeployment(lane: ServerlessLane): Promise<EndpointDeploymentRow> {
    const result = await this.#database.query<EndpointDeploymentRow>(
      `SELECT * FROM serverless_endpoint_deployments WHERE lane = $1 AND is_active`,
      [lane],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ServerlessDispatchError(
        "DEPLOYMENT_NOT_FOUND",
        `No active endpoint deployment is published for lane ${lane}.`,
      );
    }
    return row;
  }

  /**
   * Commits the durable predispatch authority, attempt, transactional outbox row, and cost
   * reservation in one transaction. No transport call exists until this commit succeeds.
   */
  async commitPredispatch(
    scope: WorkspaceScope,
    input: CommitPredispatchInput,
  ): Promise<PredispatchCommit> {
    const deployment = await this.activeDeployment(input.lane);
    const dispatchToken = mintDispatchToken();
    const dispatchTokenSha256 = digestUtf8(dispatchToken);
    const requestBodySha256 = canonicalSha256(input.requestBody);
    const deadlineAt = isoPlusSeconds(input.now, deployment.request_ttl_seconds);
    const reconciliationDeadlineAt = isoPlusSeconds(
      input.now,
      Math.min(deployment.reconciliation_deadline_seconds, deployment.request_ttl_seconds),
    );

    const binding: PredispatchDeploymentBinding = {
      deploymentId: deployment.id,
      endpointIdSha256: deployment.endpoint_id_sha256,
      endpointConfigSha256: deployment.endpoint_config_sha256,
      workerImageDigest: deployment.worker_image_digest,
      modelManifestSha256: deployment.model_manifest_sha256,
      volumeIdSha256: deployment.volume_id_sha256,
      volumeManifestSha256: deployment.volume_manifest_sha256,
      region: "EU-RO-1",
      volumeMount: "/runpod-volume",
      gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
    };

    const authority = buildPredispatchAuthority({
      authorityId: input.authorityId,
      dispatchToken,
      checkpointAuthority: input.checkpointAuthority,
      scope,
      work: {
        projectId: input.projectId,
        projectRevisionId: input.projectRevisionId,
        generationRequestId: input.generationRequestId,
        taskId: input.taskId,
        attemptId: input.attemptId,
        lane: input.lane,
        laneBatchOrdinal: input.attemptOrdinal,
        itemsManifestSha256: input.itemsManifestSha256,
        itemCount: input.itemCount,
      },
      deployment: binding,
      inputs: {
        inputManifestSha256: input.inputManifestSha256,
        requestBodySha256,
        outputPrefix: input.outputPrefix,
        maxInputBytes: input.maxInputBytes,
        maxOutputBytes: input.maxOutputBytes,
      },
      limits: {
        deadlineAt,
        requestTtlSeconds: deployment.request_ttl_seconds,
        executionTimeoutSeconds: deployment.execution_timeout_seconds,
        initTimeoutSeconds: deployment.init_timeout_seconds,
        reconciliationDeadlineAt,
      },
      spend: {
        ceilingUsd: input.spendCeilingUsd,
        reservationUsd: input.reservationUsd,
        rateSource: input.rateSource,
        rateCheckedAt: input.rateCheckedAt,
      },
      committedAt: input.now,
    });

    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      await transaction.query(
        `INSERT INTO serverless_attempts (
           id, account_id, workspace_id, project_id, project_revision_id, generation_request_id,
           task_id, deployment_id, lane, attempt_ordinal, state, dispatch_token_sha256,
           items_manifest_sha256, item_count, input_manifest_sha256, output_prefix, deadline_at,
           reconciliation_deadline_at, created_at, updated_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PLANNED', $11, $12, $13, $14, $15, $16, $17,
           $18, $18
         )`,
        [
          input.attemptId,
          scope.accountId,
          scope.workspaceId,
          input.projectId,
          input.projectRevisionId,
          input.generationRequestId,
          input.taskId,
          deployment.id,
          input.lane,
          input.attemptOrdinal,
          dispatchTokenSha256,
          input.itemsManifestSha256,
          input.itemCount,
          input.inputManifestSha256,
          input.outputPrefix,
          deadlineAt,
          reconciliationDeadlineAt,
          input.now,
        ],
      );

      await transaction.query(
        `INSERT INTO serverless_predispatch_authorities (
           id, account_id, workspace_id, project_revision_id, attempt_id, dispatch_token_sha256,
           checkpoint_id, authority_mode, non_transferable, allowed_operations, deployment_id,
           endpoint_id_sha256, endpoint_config_sha256, worker_image_digest, model_manifest_sha256,
           volume_id_sha256, volume_manifest_sha256, region, gpu_allowlist, items_manifest_sha256,
           input_manifest_sha256, request_body_sha256, envelope_sha256, deadline_at,
           reconciliation_deadline_at, request_ttl_seconds, execution_timeout_seconds,
           init_timeout_seconds, spend_ceiling_usd, reservation_usd, rate_source, rate_checked_at,
           fixed_retained_volume_usd_excluded, authority_sha256, committed_at
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, true,
           ARRAY['serverless_run', 'serverless_status', 'serverless_cancel']::text[], $9, $10, $11,
           $12, $13, $14, $15, 'EU-RO-1', ARRAY['NVIDIA GeForce RTX 4090']::text[], $16, $17, $18,
           $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, true, $29, $30
         )`,
        [
          input.authorityId,
          scope.accountId,
          scope.workspaceId,
          input.projectRevisionId,
          input.attemptId,
          dispatchTokenSha256,
          input.checkpointAuthority.checkpointId,
          input.checkpointAuthority.mode === "none"
            ? "provider_free_fixture"
            : input.checkpointAuthority.mode,
          deployment.id,
          deployment.endpoint_id_sha256,
          deployment.endpoint_config_sha256,
          deployment.worker_image_digest,
          deployment.model_manifest_sha256,
          deployment.volume_id_sha256,
          deployment.volume_manifest_sha256,
          input.itemsManifestSha256,
          input.inputManifestSha256,
          requestBodySha256,
          canonicalSha256(authority.document),
          deadlineAt,
          reconciliationDeadlineAt,
          deployment.request_ttl_seconds,
          deployment.execution_timeout_seconds,
          deployment.init_timeout_seconds,
          input.spendCeilingUsd,
          input.reservationUsd,
          input.rateSource,
          input.rateCheckedAt,
          authority.authoritySha256,
          input.now,
        ],
      );

      await transaction.query(
        `INSERT INTO serverless_dispatch_outbox (
           id, account_id, workspace_id, project_revision_id, attempt_id, dispatch_token_sha256,
           authority_sha256, request_body_sha256, state, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'READY_TO_DISPATCH', $9, $9)`,
        [
          input.outboxId,
          scope.accountId,
          scope.workspaceId,
          input.projectRevisionId,
          input.attemptId,
          dispatchTokenSha256,
          authority.authoritySha256,
          requestBodySha256,
          input.now,
        ],
      );

      await transaction.query(
        `INSERT INTO serverless_cost_ledgers (
           id, account_id, workspace_id, project_revision_id, attempt_id, owner_type, owner_id,
           ceiling_usd, estimated_usd, reserved_usd, fixed_retained_volume_usd_excluded,
           updated_at
         ) VALUES ($1, $2, $3, $4, $5, 'PROJECT_REVISION', $4, $6, $7, $7, true, $8)`,
        [
          input.ledgerId,
          scope.accountId,
          scope.workspaceId,
          input.projectRevisionId,
          input.attemptId,
          input.spendCeilingUsd,
          input.reservationUsd,
          input.now,
        ],
      );

      await transaction.query(
        `INSERT INTO serverless_cost_events (
           id, account_id, workspace_id, project_revision_id, attempt_id, ledger_id, sequence,
           kind, amount_usd, rate_source, rate_checked_at, confidence, recorded_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 1, 'RESERVATION', $7, $8, $9, 'ESTIMATED', $10)`,
        [
          input.costEventId,
          scope.accountId,
          scope.workspaceId,
          input.projectRevisionId,
          input.attemptId,
          input.ledgerId,
          input.reservationUsd,
          input.rateSource,
          input.rateCheckedAt,
          input.now,
        ],
      );

      await transaction.query(
        `UPDATE serverless_attempts
            SET state = 'OUTBOXED', version = version + 1, updated_at = $2
          WHERE id = $1`,
        [input.attemptId, input.now],
      );

      if (input.beforeCommit !== undefined) await input.beforeCommit();
    });

    return Object.freeze({
      attemptId: input.attemptId,
      dispatchToken,
      dispatchTokenSha256,
      outboxId: input.outboxId,
      endpointIdSha256: deployment.endpoint_id_sha256,
      requestBodySha256,
      outputPrefix: input.outputPrefix,
      authority,
      deadlineAt,
      reconciliationDeadlineAt,
      requestTtlSeconds: deployment.request_ttl_seconds,
    });
  }

  /**
   * Leases the outbox row, sends once, and binds the returned provider job identifier. A lost
   * response becomes `DISPATCH_ACK_UNKNOWN`; it is never treated as proof that no job was created
   * and never triggers a blind resubmission.
   */
  async dispatchOnce(
    scope: WorkspaceScope,
    input: {
      readonly commit: PredispatchCommit;
      readonly endpoint: ServerlessTransportPort;
      readonly endpointIdSha256: Sha256;
      readonly envelope: Readonly<Record<string, unknown>>;
      readonly requestBodySha256: Sha256;
      readonly assignmentId: string;
      readonly leaseId: string;
      readonly holderSha256: Sha256;
      readonly now: string;
      readonly leaseSeconds?: number;
    },
  ): Promise<DispatchOutcome> {
    // A superseded Pod-era envelope fails closed before the outbox row is ever leased.
    assertDispatchableEnvelope(input.envelope);
    if (input.endpointIdSha256 !== input.commit.endpointIdSha256) {
      throw new ServerlessDispatchError(
        "ENDPOINT_BINDING_MISMATCH",
        "The transport endpoint does not match the committed predispatch endpoint.",
      );
    }
    if (input.requestBodySha256 !== input.commit.requestBodySha256) {
      throw new ServerlessDispatchError(
        "REQUEST_BODY_MISMATCH",
        "The transport request bytes do not match the committed predispatch request hash.",
      );
    }

    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const leased = await transaction.query(
        `UPDATE serverless_dispatch_outbox
            SET state = 'LEASED', lease_id = $2, lease_holder_sha256 = $3, leased_at = $4,
                lease_expires_at = $5, version = version + 1, updated_at = $4
          WHERE id = $1 AND state = 'READY_TO_DISPATCH'`,
        [
          input.commit.outboxId,
          input.leaseId,
          input.holderSha256,
          input.now,
          isoPlusSeconds(input.now, input.leaseSeconds ?? 120),
        ],
      );
      if (leased.affectedRows !== 1) {
        throw new ServerlessDispatchError(
          "OUTBOX_NOT_SENDABLE",
          "Only a READY_TO_DISPATCH outbox row can be leased for a single send.",
        );
      }
      await transaction.query(
        `UPDATE serverless_dispatch_outbox
            SET state = 'SENT', send_attempt_count = 1, version = version + 1, updated_at = $2
          WHERE id = $1`,
        [input.commit.outboxId, input.now],
      );
      await transaction.query(
        `UPDATE serverless_attempts
            SET state = 'DISPATCHING', submitted_at = $2, ttl_expires_at = $3,
                version = version + 1, updated_at = $2
          WHERE id = $1`,
        [
          input.commit.attemptId,
          input.now,
          isoPlusSeconds(input.now, input.commit.requestTtlSeconds),
        ],
      );
    });

    let providerJobId: string;
    try {
      const response = await input.endpoint.run({
        endpointIdSha256: input.endpointIdSha256,
        dispatchToken: input.commit.dispatchToken,
        requestBodySha256: input.requestBodySha256,
        envelope: input.envelope,
      });
      if (typeof response.id !== "string" || response.id.length === 0) {
        throw new ServerlessDispatchError(
          "ASSIGNMENT_CONFLICT",
          "The provider run response did not contain a usable job identifier.",
        );
      }
      providerJobId = response.id;
    } catch (error) {
      const acknowledgementUnknown =
        (error instanceof FakeTransportError && error.code === "TRANSPORT_RESPONSE_LOST") ||
        (error instanceof ServerlessTransportError && error.code === "DISPATCH_ACK_UNKNOWN");
      const definitelyRejected =
        error instanceof ServerlessTransportError && error.code === "REQUEST_REJECTED";
      if (definitelyRejected) {
        // The provider proved no job was created. Preserve the one-send invariant, but do not
        // strand a plain SENT/DISPATCHING row that restart logic could mistake for ambiguity.
        await this.#database.transaction(async (transaction) => {
          await assertScope(transaction, scope);
          await transaction.query(
            `UPDATE serverless_dispatch_outbox
                SET state = 'DEAD_LETTER', version = version + 1, updated_at = $2
              WHERE id = $1 AND state = 'SENT'`,
            [input.commit.outboxId, input.now],
          );
          await transaction.query(
            `UPDATE serverless_attempts
                SET state = 'PERMANENT_FAILED', terminal_at = $2,
                    version = version + 1, updated_at = $2
              WHERE id = $1 AND state = 'DISPATCHING'`,
            [input.commit.attemptId, input.now],
          );
        });
        throw error;
      }
      if (!acknowledgementUnknown) {
        throw error;
      }
      await this.#database.transaction(async (transaction) => {
        await assertScope(transaction, scope);
        await transaction.query(
          `UPDATE serverless_dispatch_outbox
              SET state = 'DISPATCH_ACK_UNKNOWN', version = version + 1, updated_at = $2
            WHERE id = $1`,
          [input.commit.outboxId, input.now],
        );
        await transaction.query(
          `UPDATE serverless_attempts
              SET state = 'RECONCILING', version = version + 1, updated_at = $2
            WHERE id = $1`,
          [input.commit.attemptId, input.now],
        );
      });
      return { kind: "DISPATCH_ACK_UNKNOWN" };
    }

    await this.#bindAssignment(scope, {
      attemptId: input.commit.attemptId,
      projectRevisionId: await this.#revisionOf(input.commit.attemptId),
      outboxId: input.commit.outboxId,
      dispatchTokenSha256: input.commit.dispatchTokenSha256,
      assignmentId: input.assignmentId,
      providerJobId,
      source: "RUN_RESPONSE",
      workerId: null,
      now: input.now,
    });
    return { kind: "ASSIGNED", providerJobId, assignmentId: input.assignmentId };
  }

  async #revisionOf(attemptId: string): Promise<string> {
    const result = await this.#database.query<AttemptRow>(
      `SELECT project_revision_id FROM serverless_attempts WHERE id = $1`,
      [attemptId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ServerlessDispatchError("ATTEMPT_NOT_FOUND", "Unknown Serverless attempt.");
    }
    return row.project_revision_id;
  }

  async #bindAssignment(
    scope: WorkspaceScope,
    input: {
      readonly attemptId: string;
      readonly projectRevisionId: string;
      readonly outboxId: string;
      readonly dispatchTokenSha256: Sha256;
      readonly assignmentId: string;
      readonly providerJobId: string;
      readonly source: "RUN_RESPONSE" | "BOUNDED_RECONCILIATION";
      readonly workerId: string | null;
      readonly now: string;
    },
  ): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      await transaction.query(
        `INSERT INTO serverless_provider_assignments (
           id, account_id, workspace_id, project_revision_id, attempt_id, dispatch_token_sha256,
           provider_job_id, provider_job_id_sha256, assignment_source, worker_id, assigned_at,
           is_current
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, true)`,
        [
          input.assignmentId,
          scope.accountId,
          scope.workspaceId,
          input.projectRevisionId,
          input.attemptId,
          input.dispatchTokenSha256,
          input.providerJobId,
          digestUtf8(input.providerJobId),
          input.source,
          input.workerId,
          input.now,
        ],
      );
      await transaction.query(
        `UPDATE serverless_dispatch_outbox
            SET state = 'ASSIGNED', send_attempt_count = 1, version = version + 1, updated_at = $2
          WHERE id = $1`,
        [input.outboxId, input.now],
      );
      await transaction.query(
        `UPDATE serverless_attempts
            SET state = 'ASSIGNED', version = version + 1, updated_at = $2
          WHERE id = $1 AND state IN ('DISPATCHING', 'RECONCILING')`,
        [input.attemptId, input.now],
      );
    });
  }

  async currentAssignment(attemptId: string): Promise<AssignmentRow | null> {
    const result = await this.#database.query<AssignmentRow>(
      `SELECT id, provider_job_id, worker_id, is_current
         FROM serverless_provider_assignments
        WHERE attempt_id = $1 AND is_current`,
      [attemptId],
    );
    return result.rows[0] ?? null;
  }

  async attempt(attemptId: string): Promise<AttemptRow> {
    const result = await this.#database.query<AttemptRow>(
      `SELECT * FROM serverless_attempts WHERE id = $1`,
      [attemptId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new ServerlessDispatchError("ATTEMPT_NOT_FOUND", "Unknown Serverless attempt.");
    }
    return row;
  }

  /** Records an authoritative polled status observation. */
  async recordPolledStatus(
    scope: WorkspaceScope,
    input: {
      readonly eventId: string;
      readonly attemptId: string;
      readonly providerJobId: string;
      readonly providerStatus: ServerlessProviderStatus;
      readonly attemptState: string;
      readonly itemsCompleted: number;
      readonly observedAt: string;
    },
  ): Promise<void> {
    await this.#recordProgress(scope, { ...input, advisorySource: "POLL_STATUS" });
  }

  /**
   * Ingests one advisory webhook. Its callback token authenticates the caller, the delivery is
   * matched to the current assignment, and it is recorded as non-authoritative. A forged, stale, or
   * unbound callback is rejected without revealing tenant state.
   */
  async ingestWebhook(
    scope: WorkspaceScope,
    input: {
      readonly eventId: string;
      readonly attemptId: string;
      readonly delivery: FakeWebhookDelivery;
      readonly expectedCallbackTokenSha256: Sha256;
      readonly attemptState: string;
      readonly itemsCompleted: number;
      readonly observedAt: string;
    },
  ): Promise<void> {
    if (input.delivery.callbackTokenSha256 !== input.expectedCallbackTokenSha256) {
      throw new ServerlessDispatchError(
        "CALLBACK_UNAUTHENTICATED",
        "The callback token does not authenticate this attempt.",
      );
    }
    const assignment = await this.currentAssignment(input.attemptId);
    if (assignment === null || assignment.provider_job_id !== input.delivery.providerJobId) {
      throw new ServerlessDispatchError(
        "ASSIGNMENT_CONFLICT",
        "The callback names a provider job that is not this attempt's current assignment.",
      );
    }
    await this.#recordProgress(scope, {
      eventId: input.eventId,
      attemptId: input.attemptId,
      providerJobId: input.delivery.providerJobId,
      providerStatus: input.delivery.status,
      attemptState: input.attemptState,
      itemsCompleted: input.itemsCompleted,
      observedAt: input.observedAt,
      advisorySource: "WEBHOOK",
    });
  }

  async #recordProgress(
    scope: WorkspaceScope,
    input: {
      readonly eventId: string;
      readonly attemptId: string;
      readonly providerJobId: string;
      readonly providerStatus: ServerlessProviderStatus;
      readonly attemptState: string;
      readonly itemsCompleted: number;
      readonly observedAt: string;
      readonly advisorySource: "POLL_STATUS" | "WEBHOOK";
    },
  ): Promise<void> {
    const attempt = await this.attempt(input.attemptId);
    const assignment = await this.currentAssignment(input.attemptId);
    if (assignment === null) {
      throw new ServerlessDispatchError(
        "ASSIGNMENT_REQUIRED",
        "Provider status cannot become authoritative before assignment.",
      );
    }
    if (assignment.provider_job_id !== input.providerJobId) {
      throw new ServerlessDispatchError(
        "ASSIGNMENT_CONFLICT",
        "Provider status names a job that is not the current assignment.",
      );
    }
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const next = await transaction.query<{ next: string } & Record<string, unknown>>(
        `SELECT coalesce(max(sequence), 0) + 1 AS next
           FROM serverless_progress_events WHERE attempt_id = $1`,
        [input.attemptId],
      );
      await transaction.query(
        `INSERT INTO serverless_progress_events (
           id, account_id, workspace_id, project_revision_id, attempt_id, assignment_id, sequence,
           advisory_source, authoritative, provider_status, attempt_state, items_completed,
           items_total, observed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          input.eventId,
          scope.accountId,
          scope.workspaceId,
          attempt.project_revision_id,
          input.attemptId,
          assignment.id,
          Number(next.rows[0]?.next ?? 1),
          input.advisorySource,
          input.advisorySource === "POLL_STATUS",
          input.providerStatus,
          input.attemptState,
          input.itemsCompleted,
          attempt.item_count,
          input.observedAt,
        ],
      );
      if (input.advisorySource === "POLL_STATUS") {
        const providerTerminal = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(
          input.providerStatus,
        );
        await transaction.query(
          `UPDATE serverless_attempts
              SET state = $2,
                  provider_terminal_observed_at = CASE
                    WHEN $4 AND provider_terminal_observed_at IS NULL THEN $3::timestamptz
                    ELSE provider_terminal_observed_at
                  END,
                  provider_result_expires_at = CASE
                    WHEN $4 AND provider_result_expires_at IS NULL
                      THEN $3::timestamptz + interval '1800 seconds'
                    ELSE provider_result_expires_at
                  END,
                  version = version + 1, updated_at = $3
            WHERE id = $1 AND state NOT IN ('SUCCEEDED', 'PERMANENT_FAILED', 'CANCELLED')`,
          [input.attemptId, input.attemptState, input.observedAt, providerTerminal],
        );
      }
    });
  }

  /**
   * Verifies one signed provenance receipt and, when it is canonical, records the single accepted
   * durable output. Duplicate, foreign, superseded, and unbound deliveries are quarantined instead.
   */
  async acceptOutput(
    scope: WorkspaceScope,
    input: {
      readonly outputReceiptId: string;
      readonly provenanceRowId: string;
      readonly attemptId: string;
      readonly receipt: ProvenanceReceipt;
      readonly artifactCommitReceiptSha256s: readonly Sha256[];
      readonly now: string;
    },
  ): Promise<OutputAcceptance> {
    const attempt = await this.attempt(input.attemptId);
    const assignment = await this.currentAssignment(input.attemptId);
    if (assignment === null) {
      await this.#quarantine(scope, input, attempt, "QUARANTINED_UNBOUND", "no current assignment");
      return "QUARANTINED_UNBOUND";
    }
    if (
      !["ASSIGNED", "IN_QUEUE", "IN_PROGRESS", "UPLOADING", "RECONCILING"].includes(attempt.state)
    ) {
      await this.#quarantine(
        scope,
        input,
        attempt,
        attempt.state === "SUCCEEDED" ? "QUARANTINED_DUPLICATE" : "QUARANTINED_SUPERSEDED",
        `attempt state ${attempt.state} cannot accept output`,
      );
      return attempt.state === "SUCCEEDED" ? "QUARANTINED_DUPLICATE" : "QUARANTINED_SUPERSEDED";
    }
    const deployment = await this.#database.query<EndpointDeploymentRow>(
      `SELECT * FROM serverless_endpoint_deployments WHERE id = $1`,
      [attempt.deployment_id],
    );
    const bound = deployment.rows[0];
    if (bound === undefined) {
      throw new ServerlessDispatchError("DEPLOYMENT_NOT_FOUND", "The bound deployment is missing.");
    }

    const seen = await this.#database.query<{ receipt_nonce: string } & Record<string, unknown>>(
      `SELECT receipt_nonce FROM serverless_provenance_receipts WHERE attempt_id = $1`,
      [input.attemptId],
    );
    try {
      verifyProvenanceReceipt(this.#signer, input.receipt, {
        dispatchTokenSha256: attempt.dispatch_token_sha256,
        attemptId: attempt.id,
        providerJobId: assignment.provider_job_id,
        accountId: scope.accountId,
        workspaceId: scope.workspaceId,
        deploymentId: bound.id,
        endpointIdSha256: bound.endpoint_id_sha256,
        containerDigest: bound.worker_image_digest,
        volumeIdSha256: bound.volume_id_sha256,
        volumeManifestSha256: bound.volume_manifest_sha256,
        modelManifestSha256: bound.model_manifest_sha256,
        gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
        seenNonces: new Set(seen.rows.map((row) => Number(row.receipt_nonce))),
      });
    } catch (error) {
      if (!(error instanceof ReceiptVerificationError)) throw error;
      const acceptance: OutputAcceptance =
        error.code === "RECEIPT_NONCE_REPLAYED"
          ? "QUARANTINED_DUPLICATE"
          : error.code === "RECEIPT_TENANT_MISMATCH" ||
              error.code === "RECEIPT_TOKEN_MISMATCH" ||
              error.code === "RECEIPT_ATTEMPT_MISMATCH"
            ? "QUARANTINED_FOREIGN"
            : "QUARANTINED_SUPERSEDED";
      await this.#quarantine(scope, input, attempt, acceptance, error.code);
      return acceptance;
    }

    const existing = await this.#database.query(
      `SELECT 1 FROM serverless_output_receipts
        WHERE attempt_id = $1 AND acceptance = 'ACCEPTED_CANONICAL'`,
      [input.attemptId],
    );
    if (existing.rows.length > 0) {
      await this.#quarantine(
        scope,
        input,
        attempt,
        "QUARANTINED_DUPLICATE",
        "a canonical output is already accepted",
      );
      return "QUARANTINED_DUPLICATE";
    }

    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const locked = await transaction.query<{ state: string } & Record<string, unknown>>(
        `SELECT state FROM serverless_attempts WHERE id = $1 FOR UPDATE`,
        [attempt.id],
      );
      if (
        !["ASSIGNED", "IN_QUEUE", "IN_PROGRESS", "UPLOADING", "RECONCILING"].includes(
          locked.rows[0]?.state ?? "",
        )
      ) {
        throw new ServerlessDispatchError(
          "DISPATCH_NOT_PERMITTED",
          "The attempt became terminal or cancelling before output acceptance committed.",
        );
      }
      await this.#insertProvenance(transaction, scope, attempt, assignment.id, input);
      const artifacts = await this.#validatedOutputArtifacts(
        transaction,
        scope,
        attempt,
        input.receipt,
        input.artifactCommitReceiptSha256s,
      );
      const artifactCommitManifestSha256 = canonicalSha256({
        artifact_commit_receipt_sha256s: [...input.artifactCommitReceiptSha256s].sort(),
      });
      await transaction.query(
        `INSERT INTO serverless_output_receipts (
           id, account_id, workspace_id, project_revision_id, attempt_id, assignment_id, lane,
           acceptance, durable_truth_source, artifacts, provenance_receipt_sha256,
           artifact_commit_receipt_sha256, artifact_commit_receipt_sha256s, accepted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACCEPTED_CANONICAL', 'SIGNED_PRIVATE_R2_RECEIPT',
                   $8::jsonb, $9, $10, $11::jsonb, $12)`,
        [
          input.outputReceiptId,
          scope.accountId,
          scope.workspaceId,
          attempt.project_revision_id,
          attempt.id,
          assignment.id,
          attempt.lane,
          JSON.stringify(artifacts),
          input.receipt.receipt_sha256,
          artifactCommitManifestSha256,
          JSON.stringify([...input.artifactCommitReceiptSha256s].sort()),
          input.now,
        ],
      );
      await transaction.query(
        `UPDATE serverless_attempts
            SET state = 'SUCCEEDED', terminal_at = $2, version = version + 1, updated_at = $2
          WHERE id = $1`,
        [attempt.id, input.now],
      );
    });
    return "ACCEPTED_CANONICAL";
  }

  async #validatedOutputArtifacts(
    executor: SqlExecutor,
    scope: WorkspaceScope,
    attempt: AttemptRow,
    receipt: ProvenanceReceipt,
    receiptSha256s: readonly Sha256[],
  ): Promise<readonly Readonly<Record<string, unknown>>[]> {
    const uniqueReceiptHashes = new Set(receiptSha256s);
    const uniqueItems = new Set(receipt.items.map((item) => item.item_id));
    if (
      receiptSha256s.length !== attempt.item_count ||
      uniqueReceiptHashes.size !== attempt.item_count ||
      receipt.items.length !== attempt.item_count ||
      uniqueItems.size !== attempt.item_count ||
      receipt.items.some(
        (item) =>
          item.state !== "SUCCEEDED" ||
          item.output_object_key === null ||
          item.output_sha256 === null ||
          !Number.isSafeInteger(item.output_bytes) ||
          item.output_bytes < 0,
      )
    ) {
      throw new ServerlessDispatchError(
        "ARTIFACT_RECEIPT_MISMATCH",
        "Canonical output requires one successful signed item and one unique commit receipt per batch item.",
      );
    }

    const result = await executor.query<
      {
        receipt_sha256: Sha256;
        object_key: string;
        content_length: string;
        checksum_sha256: Sha256;
        probe: Readonly<Record<string, boolean | number | string | null>>;
        artifact_id: string;
        project_revision_id: string;
        lane: string;
        job_id: string;
      } & Record<string, unknown>
    >(
      `SELECT receipt.receipt_sha256, receipt.object_key, receipt.content_length,
              receipt.checksum_sha256, receipt.probe, reservation.artifact_id,
              reservation.project_revision_id, reservation.lane, reservation.job_id
         FROM artifact_receipts AS receipt
         JOIN artifact_reservations AS reservation
           ON reservation.account_id = receipt.account_id
          AND reservation.workspace_id = receipt.workspace_id
          AND reservation.id = receipt.reservation_id
        WHERE receipt.account_id = $1
          AND receipt.workspace_id = $2
          AND receipt.receipt_sha256 IN (SELECT jsonb_array_elements_text($3::jsonb))
          AND receipt.deleted_at IS NULL`,
      [scope.accountId, scope.workspaceId, JSON.stringify(receiptSha256s)],
    );
    if (result.rows.length !== attempt.item_count) {
      throw new ServerlessDispatchError(
        "ARTIFACT_RECEIPT_MISMATCH",
        "Every canonical artifact must resolve to one live tenant-owned durable commit receipt.",
      );
    }

    const expectedLane = attempt.lane === "mage_image" ? "MAGE_IMAGE" : "SOULX_AVATAR";
    const byItem = new Map(receipt.items.map((item) => [item.item_id, item]));
    const artifacts = result.rows.map((row) => {
      const signed = byItem.get(row.artifact_id);
      if (
        signed === undefined ||
        row.project_revision_id !== attempt.project_revision_id ||
        row.lane !== expectedLane ||
        row.job_id !== attempt.id ||
        row.object_key !== `${attempt.output_prefix}/artifact/${row.artifact_id}` ||
        signed.output_object_key !== row.object_key ||
        signed.output_sha256 !== row.checksum_sha256 ||
        signed.output_bytes !== Number(row.content_length) ||
        canonicalSha256(signed.probe) !== canonicalSha256(row.probe)
      ) {
        throw new ServerlessDispatchError(
          "ARTIFACT_RECEIPT_MISMATCH",
          "Durable artifact identity, lineage, checksum, bytes, or probe differs from the signed worker facts.",
        );
      }
      return {
        item_id: row.artifact_id,
        object_key: row.object_key,
        content_length: Number(row.content_length),
        checksum_sha256: row.checksum_sha256,
        probe: row.probe,
        artifact_commit_receipt_sha256: row.receipt_sha256,
      } as const;
    });
    return artifacts.sort((left, right) =>
      String(left.item_id).localeCompare(String(right.item_id)),
    );
  }

  async #insertProvenance(
    transaction: SqlExecutor,
    scope: WorkspaceScope,
    attempt: AttemptRow,
    assignmentId: string,
    input: {
      readonly provenanceRowId: string;
      readonly receipt: ProvenanceReceipt;
      readonly now: string;
    },
  ): Promise<void> {
    const receipt = input.receipt;
    await transaction.query(
      `INSERT INTO serverless_provenance_receipts (
         id, account_id, workspace_id, project_revision_id, attempt_id, assignment_id,
         receipt_nonce, attestation_scope, worker_id, provider_job_id, gpu_name, gpu_uuid_sha256,
         driver_version, cuda_version, intended_region, intended_volume_id_sha256,
         manifest_sha256_before, manifest_sha256_after, mutation_detected, cross_mount_detected,
         model_ready, timings, items, receipt_sha256, signature_key_id, signature_value,
         issued_at, accepted_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'EU-RO-1', $15, $16,
                 $17, false, false, true, $18::jsonb, $19::jsonb, $20, $21, $22, $23, $24)`,
      [
        input.provenanceRowId,
        scope.accountId,
        scope.workspaceId,
        attempt.project_revision_id,
        attempt.id,
        assignmentId,
        receipt.receipt_nonce,
        receipt.attestation_scope,
        receipt.worker_id,
        receipt.provider_job_id,
        receipt.runtime_probe.gpu_name,
        receipt.runtime_probe.gpu_uuid_sha256,
        receipt.runtime_probe.driver_version,
        receipt.runtime_probe.cuda_version,
        receipt.deployment.intended_volume_id_sha256,
        receipt.volume_verification.manifest_sha256_before,
        receipt.volume_verification.manifest_sha256_after,
        JSON.stringify(receipt.timings),
        JSON.stringify(receipt.items),
        receipt.receipt_sha256,
        receipt.signature.key_id,
        receipt.signature.value,
        receipt.issued_at,
        input.now,
      ],
    );
  }

  async #quarantine(
    scope: WorkspaceScope,
    input: {
      readonly outputReceiptId: string;
      readonly receipt: ProvenanceReceipt;
      readonly artifactCommitReceiptSha256s: readonly Sha256[];
      readonly now: string;
    },
    attempt: AttemptRow,
    acceptance: OutputAcceptance,
    reason: string,
  ): Promise<void> {
    const assignment = await this.currentAssignment(attempt.id);
    if (assignment === null) return;
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      await transaction.query(
        `INSERT INTO serverless_output_receipts (
           id, account_id, workspace_id, project_revision_id, attempt_id, assignment_id, lane,
           acceptance, durable_truth_source, artifacts, provenance_receipt_sha256,
           artifact_commit_receipt_sha256, artifact_commit_receipt_sha256s,
           quarantine_reason, accepted_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'SIGNED_PRIVATE_R2_RECEIPT', '[]'::jsonb, $9,
                   $10, $11::jsonb, $12, $13)`,
        [
          input.outputReceiptId,
          scope.accountId,
          scope.workspaceId,
          attempt.project_revision_id,
          attempt.id,
          assignment.id,
          attempt.lane,
          acceptance,
          input.receipt.receipt_sha256,
          canonicalSha256({
            artifact_commit_receipt_sha256s: [...input.artifactCommitReceiptSha256s].sort(),
          }),
          JSON.stringify([...input.artifactCommitReceiptSha256s].sort()),
          reason,
          input.now,
        ],
      );
    });
  }

  /**
   * Bounded reconciliation inside the provider's asynchronous result window.
   *
   * A durable signed receipt is the only evidence that can resolve a lost `/run` response into a
   * unique assignment. When nothing proves uniqueness before the deadline the attempt stops,
   * records its possible duplicate compute, and refuses further dispatch.
   */
  async reconcile(
    scope: WorkspaceScope,
    input: {
      readonly reconciliationId: string;
      readonly attemptId: string;
      readonly assignmentId: string;
      readonly outboxId: string;
      readonly trigger:
        | "DISPATCH_ACK_UNKNOWN"
        | "POLL_DEADLINE"
        | "RESTART"
        | "WEBHOOK_ADVISORY"
        | "RESULT_WINDOW_EXPIRY_RISK"
        | "OWNER_CANCELLATION";
      readonly durableReceipts: readonly ProvenanceReceipt[];
      readonly endpoint: Pick<ServerlessTransportPort, "status">;
      readonly possibleDuplicateComputeUsd: number;
      readonly now: string;
    },
  ): Promise<ReconciliationOutcome> {
    const attempt = await this.attempt(input.attemptId);
    const existing = await this.currentAssignment(input.attemptId);
    const deployment = await this.#database.query<EndpointDeploymentRow>(
      `SELECT * FROM serverless_endpoint_deployments WHERE id = $1`,
      [attempt.deployment_id],
    );
    const bound = deployment.rows[0];
    if (bound === undefined) {
      throw new ServerlessDispatchError("DEPLOYMENT_NOT_FOUND", "The bound deployment is missing.");
    }
    const storedNonces = await this.#database.query<
      { receipt_nonce: string } & Record<string, unknown>
    >(`SELECT receipt_nonce FROM serverless_provenance_receipts WHERE attempt_id = $1`, [
      attempt.id,
    ]);
    const seenNonces = new Set(storedNonces.rows.map((row) => Number(row.receipt_nonce)));
    const matching: ProvenanceReceipt[] = [];
    for (const receipt of input.durableReceipts) {
      if (receipt.provider_job_id === null) continue;
      try {
        verifyProvenanceReceipt(this.#signer, receipt, {
          dispatchTokenSha256: attempt.dispatch_token_sha256,
          attemptId: attempt.id,
          providerJobId: receipt.provider_job_id,
          accountId: scope.accountId,
          workspaceId: scope.workspaceId,
          deploymentId: bound.id,
          endpointIdSha256: bound.endpoint_id_sha256,
          containerDigest: bound.worker_image_digest,
          volumeIdSha256: bound.volume_id_sha256,
          volumeManifestSha256: bound.volume_manifest_sha256,
          modelManifestSha256: bound.model_manifest_sha256,
          gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
          seenNonces,
        });
        matching.push(receipt);
        seenNonces.add(receipt.receipt_nonce);
      } catch (error) {
        if (!(error instanceof ReceiptVerificationError)) throw error;
      }
    }
    const distinctJobs = new Set(
      matching.map((receipt) => receipt.provider_job_id).filter((id): id is string => id !== null),
    );
    let outcome: ReconciliationOutcome;
    if (existing !== null) {
      outcome = "UNIQUE_ASSIGNMENT_PROVED";
    } else if (distinctJobs.size === 1) {
      outcome = "UNIQUE_ASSIGNMENT_PROVED";
    } else if (
      distinctJobs.size === 0 &&
      Date.parse(input.now) >= Date.parse(attempt.reconciliation_deadline_at)
    ) {
      // Nothing durable exists and the bounded window closed. The provider documents no way to ask
      // "did my token create a job", so uniqueness cannot be proved and dispatch stops.
      outcome = "AMBIGUOUS_STOP";
    } else if (distinctJobs.size === 0) {
      outcome = "NO_ASSIGNMENT_PROVED";
    } else {
      outcome = "AMBIGUOUS_STOP";
    }

    if (existing === null && outcome === "UNIQUE_ASSIGNMENT_PROVED") {
      const [providerJobId] = [...distinctJobs];
      const receipt = matching.find((candidate) => candidate.provider_job_id === providerJobId);
      await this.#bindAssignment(scope, {
        attemptId: attempt.id,
        projectRevisionId: attempt.project_revision_id,
        outboxId: input.outboxId,
        dispatchTokenSha256: attempt.dispatch_token_sha256,
        assignmentId: input.assignmentId,
        providerJobId: providerJobId as string,
        source: "BOUNDED_RECONCILIATION",
        workerId: receipt?.worker_id ?? null,
        now: input.now,
      });
    }

    const assignment = existing ?? (await this.currentAssignment(input.attemptId));
    let statusPolls = 0;
    const statusDeadline =
      attempt.provider_result_expires_at ??
      isoPlusSeconds(attempt.ttl_expires_at ?? attempt.deadline_at, PROVIDER_RESULT_WINDOW_SECONDS);
    if (assignment !== null && Date.parse(input.now) < Date.parse(statusDeadline)) {
      const snapshot = await input.endpoint.status(assignment.provider_job_id);
      if (snapshot.id !== assignment.provider_job_id) {
        throw new ServerlessDispatchError(
          "ASSIGNMENT_CONFLICT",
          "The status response does not match the current provider assignment.",
        );
      }
      statusPolls = 1;
      outcome = ["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(snapshot.status)
        ? "TERMINAL_CONFIRMED"
        : "UNIQUE_ASSIGNMENT_PROVED";
      await this.recordPolledStatus(scope, {
        eventId: input.reconciliationId,
        attemptId: attempt.id,
        providerJobId: assignment.provider_job_id,
        providerStatus: snapshot.status,
        attemptState: "RECONCILING",
        itemsCompleted: 0,
        observedAt: input.now,
      });
    } else if (assignment !== null) {
      // A provider job was bound, but neither terminal state nor output was durably observed before
      // the latest possible TTL-plus-result-retention boundary. No replacement can be proven safe.
      outcome = "AMBIGUOUS_STOP";
    }

    const refreshedAttempt = await this.attempt(input.attemptId);
    const reconciliationUpperBound =
      refreshedAttempt.provider_result_expires_at ??
      isoPlusSeconds(
        refreshedAttempt.ttl_expires_at ?? refreshedAttempt.deadline_at,
        PROVIDER_RESULT_WINDOW_SECONDS,
      );
    const reconciliationDeadlineAt =
      outcome === "AMBIGUOUS_STOP"
        ? input.now
        : new Date(
            Math.min(Date.parse(input.now) + 60_000, Date.parse(reconciliationUpperBound)),
          ).toISOString();

    const durableOutput = await this.#database.query(
      `SELECT 1 FROM serverless_output_receipts
        WHERE attempt_id = $1 AND acceptance = 'ACCEPTED_CANONICAL'`,
      [input.attemptId],
    );

    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const next = await transaction.query<{ next: string } & Record<string, unknown>>(
        `SELECT coalesce(max(sequence), 0) + 1 AS next
           FROM serverless_reconciliations WHERE attempt_id = $1`,
        [input.attemptId],
      );
      await transaction.query(
        `INSERT INTO serverless_reconciliations (
           id, account_id, workspace_id, project_revision_id, attempt_id, sequence, trigger_reason,
           started_at, deadline_at, provider_result_window_seconds, outcome, status_polls,
           assignments_observed, durable_output_present, cost_events_observed,
           possible_duplicate_compute_usd, new_dispatch_permitted, queue_purge_used, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                   false, $8)`,
        [
          input.reconciliationId,
          scope.accountId,
          scope.workspaceId,
          attempt.project_revision_id,
          attempt.id,
          Number(next.rows[0]?.next ?? 1),
          input.trigger,
          input.now,
          reconciliationDeadlineAt,
          PROVIDER_RESULT_WINDOW_SECONDS,
          outcome,
          statusPolls,
          existing !== null ? 1 : distinctJobs.size,
          durableOutput.rows.length > 0,
          1,
          input.possibleDuplicateComputeUsd,
          outcome === "NO_ASSIGNMENT_PROVED",
        ],
      );

      if (outcome === "AMBIGUOUS_STOP") {
        await transaction.query(
          `UPDATE serverless_dispatch_outbox
              SET state = 'DEAD_LETTER', version = version + 1, updated_at = $2
            WHERE id = $1`,
          [input.outboxId, input.now],
        );
        await transaction.query(
          `UPDATE serverless_attempts
              SET state = 'PERMANENT_FAILED', terminal_at = $2,
                  possible_duplicate_executions = possible_duplicate_executions + 1,
                  possible_duplicate_cost_usd = possible_duplicate_cost_usd + $3,
                  version = version + 1, updated_at = $2
            WHERE id = $1`,
          [attempt.id, input.now, input.possibleDuplicateComputeUsd],
        );
        await transaction.query(
          `UPDATE serverless_cost_ledgers
              SET possible_duplicate_usd = possible_duplicate_usd + $2, version = version + 1,
                  updated_at = $3
            WHERE attempt_id = $1`,
          [attempt.id, input.possibleDuplicateComputeUsd, input.now],
        );
      }
    });
    return outcome;
  }

  /**
   * Commits local cancellation intent first, then cancels the exact owned provider job. It never
   * touches the endpoint queue and never promises a refund for consumed compute.
   */
  async cancel(
    scope: WorkspaceScope,
    input: {
      readonly cancellationId: string;
      readonly attemptId: string;
      readonly requestedBy:
        | "OWNER_ACCOUNT"
        | "SYSTEM_DEADLINE"
        | "SYSTEM_TTL_EXPIRY"
        | "SYSTEM_SPEND_CEILING";
      readonly endpoint: Pick<ServerlessTransportPort, "cancel">;
      readonly settledCostUsd: number;
      readonly now: string;
    },
  ): Promise<{ readonly providerTerminalState: ServerlessProviderStatus | null }> {
    const attempt = await this.attempt(input.attemptId);
    const assignment = await this.currentAssignment(input.attemptId);

    const cancellationStarted = await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const updated = await transaction.query(
        `UPDATE serverless_attempts
            SET state = 'CANCELLING', version = version + 1, updated_at = $2
          WHERE id = $1 AND state NOT IN ('SUCCEEDED', 'PERMANENT_FAILED', 'CANCELLED')`,
        [attempt.id, input.now],
      );
      return updated.affectedRows === 1;
    });

    if (!cancellationStarted) return { providerTerminalState: null };

    let providerTerminalState: ServerlessProviderStatus | null = null;
    if (assignment !== null) {
      providerTerminalState = (await input.endpoint.cancel(assignment.provider_job_id)).status;
    }

    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      await transaction.query(
        `INSERT INTO serverless_cancellations (
           id, account_id, workspace_id, project_revision_id, attempt_id, assignment_id,
           requested_by, target_scope, local_intent_committed_at, provider_cancel_called,
           provider_terminal_state, settled_cost_usd, possible_unrefunded_cost_usd,
           refund_promised, completed_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'EXACT_OWNED_PROVIDER_JOB_ID', $8, $9, $10, $11,
                   $11, false, $12)
         ON CONFLICT (attempt_id) DO NOTHING`,
        [
          input.cancellationId,
          scope.accountId,
          scope.workspaceId,
          attempt.project_revision_id,
          attempt.id,
          assignment?.id ?? null,
          input.requestedBy,
          input.now,
          assignment !== null,
          providerTerminalState,
          input.settledCostUsd,
          providerTerminalState === null ? null : input.now,
        ],
      );
      await transaction.query(
        `UPDATE serverless_attempts
            SET state = 'CANCELLED', terminal_at = $2, version = version + 1, updated_at = $2
          WHERE id = $1 AND state = 'CANCELLING'`,
        [attempt.id, input.now],
      );
      await transaction.query(
        `UPDATE serverless_dispatch_outbox
            SET state = 'TERMINAL', version = version + 1, updated_at = $2
          WHERE id IN (SELECT id FROM serverless_dispatch_outbox WHERE attempt_id = $1)
            AND state NOT IN ('TERMINAL', 'DEAD_LETTER')`,
        [attempt.id, input.now],
      );
    });
    return { providerTerminalState };
  }

  /** Appends one settled or possible-duplicate cost fact and keeps the ledger conserved. */
  async recordCost(
    scope: WorkspaceScope,
    input: {
      readonly costEventId: string;
      readonly attemptId: string;
      readonly kind: "ESTIMATE" | "PROVIDER_REPORT" | "POSSIBLE_DUPLICATE" | "SETTLED" | "REFUND";
      readonly amountUsd: number;
      readonly rateSource: string;
      readonly rateCheckedAt: string;
      readonly now: string;
    },
  ): Promise<void> {
    const attempt = await this.attempt(input.attemptId);
    const ledger = await this.#database.query<
      { id: string; ceiling_usd: string } & Record<string, unknown>
    >(`SELECT id, ceiling_usd FROM serverless_cost_ledgers WHERE attempt_id = $1`, [
      input.attemptId,
    ]);
    const row = ledger.rows[0];
    if (row === undefined) {
      throw new ServerlessDispatchError("ATTEMPT_NOT_FOUND", "The attempt has no cost ledger.");
    }
    const column =
      input.kind === "SETTLED"
        ? "settled_usd"
        : input.kind === "REFUND"
          ? "refunded_usd"
          : input.kind === "POSSIBLE_DUPLICATE"
            ? "possible_duplicate_usd"
            : input.kind === "PROVIDER_REPORT"
              ? "reported_usd"
              : "estimated_usd";

    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const next = await transaction.query<{ next: string } & Record<string, unknown>>(
        `SELECT coalesce(max(sequence), 0) + 1 AS next
           FROM serverless_cost_events WHERE attempt_id = $1`,
        [input.attemptId],
      );
      await transaction.query(
        `INSERT INTO serverless_cost_events (
           id, account_id, workspace_id, project_revision_id, attempt_id, ledger_id, sequence,
           kind, amount_usd, rate_source, rate_checked_at, confidence, recorded_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          input.costEventId,
          scope.accountId,
          scope.workspaceId,
          attempt.project_revision_id,
          input.attemptId,
          row.id,
          Number(next.rows[0]?.next ?? 1),
          input.kind,
          input.amountUsd,
          input.rateSource,
          input.rateCheckedAt,
          input.kind === "POSSIBLE_DUPLICATE"
            ? "AMBIGUOUS"
            : input.kind === "SETTLED"
              ? "MEASURED"
              : input.kind === "PROVIDER_REPORT"
                ? "PROVIDER_REPORTED"
                : "ESTIMATED",
          input.now,
        ],
      );
      await transaction.query(
        `UPDATE serverless_cost_ledgers
            SET ${column} = ${column} + $2, version = version + 1, updated_at = $3
          WHERE attempt_id = $1`,
        [input.attemptId, input.amountUsd, input.now],
      );
    });
  }

  /** Rebuilds in-flight transport state after a restart without inventing provider facts. */
  async reconstructAfterRestart(): Promise<
    readonly { readonly attemptId: string; readonly state: string; readonly outboxState: string }[]
  > {
    const result = await this.#database.query<
      { attempt_id: string; state: string; outbox_state: string } & Record<string, unknown>
    >(
      `SELECT attempt.id AS attempt_id, attempt.state, outbox.state AS outbox_state
         FROM serverless_attempts AS attempt
         JOIN serverless_dispatch_outbox AS outbox ON outbox.attempt_id = attempt.id
        WHERE attempt.state <> ALL ($1::text[])
        ORDER BY attempt.created_at, attempt.id`,
      [`{${TERMINAL_ATTEMPT_STATES.join(",")}}`],
    );
    return result.rows.map((row) => ({
      attemptId: row.attempt_id,
      state: row.state,
      outboxState: row.outbox_state,
    }));
  }
}
