export type V209DiagnosticLane = "mage_image" | "soulx_avatar";

export interface V209RunDiagnosticScope {
  readonly accountId: string;
  readonly workspaceId: string;
}

export type V209RunDiagnosticKey =
  | { readonly projectId: string; readonly generationRequestId?: never }
  | { readonly projectId?: never; readonly generationRequestId: string };

export interface V209RunDiagnosticSnapshot {
  readonly accountId: string;
  readonly workspaceId: string;
  readonly generationRequest: {
    readonly id: string;
    readonly projectId: string;
    readonly projectRevisionId: string;
    readonly state: string;
    readonly createdAt: string;
    readonly terminalAt: string | null;
  } | null;
  readonly providerLease: {
    readonly id: string;
    readonly state: string;
    readonly slot: number | null;
    readonly expiresAt: string;
    readonly releasedAt: string | null;
  } | null;
  readonly lanes: readonly {
    readonly lane: V209DiagnosticLane;
    readonly attemptId: string;
    readonly attemptState: string;
    readonly outboxState: string;
    readonly sendAttemptCount: number;
    readonly providerJobId: string | null;
    readonly providerStatus: string | null;
    readonly providerStatusObservedAt: string | null;
    readonly outputReceiptSha256: string | null;
    readonly outputBarrierSha256: string | null;
  }[];
  readonly renderAttempt: {
    readonly id: string;
    readonly state: string;
    readonly resultReceiptSha256: string | null;
  } | null;
  readonly workerLease: {
    readonly id: string;
    readonly deviceId: string;
    readonly state: string;
    readonly failureCode: string | null;
  } | null;
  readonly workerEvents: readonly {
    readonly sequence: number;
    readonly kind: string;
    readonly occurredAt: string;
  }[];
  readonly finalOutput: {
    readonly objectKeySha256: string;
    readonly contentLength: number;
    readonly checksumSha256: string;
    readonly receiptSha256: string;
    readonly probe: {
      readonly durationMs: number;
      readonly videoCodec: string;
      readonly audioCodec: string;
      readonly width: number;
      readonly height: number;
      readonly fps: number;
      readonly avDriftMs: number;
      readonly decodeOk: boolean;
    };
  } | null;
}

/**
 * Deliberately narrow capability. Implementations may issue tenant-scoped SELECTs or query a
 * read-only view, but receive no credential, provider client, bucket binding, or mutation port.
 */
export interface V209RunDiagnosticsSource {
  loadReadOnly(input: {
    readonly scope: V209RunDiagnosticScope;
    readonly key: V209RunDiagnosticKey;
  }): Promise<V209RunDiagnosticSnapshot | null>;
}

export type V209DiagnosticStage =
  | "NOT_FOUND"
  | "QUEUE"
  | "MAGE_IMAGE"
  | "SOULX_AVATAR"
  | "OUTPUT_BARRIER"
  | "PERSONAL_MEDIA_WORKER"
  | "RENDER"
  | "FINAL_OUTPUT"
  | "COMPLETE";

export interface V209RunDiagnostics {
  readonly schemaVersion: "videoforge.v2-09-run-diagnostics/v1";
  readonly stage: V209DiagnosticStage;
  readonly terminal: boolean;
  readonly generationRequest: V209RunDiagnosticSnapshot["generationRequest"];
  readonly providerLease: V209RunDiagnosticSnapshot["providerLease"];
  readonly lanes: V209RunDiagnosticSnapshot["lanes"];
  readonly noRedispatch: boolean;
  readonly renderAttempt: V209RunDiagnosticSnapshot["renderAttempt"];
  readonly workerLease: V209RunDiagnosticSnapshot["workerLease"];
  readonly workerEvents: V209RunDiagnosticSnapshot["workerEvents"];
  readonly finalOutput: V209RunDiagnosticSnapshot["finalOutput"];
}

