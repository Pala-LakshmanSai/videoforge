import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";
import { canonicalizeJson } from "@videoforge/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import manifestFixture from "../../../../../project-context/evidence/fixtures/resolved_render_manifest.v209-short.valid.json";

import type {
  HostedR2BucketBinding,
  HostedRuntimeConfiguration,
  HostedRuntimeEnvironment,
} from "./configuration.js";
import { sha256Bytes } from "./crypto.js";
import {
  handleV213ResolvedRenderManifestRequest,
  type V213ResolvedRenderManifestProjection,
  type V213ResolvedRenderManifestReadDependencies,
  type V213ResolvedRenderManifestReadRequest,
  V213_RESOLVED_RENDER_MANIFEST_PATH,
} from "./v213-resolved-render-manifest-route.js";

const NOW = new Date("2026-08-28T00:00:00.000Z");
const TOKEN = "workflow-operator-token-at-least-thirty-two-bytes";
const FULL_AUTHORITY = "10000000-0000-4000-8000-000000000001";
const ACCOUNT = "20000000-0000-4000-8000-000000000002";
const WORKSPACE = "30000000-0000-4000-8000-000000000003";
const PROJECT = "40000000-0000-4000-8000-000000000004";
const REVISION = "50000000-0000-4000-8000-000000000005";
const RECEIPT = "60000000-0000-4000-8000-000000000006";
const RESERVATION = "70000000-0000-4000-8000-000000000007";
const VOICE_RECEIPT = "80000000-0000-4000-8000-000000000008";
const IMAGE_RECEIPT = "90000000-0000-4000-8000-000000000009";
const OBJECT_KEY = `tenant/${ACCOUNT}/workspace/${WORKSPACE}/project/${PROJECT}/revision/${REVISION}/lane/render/job/manifest/artifact/resolved`;

const config = {
  environment: "production",
  gpuTransport: "QUALIFIED_EXACT",
} as HostedRuntimeConfiguration;

interface Fixture {
  readonly bytes: ArrayBuffer;
  readonly checksum: Sha256;
  readonly uri: string;
  readonly request: V213ResolvedRenderManifestReadRequest;
  readonly projection: V213ResolvedRenderManifestProjection;
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const result = new ArrayBuffer(value.byteLength);
  new Uint8Array(result).set(value);
  return result;
}

function checksumBytes(checksum: Sha256): ArrayBuffer {
  return asArrayBuffer(
    Uint8Array.from(checksum.slice(7).match(/../gu)!, (pair) => Number.parseInt(pair, 16)),
  );
}

