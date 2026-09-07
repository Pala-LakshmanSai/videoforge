import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  V209_CHROME_BOOTSTRAP_RECEIPT_SCHEMA,
  V209_CHROME_BOOTSTRAP_SCHEMA,
  materializeV209ChromeBootstrap,
} from "./chrome-production-bootstrap.mjs";

function harness(overrides = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "v209-chrome-bootstrap-"));
  const secure = resolve(root, "secure");
  mkdirSync(secure, { mode: 0o700 });
  const voiceoverPath = resolve(secure, "acceptance.wav");
  writeFileSync(voiceoverPath, Buffer.from("deterministic spoken fixture"), { mode: 0o600 });
  const calls = [];
  const configuration = {
    schemaVersion: V209_CHROME_BOOTSTRAP_SCHEMA,
    productionOrigin: "https://video.example.test",
    authStatePath: resolve(secure, "chrome-auth.json"),
    chromeRequestPath: resolve(secure, "chrome-request.json"),
    voiceoverPath,
    verifiedOutputPath: resolve(secure, "verified.mp4"),
    title: "V2-09 production acceptance",
    spendCapUsd: 2,
    stopAt: "2026-09-08T01:00:00.000Z",
    maxProgressReads: 720,
    pollIntervalMs: 1_000,
    loginTimeoutMs: 300_000,
    ...overrides,
  };
  const facts = [
    {
      schema_version: "videoforge-hosted-tenant/v1",
      account_id: "11111111-1111-4111-8111-111111111111",
      workspace_id: "22222222-2222-4222-8222-222222222222",
    },
    {
      avatars: [
        { version_id: "avatar-z", state: "READY", status: "ACTIVE" },
        { version_id: "avatar-a", state: "READY", status: "ACTIVE" },
        { version_id: "avatar-draft", state: "DRAFT", status: "ACTIVE" },
      ],
      styles: [
        { version_id: "style-z", state: "PUBLISHED", status: "ACTIVE" },
        { version_id: "style-a", state: "PUBLISHED", status: "ACTIVE" },
      ],
    },
  ];
  const page = {
    goto: async (url) => calls.push(["goto", url]),
    waitForURL: async (pattern, options) => calls.push(["waitForURL", pattern, options]),
    evaluate: async () => facts,
    close: async () => calls.push(["page.close"]),
  };
  const context = {
    newPage: async () => page,
    storageState: async ({ path }) => {
      calls.push(["storageState", path]);
      writeFileSync(path, '{"cookies":[{"name":"session","value":"opaque"}],"origins":[]}');
    },
    close: async () => calls.push(["context.close"]),
  };
  const browser = {
    newContext: async (options) => {
      calls.push(["newContext", options]);
      return context;
    },
    close: async () => calls.push(["browser.close"]),
  };
  return {
    root,
    secure,
    calls,
    facts,
    configuration,
    dependencies: {
      launch: async () => browser,
      probeVoiceover: async () => 45_000,
    },
  };
}

test("interactive login materializes auth and a deterministic request without Generate", async () => {
  const value = harness();
  const receipt = await materializeV209ChromeBootstrap(value.configuration, value.dependencies);
  assert.equal(receipt.schema_version, V209_CHROME_BOOTSTRAP_RECEIPT_SCHEMA);
  assert.equal(receipt.generate_clicks, 0);
  assert.equal(receipt.interactive_login_only, true);
  assert.match(receipt.auth_state_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.match(receipt.chrome_request_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(statSync(value.configuration.authStatePath).mode & 0o777, 0o600);
  assert.equal(statSync(value.configuration.chromeRequestPath).mode & 0o777, 0o600);
  const request = JSON.parse(readFileSync(value.configuration.chromeRequestPath, "utf8"));
  assert.equal(request.request.accountId, value.facts[0].account_id);
  assert.equal(request.request.workspaceId, value.facts[0].workspace_id);
  assert.equal(request.request.prepared.avatarProfileVersionId, "avatar-a");
  assert.equal(request.request.prepared.imageStyleVersionId, "style-a");
  assert.equal(request.request.prepared.voiceoverDurationMs, 45_000);
  assert.equal(request.request.prepared.voiceoverContentType, "audio/wav");
  assert.equal(
    value.calls.some(([name]) => /click|generate/iu.test(name)),
    false,
  );
  assert.deepEqual(
    value.calls.filter(([name]) => name === "storageState").map(([name]) => name),
    ["storageState"],
  );
});

test("unavailable interactive authentication fails closed and removes owned empty outputs", async () => {
  const value = harness();
  value.dependencies.launch = async () => ({
    newContext: async () => ({
      newPage: async () => ({
        goto: async () => undefined,
        waitForURL: async () => {
          throw new Error("login timed out");
        },
        close: async () => undefined,
      }),
      close: async () => undefined,
    }),
    close: async () => undefined,
  });
  await assert.rejects(
    materializeV209ChromeBootstrap(value.configuration, value.dependencies),
    /V2_09_CHROME_BOOTSTRAP_AUTH_UNAVAILABLE/u,
  );
  assert.throws(() => statSync(value.configuration.authStatePath));
  assert.throws(() => statSync(value.configuration.chromeRequestPath));
});

test("invalid voiceover duration fails before Chrome launch", async () => {
  const value = harness();
  let launches = 0;
  value.dependencies.probeVoiceover = async () => 29_999;
  value.dependencies.launch = async () => {
    launches += 1;
    throw new Error("must not launch");
  };
  await assert.rejects(
    materializeV209ChromeBootstrap(value.configuration, value.dependencies),
    /V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID/u,
  );
  assert.equal(launches, 0);
});

test("existing protected output is never overwritten", async () => {
  const value = harness();
  writeFileSync(value.configuration.authStatePath, "existing", { mode: 0o600 });
  await assert.rejects(
    materializeV209ChromeBootstrap(value.configuration, value.dependencies),
    /V2_09_CHROME_BOOTSTRAP_OUTPUT_EXISTS/u,
  );
  assert.equal(readFileSync(value.configuration.authStatePath, "utf8"), "existing");
});

test("malformed deadline is rejected with a bounded code before file or browser work", async () => {
  const value = harness({ stopAt: "not-an-instant" });
  let launches = 0;
  value.dependencies.launch = async () => {
    launches += 1;
    throw new Error("must not launch");
  };
  await assert.rejects(
    materializeV209ChromeBootstrap(value.configuration, value.dependencies),
    /V2_09_CHROME_BOOTSTRAP_CONFIGURATION_INVALID/u,
  );
  assert.equal(launches, 0);
});
