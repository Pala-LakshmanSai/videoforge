import { describe, expect, it, vi } from "vitest";

import type { HostedServerlessAttemptBinding } from "../runtime/hosted-serverless-output-barrier";
import { sha256 } from "./crypto";
import {
  createHostedAuthenticatedServerlessCallbackRoute,
  type HostedServerlessCallbackAuthority,
} from "./hosted-serverless-callback-auth";

const ATTEMPT = "00000000-0000-4000-8000-000000000001";
const FOREIGN_ATTEMPT = "00000000-0000-4000-8000-000000000002";
const TOKEN = "callback-only-token_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF";

const binding: HostedServerlessAttemptBinding = Object.freeze({
  accountId: "00000000-0000-4000-8000-000000000003",
  workspaceId: "00000000-0000-4000-8000-000000000004",
  projectId: "00000000-0000-4000-8000-000000000005",
  projectRevisionId: "00000000-0000-4000-8000-000000000006",
  lane: "mage_image",
  attemptId: ATTEMPT,
  providerJobId: "provider-job-1",
  dispatchTokenSha256: `sha256:${"1".repeat(64)}`,
  envelopeSha256: `sha256:${"8".repeat(64)}`,
  requestSha256: `sha256:${"9".repeat(64)}`,
  deploymentId: "00000000-0000-4000-8000-000000000007",
  endpointIdSha256: `sha256:${"2".repeat(64)}`,
  endpointConfigSha256: `sha256:${"3".repeat(64)}`,
  workerImageDigest: `sha256:${"4".repeat(64)}`,
  modelManifestSha256: `sha256:${"5".repeat(64)}`,
  volumeIdSha256: `sha256:${"6".repeat(64)}`,
  volumeManifestSha256: `sha256:${"7".repeat(64)}`,
  expectedObjects: [],
});

function request(token: string | null, body = "{}", length = body.length): Request {
  const headers = new Headers({
    "content-type": "application/json",
    "content-length": String(length),
  });
  if (token !== null) headers.set("authorization", `Bearer ${token}`);
  return new Request(
    `https://videoforge.example/api/v2/serverless-attempts/${ATTEMPT}/output-callback`,
    {
      method: "POST",
      headers,
      body,
    },
  );
}

async function authority(): Promise<HostedServerlessCallbackAuthority> {
  return {
    purpose: "SERVERLESS_OUTPUT_CALLBACK",
    callbackTokenSha256: await sha256(TOKEN),
    assignmentId: "00000000-0000-4000-8000-000000000008",
    binding,
  };
}

describe("hosted signed worker callback authentication", () => {
  it("uses one opaque token-hash lookup and passes the durable bound attempt to the barrier", async () => {
    const expected = await authority();
    const load = vi.fn(async () => expected);
    const acceptBound = vi.fn(async () => ({
      barrier: "LANE_COMPLETED" as const,
      renderPlan: null,
    }));
    const route = createHostedAuthenticatedServerlessCallbackRoute({
      authorities: { loadCurrentOutputAuthorityByTokenSha256: load },
      callback: { acceptBound },
    });

    const response = await route.handle(request(TOKEN), ATTEMPT);
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith(expected.callbackTokenSha256);
    expect(acceptBound).toHaveBeenCalledWith(binding, {});
    await expect(response.json()).resolves.toEqual({
      schema_version: "videoforge-hosted-serverless-output-callback-response/v1",
      outcome: "LANE_COMPLETED",
      render_plan: "PENDING",
    });
  });

  it("returns one non-oracle response for missing, wrong, unknown, and foreign-attempt tokens", async () => {
    const expected = await authority();
    const acceptBound = vi.fn();
    const route = createHostedAuthenticatedServerlessCallbackRoute({
      authorities: {
        async loadCurrentOutputAuthorityByTokenSha256(hash) {
          return hash === expected.callbackTokenSha256 ? expected : null;
        },
      },
      callback: { acceptBound },
    });
    const cases = [
      route.handle(request(null), ATTEMPT),
      route.handle(request("wrong-token_abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH"), ATTEMPT),
      route.handle(request(TOKEN), FOREIGN_ATTEMPT),
    ];
    for (const response of await Promise.all(cases)) {
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: { code: "HOSTED_SERVERLESS_CALLBACK_UNAUTHENTICATED", retryable: false },
      });
    }
    expect(acceptBound).not.toHaveBeenCalled();
  });

  it("authenticates before parsing, then rejects malformed and oversized bodies", async () => {
    const expected = await authority();
    const load = vi.fn(async () => expected);
    const acceptBound = vi.fn();
    const route = createHostedAuthenticatedServerlessCallbackRoute({
      authorities: { loadCurrentOutputAuthorityByTokenSha256: load },
      callback: { acceptBound },
    });

    const unauthenticatedMalformed = await route.handle(request(null, "{"), ATTEMPT);
    expect(unauthenticatedMalformed.status).toBe(401);
    const malformed = await route.handle(request(TOKEN, "{"), ATTEMPT);
    expect(malformed.status).toBe(400);
    const oversized = await route.handle(request(TOKEN, "{}", 4 * 1024 * 1024 + 1), ATTEMPT);
    expect(oversized.status).toBe(400);
    expect(acceptBound).not.toHaveBeenCalled();
  });

  it("delegates exact replay semantics to the existing output barrier", async () => {
    const expected = await authority();
    let calls = 0;
    const route = createHostedAuthenticatedServerlessCallbackRoute({
      authorities: {
        async loadCurrentOutputAuthorityByTokenSha256() {
          return expected;
        },
      },
      callback: {
        async acceptBound() {
          calls += 1;
          return {
            barrier: calls === 1 ? "LANE_COMPLETED" : "DUPLICATE_IDEMPOTENT",
            renderPlan: null,
          };
        },
      },
    });
    const first = (await (await route.handle(request(TOKEN), ATTEMPT)).json()) as {
      outcome: string;
    };
    const replay = (await (await route.handle(request(TOKEN), ATTEMPT)).json()) as {
      outcome: string;
    };
    expect(first.outcome).toBe("LANE_COMPLETED");
    expect(replay.outcome).toBe("DUPLICATE_IDEMPOTENT");
  });
});
