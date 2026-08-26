import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration.js";
import {
  handleV213LiveOperatorRequest,
  type V213OperatorExecutionDocument,
  type V213OperatorRouteDependencies,
} from "./v213-live-operator-route.js";

const token = "operator-secret-that-is-at-least-thirty-two-bytes";
const config = {
  environment: "production",
  gpuTransport: "QUALIFIED_EXACT",
} as HostedRuntimeConfiguration;
const environment = {
  VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: token,
} as HostedRuntimeEnvironment;

async function signature(body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function document(): V213OperatorExecutionDocument {
  const value = {
    schemaVersion: "videoforge.v213-hosted-acceptance-command/v1" as const,
    commandId: "command-1",
    stageAuthorityId: "stage-1",
    command: "v2-10-operator-free-ranga-pilot" as const,
    checkpoint: "V2-10" as const,
    workflowId: "v213-v2-10-command-1",
    attemptId: "v213-v2-10-command-1-attempt",
    accountId: "account-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    projectRevisionId: "revision-1",
    outerStateSha256: canonicalSha256({ outer: 1 }),
  };
  return {
    ...value,
    requestSha256: canonicalSha256({
      command: value.command,
      checkpoint: value.checkpoint,
      workflowId: value.workflowId,
      attemptId: value.attemptId,
      accountId: value.accountId,
      workspaceId: value.workspaceId,
      projectId: value.projectId,
      projectRevisionId: value.projectRevisionId,
      outerStateSha256: value.outerStateSha256,
    }),
  };
}

async function request(value = document(), signatureOverride?: string): Promise<Request> {
  const body = JSON.stringify(value);
  return new Request("https://videoforge.example/api/operator/v2-13/live-acceptance", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(body).byteLength),
      "x-videoforge-signature": signatureOverride ?? (await signature(body)),
    },
    body,
  });
}

function dependencies(existing = false) {
  const result = {
    evidenceSha256: canonicalSha256({ evidence: 1 }),
    summary: { terminal: true, zeroWorkersAfter: true },
  };
  const value: V213OperatorRouteDependencies = {
    claim: vi.fn(async () =>
      existing
        ? { action: "EXISTING" as const, result }
        : { action: "EXECUTE" as const, execution: { databaseOwned: true } },
    ),
    execute: vi.fn(async () => result),
    complete: vi.fn(async () => result),
    close: vi.fn(async () => undefined),
  };
  return value;
}

describe("V213 operator-only acceptance route", () => {
  it("claims DB state before executing and returns terminal evidence", async () => {
    const deps = dependencies();
    const response = await handleV213LiveOperatorRequest(
      await request(),
      environment,
      config,
      undefined,
      deps,
    );
    expect(response?.status).toBe(201);
    expect(deps.claim).toHaveBeenCalledOnce();
    expect(deps.execute).toHaveBeenCalledWith("V2-10", { databaseOwned: true }, "EXECUTE");
    expect((deps.claim as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      (deps.execute as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]!,
    );
  });

  it("returns replay readback without executing again", async () => {
    const deps = dependencies(true);
    const response = await handleV213LiveOperatorRequest(
      await request(),
      environment,
      config,
      undefined,
      deps,
    );
    expect(response?.status).toBe(200);
    expect(deps.execute).not.toHaveBeenCalled();
  });

  it("uses a tenant-oracle-free rejection for HMAC or identity drift", async () => {
    const deps = dependencies();
    const response = await handleV213LiveOperatorRequest(
      await request({ ...document(), requestSha256: canonicalSha256({ drift: 1 }) as Sha256 }),
      environment,
      config,
      undefined,
      deps,
    );
    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({ error: { code: "NOT_FOUND" } });
    expect(deps.claim).not.toHaveBeenCalled();
  });
});
