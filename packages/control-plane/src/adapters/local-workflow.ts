import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import type { AppendWorkflowEventCommand, WorkflowEventRecord } from "../repositories/events.js";
import type {
  OutboxRecord,
  ProviderDispatchAckUnknown,
  ProviderDispatchAcknowledgement,
} from "../repositories/execution.js";
import type {
  DeterministicIdempotencyKey,
  JsonObject,
  Sha256,
  WorkspaceScope,
} from "../repositories/types.js";
import { trustedTenantScope } from "../repositories/types.js";
import {
  NoopTelemetryAdapter,
  TelemetryStream,
  instrumentLocalOperation,
  type TelemetryPort,
} from "../telemetry/index.js";
import {
  createPGliteControlPlaneRepositories,
  pgliteAdapterInternals,
} from "./pglite-repositories.js";

type Row = Record<string, unknown>;

function directTransactionalExecutor(executor: SqlExecutor): TransactionalSqlExecutor {
  return {
    execute: (sql) => executor.execute(sql),
    query: (sql, parameters) => executor.query(sql, parameters),
    transaction: (work) => work(executor),
  };
}

function sha256(bytes: Uint8Array | string): Sha256 {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function normalizeSecret(secret: Uint8Array | string): Uint8Array {
  const normalized = typeof secret === "string" ? Buffer.from(secret, "utf8") : secret;
  if (normalized.byteLength < 32) {
    throw new RangeError("callback HMAC secret must contain at least 32 bytes");
  }
  return new Uint8Array(normalized);
}

class CallbackPayloadTooLarge extends Error {
  public constructor() {
    super("callback raw payload exceeds the configured byte limit");
    this.name = "CallbackPayloadTooLarge";
  }
}

class CallbackStructureTooComplex extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "CallbackStructureTooComplex";
  }
}

const CALLBACK_JSON_MAX_DEPTH = 64;
const CALLBACK_JSON_MAX_NODES = 50_000;

interface CallbackJsonBudget {
  nodes: number;
}

function normalizeRawPayload(payload: Uint8Array | string, maximumBytes?: number): Uint8Array {
  if (typeof payload === "string") {
    if (maximumBytes !== undefined && Buffer.byteLength(payload, "utf8") > maximumBytes) {
      throw new CallbackPayloadTooLarge();
    }
    return new Uint8Array(Buffer.from(payload, "utf8"));
  }
  if (!(payload instanceof Uint8Array)) {
    throw new TypeError("callback raw payload must be a string or Uint8Array");
  }
  if (maximumBytes !== undefined && payload.byteLength > maximumBytes) {
    throw new CallbackPayloadTooLarge();
  }
  return new Uint8Array(payload);
}

function strictCanonicalJson(
  value: unknown,
  ancestors: WeakSet<object> = new WeakSet(),
  budget: CallbackJsonBudget = { nodes: 0 },
  depth = 0,
): string {
  if (depth > CALLBACK_JSON_MAX_DEPTH) {
    throw new CallbackStructureTooComplex(`callback JSON depth exceeds ${CALLBACK_JSON_MAX_DEPTH}`);
  }
  budget.nodes += 1;
  if (budget.nodes > CALLBACK_JSON_MAX_NODES) {
    throw new CallbackStructureTooComplex(
      `callback JSON node count exceeds ${CALLBACK_JSON_MAX_NODES}`,
    );
  }
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("callback JSON numbers must be finite");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") {
    throw new TypeError("callback JSON contains an unsupported value");
  }
  if (ancestors.has(value)) throw new TypeError("callback JSON cannot contain cycles");
  ancestors.add(value);
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new TypeError("callback JSON cannot contain symbol properties");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      const expectedKeys = [
        ...Array.from({ length: value.length }, (_unused, index) => String(index)),
        "length",
      ];
      const stringKeys = ownKeys as string[];
      if (
        stringKeys.length !== expectedKeys.length ||
        expectedKeys.some((key) => !stringKeys.includes(key))
      ) {
        throw new TypeError("callback JSON arrays must be dense and contain no extra fields");
      }
      return `[${Array.from({ length: value.length }, (_unused, index) => {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new TypeError("callback JSON accessors are not allowed");
        }
        return strictCanonicalJson(descriptor.value, ancestors, budget, depth + 1);
      }).join(",")}]`;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("callback JSON objects must have a plain prototype");
    }
    const keys = (ownKeys as string[]).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${keys
      .map((key) => {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new TypeError("callback JSON accessors are not allowed");
        }
        return `${JSON.stringify(key)}:${strictCanonicalJson(
          descriptor.value,
          ancestors,
          budget,
          depth + 1,
        )}`;
      })
      .join(",")}}`;
  } finally {
    ancestors.delete(value);
  }
}

function rawPayloadMatchesEvent(rawPayload: Uint8Array, eventPayload: JsonObject): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(rawPayload).toString("utf8")) as unknown;
    return strictCanonicalJson(decoded) === strictCanonicalJson(eventPayload);
  } catch {
    return false;
  }
}

function fixedTuple(fields: readonly string[]): string {
  return fields.map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`).join("");
}

