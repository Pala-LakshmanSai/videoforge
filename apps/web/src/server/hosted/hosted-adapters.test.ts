import { describe, expect, it } from "vitest";

import { CloudRunJobsClient, executionNamesForAttempt } from "./cloud-run";
import {
  exactCpuUploadAuthorityRequest,
  hasExactResultObjectMetadata,
} from "./legacy-cloud-run-contract";
import {
  HostedConfigurationError,
  hostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
} from "./configuration";
import {
  deleteHostedR2ObjectsAndVerify,
  hostedCompleteAttemptArtifactKeys,
  hostedJobArtifactPrefix,
  HostedR2Signer,
} from "./r2";
import {
  completionMatchesTerminalLease,
  mediaWorkerTerminalEventKind,
  supportedWorkerPlatform,
} from "./personal-worker";
import {
  bindHostedCpuInputDocument,
  canonicalJson,
  exactHostedCpuSubmission,
  exactHostedRenderSubmission,
  whisperModelUri,
} from "./submission";

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
    MEDIA_WORKER_RELEASE_MANIFEST_JSON: JSON.stringify({
      schema_version: "videoforge-media-worker-release/v1",
      version: "0.1.0",
      minimum_protocol_version: 1,
      execution_bundle_sha256: `sha256:${"a".repeat(64)}`,
      whisper_model_sha256: `sha256:${"d".repeat(64)}`,
      windows: {
        url: "https://downloads.example.test/videoforge-worker-0.1.0.exe",
        sha256: `sha256:${"b".repeat(64)}`,
        size_bytes: 1024,
        trust: "UNSIGNED_BETA",
      },
      macos: {
        url: "https://downloads.example.test/videoforge-worker-0.1.0.dmg",
        sha256: `sha256:${"c".repeat(64)}`,
        size_bytes: 2048,
        trust: "AD_HOC_BETA",
      },
    }),
    DATABASE_URL:
      "postgresql://fixture:fixture@fixture.example.test/videoforge?sslmode=require&channel_binding=require",
    BETTER_AUTH_SECRET: "fixture-better-auth-secret-00000000000000000001",
    GOOGLE_CLIENT_ID: "fixture-google-client.apps.example.test",
    GOOGLE_CLIENT_SECRET: "fixture-google-client-secret",
    R2_ACCOUNT_ID: "fixture-cloudflare-account-id",
    R2_ACCESS_KEY_ID: "fixture-r2-access-key-id",
    R2_SECRET_ACCESS_KEY: "fixture-r2-secret-access-key",
    WORKFLOW_CALLBACK_SECRET: "fixture-workflow-callback-secret-00000000000001",
    MEDIA_WORKER_TOKEN_SECRET: "fixture-media-worker-token-secret-000000000000002",
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
    expect(config.mediaWorkerRelease.windows.trust).toBe("UNSIGNED_BETA");
    expect(config.mediaWorkerRelease.macos.trust).toBe("AD_HOC_BETA");
    expect(config.mediaWorkerRelease.whisperModelSha256).toBe(`sha256:${"d".repeat(64)}`);
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
      source.WORKFLOW_CALLBACK_SECRET,
      source.MEDIA_WORKER_TOKEN_SECRET,
    ]) {
      expect(serialized).not.toContain(value);
    }
    expect(() =>
      hostedRuntimeConfiguration({
        ...source,
        MEDIA_WORKER_TOKEN_SECRET: source.WORKFLOW_CALLBACK_SECRET,
      }),
    ).toThrow(HostedConfigurationError);
    for (const databaseUrl of [
      "postgresql://fixture:fixture@fixture.example.test/videoforge?sslmode=disable&channel_binding=require",
      "postgresql://fixture:fixture@fixture.example.test/videoforge?sslmode=require",
      "postgresql://fixture:fixture@fixture.example.test/videoforge?sslmode=require&channel_binding=require&channel_binding=disable",
    ]) {
      expect(() => hostedRuntimeConfiguration({ ...source, DATABASE_URL: databaseUrl })).toThrow(
        HostedConfigurationError,
      );
    }
    const release = JSON.parse(source.MEDIA_WORKER_RELEASE_MANIFEST_JSON!);
    release.macos.trust = "UNSIGNED_BETA";
    expect(() =>
      hostedRuntimeConfiguration({
        ...source,
        MEDIA_WORKER_RELEASE_MANIFEST_JSON: JSON.stringify(release),
      }),
    ).toThrow(HostedConfigurationError);
    release.macos.trust = "AD_HOC_BETA";
    delete release.whisper_model_sha256;
    expect(() =>
      hostedRuntimeConfiguration({
        ...source,
        MEDIA_WORKER_RELEASE_MANIFEST_JSON: JSON.stringify(release),
      }),
    ).toThrow(HostedConfigurationError);
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
      "X-Amz-SignedHeaders=content-length;content-type;host;x-amz-checksum-sha256",
    );
    expect(port.requiredHeaders["content-length"]).toBe("128");
    expect(port.requiredHeaders["content-type"]).toBe("application/json");
    expect(port.requiredHeaders["x-amz-checksum-sha256"]).toBe(
      "qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
    );
    expect(port.url).not.toContain(config.r2.secretAccessKey);
    const longInput = await new HostedR2Signer(config.r2).sign({
      method: "GET",
      objectKey:
        "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/input/job/job-a/artifact/artifact-a",
      contentType: "audio/wav",
      contentLength: 1024,
      checksumSha256: `sha256:${"b".repeat(64)}`,
      lifetimeSeconds: 3600,
      downloadFilename: "owned-render.mp4",
      now: new Date("2026-08-16T00:00:00.000Z"),
    });
    expect(longInput.url).toContain("X-Amz-Expires=3600");
    expect(new URL(longInput.url).searchParams.get("response-content-disposition")).toBe(
      'attachment; filename="owned-render.mp4"',
    );
    await expect(
      new HostedR2Signer(config.r2).sign({
        method: "PUT",
        objectKey:
          "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/input/job/job-a/artifact/artifact-a",
        contentType: "application/json",
        contentLength: 128,
        checksumSha256: `sha256:${"a".repeat(64)}`,
        lifetimeSeconds: 3600,
      }),
    ).rejects.toThrow(/PUT port lifetime/u);
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
    await expect(
      new HostedR2Signer(config.r2).sign({
        method: "PUT",
        objectKey:
          "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/input/job/job-a/artifact/artifact-a",
        contentType: "application/json",
        contentLength: 0,
        checksumSha256: `sha256:${"a".repeat(64)}`,
        lifetimeSeconds: 300,
      }),
    ).rejects.toThrow(/content length/u);
  });

  it("signs generated Mage output without inventing pre-dispatch bytes", async () => {
    const config = hostedRuntimeConfiguration(environment());
    const port = await new HostedR2Signer(config.r2).signGenerated({
      objectKey:
        "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/mage-image/job/job-a/artifact/scene-a",
      contentType: "image/png",
      maxContentLength: 4 * 1024 * 1024,
      lifetimeSeconds: 300,
      now: new Date("2026-08-16T00:00:00.000Z"),
    });
    expect(port.method).toBe("PUT");
    expect(port.maxContentLength).toBe(4 * 1024 * 1024);
    expect(port.requiredHeaders["content-type"]).toBe("image/png");
    expect(decodeURIComponent(port.url)).toContain("X-Amz-SignedHeaders=content-type;host");
    const qualificationPort = await new HostedR2Signer(config.r2).signGenerated({
      objectKey:
        "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/mage-image/job/job-a/artifact/scene-b",
      contentType: "image/png",
      maxContentLength: 4 * 1024 * 1024,
      lifetimeSeconds: 7_200,
      now: new Date("2026-08-16T00:00:00.000Z"),
    });
    expect(qualificationPort.url).toContain("X-Amz-Expires=7200");
    await expect(
      new HostedR2Signer(config.r2).signGenerated({
        objectKey: "tenant/account-a",
        contentType: "image/png",
        maxContentLength: 1,
        lifetimeSeconds: 300,
      }),
    ).rejects.toThrow(/exact tenant lineage/u);
    await expect(
      new HostedR2Signer(config.r2).signGenerated({
        objectKey:
          "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/mage-image/job/job-a/artifact/scene-c",
        contentType: "image/png",
        maxContentLength: 4 * 1024 * 1024,
        lifetimeSeconds: 7_201,
      }),
    ).rejects.toThrow(/generated PUT port lifetime/u);
  });

  it("accepts exact Avatar Hub profile-version storage keys", async () => {
    const config = hostedRuntimeConfiguration(environment());
    const port = await new HostedR2Signer(config.r2).sign({
      method: "PUT",
      objectKey:
        "tenant/account-a/workspace/workspace-a/avatar-profile/profile-a/version/version-a/canonical/canonical.mp4",
      contentType: "video/mp4",
      contentLength: 128,
      checksumSha256: `sha256:${"a".repeat(64)}`,
      lifetimeSeconds: 300,
      now: new Date("2026-08-16T00:00:00.000Z"),
    });
    expect(port.method).toBe("PUT");
    expect(port.url).toContain("avatar-profile");
  });

  it("fails closed until an exact worker-artifact prefix is empty after delete", async () => {
    const prefix =
      "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/render/job/job-a/artifact/";
    const objects = new Set([
      `${prefix}final-mp4`,
      `${prefix}result-document`,
      `${prefix}unexpected`,
    ]);
    const bucket = {
      async head(key: string) {
        return objects.has(key) ? { size: 1 } : null;
      },
      async get() {
        return null;
      },
      async put() {
        return {};
      },
      async list(options: { prefix: string; cursor?: string; limit?: number }) {
        expect(options.prefix).toBe(prefix);
        return {
          objects: [...objects]
            .filter((key) => key.startsWith(options.prefix))
            .map((key) => ({ key })),
          truncated: false,
        };
      },
      async delete(keys: string | readonly string[]) {
        for (const key of typeof keys === "string" ? [keys] : keys) objects.delete(key);
      },
    };

    await expect(
      deleteHostedR2ObjectsAndVerify(bucket, prefix, [
        `${prefix}final-mp4`,
        `${prefix}result-document`,
      ]),
    ).rejects.toThrow(/retained objects/u);
    expect(objects).toEqual(new Set([`${prefix}unexpected`]));

    objects.delete(`${prefix}unexpected`);
    await expect(
      deleteHostedR2ObjectsAndVerify(bucket, prefix, [
        `${prefix}final-mp4`,
        `${prefix}result-document`,
      ]),
    ).resolves.toMatchObject({
      schemaVersion: "videoforge-r2-post-delete-verification/v1",
      objectPrefix: prefix,
      expectedAbsentKeys: [`${prefix}final-mp4`, `${prefix}result-document`],
      remainingKeys: [],
      verified: true,
    });
    expect(hostedJobArtifactPrefix(`${prefix}final-mp4`)).toBe(prefix);
    expect(
      hostedCompleteAttemptArtifactKeys(`${prefix}job-spec`, [
        `${prefix}result-document`,
        `${prefix}final-mp4`,
      ]),
    ).toEqual([`${prefix}final-mp4`, `${prefix}job-spec`, `${prefix}result-document`]);
  });

  it("keeps worker enrollment aligned with the published native platforms", () => {
    expect(supportedWorkerPlatform("WINDOWS", "X86_64")).toBe(true);
    expect(supportedWorkerPlatform("WINDOWS", "AARCH64")).toBe(false);
    expect(supportedWorkerPlatform("MACOS", "X86_64")).toBe(true);
    expect(supportedWorkerPlatform("MACOS", "AARCH64")).toBe(true);
    expect(supportedWorkerPlatform("LINUX", "X86_64")).toBe(false);
  });

  it("acknowledges only the durable terminal completion on replay", () => {
    const succeeded = {
      state: "SUCCEEDED" as const,
      failureCode: null,
      resultObjectKey: "result-a",
      resultContentLength: 128,
      resultChecksumSha256: `sha256:${"a".repeat(64)}`,
    };
    expect(
      completionMatchesTerminalLease(succeeded, {
        schema_version: "videoforge-personal-worker-completion/v1",
        status: "SUCCEEDED",
        failure_code: null,
        result_object_key: "result-a",
        result_content_length: 128,
        result_checksum_sha256: `sha256:${"a".repeat(64)}`,
      }),
    ).toBe(true);
    expect(
      completionMatchesTerminalLease(succeeded, {
        schema_version: "videoforge-personal-worker-completion/v1",
        status: "SUCCEEDED",
        failure_code: null,
        result_object_key: "forged-result",
        result_content_length: 128,
        result_checksum_sha256: `sha256:${"a".repeat(64)}`,
      }),
    ).toBe(false);
    expect(
      completionMatchesTerminalLease(
        {
          ...succeeded,
          state: "CANCELLED",
          resultObjectKey: null,
          resultContentLength: null,
          resultChecksumSha256: null,
        },
        {
          schema_version: "videoforge-personal-worker-completion/v1",
          status: "SUCCEEDED",
          failure_code: null,
          result_object_key: "late-result",
          result_content_length: 128,
          result_checksum_sha256: `sha256:${"b".repeat(64)}`,
        },
      ),
    ).toBe(true);
  });

  it("maps cancellation to the media-worker event kind allowed by migration 0032", () => {
    expect(mediaWorkerTerminalEventKind("SUCCEEDED")).toBe("SUCCEEDED");
    expect(mediaWorkerTerminalEventKind("FAILED")).toBe("FAILED");
    expect(mediaWorkerTerminalEventKind("CANCELLED")).toBe("CANCEL_OBSERVED");
  });

  it("keeps the historical Cloud Run adapter fail-closed for rollback evidence", () => {
    expect(
      () =>
        new CloudRunJobsClient({
          projectId: "legacy-project",
          region: "asia-south1",
          asrJobName: "legacy-asr",
          renderJobName: "legacy-render",
          serviceAccountJson: "not-json",
        }),
    ).toThrow(/valid JSON/u);
  });

  it("accepts only exact JSON result-object metadata before hashing bytes", () => {
    expect(
      hasExactResultObjectMetadata(
        { size: 128, httpMetadata: { contentType: "application/json" } },
        128,
      ),
    ).toBe(true);
    expect(
      hasExactResultObjectMetadata(
        { size: 127, httpMetadata: { contentType: "application/json" } },
        128,
      ),
    ).toBe(false);
    expect(hasExactResultObjectMetadata({ size: 128 }, 128)).toBe(false);
    expect(
      hasExactResultObjectMetadata({ size: 128, httpMetadata: { contentType: "text/plain" } }, 128),
    ).toBe(false);
  });

  it("parses only exact checksum-bound Cloud Run upload requests", () => {
    const exact = {
      schema_version: "videoforge-cloud-run-upload-authority/v1",
      source: "PRIMARY_RESULT_OUTPUT",
      object_key:
        "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/render/job/job-a/artifact/output-a",
      content_type: "video/mp4",
      content_length: 1024,
      checksum_sha256: `sha256:${"a".repeat(64)}`,
    };
    expect(exactCpuUploadAuthorityRequest(exact)).toMatchObject({
      source: "PRIMARY_RESULT_OUTPUT",
      contentLength: 1024,
    });
    expect(exactCpuUploadAuthorityRequest({ ...exact, extra: true })).toBeNull();
    expect(exactCpuUploadAuthorityRequest({ ...exact, content_length: 0 })).toBeNull();
    expect(exactCpuUploadAuthorityRequest({ ...exact, checksum_sha256: "sha256:nope" })).toBeNull();
  });

  it("binds an exact idempotent hosted CPU submission to server-owned lineage", () => {
    const modelHash = `sha256:${"c".repeat(64)}`;
    const input = {
      schema_version: "asr-job-input/v1",
      project_revision_id: "client-value-is-not-authority",
      attempt_id: "client-value-is-not-authority",
      model: { sha256: modelHash },
      output: { result_uri: "client-value-is-not-authority" },
      cancel_token: "client-value-is-not-authority",
    };
    const submission = exactHostedCpuSubmission({
      schema_version: "videoforge-hosted-cpu-submission/v1",
      idempotency_key: "owned-asr-request-0001",
      project_id: "11111111-1111-4111-8111-111111111111",
      project_revision_id: "22222222-2222-4222-8222-222222222222",
      kind: "ASR",
      input_document: input,
      objects: [
        {
          artifact_receipt_id: "33333333-3333-4333-8333-333333333333",
          uri: `vf-local://objects/sha256/cc/${"c".repeat(64)}.bin`,
        },
      ],
    });
    expect(submission).not.toBeNull();
    const bound = bindHostedCpuInputDocument(
      submission!.inputDocument,
      "ASR",
      submission!.projectRevisionId,
      "44444444-4444-4444-8444-444444444444",
    );
    expect(bound).toMatchObject({
      project_revision_id: submission!.projectRevisionId,
      attempt_id: "44444444-4444-4444-8444-444444444444",
      cancel_token: "44444444-4444-4444-8444-444444444444",
      output: {
        result_uri:
          "vf-local-run://22222222-2222-4222-8222-222222222222/44444444-4444-4444-8444-444444444444/asr-result.json",
      },
    });
    expect(whisperModelUri(bound)).toBe(`vf-local://objects/sha256/cc/${"c".repeat(64)}.bin`);
    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
  });

  it("rejects rebinding and malformed hosted CPU submission facts", () => {
    expect(
      exactHostedCpuSubmission({
        schema_version: "videoforge-hosted-cpu-submission/v1",
        idempotency_key: "short",
        project_id: "not-a-uuid",
        project_revision_id: "not-a-uuid",
        kind: "ASR",
        input_document: {},
        objects: [],
      }),
    ).toBeNull();
    expect(() =>
      bindHostedCpuInputDocument(
        { schema_version: "render-job-input/v1", output: {} },
        "ASR",
        "22222222-2222-4222-8222-222222222222",
        "44444444-4444-4444-8444-444444444444",
      ),
    ).toThrow(/exact job kind/u);
  });

  it("accepts only an exact revision-owned render plan", () => {
    const revisionId = "22222222-2222-4222-8222-222222222222";
    const projectId = "11111111-1111-4111-8111-111111111111";
    const manifestHash = `sha256:${"c".repeat(64)}`;
    const voiceoverHash = `sha256:${"a".repeat(64)}`;
    const avatarHash = `sha256:${"d".repeat(64)}`;
    const imageHash = `sha256:${"e".repeat(64)}`;
    const renderPlan = {
      schema_version: "videoforge-hosted-cpu-submission/v1",
      idempotency_key: "owned-render-request-0001",
      project_id: projectId,
      project_revision_id: revisionId,
      kind: "RENDER",
      input_document: {
        schema_version: "render-job-input/v1",
        project_revision_id: revisionId,
        attempt_id: "55555555-5555-4555-8555-555555555555",
        resolved_render_manifest: {
          asset_id: "manifest-001",
          sha256: manifestHash,
          artifact_uri: `vf-local://objects/sha256/cc/${"c".repeat(64)}.json`,
        },
        assets: [
          {
            asset_id: "voiceover-001",
            sha256: voiceoverHash,
            artifact_uri: `vf-local://objects/sha256/aa/${"a".repeat(64)}.wav`,
            kind: "VOICEOVER",
          },
          {
            asset_id: "avatar-001",
            sha256: avatarHash,
            artifact_uri: `vf-local://objects/sha256/dd/${"d".repeat(64)}.mp4`,
            kind: "AVATAR_CLIP",
          },
          {
            asset_id: "image-001",
            sha256: imageHash,
            artifact_uri: `vf-local://objects/sha256/ee/${"e".repeat(64)}.png`,
            kind: "IMAGE",
          },
        ],
        output: {
          result_uri: "vf-local-run://placeholder/attempt/output.mp4",
          filename: "fixture.mp4",
        },
        tools: { ffmpeg_version: "8.1.2", ffprobe_version: "8.1.2" },
        cancel_token: "fixture-render-cancel-token-0000000000000001",
      },
      objects: [
        {
          artifact_receipt_id: "66666666-6666-4666-8666-666666666666",
          uri: `vf-local://objects/sha256/cc/${"c".repeat(64)}.json`,
        },
        {
          artifact_receipt_id: "77777777-7777-4777-8777-777777777777",
          uri: `vf-local://objects/sha256/aa/${"a".repeat(64)}.wav`,
        },
        {
          artifact_receipt_id: "88888888-8888-4888-8888-888888888888",
          uri: `vf-local://objects/sha256/dd/${"d".repeat(64)}.mp4`,
        },
        {
          artifact_receipt_id: "99999999-9999-4999-8999-999999999999",
          uri: `vf-local://objects/sha256/ee/${"e".repeat(64)}.png`,
        },
      ],
    };
    expect(
      exactHostedRenderSubmission(
        renderPlan,
        renderPlan.project_id,
        renderPlan.project_revision_id,
      ),
    ).toMatchObject({ kind: "RENDER", projectId: renderPlan.project_id });
    expect(exactHostedRenderSubmission({ ...renderPlan, kind: "ASR" })).toBeNull();
    expect(
      exactHostedRenderSubmission(renderPlan, "44444444-4444-4444-8444-444444444444"),
    ).toBeNull();
    expect(exactHostedRenderSubmission({ ...renderPlan, extra: true })).toBeNull();
    expect(
      exactHostedRenderSubmission({
        ...renderPlan,
        input_document: { ...renderPlan.input_document, assets: undefined },
      }),
    ).toBeNull();
  });
});
