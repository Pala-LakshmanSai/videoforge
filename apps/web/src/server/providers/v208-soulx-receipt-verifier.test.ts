// @vitest-environment node

import { createHash } from "node:crypto";

import {
  PROVENANCE_ATTESTATION_SCOPE,
  ProvenanceReceiptSigner,
  type ProvenanceReceiptBody,
} from "@videoforge/control-plane";
import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";
import { describe, expect, it, vi } from "vitest";

import { createV208SoulXReceiptVerifier } from "./v208-soulx-receipt-verifier.js";
import { v213SoulxWarmupAttestationSha256 } from "./v213-provenance-receipt.js";

const sha = (value: Uint8Array | string) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}` as `sha256:${string}`;

describe("V2-08 whole-span receipt verifier", () => {
  it("verifies the signed four-item receipt, exact R2 bytes and independent MP4 probes", async () => {
    const signer = new ProvenanceReceiptSigner("v208-receipt", Buffer.alloc(32, 8));
    const image = `ghcr.io/example/soulx@sha256:${"3".repeat(64)}`;
    const deployment = {
      lane: "soulx" as const,
      purpose: "qualification" as const,
      endpointId: "endpoint-soulx",
      endpointIdSha256: sha("endpoint-soulx") as `sha256:${string}`,
      templateId: "template-soulx",
      templateIdSha256: sha("template-soulx") as `sha256:${string}`,
      image,
      sourceCommit: "4".repeat(40),
      deploymentSha256: `sha256:${"5".repeat(64)}`,
      volumeIdSha256: `sha256:${"6".repeat(64)}` as `sha256:${string}`,
      volumeManifestSha256: `sha256:${"7".repeat(64)}` as `sha256:${string}`,
      volumeSizeGb: 50 as const,
      volumeMount: "/runpod-volume" as const,
      region: "EU-RO-1" as const,
      gpu: "NVIDIA GeForce RTX 4090" as const,
      gpuCount: 1 as const,
      workersMin: 0 as const,
      workersMax: 1 as const,
      idleTimeoutSeconds: 60 as const,
      handlerConcurrency: 1 as const,
      scalerType: "REQUEST_COUNT" as const,
      scalerValue: 1 as const,
      initTimeoutSeconds: 800,
    };
    const outputPrefix =
      "tenant/account-a/workspace/workspace-a/project/project-a/revision/revision-a/lane/soulx-avatar/job/attempt-v208/artifact";
    const output = new Map(
      ([2, 4, 6, 10] as const).map((seconds) => [
        `${outputPrefix}/soulx-${seconds}s`,
        Uint8Array.from([seconds, 1, 2, 3]),
      ]),
    );
    const envelope = {
      dispatch_token: `dispatch-${"x".repeat(32)}`,
      tenant: { account_id: "account-a", workspace_id: "workspace-a" },
      work: { attempt_id: "attempt-v208" },
      runtime: { deployment_id: deployment.deploymentSha256 },
    };
    const request = {
      envelope,
      batch: { spans: [2, 4, 6, 10] },
      ports: { inputs: [] },
      generated_output_authorities: [...output.keys()].map((key) => ({ path: `/${key}` })),
      output_put_urls: [...output.keys()].map((key) => `https://example.test/${key}`),
    };
    const { envelope: _envelope, ...requestBody } = request;
    void _envelope;
    const body: ProvenanceReceiptBody = {
      schema_version: "serverless-provenance-receipt/v1",
      receipt_id: "receipt-v208",
      attestation_scope: PROVENANCE_ATTESTATION_SCOPE,
      dispatch_token: envelope.dispatch_token,
      envelope_sha256: sha(canonicalizeJson(envelope as unknown as JsonValue)),
      request_sha256: sha(canonicalizeJson(requestBody as unknown as JsonValue)),
      attempt_id: "attempt-v208",
      provider_job_id: "job-v208",
      worker_id: "worker-v208",
      tenant: { account_id: "account-a", workspace_id: "workspace-a" },
      lane: "soulx_avatar",
      deployment: {
        deployment_id: deployment.deploymentSha256,
        endpoint_id_sha256: deployment.endpointIdSha256,
        container_digest: image.slice(image.indexOf("sha256:")) as `sha256:${string}`,
        intended_region: "EU-RO-1",
        intended_volume_id_sha256: deployment.volumeIdSha256,
        model_manifest_sha256: deployment.volumeManifestSha256,
      },
      runtime_probe: {
        gpu_name: "NVIDIA GeForce RTX 4090",
        gpu_count: 1,
        total_vram_bytes: 24 * 1024 ** 3,
        peak_vram_bytes: 12 * 1024 ** 3,
        gpu_uuid_sha256: null,
        driver_version: "550.90.07",
        cuda_version: "12.4",
        probe_source: "WORKER_RUNTIME_SELF_REPORT",
      },
      volume_verification: {
        manifest_sha256_before: deployment.volumeManifestSha256,
        manifest_sha256_after: deployment.volumeManifestSha256,
        mutation_detected: false,
        cross_mount_detected: false,
      },
      model_ready_evidence: {
        state: "MODEL_READY",
        warmup_completed: true,
        warmup_output_sha256: v213SoulxWarmupAttestationSha256(
          image.slice(image.indexOf("sha256:")) as `sha256:${string}`,
        ),
      },
      timings: {
        allocation_ms: 1,
        container_ready_ms: 300_000,
        volume_verified_ms: 1,
        model_load_ms: 1,
        warmup_ms: 1,
        first_inference_ms: 1,
        upload_ms: 1,
        total_ms: 320_000,
      },
      items: ([2, 4, 6, 10] as const).map((seconds) => {
        const key = `${outputPrefix}/soulx-${seconds}s`;
        const bytes = output.get(key)!;
        return {
          item_id: `soulx-${seconds}s`,
          state: "SUCCEEDED" as const,
          output_object_key: key,
          output_sha256: sha(bytes),
          output_bytes: bytes.byteLength,
          probe: {
            native_clip_reused_for_full_and_split: true,
            runtime_cache_hit: false,
            format: "mp4",
            width: 512,
            height: 512,
            fps_num: 25,
            fps_den: 1,
            duration_ms: seconds * 1_000,
          },
        };
      }),
      scratch_cleanup: {
        terminal_reason: "SUCCESS",
        removed: true,
        scratch_on_model_volume: false,
      },
      receipt_nonce: 1,
      issued_at: "2026-09-05T00:00:00.000Z",
    };
    const bodyBytes = Buffer.from(canonicalizeJson(body as unknown as JsonValue));
    const receipt = signer.signOverBytes(body, bodyBytes);
    const probeMp4 = vi.fn(async (bytes: Uint8Array) => ({
      format: "mp4" as const,
      width: 512 as const,
      height: 512 as const,
      fpsNum: 25 as const,
      fpsDen: 1 as const,
      durationMs: bytes[0]! * 1_000,
      videoStreams: 1 as const,
      audioStreams: 1 as const,
      videoCodec: "h264" as const,
      audioCodec: "aac" as const,
      audioSampleRate: 16_000 as const,
      audioChannels: 1 as const,
      videoFrames: bytes[0]! * 25,
      videoDurationMs: bytes[0]! * 1_000,
      audioDurationMs: bytes[0]! * 1_000,
    }));
    const verify = createV208SoulXReceiptVerifier({
      signer,
      readOutput: async (key) => output.get(key)!,
      probeMp4,
    });
    await expect(
      verify({
        descriptor: {
          key: "soulxWholeSpanCold",
          lane: "soulx",
          id: "soulx-cold-whole-span-2-4-6-10s",
          seconds: 22,
          mode: "complete",
          cold: true,
        },
        jobId: "job-v208",
        deployment,
        materialization: {
          schemaVersion: "videoforge.v213-qualification-case-materialization/v1",
          caseDescriptorSha256: `sha256:${"a".repeat(64)}`,
          materializationEvidenceSha256: `sha256:${"b".repeat(64)}`,
          request,
        },
        observed: {
          jobId: "job-v208",
          status: "COMPLETED",
          receiptDelivery: { receipt, receiptBodyBase64: bodyBytes.toString("base64") },
        },
      }),
    ).resolves.toMatchObject({
      workerReceiptVerified: true,
      outputItemsVerified: 4,
      coldModelReadyMs: 300_000,
      workerId: "worker-v208",
    });
    expect(probeMp4).toHaveBeenCalledTimes(4);
  });
});
