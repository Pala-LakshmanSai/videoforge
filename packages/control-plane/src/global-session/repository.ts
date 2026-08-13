import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import type { GlobalSessionLane } from "../database/vocabulary.js";
import { assertContract, sha256CanonicalJson, type ContractDocument } from "@videoforge/contracts";

export type GlobalSessionProblemCode =
  | "ACTIVE_PROJECT_TRANSITION_UNVERIFIED"
  | "ADMISSION_REQUIRED"
  | "DISPATCH_AUTHORITY_UNVERIFIED"
  | "DURABLE_OUTPUT_AUTHORITY_UNVERIFIED"
  | "GENERATION_SESSION_CHANGED"
  | "GPU_INVENTORY_STALE"
  | "GPU_OFFERING_UNAVAILABLE"
  | "GPU_PRICE_CHANGED"
  | "POD_CREATE_AMBIGUOUS"
  | "POD_DELETE_UNVERIFIED"
  | "POD_MODEL_READY_UNVERIFIED"
  | "LANE_DEMAND_UNVERIFIED"
  | "QUEUE_ENTRY_ACTIVE"
  | "QUEUE_ENTRY_NOT_WAITING"
  | "QUEUE_VERSION_CONFLICT"
  | "SESSION_NOT_DRAINED";

export class GlobalSessionContractError extends Error {
  readonly code: GlobalSessionProblemCode;

  constructor(code: GlobalSessionProblemCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "GlobalSessionContractError";
    this.code = code;
  }
}

export interface AdmissionCommand {
  readonly admissionId: string;
  readonly userId: string;
  readonly normalizedEmail: string;
  readonly emailVerifiedAt: string;
  readonly inviteRedemptionId: string;
  readonly authMethods: readonly ("EMAIL_PASSWORD" | "GOOGLE")[];
  readonly admittedAt: string;
}

export interface LaneVolumeCommand {
  readonly lane: GlobalSessionLane;
  readonly modelVolumeId: string;
  readonly providerVolumeId: string;
  readonly modelRevision: string;
  readonly manifestId: string;
  readonly manifestSha256: string;
  readonly fileCount: number;
  readonly totalBytes: bigint;
  readonly verifiedAt: string;
}

export interface InventoryReceiptCommand {
  readonly receiptId: string;
  readonly lane: GlobalSessionLane;
  readonly offeringId: string;
  readonly gpuSku: string;
  readonly availableCount: number;
  readonly observedRateMicroUsdPerHour: bigint;
  readonly normalizedPayloadSha256: string;
  readonly observedAt: string;
  readonly expiresAt: string;
}

export interface LaneStartSelection {
  readonly lane: GlobalSessionLane;
  readonly inventoryReceiptId: string;
  readonly modelVolumeId: string;
  readonly manifestId: string;
  readonly offeringId: string;
  readonly selectedGpuSku: string;
  readonly rateCeilingMicroUsdPerHour: bigint;
  readonly podAttemptId: string;
  readonly createAttemptKey: string;
  readonly expectedPodTag: string;
}

export interface StartOrEnqueueCommand {
  readonly proposedSessionId: string;
  readonly queueEntryId: string;
  readonly computeRunPlanId: string;
  readonly computeRunPlanSha256: string;
  readonly projectRevisionId: string;
  readonly admissionId: string;
  readonly idempotencyKey: string;
  readonly gpuPairHash: string;
  readonly now: string;
  readonly hardCeilingMicroUsd: bigint;
  readonly reserveMicroUsd: bigint;
  readonly reserveCostEventId: string;
  readonly reserveCostIdempotencyKey: string;
  readonly openedEventId: string;
  readonly openedEventPayloadSha256: string;
  readonly addedEventId: string;
  readonly addedEventPayloadSha256: string;
  readonly lanes: readonly [LaneStartSelection, LaneStartSelection];
}

export interface StartOrEnqueueResult {
  readonly outcome: "STARTED" | "WAITING";
  readonly generationSessionId: string;
  readonly queueEntryId: string;
  readonly queueVersion: number;
  readonly gpuPairHash: string;
}

interface OpenSessionRow extends Record<string, unknown> {
  readonly id: string;
  readonly queue_version: number;
  readonly gpu_pair_hash: string;
  readonly state: string;
}

interface QueueEntryRow extends Record<string, unknown> {
  readonly id: string;
  readonly generation_session_id: string;
  readonly state: string;
  readonly position: number;
}

interface CountRow extends Record<string, unknown> {
  readonly count: string;
}

interface PodAttemptRow extends Record<string, unknown> {
  readonly id: string;
  readonly expected_pod_tag: string;
  readonly selected_gpu_sku: string;
  readonly model_volume_id: string;
  readonly manifest_id: string;
  readonly create_state: string;
  readonly delete_state: string;
  readonly model_ready_at: string | null;
}

interface DatabaseError extends Error {
  readonly code?: string;
}

function isDatabaseError(error: unknown, code: string): error is DatabaseError {
  return error instanceof Error && "code" in error && error.code === code;
}

function laneExpectations(lane: GlobalSessionLane): {
  readonly modelId: string;
  readonly precision: string;
  readonly mountPath: string;
} {
  return lane === "mage_image"
    ? {
        modelId: "Comfy-Org/Mage-Flow",
        precision: "int8-convrot",
        mountPath: "/models/mage",
      }
    : {
        modelId: "EchoMimicV3-Flash",
        precision: "fp8",
        mountPath: "/models/echo",
      };
}

function lanesByName(
  lanes: readonly [LaneStartSelection, LaneStartSelection],
): Readonly<Record<GlobalSessionLane, LaneStartSelection>> {
  const entries = Object.fromEntries(lanes.map((lane) => [lane.lane, lane]));
  if (entries.mage_image === undefined || entries.echo_avatar === undefined) {
    throw new GlobalSessionContractError(
      "GENERATION_SESSION_CHANGED",
      "Idle start requires one independent selection for each exact lane.",
    );
  }
  return entries as unknown as Readonly<Record<GlobalSessionLane, LaneStartSelection>>;
}

async function requireAdmission(executor: SqlExecutor, admissionId: string): Promise<void> {
  const result = await executor.query(
    `SELECT id FROM app_admissions WHERE id = $1 AND status = 'ADMITTED'`,
    [admissionId],
  );
  if (result.rows.length !== 1) {
    throw new GlobalSessionContractError(
      "ADMISSION_REQUIRED",
      "Global session mutation requires one admitted identity.",
    );
  }
}

