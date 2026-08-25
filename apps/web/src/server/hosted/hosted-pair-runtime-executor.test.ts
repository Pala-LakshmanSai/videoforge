import { describe, expect, it, vi } from "vitest";
import validEnvelope from "@videoforge/contracts/generated/fixtures/serverless_worker_job_envelope_v3.valid.json";
import { ServerlessTransportError } from "@videoforge/control-plane";
import { sha256CanonicalJson } from "@videoforge/contracts";

import {
  HostedPairRuntimeExecutor,
  type HostedPairLane,
  type HostedPairRuntimeStore,
} from "./hosted-pair-runtime-executor";

const hash = `sha256:${"a".repeat(64)}` as const;
const claims = {
  mage_image: {
    lane: "mage_image",
    attemptId: "mage-attempt",
    dispatchToken: "mage-token-012345678901234567890123456789",
    dispatchTokenSha256: hash,
    endpointIdSha256: hash,
    requestBodySha256: hash,
    deploymentId: validEnvelope.runtime.deployment_id,
    phase: "MAGE_SENT",
  },
  soulx_avatar: {
    lane: "soulx_avatar",
    attemptId: "soulx-attempt",
    dispatchToken: "soulx-token-0123456789012345678901234567",
    dispatchTokenSha256: hash,
    endpointIdSha256: hash,
    requestBodySha256: hash,
    deploymentId: validEnvelope.runtime.deployment_id,
    phase: "SOULX_SENT",
  },
} as const;

function envelope(lane: HostedPairLane) {
  const claim = claims[lane];
  return {
    lane,
    document: {
      ...structuredClone(validEnvelope),
      dispatch_token: claim.dispatchToken,
      tenant: { account_id: "account", workspace_id: "workspace" },
      work: {
        ...validEnvelope.work,
        generation_request_id: "request",
        attempt_id: claim.attemptId,
        lane,
      },
    },
  } as const;
}

function fixture(run: (lane: HostedPairLane) => unknown) {
  let mageAssigned = false;
  const finishSend = vi.fn(async (input: { lane: HostedPairLane; outcome: string }) => {
    if (input.lane === "mage_image" && input.outcome === "ASSIGNED") mageAssigned = true;
  });
  const store: HostedPairRuntimeStore = {
    prepare: vi.fn(async () => {
      const prepared = await Promise.all(
        (["mage_image", "soulx_avatar"] as const).map(async (lane) => {
          const {
            authority_sha256: _authority,
            signature: _signature,
            ...unsigned
          } = envelope(lane).document;
          return { ...claims[lane], expectedEnvelopeSha256: await sha256CanonicalJson(unsigned) };
        }),
      );
      return prepared as [(typeof prepared)[0], (typeof prepared)[1]];
    }),
    beginSend: vi.fn(async (input: Parameters<HostedPairRuntimeStore["beginSend"]>[0]) => {
      if (input.lane === "soulx_avatar" && !mageAssigned) throw new Error("soulx before mage");
      const {
        authority_sha256: _authority,
        signature: _signature,
        ...unsigned
      } = envelope(input.lane).document;
      return {
        ...claims[input.lane],
        expectedEnvelopeSha256: await sha256CanonicalJson(unsigned),
      };
    }),
    finishSend,
    inspect: vi.fn(),
  };
  const settlementStore = { settle: vi.fn() };
  const transports = {
    mage_image: { run: vi.fn(async () => run("mage_image")), status: vi.fn(), cancel: vi.fn() },
    soulx_avatar: {
      run: vi.fn(async () => run("soulx_avatar")),
      status: vi.fn(),
      cancel: vi.fn(),
    },
  };
  const executor = new HostedPairRuntimeExecutor(
    store,
    transports as never,
    {
      verifyPair: vi.fn(async () => true),
    },
    settlementStore,
  );
  return { executor, store, settlementStore, finishSend, transports };
}

const input = {
  accountId: "account",
  workspaceId: "workspace",
  generationRequestId: "request",
  dispatchTokenKey: "k".repeat(32),
  envelopes: [envelope("mage_image"), envelope("soulx_avatar")] as const,
};

