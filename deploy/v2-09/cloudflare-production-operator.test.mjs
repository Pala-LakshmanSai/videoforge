import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { hashV213DryOutputBundle } from "../v2-13/full-live-adapters.mjs";
import { APPROVED_WRANGLER_OAUTH_SCOPES, SECRET_NAMES } from "../v2-13/guarded-activation.mjs";
import {
  ACTIVATED_ASSETS_PATH,
  ACTIVATED_MAIN_PATH,
  parseProductionConfig,
} from "../v2-13/validate-production-config.mjs";
import {
  createV209CloudflareProductionOperator,
  planV209CloudflareProduction,
} from "./cloudflare-production-operator.mjs";

const ROOT = resolve(new URL("../..", import.meta.url).pathname);
const SOURCE = "a".repeat(40);
const VERSION_IDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
  "55555555-5555-4555-8555-555555555555",
];
const hash = (value) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const canonical = (value) => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};

function bundleSha256() {
  const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v209-cf-bundle-test-"));
  writeFileSync(resolve(directory, "index.js"), "fixture-exact-worker-bundle\n");
  return hashV213DryOutputBundle(directory);
}

function fixture() {
  const directory = mkdtempSync(resolve(tmpdir(), "videoforge-v209-cf-operator-test-"));
  chmodSync(directory, 0o700);
  const file = (name, value) => {
    const path = resolve(directory, name);
    writeFileSync(path, value, { mode: 0o600 });
    return path;
  };
  const qualified = parseProductionConfig(
    readFileSync(resolve(ROOT, "apps/web/wrangler.production.jsonc"), "utf8"),
  );
  qualified.account_id = "1".repeat(32);
  qualified.main = ACTIVATED_MAIN_PATH;
  qualified.assets.directory = ACTIVATED_ASSETS_PATH;
  qualified.r2_buckets[0].bucket_name = "videoforge-assets";
  qualified.workflows[0].name = "videoforge-video";
  qualified.workflows[1].name = "videoforge-video-pair";
  Object.assign(qualified.vars, {
    VIDEOFORGE_COMMIT: SOURCE,
    VIDEOFORGE_ENVIRONMENT: "production",
    VIDEOFORGE_PROVIDER_MODE: "production",
    VIDEOFORGE_GPU_TRANSPORT: "QUALIFIED_EXACT",
    VIDEOFORGE_PUBLIC_ORIGIN: "https://videoforge-production-runtime.account-subdomain.workers.dev",
    R2_ACCOUNT_ID: qualified.account_id,
    VIDEOFORGE_R2_BUCKET_NAME: qualified.r2_buckets[0].bucket_name,
    VIDEOFORGE_R2_REGION: "auto",
    MEDIA_WORKER_RELEASE_MANIFEST_JSON: JSON.stringify({
      schema_version: "videoforge-media-worker-release/v1",
      version: "0.1.15",
      minimum_protocol_version: 1,
      execution_bundle_sha256: hash("execution"),
      whisper_model_sha256: hash("model"),
      windows: {
        url: "https://downloads.videoforge.example/worker.exe",
        sha256: hash("windows"),
        size_bytes: 1024,
        trust: "AUTHENTICODE_SIGNED",
      },
      macos: {
        url: "https://downloads.videoforge.example/worker.dmg",
        sha256: hash("macos"),
        size_bytes: 2048,
        trust: "DEVELOPER_ID_NOTARIZED",
      },
    }),
  });
  const qualifiedConfigPath = file("qualified.json", `${JSON.stringify(qualified, null, 2)}\n`);
  return {
    directory,
    configuration: {
      root: ROOT,
      sourceCommit: SOURCE,
      workerName: "videoforge-production-runtime",
      qualifiedConfigPath,
      disabledConfigPath: resolve(directory, "disabled.json"),
      bootstrapConfigPath: resolve(directory, "bootstrap.json"),
      journalPath: resolve(directory, "journal.json"),
      oauthConfigPath: file("oauth.json", "{}"),
      expectedOauthScopes: APPROVED_WRANGLER_OAUTH_SCOPES,
      secretFiles: Object.fromEntries(
        SECRET_NAMES.map((name) => [name, file(`secret-${name}`, `fixture-${name}`)]),
      ),
      environment: { CI: "1" },
    },
    qualified,
    configSha256: hash(readFileSync(qualifiedConfigPath)),
    workerBundleSha256: bundleSha256(),
  };
}

