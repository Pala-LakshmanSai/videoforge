import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import { TENANT_PRINCIPAL_SETTING } from "../database/vocabulary.js";
import type { Sha256, WorkspaceActorScope, WorkspaceScope } from "../repositories/types.js";

export const FAIR_ADMISSION_ACTIVE_STATES = Object.freeze([
  "ADMITTED",
  "ACTIVE",
  "CANCELLING",
] as const);

export type FairRequestKind = "VIDEO" | "PRESET_PREVIEW";
export type FairRequestState =
  | "WAITING"
  | "ADMITTED"
  | "ACTIVE"
  | "CANCELLING"
  | "RETRY_WAIT"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELLED";

export type FairAdmissionErrorCode =
  | "EXPECTED_VERSION_MISMATCH"
  | "IDEMPOTENCY_CONFLICT"
  | "INVALID_LEASE_EXPIRY"
  | "INVALID_REORDER"
  | "INVALID_STATE_TRANSITION"
  | "LEASE_NOT_ACTIVE"
  | "LEASE_OWNER_MISMATCH"
  | "NOT_FOUND"
  | "TENANT_SCOPE_MISMATCH";

export class FairAdmissionError extends Error {
  constructor(
    readonly code: FairAdmissionErrorCode,
    message: string,
    readonly currentVersion?: number,
  ) {
    super(message);
    this.name = "FairAdmissionError";
  }
}

export interface EnqueueVideoCommand {
  readonly requestId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly idempotencyKey: string;
  readonly now: string;
  readonly availableAt?: string;
  readonly auditId: string;
}

export interface EnqueuePreviewCommand {
  readonly requestId: string;
  readonly lane: "MAGE" | "SOULX";
  readonly presetVersionId: string;
  readonly idempotencyKey: string;
  readonly now: string;
  readonly availableAt?: string;
  readonly auditId: string;
}

export interface PromotionIdentity {
  readonly leaseId: string;
  readonly auditId: string;
  readonly ownerTokenSha256: Sha256;
  readonly now: string;
  readonly expiresAt: string;
  /** Test/recovery injection. A throw proves the whole promotion rolls back. */
  readonly beforeCommit?: () => void | Promise<void>;
}

export interface PromotedWorkload {
  readonly requestKind: FairRequestKind;
  readonly requestId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly leaseId: string;
  readonly slot: 1 | 2;
  readonly requestVersion: number;
  readonly leaseVersion: number;
  readonly videoFairCursor: bigint;
  readonly previewFairCursor: bigint;
}

export interface OwnedQueueItem {
  readonly requestKind: FairRequestKind;
  readonly requestId: string;
  readonly state: FairRequestState;
  readonly queueOrder: bigint;
  readonly version: number;
  readonly attemptOrdinal: number;
  readonly availableAt: string;
  readonly leaseId: string | null;
  readonly leaseSlot: 1 | 2 | null;
  readonly leaseExpiresAt: string | null;
}

interface CapacityRow extends Record<string, unknown> {
  readonly active_lease_count: number;
  readonly schedule_sequence: bigint | string;
  readonly video_fair_cursor: bigint | string;
  readonly preview_fair_cursor: bigint | string;
  readonly version: number;
}

interface CandidateRow extends Record<string, unknown> {
  readonly id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly created_by_user_id: string;
  readonly version: number;
}

interface LeaseRow extends Record<string, unknown> {
  readonly id: string;
  readonly slot: number;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly request_kind: FairRequestKind;
  readonly generation_request_id: string | null;
  readonly preset_preview_request_id: string | null;
  readonly owner_token_sha256: string;
  readonly state: "ACTIVE" | "RELEASED" | "EXPIRED";
  readonly version: number;
  readonly expires_at: string;
}

interface RequestVersionRow extends Record<string, unknown> {
  readonly id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly created_by_user_id: string;
  readonly state: FairRequestState;
  readonly version: number;
}

interface PreviewPresetRow extends Record<string, unknown> {
  readonly account_id: string;
  readonly workspace_id: string;
  readonly scope_kind: "WORKSPACE" | "SYSTEM";
}

function bigint(value: bigint | string | number): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function isoMillis(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new RangeError(`invalid UTC timestamp: ${value}`);
  }
  return parsed;
}

function assertLeaseWindow(now: string, expiresAt: string): void {
  if (isoMillis(expiresAt) <= isoMillis(now)) {
    throw new FairAdmissionError(
      "INVALID_LEASE_EXPIRY",
      "A capacity lease must expire after it is acquired.",
    );
  }
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
    throw new FairAdmissionError(
      "TENANT_SCOPE_MISMATCH",
      "The authenticated account does not own this active default workspace.",
    );
  }
  await bindPrincipal(executor, scope.accountId);
}

