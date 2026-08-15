import type {
  AcceptedPrivateArtifact,
  ArtifactControlPlanePort,
  ArtifactTransferAudit,
  SignedArtifactOperation,
} from "@videoforge/pipeline";
import { describe, expect, it, vi } from "vitest";

import { apiProblem, problemResponse } from "../problem";
import {
  createPrivateArtifactControlPlaneApp,
  MAX_ARTIFACT_METADATA_BODY_BYTES,
} from "./private-artifact-routes";

const ACCOUNT_ID = "account_001";
const WORKSPACE_ID = "workspace_001";

function signed(operation: SignedArtifactOperation["operation"]): SignedArtifactOperation {
  return {
    schemaVersion: "signed-artifact-operation/v1",
    operation,
    workspaceId: WORKSPACE_ID,
    objectKey:
      "workspace/workspace_001/project/project_001/revision/revision_001/inputs/" +
      `${"a".repeat(64)}.bin`,
    uploadId: operation === "DOWNLOAD" ? null : "upload_001",
    partNumber: operation === "UPLOAD_PART" ? 1 : null,
    expiresAtEpochMs: Date.parse("2026-08-10T00:01:00.000Z"),
    transferUri: `vf-local-r2://signed/${operation.toLowerCase()}`,
    token: `token_${operation.toLowerCase()}`,
    applicationBodyBytes: 0,
  };
}

function fakeControlPlane(): ArtifactControlPlanePort & {
  readonly calls: Array<{ readonly operation: string; readonly request: unknown }>;
} {
  const calls: Array<{ operation: string; request: unknown }> = [];
  const invoke = async (operation: SignedArtifactOperation["operation"], request: unknown) => {
    calls.push({ operation, request });
    return signed(operation);
  };
  const audit: ArtifactTransferAudit = {
    applicationBodyBytes: 0,
    directUploadBytes: 0,
    directDownloadBytes: 0,
    signedOperations: 0,
    directOperations: 0,
  };
  return {
    calls,
    signInitiate: (request) => invoke("INITIATE", request),
    signPart: (request) => invoke("UPLOAD_PART", request),
    signComplete: (request) => invoke("COMPLETE", request),
    signAbort: (request) => invoke("ABORT", request),
    signDownload: (request) => invoke("DOWNLOAD", request),
    resolveAccepted: () => Promise.resolve(null as AcceptedPrivateArtifact | null),
    audit: () => audit,
  };
}

