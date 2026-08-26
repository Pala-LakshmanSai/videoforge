import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import { handleHostedRequest } from "./app";
import {
  configuredHostedRuntimeConfiguration,
  hostedRuntimeConfiguration,
  qualifiedHostedRuntimeConfiguration,
  type HostedRuntimeEnvironment,
  type HostedVerifiedQualifiedGpuActivation,
} from "./configuration";
import {
  HOSTED_PAIR_REQUIRED_MIGRATIONS,
  type HostedPairProductionGateInput,
} from "./hosted-pair-production-composition";

const sha = (label: string): Sha256 => canonicalSha256({ label });
const SOURCE_COMMIT = "a".repeat(40);
const NOW = "2026-08-26T00:02:00.000Z";
const DATABASE_NOW = "2026-08-26T00:01:00.000Z";
const EXPIRES = "2026-08-26T00:05:00.000Z";
const CLOUDFLARE_VERSION_SHA256 = `sha256:${"751cc65abbf0e6b4d0e92d22149df0a6d2136a65620731a6e5a53d4491f7ebc6"}`;
const evidence = Object.freeze({
  schema_version: "qualified-gpu-activation/v1",
  id: "activation-1",
  enabledConfigSha256: sha("enabled-config"),
});

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
    CF_VERSION_METADATA: { id: "cloudflare-version-id", tag: "v213", timestamp: NOW },
    VIDEOFORGE_COMMIT: SOURCE_COMMIT,
    VIDEOFORGE_PROVIDER_MODE: "production",
    VIDEOFORGE_GPU_TRANSPORT: "QUALIFIED_EXACT",
    VIDEOFORGE_PUBLIC_ORIGIN: "https://videoforge.example.test",
    VIDEOFORGE_R2_BUCKET_NAME: "videoforge-production-private",
    MEDIA_WORKER_RELEASE_MANIFEST_JSON: JSON.stringify({
      schema_version: "videoforge-media-worker-release/v1",
      version: "0.1.0",
      minimum_protocol_version: 1,
      execution_bundle_sha256: sha("bundle"),
      whisper_model_sha256: sha("whisper"),
      windows: {
        url: "https://downloads.example.test/worker.exe",
        sha256: sha("windows"),
        size_bytes: 1,
        trust: "UNSIGNED_BETA",
      },
      macos: {
        url: "https://downloads.example.test/worker.dmg",
        sha256: sha("macos"),
        size_bytes: 1,
        trust: "AD_HOC_BETA",
      },
    }),
    DATABASE_URL:
      "postgresql://runtime:secret@db.example.test/videoforge?sslmode=require&channel_binding=require",
    VIDEOFORGE_RECONCILER_DATABASE_URL:
      "postgresql://reconciler:secret@db.example.test/videoforge?sslmode=require&channel_binding=require",
    BETTER_AUTH_SECRET: "better-auth-secret-000000000000000000000001",
    GOOGLE_CLIENT_ID: "google-client.apps.example.test",
    GOOGLE_CLIENT_SECRET: "google-secret",
    R2_ACCOUNT_ID: "account",
    R2_ACCESS_KEY_ID: "access",
    R2_SECRET_ACCESS_KEY: "secret",
    WORKFLOW_CALLBACK_SECRET: "workflow-secret-00000000000000000000000001",
    MEDIA_WORKER_TOKEN_SECRET: "worker-token-0000000000000000000000000002",
    VIDEOFORGE_DISPATCH_TOKEN_KEY: "dispatch-token-key-0000000000000001",
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: "ab".repeat(32),
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: "envelope-signing-key-v1",
    VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: "provider-proof-key-000000000000001",
    VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: "workflow-operator-token-00000000000001",
    VIDEOFORGE_PROVIDER_PROOF_KEY_ID: "provider-proof-v1",
    RUNPOD_API_KEY: "runpod-key-000000000000000000000001",
    RUNPOD_API_BASE_URL: "https://api.runpod.io",
    VIDEOFORGE_MAGE_ENDPOINT_ID: "mage-endpoint",
    VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256: sha("mage-endpoint-id"),
    VIDEOFORGE_SOULX_ENDPOINT_ID: "soulx-endpoint",
    VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256: sha("soulx-endpoint-id"),
  };
}