export class V209RunDiagnosticsError extends Error {
  constructor(
    readonly code:
      | "V209_DIAGNOSTIC_KEY_INVALID"
      | "V209_DIAGNOSTIC_SCOPE_INVALID"
      | "V209_DIAGNOSTIC_TENANT_MISMATCH"
      | "V209_DIAGNOSTIC_SNAPSHOT_INVALID",
  ) {
    super(code);
    this.name = "V209RunDiagnosticsError";
  }
}

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SAFE_STATE = /^[A-Z][A-Z0-9_]{1,63}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const LANES = new Set<V209DiagnosticLane>(["mage_image", "soulx_avatar"]);
const TERMINAL_REQUEST = new Set(["SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]);
const FAILED = new Set([
  "FAILED",
  "PERMANENT_FAILED",
  "RETRYABLE_FAILED",
  "DEAD_LETTER",
  "TIMED_OUT",
  "CANCELLED",
  "EXPIRED",
]);

function invalid(): never {
  throw new V209RunDiagnosticsError("V209_DIAGNOSTIC_SNAPSHOT_INVALID");
}

function identifier(value: string): string {
  if (!SAFE_ID.test(value)) invalid();
  return value;
}

function state(value: string): string {
  if (!SAFE_STATE.test(value)) invalid();
  return value;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) invalid();
  return parsed.toISOString();
}

function nullableTimestamp(value: string | null): string | null {
  return value === null ? null : timestamp(value);
}

function nullableSha256(value: string | null): string | null {
  if (value !== null && !SHA256.test(value)) invalid();
  return value;
}

function sanitizeSnapshot(snapshot: V209RunDiagnosticSnapshot): Omit<V209RunDiagnostics, "stage"> {
  const generationRequest = snapshot.generationRequest
    ? Object.freeze({
        id: identifier(snapshot.generationRequest.id),
        projectId: identifier(snapshot.generationRequest.projectId),
        projectRevisionId: identifier(snapshot.generationRequest.projectRevisionId),
        state: state(snapshot.generationRequest.state),
        createdAt: timestamp(snapshot.generationRequest.createdAt),
        terminalAt: nullableTimestamp(snapshot.generationRequest.terminalAt),
      })
    : null;
  const providerLease = snapshot.providerLease
    ? Object.freeze({
        id: identifier(snapshot.providerLease.id),
        state: state(snapshot.providerLease.state),
        slot:
          snapshot.providerLease.slot === null ||
          (Number.isSafeInteger(snapshot.providerLease.slot) && snapshot.providerLease.slot >= 0)
            ? snapshot.providerLease.slot
            : invalid(),
        expiresAt: timestamp(snapshot.providerLease.expiresAt),
        releasedAt: nullableTimestamp(snapshot.providerLease.releasedAt),
      })
    : null;
  const lanes = snapshot.lanes
    .map((lane) => {
      if (
        !LANES.has(lane.lane) ||
        !Number.isSafeInteger(lane.sendAttemptCount) ||
        lane.sendAttemptCount < 0
      )
        invalid();
      return Object.freeze({
        lane: lane.lane,
        attemptId: identifier(lane.attemptId),
        attemptState: state(lane.attemptState),
        outboxState: state(lane.outboxState),
        sendAttemptCount: lane.sendAttemptCount,
        providerJobId: lane.providerJobId === null ? null : identifier(lane.providerJobId),
        providerStatus: lane.providerStatus === null ? null : state(lane.providerStatus),
        providerStatusObservedAt: nullableTimestamp(lane.providerStatusObservedAt),
        outputReceiptSha256: nullableSha256(lane.outputReceiptSha256),
        outputBarrierSha256: nullableSha256(lane.outputBarrierSha256),
      });
    })
    .sort((left, right) => left.lane.localeCompare(right.lane));
  if (new Set(lanes.map((lane) => lane.lane)).size !== lanes.length) invalid();
  const renderAttempt = snapshot.renderAttempt
    ? Object.freeze({
        id: identifier(snapshot.renderAttempt.id),
        state: state(snapshot.renderAttempt.state),
        resultReceiptSha256: nullableSha256(snapshot.renderAttempt.resultReceiptSha256),
      })
    : null;
  const workerLease = snapshot.workerLease
    ? Object.freeze({
        id: identifier(snapshot.workerLease.id),
        deviceId: identifier(snapshot.workerLease.deviceId),
        state: state(snapshot.workerLease.state),
        failureCode:
          snapshot.workerLease.failureCode === null
            ? null
            : state(snapshot.workerLease.failureCode),
      })
    : null;
  const workerEvents = snapshot.workerEvents
    .map((event) => {
      if (!Number.isSafeInteger(event.sequence) || event.sequence < 1) invalid();
      return Object.freeze({
        sequence: event.sequence,
        kind: state(event.kind),
        occurredAt: timestamp(event.occurredAt),
      });
    })
    .sort((left, right) => left.sequence - right.sequence);
  const finalOutput = snapshot.finalOutput
    ? Object.freeze({
        objectKeySha256: nullableSha256(snapshot.finalOutput.objectKeySha256)!,
        contentLength:
          Number.isSafeInteger(snapshot.finalOutput.contentLength) &&
          snapshot.finalOutput.contentLength > 0
            ? snapshot.finalOutput.contentLength
            : invalid(),
        checksumSha256: nullableSha256(snapshot.finalOutput.checksumSha256)!,
        receiptSha256: nullableSha256(snapshot.finalOutput.receiptSha256)!,
        probe: Object.freeze({
          durationMs:
            Number.isSafeInteger(snapshot.finalOutput.probe.durationMs) &&
            snapshot.finalOutput.probe.durationMs > 0
              ? snapshot.finalOutput.probe.durationMs
              : invalid(),
          videoCodec: identifier(snapshot.finalOutput.probe.videoCodec),
          audioCodec: identifier(snapshot.finalOutput.probe.audioCodec),
          width: snapshot.finalOutput.probe.width,
          height: snapshot.finalOutput.probe.height,
          fps: snapshot.finalOutput.probe.fps,
          avDriftMs: snapshot.finalOutput.probe.avDriftMs,
          decodeOk: snapshot.finalOutput.probe.decodeOk,
        }),
      })
    : null;
  if (
    finalOutput &&
    (![finalOutput.probe.width, finalOutput.probe.height, finalOutput.probe.fps].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
      !Number.isFinite(finalOutput.probe.avDriftMs) ||
      finalOutput.probe.decodeOk !== true)
  )
    invalid();
  return Object.freeze({
    schemaVersion: "videoforge.v2-09-run-diagnostics/v1" as const,
    terminal: generationRequest !== null && TERMINAL_REQUEST.has(generationRequest.state),
    generationRequest,
    providerLease,
    lanes: Object.freeze(lanes),
    noRedispatch: lanes.every((lane) => lane.sendAttemptCount <= 1),
    renderAttempt,
    workerLease,
    workerEvents: Object.freeze(workerEvents),
    finalOutput,
  });
}

function failedStage(value: Omit<V209RunDiagnostics, "stage">): V209DiagnosticStage {
  if (!value.generationRequest) return "NOT_FOUND";
  if (FAILED.has(value.generationRequest.state)) return "QUEUE";
  for (const lane of value.lanes) {
    if (
      FAILED.has(lane.attemptState) ||
      FAILED.has(lane.outboxState) ||
      (lane.providerStatus && FAILED.has(lane.providerStatus))
    )
      return lane.lane === "mage_image" ? "MAGE_IMAGE" : "SOULX_AVATAR";
    if (
      lane.providerStatus === "COMPLETED" &&
      (!lane.outputReceiptSha256 || !lane.outputBarrierSha256)
    )
      return "OUTPUT_BARRIER";
  }
  if (value.workerLease && FAILED.has(value.workerLease.state)) return "PERSONAL_MEDIA_WORKER";
  if (value.renderAttempt && FAILED.has(value.renderAttempt.state)) return "RENDER";
  if (value.renderAttempt?.state === "SUCCEEDED" && !value.finalOutput) return "FINAL_OUTPUT";
  if (value.finalOutput) return "COMPLETE";
  if (value.renderAttempt) return "RENDER";
  if (value.workerLease) return "PERSONAL_MEDIA_WORKER";
  const activeLane = value.lanes.find(
    (lane) => lane.attemptState !== "SUCCEEDED" || lane.providerStatus !== "COMPLETED",
  );
  if (activeLane) return activeLane.lane === "mage_image" ? "MAGE_IMAGE" : "SOULX_AVATAR";
  return "QUEUE";
}

/** Produces an allowlisted, provider-free diagnostic document from one tenant-scoped snapshot. */
export async function diagnoseV209Run(input: {
  readonly scope: V209RunDiagnosticScope;
  readonly key: V209RunDiagnosticKey;
  readonly source: V209RunDiagnosticsSource;
}): Promise<V209RunDiagnostics> {
  if (!SAFE_ID.test(input.scope.accountId) || !SAFE_ID.test(input.scope.workspaceId))
    throw new V209RunDiagnosticsError("V209_DIAGNOSTIC_SCOPE_INVALID");
  const projectId = input.key.projectId;
  const generationRequestId = input.key.generationRequestId;
  if ((projectId === undefined) === (generationRequestId === undefined))
    throw new V209RunDiagnosticsError("V209_DIAGNOSTIC_KEY_INVALID");
  identifier(projectId ?? generationRequestId!);
  const snapshot = await input.source.loadReadOnly({ scope: input.scope, key: input.key });
  if (!snapshot) {
    return Object.freeze({
      schemaVersion: "videoforge.v2-09-run-diagnostics/v1",
      stage: "NOT_FOUND",
      terminal: false,
      generationRequest: null,
      providerLease: null,
      lanes: Object.freeze([]),
      noRedispatch: true,
      renderAttempt: null,
      workerLease: null,
      workerEvents: Object.freeze([]),
      finalOutput: null,
    });
  }
  if (
    snapshot.accountId !== input.scope.accountId ||
    snapshot.workspaceId !== input.scope.workspaceId
  )
    throw new V209RunDiagnosticsError("V209_DIAGNOSTIC_TENANT_MISMATCH");
  const sanitized = sanitizeSnapshot(snapshot);
  if (
    (projectId !== undefined && sanitized.generationRequest?.projectId !== projectId) ||
    (generationRequestId !== undefined && sanitized.generationRequest?.id !== generationRequestId)
  )
    throw new V209RunDiagnosticsError("V209_DIAGNOSTIC_TENANT_MISMATCH");
  return Object.freeze({ ...sanitized, stage: failedStage(sanitized) });
}
