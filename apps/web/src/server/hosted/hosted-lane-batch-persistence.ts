import type {
  EndpointDeploymentInput,
  ServerlessLane,
  Sha256,
  SqlExecutor,
  TransactionalSqlExecutor,
  WorkspaceScope,
} from "@videoforge/control-plane";

import {
  HostedDispatchCoordinationError,
  type HostedDispatchInspection,
  type HostedPersistedDispatchPlan,
  type HostedPersistedServerlessAttempt,
  type HostedPublishedDeploymentBinding,
} from "./hosted-serverless-dispatch-coordinator";

type JsonRow = { readonly document: unknown } & Record<string, unknown>;

function invalid(): never {
  throw new HostedDispatchCoordinationError("HOSTED_SERVERLESS_PLAN_LINEAGE_INVALID");
}

function object(value: unknown): Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid();
  return value as Readonly<Record<string, unknown>>;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalid();
  return value;
}

function text(value: unknown): string {
  if (typeof value !== "string") invalid();
  return value;
}

function number(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) invalid();
  return parsed;
}

function iso(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(text(value));
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

async function tenantQuery<Row extends Record<string, unknown>>(
  database: TransactionalSqlExecutor,
  scope: WorkspaceScope,
  operation: (transaction: SqlExecutor) => Promise<Row | null>,
): Promise<Row | null> {
  return database.transaction(async (transaction) => {
    await transaction.query("SELECT set_config($1,$2,true)", [
      "videoforge.account_id",
      scope.accountId,
    ]);
    return operation(transaction);
  });
}

export interface HostedLaneBatchMaterialization {
  readonly scope: WorkspaceScope;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly generationPlanSha256: Sha256;
  /** Exact pair ordered mage_image then soulx_avatar. No authority or transport is created. */
  readonly batches: readonly Readonly<Record<string, unknown>>[];
}

export class HostedSqlLaneBatchMaterializer {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  materialize(input: HostedLaneBatchMaterialization): Promise<{ readonly replayed: boolean }> {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.scope.accountId,
      ]);
      const result = await transaction.query<{ replayed: boolean }>(
        `SELECT replayed FROM public.videoforge_materialize_hosted_lane_batches(
          $1,$2,$3,$4,$5,$6,$7::jsonb
        )`,
        [
          input.scope.accountId,
          input.scope.workspaceId,
          input.projectId,
          input.projectRevisionId,
          input.generationRequestId,
          input.generationPlanSha256,
          JSON.stringify(input.batches),
        ],
      );
      if (result.rows.length !== 1 || typeof result.rows[0]?.replayed !== "boolean") invalid();
      return Object.freeze({ replayed: result.rows[0].replayed });
    });
  }
}

function taskFromBatch(value: unknown) {
  const batch = object(value);
  const items = array(batch.items).map((candidate) => object(candidate));
  return Object.freeze({
    taskId: text(batch.dispatch_task_id),
    lane: text(batch.lane) as ServerlessLane,
    state: "READY" as const,
    attemptOrdinal: number(batch.attempt_ordinal),
    itemIds: Object.freeze(items.map((item) => text(item.item_id))),
    itemsManifestSha256: text(batch.items_manifest_sha256) as Sha256,
    inputManifestSha256: text(batch.input_manifest_sha256) as Sha256,
    outputPrefix: text(batch.output_prefix),
    maxInputBytes: number(batch.max_input_bytes),
    maxOutputBytes: number(batch.max_output_bytes),
    requestBody: object(batch.request_body),
    requestBodySha256: text(batch.request_body_sha256) as Sha256,
    envelope: object(batch.envelope),
    spendCeilingUsd: number(batch.spend_ceiling_usd),
    reservationUsd: number(batch.reservation_usd),
    rateSource: text(batch.rate_source),
    rateCheckedAt: iso(batch.rate_checked_at),
    checkpointAuthority: object(batch.checkpoint_authority) as never,
    authorityExpiresAt: iso(batch.authority_expires_at),
  });
}

/** Read-only concrete projection. Fresh qualification remains enforced by requireLane and the
 * one-time paid claim remains enforced by HostedSqlPaidAuthorityGate before predispatch. */