function authority(value) {
  return {
    authority_id: "v2-09-cloudflare-test-authority",
    proposal_sha256: hash("proposal"),
    source_commit: SOURCE,
    issued_at: "2026-09-06T21:00:00Z",
    expires_at: "2026-09-06T23:00:00Z",
    production: {
      worker_name: "videoforge-production-runtime",
      config_sha256: value.configSha256,
      worker_bundle_sha256: value.workerBundleSha256,
      secret_allowlist_sha256: hash(canonical([...SECRET_NAMES].sort())),
      secret_count: SECRET_NAMES.length,
    },
    scope: {
      cleanup_only_recovery: true,
      allow_redispatch: false,
      operations: ["reconcile-v209-production-safety"],
    },
  };
}

function harness(
  value,
  { failQualifiedOnce = false, mutateVersionOnce, wrongRouteVersion = false } = {},
) {
  const calls = [];
  const apiCalls = [];
  const sequence = [];
  const secrets = new Set();
  let activeConfig = null;
  let activeVersion = VERSION_IDS[0];
  let deployCount = 0;
  let shouldFailQualified = failQualifiedOnce;
  let shouldMutateVersion = typeof mutateVersionOnce === "function";
  const runChild = async (input) => {
    calls.push(input);
    sequence.push({ kind: "wrangler", args: input.args.slice(4) });
    const args = input.args.slice(4);
    if (args[0] === "deploy" && args.includes("--dry-run")) {
      const output = args[args.indexOf("--outdir") + 1];
      mkdirSync(output, { recursive: true });
      writeFileSync(resolve(output, "index.js"), "fixture-exact-worker-bundle\n");
      return { status: 0, signal: null, stdout: "", stderr: "" };
    }
    if (args[0] === "deploy") {
      const config = args[args.indexOf("--config") + 1];
      activeConfig = JSON.parse(readFileSync(config, "utf8"));
      activeVersion = VERSION_IDS[Math.min(deployCount, VERSION_IDS.length - 1)];
      deployCount += 1;
      if (shouldFailQualified && activeConfig.vars.VIDEOFORGE_GPU_TRANSPORT === "QUALIFIED_EXACT") {
        shouldFailQualified = false;
        throw new Error("fixture unknown qualified deploy outcome");
      }
      return { status: 0, signal: null, stdout: "", stderr: "" };
    }
    if (args[0] === "deployments" && args[1] === "status")
      return {
        status: 0,
        signal: null,
        stdout: JSON.stringify({ deployments: [{ version_id: activeVersion, percentage: 100 }] }),
        stderr: "",
      };
    if (args[0] === "versions" && args[1] === "view") {
      const version = {
        ...activeConfig,
        secret_bindings: [...secrets].sort().map((name) => ({ name, type: "secret_text" })),
      };
      const observedVersion = shouldMutateVersion ? mutateVersionOnce(version) : version;
      shouldMutateVersion = false;
      return {
        status: 0,
        signal: null,
        stdout: JSON.stringify(observedVersion),
        stderr: "",
      };
    }
    if (args[0] === "secret" && args[1] === "put") {
      secrets.add(args[2]);
      return { status: 0, signal: null, stdout: "", stderr: "" };
    }
    if (args[0] === "secret" && args[1] === "delete") {
      secrets.delete(args[2]);
      return { status: 0, signal: null, stdout: "", stderr: "" };
    }
    if (args[0] === "secret" && args[1] === "list")
      return {
        status: 0,
        signal: null,
        stdout: JSON.stringify([...secrets].sort().map((name) => ({ name, type: "secret_text" }))),
        stderr: "",
      };
    throw new Error(`unexpected fixture command: ${args.join(" ")}`);
  };
  const fetchImpl = async () => {
    const transport = activeConfig.vars.VIDEOFORGE_GPU_TRANSPORT;
    return new Response(
      JSON.stringify({
        schema_version: "videoforge-hosted-status/v1",
        commit: SOURCE,
        environment: "production",
        gpu_transport: transport,
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json; charset=UTF-8",
          "x-videoforge-worker-version": wrongRouteVersion ? VERSION_IDS[4] : activeVersion,
        },
      },
    );
  };
  const oauthApiResponse = async ({ path }) => {
    apiCalls.push(path);
    sequence.push({ kind: "oauth", path });
    let status = 200;
    let result;
    if (path === "/") result = { id: value.qualified.account_id };
    else if (path === "/workers/subdomain") result = { subdomain: "account-subdomain" };
    else if (path.endsWith("/settings")) {
      status = 404;
      result = null;
    } else if (path.startsWith("/workflows")) result = [];
    else if (path.startsWith("/r2/buckets"))
      result = [{ name: value.qualified.r2_buckets[0].bucket_name }];
    else throw new Error(`unexpected OAuth path ${path}`);
    return {
      bytes: JSON.stringify({
        status,
        body: {
          success: status === 200,
          result,
          ...(Array.isArray(result)
            ? {
                result_info: {
                  page: 1,
                  total_pages: 1,
                  total_count: result.length,
                },
              }
            : {}),
        },
      }),
      trustedDate: "Sat, 06 Sep 2026 22:00:00 GMT",
    };
  };
  const snapshotUploadArtifact = (configBytes) => {
    const modulePath = resolve(value.directory, "immutable-worker.js");
    const assetsPath = resolve(value.directory, "immutable-assets");
    const configPath = resolve(value.directory, "immutable-qualified.json");
    writeFileSync(modulePath, "fixture immutable worker\n", { mode: 0o400 });
    mkdirSync(assetsPath, { mode: 0o500 });
    writeFileSync(configPath, configBytes, { mode: 0o400 });
    return { modulePath, assetsPath, configPath, cleanup() {} };
  };
  return {
    apiCalls,
    calls,
    secrets,
    runChild,
    fetchImpl,
    oauthApiResponse,
    sequence,
    snapshotUploadArtifact,
    activeTransport: () => activeConfig?.vars?.VIDEOFORGE_GPU_TRANSPORT,
  };
}

