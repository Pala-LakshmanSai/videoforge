import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import {
  V209_CHROME_BOOTSTRAP_RECEIPT_SCHEMA,
  V209_CHROME_BOOTSTRAP_SCHEMA,
  V209_CHROME_REQUEST_SCOPE_SCHEMA,
  V209_POST_DEPLOY_CHROME_AUTH_SCHEMA,
  materializeV209ChromeBootstrap,
  materializeV209ChromeRequestScope,
  materializeV209PostDeployChromeAuth,
  validateV209ChromePreclaimInputs,
  validateV209ChromeVoiceoverMedia,
  validateV209PostDeployChromeAuthReceipt,
} from "./chrome-production-bootstrap.mjs";

const STATIC_SCOPE_STOP_AT = "2026-09-08T01:00:00.000Z";
const BOOTSTRAP_NOW = new Date("2026-09-07T10:00:00.000Z");
const BOOTSTRAP_STOP_AT = "2026-09-07T10:27:40.000Z";

function pcmWav(durationMs) {
  const sampleRate = 48_000;
  const dataBytes = Math.round((sampleRate * 2 * durationMs) / 1_000);
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write("WAVEfmt ", 8, "ascii");
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(1, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * 2, 28);
  bytes.writeUInt16LE(2, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36, "ascii");
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
}

function harness(overrides = {}) {
  const root = mkdtempSync(resolve(tmpdir(), "v209-chrome-bootstrap-"));
  const secure = resolve(root, "secure");
  mkdirSync(secure, { mode: 0o700 });
  const wranglerHome = resolve(secure, "wrangler-home");
  mkdirSync(wranglerHome, { mode: 0o700 });
  const voiceoverPath = resolve(secure, "acceptance.wav");
  const voiceoverBytes = Buffer.from("deterministic spoken fixture");
  writeFileSync(voiceoverPath, voiceoverBytes, { mode: 0o600 });
  const voiceoverSha256 = `sha256:${createHash("sha256").update(voiceoverBytes).digest("hex")}`;
  const calls = [];
  const configuration = {
    schemaVersion: V209_CHROME_BOOTSTRAP_SCHEMA,
    productionOrigin: "https://video.example.test",
    authStatePath: resolve(secure, "chrome-auth.json"),
    chromeRequestPath: resolve(secure, "chrome-request.json"),
    voiceoverPath,
    verifiedOutputPath: resolve(secure, "verified.mp4"),
    title: "V2-09 production acceptance",
    successHorizonSeconds: 1_660,
    maxProgressReads: 720,
    pollIntervalMs: 1_000,
    loginTimeoutMs: 300_000,
    voiceoverSha256,
    voiceoverDurationMs: 45_000,
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
    productionConfiguration: {
      cloudflare: {
        environment: {
          WRANGLER_HOME: wranglerHome,
          XDG_CONFIG_HOME: wranglerHome,
        },
      },
    },
    dependencies: {
      launch: async () => browser,
      probeVoiceover: async () => 45_000,
      now: () => new Date(BOOTSTRAP_NOW),
      authorityExpiresAt: "2026-09-08T01:00:00.000Z",
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
  assert.equal(request.request.stopAt, BOOTSTRAP_STOP_AT);
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
    /V2_09_CHROME_BOOTSTRAP_AWAITING_INTERACTIVE_CHROME_LOGIN/u,
  );
  assert.throws(() => statSync(value.configuration.authStatePath));
  assert.throws(() => statSync(value.configuration.chromeRequestPath));
});

