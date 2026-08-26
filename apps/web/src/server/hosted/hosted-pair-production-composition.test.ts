import { describe, expect, it, vi } from "vitest";
import validEnvelope from "@videoforge/contracts/generated/fixtures/serverless_worker_job_envelope_v3.valid.json";
import { sha256CanonicalJson, type JsonValue } from "@videoforge/contracts";

import { createHostedEnvelopePairSigner } from "./hosted-envelope-signer";
import {
  HOSTED_PAIR_REQUIRED_MIGRATIONS,
  HostedPairProductionComposition,
  HostedPairProductionReconciler,
  createHostedHmacProviderProofAuthority,
  evaluateHostedPairProductionGate,
  hostedPairDocumentVerifier,
  type HostedPairProductionGateInput,
  type HostedProviderProofDocument,
} from "./hosted-pair-production-composition";
import {
  HostedPairRuntimeExecutor,
  type HostedPairLane,
  type HostedPairRuntimeStore,
} from "./hosted-pair-runtime-executor";

const ids = {
  account: "11111111-1111-4111-8111-111111111111",
  workspace: "22222222-2222-4222-8222-222222222222",
  request: "33333333-3333-4333-8333-333333333333",
  mageAttempt: "44444444-4444-4444-8444-444444444444",
  soulxAttempt: "55555555-5555-4555-8555-555555555555",
  deployment: validEnvelope.runtime.deployment_id,
} as const;
const digest = (character: string) => `sha256:${character.repeat(64)}` as const;
const now = "2026-08-26T08:00:00.000Z";

function gate(
  overrides: Partial<HostedPairProductionGateInput> = {},
): HostedPairProductionGateInput {
  const deployment = {
    deploymentId: ids.deployment,
    endpointIdSha256: digest("a"),
    endpointConfigSha256: digest("b"),
    workerImageDigest: digest("c"),
    modelManifestSha256: digest("d"),
    volumeIdSha256: digest("e"),
    volumeManifestSha256: digest("f"),
    region: "EU-RO-1",
    gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
    deploymentSnapshotSha256: digest("1"),
    authority: {
      endpointIdSha256: digest("a"),
      endpointConfigSha256: digest("b"),
      workerImageDigest: digest("c"),
      modelManifestSha256: digest("d"),
      volumeIdSha256: digest("e"),
      volumeManifestSha256: digest("f"),
      region: "EU-RO-1",
      gpuAllowlist: ["NVIDIA GeForce RTX 4090"],
    },
  };
  return {
    gpuTransport: "QUALIFIED_EXACT",
    migrationLedger: HOSTED_PAIR_REQUIRED_MIGRATIONS.map(([version, sha256]) => ({
      version,
      sha256,
    })),
    now,
    qualifications: {
      mage_image: {
        accepted: true,
        verifiedAt: "2026-08-26T07:30:00.000Z",
        expiresAt: "2026-08-26T09:00:00.000Z",
        qualificationRecordSha256: digest("2"),
        deploymentSnapshotSha256: deployment.deploymentSnapshotSha256,
      },
      soulx_avatar: {
        accepted: true,
        verifiedAt: "2026-08-26T07:31:00.000Z",
        expiresAt: "2026-08-26T09:00:00.000Z",
        qualificationRecordSha256: digest("3"),
        deploymentSnapshotSha256: deployment.deploymentSnapshotSha256,
      },
    },
    deployments: { mage_image: deployment, soulx_avatar: deployment },
    paidApproval: { approved: true, exact: true, expiresAt: "2026-08-26T09:00:00.000Z" },
    bindings: {
      runtimeDatabase: "NEON_RUNTIME_DATABASE_URL",
      reconcilerDatabase: "NEON_RECONCILER_DATABASE_URL",
      dispatchTokenKey: "HOSTED_DISPATCH_TOKEN_KEY",
      envelopeSignerKey: "HOSTED_ENVELOPE_SIGNING_KEY",
      providerProofVerifierKey: "HOSTED_PROVIDER_PROOF_VERIFY_KEY",
    },
    ...overrides,
  };
}