async function fixture(document: unknown = manifestFixture): Promise<Fixture> {
  const encoded = new TextEncoder().encode(canonicalizeJson(document as never));
  const bytes = asArrayBuffer(encoded);
  const checksum = await sha256Bytes(bytes);
  const hex = checksum.slice(7);
  const uri = `vf-local://objects/sha256/${hex.slice(0, 2)}/${hex}.json`;
  const voiceHash = "a".repeat(64);
  const imageHash = "b".repeat(64);
  const payload = {
    schema_version: "videoforge-hosted-cpu-submission/v1",
    idempotency_key: `render-plan-${REVISION}`,
    project_id: PROJECT,
    project_revision_id: REVISION,
    kind: "RENDER",
    input_document: {
      schema_version: "render-job-input/v1",
      project_revision_id: REVISION,
      attempt_id: REVISION,
      resolved_render_manifest: {
        asset_id: "resolved-manifest",
        sha256: checksum,
        artifact_uri: uri,
      },
      assets: [
        {
          asset_id: "voiceover-asset",
          sha256: `sha256:${voiceHash}`,
          artifact_uri: `vf-local://objects/sha256/aa/${voiceHash}.wav`,
          kind: "VOICEOVER",
        },
        {
          asset_id: "image-asset",
          sha256: `sha256:${imageHash}`,
          artifact_uri: `vf-local://objects/sha256/bb/${imageHash}.png`,
          kind: "IMAGE",
        },
      ],
      output: {
        result_uri: `vf-local-run://${REVISION}/${REVISION}/videoforge-output.mp4`,
        filename: "videoforge-output.mp4",
      },
      tools: { ffmpeg_version: "7.1", ffprobe_version: "7.1" },
      cancel_token: `render-plan-${REVISION}`,
    },
    objects: [
      { artifact_receipt_id: RECEIPT, uri },
      {
        artifact_receipt_id: VOICE_RECEIPT,
        uri: `vf-local://objects/sha256/aa/${voiceHash}.wav`,
      },
      {
        artifact_receipt_id: IMAGE_RECEIPT,
        uri: `vf-local://objects/sha256/bb/${imageHash}.png`,
      },
    ],
  };
  const unsigned = {
    schemaVersion: "videoforge.v213-resolved-render-manifest-read/v1" as const,
    fullLiveAuthorityId: FULL_AUTHORITY,
    operationId: "v2-09-short-hosted-project" as const,
    outerStateSha256: canonicalSha256({ outer: true }),
    materializationRequestSha256: canonicalSha256({ materialization: true }),
    accountId: ACCOUNT,
    workspaceId: WORKSPACE,
    projectId: PROJECT,
    projectRevisionId: REVISION,
    artifactUri: uri,
    sha256: checksum,
    issuedAt: NOW.toISOString(),
    nonce: "manifest-read-nonce-0001",
  };
  const request = { ...unsigned, requestSha256: canonicalSha256(unsigned) };
  const projection: V213ResolvedRenderManifestProjection = {
    payload,
    payloadSha256: canonicalSha256(payload),
    ownershipAccountId: ACCOUNT,
    ownershipWorkspaceId: WORKSPACE,
    ownershipProjectId: PROJECT,
    ownershipProjectRevisionId: REVISION,
    ownershipRevisionStatus: "LOCKED",
    matchingObjectCount: 1,
    artifactReceiptId: RECEIPT,
    receiptId: RECEIPT,
    receiptAccountId: ACCOUNT,
    receiptWorkspaceId: WORKSPACE,
    receiptObjectKey: OBJECT_KEY,
    receiptContentType: "application/json",
    receiptContentLength: bytes.byteLength,
    receiptChecksumSha256: checksum,
    receiptDeletedAt: null,
    reservationId: RESERVATION,
    reservationAccountId: ACCOUNT,
    reservationWorkspaceId: WORKSPACE,
    reservationProjectId: PROJECT,
    reservationProjectRevisionId: REVISION,
    reservationObjectKey: OBJECT_KEY,
    reservationMethod: "PUT",
    reservationLane: "RENDER",
    reservationState: "COMMITTED",
    reservationContentType: "application/json",
    reservationContentLength: bytes.byteLength,
    reservationChecksumSha256: checksum,
  };
  return { bytes, checksum, uri, request, projection };
}

function bucket(
  value: Fixture,
  overrides: {
    readonly head?: null | Partial<Awaited<ReturnType<HostedR2BucketBinding["head"]>>>;
    readonly get?: null | {
      readonly size?: number;
      readonly contentType?: string;
      readonly bytes?: ArrayBuffer;
    };
  } = {},
): HostedR2BucketBinding {
  const head =
    overrides.head === null
      ? null
      : {
          size: value.bytes.byteLength,
          httpMetadata: { contentType: "application/json" },
          checksums: { sha256: checksumBytes(value.checksum) },
          ...overrides.head,
        };
  const get =
    overrides.get === null
      ? null
      : {
          size: overrides.get?.size ?? value.bytes.byteLength,
          httpMetadata: { contentType: overrides.get?.contentType ?? "application/json" },
          arrayBuffer: vi.fn(async () => overrides.get?.bytes ?? value.bytes),
        };
  return {
    head: vi.fn(async () => head as never),
    get: vi.fn(async () => get as never),
  } as unknown as HostedR2BucketBinding;
}

function dependencies(
  projection: V213ResolvedRenderManifestProjection | null,
): V213ResolvedRenderManifestReadDependencies {
  return {
    claimAndLoad: vi.fn(async () => projection),
    close: vi.fn(async () => undefined),
  };
}

