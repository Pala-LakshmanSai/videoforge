import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration.js";
import { createNeonExecutor, createNeonPool } from "./neon.js";
import {
  parseV213AcceptanceOperatorEvidenceRequest,
  parseV213AcceptanceOperatorEvidenceResult,
  V213_ACCEPTANCE_OPERATOR_EVIDENCE_PATH,
  type V213AcceptanceOperatorEvidenceRequest,
  type V213AcceptanceOperatorEvidenceResult,
} from "../runtime/v213-acceptance-operator-evidence.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const SIGNATURE = /^[0-9a-f]{64}$/u;
const MAX_BODY_BYTES = 64 * 1024;
const COMMANDS = Object.freeze({
  "v2-10-operator-free-ranga-pilot": "V2-10",
  "v2-11-two-concurrent-owned-projects": "V2-11",
  "v2-12-long-output": "V2-12",
  "v2-13-final-two-lane-smoke": "V2-13",
} as const);
type Command = keyof typeof COMMANDS;

export interface V213OperatorExecutionDocument {
  readonly schemaVersion: "videoforge.v213-hosted-acceptance-command/v1";
  readonly commandId: string;
  readonly stageAuthorityId: string;
  readonly command: Command;
  readonly checkpoint: (typeof COMMANDS)[Command];
  readonly workflowId: string;
  readonly attemptId: string;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly requestSha256: Sha256;
  readonly outerStateSha256: Sha256;
}

export interface V213OperatorExecutionResult {
  readonly evidenceSha256: Sha256;
  readonly summary: Readonly<Record<string, unknown>>;
}

export interface V213OperatorRouteDependencies {
  /** Claims and loads only database-owned checkpoint input. */
  claim(input: {
    readonly tokenSha256: Sha256;
    readonly document: V213OperatorExecutionDocument;
  }): Promise<
    | {
        readonly action: "EXECUTE" | "RECONCILE";
        readonly execution: Readonly<Record<string, unknown>>;
      }
    | { readonly action: "EXISTING"; readonly result: V213OperatorExecutionResult }
    | null
  >;
  complete(input: {
    readonly tokenSha256: Sha256;
    readonly document: V213OperatorExecutionDocument;
    readonly result: V213OperatorExecutionResult;
  }): Promise<V213OperatorExecutionResult>;
  execute(
    checkpoint: V213OperatorExecutionDocument["checkpoint"],
    databaseExecution: Readonly<Record<string, unknown>>,
    mode: "EXECUTE" | "RECONCILE",
  ): Promise<V213OperatorExecutionResult>;
  readonly close: () => Promise<void>;
}

export interface V213OperatorEvidenceRouteDependencies {
  ingest(input: {
    readonly tokenSha256: Sha256;
    readonly nonceSha256: Sha256;
    readonly request: V213AcceptanceOperatorEvidenceRequest;
  }): Promise<V213AcceptanceOperatorEvidenceResult | null>;
  readonly close: () => Promise<void>;
}

function response(value: unknown, status: number): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

function parse(value: unknown): V213OperatorExecutionDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const keys = [
    "accountId",
    "attemptId",
    "checkpoint",
    "command",
    "commandId",
    "outerStateSha256",
    "projectId",
    "projectRevisionId",
    "requestSha256",
    "schemaVersion",
    "stageAuthorityId",
    "workflowId",
    "workspaceId",
  ];
  const command = item.command as Command;
  if (
    Object.keys(item).sort().join(",") !== keys.sort().join(",") ||
    item.schemaVersion !== "videoforge.v213-hosted-acceptance-command/v1" ||
    !(command in COMMANDS) ||
    item.checkpoint !== COMMANDS[command] ||
    ![
      item.commandId,
      item.stageAuthorityId,
      item.workflowId,
      item.attemptId,
      item.accountId,
      item.workspaceId,
      item.projectId,
      item.projectRevisionId,
    ].every((entry) => typeof entry === "string" && ID.test(entry)) ||
    typeof item.requestSha256 !== "string" ||
    !SHA256.test(item.requestSha256) ||
    typeof item.outerStateSha256 !== "string" ||
    !SHA256.test(item.outerStateSha256) ||
    !String(item.workflowId).startsWith(`v213-${String(item.checkpoint).toLowerCase()}-`)
  )
    return null;
  return item as unknown as V213OperatorExecutionDocument;
}