async function restartFixture() {
  const lanes = ["mage_image", "soulx_avatar"] as const;
  const tokens = {
    mage_image: "dt-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    soulx_avatar: "dt-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  } as const;
  const attempts = {
    mage_image: ids.mageAttempt,
    soulx_avatar: ids.soulxAttempt,
  } as const;
  const bodies = await Promise.all(
    lanes.map(async (lane) => {
      const body = {
        ...structuredClone(validEnvelope),
        tenant: { account_id: ids.account, workspace_id: ids.workspace },
        work: {
          ...validEnvelope.work,
          generation_request_id: ids.request,
          attempt_id: attempts[lane],
          lane,
        },
        dispatch_token: tokens[lane],
      } as Record<string, JsonValue>;
      delete body.authority_sha256;
      delete body.signature;
      const expectedEnvelopeSha256 = await sha256CanonicalJson(body);
      return {
        body,
        claim: {
          lane,
          attemptId: attempts[lane],
          dispatchToken: tokens[lane],
          dispatchTokenSha256: digest(lane === "mage_image" ? "b" : "c"),
          endpointIdSha256: digest("a"),
          requestBodySha256: digest("d"),
          deploymentId: ids.deployment,
          phase: "PREPARED",
          expectedEnvelopeSha256,
          attemptState: "OUTBOXED",
          outboxState: "READY_TO_DISPATCH",
          providerJobId: null,
        },
      };
    }),
  );
  const finishSend = vi.fn();
  let mageAssigned = false;
  finishSend.mockImplementation(async (input: { lane: HostedPairLane; outcome: string }) => {
    if (input.lane === "mage_image" && input.outcome === "ASSIGNED") mageAssigned = true;
  });
  const store: HostedPairRuntimeStore = {
    prepare: vi.fn(async () => bodies.map(({ claim }) => claim) as never),
    beginSend: vi.fn(async (input) => {
      if (input.lane === "soulx_avatar" && !mageAssigned) throw new Error("SoulX before Mage");
      return bodies.find(({ claim }) => claim.lane === input.lane)!.claim;
    }),
    finishSend,
    inspect: vi.fn(),
  };
  const signer = createHostedEnvelopePairSigner({
    keyId: "hosted-envelope-production-v1",
    secretHex: "ab".repeat(32),
  });
  const transports = Object.fromEntries(
    lanes.map((lane) => [
      lane,
      { run: vi.fn(async () => ({ id: `${lane}-job` })), status: vi.fn(), cancel: vi.fn() },
    ]),
  ) as never;
  const runtime = new HostedPairRuntimeExecutor(
    store,
    transports,
    hostedPairDocumentVerifier(signer),
  );
  const reconstruction = { reconstruct: vi.fn(async () => bodies as never) };
  const trusted = gate();
  const activation = {
    load: vi.fn(async () => ({
      now: trusted.now,
      migrationLedger: trusted.migrationLedger,
      qualifications: trusted.qualifications,
      deployments: trusted.deployments,
      paidApproval: trusted.paidApproval,
    })),
  };
  return {
    composition: new HostedPairProductionComposition(activation, reconstruction, runtime, signer),
    activation,
    reconstruction,
    finishSend,
    store,
    signer,
  };
}

