import { describe, expect, it, vi } from "vitest";

import { handleHostedInviteRedemption, HOSTED_INVITE_REDEMPTION_SCHEMA } from "./invite-redemption";

const ORIGIN = "https://videoforge.example.test";
const SESSION = "session-token-that-is-never-returned";
const allowRateLimit = async () => true;

function request(body: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/v2/invite/redemption`, {
    method: "POST",
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

function body(inviteCode = "test-invitation-code-0001") {
  return { schema_version: HOSTED_INVITE_REDEMPTION_SCHEMA, invite_code: inviteCode };
}

describe("hosted invite redemption route", () => {
  it("rejects cross-origin writes before authentication or verifier processing", async () => {
    const sessionToken = vi.fn(async () => SESSION);
    const redeem = vi
      .fn<(sessionToken: string, verifierSha256: `sha256:${string}`) => Promise<"ADMITTED">>()
      .mockResolvedValue("ADMITTED");

    const response = await handleHostedInviteRedemption(request(body(), "https://evil.test"), {
      publicOrigin: ORIGIN,
      sessionToken,
      consumeRateLimit: allowRateLimit,
      redeem,
    });

    expect(response.status).toBe(403);
    expect(sessionToken).not.toHaveBeenCalled();
    expect(redeem).not.toHaveBeenCalled();
  });

  it("accepts only the exact schema and never passes the raw verifier to persistence", async () => {
    const redeem = vi
      .fn<(sessionToken: string, verifierSha256: `sha256:${string}`) => Promise<"ADMITTED">>()
      .mockResolvedValue("ADMITTED");
    const response = await handleHostedInviteRedemption(request(body()), {
      publicOrigin: ORIGIN,
      sessionToken: async () => SESSION,
      consumeRateLimit: allowRateLimit,
      redeem,
    });

    expect(response.status).toBe(200);
    expect(redeem).toHaveBeenCalledTimes(1);
    const [sessionToken, verifierSha256] = redeem.mock.calls[0]!;
    expect(sessionToken).toBe(SESSION);
    expect(verifierSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(verifierSha256).not.toContain("test-invitation-code-0001");
    expect(await response.text()).not.toContain("test-invitation-code-0001");
  });

  it("rejects malformed or unauthenticated requests without invoking admission", async () => {
    const redeem = vi.fn(async () => "ADMITTED" as const);
    const malformed = await handleHostedInviteRedemption(
      request({ schema_version: HOSTED_INVITE_REDEMPTION_SCHEMA, invite_code: " short " }),
      {
        publicOrigin: ORIGIN,
        sessionToken: async () => SESSION,
        consumeRateLimit: allowRateLimit,
        redeem,
      },
    );
    expect(malformed.status).toBe(400);
    expect(redeem).not.toHaveBeenCalled();

    const unauthenticated = await handleHostedInviteRedemption(request(body()), {
      publicOrigin: ORIGIN,
      sessionToken: async () => null,
      consumeRateLimit: allowRateLimit,
      redeem,
    });
    expect(unauthenticated.status).toBe(401);
    expect(redeem).not.toHaveBeenCalled();
  });

  it.each([
    ["INVITE_ALREADY_USED", 409],
    ["INVITE_EMAIL_MISMATCH", 403],
    ["INVITE_EXPIRED", 410],
    ["INVITE_REVOKED", 410],
    ["INVITE_INVALID", 400],
  ] as const)("maps %s to a bounded safe response", async (outcome, expectedStatus) => {
    const response = await handleHostedInviteRedemption(request(body()), {
      publicOrigin: ORIGIN,
      sessionToken: async () => SESSION,
      consumeRateLimit: allowRateLimit,
      redeem: async () => outcome,
    });

    expect(response.status).toBe(expectedStatus);
    expect(await response.json()).toEqual({ error: { code: outcome, retryable: false } });
  });

  it("fails closed before verifier processing when the invite rate limit is exhausted", async () => {
    const redeem = vi.fn(async () => "ADMITTED" as const);
    const response = await handleHostedInviteRedemption(request(body()), {
      publicOrigin: ORIGIN,
      sessionToken: async () => SESSION,
      consumeRateLimit: async () => false,
      redeem,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("600");
    expect(redeem).not.toHaveBeenCalled();
  });
});
