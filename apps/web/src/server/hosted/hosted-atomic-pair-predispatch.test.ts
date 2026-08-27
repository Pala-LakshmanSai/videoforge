import { describe, expect, it, vi } from "vitest";
import validEnvelope from "@videoforge/contracts/generated/fixtures/serverless_worker_job_envelope_v3.valid.json";

import {
  decideHostedAtomicPairRecovery,
  HostedSqlAtomicPairPredispatch,
  signAndVerifyHostedAtomicPair,
} from "./hosted-atomic-pair-predispatch";
import type { HostedEnvelopePairSigner } from "./hosted-envelope-signer";

describe("hosted atomic pair predispatch", () => {
  it("uses one transaction and returns the exact deterministic lane order", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.startsWith("SELECT set_config")) return { rows: [], affectedRows: 1 };
      return {
        affectedRows: 2,
        rows: ["mage_image", "soulx_avatar"].map((lane, index) => ({
          lane,
          attempt_id: `attempt-${index}`,
          authority_id: `authority-${index}`,
          outbox_id: `outbox-${index}`,
          dispatch_token: `vf_token_${index}`,
          dispatch_token_sha256: `sha256:${"1".repeat(64)}`,
          unsigned_envelope: {
            schema: "serverless-worker-job-envelope/v3",
            dispatch_token: `vf_token_${index}`,
          },
          unsigned_envelope_sha256: `sha256:${"2".repeat(64)}`,
          request_body_sha256: `sha256:${"3".repeat(64)}`,
          endpoint_id_sha256: `sha256:${"4".repeat(64)}`,
          output_prefix: "tenant/test",
          authority_sha256: `sha256:${"5".repeat(64)}`,
          request_ttl_seconds: 7200,
          deadline_at: new Date("2026-08-25T10:00:00.000Z"),
          reconciliation_deadline_at: new Date("2026-08-25T09:30:00.000Z"),
        })),
      };
    });
    const database = {
      query,
      transaction: vi.fn(async (operation: (tx: { query: typeof query }) => unknown) =>
        operation({ query }),
      ),
    };
    const adapter = new HostedSqlAtomicPairPredispatch(database as never);
    const result = await adapter.commit({
      approvalId: "approval",
      approvalSha256: `sha256:${"a".repeat(64)}`,
      claimId: "claim",
      accountId: "account",
      workspaceId: "workspace",
      projectId: "project",
      projectRevisionId: "revision",
      generationRequestId: "request",
      generationPlanSha256: `sha256:${"b".repeat(64)}`,
      leaseId: "lease",
      laneBindings: [],
      totalCapUsd: 1,
      expiresAt: "2026-08-25T11:00:00.000Z",
      pair: [],
      v209Admission: {} as never,
      dispatchTokenKey: "k".repeat(32),
    });
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(result.map(({ lane }) => lane)).toEqual(["mage_image", "soulx_avatar"]);
    expect(query.mock.calls[2]?.[0]).toContain("videoforge_commit_hosted_atomic_pair_predispatch");
  });

  it.each([
    ["READY_TO_DISPATCH", "READY_TO_DISPATCH", "SEND_MAGE_ONLY"],
    ["ASSIGNED", "READY_TO_DISPATCH", "SEND_SOULX_ONLY"],
    ["ASSIGNED", "ASSIGNED", "COMPLETE"],
    ["SENT", "READY_TO_DISPATCH", "CLEANUP_ONLY"],
    ["DISPATCH_ACK_UNKNOWN", "READY_TO_DISPATCH", "CLEANUP_ONLY"],
    ["ASSIGNED", "SENT", "CLEANUP_ONLY"],
    ["DEAD_LETTER", "READY_TO_DISPATCH", "CLEANUP_ONLY"],
  ])("maps Mage %s and SoulX %s to %s", (mage, soulx, expected) => {
    expect(decideHostedAtomicPairRecovery({ mage, soulx })).toBe(expected);
  });

  it("signs and verifies the exact pair before transport", async () => {
    const { authority_sha256: _authority, signature: _signature, ...unsigned } = validEnvelope;
    void _authority;
    void _signature;
    const bodies = [
      { lane: "mage_image", body: structuredClone(unsigned) },
      {
        lane: "soulx_avatar",
        body: { ...structuredClone(unsigned), work: { ...unsigned.work, lane: "soulx_avatar" } },
      },
    ] as const;
    const { sha256CanonicalJson } = await import("@videoforge/contracts");
    const commits = await Promise.all(
      bodies.map(async ({ lane, body }) => ({
        lane,
        attemptId: lane,
        authorityId: lane,
        outboxId: lane,
        dispatchToken: lane,
        dispatchTokenSha256: `sha256:${"1".repeat(64)}`,
        unsignedEnvelope: body,
        unsignedEnvelopeSha256: await sha256CanonicalJson(body),
        requestBodySha256: `sha256:${"2".repeat(64)}`,
        endpointIdSha256: `sha256:${"3".repeat(64)}`,
        outputPrefix: "tenant/test",
        authoritySha256: `sha256:${"4".repeat(64)}`,
        requestTtlSeconds: 7200,
        deadlineAt: "2026-08-25T10:00:00.000Z",
        reconciliationDeadlineAt: "2026-08-25T09:30:00.000Z",
      })),
    );
    const signatures = await Promise.all(
      commits.map(async (commit) => ({
        lane: commit.lane,
        keyId: "key",
        keyHash: `sha256:${"3".repeat(64)}`,
        authoritySha256: commit.unsignedEnvelopeSha256,
        signature: { algorithm: "HMAC-SHA256" as const, key_id: "key", value: "4".repeat(64) },
      })),
    );
    const signer = { signPair: vi.fn(async () => signatures), verifyPair: vi.fn(async () => true) };
    await expect(
      signAndVerifyHostedAtomicPair(commits, signer as HostedEnvelopePairSigner),
    ).resolves.toHaveLength(2);
    expect(signer.signPair).toHaveBeenCalledBefore(signer.verifyPair);
  });

  it("rejects malformed final envelopes after pair verification", async () => {
    const commit = {
      lane: "mage_image" as const,
      attemptId: "a",
      authorityId: "a",
      outboxId: "a",
      dispatchToken: "a",
      dispatchTokenSha256: `sha256:${"1".repeat(64)}`,
      unsignedEnvelope: { schema: "serverless-worker-job-envelope/v3" },
      unsignedEnvelopeSha256: await (
        await import("@videoforge/contracts")
      ).sha256CanonicalJson({ schema: "serverless-worker-job-envelope/v3" }),
      requestBodySha256: `sha256:${"2".repeat(64)}`,
      endpointIdSha256: `sha256:${"3".repeat(64)}`,
      outputPrefix: "tenant/test",
      authoritySha256: `sha256:${"4".repeat(64)}`,
      requestTtlSeconds: 1,
      deadlineAt: "2026-08-25T10:00:00.000Z",
      reconciliationDeadlineAt: "2026-08-25T09:30:00.000Z",
    };
    const second = { ...commit, lane: "soulx_avatar" as const };
    const signer = {
      signPair: vi.fn(async () =>
        [commit, second].map((item) => ({
          lane: item.lane,
          keyId: "key",
          keyHash: `sha256:${"3".repeat(64)}` as const,
          authoritySha256: item.unsignedEnvelopeSha256,
          signature: { algorithm: "HMAC-SHA256" as const, key_id: "key", value: "4".repeat(64) },
        })),
      ),
      verifyPair: vi.fn(async () => true),
    };
    await expect(
      signAndVerifyHostedAtomicPair([commit, second], signer as HostedEnvelopePairSigner),
    ).rejects.toMatchObject({ code: "HOSTED_ATOMIC_PAIR_FINAL_ENVELOPE_INVALID" });
  });
});