async function executeThroughQualified(operator, approved) {
  const disabled = await operator.deployCloudflareDisabled.run({
    authority: approved,
    operationId: "deploy-cloudflare-disabled-bootstrap",
  });
  const secrets = await operator.uploadCloudflareSecrets.run({
    authority: approved,
    operationId: "upload-cloudflare-production-secrets",
  });
  const deployed = await operator.deployCloudflareQualified.run({
    authority: approved,
    operationId: "deploy-cloudflare-qualified-production",
  });
  const readback = await operator.readbackCloudflareQualified.run({
    authority: approved,
    operationId: "readback-qualified-production",
  });
  return { deployed, disabled, readback, secrets };
}

test("executes exact disabled, 22-secret, qualified, bundle, header, and route contract", async () => {
  const value = fixture();
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  const result = await executeThroughQualified(operator, authority(value));
  assert.equal(result.disabled.bootstrap_deploy_count, 1);
  assert.equal(result.disabled.full_disabled_deploy_count, 1);
  assert.equal(result.disabled.deploy_count, 2);
  assert.equal(result.secrets.secret_put_count, SECRET_NAMES.length);
  assert.equal(result.secrets.mutation_count, SECRET_NAMES.length + 1);
  assert.equal(result.deployed.deploy_count, 1);
  assert.equal(result.deployed.worker_bundle_sha256, value.workerBundleSha256);
  assert.equal(result.readback.deployment_id_sha256, result.deployed.deployment_id_sha256);
  assert.equal(result.readback.gpu_transport, "QUALIFIED_EXACT");
  assert.equal(mock.secrets.size, SECRET_NAMES.length);
  assert.deepEqual(mock.apiCalls, [
    "/",
    "/workers/subdomain",
    "/workers/scripts/videoforge-production-runtime/settings",
    "/workflows?page=1&per_page=100",
    "/r2/buckets?page=1&per_page=100",
  ]);
  const wranglerArgs = mock.calls.map(({ args }) => args.slice(4));
  assert.equal(
    wranglerArgs.filter((args) => args[0] === "deploy" && !args.includes("--dry-run")).length,
    4,
  );
  assert.equal(
    wranglerArgs.filter((args) => args[0] === "secret" && args[1] === "put").length,
    SECRET_NAMES.length,
  );
  assert.equal(
    wranglerArgs.some((args) => args.includes("r2")),
    false,
  );
  const firstSecretRead = mock.sequence.findIndex(
    (entry) => entry.kind === "wrangler" && entry.args[0] === "secret",
  );
  const fullDisabledDeploy = mock.sequence.findIndex(
    (entry) =>
      entry.kind === "wrangler" &&
      entry.args[0] === "deploy" &&
      entry.args.includes(`videoforge-v2-09-disabled:${SOURCE}`),
  );
  assert.equal(firstSecretRead > fullDisabledDeploy, true);
  assert.deepEqual(Object.keys(result.disabled).sort(), [
    "bootstrap_deploy_count",
    "config_sha256",
    "deploy_count",
    "full_disabled_deploy_count",
    "gpu_transport",
    "operation_id",
    "schema_version",
    "worker",
  ]);
  assert.deepEqual(Object.keys(result.secrets).sort(), [
    "deploy_count",
    "mutation_count",
    "operation_id",
    "schema_version",
    "secret_allowlist_sha256",
    "secret_count",
    "secret_put_count",
    "transaction_count",
    "worker",
  ]);
  const coordinatorSource = readFileSync(
    resolve(ROOT, "deploy/v2-09/execute-qualified-production.mjs"),
    "utf8",
  );
  for (const assertion of [
    "result.bootstrap_deploy_count !== 1",
    "result.full_disabled_deploy_count !== 1",
    "result.deploy_count !== 2",
    "result.secret_put_count !== authority.production.secret_count",
    "result.mutation_count !== authority.production.secret_count + 1",
  ])
    assert.equal(coordinatorSource.includes(assertion), true, assertion);
  const journal = JSON.parse(readFileSync(value.configuration.journalPath, "utf8"));
  assert.equal(journal.state, "QUALIFIED_VERIFIED");
  assert.equal(journal.retained_r2_deleted, false);
});

