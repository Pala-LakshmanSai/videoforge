import { beforeEach, expect, it, vi } from "vitest";
import type { HostedRuntimeConfiguration } from "./configuration";
import { handlePersonalWorkerRequest } from "./personal-worker";
const state = vi.hoisted(() => ({
  calls: [] as string[],
  fresh: true,
  active: true,
  failInputs: false,
  bytes: new Uint8Array(),
  checksum: "",
}));
vi.mock("./neon", async (original) => ({
  ...(await original<typeof import("./neon")>()),
  createNeonPool: () => ({
    async query(sql: string) {
      if (sql.includes("videoforge_hosted_cpu_expected_primary_output")) return { rows: [{}] };
      if (!sql.includes("videoforge_media_worker_device_scope"))
        throw Error("unleased tenant query");
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
      let tenant = false;
      return {
        async query(sql: string, parameters?: unknown[]) {
          if (["BEGIN", "COMMIT", "ROLLBACK"].includes(sql)) {
            state.calls.push(sql);
            tenant = false;
            return { rows: [], rowCount: 0 };
          }
          if (sql.includes("set_config")) {
            expect(sql).toBe("SELECT set_config($1, $2, true)");
            expect(parameters).toEqual(["videoforge.account_id", "account"]);
            tenant = true;
            state.calls.push("TENANT");
            return { rows: [], rowCount: 0 };
          }
          expect(tenant).toBe(true);
          if (sql.includes("SELECT lease.attempt_id")) {
            const terminal = sql.includes("attempt_state");
            state.calls.push(terminal ? "TERMINAL" : "ACTIVE");
            return {
              rows: terminal
                ? [
                    {
                      attempt_id: "attempt",
                      kind: "ASR",
                      state: "FAILED",
                      attempt_state: "FAILED",
                      failure_code: "FIXTURE_FAILURE",
                      result_object_key: null,
                      result_content_length: null,
                      result_checksum_sha256: null,
                    },
                  ]
                : state.active
                  ? [{ attempt_id: "attempt", kind: "ASR", state: "RUNNING" }]
                  : [],
            };
          }
          if (sql.includes("last_heartbeat_at = now()")) {
            state.calls.push("RENEW");
            return { rows: [{ state: "RUNNING" }] };
          }
          if (sql.includes("FROM hosted_cpu_upload_authorities")) {
            state.calls.push("EXPECTED_RESULT");
            return { rows: [] };
          }

          if (sql.includes("SELECT 1 FROM media_worker_devices")) {
            state.calls.push("FRESHNESS");
            return { rows: state.fresh ? [{ ok: 1 }] : [] };
          }
          if (sql.includes("FROM media_worker_input_objects")) {
            state.calls.push("INPUTS");
            if (state.failInputs) throw Error("input read failure");
            return { rows: [] };
          }
          if (sql.includes("SELECT attempt.id,attempt.kind")) {
            state.calls.push("ATTEMPT");
            return {
              rows: [
                {
                  id: "attempt",
                  kind: "ASR",
                  job_spec_object_key: "private-template",
                  job_spec_content_length: state.bytes.length,
                  job_spec_checksum_sha256: state.checksum,
                  deadline_at: new Date(Date.now() + 60000),
                },
              ],
            };
          }
          if (sql.includes("INSERT INTO media_worker_leases")) state.calls.push("LEASE");
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
}));
const config = {
  neon: { databaseUrl: "unused" },
  publicOrigin: "https://example.test",
  mediaWorkerTokenSecret: "fixture-secret",
  workflowCallbackSecret: "fixture-secret",
  r2: {
    accountId: "fixture",
    bucketName: "fixture",
    accessKeyId: "fixture",
    secretAccessKey: "fixture",
    region: "auto",
  },
  mediaWorkerRelease: {
    minimumProtocolVersion: 1,
    executionBundleSha256: `sha256:${"a".repeat(64)}`,
  },
} as HostedRuntimeConfiguration;
const request = () =>
  new Request("https://example.test/api/v2/media-worker/claim", {
    method: "POST",
    headers: { authorization: `Bearer ${"b".repeat(64)}` },
  });
const environment = () =>
  ({
    PRIVATE_ARTIFACTS: {
      get: async () => ({ size: state.bytes.length, arrayBuffer: async () => state.bytes.buffer }),
    },
  }) as never;
beforeEach(async () => {
  state.calls = [];
  state.fresh = true;
  state.active = true;
  state.failInputs = false;
  state.bytes = new TextEncoder().encode(
    JSON.stringify({
      schema_version: "videoforge-personal-worker-job-template/v1",
      attempt_id: "attempt",
      kind: "ASR",
      input_document: {},
      outputs: [{}],
      result: {},
      tooling: {},
    }),
  );
  state.checksum = `sha256:${Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", state.bytes)),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("")}`;
});
it("leases separate tenant transactions for freshness and post-claim inputs", async () => {
  const result = await handlePersonalWorkerRequest(
    request(),
    environment(),
    { waitUntil() {} },
    config,
  );
  expect(result?.status).toBe(200);
  expect(state.calls.slice(0, 5)).toEqual(["BEGIN", "TENANT", "FRESHNESS", "COMMIT", "RELEASE"]);
  expect(state.calls.slice(-6)).toEqual(["BEGIN", "TENANT", "INPUTS", "COMMIT", "RELEASE", "END"]);
  expect(state.calls.filter((x) => x === "LEASE")).toHaveLength(1);
});
it("rejects stale heartbeat before creating a lease", async () => {
  state.fresh = false;
  const result = await handlePersonalWorkerRequest(
    request(),
    environment(),
    { waitUntil() {} },
    config,
  );
  expect(result?.status).toBe(409);
  expect(await result?.json()).toEqual({ error: { code: "MEDIA_WORKER_HEARTBEAT_REQUIRED" } });
  expect(state.calls).toEqual(["BEGIN", "TENANT", "FRESHNESS", "COMMIT", "RELEASE", "END"]);
});
it("rolls back and releases the input transaction without replaying the claim", async () => {
  state.failInputs = true;
  await expect(
    handlePersonalWorkerRequest(request(), environment(), { waitUntil() {} }, config),
  ).rejects.toThrow("input read failure");
  expect(state.calls.slice(-6)).toEqual([
    "BEGIN",
    "TENANT",
    "INPUTS",
    "ROLLBACK",
    "RELEASE",
    "END",
  ]);
  expect(state.calls.filter((x) => x === "LEASE")).toHaveLength(1);
});

const leaseRequest = (action: string, body?: unknown) =>
  new Request(
    `https://example.test/api/v2/media-worker/leases/11111111-1111-4111-8111-111111111111/${action}`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${"b".repeat(64)}`,
        "x-videoforge-lease-token": "c".repeat(64),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
  );
it("pins active lease authorization and renewal separately", async () => {
  const result = await handlePersonalWorkerRequest(
    leaseRequest("heartbeat"),
    environment(),
    { waitUntil() {} },
    config,
  );
  expect(result?.status).toBe(200);
  expect(state.calls).toEqual([
    "BEGIN",
    "TENANT",
    "ACTIVE",
    "COMMIT",
    "RELEASE",
    "BEGIN",
    "TENANT",
    "RENEW",
    "COMMIT",
    "RELEASE",
    "END",
  ]);
});
it("pins terminal replay lookup without a new claim", async () => {
  state.active = false;
  const result = await handlePersonalWorkerRequest(
    leaseRequest("complete", {
      schema_version: "videoforge-personal-worker-completion/v1",
      status: "FAILED",
      failure_code: "FIXTURE_FAILURE",
      result_object_key: null,
      result_content_length: null,
      result_checksum_sha256: null,
    }),
    environment(),
    { waitUntil() {} },
    config,
  );
  expect(result?.status).toBe(200);
  expect(state.calls).toEqual([
    "BEGIN",
    "TENANT",
    "ACTIVE",
    "COMMIT",
    "RELEASE",
    "BEGIN",
    "TENANT",
    "TERMINAL",
    "COMMIT",
    "RELEASE",
    "END",
  ]);
});
it("pins expected result lookup and keeps missing-result rejection", async () => {
  const result = await handlePersonalWorkerRequest(
    leaseRequest("complete", {
      schema_version: "videoforge-personal-worker-completion/v1",
      status: "SUCCEEDED",
      failure_code: null,
      result_object_key: "private",
      result_content_length: 1,
      result_checksum_sha256: `sha256:${"a".repeat(64)}`,
    }),
    environment(),
    { waitUntil() {} },
    config,
  );
  expect(result?.status).toBe(409);
  expect(await result?.json()).toEqual({ error: { code: "MEDIA_WORKER_RESULT_MISSING" } });
  expect(state.calls.slice(-6)).toEqual([
    "BEGIN",
    "TENANT",
    "EXPECTED_RESULT",
    "COMMIT",
    "RELEASE",
    "END",
  ]);
});
