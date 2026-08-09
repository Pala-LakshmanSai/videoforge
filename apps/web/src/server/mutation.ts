import { createProjectRequestSchema, type CreateProjectRequest } from "@videoforge/contracts";
import type { Context } from "hono";
import { z } from "zod";

import { apiProblem, problemResponse } from "./problem";

export const SHA256 = /^sha256:[a-f0-9]{64}$/u;
export const FIXTURE_FALLBACK_INCREMENT_USD = 0.18;

const MAX_IDEMPOTENCY_RECORDS_PER_SESSION = 512;

interface IdempotencyRecord {
  readonly fingerprint: string;
  response: Response | null;
  pending: Promise<Response> | null;
}

export type IdempotencyLedger = Map<string, IdempotencyRecord>;

export function parseJsonBody(
  rawBody: string,
): { ok: true; data: unknown } | { ok: false; response: Response } {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody) as unknown;
  } catch {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_JSON",
          400,
          "Request body is not valid JSON",
          "Send one JSON object as the request body.",
          false,
        ),
      ),
    };
  }
  return { ok: true, data: payload };
}

export function readStrictMetadata<T>(
  rawBody: string,
  schema: z.ZodType<T>,
  code: string,
  title: string,
  detail: string,
): { ok: true; data: T } | { ok: false; response: Response } {
  const payload = parseJsonBody(rawBody);
  if (!payload.ok) return payload;
  const result = schema.safeParse(payload.data);
  if (!result.success) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(code, 422, title, detail, false),
        result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      ),
    };
  }
  return { ok: true, data: result.data };
}

type CreateProjectRequestResolution =
  | { ok: true; data: CreateProjectRequest }
  | { ok: false; response: Response };

export function readCreateProjectRequest(rawBody: string): CreateProjectRequestResolution {
  const payload = parseJsonBody(rawBody);
  if (!payload.ok) return payload;
  const result = createProjectRequestSchema.safeParse(payload.data);
  if (!result.success) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_CREATE_PROJECT_REQUEST",
          422,
          "Create Project request is invalid",
          "The request does not satisfy create-project-request/v2.",
          false,
        ),
        result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
          code: issue.code,
        })),
      ),
    };
  }
  return { ok: true, data: result.data };
}

function mutationHeadersError(c: Context, requireVersion = false): Response | null {
  const idempotencyKey = c.req.header("idempotency-key")?.trim();
  if (!idempotencyKey) {
    return problemResponse(
      apiProblem(
        "IDEMPOTENCY_KEY_REQUIRED",
        400,
        "Idempotency-Key header is required",
        "Fixture mutations require a stable Idempotency-Key so duplicate clicks remain safe.",
        false,
      ),
    );
  }
  if (requireVersion && !c.req.header("if-match")) {
    return problemResponse(
      apiProblem(
        "IF_MATCH_REQUIRED",
        428,
        "If-Match header is required",
        "This fixture mutation requires the exact current candidate/version token.",
        false,
      ),
    );
  }
  return null;
}

export function projectVersionError(c: Context, currentVersionToken: string): Response | null {
  if (c.req.header("if-match") !== currentVersionToken) {
    return problemResponse(
      apiProblem(
        "REVISION_CONFLICT",
        412,
        "The project version has changed",
        "Refresh the authoritative project state and retry with its current version token.",
        false,
      ),
    );
  }
  return null;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("Value is not valid JSON.");
    return serialized;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}

function normalizedBodyFingerprint(rawBody: string): string {
  try {
    return canonicalJson(JSON.parse(rawBody) as unknown);
  } catch {
    return rawBody;
  }
}

function idempotencyFingerprint(c: Context, rawBody: string): string {
  const url = new URL(c.req.url);
  return [
    c.req.method.toUpperCase(),
    url.pathname,
    url.searchParams.get("fixture") ?? "",
    normalizedBodyFingerprint(rawBody),
  ].join("\n");
}

export async function idempotentMutation(
  c: Context,
  ledger: IdempotencyLedger,
  requireVersion: boolean,
  handle: (rawBody: string) => Response | Promise<Response>,
): Promise<Response> {
  const headersError = mutationHeadersError(c, requireVersion);
  if (headersError) return headersError;

  const idempotencyKey = c.req.header("idempotency-key")?.trim();
  if (!idempotencyKey) {
    throw new Error("Idempotency-Key was validated but is unavailable.");
  }
  const rawBody = await c.req.text();
  const fingerprint = idempotencyFingerprint(c, rawBody);
  const existing = ledger.get(idempotencyKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      return problemResponse(
        apiProblem(
          "IDEMPOTENCY_KEY_REUSED",
          409,
          "Idempotency key was reused for a different request",
          "Use the original request body to replay this operation or send a new Idempotency-Key.",
          false,
        ),
      );
    }
    if (existing.pending) await existing.pending;
    if (!existing.response) {
      throw new Error("Idempotent mutation completed without a replayable response.");
    }
    const replay = existing.response.clone();
    replay.headers.set("x-videoforge-idempotent-replay", "true");
    return replay;
  }

  const record: IdempotencyRecord = { fingerprint, response: null, pending: null };
  if (ledger.size >= MAX_IDEMPOTENCY_RECORDS_PER_SESSION) {
    const settledKey = [...ledger].find(([, value]) => value.pending === null)?.[0];
    if (settledKey) ledger.delete(settledKey);
  }
  if (ledger.size >= MAX_IDEMPOTENCY_RECORDS_PER_SESSION) {
    return problemResponse(
      apiProblem(
        "IDEMPOTENCY_CAPACITY_EXCEEDED",
        429,
        "Too many fixture mutations are still pending",
        "Wait for an in-flight fixture mutation to settle, then retry with the same key.",
        true,
      ),
    );
  }
  const pending = Promise.resolve()
    .then(() => handle(rawBody))
    .then((response) => {
      record.response = response.clone();
      record.pending = null;
      return response;
    })
    .catch((error: unknown) => {
      ledger.delete(idempotencyKey);
      throw error;
    });
  record.pending = pending;
  ledger.set(idempotencyKey, record);
  return pending;
}