function jsonRequest(path: string, body: unknown, workspaceId = WORKSPACE_ID): Request {
  return new Request(`https://videoforge.local${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-workspace-id": workspaceId,
    },
    body: JSON.stringify(body),
  });
}

const objectKey =
  "workspace/workspace_001/project/project_001/revision/revision_001/inputs/" +
  `${"a".repeat(64)}.bin`;

describe("private artifact Hono control-plane boundary", () => {
  it("is fail-closed unless an isolated fixture explicitly enables the legacy raw-key surface", () => {
    expect(() =>
      createPrivateArtifactControlPlaneApp({
        controlPlane: fakeControlPlane(),
        authorize: () => ({ ok: true, accountId: ACCOUNT_ID, workspaceId: WORKSPACE_ID }),
      } as never),
    ).toThrow("LEGACY_RAW_ARTIFACT_KEY_ROUTE_FORBIDDEN");
  });

  it("routes all signing operations through the metadata-only facet", async () => {
    const controlPlane = fakeControlPlane();
    const app = createPrivateArtifactControlPlaneApp({
      legacyFixtureOnly: true,
      controlPlane,
      authorize: (request) => ({
        ok: true,
        accountId: ACCOUNT_ID,
        workspaceId: request.headers.get("x-workspace-id") ?? "",
      }),
    });
    const cases = [
      {
        path: "/api/v1/artifacts/sign/initiate",
        operation: "INITIATE",
        body: {
          idempotencyKey: "upload_001",
          assetId: "asset_001",
          scope: {
            ownerType: "PROJECT_REVISION",
            workspaceId: WORKSPACE_ID,
            projectId: "project_001",
            projectRevisionId: "revision_001",
          },
          objectKey,
          integrity: {
            binarySha256: `sha256:${"a".repeat(64)}`,
            byteSize: 10,
            contentType: "application/octet-stream",
            canonicalDocument: null,
          },
          retention: {
            retentionClass: "ACCEPTED_SCENE",
            retainUntilEpochMs: Date.parse("2026-08-17T00:00:00.000Z"),
          },
          expiresInMs: 60_000,
        },
      },
      {
        path: "/api/v1/artifacts/sign/part",
        operation: "UPLOAD_PART",
        body: {
          workspaceId: WORKSPACE_ID,
          uploadId: "upload_001",
          partNumber: 1,
          partSha256: `sha256:${"a".repeat(64)}`,
          partBytes: 10,
          expiresInMs: 60_000,
        },
      },
      {
        path: "/api/v1/artifacts/sign/complete",
        operation: "COMPLETE",
        body: {
          workspaceId: WORKSPACE_ID,
          uploadId: "upload_001",
          parts: [
            {
              partNumber: 1,
              etag: `etag_${"a".repeat(43)}`,
              partSha256: `sha256:${"a".repeat(64)}`,
              partBytes: 10,
              replayed: false,
            },
          ],
          expiresInMs: 60_000,
        },
      },
      {
        path: "/api/v1/artifacts/sign/abort",
        operation: "ABORT",
        body: { workspaceId: WORKSPACE_ID, uploadId: "upload_001", expiresInMs: 60_000 },
      },
      {
        path: "/api/v1/artifacts/sign/download",
        operation: "DOWNLOAD",
        body: { workspaceId: WORKSPACE_ID, objectKey, expiresInMs: 60_000 },
      },
    ] as const;

    for (const item of cases) {
      const response = await app.fetch(jsonRequest(item.path, item.body));
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        operation: item.operation,
        workspaceId: WORKSPACE_ID,
        applicationBodyBytes: 0,
      });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(controlPlane.calls.map((call) => call.operation)).toEqual(
      cases.map((item) => item.operation),
    );
    expect(
      controlPlane.calls.every((call) => !JSON.stringify(call.request).includes("media-bytes")),
    ).toBe(true);
  });

  it("rejects large media bodies before reading them or reaching either storage facet", async () => {
    const controlPlane = fakeControlPlane();
    const directTransferAccess = vi.fn(() => {
      throw new Error("direct transfer facet must remain unreachable");
    });
    const options = {
      legacyFixtureOnly: true as const,
      controlPlane,
      authorize: () => ({ ok: true as const, accountId: ACCOUNT_ID, workspaceId: WORKSPACE_ID }),
    };
    Object.defineProperty(options, "directTransfer", {
      enumerable: true,
      get: directTransferAccess,
    });
    const app = createPrivateArtifactControlPlaneApp(options);
    const media = new Uint8Array(8 * 1_024 * 1_024);
    const request = new Request("https://videoforge.local/api/v1/artifacts/sign/initiate", {
      method: "POST",
      headers: {
        "content-type": "audio/wav",
        "content-length": String(media.byteLength),
      },
      body: media,
    });
    const originalBody = request.body;
    const bodyAccess = vi.fn(() => originalBody);
    Object.defineProperty(request, "body", { configurable: true, get: bodyAccess });

    const response = await app.fetch(request);
    expect(response.status).toBe(415);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ARTIFACT_METADATA_CONTENT_TYPE_REQUIRED" },
    });
    expect(bodyAccess).not.toHaveBeenCalled();
    expect(controlPlane.calls).toHaveLength(0);
    expect(directTransferAccess).not.toHaveBeenCalled();
  });

  it("authorizes before body reads and rejects workspace mismatches and oversized metadata", async () => {
    const controlPlane = fakeControlPlane();
    const unauthorized = createPrivateArtifactControlPlaneApp({
      legacyFixtureOnly: true,
      controlPlane,
      authorize: () => ({
        ok: false,
        response: problemResponse(
          apiProblem(
            "SESSION_REQUIRED",
            401,
            "Authentication is required",
            "Continue with an invited account.",
            false,
          ),
        ),
      }),
    });
    const deniedRequest = jsonRequest("/api/v1/artifacts/sign/download", {
      workspaceId: WORKSPACE_ID,
      objectKey,
      expiresInMs: 60_000,
    });
    const originalBody = deniedRequest.body;
    const bodyAccess = vi.fn(() => originalBody);
    Object.defineProperty(deniedRequest, "body", { configurable: true, get: bodyAccess });
    expect((await unauthorized.fetch(deniedRequest)).status).toBe(401);
    expect(bodyAccess).not.toHaveBeenCalled();

    const app = createPrivateArtifactControlPlaneApp({
      legacyFixtureOnly: true,
      controlPlane,
      authorize: () => ({ ok: true, accountId: ACCOUNT_ID, workspaceId: WORKSPACE_ID }),
    });
    const mismatch = await app.fetch(
      jsonRequest(
        "/api/v1/artifacts/sign/download",
        { workspaceId: "workspace_other", objectKey, expiresInMs: 60_000 },
        WORKSPACE_ID,
      ),
    );
    expect(mismatch.status).toBe(403);

    const oversized = new Request("https://videoforge.local/api/v1/artifacts/sign/initiate", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_ARTIFACT_METADATA_BODY_BYTES + 1),
      },
      body: "{}",
    });
    const oversizedOriginalBody = oversized.body;
    const oversizedBodyAccess = vi.fn(() => oversizedOriginalBody);
    Object.defineProperty(oversized, "body", {
      configurable: true,
      get: oversizedBodyAccess,
    });
    const tooLarge = await app.fetch(oversized);
    expect(tooLarge.status).toBe(413);
    expect(oversizedBodyAccess).not.toHaveBeenCalled();
    expect(controlPlane.calls).toHaveLength(0);
  });

  it("rejects ambiguous framing and non-exact adapter output", async () => {
    const controlPlane = fakeControlPlane();
    const app = createPrivateArtifactControlPlaneApp({
      legacyFixtureOnly: true,
      controlPlane,
      authorize: () => ({ ok: true, accountId: ACCOUNT_ID, workspaceId: WORKSPACE_ID }),
    });
    const body = JSON.stringify({ workspaceId: WORKSPACE_ID, objectKey, expiresInMs: 60_000 });
    const chunked = new Request("https://videoforge.local/api/v1/artifacts/sign/download", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    chunked.headers.set("transfer-encoding", "chunked");
    expect((await app.fetch(chunked)).status).toBe(400);

    const mismatchedLength = new Request(
      "https://videoforge.local/api/v1/artifacts/sign/download",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": "2",
        },
        body,
      },
    );
    expect((await app.fetch(mismatchedLength)).status).toBe(400);
    expect(controlPlane.calls).toHaveLength(0);

    const invalidControlPlane = {
      ...controlPlane,
      signDownload: async () => ({
        ...signed("INITIATE"),
        mediaBody: "media-bytes".repeat(16 * 1_024),
      }),
    } as unknown as ArtifactControlPlanePort;
    const invalidApp = createPrivateArtifactControlPlaneApp({
      legacyFixtureOnly: true,
      controlPlane: invalidControlPlane,
      authorize: () => ({ ok: true, accountId: ACCOUNT_ID, workspaceId: WORKSPACE_ID }),
    });
    const invalidResponse = await invalidApp.fetch(
      jsonRequest("/api/v1/artifacts/sign/download", {
        workspaceId: WORKSPACE_ID,
        objectKey,
        expiresInMs: 60_000,
      }),
    );
    expect(invalidResponse.status).toBe(500);
    const invalidText = await invalidResponse.text();
    expect(invalidText).not.toContain("media-bytes");
    expect(JSON.parse(invalidText)).toMatchObject({
      error: { code: "ARTIFACT_SIGNING_RESULT_INVALID" },
    });
  });
});