export class HostedSqlDispatchInspection implements HostedDispatchInspection {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  readPlan(scope: WorkspaceScope, generationRequestId: string) {
    return tenantQuery(this.database, scope, async (transaction) => {
      const result = await transaction.query<JsonRow>(
        `SELECT jsonb_build_object(
          'account_id',b.account_id,'workspace_id',b.workspace_id,'project_id',b.project_id,
          'project_revision_id',b.project_revision_id,'generation_request_id',b.generation_request_id,
          'generation_plan_sha256',b.generation_plan_sha256,
          'paid_authority',jsonb_build_object('approval_id',a.id,'approval_sha256',a.approval_sha256,
            'total_cap_usd',a.maximum_cumulative_finite_cap_usd,'expires_at',a.expires_at),
          'batches',jsonb_agg(b.payload ORDER BY b.batch_ordinal)
        ) AS document
        FROM public.hosted_lane_batches b
        JOIN public.hosted_paid_dispatch_approvals a
          ON a.account_id=b.account_id AND a.workspace_id=b.workspace_id
         AND a.generation_request_id=b.generation_request_id
         AND a.generation_plan_sha256=b.generation_plan_sha256
        WHERE b.account_id=$1 AND b.workspace_id=$2 AND b.generation_request_id=$3
          AND a.approved_at<=transaction_timestamp() AND a.expires_at>transaction_timestamp()
          AND NOT EXISTS (SELECT 1 FROM public.hosted_paid_dispatch_claims c WHERE c.approval_id=a.id)
        GROUP BY b.account_id,b.workspace_id,b.project_id,b.project_revision_id,
          b.generation_request_id,b.generation_plan_sha256,a.id,a.approval_sha256,
          a.maximum_cumulative_finite_cap_usd,a.expires_at
        HAVING count(*)=2`,
        [scope.accountId, scope.workspaceId, generationRequestId],
      );
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) invalid();
      return { document: result.rows[0]!.document };
    }).then((row): HostedPersistedDispatchPlan | null => {
      if (row === null) return null;
      const document = object(row.document);
      const authority = object(document.paid_authority);
      return Object.freeze({
        accountId: text(document.account_id),
        workspaceId: text(document.workspace_id),
        projectId: text(document.project_id),
        projectRevisionId: text(document.project_revision_id),
        generationRequestId: text(document.generation_request_id),
        generationPlanSha256: text(document.generation_plan_sha256) as Sha256,
        paidAuthority: Object.freeze({
          approvalId: text(authority.approval_id),
          approvalSha256: text(authority.approval_sha256) as Sha256,
          totalCapUsd: number(authority.total_cap_usd),
          expiresAt: iso(authority.expires_at),
        }),
        tasks: Object.freeze(array(document.batches).map(taskFromBatch)),
      });
    });
  }

  readAttempt(
    scope: WorkspaceScope,
    input: { readonly taskId: string; readonly attemptOrdinal: number },
  ) {
    return tenantQuery(this.database, scope, async (transaction) => {
      const result = await transaction.query<JsonRow>(
        `SELECT jsonb_build_object('account_id',a.account_id,'workspace_id',a.workspace_id,
          'project_id',a.project_id,'project_revision_id',a.project_revision_id,
          'generation_request_id',a.generation_request_id,'task_id',a.task_id,'lane',a.lane,
          'attempt_ordinal',a.attempt_ordinal,'attempt_id',a.id,'outbox_id',o.id,'state',a.state) AS document
         FROM public.serverless_attempts a JOIN public.serverless_dispatch_outbox o
           ON o.account_id=a.account_id AND o.workspace_id=a.workspace_id AND o.attempt_id=a.id
        WHERE a.account_id=$1 AND a.workspace_id=$2 AND a.task_id=$3 AND a.attempt_ordinal=$4`,
        [scope.accountId, scope.workspaceId, input.taskId, input.attemptOrdinal],
      );
      if (result.rows.length === 0) return null;
      if (result.rows.length !== 1) invalid();
      return { document: result.rows[0]!.document };
    }).then((row): HostedPersistedServerlessAttempt | null => {
      if (row === null) return null;
      const value = object(row.document);
      return Object.freeze({
        accountId: text(value.account_id),
        workspaceId: text(value.workspace_id),
        projectId: text(value.project_id),
        projectRevisionId: text(value.project_revision_id),
        generationRequestId: text(value.generation_request_id),
        taskId: text(value.task_id),
        lane: text(value.lane) as ServerlessLane,
        attemptOrdinal: number(value.attempt_ordinal),
        attemptId: text(value.attempt_id),
        outboxId: text(value.outbox_id),
        state: text(value.state),
      });
    });
  }

  readPublishedDeployment(lane: ServerlessLane) {
    return this.database
      .transaction(async (transaction) => {
        const result = await transaction.query<JsonRow>(
          `SELECT jsonb_build_object('deployment',jsonb_build_object(
          'deploymentId',d.id,'lane',d.lane,'endpointProfileId',d.endpoint_profile_id,
          'endpointIdSha256',d.endpoint_id_sha256,'endpointConfigSha256',d.endpoint_config_sha256,
          'workerImageDigest',d.worker_image_digest,'modelManifestSha256',d.model_manifest_sha256,
          'volumeIdSha256',d.volume_id_sha256,'volumeManifestSha256',d.volume_manifest_sha256,
          'idleTimeoutSeconds',d.idle_timeout_seconds,'initTimeoutSeconds',d.init_timeout_seconds,
          'executionTimeoutSeconds',d.execution_timeout_seconds,'requestTtlSeconds',d.request_ttl_seconds,
          'reconciliationDeadlineSeconds',d.reconciliation_deadline_seconds,
          'pollingIntervalSeconds',d.polling_interval_seconds,
          'maxReplacementAttempts',d.max_replacement_attempts,'timeoutEvidence',d.timeout_evidence,
          'deploymentVersion',d.deployment_version,'createdAt',d.created_at),
          'sealed_lineage',d.timeout_evidence->'sealed_lineage',
          'sealed_lineage_sha256','sha256:'||encode(sha256(convert_to(
            public.videoforge_canonical_jsonb(d.timeout_evidence->'sealed_lineage'),'UTF8')),'hex')) AS document
         FROM public.serverless_endpoint_deployments d WHERE d.lane=$1 AND d.is_active`,
          [lane],
        );
        if (result.rows.length === 0) return null;
        if (result.rows.length !== 1) invalid();
        return result.rows[0]!.document;
      })
      .then((row): HostedPublishedDeploymentBinding | null => {
        if (row === null) return null;
        const value = object(row);
        return Object.freeze({
          deployment: object(value.deployment) as unknown as Readonly<EndpointDeploymentInput>,
          sealedLineage: object(value.sealed_lineage) as never,
          sealedLineageSha256: text(value.sealed_lineage_sha256) as Sha256,
        });
      });
  }
}
