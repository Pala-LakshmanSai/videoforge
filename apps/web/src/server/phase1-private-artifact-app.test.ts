import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AuthWorkspaceBoundary,
  DeterministicLocalAuthorizationDirectory,
  DeterministicLocalIdentityProvider,
  type AuthSession,
  type WorkspaceAccessRecord,
} from "@videoforge/control-plane/auth";
import {
  LocalArtifactStore,
  type ArtifactPartReceipt,
  type SignedArtifactOperation,
} from "@videoforge/pipeline";
import { afterEach, describe, expect, it } from "vitest";

import { createPhase1PrivateArtifactApp } from "./phase1-private-artifact-app";

const NOW = Date.parse("2026-08-10T13:00:00.000Z");
const WORKSPACE_A = "workspace_phase1_a";
const WORKSPACE_B = "workspace_phase1_b";
const USER_A = "user_phase1_a";
const USER_B = "user_phase1_b";
const TOKEN_A = "phase1_session_token_a";
const TOKEN_B = "phase1_session_token_b";
const temporaryRoots: string[] = [];

function session(
  token: string,
  userId: string,
  email: string,
): {
  readonly sessionToken: string;
  readonly session: AuthSession;
} {
  return {
    sessionToken: token,
    session: {
      sessionId: `session_${userId}`,
      userId,
      normalizedEmail: email,
      provider: "LOCAL",
      status: "ACTIVE",
      issuedAt: "2026-08-10T12:00:00.000Z",
      expiresAt: "2026-08-10T14:00:00.000Z",
    },
  };
}

function access(workspaceId: string, userId: string, email: string): WorkspaceAccessRecord {
  return {
    workspace: { workspaceId, accountId: `account_for_${workspaceId}`, status: "ACTIVE" },
    identity: { userId, normalizedEmail: email, status: "ACTIVE" },
    invitation: { workspaceId, normalizedEmail: email, status: "ACCEPTED" },
    membership: {
      membershipId: `membership_${workspaceId}_${userId}`,
      workspaceId,
      userId,
      role: "MEMBER",
      status: "ACTIVE",
    },
  };
}

function authorization() {
  return new AuthWorkspaceBoundary({
    sessions: new DeterministicLocalIdentityProvider([
      session(TOKEN_A, USER_A, "phase1-a@example.test"),
      session(TOKEN_B, USER_B, "phase1-b@example.test"),
    ]),
    directory: new DeterministicLocalAuthorizationDirectory([
      access(WORKSPACE_A, USER_A, "phase1-a@example.test"),
      access(WORKSPACE_B, USER_B, "phase1-b@example.test"),
    ]),
    clock: { nowEpochMs: () => NOW },
  });
}

function sessionHeaders(token: string, workspaceId: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    "x-videoforge-workspace-id": workspaceId,
  };
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function largeValidWave(dataBytes = 9 * 1_024 * 1_024): Uint8Array {
  const evenDataBytes = dataBytes - (dataBytes % 2);
  const bytes = new Uint8Array(44 + evenDataBytes);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      bytes[offset + index] = value.charCodeAt(index);
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 48_000, true);
  view.setUint32(28, 96_000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, evenDataBytes, true);
  for (let index = 44; index < bytes.byteLength; index += 1) {
    bytes[index] = index % 251;
  }
  return bytes;
}