function deliveryMutationKey(
  outbox: OutboxRecord,
  transition: "ACKNOWLEDGED" | "ACKNOWLEDGEMENT_UNKNOWN",
): DeterministicIdempotencyKey {
  return `local-outbox:${sha256(
    fixedTuple([outbox.outboxId, outbox.updatedAt, outbox.leaseOwner ?? "", transition]),
  )}` as DeterministicIdempotencyKey;
}

function callbackSigningInput(input: CallbackSignatureInput, payloadHash: Sha256): string {
  const eventDescriptorHash = sha256(
    fixedTuple([
      input.workflowEvent.idempotencyKey,
      input.workflowEvent.eventId,
      input.workflowEvent.workflowInstanceId,
      input.workflowEvent.aggregate.aggregateType,
      input.workflowEvent.aggregate.aggregateId,
      input.workflowEvent.aggregate.taskId ?? "",
      input.workflowEvent.aggregate.attemptId ?? "",
      String(input.workflowEvent.sequence),
      input.workflowEvent.kind,
      input.workflowEvent.payloadContractName,
      input.workflowEvent.payloadContractVersion,
      input.workflowEvent.payloadHash,
      input.workflowEvent.occurredAt,
    ]),
  );
  return fixedTuple([
    "videoforge-callback/v1",
    input.receiptId,
    input.signatureKeyId,
    input.callbackKind,
    input.scope.workspaceId,
    input.taskId,
    input.attemptId,
    input.workflowEvent.eventId,
    input.signedAt,
    input.expiresAt,
    input.nonce,
    payloadHash,
    eventDescriptorHash,
  ]);
}

function signatureBytes(signature: string): Buffer | null {
  const match = /^sha256=([0-9a-f]{64})$/.exec(signature);
  return match === null ? null : Buffer.from(match[1]!, "hex");
}

function sqlConstraint(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const value = (error as { readonly constraint?: unknown }).constraint;
  return typeof value === "string" ? value : null;
}

function sqlCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const value = (error as { readonly code?: unknown }).code;
  return typeof value === "string" ? value : null;
}

function repositoryFailureLabel(result: {
  readonly kind: string;
  readonly code?: string;
  readonly entity?: string;
}): string {
  return `${result.kind}/${result.code ?? result.entity ?? "UNKNOWN"}`;
}

export interface OutboxLeaseRequest {
  readonly workerId: string;
  readonly now: string;
  readonly leaseExpiresAt: string;
}