async function openSession(executor: SqlExecutor, lock: boolean): Promise<OpenSessionRow | null> {
  const result = await executor.query<OpenSessionRow>(
    `SELECT id, queue_version, gpu_pair_hash, state
       FROM generation_sessions
      WHERE singleton_key = 'GLOBAL' AND state IN ('LOCKING', 'ACTIVE', 'DRAINING')
      ${lock ? "FOR UPDATE" : ""}`,
  );
  if (result.rows.length > 1) {
    throw new GlobalSessionContractError(
      "GENERATION_SESSION_CHANGED",
      "Singleton generation-session invariant is broken.",
    );
  }
  return result.rows[0] ?? null;
}

async function nextEventSequence(executor: SqlExecutor, sessionId: string): Promise<number> {
  const result = await executor.query<CountRow>(
    `SELECT (coalesce(max(sequence), 0) + 1)::text AS count
       FROM global_session_events WHERE generation_session_id = $1`,
    [sessionId],
  );
  return Number(result.rows[0]?.count ?? "1");
}

export class GlobalSessionRepository {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async registerAdmission(command: AdmissionCommand): Promise<void> {
    await this.database.query(
      `INSERT INTO app_admissions (
         id, user_id, normalized_email, email_verified_at, invite_redemption_id,
         auth_methods, status, version, admitted_at
       ) VALUES ($1, $2, $3, $4, $5, string_to_array($6, ','), 'ADMITTED', 1, $7)`,
      [
        command.admissionId,
        command.userId,
        command.normalizedEmail,
        command.emailVerifiedAt,
        command.inviteRedemptionId,
        command.authMethods.join(","),
        command.admittedAt,
      ],
    );
  }

