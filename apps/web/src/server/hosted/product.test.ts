import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => {
  const scopeRows: Record<string, unknown>[] = [
    {
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    },
  ];
  const projectRows: Record<string, unknown>[] = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Private project",
      revision_id: "22222222-2222-4222-8222-222222222222",
      revision_state: "DRAFT",
    },
  ];
  const rateLimitRows = [{ allowed: true }];
  const query = vi.fn(async (sql: string) => {
    if (sql.includes("videoforge_consume_hosted_rate_limit"))
      return { rows: rateLimitRows, affectedRows: 1 };
    if (sql.includes("videoforge_hosted_session_scope"))
      return { rows: scopeRows, affectedRows: 1 };
    if (sql.includes("FROM projects AS project")) return { rows: projectRows, affectedRows: 1 };
    return { rows: [], affectedRows: 0 };
  });
  const pool = { query, end: vi.fn() };
  const transaction = vi.fn(async (work: (executor: unknown) => Promise<unknown>) =>
    work({ execute: vi.fn(), query }),
  );
  const executor = { execute: vi.fn(), query, transaction };
  return { scopeRows, projectRows, rateLimitRows, query, pool, executor };
});

vi.mock("./auth", () => ({
  createHostedAuth: vi.fn(() => ({
    api: {
      getSession: vi.fn(async () => ({
        user: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
        session: { token: "fixture-session-token" },
      })),
    },
  })),
}));

vi.mock("./neon", () => ({
  createNeonPool: vi.fn(() => testState.pool),
  createNeonExecutor: vi.fn(() => testState.executor),
}));

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { handleHostedProductRequest, hostedGpuProductState } from "./product";

const ORIGIN = "https://hosted.example.test";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PRESET_ID = "44444444-4444-4444-8444-444444444444";

const config = {
  publicOrigin: ORIGIN,
  neon: { databaseUrl: "postgresql://fixture" },
} as HostedRuntimeConfiguration;
const environment = {} as HostedRuntimeEnvironment;
const executionContext = { waitUntil: vi.fn() };

function request(
  path: string,
  method: "GET" | "POST" = "POST",
  body: unknown = {},
  sameOrigin = true,
  headers: Record<string, string> = {},
): Request {
  const requestHeaders = new Headers({
    origin: sameOrigin ? ORIGIN : "https://attacker.example.test",
    ...headers,
  });
  if (method === "POST") requestHeaders.set("content-type", "application/json");
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: requestHeaders,
    body: method === "GET" ? undefined : JSON.stringify(body),
  });
}

async function errorCode(result: Response | null): Promise<string | null> {
  if (!result) return null;
  const value = (await result.json()) as { error?: { code?: string } };
  return value.error?.code ?? null;
}

