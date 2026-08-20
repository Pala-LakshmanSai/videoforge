import { describe, expect, it } from "vitest";

import { hostedRuntimeConfiguration, type HostedRuntimeEnvironment } from "./configuration";
import { handleV207GeneratedOutputPort } from "./v207-output-ports";

const nonce = "a".repeat(64);
const objectKey =
  "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/mage-image/job/attempt-a/artifact/scene-a";

function environment(): HostedRuntimeEnvironment {
  return {
    PRIVATE_ARTIFACTS: {
      async head() {
        return null;
      },
      async get() {
        return null;
      },
      async put() {
        return {};
      },
      async list() {
        return { objects: [], truncated: false };
      },
      async delete() {},
    },
    VIDEO_WORKFLOW: {
      async create() {
        return { id: "workflow-a" };
      },
      async get() {
        return { async status() {}, async sendEvent() {} };
      },
    },
    VIDEOFORGE_PROVIDER_MODE: "staging",
    VIDEOFORGE_COMMIT: "v207-test",
    VIDEOFORGE_PUBLIC_ORIGIN: "https://staging.example.test",
    VIDEOFORGE_R2_BUCKET_NAME: "videoforge-v2-06-staging-private",
    R2_ACCOUNT_ID: "account-id",
    R2_ACCESS_KEY_ID: "access-key-id",
    R2_SECRET_ACCESS_KEY: "secret-access-key",
    DATABASE_URL:
      "postgresql://fixture:fixture@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
    BETTER_AUTH_SECRET: "better-auth-secret-000000000000000000000000",
    GOOGLE_CLIENT_ID: "google-client.apps.example.test",
    GOOGLE_CLIENT_SECRET: "google-client-secret",
    WORKFLOW_CALLBACK_SECRET: "workflow-callback-secret-000000000000000000000",
    MEDIA_WORKER_TOKEN_SECRET: "media-worker-token-secret-00000000000000000000",
    MEDIA_WORKER_RELEASE_MANIFEST_JSON: JSON.stringify({
      schema_version: "videoforge-media-worker-release/v1",
      version: "0.1.0",
      minimum_protocol_version: 1,
      execution_bundle_sha256: `sha256:${"a".repeat(64)}`,
      whisper_model_sha256: `sha256:${"b".repeat(64)}`,
      windows: {
        url: "https://downloads.example.test/worker.exe",
        sha256: `sha256:${"c".repeat(64)}`,
        size_bytes: 1,
        trust: "UNSIGNED_BETA",
      },
      macos: {
        url: "https://downloads.example.test/worker.dmg",
        sha256: `sha256:${"d".repeat(64)}`,
        size_bytes: 1,
        trust: "AD_HOC_BETA",
      },
    }),
    VIDEOFORGE_V207_AUTHORITY_NONCE: nonce,
  };
}

function request(body: unknown, authority = nonce): Request {
  return new Request("https://staging.example.test/api/v2/v207/generated-output-port", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-videoforge-v207-authority": authority,
    },
    body: JSON.stringify(body),
  });
}

describe("V2-07 hosted generated-output port", () => {
  const config = hostedRuntimeConfiguration(environment());

  it("signs a bounded PUT without predeclaring output bytes", async () => {
    const response = await handleV207GeneratedOutputPort(
      request({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "PUT",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        content_type: "image/png",
        max_content_length: 4 * 1024 * 1024,
        lifetime_seconds: 300,
      }),
      config,
      environment(),
    );
    expect(response?.status).toBe(200);
    const value = (await response?.json()) as Record<string, unknown>;
    expect(value.schema_version).toBe("videoforge-v207-generated-output-port/v1");
    expect(value.method).toBe("PUT");
    expect(value.maxContentLength).toBe(4 * 1024 * 1024);
    expect(value.url).toMatch(/^https:\/\//u);
  });

  it("signs a checksum-bound GET only after measured output facts exist", async () => {
    const response = await handleV207GeneratedOutputPort(
      request({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "GET",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
        content_type: "image/png",
        max_content_length: 4 * 1024 * 1024,
        lifetime_seconds: 300,
        content_length: 3,
        checksum_sha256: `sha256:${"e".repeat(64)}`,
      }),
      config,
      environment(),
    );
    expect(response?.status).toBe(200);
    const value = (await response?.json()) as Record<string, unknown>;
    expect(value.schema_version).toBe("videoforge-v207-generated-output-read-port/v1");
    expect(value.method).toBe("GET");
    expect(value.contentLength).toBe(3);
  });

  it("rejects wrong nonce, scope/path, and extra fields", async () => {
    const base = {
      schema_version: "videoforge-v207-generated-output-port-request/v1",
      operation: "PUT",
      account_id: "account-a",
      workspace_id: "workspace-a",
      object_key: objectKey,
      content_type: "image/png",
      max_content_length: 4 * 1024 * 1024,
      lifetime_seconds: 300,
    };
    expect(
      (await handleV207GeneratedOutputPort(request(base, "b".repeat(64)), config, environment()))
        ?.status,
    ).toBe(403);
    expect(
      (
        await handleV207GeneratedOutputPort(
          request({ ...base, object_key: objectKey.replace("account-a", "account-b") }),
          config,
          environment(),
        )
      )?.status,
    ).toBe(400);
    expect(
      (
        await handleV207GeneratedOutputPort(
          request({ ...base, unexpected: true }),
          config,
          environment(),
        )
      )?.status,
    ).toBe(400);
  });

  it("deletes one exact generated object only with the activation nonce", async () => {
    const deleted: string[] = [];
    const runtime = environment();
    runtime.PRIVATE_ARTIFACTS!.delete = async (key) => {
      deleted.push(...(Array.isArray(key) ? key : [key]));
    };
    const response = await handleV207GeneratedOutputPort(
      request({
        schema_version: "videoforge-v207-generated-output-port-request/v1",
        operation: "DELETE",
        account_id: "account-a",
        workspace_id: "workspace-a",
        object_key: objectKey,
      }),
      config,
      runtime,
    );
    expect(response?.status).toBe(200);
    await expect(response?.json()).resolves.toMatchObject({
      schema_version: "videoforge-v207-generated-output-delete/v1",
      deleted: true,
    });
    expect(deleted).toEqual([objectKey]);
    expect(
      (
        await handleV207GeneratedOutputPort(
          request(
            {
              schema_version: "videoforge-v207-generated-output-port-request/v1",
              operation: "DELETE",
              account_id: "account-a",
              workspace_id: "workspace-a",
              object_key: objectKey,
            },
            "b".repeat(64),
          ),
          config,
          runtime,
        )
      )?.status,
    ).toBe(403);
  });
});
