import { beforeEach, expect, it, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostedRuntimeConfiguration } from "./configuration";
import { handlePersonalWorkerRequest } from "./personal-worker";
import { workerConnectScript } from "./worker-connect-scripts";

const state = vi.hoisted(() => ({
  calls: [] as string[],
  tokenValid: true,
  ownerConflict: false,
  signedIn: true,
  deviceAuthorized: true,
  sameAccount: true,
  ready: true,
  busy: false,
}));
vi.mock("./auth", () => ({
  createHostedAuth: () => ({
    api: { getSession: async () => (state.signedIn ? { session: { token: "session" } } : null) },
  }),
}));
vi.mock("./neon", async (original) => {
  const actual = await original<typeof import("./neon")>();
  async function query(sql: string) {
    state.calls.push(sql);
    if (sql.includes("videoforge_media_worker_device_scope"))
      return {
        rows: state.deviceAuthorized
          ? [
              {
                device_id: "device",
                account_id: state.sameAccount ? "account" : "old-account",
                workspace_id: state.sameAccount ? "workspace" : "old-workspace",
                status: "ONLINE",
              },
            ]
          : [],
      };
    if (sql.includes("SELECT status, (status"))
      return { rows: [{ status: "ONLINE", ready: state.ready }] };
    if (sql.includes("SELECT id FROM media_worker_leases"))
      return { rows: state.busy ? [{ id: "lease" }] : [] };
    if (
      sql.includes("videoforge_hosted_session_scope") ||
      sql.includes("videoforge_media_worker_connect_consume")
    )
      return {
        rows: state.tokenValid ? [{ account_id: "account", workspace_id: "workspace" }] : [],
        rowCount: 1,
      };
    if (sql.includes("SELECT * FROM media_worker_enrollments"))
      return {
        rows: [
          {
            state: "PENDING",
            account_id: null,
            installation_id: "installation",
            display_name: "Mac",
            platform: "MACOS",
            architecture: "AARCH64",
            worker_version: "0.1.44",
            protocol_version: 1,
            execution_bundle_sha256: `sha256:${"a".repeat(64)}`,
          },
        ],
        rowCount: 1,
      };
    if (sql.includes("FROM media_worker_devices WHERE installation_id"))
      return {
        rows: state.ownerConflict
          ? [{ id: "other", status: "ONLINE", account_id: "foreign", workspace_id: "foreign" }]
          : [],
        rowCount: 0,
      };
    if (sql.includes("INSERT INTO media_worker_connect_commands"))
      return { rows: [{ expires_at: new Date(Date.now() + 900000).toISOString() }], rowCount: 1 };
    if (sql.includes("UPDATE media_worker_enrollments"))
      return { rows: [{ id: "enrollment" }], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  }
  return {
    ...actual,
    createNeonPool: () => ({
      query,
      connect: async () => ({ query, release() {} }),
      end: async () => {},
    }),
  };
});
const config = {
  publicOrigin: "https://app.example.test",
  neon: { databaseUrl: "unused" },
  mediaWorkerTokenSecret: "test-secret",
  mediaWorkerRelease: {
    version: "0.1.44",
    minimumProtocolVersion: 1,
    executionBundleSha256: `sha256:${"a".repeat(64)}`,
    macos: {
      url: "https://example.test/worker.dmg",
      sha256: `sha256:${"b".repeat(64)}`,
      sizeBytes: 42,
    },
    windows: {
      url: "https://example.test/worker.exe",
      sha256: `sha256:${"c".repeat(64)}`,
      sizeBytes: 43,
    },
  },
} as HostedRuntimeConfiguration;
beforeEach(() => {
  state.calls = [];
  state.tokenValid = true;
  state.ownerConflict = false;
  state.signedIn = true;
  state.deviceAuthorized = true;
  state.sameAccount = true;
  state.ready = true;
  state.busy = false;
});
const enroll = () =>
  new Request("https://app.example.test/api/v2/media-worker-enrollments", {
    method: "POST",
    headers: { "content-length": "700", "x-videoforge-connect-token": "d".repeat(64) },
    body: JSON.stringify({
      schema_version: "videoforge-media-worker-enrollment/v1",
      installation_id: "11111111-1111-4111-8111-111111111111",
      display_name: "Mac",
      platform: "MACOS",
      architecture: "AARCH64",
      worker_version: "0.1.44",
      protocol_version: 1,
      execution_bundle_sha256: `sha256:${"a".repeat(64)}`,
      pkce_challenge: "p".repeat(43),
    }),
  });
it("approves command enrollment and device in the same transaction", async () => {
  const response = await handlePersonalWorkerRequest(enroll(), {}, { waitUntil() {} }, config);
  expect(response?.status).toBe(201);
  expect(
    state.calls.filter((sql) => sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK"),
  ).toEqual(["BEGIN", "COMMIT"]);
  expect(state.calls.some((sql) => sql.includes("INSERT INTO media_worker_devices"))).toBe(true);
  expect(state.calls.findIndex((sql) => sql.includes("connect_consume"))).toBeLessThan(
    state.calls.findIndex((sql) => sql.includes("UPDATE media_worker_enrollments")),
  );
});
it.each(["expired", "foreign installation"])(
  "rolls back command and enrollment for %s",
  async (reason) => {
    state.tokenValid = reason !== "expired";
    state.ownerConflict = reason === "foreign installation";
    const response = await handlePersonalWorkerRequest(enroll(), {}, { waitUntil() {} }, config);
    expect(response?.status).toBe(409);
    expect(state.calls).toContain("ROLLBACK");
    expect(state.calls).not.toContain("COMMIT");
  },
);
it("requires same-origin signed-in command creation", async () => {
  const request = (origin: string) =>
    new Request("https://app.example.test/api/v2/media-worker/connect-command", {
      method: "POST",
      headers: { origin },
    });
  expect(
    (
      await handlePersonalWorkerRequest(
        request("https://foreign.test"),
        {},
        { waitUntil() {} },
        config,
      )
    )?.status,
  ).toBe(403);
  state.signedIn = false;
  expect(
    (
      await handlePersonalWorkerRequest(
        request(config.publicOrigin),
        {},
        { waitUntil() {} },
        config,
      )
    )?.status,
  ).toBe(401);
  state.signedIn = true;
  const response = await handlePersonalWorkerRequest(
    request(config.publicOrigin),
    {},
    { waitUntil() {} },
    config,
  );
  expect(response?.status).toBe(201);
  const commands = (await response?.json()) as { macos: string; windows: string };
  expect(commands).toMatchObject({
    macos: expect.stringContaining("bash -c 'script="),
    windows: expect.stringContaining("powershell.exe -NoProfile"),
  });
  // This outer command has no variables or quotes for CMD/parent PowerShell to expand.
  expect(commands.windows).toMatch(
    /^powershell\.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand [A-Za-z0-9+/]+=*$/u,
  );
  const decoded = Buffer.from(commands.windows.split(" ").at(-1)!, "base64").toString("utf16le");
  expect(decoded).toMatch(
    /^\$ErrorActionPreference='Stop'; \[Net\.ServicePointManager\]::SecurityProtocol=\[Net\.SecurityProtocolType\]::Tls12; \$s=\(Invoke-WebRequest -UseBasicParsing 'https:\/\/app\.example\.test\/api\/v2\/media-worker\/connect\.ps1\?token=[a-f0-9]{64}'\)\.Content; Invoke-Expression \$s$/u,
  );
});
it.runIf(process.platform !== "win32")(
  "does not execute a partially downloaded or expired connection script",
  async () => {
    const response = await handlePersonalWorkerRequest(
      new Request("https://app.example.test/api/v2/media-worker/connect-command", {
        method: "POST",
        headers: { origin: config.publicOrigin },
      }),
      {},
      { waitUntil() {} },
      config,
    );
    const commands = (await response?.json()) as { macos: string };
    const directory = mkdtempSync(join(tmpdir(), "vf-connect-download-"));
    const marker = join(directory, "executed");
    try {
      // Simulate curl writing executable bytes before a failed transfer.
      writeFileSync(
        join(directory, "curl"),
        `#!/bin/bash\nprintf '%s\\n' 'touch "${marker}"'\nexit 22\n`,
        { mode: 0o700 },
      );
      const result = spawnSync("/bin/bash", ["-c", commands.macos], {
        env: { ...process.env, PATH: `${directory}:/usr/bin:/bin`, TMPDIR: directory },
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Get a fresh command");
      expect(existsSync(marker)).toBe(false);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
it("installer scripts pin exact bytes/hash and reuse running workers without replacement", () => {
  for (const platform of ["MACOS", "WINDOWS"] as const) {
    const script = workerConnectScript(config, "d".repeat(64), platform);
    expect(script).not.toContain("@@");
    expect(script).toContain("--connect-file");
    expect(script).toContain(
      platform === "MACOS"
        ? "Connected and Online"
        : "Your existing worker is running; current work was preserved",
    );
    expect(script).not.toContain("Stop-Process");
    expect(script).not.toContain("pkill");
    expect(script).toContain(platform === "MACOS" ? "shasum -a 256" : "Get-FileHash");
  }
  expect(() => workerConnectScript(config, "'; touch /tmp/x; '", "MACOS")).toThrow("rejected");
});

const prepare = (running = true) =>
  handlePersonalWorkerRequest(
    new Request("https://app.example.test/api/v2/media-worker/connect-prepare", {
      method: "POST",
      headers: { authorization: `Bearer ${"e".repeat(64)}` },
      body: JSON.stringify({ token: "d".repeat(64), running }),
    }),
    {},
    { waitUntil() {} },
    config,
  );
it("reconnects the same online account without replacing its worker", async () => {
  const response = await prepare();
  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual({ action: "CONNECTED" });
  expect(
    state.calls.some(
      (sql) =>
        sql.includes("UPDATE media_worker_devices") ||
        sql.includes("INSERT INTO media_worker_connect_commands"),
    ),
  ).toBe(false);
});
it("switches an idle computer using a fresh enrollment while preserving old tenant history", async () => {
  state.sameAccount = false;
  const response = await prepare();
  expect(response?.status).toBe(200);
  expect(await response?.json()).toEqual({
    action: "SWITCH",
    token: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(state.calls.some((sql) => sql.includes("status='REVOKED'"))).toBe(true);
  expect(state.calls.some((sql) => sql.includes("INSERT INTO media_worker_events"))).toBe(true);
  expect(state.calls).toContain("COMMIT");
});
it.each(["busy", "expired"])("rolls back an account switch when %s", async (reason) => {
  state.sameAccount = false;
  state.busy = reason === "busy";
  state.tokenValid = reason !== "expired";
  const response = await prepare();
  expect(response?.status).toBe(409);
  expect(state.calls).toContain("ROLLBACK");
  expect(state.calls).not.toContain("COMMIT");
  expect(state.calls.some((sql) => sql.includes("UPDATE media_worker_devices"))).toBe(false);
});
it("requires the existing device credential as well as the new account command", async () => {
  state.deviceAuthorized = false;
  expect((await prepare())?.status).toBe(401);
  expect(state.calls.some((sql) => sql.includes("connect_consume"))).toBe(false);
});
it("reissues a same-account command for a stopped worker without revoking it", async () => {
  const response = await prepare(false);
  expect(await response?.json()).toEqual({
    action: "CONNECT",
    token: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(state.calls.some((sql) => sql.includes("UPDATE media_worker_devices"))).toBe(false);
});

it.runIf(process.platform !== "win32")(
  "keeps adjacent duplicate pastes as separate commands",
  async () => {
    const response = await handlePersonalWorkerRequest(
      new Request("https://app.example.test/api/v2/media-worker/connect-command", {
        method: "POST",
        headers: { origin: config.publicOrigin },
      }),
      {},
      { waitUntil() {} },
      config,
    );
    const commands = (await response?.json()) as { macos: string };
    const directory = mkdtempSync(join(tmpdir(), "vf-connect-paste-"));
    try {
      writeFileSync(join(directory, "curl"), '#!/bin/bash\nprintf "%s\\n" "echo bootstrap-ok"\n', {
        mode: 0o700,
      });
      const result = spawnSync("/bin/bash", ["-c", commands.macos + commands.macos], {
        env: { ...process.env, PATH: `${directory}:/usr/bin:/bin` },
        encoding: "utf8",
      });
      expect(result.status).toBe(0);
      expect(result.stdout.trim().split("\n")).toEqual(["bootstrap-ok", "bootstrap-ok"]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
