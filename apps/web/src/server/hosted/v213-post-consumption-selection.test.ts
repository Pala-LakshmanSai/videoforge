import { describe, expect, it, vi } from "vitest";

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import {
  handleV213PostConsumptionSelectionRequest,
  V213_POST_CONSUMPTION_SELECTION_PATH,
  type V213PostConsumptionSelectionDependencies,
} from "./v213-post-consumption-selection";

const ORIGIN = "https://videoforge.example";
const USER_ID = "00000000-0000-4000-8000-000000000001";
const ACCOUNT_ID = "00000000-0000-4000-8000-000000000002";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000003";
const PROJECT_ID = "00000000-0000-4000-8000-000000000004";
const REVISION_ID = "00000000-0000-4000-8000-000000000005";
const CHALLENGE_ID = "00000000-0000-4000-8000-000000000006";
const HASH = `sha256:${"a".repeat(64)}` as const;
const SELECTION_HASH = `sha256:${"b".repeat(64)}` as const;

const environment = {} as HostedRuntimeEnvironment;
const config = {
  commit: "test-commit",
  environment: "production",
  gpuTransport: "QUALIFIED_EXACT",
  publicOrigin: ORIGIN,
  neon: { databaseUrl: "postgres://test.invalid/videoforge" },
} as HostedRuntimeConfiguration;
const executionContext = { waitUntil: vi.fn() };

function challenge(
  role: "primary" | "sameAccountWaiter" | "secondary" | "fairnessProbe" = "primary",
) {
  return {
    challengeId: CHALLENGE_ID,
    challengeSha256: HASH,
    role,
  };
}

function selectionIdentity() {
  return {
    accountId: ACCOUNT_ID,
    workspaceId: WORKSPACE_ID,
    projectId: PROJECT_ID,
    projectRevisionId: REVISION_ID,
  };
}

function requestFor(
  method: "GET" | "POST",
  options: {
    readonly origin?: string | null;
    readonly body?: unknown;
    readonly contentLength?: string;
    readonly contentType?: string;
  } = {},
): Request {
  const headers = new Headers();
  if (options.origin !== null) headers.set("origin", options.origin ?? ORIGIN);
  if (method === "POST") {
    const body = JSON.stringify(
      options.body ?? {
        challengeId: CHALLENGE_ID,
        challengeSha256: HASH,
        role: "primary",
        identity: selectionIdentity(),
      },
    );
    headers.set("content-type", options.contentType ?? "application/json");
    headers.set(
      "content-length",
      options.contentLength ?? String(new TextEncoder().encode(body).byteLength),
    );
    return new Request(`${ORIGIN}${V213_POST_CONSUMPTION_SELECTION_PATH}`, {
      method,
      headers,
      body,
    });
  }
  return new Request(`${ORIGIN}${V213_POST_CONSUMPTION_SELECTION_PATH}`, { method, headers });
}

function dependencies(
  overrides: Partial<V213PostConsumptionSelectionDependencies> = {},
): V213PostConsumptionSelectionDependencies {
  return {
    session: vi.fn(async () => ({ user: { id: USER_ID } })),
    challenge: vi.fn(async () => challenge()),
    submit: vi.fn(async () => ({ state: "PENDING", selectionSha256: null })),
    close: vi.fn(async () => undefined),
    ...overrides,
  };
}