describe("hosted product route contract", () => {
  it("reports qualified work as dispatch-ready without inventing a GPU estimate", () => {
    expect(hostedGpuProductState({ dispatch_available: true })).toStrictEqual({
      projectedUsd: null,
      pendingState: "READY_FOR_GPU_DISPATCH",
      estimateDetail:
        "GPU projection is unavailable until exact lane work is materialized. The selected cap is the hard maximum.",
    });
    expect(hostedGpuProductState({ dispatch_available: false })).toMatchObject({
      projectedUsd: 0,
      pendingState: "WAITING_FOR_GPU_QUALIFICATION",
    });
  });

  it.each([
    "/api/v2/hosted/avatars",
    `/api/v2/hosted/avatars/${PRESET_ID}/commit`,
    `/api/v2/hosted/avatars/${PRESET_ID}/approve`,
    "/api/v2/hosted/styles",
    `/api/v2/hosted/styles/${PRESET_ID}/commit`,
    `/api/v2/hosted/styles/${PRESET_ID}/analyze`,
    `/api/v2/hosted/styles/${PRESET_ID}/publish`,
    `/api/v2/hosted/projects/${PROJECT_ID}/retry`,
  ])("recognizes the exact write route before unavailable bindings: %s", async (path) => {
    const result = await handleHostedProductRequest(
      request(path, "POST", {}, false),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(403);
    await expect(errorCode(result)).resolves.toBe("HOSTED_BROWSER_ORIGIN_REJECTED");
  });

  it.each([
    "/api/v2/hosted/avatars",
    `/api/v2/hosted/avatars/${PRESET_ID}/commit`,
    `/api/v2/hosted/avatars/${PRESET_ID}/approve`,
    "/api/v2/hosted/styles",
    `/api/v2/hosted/styles/${PRESET_ID}/commit`,
    `/api/v2/hosted/styles/${PRESET_ID}/analyze`,
    `/api/v2/hosted/styles/${PRESET_ID}/publish`,
    `/api/v2/hosted/projects/${PROJECT_ID}/retry`,
  ])(
    "fails closed for an unqualified write capability before database access: %s",
    async (path) => {
      testState.query.mockClear();
      const result = await handleHostedProductRequest(
        request(path, "POST", { unexpected: true }),
        environment,
        config,
        executionContext,
      );
      expect(result?.status).toBe(409);
      await expect(errorCode(result)).resolves.toBe(
        path.endsWith("/retry") ? "TARGETED_RETRY_NOT_QUALIFIED" : "PRESET_CREATION_NOT_QUALIFIED",
      );
      expect(testState.query).not.toHaveBeenCalled();
    },
  );

  it("fails closed at the tenant admission seam", async () => {
    testState.scopeRows.length = 0;
    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/projects/${PROJECT_ID}/manifest`, "GET"),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(403);
    await expect(errorCode(result)).resolves.toBe("INVITE_ADMISSION_REQUIRED");
    testState.scopeRows.push({
      user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      account_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      workspace_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
  });

  it("fails closed before tenant data access when the hosted rate limit is exhausted", async () => {
    testState.query.mockClear();
    testState.rateLimitRows[0]!.allowed = false;
    const candidate = request(`/api/v2/hosted/projects/${PROJECT_ID}/review`, "POST", {
      attempt_id: "22222222-2222-4222-8222-222222222222",
    });
    const result = await handleHostedProductRequest(
      candidate,
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(429);
    expect(result?.headers.get("retry-after")).toBe("60");
    await expect(errorCode(result)).resolves.toBe("HOSTED_RATE_LIMITED");
    expect(
      testState.query.mock.calls.some(([sql]) =>
        String(sql).includes("videoforge_hosted_session_scope"),
      ),
    ).toBe(false);
    expect(candidate.bodyUsed).toBe(false);
    testState.rateLimitRows[0]!.allowed = true;
  });

  it("rejects an oversized hosted JSON body before parsing it", async () => {
    const candidate = request("/api/v2/hosted/projects/preflight", "POST", {}, true, {
      "content-length": "131073",
    });
    const result = await handleHostedProductRequest(
      candidate,
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(400);
    await expect(errorCode(result)).resolves.toBe("PROJECT_PREFLIGHT_REJECTED");
    expect(candidate.bodyUsed).toBe(false);
  });

  it("keeps provenance manifest unavailable until an approved render exists", async () => {
    const result = await handleHostedProductRequest(
      request(`/api/v2/hosted/projects/${PROJECT_ID}/manifest`, "GET"),
      environment,
      config,
      executionContext,
    );
    expect(result?.status).toBe(409);
    await expect(errorCode(result)).resolves.toBe("PROJECT_APPROVAL_REQUIRED");
  });

  it("preserves SYSTEM preset materialization and global queue contract in source", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    expect(source).toContain("await materializeSystemAvatar(transaction, scope, avatarSource)");
    expect(source).toContain("videoforge_read_system_avatar_version_assets($1)");
    expect(source).toContain("await materializeSystemStyle(transaction, scope, styleSource)");
    const createStart = source.indexOf("async function createProject(");
    const createEnd = source.indexOf("async function commitProject(", createStart);
    expect(source.slice(createStart, createEnd)).toContain("resolveProjectPresets(");

    const queueStart = source.indexOf("const queue = await transaction.query(");
    const queueEnd = source.indexOf("const runtime = await transaction.query(", queueStart);
    const queueSql = source.slice(queueStart, queueEnd);
    expect(queueSql).not.toContain("ahead.account_id");
    expect(queueSql).not.toContain("ahead.workspace_id");
    expect(queueSql).not.toContain("total.account_id");
    expect(queueSql).not.toContain("total.workspace_id");
    expect(queueSql).toContain("ahead.queue_order < request.queue_order");
  });

  it("consumes a retryable attempt exactly once before reopening its request", () => {
    const source = readFileSync(resolve(process.cwd(), "src/server/hosted/product.ts"), "utf8");
    const retryStart = source.indexOf("async function retryProjectAttempt(");
    const retryEnd = source.indexOf("async function projectManifest(", retryStart);
    const retry = source.slice(retryStart, retryEnd);
    expect(retry).toContain("SET state = 'PERMANENT_FAILED'");
    expect(retry).toContain("state = 'RETRYABLE_FAILED' AND version = $4");
    expect(retry).toContain("request.state = 'FAILED'");
    expect(retry).toContain("task.state = 'FAILED'");
    expect(retry).not.toContain("request.state IN ('FAILED','RETRY_WAIT')");
    expect(retry).not.toContain("task.state IN ('FAILED','RETRY_WAIT')");
  });
});
