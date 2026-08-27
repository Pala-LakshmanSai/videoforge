import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import type { HostedRuntimeConfiguration, HostedRuntimeEnvironment } from "./configuration.js";
import {
  handleV213AcceptanceOperatorEvidenceRequest,
  handleV213LiveOperatorRequest,
  type V213OperatorEvidenceRouteDependencies,
  type V213OperatorExecutionDocument,
  type V213OperatorRouteDependencies,
} from "./v213-live-operator-route.js";
import type { V213AcceptanceOperatorEvidenceRequest } from "../runtime/v213-acceptance-operator-evidence.js";

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
    workflowId: "v213-v2-10-execution-1",
    attemptId: "db-owned-attempt-1",
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

function evidenceRequest(): V213AcceptanceOperatorEvidenceRequest {
  const unsigned = {
    schemaVersion: "videoforge.v213-operator-evidence-ingestion-request/v1" as const,
    binding: {
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      operationId: "v2-10-operator-free-ranga-pilot" as const,
      checkpoint: "V2-10" as const,
      stageAuthorityId: "22222222-2222-4222-8222-222222222222",
      outerStateSha256: canonicalSha256({ outer: true }),
      workflowId: "v213-v2-10-execution-1",
      executionId: "execution-1",
      executionRequestSha256: canonicalSha256({ request: true }),
      authoritySha256: canonicalSha256({ authority: true }),
    },
    evidence: {
      schemaVersion: "videoforge.v213-v210-visual-decision-evidence/v1" as const,
      kind: "V210_VISUAL_DECISION" as const,
      scope: {
        accountId: "30000000-0000-4000-8000-000000000001",
        workspaceId: "30000000-0000-4000-8000-000000000002",
        projectId: "30000000-0000-4000-8000-000000000003",
        projectRevisionId: "30000000-0000-4000-8000-000000000004",
        requestSha256: canonicalSha256({ scope: true }),
        attemptId: "attempt-1",
      },
      outputSha256: canonicalSha256({ output: true }),
      outputReceiptSha256: canonicalSha256({ outputReceipt: true }),
      decision: "ACCEPTED" as const,
      review: {
        reviewedCutCount: 12,
        everyCutReviewed: true as const,
        noManualMediaEditOrSubstitution: true as const,
        literalRelevance: "PASSED" as const,
        imageRealism: "PASSED" as const,
        avatarIdentityAndCrop: "PASSED" as const,
        lipSync: "PASSED" as const,
        audioVideoQuality: "PASSED" as const,
        prohibitedGraphicsAbsent: "PASSED" as const,
        hardCutsOnly: "PASSED" as const,
        requiredImageZoom: "PASSED" as const,
      },
      observedAt: "2026-08-28T10:00:00.000Z",
    },
    issuedAt: "2026-08-28T10:00:01.000Z",
    nonce: "operator-evidence-nonce-0001",
  };
  return { ...unsigned, requestSha256: canonicalSha256(unsigned) };
}

function v212ChromeEvidenceRequest(): V213AcceptanceOperatorEvidenceRequest {
  const outputSha256 = canonicalSha256({ output: "v212" });
  const unsigned = {
    schemaVersion: "videoforge.v213-operator-evidence-ingestion-request/v1" as const,
    binding: {
      fullLiveAuthorityId: "11111111-1111-4111-8111-111111111111",
      operationId: "v2-12-long-output" as const,
      checkpoint: "V2-12" as const,
      stageAuthorityId: "22222222-2222-4222-8222-222222222222",
      outerStateSha256: canonicalSha256({ outer: true }),
      workflowId: "v213-v2-12-execution-1",
      executionId: "execution-1",
      executionRequestSha256: canonicalSha256({ request: "v212" }),
      authoritySha256: canonicalSha256({ authority: "v212" }),
    },
    evidence: {
      schemaVersion: "videoforge.v213-v212-real-chrome-evidence/v1" as const,
      kind: "V212_REAL_CHROME" as const,
      scope: {
        accountId: "30000000-0000-4000-8000-000000000001",
        workspaceId: "30000000-0000-4000-8000-000000000002",
        projectId: "30000000-0000-4000-8000-000000000003",
        projectRevisionId: "30000000-0000-4000-8000-000000000004",
        requestSha256: canonicalSha256({ scope: "v212" }),
        attemptId: "attempt-v212",
      },
      outputSha256,
      outputReceiptSha256: canonicalSha256({ outputReceipt: "v212" }),
      productionUrlSha256: canonicalSha256({ productionUrl: "https://videoforge.example" }),
      chromeReceiptSha256: canonicalSha256({ chromeReceipt: "v212" }),
      authenticatedSession: true as const,
      privateReadbackPassed: true as const,
      playbackPassed: true as const,
      downloadSha256: outputSha256,
      downloadBytes: 12_345_678,
      observedAt: "2026-08-28T10:00:00.000Z",
    },
    issuedAt: "2026-08-28T10:00:01.000Z",
    nonce: "operator-evidence-v212-chrome-0001",
  };
  return { ...unsigned, requestSha256: canonicalSha256(unsigned) };
}