export type LocalDispatchOutcome =
  | {
      readonly kind: "ACKNOWLEDGED";
      readonly externalJobId: string;
      readonly providerDetails: JsonObject;
      readonly acknowledgedAt: string;
    }
  | {
      readonly kind: "ACKNOWLEDGEMENT_UNKNOWN";
      readonly providerDetails: JsonObject;
      readonly ambiguityReason: string;
      readonly observedAt: string;
    }
  | {
      /** The driver knows that no request bytes crossed the transport boundary. */
      readonly kind: "DEFINITELY_NOT_SENT";
      readonly reason: string;
      readonly classifiedAt: string;
      readonly retryAt: string;
    };

export interface LocalDispatchDriver {
  dispatch(outbox: OutboxRecord): Promise<LocalDispatchOutcome>;
}

export interface LocalWorkflowTransportOptions {
  /** Trusted control-plane time sampled after the dispatch driver settles. */
  readonly clock?: () => string;
  /** Optional runtime-neutral sink. Omitted telemetry is validated then discarded locally. */
  readonly telemetry?: TelemetryPort;
  /** Independently injected clocks keep telemetry from changing settlement-clock behavior. */
  readonly telemetryClock?: () => string;
  readonly telemetryMonotonicClock?: () => number;
}

export type LocalDeliveryResult =
  | { readonly kind: "NO_WORK" }
  | {
      readonly kind: "DELIVERED";
      readonly outbox: OutboxRecord;
      readonly acknowledgement: ProviderDispatchAcknowledgement | null;
    }
  | {
      readonly kind: "ACKNOWLEDGEMENT_UNKNOWN";
      readonly outbox: OutboxRecord;
      readonly ambiguity: ProviderDispatchAckUnknown | null;
    }
  | {
      readonly kind: "RETRY_WAIT";
      readonly outbox: OutboxRecord;
      readonly reason: string;
    }
  | {
      readonly kind: "LEASE_LOST";
      readonly outbox: OutboxRecord;
    };

/** Provider-free local outbox transport. The caller supplies an in-process fake dispatch driver. */
export class LocalWorkflowTransport {
  private readonly clock: () => string;
  private readonly telemetry: TelemetryPort;
  private readonly telemetryClock?: () => string;
  private readonly telemetryMonotonicClock?: () => number;

  public constructor(
    private readonly database: TransactionalSqlExecutor,
    private readonly driver: LocalDispatchDriver,
    options: LocalWorkflowTransportOptions = {},
  ) {
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.telemetry = options.telemetry ?? new NoopTelemetryAdapter();
    this.telemetryClock = options.telemetryClock;
    this.telemetryMonotonicClock = options.telemetryMonotonicClock;
  }

  public async leaseNext(request: OutboxLeaseRequest): Promise<OutboxRecord | null> {
    if (request.workerId.trim() !== request.workerId || request.workerId.length < 1) {
      throw new RangeError("outbox lease worker ID must be non-empty and trimmed");
    }
    const requestedAt = Date.parse(request.now);
    const requestedExpiry = Date.parse(request.leaseExpiresAt);
    if (
      !Number.isFinite(requestedAt) ||
      !Number.isFinite(requestedExpiry) ||
      requestedExpiry <= requestedAt
    ) {
      throw new RangeError("outbox lease expiry must be later than now");
    }
    return this.database.transaction(async (transaction) => {
      const candidate = await transaction.query<Row>(
        `SELECT queued.* FROM outbox queued
         JOIN generation_tasks task
           ON task.workspace_id = queued.workspace_id AND task.id = queued.task_id
         JOIN attempts attempt
           ON attempt.workspace_id = queued.workspace_id
          AND attempt.task_id = queued.task_id AND attempt.id = queued.attempt_id
         WHERE (
           (queued.state IN ('PENDING', 'RETRY_WAIT') AND queued.available_at <= $1)
           OR (queued.state = 'LEASED' AND queued.lease_expires_at <= $1)
         )
         AND (
           (
             queued.kind = 'DISPATCH'
             AND task.state IN ('PENDING', 'READY', 'DISPATCHING', 'RETRY_WAIT')
             AND attempt.state = 'CREATED' AND attempt.dispatch_state = 'NOT_SENT'
             AND attempt.claim_state = 'UNCLAIMED' AND attempt.started_at IS NULL
             AND attempt.finished_at IS NULL AND attempt.result_disposition = 'PENDING'
           )
           OR (queued.kind = 'CANCEL' AND task.state = 'CANCEL_REQUESTED')
           OR (
             queued.kind = 'CALLBACK_RECONCILE'
             AND task.state NOT IN ('CANCELLED', 'COMPLETE', 'FAILED')
           )
         )
         ORDER BY queued.available_at, queued.created_at, queued.id
         LIMIT 1
         FOR UPDATE SKIP LOCKED`,
        [request.now],
      );
      const row = candidate.rows[0];
      if (row === undefined) return null;
      const outboxId = String(row.id);
      const workspaceId = String(row.workspace_id);
      await transaction.query(
        `UPDATE outbox SET state = 'LEASED', lease_owner = $3, lease_expires_at = $4,
           delivered_at = NULL, updated_at = $2
         WHERE workspace_id = $1 AND id = $5`,
        [workspaceId, request.now, request.workerId, request.leaseExpiresAt, outboxId],
      );
      const leased = await transaction.query<Row>(
        "SELECT * FROM outbox WHERE workspace_id = $1 AND id = $2",
        [workspaceId, outboxId],
      );
      const leasedRow = leased.rows[0];
      if (leasedRow === undefined) throw new Error("leased outbox row disappeared");
      return pgliteAdapterInternals.mapOutbox(leasedRow);
    });
  }

