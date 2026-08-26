import { canonicalSha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration";
import { handleV213OperatorWorkflowStart } from "./v213-operator-workflow";

const token = "opaque-operator-token-with-at-least-thirty-two-bytes";
const generationRequestId = "11111111-1111-4111-8111-111111111111";
const outerStateSha256 = `sha256:${"2".repeat(64)}`;
const params = {
  accountId: "22222222-2222-4222-8222-222222222222",
  workspaceId: "33333333-3333-4333-8333-333333333333",
  generationRequestId,
  cancelAt: "2026-08-26T05:10:00.000Z",
  stopAt: "2026-08-26T05:15:00.000Z",
};
const workflowId = `hosted-pair-${generationRequestId}`;
const requestSha256 = canonicalSha256({ workflowId, outerStateSha256, params });
const document = {
  schemaVersion: "videoforge.v213-pair-workflow-start/v1",
  workflowId,
  requestSha256,
  outerStateSha256,
  params,
};

async function hmac(preimage: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const value = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(preimage));
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const config = {
  environment: "production",
  gpuTransport: "QUALIFIED_EXACT",
  neon: { databaseUrl: "postgres://protected" },
} as HostedRuntimeConfiguration;

function environment(
  workflow: HostedRuntimeEnvironment["HOSTED_PAIR_WORKFLOW"],
): HostedRuntimeEnvironment {
  return { VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: token, HOSTED_PAIR_WORKFLOW: workflow };
}

async function post(
  dependencies: Parameters<typeof handleV213OperatorWorkflowStart>[3],
  workflow: HostedRuntimeEnvironment["HOSTED_PAIR_WORKFLOW"],
) {
  const raw = JSON.stringify(document);
  return handleV213OperatorWorkflowStart(
    new Request("https://videoforge.test/api/operator/v2-13/pair-workflows", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-videoforge-request-sha256": requestSha256,
        "x-videoforge-signature": await hmac(raw),
      },
      body: raw,
    }),
    environment(workflow),
    config,
    dependencies,
  );
}

describe("V2-13 one-shot operator Workflow route", () => {
  it("claims in DB before one deterministic Workflow create and records exact outer-state result", async () => {
    const events: string[] = [];
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("claim_v213")) {
        events.push("claim");
        return { rows: [{ claim: { action: "CREATE" } }] };
      }
      events.push("complete");
      return {
        rows: [
          {
            result: {
              schemaVersion: "videoforge.v213-pair-workflow-start-result/v1",
              workflowId,
              requestSha256,
              outerStateSha256,
              state: "STARTED",
            },
          },
        ],
      };
    });
    const create = vi.fn(async () => {
      events.push("create");
      return { id: workflowId };
    });
    const response = await post(
      { query, close: vi.fn(async () => undefined) },
      { create, get: vi.fn() },
    );
    expect(response?.status).toBe(201);
    expect(await response?.json()).toEqual({
      schemaVersion: "videoforge.v213-pair-workflow-start-result/v1",
      workflowId,
      requestSha256,
      outerStateSha256,
      state: "STARTED",
    });
    expect(events).toEqual(["claim", "create", "complete"]);
    expect(create).toHaveBeenCalledOnce();
  });

  it("recovers a lost create acknowledgement with get/status and never redispatches", async () => {
    const status = vi.fn(async () => ({ status: "running" }));
    const create = vi.fn(async () => {
      throw new Error("ACK_LOST");
    });
    const query = vi.fn(async (sql: string) =>
      sql.includes("claim_v213")
        ? { rows: [{ claim: { action: "CREATE" } }] }
        : {
            rows: [
              {
                result: {
                  schemaVersion: "videoforge.v213-pair-workflow-start-result/v1",
                  workflowId,
                  requestSha256,
                  outerStateSha256,
                  state: "EXISTING",
                },
              },
            ],
          },
    );
    const response = await post(
      { query, close: vi.fn(async () => undefined) },
      { create, get: vi.fn(async () => ({ status, sendEvent: vi.fn() })) },
    );
    expect(response?.status).toBe(200);
    expect(create).toHaveBeenCalledOnce();
    expect(status).toHaveBeenCalledOnce();
  });

  it("rejects an invalid HMAC before DB or Workflow access", async () => {
    const query = vi.fn();
    const raw = JSON.stringify(document);
    const response = await handleV213OperatorWorkflowStart(
      new Request("https://videoforge.test/api/operator/v2-13/pair-workflows", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "x-videoforge-request-sha256": requestSha256,
          "x-videoforge-signature": "0".repeat(64),
        },
        body: raw,
      }),
      environment({ create: vi.fn(), get: vi.fn() }),
      config,
      { query, close: vi.fn(async () => undefined) },
    );
    expect(response?.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });
});