test("an unknown qualified deploy outcome is durably reconciled to disabled with no secrets or R2 deletion", async () => {
  const value = fixture();
  const mock = harness(value, { failQualifiedOnce: true });
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  const approved = authority(value);
  await operator.deployCloudflareDisabled.run({
    authority: approved,
    operationId: "deploy-cloudflare-disabled-bootstrap",
  });
  await operator.uploadCloudflareSecrets.run({
    authority: approved,
    operationId: "upload-cloudflare-production-secrets",
  });
  await assert.rejects(
    operator.deployCloudflareQualified.run({
      authority: approved,
      operationId: "deploy-cloudflare-qualified-production",
    }),
    /fixture unknown qualified deploy outcome/u,
  );
  assert.equal(mock.activeTransport(), "DISABLED_UNQUALIFIED");
  assert.equal(mock.secrets.size, 0);
  assert.equal(
    mock.calls.some(({ args }) => args.includes("r2")),
    false,
  );
  const journal = JSON.parse(readFileSync(value.configuration.journalPath, "utf8"));
  assert.equal(journal.state, "SAFE_DISABLED_CLEAN");
  assert.equal(journal.retained_r2_deleted, false);
});

test("stale authority and dry-run plan make zero provider or mutation calls", async () => {
  const value = fixture();
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    now: () => new Date("2026-09-07T00:00:00Z"),
  });
  assert.deepEqual(planV209CloudflareProduction(), {
    schema_version: "videoforge.v2-09-cloudflare-production-plan/v1",
    remote_mutations: 0,
    provider_calls: 0,
    retained_r2_mutation: false,
    state: "DRY_RUN_NO_ACTION",
  });
  await assert.rejects(
    operator.deployCloudflareDisabled.run({
      authority: authority(value),
      operationId: "deploy-cloudflare-disabled-bootstrap",
    }),
    /AUTHORITY_NOT_CURRENT/u,
  );
  assert.equal(mock.calls.length, 0);
});

test("version readback rejects an extra non-string root variable", async () => {
  const value = fixture();
  const mock = harness(value, {
    mutateVersionOnce: (version) => ({
      ...version,
      vars: { ...version.vars, UNAPPROVED_STATE: { enabled: true } },
    }),
  });
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  await assert.rejects(
    operator.deployCloudflareDisabled.run({
      authority: authority(value),
      operationId: "deploy-cloudflare-disabled-bootstrap",
    }),
    /ACTIVE_VERSION_CLOSED_WORLD_DRIFT/u,
  );
});

test("version readback rejects an unknown typed binding without a binding field", async () => {
  const value = fixture();
  const mock = harness(value, {
    mutateVersionOnce: (version) => ({
      ...version,
      bindings: [
        {
          name: "UNAPPROVED_KV",
          namespace_id: "2".repeat(32),
          type: "kv_namespace",
        },
      ],
    }),
  });
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  await assert.rejects(
    operator.deployCloudflareDisabled.run({
      authority: authority(value),
      operationId: "deploy-cloudflare-disabled-bootstrap",
    }),
    /ACTIVE_VERSION_CLOSED_WORLD_DRIFT/u,
  );
});

