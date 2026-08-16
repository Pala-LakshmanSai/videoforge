import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import { TENANT_PRINCIPAL_SETTING } from "../database/vocabulary.js";
import type { Sha256, WorkspaceScope } from "../repositories/types.js";
import type { ServerlessLane } from "../serverless/dispatcher.js";

/**
 * Per-video runtime state for the V2-05 cutover.
 *
 * Each admitted video owns independent stage state. CPU preparation may only begin after durable
 * database admission, each lane may only be dispatched after its own items manifest and durable
 * predispatch authority exist, and accepted units belong to the video rather than to one attempt so
 * a bounded retry resumes instead of regenerating.
 *
 * Every state exposed here is a factual private observation. Nothing in this service simulates a
 * worker, a GPU, or provider progress that has not been observed.
 */
export type VideoRuntimeStage =
  | "QUEUED"
  | "PREPARING"
  | "WAITING_FOR_WORKER"
  | "INITIALIZING"
  | "GENERATING_IMAGES"
  | "GENERATING_AVATAR"
  | "RENDERING"
  | "COMPLETE"
  | "FAILED"
  | "CANCELED";

export type VideoRuntimeLaneState =
  | "BLOCKED_ON_PREPARATION"
  | "MANIFEST_DURABLE"
  | "WAITING_FOR_WORKER"
  | "INITIALIZING"
  | "GENERATING"
  | "SUCCEEDED"
  | "FAILED"
  | "CANCELED";

export type VideoRuntimeTerminalReason =
  | "SUCCEEDED"
  | "LANE_PERMANENT_FAILURE"
  | "RENDER_FAILURE"
  | "OWNER_CANCELLED"
  | "SYSTEM_CANCELLED";

export type VideoRuntimeErrorCode =
  | "RUNTIME_NOT_FOUND"
  | "RUNTIME_TERMINAL"
  | "LANE_NOT_FOUND"
  | "LANE_RETRY_EXHAUSTED"
  | "PREPARATION_REQUIRED"
  | "ADMISSION_REQUIRED"
  | "STAGE_CONFLICT"
  | "TENANT_SCOPE_MISMATCH"
  | "UNIT_NOT_PLANNED";

export class VideoRuntimeError extends Error {
  constructor(
    readonly code: VideoRuntimeErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "VideoRuntimeError";
  }
}

export interface VideoRuntimeLanePlan {
  readonly lane: ServerlessLane;
  readonly itemsManifestSha256: Sha256;
  readonly itemIds: readonly string[];
}

export interface VideoRuntimeAcceptedUnit {
  readonly itemId: string;
  readonly objectKey: string;
  readonly checksumSha256: Sha256;
  readonly contentLength: number;
}

export interface VideoRuntimeLaneView {
  readonly lane: ServerlessLane;
  readonly state: VideoRuntimeLaneState;
  readonly plannedItemCount: number;
  readonly acceptedItemCount: number;
  readonly attemptOrdinal: number;
  readonly maxAttemptOrdinal: number;
  readonly currentAttemptId: string | null;
  readonly itemsManifestSha256: Sha256 | null;
}

export interface VideoRuntimeView {
  readonly runtimeId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly generationRequestId: string;
  readonly stage: VideoRuntimeStage;
  readonly terminalReason: VideoRuntimeTerminalReason | null;
  readonly preparationManifestSha256: Sha256 | null;
  readonly renderManifestSha256: Sha256 | null;
  readonly finalOutputSha256: Sha256 | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lanes: readonly VideoRuntimeLaneView[];
  /** No provider call, worker, GPU, or spend is authorized in a provider-free runtime. */
  readonly providerCallsAuthorized: false;
  readonly authorizedSpendUsd: 0;
}

const LANES: readonly ServerlessLane[] = Object.freeze(["mage_image", "soulx_avatar"]);

const LANE_GENERATING_STAGE: Readonly<Record<ServerlessLane, VideoRuntimeStage>> = Object.freeze({
  mage_image: "GENERATING_IMAGES",
  soulx_avatar: "GENERATING_AVATAR",
});