test("request scope binds before deployment without opening Chrome or creating auth state", async () => {
  const value = harness();
  let launches = 0;
  const scope = {
    schemaVersion: V209_CHROME_REQUEST_SCOPE_SCHEMA,
    productionOrigin: value.configuration.productionOrigin,
    authStatePath: value.configuration.authStatePath,
    chromeRequestPath: value.configuration.chromeRequestPath,
    voiceoverPath: value.configuration.voiceoverPath,
    verifiedOutputPath: value.configuration.verifiedOutputPath,
    title: value.configuration.title,
    stopAt: STATIC_SCOPE_STOP_AT,
    maxProgressReads: value.configuration.maxProgressReads,
    pollIntervalMs: value.configuration.pollIntervalMs,
    accountId: value.facts[0].account_id,
    workspaceId: value.facts[0].workspace_id,
    avatarProfileVersionId: "avatar-a",
    imageStyleVersionId: "style-a",
  };
  const receipt = await materializeV209ChromeRequestScope(scope, {
    probeVoiceover: async () => 45_000,
    launch: async () => {
      launches += 1;
      throw new Error("must not launch");
    },
  });
  assert.equal(receipt.status, "REQUEST_SCOPE_BOUND_AWAITING_POST_DEPLOY_AUTH");
  assert.equal(receipt.auth_state_created, false);
  assert.equal(receipt.generate_clicks, 0);
  assert.equal(launches, 0);
  assert.throws(() => statSync(scope.authStatePath));
  assert.equal(statSync(scope.chromeRequestPath).mode & 0o777, 0o600);
});

test("post-deploy authentication matches bound tenant and presets without Generate", async () => {
  const value = harness();
  const scope = {
    schemaVersion: V209_CHROME_REQUEST_SCOPE_SCHEMA,
    productionOrigin: value.configuration.productionOrigin,
    authStatePath: value.configuration.authStatePath,
    chromeRequestPath: value.configuration.chromeRequestPath,
    voiceoverPath: value.configuration.voiceoverPath,
    verifiedOutputPath: value.configuration.verifiedOutputPath,
    title: value.configuration.title,
    stopAt: STATIC_SCOPE_STOP_AT,
    maxProgressReads: value.configuration.maxProgressReads,
    pollIntervalMs: value.configuration.pollIntervalMs,
    accountId: value.facts[0].account_id,
    workspaceId: value.facts[0].workspace_id,
    avatarProfileVersionId: "avatar-a",
    imageStyleVersionId: "style-a",
  };
  const scoped = await materializeV209ChromeRequestScope(scope, {
    probeVoiceover: async () => 45_000,
  });
  const receipt = await materializeV209PostDeployChromeAuth(
    {
      schemaVersion: V209_POST_DEPLOY_CHROME_AUTH_SCHEMA,
      productionOrigin: scope.productionOrigin,
      authStatePath: scope.authStatePath,
      chromeRequestPath: scope.chromeRequestPath,
      chromeRequestSha256: scoped.chrome_request_sha256,
      loginTimeoutMs: 300_000,
    },
    value.dependencies,
  );
  assert.equal(receipt.status, "AUTHENTICATED_READY_FOR_ONE_E2E");
  assert.equal(receipt.chrome_request_sha256, scoped.chrome_request_sha256);
  assert.equal(receipt.post_deploy_authentication, true);
  assert.equal(receipt.generate_clicks, 0);
  assert.equal(statSync(scope.authStatePath).mode & 0o777, 0o600);
  assert.equal(
    validateV209PostDeployChromeAuthReceipt(receipt, {
      authStatePath: scope.authStatePath,
      chromeRequestSha256: scoped.chrome_request_sha256,
    }).status,
    "AUTHENTICATED_READY_FOR_ONE_E2E",
  );
  assert.throws(
    () =>
      validateV209PostDeployChromeAuthReceipt(
        { ...receipt, chrome_request_sha256: `sha256:${"0".repeat(64)}` },
        {
          authStatePath: scope.authStatePath,
          chromeRequestSha256: scoped.chrome_request_sha256,
        },
      ),
    /V2_09_CHROME_BOOTSTRAP_AUTH_RECEIPT_INVALID/u,
  );
});

