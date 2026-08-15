import { createHash } from "node:crypto";

import { canonicalizeJson, validateContract } from "@videoforge/contracts";

import type { SqlExecutor, TransactionalSqlExecutor } from "../database/ports.js";
import { TENANT_PRINCIPAL_SETTING } from "../database/vocabulary.js";
import type * as ArtifactContracts from "../repositories/artifacts.js";
import type * as EventContracts from "../repositories/events.js";
import type * as ExecutionContracts from "../repositories/execution.js";
import type * as IdentityContracts from "../repositories/identity.js";
import type * as PresetContracts from "../repositories/presets.js";
import type * as ProjectContracts from "../repositories/projects.js";
import type * as TimingContracts from "../repositories/timing.js";
import type {
  CanonicalDocument,
  DurableOwner,
  IdempotentMutation,
  IdempotentRepositoryResult,
  JsonObject,
  RepositoryResult,
  Sha256,
  WorkspaceScope,
} from "../repositories/types.js";
import type {
  ControlPlaneRepositories,
  RepositorySession,
  RepositoryUnitOfWork,
} from "../repositories/unit-of-work.js";
import {
  DURABLE_STYLE_ANALYZER_MODEL,
  DURABLE_STYLE_ANALYZER_PROVIDER,
  composeDurableImageStyleAnalysisInput,
} from "../styles/durable-analysis.js";

type Row = Record<string, unknown>;

const MAX_TASK_ATTEMPTS = 32;

interface AtomicRunner {
  run<Value>(work: (executor: SqlExecutor) => Promise<Value>): Promise<Value>;
}

interface RepositoryContext {
  readonly executor: SqlExecutor;
  readonly atomic: AtomicRunner;
}

function success<Value>(value: Value): { readonly ok: true; readonly value: Value } {
  return { ok: true, value };
}

function write<Value>(value: Value, replayed = false) {
  return success({ value, replayed });
}

function conflict<Code extends string>(code: Code, message: string, currentVersion?: number) {
  return currentVersion === undefined
    ? ({ ok: false, kind: "CONFLICT", code, message } as const)
    : ({ ok: false, kind: "CONFLICT", code, message, currentVersion } as const);
}

function missing<Entity extends string>(entity: Entity, id: string) {
  return { ok: false, kind: "NOT_FOUND", entity, id } as const;
}

function invariant<Code extends string>(code: Code, message: string) {
  return { ok: false, kind: "INVARIANT_VIOLATION", code, message } as const;
}

function stringValue(value: unknown, column: string): string {
  if (typeof value !== "string") {
    throw new TypeError(`expected ${column} to be a string`);
  }
  return value;
}

function nullableString(value: unknown, column: string): string | null {
  return value === null ? null : stringValue(value, column);
}

function numberValue(value: unknown, column: string): number {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "bigint") {
    return Number(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return Number(value);
  }
  throw new TypeError(`expected ${column} to be numeric`);
}

function nullableDecimalNumber(value: unknown, column: string): number | null {
  if (value === null) return null;
  const parsed =
    typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`expected ${column} to be a finite decimal`);
  }
  return parsed;
}

function bigintValue(value: unknown, column: string): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    return BigInt(value);
  }
  throw new TypeError(`expected ${column} to be an integer`);
}

function nullableBigint(value: unknown, column: string): bigint | null {
  return value === null ? null : bigintValue(value, column);
}

function booleanValue(value: unknown, column: string): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError(`expected ${column} to be boolean`);
  }
  return value;
}

function timestamp(value: unknown, column: string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  return stringValue(value, column);
}

function nullableTimestamp(value: unknown, column: string): string | null {
  return value === null ? null : timestamp(value, column);
}

function jsonObject(value: unknown, column: string): JsonObject {
  if (typeof value === "string") {
    return JSON.parse(value) as JsonObject;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`expected ${column} to be a JSON object`);
  }
  return value as JsonObject;
}

function jsonArray(value: unknown, column: string): readonly string[] {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new TypeError(`expected ${column} to be a string array`);
  }
  return parsed;
}

function jsonParameter(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === "bigint" ? item.toString() : item,
  );
}

function canonicalComparable(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { $bigint: value.toString() };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(canonicalComparable);
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalComparable(item)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalComparable(left)) === JSON.stringify(canonicalComparable(right));
}

function exactObjectKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const expectedKeys = [...expected].sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function validImageStyleProfileDocument(candidate: unknown): candidate is CanonicalDocument {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return false;
  try {
    const document = candidate as CanonicalDocument;
    if (
      !exactObjectKeys(document, [
        "canonicalDocumentSha256",
        "contractName",
        "contractVersion",
        "payload",
      ]) ||
      document.contractName !== "image-style-profile" ||
      document.contractVersion !== "v1" ||
      !validateContract("imageStyleProfile", document.payload).success
    ) {
      return false;
    }
    const actual = `sha256:${createHash("sha256")
      .update(canonicalizeJson(document.payload), "utf8")
      .digest("hex")}`;
    return actual === document.canonicalDocumentSha256;
  } catch {
    return false;
  }
}

const IMAGE_STYLE_ANALYSIS_USAGE_KEYS = Object.freeze([
  "completion_tokens",
  "prompt_tokens",
  "provider_attempt_count",
  "reasoning_tokens",
  "schema_version",
  "total_tokens",
]);

function validImageStyleAnalysisUsage(
  candidate: unknown,
): candidate is PresetContracts.ImageStyleAnalysisUsageSummary {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return false;
  const usage = candidate as Record<string, unknown>;
  if (
    !exactObjectKeys(usage, IMAGE_STYLE_ANALYSIS_USAGE_KEYS) ||
    usage.schema_version !== "videoforge.image-style-analysis-usage/v1" ||
    (usage.provider_attempt_count !== 1 && usage.provider_attempt_count !== 2)
  ) {
    return false;
  }
  const prompt = usage.prompt_tokens;
  const completion = usage.completion_tokens;
  const total = usage.total_tokens;
  const reasoning = usage.reasoning_tokens;
  return (
    Number.isSafeInteger(prompt) &&
    Number.isSafeInteger(completion) &&
    Number.isSafeInteger(total) &&
    Number.isSafeInteger(reasoning) &&
    (prompt as number) >= 0 &&
    (completion as number) >= 0 &&
    (total as number) === (prompt as number) + (completion as number) &&
    (reasoning as number) >= 0 &&
    (reasoning as number) <= (completion as number)
  );
}

function imageStyleAnalysisArtifactMetadata(
  command: PresetContracts.AcceptImageStyleAnalysisResultCommand,
): JsonObject {
  return {
    source: "image-style-analysis",
    analysis_attempt_id: command.analysisAttemptId,
    task_id: command.taskId,
    execution_attempt_id: command.executionAttemptId,
    analyzer_request_hash: command.analyzerRequestHash,
    reference_set_hash: command.referenceSetHash,
    analyzer_output_hash: command.analyzerOutputHash,
    analyzer_model_snapshot: command.analyzerModelSnapshot,
    usage_schema_version: command.usagePayload.schema_version,
    provider_attempt_count: command.usagePayload.provider_attempt_count,
    prompt_tokens: command.usagePayload.prompt_tokens,
    completion_tokens: command.usagePayload.completion_tokens,
    total_tokens: command.usagePayload.total_tokens,
    reasoning_tokens: command.usagePayload.reasoning_tokens,
    reported_cost_micro_usd: command.reportedCostMicroUsd.toString(),
  };
}

function imageStyleAnalysisProviderDetails(
  command: PresetContracts.AcceptImageStyleAnalysisResultCommand,
): JsonObject {
  return {
    source: "image-style-analysis",
    analysis_attempt_id: command.analysisAttemptId,
    analyzer_request_hash: command.analyzerRequestHash,
    reference_set_hash: command.referenceSetHash,
    analyzer_output_hash: command.analyzerOutputHash,
    analyzer_model_snapshot: command.analyzerModelSnapshot,
    usage: command.usagePayload,
    reported_cost_micro_usd: command.reportedCostMicroUsd.toString(),
  };
}

function imageStyleAnalysisKind(value: unknown): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>).analysis_kind
    : undefined;
}

function imageStyleAnalyzerModelSnapshot(
  command: PresetContracts.BeginImageStyleAnalysisCommand,
): string {
  return canonicalizeJson({
    model: command.model,
    model_revision: command.modelRevision,
    provider: command.provider,
  });
}

type CanonicalReceiptValue =
  | { readonly type: "array"; readonly value: readonly CanonicalReceiptValue[] }
  | { readonly type: "bigint"; readonly value: string }
  | { readonly type: "boolean"; readonly value: boolean }
  | { readonly type: "null" }
  | { readonly type: "number"; readonly value: string }
  | {
      readonly type: "object";
      readonly value: readonly (readonly [string, CanonicalReceiptValue])[];
    }
  | { readonly type: "string"; readonly value: string };

const RECEIPT_CODEC_MAX_DEPTH = 64;
const RECEIPT_CODEC_MAX_NODES = 50_000;
const RECEIPT_CODEC_MAX_BYTES = 2 * 1024 * 1024;

interface ReceiptCodecBudget {
  bytes: number;
  nodes: number;
}

function chargeReceiptCodec(budget: ReceiptCodecBudget, depth: number, bytes = 0): void {
  if (depth > RECEIPT_CODEC_MAX_DEPTH) {
    throw new RangeError(`repository receipt codec depth exceeds ${RECEIPT_CODEC_MAX_DEPTH}`);
  }
  budget.nodes += 1;
  budget.bytes += 64 + bytes;
  if (budget.nodes > RECEIPT_CODEC_MAX_NODES) {
    throw new RangeError(`repository receipt codec node count exceeds ${RECEIPT_CODEC_MAX_NODES}`);
  }
  if (budget.bytes > RECEIPT_CODEC_MAX_BYTES) {
    throw new RangeError(`repository receipt codec size exceeds ${RECEIPT_CODEC_MAX_BYTES} bytes`);
  }
}

function sortedStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodeReceiptNode(
  value: unknown,
  budget: ReceiptCodecBudget,
  depth: number,
  ancestors: WeakSet<object>,
): CanonicalReceiptValue {
  const primitiveBytes =
    typeof value === "string"
      ? Buffer.byteLength(value, "utf8")
      : typeof value === "bigint" || typeof value === "number"
        ? Buffer.byteLength(String(value), "utf8")
        : 0;
  chargeReceiptCodec(budget, depth, primitiveBytes);
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("repository receipt numbers must be finite");
    }
    return { type: "number", value: Object.is(value, -0) ? "-0" : String(value) };
  }
  if (typeof value === "bigint") return { type: "bigint", value: value.toString() };
  if (typeof value !== "object") {
    throw new TypeError("repository receipts cannot encode undefined, symbols, or functions");
  }
  if (ancestors.has(value)) throw new TypeError("repository receipts cannot encode cycles");
  ancestors.add(value);
  try {
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some((key) => typeof key === "symbol")) {
      throw new TypeError("repository receipts cannot encode symbol properties");
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value)) {
      const length = value.length;
      const expectedKeys = [...Array.from({ length }, (_unused, index) => String(index)), "length"];
      const stringKeys = ownKeys as string[];
      if (
        stringKeys.length !== expectedKeys.length ||
        expectedKeys.some((key) => !stringKeys.includes(key))
      ) {
        throw new TypeError("repository receipt arrays must be dense and contain no extra fields");
      }
      const items = Array.from({ length }, (_unused, index) => {
        const descriptor = descriptors[String(index)];
        if (descriptor === undefined || !("value" in descriptor)) {
          throw new TypeError("repository receipts cannot encode accessors");
        }
        return encodeReceiptNode(descriptor.value, budget, depth + 1, ancestors);
      });
      return { type: "array", value: items };
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("repository receipt objects must have a plain prototype");
    }
    const keys = (ownKeys as string[]).sort(sortedStrings);
    const entries = keys.map((key) => {
      budget.bytes += Buffer.byteLength(key, "utf8");
      if (budget.bytes > RECEIPT_CODEC_MAX_BYTES) {
        throw new RangeError(
          `repository receipt codec size exceeds ${RECEIPT_CODEC_MAX_BYTES} bytes`,
        );
      }
      const descriptor = descriptors[key];
      if (descriptor === undefined || !("value" in descriptor)) {
        throw new TypeError("repository receipts cannot encode accessors");
      }
      return [key, encodeReceiptNode(descriptor.value, budget, depth + 1, ancestors)] as const;
    });
    return { type: "object", value: entries };
  } finally {
    ancestors.delete(value);
  }
}

function encodeReceiptValue(value: unknown): CanonicalReceiptValue {
  const budget: ReceiptCodecBudget = { bytes: 0, nodes: 0 };
  const encoded = encodeReceiptNode(value, budget, 0, new WeakSet());
  const exactBytes = Buffer.byteLength(JSON.stringify(encoded), "utf8");
  if (exactBytes > RECEIPT_CODEC_MAX_BYTES) {
    throw new RangeError(`repository receipt codec size exceeds ${RECEIPT_CODEC_MAX_BYTES} bytes`);
  }
  return encoded;
}