async function capacityForUpdate(executor: SqlExecutor): Promise<CapacityRow> {
  const result = await executor.query<CapacityRow>(
    `SELECT active_lease_count, schedule_sequence, video_fair_cursor,
            preview_fair_cursor, version
       FROM global_generation_capacity WHERE singleton FOR UPDATE`,
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error("global generation capacity row is missing");
  return row;
}

function requestTable(kind: FairRequestKind): "generation_requests" | "preset_preview_requests" {
  return kind === "VIDEO" ? "generation_requests" : "preset_preview_requests";
}

function requestIdColumn(
  kind: FairRequestKind,
): "generation_request_id" | "preset_preview_request_id" {
  return kind === "VIDEO" ? "generation_request_id" : "preset_preview_request_id";
}

async function appendAudit(
  executor: SqlExecutor,
  input: {
    readonly auditId: string;
    readonly accountId: string;
    readonly workspaceId: string;
    readonly actorUserId: string;
    readonly operation:
      | "ENQUEUE"
      | "PROMOTE"
      | "REORDER"
      | "CANCEL_WAITING"
      | "CANCEL_ACTIVE"
      | "RETRY"
      | "HEARTBEAT"
      | "TERMINAL_RELEASE"
      | "LEASE_EXPIRE"
      | "RECONSTRUCT";
    readonly requestKind: FairRequestKind | "CAPACITY";
    readonly requestId: string | null;
    readonly leaseId: string | null;
    readonly requestVersionBefore: number | null;
    readonly requestVersionAfter: number | null;
    readonly cursorsBefore: CapacityRow;
    readonly cursorsAfter: CapacityRow;
    readonly detail: Readonly<Record<string, string | number | boolean | null>>;
    readonly occurredAt: string;
  },
): Promise<void> {
  await executor.query(
    `INSERT INTO generation_queue_audits (
       id, account_id, workspace_id, actor_user_id, operation, request_kind,
       request_id, lease_id, request_version_before, request_version_after,
       video_cursor_before, video_cursor_after, preview_cursor_before, preview_cursor_after,
       detail, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15::jsonb, $16)`,
    [
      input.auditId,
      input.accountId,
      input.workspaceId,
      input.actorUserId,
      input.operation,
      input.requestKind,
      input.requestId,
      input.leaseId,
      input.requestVersionBefore,
      input.requestVersionAfter,
      bigint(input.cursorsBefore.video_fair_cursor),
      bigint(input.cursorsAfter.video_fair_cursor),
      bigint(input.cursorsBefore.preview_fair_cursor),
      bigint(input.cursorsAfter.preview_fair_cursor),
      JSON.stringify(input.detail),
      input.occurredAt,
    ],
  );
}

async function ensureAccountHead(executor: SqlExecutor, accountId: string): Promise<void> {
  await executor.query(
    `INSERT INTO account_queue_heads (account_id) VALUES ($1)
     ON CONFLICT (account_id) DO NOTHING`,
    [accountId],
  );
  await executor.query(
    `SELECT account_id FROM account_queue_heads WHERE account_id = $1 FOR UPDATE`,
    [accountId],
  );
}

async function nextQueueOrder(
  executor: SqlExecutor,
  table: "generation_requests" | "preset_preview_requests",
  accountId: string,
): Promise<bigint> {
  const result = await executor.query<{ next_order: bigint | string } & Record<string, unknown>>(
    `SELECT COALESCE(MAX(queue_order), 0) + 1 AS next_order FROM ${table} WHERE account_id = $1`,
    [accountId],
  );
  return bigint(result.rows[0]?.next_order ?? 1);
}

async function candidate(
  executor: SqlExecutor,
  kind: FairRequestKind,
  now: string,
): Promise<CandidateRow | null> {
  const table = requestTable(kind);
  const servedColumn =
    kind === "VIDEO" ? "video_last_served_sequence" : "preview_last_served_sequence";
  const result = await executor.query<CandidateRow>(
    `SELECT request.id, request.account_id, request.workspace_id,
            request.created_by_user_id, request.version
       FROM ${table} AS request
       JOIN account_queue_heads AS head ON head.account_id = request.account_id
      WHERE request.state IN ('WAITING', 'RETRY_WAIT')
        AND request.available_at <= $1
        AND NOT EXISTS (
          SELECT 1 FROM provider_workload_leases AS lease
           WHERE lease.account_id = request.account_id AND lease.state = 'ACTIVE'
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${table} AS earlier
           WHERE earlier.account_id = request.account_id
             AND earlier.state IN ('WAITING', 'RETRY_WAIT')
             AND earlier.available_at <= $1
             AND (earlier.queue_order, earlier.id) < (request.queue_order, request.id)
        )
      ORDER BY head.${servedColumn}, request.account_id, request.queue_order, request.id
      LIMIT 1
      FOR UPDATE OF request, head`,
    [now],
  );
  return result.rows[0] ?? null;
}

async function availableSlot(executor: SqlExecutor): Promise<1 | 2 | null> {
  const result = await executor.query<{ slot: number } & Record<string, unknown>>(
    `SELECT candidate.slot
       FROM (VALUES (1), (2)) AS candidate(slot)
      WHERE NOT EXISTS (
        SELECT 1 FROM provider_workload_leases AS lease
         WHERE lease.slot = candidate.slot AND lease.state = 'ACTIVE'
      )
      ORDER BY candidate.slot
      LIMIT 1`,
  );
  const slot = result.rows[0]?.slot;
  return slot === 1 || slot === 2 ? slot : null;
}

async function promoteInTransaction(
  executor: SqlExecutor,
  identity: PromotionIdentity,
): Promise<PromotedWorkload | null> {
  assertLeaseWindow(identity.now, identity.expiresAt);
  const before = await capacityForUpdate(executor);
  if (before.active_lease_count >= 2) return null;

  let kind: FairRequestKind = "VIDEO";
  let selected = await candidate(executor, "VIDEO", identity.now);
  if (selected === null) {
    kind = "PRESET_PREVIEW";
    selected = await candidate(executor, "PRESET_PREVIEW", identity.now);
  }
  if (selected === null) return null;

  const slot = await availableSlot(executor);
  if (slot === null) return null;
  await bindPrincipal(executor, selected.account_id);

  const table = requestTable(kind);
  const updated = await executor.query<{ version: number } & Record<string, unknown>>(
    `UPDATE ${table}
        SET state = 'ADMITTED', admitted_at = $2, terminal_at = NULL,
            version = version + 1, updated_at = $2
      WHERE id = $1 AND account_id = $3 AND version = $4
        AND state IN ('WAITING', 'RETRY_WAIT')
      RETURNING version`,
    [selected.id, identity.now, selected.account_id, selected.version],
  );
  const requestVersion = updated.rows[0]?.version;
  if (requestVersion === undefined) {
    throw new FairAdmissionError(
      "EXPECTED_VERSION_MISMATCH",
      "The selected queue head changed before promotion.",
    );
  }

  const nextSequence = bigint(before.schedule_sequence) + 1n;
  if (kind === "VIDEO") {
    await executor.query(
      `UPDATE account_queue_heads
          SET video_last_served_sequence = $2, version = version + 1, updated_at = $3
        WHERE account_id = $1`,
      [selected.account_id, nextSequence, identity.now],
    );
    await executor.query(
      `UPDATE global_generation_capacity
          SET schedule_sequence = $1, video_fair_cursor = $1,
              version = version + 1, updated_at = $2
        WHERE singleton`,
      [nextSequence, identity.now],
    );
  } else {
    await executor.query(
      `UPDATE account_queue_heads
          SET preview_last_served_sequence = $2, version = version + 1, updated_at = $3
        WHERE account_id = $1`,
      [selected.account_id, nextSequence, identity.now],
    );
    await executor.query(
      `UPDATE global_generation_capacity
          SET schedule_sequence = $1, preview_fair_cursor = $1,
              version = version + 1, updated_at = $2
        WHERE singleton`,
      [nextSequence, identity.now],
    );
  }

  await executor.query(
    `INSERT INTO provider_workload_leases (
       id, slot, account_id, workspace_id, request_kind,
       generation_request_id, preset_preview_request_id, owner_token_sha256,
       state, acquired_at, heartbeat_at, expires_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, $9, $10)`,
    [
      identity.leaseId,
      slot,
      selected.account_id,
      selected.workspace_id,
      kind,
      kind === "VIDEO" ? selected.id : null,
      kind === "PRESET_PREVIEW" ? selected.id : null,
      identity.ownerTokenSha256,
      identity.now,
      identity.expiresAt,
    ],
  );

  const after = await capacityForUpdate(executor);
  await appendAudit(executor, {
    auditId: identity.auditId,
    accountId: selected.account_id,
    workspaceId: selected.workspace_id,
    actorUserId: selected.created_by_user_id,
    operation: "PROMOTE",
    requestKind: kind,
    requestId: selected.id,
    leaseId: identity.leaseId,
    requestVersionBefore: selected.version,
    requestVersionAfter: requestVersion,
    cursorsBefore: before,
    cursorsAfter: after,
    detail: { slot, waitingWorkMaterializedProviderActions: false },
    occurredAt: identity.now,
  });

  await identity.beforeCommit?.();
  return Object.freeze({
    requestKind: kind,
    requestId: selected.id,
    accountId: selected.account_id,
    workspaceId: selected.workspace_id,
    leaseId: identity.leaseId,
    slot,
    requestVersion,
    leaseVersion: 1,
    videoFairCursor: bigint(after.video_fair_cursor),
    previewFairCursor: bigint(after.preview_fair_cursor),
  });
}

async function ownedRequestForUpdate(
  executor: SqlExecutor,
  scope: WorkspaceScope,
  kind: FairRequestKind,
  requestId: string,
): Promise<RequestVersionRow> {
  const result = await executor.query<RequestVersionRow>(
    `SELECT id, account_id, workspace_id, created_by_user_id, state, version
       FROM ${requestTable(kind)}
      WHERE account_id = $1 AND workspace_id = $2 AND id = $3
      FOR UPDATE`,
    [scope.accountId, scope.workspaceId, requestId],
  );
  const row = result.rows[0];
  if (row === undefined) {
    throw new FairAdmissionError("NOT_FOUND", "Owned queue request was not found.");
  }
  return row;
}

export class FairAdmissionRepository {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async enqueueVideo(
    scope: WorkspaceActorScope,
    command: EnqueueVideoCommand,
  ): Promise<OwnedQueueItem> {
    return this.database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      await ensureAccountHead(transaction, scope.accountId);
      const before = await capacityForUpdate(transaction);
      const replay = await transaction.query<
        RequestVersionRow & {
          queue_order: bigint | string;
          available_at: string;
          attempt_ordinal: number;
          project_id: string;
          project_revision_id: string;
        }
      >(
        `SELECT id, account_id, workspace_id, created_by_user_id, state, version,
                queue_order, available_at::text, attempt_ordinal, project_id, project_revision_id
           FROM generation_requests
          WHERE account_id = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [scope.accountId, command.idempotencyKey],
      );
      const existing = replay.rows[0];
      if (existing !== undefined) {
        if (
          existing.id !== command.requestId ||
          existing.workspace_id !== scope.workspaceId ||
          existing.created_by_user_id !== scope.actorUserId ||
          existing.project_id !== command.projectId ||
          existing.project_revision_id !== command.projectRevisionId
        ) {
          throw new FairAdmissionError(
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key is already bound to different generation work.",
          );
        }
        return Object.freeze({
          requestKind: "VIDEO" as const,
          requestId: existing.id,
          state: existing.state,
          queueOrder: bigint(existing.queue_order),
          version: existing.version,
          attemptOrdinal: existing.attempt_ordinal,
          availableAt: existing.available_at,
          leaseId: null,
          leaseSlot: null,
          leaseExpiresAt: null,
        });
      }
      const order = await nextQueueOrder(transaction, "generation_requests", scope.accountId);
      const inserted = await transaction.query<
        RequestVersionRow & {
          queue_order: bigint | string;
          available_at: string;
          attempt_ordinal: number;
        }
      >(
        `INSERT INTO generation_requests (
           id, account_id, workspace_id, project_id, project_revision_id, created_by_user_id,
           state, queue_order, available_at, idempotency_key, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'WAITING', $7, $8, $9, $10, $10)
         RETURNING id, account_id, workspace_id, created_by_user_id, state, version,
                   queue_order, available_at::text, attempt_ordinal`,
        [
          command.requestId,
          scope.accountId,
          scope.workspaceId,
          command.projectId,
          command.projectRevisionId,
          scope.actorUserId,
          order,
          command.availableAt ?? command.now,
          command.idempotencyKey,
          command.now,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("generation request insert returned no row");
      await appendAudit(transaction, {
        auditId: command.auditId,
        accountId: scope.accountId,
        workspaceId: scope.workspaceId,
        actorUserId: scope.actorUserId,
        operation: "ENQUEUE",
        requestKind: "VIDEO",
        requestId: command.requestId,
        leaseId: null,
        requestVersionBefore: null,
        requestVersionAfter: row.version,
        cursorsBefore: before,
        cursorsAfter: before,
        detail: { queueOrder: Number(order), providerActionsCreated: false },
        occurredAt: command.now,
      });
      return Object.freeze({
        requestKind: "VIDEO" as const,
        requestId: row.id,
        state: row.state,
        queueOrder: bigint(row.queue_order),
        version: row.version,
        attemptOrdinal: row.attempt_ordinal,
        availableAt: row.available_at,
        leaseId: null,
        leaseSlot: null,
        leaseExpiresAt: null,
      });
    });
  }

  async enqueuePreview(
    scope: WorkspaceActorScope,
    command: EnqueuePreviewCommand,
  ): Promise<OwnedQueueItem> {
    return this.database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      await ensureAccountHead(transaction, scope.accountId);
      const before = await capacityForUpdate(transaction);
      const presetTable =
        command.lane === "MAGE" ? "image_style_versions" : "avatar_profile_versions";
      const preset = await transaction.query<PreviewPresetRow>(
        `SELECT account_id, workspace_id, scope_kind
           FROM ${presetTable}
          WHERE id = $1
            AND ((account_id = $2 AND workspace_id = $3 AND scope_kind = 'WORKSPACE')
              OR (account_id = 'ffffffff-ffff-4fff-8fff-000000000001'::uuid
                  AND scope_kind = 'SYSTEM'))
          ORDER BY CASE WHEN account_id = $2 THEN 0 ELSE 1 END
          LIMIT 1`,
        [command.presetVersionId, scope.accountId, scope.workspaceId],
      );
      const resolvedPreset = preset.rows[0];
      if (resolvedPreset === undefined) {
        throw new FairAdmissionError(
          "NOT_FOUND",
          "Owned or immutable system preset version was not found.",
        );
      }
      const replay = await transaction.query<
        RequestVersionRow & {
          queue_order: bigint | string;
          available_at: string;
          attempt_ordinal: number;
          lane: "MAGE" | "SOULX";
          preset_version_id: string;
        }
      >(
        `SELECT id, account_id, workspace_id, created_by_user_id, state, version,
                queue_order, available_at::text, attempt_ordinal, lane, preset_version_id
           FROM preset_preview_requests
          WHERE account_id = $1 AND idempotency_key = $2
          FOR UPDATE`,
        [scope.accountId, command.idempotencyKey],
      );
      const existing = replay.rows[0];
      if (existing !== undefined) {
        if (
          existing.id !== command.requestId ||
          existing.workspace_id !== scope.workspaceId ||
          existing.created_by_user_id !== scope.actorUserId ||
          existing.lane !== command.lane ||
          existing.preset_version_id !== command.presetVersionId
        ) {
          throw new FairAdmissionError(
            "IDEMPOTENCY_CONFLICT",
            "The idempotency key is already bound to different preview work.",
          );
        }
        return Object.freeze({
          requestKind: "PRESET_PREVIEW" as const,
          requestId: existing.id,
          state: existing.state,
          queueOrder: bigint(existing.queue_order),
          version: existing.version,
          attemptOrdinal: existing.attempt_ordinal,
          availableAt: existing.available_at,
          leaseId: null,
          leaseSlot: null,
          leaseExpiresAt: null,
        });
      }
      const order = await nextQueueOrder(transaction, "preset_preview_requests", scope.accountId);
      const inserted = await transaction.query<
        RequestVersionRow & {
          queue_order: bigint | string;
          available_at: string;
          attempt_ordinal: number;
        }
      >(
        `INSERT INTO preset_preview_requests (
           id, account_id, workspace_id, lane, preset_version_id,
           preset_account_id, preset_workspace_id, preset_scope_kind,
           mage_image_style_version_id, soulx_avatar_profile_version_id, created_by_user_id,
           state, queue_order, available_at, idempotency_key, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                   CASE WHEN $4 = 'MAGE' THEN $5::uuid END,
                   CASE WHEN $4 = 'SOULX' THEN $5::uuid END,
                   $9, 'WAITING', $10, $11, $12, $13, $13)
         RETURNING id, account_id, workspace_id, created_by_user_id, state, version,
                   queue_order, available_at::text, attempt_ordinal`,
        [
          command.requestId,
          scope.accountId,
          scope.workspaceId,
          command.lane,
          command.presetVersionId,
          resolvedPreset.account_id,
          resolvedPreset.workspace_id,
          resolvedPreset.scope_kind,
          scope.actorUserId,
          order,
          command.availableAt ?? command.now,
          command.idempotencyKey,
          command.now,
        ],
      );
      const row = inserted.rows[0];
      if (row === undefined) throw new Error("preview request insert returned no row");
      await appendAudit(transaction, {
        auditId: command.auditId,
        accountId: scope.accountId,
        workspaceId: scope.workspaceId,
        actorUserId: scope.actorUserId,
        operation: "ENQUEUE",
        requestKind: "PRESET_PREVIEW",
        requestId: command.requestId,
        leaseId: null,
        requestVersionBefore: null,
        requestVersionAfter: row.version,
        cursorsBefore: before,
        cursorsAfter: before,
        detail: { queueOrder: Number(order), providerActionsCreated: false, lane: command.lane },
        occurredAt: command.now,
      });
      return Object.freeze({
        requestKind: "PRESET_PREVIEW" as const,
        requestId: row.id,
        state: row.state,
        queueOrder: bigint(row.queue_order),
        version: row.version,
        attemptOrdinal: row.attempt_ordinal,
        availableAt: row.available_at,
        leaseId: null,
        leaseSlot: null,
        leaseExpiresAt: null,
      });
    });
  }

  async promoteNext(identity: PromotionIdentity): Promise<PromotedWorkload | null> {
    return this.database.transaction((transaction) => promoteInTransaction(transaction, identity));
  }

  async listOwned(scope: WorkspaceScope): Promise<readonly OwnedQueueItem[]> {
    return this.database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const result = await transaction.query<
        Record<string, unknown> & {
          request_kind: FairRequestKind;
          request_id: string;
          state: FairRequestState;
          queue_order: bigint | string;
          version: number;
          attempt_ordinal: number;
          available_at: string;
          lease_id: string | null;
          slot: number | null;
          expires_at: string | null;
        }
      >(
        `SELECT request_kind, request_id, state, queue_order, version, attempt_ordinal,
                available_at::text, lease_id, slot, expires_at
           FROM (
             SELECT 'VIDEO'::text AS request_kind, request.id AS request_id, request.state,
                    request.queue_order, request.version, request.attempt_ordinal,
                    request.available_at, lease.id AS lease_id, lease.slot, lease.expires_at::text,
                    request.created_at
               FROM generation_requests request
               LEFT JOIN provider_workload_leases lease
                 ON lease.generation_request_id = request.id AND lease.state = 'ACTIVE'
              WHERE request.account_id = $1 AND request.workspace_id = $2
             UNION ALL
             SELECT 'PRESET_PREVIEW'::text, request.id, request.state, request.queue_order,
                    request.version, request.attempt_ordinal, request.available_at,
                    lease.id, lease.slot, lease.expires_at::text, request.created_at
               FROM preset_preview_requests request
               LEFT JOIN provider_workload_leases lease
                 ON lease.preset_preview_request_id = request.id AND lease.state = 'ACTIVE'
              WHERE request.account_id = $1 AND request.workspace_id = $2
           ) owned
          ORDER BY created_at NULLS LAST, request_kind, queue_order, request_id`,
        [scope.accountId, scope.workspaceId],
      );
      return Object.freeze(
        result.rows.map((row) =>
          Object.freeze({
            requestKind: row.request_kind,
            requestId: row.request_id,
            state: row.state,
            queueOrder: bigint(row.queue_order),
            version: row.version,
            attemptOrdinal: row.attempt_ordinal,
            availableAt: row.available_at,
            leaseId: row.lease_id,
            leaseSlot: row.slot === 1 || row.slot === 2 ? row.slot : null,
            leaseExpiresAt: row.expires_at,
          }),
        ),
      );
    });
  }

  async reorderOwnedWaiting(
    scope: WorkspaceActorScope,
    input: {
      readonly requestKind: FairRequestKind;
      readonly requestId: string;
      readonly expectedVersion: number;
      readonly toPosition: number;
      readonly auditId: string;
      readonly now: string;
    },
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      await ensureAccountHead(transaction, scope.accountId);
      const before = await capacityForUpdate(transaction);
      const table = requestTable(input.requestKind);
      const waiting = await transaction.query<
        Record<string, unknown> & { id: string; queue_order: bigint | string; version: number }
      >(
        `SELECT id, queue_order, version FROM ${table}
          WHERE account_id = $1 AND workspace_id = $2 AND state IN ('WAITING', 'RETRY_WAIT')
          ORDER BY queue_order, id FOR UPDATE`,
        [scope.accountId, scope.workspaceId],
      );
      const currentIndex = waiting.rows.findIndex((row) => row.id === input.requestId);
      if (currentIndex < 0) {
        const owned = await transaction.query<{ present: boolean } & Record<string, unknown>>(
          `SELECT EXISTS (
             SELECT 1 FROM ${table}
              WHERE account_id = $1 AND workspace_id = $2 AND id = $3
           ) AS present`,
          [scope.accountId, scope.workspaceId, input.requestId],
        );
        if (owned.rows[0]?.present === true) {
          throw new FairAdmissionError(
            "INVALID_STATE_TRANSITION",
            "Only owned waiting requests may be reordered.",
          );
        }
        throw new FairAdmissionError("NOT_FOUND", "Owned waiting request was not found.");
      }
      const target = waiting.rows[currentIndex];
      if (target?.version !== input.expectedVersion) {
        throw new FairAdmissionError(
          "EXPECTED_VERSION_MISMATCH",
          "Queue request version is stale.",
          target?.version,
        );
      }
      if (
        !Number.isInteger(input.toPosition) ||
        input.toPosition < 1 ||
        input.toPosition > waiting.rows.length
      ) {
        throw new FairAdmissionError("INVALID_REORDER", "Owned queue position is out of range.");
      }
      const orderedIds = waiting.rows.map((row) => row.id);
      const [moved] = orderedIds.splice(currentIndex, 1);
      if (moved === undefined) throw new Error("waiting request disappeared during reorder");
      orderedIds.splice(input.toPosition - 1, 0, moved);
      const originalOrders = waiting.rows.map((row) => bigint(row.queue_order));
      const offset = (originalOrders.at(-1) ?? 0n) + BigInt(waiting.rows.length) + 1_000n;
      await transaction.query(
        `UPDATE ${table} SET queue_order = queue_order + $3
          WHERE account_id = $1 AND workspace_id = $2 AND state IN ('WAITING', 'RETRY_WAIT')`,
        [scope.accountId, scope.workspaceId, offset],
      );
      for (const [index, requestId] of orderedIds.entries()) {
        await transaction.query(
          `UPDATE ${table}
              SET queue_order = $4,
                  version = version + CASE WHEN id = $6 THEN 1 ELSE 0 END,
                  updated_at = CASE WHEN id = $6 THEN $5 ELSE updated_at END
            WHERE account_id = $1 AND workspace_id = $2 AND id = $3`,
          [
            scope.accountId,
            scope.workspaceId,
            requestId,
            originalOrders[index] ?? BigInt(index + 1),
            input.now,
            moved,
          ],
        );
      }
      const after = await capacityForUpdate(transaction);
      await appendAudit(transaction, {
        auditId: input.auditId,
        accountId: scope.accountId,
        workspaceId: scope.workspaceId,
        actorUserId: scope.actorUserId,
        operation: "REORDER",
        requestKind: input.requestKind,
        requestId: input.requestId,
        leaseId: null,
        requestVersionBefore: input.expectedVersion,
        requestVersionAfter: input.expectedVersion + 1,
        cursorsBefore: before,
        cursorsAfter: after,
        detail: { fromPosition: currentIndex + 1, toPosition: input.toPosition },
        occurredAt: input.now,
      });
    });
  }

  async cancelOwned(
    scope: WorkspaceActorScope,
    input: {
      readonly requestKind: FairRequestKind;
      readonly requestId: string;
      readonly expectedVersion: number;
      readonly auditId: string;
      readonly now: string;
    },
  ): Promise<"CANCELLED" | "CANCELLING"> {
    return this.database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const before = await capacityForUpdate(transaction);
      const row = await ownedRequestForUpdate(
        transaction,
        scope,
        input.requestKind,
        input.requestId,
      );
      if (row.version !== input.expectedVersion) {
        throw new FairAdmissionError(
          "EXPECTED_VERSION_MISMATCH",
          "Queue request version is stale.",
          row.version,
        );
      }
      const waiting = row.state === "WAITING" || row.state === "RETRY_WAIT";
      const active = FAIR_ADMISSION_ACTIVE_STATES.includes(
        row.state as (typeof FAIR_ADMISSION_ACTIVE_STATES)[number],
      );
      if (!waiting && !active) {
        throw new FairAdmissionError(
          "INVALID_STATE_TRANSITION",
          "Only waiting or active owned work can be cancelled.",
        );
      }
      const nextState = waiting ? "CANCELLED" : "CANCELLING";
      await transaction.query(
        `UPDATE ${requestTable(input.requestKind)}
            SET state = $4,
                terminal_at = CASE WHEN $4 = 'CANCELLED' THEN $5::timestamptz ELSE NULL::timestamptz END,
                version = version + 1, updated_at = $5
          WHERE account_id = $1 AND workspace_id = $2 AND id = $3 AND version = $6`,
        [
          scope.accountId,
          scope.workspaceId,
          input.requestId,
          nextState,
          input.now,
          input.expectedVersion,
        ],
      );
      const after = await capacityForUpdate(transaction);
      await appendAudit(transaction, {
        auditId: input.auditId,
        accountId: scope.accountId,
        workspaceId: scope.workspaceId,
        actorUserId: scope.actorUserId,
        operation: waiting ? "CANCEL_WAITING" : "CANCEL_ACTIVE",
        requestKind: input.requestKind,
        requestId: input.requestId,
        leaseId: null,
        requestVersionBefore: input.expectedVersion,
        requestVersionAfter: input.expectedVersion + 1,
        cursorsBefore: before,
        cursorsAfter: after,
        detail: { activeWorkloadMoved: false },
        occurredAt: input.now,
      });
      return nextState;
    });
  }

  async retryOwnedFailed(
    scope: WorkspaceActorScope,
    input: {
      readonly requestKind: FairRequestKind;
      readonly requestId: string;
      readonly expectedVersion: number;
      readonly auditId: string;
      readonly now: string;
      readonly availableAt?: string;
    },
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const before = await capacityForUpdate(transaction);
      const row = await ownedRequestForUpdate(
        transaction,
        scope,
        input.requestKind,
        input.requestId,
      );
      if (row.version !== input.expectedVersion) {
        throw new FairAdmissionError(
          "EXPECTED_VERSION_MISMATCH",
          "Retry version is stale.",
          row.version,
        );
      }
      if (row.state !== "FAILED") {
        throw new FairAdmissionError("INVALID_STATE_TRANSITION", "Only failed work may retry.");
      }
      await transaction.query(
        `UPDATE ${requestTable(input.requestKind)}
            SET state = 'WAITING', admitted_at = NULL, terminal_at = NULL,
                attempt_ordinal = attempt_ordinal + 1, available_at = $4,
                version = version + 1, updated_at = $5
          WHERE account_id = $1 AND workspace_id = $2 AND id = $3 AND version = $6`,
        [
          scope.accountId,
          scope.workspaceId,
          input.requestId,
          input.availableAt ?? input.now,
          input.now,
          input.expectedVersion,
        ],
      );
      const after = await capacityForUpdate(transaction);
      await appendAudit(transaction, {
        auditId: input.auditId,
        accountId: scope.accountId,
        workspaceId: scope.workspaceId,
        actorUserId: scope.actorUserId,
        operation: "RETRY",
        requestKind: input.requestKind,
        requestId: input.requestId,
        leaseId: null,
        requestVersionBefore: input.expectedVersion,
        requestVersionAfter: input.expectedVersion + 1,
        cursorsBefore: before,
        cursorsAfter: after,
        detail: { attemptOrdinalIncremented: true },
        occurredAt: input.now,
      });
    });
  }

  async heartbeatLease(input: {
    readonly leaseId: string;
    readonly ownerTokenSha256: Sha256;
    readonly expectedVersion: number;
    readonly auditId: string;
    readonly now: string;
    readonly expiresAt: string;
  }): Promise<number> {
    assertLeaseWindow(input.now, input.expiresAt);
    return this.database.transaction(async (transaction) => {
      const before = await capacityForUpdate(transaction);
      const result = await transaction.query<LeaseRow & { created_by_user_id: string }>(
        `SELECT lease.*, COALESCE(video.created_by_user_id, preview.created_by_user_id) AS created_by_user_id
           FROM provider_workload_leases lease
           LEFT JOIN generation_requests video ON video.id = lease.generation_request_id
           LEFT JOIN preset_preview_requests preview ON preview.id = lease.preset_preview_request_id
          WHERE lease.id = $1 FOR UPDATE OF lease`,
        [input.leaseId],
      );
      const lease = result.rows[0];
      if (lease === undefined || lease.state !== "ACTIVE") {
        throw new FairAdmissionError("LEASE_NOT_ACTIVE", "Capacity lease is not active.");
      }
      if (lease.owner_token_sha256 !== input.ownerTokenSha256) {
        throw new FairAdmissionError(
          "LEASE_OWNER_MISMATCH",
          "Capacity lease ownership does not match.",
        );
      }
      if (lease.version !== input.expectedVersion) {
        throw new FairAdmissionError(
          "EXPECTED_VERSION_MISMATCH",
          "Lease version is stale.",
          lease.version,
        );
      }
      if (isoMillis(lease.expires_at) <= isoMillis(input.now)) {
        throw new FairAdmissionError("LEASE_NOT_ACTIVE", "Expired capacity cannot be heartbeated.");
      }
      await bindPrincipal(transaction, lease.account_id);
      await transaction.query(
        `UPDATE provider_workload_leases
            SET heartbeat_at = $2, expires_at = $3, version = version + 1
          WHERE id = $1 AND version = $4`,
        [input.leaseId, input.now, input.expiresAt, input.expectedVersion],
      );
      const after = await capacityForUpdate(transaction);
      await appendAudit(transaction, {
        auditId: input.auditId,
        accountId: lease.account_id,
        workspaceId: lease.workspace_id,
        actorUserId: lease.created_by_user_id,
        operation: "HEARTBEAT",
        requestKind: lease.request_kind,
        requestId: lease.generation_request_id ?? lease.preset_preview_request_id,
        leaseId: lease.id,
        requestVersionBefore: null,
        requestVersionAfter: null,
        cursorsBefore: before,
        cursorsAfter: after,
        detail: { leaseVersionBefore: lease.version, leaseVersionAfter: lease.version + 1 },
        occurredAt: input.now,
      });
      return lease.version + 1;
    });
  }

  async settleAndPromote(input: {
    readonly leaseId: string;
    readonly ownerTokenSha256: Sha256;
    readonly expectedLeaseVersion: number;
    readonly terminalState: "SUCCEEDED" | "FAILED" | "CANCELLED";
    readonly auditId: string;
    readonly now: string;
    readonly nextPromotion?: PromotionIdentity;
  }): Promise<PromotedWorkload | null> {
    return this.database.transaction(async (transaction) => {
      const before = await capacityForUpdate(transaction);
      const result = await transaction.query<LeaseRow & { created_by_user_id: string }>(
        `SELECT lease.*, COALESCE(video.created_by_user_id, preview.created_by_user_id) AS created_by_user_id
           FROM provider_workload_leases lease
           LEFT JOIN generation_requests video ON video.id = lease.generation_request_id
           LEFT JOIN preset_preview_requests preview ON preview.id = lease.preset_preview_request_id
          WHERE lease.id = $1 FOR UPDATE OF lease`,
        [input.leaseId],
      );
      const lease = result.rows[0];
      if (lease === undefined || lease.state !== "ACTIVE") {
        throw new FairAdmissionError("LEASE_NOT_ACTIVE", "Capacity lease is not active.");
      }
      if (lease.owner_token_sha256 !== input.ownerTokenSha256) {
        throw new FairAdmissionError(
          "LEASE_OWNER_MISMATCH",
          "Capacity lease ownership does not match.",
        );
      }
      if (lease.version !== input.expectedLeaseVersion) {
        throw new FairAdmissionError(
          "EXPECTED_VERSION_MISMATCH",
          "Lease version is stale.",
          lease.version,
        );
      }
      await bindPrincipal(transaction, lease.account_id);
      const table = requestTable(lease.request_kind);
      const idColumn = requestIdColumn(lease.request_kind);
      const requestId = lease[idColumn];
      if (requestId === null) throw new Error("active lease has no matching request");
      const request = await transaction.query<RequestVersionRow>(
        `SELECT id, account_id, workspace_id, created_by_user_id, state, version
           FROM ${table} WHERE id = $1 FOR UPDATE`,
        [requestId],
      );
      const requestRow = request.rows[0];
      if (
        requestRow === undefined ||
        !FAIR_ADMISSION_ACTIVE_STATES.includes(requestRow.state as never)
      ) {
        throw new FairAdmissionError("INVALID_STATE_TRANSITION", "Leased request is not active.");
      }
      await transaction.query(
        `UPDATE ${table}
            SET state = $2, terminal_at = $3, version = version + 1, updated_at = $3
          WHERE id = $1 AND version = $4`,
        [requestId, input.terminalState, input.now, requestRow.version],
      );
      await transaction.query(
        `UPDATE provider_workload_leases
            SET state = 'RELEASED', released_at = $2, release_reason = $3,
                version = version + 1
          WHERE id = $1 AND version = $4`,
        [input.leaseId, input.now, `TERMINAL_${input.terminalState}`, input.expectedLeaseVersion],
      );
      const afterRelease = await capacityForUpdate(transaction);
      await appendAudit(transaction, {
        auditId: input.auditId,
        accountId: lease.account_id,
        workspaceId: lease.workspace_id,
        actorUserId: lease.created_by_user_id,
        operation: "TERMINAL_RELEASE",
        requestKind: lease.request_kind,
        requestId,
        leaseId: lease.id,
        requestVersionBefore: requestRow.version,
        requestVersionAfter: requestRow.version + 1,
        cursorsBefore: before,
        cursorsAfter: afterRelease,
        detail: { terminalState: input.terminalState },
        occurredAt: input.now,
      });
      return input.nextPromotion === undefined
        ? null
        : promoteInTransaction(transaction, input.nextPromotion);
    });
  }

  async reclaimExpired(input: {
    readonly now: string;
    readonly expirations: readonly { readonly leaseId: string; readonly auditId: string }[];
    readonly promotions?: readonly PromotionIdentity[];
  }): Promise<readonly PromotedWorkload[]> {
    return this.database.transaction(async (transaction) => {
      const promoted: PromotedWorkload[] = [];
      for (const expiration of input.expirations) {
        const before = await capacityForUpdate(transaction);
        const result = await transaction.query<LeaseRow & { created_by_user_id: string }>(
          `SELECT lease.*, COALESCE(video.created_by_user_id, preview.created_by_user_id) AS created_by_user_id
             FROM provider_workload_leases lease
             LEFT JOIN generation_requests video ON video.id = lease.generation_request_id
             LEFT JOIN preset_preview_requests preview ON preview.id = lease.preset_preview_request_id
            WHERE lease.id = $1 FOR UPDATE OF lease`,
          [expiration.leaseId],
        );
        const lease = result.rows[0];
        if (lease === undefined || lease.state !== "ACTIVE") continue;
        if (isoMillis(lease.expires_at) > isoMillis(input.now)) continue;
        await bindPrincipal(transaction, lease.account_id);
        const table = requestTable(lease.request_kind);
        const requestId = lease[requestIdColumn(lease.request_kind)];
        if (requestId === null) throw new Error("active lease has no request");
        const request = await transaction.query<RequestVersionRow>(
          `SELECT id, account_id, workspace_id, created_by_user_id, state, version
             FROM ${table} WHERE id = $1 FOR UPDATE`,
          [requestId],
        );
        const requestRow = request.rows[0];
        if (requestRow === undefined) throw new Error("active lease request is missing");
        await transaction.query(
          `UPDATE ${table}
              SET state = 'RETRY_WAIT', admitted_at = NULL, terminal_at = NULL,
                  attempt_ordinal = attempt_ordinal + 1, available_at = $2,
                  version = version + 1, updated_at = $2
            WHERE id = $1 AND version = $3`,
          [requestId, input.now, requestRow.version],
        );
        await transaction.query(
          `UPDATE provider_workload_leases
              SET state = 'EXPIRED', released_at = $2, release_reason = 'LEASE_EXPIRED',
                  version = version + 1
            WHERE id = $1 AND version = $3`,
          [lease.id, input.now, lease.version],
        );
        const after = await capacityForUpdate(transaction);
        await appendAudit(transaction, {
          auditId: expiration.auditId,
          accountId: lease.account_id,
          workspaceId: lease.workspace_id,
          actorUserId: lease.created_by_user_id,
          operation: "LEASE_EXPIRE",
          requestKind: lease.request_kind,
          requestId,
          leaseId: lease.id,
          requestVersionBefore: requestRow.version,
          requestVersionAfter: requestRow.version + 1,
          cursorsBefore: before,
          cursorsAfter: after,
          detail: { reclaimed: true },
          occurredAt: input.now,
        });
      }
      for (const identity of input.promotions ?? []) {
        const result = await promoteInTransaction(transaction, identity);
        if (result !== null) promoted.push(result);
      }
      return Object.freeze(promoted);
    });
  }

  async reconstruct(input: {
    readonly now: string;
    readonly auditId?: string;
  }): Promise<{ readonly activeLeaseCount: number; readonly accountIds: readonly string[] }> {
    return this.database.transaction(async (transaction) => {
      const before = await capacityForUpdate(transaction);
      const active = await transaction.query<LeaseRow & { created_by_user_id: string }>(
        `SELECT lease.*, COALESCE(video.created_by_user_id, preview.created_by_user_id) AS created_by_user_id
           FROM provider_workload_leases lease
           LEFT JOIN generation_requests video ON video.id = lease.generation_request_id
           LEFT JOIN preset_preview_requests preview ON preview.id = lease.preset_preview_request_id
          WHERE lease.state = 'ACTIVE'
          ORDER BY lease.slot FOR UPDATE OF lease`,
      );
      const accountIds = active.rows.map((row) => row.account_id);
      if (active.rows.length > 2 || new Set(accountIds).size !== active.rows.length) {
        throw new Error("durable capacity leases violate the one-account/two-global invariant");
      }
      for (const lease of active.rows) {
        const table = requestTable(lease.request_kind);
        const requestId = lease[requestIdColumn(lease.request_kind)];
        const match = await transaction.query<{ present: boolean } & Record<string, unknown>>(
          `SELECT EXISTS (
             SELECT 1 FROM ${table}
              WHERE id = $1 AND account_id = $2 AND workspace_id = $3
                AND state IN ('ADMITTED', 'ACTIVE', 'CANCELLING')
           ) AS present`,
          [requestId, lease.account_id, lease.workspace_id],
        );
        if (match.rows[0]?.present !== true) {
          throw new Error("active capacity lease does not join one active request");
        }
      }
      if (before.active_lease_count !== active.rows.length) {
        await transaction.query(
          `UPDATE global_generation_capacity
              SET active_lease_count = $1, version = version + 1, updated_at = $2
            WHERE singleton`,
          [active.rows.length, input.now],
        );
      }
      const after = await capacityForUpdate(transaction);
      const auditLease = active.rows[0];
      if (input.auditId !== undefined && before.active_lease_count !== active.rows.length) {
        const auditIdentity =
          auditLease ??
          (
            await transaction.query<
              {
                account_id: string;
                workspace_id: string;
                actor_user_id: string;
              } & Record<string, unknown>
            >(
              `SELECT account.id AS account_id, workspace.id AS workspace_id,
                      membership.user_id AS actor_user_id
                 FROM accounts account
                 JOIN workspaces workspace ON workspace.account_id = account.id AND workspace.is_default
                 JOIN memberships membership ON membership.workspace_id = workspace.id
                  AND membership.status = 'ACTIVE'
                WHERE account.scope_kind = 'SYSTEM'
                ORDER BY membership.created_at, membership.id
                LIMIT 1`,
            )
          ).rows[0];
        if (auditIdentity === undefined) {
          throw new Error("capacity reconstruction repair requires an audit identity");
        }
        const actorUserId =
          auditLease?.created_by_user_id ??
          (auditIdentity as { readonly actor_user_id: string }).actor_user_id;
        await bindPrincipal(transaction, auditIdentity.account_id);
        await appendAudit(transaction, {
          auditId: input.auditId,
          accountId: auditIdentity.account_id,
          workspaceId: auditIdentity.workspace_id,
          actorUserId,
          operation: "RECONSTRUCT",
          requestKind: "CAPACITY",
          requestId: null,
          leaseId: null,
          requestVersionBefore: null,
          requestVersionAfter: null,
          cursorsBefore: before,
          cursorsAfter: after,
          detail: { activeLeaseCount: active.rows.length },
          occurredAt: input.now,
        });
      }
      return Object.freeze({
        activeLeaseCount: active.rows.length,
        accountIds: Object.freeze(accountIds),
      });
    });
  }
}