test("post-deploy login timeout is explicitly resumable and leaves the request bound", async () => {
  const value = harness();
  const scope = {
    schemaVersion: V209_CHROME_REQUEST_SCOPE_SCHEMA,
    productionOrigin: value.configuration.productionOrigin,
    authStatePath: value.configuration.authStatePath,
    chromeRequestPath: value.configuration.chromeRequestPath,
    voiceoverPath: value.configuration.voiceoverPath,
    verifiedOutputPath: value.configuration.verifiedOutputPath,
    title: value.configuration.title,
    stopAt: STATIC_SCOPE_STOP_AT,
    maxProgressReads: value.configuration.maxProgressReads,
    pollIntervalMs: value.configuration.pollIntervalMs,
    accountId: value.facts[0].account_id,
    workspaceId: value.facts[0].workspace_id,
    avatarProfileVersionId: "avatar-a",
    imageStyleVersionId: "style-a",
  };
  const scoped = await materializeV209ChromeRequestScope(scope, {
    probeVoiceover: async () => 45_000,
  });
  const unavailable = harness();
  unavailable.dependencies.launch = async () => ({
    newContext: async () => ({
      newPage: async () => ({
        goto: async () => undefined,
        waitForURL: async () => {
          throw new Error("login timeout");
        },
        close: async () => undefined,
      }),
      close: async () => undefined,
    }),
    close: async () => undefined,
  });
  let observed;
  try {
    await materializeV209PostDeployChromeAuth(
      {
        schemaVersion: V209_POST_DEPLOY_CHROME_AUTH_SCHEMA,
        productionOrigin: scope.productionOrigin,
        authStatePath: scope.authStatePath,
        chromeRequestPath: scope.chromeRequestPath,
        chromeRequestSha256: scoped.chrome_request_sha256,
        loginTimeoutMs: 300_000,
      },
      unavailable.dependencies,
    );
  } catch (error) {
    observed = error;
  }
  assert.equal(observed?.code, "V2_09_CHROME_BOOTSTRAP_AWAITING_INTERACTIVE_CHROME_LOGIN");
  assert.equal(observed?.resumable, true);
  assert.equal(statSync(scope.chromeRequestPath).isFile(), true);
  assert.throws(() => statSync(scope.authStatePath));
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

test("full bootstrap plans require the bound voiceover fields and no extra keys", async () => {
  const missing = harness();
  delete missing.configuration.voiceoverSha256;
  await assert.rejects(
    materializeV209ChromeBootstrap(missing.configuration, missing.dependencies),
    /V2_09_CHROME_BOOTSTRAP_CONFIGURATION_INVALID/u,
  );

  const extra = harness({ unexpected: true });
  await assert.rejects(
    materializeV209ChromeBootstrap(extra.configuration, extra.dependencies),
    /V2_09_CHROME_BOOTSTRAP_CONFIGURATION_INVALID/u,
  );
});

test("preclaim validator accepts the exact local voiceover and Wrangler directories without writes", async () => {
  const value = harness();
  let probes = 0;
  const receipt = await validateV209ChromePreclaimInputs(
    value.configuration,
    value.productionConfiguration,
    {
      probeVoiceover: async (bytes, identity) => {
        probes += 1;
        assert.equal(identity.sha256, value.configuration.voiceoverSha256);
        assert.equal(bytes.length, statSync(value.configuration.voiceoverPath).size);
        return 45_000;
      },
      launch: async () => {
        throw new Error("must not launch Chrome");
      },
    },
  );
  assert.equal(receipt.schema_version, "videoforge.v2-09-chrome-preclaim-inputs/v1");
  assert.equal(receipt.voiceover_sha256, value.configuration.voiceoverSha256);
  assert.equal(receipt.voiceover_duration_ms, 45_000);
  assert.equal(
    receipt.wrangler_home,
    value.productionConfiguration.cloudflare.environment.WRANGLER_HOME,
  );
  assert.equal(
    receipt.xdg_config_home,
    value.productionConfiguration.cloudflare.environment.XDG_CONFIG_HOME,
  );
  assert.equal(probes, 1);
  assert.throws(() => statSync(value.configuration.authStatePath));
  assert.throws(() => statSync(value.configuration.chromeRequestPath));
});

test("production ffprobe derives exact duration from a streamed WAV snapshot", async () => {
  const value = harness();
  const voiceover = pcmWav(30_000);
  writeFileSync(value.configuration.voiceoverPath, voiceover, { mode: 0o600 });
  value.configuration.voiceoverSha256 = `sha256:${createHash("sha256")
    .update(voiceover)
    .digest("hex")}`;
  value.configuration.voiceoverDurationMs = 30_000;
  const receipt = await validateV209ChromePreclaimInputs(
    value.configuration,
    value.productionConfiguration,
  );
  assert.equal(receipt.voiceover_duration_ms, 30_000);
  assert.equal(receipt.voiceover_sha256, value.configuration.voiceoverSha256);
});

test("preclaim validator binds the staged voiceover hash and exact ffprobe duration", async () => {
  const hashMismatch = harness({ voiceoverSha256: `sha256:${"0".repeat(64)}` });
  let probes = 0;
  await assert.rejects(
    validateV209ChromePreclaimInputs(
      hashMismatch.configuration,
      hashMismatch.productionConfiguration,
      {
        probeVoiceover: async () => {
          probes += 1;
          return 45_000;
        },
      },
    ),
    /V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID/u,
  );
  assert.equal(probes, 0);

  const durationMismatch = harness({ voiceoverDurationMs: 45_001 });
  await assert.rejects(
    validateV209ChromePreclaimInputs(
      durationMismatch.configuration,
      durationMismatch.productionConfiguration,
      { probeVoiceover: async () => 45_000 },
    ),
    /V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID/u,
  );
});

test("preclaim validator rejects unsupported voiceover extensions and oversized media", async () => {
  const flac = harness();
  const flacPath = resolve(flac.secure, "acceptance.flac");
  writeFileSync(flacPath, readFileSync(flac.configuration.voiceoverPath), { mode: 0o600 });
  flac.configuration.voiceoverPath = flacPath;
  await assert.rejects(
    validateV209ChromePreclaimInputs(
      flac.configuration,
      flac.productionConfiguration,
      { probeVoiceover: async () => 45_000 },
    ),
    /V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID/u,
  );

  assert.throws(
    () =>
      validateV209ChromeVoiceoverMedia(
        "/private/acceptance.wav",
        { length: 1_073_741_825 },
        45_000,
      ),
    /V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID/u,
  );
});

test("preclaim validator requires the exact nested Cloudflare environment contract", async () => {
  const missingNested = harness();
  missingNested.productionConfiguration.environment = {
    WRANGLER_HOME: missingNested.secure,
    XDG_CONFIG_HOME: missingNested.secure,
  };
  delete missingNested.productionConfiguration.cloudflare.environment;
  await assert.rejects(
    validateV209ChromePreclaimInputs(
      missingNested.configuration,
      missingNested.productionConfiguration,
      { probeVoiceover: async () => 45_000 },
    ),
    /V2_09_CHROME_BOOTSTRAP_WRANGLER_HOME_INVALID/u,
  );

  const missingKey = harness();
  delete missingKey.productionConfiguration.cloudflare.environment.XDG_CONFIG_HOME;
  await assert.rejects(
    validateV209ChromePreclaimInputs(
      missingKey.configuration,
      missingKey.productionConfiguration,
      { probeVoiceover: async () => 45_000 },
    ),
    /V2_09_CHROME_BOOTSTRAP_WRANGLER_HOME_INVALID/u,
  );

  const extra = harness();
  extra.productionConfiguration.cloudflare.environment.EXTRA = "unexpected";
  await assert.rejects(
    validateV209ChromePreclaimInputs(
      extra.configuration,
      extra.productionConfiguration,
      { probeVoiceover: async () => 45_000 },
    ),
    /V2_09_CHROME_BOOTSTRAP_WRANGLER_HOME_INVALID/u,
  );

  const nonString = harness();
  nonString.productionConfiguration.cloudflare.environment.PATH = null;
  await assert.rejects(
    validateV209ChromePreclaimInputs(
      nonString.configuration,
      nonString.productionConfiguration,
      { probeVoiceover: async () => 45_000 },
    ),
    /V2_09_CHROME_BOOTSTRAP_WRANGLER_HOME_INVALID/u,
  );
});

test("preclaim validator rejects non-private voiceover files and Wrangler directories", async () => {
  const voiceoverMode = harness();
  chmodSync(voiceoverMode.configuration.voiceoverPath, 0o644);
  await assert.rejects(
    validateV209ChromePreclaimInputs(
      voiceoverMode.configuration,
      voiceoverMode.productionConfiguration,
      { probeVoiceover: async () => 45_000 },
    ),
    /V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID/u,
  );

  const wranglerMode = harness();
  chmodSync(wranglerMode.productionConfiguration.cloudflare.environment.WRANGLER_HOME, 0o755);
  await assert.rejects(
    validateV209ChromePreclaimInputs(
      wranglerMode.configuration,
      wranglerMode.productionConfiguration,
      { probeVoiceover: async () => 45_000 },
    ),
    /V2_09_CHROME_BOOTSTRAP_WRANGLER_HOME_INVALID/u,
  );

  const wranglerAlias = harness();
  const alias = resolve(wranglerAlias.root, "wrangler-alias");
  symlinkSync(wranglerAlias.productionConfiguration.cloudflare.environment.WRANGLER_HOME, alias);
  wranglerAlias.productionConfiguration.cloudflare.environment.XDG_CONFIG_HOME = alias;
  await assert.rejects(
    validateV209ChromePreclaimInputs(
      wranglerAlias.configuration,
      wranglerAlias.productionConfiguration,
      { probeVoiceover: async () => 45_000 },
    ),
    /V2_09_CHROME_BOOTSTRAP_WRANGLER_HOME_INVALID/u,
  );
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

test("arbitrary static or extended bootstrap horizons are rejected before browser work", async () => {
  const value = harness({ successHorizonSeconds: 1_661 });
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

test("dynamic deadline requires the full sealed horizon before auth or request completion", async () => {
  for (const authorityExpiresAt of ["2026-09-07T10:27:39.999Z", "2026-09-07T10:13:19.999Z"]) {
    const short = harness();
    short.dependencies.authorityExpiresAt = authorityExpiresAt;
    await assert.rejects(
      materializeV209ChromeBootstrap(short.configuration, short.dependencies),
      /V2_09_CHROME_BOOTSTRAP_AUTHORITY_EXPIRY_INVALID/u,
    );
    assert.throws(() => statSync(short.configuration.authStatePath));
    assert.throws(() => statSync(short.configuration.chromeRequestPath));
  }

  const exact = harness();
  exact.dependencies.authorityExpiresAt = BOOTSTRAP_STOP_AT;
  await materializeV209ChromeBootstrap(exact.configuration, exact.dependencies);
  const request = JSON.parse(readFileSync(exact.configuration.chromeRequestPath, "utf8"));
  assert.equal(request.request.stopAt, BOOTSTRAP_STOP_AT);
});

test("an adopted request keeps its earlier bounded deadline without extending it", async () => {
  const value = harness();
  await materializeV209ChromeBootstrap(value.configuration, value.dependencies);
  value.dependencies.now = () => new Date("2026-09-07T10:01:00.000Z");
  const request = JSON.parse(readFileSync(value.configuration.chromeRequestPath, "utf8"));
  assert.equal(request.request.stopAt, BOOTSTRAP_STOP_AT);
  const receipt = await materializeV209ChromeBootstrap(value.configuration, value.dependencies);
  assert.equal(receipt.status, "AUTHENTICATED_READY_FOR_ONE_E2E");

  value.dependencies.now = () => new Date("2026-09-07T10:14:20.001Z");
  await assert.rejects(
    materializeV209ChromeBootstrap(value.configuration, value.dependencies),
    /V2_09_CHROME_BOOTSTRAP_EXECUTION_WINDOW_INVALID/u,
  );
});

test("interactive pause can resume hours later with a fresh bounded success horizon", async () => {
  const value = harness();
  const successfulLaunch = value.dependencies.launch;
  value.dependencies.launch = async () => ({
    newContext: async () => ({
      newPage: async () => ({
        goto: async () => undefined,
        waitForURL: async () => {
          const error = new Error("timed out");
          error.name = "TimeoutError";
          throw error;
        },
        close: async () => undefined,
      }),
      close: async () => undefined,
    }),
    close: async () => undefined,
  });
  await assert.rejects(
    materializeV209ChromeBootstrap(value.configuration, value.dependencies),
    /V2_09_CHROME_BOOTSTRAP_AWAITING_INTERACTIVE_CHROME_LOGIN/u,
  );

  value.dependencies.launch = successfulLaunch;
  value.dependencies.now = () => new Date("2026-09-07T22:00:00.000Z");
  value.dependencies.authorityExpiresAt = "2026-09-08T05:32:10.000Z";
  await materializeV209ChromeBootstrap(value.configuration, value.dependencies);
  const request = JSON.parse(readFileSync(value.configuration.chromeRequestPath, "utf8"));
  assert.equal(request.request.stopAt, "2026-09-07T22:27:40.000Z");
});

test("voiceover probing and request hashing use one stable descriptor snapshot", async () => {
  const value = harness();
  const original = readFileSync(value.configuration.voiceoverPath);
  const expected = `sha256:${createHash("sha256").update(original).digest("hex")}`;
  value.dependencies.probeVoiceover = async (bytes, identity) => {
    assert.equal(identity.sha256, expected);
    assert.deepEqual(bytes, original);
    writeFileSync(value.configuration.voiceoverPath, "replaced pathname bytes", { mode: 0o600 });
    return 45_000;
  };
  const receipt = await materializeV209ChromeBootstrap(value.configuration, value.dependencies);
  const request = JSON.parse(readFileSync(value.configuration.chromeRequestPath, "utf8"));
  assert.equal(receipt.voiceover_sha256, expected);
  assert.equal(request.request.prepared.voiceoverSha256, expected);
  assert.equal(request.request.prepared.voiceoverContentLength, original.length);
});

test("arbitrary browser operational failures are terminal, never resumable login pauses", async () => {
  const value = harness();
  value.dependencies.launch = async () => {
    throw new Error("browser binary damaged");
  };
  let observed;
  try {
    await materializeV209ChromeBootstrap(value.configuration, value.dependencies);
  } catch (error) {
    observed = error;
  }
  assert.equal(observed?.message, "V2_09_CHROME_BOOTSTRAP_BROWSER_OPERATION_FAILED");
  assert.notEqual(observed?.resumable, true);
});

test("a non-timeout navigation failure is terminal rather than awaiting login", async () => {
  const value = harness();
  value.dependencies.launch = async () => ({
    newContext: async () => ({
      newPage: async () => ({
        goto: async () => undefined,
        waitForURL: async () => {
          throw new Error("browser target closed");
        },
        close: async () => undefined,
      }),
      close: async () => undefined,
    }),
    close: async () => undefined,
  });
  let observed;
  try {
    await materializeV209ChromeBootstrap(value.configuration, value.dependencies);
  } catch (error) {
    observed = error;
  }
  assert.equal(observed?.message, "V2_09_CHROME_BOOTSTRAP_LOGIN_NAVIGATION_FAILED");
  assert.notEqual(observed?.resumable, true);
});

test("a completed browser auth write is claim-bound and adopted after receipt crash", async () => {
  const value = harness();
  value.dependencies.launch = async () => ({
    newContext: async () => ({
      newPage: async () => ({
        goto: async () => undefined,
        waitForURL: async () => undefined,
        evaluate: async () => value.facts,
        close: async () => undefined,
      }),
      storageState: async ({ path }) => {
        writeFileSync(path, '{"cookies":[{"name":"session","value":"opaque"}],"origins":[]}');
        throw new Error("simulated crash after browser write");
      },
      close: async () => undefined,
    }),
    close: async () => undefined,
  });
  await assert.rejects(
    materializeV209ChromeBootstrap(value.configuration, value.dependencies),
    /V2_09_CHROME_BOOTSTRAP_AUTH_WRITE_FAILED/u,
  );
  assert.throws(() => statSync(value.configuration.authStatePath));
  const resumed = harness();
  resumed.configuration = value.configuration;
  resumed.facts = value.facts;
  let storageWrites = 0;
  const standard = resumed.dependencies.launch;
  resumed.dependencies.launch = async () => {
    const browser = await standard();
    const originalNewContext = browser.newContext;
    browser.newContext = async (options) => {
      assert.equal(options.storageState, value.configuration.authStatePath);
      const context = await originalNewContext(options);
      const originalStorage = context.storageState;
      context.storageState = async (input) => {
        storageWrites += 1;
        return originalStorage(input);
      };
      return context;
    };
    return browser;
  };
  const receipt = await materializeV209ChromeBootstrap(value.configuration, resumed.dependencies);
  assert.equal(receipt.status, "AUTHENTICATED_READY_FOR_ONE_E2E");
  assert.equal(storageWrites, 0);
  assert.equal(statSync(value.configuration.authStatePath).mode & 0o777, 0o600);
});
