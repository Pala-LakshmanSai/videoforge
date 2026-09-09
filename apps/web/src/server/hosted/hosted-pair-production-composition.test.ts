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
    cloudflare: {
      sourceCommit: "a".repeat(40),
      versionIdSha256: digest("7"),
      deployedConfigSha256: digest("8"),
      readbackSha256: digest("9"),
      observedAt: "2026-08-26T07:59:00.000Z",
    },
    bindings: {
      runtimeDatabase: "NEON_RUNTIME_DATABASE_URL",
      reconcilerDatabase: "NEON_RECONCILER_DATABASE_URL",
      dispatchTokenKey: "HOSTED_DISPATCH_TOKEN_KEY",
      envelopeSignerKey: "HOSTED_ENVELOPE_SIGNING_KEY",
      providerProofVerifierKey: "HOSTED_PROVIDER_PROOF_VERIFY_KEY",
      workflowOperatorToken: "HOSTED_WORKFLOW_OPERATOR_TOKEN",
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
      cloudflare: trusted.cloudflare,
    })),
  };
  return {
    composition: new HostedPairProductionComposition(activation, reconstruction, runtime, signer),
    activation,
    reconstruction,
    finishSend,
    store,
    signer,
    runtime,
  };
}

describe("hosted production pair composition", () => {
  it("accepts the exact current 37..87 manifest ledger", () => {
    expect(HOSTED_PAIR_REQUIRED_MIGRATIONS).toEqual([
      [37, "sha256:e21a04350d2685f231bbfa8ac9a1109a22194ab0e227d49a9dfa4c68d84aa9ef"],
      [38, "sha256:de64f32ab2b07d9e3448e29f466ea6a26e48f507cab12800abc2efd7393afe00"],
      [39, "sha256:1b602747e8a5ed91c76d1a602d5b7be87a6139cdcf862dd7da10fd9f45238637"],
      [40, "sha256:9e7cbbecd515c8781f66a6888d1283abeb2e91baee4f61d6ad1857775a67c1a3"],
      [41, "sha256:24f161e5c441f7cfa6b7837d185e64b3eae182d729c8ef21ef6850aeec9bcf84"],
      [42, "sha256:d7168a4143a813df7b9114f76f1efe71aa287bec4b1f137ab414a98e65e6b967"],
      [43, "sha256:590386f350c606da0be673376d14a9609df5f221268b2a932d4e00d608b2b927"],
      [44, "sha256:8ab2a30c7df970531e521fac0662f666ef2689a908057fa4525a623c11622a6f"],
      [45, "sha256:1365c546595f57aaca61950c39f0f52c44986dab2543d21eb60b5773af12929b"],
      [46, "sha256:d98e020a52a1820db811f5c9a679651c1169000ebe28c1d00b35e04c003ba33b"],
      [47, "sha256:d9840c7033b823a7f9a03e13d7213c50b81d40c7f89423f6c6f4ecc7e8e8649a"],
      [48, "sha256:8181d1c050690a8e15ce5cef7473a5caa872d5f868b18f059574dbd4fcbdc82d"],
      [49, "sha256:e29c4beeff16c40acb2d598e22d1393d1193abd80cd990805900234c15986e31"],
      [50, "sha256:027550e364f6d4bc4c58416156d74165eccf0a2a883cdb6b327cbb5b4665f352"],
      [51, "sha256:be05cc3a2e95f7e5f8921412316be131fe9df77904d7dac63ea4d77133aef563"],
      [52, "sha256:3ef175f09f39be8c70d2108d74cc30f13f663094a7d09fc80d8862821600c90a"],
      [53, "sha256:d73b290a68a380c21a8243b11b39e9f828f8d5f4a9a876a061a7eea6b92e864a"],
      [54, "sha256:3faacf0a963ec79a787be05ac97ea6129455e605a9e0e784184877ec91cd20ea"],
      [55, "sha256:636a02026d2a529d4eeb319d09759816ac87681a7e7baf227c0b6c549c3b9b2d"],
      [56, "sha256:12794e13d9866dc7348995977e08ed0e63abe4cfa52a39190eeb4740772a9b45"],
      [57, "sha256:73318f34179905dbfaf7e4809f2bba38b211515d6af60377f49a9333af8abf4e"],
      [58, "sha256:ab2fa026bc1734211cbc82e90f930a9ad7c0323a7187ca01195a7669f319406d"],
      [59, "sha256:9d26a9e4f5152f1a981f0dde9b59cf02b211cba4812a9ada66fa1bc50b3a8602"],
      [60, "sha256:f24e13ff02ec7f761f66b97bccde469945c242fb1d0637b55c3b5574bf0cdf16"],
      [61, "sha256:803162f05a0b0b17834be178b8d9b76caf74c85b81a02475eea3f032510540d5"],
      [62, "sha256:789404f23671518edb738cf4f5e0f5b5ce5ed25eaad6cc8033b089351d309404"],
      [63, "sha256:16d06fd8855a433354124ed57300c9dbfab6853ddd156c8a8504db4e595b5aee"],
      [64, "sha256:8a7822ac9418044b3d8db948aae6c8298894b411e9248137f10b681371b4af14"],
      [65, "sha256:216c15dc379a93ec597eb8b0d325323b5d7a8c8091a1955cdffae951e360efea"],
      [66, "sha256:5564d62a3128d8850dfdd60cbf68cd4476d8585dcc04126a0cd1e0ad254317e5"],
      [67, "sha256:6ad89b0630de5e34c3ce5c413ab42d5bb98113754940147db5cc9ba75ae67517"],
      [68, "sha256:e97130419c299cffae599bfec52a7348460b0d49d9dae5c2761259a26a690689"],
      [69, "sha256:718046630b67bbe3ae40371d742959c22436ab1f638b5c421d031618f574b00c"],
      [70, "sha256:b67fc1108168772ddaa9f2b46387083f82cf602203dd83517ea894e2119a59d5"],
      [71, "sha256:8dcf727566e118b5af86a10758545241985b8b1c4fa1b3e8a0f66f147deedc1d"],
      [72, "sha256:50abbcbaf46406a3cd07dd98f1d2bd27b8d0c3cf56096a78e021f82aa44f86ac"],
      [73, "sha256:59d6af63ba2d8eafc7c93eb4cc255d162253aa2cb433183ab251eb404dc6fd9e"],
      [74, "sha256:77ef79b39fdc4b757e8aae0406cd7be9f361b5e30eb2cc9feeddf0818b4bb8ba"],
      [75, "sha256:06e02690a510b03697d4ba3428b642527661e2ee310b9d3d2c7763a6296a5667"],
      [76, "sha256:878039c43152f4c8938d3b3273d9871894d03823f643f3c4b0b4005c53c745c5"],
      [77, "sha256:5afce995259d8e717135648c3c10bfa7813da79d33347cf840d90cd3eb06f213"],
      [78, "sha256:c1fb46651322acff10476472dccee04ddd8553721bd1174347dde2a457c95773"],
      [79, "sha256:773618d0109dc3dfcc34acd8dd7108b2a6e11dadac0e7f7d029ff852236b52f3"],
      [80, "sha256:00c2eea0e713a181f9c84af1a78fa8b1fb57fca3d1e2348915463133befe81bb"],
      [81, "sha256:dee1b8adab28d9996c4fd9b7d71b322fc0d48123e6c81f2760499bd79e2b945c"],
      [82, "sha256:c36621d8fdd25ccc6a9506b3d4572c28223aa9e1e2bbbbb2039c7dc661b30454"],
      [83, "sha256:06ffc203c6e124dc5569b403156a1726d114c04089efd8081d9baa7504d6d587"],
      [84, "sha256:626a78dc70217a28d189467fd5ff3b8b9a91be8de00a6dee358d8b00b87ed75f"],
      [85, "sha256:8e3150e340a3a8b2525d41470b6e98e127434e7baf199eb543921647716d585b"],
      [86, "sha256:4b1fff44485f3d81789a4d203ff5856afea221c6950f129d164484e313e3c2e5"],
      [87, "sha256:6fb7eba2268517a63a8632c89deb25c627cd13566700e12900f79c8807020a96"],
    ]);
    expect(evaluateHostedPairProductionGate(gate())).toEqual({ state: "READY" });
  });

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
      reason: "MIGRATION_LEDGER_0037_0084_INVALID",
    });
    expect(
      evaluateHostedPairProductionGate(
        gate({ migrationLedger: gate().migrationLedger.slice(0, -3) }),
      ),
    ).toMatchObject({ reason: "MIGRATION_LEDGER_0037_0084_INVALID" });
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
          VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: "workflow-operator-token-binding",
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

  it("reconstructs a fresh pair when the pre-begin runtime projection is empty", async () => {
    const fixture = await restartFixture();
    fixture.store.inspect = vi.fn(async () => []);
    const recovered = new HostedPairProductionComposition(
      fixture.activation,
      fixture.reconstruction,
      fixture.runtime,
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
          VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: "workflow-operator-token-binding",
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
    expect(fixture.reconstruction.reconstruct).toHaveBeenCalledOnce();
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
          VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: "workflow-operator-token-binding",
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
        VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN: "workflow-operator-token-binding",
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