  public async deliverNext(request: OutboxLeaseRequest): Promise<LocalDeliveryResult> {
    const outbox = await this.leaseNext(request);
    if (outbox === null) return { kind: "NO_WORK" };
    let outcome: LocalDispatchOutcome;
    const stream = new TelemetryStream({
      port: this.telemetry,
      streamId: outbox.outboxId,
      correlation: {
        requestId: null,
        workspaceId: outbox.workspaceId,
        projectId: null,
        revisionId: null,
        taskId: outbox.taskId,
        attemptId: outbox.attemptId,
        outboxId: outbox.outboxId,
        providerJobId: null,
      },
      ...(this.telemetryClock === undefined ? {} : { clock: this.telemetryClock }),
    });
    const queuedAt = Date.parse(outbox.availableAt);
    const leasedAt = Date.parse(request.now);
    const queueWaitMs =
      Number.isFinite(queuedAt) && Number.isFinite(leasedAt) && leasedAt >= queuedAt
        ? leasedAt - queuedAt
        : null;
    try {
      outcome = await instrumentLocalOperation(
        stream,
        {
          operationName: "local_driver_dispatch",
          stage: "dispatch",
          providerOperation: "local.dispatch",
          retry: null,
          queueWaitMs,
          cost: null,
          ...(this.telemetryMonotonicClock === undefined
            ? {}
            : { monotonicClock: this.telemetryMonotonicClock }),
          classifyError: () => ({
            code: "LOCAL_DISPATCH_DRIVER_FAILED",
            classification: "TRANSIENT",
            retryable: true,
          }),
        },
        () => this.driver.dispatch(structuredClone(outbox)),
      );
    } catch (error: unknown) {
      outcome = {
        kind: "ACKNOWLEDGEMENT_UNKNOWN",
        providerDetails: {
          driver: "local",
          failure: error instanceof Error ? error.name : "NonErrorFailure",
        },
        ambiguityReason: "local dispatch driver failed after dispatch eligibility",
        observedAt: request.now,
      };
    }
    return this.database.transaction(async (transaction) => {
      const current = await transaction.query<Row>(
        "SELECT * FROM outbox WHERE workspace_id = $1 AND id = $2 FOR UPDATE",
        [outbox.workspaceId, outbox.outboxId],
      );
      const currentRow = current.rows[0];
      if (currentRow === undefined) {
        throw new Error("leased outbox row disappeared before settlement");
      }
      const currentOutbox = pgliteAdapterInternals.mapOutbox(currentRow);
      const leaseFenceMilliseconds = Date.parse(this.clock());
      if (!Number.isFinite(leaseFenceMilliseconds)) {
        throw new RangeError("local workflow transport clock must return a valid timestamp");
      }
      if (
        currentOutbox.state !== "LEASED" ||
        currentOutbox.leaseOwner !== request.workerId ||
        currentOutbox.leaseExpiresAt === null ||
        Date.parse(currentOutbox.leaseExpiresAt) <= leaseFenceMilliseconds
      ) {
        return { kind: "LEASE_LOST" as const, outbox: currentOutbox };
      }
      const repositories = createPGliteControlPlaneRepositories(
        directTransactionalExecutor(transaction),
      );
      if (outcome.kind === "ACKNOWLEDGED") {
        let acknowledgement: ProviderDispatchAcknowledgement | null = null;
        if (outbox.kind === "DISPATCH") {
          const result = await repositories.execution.recordDispatchAcknowledged(
            trustedTenantScope(outbox.accountId, outbox.workspaceId),
            {
              idempotencyKey: deliveryMutationKey(outbox, "ACKNOWLEDGED"),
              taskId: outbox.taskId,
              attemptId: outbox.attemptId,
              externalJobId: outcome.externalJobId,
              providerDetails: outcome.providerDetails,
              acknowledgedAt: outcome.acknowledgedAt,
            },
          );
          if (!result.ok) {
            throw new Error(
              `local dispatch acknowledgement rejected: ${repositoryFailureLabel(result)}`,
            );
          }
          acknowledgement = result.value.value;
        }
        await transaction.query(
          `UPDATE outbox SET state = 'DELIVERED', lease_owner = NULL, lease_expires_at = NULL,
             delivered_at = $3, updated_at = $3
           WHERE workspace_id = $1 AND id = $2 AND state = 'LEASED' AND lease_owner = $4`,
          [outbox.workspaceId, outbox.outboxId, outcome.acknowledgedAt, request.workerId],
        );
        const delivered = await this.resolveOutbox(transaction, outbox);
        return { kind: "DELIVERED", outbox: delivered, acknowledgement };
      }
      if (outcome.kind === "ACKNOWLEDGEMENT_UNKNOWN") {
        let ambiguity: ProviderDispatchAckUnknown | null = null;
        if (outbox.kind === "DISPATCH") {
          const result = await repositories.execution.recordDispatchAckUnknown(
            trustedTenantScope(outbox.accountId, outbox.workspaceId),
            {
              idempotencyKey: deliveryMutationKey(outbox, "ACKNOWLEDGEMENT_UNKNOWN"),
              taskId: outbox.taskId,
              attemptId: outbox.attemptId,
              providerDetails: outcome.providerDetails,
              ambiguityReason: outcome.ambiguityReason,
              observedAt: outcome.observedAt,
            },
          );
          if (!result.ok) {
            throw new Error(`local dispatch ambiguity rejected: ${repositoryFailureLabel(result)}`);
          }
          ambiguity = result.value.value;
        }
        // DEAD_LETTER here means operator/reconciler attention. It deliberately cannot be leased
        // again until reconciliation creates a new explicit dispatch action.
        await transaction.query(
          `UPDATE outbox SET state = 'DEAD_LETTER', lease_owner = NULL,
             lease_expires_at = NULL, delivered_at = NULL, updated_at = $3
           WHERE workspace_id = $1 AND id = $2 AND state = 'LEASED' AND lease_owner = $4`,
          [outbox.workspaceId, outbox.outboxId, outcome.observedAt, request.workerId],
        );
        const blocked = await this.resolveOutbox(transaction, outbox);
        return {
          kind: "ACKNOWLEDGEMENT_UNKNOWN",
          outbox: blocked,
          ambiguity,
        };
      }
      await transaction.query(
        `UPDATE outbox SET state = 'RETRY_WAIT', available_at = $3,
           lease_owner = NULL, lease_expires_at = NULL, delivered_at = NULL, updated_at = $4
         WHERE workspace_id = $1 AND id = $2 AND state = 'LEASED' AND lease_owner = $5`,
        [
          outbox.workspaceId,
          outbox.outboxId,
          outcome.retryAt,
          outcome.classifiedAt,
          request.workerId,
        ],
      );
      const retry = await this.resolveOutbox(transaction, outbox);
      return { kind: "RETRY_WAIT", outbox: retry, reason: outcome.reason };
    });
  }