describe("hosted production pair composition", () => {
  it("returns disabled before DB reconstruction or provider transport", async () => {
    const fixture = await restartFixture();
    await expect(
      fixture.composition.resume({
        environment: { VIDEOFORGE_GPU_TRANSPORT: "DISABLED_UNQUALIFIED" },
        accountId: ids.account,
        workspaceId: ids.workspace,
        generationRequestId: ids.request,
        dispatchTokenKey: "not-read-while-disabled",
      }),
    ).resolves.toEqual({ state: "DISABLED_UNQUALIFIED", reason: "GPU_TRANSPORT_DISABLED" });
    expect(fixture.reconstruction.reconstruct).not.toHaveBeenCalled();
    expect(fixture.activation.load).not.toHaveBeenCalled();
    expect(fixture.finishSend).not.toHaveBeenCalled();
  });

  it("rejects ledger, qualification, approval, role, or key drift", () => {
    expect(evaluateHostedPairProductionGate(gate({ migrationLedger: [] }))).toMatchObject({
      reason: "MIGRATION_LEDGER_0037_0044_INVALID",
    });
    expect(
      evaluateHostedPairProductionGate(
        gate({
          qualifications: {
            ...gate().qualifications,
            mage_image: { ...gate().qualifications.mage_image, expiresAt: "not-a-date" },
          },
        }),
      ),
    ).toMatchObject({ reason: "QUALIFICATION_OR_DEPLOYMENT_INVALID:mage_image" });
    expect(
      evaluateHostedPairProductionGate(
        gate({ paidApproval: { ...gate().paidApproval, exact: false } }),
      ),
    ).toMatchObject({ reason: "PAID_APPROVAL_INVALID" });
    expect(
      evaluateHostedPairProductionGate(
        gate({
          bindings: {
            ...gate().bindings,
            reconcilerDatabase: gate().bindings.runtimeDatabase,
          },
        }),
      ),
    ).toMatchObject({ reason: "DATABASE_ROLES_NOT_SEPARATE" });
  });

  it("reconstructs, re-signs, verifies, and follows 0043 Mage-then-SoulX state", async () => {
    const fixture = await restartFixture();
    await expect(
      fixture.composition.resume({
        environment: {
          VIDEOFORGE_GPU_TRANSPORT: "QUALIFIED_EXACT",
          DATABASE_URL: "postgres-runtime-binding",
          VIDEOFORGE_RECONCILER_DATABASE_URL: "postgres-reconciler-binding",
          VIDEOFORGE_DISPATCH_TOKEN_KEY: "dispatch-token-binding",
          VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: "envelope-signing-binding",
          VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: "envelope-signing-key-id",
          VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: "provider-proof-binding",
        },
        accountId: ids.account,
        workspaceId: ids.workspace,
        generationRequestId: ids.request,
        dispatchTokenKey: "dispatch-token-key-material-never-logged",
      }),
    ).resolves.toEqual({
      state: "BOTH_ASSIGNED",
      providerJobIds: ["mage_image-job", "soulx_avatar-job"],
    });
    expect(fixture.reconstruction.reconstruct).toHaveBeenCalledTimes(1);
    expect(fixture.finishSend.mock.calls.map(([value]) => value.lane)).toEqual([
      "mage_image",
      "soulx_avatar",
    ]);
  });

  it("recovers a crashed Workflow into observation without a blind resend", async () => {
    const fixture = await restartFixture();
    fixture.store.inspect = vi.fn(async () =>
      (["mage_image", "soulx_avatar"] as const).map((lane) => ({
        lane,
        attemptId: lane === "mage_image" ? ids.mageAttempt : ids.soulxAttempt,
        attemptState: "ASSIGNED",
        outboxState: "ASSIGNED",
        providerJobId: `${lane}-existing-job`,
        deploymentId: ids.deployment,
        dispatchTokenSha256: digest("b"),
        pairPhase: "BOTH_ASSIGNED",
        recoveryAction: "RECONCILE_ASSIGNED",
      })),
    );
    const recovered = new HostedPairProductionComposition(
      fixture.activation,
      fixture.reconstruction,
      {} as never,
      fixture.signer,
      fixture.store,
    );
    await expect(
      recovered.resume({
        environment: {
          VIDEOFORGE_GPU_TRANSPORT: "QUALIFIED_EXACT",
          DATABASE_URL: "postgres-runtime-binding",
          VIDEOFORGE_RECONCILER_DATABASE_URL: "postgres-reconciler-binding",
          VIDEOFORGE_DISPATCH_TOKEN_KEY: "dispatch-token-binding",
          VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: "envelope-signing-binding",
          VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: "envelope-signing-key-id",
          VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: "provider-proof-binding",
        },
        accountId: ids.account,
        workspaceId: ids.workspace,
        generationRequestId: ids.request,
        dispatchTokenKey: "dispatch-token-key-material-never-logged",
      }),
    ).resolves.toEqual({
      state: "BOTH_ASSIGNED",
      providerJobIds: ["mage_image-existing-job", "soulx_avatar-existing-job"],
    });
    expect(fixture.reconstruction.reconstruct).not.toHaveBeenCalled();
  });

  it("continues SoulX after a durable Mage assignment on Workflow restart", async () => {
    const fixture = await restartFixture();
    fixture.store.inspect = vi.fn(async () => [
      {
        lane: "mage_image" as const,
        attemptId: ids.mageAttempt,
        attemptState: "ASSIGNED",
        outboxState: "ASSIGNED",
        providerJobId: "mage-existing-job",
        deploymentId: ids.deployment,
        dispatchTokenSha256: digest("b"),
        pairPhase: "MAGE_ASSIGNED",
        recoveryAction: "CLEANUP_ONLY",
      },
      {
        lane: "soulx_avatar" as const,
        attemptId: ids.soulxAttempt,
        attemptState: "OUTBOXED",
        outboxState: "READY_TO_DISPATCH",
        providerJobId: null,
        deploymentId: ids.deployment,
        dispatchTokenSha256: digest("c"),
        pairPhase: "MAGE_ASSIGNED",
        recoveryAction: "SEND_SOULX_ONLY",
      },
    ]);
    const execute = vi.fn(async () => ({
      state: "BOTH_ASSIGNED" as const,
      providerJobIds: ["mage-existing-job", "soulx-new-job"] as const,
    }));
    const recovered = new HostedPairProductionComposition(
      fixture.activation,
      fixture.reconstruction,
      { execute } as never,
      fixture.signer,
      fixture.store,
    );
    await recovered.resume({
      environment: {
        VIDEOFORGE_GPU_TRANSPORT: "QUALIFIED_EXACT",
        DATABASE_URL: "postgres-runtime-binding",
        VIDEOFORGE_RECONCILER_DATABASE_URL: "postgres-reconciler-binding",
        VIDEOFORGE_DISPATCH_TOKEN_KEY: "dispatch-token-binding",
        VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: "envelope-signing-binding",
        VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID: "envelope-signing-key-id",
        VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY: "provider-proof-binding",
      },
      accountId: ids.account,
      workspaceId: ids.workspace,
      generationRequestId: ids.request,
      dispatchTokenKey: "dispatch-token-key-material-never-logged",
    });
    expect(fixture.reconstruction.reconstruct).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("concretely signs and verifies exact provider proof scope", async () => {
    const authority = createHostedHmacProviderProofAuthority(
      {
        observe: vi.fn(async () => ({
          providerState: "CANCELLED" as const,
          observedAt: now,
          nonce: "provider-proof-nonce-1234",
        })),
      },
      { keyId: "provider-proof-production-v1", secretHex: "cd".repeat(32) },
    );
    const document = await authority.acquire({
      account_id: ids.account,
      workspace_id: ids.workspace,
      generation_request_id: ids.request,
      lane: "mage_image",
      attempt_id: ids.mageAttempt,
      deployment_id: ids.deployment,
      dispatch_token_sha256: digest("b"),
      provider_job_id: "mage-job",
    });
    await expect(authority.verify(document)).resolves.toBe(true);
    await expect(authority.verify({ ...document, attempt_id: ids.soulxAttempt })).resolves.toBe(
      false,
    );
  });
});

describe("separately privileged hosted pair reconciler", () => {
  const rows = (["mage_image", "soulx_avatar"] as const).map((lane) => ({
    lane,
    attemptId: lane === "mage_image" ? ids.mageAttempt : ids.soulxAttempt,
    attemptState: "ASSIGNED",
    outboxState: "ASSIGNED",
    providerJobId: `${lane}-job`,
    deploymentId: ids.deployment,
    dispatchTokenSha256: digest(lane === "mage_image" ? "b" : "c"),
    pairPhase: "BOTH_ASSIGNED",
    recoveryAction: "RECONCILE_ASSIGNED",
  }));

  function proof(input: Record<string, unknown>): HostedProviderProofDocument {
    return {
      schema_version: "videoforge-hosted-provider-proof/v1",
      account_id: String(input.account_id),
      workspace_id: String(input.workspace_id),
      generation_request_id: String(input.generation_request_id),
      lane: input.lane as HostedPairLane,
      attempt_id: String(input.attempt_id),
      deployment_id: String(input.deployment_id),
      dispatch_token_sha256: String(input.dispatch_token_sha256),
      provider_job_id: String(input.provider_job_id),
      provider_state: "CANCELLED",
      observed_at: now,
      nonce: "proof-nonce-0123456789",
      signature: {
        algorithm: "HMAC-SHA256",
        key_id: "provider-proof-production-v1",
        value: "a".repeat(64),
      },
    };
  }

  it("settles only two cryptographically verified exact-scope proofs", async () => {
    const settlement = { settle: vi.fn() };
    const reconciler = new HostedPairProductionReconciler(
      { inspect: vi.fn(async () => rows) },
      { acquire: vi.fn(async (input) => proof(input)) },
      { verify: vi.fn(async () => true) },
      settlement,
    );
    await expect(
      reconciler.reconcile({
        accountId: ids.account,
        workspaceId: ids.workspace,
        generationRequestId: ids.request,
        settlementCostGuard: { schemaVersion: "test-settlement-cost-guard/v1" },
      }),
    ).resolves.toEqual({ state: "SETTLED" });
    expect(settlement.settle).toHaveBeenCalledTimes(1);
    expect(settlement.settle.mock.calls[0]?.[0].observations).toHaveLength(2);
  });

  it("rejects forged or cross-scope proof before privileged settlement", async () => {
    const settlement = { settle: vi.fn() };
    const reconciler = new HostedPairProductionReconciler(
      { inspect: vi.fn(async () => rows) },
      { acquire: vi.fn(async (input) => ({ ...proof(input), account_id: "foreign" })) },
      { verify: vi.fn(async () => true) },
      settlement,
    );
    await expect(
      reconciler.reconcile({
        accountId: ids.account,
        workspaceId: ids.workspace,
        generationRequestId: ids.request,
        settlementCostGuard: { schemaVersion: "test-settlement-cost-guard/v1" },
      }),
    ).rejects.toMatchObject({ code: "HOSTED_PAIR_PROVIDER_PROOF_INVALID" });
    expect(settlement.settle).not.toHaveBeenCalled();
  });
});