type ProjectMutationRequestResolution =
  | { ok: true; projectId: string }
  | { ok: false; response: Response };

export function readProjectMutationRequest(
  rawBody: string,
  pathProjectId: string,
): ProjectMutationRequestResolution {
  const payload = parseJsonBody(rawBody);
  if (!payload.ok) return payload;
  if (
    payload.data === null ||
    typeof payload.data !== "object" ||
    Array.isArray(payload.data) ||
    !("project_id" in payload.data) ||
    typeof payload.data.project_id !== "string" ||
    payload.data.project_id.length === 0 ||
    payload.data.project_id.length > 160
  ) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_PROJECT_MUTATION_REQUEST",
          422,
          "Project mutation request is invalid",
          "Send a non-empty project_id matching the project in the route.",
          false,
        ),
      ),
    };
  }
  if (payload.data.project_id !== pathProjectId) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "PROJECT_ID_MISMATCH",
          409,
          "Project ID does not match the route",
          `Body project_id '${payload.data.project_id}' does not match route project '${pathProjectId}'.`,
          false,
        ),
      ),
    };
  }
  return { ok: true, projectId: payload.data.project_id };
}

type FinalApprovalRequestResolution =
  | { ok: true; projectId: string; candidateId: string; candidateSha256: string }
  | { ok: false; response: Response };

export function readFinalApprovalRequest(
  rawBody: string,
  pathProjectId: string,
): FinalApprovalRequestResolution {
  const payload = parseJsonBody(rawBody);
  if (!payload.ok) return payload;
  if (
    payload.data === null ||
    typeof payload.data !== "object" ||
    Array.isArray(payload.data) ||
    Object.keys(payload.data).length !== 3 ||
    !("project_id" in payload.data) ||
    !("candidate_id" in payload.data) ||
    !("candidate_sha256" in payload.data) ||
    typeof payload.data.project_id !== "string" ||
    payload.data.project_id.length === 0 ||
    payload.data.project_id.length > 160 ||
    typeof payload.data.candidate_id !== "string" ||
    payload.data.candidate_id.length === 0 ||
    payload.data.candidate_id.length > 160 ||
    typeof payload.data.candidate_sha256 !== "string" ||
    !SHA256.test(payload.data.candidate_sha256)
  ) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_FINAL_APPROVAL_REQUEST",
          422,
          "Final approval request is invalid",
          "Send exactly project_id, the current candidate_id, and its SHA-256 checksum.",
          false,
        ),
      ),
    };
  }
  if (payload.data.project_id !== pathProjectId) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "PROJECT_ID_MISMATCH",
          409,
          "Project ID does not match the route",
          `Body project_id '${payload.data.project_id}' does not match route project '${pathProjectId}'.`,
          false,
        ),
      ),
    };
  }
  return {
    ok: true,
    projectId: payload.data.project_id,
    candidateId: payload.data.candidate_id,
    candidateSha256: payload.data.candidate_sha256,
  };
}

type FallbackApprovalRequestResolution =
  | { ok: true; projectId: string; approvedIncrementUsd: number }
  | { ok: false; response: Response };

export function readFallbackApprovalRequest(
  rawBody: string,
  pathProjectId: string,
): FallbackApprovalRequestResolution {
  const projectRequest = readProjectMutationRequest(rawBody, pathProjectId);
  if (!projectRequest.ok) return projectRequest;
  const payload = parseJsonBody(rawBody);
  if (!payload.ok) return payload;
  if (
    payload.data === null ||
    typeof payload.data !== "object" ||
    Array.isArray(payload.data) ||
    Object.keys(payload.data).length !== 2 ||
    !("approved_increment_usd" in payload.data) ||
    payload.data.approved_increment_usd !== FIXTURE_FALLBACK_INCREMENT_USD
  ) {
    return {
      ok: false,
      response: problemResponse(
        apiProblem(
          "INVALID_FALLBACK_APPROVAL_AMOUNT",
          422,
          "Fallback approval amount is invalid",
          `Fixture fallback approval requires the exact capped increment of $${FIXTURE_FALLBACK_INCREMENT_USD.toFixed(2)}.`,
          false,
        ),
      ),
    };
  }
  return {
    ok: true,
    projectId: projectRequest.projectId,
    approvedIncrementUsd: FIXTURE_FALLBACK_INCREMENT_USD,
  };
}