async function bodyOf(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

describe("V2-13 post-consumption materialization selection", () => {
  it("discovers the exact active challenge for an authenticated GET", async () => {
    const deps = dependencies();

    const response = await handleV213PostConsumptionSelectionRequest(
      requestFor("GET"),
      environment,
      config,
      executionContext,
      deps,
    );

    expect(response?.status).toBe(200);
    await expect(bodyOf(response!)).resolves.toEqual({
      schemaVersion: "videoforge.v213-post-consumption-challenge/v1",
      challengeId: CHALLENGE_ID,
      challengeSha256: HASH,
      role: "primary",
    });
    expect(deps.session).toHaveBeenCalledOnce();
    expect(deps.challenge).toHaveBeenCalledOnce();
    expect(deps.close).toHaveBeenCalledOnce();
  });

  it("requires authentication before challenge discovery", async () => {
    const deps = dependencies({ session: vi.fn(async () => null) });

    const response = await handleV213PostConsumptionSelectionRequest(
      requestFor("GET"),
      environment,
      config,
      executionContext,
      deps,
    );

    expect(response?.status).toBe(401);
    await expect(bodyOf(response!)).resolves.toEqual({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
    expect(deps.challenge).not.toHaveBeenCalled();
    expect(deps.close).toHaveBeenCalledOnce();
  });

  it.each([
    ["zero", null],
    ["ambiguous", []],
    ["malformed", { challengeId: CHALLENGE_ID, challengeSha256: HASH, role: "unknown" }],
  ])("fails closed when challenge discovery is %s", async (_label, value) => {
    const deps = dependencies({ challenge: vi.fn(async () => value) });

    const response = await handleV213PostConsumptionSelectionRequest(
      requestFor("GET"),
      environment,
      config,
      executionContext,
      deps,
    );

    expect(response?.status).toBe(404);
    await expect(bodyOf(response!)).resolves.toEqual({
      error: { code: "V213_MATERIALIZATION_CHALLENGE_UNAVAILABLE" },
    });
    expect(deps.close).toHaveBeenCalledOnce();
  });

  it("fails closed when challenge discovery is unavailable", async () => {
    const { challenge: _challenge, ...deps } = dependencies();
    void _challenge;

    const response = await handleV213PostConsumptionSelectionRequest(
      requestFor("GET"),
      environment,
      config,
      executionContext,
      deps,
    );

    expect(response?.status).toBe(503);
    await expect(bodyOf(response!)).resolves.toEqual({
      error: { code: "V213_MATERIALIZATION_DISABLED" },
    });
    expect(deps.close).toHaveBeenCalledOnce();
  });

  it("accepts a same-origin POST only with the exact scoped identity", async () => {
    const submit = vi.fn(async () => ({ state: "PENDING", selectionSha256: null }));
    const deps = dependencies({ submit });
    const identity = selectionIdentity();

    const response = await handleV213PostConsumptionSelectionRequest(
      requestFor("POST", {
        body: {
          challengeId: CHALLENGE_ID,
          challengeSha256: HASH,
          role: "secondary",
          identity,
        },
      }),
      environment,
      config,
      executionContext,
      deps,
    );

    expect(response?.status).toBe(202);
    await expect(bodyOf(response!)).resolves.toEqual({
      schemaVersion: "videoforge.v213-post-consumption-selection/v1",
      state: "PENDING",
      selectionSha256: null,
    });
    expect(submit).toHaveBeenCalledWith({
      challengeId: CHALLENGE_ID,
      challengeSha256: HASH,
      role: "secondary",
      identity,
      accountId: ACCOUNT_ID,
      workspaceId: WORKSPACE_ID,
      selectedByUserId: USER_ID,
    });
  });

  it.each([
    ["missing origin", { origin: null }],
    ["foreign origin", { origin: "https://attacker.example" }],
  ])("rejects a POST with %s before authentication or submission", async (_label, options) => {
    const deps = dependencies();

    const response = await handleV213PostConsumptionSelectionRequest(
      requestFor("POST", options),
      environment,
      config,
      executionContext,
      deps,
    );

    expect(response?.status).toBe(403);
    await expect(bodyOf(response!)).resolves.toEqual({
      error: { code: "HOSTED_BROWSER_ORIGIN_REJECTED" },
    });
    expect(deps.session).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong content length", { contentLength: "1" }],
    ["missing content length", { contentLength: "0" }],
    ["wrong content type", { contentType: "text/plain" }],
  ])("rejects a POST with %s", async (_label, options) => {
    const deps = dependencies();

    const response = await handleV213PostConsumptionSelectionRequest(
      requestFor("POST", options),
      environment,
      config,
      executionContext,
      deps,
    );

    expect(response?.status).toBe(400);
    await expect(bodyOf(response!)).resolves.toEqual({
      error: { code: "V213_MATERIALIZATION_REQUEST_INVALID" },
    });
    expect(deps.session).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it("rejects a POST whose identity shape is not exact", async () => {
    const deps = dependencies();

    const response = await handleV213PostConsumptionSelectionRequest(
      requestFor("POST", {
        body: {
          challengeId: CHALLENGE_ID,
          challengeSha256: HASH,
          role: "primary",
          identity: { ...selectionIdentity(), accountId: "not-a-uuid", extra: "reject" },
        },
      }),
      environment,
      config,
      executionContext,
      deps,
    );

    expect(response?.status).toBe(400);
    await expect(bodyOf(response!)).resolves.toEqual({
      error: { code: "V213_MATERIALIZATION_REQUEST_INVALID" },
    });
    expect(deps.session).not.toHaveBeenCalled();
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it("returns 202 for PENDING and 200 for READY selection results", async () => {
    const pending = dependencies({
      submit: vi.fn(async () => ({ state: "PENDING", selectionSha256: null })),
    });
    const ready = dependencies({
      submit: vi.fn(async () => ({ state: "READY", selectionSha256: SELECTION_HASH })),
    });

    const pendingResponse = await handleV213PostConsumptionSelectionRequest(
      requestFor("POST"),
      environment,
      config,
      executionContext,
      pending,
    );
    const readyResponse = await handleV213PostConsumptionSelectionRequest(
      requestFor("POST"),
      environment,
      config,
      executionContext,
      ready,
    );

    expect(pendingResponse?.status).toBe(202);
    await expect(bodyOf(pendingResponse!)).resolves.toMatchObject({
      state: "PENDING",
      selectionSha256: null,
    });
    expect(readyResponse?.status).toBe(200);
    await expect(bodyOf(readyResponse!)).resolves.toMatchObject({
      state: "READY",
      selectionSha256: SELECTION_HASH,
    });
  });

  it("rejects a malformed or failed selection result", async () => {
    const malformed = dependencies({
      submit: vi.fn(async () => ({ state: "READY", selectionSha256: "bad" })),
    });
    const failed = dependencies({
      submit: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });

    const malformedResponse = await handleV213PostConsumptionSelectionRequest(
      requestFor("POST"),
      environment,
      config,
      executionContext,
      malformed,
    );
    const failedResponse = await handleV213PostConsumptionSelectionRequest(
      requestFor("POST"),
      environment,
      config,
      executionContext,
      failed,
    );

    expect(malformedResponse?.status).toBe(409);
    expect(failedResponse?.status).toBe(409);
    await expect(bodyOf(malformedResponse!)).resolves.toEqual({
      error: { code: "V213_MATERIALIZATION_RESULT_INVALID" },
    });
    await expect(bodyOf(failedResponse!)).resolves.toEqual({
      error: { code: "V213_MATERIALIZATION_SELECTION_REJECTED" },
    });
  });
});
