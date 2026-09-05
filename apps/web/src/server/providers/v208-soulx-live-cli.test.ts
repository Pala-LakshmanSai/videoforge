// @vitest-environment node

import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import { describe, expect, it, vi } from "vitest";

import {
  createV208CleanupAttributableResource,
  runV208SoulXLiveCli,
} from "./v208-soulx-live-cli.js";

const FULL_AUTHORITY = "12345678-1234-4123-8123-123456789abc";
const STAGE_AUTHORITY = "authority-v208-soulx";
const RESOURCE_KEY = `v213-${STAGE_AUTHORITY}-soulx-qualification`;

function database(value: unknown): TransactionalSqlExecutor {
  return {
    query: vi.fn(async () => ({ rows: [{ value }] })),
    transaction: vi.fn(),
  } as unknown as TransactionalSqlExecutor;
}

describe("V2-08 live composition", () => {
  it("loads and narrows the durable cleanup scope to the exact consumed SoulX authority", async () => {
    const stage = {
      stage: "soulx",
      stageAuthorityId: STAGE_AUTHORITY,
      operations: [
        {
          kind: "create",
          resourceKey: RESOURCE_KEY,
          state: "ACKED",
          providerId: "endpoint-v208",
          evidence: {},
        },
        {
          kind: "dispatch",
          resourceKey: "v208-soulx-cold-whole-span-2-4-6-10s",
          state: "ACKED",
          providerId: "job-cold",
          evidence: null,
        },
        {
          kind: "status",
          resourceKey: `sha256:${"a".repeat(64)}:job-cold:0`,
          state: "TERMINAL",
          providerId: "job-cold",
          evidence: {},
        },
        {
          kind: "cancel",
          resourceKey: `sha256:${"a".repeat(64)}:job-cancel`,
          state: "TERMINAL",
          providerId: "job-cancel",
          evidence: {},
        },
        {
          kind: "delete",
          resourceKey: RESOURCE_KEY,
          state: "TERMINAL",
          providerId: "endpoint-v208",
          evidence: null,
        },
      ],
    };
    const sql = database({
      schemaVersion: "videoforge.v213-cleanup-scope/v1",
      fullLiveAuthorityId: FULL_AUTHORITY,
      stages: [
        { stage: "mage", stageAuthorityId: "other-authority", operations: [] },
        stage,
      ],
    });
    const cleanupAttributableResources = vi.fn(async () => ({
      production: [],
      deletedEndpointIdSha256s: [],
      deletedTemplateIdSha256s: [],
    }));
    const cleanup = createV208CleanupAttributableResource({
      database: sql,
      fullLiveAuthorityId: FULL_AUTHORITY,
      transport: { cleanupAttributableResources },
    });

    await expect(cleanup(RESOURCE_KEY)).resolves.toBe(true);
    expect(sql.query).toHaveBeenCalledWith(
      "SELECT public.videoforge_load_v213_cleanup_scope($1::uuid) value",
      [FULL_AUTHORITY],
    );
    expect(cleanupAttributableResources).toHaveBeenCalledWith([stage]);
  });

  it("rejects cleanup scope containing a different resource key", async () => {
    const cleanup = createV208CleanupAttributableResource({
      database: database({
        schemaVersion: "videoforge.v213-cleanup-scope/v1",
        fullLiveAuthorityId: FULL_AUTHORITY,
        stages: [
          {
            stage: "soulx",
            stageAuthorityId: STAGE_AUTHORITY,
            operations: [{ resourceKey: "v213-another-authority-soulx-qualification" }],
          },
        ],
      }),
      fullLiveAuthorityId: FULL_AUTHORITY,
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