function exactObject(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must have a plain prototype`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.some((key) => typeof key === "symbol")) {
    throw new TypeError(`${label} cannot contain symbol properties`);
  }
  const keys = ownKeys as string[];
  if (keys.length !== expectedKeys.length || expectedKeys.some((key) => !keys.includes(key))) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const result: Record<string, unknown> = {};
  for (const key of expectedKeys) {
    const descriptor = descriptors[key];
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new TypeError(`${label} cannot contain accessors`);
    }
    Object.defineProperty(result, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return result;
}

function decodeReceiptNode(value: unknown, budget: ReceiptCodecBudget, depth: number): unknown {
  chargeReceiptCodec(budget, depth);
  const hasValue = typeof value === "object" && value !== null && Object.hasOwn(value, "value");
  const base = exactObject(
    value,
    hasValue ? ["type", "value"] : ["type"],
    "repository receipt value",
  );
  const type = base.type;
  if (type === "null") {
    exactObject(value, ["type"], "repository receipt null");
    return null;
  }
  if (type === "string") {
    if (typeof base.value !== "string") throw new TypeError("invalid receipt string");
    budget.bytes += Buffer.byteLength(base.value, "utf8");
    if (budget.bytes > RECEIPT_CODEC_MAX_BYTES) {
      throw new RangeError(
        `repository receipt codec size exceeds ${RECEIPT_CODEC_MAX_BYTES} bytes`,
      );
    }
    return base.value;
  }
  if (type === "boolean") {
    if (typeof base.value !== "boolean") throw new TypeError("invalid receipt boolean");
    return base.value;
  }
  if (type === "number") {
    if (typeof base.value !== "string") throw new TypeError("invalid receipt number");
    budget.bytes += Buffer.byteLength(base.value, "utf8");
    if (budget.bytes > RECEIPT_CODEC_MAX_BYTES) {
      throw new RangeError(
        `repository receipt codec size exceeds ${RECEIPT_CODEC_MAX_BYTES} bytes`,
      );
    }
    if (base.value === "-0") return -0;
    const decoded = Number(base.value);
    if (!Number.isFinite(decoded) || String(decoded) !== base.value) {
      throw new TypeError("receipt number is not canonical");
    }
    return decoded;
  }
  if (type === "bigint") {
    if (typeof base.value !== "string") throw new TypeError("invalid receipt bigint");
    budget.bytes += Buffer.byteLength(base.value, "utf8");
    if (budget.bytes > RECEIPT_CODEC_MAX_BYTES) {
      throw new RangeError(
        `repository receipt codec size exceeds ${RECEIPT_CODEC_MAX_BYTES} bytes`,
      );
    }
    if (!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(base.value)) {
      throw new TypeError("receipt bigint is not canonical");
    }
    return BigInt(base.value);
  }
  if (type === "array") {
    if (!Array.isArray(base.value)) throw new TypeError("invalid receipt array");
    return base.value.map((item) => decodeReceiptNode(item, budget, depth + 1));
  }
  if (type === "object") {
    if (!Array.isArray(base.value)) throw new TypeError("invalid receipt object");
    const output: Record<string, unknown> = {};
    let priorKey: string | null = null;
    for (const entry of base.value) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") {
        throw new TypeError("invalid receipt object entry");
      }
      if (priorKey !== null && sortedStrings(priorKey, entry[0]) >= 0) {
        throw new TypeError("receipt object keys must be unique and sorted");
      }
      budget.bytes += Buffer.byteLength(entry[0], "utf8");
      if (budget.bytes > RECEIPT_CODEC_MAX_BYTES) {
        throw new RangeError(
          `repository receipt codec size exceeds ${RECEIPT_CODEC_MAX_BYTES} bytes`,
        );
      }
      Object.defineProperty(output, entry[0], {
        configurable: true,
        enumerable: true,
        value: decodeReceiptNode(entry[1], budget, depth + 1),
        writable: true,
      });
      priorKey = entry[0];
    }
    return output;
  }
  throw new TypeError("unsupported repository receipt value type");
}

function decodeReceiptValue(value: unknown): unknown {
  return decodeReceiptNode(value, { bytes: 0, nodes: 0 }, 0);
}

function receiptPayloadJson(value: CanonicalReceiptValue): string {
  return JSON.stringify(value);
}

function receiptHash(value: CanonicalReceiptValue): Sha256 {
  return `sha256:${createHash("sha256").update(receiptPayloadJson(value)).digest("hex")}`;
}

async function one(
  executor: SqlExecutor,
  sql: string,
  parameters: readonly (string | number | bigint | boolean | Date | Uint8Array | null)[] = [],
): Promise<Row | null> {
  const result = await executor.query<Row>(sql, parameters);
  return result.rows[0] ?? null;
}

function ownerColumns(owner: DurableOwner): readonly [string | null, string | null, string | null] {
  switch (owner.ownerType) {
    case "PROJECT_REVISION":
      return [owner.projectRevisionId, null, null];
    case "IMAGE_STYLE_VERSION":
      return [null, owner.imageStyleVersionId, null];
    case "AVATAR_PROFILE_VERSION":
      return [null, null, owner.avatarProfileVersionId];
  }
}

function ownerFromRow(row: Row): DurableOwner {
  const ownerType = stringValue(row.owner_type, "owner_type");
  const ownerId = stringValue(row.owner_id, "owner_id");
  switch (ownerType) {
    case "PROJECT_REVISION":
      return {
        ownerType,
        ownerId,
        projectRevisionId: stringValue(row.project_revision_id ?? ownerId, "project_revision_id"),
      };
    case "IMAGE_STYLE_VERSION":
      return {
        ownerType,
        ownerId,
        imageStyleVersionId: stringValue(
          row.image_style_version_id ?? ownerId,
          "image_style_version_id",
        ),
      };
    case "AVATAR_PROFILE_VERSION":
      return {
        ownerType,
        ownerId,
        avatarProfileVersionId: stringValue(
          row.avatar_profile_version_id ?? ownerId,
          "avatar_profile_version_id",
        ),
      };
    default:
      throw new TypeError(`unsupported durable owner ${ownerType}`);
  }
}

function mapTask(row: Row): ExecutionContracts.GenerationTaskRecord {
  return {
    taskId: stringValue(row.id, "generation_tasks.id"),
    workspaceId: stringValue(row.workspace_id, "generation_tasks.workspace_id"),
    owner: ownerFromRow(row),
    taskKey: stringValue(row.task_key, "generation_tasks.task_key"),
    lane: stringValue(
      row.lane,
      "generation_tasks.lane",
    ) as ExecutionContracts.GenerationTaskRecord["lane"],
    state: stringValue(
      row.state,
      "generation_tasks.state",
    ) as ExecutionContracts.GenerationTaskRecord["state"],
    required: booleanValue(row.required, "generation_tasks.required"),
    dependsOn: jsonArray(row.depends_on, "generation_tasks.depends_on"),
    acceptedAttemptId: nullableString(
      row.accepted_attempt_id,
      "generation_tasks.accepted_attempt_id",
    ),
    version: numberValue(row.version, "generation_tasks.version"),
    createdAt: timestamp(row.created_at, "generation_tasks.created_at"),
    updatedAt: timestamp(row.updated_at, "generation_tasks.updated_at"),
    cancelRequestedAt: nullableTimestamp(
      row.cancel_requested_at,
      "generation_tasks.cancel_requested_at",
    ),
    finishedAt: nullableTimestamp(row.finished_at, "generation_tasks.finished_at"),
  };
}

function mapAttempt(row: Row): ExecutionContracts.AttemptRecord {
  return {
    attemptId: stringValue(row.id, "attempts.id"),
    workspaceId: stringValue(row.workspace_id, "attempts.workspace_id"),
    taskId: stringValue(row.task_id, "attempts.task_id"),
    ordinal: numberValue(row.ordinal, "attempts.ordinal"),
    idempotencyKey: stringValue(
      row.idempotency_key,
      "attempts.idempotency_key",
    ) as ExecutionContracts.AttemptRecord["idempotencyKey"],
    state: stringValue(row.state, "attempts.state") as ExecutionContracts.AttemptRecord["state"],
    dispatchState: stringValue(
      row.dispatch_state,
      "attempts.dispatch_state",
    ) as ExecutionContracts.AttemptRecord["dispatchState"],
    claimState: stringValue(
      row.claim_state,
      "attempts.claim_state",
    ) as ExecutionContracts.AttemptRecord["claimState"],
    executionProfileId: stringValue(row.execution_profile_id, "attempts.execution_profile_id"),
    executionClaimTokenHash: stringValue(
      row.execution_claim_token_hash,
      "attempts.execution_claim_token_hash",
    ) as Sha256,
    externalJobId: nullableString(row.external_job_id, "attempts.external_job_id"),
    inputHash: stringValue(row.input_hash, "attempts.input_hash") as Sha256,
    outputAssetId: nullableString(row.output_asset_id, "attempts.output_asset_id"),
    resultDisposition: stringValue(
      row.result_disposition,
      "attempts.result_disposition",
    ) as ExecutionContracts.AttemptRecord["resultDisposition"],
    parentAttemptId: nullableString(row.parent_attempt_id, "attempts.parent_attempt_id"),
    fallbackReason: nullableString(row.fallback_reason, "attempts.fallback_reason"),
    problemCode: nullableString(row.problem_code, "attempts.problem_code"),
    providerDetails: jsonObject(row.provider_details, "attempts.provider_details"),
    createdAt: timestamp(row.created_at, "attempts.created_at"),
    claimedAt: nullableTimestamp(row.claimed_at, "attempts.claimed_at"),
    startedAt: nullableTimestamp(row.started_at, "attempts.started_at"),
    finishedAt: nullableTimestamp(row.finished_at, "attempts.finished_at"),
  } as ExecutionContracts.AttemptRecord;
}

function mapCostEvent(row: Row): EventContracts.CostEventRecord {
  return {
    costEventId: stringValue(row.id, "cost_events.id"),
    workspaceId: stringValue(row.workspace_id, "cost_events.workspace_id"),
    owner: ownerFromRow(row),
    taskId: stringValue(row.task_id, "cost_events.task_id"),
    attemptId: stringValue(row.attempt_id, "cost_events.attempt_id"),
    sequence: numberValue(row.sequence, "cost_events.sequence"),
    eventType: stringValue(
      row.event_type,
      "cost_events.event_type",
    ) as EventContracts.CostEventRecord["eventType"],
    amountMicroUsd: bigintValue(row.amount_micro_usd, "cost_events.amount_micro_usd"),
    currency: "USD",
    idempotencyKey: stringValue(
      row.idempotency_key,
      "cost_events.idempotency_key",
    ) as EventContracts.CostEventRecord["idempotencyKey"],
    providerReference: nullableString(row.provider_reference, "cost_events.provider_reference"),
    details: jsonObject(row.details, "cost_events.details"),
    occurredAt: timestamp(row.occurred_at, "cost_events.occurred_at"),
    createdAt: timestamp(row.created_at, "cost_events.created_at"),
  };
}

function mapOutbox(row: Row): ExecutionContracts.OutboxRecord {
  return {
    outboxId: stringValue(row.id, "outbox.id"),
    accountId: stringValue(row.account_id, "outbox.account_id"),
    workspaceId: stringValue(row.workspace_id, "outbox.workspace_id"),
    taskId: stringValue(row.task_id, "outbox.task_id"),
    attemptId: stringValue(row.attempt_id, "outbox.attempt_id"),
    kind: stringValue(row.kind, "outbox.kind") as ExecutionContracts.OutboxRecord["kind"],
    state: stringValue(row.state, "outbox.state") as ExecutionContracts.OutboxRecord["state"],
    dedupeKey: stringValue(
      row.dedupe_key,
      "outbox.dedupe_key",
    ) as ExecutionContracts.OutboxRecord["dedupeKey"],
    payloadContractName: stringValue(row.payload_contract_name, "outbox.payload_contract_name"),
    payloadContractVersion: stringValue(
      row.payload_contract_version,
      "outbox.payload_contract_version",
    ),
    payloadHash: stringValue(row.payload_hash, "outbox.payload_hash") as Sha256,
    payload: jsonObject(row.payload, "outbox.payload"),
    availableAt: timestamp(row.available_at, "outbox.available_at"),
    leaseOwner: nullableString(row.lease_owner, "outbox.lease_owner"),
    leaseExpiresAt: nullableTimestamp(row.lease_expires_at, "outbox.lease_expires_at"),
    deliveredAt: nullableTimestamp(row.delivered_at, "outbox.delivered_at"),
    createdAt: timestamp(row.created_at, "outbox.created_at"),
    updatedAt: timestamp(row.updated_at, "outbox.updated_at"),
  };
}

function mapWorkflowEvent(row: Row): EventContracts.WorkflowEventRecord {
  const aggregateType = stringValue(row.aggregate_type, "workflow_events.aggregate_type");
  const aggregateId = stringValue(row.aggregate_id, "workflow_events.aggregate_id");
  let aggregate: EventContracts.WorkflowAggregate;
  if (aggregateType === "WORKFLOW") {
    aggregate = { aggregateType, aggregateId, taskId: null, attemptId: null };
  } else if (aggregateType === "TASK") {
    aggregate = {
      aggregateType,
      aggregateId,
      taskId: stringValue(row.task_id, "workflow_events.task_id"),
      attemptId: null,
    };
  } else if (aggregateType === "ATTEMPT") {
    aggregate = {
      aggregateType,
      aggregateId,
      taskId: stringValue(row.task_id, "workflow_events.task_id"),
      attemptId: stringValue(row.attempt_id, "workflow_events.attempt_id"),
    };
  } else {
    throw new TypeError(`unsupported workflow aggregate ${aggregateType}`);
  }
  return {
    eventId: stringValue(row.id, "workflow_events.id"),
    workspaceId: stringValue(row.workspace_id, "workflow_events.workspace_id"),
    workflowInstanceId: stringValue(
      row.workflow_instance_id,
      "workflow_events.workflow_instance_id",
    ),
    aggregate,
    sequence: numberValue(row.sequence, "workflow_events.sequence"),
    kind: stringValue(row.kind, "workflow_events.kind") as EventContracts.WorkflowEventKind,
    payloadContractName: stringValue(
      row.payload_contract_name,
      "workflow_events.payload_contract_name",
    ),
    payloadContractVersion: stringValue(
      row.payload_contract_version,
      "workflow_events.payload_contract_version",
    ),
    payloadHash: stringValue(row.payload_hash, "workflow_events.payload_hash") as Sha256,
    payload: jsonObject(row.payload, "workflow_events.payload"),
    occurredAt: timestamp(row.occurred_at, "workflow_events.occurred_at"),
    createdAt: timestamp(row.created_at, "workflow_events.created_at"),
  };
}

async function loadTask(
  executor: SqlExecutor,
  workspaceId: string,
  taskId: string,
): Promise<ExecutionContracts.GenerationTaskRecord | null> {
  const row = await one(
    executor,
    "SELECT * FROM generation_tasks WHERE workspace_id = $1 AND id = $2",
    [workspaceId, taskId],
  );
  return row === null ? null : mapTask(row);
}

async function loadAttempt(
  executor: SqlExecutor,
  workspaceId: string,
  attemptId: string,
): Promise<ExecutionContracts.AttemptRecord | null> {
  const row = await one(executor, "SELECT * FROM attempts WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    attemptId,
  ]);
  return row === null ? null : mapAttempt(row);
}

async function loadOutbox(
  executor: SqlExecutor,
  workspaceId: string,
  outboxId: string,
): Promise<ExecutionContracts.OutboxRecord | null> {
  const row = await one(executor, "SELECT * FROM outbox WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    outboxId,
  ]);
  return row === null ? null : mapOutbox(row);
}

function mapIdentity(row: Row): IdentityContracts.UserIdentity {
  return {
    userId: stringValue(row.user_id, "users.id"),
    normalizedEmail: stringValue(row.normalized_email, "users.normalized_email"),
    displayName: stringValue(row.display_name, "users.display_name"),
    status: stringValue(row.user_status, "users.status") as IdentityContracts.UserStatus,
  };
}

function mapMembership(row: Row): IdentityContracts.WorkspaceMembership {
  return {
    membershipId: stringValue(row.membership_id, "memberships.id"),
    workspaceId: stringValue(row.workspace_id, "memberships.workspace_id"),
    userId: stringValue(row.user_id, "memberships.user_id"),
    normalizedName: stringValue(row.normalized_name, "memberships.normalized_name"),
    role: stringValue(row.role, "memberships.role") as IdentityContracts.MembershipRole,
    status: stringValue(
      row.membership_status,
      "memberships.status",
    ) as IdentityContracts.MembershipStatus,
    version: numberValue(row.version, "memberships.version"),
    createdAt: timestamp(row.created_at, "memberships.created_at"),
    updatedAt: timestamp(row.updated_at, "memberships.updated_at"),
  };
}

function authorizationFromRow(row: Row): IdentityContracts.WorkspaceAuthorization {
  const identity = mapIdentity(row);
  const membership = mapMembership(row);
  if (identity.status === "DISABLED") {
    return {
      identity: { ...identity, status: "DISABLED" },
      membership,
      authorized: false,
      reason: "USER_DISABLED",
    };
  }
  const activeIdentity = { ...identity, status: "ACTIVE" } as const;
  switch (membership.status) {
    case "ACTIVE":
      return {
        identity: activeIdentity,
        membership: { ...membership, status: "ACTIVE" },
        authorized: true,
        reason: "ACTIVE_MEMBER",
      };
    case "INVITED":
      return {
        identity: activeIdentity,
        membership: { ...membership, status: "INVITED" },
        authorized: false,
        reason: "INVITED",
      };
    case "SUSPENDED":
      return {
        identity: activeIdentity,
        membership: { ...membership, status: "SUSPENDED" },
        authorized: false,
        reason: "MEMBERSHIP_SUSPENDED",
      };
    case "ARCHIVED":
      return {
        identity: activeIdentity,
        membership: { ...membership, status: "ARCHIVED" },
        authorized: false,
        reason: "MEMBERSHIP_ARCHIVED",
      };
  }
}

function createIdentityRepository(
  context: RepositoryContext,
): IdentityContracts.IdentityRepository {
  const joinedQuery = `SELECT
      membership.id AS membership_id, membership.workspace_id, membership.user_id,
      membership.normalized_name, membership.role, membership.status AS membership_status,
      membership.version, membership.created_at, membership.updated_at,
      identity.normalized_email, identity.display_name, identity.status AS user_status
    FROM memberships membership
    JOIN users identity ON identity.id = membership.user_id`;
  return {
    async findMembership(scope, lookup) {
      const row = await one(
        context.executor,
        `${joinedQuery} WHERE membership.workspace_id = $1 AND membership.user_id = $2`,
        [scope.workspaceId, lookup.userId],
      );
      return row === null ? missing("MEMBERSHIP", lookup.userId) : success(mapMembership(row));
    },
    async findAuthentication(scope, lookup) {
      const row = await one(
        context.executor,
        `${joinedQuery} WHERE membership.workspace_id = $1 AND identity.normalized_email = $2`,
        [scope.workspaceId, lookup.normalizedEmail],
      );
      return row === null
        ? missing("USER", lookup.normalizedEmail)
        : success(authorizationFromRow(row));
    },
    async authorizeMembership(scope, lookup) {
      const row = await one(
        context.executor,
        `${joinedQuery} WHERE membership.workspace_id = $1 AND membership.user_id = $2`,
        [scope.workspaceId, lookup.userId],
      );
      return row === null
        ? missing("MEMBERSHIP", lookup.userId)
        : success(authorizationFromRow(row));
    },
  };
}

function mapArtifact(row: Row): ArtifactContracts.ArtifactMetadata {
  return {
    assetId: stringValue(row.id, "assets.id"),
    workspaceId: stringValue(row.workspace_id, "assets.workspace_id"),
    projectId: nullableString(row.project_id, "assets.project_id"),
    projectRevisionId: nullableString(row.project_revision_id, "assets.project_revision_id"),
    sourceAttemptId: nullableString(row.source_attempt_id, "assets.source_attempt_id"),
    kind: stringValue(row.kind, "assets.kind") as ArtifactContracts.ArtifactKind,
    state: stringValue(row.state, "assets.state") as ArtifactContracts.ArtifactState,
    objectKey: nullableString(row.object_key, "assets.object_key"),
    binarySha256: nullableString(row.binary_sha256, "assets.binary_sha256") as Sha256 | null,
    canonicalContractName: nullableString(
      row.canonical_contract_name,
      "assets.canonical_contract_name",
    ),
    canonicalContractVersion: nullableString(
      row.canonical_contract_version,
      "assets.canonical_contract_version",
    ),
    canonicalDocumentSha256: nullableString(
      row.canonical_document_sha256,
      "assets.canonical_document_sha256",
    ) as Sha256 | null,
    contentType: nullableString(row.content_type, "assets.content_type"),
    byteSize: nullableBigint(row.byte_size, "assets.byte_size"),
    widthPx: row.width_px === null ? null : numberValue(row.width_px, "assets.width_px"),
    heightPx: row.height_px === null ? null : numberValue(row.height_px, "assets.height_px"),
    durationMs: nullableBigint(row.duration_ms, "assets.duration_ms"),
    metadata: jsonObject(row.metadata, "assets.metadata"),
    createdAt: timestamp(row.created_at, "assets.created_at"),
    verifiedAt: nullableTimestamp(row.verified_at, "assets.verified_at"),
    archivedAt: nullableTimestamp(row.archived_at, "assets.archived_at"),
  };
}

async function findArtifact(
  executor: SqlExecutor,
  workspaceId: string,
  assetId: string,
): Promise<ArtifactContracts.ArtifactMetadata | null> {
  const row = await one(executor, "SELECT * FROM assets WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    assetId,
  ]);
  return row === null ? null : mapArtifact(row);
}

function createArtifactRepository(
  context: RepositoryContext,
): ArtifactContracts.ArtifactRepository {
  return {
    async registerMetadata(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findArtifact(executor, scope.workspaceId, command.assetId);
        if (existing !== null) {
          const expected = {
            assetId: command.assetId,
            workspaceId: scope.workspaceId,
            projectId: command.projectId,
            projectRevisionId: command.projectRevisionId,
            sourceAttemptId: command.sourceAttemptId,
            kind: command.kind,
            objectKey: command.objectKey,
            contentType: command.contentType,
            metadata: command.metadata,
          };
          const actual = {
            assetId: existing.assetId,
            workspaceId: existing.workspaceId,
            projectId: existing.projectId,
            projectRevisionId: existing.projectRevisionId,
            sourceAttemptId: existing.sourceAttemptId,
            kind: existing.kind,
            objectKey: existing.objectKey,
            contentType: existing.contentType,
            metadata: existing.metadata,
          };
          return sameValue(actual, expected)
            ? write(existing, true)
            : conflict(
                "IDEMPOTENCY_KEY_REUSED",
                "artifact identity was reused with different metadata",
              );
        }
        await executor.query(
          `INSERT INTO assets (
             id, workspace_id, project_id, project_revision_id, source_attempt_id,
             kind, state, object_key, content_type, metadata
           ) VALUES ($1, $2, $3, $4, $5, $6, 'UPLOADING', $7, $8, $9::jsonb)`,
          [
            command.assetId,
            scope.workspaceId,
            command.projectId,
            command.projectRevisionId,
            command.sourceAttemptId,
            command.kind,
            command.objectKey,
            command.contentType,
            jsonParameter(command.metadata),
          ],
        );
        const inserted = await findArtifact(executor, scope.workspaceId, command.assetId);
        if (inserted === null) throw new Error("inserted artifact disappeared");
        return write(inserted);
      });
    },
    async bindBinaryContent(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findArtifact(executor, scope.workspaceId, command.assetId);
        if (existing === null) return missing("ASSET", command.assetId);
        if (existing.state === "ARCHIVED") {
          return invariant("ARTIFACT_NOT_VERIFIABLE", "archived artifacts cannot be rebound");
        }
        if (existing.binarySha256 !== null) {
          const exact =
            existing.binarySha256 === command.binarySha256 &&
            existing.byteSize === command.byteSize &&
            existing.contentType === command.contentType &&
            existing.widthPx === command.widthPx &&
            existing.heightPx === command.heightPx &&
            existing.durationMs === command.durationMs &&
            existing.verifiedAt === command.verifiedAt;
          return exact
            ? write(existing, true)
            : invariant(
                "ARTIFACT_ALREADY_BOUND",
                "artifact binary content is immutable once bound",
              );
        }
        await executor.query(
          `UPDATE assets SET state = 'VERIFIED', binary_sha256 = $3, byte_size = $4,
             content_type = $5, width_px = $6, height_px = $7, duration_ms = $8, verified_at = $9
           WHERE workspace_id = $1 AND id = $2`,
          [
            scope.workspaceId,
            command.assetId,
            command.binarySha256,
            command.byteSize,
            command.contentType,
            command.widthPx,
            command.heightPx,
            command.durationMs,
            command.verifiedAt,
          ],
        );
        const updated = await findArtifact(executor, scope.workspaceId, command.assetId);
        if (updated === null) throw new Error("bound artifact disappeared");
        return write(updated);
      });
    },
    async bindCanonicalDocument(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findArtifact(executor, scope.workspaceId, command.assetId);
        if (existing === null) return missing("ASSET", command.assetId);
        if (existing.canonicalDocumentSha256 !== null) {
          const exact =
            existing.canonicalContractName === command.contractName &&
            existing.canonicalContractVersion === command.contractVersion &&
            existing.canonicalDocumentSha256 === command.canonicalDocumentSha256 &&
            existing.binarySha256 === command.binarySha256 &&
            existing.byteSize === command.byteSize &&
            existing.verifiedAt === command.verifiedAt;
          return exact
            ? write(existing, true)
            : invariant("ARTIFACT_ALREADY_BOUND", "canonical document binding is immutable");
        }
        if (
          existing.binarySha256 !== null &&
          command.binarySha256 !== null &&
          existing.binarySha256 !== command.binarySha256
        ) {
          return invariant("CONTENT_ADDRESS_MISMATCH", "binary content hash does not match");
        }
        await executor.query(
          `UPDATE assets SET state = 'VERIFIED', canonical_contract_name = $3,
             canonical_contract_version = $4, canonical_document_sha256 = $5,
             binary_sha256 = COALESCE(binary_sha256, $6), byte_size = $7, verified_at = $8
           WHERE workspace_id = $1 AND id = $2`,
          [
            scope.workspaceId,
            command.assetId,
            command.contractName,
            command.contractVersion,
            command.canonicalDocumentSha256,
            command.binarySha256,
            command.byteSize,
            command.verifiedAt,
          ],
        );
        const updated = await findArtifact(executor, scope.workspaceId, command.assetId);
        if (updated === null) throw new Error("bound canonical artifact disappeared");
        return write(updated);
      });
    },
    async resolveExact(scope, assetId) {
      const artifact = await findArtifact(context.executor, scope.workspaceId, assetId);
      return artifact === null ? missing("ASSET", assetId) : success(artifact);
    },
    async findByContentAddress(scope, lookup) {
      const result =
        lookup.kind === "BINARY"
          ? await context.executor.query<Row>(
              "SELECT * FROM assets WHERE workspace_id = $1 AND binary_sha256 = $2 ORDER BY id",
              [scope.workspaceId, lookup.sha256],
            )
          : await context.executor.query<Row>(
              `SELECT * FROM assets WHERE workspace_id = $1 AND canonical_contract_name = $2
                 AND canonical_contract_version = $3 AND canonical_document_sha256 = $4 ORDER BY id`,
              [scope.workspaceId, lookup.contractName, lookup.contractVersion, lookup.sha256],
            );
      return success(result.rows.map(mapArtifact));
    },
    async archive(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findArtifact(executor, scope.workspaceId, command.assetId);
        if (existing === null) return missing("ASSET", command.assetId);
        if (existing.state === "ARCHIVED") {
          return existing.archivedAt === command.archivedAt
            ? write(existing, true)
            : conflict("STATE_CONFLICT", "artifact is already archived");
        }
        await executor.query(
          "UPDATE assets SET state = 'ARCHIVED', archived_at = $3 WHERE workspace_id = $1 AND id = $2",
          [scope.workspaceId, command.assetId, command.archivedAt],
        );
        const updated = await findArtifact(executor, scope.workspaceId, command.assetId);
        if (updated === null) throw new Error("archived artifact disappeared");
        return write(updated);
      });
    },
  };
}

function mapProject(row: Row): ProjectContracts.ProjectShell {
  return {
    projectId: stringValue(row.id, "projects.id"),
    workspaceId: stringValue(row.workspace_id, "projects.workspace_id"),
    ownerUserId: stringValue(row.owner_user_id, "projects.owner_user_id"),
    name: stringValue(row.name, "projects.name"),
    normalizedName: stringValue(row.normalized_name, "projects.normalized_name"),
    status: stringValue(row.status, "projects.status") as ProjectContracts.ProjectStatus,
    version: numberValue(row.version, "projects.version"),
    createdAt: timestamp(row.created_at, "projects.created_at"),
    updatedAt: timestamp(row.updated_at, "projects.updated_at"),
    archivedAt: nullableTimestamp(row.archived_at, "projects.archived_at"),
  };
}

function mapProjectInput(row: Row): ProjectContracts.ProjectInput {
  return {
    inputId: stringValue(row.id, "project_inputs.id"),
    workspaceId: stringValue(row.workspace_id, "project_inputs.workspace_id"),
    projectId: stringValue(row.project_id, "project_inputs.project_id"),
    kind: stringValue(row.kind, "project_inputs.kind") as ProjectContracts.ProjectInputKind,
    state: stringValue(row.state, "project_inputs.state") as ProjectContracts.ProjectInputState,
    assetId: nullableString(row.asset_id, "project_inputs.asset_id"),
    declaredBinarySha256: nullableString(
      row.declared_binary_sha256,
      "project_inputs.declared_binary_sha256",
    ) as Sha256 | null,
    verifiedBinarySha256: nullableString(
      row.verified_binary_sha256,
      "project_inputs.verified_binary_sha256",
    ) as Sha256 | null,
    optionalScript: nullableString(row.optional_script, "project_inputs.optional_script"),
    createdAt: timestamp(row.created_at, "project_inputs.created_at"),
    updatedAt: timestamp(row.updated_at, "project_inputs.updated_at"),
    verifiedAt: nullableTimestamp(row.verified_at, "project_inputs.verified_at"),
    archivedAt: nullableTimestamp(row.archived_at, "project_inputs.archived_at"),
  };
}

function mapProjectRevision(row: Row): ProjectContracts.ProjectRevision {
  const compatibilityState = stringValue(
    row.avatar_compatibility_state,
    "project_revisions.avatar_compatibility_state",
  ) as ProjectContracts.AvatarCompatibilitySnapshot["state"];
  const avatarCompatibility: ProjectContracts.AvatarCompatibilitySnapshot =
    compatibilityState === "UNTESTED" || compatibilityState === "RUNNING"
      ? { state: compatibilityState, assessmentId: null, evidenceHash: null }
      : {
          state: compatibilityState,
          assessmentId: stringValue(
            row.avatar_compatibility_assessment_id,
            "project_revisions.avatar_compatibility_assessment_id",
          ),
          evidenceHash: stringValue(
            row.avatar_compatibility_evidence_hash,
            "project_revisions.avatar_compatibility_evidence_hash",
          ) as Sha256,
        };
  const base: ProjectContracts.ProjectRevisionBase = {
    revisionId: stringValue(row.id, "project_revisions.id"),
    workspaceId: stringValue(row.workspace_id, "project_revisions.workspace_id"),
    projectId: stringValue(row.project_id, "project_revisions.project_id"),
    revisionNumber: numberValue(row.revision_number, "project_revisions.revision_number"),
    title: stringValue(row.title, "project_revisions.title"),
    voiceoverAssetId: stringValue(row.voiceover_asset_id, "project_revisions.voiceover_asset_id"),
    voiceoverBinarySha256: stringValue(
      row.voiceover_binary_sha256,
      "project_revisions.voiceover_binary_sha256",
    ) as Sha256,
    avatarProfileId: stringValue(row.avatar_profile_id, "project_revisions.avatar_profile_id"),
    avatarProfileVersionId: stringValue(
      row.avatar_profile_version_id,
      "project_revisions.avatar_profile_version_id",
    ),
    avatarProfileHash: stringValue(
      row.avatar_profile_hash,
      "project_revisions.avatar_profile_hash",
    ) as Sha256,
    avatarRuntimeSourceAssetId: stringValue(
      row.avatar_runtime_source_asset_id,
      "project_revisions.avatar_runtime_source_asset_id",
    ),
    avatarRuntimeSourceBinarySha256: stringValue(
      row.avatar_runtime_source_binary_sha256,
      "project_revisions.avatar_runtime_source_binary_sha256",
    ) as Sha256,
    avatarSourcePreparationProfile: stringValue(
      row.avatar_source_preparation_profile,
      "project_revisions.avatar_source_preparation_profile",
    ),
    avatarSourceValidationProfile: stringValue(
      row.avatar_source_validation_profile,
      "project_revisions.avatar_source_validation_profile",
    ),
    avatarCompatibility,
    imageStyleId: stringValue(row.image_style_id, "project_revisions.image_style_id"),
    imageStyleVersionId: stringValue(
      row.image_style_version_id,
      "project_revisions.image_style_version_id",
    ),
    styleProfileHash: stringValue(
      row.style_profile_hash,
      "project_revisions.style_profile_hash",
    ) as Sha256,
    extraPromptKeywords: nullableString(
      row.extra_prompt_keywords,
      "project_revisions.extra_prompt_keywords",
    ),
    applyExtraPromptKeywords: booleanValue(
      row.apply_extra_prompt_keywords,
      "project_revisions.apply_extra_prompt_keywords",
    ),
    generationMode: stringValue(
      row.generation_mode,
      "project_revisions.generation_mode",
    ) as ProjectContracts.GenerationMode,
    maximumCostMicroUsd: bigintValue(
      row.maximum_cost_micro_usd,
      "project_revisions.maximum_cost_micro_usd",
    ),
    currency: "USD",
    seed: bigintValue(row.seed, "project_revisions.seed"),
    revisionConfig: {
      contractName: stringValue(
        row.revision_config_contract_name,
        "project_revisions.revision_config_contract_name",
      ),
      contractVersion: stringValue(
        row.revision_config_contract_version,
        "project_revisions.revision_config_contract_version",
      ),
      payload: jsonObject(row.revision_config_payload, "project_revisions.revision_config_payload"),
      canonicalDocumentSha256: stringValue(
        row.revision_config_hash,
        "project_revisions.revision_config_hash",
      ) as Sha256,
    },
    createdByUserId: stringValue(row.created_by_user_id, "project_revisions.created_by_user_id"),
    createdAt: timestamp(row.created_at, "project_revisions.created_at"),
  };
  const status = stringValue(row.status, "project_revisions.status");
  if (status === "DRAFT") return { ...base, status, lockedAt: null };
  if (status === "LOCKED") {
    return {
      ...base,
      status,
      lockedAt: timestamp(row.locked_at, "project_revisions.locked_at"),
    };
  }
  throw new TypeError(`unsupported project revision status ${status}`);
}

async function findProject(
  executor: SqlExecutor,
  workspaceId: string,
  projectId: string,
): Promise<ProjectContracts.ProjectShell | null> {
  const row = await one(executor, "SELECT * FROM projects WHERE workspace_id = $1 AND id = $2", [
    workspaceId,
    projectId,
  ]);
  return row === null ? null : mapProject(row);
}

async function findProjectRevision(
  executor: SqlExecutor,
  workspaceId: string,
  projectId: string,
  revisionId: string,
): Promise<ProjectContracts.ProjectRevision | null> {
  const row = await one(
    executor,
    "SELECT * FROM project_revisions WHERE workspace_id = $1 AND project_id = $2 AND id = $3",
    [workspaceId, projectId, revisionId],
  );
  return row === null ? null : mapProjectRevision(row);
}

function createProjectRepository(context: RepositoryContext): ProjectContracts.ProjectRepository {
  return {
    async createShell(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findProject(executor, scope.workspaceId, command.projectId);
        if (existing !== null) {
          return existing.ownerUserId === scope.actorUserId &&
            existing.name === command.name &&
            existing.normalizedName === command.normalizedName
            ? write(existing, true)
            : conflict(
                "IDEMPOTENCY_KEY_REUSED",
                "project identity was reused with different input",
              );
        }
        await executor.query(
          `INSERT INTO projects (id, workspace_id, owner_user_id, name, normalized_name)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            command.projectId,
            scope.workspaceId,
            scope.actorUserId,
            command.name,
            command.normalizedName,
          ],
        );
        const inserted = await findProject(executor, scope.workspaceId, command.projectId);
        if (inserted === null) throw new Error("inserted project disappeared");
        return write(inserted);
      });
    },
    async registerInput(scope, command) {
      return context.atomic.run(async (executor) => {
        const project = await findProject(executor, scope.workspaceId, command.projectId);
        if (project === null) return missing("PROJECT", command.projectId);
        if (project.status === "ARCHIVED") {
          return invariant("PROJECT_ARCHIVED", "archived projects reject new inputs");
        }
        const existingRow = await one(
          executor,
          "SELECT * FROM project_inputs WHERE workspace_id = $1 AND idempotency_key = $2",
          [scope.workspaceId, command.idempotencyKey],
        );
        if (existingRow !== null) {
          const existing = mapProjectInput(existingRow);
          const exact =
            existing.inputId === command.inputId &&
            existing.projectId === command.projectId &&
            existing.kind === command.kind &&
            existing.declaredBinarySha256 === command.declaredBinarySha256 &&
            existing.optionalScript === command.optionalScript;
          return exact
            ? write(existing, true)
            : conflict("IDEMPOTENCY_KEY_REUSED", "project input retry key changed input");
        }
        await executor.query(
          `INSERT INTO project_inputs (
             id, workspace_id, project_id, kind, state, idempotency_key,
             declared_binary_sha256, optional_script
           ) VALUES ($1, $2, $3, $4, 'PENDING_UPLOAD', $5, $6, $7)`,
          [
            command.inputId,
            scope.workspaceId,
            command.projectId,
            command.kind,
            command.idempotencyKey,
            command.declaredBinarySha256,
            command.optionalScript,
          ],
        );
        const inserted = await one(
          executor,
          "SELECT * FROM project_inputs WHERE workspace_id = $1 AND id = $2",
          [scope.workspaceId, command.inputId],
        );
        if (inserted === null) throw new Error("inserted project input disappeared");
        return write(mapProjectInput(inserted));
      });
    },
    async verifyInput(scope, command) {
      return context.atomic.run(async (executor) => {
        const row = await one(
          executor,
          "SELECT * FROM project_inputs WHERE workspace_id = $1 AND project_id = $2 AND id = $3",
          [scope.workspaceId, command.projectId, command.inputId],
        );
        if (row === null) return missing("PROJECT_INPUT", command.inputId);
        const input = mapProjectInput(row);
        if (input.state === "VERIFIED") {
          const exact =
            input.assetId === command.assetId &&
            input.verifiedBinarySha256 === command.verifiedBinarySha256 &&
            input.verifiedAt === command.verifiedAt;
          return exact
            ? write(input as ProjectContracts.VerifiedProjectInput, true)
            : conflict("STATE_CONFLICT", "project input is already verified with another asset");
        }
        const artifact = await findArtifact(executor, scope.workspaceId, command.assetId);
        if (artifact === null) return missing("ASSET", command.assetId);
        if (
          artifact.binarySha256 !== command.verifiedBinarySha256 ||
          (artifact.state !== "VERIFIED" && artifact.state !== "ACCEPTED")
        ) {
          return invariant("SNAPSHOT_MISMATCH", "verified input does not match artifact content");
        }
        await executor.query(
          `UPDATE project_inputs SET state = 'VERIFIED', asset_id = $4,
             verified_binary_sha256 = $5, verified_at = $6, updated_at = $6
           WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            command.projectId,
            command.inputId,
            command.assetId,
            command.verifiedBinarySha256,
            command.verifiedAt,
          ],
        );
        const updated = await one(
          executor,
          "SELECT * FROM project_inputs WHERE workspace_id = $1 AND id = $2",
          [scope.workspaceId, command.inputId],
        );
        if (updated === null) throw new Error("verified project input disappeared");
        return write(mapProjectInput(updated) as ProjectContracts.VerifiedProjectInput);
      });
    },
    async createRevisionDraft(scope, command) {
      return context.atomic.run(async (executor) => {
        const project = await findProject(executor, scope.workspaceId, command.projectId);
        if (project === null) return missing("PROJECT", command.projectId);
        if (project.status === "ARCHIVED") {
          return invariant("PROJECT_ARCHIVED", "archived projects reject new revisions");
        }
        if (project.version !== command.expectedProjectVersion) {
          return conflict(
            "EXPECTED_VERSION_MISMATCH",
            "project version changed before revision creation",
            project.version,
          );
        }
        const existing = await findProjectRevision(
          executor,
          scope.workspaceId,
          command.projectId,
          command.revisionId,
        );
        if (existing !== null) {
          return sameValue(
            {
              ...existing,
              revisionId: undefined,
              workspaceId: undefined,
              projectId: undefined,
              revisionNumber: undefined,
              createdByUserId: undefined,
              createdAt: undefined,
              status: undefined,
              lockedAt: undefined,
            },
            {
              ...command,
              idempotencyKey: undefined,
              revisionId: undefined,
              projectId: undefined,
              revisionNumber: undefined,
              expectedProjectVersion: undefined,
            },
          )
            ? write(existing as ProjectContracts.DraftProjectRevision, true)
            : conflict("PROJECT_REVISION_EXISTS", "revision identity already exists");
        }
        await executor.query(
          `INSERT INTO project_revisions (
             id, workspace_id, project_id, revision_number, status, title,
             voiceover_asset_id, voiceover_binary_sha256,
             avatar_profile_id, avatar_profile_version_id, avatar_profile_hash,
             avatar_runtime_source_asset_id, avatar_runtime_source_binary_sha256,
             avatar_source_preparation_profile, avatar_source_validation_profile,
             avatar_compatibility_state, avatar_compatibility_assessment_id,
             avatar_compatibility_evidence_hash,
             image_style_id, image_style_version_id, style_profile_hash,
             extra_prompt_keywords, apply_extra_prompt_keywords, generation_mode,
             maximum_cost_micro_usd, currency, seed,
             revision_config_contract_name, revision_config_contract_version,
             revision_config_payload, revision_config_hash, created_by_user_id
           ) VALUES (
             $1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, 'USD', $25,
             $26, $27, $28::jsonb, $29, $30
           )`,
          [
            command.revisionId,
            scope.workspaceId,
            command.projectId,
            command.revisionNumber,
            command.title,
            command.voiceoverAssetId,
            command.voiceoverBinarySha256,
            command.avatarProfileId,
            command.avatarProfileVersionId,
            command.avatarProfileHash,
            command.avatarRuntimeSourceAssetId,
            command.avatarRuntimeSourceBinarySha256,
            command.avatarSourcePreparationProfile,
            command.avatarSourceValidationProfile,
            command.avatarCompatibility.state,
            command.avatarCompatibility.assessmentId,
            command.avatarCompatibility.evidenceHash,
            command.imageStyleId,
            command.imageStyleVersionId,
            command.styleProfileHash,
            command.extraPromptKeywords,
            command.applyExtraPromptKeywords,
            command.generationMode,
            command.maximumCostMicroUsd,
            command.seed,
            command.revisionConfig.contractName,
            command.revisionConfig.contractVersion,
            jsonParameter(command.revisionConfig.payload),
            command.revisionConfig.canonicalDocumentSha256,
            scope.actorUserId,
          ],
        );
        const inserted = await findProjectRevision(
          executor,
          scope.workspaceId,
          command.projectId,
          command.revisionId,
        );
        if (inserted === null || inserted.status !== "DRAFT") {
          throw new Error("inserted project revision draft disappeared");
        }
        return write(inserted);
      });
    },
    async lockRevision(scope, command) {
      return context.atomic.run(async (executor) => {
        const project = await findProject(executor, scope.workspaceId, command.projectId);
        if (project === null) return missing("PROJECT", command.projectId);
        const revision = await findProjectRevision(
          executor,
          scope.workspaceId,
          command.projectId,
          command.revisionId,
        );
        if (revision === null) return missing("PROJECT_REVISION", command.revisionId);
        if (revision.status === "LOCKED") {
          return conflict("PROJECT_REVISION_LOCKED", "locked revisions are immutable");
        }
        if (project.version !== command.expectedProjectVersion) {
          return conflict(
            "EXPECTED_VERSION_MISMATCH",
            "project version changed before revision lock",
            project.version,
          );
        }
        if (
          revision.revisionConfig.canonicalDocumentSha256 !== command.expectedRevisionConfigHash
        ) {
          return invariant(
            "REVISION_SNAPSHOT_MISMATCH",
            "revision config hash changed before lock",
          );
        }
        const voiceover = await findArtifact(
          executor,
          scope.workspaceId,
          revision.voiceoverAssetId,
        );
        const avatar = await one(
          executor,
          `SELECT version.* FROM avatar_profile_versions version
           WHERE version.workspace_id = $1 AND version.profile_id = $2 AND version.id = $3`,
          [scope.workspaceId, revision.avatarProfileId, revision.avatarProfileVersionId],
        );
        const style = await one(
          executor,
          `SELECT version.* FROM image_style_versions version
           WHERE version.workspace_id = $1 AND version.style_id = $2 AND version.id = $3`,
          [scope.workspaceId, revision.imageStyleId, revision.imageStyleVersionId],
        );
        if (
          voiceover === null ||
          voiceover.binarySha256 !== revision.voiceoverBinarySha256 ||
          (voiceover.state !== "VERIFIED" && voiceover.state !== "ACCEPTED") ||
          avatar === null ||
          avatar.state !== "READY" ||
          avatar.profile_hash !== revision.avatarProfileHash ||
          avatar.runtime_source_asset_id !== revision.avatarRuntimeSourceAssetId ||
          avatar.runtime_source_binary_sha256 !== revision.avatarRuntimeSourceBinarySha256 ||
          style === null ||
          style.state !== "PUBLISHED" ||
          style.style_profile_hash !== revision.styleProfileHash
        ) {
          return invariant(
            "REVISION_SNAPSHOT_MISMATCH",
            "revision pins do not match immutable sources",
          );
        }
        await executor.query(
          `UPDATE project_revisions SET status = 'LOCKED', locked_at = $4
           WHERE workspace_id = $1 AND project_id = $2 AND id = $3`,
          [scope.workspaceId, command.projectId, command.revisionId, command.lockedAt],
        );
        await executor.query(
          `UPDATE projects SET version = version + 1, updated_at = $3
           WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, command.projectId, command.lockedAt],
        );
        const locked = await findProjectRevision(
          executor,
          scope.workspaceId,
          command.projectId,
          command.revisionId,
        );
        if (locked === null || locked.status !== "LOCKED") {
          throw new Error("locked project revision disappeared");
        }
        return write(locked);
      });
    },
    async resolveExactRevision(scope, lookup) {
      const revision = await findProjectRevision(
        context.executor,
        scope.workspaceId,
        lookup.projectId,
        lookup.revisionId,
      );
      return revision === null ? missing("PROJECT_REVISION", lookup.revisionId) : success(revision);
    },
    async archiveProject(scope, command) {
      return context.atomic.run(async (executor) => {
        const project = await findProject(executor, scope.workspaceId, command.projectId);
        if (project === null) return missing("PROJECT", command.projectId);
        if (project.status === "ARCHIVED") {
          return project.archivedAt === command.archivedAt
            ? write(project, true)
            : conflict("STATE_CONFLICT", "project is already archived");
        }
        if (project.version !== command.expectedVersion) {
          return conflict(
            "EXPECTED_VERSION_MISMATCH",
            "project version changed before archive",
            project.version,
          );
        }
        await executor.query(
          `UPDATE projects SET status = 'ARCHIVED', version = version + 1,
             archived_at = $3, updated_at = $3
           WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, command.projectId, command.archivedAt],
        );
        const archived = await findProject(executor, scope.workspaceId, command.projectId);
        if (archived === null) throw new Error("archived project disappeared");
        return write(archived);
      });
    },
  };
}

function canonicalDocumentFromColumns(
  row: Row,
  prefix: "profile" | "evidence",
): CanonicalDocument | null {
  const contractName = row[`${prefix}_contract_name`];
  if (contractName === null) return null;
  return {
    contractName: stringValue(contractName, `${prefix}_contract_name`),
    contractVersion: stringValue(row[`${prefix}_contract_version`], `${prefix}_contract_version`),
    payload: jsonObject(row[`${prefix}_payload`], `${prefix}_payload`),
    canonicalDocumentSha256: stringValue(
      row[prefix === "profile" ? "profile_hash" : "evidence_hash"],
      `${prefix}_hash`,
    ) as Sha256,
  };
}

function mapAvatarProfile(row: Row): PresetContracts.AvatarProfile {
  return {
    profileId: stringValue(row.id, "avatar_profiles.id"),
    workspaceId: stringValue(row.workspace_id, "avatar_profiles.workspace_id"),
    name: stringValue(row.name, "avatar_profiles.name"),
    normalizedName: stringValue(row.normalized_name, "avatar_profiles.normalized_name"),
    status: stringValue(row.status, "avatar_profiles.status") as PresetContracts.PresetStatus,
    activeVersionId: nullableString(row.active_version_id, "avatar_profiles.active_version_id"),
    thumbnailAssetId: nullableString(row.thumbnail_asset_id, "avatar_profiles.thumbnail_asset_id"),
    createdByUserId: stringValue(row.created_by_user_id, "avatar_profiles.created_by_user_id"),
    createdAt: timestamp(row.created_at, "avatar_profiles.created_at"),
    updatedAt: timestamp(row.updated_at, "avatar_profiles.updated_at"),
    archivedAt: nullableTimestamp(row.archived_at, "avatar_profiles.archived_at"),
  };
}

function mapAvatarVersion(row: Row): PresetContracts.AvatarProfileVersion {
  const state = stringValue(row.state, "avatar_profile_versions.state");
  const base: PresetContracts.AvatarVersionBase = {
    versionId: stringValue(row.id, "avatar_profile_versions.id"),
    workspaceId: stringValue(row.workspace_id, "avatar_profile_versions.workspace_id"),
    profileId: stringValue(row.profile_id, "avatar_profile_versions.profile_id"),
    versionNumber: numberValue(row.version_number, "avatar_profile_versions.version_number"),
    createdAt: timestamp(row.created_at, "avatar_profile_versions.created_at"),
    updatedAt: timestamp(row.updated_at, "avatar_profile_versions.updated_at"),
  };
  if (state === "READY") {
    return {
      ...base,
      state,
      profileDocument: canonicalDocumentFromColumns(row, "profile")!,
      originalAssetId: stringValue(
        row.original_asset_id,
        "avatar_profile_versions.original_asset_id",
      ),
      runtimeSourceAssetId: stringValue(
        row.runtime_source_asset_id,
        "avatar_profile_versions.runtime_source_asset_id",
      ),
      runtimeSourceBinarySha256: stringValue(
        row.runtime_source_binary_sha256,
        "avatar_profile_versions.runtime_source_binary_sha256",
      ) as Sha256,
      sourcePreparationProfile: stringValue(
        row.source_preparation_profile,
        "avatar_profile_versions.source_preparation_profile",
      ),
      sourceValidationProfile: stringValue(
        row.source_validation_profile,
        "avatar_profile_versions.source_validation_profile",
      ),
      rightsAttestedByUserId: stringValue(
        row.rights_attested_by_user_id,
        "avatar_profile_versions.rights_attested_by_user_id",
      ),
      likenessAttestedByUserId: stringValue(
        row.likeness_attested_by_user_id,
        "avatar_profile_versions.likeness_attested_by_user_id",
      ),
      readyAt: timestamp(row.ready_at, "avatar_profile_versions.ready_at"),
    };
  }
  if (state === "ABANDONED") {
    return {
      ...base,
      state,
      abandonedAt: timestamp(row.abandoned_at, "avatar_profile_versions.abandoned_at"),
    };
  }
  return {
    ...base,
    state: state as PresetContracts.AvatarDraftState,
    profileDocument: canonicalDocumentFromColumns(row, "profile"),
    originalAssetId: nullableString(
      row.original_asset_id,
      "avatar_profile_versions.original_asset_id",
    ),
    runtimeSourceAssetId: nullableString(
      row.runtime_source_asset_id,
      "avatar_profile_versions.runtime_source_asset_id",
    ),
    runtimeSourceBinarySha256: nullableString(
      row.runtime_source_binary_sha256,
      "avatar_profile_versions.runtime_source_binary_sha256",
    ) as Sha256 | null,
    sourcePreparationProfile: nullableString(
      row.source_preparation_profile,
      "avatar_profile_versions.source_preparation_profile",
    ),
    sourceValidationProfile: nullableString(
      row.source_validation_profile,
      "avatar_profile_versions.source_validation_profile",
    ),
    rightsAttestedByUserId: nullableString(
      row.rights_attested_by_user_id,
      "avatar_profile_versions.rights_attested_by_user_id",
    ),
    likenessAttestedByUserId: nullableString(
      row.likeness_attested_by_user_id,
      "avatar_profile_versions.likeness_attested_by_user_id",
    ),
  };
}

function mapImageStyle(row: Row): PresetContracts.ImageStyle {
  return {
    styleId: stringValue(row.id, "image_styles.id"),
    workspaceId: stringValue(row.workspace_id, "image_styles.workspace_id"),
    name: stringValue(row.name, "image_styles.name"),
    normalizedName: stringValue(row.normalized_name, "image_styles.normalized_name"),
    status: stringValue(row.status, "image_styles.status") as PresetContracts.PresetStatus,
    activeVersionId: nullableString(row.active_version_id, "image_styles.active_version_id"),
    coverAssetId: nullableString(row.cover_asset_id, "image_styles.cover_asset_id"),
    createdByUserId: stringValue(row.created_by_user_id, "image_styles.created_by_user_id"),
    createdAt: timestamp(row.created_at, "image_styles.created_at"),
    updatedAt: timestamp(row.updated_at, "image_styles.updated_at"),
    archivedAt: nullableTimestamp(row.archived_at, "image_styles.archived_at"),
  };
}

function mapImageStyleVersion(row: Row): PresetContracts.ImageStyleVersion {
  const state = stringValue(row.state, "image_style_versions.state");
  const base: PresetContracts.ImageStyleVersionBase = {
    versionId: stringValue(row.id, "image_style_versions.id"),
    workspaceId: stringValue(row.workspace_id, "image_style_versions.workspace_id"),
    styleId: stringValue(row.style_id, "image_style_versions.style_id"),
    versionNumber: numberValue(row.version_number, "image_style_versions.version_number"),
    createdAt: timestamp(row.created_at, "image_style_versions.created_at"),
    updatedAt: timestamp(row.updated_at, "image_style_versions.updated_at"),
  };
  if (state === "PUBLISHED") {
    return {
      ...base,
      state,
      profileDocument: {
        contractName: stringValue(
          row.profile_contract_name,
          "image_style_versions.profile_contract_name",
        ),
        contractVersion: stringValue(
          row.profile_contract_version,
          "image_style_versions.profile_contract_version",
        ),
        payload: jsonObject(row.profile_payload, "image_style_versions.profile_payload"),
        canonicalDocumentSha256: stringValue(
          row.style_profile_hash,
          "image_style_versions.style_profile_hash",
        ) as Sha256,
      },
      analyzerRequestHash: nullableString(
        row.analyzer_request_hash,
        "image_style_versions.analyzer_request_hash",
      ) as Sha256 | null,
      analyzerModelSnapshot: nullableString(
        row.analyzer_model_snapshot,
        "image_style_versions.analyzer_model_snapshot",
      ),
      disclosureAttestedByUserId: stringValue(
        row.disclosure_attested_by_user_id,
        "image_style_versions.disclosure_attested_by_user_id",
      ),
      publishedAt: timestamp(row.published_at, "image_style_versions.published_at"),
    };
  }
  if (state === "ABANDONED") {
    return {
      ...base,
      state,
      abandonedAt: timestamp(row.abandoned_at, "image_style_versions.abandoned_at"),
    };
  }
  return {
    ...base,
    state: state as PresetContracts.ImageStyleDraftState,
    profileDocument:
      row.profile_contract_name === null
        ? null
        : {
            contractName: stringValue(
              row.profile_contract_name,
              "image_style_versions.profile_contract_name",
            ),
            contractVersion: stringValue(
              row.profile_contract_version,
              "image_style_versions.profile_contract_version",
            ),
            payload: jsonObject(row.profile_payload, "image_style_versions.profile_payload"),
            canonicalDocumentSha256: stringValue(
              row.style_profile_hash,
              "image_style_versions.style_profile_hash",
            ) as Sha256,
          },
    analyzerRequestHash: nullableString(
      row.analyzer_request_hash,
      "image_style_versions.analyzer_request_hash",
    ) as Sha256 | null,
    analyzerModelSnapshot: nullableString(
      row.analyzer_model_snapshot,
      "image_style_versions.analyzer_model_snapshot",
    ),
    disclosureAttestedByUserId: nullableString(
      row.disclosure_attested_by_user_id,
      "image_style_versions.disclosure_attested_by_user_id",
    ),
  };
}

async function findAvatarProfile(
  executor: SqlExecutor,
  workspaceId: string,
  profileId: string,
): Promise<PresetContracts.AvatarProfile | null> {
  const row = await one(
    executor,
    "SELECT * FROM avatar_profiles WHERE workspace_id = $1 AND id = $2",
    [workspaceId, profileId],
  );
  return row === null ? null : mapAvatarProfile(row);
}

async function findAvatarVersion(
  executor: SqlExecutor,
  workspaceId: string,
  profileId: string,
  versionId: string,
): Promise<PresetContracts.AvatarProfileVersion | null> {
  const row = await one(
    executor,
    `SELECT * FROM avatar_profile_versions
     WHERE workspace_id = $1 AND profile_id = $2 AND id = $3`,
    [workspaceId, profileId, versionId],
  );
  return row === null ? null : mapAvatarVersion(row);
}

async function findImageStyle(
  executor: SqlExecutor,
  workspaceId: string,
  styleId: string,
): Promise<PresetContracts.ImageStyle | null> {
  const row = await one(
    executor,
    "SELECT * FROM image_styles WHERE workspace_id = $1 AND id = $2",
    [workspaceId, styleId],
  );
  return row === null ? null : mapImageStyle(row);
}

async function findImageStyleVersion(
  executor: SqlExecutor,
  workspaceId: string,
  styleId: string,
  versionId: string,
): Promise<PresetContracts.ImageStyleVersion | null> {
  const row = await one(
    executor,
    `SELECT * FROM image_style_versions
     WHERE workspace_id = $1 AND style_id = $2 AND id = $3`,
    [workspaceId, styleId, versionId],
  );
  return row === null ? null : mapImageStyleVersion(row);
}

function mapImageStyleReference(row: Row): PresetContracts.ImageStyleReference {
  return {
    referenceId: stringValue(row.id, "image_style_references.id"),
    workspaceId: stringValue(row.workspace_id, "image_style_references.workspace_id"),
    styleId: stringValue(row.style_id, "image_style_references.style_id"),
    versionId: stringValue(row.version_id, "image_style_references.version_id"),
    originalAssetId: stringValue(row.original_asset_id, "image_style_references.original_asset_id"),
    normalizedAssetId: stringValue(
      row.normalized_asset_id,
      "image_style_references.normalized_asset_id",
    ),
    referenceOrder: numberValue(row.reference_order, "image_style_references.reference_order"),
    rightsBasis: stringValue(
      row.rights_basis,
      "image_style_references.rights_basis",
    ) as PresetContracts.ImageStyleReferenceRightsBasis,
    rightsBasisNote: nullableString(
      row.rights_basis_note,
      "image_style_references.rights_basis_note",
    ),
    rightsAttestedByUserId: stringValue(
      row.rights_attested_by_user_id,
      "image_style_references.rights_attested_by_user_id",
    ),
    rightsAttestedAt: timestamp(
      row.rights_attested_at,
      "image_style_references.rights_attested_at",
    ),
    originalRetentionPolicy: stringValue(
      row.original_retention_policy,
      "image_style_references.original_retention_policy",
    ) as PresetContracts.ImageStyleOriginalRetentionPolicy,
    confidence: nullableDecimalNumber(row.confidence, "image_style_references.confidence"),
    isOutlier: booleanValue(row.is_outlier, "image_style_references.is_outlier"),
    retentionState: stringValue(
      row.retention_state,
      "image_style_references.retention_state",
    ) as PresetContracts.ImageStyleReferenceRetentionState,
    createdAt: timestamp(row.created_at, "image_style_references.created_at"),
    deletedAt: nullableTimestamp(row.deleted_at, "image_style_references.deleted_at"),
  };
}

async function findImageStyleReference(
  executor: SqlExecutor,
  workspaceId: string,
  lookup: PresetContracts.ImageStyleReferenceLookup,
): Promise<PresetContracts.ImageStyleReference | null> {
  const row = await one(
    executor,
    `SELECT * FROM image_style_references
     WHERE workspace_id = $1 AND style_id = $2 AND version_id = $3 AND id = $4`,
    [workspaceId, lookup.styleId, lookup.versionId, lookup.referenceId],
  );
  return row === null ? null : mapImageStyleReference(row);
}

const STYLE_REFERENCE_MIME_TYPES = Object.freeze([
  "image/jpeg",
  "image/png",
  "image/webp",
] as const);
const STYLE_REFERENCE_RIGHTS_BASES = Object.freeze([
  "OWNED",
  "LICENSED",
  "PUBLIC_DOMAIN",
  "OTHER_DOCUMENTED_BASIS",
] as const);
const STYLE_REFERENCE_RETENTION_POLICIES = Object.freeze([
  "RETAIN",
  "DELETE_AFTER_ANALYSIS",
] as const);
const MAX_STYLE_REFERENCE_BYTES = 20 * 1024 * 1024;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u;

function imageStyleReferenceCommandProblem(
  command: PresetContracts.AttachImageStyleReferenceCommand,
): string | null {
  const note = command.rightsBasisNote;
  if (
    command.originalAssetId === command.normalizedAssetId ||
    !Number.isSafeInteger(command.referenceOrder) ||
    command.referenceOrder < 1 ||
    command.referenceOrder > 12 ||
    !STYLE_REFERENCE_RIGHTS_BASES.includes(command.rightsBasis) ||
    !STYLE_REFERENCE_RETENTION_POLICIES.includes(command.originalRetentionPolicy) ||
    !UTC_TIMESTAMP.test(command.rightsAttestedAt) ||
    (note !== null && (note !== note.trim() || note.length < 1 || note.length > 1_000)) ||
    (command.rightsBasis === "OTHER_DOCUMENTED_BASIS" && note === null)
  ) {
    return "reference identity, order, rights, retention, or attestation facts are invalid";
  }
  return null;
}

function styleReferenceArtifactProblem(
  artifact: ArtifactContracts.ArtifactMetadata,
  expectedKind: "STYLE_REFERENCE_ORIGINAL" | "STYLE_REFERENCE_NORMALIZED",
): string | null {
  if (artifact.kind !== expectedKind) return `artifact kind must be ${expectedKind}`;
  if (artifact.state !== "VERIFIED" && artifact.state !== "ACCEPTED") {
    return "reference artifacts must be verified or accepted";
  }
  if (
    artifact.binarySha256 === null ||
    artifact.byteSize === null ||
    artifact.byteSize < 1n ||
    artifact.byteSize > BigInt(MAX_STYLE_REFERENCE_BYTES) ||
    artifact.widthPx === null ||
    artifact.heightPx === null ||
    artifact.widthPx < 512 ||
    artifact.heightPx < 512 ||
    artifact.widthPx > 16_384 ||
    artifact.heightPx > 16_384 ||
    artifact.contentType === null ||
    !STYLE_REFERENCE_MIME_TYPES.includes(
      artifact.contentType as (typeof STYLE_REFERENCE_MIME_TYPES)[number],
    ) ||
    artifact.durationMs !== null ||
    artifact.verifiedAt === null
  ) {
    return "reference artifact media facts are incomplete or outside bounds";
  }
  return null;
}

async function imageStyleHasAnalysisAttempt(
  executor: SqlExecutor,
  workspaceId: string,
  versionId: string,
): Promise<boolean> {
  return (
    (await one(
      executor,
      `SELECT id FROM image_style_analysis_attempts
       WHERE workspace_id = $1 AND style_version_id = $2 LIMIT 1`,
      [workspaceId, versionId],
    )) !== null
  );
}

async function resolveImageStyleAnalysisReferenceSetIn(
  executor: SqlExecutor,
  workspaceId: string,
  lookup: PresetContracts.ImageStyleVersionReferenceLookup,
): Promise<
  RepositoryResult<
    readonly PresetContracts.ImageStyleAnalysisReferenceBinding[],
    PresetContracts.ImageStyleConflict,
    PresetContracts.ImageStyleMissing,
    PresetContracts.ImageStyleInvariant
  >
> {
  const version = await findImageStyleVersion(
    executor,
    workspaceId,
    lookup.styleId,
    lookup.versionId,
  );
  if (version === null) return missing("IMAGE_STYLE_VERSION", lookup.versionId);
  const result = await executor.query<Row>(
    `SELECT * FROM image_style_references
     WHERE workspace_id = $1 AND style_id = $2 AND version_id = $3
     ORDER BY reference_order ASC, id ASC`,
    [workspaceId, lookup.styleId, lookup.versionId],
  );
  if (result.rows.length < 3 || result.rows.length > 8) {
    return invariant(
      "IMAGE_STYLE_REFERENCE_SET_INVALID",
      "style analysis requires three to eight durable references",
    );
  }
  const hashes = new Set<string>();
  const bindings: PresetContracts.ImageStyleAnalysisReferenceBinding[] = [];
  for (const [index, row] of result.rows.entries()) {
    const reference = mapImageStyleReference(row);
    if (reference.referenceOrder !== index + 1 || reference.retentionState !== "RETAIN") {
      return invariant(
        "IMAGE_STYLE_REFERENCE_SET_INVALID",
        "analysis references must be contiguous, ordered, and retained",
      );
    }
    const original = await findArtifact(executor, workspaceId, reference.originalAssetId);
    const normalized = await findArtifact(executor, workspaceId, reference.normalizedAssetId);
    if (original === null) return missing("ASSET", reference.originalAssetId);
    if (normalized === null) return missing("ASSET", reference.normalizedAssetId);
    if (
      styleReferenceArtifactProblem(original, "STYLE_REFERENCE_ORIGINAL") !== null ||
      styleReferenceArtifactProblem(normalized, "STYLE_REFERENCE_NORMALIZED") !== null ||
      normalized.binarySha256 === null ||
      normalized.byteSize === null ||
      normalized.contentType === null ||
      normalized.widthPx === null ||
      normalized.heightPx === null ||
      hashes.has(normalized.binarySha256)
    ) {
      return invariant(
        "IMAGE_STYLE_REFERENCE_SET_INVALID",
        "analysis references contain invalid artifacts or duplicate normalized hashes",
      );
    }
    hashes.add(normalized.binarySha256);
    bindings.push(
      Object.freeze({
        referenceId: reference.referenceId,
        normalizedAssetId: reference.normalizedAssetId,
        alias: `ref_${String(index + 1).padStart(2, "0")}`,
        derivativeSha256: normalized.binarySha256,
        mimeType:
          normalized.contentType as PresetContracts.ImageStyleAnalysisReferenceBinding["mimeType"],
        width: normalized.widthPx,
        height: normalized.heightPx,
        bytes: Number(normalized.byteSize),
      }),
    );
  }
  return success(Object.freeze(bindings));
}

function timingHeadVersion(row: Row | null): number {
  return row === null ? 0 : numberValue(row.version, "revision_timing_heads.version");
}

function validateTranscriptTimingCommand(
  command: TimingContracts.PersistTranscriptTimingCommand,
): string | null {
  if (
    !Number.isSafeInteger(command.expectedHeadVersion) ||
    command.expectedHeadVersion < 0 ||
    !Number.isSafeInteger(command.lineageSequence) ||
    command.lineageSequence < 1 ||
    (command.lineageSequence === 1) !== (command.supersedesTranscriptId === null) ||
    !Number.isSafeInteger(command.sourceDurationMs) ||
    command.sourceDurationMs < 10_000 ||
    command.sourceDurationMs > 3_600_000 ||
    command.canonicalDocument.contractName !== "transcript-timing" ||
    command.canonicalDocument.contractVersion !== "v1" ||
    command.words.length < 1 ||
    command.sentences.length < 1 ||
    command.phrases.length < 1
  ) {
    return "transcript lineage metadata is incomplete or outside the canonical envelope";
  }
  const wordIds = new Set<string>();
  let priorWordEndMs = 0;
  for (const [index, word] of command.words.entries()) {
    if (
      wordIds.has(word.wordId) ||
      word.index !== index ||
      !Number.isSafeInteger(word.startMs) ||
      !Number.isSafeInteger(word.endMsExclusive) ||
      word.startMs < 0 ||
      word.startMs < priorWordEndMs ||
      word.endMsExclusive <= word.startMs ||
      word.endMsExclusive > command.sourceDurationMs ||
      word.text.length < 1 ||
      word.text.length > 240 ||
      (word.confidence !== null &&
        (!Number.isFinite(word.confidence) || word.confidence < 0 || word.confidence > 1))
    ) {
      return "transcript words must be unique, contiguous, bounded integer timing facts";
    }
    wordIds.add(word.wordId);
    priorWordEndMs = word.endMsExclusive;
  }
  const sentenceIds = new Set<string>();
  let nextSentenceWord = 0;
  for (const [index, sentence] of command.sentences.entries()) {
    if (
      sentenceIds.has(sentence.sentenceId) ||
      sentence.index !== index ||
      sentence.wordStart !== nextSentenceWord ||
      sentence.wordEndExclusive <= sentence.wordStart ||
      sentence.wordEndExclusive > command.words.length ||
      sentence.startMs !== command.words[sentence.wordStart]?.startMs ||
      sentence.endMsExclusive !== command.words[sentence.wordEndExclusive - 1]?.endMsExclusive ||
      sentence.text.length < 1 ||
      sentence.text.length > 12_000
    ) {
      return "transcript sentences must provide an exact ordered partition of words";
    }
    sentenceIds.add(sentence.sentenceId);
    nextSentenceWord = sentence.wordEndExclusive;
  }
  if (nextSentenceWord !== command.words.length) {
    return "transcript sentences do not cover every word";
  }
  const phraseIds = new Set<string>();
  let nextPhraseWord = 0;
  for (const [index, phrase] of command.phrases.entries()) {
    const sentence = command.sentences.find((item) => item.sentenceId === phrase.sentenceId);
    if (
      phraseIds.has(phrase.phraseId) ||
      sentence === undefined ||
      phrase.index !== index ||
      phrase.wordStart !== nextPhraseWord ||
      phrase.wordEndExclusive <= phrase.wordStart ||
      phrase.wordStart < sentence.wordStart ||
      phrase.wordEndExclusive > sentence.wordEndExclusive ||
      phrase.startMs !== command.words[phrase.wordStart]?.startMs ||
      phrase.endMsExclusive !== command.words[phrase.wordEndExclusive - 1]?.endMsExclusive ||
      !Number.isSafeInteger(phrase.pauseBeforeMs) ||
      !Number.isSafeInteger(phrase.pauseAfterMs) ||
      phrase.pauseBeforeMs < 0 ||
      phrase.pauseAfterMs < 0 ||
      phrase.text.length < 1 ||
      phrase.text.length > 4000
    ) {
      return "transcript phrases must provide an exact ordered partition within sentences";
    }
    phraseIds.add(phrase.phraseId);
    nextPhraseWord = phrase.wordEndExclusive;
  }
  return nextPhraseWord === command.words.length
    ? null
    : "transcript phrases do not cover every word";
}

function avatarSpanTaskKey(segment: TimingContracts.TimelineSegmentRecord): string | null {
  if (
    segment.timelineComposition !== "AVATAR_FULL" &&
    segment.timelineComposition !== "AVATAR_SPLIT_IMAGE"
  ) {
    return null;
  }
  const avatar = segment.requiredSlots.avatar;
  if (typeof avatar !== "object" || avatar === null || Array.isArray(avatar)) return null;
  const value = (avatar as Record<string, unknown>).span_audio_task_key;
  return typeof value === "string" ? value : null;
}

function validateTimelinePlanCommand(
  command: TimingContracts.PersistTimelinePlanCommand,
): string | null {
  if (
    !Number.isSafeInteger(command.expectedHeadVersion) ||
    command.expectedHeadVersion < 1 ||
    !Number.isSafeInteger(command.planSequence) ||
    command.planSequence < 1 ||
    (command.planSequence === 1) !== (command.supersedesTimelinePlanId === null) ||
    command.seed < 0n ||
    command.seed > 4_294_967_295n ||
    command.outputFpsNum !== 30 ||
    command.outputFpsDen !== 1 ||
    !Number.isSafeInteger(command.totalFrames) ||
    command.totalFrames < 1 ||
    command.canonicalDocument.contractName !== "timeline-plan" ||
    command.canonicalDocument.contractVersion !== "v1" ||
    command.segments.length < 1
  ) {
    return "timeline plan metadata is incomplete or outside the canonical envelope";
  }
  const segmentIds = new Set<string>();
  let nextFrame = 0;
  let nextWord = 0;
  for (const [index, segment] of command.segments.entries()) {
    const needsImage =
      segment.timelineComposition === "IMAGE_FULL" ||
      segment.timelineComposition === "AVATAR_SPLIT_IMAGE";
    const spanTaskKey = avatarSpanTaskKey(segment);
    if (
      segmentIds.has(segment.segmentId) ||
      segment.index !== index ||
      segment.startFrame !== nextFrame ||
      segment.endFrameExclusive <= segment.startFrame ||
      segment.endFrameExclusive > command.totalFrames ||
      segment.wordStart !== nextWord ||
      segment.wordEndExclusive <= segment.wordStart ||
      segment.sourceAudioStartMs < 0 ||
      segment.sourceAudioEndMsExclusive <= segment.sourceAudioStartMs ||
      segment.narration.length < 1 ||
      (needsImage ? segment.inImageShotRole === null : segment.inImageShotRole !== null) ||
      ((segment.timelineComposition === "AVATAR_FULL" ||
        segment.timelineComposition === "AVATAR_SPLIT_IMAGE") &&
        spanTaskKey === null)
    ) {
      return "timeline segments must provide exact ordered frame, word, composition, and slot facts";
    }
    segmentIds.add(segment.segmentId);
    nextFrame = segment.endFrameExclusive;
    nextWord = segment.wordEndExclusive;
  }
  if (nextFrame !== command.totalFrames) return "timeline segments do not cover every output frame";
  const avatarSegments = command.segments.filter(
    (segment) =>
      segment.timelineComposition === "AVATAR_FULL" ||
      segment.timelineComposition === "AVATAR_SPLIT_IMAGE",
  );
  if (command.selectedSpanAudio.length !== avatarSegments.length) {
    return "every avatar segment must own exactly one selected span-audio record";
  }
  const spanIds = new Set<string>();
  const spanSegments = new Set<string>();
  for (const span of command.selectedSpanAudio) {
    const segment = avatarSegments.find((item) => item.segmentId === span.timelineSegmentId);
    if (
      segment === undefined ||
      spanIds.has(span.spanId) ||
      spanSegments.has(span.timelineSegmentId) ||
      span.transcriptId !== command.transcriptId ||
      span.taskKey !== avatarSpanTaskKey(segment) ||
      span.selectedStartMs !== segment.sourceAudioStartMs ||
      span.selectedEndMsExclusive !== segment.sourceAudioEndMsExclusive ||
      span.paddedStartMs < 0 ||
      span.paddedStartMs > span.selectedStartMs ||
      span.paddedEndMsExclusive < span.selectedEndMsExclusive ||
      span.trimStartMs !== span.selectedStartMs - span.paddedStartMs ||
      span.trimEndMsExclusive !==
        span.trimStartMs + span.selectedEndMsExclusive - span.selectedStartMs
    ) {
      return "selected span audio does not match its immutable avatar segment ownership";
    }
    spanIds.add(span.spanId);
    spanSegments.add(span.timelineSegmentId);
  }
  return null;
}

async function loadPersistedTranscript(
  executor: SqlExecutor,
  workspaceId: string,
  projectRevisionId: string,
  transcriptId: string,
  headVersion: number,
): Promise<TimingContracts.PersistedTranscriptTiming | null> {
  const row = await one(
    executor,
    `SELECT * FROM public.transcripts
      WHERE workspace_id = $1 AND project_revision_id = $2 AND id = $3
        AND lineage_contract_version = 'timing-lineage/v1'`,
    [workspaceId, projectRevisionId, transcriptId],
  );
  if (row === null) return null;
  const words = await executor.query<Row>(
    `SELECT * FROM public.transcript_words
      WHERE workspace_id = $1 AND transcript_id = $2 ORDER BY word_index`,
    [workspaceId, transcriptId],
  );
  const sentences = await executor.query<Row>(
    `SELECT * FROM public.transcript_sentences
      WHERE workspace_id = $1 AND transcript_id = $2 ORDER BY sentence_index`,
    [workspaceId, transcriptId],
  );
  const phrases = await executor.query<Row>(
    `SELECT * FROM public.transcript_phrases
      WHERE workspace_id = $1 AND transcript_id = $2 ORDER BY phrase_index`,
    [workspaceId, transcriptId],
  );
  return Object.freeze({
    transcriptId: stringValue(row.id, "transcripts.id"),
    projectRevisionId: stringValue(row.project_revision_id, "transcripts.project_revision_id"),
    lineageSequence: numberValue(row.lineage_sequence, "transcripts.lineage_sequence"),
    supersedesTranscriptId: nullableString(
      row.supersedes_transcript_id,
      "transcripts.supersedes_transcript_id",
    ),
    sourceAssetId: stringValue(row.source_asset_id, "transcripts.source_asset_id"),
    sourceBinarySha256: stringValue(
      row.source_binary_sha256,
      "transcripts.source_binary_sha256",
    ) as Sha256,
    sourceDurationMs: numberValue(row.duration_ms, "transcripts.duration_ms"),
    engineName: stringValue(row.engine_name, "transcripts.engine_name"),
    engineVersion: stringValue(row.engine_version, "transcripts.engine_version"),
    modelName: stringValue(row.model_name, "transcripts.model_name"),
    modelSha256: stringValue(row.model_hash, "transcripts.model_hash") as Sha256,
    language: stringValue(row.language, "transcripts.language"),
    transcriptionConfigHash: stringValue(
      row.transcription_config_hash,
      "transcripts.transcription_config_hash",
    ) as Sha256,
    optionalScriptHash: nullableString(
      row.optional_script_hash,
      "transcripts.optional_script_hash",
    ) as Sha256 | null,
    inputFingerprintHash: stringValue(
      row.input_fingerprint_hash,
      "transcripts.input_fingerprint_hash",
    ) as Sha256,
    canonicalDocumentAssetId: stringValue(
      row.canonical_document_asset_id,
      "transcripts.canonical_document_asset_id",
    ),
    canonicalDocument: Object.freeze({
      contractName: stringValue(row.contract_name, "transcripts.contract_name"),
      contractVersion: stringValue(row.contract_version, "transcripts.contract_version"),
      canonicalDocumentSha256: stringValue(
        row.canonical_document_hash,
        "transcripts.canonical_document_hash",
      ) as Sha256,
    }),
    words: Object.freeze(
      words.rows.map((word) =>
        Object.freeze({
          wordId: stringValue(word.id, "transcript_words.id"),
          index: numberValue(word.word_index, "transcript_words.word_index"),
          text: stringValue(word.word, "transcript_words.word"),
          startMs: numberValue(word.start_ms, "transcript_words.start_ms"),
          endMsExclusive: numberValue(word.end_ms_exclusive, "transcript_words.end_ms_exclusive"),
          confidence:
            word.confidence === null
              ? null
              : Number(stringValue(word.confidence, "transcript_words.confidence")),
        }),
      ),
    ),
    sentences: Object.freeze(
      sentences.rows.map((sentence) =>
        Object.freeze({
          sentenceId: stringValue(sentence.id, "transcript_sentences.id"),
          sentenceKey: stringValue(sentence.sentence_key, "transcript_sentences.sentence_key"),
          index: numberValue(sentence.sentence_index, "transcript_sentences.sentence_index"),
          wordStart: numberValue(sentence.word_start, "transcript_sentences.word_start"),
          wordEndExclusive: numberValue(
            sentence.word_end_exclusive,
            "transcript_sentences.word_end_exclusive",
          ),
          startMs: numberValue(sentence.start_ms, "transcript_sentences.start_ms"),
          endMsExclusive: numberValue(
            sentence.end_ms_exclusive,
            "transcript_sentences.end_ms_exclusive",
          ),
          text: stringValue(sentence.text, "transcript_sentences.text"),
        }),
      ),
    ),
    phrases: Object.freeze(
      phrases.rows.map((phrase) =>
        Object.freeze({
          phraseId: stringValue(phrase.id, "transcript_phrases.id"),
          phraseKey: stringValue(phrase.phrase_key, "transcript_phrases.phrase_key"),
          sentenceId: stringValue(phrase.sentence_id, "transcript_phrases.sentence_id"),
          index: numberValue(phrase.phrase_index, "transcript_phrases.phrase_index"),
          wordStart: numberValue(phrase.word_start, "transcript_phrases.word_start"),
          wordEndExclusive: numberValue(
            phrase.word_end_exclusive,
            "transcript_phrases.word_end_exclusive",
          ),
          startMs: numberValue(phrase.start_ms, "transcript_phrases.start_ms"),
          endMsExclusive: numberValue(
            phrase.end_ms_exclusive,
            "transcript_phrases.end_ms_exclusive",
          ),
          pauseBeforeMs: numberValue(phrase.pause_before_ms, "transcript_phrases.pause_before_ms"),
          pauseAfterMs: numberValue(phrase.pause_after_ms, "transcript_phrases.pause_after_ms"),
          text: stringValue(phrase.text, "transcript_phrases.text"),
        }),
      ),
    ),
    headVersion,
    createdAt: timestamp(row.created_at, "transcripts.created_at"),
  });
}

async function loadPersistedTimelinePlan(
  executor: SqlExecutor,
  workspaceId: string,
  projectRevisionId: string,
  timelinePlanId: string,
  headVersion: number,
): Promise<TimingContracts.PersistedTimelinePlan | null> {
  const row = await one(
    executor,
    `SELECT * FROM public.timeline_plans
      WHERE workspace_id = $1 AND project_revision_id = $2 AND id = $3`,
    [workspaceId, projectRevisionId, timelinePlanId],
  );
  if (row === null) return null;
  const segments = await executor.query<Row>(
    `SELECT * FROM public.timeline_segments
      WHERE workspace_id = $1 AND timeline_plan_id = $2 ORDER BY segment_index`,
    [workspaceId, timelinePlanId],
  );
  const spans = await executor.query<Row>(
    `SELECT * FROM public.selected_span_audio
      WHERE workspace_id = $1 AND timeline_plan_id = $2 ORDER BY span_key`,
    [workspaceId, timelinePlanId],
  );
  return Object.freeze({
    timelinePlanId: stringValue(row.id, "timeline_plans.id"),
    projectRevisionId: stringValue(row.project_revision_id, "timeline_plans.project_revision_id"),
    transcriptId: stringValue(row.transcript_id, "timeline_plans.transcript_id"),
    planSequence: numberValue(row.plan_sequence, "timeline_plans.plan_sequence"),
    supersedesTimelinePlanId: nullableString(
      row.supersedes_timeline_plan_id,
      "timeline_plans.supersedes_timeline_plan_id",
    ),
    revisionConfigHash: stringValue(
      row.revision_config_hash,
      "timeline_plans.revision_config_hash",
    ) as Sha256,
    transcriptDocumentHash: stringValue(
      row.transcript_document_hash,
      "timeline_plans.transcript_document_hash",
    ) as Sha256,
    schedulerVersion: stringValue(row.scheduler_version, "timeline_plans.scheduler_version"),
    schedulerConfigHash: stringValue(
      row.scheduler_config_hash,
      "timeline_plans.scheduler_config_hash",
    ) as Sha256,
    seed: bigintValue(row.seed, "timeline_plans.seed"),
    inputFingerprintHash: stringValue(
      row.input_fingerprint_hash,
      "timeline_plans.input_fingerprint_hash",
    ) as Sha256,
    canonicalDocumentAssetId: stringValue(
      row.canonical_document_asset_id,
      "timeline_plans.canonical_document_asset_id",
    ),
    canonicalDocument: Object.freeze({
      contractName: stringValue(row.contract_name, "timeline_plans.contract_name"),
      contractVersion: stringValue(row.contract_version, "timeline_plans.contract_version"),
      canonicalDocumentSha256: stringValue(
        row.canonical_document_hash,
        "timeline_plans.canonical_document_hash",
      ) as Sha256,
    }),
    outputFpsNum: numberValue(row.output_fps_num, "timeline_plans.output_fps_num") as 30,
    outputFpsDen: numberValue(row.output_fps_den, "timeline_plans.output_fps_den") as 1,
    totalFrames: numberValue(row.total_frames, "timeline_plans.total_frames"),
    segments: Object.freeze(
      segments.rows.map((segment) =>
        Object.freeze({
          segmentId: stringValue(segment.id, "timeline_segments.id"),
          segmentKey: stringValue(segment.segment_key, "timeline_segments.segment_key"),
          index: numberValue(segment.segment_index, "timeline_segments.segment_index"),
          startFrame: numberValue(segment.start_frame, "timeline_segments.start_frame"),
          endFrameExclusive: numberValue(
            segment.end_frame_exclusive,
            "timeline_segments.end_frame_exclusive",
          ),
          sourceAudioStartMs: numberValue(
            segment.source_audio_start_ms,
            "timeline_segments.source_audio_start_ms",
          ),
          sourceAudioEndMsExclusive: numberValue(
            segment.source_audio_end_ms_exclusive,
            "timeline_segments.source_audio_end_ms_exclusive",
          ),
          wordStart: numberValue(segment.word_start, "timeline_segments.word_start"),
          wordEndExclusive: numberValue(
            segment.word_end_exclusive,
            "timeline_segments.word_end_exclusive",
          ),
          timelineComposition: stringValue(
            segment.timeline_composition,
            "timeline_segments.timeline_composition",
          ) as TimingContracts.TimelineComposition,
          inImageShotRole: nullableString(
            segment.in_image_shot_role,
            "timeline_segments.in_image_shot_role",
          ) as TimingContracts.InImageShotRole | null,
          narration: stringValue(segment.narration, "timeline_segments.narration"),
          requiredSlots: jsonObject(segment.required_slots, "timeline_segments.required_slots"),
        }),
      ),
    ),
    selectedSpanAudio: Object.freeze(
      spans.rows.map((span) =>
        Object.freeze({
          spanId: stringValue(span.id, "selected_span_audio.id"),
          spanKey: stringValue(span.span_key, "selected_span_audio.span_key"),
          timelineSegmentId: stringValue(
            span.timeline_segment_id,
            "selected_span_audio.timeline_segment_id",
          ),
          transcriptId: stringValue(span.transcript_id, "selected_span_audio.transcript_id"),
          taskKey: stringValue(span.task_key, "selected_span_audio.task_key"),
          sourceAssetId: stringValue(span.source_asset_id, "selected_span_audio.source_asset_id"),
          sourceBinarySha256: stringValue(
            span.source_binary_sha256,
            "selected_span_audio.source_binary_sha256",
          ) as Sha256,
          selectedStartMs: numberValue(
            span.selected_start_ms,
            "selected_span_audio.selected_start_ms",
          ),
          selectedEndMsExclusive: numberValue(
            span.selected_end_ms_exclusive,
            "selected_span_audio.selected_end_ms_exclusive",
          ),
          paddedStartMs: numberValue(span.padded_start_ms, "selected_span_audio.padded_start_ms"),
          paddedEndMsExclusive: numberValue(
            span.padded_end_ms_exclusive,
            "selected_span_audio.padded_end_ms_exclusive",
          ),
          trimStartMs: numberValue(span.trim_start_ms, "selected_span_audio.trim_start_ms"),
          trimEndMsExclusive: numberValue(
            span.trim_end_ms_exclusive,
            "selected_span_audio.trim_end_ms_exclusive",
          ),
        }),
      ),
    ),
    headVersion,
    createdAt: timestamp(row.created_at, "timeline_plans.created_at"),
  });
}

function mapMaterializedSelectedSpanAudio(row: Row): TimingContracts.MaterializedSelectedSpanAudio {
  return Object.freeze({
    spanId: stringValue(row.id, "selected_span_audio.id"),
    spanKey: stringValue(row.span_key, "selected_span_audio.span_key"),
    timelineSegmentId: stringValue(
      row.timeline_segment_id,
      "selected_span_audio.timeline_segment_id",
    ),
    transcriptId: stringValue(row.transcript_id, "selected_span_audio.transcript_id"),
    taskKey: stringValue(row.task_key, "selected_span_audio.task_key"),
    sourceAssetId: stringValue(row.source_asset_id, "selected_span_audio.source_asset_id"),
    sourceBinarySha256: stringValue(
      row.source_binary_sha256,
      "selected_span_audio.source_binary_sha256",
    ) as Sha256,
    selectedStartMs: numberValue(row.selected_start_ms, "selected_span_audio.selected_start_ms"),
    selectedEndMsExclusive: numberValue(
      row.selected_end_ms_exclusive,
      "selected_span_audio.selected_end_ms_exclusive",
    ),
    paddedStartMs: numberValue(row.padded_start_ms, "selected_span_audio.padded_start_ms"),
    paddedEndMsExclusive: numberValue(
      row.padded_end_ms_exclusive,
      "selected_span_audio.padded_end_ms_exclusive",
    ),
    trimStartMs: numberValue(row.trim_start_ms, "selected_span_audio.trim_start_ms"),
    trimEndMsExclusive: numberValue(
      row.trim_end_ms_exclusive,
      "selected_span_audio.trim_end_ms_exclusive",
    ),
    state: "MATERIALIZED",
    materializedAssetId: stringValue(
      row.materialized_asset_id,
      "selected_span_audio.materialized_asset_id",
    ),
    materializedBinarySha256: stringValue(
      row.materialized_binary_sha256,
      "selected_span_audio.materialized_binary_sha256",
    ) as Sha256,
    materializedDurationMs: numberValue(
      row.materialized_duration_ms,
      "selected span materialized duration",
    ),
    version: numberValue(row.version, "selected_span_audio.version"),
    materializedAt: timestamp(row.materialized_at, "selected_span_audio.materialized_at"),
  });
}

function createTimingRepository(context: RepositoryContext): TimingContracts.TimingRepository {
  return {
    async persistTranscriptTiming(scope, command) {
      const validation = validateTranscriptTimingCommand(command);
      if (validation !== null) return invariant("TRANSCRIPT_COVERAGE_INVALID", validation);
      return context.atomic.run(async (executor) => {
        const project = await findProject(executor, scope.workspaceId, command.projectId);
        if (project === null) return missing("PROJECT", command.projectId);
        const revision = await findProjectRevision(
          executor,
          scope.workspaceId,
          command.projectId,
          command.projectRevisionId,
        );
        if (revision === null) return missing("PROJECT_REVISION", command.projectRevisionId);
        if (revision.status !== "LOCKED") {
          return invariant("REVISION_NOT_LOCKED", "timing requires one exact locked revision");
        }
        if (
          revision.voiceoverAssetId !== command.sourceAssetId ||
          revision.voiceoverBinarySha256 !== command.sourceBinarySha256
        ) {
          return invariant(
            "TIMING_INPUT_MISMATCH",
            "transcript source does not match the revision-pinned voiceover",
          );
        }
        const document = await one(
          executor,
          `SELECT document.kind, document.state, document.canonical_contract_name,
                  document.canonical_contract_version, document.canonical_document_sha256,
                  document.source_attempt_id,
                  attempt.state AS source_attempt_state,
                  attempt.result_disposition AS source_attempt_disposition,
                  attempt.output_asset_id AS source_attempt_output_asset_id,
                  attempt.input_hash AS source_attempt_input_hash,
                  task.id AS source_task_id, task.owner_type AS source_task_owner_type,
                  task.owner_id AS source_task_owner_id, task.project_revision_id,
                  task.lane AS source_task_lane, task.state AS source_task_state,
                  task.accepted_attempt_id,
                  document.metadata->>'asr_input_hash' AS document_asr_input_hash
             FROM public.assets document
             LEFT JOIN public.attempts attempt
               ON attempt.workspace_id = document.workspace_id
              AND attempt.id = document.source_attempt_id
             LEFT JOIN public.generation_tasks task
               ON task.workspace_id = attempt.workspace_id AND task.id = attempt.task_id
            WHERE document.workspace_id = $1 AND document.id = $2`,
          [scope.workspaceId, command.canonicalDocumentAssetId],
        );
        if (document === null) return missing("ASSET", command.canonicalDocumentAssetId);
        if (
          document.kind !== "CANONICAL_DOCUMENT" ||
          (document.state !== "VERIFIED" && document.state !== "ACCEPTED") ||
          document.canonical_contract_name !== command.canonicalDocument.contractName ||
          document.canonical_contract_version !== command.canonicalDocument.contractVersion ||
          document.canonical_document_sha256 !== command.canonicalDocument.canonicalDocumentSha256
        ) {
          return invariant(
            "CANONICAL_DOCUMENT_MISMATCH",
            "transcript canonical asset does not match its exact document identity",
          );
        }
        if (
          document.source_attempt_id !== null &&
          (document.source_attempt_state !== "SUCCEEDED" ||
            document.source_attempt_disposition !== "ACCEPTED" ||
            document.source_attempt_output_asset_id !== command.canonicalDocumentAssetId ||
            document.source_task_owner_type !== "PROJECT_REVISION" ||
            document.source_task_owner_id !== command.projectRevisionId ||
            document.project_revision_id !== command.projectRevisionId ||
            document.source_task_lane !== "TRANSCRIBE" ||
            document.source_task_state !== "COMPLETE" ||
            document.accepted_attempt_id !== document.source_attempt_id ||
            document.document_asr_input_hash !== document.source_attempt_input_hash)
        ) {
          return invariant(
            "TIMING_INPUT_MISMATCH",
            "transcript artifact is not the exact accepted local transcription attempt",
          );
        }
        const head = await one(
          executor,
          `SELECT * FROM public.revision_timing_heads
            WHERE workspace_id = $1 AND project_revision_id = $2 FOR UPDATE`,
          [scope.workspaceId, command.projectRevisionId],
        );
        const currentVersion = timingHeadVersion(head);
        if (currentVersion !== command.expectedHeadVersion) {
          return conflict(
            "TIMING_HEAD_VERSION_MISMATCH",
            "timing head changed before transcript persistence",
            currentVersion,
          );
        }
        if (head !== null && head.current_transcript_id !== null) {
          return invariant(
            "TIMING_HEAD_NOT_EMPTY",
            "invalidate the current timing head before selecting another transcript",
          );
        }
        if (
          (await one(
            executor,
            `SELECT id FROM public.transcripts
              WHERE workspace_id = $1 AND project_revision_id = $2
                AND (id = $3 OR input_fingerprint_hash = $4)`,
            [
              scope.workspaceId,
              command.projectRevisionId,
              command.transcriptId,
              command.inputFingerprintHash,
            ],
          )) !== null
        ) {
          return conflict("TIMING_INPUT_EXISTS", "transcript identity or input already exists");
        }
        if (command.supersedesTranscriptId !== null) {
          const parent = await one(
            executor,
            `SELECT lineage_sequence FROM public.transcripts
              WHERE workspace_id = $1 AND project_revision_id = $2 AND id = $3
                AND lineage_contract_version = 'timing-lineage/v1'`,
            [scope.workspaceId, command.projectRevisionId, command.supersedesTranscriptId],
          );
          if (
            parent === null ||
            command.lineageSequence <= numberValue(parent.lineage_sequence, "parent lineage")
          ) {
            return invariant(
              "TIMING_INPUT_MISMATCH",
              "superseded transcript must be earlier immutable lineage in the same revision",
            );
          }
        }
        await executor.query(
          `INSERT INTO public.transcripts (
             id, workspace_id, project_revision_id, source_asset_id, state,
             model_name, model_hash, duration_ms, contract_name, contract_version,
             canonical_document_asset_id, canonical_document_hash, ready_at,
             lineage_contract_version, source_binary_sha256, engine_name, engine_version,
             language, transcription_config_hash, optional_script_hash, input_fingerprint_hash,
             idempotency_key, lineage_sequence, supersedes_transcript_id, created_at
           ) VALUES (
             $1, $2, $3, $4, 'READY', $5, $6, $7, $8, $9, $10, $11, $12,
             'timing-lineage/v1', $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $12
           )`,
          [
            command.transcriptId,
            scope.workspaceId,
            command.projectRevisionId,
            command.sourceAssetId,
            command.modelName,
            command.modelSha256,
            command.sourceDurationMs,
            command.canonicalDocument.contractName,
            command.canonicalDocument.contractVersion,
            command.canonicalDocumentAssetId,
            command.canonicalDocument.canonicalDocumentSha256,
            command.createdAt,
            command.sourceBinarySha256,
            command.engineName,
            command.engineVersion,
            command.language,
            command.transcriptionConfigHash,
            command.optionalScriptHash,
            command.inputFingerprintHash,
            command.idempotencyKey,
            command.lineageSequence,
            command.supersedesTranscriptId,
          ],
        );
        for (const word of command.words) {
          await executor.query(
            `INSERT INTO public.transcript_words (
               id, workspace_id, transcript_id, word_index, word,
               start_ms, end_ms_exclusive, confidence, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              word.wordId,
              scope.workspaceId,
              command.transcriptId,
              word.index,
              word.text,
              word.startMs,
              word.endMsExclusive,
              word.confidence,
              command.createdAt,
            ],
          );
        }
        for (const sentence of command.sentences) {
          await executor.query(
            `INSERT INTO public.transcript_sentences (
               id, workspace_id, transcript_id, sentence_key, sentence_index,
               word_start, word_end_exclusive, start_ms, end_ms_exclusive, text, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              sentence.sentenceId,
              scope.workspaceId,
              command.transcriptId,
              sentence.sentenceKey,
              sentence.index,
              sentence.wordStart,
              sentence.wordEndExclusive,
              sentence.startMs,
              sentence.endMsExclusive,
              sentence.text,
              command.createdAt,
            ],
          );
        }
        for (const phrase of command.phrases) {
          await executor.query(
            `INSERT INTO public.transcript_phrases (
               id, workspace_id, transcript_id, sentence_id, phrase_key, phrase_index,
               word_start, word_end_exclusive, start_ms, end_ms_exclusive,
               pause_before_ms, pause_after_ms, text, created_at
             ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
            [
              phrase.phraseId,
              scope.workspaceId,
              command.transcriptId,
              phrase.sentenceId,
              phrase.phraseKey,
              phrase.index,
              phrase.wordStart,
              phrase.wordEndExclusive,
              phrase.startMs,
              phrase.endMsExclusive,
              phrase.pauseBeforeMs,
              phrase.pauseAfterMs,
              phrase.text,
              command.createdAt,
            ],
          );
        }
        const nextVersion = currentVersion + 1;
        if (head === null) {
          await executor.query(
            `INSERT INTO public.revision_timing_heads (
               workspace_id, project_revision_id, version, current_transcript_id,
               transcript_input_fingerprint_hash, updated_at
             ) VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              scope.workspaceId,
              command.projectRevisionId,
              nextVersion,
              command.transcriptId,
              command.inputFingerprintHash,
              command.createdAt,
            ],
          );
        } else {
          await executor.query(
            `UPDATE public.revision_timing_heads
                SET version = $3, current_transcript_id = $4,
                    transcript_input_fingerprint_hash = $5, updated_at = $6
              WHERE workspace_id = $1 AND project_revision_id = $2`,
            [
              scope.workspaceId,
              command.projectRevisionId,
              nextVersion,
              command.transcriptId,
              command.inputFingerprintHash,
              command.createdAt,
            ],
          );
        }
        const inserted = await loadPersistedTranscript(
          executor,
          scope.workspaceId,
          command.projectRevisionId,
          command.transcriptId,
          nextVersion,
        );
        if (inserted === null) throw new Error("persisted transcript disappeared");
        return write(inserted);
      });
    },

    async persistTimelinePlan(scope, command) {
      const validation = validateTimelinePlanCommand(command);
      if (validation !== null) return invariant("TIMELINE_COVERAGE_INVALID", validation);
      return context.atomic.run(async (executor) => {
        const revision = await findProjectRevision(
          executor,
          scope.workspaceId,
          command.projectId,
          command.projectRevisionId,
        );
        if (revision === null) return missing("PROJECT_REVISION", command.projectRevisionId);
        if (revision.status !== "LOCKED") {
          return invariant("REVISION_NOT_LOCKED", "timeline requires one exact locked revision");
        }
        if (revision.revisionConfig.canonicalDocumentSha256 !== command.revisionConfigHash) {
          return invariant(
            "TIMING_INPUT_MISMATCH",
            "timeline revision configuration hash is stale",
          );
        }
        const transcript = await loadPersistedTranscript(
          executor,
          scope.workspaceId,
          command.projectRevisionId,
          command.transcriptId,
          command.expectedHeadVersion,
        );
        if (transcript === null) return missing("TRANSCRIPT", command.transcriptId);
        if (
          transcript.canonicalDocument.canonicalDocumentSha256 !== command.transcriptDocumentHash
        ) {
          return invariant("TIMING_INPUT_MISMATCH", "timeline transcript hash is stale");
        }
        const wordStartByIndex = new Map(
          transcript.words.map((word) => [word.index, word.startMs] as const),
        );
        if (
          command.segments.at(-1)?.wordEndExclusive !== transcript.words.length ||
          command.segments.some((segment) => {
            const expectedStartMs =
              segment.wordStart === 0 ? 0 : wordStartByIndex.get(segment.wordStart);
            const expectedEndMs =
              segment.wordEndExclusive === transcript.words.length
                ? transcript.sourceDurationMs
                : wordStartByIndex.get(segment.wordEndExclusive);
            return (
              expectedStartMs === undefined ||
              expectedEndMs === undefined ||
              segment.sourceAudioStartMs !== expectedStartMs ||
              segment.sourceAudioEndMsExclusive !== expectedEndMs
            );
          })
        ) {
          return invariant(
            "TIMELINE_COVERAGE_INVALID",
            "timeline segments must cover every transcript word and source-audio word boundary exactly",
          );
        }
        if (
          command.selectedSpanAudio.some(
            (span) =>
              span.sourceAssetId !== transcript.sourceAssetId ||
              span.sourceBinarySha256 !== transcript.sourceBinarySha256,
          )
        ) {
          return invariant(
            "SELECTED_SPAN_OWNERSHIP_MISMATCH",
            "selected span audio must use the exact transcript voiceover source",
          );
        }
        const document = await one(
          executor,
          `SELECT kind, state, canonical_contract_name, canonical_contract_version,
                  canonical_document_sha256
             FROM public.assets WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, command.canonicalDocumentAssetId],
        );
        if (document === null) return missing("ASSET", command.canonicalDocumentAssetId);
        if (
          document.kind !== "CANONICAL_DOCUMENT" ||
          (document.state !== "VERIFIED" && document.state !== "ACCEPTED") ||
          document.canonical_contract_name !== command.canonicalDocument.contractName ||
          document.canonical_contract_version !== command.canonicalDocument.contractVersion ||
          document.canonical_document_sha256 !== command.canonicalDocument.canonicalDocumentSha256
        ) {
          return invariant(
            "CANONICAL_DOCUMENT_MISMATCH",
            "timeline canonical asset does not match its exact document identity",
          );
        }
        const head = await one(
          executor,
          `SELECT * FROM public.revision_timing_heads
            WHERE workspace_id = $1 AND project_revision_id = $2 FOR UPDATE`,
          [scope.workspaceId, command.projectRevisionId],
        );
        if (head === null) return missing("TIMING_HEAD", command.projectRevisionId);
        const currentVersion = timingHeadVersion(head);
        if (currentVersion !== command.expectedHeadVersion) {
          return conflict(
            "TIMING_HEAD_VERSION_MISMATCH",
            "timing head changed before timeline persistence",
            currentVersion,
          );
        }
        if (head.current_transcript_id !== command.transcriptId) {
          return invariant("TIMING_INPUT_MISMATCH", "timeline transcript is not the current head");
        }
        if (head.current_timeline_plan_id !== null) {
          return invariant(
            "TIMING_HEAD_NOT_EMPTY",
            "invalidate the current timing head before selecting another plan",
          );
        }
        if (
          (await one(
            executor,
            `SELECT id FROM public.timeline_plans
              WHERE workspace_id = $1 AND project_revision_id = $2
                AND (id = $3 OR input_fingerprint_hash = $4)`,
            [
              scope.workspaceId,
              command.projectRevisionId,
              command.timelinePlanId,
              command.inputFingerprintHash,
            ],
          )) !== null
        ) {
          return conflict("TIMING_INPUT_EXISTS", "timeline identity or input already exists");
        }
        if (command.supersedesTimelinePlanId !== null) {
          const parent = await one(
            executor,
            `SELECT plan_sequence FROM public.timeline_plans
              WHERE workspace_id = $1 AND project_revision_id = $2 AND id = $3`,
            [scope.workspaceId, command.projectRevisionId, command.supersedesTimelinePlanId],
          );
          if (
            parent === null ||
            command.planSequence <= numberValue(parent.plan_sequence, "parent plan sequence")
          ) {
            return invariant(
              "TIMING_INPUT_MISMATCH",
              "superseded timeline plan must be earlier immutable lineage in the same revision",
            );
          }
        }
        await executor.query(
          `INSERT INTO public.timeline_plans (
             id, workspace_id, project_revision_id, transcript_id, plan_sequence,
             supersedes_timeline_plan_id, revision_config_hash, transcript_document_hash,
             scheduler_version, scheduler_config_hash, seed, input_fingerprint_hash,
             contract_name, contract_version, canonical_document_asset_id,
             canonical_document_hash, output_fps_num, output_fps_den, total_frames,
             idempotency_key, created_by_user_id, created_at
           ) VALUES (
             $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
             $15, $16, $17, $18, $19, $20, $21, $22
           )`,
          [
            command.timelinePlanId,
            scope.workspaceId,
            command.projectRevisionId,
            command.transcriptId,
            command.planSequence,
            command.supersedesTimelinePlanId,
            command.revisionConfigHash,
            command.transcriptDocumentHash,
            command.schedulerVersion,
            command.schedulerConfigHash,
            command.seed,
            command.inputFingerprintHash,
            command.canonicalDocument.contractName,
            command.canonicalDocument.contractVersion,
            command.canonicalDocumentAssetId,
            command.canonicalDocument.canonicalDocumentSha256,
            command.outputFpsNum,
            command.outputFpsDen,
            command.totalFrames,
            command.idempotencyKey,
            scope.actorUserId,
            command.createdAt,
          ],
        );
        for (const segment of command.segments) {
          await executor.query(
            `INSERT INTO public.timeline_segments (
               id, workspace_id, project_revision_id, timeline_plan_id, segment_key,
               segment_index, start_frame, end_frame_exclusive, source_audio_start_ms,
               source_audio_end_ms_exclusive, word_start, word_end_exclusive,
               timeline_composition, in_image_shot_role, narration, required_slots,
               timeline_plan_hash, created_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16::jsonb, $17, $18
             )`,
            [
              segment.segmentId,
              scope.workspaceId,
              command.projectRevisionId,
              command.timelinePlanId,
              segment.segmentKey,
              segment.index,
              segment.startFrame,
              segment.endFrameExclusive,
              segment.sourceAudioStartMs,
              segment.sourceAudioEndMsExclusive,
              segment.wordStart,
              segment.wordEndExclusive,
              segment.timelineComposition,
              segment.inImageShotRole,
              segment.narration,
              jsonParameter(segment.requiredSlots),
              command.canonicalDocument.canonicalDocumentSha256,
              command.createdAt,
            ],
          );
        }
        for (const span of command.selectedSpanAudio) {
          await executor.query(
            `INSERT INTO public.selected_span_audio (
               id, workspace_id, project_revision_id, timeline_plan_id, timeline_segment_id,
               transcript_id, span_key, task_key, source_asset_id, source_binary_sha256,
               selected_start_ms, selected_end_ms_exclusive, padded_start_ms,
               padded_end_ms_exclusive, trim_start_ms, trim_end_ms_exclusive,
               state, created_at
             ) VALUES (
               $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               $15, $16, 'PLANNED', $17
             )`,
            [
              span.spanId,
              scope.workspaceId,
              command.projectRevisionId,
              command.timelinePlanId,
              span.timelineSegmentId,
              span.transcriptId,
              span.spanKey,
              span.taskKey,
              span.sourceAssetId,
              span.sourceBinarySha256,
              span.selectedStartMs,
              span.selectedEndMsExclusive,
              span.paddedStartMs,
              span.paddedEndMsExclusive,
              span.trimStartMs,
              span.trimEndMsExclusive,
              command.createdAt,
            ],
          );
        }
        const nextVersion = currentVersion + 1;
        await executor.query(
          `UPDATE public.revision_timing_heads
              SET version = $3, current_timeline_plan_id = $4,
                  timeline_input_fingerprint_hash = $5, updated_at = $6
            WHERE workspace_id = $1 AND project_revision_id = $2`,
          [
            scope.workspaceId,
            command.projectRevisionId,
            nextVersion,
            command.timelinePlanId,
            command.inputFingerprintHash,
            command.createdAt,
          ],
        );
        const inserted = await loadPersistedTimelinePlan(
          executor,
          scope.workspaceId,
          command.projectRevisionId,
          command.timelinePlanId,
          nextVersion,
        );
        if (inserted === null) throw new Error("persisted timeline plan disappeared");
        return write(inserted);
      });
    },

    async materializeSelectedSpanAudio(scope, command) {
      if (
        !Number.isSafeInteger(command.expectedHeadVersion) ||
        command.expectedHeadVersion < 2 ||
        !Number.isSafeInteger(command.expectedSpanVersion) ||
        command.expectedSpanVersion < 1 ||
        !Number.isSafeInteger(command.materializedDurationMs) ||
        command.materializedDurationMs < 1
      ) {
        return invariant("TIMING_INPUT_MISMATCH", "span materialization facts are invalid");
      }
      return context.atomic.run(async (executor) => {
        const project = await findProject(executor, scope.workspaceId, command.projectId);
        if (project === null) return missing("PROJECT", command.projectId);
        const revision = await findProjectRevision(
          executor,
          scope.workspaceId,
          command.projectId,
          command.projectRevisionId,
        );
        if (revision === null) return missing("PROJECT_REVISION", command.projectRevisionId);
        if (revision.status !== "LOCKED") {
          return invariant("REVISION_NOT_LOCKED", "span audio requires one exact locked revision");
        }
        const head = await one(
          executor,
          `SELECT * FROM public.revision_timing_heads
            WHERE workspace_id = $1 AND project_revision_id = $2 FOR UPDATE`,
          [scope.workspaceId, command.projectRevisionId],
        );
        if (head === null) return missing("TIMING_HEAD", command.projectRevisionId);
        const currentVersion = timingHeadVersion(head);
        if (currentVersion !== command.expectedHeadVersion) {
          return conflict(
            "TIMING_HEAD_VERSION_MISMATCH",
            "timing head changed before span materialization",
            currentVersion,
          );
        }
        if (
          head.current_transcript_id !== command.transcriptId ||
          head.current_timeline_plan_id !== command.timelinePlanId
        ) {
          return invariant(
            "TIMING_INPUT_MISMATCH",
            "span audio does not belong to the current timing head",
          );
        }
        const span = await one(
          executor,
          `SELECT span.*, artifact.kind AS materialized_kind,
                  artifact.state AS materialized_asset_state,
                  artifact.project_id AS materialized_project_id,
                  artifact.project_revision_id AS materialized_revision_id,
                  artifact.source_attempt_id AS materialized_source_attempt_id,
                  artifact.binary_sha256 AS materialized_asset_sha256,
                  artifact.content_type AS materialized_content_type,
                  artifact.duration_ms AS materialized_asset_duration_ms,
                  artifact.metadata->>'span_id' AS materialized_span_id,
                  artifact.metadata->>'timeline_plan_id' AS materialized_timeline_plan_id,
                  artifact.metadata->>'transcript_id' AS materialized_transcript_id,
                  artifact.metadata->>'task_key' AS materialized_artifact_task_key,
                  artifact.metadata->>'source_asset_id' AS materialized_source_asset_id,
                  artifact.metadata->>'source_binary_sha256' AS materialized_source_sha256,
                  artifact.metadata->>'padded_start_ms' AS materialized_padded_start_ms,
                  artifact.metadata->>'padded_end_ms_exclusive' AS materialized_padded_end_ms,
                  artifact.metadata->>'span_audio_input_hash' AS materialized_input_hash,
                  attempt.state AS materialized_attempt_state,
                  attempt.result_disposition AS materialized_attempt_disposition,
                  attempt.output_asset_id AS materialized_attempt_output_asset_id,
                  attempt.input_hash AS materialized_attempt_input_hash,
                  task.owner_type AS materialized_task_owner_type,
                  task.owner_id AS materialized_task_owner_id,
                  task.project_revision_id AS materialized_task_revision_id,
                  task.lane AS materialized_task_lane,
                  task.task_key AS materialized_generation_task_key,
                  task.state AS materialized_task_state,
                  task.accepted_attempt_id AS materialized_accepted_attempt_id
             FROM public.selected_span_audio span
             LEFT JOIN public.assets artifact
               ON artifact.workspace_id = span.workspace_id
              AND artifact.id = $6
             LEFT JOIN public.attempts attempt
               ON attempt.workspace_id = artifact.workspace_id
              AND attempt.id = artifact.source_attempt_id
             LEFT JOIN public.generation_tasks task
               ON task.workspace_id = attempt.workspace_id AND task.id = attempt.task_id
            WHERE span.workspace_id = $1 AND span.project_revision_id = $2
              AND span.timeline_plan_id = $3 AND span.transcript_id = $4 AND span.id = $5
            FOR UPDATE OF span`,
          [
            scope.workspaceId,
            command.projectRevisionId,
            command.timelinePlanId,
            command.transcriptId,
            command.spanId,
            command.materializedAssetId,
          ],
        );
        if (span === null) return missing("SELECTED_SPAN_AUDIO", command.spanId);
        const spanVersion = numberValue(span.version, "selected_span_audio.version");
        if (spanVersion !== command.expectedSpanVersion) {
          return conflict(
            "EXPECTED_VERSION_MISMATCH",
            "selected span changed before materialization",
            spanVersion,
          );
        }
        if (span.state === "MATERIALIZED") {
          const existing = mapMaterializedSelectedSpanAudio({
            ...span,
            materialized_duration_ms: span.materialized_asset_duration_ms,
          });
          return existing.materializedAssetId === command.materializedAssetId &&
            existing.materializedBinarySha256 === command.materializedBinarySha256 &&
            existing.materializedDurationMs === command.materializedDurationMs &&
            existing.materializedAt === command.materializedAt
            ? write(existing, true)
            : conflict("STATE_CONFLICT", "selected span already has different materialized audio");
        }
        const expectedDuration =
          numberValue(span.padded_end_ms_exclusive, "selected_span_audio.padded_end_ms_exclusive") -
          numberValue(span.padded_start_ms, "selected_span_audio.padded_start_ms");
        if (
          expectedDuration !== command.materializedDurationMs ||
          span.materialized_kind !== "AUDIO_SPAN" ||
          (span.materialized_asset_state !== "VERIFIED" &&
            span.materialized_asset_state !== "ACCEPTED") ||
          span.materialized_project_id !== command.projectId ||
          span.materialized_revision_id !== command.projectRevisionId ||
          span.materialized_source_attempt_id !== command.outputAttemptId ||
          span.materialized_asset_sha256 !== command.materializedBinarySha256 ||
          span.materialized_content_type !== "audio/wav" ||
          span.materialized_asset_duration_ms === null ||
          numberValue(span.materialized_asset_duration_ms, "assets.duration_ms") !==
            command.materializedDurationMs ||
          span.materialized_span_id !== command.spanId ||
          span.materialized_timeline_plan_id !== command.timelinePlanId ||
          span.materialized_transcript_id !== command.transcriptId ||
          span.materialized_artifact_task_key !== span.task_key ||
          span.materialized_generation_task_key !== span.task_key ||
          span.materialized_source_asset_id !== span.source_asset_id ||
          span.materialized_source_sha256 !== span.source_binary_sha256 ||
          span.materialized_padded_start_ms !== String(span.padded_start_ms) ||
          span.materialized_padded_end_ms !== String(span.padded_end_ms_exclusive) ||
          span.materialized_input_hash !== span.materialized_attempt_input_hash ||
          span.materialized_attempt_state !== "SUCCEEDED" ||
          span.materialized_attempt_disposition !== "ACCEPTED" ||
          span.materialized_attempt_output_asset_id !== command.materializedAssetId ||
          span.materialized_task_owner_type !== "PROJECT_REVISION" ||
          span.materialized_task_owner_id !== command.projectRevisionId ||
          span.materialized_task_revision_id !== command.projectRevisionId ||
          span.materialized_task_lane !== "PREPARE" ||
          span.materialized_task_state !== "COMPLETE" ||
          span.materialized_accepted_attempt_id !== command.outputAttemptId
        ) {
          return invariant(
            "SELECTED_SPAN_OWNERSHIP_MISMATCH",
            "materialized audio is not the exact accepted output for this selected span",
          );
        }
        const nextSpanVersion = spanVersion + 1;
        await executor.query(
          `UPDATE public.selected_span_audio
              SET state = 'MATERIALIZED', materialized_asset_id = $3,
                  materialized_binary_sha256 = $4, version = $5, materialized_at = $6
            WHERE workspace_id = $1 AND id = $2 AND state = 'PLANNED'`,
          [
            scope.workspaceId,
            command.spanId,
            command.materializedAssetId,
            command.materializedBinarySha256,
            nextSpanVersion,
            command.materializedAt,
          ],
        );
        const materialized = await one(
          executor,
          `SELECT span.*, artifact.duration_ms AS materialized_duration_ms
             FROM public.selected_span_audio span
             JOIN public.assets artifact
               ON artifact.workspace_id = span.workspace_id
              AND artifact.id = span.materialized_asset_id
            WHERE span.workspace_id = $1 AND span.id = $2`,
          [scope.workspaceId, command.spanId],
        );
        if (materialized === null) throw new Error("materialized span audio disappeared");
        return write(mapMaterializedSelectedSpanAudio(materialized));
      });
    },

    async invalidateTiming(scope, command) {
      if (!Number.isSafeInteger(command.expectedHeadVersion) || command.expectedHeadVersion < 1) {
        return invariant("TIMING_INPUT_MISMATCH", "expected timing head version is invalid");
      }
      return context.atomic.run(async (executor) => {
        const revision = await findProjectRevision(
          executor,
          scope.workspaceId,
          command.projectId,
          command.projectRevisionId,
        );
        if (revision === null) return missing("PROJECT_REVISION", command.projectRevisionId);
        if (revision.status !== "LOCKED") {
          return invariant("REVISION_NOT_LOCKED", "timing invalidation requires a locked revision");
        }
        const head = await one(
          executor,
          `SELECT * FROM public.revision_timing_heads
            WHERE workspace_id = $1 AND project_revision_id = $2 FOR UPDATE`,
          [scope.workspaceId, command.projectRevisionId],
        );
        if (head === null) return missing("TIMING_HEAD", command.projectRevisionId);
        const currentVersion = timingHeadVersion(head);
        if (currentVersion !== command.expectedHeadVersion) {
          return conflict(
            "TIMING_HEAD_VERSION_MISMATCH",
            "timing head changed before invalidation",
            currentVersion,
          );
        }
        if (
          head.current_transcript_id === null ||
          head.transcript_input_fingerprint_hash === null
        ) {
          return invariant("TIMING_HEAD_NOT_EMPTY", "timing head is already invalidated");
        }
        const currentTranscriptId = stringValue(
          head.current_transcript_id,
          "revision_timing_heads.current_transcript_id",
        );
        const currentTimelinePlanId = nullableString(
          head.current_timeline_plan_id,
          "revision_timing_heads.current_timeline_plan_id",
        );
        const currentTranscriptInputHash = stringValue(
          head.transcript_input_fingerprint_hash,
          "revision_timing_heads.transcript_input_fingerprint_hash",
        ) as Sha256;
        const currentTimelineInputHash = nullableString(
          head.timeline_input_fingerprint_hash,
          "revision_timing_heads.timeline_input_fingerprint_hash",
        ) as Sha256 | null;
        await executor.query(
          `INSERT INTO public.timing_invalidations (
             id, workspace_id, project_revision_id, invalidated_head_version,
             invalidated_transcript_id, invalidated_timeline_plan_id,
             prior_transcript_input_fingerprint_hash, prior_timeline_input_fingerprint_hash,
             next_input_fingerprint_hash, reason, idempotency_key,
             created_by_user_id, created_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            command.invalidationId,
            scope.workspaceId,
            command.projectRevisionId,
            currentVersion,
            currentTranscriptId,
            currentTimelinePlanId,
            currentTranscriptInputHash,
            currentTimelineInputHash,
            command.nextInputFingerprintHash,
            command.reason,
            command.idempotencyKey,
            scope.actorUserId,
            command.invalidatedAt,
          ],
        );
        const nextVersion = currentVersion + 1;
        await executor.query(
          `UPDATE public.revision_timing_heads
              SET version = $3, current_transcript_id = NULL, current_timeline_plan_id = NULL,
                  transcript_input_fingerprint_hash = NULL,
                  timeline_input_fingerprint_hash = NULL, updated_at = $4
            WHERE workspace_id = $1 AND project_revision_id = $2`,
          [scope.workspaceId, command.projectRevisionId, nextVersion, command.invalidatedAt],
        );
        return write(
          Object.freeze({
            invalidationId: command.invalidationId,
            projectRevisionId: command.projectRevisionId,
            invalidatedHeadVersion: currentVersion,
            invalidatedTranscriptId: currentTranscriptId,
            invalidatedTimelinePlanId: currentTimelinePlanId,
            priorTranscriptInputFingerprintHash: currentTranscriptInputHash,
            priorTimelineInputFingerprintHash: currentTimelineInputHash,
            nextInputFingerprintHash: command.nextInputFingerprintHash,
            reason: command.reason,
            createdByUserId: scope.actorUserId,
            createdAt: command.invalidatedAt,
            headVersion: nextVersion,
          }),
        );
      });
    },

    async resolveExactPlan(scope, lookup) {
      const project = await findProject(context.executor, scope.workspaceId, lookup.projectId);
      if (project === null) return missing("PROJECT", lookup.projectId);
      const revision = await findProjectRevision(
        context.executor,
        scope.workspaceId,
        lookup.projectId,
        lookup.projectRevisionId,
      );
      if (revision === null) return missing("PROJECT_REVISION", lookup.projectRevisionId);
      const head = await one(
        context.executor,
        `SELECT * FROM public.revision_timing_heads
          WHERE workspace_id = $1 AND project_revision_id = $2
            AND transcript_input_fingerprint_hash = $3
            AND timeline_input_fingerprint_hash = $4`,
        [
          scope.workspaceId,
          lookup.projectRevisionId,
          lookup.transcriptInputFingerprintHash,
          lookup.timelineInputFingerprintHash,
        ],
      );
      if (
        head === null ||
        head.current_transcript_id === null ||
        head.current_timeline_plan_id === null
      ) {
        return missing("TIMELINE_PLAN", lookup.projectRevisionId);
      }
      const headVersion = timingHeadVersion(head);
      const transcript = await loadPersistedTranscript(
        context.executor,
        scope.workspaceId,
        lookup.projectRevisionId,
        stringValue(head.current_transcript_id, "revision_timing_heads.current_transcript_id"),
        headVersion,
      );
      const timelinePlan = await loadPersistedTimelinePlan(
        context.executor,
        scope.workspaceId,
        lookup.projectRevisionId,
        stringValue(
          head.current_timeline_plan_id,
          "revision_timing_heads.current_timeline_plan_id",
        ),
        headVersion,
      );
      if (transcript === null || timelinePlan === null) {
        return invariant(
          "TIMING_INPUT_MISMATCH",
          "timing head points to missing immutable lineage",
        );
      }
      return success(
        Object.freeze({
          projectId: lookup.projectId,
          projectRevisionId: lookup.projectRevisionId,
          headVersion,
          transcript,
          timelinePlan,
        }),
      );
    },
  };
}

function createAvatarProfileRepository(
  context: RepositoryContext,
): PresetContracts.AvatarProfileRepository {
  return {
    async createProfile(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findAvatarProfile(executor, scope.workspaceId, command.profileId);
        if (existing !== null) {
          return existing.createdByUserId === scope.actorUserId &&
            existing.name === command.name &&
            existing.normalizedName === command.normalizedName
            ? write(existing, true)
            : conflict("IDEMPOTENCY_KEY_REUSED", "avatar profile identity changed on retry");
        }
        await executor.query(
          `INSERT INTO avatar_profiles (id, workspace_id, name, normalized_name, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            command.profileId,
            scope.workspaceId,
            command.name,
            command.normalizedName,
            scope.actorUserId,
          ],
        );
        const inserted = await findAvatarProfile(executor, scope.workspaceId, command.profileId);
        if (inserted === null) throw new Error("inserted avatar profile disappeared");
        return write(inserted);
      });
    },
    async createDraftVersion(scope, command) {
      return context.atomic.run(async (executor) => {
        const profile = await findAvatarProfile(executor, scope.workspaceId, command.profileId);
        if (profile === null) return missing("AVATAR_PROFILE", command.profileId);
        if (profile.status === "ARCHIVED") {
          return invariant("AVATAR_PROFILE_ARCHIVED", "archived avatar profiles reject drafts");
        }
        const existing = await findAvatarVersion(
          executor,
          scope.workspaceId,
          command.profileId,
          command.versionId,
        );
        if (existing !== null) {
          return existing.versionNumber === command.versionNumber && existing.state === "DRAFT"
            ? write(existing, true)
            : conflict("AVATAR_PROFILE_VERSION_CONFLICT", "avatar version identity already exists");
        }
        await executor.query(
          `INSERT INTO avatar_profile_versions (
             id, workspace_id, profile_id, version_number, state
           ) VALUES ($1, $2, $3, $4, 'DRAFT')`,
          [command.versionId, scope.workspaceId, command.profileId, command.versionNumber],
        );
        const inserted = await findAvatarVersion(
          executor,
          scope.workspaceId,
          command.profileId,
          command.versionId,
        );
        if (inserted === null) throw new Error("inserted avatar draft disappeared");
        return write(inserted as PresetContracts.AvatarProfileDraftVersion);
      });
    },
    async saveDraftVersion(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findAvatarVersion(
          executor,
          scope.workspaceId,
          command.profileId,
          command.versionId,
        );
        if (existing === null) return missing("AVATAR_PROFILE_VERSION", command.versionId);
        if (existing.state === "READY" || existing.state === "ABANDONED") {
          return invariant(
            "IMMUTABLE_RECORD",
            "published or abandoned avatar versions are immutable",
          );
        }
        if (existing.updatedAt !== command.expectedUpdatedAt) {
          return conflict("EXPECTED_VERSION_MISMATCH", "avatar draft changed before save");
        }
        await executor.query(
          `UPDATE avatar_profile_versions SET state = $4,
             profile_contract_name = $5, profile_contract_version = $6,
             profile_payload = $7::jsonb, profile_hash = $8,
             original_asset_id = $9, runtime_source_asset_id = $10,
             runtime_source_binary_sha256 = $11, source_preparation_profile = $12,
             source_validation_profile = $13, rights_attested_by_user_id = $14,
             likeness_attested_by_user_id = $15, updated_at = now()
           WHERE workspace_id = $1 AND profile_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            command.profileId,
            command.versionId,
            command.nextState,
            command.profileDocument?.contractName ?? null,
            command.profileDocument?.contractVersion ?? null,
            command.profileDocument === null
              ? null
              : jsonParameter(command.profileDocument.payload),
            command.profileDocument?.canonicalDocumentSha256 ?? null,
            command.originalAssetId,
            command.runtimeSourceAssetId,
            command.runtimeSourceBinarySha256,
            command.sourcePreparationProfile,
            command.sourceValidationProfile,
            command.rightsAttestedByUserId,
            command.likenessAttestedByUserId,
          ],
        );
        const updated = await findAvatarVersion(
          executor,
          scope.workspaceId,
          command.profileId,
          command.versionId,
        );
        if (updated === null) throw new Error("saved avatar draft disappeared");
        return write(updated as PresetContracts.AvatarProfileDraftVersion);
      });
    },
    async publishVersion(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findAvatarVersion(
          executor,
          scope.workspaceId,
          command.profileId,
          command.versionId,
        );
        if (existing === null) return missing("AVATAR_PROFILE_VERSION", command.versionId);
        if (existing.state === "READY") {
          return sameValue(
            {
              profileDocument: existing.profileDocument,
              originalAssetId: existing.originalAssetId,
              runtimeSourceAssetId: existing.runtimeSourceAssetId,
              runtimeSourceBinarySha256: existing.runtimeSourceBinarySha256,
              sourcePreparationProfile: existing.sourcePreparationProfile,
              sourceValidationProfile: existing.sourceValidationProfile,
              rightsAttestedByUserId: existing.rightsAttestedByUserId,
              likenessAttestedByUserId: existing.likenessAttestedByUserId,
              readyAt: existing.readyAt,
            },
            {
              profileDocument: command.profileDocument,
              originalAssetId: command.originalAssetId,
              runtimeSourceAssetId: command.runtimeSourceAssetId,
              runtimeSourceBinarySha256: command.runtimeSourceBinarySha256,
              sourcePreparationProfile: command.sourcePreparationProfile,
              sourceValidationProfile: command.sourceValidationProfile,
              rightsAttestedByUserId: command.rightsAttestedByUserId,
              likenessAttestedByUserId: command.likenessAttestedByUserId,
              readyAt: command.readyAt,
            },
          )
            ? write(existing, true)
            : invariant("IMMUTABLE_RECORD", "ready avatar version cannot be changed");
        }
        if (existing.state === "ABANDONED") {
          return invariant(
            "AVATAR_VERSION_NOT_PUBLISHABLE",
            "abandoned avatar version cannot publish",
          );
        }
        if (existing.updatedAt !== command.expectedUpdatedAt) {
          return conflict("EXPECTED_VERSION_MISMATCH", "avatar version changed before publication");
        }
        await executor.query(
          `UPDATE avatar_profile_versions SET state = 'READY',
             profile_contract_name = $4, profile_contract_version = $5,
             profile_payload = $6::jsonb, profile_hash = $7, original_asset_id = $8,
             runtime_source_asset_id = $9, runtime_source_binary_sha256 = $10,
             source_preparation_profile = $11, source_validation_profile = $12,
             rights_attested_by_user_id = $13, likeness_attested_by_user_id = $14,
             ready_at = $15, updated_at = $15
           WHERE workspace_id = $1 AND profile_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            command.profileId,
            command.versionId,
            command.profileDocument.contractName,
            command.profileDocument.contractVersion,
            jsonParameter(command.profileDocument.payload),
            command.profileDocument.canonicalDocumentSha256,
            command.originalAssetId,
            command.runtimeSourceAssetId,
            command.runtimeSourceBinarySha256,
            command.sourcePreparationProfile,
            command.sourceValidationProfile,
            command.rightsAttestedByUserId,
            command.likenessAttestedByUserId,
            command.readyAt,
          ],
        );
        await executor.query(
          `UPDATE avatar_profiles SET active_version_id = $3, updated_at = $4
           WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, command.profileId, command.versionId, command.readyAt],
        );
        const published = await findAvatarVersion(
          executor,
          scope.workspaceId,
          command.profileId,
          command.versionId,
        );
        if (published === null || published.state !== "READY") {
          throw new Error("published avatar version disappeared");
        }
        return write(published);
      });
    },
    async resolveExactReadyVersion(scope, lookup) {
      const version = await findAvatarVersion(
        context.executor,
        scope.workspaceId,
        lookup.profileId,
        lookup.versionId,
      );
      if (version === null) return missing("AVATAR_PROFILE_VERSION", lookup.versionId);
      if (version.state !== "READY") {
        return invariant("AVATAR_VERSION_NOT_READY", "requested avatar version is not ready");
      }
      const profile = await findAvatarProfile(
        context.executor,
        scope.workspaceId,
        lookup.profileId,
      );
      if (profile === null) return missing("AVATAR_PROFILE", lookup.profileId);
      if (lookup.use === "NEW_REVISION" && profile.status === "ARCHIVED") {
        return invariant("AVATAR_PROFILE_ARCHIVED", "archived avatar cannot enter a new revision");
      }
      return success(version);
    },
    async beginCompatibilityTest(scope, command) {
      if (
        command.reservation.task.owner.ownerType !== "AVATAR_PROFILE_VERSION" ||
        command.reservation.task.owner.ownerId !== command.versionId ||
        command.reservation.task.owner.avatarProfileVersionId !== command.versionId
      ) {
        return invariant(
          "AVATAR_COMPATIBILITY_BILLING_BOUNDARY_MISMATCH",
          "compatibility test must bill its exact avatar version",
        );
      }
      return context.atomic.run(async (executor) => {
        const reservationCommand = {
          ...command.reservation,
          idempotencyKey: command.idempotencyKey,
        };
        const reserved = await reserveTaskAttemptIn(executor, scope, reservationCommand);
        if (!reserved.ok) {
          return reserved as IdempotentRepositoryResult<
            never,
            PresetContracts.AvatarConflict,
            PresetContracts.AvatarMissing,
            PresetContracts.AvatarInvariant
          >;
        }
        const existing = await one(
          executor,
          `SELECT test.*, assessment.execution_profile_id
           FROM avatar_profile_test_attempts test
           JOIN avatar_compatibility_assessments assessment
             ON assessment.workspace_id = test.workspace_id AND assessment.id = test.assessment_id
           WHERE test.workspace_id = $1 AND test.id = $2`,
          [scope.workspaceId, command.testAttemptId],
        );
        if (existing !== null) {
          return write(
            {
              kind: "AVATAR_COMPATIBILITY_TEST_STARTED" as const,
              assessment: mapAvatarAssessment(existing),
              testAttempt: mapAvatarTestAttempt(existing),
              reservation: reserved.value
                .value as ExecutionContracts.AvatarProfileVersionTaskAttemptReservation,
            },
            true,
          );
        }
        await executor.query(
          `INSERT INTO avatar_compatibility_assessments (
             id, workspace_id, avatar_profile_version_id, execution_profile_id, state
           ) VALUES ($1, $2, $3, $4, 'RUNNING')`,
          [
            command.assessmentId,
            scope.workspaceId,
            command.versionId,
            command.reservation.attempt.executionProfileId,
          ],
        );
        await executor.query(
          `INSERT INTO avatar_profile_test_attempts (
             id, workspace_id, assessment_id, ordinal, idempotency_key, state,
             task_id, execution_attempt_id, reservation_cost_event_id, outbox_id,
             avatar_profile_version_id
           ) VALUES ($1, $2, $3, $4, $5, 'CREATED', $6, $7, $8, $9, $10)`,
          [
            command.testAttemptId,
            scope.workspaceId,
            command.assessmentId,
            command.reservation.attempt.ordinal,
            command.idempotencyKey,
            command.reservation.task.taskId,
            command.reservation.attempt.attemptId,
            command.reservation.costReservation.costEventId,
            command.reservation.dispatchOutbox.outboxId,
            command.versionId,
          ],
        );
        const inserted = await one(
          executor,
          `SELECT test.*, assessment.execution_profile_id,
                  assessment.created_at AS assessment_created_at,
                  assessment.updated_at AS assessment_updated_at,
                  assessment.state AS assessment_state
           FROM avatar_profile_test_attempts test
           JOIN avatar_compatibility_assessments assessment
             ON assessment.workspace_id = test.workspace_id AND assessment.id = test.assessment_id
           WHERE test.workspace_id = $1 AND test.id = $2`,
          [scope.workspaceId, command.testAttemptId],
        );
        if (inserted === null) throw new Error("avatar compatibility attempt disappeared");
        return write({
          kind: "AVATAR_COMPATIBILITY_TEST_STARTED" as const,
          assessment: mapAvatarAssessment(inserted),
          testAttempt: mapAvatarTestAttempt(inserted),
          reservation: reserved.value
            .value as ExecutionContracts.AvatarProfileVersionTaskAttemptReservation,
        });
      });
    },
    async archiveProfile(scope, command) {
      return context.atomic.run(async (executor) => {
        const profile = await findAvatarProfile(executor, scope.workspaceId, command.profileId);
        if (profile === null) return missing("AVATAR_PROFILE", command.profileId);
        if (profile.status === "ARCHIVED") {
          return profile.archivedAt === command.archivedAt
            ? write(profile, true)
            : conflict("STATE_CONFLICT", "avatar profile is already archived");
        }
        if (profile.updatedAt !== command.expectedUpdatedAt) {
          return conflict("EXPECTED_VERSION_MISMATCH", "avatar profile changed before archive");
        }
        await executor.query(
          `UPDATE avatar_profiles SET status = 'ARCHIVED', archived_at = $3, updated_at = $3
           WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, command.profileId, command.archivedAt],
        );
        const archived = await findAvatarProfile(executor, scope.workspaceId, command.profileId);
        if (archived === null) throw new Error("archived avatar profile disappeared");
        return write(archived);
      });
    },
  };
}

