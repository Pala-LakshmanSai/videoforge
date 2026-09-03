import { createHostedAuth, type HostedExecutionContext } from "./auth";
import type { HostedNeonPool, HostedRuntimeConfiguration } from "./configuration";

export interface HostedScope extends Record<string, unknown> {
  readonly user_id: string;
  readonly account_id: string;
  readonly workspace_id: string;
}

export function response(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "x-videoforge-runtime": "hosted-v2-06",
    },
  });
}

function rateLimitedResponse(): Response {
  return Response.json(
    { error: { code: "HOSTED_RATE_LIMITED", retryable: true } },
    {
      status: 429,
      headers: {
        "cache-control": "no-store",
        "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
        "retry-after": "60",
        "x-content-type-options": "nosniff",
        "x-videoforge-runtime": "hosted-v2-06",
      },
    },
  );
}

export function sameOrigin(request: Request, config: HostedRuntimeConfiguration): boolean {
  return request.headers.get("origin") === new URL(config.publicOrigin).origin;
}

function hostedRateLimitOperation(
  request: Request,
): "hosted_read" | "project_create" | "project_commit" | "project_review" | "hosted_mutation" {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" || path === "/api/v2/hosted/projects/preflight") {
    return "hosted_read";
  }
  if (path === "/api/v2/hosted/projects") return "project_create";
  if (/^\/api\/v2\/hosted\/projects\/[0-9a-f-]+\/commit$/u.test(path)) {
    return "project_commit";
  }
  if (/^\/api\/v2\/hosted\/projects\/[0-9a-f-]+\/review$/u.test(path)) {
    return "project_review";
  }
  return "hosted_mutation";
}

export async function sessionScope(
  request: Request,
  config: HostedRuntimeConfiguration,
  pool: HostedNeonPool,
  executionContext: HostedExecutionContext,
): Promise<HostedScope | Response> {
  const session = await createHostedAuth({ config, pool, executionContext }).api.getSession({
    headers: request.headers,
  });
  if (!session?.user?.id) return response({ error: { code: "AUTHENTICATION_REQUIRED" } }, 401);
  const rateLimitOperation = hostedRateLimitOperation(request);
  const rateLimit = await pool.query<{ allowed: boolean }>(
    `SELECT videoforge_consume_hosted_rate_limit($1, $2) AS allowed`,
    [session.session.token, rateLimitOperation],
  );
  if (rateLimit.rows[0]?.allowed !== true) return rateLimitedResponse();
  const result = await pool.query<HostedScope>(
    `SELECT user_id, account_id, workspace_id
       FROM videoforge_hosted_session_scope($1)`,
    [session.session.token],
  );
  const scope = result.rows[0];
  if (!scope) return response({ error: { code: "INVITE_ADMISSION_REQUIRED" } }, 403);
  return scope;
}

export function plainRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export async function parseHostedJson(
  request: Request,
  code: string,
  maximumBytes = 524_288,
): Promise<unknown | Response> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader === null ? null : Number(contentLengthHeader);
  if (
    contentType !== "application/json" ||
    (contentLength !== null &&
      (!Number.isSafeInteger(contentLength) || contentLength < 0 || contentLength > maximumBytes))
  ) {
    return response({ error: { code } }, 400);
  }
  try {
    if (!request.body) return response({ error: { code } }, 400);
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel();
        return response({ error: { code } }, 400);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
    ) as unknown;
  } catch {
    return response({ error: { code } }, 400);
  }
}