function lane(name: "mage_image" | "soulx_avatar") {
  const deployment = {
    deploymentId: `deployment-${name}`,
    endpointIdSha256: sha(`${name}-endpoint`),
    endpointConfigSha256: sha(`${name}-config`),
    workerImageDigest: sha(`${name}-image`),
    modelManifestSha256: sha(`${name}-model`),
    volumeIdSha256: sha(`${name}-volume`),
    volumeManifestSha256: sha(`${name}-volume-manifest`),
    region: "EU-RO-1",
    gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
    deploymentSnapshotSha256: sha(`${name}-deployment-snapshot`),
  } as const;
  return {
    qualification: {
      accepted: true,
      verifiedAt: DATABASE_NOW,
      expiresAt: EXPIRES,
      qualificationRecordSha256: sha(`${name}-qualification`),
      deploymentSnapshotSha256: deployment.deploymentSnapshotSha256,
    },
    deployment: {
      ...deployment,
      authority: {
        endpointConfigSha256: deployment.endpointConfigSha256,
        endpointIdSha256: deployment.endpointIdSha256,
        gpuAllowlist: deployment.gpuAllowlist,
        modelManifestSha256: deployment.modelManifestSha256,
        region: deployment.region,
        volumeIdSha256: deployment.volumeIdSha256,
        volumeManifestSha256: deployment.volumeManifestSha256,
        workerImageDigest: deployment.workerImageDigest,
      },
    },
  };
}

function gate(): HostedPairProductionGateInput {
  const mage = lane("mage_image");
  const soulx = lane("soulx_avatar");
  return {
    gpuTransport: "QUALIFIED_EXACT",
    migrationLedger: HOSTED_PAIR_REQUIRED_MIGRATIONS.map(([version, digest]) => ({
      version,
      sha256: digest,
    })),
    now: DATABASE_NOW,
    qualifications: { mage_image: mage.qualification, soulx_avatar: soulx.qualification },
    deployments: { mage_image: mage.deployment, soulx_avatar: soulx.deployment },
    paidApproval: { approved: true, exact: true, expiresAt: EXPIRES },
    cloudflare: {
      sourceCommit: SOURCE_COMMIT,
      versionIdSha256: CLOUDFLARE_VERSION_SHA256,
      deployedConfigSha256: sha("enabled-config"),
      readbackSha256: sha("cloudflare-readback"),
      observedAt: DATABASE_NOW,
    },
    bindings: {
      runtimeDatabase: "VIDEOFORGE_RUNTIME_DATABASE",
      reconcilerDatabase: "VIDEOFORGE_RECONCILER_DATABASE",
      dispatchTokenKey: "VIDEOFORGE_DISPATCH_TOKEN_KEY",
      envelopeSignerKey: "VIDEOFORGE_ENVELOPE_SIGNING_KEY",
      providerProofVerifierKey: "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
      workflowOperatorToken: "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
    },
  };
}

function verified(
  overrides: Partial<HostedVerifiedQualifiedGpuActivation> = {},
): HostedVerifiedQualifiedGpuActivation {
  const snapshot = gate();
  return {
    verifierId: "videoforge-hosted-qualified-gpu-activation-verifier-v1",
    accepted: true,
    signatureVerified: true,
    canonicalEvidenceSha256: canonicalSha256(evidence),
    verifierSignatureSha256: sha("signature"),
    sourceCommit: SOURCE_COMMIT,
    databaseObservedAt: DATABASE_NOW,
    expiresAt: EXPIRES,
    activationSnapshotSha256: canonicalSha256(snapshot),
    paidApprovalLedgerSha256: sha("approval-ledger"),
    gate: snapshot,
    ...overrides,
  };
}

