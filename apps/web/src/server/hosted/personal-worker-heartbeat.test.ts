import { beforeEach, expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration } from "./configuration";
import { handlePersonalWorkerRequest } from "./personal-worker";

const state = vi.hoisted(() => ({ calls: [] as string[], tenant: false, failUpdate: false }));
vi.mock("./neon", async (original) => {
  const actual = await original<typeof import("./neon")>();
  return {
    ...actual,
    createNeonPool: () => ({
      async query(sql: string) {
        if (!sql.includes("videoforge_media_worker_device_scope"))
          throw Error("Unpinned tenant query");
        return {
          rows: [
            {
              device_id: "device",
              account_id: "account",
              workspace_id: "workspace",
              status: "ONLINE",
              protocol_version: 1,
              execution_bundle_sha256: `sha256:${"a".repeat(64)}`,
            },
          ],
        };
      },
      async connect() {
        return {
          async query(sql: string, parameters?: unknown[]) {
            if (sql === "BEGIN") {
              state.calls.push("BEGIN");
              return { rows: [], rowCount: 0 };
            }
            if (sql.includes("set_config")) {
              expect(sql).toContain("$2, true");
              expect(parameters).toEqual(["videoforge.account_id", "account"]);
              state.tenant = true;
              state.calls.push("TENANT");
            } else if (sql.includes("UPDATE media_worker_devices")) {
              expect(state.tenant).toBe(true);
              state.calls.push("UPDATE");
              if (state.failUpdate) throw Error("fixture database failure");
              return { rows: [{ id: "device" }], rowCount: 1 };
            } else {
              state.calls.push(sql);
              state.tenant = false;
            }
            return { rows: [], rowCount: 0 };
          },
          release() {
            state.calls.push("RELEASE");
          },
        };
      },
      async end() {
        state.calls.push("END");
      },
    }),
  };
});

beforeEach(() => {
  state.calls = [];
  state.tenant = false;
  state.failUpdate = false;
});
const request = () =>
  new Request("https://example.test/api/v2/media-worker/heartbeat", {
    method: "POST",
    headers: { authorization: `Bearer ${"b".repeat(64)}` },
    body: JSON.stringify({
      schema_version: "videoforge-media-worker-heartbeat/v1",
      platform: "MACOS",
      architecture: "AARCH64",
      worker_version: "0.1.15",
      protocol_version: 1,
      execution_bundle_sha256: `sha256:${"a".repeat(64)}`,
    }),
  });
const config = {
  neon: { databaseUrl: "unused" },
  mediaWorkerRelease: {
    minimumProtocolVersion: 1,
    executionBundleSha256: `sha256:${"a".repeat(64)}`,
  },
} as HostedRuntimeConfiguration;
it("pins tenant scope and heartbeat update to one transaction", async () => {
  const response = await handlePersonalWorkerRequest(request(), {}, { waitUntil() {} }, config);
  expect(response?.status).toBe(200);
  expect(await response?.json()).toMatchObject({ status: "ONLINE", claim_available: true });
  expect(state.calls).toEqual(["BEGIN", "TENANT", "UPDATE", "COMMIT", "RELEASE", "END"]);
  expect(state.tenant).toBe(false);
});
it("rolls back and releases the pinned connection when update fails", async () => {
  state.failUpdate = true;
  await expect(
    handlePersonalWorkerRequest(request(), {}, { waitUntil() {} }, config),
  ).rejects.toThrow("fixture database failure");
  expect(state.calls).toEqual(["BEGIN", "TENANT", "UPDATE", "ROLLBACK", "RELEASE", "END"]);
  expect(state.tenant).toBe(false);
});
