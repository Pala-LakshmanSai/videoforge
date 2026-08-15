import {
  ImageStyleDerivedEditError,
  type EditedImageStyleProfile,
  type ImageStyleDerivedEditErrorCode,
} from "@videoforge/control-plane";
import {
  AuthWorkspaceBoundary,
  DeterministicLocalAuthorizationDirectory,
  DeterministicLocalIdentityProvider,
  type AuthSession,
  type WorkspaceAccessRecord,
} from "@videoforge/control-plane/auth";
import {
  IMAGE_STYLE_EDIT_REQUEST_VERSION,
  formatImageStyleEditVersionTag,
  imageStyleEditProblemSchema,
  imageStyleEditResponseSchema,
} from "@videoforge/contracts/image-style-edit";
import { describe, expect, it, vi } from "vitest";

import PROFILE from "../../../../packages/contracts/generated/fixtures/default_image_style_v1.json";
import { createImageStyleEditApiApp } from "./image-style-edit-app";

const NOW = "2026-08-11T08:00:00.000Z";
const ACCOUNT_A = "account_style_api_a";
const WORKSPACE_A = "workspace_style_api_a";
const WORKSPACE_B = "workspace_style_api_b";
const USER_A = "user_style_api_a";
const TOKEN_A = "style_api_session_a";
const HASH_A = `sha256:${"a".repeat(64)}` as const;
const HASH_B = `sha256:${"b".repeat(64)}` as const;

function session(): { readonly sessionToken: string; readonly session: AuthSession } {
  return {
    sessionToken: TOKEN_A,
    session: {
      sessionId: "session_style_api_a",
      userId: USER_A,
      normalizedEmail: "style-api-a@example.test",
      provider: "LOCAL",
      status: "ACTIVE",
      issuedAt: "2026-08-11T07:00:00.000Z",
      expiresAt: "2026-08-11T09:00:00.000Z",
    },
  };
}

function access(): WorkspaceAccessRecord {
  return {
    workspace: { workspaceId: WORKSPACE_A, accountId: ACCOUNT_A, status: "ACTIVE" },
    identity: {
      userId: USER_A,
      normalizedEmail: "style-api-a@example.test",
      status: "ACTIVE",
    },
    invitation: {
      workspaceId: WORKSPACE_A,
      normalizedEmail: "style-api-a@example.test",
      status: "ACCEPTED",
    },
    membership: {
      membershipId: "membership_style_api_a",
      workspaceId: WORKSPACE_A,
      userId: USER_A,
      role: "MEMBER",
      status: "ACTIVE",
    },
  };
}

function authorization(): AuthWorkspaceBoundary {
  return new AuthWorkspaceBoundary({
    sessions: new DeterministicLocalIdentityProvider([session()]),
    directory: new DeterministicLocalAuthorizationDirectory([access()]),
    clock: { nowEpochMs: () => Date.parse(NOW) },
  });
}

function result(replayed = false): EditedImageStyleProfile {
  return {
    kind: "IMAGE_STYLE_DERIVED_PROFILE_EDITED",
    workspaceId: WORKSPACE_A,
    styleId: "style_api_a",
    versionId: "version_api_a",
    editorUserId: USER_A,
    editedAt: NOW,
    editId: "edit_style_api_a",
    rootSourceArtifactId: "root_style_api_a",
    rootSourceArtifactHash: HASH_A,
    parentArtifactId: "parent_style_api_a",
    parentArtifactHash: HASH_A,
    derivedArtifactId: "derived_style_api_a",
    derivedArtifactHash: HASH_B,
    changedPointers: ["/summary"],
    priorRevision: 1,
    resultRevision: 2,
    invalidatedReviewSnapshotId: "review_style_api_a",
    replayed,
  };
}

function headers(overrides: Record<string, string> = {}): HeadersInit {
  return {
    authorization: `Bearer ${TOKEN_A}`,
    "content-type": "application/json",
    "idempotency-key": "style-api-edit-1",
    "if-match": formatImageStyleEditVersionTag({ revision: 1, currentArtifactHash: HASH_A }),
    "x-videoforge-workspace-id": WORKSPACE_A,
    ...overrides,
  };
}

function body(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: IMAGE_STYLE_EDIT_REQUEST_VERSION,
    candidate_profile: PROFILE,
    ...overrides,
  });
}

const route = "/api/v1/image-styles/style_api_a/versions/version_api_a";