test("port identity binds composed capability, imported source, sanitized config, and dependencies", () => {
  const value = fixture();
  const mock = harness(value);
  const first = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    now: function firstClock() {
      return new Date("2026-09-06T22:00:00Z");
    },
  });
  const second = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    now: function secondClock() {
      return new Date("2026-09-06T22:00:00Z");
    },
  });
  assert.match(first.deployCloudflareDisabled.source_sha256, /^sha256:[0-9a-f]{64}$/u);
  assert.notEqual(
    first.deployCloudflareDisabled.source_sha256,
    first.deployCloudflareQualified.source_sha256,
  );
  assert.notEqual(
    first.deployCloudflareDisabled.source_sha256,
    second.deployCloudflareDisabled.source_sha256,
  );
  assert.throws(
    () =>
      createV209CloudflareProductionOperator(value.configuration, {
        runChild: mock.runChild,
      }),
    /PRODUCTION_DEPENDENCY_INJECTION_FORBIDDEN/u,
  );
});

test("cleanup-only can disable and remove only attributable secrets after normal authority expiry", async () => {
  const value = fixture();
  const mock = harness(value);
  let observed = new Date("2026-09-06T22:00:00Z");
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    now: () => observed,
  });
  const approved = authority(value);
  await operator.deployCloudflareDisabled.run({
    authority: approved,
    operationId: "deploy-cloudflare-disabled-bootstrap",
  });
  await operator.uploadCloudflareSecrets.run({
    authority: approved,
    operationId: "upload-cloudflare-production-secrets",
  });
  const beforeCleanupCalls = mock.calls.length;
  observed = new Date("2026-09-07T01:00:00Z");
  const reconciliation = await operator.reconcileCloudflareSafety.run({
    authority: approved,
    cleanupOnly: true,
    operationId: "reconcile-v209-production-safety",
  });
  assert.equal(reconciliation.safety_verified, true);
  assert.equal(reconciliation.gpu_transport, "DISABLED_UNQUALIFIED");
  assert.equal(reconciliation.retained_r2_deleted, false);
  assert.equal(mock.activeTransport(), "DISABLED_UNQUALIFIED");
  assert.equal(mock.secrets.size, 0);
  assert.equal(
    mock.calls.some(({ args }) => args.includes("r2")),
    false,
  );
  assert.equal(
    mock.calls
      .slice(beforeCleanupCalls)
      .some(({ args }) => args.includes("videoforge-v2-09-qualified:" + SOURCE)),
    false,
  );
});

test("route version-header mismatch fails closed and reconciles the qualified deployment", async () => {
  const value = fixture();
  const healthy = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: healthy.runChild,
    fetchImpl: healthy.fetchImpl,
    oauthApiResponse: healthy.oauthApiResponse,
    snapshotUploadArtifact: healthy.snapshotUploadArtifact,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  const approved = authority(value);
  await operator.deployCloudflareDisabled.run({
    authority: approved,
    operationId: "deploy-cloudflare-disabled-bootstrap",
  });
  await operator.uploadCloudflareSecrets.run({
    authority: approved,
    operationId: "upload-cloudflare-production-secrets",
  });
  const bad = harness(value, { wrongRouteVersion: true });
  let routeMismatchInjected = false;
  // Reuse the established mocked remote state for this narrow failure by delegating command state
  // to the healthy harness and changing only the route version header.
  const brokenOperator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: healthy.runChild,
    oauthApiResponse: healthy.oauthApiResponse,
    snapshotUploadArtifact: healthy.snapshotUploadArtifact,
    fetchImpl: async (...args) => {
      const response = await healthy.fetchImpl(...args);
      if (routeMismatchInjected) return response;
      routeMismatchInjected = true;
      const body = await response.text();
      return new Response(body, {
        status: response.status,
        headers: {
          "content-type": "application/json",
          "x-videoforge-worker-version": VERSION_IDS[4],
        },
      });
    },
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  await assert.rejects(
    brokenOperator.deployCloudflareQualified.run({
      authority: approved,
      operationId: "deploy-cloudflare-qualified-production",
    }),
    /ROUTE_READBACK_DRIFT/u,
  );
  assert.equal(healthy.activeTransport(), "DISABLED_UNQUALIFIED");
  assert.equal(healthy.secrets.size, 0);
  assert.equal(bad.calls.length, 0);
});