describe("hosted pair runtime executor", () => {
  it("rejects the signed pair before any send-state mutation when verification fails", async () => {
    const f = fixture((lane) => ({ id: `${lane}-job` }));
    const executor = new HostedPairRuntimeExecutor(
      f.store,
      f.transports as never,
      {
        verifyPair: vi.fn(async () => false),
      },
      f.settlementStore,
    );
    await expect(executor.execute(input)).rejects.toMatchObject({
      code: "HOSTED_PAIR_SIGNATURE_INVALID",
    });
    expect(f.store.beginSend).not.toHaveBeenCalled();
  });

  it("rejects persisted envelope-hash drift before beginSend mutates SENT", async () => {
    const f = fixture((lane) => ({ id: `${lane}-job` }));
    f.store.prepare = vi.fn(
      async () =>
        [
          { ...claims.mage_image, expectedEnvelopeSha256: `sha256:${"f".repeat(64)}` },
          { ...claims.soulx_avatar, expectedEnvelopeSha256: `sha256:${"f".repeat(64)}` },
        ] as const,
    );
    await expect(f.executor.execute(input)).rejects.toMatchObject({
      code: "HOSTED_PAIR_ENVELOPE_LINEAGE_INVALID",
    });
    expect(f.store.beginSend).not.toHaveBeenCalled();
  });

  it("persists and assigns Mage before SoulX", async () => {
    const f = fixture((lane) => ({ id: `${lane}-job` }));
    await expect(f.executor.execute(input)).resolves.toEqual({
      state: "BOTH_ASSIGNED",
      providerJobIds: ["mage_image-job", "soulx_avatar-job"],
    });
    expect(f.finishSend.mock.calls.map(([call]) => [call.lane, call.outcome])).toEqual([
      ["mage_image", "ASSIGNED"],
      ["soulx_avatar", "ASSIGNED"],
    ]);
  });

  it("stops before SoulX after first acknowledgement ambiguity", async () => {
    const f = fixture((lane) => {
      if (lane === "mage_image") throw new ServerlessTransportError("DISPATCH_ACK_UNKNOWN");
      return { id: "must-not-run" };
    });
    await expect(f.executor.execute(input)).resolves.toMatchObject({
      state: "CLEANUP_ONLY",
      lane: "mage_image",
      reason: "DISPATCH_ACK_UNKNOWN",
    });
    expect(f.transports.soulx_avatar.run).not.toHaveBeenCalled();
  });

  it("treats a malformed response as acknowledgement unknown", async () => {
    const f = fixture(() => ({ nope: true }));
    await expect(f.executor.execute(input)).resolves.toMatchObject({
      state: "CLEANUP_ONLY",
      reason: "DISPATCH_ACK_UNKNOWN",
    });
    expect(f.finishSend).toHaveBeenLastCalledWith(
      expect.objectContaining({ outcome: "DISPATCH_ACK_UNKNOWN", providerJobId: null }),
    );
  });

  it("treats an unexpected transport failure as acknowledgement unknown", async () => {
    const f = fixture(() => {
      throw new Error("network");
    });
    await expect(f.executor.execute(input)).resolves.toMatchObject({
      state: "CLEANUP_ONLY",
      reason: "DISPATCH_ACK_UNKNOWN",
    });
  });

  it("terminalizes only an explicit definite request rejection", async () => {
    const f = fixture(() => {
      throw new ServerlessTransportError("REQUEST_REJECTED");
    });
    await expect(f.executor.execute(input)).resolves.toMatchObject({
      state: "CLEANUP_ONLY",
      reason: "REQUEST_REJECTED",
    });
    expect(f.finishSend).toHaveBeenCalledWith(
      expect.objectContaining({ outcome: "REQUEST_REJECTED" }),
    );
  });

  it("reconciles assigned jobs by exact id, cancels nonterminal work, then settles once", async () => {
    const f = fixture((lane) => ({ id: `${lane}-job` }));
    f.store.inspect = vi.fn(async () =>
      (["mage_image", "soulx_avatar"] as const).map((lane) => ({
        lane,
        attemptId: `${lane}-attempt`,
        attemptState: "ASSIGNED",
        outboxState: "ASSIGNED",
        providerJobId: `${lane}-job`,
        deploymentId: claims[lane].deploymentId,
        dispatchTokenSha256: hash,
        pairPhase: "BOTH_ASSIGNED",
        recoveryAction: "RECONCILE_ASSIGNED",
      })),
    );
    for (const lane of ["mage_image", "soulx_avatar"] as const) {
      f.transports[lane].status.mockResolvedValue({ id: `${lane}-job`, status: "IN_PROGRESS" });
      f.transports[lane].cancel.mockResolvedValue({ id: `${lane}-job`, status: "CANCELLED" });
    }
    await expect(
      f.executor.reconcileAndSettle({
        accountId: "account",
        workspaceId: "workspace",
        generationRequestId: "request",
      }),
    ).resolves.toEqual({ state: "SETTLED" });
    expect(f.settlementStore.settle).toHaveBeenCalledTimes(1);
    expect(f.transports.mage_image.run).not.toHaveBeenCalled();
    expect(f.transports.soulx_avatar.run).not.toHaveBeenCalled();
  });
});