async function digest(value: string): Promise<Sha256> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `sha256:${[...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as Sha256;
}

function productionEvidenceDependencies(
  config: HostedRuntimeConfiguration,
): V213OperatorEvidenceRouteDependencies {
  const pool = createNeonPool(config.neon.databaseUrl);
  const database = createNeonExecutor(pool);
  return {
    ingest: async (input) =>
      database.transaction(async (transaction) => {
        const result = await transaction.query<{ value: unknown }>(
          "SELECT public.videoforge_ingest_v213_acceptance_operator_evidence($1::jsonb) AS value",
          [JSON.stringify(input)],
        );
        return (result.rows[0]?.value ?? null) as V213AcceptanceOperatorEvidenceResult | null;
      }),
    close: () => pool.end(),
  };
}

async function verifyHmac(token: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature || !SIGNATURE.test(signature)) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    Uint8Array.from(signature.match(/../gu) ?? [], (pair) => Number.parseInt(pair, 16)),
    new TextEncoder().encode(body),
  );
}

function productionDependencies(
  config: HostedRuntimeConfiguration,
  execute: V213OperatorRouteDependencies["execute"],
): V213OperatorRouteDependencies {
  const pool = createNeonPool(config.neon.databaseUrl);
  const database = createNeonExecutor(pool);
  return {
    claim: async (input) =>
      database.transaction(async (transaction) => {
        const result = await transaction.query<{ value: unknown }>(
          "SELECT public.videoforge_claim_v213_operator_acceptance($1::jsonb) AS value",
          [JSON.stringify(input)],
        );
        return (result.rows[0]?.value ?? null) as Awaited<
          ReturnType<V213OperatorRouteDependencies["claim"]>
        >;
      }),
    complete: async (input) =>
      database.transaction(async (transaction) => {
        const result = await transaction.query<{ value: unknown }>(
          "SELECT public.videoforge_complete_v213_operator_acceptance($1::jsonb) AS value",
          [JSON.stringify(input)],
        );
        return result.rows[0]?.value as V213OperatorExecutionResult;
      }),
    execute,
    close: () => pool.end(),
  };
}

export async function handleV213AcceptanceOperatorEvidenceRequest(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  injected?: V213OperatorEvidenceRouteDependencies,
  now: () => Date = () => new Date(),
): Promise<Response | null> {
  if (new URL(request.url).pathname !== V213_ACCEPTANCE_OPERATOR_EVIDENCE_PATH) return null;
  if (request.method !== "POST") return response({ error: { code: "NOT_FOUND" } }, 404);
  if (config.environment !== "production" || config.gpuTransport !== "QUALIFIED_EXACT")
    return response({ error: { code: "V213_OPERATOR_EVIDENCE_DISABLED" } }, 503);
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/u)?.[1];
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !token ||
    token !== environment.VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN ||
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 1 ||
    declaredLength > MAX_BODY_BYTES ||
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return response({ error: { code: "NOT_FOUND" } }, 404);
  const raw = await request.text();
  if (
    new TextEncoder().encode(raw).byteLength !== declaredLength ||
    !(await verifyHmac(token, raw, request.headers.get("x-videoforge-signature")))
  )
    return response({ error: { code: "NOT_FOUND" } }, 404);
  let document: V213AcceptanceOperatorEvidenceRequest | null = null;
  try {
    document = parseV213AcceptanceOperatorEvidenceRequest(JSON.parse(raw), now());
  } catch {
    document = null;
  }
  if (!document) return response({ error: { code: "NOT_FOUND" } }, 404);
  const dependencies = injected ?? productionEvidenceDependencies(config);
  try {
    const ingested = await dependencies.ingest({
      tokenSha256: await digest(token),
      nonceSha256: await digest(document.nonce),
      request: document,
    });
    const result = parseV213AcceptanceOperatorEvidenceResult(ingested, document);
    return result
      ? response(result, 201)
      : response({ error: { code: "V213_OPERATOR_EVIDENCE_REJECTED" } }, 409);
  } catch {
    return response({ error: { code: "V213_OPERATOR_EVIDENCE_REJECTED" } }, 409);
  } finally {
    try {
      await dependencies.close();
    } catch {
      // The exact ingest result was already obtained. Closing the pool cannot change the durable row.
    }
  }
}

export async function handleV213LiveOperatorRequest(
  request: Request,
  environment: HostedRuntimeEnvironment,
  config: HostedRuntimeConfiguration,
  execute?: V213OperatorRouteDependencies["execute"],
  injected?: V213OperatorRouteDependencies,
): Promise<Response | null> {
  const path = "/api/operator/v2-13/live-acceptance";
  if (new URL(request.url).pathname !== path) return null;
  if (request.method !== "POST") return response({ error: { code: "NOT_FOUND" } }, 404);
  if (config.environment !== "production" || config.gpuTransport !== "QUALIFIED_EXACT")
    return response({ error: { code: "V213_LIVE_ACCEPTANCE_DISABLED" } }, 503);
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/u)?.[1];
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !token ||
    token !== environment.VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN ||
    !Number.isSafeInteger(declaredLength) ||
    declaredLength < 1 ||
    declaredLength > MAX_BODY_BYTES ||
    request.headers.get("content-type")?.split(";", 1)[0] !== "application/json"
  )
    return response({ error: { code: "NOT_FOUND" } }, 404);
  const raw = await request.text();
  if (
    new TextEncoder().encode(raw).byteLength !== declaredLength ||
    declaredLength > MAX_BODY_BYTES
  )
    return response({ error: { code: "NOT_FOUND" } }, 404);
  let document: V213OperatorExecutionDocument | null = null;
  try {
    document = parse(JSON.parse(raw));
  } catch {
    document = null;
  }
  if (
    !document ||
    canonicalSha256({
      command: document.command,
      checkpoint: document.checkpoint,
      workflowId: document.workflowId,
      attemptId: document.attemptId,
      accountId: document.accountId,
      workspaceId: document.workspaceId,
      projectId: document.projectId,
      projectRevisionId: document.projectRevisionId,
      outerStateSha256: document.outerStateSha256,
    }) !== document.requestSha256 ||
    !(await verifyHmac(token, raw, request.headers.get("x-videoforge-signature")))
  )
    return response({ error: { code: "NOT_FOUND" } }, 404);
  const dependencies = injected ?? (execute ? productionDependencies(config, execute) : null);
  if (!dependencies) return response({ error: { code: "V213_LIVE_ACCEPTANCE_DISABLED" } }, 503);
  const tokenSha256 = await digest(token);
  try {
    const claim = await dependencies.claim({ tokenSha256, document });
    if (!claim) return response({ error: { code: "NOT_FOUND" } }, 404);
    if (claim.action === "EXISTING") return response(claim.result, 200);
    const result = await dependencies.execute(document.checkpoint, claim.execution, claim.action);
    if (!SHA256.test(result.evidenceSha256))
      return response({ error: { code: "V213_LIVE_ACCEPTANCE_REJECTED" } }, 409);
    return response(await dependencies.complete({ tokenSha256, document, result }), 201);
  } catch {
    return response({ error: { code: "V213_LIVE_ACCEPTANCE_REJECTED" } }, 409);
  } finally {
    await dependencies.close();
  }
}