async function operatorEvidenceHttpRequest(
  value = evidenceRequest(),
  signatureOverride?: string,
): Promise<Request> {
  const body = JSON.stringify(value);
  return new Request("https://videoforge.example/api/operator/v2-13/acceptance-evidence", {
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

describe("V213 append-only operator evidence route", () => {
  it("HMAC-authenticates and persists an exact current-output visual decision", async () => {
    const requestDocument = evidenceRequest();
    const result = {
      schemaVersion: "videoforge.v213-operator-evidence-ingestion-result/v1" as const,
      fullLiveAuthorityId: requestDocument.binding.fullLiveAuthorityId,
      operationId: requestDocument.binding.operationId,
      checkpoint: requestDocument.binding.checkpoint,
      workflowId: requestDocument.binding.workflowId,
      executionRequestSha256: requestDocument.binding.executionRequestSha256,
      kind: requestDocument.evidence.kind,
      evidenceSha256: canonicalSha256(requestDocument.evidence),
      state: "RECORDED" as const,
      recordedAt: "2026-08-28T10:00:02.000Z",
    };
    const dependencies: V213OperatorEvidenceRouteDependencies = {
      ingest: vi.fn(async () => result),
      close: vi.fn(async () => undefined),
    };
    const response = await handleV213AcceptanceOperatorEvidenceRequest(
      await operatorEvidenceHttpRequest(requestDocument),
      environment,
      config,
      dependencies,
      () => new Date("2026-08-28T10:00:02.000Z"),
    );
    expect(response?.status).toBe(201);
    expect(response?.headers.get("cache-control")).toBe("no-store");
    expect(dependencies.ingest).toHaveBeenCalledWith(
      expect.objectContaining({ request: requestDocument }),
    );
  });

  it("accepts exact output-bound authenticated V2-12 Chrome playback and download proof", async () => {
    const requestDocument = v212ChromeEvidenceRequest();
    const result = {
      schemaVersion: "videoforge.v213-operator-evidence-ingestion-result/v1" as const,
      fullLiveAuthorityId: requestDocument.binding.fullLiveAuthorityId,
      operationId: requestDocument.binding.operationId,
      checkpoint: requestDocument.binding.checkpoint,
      workflowId: requestDocument.binding.workflowId,
      executionRequestSha256: requestDocument.binding.executionRequestSha256,
      kind: requestDocument.evidence.kind,
      evidenceSha256: canonicalSha256(requestDocument.evidence),
      state: "RECORDED" as const,
      recordedAt: "2026-08-28T10:00:02.000Z",
    };
    const dependencies: V213OperatorEvidenceRouteDependencies = {
      ingest: vi.fn(async () => result),
      close: vi.fn(async () => undefined),
    };
    const response = await handleV213AcceptanceOperatorEvidenceRequest(
      await operatorEvidenceHttpRequest(requestDocument),
      environment,
      config,
      dependencies,
      () => new Date("2026-08-28T10:00:02.000Z"),
    );
    expect(response?.status).toBe(201);
    expect(dependencies.ingest).toHaveBeenCalledOnce();
  });

  it("rejects V2-12 Chrome evidence when downloaded bytes do not hash to the current output", async () => {
    const original = v212ChromeEvidenceRequest();
    const unsigned = {
      ...original,
      evidence: { ...original.evidence, downloadSha256: canonicalSha256({ stale: true }) },
    };
    const drifted = {
      ...unsigned,
      requestSha256: canonicalSha256({
        schemaVersion: unsigned.schemaVersion,
        binding: unsigned.binding,
        evidence: unsigned.evidence,
        issuedAt: unsigned.issuedAt,
        nonce: unsigned.nonce,
      }),
    } as V213AcceptanceOperatorEvidenceRequest;
    const dependencies: V213OperatorEvidenceRouteDependencies = {
      ingest: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const response = await handleV213AcceptanceOperatorEvidenceRequest(
      await operatorEvidenceHttpRequest(drifted),
      environment,
      config,
      dependencies,
      () => new Date("2026-08-28T10:00:02.000Z"),
    );
    expect(response?.status).toBe(404);
    expect(dependencies.ingest).not.toHaveBeenCalled();
  });

  it("returns tenant-oracle-free not-found before persistence on output or signature drift", async () => {
    const dependencies: V213OperatorEvidenceRouteDependencies = {
      ingest: vi.fn(),
      close: vi.fn(async () => undefined),
    };
    const drifted = {
      ...evidenceRequest(),
      evidence: { ...evidenceRequest().evidence, outputSha256: canonicalSha256({ drift: true }) },
    } as V213AcceptanceOperatorEvidenceRequest;
    const response = await handleV213AcceptanceOperatorEvidenceRequest(
      await operatorEvidenceHttpRequest(drifted, "0".repeat(64)),
      environment,
      config,
      dependencies,
      () => new Date("2026-08-28T10:00:02.000Z"),
    );
    expect(response?.status).toBe(404);
    expect(dependencies.ingest).not.toHaveBeenCalled();
  });
});