function mapAvatarAssessment(row: Row): PresetContracts.RunningAvatarCompatibilityAssessment {
  return {
    assessmentId: stringValue(row.assessment_id, "avatar_compatibility_assessments.id"),
    workspaceId: stringValue(row.workspace_id, "avatar_compatibility_assessments.workspace_id"),
    avatarProfileVersionId: stringValue(
      row.avatar_profile_version_id,
      "avatar_compatibility_assessments.avatar_profile_version_id",
    ),
    executionProfileId: stringValue(
      row.execution_profile_id,
      "avatar_compatibility_assessments.execution_profile_id",
    ),
    state: "RUNNING",
    modelSnapshotHash: null,
    evidenceDocument: null,
    evidenceHash: null,
    createdAt: timestamp(
      row.assessment_created_at ?? row.created_at,
      "avatar_compatibility_assessments.created_at",
    ),
    updatedAt: timestamp(
      row.assessment_updated_at ?? row.updated_at,
      "avatar_compatibility_assessments.updated_at",
    ),
    finishedAt: null,
  };
}

function mapAvatarTestAttempt(row: Row): PresetContracts.CreatedAvatarProfileTestAttempt {
  return {
    testAttemptId: stringValue(row.id, "avatar_profile_test_attempts.id"),
    workspaceId: stringValue(row.workspace_id, "avatar_profile_test_attempts.workspace_id"),
    avatarProfileVersionId: stringValue(
      row.avatar_profile_version_id,
      "avatar_profile_test_attempts.avatar_profile_version_id",
    ),
    assessmentId: stringValue(row.assessment_id, "avatar_profile_test_attempts.assessment_id"),
    executionAttemptId: stringValue(
      row.execution_attempt_id,
      "avatar_profile_test_attempts.execution_attempt_id",
    ),
    taskId: stringValue(row.task_id, "avatar_profile_test_attempts.task_id"),
    reservationCostEventId: stringValue(
      row.reservation_cost_event_id,
      "avatar_profile_test_attempts.reservation_cost_event_id",
    ),
    dispatchOutboxId: stringValue(row.outbox_id, "avatar_profile_test_attempts.outbox_id"),
    ordinal: numberValue(row.ordinal, "avatar_profile_test_attempts.ordinal"),
    idempotencyKey: stringValue(
      row.idempotency_key,
      "avatar_profile_test_attempts.idempotency_key",
    ) as PresetContracts.CreatedAvatarProfileTestAttempt["idempotencyKey"],
    state: "CREATED",
    externalJobId: null,
    outputAssetId: null,
    reportedCostMicroUsd: null,
    createdAt: timestamp(row.created_at, "avatar_profile_test_attempts.created_at"),
    startedAt: null,
    finishedAt: null,
  };
}

