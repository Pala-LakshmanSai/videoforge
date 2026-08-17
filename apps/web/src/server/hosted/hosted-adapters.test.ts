import { describe, expect, it } from "vitest";

import { CloudRunJobsClient, executionNamesForAttempt } from "./cloud-run";
import {
  HostedConfigurationError,
  hostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "./configuration";
import { HostedR2Signer } from "./r2";

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
        return {
          async status() {
            return {};
          },
          async sendEvent() {},
        };
      },
    },
    VIDEOFORGE_COMMIT: "commit-v2-06",
    VIDEOFORGE_PROVIDER_MODE: "staging",
    VIDEOFORGE_PUBLIC_ORIGIN: "https://staging.videoforge.example.test",
    VIDEOFORGE_R2_BUCKET_NAME: "videoforge-v2-06-staging-private",
    GCP_PROJECT_ID: "videoforge-staging-project",
    GCP_REGION: "asia-south1",
    GCP_ASR_JOB_NAME: "videoforge-v2-06-asr-staging",
    GCP_RENDER_JOB_NAME: "videoforge-v2-06-render-staging",
    DATABASE_URL: "postgresql://fixture:fixture@fixture.example.test/videoforge?sslmode=require",
    BETTER_AUTH_SECRET: "fixture-better-auth-secret-00000000000000000001",
    GOOGLE_CLIENT_ID: "fixture-google-client.apps.example.test",
    GOOGLE_CLIENT_SECRET: "fixture-google-client-secret",
    R2_ACCOUNT_ID: "fixture-cloudflare-account-id",
    R2_ACCESS_KEY_ID: "fixture-r2-access-key-id",
    R2_SECRET_ACCESS_KEY: "fixture-r2-secret-access-key",
    GCP_RUN_INVOKER_SERVICE_ACCOUNT_JSON: "fixture-service-account-json",
    EMAIL_DELIVERY_ENDPOINT: "https://email.example.test/v1/send",
    EMAIL_DELIVERY_API_KEY: "fixture-email-api-key",
    WORKFLOW_CALLBACK_SECRET: "fixture-workflow-callback-secret-00000000000001",
  };
}

describe("V2-06 hosted adapters", () => {
  it("reconciles an ambiguous Cloud Run dispatch only to its exact attempt lineage", () => {
    const name = "projects/project-a/locations/asia-south1/jobs/job-a/executions/execution-a";
    expect(
      executionNamesForAttempt(
        [
          {
            name,
            template: {
              containers: [{ env: [{ name: "VIDEOFORGE_ATTEMPT_ID", value: "attempt-a" }] }],
            },
          },
          {
            name: `${name}-other`,
            template: {
              containers: [{ env: [{ name: "VIDEOFORGE_ATTEMPT_ID", value: "attempt-b" }] }],
            },
          },
        ],
        "attempt-a",
      ),
    ).toEqual([name]);
  });
  it("fails closed on absent bindings and serializes no secret values", () => {
    expect(() => hostedRuntimeConfiguration({ VIDEOFORGE_PROVIDER_MODE: "staging" })).toThrow(
      HostedConfigurationError,
    );
    const source = environment();
    const config = hostedRuntimeConfiguration(source);
    const serialized = JSON.stringify(config);
    expect(JSON.parse(serialized)).toEqual({
      schemaVersion: "videoforge-hosted-configuration/v1",
      credentials: "REDACTED",
      commit: "commit-v2-06",
      publicOrigin: "https://staging.videoforge.example.test",
    });
    for (const value of [
      source.DATABASE_URL,
      source.BETTER_AUTH_SECRET,
      source.GOOGLE_CLIENT_SECRET,
      source.R2_SECRET_ACCESS_KEY,
      source.EMAIL_DELIVERY_API_KEY,
      source.WORKFLOW_CALLBACK_SECRET,
    ]) {
      expect(serialized).not.toContain(value);
    }
  });

  it("signs only exact tenant R2 paths with bounded methods and expiry", async () => {
    const config = hostedRuntimeConfiguration(environment());
    const port = await new HostedR2Signer(config.r2).sign({
      method: "PUT",
      objectKey:
        "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/input/job/job-a/artifact/artifact-a",
      contentType: "application/json",
      contentLength: 128,
      checksumSha256: `sha256:${"a".repeat(64)}`,
      lifetimeSeconds: 300,
      now: new Date("2026-08-16T00:00:00.000Z"),
    });
    expect(port.method).toBe("PUT");
    expect(new URL(port.url).hostname).toBe(
      "fixture-cloudflare-account-id.r2.cloudflarestorage.com",
    );
    expect(port.url).toContain("X-Amz-Expires=300");
    expect(decodeURIComponent(port.url)).toContain(
      "X-Amz-SignedHeaders=host;x-amz-checksum-sha256",
    );
    expect(port.requiredHeaders["x-amz-checksum-sha256"]).toBe(
      "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
    );
    expect(port.url).not.toContain(config.r2.secretAccessKey);
    await expect(
      new HostedR2Signer(config.r2).sign({
        method: "GET",
        objectKey: "tenant/account-a",
        contentType: "application/json",
        contentLength: 1,
        checksumSha256: `sha256:${"a".repeat(64)}`,
        lifetimeSeconds: 300,
      }),
    ).rejects.toThrow(/exact tenant lineage/u);
  });

  it("rejects malformed Cloud Run service identities before any request", () => {
    const config = hostedRuntimeConfiguration(environment());
    expect(() => new CloudRunJobsClient(config.cloudRun)).toThrow(/valid JSON/u);
  });
});
