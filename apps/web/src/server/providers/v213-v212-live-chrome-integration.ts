import { createHash } from "node:crypto";

import {
  canonicalSha256,
  type Sha256,
  type TransactionalSqlExecutor,
} from "@videoforge/control-plane";

import {
  buildV213V212RealChromeRequest,
  type V213V212RealChromeRequest,
} from "./v213-v212-real-chrome.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const WORKFLOW_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,319}$/u;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 250;

export const V213_V212_TERMINAL_OUTPUT_PROJECTION_SCHEMA =
  "videoforge.v213-v212-terminal-output-projection/v1" as const;

export class V213V212LiveChromeIntegrationError extends Error {
  constructor(readonly code: string) {
    super(`V213_V212_LIVE_CHROME_${code}`);
    this.name = "V213V212LiveChromeIntegrationError";
  }
}

function fail(code: string): never {
  throw new V213V212LiveChromeIntegrationError(code);
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) fail(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): void {
  if (Object.keys(value).sort().join(",") !== [...expected].sort().join(","))
    fail("PROJECTION_FIELDS_INVALID");
}

function exactIso(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function sha256(value: string): Sha256 {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export interface V213V212TerminalOutputProjection {
  readonly schemaVersion: typeof V213_V212_TERMINAL_OUTPUT_PROJECTION_SCHEMA;
  readonly fullLiveAuthorityId: string;
  readonly stageAuthorityId: string;
  readonly outerStateSha256: Sha256;
  readonly operationId: "v2-12-long-output";
  readonly checkpoint: "V2-12";
  readonly workflowId: string;
  readonly executionId: string;
  readonly executionRequestSha256: Sha256;
  readonly authoritySha256: Sha256;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly attemptId: string;
  readonly scopeRequestSha256: Sha256;
  readonly outputSha256: Sha256;
  readonly outputReceiptSha256: Sha256;
  readonly outputBytes: number;
  readonly terminalAt: string;
  readonly workloadDeadlineAt: string;
  readonly fullAuthorityExpiresAt: string;
  readonly outputBindingSha256: Sha256;
}

const PROJECTION_KEYS = Object.freeze([
  "accountId",
  "attemptId",
  "authoritySha256",
  "checkpoint",
  "executionId",
  "executionRequestSha256",
  "fullAuthorityExpiresAt",
  "fullLiveAuthorityId",
  "operationId",
  "outputBindingSha256",
  "outputBytes",
  "outputReceiptSha256",
  "outputSha256",
  "outerStateSha256",
  "projectId",
  "projectRevisionId",
  "scopeRequestSha256",
  "schemaVersion",
  "stageAuthorityId",
  "terminalAt",
  "workflowId",
  "workloadDeadlineAt",
  "workspaceId",
]);

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function validSha(value: unknown): value is Sha256 {
  return typeof value === "string" && SHA256.test(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && WORKFLOW_ID.test(value);
}

export function validateV213V212TerminalOutputProjection(
  value: unknown,
  expected: {
    readonly fullLiveAuthorityId: string;
    readonly workflowId: string;
    readonly deadlineAt: string;
  },
  now: Date = new Date(),
): V213V212TerminalOutputProjection {
  const projection = object(value, "PROJECTION_INVALID");
  exactKeys(projection, PROJECTION_KEYS);
  const terminalAt = exactIso(projection.terminalAt) ? Date.parse(projection.terminalAt) : NaN;
  const workloadDeadlineAt = exactIso(projection.workloadDeadlineAt)
    ? Date.parse(projection.workloadDeadlineAt)
    : NaN;
  const fullAuthorityExpiresAt = exactIso(projection.fullAuthorityExpiresAt)
    ? Date.parse(projection.fullAuthorityExpiresAt)
    : NaN;
  const deadlineAt = exactIso(expected.deadlineAt) ? Date.parse(expected.deadlineAt) : NaN;
  const nowMs = now.getTime();
  if (
    projection.schemaVersion !== V213_V212_TERMINAL_OUTPUT_PROJECTION_SCHEMA ||
    projection.fullLiveAuthorityId !== expected.fullLiveAuthorityId ||
    projection.operationId !== "v2-12-long-output" ||
    projection.checkpoint !== "V2-12" ||
    projection.workflowId !== expected.workflowId ||
    !validUuid(projection.fullLiveAuthorityId) ||
    !validUuid(projection.stageAuthorityId) ||
    !validId(projection.workflowId) ||
    !validId(projection.executionId) ||
    !validId(projection.attemptId) ||
    ![
      projection.outerStateSha256,
      projection.executionRequestSha256,
      projection.authoritySha256,
      projection.scopeRequestSha256,
      projection.outputSha256,
      projection.outputReceiptSha256,
      projection.outputBindingSha256,
    ].every(validSha) ||
    ![
      projection.accountId,
      projection.workspaceId,
      projection.projectId,
      projection.projectRevisionId,
    ].every(validUuid) ||
    !Number.isSafeInteger(projection.outputBytes) ||
    Number(projection.outputBytes) < 1 ||
    Number(projection.outputBytes) > MAX_OUTPUT_BYTES ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(terminalAt) ||
    !Number.isFinite(workloadDeadlineAt) ||
    !Number.isFinite(fullAuthorityExpiresAt) ||
    !Number.isFinite(deadlineAt) ||
    terminalAt > nowMs ||
    workloadDeadlineAt <= nowMs ||
    fullAuthorityExpiresAt <= nowMs ||
    workloadDeadlineAt !== deadlineAt ||
    Math.min(workloadDeadlineAt, fullAuthorityExpiresAt) <= nowMs ||
    terminalAt >= deadlineAt
  )
    fail("PROJECTION_BINDING_INVALID");
  return Object.freeze(projection) as unknown as V213V212TerminalOutputProjection;
}

export interface V213V212TerminalOutputResolverRequest {
  readonly fullLiveAuthorityId: string;
  readonly workflowId: string;
  readonly deadlineAt: string;
  readonly signal?: AbortSignal;
}

export type V213V212TerminalOutputResolver = (
  input: V213V212TerminalOutputResolverRequest,
) => Promise<V213V212TerminalOutputProjection>;

/**
 * Reconciler-only post-terminal read. The SQL function is deliberately a projection over the
 * already-claimed V2-12 workflow and durable output rows; this adapter has no dispatch method.
 */
export function createV213V212ProductionTerminalOutputResolver(input: {
  readonly database: TransactionalSqlExecutor;
  readonly now: () => Date;
  readonly sleep: (milliseconds: number) => Promise<void>;
  readonly pollIntervalMs?: number;
}): V213V212TerminalOutputResolver {
  const interval = input.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  if (!Number.isInteger(interval) || interval < 100 || interval > 10_000)
    fail("POLL_INTERVAL_INVALID");
  return async (request) => {
    if (!validUuid(request.fullLiveAuthorityId) || !validId(request.workflowId))
      fail("REQUEST_IDENTITY_INVALID");
    const deadlineAt = exactIso(request.deadlineAt) ? Date.parse(request.deadlineAt) : NaN;
    if (!Number.isFinite(deadlineAt)) fail("REQUEST_DEADLINE_INVALID");
    while (input.now().getTime() < deadlineAt) {
      if (request.signal?.aborted) fail("CANCELLED");
      let value: unknown;
      try {
        value = await input.database.transaction(async (transaction) => {
          const result = await transaction.query<{ value: unknown }>(
            `SELECT public.videoforge_load_v212_terminal_output_projection(
               $1::uuid,$2::text,$3::text
             ) AS value`,
            [request.fullLiveAuthorityId, "v2-12-long-output", request.workflowId],
          );
          return result.rows.length === 1 ? result.rows[0]?.value : null;
        });
      } catch {
        fail("PROJECTION_READ_FAILED");
      }
      if (value !== null && value !== undefined)
        return validateV213V212TerminalOutputProjection(value, request, input.now());
      const remaining = deadlineAt - input.now().getTime();
      if (remaining <= 0) break;
      await input.sleep(Math.min(interval, remaining));
    }
    fail("TERMINAL_OUTPUT_DEADLINE_EXCEEDED");
  };
}

function requestRecord(value: unknown, code: string): Record<string, unknown> {
  return object(value, code);
}

export function buildV213V212RealChromeRequestFromTerminalProjection(input: {
  readonly materialized: {
    readonly requestDocument: Readonly<Record<string, unknown>>;
    readonly executionDocument: Readonly<Record<string, unknown>>;
    readonly callDocument: Readonly<Record<string, unknown>>;
  };
  readonly projection: V213V212TerminalOutputProjection;
  readonly productionOrigin: string;
  readonly now: Date;
}): V213V212RealChromeRequest {
  const requestDocument = requestRecord(
    input.materialized.requestDocument,
    "MATERIALIZATION_INVALID",
  );
  const executionDocument = requestRecord(
    input.materialized.executionDocument,
    "MATERIALIZATION_INVALID",
  );
  const callDocument = requestRecord(input.materialized.callDocument, "MATERIALIZATION_INVALID");
  const executionRequest = requestRecord(callDocument.request, "MATERIALIZATION_REQUEST_INVALID");
  const scopes = Array.isArray(executionRequest.scopes) ? executionRequest.scopes : [];
  const scope = requestRecord(scopes[0], "MATERIALIZATION_SCOPE_INVALID");
  if (
    requestDocument.fullLiveAuthorityId !== input.projection.fullLiveAuthorityId ||
    requestDocument.stageAuthorityId !== input.projection.stageAuthorityId ||
    requestDocument.outerStateSha256 !== input.projection.outerStateSha256 ||
    executionDocument.workflowId !== input.projection.workflowId ||
    executionDocument.workloadDeadlineAt !== input.projection.workloadDeadlineAt ||
    executionRequest.executionId !== input.projection.executionId ||
    executionRequest.authoritySha256 !== input.projection.authoritySha256 ||
    canonicalSha256(executionRequest) !== input.projection.executionRequestSha256 ||
    scope.accountId !== input.projection.accountId ||
    scope.workspaceId !== input.projection.workspaceId ||
    scope.projectId !== input.projection.projectId ||
    scope.projectRevisionId !== input.projection.projectRevisionId ||
    scope.attemptId !== input.projection.attemptId ||
    scope.requestSha256 !== input.projection.scopeRequestSha256
  )
    fail("MATERIALIZATION_BINDING_INVALID");
  const workloadDeadlineAt = Date.parse(input.projection.workloadDeadlineAt);
  const fullAuthorityExpiresAt = Date.parse(input.projection.fullAuthorityExpiresAt);
  const deadlineAt = new Date(Math.min(workloadDeadlineAt, fullAuthorityExpiresAt)).toISOString();
  return buildV213V212RealChromeRequest(
    {
      fullLiveAuthorityId: input.projection.fullLiveAuthorityId,
      stageAuthorityId: input.projection.stageAuthorityId,
      outerStateSha256: input.projection.outerStateSha256,
      operationId: "v2-12-long-output",
      checkpoint: "V2-12",
      workflowId: input.projection.workflowId,
      executionId: input.projection.executionId,
      executionRequestSha256: input.projection.executionRequestSha256,
      authoritySha256: input.projection.authoritySha256,
      accountId: input.projection.accountId,
      workspaceId: input.projection.workspaceId,
      projectId: input.projection.projectId,
      projectRevisionId: input.projection.projectRevisionId,
      attemptId: input.projection.attemptId,
      scopeRequestSha256: input.projection.scopeRequestSha256,
      outputSha256: input.projection.outputSha256,
      outputReceiptSha256: input.projection.outputReceiptSha256,
      outputBytes: input.projection.outputBytes,
      productionUrlSha256: sha256(input.productionOrigin),
      terminalAt: input.projection.terminalAt,
      workloadDeadlineAt: input.projection.workloadDeadlineAt,
      fullAuthorityExpiresAt: input.projection.fullAuthorityExpiresAt,
      deadlineAt,
    },
    input.now,
  );
}

/**
 * Starts the live acceptance request once, waits for the DB-owned terminal projection, launches
 * the installed-Chrome producer once, and only then awaits the response that resumes/finalizes
 * the Workflow. A producer failure aborts the outstanding HTTP request and never redispatches.
 */
export async function runV213V212LiveAcceptanceWithChrome<Acceptance, Chrome>(input: {
  readonly materialized: {
    readonly requestDocument: Readonly<Record<string, unknown>>;
    readonly executionDocument: Readonly<Record<string, unknown>>;
    readonly callDocument: Readonly<Record<string, unknown>>;
  };
  readonly fullLiveAuthorityId: string;
  readonly workflowId: string;
  readonly workloadDeadlineAt: string;
  readonly productionOrigin: string;
  readonly now: () => Date;
  readonly resolveTerminal: V213V212TerminalOutputResolver;
  readonly startLiveAcceptance: (signal: AbortSignal) => Promise<Acceptance>;
  readonly produceChrome: (input: {
    readonly request: V213V212RealChromeRequest;
    readonly signal: AbortSignal;
  }) => Promise<Chrome>;
  readonly signal?: AbortSignal;
}): Promise<{
  readonly acceptance: Acceptance;
  readonly terminal: V213V212TerminalOutputProjection;
  readonly request: V213V212RealChromeRequest;
  readonly chrome: Chrome;
}> {
  if (!validUuid(input.fullLiveAuthorityId) || !validId(input.workflowId))
    fail("REQUEST_IDENTITY_INVALID");
  if (!exactIso(input.workloadDeadlineAt)) fail("REQUEST_DEADLINE_INVALID");
  const controller = new AbortController();
  const abortFromParent = () => controller.abort();
  if (input.signal) {
    if (input.signal.aborted) fail("CANCELLED");
    input.signal.addEventListener("abort", abortFromParent, { once: true });
  }
  let acceptance: Promise<Acceptance>;
  try {
    acceptance = Promise.resolve(input.startLiveAcceptance(controller.signal));
  } catch (error) {
    acceptance = Promise.reject(error);
  }
  let acceptanceFailure: { readonly error: unknown } | undefined;
  void acceptance.catch((error: unknown) => {
    acceptanceFailure = { error };
    controller.abort();
  });
  try {
    await Promise.resolve();
    if (acceptanceFailure) throw acceptanceFailure.error;
    const terminal = await Promise.race([
      input.resolveTerminal({
        fullLiveAuthorityId: input.fullLiveAuthorityId,
        workflowId: input.workflowId,
        deadlineAt: input.workloadDeadlineAt,
        signal: controller.signal,
      }),
      acceptance.then(
        () => new Promise<never>(() => undefined),
        (error: unknown) => Promise.reject(error),
      ),
    ]);
    if (controller.signal.aborted) fail("CANCELLED");
    validateV213V212TerminalOutputProjection(
      terminal,
      {
        fullLiveAuthorityId: input.fullLiveAuthorityId,
        workflowId: input.workflowId,
        deadlineAt: input.workloadDeadlineAt,
      },
      input.now(),
    );
    const request = buildV213V212RealChromeRequestFromTerminalProjection({
      materialized: input.materialized,
      projection: terminal,
      productionOrigin: input.productionOrigin,
      now: input.now(),
    });
    const chrome = await input.produceChrome({ request, signal: controller.signal });
    if (controller.signal.aborted) fail("CANCELLED");
    return Object.freeze({
      acceptance: await acceptance,
      terminal,
      request,
      chrome,
    });
  } catch (error) {
    controller.abort();
    await acceptance.catch(() => undefined);
    throw error;
  } finally {
    input.signal?.removeEventListener("abort", abortFromParent);
  }
}