interface RuntimeRow extends Record<string, unknown> {
  readonly id: string;
  readonly account_id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly project_revision_id: string;
  readonly generation_request_id: string;
  readonly stage: VideoRuntimeStage;
  readonly terminal_reason: VideoRuntimeTerminalReason | null;
  readonly preparation_manifest_sha256: Sha256 | null;
  readonly render_manifest_sha256: Sha256 | null;
  readonly final_output_sha256: Sha256 | null;
  readonly version: number;
  readonly created_at: string;
  readonly updated_at: string;
}

interface LaneRow extends Record<string, unknown> {
  readonly id: string;
  readonly lane: ServerlessLane;
  readonly state: VideoRuntimeLaneState;
  readonly items_manifest_sha256: Sha256 | null;
  readonly planned_item_count: number;
  readonly accepted_item_count: number;
  readonly attempt_ordinal: number;
  readonly max_attempt_ordinal: number;
  readonly current_attempt_id: string | null;
  readonly version: number;
}

function timestamp(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
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
    throw new VideoRuntimeError(
      "TENANT_SCOPE_MISMATCH",
      "The authenticated account does not own this active default workspace.",
    );
  }
  await bindPrincipal(executor, scope.accountId);
}

export class VideoRuntimeService {
  readonly #database: TransactionalSqlExecutor;

  constructor(database: TransactionalSqlExecutor) {
    this.#database = database;
  }