function resolve(value = verified(), source = environment()) {
  return qualifiedHostedRuntimeConfiguration({
    source,
    evidence,
    verifier: { verify: vi.fn(async () => value) },
    now: () => new Date(NOW),
  });
}

describe("qualified hosted GPU transport configuration", () => {
  it("resolves the production request configuration through the exact trusted DB seam", async () => {
    const verification = verified();
    await expect(
      configuredHostedRuntimeConfiguration({
        source: environment(),
        databaseSource: { load: async () => ({ evidence, verification }) },
        now: () => new Date(NOW),
      }),
    ).resolves.toMatchObject({ gpuTransport: "QUALIFIED_EXACT" });
    await expect(
      configuredHostedRuntimeConfiguration({ source: environment(), now: () => new Date(NOW) }),
    ).resolves.toMatchObject({ gpuTransport: "DISABLED_UNQUALIFIED" });
  });

  it("uses the trusted DB result in handleHostedRequest and otherwise reports disabled", async () => {
    const verification = verified();
    const request = new Request("https://videoforge.example.test/api/v2/hosted/status");
    const context = { waitUntil: vi.fn() };
    const enabled = await handleHostedRequest(request, environment(), context, undefined, {
      databaseSource: () => ({ load: async () => ({ evidence, verification }) }),
      now: () => new Date(NOW),
    });
    await expect(enabled.json()).resolves.toMatchObject({ gpu_transport: "QUALIFIED_EXACT" });

    const disabled = await handleHostedRequest(request, environment(), context, undefined, {
      now: () => new Date(NOW),
    });
    await expect(disabled.json()).resolves.toMatchObject({
      gpu_transport: "DISABLED_UNQUALIFIED",
    });
  });

  it("enables only the exact signed fresh DB activation and serializes no credentials", async () => {
    const config = await resolve();
    expect(config.gpuTransport).toBe("QUALIFIED_EXACT");
    expect(config.gpuActivation).toMatchObject({
      evidenceSha256: canonicalSha256(evidence),
      paidApprovalLedgerSha256: sha("approval-ledger"),
      migrationLedgerSha256: canonicalSha256(gate().migrationLedger),
    });
    expect(JSON.parse(JSON.stringify(config))).toMatchObject({
      gpuTransport: "QUALIFIED_EXACT",
      credentials: "REDACTED",
    });
    expect(JSON.stringify(config)).not.toContain(environment().RUNPOD_API_KEY!);
  });

  it("does not enable from the environment flag alone", () => {
    const config = hostedRuntimeConfiguration(environment());
    expect(config.gpuTransport).toBe("DISABLED_UNQUALIFIED");
    expect(config.gpuActivation).toBeNull();
  });

  it("returns disabled when either deployment snapshot drifts", async () => {
    const value = verified();
    const driftedGate = structuredClone(value.gate) as HostedPairProductionGateInput;
    (
      driftedGate.deployments.mage_image as { deploymentSnapshotSha256: string }
    ).deploymentSnapshotSha256 = sha("drift");
    await expect(
      resolve({
        ...value,
        gate: driftedGate,
        activationSnapshotSha256: canonicalSha256(driftedGate),
      }),
    ).resolves.toMatchObject({
      gpuTransport: "DISABLED_UNQUALIFIED",
      gpuActivation: null,
    });
  });

  it("returns disabled for stale DB evidence or an invalid approval-ledger hash", async () => {
    await expect(
      resolve(verified({ databaseObservedAt: "2026-08-25T23:00:00.000Z" })),
    ).resolves.toMatchObject({ gpuTransport: "DISABLED_UNQUALIFIED" });
    await expect(
      resolve(verified({ paidApprovalLedgerSha256: "not-a-hash" as Sha256 })),
    ).resolves.toMatchObject({ gpuTransport: "DISABLED_UNQUALIFIED" });
  });
});