function mapImageStyleAnalysisAttempt(row: Row): PresetContracts.ImageStyleAnalysisAttempt {
  const state = stringValue(row.state, "image_style_analysis_attempts.state");
  const base: PresetContracts.ImageStyleAnalysisAttemptBase = {
    analysisAttemptId: stringValue(row.id, "image_style_analysis_attempts.id"),
    workspaceId: stringValue(row.workspace_id, "image_style_analysis_attempts.workspace_id"),
    styleVersionId: stringValue(
      row.style_version_id,
      "image_style_analysis_attempts.style_version_id",
    ),
    executionAttemptId: stringValue(
      row.execution_attempt_id,
      "image_style_analysis_attempts.execution_attempt_id",
    ),
    taskId: stringValue(row.task_id, "image_style_analysis_attempts.task_id"),
    reservationCostEventId: stringValue(
      row.reservation_cost_event_id,
      "image_style_analysis_attempts.reservation_cost_event_id",
    ),
    dispatchOutboxId: stringValue(row.outbox_id, "image_style_analysis_attempts.outbox_id"),
    ordinal: numberValue(row.ordinal, "image_style_analysis_attempts.ordinal"),
    idempotencyKey: stringValue(
      row.idempotency_key,
      "image_style_analysis_attempts.idempotency_key",
    ) as PresetContracts.CreatedImageStyleAnalysisAttempt["idempotencyKey"],
    requestHash: stringValue(
      row.request_hash,
      "image_style_analysis_attempts.request_hash",
    ) as Sha256,
    provider: stringValue(row.provider, "image_style_analysis_attempts.provider"),
    model: stringValue(row.model, "image_style_analysis_attempts.model"),
    modelRevision: stringValue(row.model_revision, "image_style_analysis_attempts.model_revision"),
  };
  if (state === "UNKNOWN") {
    return {
      ...base,
      state,
      responseHash: null,
      usagePayload:
        row.usage_payload === null
          ? null
          : jsonObject(row.usage_payload, "image_style_analysis_attempts.usage_payload"),
      reportedCostMicroUsd: nullableBigint(
        row.reported_cost_micro_usd,
        "image_style_analysis_attempts.reported_cost_micro_usd",
      ),
    };
  }
  if (!["CREATED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"].includes(state)) {
    throw new TypeError(`unexpected image_style_analysis_attempts.state ${state}`);
  }
  return {
    ...base,
    state: state as PresetContracts.NonUnknownImageStyleAnalysisAttempt["state"],
    responseHash: nullableString(
      row.response_hash,
      "image_style_analysis_attempts.response_hash",
    ) as Sha256 | null,
    usagePayload:
      row.usage_payload === null
        ? null
        : jsonObject(row.usage_payload, "image_style_analysis_attempts.usage_payload"),
    reportedCostMicroUsd: nullableBigint(
      row.reported_cost_micro_usd,
      "image_style_analysis_attempts.reported_cost_micro_usd",
    ),
  };
}