  /**
   * Records the runtime of one enqueued video. A queued runtime holds no manifest, no lane work,
   * and no provider identity, so an unadmitted request stays completely inert.
   */
  async register(
    scope: WorkspaceScope,
    input: {
      readonly runtimeId: string;
      readonly projectId: string;
      readonly projectRevisionId: string;
      readonly generationRequestId: string;
      readonly now: string;
    },
  ): Promise<VideoRuntimeView> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      await transaction.query(
        `INSERT INTO video_runtime_states (
           id, account_id, workspace_id, project_id, project_revision_id, generation_request_id,
           stage, version, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, 'QUEUED', 1, $7, $7)
         ON CONFLICT (generation_request_id) DO NOTHING`,
        [
          input.runtimeId,
          scope.accountId,
          scope.workspaceId,
          input.projectId,
          input.projectRevisionId,
          input.generationRequestId,
          input.now,
        ],
      );
      for (const lane of LANES) {
        await transaction.query(
          `INSERT INTO video_runtime_lane_states (
             id, account_id, workspace_id, runtime_id, project_revision_id, lane, state,
             version, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, 'BLOCKED_ON_PREPARATION', 1, $7, $7)
           ON CONFLICT (runtime_id, lane) DO NOTHING`,
          [
            surrogateId(),
            scope.accountId,
            scope.workspaceId,
            input.runtimeId,
            input.projectRevisionId,
            lane,
            input.now,
          ],
        );
      }
    });
    return this.view(scope, input.runtimeId);
  }

  /** CPU preparation is only legal once the database says this video is admitted. */
  async beginPreparation(
    scope: WorkspaceScope,
    input: { readonly runtimeId: string; readonly now: string },
  ): Promise<VideoRuntimeView> {
    await this.#transition(scope, input.runtimeId, "PREPARING", "PREPARATION_STARTED", input.now);
    return this.view(scope, input.runtimeId);
  }

  /**
   * Publishes the durable preparation output: the video's manifest hash and one exact items
   * manifest per lane. No lane may be dispatched before this commit lands.
   */
  async completePreparation(
    scope: WorkspaceScope,
    input: {
      readonly runtimeId: string;
      readonly preparationManifestSha256: Sha256;
      readonly lanes: readonly VideoRuntimeLanePlan[];
      readonly now: string;
    },
  ): Promise<VideoRuntimeView> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const runtime = await this.#lockedRuntime(transaction, scope, input.runtimeId);
      if (runtime.stage !== "PREPARING") {
        throw new VideoRuntimeError(
          "STAGE_CONFLICT",
          `Preparation output requires the PREPARING stage, not ${runtime.stage}.`,
        );
      }
      await transaction.query(
        `UPDATE video_runtime_states
            SET preparation_manifest_sha256 = $2,
                prepared_at = $3,
                stage = 'WAITING_FOR_WORKER',
                version = version + 1,
                updated_at = $3
          WHERE id = $1`,
        [input.runtimeId, input.preparationManifestSha256, input.now],
      );
      for (const plan of input.lanes) {
        await transaction.query(
          `UPDATE video_runtime_lane_states
              SET items_manifest_sha256 = $3,
                  planned_item_count = $4,
                  state = 'MANIFEST_DURABLE',
                  version = version + 1,
                  updated_at = $5
            WHERE runtime_id = $1 AND lane = $2`,
          [input.runtimeId, plan.lane, plan.itemsManifestSha256, plan.itemIds.length, input.now],
        );
        await this.#event(transaction, runtime, {
          lane: plan.lane,
          fromState: "BLOCKED_ON_PREPARATION",
          toState: "MANIFEST_DURABLE",
          reason: "LANE_MANIFEST_DURABLE",
          detail: { planned_item_count: plan.itemIds.length },
          occurredAt: input.now,
        });
      }
      await this.#event(transaction, runtime, {
        lane: null,
        fromState: "PREPARING",
        toState: "WAITING_FOR_WORKER",
        reason: "PREPARATION_COMMITTED",
        detail: { preparation_manifest_sha256: input.preparationManifestSha256 },
        occurredAt: input.now,
      });
    });
    return this.view(scope, input.runtimeId);
  }

  /**
   * Binds the exact dispatched attempt to its lane. The database rejects the bind unless the
   * lane's own manifest matches the attempt and exactly one durable predispatch authority exists.
   */
  async bindLaneAttempt(
    scope: WorkspaceScope,
    input: {
      readonly runtimeId: string;
      readonly lane: ServerlessLane;
      readonly attemptId: string;
      readonly attemptOrdinal: number;
      readonly now: string;
    },
  ): Promise<VideoRuntimeView> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const runtime = await this.#lockedRuntime(transaction, scope, input.runtimeId);
      const lane = await this.#laneRow(transaction, input.runtimeId, input.lane);
      if (lane.items_manifest_sha256 === null) {
        throw new VideoRuntimeError(
          "PREPARATION_REQUIRED",
          "A lane cannot be dispatched before its durable items manifest exists.",
        );
      }
      if (input.attemptOrdinal > lane.max_attempt_ordinal) {
        throw new VideoRuntimeError(
          "LANE_RETRY_EXHAUSTED",
          "The lane exhausted its bounded retry budget.",
        );
      }
      await transaction.query(
        `UPDATE video_runtime_lane_states
            SET state = 'WAITING_FOR_WORKER',
                current_attempt_id = $3,
                attempt_ordinal = $4,
                version = version + 1,
                updated_at = $5
          WHERE runtime_id = $1 AND lane = $2`,
        [input.runtimeId, input.lane, input.attemptId, input.attemptOrdinal, input.now],
      );
      await this.#event(transaction, runtime, {
        lane: input.lane,
        fromState: lane.state,
        toState: "WAITING_FOR_WORKER",
        reason: "LANE_DISPATCH_BOUND",
        detail: { attempt_ordinal: input.attemptOrdinal },
        occurredAt: input.now,
      });
      await this.#syncStage(transaction, runtime, input.now);
    });
    return this.view(scope, input.runtimeId);
  }

  /**
   * Records one observed worker phase. `INITIALIZING` means the provider reported the job as
   * running before any item completed; `GENERATING` means observed item progress.
   */
  async observeLaneProgress(
    scope: WorkspaceScope,
    input: {
      readonly runtimeId: string;
      readonly lane: ServerlessLane;
      readonly observed: "WAITING_FOR_WORKER" | "INITIALIZING" | "GENERATING";
      readonly now: string;
    },
  ): Promise<VideoRuntimeView> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const runtime = await this.#lockedRuntime(transaction, scope, input.runtimeId);
      const lane = await this.#laneRow(transaction, input.runtimeId, input.lane);
      if (lane.current_attempt_id === null) {
        throw new VideoRuntimeError(
          "STAGE_CONFLICT",
          "Worker progress requires a bound lane attempt.",
        );
      }
      if (lane.state === input.observed) return;
      await transaction.query(
        `UPDATE video_runtime_lane_states
            SET state = $3, version = version + 1, updated_at = $4
          WHERE runtime_id = $1 AND lane = $2`,
        [input.runtimeId, input.lane, input.observed, input.now],
      );
      await this.#event(transaction, runtime, {
        lane: input.lane,
        fromState: lane.state,
        toState: input.observed,
        reason: "LANE_PROGRESS_OBSERVED",
        detail: {},
        occurredAt: input.now,
      });
      await this.#syncStage(transaction, runtime, input.now);
    });
    return this.view(scope, input.runtimeId);
  }

  /**
   * Records the units of one accepted canonical output. Units are append-only facts of the video,
   * so replaying the same accepted unit is idempotent and a later retry cannot discard it.
   */
  async acceptLaneUnits(
    scope: WorkspaceScope,
    input: {
      readonly runtimeId: string;
      readonly lane: ServerlessLane;
      readonly attemptId: string;
      readonly units: readonly VideoRuntimeAcceptedUnit[];
      readonly now: string;
    },
  ): Promise<VideoRuntimeView> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const runtime = await this.#lockedRuntime(transaction, scope, input.runtimeId);
      const lane = await this.#laneRow(transaction, input.runtimeId, input.lane);
      for (const unit of input.units) {
        await transaction.query(
          `INSERT INTO video_runtime_accepted_units (
             id, account_id, workspace_id, runtime_id, project_revision_id, lane, item_id,
             object_key, checksum_sha256, content_length, accepted_attempt_id, accepted_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (runtime_id, lane, item_id) DO NOTHING`,
          [
            surrogateId(),
            runtime.account_id,
            runtime.workspace_id,
            input.runtimeId,
            runtime.project_revision_id,
            input.lane,
            unit.itemId,
            unit.objectKey,
            unit.checksumSha256,
            unit.contentLength,
            input.attemptId,
            input.now,
          ],
        );
      }
      const accepted = await transaction.query<{ count: string } & Record<string, unknown>>(
        `SELECT count(*)::text AS count
           FROM video_runtime_accepted_units
          WHERE runtime_id = $1 AND lane = $2`,
        [input.runtimeId, input.lane],
      );
      const acceptedCount = Number(accepted.rows[0]?.count ?? "0");
      if (acceptedCount > lane.planned_item_count) {
        throw new VideoRuntimeError(
          "UNIT_NOT_PLANNED",
          "Accepted units exceeded the durable lane plan.",
        );
      }
      const complete = acceptedCount === lane.planned_item_count && lane.planned_item_count > 0;
      await transaction.query(
        `UPDATE video_runtime_lane_states
            SET accepted_item_count = $3,
                state = CASE WHEN $4 THEN 'SUCCEEDED' ELSE state END,
                current_attempt_id = CASE WHEN $4 THEN NULL ELSE current_attempt_id END,
                version = version + 1,
                updated_at = $5
          WHERE runtime_id = $1 AND lane = $2`,
        [input.runtimeId, input.lane, acceptedCount, complete, input.now],
      );
      await this.#event(transaction, runtime, {
        lane: input.lane,
        fromState: lane.state,
        toState: complete ? "SUCCEEDED" : lane.state,
        reason: "LANE_UNITS_ACCEPTED",
        detail: { accepted_item_count: acceptedCount, planned: lane.planned_item_count },
        occurredAt: input.now,
      });
      await this.#syncStage(transaction, runtime, input.now);
    });
    return this.view(scope, input.runtimeId);
  }

  /** The exact item identifiers a bounded retry still has to generate. */
  async remainingUnits(
    scope: WorkspaceScope,
    runtimeId: string,
    lane: ServerlessLane,
    plannedItemIds: readonly string[],
  ): Promise<readonly string[]> {
    await assertScope(this.#database, scope);
    const accepted = await this.#database.query<{ item_id: string } & Record<string, unknown>>(
      `SELECT item_id FROM video_runtime_accepted_units
        WHERE account_id = $1 AND runtime_id = $2 AND lane = $3`,
      [scope.accountId, runtimeId, lane],
    );
    const done = new Set(accepted.rows.map((row) => row.item_id));
    return Object.freeze(plannedItemIds.filter((itemId) => !done.has(itemId)));
  }

  /**
   * Classifies one failed lane attempt. A retryable failure releases the attempt binding and keeps
   * every accepted unit; a permanent failure, or an exhausted retry budget, fails the video.
   */
  async failLaneAttempt(
    scope: WorkspaceScope,
    input: {
      readonly runtimeId: string;
      readonly lane: ServerlessLane;
      readonly classification: "RETRYABLE" | "PERMANENT";
      readonly reason: string;
      readonly now: string;
    },
  ): Promise<VideoRuntimeView> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const runtime = await this.#lockedRuntime(transaction, scope, input.runtimeId);
      const lane = await this.#laneRow(transaction, input.runtimeId, input.lane);
      const exhausted = lane.attempt_ordinal >= lane.max_attempt_ordinal;
      const permanent = input.classification === "PERMANENT" || exhausted;
      await transaction.query(
        `UPDATE video_runtime_lane_states
            SET state = $3, current_attempt_id = NULL, version = version + 1, updated_at = $4
          WHERE runtime_id = $1 AND lane = $2`,
        [input.runtimeId, input.lane, permanent ? "FAILED" : "MANIFEST_DURABLE", input.now],
      );
      await this.#event(transaction, runtime, {
        lane: input.lane,
        fromState: lane.state,
        toState: permanent ? "FAILED" : "MANIFEST_DURABLE",
        reason: permanent ? "LANE_PERMANENT_FAILURE" : "LANE_RETRYABLE_FAILURE",
        detail: {
          classification: input.classification,
          attempt_ordinal: lane.attempt_ordinal,
          retry_budget_exhausted: exhausted,
          accepted_units_preserved: lane.accepted_item_count,
          failure_reason: input.reason,
        },
        occurredAt: input.now,
      });
      if (permanent) {
        await this.#terminate(transaction, runtime, "FAILED", "LANE_PERMANENT_FAILURE", input.now);
        return;
      }
      await this.#syncStage(transaction, runtime, input.now);
    });
    return this.view(scope, input.runtimeId);
  }

  /** Render begins only after every lane is a durable success. */
  async beginRender(
    scope: WorkspaceScope,
    input: {
      readonly runtimeId: string;
      readonly renderManifestSha256: Sha256;
      readonly now: string;
    },
  ): Promise<VideoRuntimeView> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const runtime = await this.#lockedRuntime(transaction, scope, input.runtimeId);
      await transaction.query(
        `UPDATE video_runtime_states
            SET stage = 'RENDERING',
                render_manifest_sha256 = $2,
                version = version + 1,
                updated_at = $3
          WHERE id = $1`,
        [input.runtimeId, input.renderManifestSha256, input.now],
      );
      await this.#event(transaction, runtime, {
        lane: null,
        fromState: runtime.stage,
        toState: "RENDERING",
        reason: "ASSET_BARRIER_SATISFIED",
        detail: { render_manifest_sha256: input.renderManifestSha256 },
        occurredAt: input.now,
      });
    });
    return this.view(scope, input.runtimeId);
  }

  async completeRender(
    scope: WorkspaceScope,
    input: {
      readonly runtimeId: string;
      readonly finalOutputSha256: Sha256;
      readonly now: string;
    },
  ): Promise<VideoRuntimeView> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const runtime = await this.#lockedRuntime(transaction, scope, input.runtimeId);
      if (runtime.stage !== "RENDERING") {
        throw new VideoRuntimeError(
          "STAGE_CONFLICT",
          `A final output requires the RENDERING stage, not ${runtime.stage}.`,
        );
      }
      await transaction.query(
        `UPDATE video_runtime_states
            SET stage = 'COMPLETE',
                final_output_sha256 = $2,
                terminal_reason = 'SUCCEEDED',
                terminal_at = $3,
                version = version + 1,
                updated_at = $3
          WHERE id = $1`,
        [input.runtimeId, input.finalOutputSha256, input.now],
      );
      await this.#event(transaction, runtime, {
        lane: null,
        fromState: "RENDERING",
        toState: "COMPLETE",
        reason: "FINAL_OUTPUT_DURABLE",
        detail: { final_output_sha256: input.finalOutputSha256 },
        occurredAt: input.now,
      });
    });
    return this.view(scope, input.runtimeId);
  }

  async cancel(
    scope: WorkspaceScope,
    input: {
      readonly runtimeId: string;
      readonly requestedBy: "OWNER_ACCOUNT" | "SYSTEM";
      readonly now: string;
    },
  ): Promise<VideoRuntimeView> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const runtime = await this.#lockedRuntime(transaction, scope, input.runtimeId);
      await transaction.query(
        `UPDATE video_runtime_lane_states
            SET state = 'CANCELED', current_attempt_id = NULL, version = version + 1, updated_at = $2
          WHERE runtime_id = $1 AND state NOT IN ('SUCCEEDED', 'FAILED', 'CANCELED')`,
        [input.runtimeId, input.now],
      );
      await this.#terminate(
        transaction,
        runtime,
        "CANCELED",
        input.requestedBy === "OWNER_ACCOUNT" ? "OWNER_CANCELLED" : "SYSTEM_CANCELLED",
        input.now,
      );
    });
    return this.view(scope, input.runtimeId);
  }

  async view(scope: WorkspaceScope, runtimeId: string): Promise<VideoRuntimeView> {
    await assertScope(this.#database, scope);
    const runtime = await this.#database.query<RuntimeRow>(
      `SELECT * FROM video_runtime_states WHERE account_id = $1 AND workspace_id = $2 AND id = $3`,
      [scope.accountId, scope.workspaceId, runtimeId],
    );
    const row = runtime.rows[0];
    if (row === undefined) {
      throw new VideoRuntimeError("RUNTIME_NOT_FOUND", "Video runtime not found.");
    }
    return this.#project(row);
  }

  /** Every runtime this account owns, ordered oldest first. Foreign videos are never revealed. */
  async listOwned(scope: WorkspaceScope): Promise<readonly VideoRuntimeView[]> {
    await assertScope(this.#database, scope);
    const runtimes = await this.#database.query<RuntimeRow>(
      `SELECT * FROM video_runtime_states
        WHERE account_id = $1 AND workspace_id = $2
        ORDER BY created_at, id`,
      [scope.accountId, scope.workspaceId],
    );
    const views: VideoRuntimeView[] = [];
    for (const row of runtimes.rows) views.push(await this.#project(row));
    return Object.freeze(views);
  }

  async byGenerationRequest(
    scope: WorkspaceScope,
    generationRequestId: string,
  ): Promise<VideoRuntimeView | null> {
    await assertScope(this.#database, scope);
    const runtime = await this.#database.query<RuntimeRow>(
      `SELECT * FROM video_runtime_states
        WHERE account_id = $1 AND workspace_id = $2 AND generation_request_id = $3`,
      [scope.accountId, scope.workspaceId, generationRequestId],
    );
    const row = runtime.rows[0];
    return row === undefined ? null : this.#project(row);
  }

  /**
   * Every nonterminal runtime after a process restart, with the exact lane and attempt bindings a
   * recovery pass must reconcile. Nothing is inferred: the durable rows are the only truth.
   */
  async reconstructAfterRestart(): Promise<
    readonly {
      readonly runtimeId: string;
      readonly accountId: string;
      readonly stage: VideoRuntimeStage;
      readonly lanes: readonly {
        readonly lane: ServerlessLane;
        readonly state: VideoRuntimeLaneState;
        readonly currentAttemptId: string | null;
        readonly acceptedItemCount: number;
      }[];
    }[]
  > {
    const runtimes = await this.#database.query<RuntimeRow>(
      `SELECT * FROM video_runtime_states
        WHERE stage NOT IN ('COMPLETE', 'FAILED', 'CANCELED')
        ORDER BY created_at, id`,
    );
    const result = [];
    for (const runtime of runtimes.rows) {
      const lanes = await this.#database.query<LaneRow>(
        `SELECT * FROM video_runtime_lane_states WHERE runtime_id = $1 ORDER BY lane`,
        [runtime.id],
      );
      result.push({
        runtimeId: runtime.id,
        accountId: runtime.account_id,
        stage: runtime.stage,
        lanes: lanes.rows.map((lane) => ({
          lane: lane.lane,
          state: lane.state,
          currentAttemptId: lane.current_attempt_id,
          acceptedItemCount: Number(lane.accepted_item_count),
        })),
      });
    }
    return Object.freeze(result);
  }

  async #project(row: RuntimeRow): Promise<VideoRuntimeView> {
    const lanes = await this.#database.query<LaneRow>(
      `SELECT * FROM video_runtime_lane_states WHERE runtime_id = $1 ORDER BY lane`,
      [row.id],
    );
    return Object.freeze({
      runtimeId: row.id,
      projectId: row.project_id,
      projectRevisionId: row.project_revision_id,
      generationRequestId: row.generation_request_id,
      stage: row.stage,
      terminalReason: row.terminal_reason,
      preparationManifestSha256: row.preparation_manifest_sha256,
      renderManifestSha256: row.render_manifest_sha256,
      finalOutputSha256: row.final_output_sha256,
      version: Number(row.version),
      createdAt: timestamp(row.created_at),
      updatedAt: timestamp(row.updated_at),
      lanes: Object.freeze(
        lanes.rows.map((lane) =>
          Object.freeze({
            lane: lane.lane,
            state: lane.state,
            plannedItemCount: Number(lane.planned_item_count),
            acceptedItemCount: Number(lane.accepted_item_count),
            attemptOrdinal: Number(lane.attempt_ordinal),
            maxAttemptOrdinal: Number(lane.max_attempt_ordinal),
            currentAttemptId: lane.current_attempt_id,
            itemsManifestSha256: lane.items_manifest_sha256,
          }),
        ),
      ),
      providerCallsAuthorized: false as const,
      authorizedSpendUsd: 0 as const,
    });
  }

  async #lockedRuntime(
    executor: SqlExecutor,
    scope: WorkspaceScope,
    runtimeId: string,
  ): Promise<RuntimeRow> {
    const result = await executor.query<RuntimeRow>(
      `SELECT * FROM video_runtime_states
        WHERE account_id = $1 AND workspace_id = $2 AND id = $3
        FOR UPDATE`,
      [scope.accountId, scope.workspaceId, runtimeId],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new VideoRuntimeError("RUNTIME_NOT_FOUND", "Video runtime not found.");
    }
    if (["COMPLETE", "FAILED", "CANCELED"].includes(row.stage)) {
      throw new VideoRuntimeError("RUNTIME_TERMINAL", `This video is already ${row.stage}.`);
    }
    return row;
  }

  async #laneRow(executor: SqlExecutor, runtimeId: string, lane: ServerlessLane): Promise<LaneRow> {
    const result = await executor.query<LaneRow>(
      `SELECT * FROM video_runtime_lane_states WHERE runtime_id = $1 AND lane = $2 FOR UPDATE`,
      [runtimeId, lane],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new VideoRuntimeError("LANE_NOT_FOUND", "Video runtime lane not found.");
    }
    return row;
  }

  async #transition(
    scope: WorkspaceScope,
    runtimeId: string,
    stage: VideoRuntimeStage,
    reason: string,
    now: string,
  ): Promise<void> {
    await this.#database.transaction(async (transaction) => {
      await assertScope(transaction, scope);
      const runtime = await this.#lockedRuntime(transaction, scope, runtimeId);
      if (runtime.stage === stage) return;
      await transaction.query(
        `UPDATE video_runtime_states
            SET stage = $2,
                admitted_at = COALESCE(admitted_at, $3),
                version = version + 1,
                updated_at = $3
          WHERE id = $1`,
        [runtimeId, stage, now],
      );
      await this.#event(transaction, runtime, {
        lane: null,
        fromState: runtime.stage,
        toState: stage,
        reason,
        detail: {},
        occurredAt: now,
      });
    });
  }

  /** Derives the video stage from its independent lane facts. */
  async #syncStage(executor: SqlExecutor, runtime: RuntimeRow, now: string): Promise<void> {
    const lanes = await executor.query<LaneRow>(
      `SELECT * FROM video_runtime_lane_states WHERE runtime_id = $1 ORDER BY lane`,
      [runtime.id],
    );
    const current = await executor.query<RuntimeRow>(
      `SELECT stage FROM video_runtime_states WHERE id = $1`,
      [runtime.id],
    );
    const stage = current.rows[0]?.stage ?? runtime.stage;
    if (["COMPLETE", "FAILED", "CANCELED", "QUEUED", "PREPARING"].includes(stage)) return;

    // A video whose lanes have all succeeded is waiting on the render barrier, not on a worker.
    if (lanes.rows.every((lane) => lane.state === "SUCCEEDED")) return;
    const generating = lanes.rows.find((lane) => lane.state === "GENERATING");
    const initializing = lanes.rows.some((lane) => lane.state === "INITIALIZING");
    const next: VideoRuntimeStage =
      generating !== undefined
        ? LANE_GENERATING_STAGE[generating.lane]
        : initializing
          ? "INITIALIZING"
          : "WAITING_FOR_WORKER";
    if (next === stage) return;
    await executor.query(
      `UPDATE video_runtime_states
          SET stage = $2, version = version + 1, updated_at = $3
        WHERE id = $1`,
      [runtime.id, next, now],
    );
    await this.#event(executor, runtime, {
      lane: null,
      fromState: stage,
      toState: next,
      reason: "STAGE_DERIVED_FROM_LANES",
      detail: {},
      occurredAt: now,
    });
  }

  async #terminate(
    executor: SqlExecutor,
    runtime: RuntimeRow,
    stage: "FAILED" | "CANCELED",
    reason: VideoRuntimeTerminalReason,
    now: string,
  ): Promise<void> {
    await executor.query(
      `UPDATE video_runtime_states
          SET stage = $2, terminal_reason = $3, terminal_at = $4, version = version + 1, updated_at = $4
        WHERE id = $1`,
      [runtime.id, stage, reason, now],
    );
    await this.#event(executor, runtime, {
      lane: null,
      fromState: runtime.stage,
      toState: stage,
      reason,
      detail: {},
      occurredAt: now,
    });
  }

  async #event(
    executor: SqlExecutor,
    runtime: RuntimeRow,
    event: {
      readonly lane: ServerlessLane | null;
      readonly fromState: string;
      readonly toState: string;
      readonly reason: string;
      readonly detail: Readonly<Record<string, unknown>>;
      readonly occurredAt: string;
    },
  ): Promise<void> {
    await executor.query(
      `INSERT INTO video_runtime_events (
         id, account_id, workspace_id, runtime_id, project_revision_id, lane,
         from_state, to_state, reason, detail, occurred_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
      [
        surrogateId(),
        runtime.account_id,
        runtime.workspace_id,
        runtime.id,
        runtime.project_revision_id,
        event.lane,
        event.fromState,
        event.toState,
        event.reason,
        JSON.stringify(event.detail),
        event.occurredAt,
      ],
    );
  }
}

/** Surrogate identity for append-only rows whose natural key already enforces idempotency. */
function surrogateId(): string {
  return globalThis.crypto.randomUUID();
}