describe("Image Style edit API", () => {
  it("derives scope from auth and returns exact current lineage authority", async () => {
    const edit = vi.fn(async () => result());
    const app = createImageStyleEditApiApp({
      authorization: authorization(),
      editService: { edit },
      clock: { nowIso: () => NOW },
    });
    const response = await app.request(route, {
      method: "PATCH",
      headers: headers(),
      body: body(),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("etag")).toBe(
      formatImageStyleEditVersionTag({ revision: 2, currentArtifactHash: HASH_B }),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    const responseBody = await response.json();
    expect(imageStyleEditResponseSchema.safeParse(responseBody).success).toBe(true);
    expect(responseBody).toMatchObject({
      edit: {
        current_artifact_id: "derived_style_api_a",
        current_artifact_hash: HASH_B,
        result_revision: 2,
        root_source_artifact_id: "root_style_api_a",
        replayed: false,
      },
    });
    expect(edit).toHaveBeenCalledOnce();
    expect(edit).toHaveBeenCalledWith(
      { accountId: ACCOUNT_A, workspaceId: WORKSPACE_A, actorUserId: USER_A },
      expect.objectContaining({
        styleId: "style_api_a",
        versionId: "version_api_a",
        expectedRevision: 1,
        expectedCurrentArtifactHash: HASH_A,
        idempotencyKey: "style-api-edit-1",
        candidateProfile: PROFILE,
        editedAt: NOW,
      }),
    );
  });

  it("marks exact service replay without changing response authority", async () => {
    const app = createImageStyleEditApiApp({
      authorization: authorization(),
      editService: { edit: async () => result(true) },
      clock: { nowIso: () => NOW },
    });
    const response = await app.request(route, {
      method: "PATCH",
      headers: headers(),
      body: body(),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-videoforge-idempotent-replay")).toBe("true");
    await expect(response.json()).resolves.toMatchObject({ edit: { replayed: true } });
  });

  it("authenticates before parsing and rejects cross-workspace access", async () => {
    const edit = vi.fn(async () => result());
    const app = createImageStyleEditApiApp({
      authorization: authorization(),
      editService: { edit },
      clock: { nowIso: () => NOW },
    });
    const unauthenticated = await app.request(route, {
      method: "PATCH",
      headers: headers({ authorization: "" }),
      body: "not-json",
    });
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toMatchObject({
      error: { code: "AUTHENTICATION_REQUIRED" },
    });
    const wrongWorkspace = await app.request(route, {
      method: "PATCH",
      headers: headers({ "x-videoforge-workspace-id": WORKSPACE_B }),
      body: body(),
    });
    expect(wrongWorkspace.status).toBe(403);
    expect(edit).not.toHaveBeenCalled();
  });

  it("rejects absent or malformed concurrency and idempotency authority", async () => {
    const app = createImageStyleEditApiApp({
      authorization: authorization(),
      editService: { edit: async () => result() },
      clock: { nowIso: () => NOW },
    });
    const cases = [
      [{ "idempotency-key": "" }, 400, "IDEMPOTENCY_KEY_REQUIRED"],
      [{ "if-match": "" }, 400, "IF_MATCH_INVALID"],
      [{ "if-match": "*" }, 400, "IF_MATCH_INVALID"],
    ] as const;
    for (const [overrides, status, code] of cases) {
      const response = await app.request(route, {
        method: "PATCH",
        headers: headers(overrides),
        body: body(),
      });
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ error: { code } });
    }
    const missingIfMatchHeaders = new Headers(headers());
    missingIfMatchHeaders.delete("if-match");
    const missing = await app.request(route, {
      method: "PATCH",
      headers: missingIfMatchHeaders,
      body: body(),
    });
    expect(missing.status).toBe(428);
  });

  it("rejects malformed JSON, partial candidates, unknown fields, and client identity", async () => {
    const edit = vi.fn(async () => result());
    const app = createImageStyleEditApiApp({
      authorization: authorization(),
      editService: { edit },
      clock: { nowIso: () => NOW },
    });
    const requests = [
      ["not-json", 400, "INVALID_JSON"],
      [
        body({ candidate_profile: { schema_version: "image-style-profile/v1" } }),
        422,
        "INVALID_IMAGE_STYLE_EDIT_REQUEST",
      ],
      [body({ actor_user_id: "forged" }), 422, "INVALID_IMAGE_STYLE_EDIT_REQUEST"],
      [body({ workspace_id: WORKSPACE_B }), 422, "INVALID_IMAGE_STYLE_EDIT_REQUEST"],
    ] as const;
    for (const [requestBody, status, code] of requests) {
      const response = await app.request(route, {
        method: "PATCH",
        headers: headers(),
        body: requestBody,
      });
      expect(response.status).toBe(status);
      const responseBody = await response.json();
      expect(responseBody).toMatchObject({ error: { code } });
      expect(imageStyleEditProblemSchema.safeParse(responseBody).success).toBe(true);
    }
    expect(edit).not.toHaveBeenCalled();
  });

  it.each([
    ["IDEMPOTENCY_CONFLICT", 409],
    ["INPUT_INVALID", 422],
    ["LINEAGE_INVALID", 409],
    ["PROFILE_INVALID", 422],
    ["REPOSITORY_FAILURE", 500],
    ["STYLE_NOT_FOUND", 404],
    ["STYLE_PROFILE_NO_CHANGES", 422],
    ["STYLE_VERSION_CONFLICT", 412],
    ["STYLE_VERSION_IMMUTABLE", 409],
  ] as const)("maps %s without leaking infrastructure detail", async (code, status) => {
    const app = createImageStyleEditApiApp({
      authorization: authorization(),
      editService: {
        edit: async () => {
          throw new ImageStyleDerivedEditError(
            code as ImageStyleDerivedEditErrorCode,
            "safe detail",
          );
        },
      },
      clock: { nowIso: () => NOW },
    });
    const response = await app.request(route, {
      method: "PATCH",
      headers: headers(),
      body: body(),
    });
    expect(response.status).toBe(status);
    const responseBody = await response.json();
    expect(responseBody).toMatchObject({ error: { code, detail: "safe detail" } });
    expect(imageStyleEditProblemSchema.safeParse(responseBody).success).toBe(true);
  });
});