  async registerLaneVolume(command: LaneVolumeCommand): Promise<void> {
    const expected = laneExpectations(command.lane);
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `INSERT INTO model_volumes (
           id, provider_volume_id, lane, region, mount_path, model_id, model_revision,
           precision, retention_state, routine_deletion_allowed, registered_at
         ) VALUES ($1, $2, $3, 'EU-RO-1', $4, $5, $6, $7, 'RETAINED', false, $8)`,
        [
          command.modelVolumeId,
          command.providerVolumeId,
          command.lane,
          expected.mountPath,
          expected.modelId,
          command.modelRevision,
          expected.precision,
          command.verifiedAt,
        ],
      );
      await transaction.query(
        `INSERT INTO model_volume_manifests (
           id, model_volume_id, lane, manifest_contract_version, manifest_sha256,
           file_count, total_bytes, state, verified_at, created_at
         ) VALUES ($1, $2, $3, 'model-volume-manifest/v2', $4, $5, $6, 'VERIFIED', $7, $7)`,
        [
          command.manifestId,
          command.modelVolumeId,
          command.lane,
          command.manifestSha256,
          command.fileCount,
          command.totalBytes,
          command.verifiedAt,
        ],
      );
    });
  }

  async recordInventoryReceipt(command: InventoryReceiptCommand): Promise<void> {
    await this.database.query(
      `INSERT INTO gpu_inventory_receipts (
         id, lane, provider, cloud_type, region, offering_id, gpu_sku, gpu_count,
         available_count, observed_rate_micro_usd_per_hour, normalized_payload_sha256,
         observed_at, expires_at, created_at
       ) VALUES ($1, $2, 'RUNPOD', 'SECURE_CLOUD', 'EU-RO-1', $3, $4, 1,
                 $5, $6, $7, $8, $9, $8)`,
      [
        command.receiptId,
        command.lane,
        command.offeringId,
        command.gpuSku,
        command.availableCount,
        command.observedRateMicroUsdPerHour,
        command.normalizedPayloadSha256,
        command.observedAt,
        command.expiresAt,
      ],
    );
  }

  async startOrEnqueue(command: StartOrEnqueueCommand): Promise<StartOrEnqueueResult> {
    try {
      return await this.database.transaction(async (transaction) => {
        await requireAdmission(transaction, command.admissionId);
        const existing = await openSession(transaction, true);
        if (existing !== null) return this.enqueueWaiting(transaction, existing, command);
        return this.openIdleSession(transaction, command);
      });
    } catch (error) {
      if (!isDatabaseError(error, "23505")) throw error;
      return this.database.transaction(async (transaction) => {
        await requireAdmission(transaction, command.admissionId);
        const existing = await openSession(transaction, true);
        if (existing === null) throw error;
        return this.enqueueWaiting(transaction, existing, command);
      });
    }
  }

  private async openIdleSession(
    transaction: SqlExecutor,
    command: StartOrEnqueueCommand,
  ): Promise<StartOrEnqueueResult> {
    const laneMap = lanesByName(command.lanes);
    for (const lane of ["mage_image", "echo_avatar"] as const) {
      const selection = laneMap[lane];
      const receipt = await transaction.query<
        Record<string, unknown> & {
          readonly expires_at: string;
          readonly observed_rate_micro_usd_per_hour: bigint;
          readonly offering_id: string;
          readonly gpu_sku: string;
        }
      >(
        `SELECT expires_at::text, observed_rate_micro_usd_per_hour, offering_id, gpu_sku
           FROM gpu_inventory_receipts
          WHERE id = $1 AND lane = $2 AND available_count > 0`,
        [selection.inventoryReceiptId, lane],
      );
      const row = receipt.rows[0];
      if (row === undefined || Date.parse(row.expires_at) < Date.parse(command.now)) {
        throw new GlobalSessionContractError(
          "GPU_INVENTORY_STALE",
          `Idle ${lane} selection requires one unexpired live inventory receipt.`,
        );
      }
      if (row.offering_id !== selection.offeringId || row.gpu_sku !== selection.selectedGpuSku) {
        throw new GlobalSessionContractError(
          "GPU_OFFERING_UNAVAILABLE",
          `Idle ${lane} selection no longer identifies the observed offering.`,
        );
      }
      if (BigInt(row.observed_rate_micro_usd_per_hour) > selection.rateCeilingMicroUsdPerHour) {
        throw new GlobalSessionContractError(
          "GPU_PRICE_CHANGED",
          `Idle ${lane} offering exceeds its approved rate ceiling.`,
        );
      }
    }

    await transaction.query(
      `INSERT INTO generation_sessions (
         id, singleton_key, state, version, queue_version, gpu_pair_hash,
         selected_by_admission_id, opened_at
       ) VALUES ($1, 'GLOBAL', 'LOCKING', 1, 0, $2, $3, $4)`,
      [command.proposedSessionId, command.gpuPairHash, command.admissionId, command.now],
    );
    for (const lane of ["mage_image", "echo_avatar"] as const) {
      const selection = laneMap[lane];
      await transaction.query(
        `INSERT INTO session_gpu_bindings (
           generation_session_id, lane, inventory_receipt_id, model_volume_id, manifest_id,
           offering_id, selected_gpu_sku, rate_ceiling_micro_usd_per_hour, selected_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          command.proposedSessionId,
          lane,
          selection.inventoryReceiptId,
          selection.modelVolumeId,
          selection.manifestId,
          selection.offeringId,
          selection.selectedGpuSku,
          selection.rateCeilingMicroUsdPerHour,
          command.now,
        ],
      );
    }
    await transaction.query(
      `INSERT INTO global_queue_entries (
         id, generation_session_id, project_revision_id, submitted_by_admission_id,
         position, state, inherited_gpu_pair_hash, idempotency_key, version,
         created_at, activated_at
       ) VALUES ($1, $2, $3, $4, 0, 'ACTIVE', $5, $6, 1, $7, $7)`,
      [
        command.queueEntryId,
        command.proposedSessionId,
        command.projectRevisionId,
        command.admissionId,
        command.gpuPairHash,
        command.idempotencyKey,
        command.now,
      ],
    );
    await transaction.query(
      `INSERT INTO compute_run_plans (
         id, generation_session_id, queue_entry_id, contract_version, plan_sha256,
         state, created_at
       ) VALUES ($1, $2, $3, 'compute-run-plan/v2', $4, 'ACTIVE', $5)`,
      [
        command.computeRunPlanId,
        command.proposedSessionId,
        command.queueEntryId,
        command.computeRunPlanSha256,
        command.now,
      ],
    );
    for (const lane of ["mage_image", "echo_avatar"] as const) {
      const selection = laneMap[lane];
      await transaction.query(
        `INSERT INTO lane_demands (
           generation_session_id, lane, demand, active_queue_entry_id, version, updated_at
         ) VALUES ($1, $2, 'ACTIVE', $3, 1, $4)`,
        [command.proposedSessionId, lane, command.queueEntryId, command.now],
      );
      await transaction.query(
        `INSERT INTO pod_lifecycle_attempts (
           id, generation_session_id, lane, origin_queue_entry_id, create_attempt_key,
           expected_pod_tag, create_state, provider_pod_id, model_volume_id, manifest_id,
           selected_gpu_sku, delete_state, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'REQUESTED', NULL, $7, $8, $9,
                   'NOT_REQUESTED', $10, $10)`,
        [
          selection.podAttemptId,
          command.proposedSessionId,
          lane,
          command.queueEntryId,
          selection.createAttemptKey,
          selection.expectedPodTag,
          selection.modelVolumeId,
          selection.manifestId,
          selection.selectedGpuSku,
          command.now,
        ],
      );
    }
    await transaction.query(
      `INSERT INTO global_session_cost_events (
         id, generation_session_id, queue_entry_id, lane, stage, sequence,
         amount_micro_usd, hard_ceiling_micro_usd, idempotency_key, occurred_at
       ) VALUES ($1, $2, $3, 'session', 'RESERVED', 1, $4, $5, $6, $7)`,
      [
        command.reserveCostEventId,
        command.proposedSessionId,
        command.queueEntryId,
        command.reserveMicroUsd,
        command.hardCeilingMicroUsd,
        command.reserveCostIdempotencyKey,
        command.now,
      ],
    );
    await transaction.query(
      `INSERT INTO global_session_events (
         id, generation_session_id, sequence, kind, actor_admission_id,
         queue_entry_id, lane, payload_sha256, occurred_at
       ) VALUES ($1, $2, 1, 'GENERATION_SESSION_OPENED', $3, $4, NULL, $5, $6)`,
      [
        command.openedEventId,
        command.proposedSessionId,
        command.admissionId,
        command.queueEntryId,
        command.openedEventPayloadSha256,
        command.now,
      ],
    );
    await transaction.query(
      `UPDATE generation_sessions
          SET state = 'ACTIVE', queue_version = 1, version = 2
        WHERE id = $1 AND state = 'LOCKING'`,
      [command.proposedSessionId],
    );
    return Object.freeze({
      outcome: "STARTED",
      generationSessionId: command.proposedSessionId,
      queueEntryId: command.queueEntryId,
      queueVersion: 1,
      gpuPairHash: command.gpuPairHash,
    });
  }

  private async enqueueWaiting(
    transaction: SqlExecutor,
    session: OpenSessionRow,
    command: StartOrEnqueueCommand,
  ): Promise<StartOrEnqueueResult> {
    if (session.state !== "ACTIVE") {
      throw new GlobalSessionContractError(
        "GENERATION_SESSION_CHANGED",
        "Projects may join only an active global generation session.",
      );
    }
    const replay = await transaction.query<QueueEntryRow>(
      `SELECT id, generation_session_id, state, position
         FROM global_queue_entries WHERE idempotency_key = $1`,
      [command.idempotencyKey],
    );
    if (replay.rows[0] !== undefined) {
      return Object.freeze({
        outcome: replay.rows[0].state === "ACTIVE" ? "STARTED" : "WAITING",
        generationSessionId: replay.rows[0].generation_session_id,
        queueEntryId: replay.rows[0].id,
        queueVersion: session.queue_version,
        gpuPairHash: session.gpu_pair_hash,
      });
    }
    const tail = await transaction.query<CountRow>(
      `SELECT (coalesce(max(position), -1) + 1)::text AS count
         FROM global_queue_entries
        WHERE generation_session_id = $1 AND state IN ('ACTIVE', 'WAITING')`,
      [session.id],
    );
    const position = Number(tail.rows[0]?.count ?? "1");
    const nextVersion = session.queue_version + 1;
    await transaction.query(
      `INSERT INTO global_queue_entries (
         id, generation_session_id, project_revision_id, submitted_by_admission_id,
         position, state, inherited_gpu_pair_hash, idempotency_key, version, created_at
       ) VALUES ($1, $2, $3, $4, $5, 'WAITING', $6, $7, 1, $8)`,
      [
        command.queueEntryId,
        session.id,
        command.projectRevisionId,
        command.admissionId,
        position,
        session.gpu_pair_hash,
        command.idempotencyKey,
        command.now,
      ],
    );
    const sequence = await nextEventSequence(transaction, session.id);
    await transaction.query(
      `INSERT INTO global_session_events (
         id, generation_session_id, sequence, kind, actor_admission_id,
         queue_entry_id, lane, payload_sha256, occurred_at
       ) VALUES ($1, $2, $3, 'QUEUE_ENTRY_ADDED', $4, $5, NULL, $6, $7)`,
      [
        command.addedEventId,
        session.id,
        sequence,
        command.admissionId,
        command.queueEntryId,
        command.addedEventPayloadSha256,
        command.now,
      ],
    );
    await transaction.query(
      `UPDATE generation_sessions
          SET queue_version = $2, version = version + 1
        WHERE id = $1 AND queue_version = $3`,
      [session.id, nextVersion, session.queue_version],
    );
    return Object.freeze({
      outcome: "WAITING",
      generationSessionId: session.id,
      queueEntryId: command.queueEntryId,
      queueVersion: nextVersion,
      gpuPairHash: session.gpu_pair_hash,
    });
  }

  async moveWaiting(command: {
    readonly generationSessionId: string;
    readonly queueEntryId: string;
    readonly targetWaitingIndex: number;
    readonly expectedQueueVersion: number;
    readonly actorAdmissionId: string;
    readonly eventId: string;
    readonly eventPayloadSha256: string;
    readonly now: string;
  }): Promise<number> {
    return this.database.transaction(async (transaction) => {
      await requireAdmission(transaction, command.actorAdmissionId);
      const session = await this.lockExpectedSession(
        transaction,
        command.generationSessionId,
        command.expectedQueueVersion,
      );
      const waiting = await this.waitingEntries(transaction, command.generationSessionId);
      const sourceIndex = waiting.findIndex(({ id }) => id === command.queueEntryId);
      if (sourceIndex < 0) await this.rejectNonWaiting(transaction, command.queueEntryId);
      if (
        command.targetWaitingIndex < 0 ||
        command.targetWaitingIndex >= waiting.length ||
        sourceIndex < 0
      ) {
        throw new GlobalSessionContractError(
          "QUEUE_ENTRY_NOT_WAITING",
          "Waiting queue move target is outside the current waiting order.",
        );
      }
      const [moved] = waiting.splice(sourceIndex, 1);
      waiting.splice(command.targetWaitingIndex, 0, moved!);
      await this.rewriteWaitingPositions(transaction, command.generationSessionId, waiting);
      const nextVersion = session.queue_version + 1;
      await this.appendQueueEvent(transaction, {
        eventId: command.eventId,
        sessionId: command.generationSessionId,
        kind: "QUEUE_ENTRY_MOVED",
        actorAdmissionId: command.actorAdmissionId,
        queueEntryId: command.queueEntryId,
        payloadSha256: command.eventPayloadSha256,
        now: command.now,
      });
      await transaction.query(
        `UPDATE generation_sessions SET queue_version = $2, version = version + 1
          WHERE id = $1 AND queue_version = $3`,
        [command.generationSessionId, nextVersion, session.queue_version],
      );
      return nextVersion;
    });
  }

  async removeWaiting(command: {
    readonly generationSessionId: string;
    readonly queueEntryId: string;
    readonly expectedQueueVersion: number;
    readonly actorAdmissionId: string;
    readonly eventId: string;
    readonly eventPayloadSha256: string;
    readonly now: string;
  }): Promise<number> {
    return this.database.transaction(async (transaction) => {
      await requireAdmission(transaction, command.actorAdmissionId);
      const session = await this.lockExpectedSession(
        transaction,
        command.generationSessionId,
        command.expectedQueueVersion,
      );
      const entry = await transaction.query<QueueEntryRow>(
        `SELECT id, generation_session_id, state, position
           FROM global_queue_entries
          WHERE generation_session_id = $1 AND id = $2 FOR UPDATE`,
        [command.generationSessionId, command.queueEntryId],
      );
      if (entry.rows[0]?.state !== "WAITING") {
        await this.rejectNonWaiting(transaction, command.queueEntryId);
      }
      await transaction.query(
        `UPDATE global_queue_entries
            SET state = 'REMOVED', removed_at = $3, version = version + 1
          WHERE generation_session_id = $1 AND id = $2 AND state = 'WAITING'`,
        [command.generationSessionId, command.queueEntryId, command.now],
      );
      const waiting = await this.waitingEntries(transaction, command.generationSessionId);
      await this.rewriteWaitingPositions(transaction, command.generationSessionId, waiting);
      const nextVersion = session.queue_version + 1;
      await this.appendQueueEvent(transaction, {
        eventId: command.eventId,
        sessionId: command.generationSessionId,
        kind: "QUEUE_ENTRY_REMOVED",
        actorAdmissionId: command.actorAdmissionId,
        queueEntryId: command.queueEntryId,
        payloadSha256: command.eventPayloadSha256,
        now: command.now,
      });
      await transaction.query(
        `UPDATE generation_sessions SET queue_version = $2, version = version + 1
          WHERE id = $1 AND queue_version = $3`,
        [command.generationSessionId, nextVersion, session.queue_version],
      );
      return nextVersion;
    });
  }

  private async lockExpectedSession(
    transaction: SqlExecutor,
    sessionId: string,
    expectedQueueVersion: number,
  ): Promise<OpenSessionRow> {
    const result = await transaction.query<OpenSessionRow>(
      `SELECT id, queue_version, gpu_pair_hash, state
         FROM generation_sessions WHERE id = $1 FOR UPDATE`,
      [sessionId],
    );
    const session = result.rows[0];
    if (session === undefined || session.queue_version !== expectedQueueVersion) {
      throw new GlobalSessionContractError(
        "QUEUE_VERSION_CONFLICT",
        "Global queue version changed; reload before mutating waiting entries.",
      );
    }
    return session;
  }

  private async waitingEntries(
    transaction: SqlExecutor,
    sessionId: string,
  ): Promise<QueueEntryRow[]> {
    const result = await transaction.query<QueueEntryRow>(
      `SELECT id, generation_session_id, state, position
         FROM global_queue_entries
        WHERE generation_session_id = $1 AND state = 'WAITING'
        ORDER BY position, id`,
      [sessionId],
    );
    return [...result.rows];
  }

  private async rewriteWaitingPositions(
    transaction: SqlExecutor,
    sessionId: string,
    waiting: readonly QueueEntryRow[],
  ): Promise<void> {
    await transaction.query(
      `UPDATE global_queue_entries
          SET position = position + 1000000, version = version + 1
        WHERE generation_session_id = $1 AND state = 'WAITING'`,
      [sessionId],
    );
    for (const [index, entry] of waiting.entries()) {
      await transaction.query(
        `UPDATE global_queue_entries SET position = $3, version = version + 1
          WHERE generation_session_id = $1 AND id = $2 AND state = 'WAITING'`,
        [sessionId, entry.id, index + 1],
      );
    }
  }

  private async rejectNonWaiting(transaction: SqlExecutor, queueEntryId: string): Promise<never> {
    const result = await transaction.query<QueueEntryRow>(
      `SELECT id, generation_session_id, state, position FROM global_queue_entries WHERE id = $1`,
      [queueEntryId],
    );
    if (result.rows[0]?.state === "ACTIVE") {
      throw new GlobalSessionContractError(
        "QUEUE_ENTRY_ACTIVE",
        "Active queue entry cannot be reordered or removed.",
      );
    }
    throw new GlobalSessionContractError(
      "QUEUE_ENTRY_NOT_WAITING",
      "Only waiting queue entries may be reordered or removed.",
    );
  }

  private async appendQueueEvent(
    transaction: SqlExecutor,
    command: {
      readonly eventId: string;
      readonly sessionId: string;
      readonly kind: "QUEUE_ENTRY_MOVED" | "QUEUE_ENTRY_REMOVED";
      readonly actorAdmissionId: string;
      readonly queueEntryId: string;
      readonly payloadSha256: string;
      readonly now: string;
    },
  ): Promise<void> {
    const sequence = await nextEventSequence(transaction, command.sessionId);
    await transaction.query(
      `INSERT INTO global_session_events (
         id, generation_session_id, sequence, kind, actor_admission_id,
         queue_entry_id, lane, payload_sha256, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8)`,
      [
        command.eventId,
        command.sessionId,
        sequence,
        command.kind,
        command.actorAdmissionId,
        command.queueEntryId,
        command.payloadSha256,
        command.now,
      ],
    );
  }

  async observeCreate(command: {
    readonly podAttemptId: string;
    readonly observed: readonly {
      readonly providerPodId: string;
      readonly podTag: string;
      readonly gpuSku: string;
      readonly modelVolumeId: string;
      readonly manifestId: string;
    }[];
    readonly now: string;
  }): Promise<"ACKNOWLEDGED" | "RECONCILED_ABSENT" | "AMBIGUOUS"> {
    return this.database.transaction(async (transaction) => {
      const attempt = await transaction.query<PodAttemptRow>(
        `SELECT id, expected_pod_tag, selected_gpu_sku, model_volume_id, manifest_id,
                create_state, delete_state, model_ready_at
           FROM pod_lifecycle_attempts WHERE id = $1 FOR UPDATE`,
        [command.podAttemptId],
      );
      const expected = attempt.rows[0];
      if (expected === undefined) {
        throw new GlobalSessionContractError(
          "POD_CREATE_AMBIGUOUS",
          "Pod create attempt does not exist.",
        );
      }
      const exact = command.observed.filter(
        (pod) =>
          pod.podTag === expected.expected_pod_tag &&
          pod.gpuSku === expected.selected_gpu_sku &&
          pod.modelVolumeId === expected.model_volume_id &&
          pod.manifestId === expected.manifest_id,
      );
      if (command.observed.length === 1 && exact.length === 1) {
        await transaction.query(
          `UPDATE pod_lifecycle_attempts
              SET create_state = 'ACKNOWLEDGED', provider_pod_id = $2, updated_at = $3
            WHERE id = $1`,
          [command.podAttemptId, exact[0]!.providerPodId, command.now],
        );
        return "ACKNOWLEDGED";
      }
      if (command.observed.length === 0) {
        await transaction.query(
          `UPDATE pod_lifecycle_attempts
              SET create_state = 'RECONCILED_ABSENT', updated_at = $2
            WHERE id = $1`,
          [command.podAttemptId, command.now],
        );
        return "RECONCILED_ABSENT";
      }
      await transaction.query(
        `UPDATE pod_lifecycle_attempts
            SET create_state = 'AMBIGUOUS', provider_pod_id = NULL, updated_at = $2
          WHERE id = $1`,
        [command.podAttemptId, command.now],
      );
      return "AMBIGUOUS";
    });
  }

  async recordModelReady(command: {
    readonly podAttemptId: string;
    readonly actualGpuSku: string;
    readonly containerReadyAt: string | null;
    readonly volumeVerifiedAt: string | null;
    readonly warmupPassedAt: string | null;
    readonly modelReadyAt: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE pod_lifecycle_attempts
          SET actual_gpu_sku = $2, container_ready_at = $3, volume_verified_at = $4,
              warmup_passed_at = $5, model_ready_at = $6, updated_at = $6
        WHERE id = $1 AND create_state = 'ACKNOWLEDGED'
          AND delete_state = 'NOT_REQUESTED' AND model_ready_at IS NULL`,
      [
        command.podAttemptId,
        command.actualGpuSku,
        command.containerReadyAt,
        command.volumeVerifiedAt,
        command.warmupPassedAt,
        command.modelReadyAt,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new GlobalSessionContractError(
        "POD_MODEL_READY_UNVERIFIED",
        "Model readiness requires one exact acknowledged live Pod attempt that is not already ready.",
      );
    }
  }

  async recordDurableOutput(command: {
    readonly outputId: string;
    readonly generationSessionId: string;
    readonly queueEntryId: string;
    readonly lane: GlobalSessionLane | "render";
    readonly podAttemptId: string | null;
    readonly artifactId: string;
    readonly artifactSha256: string;
    readonly byteSize: bigint;
    readonly verifiedAt: string;
  }): Promise<void> {
    try {
      await this.database.query(
        `INSERT INTO durable_generation_outputs (
           id, generation_session_id, queue_entry_id, lane, pod_attempt_id, artifact_id,
           artifact_sha256, byte_size, durability_state, verified_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'VERIFIED', $9)`,
        [
          command.outputId,
          command.generationSessionId,
          command.queueEntryId,
          command.lane,
          command.podAttemptId,
          command.artifactId,
          command.artifactSha256,
          command.byteSize,
          command.verifiedAt,
        ],
      );
    } catch (error) {
      throw new GlobalSessionContractError(
        "DURABLE_OUTPUT_AUTHORITY_UNVERIFIED",
        "Durable output must match the exact queue entry and ready Pod lane.",
        error,
      );
    }
  }

  async authorizePodDispatch(command: {
    readonly authorizationId: string;
    readonly envelope: ContractDocument<"podWorkerJobEnvelope">;
    readonly authorizedAt: string;
  }): Promise<`sha256:${string}`> {
    const envelope = assertContract("podWorkerJobEnvelope", structuredClone(command.envelope));
    const envelopeSha256 = await sha256CanonicalJson(envelope);
    const result = await this.database.query(
      `INSERT INTO pod_dispatch_authorizations (
         id, envelope_sha256, envelope_document, generation_session_id, queue_entry_id,
         compute_run_plan_id, pod_attempt_id, lane, authorized_at, deadline_at
       )
       SELECT $1, $2, $3::jsonb, gs.id, queue_entry.id, run_plan.id,
              pod_attempt.id, pod_attempt.lane, $4, $5
         FROM generation_sessions gs
         JOIN global_queue_entries queue_entry
           ON queue_entry.generation_session_id = gs.id AND queue_entry.id = $6
         JOIN project_revisions project_revision
           ON project_revision.id = queue_entry.project_revision_id
         JOIN compute_run_plans run_plan
           ON run_plan.generation_session_id = gs.id
          AND run_plan.id = $7 AND run_plan.queue_entry_id = queue_entry.id
         JOIN pod_lifecycle_attempts pod_attempt
           ON pod_attempt.generation_session_id = gs.id
          AND pod_attempt.id = $8
          AND pod_attempt.origin_queue_entry_id = queue_entry.id
          AND pod_attempt.lane = $9
         JOIN session_gpu_bindings binding
           ON binding.generation_session_id = gs.id AND binding.lane = pod_attempt.lane
         JOIN model_volumes volume
           ON volume.id = binding.model_volume_id AND volume.lane = binding.lane
         JOIN model_volume_manifests manifest
           ON manifest.id = binding.manifest_id
          AND manifest.model_volume_id = binding.model_volume_id AND manifest.lane = binding.lane
         JOIN gpu_inventory_receipts receipt
           ON receipt.id = binding.inventory_receipt_id AND receipt.lane = binding.lane
        WHERE gs.id = $10 AND gs.state = 'ACTIVE'
          AND queue_entry.state = 'ACTIVE'
          AND run_plan.state = 'ACTIVE' AND run_plan.plan_sha256 = $11
          AND pod_attempt.create_state = 'ACKNOWLEDGED'
          AND pod_attempt.model_ready_at IS NOT NULL
          AND pod_attempt.delete_state = 'NOT_REQUESTED'
          AND pod_attempt.actual_gpu_sku = binding.selected_gpu_sku
          AND pod_attempt.create_attempt_key = $12
          AND binding.model_volume_id::text = $13 AND binding.manifest_id::text = $14
          AND binding.inventory_receipt_id::text = $15 AND binding.offering_id = $16
          AND binding.selected_gpu_sku = $17
          AND binding.rate_ceiling_micro_usd_per_hour = $18
          AND volume.provider_volume_id = $19 AND volume.model_id = $20
          AND volume.model_revision = $21 AND volume.precision = $22
          AND volume.region = $23 AND volume.mount_path = $24
          AND manifest.manifest_sha256 = $25
          AND receipt.gpu_count = $26 AND receipt.offering_id = $16 AND receipt.gpu_sku = $17
          AND $4::timestamptz < $5::timestamptz
          AND $27::bigint <= project_revision.maximum_cost_micro_usd`,
      [
        command.authorizationId,
        envelopeSha256,
        JSON.stringify(envelope),
        command.authorizedAt,
        envelope.deadline_at,
        envelope.queue_entry_id,
        envelope.compute_run_plan_id,
        envelope.pod_resource_binding.pod_attempt_id,
        envelope.lane,
        envelope.generation_session_id,
        envelope.compute_run_plan_sha256,
        envelope.pod_resource_binding.create_attempt_id,
        envelope.pod_resource_binding.model_volume_id,
        envelope.pod_resource_binding.manifest_id,
        envelope.pod_resource_binding.inventory_receipt_id,
        envelope.pod_resource_binding.offering_id,
        envelope.pod_resource_binding.selected_gpu_sku,
        envelope.pod_resource_binding.rate_ceiling_micro_usd_per_hour,
        envelope.pod_resource_binding.provider_volume_id,
        envelope.pod_resource_binding.model_id,
        envelope.pod_resource_binding.model_revision,
        envelope.pod_resource_binding.precision,
        envelope.pod_resource_binding.region,
        envelope.pod_resource_binding.mount_path,
        envelope.pod_resource_binding.manifest_sha256,
        envelope.pod_resource_binding.gpu_count,
        envelope.maximum_cost_micro_usd,
      ],
    );
    if (result.affectedRows !== 1) {
      throw new GlobalSessionContractError(
        "DISPATCH_AUTHORITY_UNVERIFIED",
        "Dispatch authority requires one exact active persisted session tuple.",
      );
    }
    return envelopeSha256;
  }

  async settleLaneDemand(command: {
    readonly generationSessionId: string;
    readonly lane: GlobalSessionLane;
    readonly podAttemptId: string;
    readonly now: string;
  }): Promise<"WAITING_WARM" | "DELETE_REQUESTED"> {
    return this.database.transaction(async (transaction) => {
      const waiters = await transaction.query<CountRow>(
        `SELECT count(*)::text AS count FROM global_queue_entries
          WHERE generation_session_id = $1 AND state = 'WAITING'`,
        [command.generationSessionId],
      );
      if (Number(waiters.rows[0]?.count ?? "0") > 0) {
        const result = await transaction.query(
          `UPDATE lane_demands
              SET demand = 'WAITING_WARM', active_queue_entry_id = NULL,
                  version = version + 1, updated_at = $3
            WHERE generation_session_id = $1 AND lane = $2
              AND EXISTS (
                SELECT 1 FROM pod_lifecycle_attempts
                 WHERE id = $4 AND generation_session_id = $1 AND lane = $2
                   AND model_ready_at IS NOT NULL AND delete_state = 'NOT_REQUESTED'
              )`,
          [command.generationSessionId, command.lane, command.now, command.podAttemptId],
        );
        if (result.affectedRows !== 1) {
          throw new GlobalSessionContractError(
            "LANE_DEMAND_UNVERIFIED",
            "Waiting demand may retain only the exact model-ready live Pod attempt.",
          );
        }
        return "WAITING_WARM";
      }
      const demand = await transaction.query(
        `UPDATE lane_demands
            SET demand = 'ZERO', active_queue_entry_id = NULL,
                version = version + 1, updated_at = $3
          WHERE generation_session_id = $1 AND lane = $2
            AND EXISTS (
              SELECT 1 FROM pod_lifecycle_attempts
               WHERE id = $4 AND generation_session_id = $1 AND lane = $2
                 AND delete_state = 'NOT_REQUESTED'
            )`,
        [command.generationSessionId, command.lane, command.now, command.podAttemptId],
      );
      const deletion = await transaction.query(
        `UPDATE pod_lifecycle_attempts
            SET delete_state = 'REQUESTED', delete_requested_at = $2, updated_at = $2
          WHERE id = $1 AND generation_session_id = $3 AND lane = $4
            AND delete_state = 'NOT_REQUESTED'`,
        [command.podAttemptId, command.now, command.generationSessionId, command.lane],
      );
      if (demand.affectedRows !== 1 || deletion.affectedRows !== 1) {
        throw new GlobalSessionContractError(
          "LANE_DEMAND_UNVERIFIED",
          "Zero lane demand requires one exact live Pod delete intent.",
        );
      }
      return "DELETE_REQUESTED";
    });
  }

  async recordDeleteAcknowledged(command: {
    readonly podAttemptId: string;
    readonly acknowledgedAt: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE pod_lifecycle_attempts
          SET delete_state = 'ACKNOWLEDGED', delete_acknowledged_at = $2, updated_at = $2
        WHERE id = $1 AND delete_state IN ('REQUESTED', 'ACK_UNKNOWN')`,
      [command.podAttemptId, command.acknowledgedAt],
    );
    if (result.affectedRows !== 1) {
      throw new GlobalSessionContractError(
        "POD_DELETE_UNVERIFIED",
        "Delete acknowledgement requires one exact requested or reconciling Pod attempt.",
      );
    }
  }

  async recordDeleteAmbiguous(command: {
    readonly podAttemptId: string;
    readonly observedAt: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE pod_lifecycle_attempts
          SET delete_state = 'ACK_UNKNOWN', updated_at = $2
        WHERE id = $1 AND delete_state = 'REQUESTED'`,
      [command.podAttemptId, command.observedAt],
    );
    if (result.affectedRows !== 1) {
      throw new GlobalSessionContractError(
        "POD_DELETE_UNVERIFIED",
        "Ambiguous delete observation requires one exact requested Pod attempt.",
      );
    }
  }

  async requestPodDelete(command: {
    readonly generationSessionId: string;
    readonly lane: GlobalSessionLane;
    readonly podAttemptId: string;
    readonly requestedAt: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.query(
        `UPDATE lane_demands
            SET demand = 'ZERO', active_queue_entry_id = NULL,
                version = version + 1, updated_at = $3
          WHERE generation_session_id = $1 AND lane = $2`,
        [command.generationSessionId, command.lane, command.requestedAt],
      );
      const result = await transaction.query(
        `UPDATE pod_lifecycle_attempts
            SET delete_state = 'REQUESTED', delete_requested_at = $2, updated_at = $2
          WHERE id = $1 AND generation_session_id = $3 AND lane = $4
            AND delete_state = 'NOT_REQUESTED'`,
        [command.podAttemptId, command.requestedAt, command.generationSessionId, command.lane],
      );
      if (result.affectedRows !== 1) {
        throw new GlobalSessionContractError(
          "POD_DELETE_UNVERIFIED",
          "Only one exact live Pod attempt may receive a delete intent.",
        );
      }
    });
  }

  async recordPodAbsence(command: {
    readonly podAttemptId: string;
    readonly absenceReceiptSha256: string;
    readonly verifiedAt: string;
  }): Promise<void> {
    const result = await this.database.query(
      `UPDATE pod_lifecycle_attempts
          SET delete_state = 'ABSENCE_VERIFIED', absence_receipt_sha256 = $2,
              absence_verified_at = $3, updated_at = $3
        WHERE id = $1 AND delete_state = 'ACKNOWLEDGED'`,
      [command.podAttemptId, command.absenceReceiptSha256, command.verifiedAt],
    );
    if (result.affectedRows !== 1) {
      throw new GlobalSessionContractError(
        "POD_DELETE_UNVERIFIED",
        "Pod absence requires an acknowledged exact delete followed by an absence receipt.",
      );
    }
  }

  async markActiveTerminal(command: {
    readonly generationSessionId: string;
    readonly queueEntryId: string;
    readonly now: string;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const plan = await transaction.query(
        `UPDATE compute_run_plans
            SET state = 'TERMINAL', terminal_at = $3
          WHERE generation_session_id = $1 AND queue_entry_id = $2 AND state = 'ACTIVE'`,
        [command.generationSessionId, command.queueEntryId, command.now],
      );
      const entry = await transaction.query(
        `UPDATE global_queue_entries
            SET state = 'TERMINAL', terminal_at = $3, version = version + 1
          WHERE generation_session_id = $1 AND id = $2 AND state = 'ACTIVE'`,
        [command.generationSessionId, command.queueEntryId, command.now],
      );
      const session = await transaction.query(
        `UPDATE generation_sessions
            SET queue_version = queue_version + 1, version = version + 1
          WHERE id = $1`,
        [command.generationSessionId],
      );
      if (plan.affectedRows !== 1 || entry.affectedRows !== 1 || session.affectedRows !== 1) {
        throw new GlobalSessionContractError(
          "ACTIVE_PROJECT_TRANSITION_UNVERIFIED",
          "Active-project stop requires one exact active run plan, queue entry, and session.",
        );
      }
    });
  }

  async recordRevalidation(command: {
    readonly revalidationId: string;
    readonly generationSessionId: string;
    readonly lane: GlobalSessionLane;
    readonly inventoryReceiptId: string;
    readonly revalidatedAt: string;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO session_gpu_revalidations (
         id, generation_session_id, lane, inventory_receipt_id, revalidated_at, created_at
       ) VALUES ($1, $2, $3, $4, $5, $5)`,
      [
        command.revalidationId,
        command.generationSessionId,
        command.lane,
        command.inventoryReceiptId,
        command.revalidatedAt,
      ],
    );
  }

  async activateNext(command: {
    readonly generationSessionId: string;
    readonly queueEntryId: string;
    readonly computeRunPlanId: string;
    readonly computeRunPlanSha256: string;
    readonly now: string;
    readonly missingLaneAttempts: readonly {
      readonly lane: GlobalSessionLane;
      readonly revalidationId: string;
      readonly podAttemptId: string;
      readonly createAttemptKey: string;
      readonly expectedPodTag: string;
    }[];
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const entry = await transaction.query<QueueEntryRow>(
        `SELECT id, generation_session_id, state, position
           FROM global_queue_entries
          WHERE generation_session_id = $1 AND id = $2 FOR UPDATE`,
        [command.generationSessionId, command.queueEntryId],
      );
      if (entry.rows[0]?.state !== "WAITING") {
        throw new GlobalSessionContractError(
          "QUEUE_ENTRY_NOT_WAITING",
          "Only the next waiting entry may become active.",
        );
      }
      const first = await transaction.query<QueueEntryRow>(
        `SELECT id, generation_session_id, state, position
           FROM global_queue_entries
          WHERE generation_session_id = $1 AND state = 'WAITING'
          ORDER BY position, id LIMIT 1`,
        [command.generationSessionId],
      );
      if (first.rows[0]?.id !== command.queueEntryId) {
        throw new GlobalSessionContractError(
          "GENERATION_SESSION_CHANGED",
          "Only the first waiting entry may be promoted.",
        );
      }
      await transaction.query(
        `UPDATE global_queue_entries
            SET state = 'ACTIVE', position = 0, activated_at = $3, version = version + 1
          WHERE generation_session_id = $1 AND id = $2 AND state = 'WAITING'`,
        [command.generationSessionId, command.queueEntryId, command.now],
      );
      const remainingWaiting = await this.waitingEntries(transaction, command.generationSessionId);
      await this.rewriteWaitingPositions(
        transaction,
        command.generationSessionId,
        remainingWaiting,
      );
      await transaction.query(
        `INSERT INTO compute_run_plans (
           id, generation_session_id, queue_entry_id, contract_version, plan_sha256,
           state, created_at
         ) VALUES ($1, $2, $3, 'compute-run-plan/v2', $4, 'ACTIVE', $5)`,
        [
          command.computeRunPlanId,
          command.generationSessionId,
          command.queueEntryId,
          command.computeRunPlanSha256,
          command.now,
        ],
      );
      const missing = new Map(command.missingLaneAttempts.map((lane) => [lane.lane, lane]));
      for (const lane of ["mage_image", "echo_avatar"] as const) {
        const latest = await transaction.query<PodAttemptRow>(
          `SELECT id, expected_pod_tag, selected_gpu_sku, model_volume_id, manifest_id,
                  create_state, delete_state, model_ready_at
             FROM pod_lifecycle_attempts
            WHERE generation_session_id = $1 AND lane = $2
            ORDER BY created_at DESC, id DESC LIMIT 1`,
          [command.generationSessionId, lane],
        );
        const current = latest.rows[0];
        if (current?.model_ready_at !== null && current?.delete_state === "NOT_REQUESTED") {
          await transaction.query(
            `UPDATE lane_demands
                SET demand = 'ACTIVE', active_queue_entry_id = $3,
                    version = version + 1, updated_at = $4
              WHERE generation_session_id = $1 AND lane = $2`,
            [command.generationSessionId, lane, command.queueEntryId, command.now],
          );
          continue;
        }
        if (current?.delete_state !== "ABSENCE_VERIFIED") {
          throw new GlobalSessionContractError(
            "POD_DELETE_UNVERIFIED",
            `Missing ${lane} Pod cannot be recreated before exact absence is proven.`,
          );
        }
        const next = missing.get(lane);
        if (next === undefined) {
          throw new GlobalSessionContractError(
            "GPU_INVENTORY_STALE",
            `Missing ${lane} Pod requires fresh same-offering revalidation at activation.`,
          );
        }
        const revalidation = await transaction.query<
          Record<string, unknown> & { readonly lane: string; readonly revalidated_at: string }
        >(
          `SELECT lane, revalidated_at::text FROM session_gpu_revalidations
            WHERE id = $1 AND generation_session_id = $2 AND lane = $3`,
          [next.revalidationId, command.generationSessionId, lane],
        );
        if (revalidation.rows[0] === undefined) {
          throw new GlobalSessionContractError(
            "GPU_INVENTORY_STALE",
            `Missing ${lane} Pod requires a persisted live revalidation receipt.`,
          );
        }
        const binding = await transaction.query<
          Record<string, unknown> & {
            readonly model_volume_id: string;
            readonly manifest_id: string;
            readonly selected_gpu_sku: string;
          }
        >(
          `SELECT model_volume_id, manifest_id, selected_gpu_sku
             FROM session_gpu_bindings
            WHERE generation_session_id = $1 AND lane = $2`,
          [command.generationSessionId, lane],
        );
        const selected = binding.rows[0]!;
        await transaction.query(
          `INSERT INTO pod_lifecycle_attempts (
             id, generation_session_id, lane, origin_queue_entry_id, create_attempt_key,
             expected_pod_tag, create_state, provider_pod_id, model_volume_id, manifest_id,
             selected_gpu_sku, delete_state, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'REQUESTED', NULL, $7, $8, $9,
                     'NOT_REQUESTED', $10, $10)`,
          [
            next.podAttemptId,
            command.generationSessionId,
            lane,
            command.queueEntryId,
            next.createAttemptKey,
            next.expectedPodTag,
            selected.model_volume_id,
            selected.manifest_id,
            selected.selected_gpu_sku,
            command.now,
          ],
        );
        await transaction.query(
          `UPDATE lane_demands
              SET demand = 'ACTIVE', active_queue_entry_id = $3,
                  version = version + 1, updated_at = $4
            WHERE generation_session_id = $1 AND lane = $2`,
          [command.generationSessionId, lane, command.queueEntryId, command.now],
        );
      }
      await transaction.query(
        `UPDATE generation_sessions
            SET queue_version = queue_version + 1, version = version + 1
          WHERE id = $1`,
        [command.generationSessionId],
      );
    });
  }

  async closeDrainedSession(command: {
    readonly generationSessionId: string;
    readonly closingAt: string;
    readonly closedAt: string;
  }): Promise<void> {
    try {
      await this.database.transaction(async (transaction) => {
        await transaction.query(
          `UPDATE generation_sessions
              SET state = 'DRAINING', closing_at = $2, version = version + 1
            WHERE id = $1 AND state = 'ACTIVE'`,
          [command.generationSessionId, command.closingAt],
        );
        const result = await transaction.query(
          `UPDATE generation_sessions
              SET state = 'CLOSED', closed_at = $2, version = version + 1
            WHERE id = $1 AND state = 'DRAINING'`,
          [command.generationSessionId, command.closedAt],
        );
        if (result.affectedRows !== 1) {
          throw new GlobalSessionContractError(
            "SESSION_NOT_DRAINED",
            "Only one fully drained session may close.",
          );
        }
      });
    } catch (error) {
      if (error instanceof GlobalSessionContractError) throw error;
      throw new GlobalSessionContractError(
        "SESSION_NOT_DRAINED",
        "Session close requires empty queue, zero demand, both Pods absent, and retained volumes.",
        error,
      );
    }
  }
}
