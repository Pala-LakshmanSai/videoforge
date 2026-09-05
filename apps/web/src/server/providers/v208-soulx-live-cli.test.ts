// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createV208CleanupAttributableResource,
  runV208SoulXLiveCli,
} from "./v208-soulx-live-cli.js";

const STAGE_AUTHORITY = "authority-v208-soulx";
const RESOURCE_KEY = `v213-${STAGE_AUTHORITY}-soulx-qualification`;

function durable(value: unknown) {
  return {
    readSnapshot: vi.fn(() => value as never),
  };
}

describe("V2-08 live composition", () => {
  it("loads and narrows the durable cleanup scope to the exact consumed SoulX authority", async () => {
    const stage = {
      stage: "soulx",
      stageAuthorityId: STAGE_AUTHORITY,
      operations: [
        {
          operationId: "create-op",
          stageAuthorityId: STAGE_AUTHORITY,
          kind: "create",
          resourceKey: RESOURCE_KEY,
          state: "ACKED",
          providerId: "endpoint-v208",
          evidence: {},
        },
        {
          operationId: "dispatch-op",
          stageAuthorityId: STAGE_AUTHORITY,
          kind: "dispatch",
          resourceKey: "v208-soulx-cold-whole-span-2-4-6-10s",
          state: "ACKED",
          providerId: "job-cold",
          evidence: null,
        },
        {
          operationId: "status-op",
          stageAuthorityId: STAGE_AUTHORITY,
          kind: "status",
          resourceKey: `sha256:${"a".repeat(64)}:job-cold:0`,
          state: "TERMINAL",
          providerId: "job-cold",
          evidence: {},
        },
        {
          operationId: "cancel-op",
          stageAuthorityId: STAGE_AUTHORITY,
          kind: "cancel",
          resourceKey: `sha256:${"a".repeat(64)}:job-cancel`,
          state: "TERMINAL",
          providerId: "job-cancel",
          evidence: {},
        },
        {
          operationId: "delete-op",
          stageAuthorityId: STAGE_AUTHORITY,
          kind: "delete",
          resourceKey: RESOURCE_KEY,
          state: "TERMINAL",
          providerId: "endpoint-v208",
          evidence: null,
        },
      ],
    };
    const store = durable({
      stageAuthority: {
        status: "CLAIMED",
        authority: { authorityId: STAGE_AUTHORITY },
        claim: { nonceSha256: `sha256:${"a".repeat(64)}`, consumedAt: "2026-01-01T00:00:00.000Z" },
        handoff: null,
      },
      operations: stage.operations,
    });
    const cleanupAttributableResources = vi.fn(async () => ({
      production: [],
      deletedEndpointIdSha256s: [],
      deletedTemplateIdSha256s: [],
    }));
    const cleanup = createV208CleanupAttributableResource({
      durable: store,
      transport: { cleanupAttributableResources },
    });

    await expect(cleanup(RESOURCE_KEY)).resolves.toBe(true);
    expect(store.readSnapshot).toHaveBeenCalledTimes(1);
    expect(cleanupAttributableResources).toHaveBeenCalledWith([
      expect.objectContaining({
        stage: "soulx",
        stageAuthorityId: STAGE_AUTHORITY,
        operations: stage.operations,
      }),
    ]);
  });

  it("rejects cleanup scope containing a different resource key", async () => {
    const cleanup = createV208CleanupAttributableResource({
      durable: durable({
        stageAuthority: {
          status: "CLAIMED",
          authority: { authorityId: STAGE_AUTHORITY },
          claim: { nonceSha256: `sha256:${"a".repeat(64)}`, consumedAt: "2026-01-01T00:00:00.000Z" },
          handoff: null,
        },
        operations: [
          {
            operationId: "bad-op",
            stageAuthorityId: STAGE_AUTHORITY,
            kind: "create",
            resourceKey: "v213-another-authority-soulx-qualification",
            state: "ACKED",
            providerId: "endpoint-v208",
            evidence: null,
          },
        ],
      }),
      transport: { cleanupAttributableResources: vi.fn() },
    });
    await expect(cleanup(RESOURCE_KEY)).rejects.toThrow("V208_CLEANUP_OPERATION_SCOPE_INVALID");
  });

  it("loads the RunPod key through the keychain port but remains fail-closed at null authority", async () => {
    const loadRunPodKey = vi.fn(async () => "runpod-key-at-least-twenty-characters");
    const writeOutput = vi.fn();
    await expect(
      runV208SoulXLiveCli(process.env, {
        loadRunPodKey,
        readInputs: () => ({}) as never,
        createComposition: (() => ({ dependencies: {} })) as never,
        writeOutput,
      }),
    ).rejects.toThrow("V208_FRESH_EXACT_AUTHORITY_REQUIRED");
    expect(loadRunPodKey).toHaveBeenCalledTimes(1);
    expect(writeOutput).not.toHaveBeenCalled();
  });
});