async function signature(body: string, token = TOKEN): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(token),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(signed)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function request(
  document: V213ResolvedRenderManifestReadRequest,
  options: { readonly token?: string; readonly signature?: string; readonly body?: string } = {},
): Promise<Request> {
  const body = options.body ?? JSON.stringify(document);
  const token = options.token ?? TOKEN;
  return new Request(`https://videoforge.example${V213_RESOLVED_RENDER_MANIFEST_PATH}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      "content-length": String(new TextEncoder().encode(body).byteLength),
      "x-videoforge-signature": options.signature ?? (await signature(body, token)),
    },
    body,
  });
}

async function invoke(
  value: Fixture,
  projection: V213ResolvedRenderManifestProjection | null = value.projection,
  r2 = bucket(value),
  requestOverride = value.request,
  runtimeConfig = config,
) {
  const deps = dependencies(projection);
  const response = await handleV213ResolvedRenderManifestRequest(
    await request(requestOverride),
    {
      VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: TOKEN,
      PRIVATE_ARTIFACTS: r2,
    } as HostedRuntimeEnvironment,
    runtimeConfig,
    deps,
    () => NOW,
  );
  return { response: response!, deps, r2 };
}

describe("V2-13 resolved-render-manifest operator route", () => {
  let value: Fixture;
  beforeEach(async () => {
    value = await fixture();
  });

  it("returns one exact tenant-bound JSON document without leaking object access", async () => {
    const { response, deps, r2 } = await invoke(value);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.claimAndLoad).toHaveBeenCalledWith({
      tokenSha256: await sha256Bytes(new TextEncoder().encode(TOKEN)),
      nonceSha256: await sha256Bytes(new TextEncoder().encode(value.request.nonce)),
      request: value.request,
    });
    expect(r2.head).toHaveBeenCalledWith(OBJECT_KEY);
    const result = (await response.json()) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(
      [
        "accountId",
        "document",
        "fullLiveAuthorityId",
        "materializationRequestSha256",
        "operationId",
        "outerStateSha256",
        "projectId",
        "projectRevisionId",
        "requestSha256",
        "schemaVersion",
        "sha256",
        "workspaceId",
      ].sort(),
    );
    expect(result).not.toHaveProperty("artifactUri");
    expect(result).not.toHaveProperty("objectKey");
    expect(result).not.toHaveProperty("nonce");
  });

  it("fails closed for bearer, HMAC, replay, freshness, and production qualification gates", async () => {
    const deps = dependencies(value.projection);
    const env = {
      VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: TOKEN,
      PRIVATE_ARTIFACTS: bucket(value),
    } as HostedRuntimeEnvironment;
    const wrongBearer = await handleV213ResolvedRenderManifestRequest(
      await request(value.request, { token: `${TOKEN}-wrong` }),
      env,
      config,
      deps,
      () => NOW,
    );
    expect(wrongBearer?.status).toBe(404);
    const badHmac = await handleV213ResolvedRenderManifestRequest(
      await request(value.request, { signature: "0".repeat(64) }),
      env,
      config,
      deps,
      () => NOW,
    );
    expect(badHmac?.status).toBe(404);
    const staleUnsigned = { ...value.request, issuedAt: "2026-08-27T23:54:59.999Z" };
    const { requestSha256: _old, ...staleBody } = staleUnsigned;
    void _old;
    const stale = { ...staleBody, requestSha256: canonicalSha256(staleBody) };
    const staleResponse = await handleV213ResolvedRenderManifestRequest(
      await request(stale),
      env,
      config,
      deps,
      () => NOW,
    );
    expect(staleResponse?.status).toBe(404);
    const disabled = await invoke(value, value.projection, bucket(value), value.request, {
      environment: "staging",
      gpuTransport: "DISABLED_UNQUALIFIED",
    } as HostedRuntimeConfiguration);
    expect(disabled.response.status).toBe(503);
    const replayDeps: V213ResolvedRenderManifestReadDependencies = {
      claimAndLoad: vi
        .fn()
        .mockResolvedValueOnce(value.projection)
        .mockRejectedValueOnce(new Error("REPLAY")),
      close: vi.fn(async () => undefined),
    };
    const first = await handleV213ResolvedRenderManifestRequest(
      await request(value.request),
      env,
      config,
      replayDeps,
      () => NOW,
    );
    const replay = await handleV213ResolvedRenderManifestRequest(
      await request(value.request),
      env,
      config,
      replayDeps,
      () => NOW,
    );
    expect(first?.status).toBe(200);
    expect(replay?.status).toBe(409);
  });

  it.each([
    ["receipt account", { receiptAccountId: WORKSPACE }],
    ["receipt workspace", { receiptWorkspaceId: ACCOUNT }],
    ["reservation account", { reservationAccountId: WORKSPACE }],
    ["reservation workspace", { reservationWorkspaceId: ACCOUNT }],
    ["project", { reservationProjectId: REVISION }],
    ["revision", { reservationProjectRevisionId: PROJECT }],
  ])("rejects cross-scope %s drift", async (_name, drift) => {
    const result = await invoke(value, { ...value.projection, ...drift });
    expect(result.response.status).toBe(409);
  });

  it.each([
    ["missing ownership", { ownershipAccountId: null }],
    ["account ownership drift", { ownershipAccountId: WORKSPACE }],
    ["workspace ownership drift", { ownershipWorkspaceId: ACCOUNT }],
    ["project ownership drift", { ownershipProjectId: REVISION }],
    ["revision ownership drift", { ownershipProjectRevisionId: PROJECT }],
    ["unlocked revision", { ownershipRevisionStatus: "DRAFT" }],
  ])("rejects %s at read time", async (_name, drift) => {
    const result = await invoke(value, { ...value.projection, ...drift });
    expect(result.response.status).toBe(409);
  });

  it("rejects plan payload-hash drift", async () => {
    const result = await invoke(value, {
      ...value.projection,
      payloadSha256: canonicalSha256({ drift: true }),
    });
    expect(result.response.status).toBe(409);
  });

  it("rejects a render plan with one receipt reused by two object URIs", async () => {
    const payload = structuredClone(value.projection.payload) as Record<string, unknown>;
    const objects = payload.objects as Record<string, unknown>[];
    objects[1]!.artifact_receipt_id = RECEIPT;
    const result = await invoke(value, {
      ...value.projection,
      payload,
      payloadSha256: canonicalSha256(payload),
    });
    expect(result.response.status).toBe(409);
  });

  it.each([
    ["missing plan", null],
    ["duplicate manifest URI", { matchingObjectCount: 2 }],
    ["missing manifest URI", { matchingObjectCount: 0 }],
    ["receipt identity", { receiptId: VOICE_RECEIPT }],
    ["object receipt identity", { artifactReceiptId: VOICE_RECEIPT }],
  ])("rejects %s", async (_name, change) => {
    const projection = change === null ? null : { ...value.projection, ...change };
    const result = await invoke(value, projection);
    expect(result.response.status).toBe(409);
  });

  it.each([
    ["deleted receipt", { receiptDeletedAt: NOW.toISOString() }],
    ["noncommitted reservation", { reservationState: "CONSUMED" }],
    ["non-RENDER reservation", { reservationLane: "INPUT" }],
    ["wrong receipt content type", { receiptContentType: "text/plain" }],
    ["wrong reservation content type", { reservationContentType: "text/plain" }],
    ["object key drift", { reservationObjectKey: `${OBJECT_KEY}-drift` }],
    ["length drift", { reservationContentLength: 999_999 }],
    ["checksum drift", { reservationChecksumSha256: canonicalSha256({ drift: true }) }],
  ])("rejects %s", async (_name, drift) => {
    const result = await invoke(value, { ...value.projection, ...drift });
    expect(result.response.status).toBe(409);
  });

  it.each([
    ["missing head", { head: null }],
    ["head metadata", { head: { httpMetadata: { contentType: "text/plain" } } }],
    ["head length", { head: { size: 99 } }],
    ["head hash", { head: { checksums: { sha256: new Uint8Array(32).buffer } } }],
    ["missing get", { get: null }],
    ["get metadata", { get: { contentType: "text/plain" } }],
    ["get length", { get: { size: 99 } }],
  ])("rejects R2 %s drift", async (_name, overrides) => {
    const result = await invoke(value, value.projection, bucket(value, overrides as never));
    expect(result.response.status).toBe(409);
  });

  it("rejects oversized, hash-drifted, and invalid-JSON object bytes", async () => {
    const oversized = await invoke(
      value,
      value.projection,
      bucket(value, { head: { size: 1024 * 1024 + 1 } }),
    );
    expect(oversized.response.status).toBe(409);
    const different = asArrayBuffer(new TextEncoder().encode('{"different":true}'));
    const hashDrift = await invoke(
      value,
      value.projection,
      bucket(value, { get: { bytes: different } }),
    );
    expect(hashDrift.response.status).toBe(409);
    const invalidBytes = asArrayBuffer(new TextEncoder().encode("not-json"));
    const invalidChecksum = await sha256Bytes(invalidBytes);
    const invalidUri = `vf-local://objects/sha256/${invalidChecksum.slice(7, 9)}/${invalidChecksum.slice(7)}.json`;
    const invalidPayload = structuredClone(value.projection.payload) as Record<string, unknown>;
    const input = invalidPayload.input_document as Record<string, unknown>;
    (input.resolved_render_manifest as Record<string, unknown>).artifact_uri = invalidUri;
    (input.resolved_render_manifest as Record<string, unknown>).sha256 = invalidChecksum;
    (invalidPayload.objects as Record<string, unknown>[])[0]!.uri = invalidUri;
    const invalidUnsigned = {
      ...value.request,
      artifactUri: invalidUri,
      sha256: invalidChecksum,
    };
    const { requestSha256: _prior, ...unsigned } = invalidUnsigned;
    void _prior;
    const invalidRequest = { ...unsigned, requestSha256: canonicalSha256(unsigned) };
    const invalidProjection = {
      ...value.projection,
      payload: invalidPayload,
      payloadSha256: canonicalSha256(invalidPayload),
      receiptContentLength: invalidBytes.byteLength,
      reservationContentLength: invalidBytes.byteLength,
      receiptChecksumSha256: invalidChecksum,
      reservationChecksumSha256: invalidChecksum,
    };
    const invalid = await invoke(
      {
        ...value,
        bytes: invalidBytes,
        checksum: invalidChecksum,
        uri: invalidUri,
        request: invalidRequest,
        projection: invalidProjection,
      },
      invalidProjection,
      bucket({ ...value, bytes: invalidBytes, checksum: invalidChecksum } as Fixture, {
        get: { bytes: invalidBytes },
      }),
      invalidRequest,
    );
    expect(invalid.response.status).toBe(409);
  });

  it("preserves success and rejection responses when dependency shutdown fails", async () => {
    const environment = {
      VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: TOKEN,
      PRIVATE_ARTIFACTS: bucket(value),
    } as HostedRuntimeEnvironment;
    const successDependencies: V213ResolvedRenderManifestReadDependencies = {
      claimAndLoad: vi.fn(async () => value.projection),
      close: vi.fn(async () => {
        throw new Error("POOL_CLOSE_FAILED");
      }),
    };
    const success = await handleV213ResolvedRenderManifestRequest(
      await request(value.request),
      environment,
      config,
      successDependencies,
      () => NOW,
    );
    expect(success?.status).toBe(200);
    const rejectDependencies: V213ResolvedRenderManifestReadDependencies = {
      claimAndLoad: vi.fn(async () => null),
      close: vi.fn(async () => {
        throw new Error("POOL_CLOSE_FAILED");
      }),
    };
    const rejected = await handleV213ResolvedRenderManifestRequest(
      await request(value.request),
      environment,
      config,
      rejectDependencies,
      () => NOW,
    );
    expect(rejected?.status).toBe(409);
  });
});
