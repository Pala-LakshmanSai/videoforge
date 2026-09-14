import { describe, expect, it, vi } from "vitest";
import { ServerlessTransportError, type Sha256 } from "@videoforge/control-plane";
import { sha256CanonicalJson } from "@videoforge/contracts";
import {
  HostedImageRegenerationRuntime,
  type HostedImageRegenerationClaim,
  type HostedImageRegenerationRequest,
  type HostedImageRegenerationStore,
} from "./hosted-image-regeneration-runtime";

const sha = (value: string) => `sha256:${value.padEnd(64, "0").slice(0, 64)}` as Sha256;
const request: HostedImageRegenerationRequest = {
  accountId: "a",
  workspaceId: "w",
  requestId: "r",
  sceneId: "scene-1",
  editedPrompt: "edited",
  envelope: { request: "r" },
  requestBody: { prompt: "edited" },
  endpointIdSha256: sha("endpoint"),
  dispatchToken: "token",
};

type TestStore = HostedImageRegenerationStore & {
  replaced: unknown[];
  sends: number;
  body?: Sha256;
  envelope?: Sha256;
};
function storeFor(state: HostedImageRegenerationClaim["state"] = "PREPARED"): TestStore {
  const bodyHash = sha256CanonicalJson(request.requestBody) as Promise<Sha256>;
  const envelopeHash = sha256CanonicalJson(request.envelope) as Promise<Sha256>;
  let claim!: HostedImageRegenerationClaim;
  let currentState = state;
  const result = { replaced: [], sends: 0 } as unknown as TestStore;
  const make = (
    next: HostedImageRegenerationClaim["state"],
    job: string | null = claim?.providerJobId ?? null,
  ) => {
    currentState = next;
    claim = {
      state: next,
      requestId: "r",
      sceneId: "scene-1",
      dispatchToken: "token",
      endpointIdSha256: sha("endpoint"),
      requestBodySha256: result.body ?? sha("body"),
      envelopeSha256: result.envelope ?? sha("envelope"),
      providerJobId: job,
    };
  };
  result.prepare = vi.fn(async () => {
    result.body = await bodyHash;
    result.envelope = await envelopeHash;
    make(currentState, currentState === "ASSIGNED" ? "job" : (claim?.providerJobId ?? null));
    return claim;
  });
  result.beginSend = vi.fn(async () => {
    result.sends += 1;
    make("SENT");
    return { claim, acquired: true };
  });
  result.finishSend = vi.fn(async (input) => {
    make(input.state, input.providerJobId);
    return claim;
  });
  result.finishTerminal = vi.fn(async (input) => {
    make(input.state);
    return claim;
  });
  result.replaceAcceptedScene = vi.fn(async (input) => {
    result.replaced.push(input.accepted);
    make("COMPLETED");
    return claim;
  });
  return result;
}

function runtime(
  store: ReturnType<typeof storeFor>,
  run: () => Promise<{ id: string }>,
  output: unknown = { signed: true },
) {
  const transport = {
    run: vi.fn(run),
    status: vi.fn(async () => ({ id: "job", status: "COMPLETED" as const, output })),
    cancel: vi.fn(),
  };
  const acceptance = { accept: vi.fn(async () => ({ image: "new" })) };
  return {
    runtime: new HostedImageRegenerationRuntime(store, transport, acceptance),
    transport,
    acceptance,
  };
}

describe("HostedImageRegenerationRuntime", () => {
  it("sends, verifies, and atomically replaces one scene", async () => {
    const store = storeFor();
    const x = runtime(store, async () => ({ id: "job" }));
    const result = await x.runtime.run(request);
    expect(result).toMatchObject({ state: "COMPLETED", replaced: true });
    expect(store.replaced).toEqual([{ image: "new" }]);
  });

  it("uses one send for concurrent invocations", async () => {
    const store = storeFor();
    let first = true;
    store.beginSend = vi.fn(async () => {
      if (!first) {
        const c = await store.prepare(request);
        return { claim: { ...c, state: "SENT" as const, providerJobId: null }, acquired: false };
      }
      first = false;
      store.sends += 1;
      return {
        claim: { ...(await store.prepare(request)), state: "SENT" as const, providerJobId: null },
        acquired: true,
      };
    });
    const x = runtime(store, async () => ({ id: "job" }));
    await Promise.all([x.runtime.run(request), x.runtime.run(request)]);
    expect(x.transport.run).toHaveBeenCalledTimes(1);
  });

  it("records lost acknowledgement and never replays", async () => {
    const store = storeFor();
    const x = runtime(store, async () => {
      throw new ServerlessTransportError("DISPATCH_ACK_UNKNOWN");
    });
    expect((await x.runtime.run(request)).state).toBe("DISPATCH_ACK_UNKNOWN");
    expect((await x.runtime.run(request)).state).toBe("DISPATCH_ACK_UNKNOWN");
    expect(x.transport.run).toHaveBeenCalledTimes(1);
  });

  it("records definite rejection", async () => {
    const store = storeFor();
    const x = runtime(store, async () => {
      throw new ServerlessTransportError("REQUEST_REJECTED");
    });
    expect((await x.runtime.run(request)).state).toBe("REQUEST_REJECTED");
  });

  it("does not replace on provider failure or acceptance failure", async () => {
    const failed = storeFor("ASSIGNED");
    const x = runtime(failed, async () => ({ id: "unused" }));
    x.transport.status = vi.fn(async () => ({
      id: "job",
      status: "FAILED" as const,
      output: undefined,
    })) as unknown as typeof x.transport.status;
    expect((await x.runtime.run(request)).state).toBe("FAILED");
    expect(failed.replaced).toHaveLength(0);
    const rejected = storeFor("ASSIGNED");
    const y = runtime(rejected, async () => ({ id: "unused" }));
    y.acceptance.accept = vi.fn(async () => {
      throw new Error("bad signature");
    });
    expect((await y.runtime.run(request)).state).toBe("FAILED");
    expect(rejected.replaced).toHaveLength(0);
  });

  it("replay of completed request does not send or replace twice", async () => {
    const store = storeFor("COMPLETED");
    const x = runtime(store, async () => ({ id: "unused" }));
    await x.runtime.run(request);
    await x.runtime.run(request);
    expect(x.transport.run).not.toHaveBeenCalled();
    expect(store.replaced).toHaveLength(0);
  });

  it("rejects a tampered supplied hash and a mismatched persisted claim", async () => {
    const store = storeFor();
    const x = runtime(store, async () => ({ id: "unused" }));
    await expect(x.runtime.run({ ...request, requestBodySha256: sha("tampered") })).rejects.toThrow(
      "REQUEST_HASH_MISMATCH",
    );
    const mismatch = storeFor();
    mismatch.prepare = vi.fn(async () => ({ ...(await store.prepare(request)), sceneId: "other" }));
    await expect(
      runtime(mismatch, async () => ({ id: "unused" })).runtime.run(request),
    ).rejects.toThrow("CLAIM_MISMATCH");
  });

  it("rejects a completed snapshot for a different provider job", async () => {
    const store = storeFor("ASSIGNED");
    const x = runtime(store, async () => ({ id: "unused" }));
    x.transport.status = vi.fn(async () => ({
      id: "other-job",
      status: "COMPLETED" as const,
      output: {},
    }));
    await expect(x.runtime.run(request)).rejects.toThrow("PROVIDER_JOB_MISMATCH");
    expect(store.replaced).toHaveLength(0);
  });
});