  private async resolveOutbox(
    executor: SqlExecutor,
    identity: OutboxRecord,
  ): Promise<OutboxRecord> {
    const result = await executor.query<Row>(
      "SELECT * FROM outbox WHERE workspace_id = $1 AND id = $2",
      [identity.workspaceId, identity.outboxId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("outbox row disappeared during delivery");
    return pgliteAdapterInternals.mapOutbox(row);
  }
}

export interface SignedCallbackEnvelope {
  readonly receiptId: string;
  readonly scope: WorkspaceScope;
  readonly taskId: string;
  readonly attemptId: string;
  readonly callbackKind: string;
  readonly nonce: string;
  readonly signatureKeyId: string;
  readonly signedAt: string;
  readonly expiresAt: string;
  readonly rawPayload: Uint8Array | string;
  readonly signature: string;
  readonly workflowEvent: AppendWorkflowEventCommand;
}

export type CallbackReceiptResult =
  | { readonly ok: true; readonly event: WorkflowEventRecord }
  | {
      readonly ok: false;
      readonly code:
        | "CALLBACK_EXPIRED"
        | "CALLBACK_EVENT_REJECTED"
        | "CALLBACK_PAYLOAD_HASH_MISMATCH"
        | "CALLBACK_PAYLOAD_TOO_LARGE"
        | "CALLBACK_REPLAY"
        | "CALLBACK_SIGNATURE_INVALID";
      readonly message: string;
    };

export type CallbackSignatureInput = Omit<SignedCallbackEnvelope, "signature">;

export interface CallbackSigningKey {
  readonly id: string;
  readonly secret: Uint8Array | string;
  readonly maximumWindowMs?: number;
  readonly maximumPayloadBytes?: number;
  readonly clock?: () => string;
}

function snapshotCallbackSignatureInput(
  input: CallbackSignatureInput,
  maximumPayloadBytes?: number,
): CallbackSignatureInput {
  const sourceEvent = input.workflowEvent;
  const sourceAggregate = sourceEvent.aggregate;
  const aggregate =
    sourceAggregate.aggregateType === "WORKFLOW"
      ? {
          aggregateType: "WORKFLOW" as const,
          aggregateId: sourceAggregate.aggregateId,
          taskId: null,
          attemptId: null,
        }
      : sourceAggregate.aggregateType === "TASK"
        ? {
            aggregateType: "TASK" as const,
            aggregateId: sourceAggregate.aggregateId,
            taskId: sourceAggregate.taskId,
            attemptId: null,
          }
        : {
            aggregateType: "ATTEMPT" as const,
            aggregateId: sourceAggregate.aggregateId,
            taskId: sourceAggregate.taskId,
            attemptId: sourceAggregate.attemptId,
          };
  const payload = JSON.parse(strictCanonicalJson(sourceEvent.payload)) as JsonObject;
  return {
    receiptId: input.receiptId,
    scope: trustedTenantScope(input.scope.accountId, input.scope.workspaceId),
    taskId: input.taskId,
    attemptId: input.attemptId,
    callbackKind: input.callbackKind,
    nonce: input.nonce,
    signatureKeyId: input.signatureKeyId,
    signedAt: input.signedAt,
    expiresAt: input.expiresAt,
    rawPayload: normalizeRawPayload(input.rawPayload, maximumPayloadBytes),
    workflowEvent: {
      idempotencyKey: sourceEvent.idempotencyKey,
      eventId: sourceEvent.eventId,
      workflowInstanceId: sourceEvent.workflowInstanceId,
      aggregate,
      sequence: sourceEvent.sequence,
      kind: sourceEvent.kind,
      payloadContractName: sourceEvent.payloadContractName,
      payloadContractVersion: sourceEvent.payloadContractVersion,
      payloadHash: sourceEvent.payloadHash,
      payload,
      occurredAt: sourceEvent.occurredAt,
    },
  };
}

export function signLocalCallback(
  input: CallbackSignatureInput,
  secret: Uint8Array | string,
): `sha256=${string}` {
  const snapshot = snapshotCallbackSignatureInput(input);
  const rawPayload = normalizeRawPayload(snapshot.rawPayload);
  const payloadHash = sha256(rawPayload);
  const signature = createHmac("sha256", normalizeSecret(secret))
    .update(callbackSigningInput(snapshot, payloadHash), "utf8")
    .update("\n", "utf8")
    .update(rawPayload)
    .digest("hex");
  return `sha256=${signature}`;
}

class CallbackMutationRollback extends Error {
  public constructor(public readonly result: CallbackReceiptResult) {
    super("callback mutation rolled back");
    this.name = "CallbackMutationRollback";
  }
}

/** Verifies raw-byte HMAC metadata before atomically claiming the nonce and appending its event. */
export class SignedCallbackProcessor {
  private readonly secret: Uint8Array;
  private readonly signatureKeyId: string;
  private readonly maximumWindowMs: number;
  private readonly maximumPayloadBytes: number;
  private readonly clock: () => string;

  public constructor(
    private readonly database: TransactionalSqlExecutor,
    key: CallbackSigningKey,
  ) {
    if (key.id.trim() !== key.id || key.id.length < 1 || key.id.length > 160) {
      throw new RangeError(
        "callback signature key ID must be trimmed and contain 1 to 160 characters",
      );
    }
    const maximumWindowMs = key.maximumWindowMs ?? 5 * 60 * 1000;
    if (!Number.isSafeInteger(maximumWindowMs) || maximumWindowMs < 1) {
      throw new RangeError("callback maximum timestamp window must be a positive integer");
    }
    this.secret = normalizeSecret(key.secret);
    this.signatureKeyId = key.id;
    this.maximumWindowMs = maximumWindowMs;
    const maximumPayloadBytes = key.maximumPayloadBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(maximumPayloadBytes) || maximumPayloadBytes < 1) {
      throw new RangeError("callback maximum payload bytes must be a positive integer");
    }
    this.maximumPayloadBytes = maximumPayloadBytes;
    this.clock = key.clock ?? (() => new Date().toISOString());
  }

  public async process(input: SignedCallbackEnvelope): Promise<CallbackReceiptResult> {
    const signature = input.signature;
    let snapshot: CallbackSignatureInput;
    try {
      snapshot = snapshotCallbackSignatureInput(input, this.maximumPayloadBytes);
    } catch (error: unknown) {
      if (error instanceof CallbackPayloadTooLarge) {
        return {
          ok: false,
          code: "CALLBACK_PAYLOAD_TOO_LARGE",
          message: error.message,
        };
      }
      if (error instanceof CallbackStructureTooComplex) {
        return {
          ok: false,
          code: "CALLBACK_PAYLOAD_HASH_MISMATCH",
          message: error.message,
        };
      }
      throw error;
    }
    const receivedAt = this.clock();
    const rawPayload = normalizeRawPayload(snapshot.rawPayload);
    const payloadHash = sha256(rawPayload);
    if (
      snapshot.workflowEvent.payloadHash !== payloadHash ||
      !rawPayloadMatchesEvent(rawPayload, snapshot.workflowEvent.payload)
    ) {
      return {
        ok: false,
        code: "CALLBACK_PAYLOAD_HASH_MISMATCH",
        message: "callback raw payload does not match the workflow event payload and hash",
      };
    }
    const signedAt = Date.parse(snapshot.signedAt);
    const expiresAt = Date.parse(snapshot.expiresAt);
    const receivedAtMilliseconds = Date.parse(receivedAt);
    if (
      !Number.isFinite(signedAt) ||
      !Number.isFinite(expiresAt) ||
      !Number.isFinite(receivedAtMilliseconds) ||
      signedAt > receivedAtMilliseconds ||
      receivedAtMilliseconds > expiresAt ||
      expiresAt - signedAt > this.maximumWindowMs
    ) {
      return {
        ok: false,
        code: "CALLBACK_EXPIRED",
        message: "callback timestamp window is invalid",
      };
    }
    if (snapshot.signatureKeyId !== this.signatureKeyId) {
      return {
        ok: false,
        code: "CALLBACK_SIGNATURE_INVALID",
        message: "callback signature key ID is not active",
      };
    }
    if (
      snapshot.workflowEvent.aggregate.aggregateType !== "ATTEMPT" ||
      snapshot.workflowEvent.aggregate.aggregateId !== snapshot.attemptId ||
      snapshot.workflowEvent.aggregate.attemptId !== snapshot.attemptId ||
      snapshot.workflowEvent.aggregate.taskId !== snapshot.taskId
    ) {
      return {
        ok: false,
        code: "CALLBACK_EVENT_REJECTED",
        message: "callback event does not match the signed task and attempt",
      };
    }
    const presented = signatureBytes(signature);
    const expected = signatureBytes(signLocalCallback(snapshot, this.secret));
    if (presented === null || expected === null || !timingSafeEqual(presented, expected)) {
      return {
        ok: false,
        code: "CALLBACK_SIGNATURE_INVALID",
        message: "callback HMAC signature is invalid",
      };
    }
    if (snapshot.nonce.length < 16 || snapshot.nonce.trim() !== snapshot.nonce) {
      return {
        ok: false,
        code: "CALLBACK_SIGNATURE_INVALID",
        message: "callback nonce is malformed",
      };
    }
    try {
      return await this.database.transaction(async (transaction) => {
        await transaction.query(
          `INSERT INTO callback_receipts (
             id, workspace_id, task_id, attempt_id, workflow_event_id,
             callback_kind, nonce_hash, payload_hash, signature_key_id,
             signed_at, expires_at, received_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            snapshot.receiptId,
            snapshot.scope.workspaceId,
            snapshot.taskId,
            snapshot.attemptId,
            snapshot.workflowEvent.eventId,
            snapshot.callbackKind,
            sha256(snapshot.nonce),
            payloadHash,
            snapshot.signatureKeyId,
            snapshot.signedAt,
            snapshot.expiresAt,
            receivedAt,
          ],
        );
        const repositories = createPGliteControlPlaneRepositories(
          directTransactionalExecutor(transaction),
        );
        const appended = await repositories.events.appendWorkflowEvent(
          snapshot.scope,
          snapshot.workflowEvent,
        );
        if (!appended.ok || appended.value.replayed) {
          throw new CallbackMutationRollback({
            ok: false,
            code: appended.ok ? "CALLBACK_REPLAY" : "CALLBACK_EVENT_REJECTED",
            message: appended.ok
              ? "callback event was already recorded"
              : `callback event rejected: ${appended.kind}`,
          });
        }
        return { ok: true as const, event: appended.value.value };
      });
    } catch (error: unknown) {
      if (error instanceof CallbackMutationRollback) return error.result;
      if (sqlCode(error) === "23505") {
        const constraint = sqlConstraint(error);
        if (
          constraint === null ||
          constraint === "callback_receipts_pkey" ||
          constraint === "callback_receipts_nonce_uq" ||
          constraint === "callback_receipts_workflow_event_uq"
        ) {
          return { ok: false, code: "CALLBACK_REPLAY", message: "callback nonce was already used" };
        }
      }
      throw error;
    }
  }
}