function createImageStyleRepository(
  context: RepositoryContext,
): PresetContracts.ImageStyleRepository {
  return {
    async resolveStyle(scope, styleId) {
      const style = await findImageStyle(context.executor, scope.workspaceId, styleId);
      return style === null ? missing("IMAGE_STYLE", styleId) : success(style);
    },
    async resolveVersion(scope, lookup) {
      const version = await findImageStyleVersion(
        context.executor,
        scope.workspaceId,
        lookup.styleId,
        lookup.versionId,
      );
      return version === null ? missing("IMAGE_STYLE_VERSION", lookup.versionId) : success(version);
    },
    async resolveAnalysisAttempt(scope, lookup) {
      const row = await one(
        context.executor,
        `SELECT analysis.*
           FROM image_style_analysis_attempts analysis
           JOIN image_style_versions version
             ON version.workspace_id = analysis.workspace_id
            AND version.id = analysis.style_version_id
          WHERE analysis.workspace_id = $1
            AND version.style_id = $2
            AND analysis.style_version_id = $3
            AND analysis.id = $4`,
        [scope.workspaceId, lookup.styleId, lookup.versionId, lookup.analysisAttemptId],
      );
      return row === null
        ? missing("IMAGE_STYLE_ANALYSIS_ATTEMPT", lookup.analysisAttemptId)
        : success(mapImageStyleAnalysisAttempt(row));
    },
    async resolveAcceptedAnalysisAttempt(scope, lookup) {
      const result = await context.executor.query<Row>(
        `SELECT analysis.*
           FROM image_style_analysis_attempts analysis
           JOIN image_style_versions version
             ON version.workspace_id = analysis.workspace_id
            AND version.id = analysis.style_version_id
          WHERE analysis.workspace_id = $1
            AND version.style_id = $2
            AND analysis.style_version_id = $3
            AND analysis.state = 'SUCCEEDED'
          ORDER BY analysis.ordinal ASC, analysis.id ASC
          LIMIT 2`,
        [scope.workspaceId, lookup.styleId, lookup.versionId],
      );
      if (result.rows.length === 0) {
        return missing("IMAGE_STYLE_ANALYSIS_ATTEMPT", lookup.versionId);
      }
      if (result.rows.length !== 1) {
        return invariant(
          "SNAPSHOT_MISMATCH",
          "Image Style version has multiple successful analysis attempts",
        );
      }
      const attempt = mapImageStyleAnalysisAttempt(result.rows[0]!);
      if (
        attempt.state !== "SUCCEEDED" ||
        attempt.responseHash === null ||
        attempt.usagePayload === null ||
        attempt.reportedCostMicroUsd === null ||
        !validImageStyleAnalysisUsage(attempt.usagePayload)
      ) {
        return invariant(
          "SNAPSHOT_MISMATCH",
          "accepted Image Style analysis attempt is incomplete",
        );
      }
      return success(attempt as PresetContracts.AcceptedImageStyleAnalysisAttempt);
    },
    async listStyles(scope, query) {
      const result = await context.executor.query<Row>(
        `SELECT * FROM image_styles
         WHERE workspace_id = $1 AND ($2 OR status = 'ACTIVE')
         ORDER BY normalized_name ASC, id ASC`,
        [scope.workspaceId, query.includeArchived],
      );
      return success(Object.freeze(result.rows.map(mapImageStyle)));
    },
    async listVersions(scope, styleId) {
      const style = await findImageStyle(context.executor, scope.workspaceId, styleId);
      if (style === null) return missing("IMAGE_STYLE", styleId);
      const result = await context.executor.query<Row>(
        `SELECT * FROM image_style_versions
         WHERE workspace_id = $1 AND style_id = $2
         ORDER BY version_number ASC, id ASC`,
        [scope.workspaceId, styleId],
      );
      return success(Object.freeze(result.rows.map(mapImageStyleVersion)));
    },
    async resolveReference(scope, lookup) {
      const reference = await findImageStyleReference(context.executor, scope.workspaceId, lookup);
      return reference === null
        ? missing("IMAGE_STYLE_REFERENCE", lookup.referenceId)
        : success(reference);
    },
    async listReferences(scope, lookup) {
      const version = await findImageStyleVersion(
        context.executor,
        scope.workspaceId,
        lookup.styleId,
        lookup.versionId,
      );
      if (version === null) return missing("IMAGE_STYLE_VERSION", lookup.versionId);
      const result = await context.executor.query<Row>(
        `SELECT * FROM image_style_references
         WHERE workspace_id = $1 AND style_id = $2 AND version_id = $3
         ORDER BY reference_order ASC, id ASC`,
        [scope.workspaceId, lookup.styleId, lookup.versionId],
      );
      return success(Object.freeze(result.rows.map(mapImageStyleReference)));
    },
    async resolveAnalysisReferenceSet(scope, lookup) {
      return resolveImageStyleAnalysisReferenceSetIn(context.executor, scope.workspaceId, lookup);
    },
    async createStyle(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findImageStyle(executor, scope.workspaceId, command.styleId);
        if (existing !== null) {
          return existing.createdByUserId === scope.actorUserId &&
            existing.name === command.name &&
            existing.normalizedName === command.normalizedName
            ? write(existing, true)
            : conflict("IDEMPOTENCY_KEY_REUSED", "image style identity changed on retry");
        }
        await executor.query(
          `INSERT INTO image_styles (id, workspace_id, name, normalized_name, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            command.styleId,
            scope.workspaceId,
            command.name,
            command.normalizedName,
            scope.actorUserId,
          ],
        );
        const inserted = await findImageStyle(executor, scope.workspaceId, command.styleId);
        if (inserted === null) throw new Error("inserted image style disappeared");
        return write(inserted);
      });
    },
    async createDraftVersion(scope, command) {
      return context.atomic.run(async (executor) => {
        const style = await findImageStyle(executor, scope.workspaceId, command.styleId);
        if (style === null) return missing("IMAGE_STYLE", command.styleId);
        if (style.status === "ARCHIVED") {
          return invariant("IMAGE_STYLE_ARCHIVED", "archived image styles reject drafts");
        }
        const existing = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (existing !== null) {
          return existing.versionNumber === command.versionNumber && existing.state === "DRAFT"
            ? write(existing, true)
            : conflict(
                "IMAGE_STYLE_VERSION_CONFLICT",
                "image style version identity already exists",
              );
        }
        await executor.query(
          `INSERT INTO image_style_versions (id, workspace_id, style_id, version_number, state)
           VALUES ($1, $2, $3, $4, 'DRAFT')`,
          [command.versionId, scope.workspaceId, command.styleId, command.versionNumber],
        );
        const inserted = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (inserted === null) throw new Error("inserted image style draft disappeared");
        return write(inserted as PresetContracts.ImageStyleDraftVersion);
      });
    },
    async attachReference(scope, command) {
      const problem = imageStyleReferenceCommandProblem(command);
      if (problem !== null) return invariant("IMAGE_STYLE_REFERENCE_INVALID", problem);
      return context.atomic.run(async (executor) => {
        const style = await findImageStyle(executor, scope.workspaceId, command.styleId);
        if (style === null) return missing("IMAGE_STYLE", command.styleId);
        if (style.status === "ARCHIVED") {
          return invariant("IMAGE_STYLE_ARCHIVED", "archived image styles reject references");
        }
        const version = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (version === null) return missing("IMAGE_STYLE_VERSION", command.versionId);
        if (version.state !== "DRAFT") {
          return invariant(
            "IMAGE_STYLE_REFERENCE_LOCKED",
            "references can attach only to an unanalyzed draft",
          );
        }
        if (await imageStyleHasAnalysisAttempt(executor, scope.workspaceId, command.versionId)) {
          return invariant(
            "IMAGE_STYLE_REFERENCE_LOCKED",
            "references are immutable after the first analysis attempt",
          );
        }
        const lookup = {
          styleId: command.styleId,
          versionId: command.versionId,
          referenceId: command.referenceId,
        };
        const existing = await findImageStyleReference(executor, scope.workspaceId, lookup);
        if (existing !== null) {
          return sameValue(
            {
              referenceId: existing.referenceId,
              styleId: existing.styleId,
              versionId: existing.versionId,
              originalAssetId: existing.originalAssetId,
              normalizedAssetId: existing.normalizedAssetId,
              referenceOrder: existing.referenceOrder,
              rightsBasis: existing.rightsBasis,
              rightsBasisNote: existing.rightsBasisNote,
              rightsAttestedByUserId: existing.rightsAttestedByUserId,
              rightsAttestedAt: existing.rightsAttestedAt,
              originalRetentionPolicy: existing.originalRetentionPolicy,
            },
            {
              referenceId: command.referenceId,
              styleId: command.styleId,
              versionId: command.versionId,
              originalAssetId: command.originalAssetId,
              normalizedAssetId: command.normalizedAssetId,
              referenceOrder: command.referenceOrder,
              rightsBasis: command.rightsBasis,
              rightsBasisNote: command.rightsBasisNote,
              rightsAttestedByUserId: scope.actorUserId,
              rightsAttestedAt: command.rightsAttestedAt,
              originalRetentionPolicy: command.originalRetentionPolicy,
            },
          )
            ? write(existing, true)
            : conflict(
                "IMAGE_STYLE_REFERENCE_CONFLICT",
                "reference identity already exists with different facts",
              );
        }
        const original = await findArtifact(executor, scope.workspaceId, command.originalAssetId);
        if (original === null) return missing("ASSET", command.originalAssetId);
        const normalized = await findArtifact(
          executor,
          scope.workspaceId,
          command.normalizedAssetId,
        );
        if (normalized === null) return missing("ASSET", command.normalizedAssetId);
        const originalProblem = styleReferenceArtifactProblem(original, "STYLE_REFERENCE_ORIGINAL");
        const normalizedProblem = styleReferenceArtifactProblem(
          normalized,
          "STYLE_REFERENCE_NORMALIZED",
        );
        if (originalProblem !== null || normalizedProblem !== null) {
          return invariant(
            "IMAGE_STYLE_REFERENCE_INVALID",
            originalProblem ?? normalizedProblem ?? "reference artifact is invalid",
          );
        }
        const collision = await one(
          executor,
          `SELECT reference.id
             FROM image_style_references reference
             JOIN assets normalized
               ON normalized.workspace_id = reference.workspace_id
              AND normalized.id = reference.normalized_asset_id
            WHERE reference.workspace_id = $1
              AND reference.style_id = $2
              AND reference.version_id = $3
              AND (
                reference.reference_order = $4 OR
                reference.original_asset_id = $5 OR
                reference.normalized_asset_id = $6 OR
                normalized.binary_sha256 = $7
              )
            LIMIT 1`,
          [
            scope.workspaceId,
            command.styleId,
            command.versionId,
            command.referenceOrder,
            command.originalAssetId,
            command.normalizedAssetId,
            normalized.binarySha256,
          ],
        );
        if (collision !== null) {
          return conflict(
            "IMAGE_STYLE_REFERENCE_CONFLICT",
            "reference order, artifact, or normalized hash is already bound",
          );
        }
        await executor.query(
          `INSERT INTO image_style_references (
             id, workspace_id, style_id, version_id,
             original_asset_id, normalized_asset_id, reference_order,
             rights_basis, rights_basis_note, rights_attested_by_user_id,
             rights_attested_at, original_retention_policy
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
          [
            command.referenceId,
            scope.workspaceId,
            command.styleId,
            command.versionId,
            command.originalAssetId,
            command.normalizedAssetId,
            command.referenceOrder,
            command.rightsBasis,
            command.rightsBasisNote,
            scope.actorUserId,
            command.rightsAttestedAt,
            command.originalRetentionPolicy,
          ],
        );
        const inserted = await findImageStyleReference(executor, scope.workspaceId, lookup);
        if (inserted === null) throw new Error("attached image style reference disappeared");
        return write(inserted);
      });
    },
    async detachReference(scope, command) {
      return context.atomic.run(async (executor) => {
        const lookup = {
          styleId: command.styleId,
          versionId: command.versionId,
          referenceId: command.referenceId,
        };
        const existing = await findImageStyleReference(executor, scope.workspaceId, lookup);
        if (existing === null) return missing("IMAGE_STYLE_REFERENCE", command.referenceId);
        const version = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (version === null) return missing("IMAGE_STYLE_VERSION", command.versionId);
        if (
          version.state !== "DRAFT" ||
          (await imageStyleHasAnalysisAttempt(executor, scope.workspaceId, command.versionId))
        ) {
          return invariant(
            "IMAGE_STYLE_REFERENCE_LOCKED",
            "references are immutable once analysis starts",
          );
        }
        await executor.query(
          `DELETE FROM image_style_references
           WHERE workspace_id = $1 AND style_id = $2 AND version_id = $3 AND id = $4`,
          [scope.workspaceId, command.styleId, command.versionId, command.referenceId],
        );
        return write(existing);
      });
    },
    async saveDraftVersion(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (existing === null) return missing("IMAGE_STYLE_VERSION", command.versionId);
        if (existing.state === "PUBLISHED" || existing.state === "ABANDONED") {
          return invariant("IMMUTABLE_RECORD", "published or abandoned image styles are immutable");
        }
        if (existing.updatedAt !== command.expectedUpdatedAt) {
          return conflict("EXPECTED_VERSION_MISMATCH", "image style draft changed before save");
        }
        const transitionAllowed =
          (existing.state === "DRAFT" && command.nextState === "DRAFT") ||
          (existing.state === "ANALYZING" &&
            (command.nextState === "NEEDS_REVIEW" || command.nextState === "FAILED")) ||
          (existing.state === "NEEDS_REVIEW" && command.nextState === "NEEDS_REVIEW") ||
          (existing.state === "FAILED" && command.nextState === "FAILED");
        if (!transitionAllowed) {
          return invariant(
            "INVALID_STATE_TRANSITION",
            `image style version cannot transition from ${existing.state} to ${command.nextState}`,
          );
        }
        if (command.nextState === "NEEDS_REVIEW") {
          if (!validImageStyleProfileDocument(command.profileDocument)) {
            return invariant(
              "IMAGE_STYLE_PROFILE_INVALID",
              "reviewable image style profile contract or canonical hash is invalid",
            );
          }
          if (command.disclosureAttestedByUserId === null) {
            return invariant(
              "IMAGE_STYLE_DISCLOSURE_REQUIRED",
              "reviewable image styles require recorded provider disclosure consent",
            );
          }
        } else if (command.profileDocument !== null) {
          return invariant(
            "IMAGE_STYLE_PROFILE_INVALID",
            "non-reviewable image style versions cannot expose a profile",
          );
        }
        if (existing.state === "DRAFT") {
          if (command.analyzerRequestHash !== null || command.analyzerModelSnapshot !== null) {
            return invariant(
              "SNAPSHOT_MISMATCH",
              "draft image styles cannot claim analyzer provenance before analysis begins",
            );
          }
        } else if (
          command.analyzerRequestHash !== existing.analyzerRequestHash ||
          command.analyzerModelSnapshot !== existing.analyzerModelSnapshot ||
          command.disclosureAttestedByUserId !== existing.disclosureAttestedByUserId
        ) {
          return invariant(
            "SNAPSHOT_MISMATCH",
            "image style analysis provenance or disclosure changed during completion/review",
          );
        }
        await executor.query(
          `UPDATE image_style_versions SET state = $4,
             profile_contract_name = $5, profile_contract_version = $6,
             profile_payload = $7::jsonb, style_profile_hash = $8,
             analyzer_request_hash = $9, analyzer_model_snapshot = $10,
             disclosure_attested_by_user_id = $11, updated_at = now()
           WHERE workspace_id = $1 AND style_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            command.styleId,
            command.versionId,
            command.nextState,
            command.profileDocument?.contractName ?? null,
            command.profileDocument?.contractVersion ?? null,
            command.profileDocument === null
              ? null
              : jsonParameter(command.profileDocument.payload),
            command.profileDocument?.canonicalDocumentSha256 ?? null,
            command.analyzerRequestHash,
            command.analyzerModelSnapshot,
            command.disclosureAttestedByUserId,
          ],
        );
        const updated = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (updated === null) throw new Error("saved image style draft disappeared");
        return write(updated as PresetContracts.ImageStyleDraftVersion);
      });
    },
    async publishVersion(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (existing === null) return missing("IMAGE_STYLE_VERSION", command.versionId);
        if (!validImageStyleProfileDocument(command.profileDocument)) {
          return invariant(
            "IMAGE_STYLE_PROFILE_INVALID",
            "published image style profile contract or canonical hash is invalid",
          );
        }
        if (existing.state === "PUBLISHED") {
          return sameValue(
            {
              profileDocument: existing.profileDocument,
              analyzerRequestHash: existing.analyzerRequestHash,
              analyzerModelSnapshot: existing.analyzerModelSnapshot,
              disclosureAttestedByUserId: existing.disclosureAttestedByUserId,
              publishedAt: existing.publishedAt,
            },
            {
              profileDocument: command.profileDocument,
              analyzerRequestHash: command.analyzerRequestHash,
              analyzerModelSnapshot: command.analyzerModelSnapshot,
              disclosureAttestedByUserId: command.disclosureAttestedByUserId,
              publishedAt: command.publishedAt,
            },
          )
            ? write(existing, true)
            : invariant("IMMUTABLE_RECORD", "published image style cannot be changed");
        }
        if (existing.state === "ABANDONED") {
          return invariant("IMAGE_STYLE_VERSION_NOT_PUBLISHABLE", "abandoned style cannot publish");
        }
        if (existing.state !== "NEEDS_REVIEW") {
          return invariant(
            "INVALID_STATE_TRANSITION",
            `image style version cannot publish from ${existing.state}`,
          );
        }
        if (existing.updatedAt !== command.expectedUpdatedAt) {
          return conflict("EXPECTED_VERSION_MISMATCH", "image style changed before publication");
        }
        if (
          !sameValue(existing.profileDocument, command.profileDocument) ||
          command.analyzerRequestHash !== existing.analyzerRequestHash ||
          command.analyzerModelSnapshot !== existing.analyzerModelSnapshot ||
          command.disclosureAttestedByUserId !== existing.disclosureAttestedByUserId
        ) {
          return invariant(
            "SNAPSHOT_MISMATCH",
            "publication must use the exact reviewed image style profile and provenance",
          );
        }
        const style = await findImageStyle(executor, scope.workspaceId, command.styleId);
        if (style === null) return missing("IMAGE_STYLE", command.styleId);
        if (style.status === "ARCHIVED") {
          return invariant("IMAGE_STYLE_ARCHIVED", "archived image styles cannot publish");
        }
        await executor.query(
          `UPDATE image_style_versions SET state = 'PUBLISHED',
             profile_contract_name = $4, profile_contract_version = $5,
             profile_payload = $6::jsonb, style_profile_hash = $7,
             analyzer_request_hash = $8, analyzer_model_snapshot = $9,
             disclosure_attested_by_user_id = $10, published_at = $11, updated_at = $11
           WHERE workspace_id = $1 AND style_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            command.styleId,
            command.versionId,
            command.profileDocument.contractName,
            command.profileDocument.contractVersion,
            jsonParameter(command.profileDocument.payload),
            command.profileDocument.canonicalDocumentSha256,
            command.analyzerRequestHash,
            command.analyzerModelSnapshot,
            command.disclosureAttestedByUserId,
            command.publishedAt,
          ],
        );
        await executor.query(
          `UPDATE image_styles SET active_version_id = $3, updated_at = $4
           WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, command.styleId, command.versionId, command.publishedAt],
        );
        const published = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (published === null || published.state !== "PUBLISHED") {
          throw new Error("published image style disappeared");
        }
        return write(published);
      });
    },
    async beginAnalysis(scope, command) {
      if (
        command.reservation.task.owner.ownerType !== "IMAGE_STYLE_VERSION" ||
        command.reservation.task.owner.ownerId !== command.versionId ||
        command.reservation.task.owner.imageStyleVersionId !== command.versionId
      ) {
        return invariant(
          "IMAGE_STYLE_ANALYSIS_BILLING_BOUNDARY_MISMATCH",
          "style analysis must bill its exact style version",
        );
      }
      return context.atomic.run(async (executor) => {
        const version = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (version === null) return missing("IMAGE_STYLE_VERSION", command.versionId);
        const existingAttempt = await one(
          executor,
          "SELECT * FROM image_style_analysis_attempts WHERE workspace_id = $1 AND id = $2",
          [scope.workspaceId, command.analysisAttemptId],
        );
        const reservationCommand = {
          ...command.reservation,
          idempotencyKey: command.idempotencyKey,
        };
        if (existingAttempt === null) {
          if (version.state !== "DRAFT" && version.state !== "FAILED") {
            return invariant(
              "INVALID_STATE_TRANSITION",
              `image style version cannot begin analysis from ${version.state}`,
            );
          }
          if (version.disclosureAttestedByUserId === null) {
            return invariant(
              "IMAGE_STYLE_DISCLOSURE_REQUIRED",
              "image style analysis requires recorded provider disclosure consent",
            );
          }
          const references = await resolveImageStyleAnalysisReferenceSetIn(
            executor,
            scope.workspaceId,
            { styleId: command.styleId, versionId: command.versionId },
          );
          if (!references.ok) return references;
        } else if (version.state !== "ANALYZING") {
          return conflict(
            "IMAGE_STYLE_ANALYSIS_CONFLICT",
            "existing image style analysis no longer owns the current version state",
          );
        }
        const reserved = await reserveTaskAttemptIn(executor, scope, reservationCommand);
        if (!reserved.ok) {
          return reserved as IdempotentRepositoryResult<
            never,
            PresetContracts.ImageStyleConflict,
            PresetContracts.ImageStyleMissing,
            PresetContracts.ImageStyleInvariant
          >;
        }
        if (existingAttempt !== null) {
          return write(
            {
              kind: "IMAGE_STYLE_ANALYSIS_STARTED" as const,
              version: version as PresetContracts.ImageStyleDraftVersion & {
                readonly state: "ANALYZING";
              },
              analysisAttempt: mapImageStyleAnalysisAttempt(
                existingAttempt,
              ) as PresetContracts.CreatedImageStyleAnalysisAttempt,
              reservation: reserved.value
                .value as ExecutionContracts.ImageStyleVersionTaskAttemptReservation,
            },
            true,
          );
        }
        await executor.query(
          `UPDATE image_style_versions SET state = 'ANALYZING',
             profile_contract_name = NULL, profile_contract_version = NULL,
             profile_payload = NULL, style_profile_hash = NULL,
             analyzer_request_hash = $4, analyzer_model_snapshot = $5, updated_at = now()
           WHERE workspace_id = $1 AND style_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            command.styleId,
            command.versionId,
            command.requestHash,
            imageStyleAnalyzerModelSnapshot(command),
          ],
        );
        await executor.query(
          `INSERT INTO image_style_analysis_attempts (
             id, workspace_id, style_version_id, ordinal, idempotency_key,
             request_hash, state, provider, model, model_revision,
             task_id, execution_attempt_id, reservation_cost_event_id, outbox_id
           ) VALUES ($1, $2, $3, $4, $5, $6, 'CREATED', $7, $8, $9, $10, $11, $12, $13)`,
          [
            command.analysisAttemptId,
            scope.workspaceId,
            command.versionId,
            command.reservation.attempt.ordinal,
            command.idempotencyKey,
            command.requestHash,
            command.provider,
            command.model,
            command.modelRevision,
            command.reservation.task.taskId,
            command.reservation.attempt.attemptId,
            command.reservation.costReservation.costEventId,
            command.reservation.dispatchOutbox.outboxId,
          ],
        );
        const inserted = await one(
          executor,
          "SELECT * FROM image_style_analysis_attempts WHERE workspace_id = $1 AND id = $2",
          [scope.workspaceId, command.analysisAttemptId],
        );
        if (inserted === null) throw new Error("image style analysis attempt disappeared");
        const analyzing = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (analyzing === null || analyzing.state !== "ANALYZING") {
          throw new Error("analyzing image style version disappeared");
        }
        return write({
          kind: "IMAGE_STYLE_ANALYSIS_STARTED" as const,
          version: analyzing as PresetContracts.ImageStyleDraftVersion & {
            readonly state: "ANALYZING";
          },
          analysisAttempt: mapImageStyleAnalysisAttempt(
            inserted,
          ) as PresetContracts.CreatedImageStyleAnalysisAttempt,
          reservation: reserved.value
            .value as ExecutionContracts.ImageStyleVersionTaskAttemptReservation,
        });
      });
    },
    async acceptAnalysisResult(scope, command) {
      if (
        !validImageStyleProfileDocument(command.profileDocument) ||
        imageStyleAnalysisKind(command.profileDocument.payload.analysis) !== "VISION_ANALYSIS" ||
        !validImageStyleAnalysisUsage(command.usagePayload) ||
        typeof command.reportedCostMicroUsd !== "bigint" ||
        command.reportedCostMicroUsd < 0n ||
        !UTC_TIMESTAMP.test(command.completedAt) ||
        command.objectKey.length < 1 ||
        command.objectKey.length > 600
      ) {
        return invariant(
          "IMAGE_STYLE_PROFILE_INVALID",
          "accepted analysis profile, usage, cost, object, or completion facts are invalid",
        );
      }
      return context.atomic.run(async (executor) => {
        const version = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (version === null) return missing("IMAGE_STYLE_VERSION", command.versionId);
        if (version.state === "PUBLISHED" || version.state === "ABANDONED") {
          return invariant("IMMUTABLE_RECORD", "immutable image style versions reject analysis");
        }

        const specializedRow = await one(
          executor,
          `SELECT analysis.*
             FROM image_style_analysis_attempts analysis
             JOIN image_style_versions version
               ON version.workspace_id = analysis.workspace_id
              AND version.id = analysis.style_version_id
            WHERE analysis.workspace_id = $1
              AND version.style_id = $2
              AND analysis.style_version_id = $3
              AND analysis.id = $4`,
          [scope.workspaceId, command.styleId, command.versionId, command.analysisAttemptId],
        );
        if (specializedRow === null) {
          return missing("IMAGE_STYLE_ANALYSIS_ATTEMPT", command.analysisAttemptId);
        }
        const specialized = mapImageStyleAnalysisAttempt(specializedRow);
        if (
          specialized.styleVersionId !== command.versionId ||
          specialized.taskId !== command.taskId ||
          specialized.executionAttemptId !== command.executionAttemptId ||
          specialized.provider !== DURABLE_STYLE_ANALYZER_PROVIDER ||
          specialized.model !== DURABLE_STYLE_ANALYZER_MODEL
        ) {
          return invariant(
            "SNAPSHOT_MISMATCH",
            "specialized Image Style analysis lineage or pinned model does not match",
          );
        }

        const references = await resolveImageStyleAnalysisReferenceSetIn(
          executor,
          scope.workspaceId,
          { styleId: command.styleId, versionId: command.versionId },
        );
        if (!references.ok) return references;
        const prepared = await composeDurableImageStyleAnalysisInput(
          scope.workspaceId,
          {
            styleId: command.styleId,
            versionId: command.versionId,
            analysisAttemptId: command.analysisAttemptId,
            taskId: command.taskId,
            executionAttemptId: command.executionAttemptId,
            provider: DURABLE_STYLE_ANALYZER_PROVIDER,
            model: DURABLE_STYLE_ANALYZER_MODEL,
            modelRevision: specialized.modelRevision,
          },
          references.value,
        );
        if (
          specialized.requestHash !== command.analyzerRequestHash ||
          command.analyzerRequestHash !== prepared.inputFingerprintHash ||
          command.referenceSetHash !== prepared.referenceSetHash ||
          command.analyzerModelSnapshot !== prepared.analyzerModelSnapshot ||
          version.analyzerRequestHash !== command.analyzerRequestHash ||
          version.analyzerModelSnapshot !== command.analyzerModelSnapshot ||
          version.disclosureAttestedByUserId !== command.disclosureAttestedByUserId
        ) {
          return invariant(
            "SNAPSHOT_MISMATCH",
            "analysis request, references, model, or disclosure provenance drifted",
          );
        }

        const firstAcceptance =
          version.state === "ANALYZING" &&
          version.profileDocument === null &&
          specialized.state === "CREATED" &&
          specialized.responseHash === null &&
          specialized.usagePayload === null &&
          specialized.reportedCostMicroUsd === null &&
          specializedRow.started_at === null &&
          specializedRow.finished_at === null &&
          specializedRow.problem_code === null;
        const exactReplay =
          version.state === "NEEDS_REVIEW" &&
          version.updatedAt === command.completedAt &&
          sameValue(version.profileDocument, command.profileDocument) &&
          specialized.state === "SUCCEEDED" &&
          specialized.responseHash === command.analyzerOutputHash &&
          sameValue(specialized.usagePayload, command.usagePayload) &&
          specialized.reportedCostMicroUsd === command.reportedCostMicroUsd &&
          nullableTimestamp(
            specializedRow.started_at,
            "image_style_analysis_attempts.started_at",
          ) === command.completedAt &&
          nullableTimestamp(
            specializedRow.finished_at,
            "image_style_analysis_attempts.finished_at",
          ) === command.completedAt &&
          specializedRow.problem_code === null;
        if (!firstAcceptance && !exactReplay) {
          return invariant(
            "INVALID_STATE_TRANSITION",
            "analysis acceptance requires the exact unfinished state or an exact replay",
          );
        }

        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        const general = await loadAttempt(executor, scope.workspaceId, command.executionAttemptId);
        if (general === null) return missing("ATTEMPT", command.executionAttemptId);
        const artifact = await findArtifact(executor, scope.workspaceId, command.outputAssetId);
        if (artifact === null) return missing("ASSET", command.outputAssetId);
        const canonicalBytes = new TextEncoder().encode(
          canonicalizeJson(command.profileDocument.payload),
        );
        if (
          task.owner.ownerType !== "IMAGE_STYLE_VERSION" ||
          task.owner.ownerId !== command.versionId ||
          task.owner.imageStyleVersionId !== command.versionId ||
          task.state !== "COMPLETE" ||
          task.acceptedAttemptId !== command.executionAttemptId ||
          task.finishedAt !== command.completedAt ||
          general.taskId !== command.taskId ||
          general.ordinal !== specialized.ordinal ||
          general.idempotencyKey !== specialized.idempotencyKey ||
          general.inputHash !== command.analyzerRequestHash ||
          general.state !== "SUCCEEDED" ||
          general.claimState !== "CLAIMED" ||
          general.resultDisposition !== "ACCEPTED" ||
          general.outputAssetId !== command.outputAssetId ||
          general.finishedAt !== command.completedAt ||
          !sameValue(general.providerDetails, imageStyleAnalysisProviderDetails(command)) ||
          artifact.projectId !== null ||
          artifact.projectRevisionId !== null ||
          artifact.sourceAttemptId !== command.executionAttemptId ||
          artifact.kind !== "CANONICAL_DOCUMENT" ||
          (artifact.state !== "VERIFIED" && artifact.state !== "ACCEPTED") ||
          artifact.objectKey !== command.objectKey ||
          artifact.contentType !== "application/json" ||
          artifact.binarySha256 !== command.profileDocument.canonicalDocumentSha256 ||
          artifact.canonicalContractName !== command.profileDocument.contractName ||
          artifact.canonicalContractVersion !== command.profileDocument.contractVersion ||
          artifact.canonicalDocumentSha256 !== command.profileDocument.canonicalDocumentSha256 ||
          artifact.byteSize !== BigInt(canonicalBytes.byteLength) ||
          artifact.widthPx !== null ||
          artifact.heightPx !== null ||
          artifact.durationMs !== null ||
          artifact.verifiedAt !== command.completedAt ||
          !sameValue(artifact.metadata, imageStyleAnalysisArtifactMetadata(command))
        ) {
          return invariant(
            "SNAPSHOT_MISMATCH",
            "accepted general attempt, canonical artifact, or analysis facts do not match",
          );
        }

        if (!exactReplay) {
          await executor.query(
            `UPDATE image_style_analysis_attempts
                SET state = 'SUCCEEDED', response_hash = $3, usage_payload = $4::jsonb,
                    reported_cost_micro_usd = $5, problem_code = NULL,
                    started_at = COALESCE(started_at, $6), finished_at = $6
              WHERE workspace_id = $1 AND id = $2 AND state = 'CREATED'`,
            [
              scope.workspaceId,
              command.analysisAttemptId,
              command.analyzerOutputHash,
              jsonParameter(command.usagePayload),
              command.reportedCostMicroUsd,
              command.completedAt,
            ],
          );
          await executor.query(
            `INSERT INTO image_style_profile_artifacts (
               id, workspace_id, style_id, version_id, origin,
               profile_contract_name, profile_contract_version, profile_payload, profile_hash,
               canonical_profile_json, root_source_artifact_id, root_source_artifact_hash,
               parent_artifact_id, parent_artifact_hash, source_analysis_evidence,
               source_analysis_attempt_id, source_analysis_output_asset_id, reference_aliases,
               created_by_user_id, created_at
             ) VALUES ($1, $2, $3, $1, 'VISION_ANALYSIS', $4, $5, $6::jsonb, $7, $8,
                       $1, $7, NULL, NULL, 'HISTORICAL_SOURCE_TRUTH', $9, $10,
                       (SELECT COALESCE(jsonb_agg(
                          to_jsonb('ref_' || lpad(reference_order::text, 2, '0'))
                          ORDER BY reference_order), '[]'::jsonb)
                          FROM image_style_references
                         WHERE workspace_id = $2 AND version_id = $1
                           AND retention_state <> 'DELETED'),
                       $11, $12)`,
            [
              command.versionId,
              scope.workspaceId,
              command.styleId,
              command.profileDocument.contractName,
              command.profileDocument.contractVersion,
              jsonParameter(command.profileDocument.payload),
              command.profileDocument.canonicalDocumentSha256,
              canonicalizeJson(command.profileDocument.payload),
              command.analysisAttemptId,
              command.outputAssetId,
              scope.actorUserId,
              command.completedAt,
            ],
          );
          await executor.query(
            `UPDATE image_style_versions
                SET state = 'NEEDS_REVIEW', profile_contract_name = $4,
                    profile_contract_version = $5, profile_payload = $6::jsonb,
                    style_profile_hash = $7, root_profile_artifact_id = $3,
                    current_profile_artifact_id = $3, review_snapshot_id = $9,
                    review_invalidated_at = NULL, updated_at = $8
              WHERE workspace_id = $1 AND style_id = $2 AND id = $3 AND state = 'ANALYZING'`,
            [
              scope.workspaceId,
              command.styleId,
              command.versionId,
              command.profileDocument.contractName,
              command.profileDocument.contractVersion,
              jsonParameter(command.profileDocument.payload),
              command.profileDocument.canonicalDocumentSha256,
              command.completedAt,
              command.analysisAttemptId,
            ],
          );
        }

        const acceptedVersion = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        const acceptedAttemptRow = await one(
          executor,
          "SELECT * FROM image_style_analysis_attempts WHERE workspace_id = $1 AND id = $2",
          [scope.workspaceId, command.analysisAttemptId],
        );
        if (
          acceptedVersion === null ||
          acceptedVersion.state !== "NEEDS_REVIEW" ||
          acceptedAttemptRow === null
        ) {
          throw new Error("accepted Image Style analysis result disappeared");
        }
        const acceptedAttempt = mapImageStyleAnalysisAttempt(acceptedAttemptRow);
        if (
          acceptedAttempt.state !== "SUCCEEDED" ||
          acceptedAttempt.responseHash === null ||
          acceptedAttempt.usagePayload === null ||
          acceptedAttempt.reportedCostMicroUsd === null
        ) {
          throw new Error("accepted Image Style specialized attempt disappeared");
        }
        return write(
          {
            kind: "IMAGE_STYLE_ANALYSIS_RESULT_ACCEPTED" as const,
            version: acceptedVersion as PresetContracts.ImageStyleDraftVersion & {
              readonly state: "NEEDS_REVIEW";
            },
            analysisAttempt:
              acceptedAttempt as PresetContracts.AcceptedImageStyleAnalysisResult["analysisAttempt"],
            outputAssetId: command.outputAssetId,
            referenceSetHash: command.referenceSetHash,
          },
          exactReplay,
        );
      });
    },
    async abandonVersion(scope, command) {
      return context.atomic.run(async (executor) => {
        const existing = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (existing === null) return missing("IMAGE_STYLE_VERSION", command.versionId);
        if (existing.state === "ABANDONED") {
          return existing.abandonedAt === command.abandonedAt
            ? write(existing, true)
            : conflict("STATE_CONFLICT", "image style version is already abandoned");
        }
        if (existing.state === "PUBLISHED") {
          return invariant(
            "IMMUTABLE_RECORD",
            "published image style versions cannot be abandoned",
          );
        }
        if (existing.state === "ANALYZING") {
          return invariant(
            "INVALID_STATE_TRANSITION",
            "running image style analysis must settle or cancel before abandonment",
          );
        }
        if (existing.updatedAt !== command.expectedUpdatedAt) {
          return conflict("EXPECTED_VERSION_MISMATCH", "image style changed before abandonment");
        }
        await executor.query(
          `UPDATE image_style_versions
           SET state = 'ABANDONED', abandoned_at = $4, updated_at = $4
           WHERE workspace_id = $1 AND style_id = $2 AND id = $3`,
          [scope.workspaceId, command.styleId, command.versionId, command.abandonedAt],
        );
        const abandoned = await findImageStyleVersion(
          executor,
          scope.workspaceId,
          command.styleId,
          command.versionId,
        );
        if (abandoned === null || abandoned.state !== "ABANDONED") {
          throw new Error("abandoned image style version disappeared");
        }
        return write(abandoned);
      });
    },
    async resolveExactPublishedVersion(scope, lookup) {
      const version = await findImageStyleVersion(
        context.executor,
        scope.workspaceId,
        lookup.styleId,
        lookup.versionId,
      );
      if (version === null) return missing("IMAGE_STYLE_VERSION", lookup.versionId);
      if (version.state !== "PUBLISHED") {
        return invariant(
          "IMAGE_STYLE_VERSION_NOT_PUBLISHED",
          "requested image style is not published",
        );
      }
      const style = await findImageStyle(context.executor, scope.workspaceId, lookup.styleId);
      if (style === null) return missing("IMAGE_STYLE", lookup.styleId);
      if (lookup.use === "NEW_REVISION" && style.status === "ARCHIVED") {
        return invariant(
          "IMAGE_STYLE_ARCHIVED",
          "archived image style cannot enter a new revision",
        );
      }
      return success(version);
    },
    async archiveStyle(scope, command) {
      return context.atomic.run(async (executor) => {
        const style = await findImageStyle(executor, scope.workspaceId, command.styleId);
        if (style === null) return missing("IMAGE_STYLE", command.styleId);
        if (style.status === "ARCHIVED") {
          return style.archivedAt === command.archivedAt
            ? write(style, true)
            : conflict("STATE_CONFLICT", "image style is already archived");
        }
        if (style.updatedAt !== command.expectedUpdatedAt) {
          return conflict("EXPECTED_VERSION_MISMATCH", "image style changed before archive");
        }
        await executor.query(
          `UPDATE image_styles SET status = 'ARCHIVED', archived_at = $3, updated_at = $3
           WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, command.styleId, command.archivedAt],
        );
        const archived = await findImageStyle(executor, scope.workspaceId, command.styleId);
        if (archived === null) throw new Error("archived image style disappeared");
        return write(archived);
      });
    },
  };
}

async function ownerExists(
  executor: SqlExecutor,
  workspaceId: string,
  owner: DurableOwner,
): Promise<boolean> {
  const table =
    owner.ownerType === "PROJECT_REVISION"
      ? "project_revisions"
      : owner.ownerType === "IMAGE_STYLE_VERSION"
        ? "image_style_versions"
        : "avatar_profile_versions";
  const row = await one(executor, `SELECT id FROM ${table} WHERE workspace_id = $1 AND id = $2`, [
    workspaceId,
    owner.ownerId,
  ]);
  return row !== null;
}

function reservationFingerprint(
  reservation: ExecutionContracts.AtomicTaskAttemptReservation,
): unknown {
  return {
    task: {
      taskId: reservation.task.taskId,
      owner: reservation.task.owner,
      taskKey: reservation.task.taskKey,
      lane: reservation.task.lane,
      required: reservation.task.required,
      dependsOn: reservation.task.dependsOn,
    },
    attempt: {
      attemptId: reservation.attempt.attemptId,
      ordinal: reservation.attempt.ordinal,
      idempotencyKey: reservation.attempt.idempotencyKey,
      executionProfileId: reservation.attempt.executionProfileId,
      executionClaimTokenHash: reservation.attempt.executionClaimTokenHash,
      inputHash: reservation.attempt.inputHash,
      parentAttemptId: reservation.attempt.parentAttemptId,
      fallbackReason: reservation.attempt.fallbackReason,
    },
    costReservation: {
      costEventId: reservation.costReservation.costEventId,
      sequence: reservation.costReservation.sequence,
      amountMicroUsd: reservation.costReservation.amountMicroUsd,
      idempotencyKey: reservation.costReservation.idempotencyKey,
      details: reservation.costReservation.details,
      occurredAt: reservation.costReservation.occurredAt,
    },
    dispatchOutbox: {
      outboxId: reservation.dispatchOutbox.outboxId,
      dedupeKey: reservation.dispatchOutbox.dedupeKey,
      payloadContractName: reservation.dispatchOutbox.payloadContractName,
      payloadContractVersion: reservation.dispatchOutbox.payloadContractVersion,
      payloadHash: reservation.dispatchOutbox.payloadHash,
      payload: reservation.dispatchOutbox.payload,
      availableAt: reservation.dispatchOutbox.availableAt,
    },
  };
}

function commandFingerprint(command: ExecutionContracts.ReserveTaskAttemptCommand): unknown {
  return {
    task: {
      taskId: command.task.taskId,
      owner: command.task.owner,
      taskKey: command.task.taskKey,
      lane: command.task.lane,
      required: command.task.required,
      dependsOn: command.task.dependsOn,
    },
    attempt: command.attempt,
    costReservation: command.costReservation,
    dispatchOutbox: command.dispatchOutbox,
  };
}

async function loadReservation(
  executor: SqlExecutor,
  workspaceId: string,
  attemptId: string,
): Promise<ExecutionContracts.AtomicTaskAttemptReservation | null> {
  const attempt = await loadAttempt(executor, workspaceId, attemptId);
  if (attempt === null) return null;
  const task = await loadTask(executor, workspaceId, attempt.taskId);
  const costRow = await one(
    executor,
    `SELECT cost.*, task.project_revision_id, task.image_style_version_id,
            task.avatar_profile_version_id
     FROM cost_events cost
     JOIN generation_tasks task
       ON task.workspace_id = cost.workspace_id AND task.id = cost.task_id
     WHERE cost.workspace_id = $1 AND cost.task_id = $2 AND cost.attempt_id = $3
       AND cost.event_type = 'RESERVED'`,
    [workspaceId, attempt.taskId, attemptId],
  );
  const outboxRow = await one(
    executor,
    `SELECT * FROM outbox WHERE workspace_id = $1 AND task_id = $2 AND attempt_id = $3
       AND kind = 'DISPATCH'`,
    [workspaceId, attempt.taskId, attemptId],
  );
  if (task === null || costRow === null || outboxRow === null) {
    throw new Error("atomic reservation is missing a task, cost, or dispatch row");
  }
  return {
    task,
    attempt: attempt as ExecutionContracts.ReservedAttemptRecord,
    costReservation: mapCostEvent(costRow) as ExecutionContracts.ReservedCostEventRecord,
    dispatchOutbox: mapOutbox(outboxRow) as ExecutionContracts.PendingDispatchOutboxRecord,
  };
}

async function reserveTaskAttemptIn(
  executor: SqlExecutor,
  scope: WorkspaceScope,
  command: ExecutionContracts.ReserveTaskAttemptCommand,
): Promise<
  IdempotentRepositoryResult<
    ExecutionContracts.AtomicTaskAttemptReservation,
    ExecutionContracts.ExecutionConflict,
    ExecutionContracts.ExecutionMissing,
    ExecutionContracts.ExecutionInvariant
  >
> {
  if (command.idempotencyKey !== command.attempt.idempotencyKey) {
    return invariant(
      "INVALID_IDEMPOTENCY_KEY",
      "reservation key must equal the durable attempt retry key",
    );
  }
  if (command.costReservation.amountMicroUsd < 0n) {
    return invariant("INVALID_MONEY", "cost reservations cannot be negative");
  }
  if (
    !Number.isSafeInteger(command.attempt.ordinal) ||
    command.attempt.ordinal < 1 ||
    command.attempt.ordinal > MAX_TASK_ATTEMPTS
  ) {
    return invariant(
      "INVALID_STATE_TRANSITION",
      `attempt ordinal must be between 1 and ${MAX_TASK_ATTEMPTS}`,
    );
  }
  if (
    command.task.owner.ownerId !==
    (command.task.owner.ownerType === "PROJECT_REVISION"
      ? command.task.owner.projectRevisionId
      : command.task.owner.ownerType === "IMAGE_STYLE_VERSION"
        ? command.task.owner.imageStyleVersionId
        : command.task.owner.avatarProfileVersionId)
  ) {
    return invariant("OWNER_REFERENCE_MISMATCH", "task owner discriminator is inconsistent");
  }
  const replayRow = await one(
    executor,
    "SELECT id FROM attempts WHERE workspace_id = $1 AND idempotency_key = $2",
    [scope.workspaceId, command.idempotencyKey],
  );
  if (replayRow !== null) {
    const existing = await loadReservation(
      executor,
      scope.workspaceId,
      stringValue(replayRow.id, "attempts.id"),
    );
    if (existing === null) throw new Error("attempt retry row disappeared");
    return sameValue(reservationFingerprint(existing), commandFingerprint(command))
      ? write(existing, true)
      : conflict("IDEMPOTENCY_KEY_REUSED", "reservation retry key changed its input fingerprint");
  }
  if (!(await ownerExists(executor, scope.workspaceId, command.task.owner))) {
    return invariant("OWNER_REFERENCE_MISMATCH", "task owner does not exist in this workspace");
  }
  const executionProfile = await one(
    executor,
    "SELECT id FROM execution_profiles WHERE workspace_id = $1 AND id = $2 AND state = 'TESTED'",
    [scope.workspaceId, command.attempt.executionProfileId],
  );
  if (executionProfile === null) {
    return missing("EXECUTION_PROFILE", command.attempt.executionProfileId);
  }
  let task = await loadTask(executor, scope.workspaceId, command.task.taskId);
  if (task === null) {
    const [projectRevisionId, imageStyleVersionId, avatarProfileVersionId] = ownerColumns(
      command.task.owner,
    );
    await executor.query(
      `INSERT INTO generation_tasks (
         id, workspace_id, owner_type, owner_id, project_revision_id,
         image_style_version_id, avatar_profile_version_id, task_key, lane,
         state, required, depends_on
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`,
      [
        command.task.taskId,
        scope.workspaceId,
        command.task.owner.ownerType,
        command.task.owner.ownerId,
        projectRevisionId,
        imageStyleVersionId,
        avatarProfileVersionId,
        command.task.taskKey,
        command.task.lane,
        command.task.initialState,
        command.task.required,
        jsonParameter(command.task.dependsOn),
      ],
    );
    task = await loadTask(executor, scope.workspaceId, command.task.taskId);
    if (task === null) throw new Error("reserved task disappeared");
  } else if (
    !sameValue(task.owner, command.task.owner) ||
    task.taskKey !== command.task.taskKey ||
    task.lane !== command.task.lane ||
    task.required !== command.task.required ||
    !sameValue(task.dependsOn, command.task.dependsOn)
  ) {
    return conflict("TASK_KEY_EXISTS", "existing task identity does not match reservation input");
  }
  if (
    task.state === "CANCEL_REQUESTED" ||
    task.state === "COMPLETE" ||
    task.state === "CANCELLED" ||
    task.state === "FAILED"
  ) {
    return conflict("STATE_CONFLICT", "cancelling or terminal tasks reject new attempts");
  }
  const attemptCount = await one(
    executor,
    `SELECT count(*)::int AS count FROM attempts
     WHERE workspace_id = $1 AND task_id = $2`,
    [scope.workspaceId, command.task.taskId],
  );
  if (
    attemptCount === null ||
    numberValue(attemptCount.count, "attempts.task_count") >= MAX_TASK_ATTEMPTS
  ) {
    return conflict("STATE_CONFLICT", `task reached the ${MAX_TASK_ATTEMPTS}-attempt limit`);
  }
  const conflictingAttempt = await one(
    executor,
    `SELECT id FROM attempts WHERE workspace_id = $1
       AND (id = $2 OR (task_id = $3 AND ordinal = $4))`,
    [scope.workspaceId, command.attempt.attemptId, command.task.taskId, command.attempt.ordinal],
  );
  if (conflictingAttempt !== null) {
    return conflict("ALREADY_EXISTS", "attempt identity or ordinal already exists");
  }
  const latestCost = await one(
    executor,
    `SELECT max(sequence) AS sequence FROM cost_events
     WHERE workspace_id = $1 AND owner_type = $2 AND owner_id = $3`,
    [scope.workspaceId, command.task.owner.ownerType, command.task.owner.ownerId],
  );
  if (
    latestCost !== null &&
    latestCost.sequence !== null &&
    command.costReservation.sequence <=
      numberValue(latestCost.sequence, "cost_events.max(sequence)")
  ) {
    return invariant(
      "SNAPSHOT_MISMATCH",
      "cost reservation sequence must strictly increase for its owner",
    );
  }
  await executor.query(
    `INSERT INTO attempts (
       id, workspace_id, task_id, ordinal, idempotency_key, state,
       dispatch_state, claim_state, execution_profile_id, execution_claim_token_hash,
       input_hash, parent_attempt_id, fallback_reason
     ) VALUES ($1, $2, $3, $4, $5, 'CREATED', 'NOT_SENT', 'UNCLAIMED', $6, $7, $8, $9, $10)`,
    [
      command.attempt.attemptId,
      scope.workspaceId,
      command.task.taskId,
      command.attempt.ordinal,
      command.attempt.idempotencyKey,
      command.attempt.executionProfileId,
      command.attempt.executionClaimTokenHash,
      command.attempt.inputHash,
      command.attempt.parentAttemptId,
      command.attempt.fallbackReason,
    ],
  );
  await executor.query(
    `INSERT INTO cost_events (
       id, workspace_id, owner_type, owner_id, task_id, attempt_id,
       sequence, event_type, amount_micro_usd, idempotency_key, details, occurred_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'RESERVED', $8, $9, $10::jsonb, $11)`,
    [
      command.costReservation.costEventId,
      scope.workspaceId,
      command.task.owner.ownerType,
      command.task.owner.ownerId,
      command.task.taskId,
      command.attempt.attemptId,
      command.costReservation.sequence,
      command.costReservation.amountMicroUsd,
      command.costReservation.idempotencyKey,
      jsonParameter(command.costReservation.details),
      command.costReservation.occurredAt,
    ],
  );
  await executor.query(
    `INSERT INTO outbox (
       id, workspace_id, task_id, attempt_id, kind, state, dedupe_key,
       payload_contract_name, payload_contract_version, payload_hash, payload, available_at
     ) VALUES ($1, $2, $3, $4, 'DISPATCH', 'PENDING', $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      command.dispatchOutbox.outboxId,
      scope.workspaceId,
      command.task.taskId,
      command.attempt.attemptId,
      command.dispatchOutbox.dedupeKey,
      command.dispatchOutbox.payloadContractName,
      command.dispatchOutbox.payloadContractVersion,
      command.dispatchOutbox.payloadHash,
      jsonParameter(command.dispatchOutbox.payload),
      command.dispatchOutbox.availableAt,
    ],
  );
  const inserted = await loadReservation(executor, scope.workspaceId, command.attempt.attemptId);
  if (inserted === null) throw new Error("atomic reservation disappeared");
  return write(inserted);
}

function createExecutionRepository(
  context: RepositoryContext,
): ExecutionContracts.ExecutionRepository {
  return {
    async reserveTaskAttempt(scope, command) {
      return context.atomic.run((executor) => reserveTaskAttemptIn(executor, scope, command));
    },
    async claimExecution(scope, command) {
      return context.atomic.run(async (executor) => {
        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        if (task.state === "CANCELLED" || task.state === "COMPLETE" || task.state === "FAILED") {
          return conflict("STATE_CONFLICT", "terminal tasks reject execution claims");
        }
        const attempt = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (attempt === null) return missing("ATTEMPT", command.attemptId);
        if (attempt.taskId !== command.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
        if (attempt.executionClaimTokenHash !== command.presentedClaimTokenHash) {
          return invariant("CLAIM_TOKEN_MISMATCH", "execution claim token hash did not match");
        }
        if (attempt.claimState === "CLAIMED") {
          return attempt.claimedAt === command.claimedAt
            ? write(
                {
                  kind: "EXECUTION_CLAIM" as const,
                  completion: "NOT_ACCEPTED" as const,
                  taskId: command.taskId,
                  attemptId: command.attemptId,
                  claimState: "CLAIMED" as const,
                  claimedAt: command.claimedAt,
                },
                true,
              )
            : conflict("CLAIM_ALREADY_CONSUMED", "execution claim is single use");
        }
        if (task.version !== command.expectedTaskVersion) {
          return conflict(
            "EXPECTED_VERSION_MISMATCH",
            "task version changed before execution claim",
            task.version,
          );
        }
        if (task.state === "BLOCKED" || task.state === "CANCEL_REQUESTED") {
          return conflict("STATE_CONFLICT", "blocked or cancelling work cannot be claimed");
        }
        if (
          attempt.finishedAt !== null ||
          attempt.resultDisposition !== "PENDING" ||
          (attempt.state !== "CREATED" && attempt.state !== "RUNNING") ||
          (attempt.dispatchState !== "ACKNOWLEDGED" && attempt.dispatchState !== "RECONCILED")
        ) {
          return conflict(
            "STATE_CONFLICT",
            "only an unfinished dispatched attempt can acquire an execution claim",
          );
        }
        await executor.query(
          `UPDATE attempts SET claim_state = 'CLAIMED', state = 'CLAIMED', claimed_at = $4
           WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
          [scope.workspaceId, command.taskId, command.attemptId, command.claimedAt],
        );
        await executor.query(
          `UPDATE generation_tasks SET state = 'RUNNING', version = version + 1, updated_at = $3
           WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, command.taskId, command.claimedAt],
        );
        return write({
          kind: "EXECUTION_CLAIM" as const,
          completion: "NOT_ACCEPTED" as const,
          taskId: command.taskId,
          attemptId: command.attemptId,
          claimState: "CLAIMED" as const,
          claimedAt: command.claimedAt,
        });
      });
    },
    async recordDispatchAcknowledged(scope, command) {
      return context.atomic.run(async (executor) => {
        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        if (
          task.state === "CANCEL_REQUESTED" ||
          task.state === "CANCELLED" ||
          task.state === "COMPLETE" ||
          task.state === "FAILED"
        ) {
          return conflict(
            "STATE_CONFLICT",
            "cancelling or terminal tasks reject dispatch acknowledgement",
          );
        }
        const attempt = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (attempt === null) return missing("ATTEMPT", command.attemptId);
        if (attempt.taskId !== command.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
        if (attempt.dispatchState === "ACKNOWLEDGED") {
          return attempt.externalJobId === command.externalJobId &&
            sameValue(attempt.providerDetails, command.providerDetails)
            ? write(
                {
                  kind: "PROVIDER_DISPATCH_ACKNOWLEDGED" as const,
                  completion: "NOT_ACCEPTED" as const,
                  taskId: command.taskId,
                  attemptId: command.attemptId,
                  dispatchState: "ACKNOWLEDGED" as const,
                  externalJobId: command.externalJobId,
                  acknowledgedAt: command.acknowledgedAt,
                },
                true,
              )
            : conflict(
                "STATE_CONFLICT",
                "dispatch acknowledgement conflicts with stored provider job",
              );
        }
        if (attempt.dispatchState === "AMBIGUOUS") {
          return invariant(
            "DISPATCH_REQUIRES_RECONCILIATION",
            "ambiguous dispatch must reconcile before acknowledgement",
          );
        }
        if (
          attempt.finishedAt !== null ||
          attempt.resultDisposition !== "PENDING" ||
          attempt.state !== "CREATED" ||
          attempt.claimState !== "UNCLAIMED" ||
          (attempt.dispatchState !== "NOT_SENT" && attempt.dispatchState !== "SENDING")
        ) {
          return conflict(
            "STATE_CONFLICT",
            "only an unfinished undispatched attempt can acknowledge dispatch",
          );
        }
        const duplicateJob = await one(
          executor,
          "SELECT id FROM attempts WHERE workspace_id = $1 AND external_job_id = $2 AND id <> $3",
          [scope.workspaceId, command.externalJobId, command.attemptId],
        );
        if (duplicateJob !== null) {
          return conflict(
            "EXTERNAL_JOB_ID_EXISTS",
            "provider job is already linked to another attempt",
          );
        }
        await executor.query(
          `UPDATE attempts SET dispatch_state = 'ACKNOWLEDGED', external_job_id = $4,
             provider_details = $5::jsonb, state = CASE WHEN state = 'CREATED' THEN 'RUNNING' ELSE state END,
             started_at = COALESCE(started_at, $6)
           WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            command.taskId,
            command.attemptId,
            command.externalJobId,
            jsonParameter(command.providerDetails),
            command.acknowledgedAt,
          ],
        );
        return write({
          kind: "PROVIDER_DISPATCH_ACKNOWLEDGED" as const,
          completion: "NOT_ACCEPTED" as const,
          taskId: command.taskId,
          attemptId: command.attemptId,
          dispatchState: "ACKNOWLEDGED" as const,
          externalJobId: command.externalJobId,
          acknowledgedAt: command.acknowledgedAt,
        });
      });
    },
    async recordDispatchAckUnknown(scope, command) {
      return context.atomic.run(async (executor) => {
        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        if (
          task.state === "CANCEL_REQUESTED" ||
          task.state === "CANCELLED" ||
          task.state === "COMPLETE" ||
          task.state === "FAILED"
        ) {
          return conflict(
            "STATE_CONFLICT",
            "cancelling or terminal tasks reject dispatch ambiguity",
          );
        }
        const attempt = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (attempt === null) return missing("ATTEMPT", command.attemptId);
        if (attempt.taskId !== command.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
        if (attempt.dispatchState === "AMBIGUOUS") {
          return write(
            {
              kind: "PROVIDER_DISPATCH_ACK_UNKNOWN" as const,
              completion: "NOT_ACCEPTED" as const,
              taskId: command.taskId,
              attemptId: command.attemptId,
              dispatchState: "AMBIGUOUS" as const,
              observedAt: command.observedAt,
            },
            true,
          );
        }
        if (attempt.dispatchState === "ACKNOWLEDGED" || attempt.dispatchState === "RECONCILED") {
          return conflict(
            "STATE_CONFLICT",
            "a confirmed or reconciled dispatch cannot be downgraded to ambiguous",
          );
        }
        if (
          attempt.finishedAt !== null ||
          attempt.resultDisposition !== "PENDING" ||
          attempt.state !== "CREATED" ||
          attempt.claimState !== "UNCLAIMED" ||
          (attempt.dispatchState !== "NOT_SENT" && attempt.dispatchState !== "SENDING")
        ) {
          return conflict(
            "STATE_CONFLICT",
            "only an unfinished undispatched attempt can become ambiguous",
          );
        }
        await executor.query(
          `UPDATE attempts SET dispatch_state = 'AMBIGUOUS', provider_details = $4::jsonb,
             problem_code = $5 WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            command.taskId,
            command.attemptId,
            jsonParameter(command.providerDetails),
            command.ambiguityReason,
          ],
        );
        await executor.query(
          `UPDATE generation_tasks SET state = 'BLOCKED', version = version + 1, updated_at = $3
           WHERE workspace_id = $1 AND id = $2
             AND state NOT IN ('CANCEL_REQUESTED', 'CANCELLED', 'COMPLETE', 'FAILED')`,
          [scope.workspaceId, command.taskId, command.observedAt],
        );
        return write({
          kind: "PROVIDER_DISPATCH_ACK_UNKNOWN" as const,
          completion: "NOT_ACCEPTED" as const,
          taskId: command.taskId,
          attemptId: command.attemptId,
          dispatchState: "AMBIGUOUS" as const,
          observedAt: command.observedAt,
        });
      });
    },
    async reconcileDispatch(scope, command) {
      return context.atomic.run(async (executor) => {
        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        if (
          task.state === "CANCEL_REQUESTED" ||
          task.state === "CANCELLED" ||
          task.state === "COMPLETE" ||
          task.state === "FAILED"
        ) {
          return conflict(
            "STATE_CONFLICT",
            "cancelling or terminal tasks reject dispatch reconciliation",
          );
        }
        const attempt = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (attempt === null) return missing("ATTEMPT", command.attemptId);
        if (attempt.taskId !== command.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
        if (attempt.dispatchState !== "AMBIGUOUS") {
          return conflict("STATE_CONFLICT", "only ambiguous dispatches can reconcile");
        }
        if (
          attempt.finishedAt !== null ||
          attempt.resultDisposition !== "PENDING" ||
          attempt.claimState !== "UNCLAIMED" ||
          (attempt.state !== "CREATED" && attempt.state !== "UNKNOWN")
        ) {
          return conflict("STATE_CONFLICT", "terminal attempts reject dispatch reconciliation");
        }
        const nextDispatchState =
          command.evidence.outcome === "STILL_UNKNOWN"
            ? "AMBIGUOUS"
            : command.evidence.outcome === "NOT_DISPATCHED_CONFIRMED"
              ? "NOT_SENT"
              : "RECONCILED";
        const nextAttemptState =
          command.evidence.outcome === "ACKNOWLEDGEMENT_CONFIRMED"
            ? "RUNNING"
            : command.evidence.outcome === "NOT_DISPATCHED_CONFIRMED"
              ? "CREATED"
              : attempt.state;
        const externalJobId =
          command.evidence.outcome === "ACKNOWLEDGEMENT_CONFIRMED"
            ? command.evidence.externalJobId
            : command.evidence.outcome === "NOT_DISPATCHED_CONFIRMED"
              ? null
              : attempt.externalJobId;
        await executor.query(
          `UPDATE attempts SET dispatch_state = $4, state = $5,
           claim_state = CASE WHEN $4 = 'NOT_SENT' THEN 'UNCLAIMED' ELSE claim_state END,
           claimed_at = CASE WHEN $4 = 'NOT_SENT' THEN NULL ELSE claimed_at END,
           started_at = CASE WHEN $4 = 'NOT_SENT' THEN NULL ELSE started_at END,
           external_job_id = $6, output_asset_id = NULL, result_disposition = 'PENDING',
           problem_code = CASE WHEN $4 = 'NOT_SENT' THEN NULL ELSE problem_code END,
           finished_at = NULL, provider_details = provider_details || $7::jsonb
           WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            command.taskId,
            command.attemptId,
            nextDispatchState,
            nextAttemptState,
            externalJobId,
            jsonParameter({ reconciliationEvidence: command.evidence }),
          ],
        );
        if (command.evidence.outcome === "NOT_DISPATCHED_CONFIRMED") {
          const requeued = await executor.query<Row>(
            `UPDATE outbox SET state = 'RETRY_WAIT', lease_owner = NULL,
               lease_expires_at = NULL, delivered_at = NULL,
               available_at = $4, updated_at = $4
             WHERE workspace_id = $1 AND task_id = $2 AND attempt_id = $3
               AND kind = 'DISPATCH' AND state IN ('PENDING', 'RETRY_WAIT', 'DEAD_LETTER')
             RETURNING id`,
            [scope.workspaceId, command.taskId, command.attemptId, command.reconciledAt],
          );
          if (requeued.rows.length !== 1) {
            return conflict(
              "STATE_CONFLICT",
              "confirmed-not-dispatched reconciliation requires one quarantined dispatch",
            );
          }
        }
        if (command.evidence.outcome !== "STILL_UNKNOWN") {
          await executor.query(
            `UPDATE generation_tasks SET state = $3, version = version + 1, updated_at = $4
             WHERE workspace_id = $1 AND id = $2 AND state = 'BLOCKED'`,
            [
              scope.workspaceId,
              command.taskId,
              command.evidence.outcome === "ACKNOWLEDGEMENT_CONFIRMED" ? "RUNNING" : "READY",
              command.reconciledAt,
            ],
          );
        }
        return write({
          kind: "DISPATCH_RECONCILIATION" as const,
          completion: "NOT_ACCEPTED" as const,
          taskId: command.taskId,
          attemptId: command.attemptId,
          dispatchState: nextDispatchState,
          evidence: command.evidence,
          reconciledAt: command.reconciledAt,
        });
      });
    },
    requestCancellation: (async (
      scope: WorkspaceScope,
      command: ExecutionContracts.RequestCancellationCommand,
    ) => {
      return context.atomic.run(async (executor) => {
        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        if (
          command.target === "TASK_ONLY" &&
          task.state === "CANCELLED" &&
          task.cancelRequestedAt === command.requestedAt &&
          task.finishedAt === command.requestedAt
        ) {
          return write(
            {
              kind: "TASK_ONLY_CANCELLATION" as const,
              completion: "NOT_ACCEPTED" as const,
              target: "TASK_ONLY" as const,
              task: task as ExecutionContracts.CancelledTaskRecord,
              outbox: null,
            },
            true,
          );
        }
        if (command.target === "ATTEMPT" && task.state === "CANCEL_REQUESTED") {
          const existingOutbox = await loadOutbox(
            executor,
            scope.workspaceId,
            command.outbox.outboxId,
          );
          if (
            task.cancelRequestedAt === command.requestedAt &&
            existingOutbox !== null &&
            existingOutbox.kind === "CANCEL" &&
            existingOutbox.taskId === command.taskId &&
            existingOutbox.attemptId === command.attemptId &&
            existingOutbox.dedupeKey === command.outbox.dedupeKey &&
            existingOutbox.payloadHash === command.outbox.payloadHash &&
            sameValue(existingOutbox.payload, command.outbox.payload)
          ) {
            return write(
              {
                kind: "ATTEMPT_CANCELLATION_REQUESTED" as const,
                completion: "NOT_ACCEPTED" as const,
                target: "ATTEMPT" as const,
                task: task as ExecutionContracts.CancelRequestedTaskRecord,
                attemptId: command.attemptId,
                outbox: existingOutbox as ExecutionContracts.PendingCancellationOutboxRecord,
              },
              true,
            );
          }
          return conflict("STATE_CONFLICT", "task already has another cancellation request");
        }
        if (task.version !== command.expectedTaskVersion) {
          return conflict(
            "EXPECTED_VERSION_MISMATCH",
            "task version changed before cancellation",
            task.version,
          );
        }
        if (task.acceptedAttemptId !== null || task.state === "COMPLETE") {
          return conflict("ACCEPTED_RESULT_EXISTS", "completed tasks cannot be cancelled");
        }
        if (task.state === "CANCELLED" || task.state === "FAILED") {
          return conflict("STATE_CONFLICT", "terminal tasks cannot be cancelled again");
        }
        if (command.target === "TASK_ONLY") {
          await executor.query(
            `UPDATE outbox SET state = 'DEAD_LETTER', lease_owner = NULL,
               lease_expires_at = NULL, delivered_at = NULL, updated_at = $3
             WHERE workspace_id = $1 AND task_id = $2 AND kind = 'DISPATCH'
               AND state IN ('PENDING', 'RETRY_WAIT')`,
            [scope.workspaceId, command.taskId, command.requestedAt],
          );
          const unsafeOutbox = await one(
            executor,
            `SELECT id FROM outbox
             WHERE workspace_id = $1 AND task_id = $2 AND kind = 'DISPATCH'
               AND state <> 'DEAD_LETTER'
             LIMIT 1 FOR UPDATE`,
            [scope.workspaceId, command.taskId],
          );
          if (unsafeOutbox !== null) {
            return conflict(
              "STATE_CONFLICT",
              "task-only cancellation cannot race a leased, delivered, or ambiguous dispatch",
            );
          }
          await executor.query(
            `UPDATE attempts SET state = 'CANCELLED', result_disposition = 'REJECTED',
               problem_code = 'CANCELLED_BEFORE_DISPATCH', finished_at = $3
             WHERE workspace_id = $1 AND task_id = $2
               AND state = 'CREATED' AND dispatch_state = 'NOT_SENT'
               AND claim_state = 'UNCLAIMED' AND started_at IS NULL
               AND finished_at IS NULL AND result_disposition = 'PENDING'`,
            [scope.workspaceId, command.taskId, command.requestedAt],
          );
          const unsafeAttempt = await one(
            executor,
            `SELECT id FROM attempts
             WHERE workspace_id = $1 AND task_id = $2
               AND NOT (
                 state = 'CANCELLED' AND dispatch_state = 'NOT_SENT'
                 AND claim_state = 'UNCLAIMED' AND started_at IS NULL
                 AND result_disposition = 'REJECTED'
                 AND problem_code = 'CANCELLED_BEFORE_DISPATCH'
                 AND finished_at = $3
               )
             LIMIT 1 FOR UPDATE`,
            [scope.workspaceId, command.taskId, command.requestedAt],
          );
          if (unsafeAttempt !== null) {
            return conflict(
              "STATE_CONFLICT",
              "task-only cancellation requires every attempt to remain undispatched and unclaimed",
            );
          }
          await executor.query(
            `UPDATE generation_tasks SET state = 'CANCELLED', version = version + 1,
               cancel_requested_at = $3, finished_at = $3, updated_at = $3
             WHERE workspace_id = $1 AND id = $2`,
            [scope.workspaceId, command.taskId, command.requestedAt],
          );
          const cancelled = await loadTask(executor, scope.workspaceId, command.taskId);
          if (cancelled === null) throw new Error("cancelled task disappeared");
          return write({
            kind: "TASK_ONLY_CANCELLATION" as const,
            completion: "NOT_ACCEPTED" as const,
            target: "TASK_ONLY" as const,
            task: cancelled as ExecutionContracts.CancelledTaskRecord,
            outbox: null,
          });
        }
        const attempt = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (attempt === null) return missing("ATTEMPT", command.attemptId);
        if (attempt.taskId !== command.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
        await executor.query(
          `UPDATE generation_tasks SET state = 'CANCEL_REQUESTED', version = version + 1,
             cancel_requested_at = $3, finished_at = NULL, updated_at = $3
           WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, command.taskId, command.requestedAt],
        );
        await executor.query(
          `INSERT INTO outbox (
             id, workspace_id, task_id, attempt_id, kind, state, dedupe_key,
             payload_contract_name, payload_contract_version, payload_hash, payload, available_at
           ) VALUES ($1, $2, $3, $4, 'CANCEL', 'PENDING', $5, $6, $7, $8, $9::jsonb, $10)`,
          [
            command.outbox.outboxId,
            scope.workspaceId,
            command.taskId,
            command.attemptId,
            command.outbox.dedupeKey,
            command.outbox.payloadContractName,
            command.outbox.payloadContractVersion,
            command.outbox.payloadHash,
            jsonParameter(command.outbox.payload),
            command.outbox.availableAt,
          ],
        );
        const cancelTask = await loadTask(executor, scope.workspaceId, command.taskId);
        const outbox = await loadOutbox(executor, scope.workspaceId, command.outbox.outboxId);
        if (cancelTask === null || outbox === null)
          throw new Error("cancellation state disappeared");
        return write({
          kind: "ATTEMPT_CANCELLATION_REQUESTED" as const,
          completion: "NOT_ACCEPTED" as const,
          target: "ATTEMPT" as const,
          task: cancelTask as ExecutionContracts.CancelRequestedTaskRecord,
          attemptId: command.attemptId,
          outbox: outbox as ExecutionContracts.PendingCancellationOutboxRecord,
        });
      });
    }) as ExecutionContracts.ExecutionRepository["requestCancellation"],
    async recordSuccessfulResult(scope, command) {
      return context.atomic.run(async (executor) => {
        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        if (
          task.state === "CANCEL_REQUESTED" ||
          task.state === "CANCELLED" ||
          task.state === "COMPLETE" ||
          task.state === "FAILED"
        ) {
          return conflict(
            "STATE_CONFLICT",
            "cancelling or terminal tasks reject successful results",
          );
        }
        const attempt = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (attempt === null) return missing("ATTEMPT", command.attemptId);
        if (attempt.taskId !== command.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
        const artifact = await findArtifact(executor, scope.workspaceId, command.outputAssetId);
        if (artifact === null) return missing("ASSET", command.outputAssetId);
        if (
          (artifact.state !== "VERIFIED" && artifact.state !== "ACCEPTED") ||
          artifact.binarySha256 !== command.outputBinarySha256
        ) {
          return invariant(
            "RESULT_ASSET_NOT_VERIFIED",
            "successful output is not a verified hash match",
          );
        }
        if (attempt.state === "SUCCEEDED") {
          if (
            attempt.outputAssetId !== command.outputAssetId ||
            !sameValue(attempt.providerDetails, command.providerDetails) ||
            attempt.finishedAt !== command.finishedAt
          ) {
            return conflict("STATE_CONFLICT", "attempt already succeeded with a different result");
          }
        } else if (
          attempt.finishedAt !== null ||
          attempt.resultDisposition !== "PENDING" ||
          attempt.claimState !== "CLAIMED" ||
          (attempt.dispatchState !== "ACKNOWLEDGED" && attempt.dispatchState !== "RECONCILED") ||
          (attempt.state !== "CLAIMED" && attempt.state !== "RUNNING")
        ) {
          return conflict(
            "STATE_CONFLICT",
            "only a claimed acknowledged attempt can become successful",
          );
        } else {
          await executor.query(
            `UPDATE attempts SET state = 'SUCCEEDED', output_asset_id = $4,
               result_disposition = 'PENDING', problem_code = NULL,
               provider_details = $5::jsonb, finished_at = $6
             WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
            [
              scope.workspaceId,
              command.taskId,
              command.attemptId,
              command.outputAssetId,
              jsonParameter(command.providerDetails),
              command.finishedAt,
            ],
          );
        }
        const successful = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (successful === null) throw new Error("successful attempt disappeared");
        return write(
          {
            kind: "SUCCESSFUL_ATTEMPT_CANDIDATE" as const,
            completion: "NOT_ACCEPTED" as const,
            reference: {
              kind: "RECORDED_SUCCESSFUL_ATTEMPT" as const,
              taskId: command.taskId,
              attemptId: command.attemptId,
              expectedTaskVersion: task.version,
            },
            attempt: successful as ExecutionContracts.SuccessfulUnacceptedAttemptRecord,
            outputBinarySha256: command.outputBinarySha256,
          },
          attempt.state === "SUCCEEDED",
        );
      });
    },
    async recordTerminalResult(scope, command) {
      return context.atomic.run(async (executor) => {
        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        if (
          task.state === "COMPLETE" ||
          task.state === "CANCELLED" ||
          task.state === "FAILED" ||
          (task.state === "CANCEL_REQUESTED" && command.state !== "CANCELLED")
        ) {
          return conflict(
            "STATE_CONFLICT",
            "terminal tasks are immutable and cancellation accepts only cancellation results",
          );
        }
        const attempt = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (attempt === null) return missing("ATTEMPT", command.attemptId);
        if (attempt.taskId !== command.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
        if (attempt.state === command.state && attempt.problemCode === command.problemCode) {
          return write(
            {
              kind: "TERMINAL_ATTEMPT_RESULT" as const,
              completion: "NOT_ACCEPTED" as const,
              attempt: attempt as ExecutionContracts.TerminalAttemptRecord,
            },
            true,
          );
        }
        if (attempt.finishedAt !== null) {
          return conflict("STATE_CONFLICT", "attempt already has a terminal result");
        }
        await executor.query(
          `UPDATE attempts SET state = $4, output_asset_id = NULL,
             result_disposition = 'REJECTED', problem_code = $5,
             provider_details = $6::jsonb, finished_at = $7
           WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
          [
            scope.workspaceId,
            command.taskId,
            command.attemptId,
            command.state,
            command.problemCode,
            jsonParameter(command.providerDetails),
            command.finishedAt,
          ],
        );
        const terminal = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (terminal === null) throw new Error("terminal attempt disappeared");
        return write({
          kind: "TERMINAL_ATTEMPT_RESULT" as const,
          completion: "NOT_ACCEPTED" as const,
          attempt: terminal as ExecutionContracts.TerminalAttemptRecord,
        });
      });
    },
    async settleAttemptCancellation(scope, command) {
      return context.atomic.run(async (executor) => {
        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        const attempt = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (attempt === null) return missing("ATTEMPT", command.attemptId);
        if (attempt.taskId !== command.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
        if (
          task.state === "CANCELLED" &&
          task.finishedAt === command.settledAt &&
          attempt.state === "CANCELLED" &&
          attempt.resultDisposition === "REJECTED" &&
          attempt.finishedAt !== null
        ) {
          return write(
            {
              kind: "ATTEMPT_CANCELLATION_SETTLED" as const,
              completion: "NOT_ACCEPTED" as const,
              task: task as ExecutionContracts.CancelledTaskRecord,
              attempt: attempt as ExecutionContracts.TerminalAttemptRecord & {
                readonly state: "CANCELLED";
              },
              settledAt: command.settledAt,
            },
            true,
          );
        }
        if (task.version !== command.expectedTaskVersion) {
          return conflict(
            "EXPECTED_VERSION_MISMATCH",
            "task version changed before cancellation settlement",
            task.version,
          );
        }
        if (task.acceptedAttemptId !== null || task.state === "COMPLETE") {
          return conflict("ACCEPTED_RESULT_EXISTS", "completed tasks cannot settle cancellation");
        }
        if (task.state !== "CANCEL_REQUESTED") {
          return conflict(
            "STATE_CONFLICT",
            "only a cancellation-requested task can settle as cancelled",
          );
        }
        if (
          attempt.state !== "CANCELLED" ||
          attempt.resultDisposition !== "REJECTED" ||
          attempt.finishedAt === null
        ) {
          return conflict(
            "STATE_CONFLICT",
            "cancellation cannot settle before the target attempt is terminal cancelled",
          );
        }
        const activeAttempts = await one(
          executor,
          `SELECT count(*)::int AS count FROM attempts
           WHERE workspace_id = $1 AND task_id = $2
             AND (state NOT IN ('FAILED', 'CANCELLED') OR finished_at IS NULL)`,
          [scope.workspaceId, command.taskId],
        );
        if (
          activeAttempts === null ||
          numberValue(activeAttempts.count, "attempts.active_count") !== 0
        ) {
          return conflict(
            "STATE_CONFLICT",
            "cancellation cannot settle while another attempt remains active",
          );
        }
        await executor.query(
          `UPDATE generation_tasks SET state = 'CANCELLED', version = version + 1,
             accepted_attempt_id = NULL, finished_at = $3, updated_at = $3
           WHERE workspace_id = $1 AND id = $2 AND state = 'CANCEL_REQUESTED'`,
          [scope.workspaceId, command.taskId, command.settledAt],
        );
        const cancelled = await loadTask(executor, scope.workspaceId, command.taskId);
        if (cancelled === null) throw new Error("settled cancellation task disappeared");
        return write({
          kind: "ATTEMPT_CANCELLATION_SETTLED" as const,
          completion: "NOT_ACCEPTED" as const,
          task: cancelled as ExecutionContracts.CancelledTaskRecord,
          attempt: attempt as ExecutionContracts.TerminalAttemptRecord & {
            readonly state: "CANCELLED";
          },
          settledAt: command.settledAt,
        });
      });
    },
    async recordUnknownAttempt(scope, command) {
      return context.atomic.run(async (executor) => {
        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        if (
          task.state === "CANCEL_REQUESTED" ||
          task.state === "CANCELLED" ||
          task.state === "COMPLETE" ||
          task.state === "FAILED"
        ) {
          return conflict(
            "STATE_CONFLICT",
            "cancelling or terminal tasks reject unknown-attempt mutation",
          );
        }
        const attempt = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (attempt === null) return missing("ATTEMPT", command.attemptId);
        if (attempt.taskId !== command.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
        const replayed = attempt.state === "UNKNOWN" && attempt.problemCode === command.problemCode;
        if (!replayed) {
          if (attempt.finishedAt !== null || attempt.resultDisposition !== "PENDING") {
            return conflict("STATE_CONFLICT", "terminal attempt cannot become unknown");
          }
          await executor.query(
            `UPDATE attempts SET state = 'UNKNOWN', dispatch_state = 'AMBIGUOUS',
               output_asset_id = NULL, result_disposition = 'PENDING', problem_code = $4,
               provider_details = $5::jsonb, finished_at = NULL
             WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
            [
              scope.workspaceId,
              command.taskId,
              command.attemptId,
              command.problemCode,
              jsonParameter(command.providerDetails),
            ],
          );
          await executor.query(
            `UPDATE generation_tasks SET state = 'BLOCKED', version = version + 1, updated_at = $3
           WHERE workspace_id = $1 AND id = $2
             AND state NOT IN ('CANCEL_REQUESTED', 'CANCELLED', 'COMPLETE', 'FAILED')`,
            [scope.workspaceId, command.taskId, command.observedAt],
          );
        }
        const unknown = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (unknown === null) throw new Error("unknown attempt disappeared");
        return write(
          {
            kind: "UNKNOWN_ATTEMPT_REQUIRES_RECONCILIATION" as const,
            completion: "NOT_ACCEPTED" as const,
            reconciliationRequired: true as const,
            observedAt: command.observedAt,
            attempt: unknown as ExecutionContracts.UnknownAttemptRecord,
          },
          replayed,
        );
      });
    },
    async acceptSuccessfulResult(scope, command) {
      return context.atomic.run(async (executor) => {
        const reference = command.candidateReference;
        const task = await loadTask(executor, scope.workspaceId, reference.taskId);
        if (task === null) return missing("TASK", reference.taskId);
        if (task.acceptedAttemptId !== null) {
          return conflict("ACCEPTED_RESULT_EXISTS", "task already has an accepted result");
        }
        if (
          task.state === "CANCEL_REQUESTED" ||
          task.state === "CANCELLED" ||
          task.state === "COMPLETE" ||
          task.state === "FAILED"
        ) {
          return conflict(
            "STATE_CONFLICT",
            "cancelling or terminal tasks reject result acceptance",
          );
        }
        if (task.version !== reference.expectedTaskVersion) {
          return conflict(
            "EXPECTED_VERSION_MISMATCH",
            "task version changed after successful result was recorded",
            task.version,
          );
        }
        const attempt = await loadAttempt(executor, scope.workspaceId, reference.attemptId);
        if (attempt === null) return missing("ATTEMPT", reference.attemptId);
        if (attempt.taskId !== reference.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
        if (
          attempt.state !== "SUCCEEDED" ||
          attempt.resultDisposition !== "PENDING" ||
          attempt.outputAssetId === null ||
          attempt.finishedAt === null
        ) {
          return invariant("ATTEMPT_NOT_SUCCESSFUL", "attempt is not an unaccepted success");
        }
        const unsafeSibling = await one(
          executor,
          `SELECT sibling.id FROM attempts sibling
           WHERE sibling.workspace_id = $1 AND sibling.task_id = $2 AND sibling.id <> $3
             AND sibling.finished_at IS NULL
             AND NOT (
               sibling.state = 'CREATED' AND sibling.dispatch_state = 'NOT_SENT'
               AND sibling.claim_state = 'UNCLAIMED' AND sibling.started_at IS NULL
               AND sibling.result_disposition = 'PENDING'
               AND NOT EXISTS (
                 SELECT 1 FROM outbox sibling_outbox
                 WHERE sibling_outbox.workspace_id = sibling.workspace_id
                   AND sibling_outbox.task_id = sibling.task_id
                   AND sibling_outbox.attempt_id = sibling.id
                   AND sibling_outbox.kind = 'DISPATCH'
                   AND sibling_outbox.state = 'LEASED'
               )
             )
           LIMIT 1 FOR UPDATE`,
          [scope.workspaceId, reference.taskId, reference.attemptId],
        );
        if (unsafeSibling !== null) {
          return conflict(
            "STATE_CONFLICT",
            "acceptance cannot race a leased or dispatched active sibling attempt",
          );
        }
        await executor.query(
          `UPDATE attempts SET state = 'CANCELLED', result_disposition = 'REJECTED',
             problem_code = 'SUPERSEDED_BY_ACCEPTED_RESULT', finished_at = $4
           WHERE workspace_id = $1 AND task_id = $2 AND id <> $3
             AND state = 'CREATED' AND dispatch_state = 'NOT_SENT'
             AND claim_state = 'UNCLAIMED' AND started_at IS NULL
             AND finished_at IS NULL AND result_disposition = 'PENDING'`,
          [scope.workspaceId, reference.taskId, reference.attemptId, command.acceptedAt],
        );
        await executor.query(
          `UPDATE attempts SET result_disposition = 'REJECTED',
             problem_code = COALESCE(problem_code, 'SUPERSEDED_BY_ACCEPTED_RESULT')
           WHERE workspace_id = $1 AND task_id = $2 AND id <> $3
             AND finished_at IS NOT NULL AND result_disposition = 'PENDING'`,
          [scope.workspaceId, reference.taskId, reference.attemptId],
        );
        await executor.query(
          `UPDATE outbox SET state = 'DEAD_LETTER', lease_owner = NULL,
             lease_expires_at = NULL, delivered_at = NULL, updated_at = $3
           WHERE workspace_id = $1 AND task_id = $2 AND kind = 'DISPATCH'
             AND state IN ('PENDING', 'RETRY_WAIT')`,
          [scope.workspaceId, reference.taskId, command.acceptedAt],
        );
        const runnableOutbox = await one(
          executor,
          `SELECT id FROM outbox
           WHERE workspace_id = $1 AND task_id = $2 AND kind = 'DISPATCH'
             AND state IN ('PENDING', 'RETRY_WAIT', 'LEASED')
           LIMIT 1 FOR UPDATE`,
          [scope.workspaceId, reference.taskId],
        );
        if (runnableOutbox !== null) {
          return conflict("STATE_CONFLICT", "accepted tasks cannot retain runnable dispatch work");
        }
        const artifact = await findArtifact(executor, scope.workspaceId, attempt.outputAssetId);
        if (
          artifact === null ||
          (artifact.state !== "VERIFIED" && artifact.state !== "ACCEPTED") ||
          artifact.binarySha256 === null
        ) {
          return invariant("RESULT_ASSET_NOT_VERIFIED", "accepted result asset is not verified");
        }
        await executor.query(
          `UPDATE attempts SET result_disposition = 'ACCEPTED'
           WHERE workspace_id = $1 AND task_id = $2 AND id = $3`,
          [scope.workspaceId, reference.taskId, reference.attemptId],
        );
        await executor.query(
          `UPDATE generation_tasks SET state = 'COMPLETE', accepted_attempt_id = $3,
             version = version + 1, finished_at = $4, updated_at = $4
           WHERE workspace_id = $1 AND id = $2`,
          [scope.workspaceId, reference.taskId, reference.attemptId, command.acceptedAt],
        );
        const completed = await loadTask(executor, scope.workspaceId, reference.taskId);
        const accepted = await loadAttempt(executor, scope.workspaceId, reference.attemptId);
        if (completed === null || accepted === null) throw new Error("accepted result disappeared");
        return write({
          kind: "ACCEPTED_ATTEMPT_RESULT" as const,
          completion: "ACCEPTED" as const,
          task: completed as ExecutionContracts.CompletedGenerationTaskRecord,
          attempt: accepted as ExecutionContracts.AcceptedAttemptRecord,
          outputBinarySha256: artifact.binarySha256,
          acceptedAt: command.acceptedAt,
        });
      });
    },
    async resolveTask(scope, lookup) {
      const task = await loadTask(context.executor, scope.workspaceId, lookup.taskId);
      return task === null ? missing("TASK", lookup.taskId) : success(task);
    },
    async listAttempts(scope, query) {
      const task = await loadTask(context.executor, scope.workspaceId, query.taskId);
      if (task === null) return missing("TASK", query.taskId);
      const rows = await context.executor.query<Row>(
        "SELECT * FROM attempts WHERE workspace_id = $1 AND task_id = $2 ORDER BY ordinal, id",
        [scope.workspaceId, query.taskId],
      );
      return success(rows.rows.map(mapAttempt));
    },
    async resolveRecoveryTaskFacts(scope, query) {
      const row = await one(
        context.executor,
        `WITH target_task AS (
           SELECT * FROM generation_tasks
           WHERE workspace_id = $1 AND id = $2
         ),
         attempt_facts AS (
           SELECT
             count(*)::int AS recovery_attempt_count,
             count(*) FILTER (WHERE claim_state = 'CLAIMED')::int
               AS recovery_claimed_attempt_count,
             count(*) FILTER (WHERE result_disposition = 'ACCEPTED')::int
               AS recovery_accepted_attempt_count,
             count(*) FILTER (WHERE dispatch_state = 'AMBIGUOUS')::int
               AS recovery_ambiguous_attempt_count,
             count(*) FILTER (WHERE finished_at IS NULL)::int
               AS recovery_active_attempt_count,
             count(*) FILTER (
               WHERE state = 'UNKNOWN' OR dispatch_state = 'AMBIGUOUS'
             )::int AS recovery_reconciling_attempt_count,
             count(*) FILTER (
               WHERE finished_at IS NULL AND state IN ('CLAIMED', 'RUNNING')
             )::int AS recovery_running_attempt_count
           FROM attempts
           WHERE workspace_id = $1 AND task_id = $2
         ),
         outbox_facts AS (
           SELECT
             count(*) FILTER (WHERE kind = 'DISPATCH')::int
               AS recovery_dispatch_outbox_count,
             count(*) FILTER (WHERE kind = 'CANCEL')::int
               AS recovery_cancellation_outbox_count,
             count(*) FILTER (WHERE state = 'DEAD_LETTER')::int
               AS recovery_dead_letter_outbox_count
           FROM outbox
           WHERE workspace_id = $1 AND task_id = $2
         ),
         per_attempt_cost AS (
           SELECT attempt_id,
             count(*)::int AS event_count,
             count(*) FILTER (WHERE event_type = 'RESERVED')::int AS reserved_event_count,
             count(*) FILTER (WHERE event_type = 'REPORTED')::int AS reported_event_count,
             count(*) FILTER (WHERE event_type = 'SETTLED')::int AS settled_event_count,
             count(*) FILTER (WHERE event_type IN ('SETTLED', 'RELEASED', 'REFUNDED'))::int
               AS finalization_event_count,
             COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'RESERVED'), 0)::bigint
               AS reserved_micro_usd,
             COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'REPORTED'), 0)::bigint
               AS reported_micro_usd,
             COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'SETTLED'), 0)::bigint
               AS settled_micro_usd,
             COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'RELEASED'), 0)::bigint
               AS released_micro_usd,
             COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'REFUNDED'), 0)::bigint
               AS refunded_micro_usd
           FROM cost_events
           WHERE workspace_id = $1 AND task_id = $2
           GROUP BY attempt_id
         ),
         cost_facts AS (
           SELECT
             COALESCE(sum(event_count), 0)::int AS recovery_cost_event_count,
             COALESCE(sum(reserved_event_count), 0)::int
               AS recovery_cost_reserved_event_count,
             COALESCE(sum(reported_event_count), 0)::int
               AS recovery_cost_reported_event_count,
             COALESCE(sum(settled_event_count), 0)::int
               AS recovery_cost_settled_event_count,
             COALESCE(sum(finalization_event_count), 0)::int
               AS recovery_cost_finalization_event_count,
             COALESCE(sum(reserved_micro_usd), 0)::bigint
               AS recovery_cost_reserved_micro_usd,
             COALESCE(sum(reported_micro_usd), 0)::bigint
               AS recovery_cost_reported_micro_usd,
             COALESCE(sum(settled_micro_usd), 0)::bigint
               AS recovery_cost_settled_micro_usd,
             COALESCE(sum(released_micro_usd), 0)::bigint
               AS recovery_cost_released_micro_usd,
             COALESCE(sum(refunded_micro_usd), 0)::bigint
               AS recovery_cost_refunded_micro_usd,
             COALESCE(sum(GREATEST(
               reserved_micro_usd - settled_micro_usd - released_micro_usd - refunded_micro_usd,
               0
             )), 0)::bigint AS recovery_cost_active_reservation_micro_usd,
             count(*) FILTER (WHERE reserved_event_count <> 1)::int
               AS recovery_cost_invalid_reservation_attempt_count,
             count(*) FILTER (
               WHERE (reported_event_count > 0 OR settled_event_count > 0)
                 AND (
                   reported_event_count = 0 OR settled_event_count = 0
                   OR reported_micro_usd <> settled_micro_usd
                 )
             )::int AS recovery_cost_unsettled_reported_attempt_count,
             count(*) FILTER (
               WHERE finalization_event_count < 1
                 OR reserved_micro_usd <>
                   settled_micro_usd + released_micro_usd + refunded_micro_usd
             )::int AS recovery_cost_non_conserving_attempt_count
           FROM per_attempt_cost
         )
         SELECT target_task.*, attempt_facts.*, outbox_facts.*, cost_facts.*
         FROM target_task
         CROSS JOIN attempt_facts
         CROSS JOIN outbox_facts
         CROSS JOIN cost_facts`,
        [scope.workspaceId, query.taskId],
      );
      if (row === null) return missing("TASK", query.taskId);
      const task = mapTask(row);
      return success({
        task,
        attemptCount: numberValue(row.recovery_attempt_count, "recovery attempt count"),
        claimedAttemptCount: numberValue(
          row.recovery_claimed_attempt_count,
          "recovery claimed attempt count",
        ),
        acceptedAttemptCount: numberValue(
          row.recovery_accepted_attempt_count,
          "recovery accepted attempt count",
        ),
        ambiguousAttemptCount: numberValue(
          row.recovery_ambiguous_attempt_count,
          "recovery ambiguous attempt count",
        ),
        activeAttemptCount: numberValue(
          row.recovery_active_attempt_count,
          "recovery active attempt count",
        ),
        reconcilingAttemptCount: numberValue(
          row.recovery_reconciling_attempt_count,
          "recovery reconciling attempt count",
        ),
        runningAttemptCount: numberValue(
          row.recovery_running_attempt_count,
          "recovery running attempt count",
        ),
        dispatchOutboxCount: numberValue(
          row.recovery_dispatch_outbox_count,
          "recovery dispatch outbox count",
        ),
        cancellationOutboxCount: numberValue(
          row.recovery_cancellation_outbox_count,
          "recovery cancellation outbox count",
        ),
        deadLetterOutboxCount: numberValue(
          row.recovery_dead_letter_outbox_count,
          "recovery dead-letter outbox count",
        ),
        cost: {
          taskId: query.taskId,
          attemptId: null,
          owner: task.owner,
          reservedMicroUsd: bigintValue(
            row.recovery_cost_reserved_micro_usd,
            "recovery cost reserved",
          ),
          reportedMicroUsd: bigintValue(
            row.recovery_cost_reported_micro_usd,
            "recovery cost reported",
          ),
          settledMicroUsd: bigintValue(
            row.recovery_cost_settled_micro_usd,
            "recovery cost settled",
          ),
          releasedMicroUsd: bigintValue(
            row.recovery_cost_released_micro_usd,
            "recovery cost released",
          ),
          refundedMicroUsd: bigintValue(
            row.recovery_cost_refunded_micro_usd,
            "recovery cost refunded",
          ),
          activeReservationMicroUsd: bigintValue(
            row.recovery_cost_active_reservation_micro_usd,
            "recovery cost active reservation",
          ),
          eventCount: numberValue(row.recovery_cost_event_count, "recovery cost event count"),
          reservedEventCount: numberValue(
            row.recovery_cost_reserved_event_count,
            "recovery cost reserved event count",
          ),
          reportedEventCount: numberValue(
            row.recovery_cost_reported_event_count,
            "recovery cost reported event count",
          ),
          settledEventCount: numberValue(
            row.recovery_cost_settled_event_count,
            "recovery cost settled event count",
          ),
          finalizationEventCount: numberValue(
            row.recovery_cost_finalization_event_count,
            "recovery cost finalization event count",
          ),
          invalidReservationAttemptCount: numberValue(
            row.recovery_cost_invalid_reservation_attempt_count,
            "recovery cost invalid reservation attempt count",
          ),
          unsettledReportedAttemptCount: numberValue(
            row.recovery_cost_unsettled_reported_attempt_count,
            "recovery cost unsettled reported attempt count",
          ),
          nonConservingAttemptCount: numberValue(
            row.recovery_cost_non_conserving_attempt_count,
            "recovery cost non-conserving attempt count",
          ),
        },
      });
    },
  };
}

function workflowCommandFingerprint(command: EventContracts.AppendWorkflowEventCommand): unknown {
  return {
    eventId: command.eventId,
    workflowInstanceId: command.workflowInstanceId,
    aggregate: command.aggregate,
    sequence: command.sequence,
    kind: command.kind,
    payloadContractName: command.payloadContractName,
    payloadContractVersion: command.payloadContractVersion,
    payloadHash: command.payloadHash,
    payload: command.payload,
    occurredAt: command.occurredAt,
  };
}

function workflowRecordFingerprint(record: EventContracts.WorkflowEventRecord): unknown {
  return {
    eventId: record.eventId,
    workflowInstanceId: record.workflowInstanceId,
    aggregate: record.aggregate,
    sequence: record.sequence,
    kind: record.kind,
    payloadContractName: record.payloadContractName,
    payloadContractVersion: record.payloadContractVersion,
    payloadHash: record.payloadHash,
    payload: record.payload,
    occurredAt: record.occurredAt,
  };
}

function costCommandFingerprint(command: EventContracts.AppendCostEventCommand): unknown {
  return {
    costEventId: command.costEventId,
    owner: command.owner,
    taskId: command.taskId,
    attemptId: command.attemptId,
    sequence: command.sequence,
    eventType: command.eventType,
    amountMicroUsd: command.amountMicroUsd,
    idempotencyKey: command.idempotencyKey,
    providerReference: command.providerReference,
    details: command.details,
    occurredAt: command.occurredAt,
  };
}

function costRecordFingerprint(record: EventContracts.CostEventRecord): unknown {
  return {
    costEventId: record.costEventId,
    owner: record.owner,
    taskId: record.taskId,
    attemptId: record.attemptId,
    sequence: record.sequence,
    eventType: record.eventType,
    amountMicroUsd: record.amountMicroUsd,
    idempotencyKey: record.idempotencyKey,
    providerReference: record.providerReference,
    details: record.details,
    occurredAt: record.occurredAt,
  };
}

function createEventRepository(context: RepositoryContext): EventContracts.EventRepository {
  return {
    async appendWorkflowEvent(scope, command) {
      return context.atomic.run(async (executor) => {
        const existingRow = await one(
          executor,
          "SELECT * FROM workflow_events WHERE workspace_id = $1 AND id = $2",
          [scope.workspaceId, command.eventId],
        );
        if (existingRow !== null) {
          const existing = mapWorkflowEvent(existingRow);
          return sameValue(workflowRecordFingerprint(existing), workflowCommandFingerprint(command))
            ? write(existing, true)
            : conflict("EVENT_ID_REUSED", "workflow event ID was reused with different content");
        }
        const workflow = await one(
          executor,
          "SELECT id FROM workflow_instances WHERE workspace_id = $1 AND id = $2",
          [scope.workspaceId, command.workflowInstanceId],
        );
        if (workflow === null) return missing("WORKFLOW_INSTANCE", command.workflowInstanceId);
        const latest = await one(
          executor,
          `SELECT max(sequence) AS sequence FROM workflow_events
           WHERE workspace_id = $1 AND aggregate_type = $2 AND aggregate_id = $3`,
          [scope.workspaceId, command.aggregate.aggregateType, command.aggregate.aggregateId],
        );
        if (
          latest !== null &&
          latest.sequence !== null &&
          command.sequence <= numberValue(latest.sequence, "workflow_events.max(sequence)")
        ) {
          return invariant(
            "EVENT_SEQUENCE_NOT_MONOTONIC",
            "workflow event sequence must strictly increase",
          );
        }
        await executor.query(
          `INSERT INTO workflow_events (
             id, workspace_id, workflow_instance_id, task_id, attempt_id,
             aggregate_type, aggregate_id, sequence, kind,
             payload_contract_name, payload_contract_version, payload_hash, payload, occurred_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb, $14)`,
          [
            command.eventId,
            scope.workspaceId,
            command.workflowInstanceId,
            command.aggregate.taskId,
            command.aggregate.attemptId,
            command.aggregate.aggregateType,
            command.aggregate.aggregateId,
            command.sequence,
            command.kind,
            command.payloadContractName,
            command.payloadContractVersion,
            command.payloadHash,
            jsonParameter(command.payload),
            command.occurredAt,
          ],
        );
        const inserted = await one(
          executor,
          "SELECT * FROM workflow_events WHERE workspace_id = $1 AND id = $2",
          [scope.workspaceId, command.eventId],
        );
        if (inserted === null) throw new Error("appended workflow event disappeared");
        return write(mapWorkflowEvent(inserted));
      });
    },
    async appendCostEvent(scope, command) {
      return context.atomic.run(async (executor) => {
        if (command.amountMicroUsd < 0n) {
          return invariant("INVALID_MONEY", "cost events cannot be negative");
        }
        const existingRow = await one(
          executor,
          `SELECT cost.*, task.project_revision_id, task.image_style_version_id,
                  task.avatar_profile_version_id
           FROM cost_events cost
           JOIN generation_tasks task
             ON task.workspace_id = cost.workspace_id AND task.id = cost.task_id
           WHERE cost.workspace_id = $1 AND cost.id = $2`,
          [scope.workspaceId, command.costEventId],
        );
        if (existingRow !== null) {
          const existing = mapCostEvent(existingRow);
          return sameValue(costRecordFingerprint(existing), costCommandFingerprint(command))
            ? write(existing, true)
            : conflict("EVENT_ID_REUSED", "cost event ID was reused with different content");
        }
        const retryRow = await one(
          executor,
          "SELECT id FROM cost_events WHERE workspace_id = $1 AND idempotency_key = $2",
          [scope.workspaceId, command.idempotencyKey],
        );
        if (retryRow !== null) {
          return conflict("IDEMPOTENCY_KEY_REUSED", "cost event retry key was reused");
        }
        const task = await loadTask(executor, scope.workspaceId, command.taskId);
        if (task === null) return missing("TASK", command.taskId);
        const attempt = await loadAttempt(executor, scope.workspaceId, command.attemptId);
        if (attempt === null) return missing("ATTEMPT", command.attemptId);
        if (attempt.taskId !== command.taskId || !sameValue(task.owner, command.owner)) {
          return invariant(
            "AGGREGATE_REFERENCE_MISMATCH",
            "cost event task, attempt, and owner must share one lineage",
          );
        }
        const latest = await one(
          executor,
          `SELECT max(sequence) AS sequence FROM cost_events
           WHERE workspace_id = $1 AND owner_type = $2 AND owner_id = $3`,
          [scope.workspaceId, command.owner.ownerType, command.owner.ownerId],
        );
        if (
          latest !== null &&
          latest.sequence !== null &&
          command.sequence <= numberValue(latest.sequence, "cost_events.max(sequence)")
        ) {
          return invariant(
            "EVENT_SEQUENCE_NOT_MONOTONIC",
            "cost event sequence must strictly increase",
          );
        }
        await executor.query(
          `INSERT INTO cost_events (
             id, workspace_id, owner_type, owner_id, task_id, attempt_id,
             sequence, event_type, amount_micro_usd, idempotency_key,
             provider_reference, details, occurred_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)`,
          [
            command.costEventId,
            scope.workspaceId,
            command.owner.ownerType,
            command.owner.ownerId,
            command.taskId,
            command.attemptId,
            command.sequence,
            command.eventType,
            command.amountMicroUsd,
            command.idempotencyKey,
            command.providerReference,
            jsonParameter(command.details),
            command.occurredAt,
          ],
        );
        const inserted = await one(
          executor,
          `SELECT cost.*, task.project_revision_id, task.image_style_version_id,
                  task.avatar_profile_version_id
           FROM cost_events cost
           JOIN generation_tasks task
             ON task.workspace_id = cost.workspace_id AND task.id = cost.task_id
           WHERE cost.workspace_id = $1 AND cost.id = $2`,
          [scope.workspaceId, command.costEventId],
        );
        if (inserted === null) throw new Error("appended cost event disappeared");
        return write(mapCostEvent(inserted));
      });
    },
    async listWorkflowEvents(scope, query) {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 1000) {
        return invariant("SNAPSHOT_MISMATCH", "workflow event limit must be between 1 and 1000");
      }
      const workflow = await one(
        context.executor,
        "SELECT id FROM workflow_instances WHERE workspace_id = $1 AND id = $2",
        [scope.workspaceId, query.workflowInstanceId],
      );
      if (workflow === null) return missing("WORKFLOW_INSTANCE", query.workflowInstanceId);
      const result = await context.executor.query<Row>(
        `SELECT * FROM workflow_events WHERE workspace_id = $1 AND workflow_instance_id = $2
           AND ($3::integer IS NULL OR sequence > $3) ORDER BY sequence, id LIMIT $4`,
        [scope.workspaceId, query.workflowInstanceId, query.afterSequence, query.limit],
      );
      return success(result.rows.map(mapWorkflowEvent));
    },
    async listCostEvents(scope, query) {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 1000) {
        return invariant("SNAPSHOT_MISMATCH", "cost event limit must be between 1 and 1000");
      }
      const result = await context.executor.query<Row>(
        `SELECT cost.*, task.project_revision_id, task.image_style_version_id,
                task.avatar_profile_version_id
         FROM cost_events cost
         JOIN generation_tasks task
           ON task.workspace_id = cost.workspace_id AND task.id = cost.task_id
         WHERE cost.workspace_id = $1 AND cost.owner_type = $2 AND cost.owner_id = $3
           AND ($4::integer IS NULL OR cost.sequence > $4)
         ORDER BY cost.sequence, cost.id LIMIT $5`,
        [
          scope.workspaceId,
          query.owner.ownerType,
          query.owner.ownerId,
          query.afterSequence,
          query.limit,
        ],
      );
      return success(result.rows.map(mapCostEvent));
    },
    async summarizeTaskCost(scope, query) {
      const task = await loadTask(context.executor, scope.workspaceId, query.taskId);
      if (task === null) return missing("TASK", query.taskId);
      if (query.attemptId !== undefined) {
        const attempt = await loadAttempt(context.executor, scope.workspaceId, query.attemptId);
        if (attempt === null) return missing("ATTEMPT", query.attemptId);
        if (attempt.taskId !== query.taskId) {
          return invariant("TASK_ATTEMPT_MISMATCH", "attempt does not belong to task");
        }
      }
      const row = await one(
        context.executor,
        `WITH per_attempt AS (
           SELECT attempt_id,
             count(*)::int AS event_count,
             count(*) FILTER (WHERE event_type = 'RESERVED')::int AS reserved_event_count,
             count(*) FILTER (WHERE event_type = 'REPORTED')::int AS reported_event_count,
             count(*) FILTER (WHERE event_type = 'SETTLED')::int AS settled_event_count,
             count(*) FILTER (WHERE event_type IN ('SETTLED', 'RELEASED', 'REFUNDED'))::int
               AS finalization_event_count,
             COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'RESERVED'), 0)::bigint
               AS reserved_micro_usd,
             COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'REPORTED'), 0)::bigint
               AS reported_micro_usd,
             COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'SETTLED'), 0)::bigint
               AS settled_micro_usd,
             COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'RELEASED'), 0)::bigint
               AS released_micro_usd,
             COALESCE(sum(amount_micro_usd) FILTER (WHERE event_type = 'REFUNDED'), 0)::bigint
               AS refunded_micro_usd
           FROM cost_events
           WHERE workspace_id = $1 AND task_id = $2
             AND ($3::uuid IS NULL OR attempt_id = $3::uuid)
           GROUP BY attempt_id
         )
         SELECT
           COALESCE(sum(event_count), 0)::int AS event_count,
           COALESCE(sum(reserved_event_count), 0)::int AS reserved_event_count,
           COALESCE(sum(reported_event_count), 0)::int AS reported_event_count,
           COALESCE(sum(settled_event_count), 0)::int AS settled_event_count,
           COALESCE(sum(finalization_event_count), 0)::int AS finalization_event_count,
           COALESCE(sum(reserved_micro_usd), 0)::bigint AS reserved_micro_usd,
           COALESCE(sum(reported_micro_usd), 0)::bigint AS reported_micro_usd,
           COALESCE(sum(settled_micro_usd), 0)::bigint AS settled_micro_usd,
           COALESCE(sum(released_micro_usd), 0)::bigint AS released_micro_usd,
           COALESCE(sum(refunded_micro_usd), 0)::bigint AS refunded_micro_usd,
           COALESCE(sum(GREATEST(
             reserved_micro_usd - settled_micro_usd - released_micro_usd - refunded_micro_usd,
             0
           )), 0)::bigint AS active_reservation_micro_usd,
           count(*) FILTER (WHERE reserved_event_count <> 1)::int
             AS invalid_reservation_attempt_count,
           count(*) FILTER (
             WHERE (reported_event_count > 0 OR settled_event_count > 0)
               AND (
                 reported_event_count = 0 OR settled_event_count = 0
                 OR reported_micro_usd <> settled_micro_usd
               )
           )::int AS unsettled_reported_attempt_count,
           count(*) FILTER (
             WHERE finalization_event_count < 1
               OR reserved_micro_usd <>
                 settled_micro_usd + released_micro_usd + refunded_micro_usd
           )::int AS non_conserving_attempt_count
         FROM per_attempt`,
        [scope.workspaceId, query.taskId, query.attemptId ?? null],
      );
      if (row === null) throw new Error("task cost summary aggregate returned no row");
      return success({
        taskId: query.taskId,
        attemptId: query.attemptId ?? null,
        owner: task.owner,
        reservedMicroUsd: bigintValue(row.reserved_micro_usd, "cost summary reserved"),
        reportedMicroUsd: bigintValue(row.reported_micro_usd, "cost summary reported"),
        settledMicroUsd: bigintValue(row.settled_micro_usd, "cost summary settled"),
        releasedMicroUsd: bigintValue(row.released_micro_usd, "cost summary released"),
        refundedMicroUsd: bigintValue(row.refunded_micro_usd, "cost summary refunded"),
        activeReservationMicroUsd: bigintValue(
          row.active_reservation_micro_usd,
          "cost summary active reservation",
        ),
        eventCount: numberValue(row.event_count, "cost summary event count"),
        reservedEventCount: numberValue(
          row.reserved_event_count,
          "cost summary reserved event count",
        ),
        reportedEventCount: numberValue(
          row.reported_event_count,
          "cost summary reported event count",
        ),
        settledEventCount: numberValue(row.settled_event_count, "cost summary settled event count"),
        finalizationEventCount: numberValue(
          row.finalization_event_count,
          "cost summary finalization event count",
        ),
        invalidReservationAttemptCount: numberValue(
          row.invalid_reservation_attempt_count,
          "cost summary invalid reservation attempt count",
        ),
        unsettledReportedAttemptCount: numberValue(
          row.unsettled_reported_attempt_count,
          "cost summary unsettled reported attempt count",
        ),
        nonConservingAttemptCount: numberValue(
          row.non_conserving_attempt_count,
          "cost summary non-conserving attempt count",
        ),
      });
    },
  };
}

type ReceiptResult = IdempotentRepositoryResult<unknown, string, string, string>;
type ReceiptInvocation = (
  scope: WorkspaceScope,
  command: IdempotentMutation,
) => Promise<ReceiptResult>;
type MutableRepositoryName = Exclude<keyof RepositorySession, "identity">;

const receiptOperations = Object.freeze({
  artifacts: Object.freeze({
    archive: "artifact_archive",
    bindBinaryContent: "artifact_bind_binary_content",
    bindCanonicalDocument: "artifact_bind_canonical_document",
    registerMetadata: "artifact_register_metadata",
  }),
  avatarProfiles: Object.freeze({
    archiveProfile: "avatar_profile_archive",
    beginCompatibilityTest: "avatar_profile_begin_compatibility_test",
    createDraftVersion: "avatar_profile_create_draft_version",
    createProfile: "avatar_profile_create",
    publishVersion: "avatar_profile_publish_version",
    saveDraftVersion: "avatar_profile_save_draft_version",
  }),
  events: Object.freeze({
    appendCostEvent: "event_append_cost",
    appendWorkflowEvent: "event_append_workflow",
  }),
  execution: Object.freeze({
    acceptSuccessfulResult: "execution_accept_successful_result",
    claimExecution: "execution_claim",
    reconcileDispatch: "execution_reconcile_dispatch",
    recordDispatchAcknowledged: "execution_record_dispatch_acknowledged",
    recordDispatchAckUnknown: "execution_record_dispatch_ack_unknown",
    recordSuccessfulResult: "execution_record_successful_result",
    settleAttemptCancellation: "execution_settle_attempt_cancellation",
    recordTerminalResult: "execution_record_terminal_result",
    recordUnknownAttempt: "execution_record_unknown_attempt",
    requestCancellation: "execution_request_cancellation",
    reserveTaskAttempt: "execution_reserve_task_attempt",
  }),
  imageStyles: Object.freeze({
    acceptAnalysisResult: "image_style_accept_analysis_result",
    abandonVersion: "image_style_abandon_version",
    archiveStyle: "image_style_archive",
    attachReference: "image_style_attach_reference",
    beginAnalysis: "image_style_begin_analysis",
    createDraftVersion: "image_style_create_draft_version",
    createStyle: "image_style_create",
    detachReference: "image_style_detach_reference",
    publishVersion: "image_style_publish_version",
    saveDraftVersion: "image_style_save_draft_version",
  }),
  projects: Object.freeze({
    archiveProject: "project_archive",
    createRevisionDraft: "project_create_revision_draft",
    createShell: "project_create_shell",
    lockRevision: "project_lock_revision",
    registerInput: "project_register_input",
    verifyInput: "project_verify_input",
  }),
  timing: Object.freeze({
    invalidateTiming: "timing_invalidate",
    materializeSelectedSpanAudio: "timing_materialize_selected_span_audio",
    persistTimelinePlan: "timing_persist_timeline_plan",
    persistTranscriptTiming: "timing_persist_transcript",
  }),
});

function directTransactionalExecutor(executor: SqlExecutor): TransactionalSqlExecutor {
  return {
    execute: (sql) => executor.execute(sql),
    query: (sql, parameters) => executor.query(sql, parameters),
    transaction: (work) => work(executor),
  };
}

function invalidIdempotencyKey(): ReceiptResult {
  return invariant(
    "INVALID_IDEMPOTENCY_KEY",
    "idempotency key must be trimmed and contain 1 to 240 characters",
  );
}

async function executeWithMutationReceipt(
  database: TransactionalSqlExecutor,
  operation: string,
  scopeInput: WorkspaceScope,
  commandInput: IdempotentMutation,
  invoke: (
    executor: SqlExecutor,
    scope: WorkspaceScope,
    command: IdempotentMutation,
  ) => Promise<ReceiptResult>,
): Promise<ReceiptResult> {
  const encodedInput = encodeReceiptValue({ scope: scopeInput, command: commandInput });
  const snapshot = decodeReceiptValue(encodedInput) as {
    readonly scope: WorkspaceScope;
    readonly command: IdempotentMutation;
  };
  const { scope, command } = snapshot;
  if (
    typeof command.idempotencyKey !== "string" ||
    command.idempotencyKey.length < 1 ||
    command.idempotencyKey.length > 240 ||
    command.idempotencyKey.trim() !== command.idempotencyKey
  ) {
    return invalidIdempotencyKey();
  }
  if (
    typeof scope.workspaceId !== "string" ||
    scope.workspaceId.length < 1 ||
    scope.workspaceId.trim() !== scope.workspaceId
  ) {
    return invariant("CROSS_WORKSPACE_REFERENCE", "workspace scope is malformed");
  }
  const inputHash = receiptHash(encodedInput);
  return database.transaction(async (transaction) => {
    // The receipt row does not exist on first use. Locking its workspace serializes the first
    // claimant without relying on a provider-specific advisory-lock implementation.
    await transaction.query("SELECT id FROM workspaces WHERE id = $1 FOR UPDATE", [
      scope.workspaceId,
    ]);
    const existing = await one(
      transaction,
      `SELECT operation, input_hash, result_codec, result_payload, result_hash
       FROM repository_mutation_receipts
       WHERE workspace_id = $1 AND idempotency_key = $2
       FOR UPDATE`,
      [scope.workspaceId, command.idempotencyKey],
    );
    if (existing !== null) {
      if (
        stringValue(existing.operation, "repository_mutation_receipts.operation") !== operation ||
        stringValue(existing.input_hash, "repository_mutation_receipts.input_hash") !== inputHash
      ) {
        return conflict(
          "IDEMPOTENCY_KEY_REUSED",
          "idempotency key was already committed for a different operation or input",
        );
      }
      if (
        stringValue(existing.result_codec, "repository_mutation_receipts.result_codec") !==
        "repository-result/v1"
      ) {
        throw new Error("repository mutation receipt uses an unsupported result codec");
      }
      const encodedResult = jsonObject(
        existing.result_payload,
        "repository_mutation_receipts.result_payload",
      ) as CanonicalReceiptValue;
      const decodedResult = decodeReceiptValue(encodedResult);
      const normalizedResult = encodeReceiptValue(decodedResult);
      const storedResultHash = stringValue(
        existing.result_hash,
        "repository_mutation_receipts.result_hash",
      );
      if (receiptHash(normalizedResult) !== storedResultHash) {
        throw new Error("repository mutation receipt result hash does not match its payload");
      }
      return write(decodedResult, true);
    }

    const result = await invoke(transaction, scope, command);
    if (!result.ok) return result;
    const encodedResult = encodeReceiptValue(result.value.value);
    await transaction.query(
      `INSERT INTO repository_mutation_receipts (
         workspace_id, idempotency_key, operation, input_hash,
         result_codec, result_payload, result_hash
       ) VALUES ($1, $2, $3, $4, 'repository-result/v1', $5::jsonb, $6)`,
      [
        scope.workspaceId,
        command.idempotencyKey,
        operation,
        inputHash,
        receiptPayloadJson(encodedResult),
        receiptHash(encodedResult),
      ],
    );
    return result;
  });
}

function receiptWrappedRepository<Repository extends object>(
  database: TransactionalSqlExecutor,
  repositoryName: MutableRepositoryName,
  repository: Repository,
  operations: Readonly<Record<string, string>>,
): Repository {
  const cached = new Map<string, ReceiptInvocation>();
  return new Proxy(repository, {
    get(target, property, receiver) {
      if (typeof property !== "string") return Reflect.get(target, property, receiver) as unknown;
      const operation = Object.hasOwn(operations, property) ? operations[property] : undefined;
      if (typeof operation !== "string") return Reflect.get(target, property, receiver) as unknown;
      const existing = cached.get(property);
      if (existing !== undefined) return existing;
      const wrapped: ReceiptInvocation = (scope, command) =>
        executeWithMutationReceipt(
          database,
          operation,
          scope,
          command,
          async (transaction, snapshotScope, snapshotCommand) => {
            const directAtomic: AtomicRunner = { run: (work) => work(transaction) };
            const transactionRepositories = createRepositorySession({
              executor: transaction,
              atomic: directAtomic,
            });
            const transactionRepository = transactionRepositories[
              repositoryName
            ] as unknown as Record<string, ReceiptInvocation>;
            const method = transactionRepository[property];
            if (method === undefined) {
              throw new Error(
                `missing receipt-wrapped repository method ${repositoryName}.${property}`,
              );
            }
            return method(snapshotScope, snapshotCommand);
          },
        );
      cached.set(property, wrapped);
      return wrapped;
    },
  });
}

function createRepositorySession(context: RepositoryContext): RepositorySession {
  return {
    identity: createIdentityRepository(context),
    avatarProfiles: createAvatarProfileRepository(context),
    imageStyles: createImageStyleRepository(context),
    projects: createProjectRepository(context),
    timing: createTimingRepository(context),
    artifacts: createArtifactRepository(context),
    execution: createExecutionRepository(context),
    events: createEventRepository(context),
  };
}

function createReceiptWrappedSession(
  database: TransactionalSqlExecutor,
  context: RepositoryContext,
): RepositorySession {
  const raw = createRepositorySession(context);
  return {
    identity: raw.identity,
    artifacts: receiptWrappedRepository(
      database,
      "artifacts",
      raw.artifacts,
      receiptOperations.artifacts,
    ),
    avatarProfiles: receiptWrappedRepository(
      database,
      "avatarProfiles",
      raw.avatarProfiles,
      receiptOperations.avatarProfiles,
    ),
    events: receiptWrappedRepository(database, "events", raw.events, receiptOperations.events),
    execution: receiptWrappedRepository(
      database,
      "execution",
      raw.execution,
      receiptOperations.execution,
    ),
    imageStyles: receiptWrappedRepository(
      database,
      "imageStyles",
      raw.imageStyles,
      receiptOperations.imageStyles,
    ),
    projects: receiptWrappedRepository(
      database,
      "projects",
      raw.projects,
      receiptOperations.projects,
    ),
    timing: receiptWrappedRepository(database, "timing", raw.timing, receiptOperations.timing),
  };
}

interface UnitOfWorkScopeGuard {
  failure: RepositoryResult<never, string, string, string> | null;
}

/**
 * Binds the trusted principal to the database session for the rest of the transaction.
 *
 * The tenant write guard rejects any row whose derived owner disagrees with this value, and the
 * `videoforge_tenant_*` views return nothing outside it, so a repository that reached a foreign
 * workspace through an application bug fails at the database rather than returning data.
 */
export async function bindTenantPrincipal(
  executor: SqlExecutor,
  scope: WorkspaceScope,
): Promise<void> {
  await executor.query(`SELECT set_config($1, $2, true)`, [
    TENANT_PRINCIPAL_SETTING,
    scope.accountId,
  ]);
}

function guardedScopeField(scope: unknown, field: "accountId" | "workspaceId"): string | null {
  if (typeof scope !== "object" || scope === null || Array.isArray(scope)) return null;
  const descriptor = Object.getOwnPropertyDescriptor(scope, field);
  return descriptor !== undefined && "value" in descriptor && typeof descriptor.value === "string"
    ? descriptor.value
    : null;
}

function scopeGuardedRepository<Repository extends object>(
  repository: Repository,
  scope: WorkspaceScope,
  guard: UnitOfWorkScopeGuard,
): Repository {
  const cached = new Map<PropertyKey, unknown>();
  return new Proxy(repository, {
    get(target, property, receiver) {
      const member = Reflect.get(target, property, receiver) as unknown;
      if (typeof member !== "function") return member;
      const existing = cached.get(property);
      if (existing !== undefined) return existing;
      const wrapped = async (...parameters: unknown[]): Promise<unknown> => {
        if (
          guardedScopeField(parameters[0], "workspaceId") !== scope.workspaceId ||
          guardedScopeField(parameters[0], "accountId") !== scope.accountId
        ) {
          const failure = invariant(
            "CROSS_WORKSPACE_REFERENCE",
            "unit-of-work repository calls must use the bound tenant scope",
          );
          guard.failure ??= failure;
          return failure;
        }
        return Reflect.apply(member, target, parameters) as Promise<unknown>;
      };
      cached.set(property, wrapped);
      return wrapped;
    },
  });
}

function createScopeGuardedSession(
  session: RepositorySession,
  scope: WorkspaceScope,
  guard: UnitOfWorkScopeGuard,
): RepositorySession {
  return {
    identity: scopeGuardedRepository(session.identity, scope, guard),
    artifacts: scopeGuardedRepository(session.artifacts, scope, guard),
    avatarProfiles: scopeGuardedRepository(session.avatarProfiles, scope, guard),
    events: scopeGuardedRepository(session.events, scope, guard),
    execution: scopeGuardedRepository(session.execution, scope, guard),
    imageStyles: scopeGuardedRepository(session.imageStyles, scope, guard),
    projects: scopeGuardedRepository(session.projects, scope, guard),
    timing: scopeGuardedRepository(session.timing, scope, guard),
  };
}

async function validateBoundTenantScope(
  executor: SqlExecutor,
  scope: WorkspaceScope,
): Promise<RepositoryResult<never, string, string, string> | null> {
  const accountId = guardedScopeField(scope, "accountId");
  const workspaceId = guardedScopeField(scope, "workspaceId");
  if (accountId === null || workspaceId === null) {
    return invariant("CROSS_WORKSPACE_REFERENCE", "a trusted account and workspace are required");
  }
  const workspace = await one(
    executor,
    "SELECT id FROM workspaces WHERE account_id = $1 AND id = $2",
    [accountId, workspaceId],
  );
  return workspace === null
    ? invariant(
        "CROSS_WORKSPACE_REFERENCE",
        "the authenticated account does not own the requested workspace",
      )
    : null;
}

function createTenantBoundRootSession(database: TransactionalSqlExecutor): RepositorySession {
  const repositoryNames = [
    "identity",
    "artifacts",
    "avatarProfiles",
    "events",
    "execution",
    "imageStyles",
    "projects",
    "timing",
  ] as const satisfies readonly (keyof RepositorySession)[];
  const session = {} as Record<keyof RepositorySession, object>;
  for (const repositoryName of repositoryNames) {
    session[repositoryName] = new Proxy(
      {},
      {
        get(_target, property) {
          if (typeof property !== "string") return undefined;
          return async (...parameters: unknown[]): Promise<unknown> => {
            if (
              guardedScopeField(parameters[0], "accountId") === null ||
              guardedScopeField(parameters[0], "workspaceId") === null
            ) {
              return invariant(
                "CROSS_WORKSPACE_REFERENCE",
                "a trusted account and workspace are required",
              );
            }
            const invocationParameters = decodeReceiptValue(
              encodeReceiptValue(parameters),
            ) as unknown[];
            const scope = invocationParameters[0] as WorkspaceScope;
            return database.transaction(async (transaction) => {
              const accountId = guardedScopeField(scope, "accountId");
              if (accountId === null) {
                return invariant(
                  "CROSS_WORKSPACE_REFERENCE",
                  "a trusted account and workspace are required",
                );
              }
              await bindTenantPrincipal(transaction, scope);
              const scopeFailure = await validateBoundTenantScope(transaction, scope);
              if (scopeFailure !== null) return scopeFailure;
              const directAtomic: AtomicRunner = { run: (operation) => operation(transaction) };
              const transactionSession = createReceiptWrappedSession(
                directTransactionalExecutor(transaction),
                { executor: transaction, atomic: directAtomic },
              );
              const member = transactionSession[repositoryName][
                property as keyof (typeof transactionSession)[typeof repositoryName]
              ] as unknown;
              if (typeof member !== "function") return member;
              return Reflect.apply(
                member,
                transactionSession[repositoryName],
                invocationParameters,
              );
            });
          };
        },
      },
    );
  }
  return session as unknown as RepositorySession;
}

class TypedTransactionRollback extends Error {
  public constructor(public readonly result: RepositoryResult<unknown, string, string, string>) {
    super("typed repository transaction rollback");
    this.name = "TypedTransactionRollback";
  }
}

/**
 * Binds the committed query-library-neutral contracts to a PGlite-compatible transactional
 * executor. The same SQL-facing boundary can be reused by a production PostgreSQL driver later;
 * this constructor itself never reads DATABASE_URL or opens a network connection.
 */
export function createPGliteControlPlaneRepositories(
  database: TransactionalSqlExecutor,
): ControlPlaneRepositories {
  const session = createTenantBoundRootSession(database);
  const unitOfWork: RepositoryUnitOfWork = {
    async execute(scope, work) {
      try {
        return await database.transaction(async (transaction) => {
          const guard: UnitOfWorkScopeGuard = { failure: null };
          const directAtomic: AtomicRunner = { run: (operation) => operation(transaction) };
          const receiptSession = createReceiptWrappedSession(
            directTransactionalExecutor(transaction),
            {
              executor: transaction,
              atomic: directAtomic,
            },
          );
          await bindTenantPrincipal(transaction, scope);
          const scopeFailure = await validateBoundTenantScope(transaction, scope);
          if (scopeFailure !== null) throw new TypedTransactionRollback(scopeFailure);
          const transactionSession = createScopeGuardedSession(receiptSession, scope, guard);
          const result = await work(transactionSession);
          if (guard.failure !== null) {
            throw new TypedTransactionRollback(guard.failure);
          }
          if (!result.ok) {
            throw new TypedTransactionRollback(result);
          }
          return result;
        });
      } catch (error: unknown) {
        if (error instanceof TypedTransactionRollback) {
          return error.result as Awaited<ReturnType<typeof work>>;
        }
        throw error;
      }
    },
  };
  return { ...session, unitOfWork };
}

/** Direct owned-path exports let isolated tests integrate without changing the shared package index. */
export const pgliteAdapterInternals = Object.freeze({
  mapAttempt,
  mapCostEvent,
  mapOutbox,
  mapTask,
  mapWorkflowEvent,
});