async function signedRequest(
  app: ReturnType<typeof createPhase1PrivateArtifactApp>,
  path: string,
  body: unknown,
  token = TOKEN_A,
  workspaceId = WORKSPACE_A,
): Promise<{ readonly response: Response; readonly operation: SignedArtifactOperation | null }> {
  const response = await app.request(path, {
    method: "POST",
    headers: sessionHeaders(token, workspaceId),
    body: JSON.stringify(body),
  });
  const operation = response.ok ? ((await response.json()) as SignedArtifactOperation) : null;
  return { response, operation };
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Phase 1 private artifact composition", () => {
  it("keeps two invited accounts isolated while large WAV bytes use only signed direct transfer", async () => {
    const sandbox = await mkdtemp(join(tmpdir(), "videoforge-phase1-isolation-"));
    temporaryRoots.push(sandbox);
    const store = await LocalArtifactStore.create(join(sandbox, "artifacts"), {
      signingKey: new Uint8Array(32).fill(0x71),
      clock: { nowEpochMs: () => NOW },
      maximumSignatureTtlMs: 5 * 60 * 1_000,
    });
    const app = createPhase1PrivateArtifactApp({
      legacyFixtureOnly: true,
      authorization: authorization(),
      controlPlane: store.controlPlane,
    });
    const bytes = largeValidWave();
    const digest = sha256(bytes);
    const objectKey =
      `workspace/${WORKSPACE_A}/project/project_phase1_a/revision/revision_phase1_a/inputs/` +
      `${digest.slice("sha256:".length)}.wav`;

    const initiated = await signedRequest(app, "/api/v1/artifacts/sign/initiate", {
      idempotencyKey: "phase1-large-voiceover",
      assetId: "asset_phase1_voiceover_a",
      scope: {
        ownerType: "PROJECT_REVISION",
        workspaceId: WORKSPACE_A,
        projectId: "project_phase1_a",
        projectRevisionId: "revision_phase1_a",
      },
      objectKey,
      integrity: {
        binarySha256: digest,
        byteSize: bytes.byteLength,
        contentType: "audio/wav",
        canonicalDocument: null,
      },
      retention: { retentionClass: "RETAIN_WHILE_REFERENCED", retainUntilEpochMs: null },
      expiresInMs: 60_000,
    });
    expect(initiated.response.status).toBe(200);
    expect(initiated.operation?.applicationBodyBytes).toBe(0);
    const upload = await store.directTransfer.initiate(initiated.operation!);

    const ranges = [
      [0, 4 * 1_024 * 1_024],
      [4 * 1_024 * 1_024, 8 * 1_024 * 1_024],
      [8 * 1_024 * 1_024, bytes.byteLength],
    ] as const;
    const receipts: ArtifactPartReceipt[] = [];
    for (const [index, [start, end]] of ranges.entries()) {
      const part = bytes.subarray(start, end);
      const signedPart = await signedRequest(app, "/api/v1/artifacts/sign/part", {
        workspaceId: WORKSPACE_A,
        uploadId: upload.uploadId,
        partNumber: index + 1,
        partSha256: sha256(part),
        partBytes: part.byteLength,
        expiresInMs: 60_000,
      });
      expect(signedPart.operation?.applicationBodyBytes).toBe(0);
      receipts.push(await store.directTransfer.uploadPart(signedPart.operation!, part));
    }

    const completed = await signedRequest(app, "/api/v1/artifacts/sign/complete", {
      workspaceId: WORKSPACE_A,
      uploadId: upload.uploadId,
      parts: receipts,
      expiresInMs: 60_000,
    });
    const accepted = await store.directTransfer.complete(completed.operation!);
    expect(accepted.binarySha256).toBe(digest);
    expect(accepted.byteSize).toBe(bytes.byteLength);

    const wrongAccountWrongScope = await signedRequest(
      app,
      "/api/v1/artifacts/sign/download",
      { workspaceId: WORKSPACE_A, objectKey, expiresInMs: 60_000 },
      TOKEN_B,
      WORKSPACE_A,
    );
    expect(wrongAccountWrongScope.response.status).toBe(403);
    await expect(wrongAccountWrongScope.response.json()).resolves.toMatchObject({
      error: { code: "WORKSPACE_ACCESS_REQUIRED" },
    });

    const wrongAccountBodyScope = await signedRequest(
      app,
      "/api/v1/artifacts/sign/download",
      { workspaceId: WORKSPACE_A, objectKey, expiresInMs: 60_000 },
      TOKEN_B,
      WORKSPACE_B,
    );
    expect(wrongAccountBodyScope.response.status).toBe(403);
    await expect(wrongAccountBodyScope.response.json()).resolves.toMatchObject({
      error: { code: "WORKSPACE_ACCESS_REQUIRED" },
    });

    const signedDownload = await signedRequest(app, "/api/v1/artifacts/sign/download", {
      workspaceId: WORKSPACE_A,
      objectKey,
      expiresInMs: 60_000,
    });
    const downloaded = await store.directTransfer.download(signedDownload.operation!);
    expect(sha256(downloaded.bytes)).toBe(digest);
    expect(store.controlPlane.audit()).toStrictEqual({
      applicationBodyBytes: 0,
      directUploadBytes: bytes.byteLength,
      directDownloadBytes: bytes.byteLength,
      signedOperations: 6,
      directOperations: 6,
    });
  });
});
