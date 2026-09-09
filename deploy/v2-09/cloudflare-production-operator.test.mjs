import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  unlinkSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";

import { hashV209DryOutputBundle } from "./dry-output-bundle.mjs";
import { APPROVED_WRANGLER_OAUTH_SCOPES, SECRET_NAMES } from "../v2-13/guarded-activation.mjs";
import {
  ACTIVATED_ASSETS_PATH,
  ACTIVATED_MAIN_PATH,
  parseProductionConfig,
} from "../v2-13/validate-production-config.mjs";
import {
  createV209CloudflareProductionOperator,
  createV209CloudflareReplacementCapabilities,
  planV209CloudflareProduction,
  snapshotV209UploadArtifact,
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
  writeFileSync(
    resolve(directory, "README.md"),
    'This folder contains the built output assets for the worker "videoforge-production-runtime" generated at 2026-09-08T09:00:53.144Z.',
  );
  return hashV209DryOutputBundle(directory, { workerName: "videoforge-production-runtime" });
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
  qualified.no_bundle = false;
  qualified.assets.directory = ACTIVATED_ASSETS_PATH;
  qualified.r2_buckets[0].bucket_name = "videoforge-assets";
  qualified.workflows[0].name = "videoforge-video-workflow";
  qualified.workflows[1].name = "videoforge-pair-workflow";
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
  {
    failQualifiedOnce = false,
    mutateVersionOnce,
    wrongRouteVersion = false,
    predecessor = null,
  } = {},
) {
  const calls = [];
  const apiCalls = [];
  const sequence = [];
  const secrets = new Set();
  let activationImported = false;
  let activeConfig = predecessor ? structuredClone(predecessor) : null;
  let activeVersion = VERSION_IDS[0];
  let deployCount = 0;
  let shouldFailQualified = failQualifiedOnce;
  let shouldMutateVersion = typeof mutateVersionOnce === "function";
  const bulkCalls = [];
  const secretBulk = async (input) => {
    input.beforeDispatch();
    bulkCalls.push(input);
    sequence.push({ kind: "bulk" });
    for (const name of SECRET_NAMES) secrets.add(name);
    return { secret_count: SECRET_NAMES.length };
  };
  const runChild = async (input) => {
    calls.push(input);
    sequence.push({ kind: "wrangler", args: input.args.slice(4) });
    const args = input.args.slice(4);
    if (args[0] === "deploy" && args.includes("--dry-run")) {
      const output = args[args.indexOf("--outdir") + 1];
      mkdirSync(output, { recursive: true });
      writeFileSync(resolve(output, "index.js"), "fixture-exact-worker-bundle\n");
      writeFileSync(
        resolve(output, "README.md"),
        'This folder contains the built output assets for the worker "videoforge-production-runtime" generated at 2026-09-08T09:02:53.144Z.',
      );
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
      assert.equal(args.includes("--force"), false);
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
    if (secrets.size < SECRET_NAMES.length)
      return new Response(
        JSON.stringify({ error: { code: "HOSTED_CONFIGURATION_INVALID", retryable: false } }),
        {
          status: 503,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            "x-videoforge-runtime": "hosted-v2-06",
            "x-videoforge-worker-version": wrongRouteVersion ? VERSION_IDS[4] : activeVersion,
          },
        },
      );
    const transport = activationImported
      ? activeConfig.vars.VIDEOFORGE_GPU_TRANSPORT
      : "DISABLED_UNQUALIFIED";
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
      result = { buckets: [{ name: value.qualified.r2_buckets[0].bucket_name }] };
    else throw new Error(`unexpected OAuth path ${path}`);
    return {
      bytes: JSON.stringify({
        status,
        body: {
          success: status === 200,
          errors: [],
          messages: [],
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
    secretBulk,
    bulkCalls,
    importActivation: () => {
      activationImported = true;
    },
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
    secretInputSha256s: operator.uploadCloudflareSecrets.secret_input_sha256s,
  });
  const deployed = await operator.deployCloudflareQualified.run({
    authority: approved,
    operationId: "deploy-cloudflare-qualified-production",
  });
  const readback = await operator.readbackCloudflareQualified.run({
    authority: approved,
    operationId: "readback-qualified-production",
    activationImported: false,
  });
  return { deployed, disabled, readback, secrets };
}

test("deployment factory binds before render and requires exact private config before provider access", async () => {
  const value = fixture();
  const bytes = readFileSync(value.configuration.qualifiedConfigPath);
  unlinkSync(value.configuration.qualifiedConfigPath);
  // Exercise the real production factory, not a replacement port descriptor.
  assert.doesNotThrow(() => createV209CloudflareProductionOperator(value.configuration));
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  const start = () =>
    operator.deployCloudflareDisabled.run({
      authority: authority(value),
      operationId: "deploy-cloudflare-disabled-bootstrap",
    });
  await assert.rejects(start, /ENOENT/u);
  assert.deepEqual(mock.apiCalls, []);
  assert.deepEqual(mock.calls, []);
  writeFileSync(value.configuration.qualifiedConfigPath, bytes, { mode: 0o600 });
  chmodSync(value.configuration.qualifiedConfigPath, 0o644);
  await assert.rejects(start, /PRIVATE_FILE_INVALID/u);
  chmodSync(value.configuration.qualifiedConfigPath, 0o600);
  writeFileSync(value.configuration.qualifiedConfigPath, "{}");
  await assert.rejects(start, /QUALIFIED_CONFIG_HASH_DRIFT/u);
  unlinkSync(value.configuration.qualifiedConfigPath);
  const alternate = `${value.configuration.qualifiedConfigPath}.alternate`;
  writeFileSync(alternate, bytes, { mode: 0o600 });
  symlinkSync(alternate, value.configuration.qualifiedConfigPath);
  await assert.rejects(start, /PRIVATE_FILE_INVALID/u);
  assert.deepEqual(mock.apiCalls, []);
  assert.deepEqual(mock.calls, []);
  unlinkSync(value.configuration.qualifiedConfigPath);
  writeFileSync(value.configuration.qualifiedConfigPath, bytes, { mode: 0o600 });
  const result = await executeThroughQualified(operator, authority(value));
  assert.equal(result.readback.gpu_transport, "QUALIFIED_EXACT");
});

test("cleanup before render proves only untouched authority state and never invents a deployment", async () => {
  const value = fixture();
  unlinkSync(value.configuration.qualifiedConfigPath);
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  const context = {
    authority: authority(value),
    cleanupOnly: true,
    operationId: "reconcile-v209-production-safety",
  };
  const expected = {
    schema_version: "videoforge.v2-09-cloudflare-safety-reconciliation/v1",
    worker: value.configuration.workerName,
    gpu_transport: "UNTOUCHED_NO_MUTATIONS",
    secret_count: null,
    retained_r2_deleted: false,
    safety_verified: true,
  };
  assert.deepEqual(await operator.reconcileCloudflareSafety.run(context), expected);
  const pristine = JSON.parse(readFileSync(value.configuration.journalPath, "utf8"));
  // An existing pristine journal is also valid (e.g. failed input checks before INTENT).
  assert.deepEqual(await operator.reconcileCloudflareSafety.run(context), expected);
  for (const changed of [
    { events: [{ sequence: 1, status: "INTENT", kind: "BOOTSTRAP_DEPLOY" }] },
    { events: [{ sequence: 1, status: "COMPLETE", kind: "BOOTSTRAP_DEPLOY" }] },
    { state: "DISABLED_VERIFIED" },
    { introduced_secret_names: ["DATABASE_URL"] },
    { active_version_id: "11111111-1111-4111-8111-111111111111" },
    { worker_bundle_sha256: hash("previous-bundle") },
  ]) {
    writeFileSync(value.configuration.journalPath, JSON.stringify({ ...pristine, ...changed }), {
      mode: 0o600,
    });
    await assert.rejects(operator.reconcileCloudflareSafety.run(context), /ENOENT/u);
  }
  writeFileSync(
    value.configuration.journalPath,
    JSON.stringify({ ...pristine, authority_id: "foreign-authority" }),
    { mode: 0o600 },
  );
  await assert.rejects(operator.reconcileCloudflareSafety.run(context), /JOURNAL_INVALID/u);
  assert.deepEqual(mock.apiCalls, []);
  assert.deepEqual(mock.calls, []);
});

test("actual pre-render staged authority cleans untouched state without invented rendered hashes", async () => {
  const value = fixture();
  unlinkSync(value.configuration.qualifiedConfigPath);
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-07T01:00:00Z"),
  });
  const staged = {
    ...authority(value),
    execution: "V2_09_PREFLIGHT_THEN_QUALIFIED_PRODUCTION_ONCE",
    production: {
      worker_name: value.configuration.workerName,
      secret_count: SECRET_NAMES.length,
      secret_allowlist_sha256: hash(canonical([...SECRET_NAMES].sort())),
      materialization_input_sha256: hash("protected-plan"),
      chrome_bootstrap_plan_sha256: hash("chrome-plan"),
    },
  };
  const run = (approved = staged) =>
    operator.reconcileCloudflareSafety.run({
      authority: approved,
      cleanupOnly: true,
      operationId: "reconcile-v209-production-safety",
    });
  const result = await run();
  assert.equal(result.gpu_transport, "UNTOUCHED_NO_MUTATIONS");
  assert.equal(result.secret_count, null);
  assert.equal(result.safety_verified, true);
  assert.equal(existsSync(value.configuration.journalPath), false);
  assert.equal(existsSync(value.configuration.qualifiedConfigPath), false);
  for (const invalid of [
    { ...staged, execution: "wrong" },
    { ...staged, source_commit: "f".repeat(40) },
    { ...staged, proposal_sha256: "invalid" },
    { ...staged, production: { ...staged.production, config_sha256: null } },
    { ...staged, production: { ...staged.production, materialization_input_sha256: null } },
    { ...staged, production: { ...staged.production, secret_allowlist_sha256: hash("foreign") } },
    { ...staged, scope: { ...staged.scope, cleanup_only_recovery: false } },
    { ...staged, scope: { ...staged.scope, allow_redispatch: true } },
  ])
    await assert.rejects(run(invalid), /CLEANUP_AUTHORITY_INVALID/u);
  // Even a malformed or dangling existing journal forbids this missing-hash path.
  for (const existing of [
    {},
    { state: "PREPARED", events: [] },
    { events: [{ status: "INTENT" }] },
  ]) {
    writeFileSync(value.configuration.journalPath, JSON.stringify(existing), { mode: 0o600 });
    await assert.rejects(run(), /PRERENDER_CLEANUP_JOURNAL_PRESENT/u);
    unlinkSync(value.configuration.journalPath);
  }
  symlinkSync(`${value.configuration.journalPath}.absent`, value.configuration.journalPath);
  await assert.rejects(run(), /PRERENDER_CLEANUP_JOURNAL_PRESENT/u);
  assert.deepEqual(mock.apiCalls, []);
  assert.deepEqual(mock.calls, []);
});

test("executes exact disabled, exact-secret, qualified, bundle, header, and route contract", async () => {
  const value = fixture();
  assert.deepEqual(
    JSON.parse(readFileSync(value.configuration.qualifiedConfigPath, "utf8")).workflows.map(
      ({ name }) => name,
    ),
    ["videoforge-video-workflow", "videoforge-pair-workflow"],
  );
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  const result = await executeThroughQualified(operator, authority(value));
  const disabled = JSON.parse(readFileSync(value.configuration.disabledConfigPath, "utf8"));
  const bootstrap = JSON.parse(readFileSync(value.configuration.bootstrapConfigPath, "utf8"));
  const withoutR2 = structuredClone(disabled);
  delete withoutR2.r2_buckets;
  assert.deepEqual(bootstrap, withoutR2);
  assert.deepEqual(bootstrap.workflows, disabled.workflows);
  assert.equal(result.disabled.bootstrap_deploy_count, 1);
  assert.equal(result.disabled.full_disabled_deploy_count, 1);
  assert.equal(result.disabled.deploy_count, 2);
  assert.equal(result.secrets.secret_put_count, SECRET_NAMES.length);
  assert.equal(result.secrets.mutation_count, 2);
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
    "/r2/buckets",
  ]);
  const wranglerArgs = mock.calls.map(({ args }) => args.slice(4));
  assert.equal(
    wranglerArgs.some((args) => args.includes("--no-bundle")),
    false,
  );
  assert.equal(
    wranglerArgs
      .filter(
        (args) => args[0] === "deploy" && args.includes(`videoforge-v2-09-qualified:${SOURCE}`),
      )
      .every((args) => args.includes("--no-upload-source-maps")),
    true,
  );
  assert.equal(
    wranglerArgs.filter((args) => args[0] === "deploy" && !args.includes("--dry-run")).length,
    4,
  );
  assert.equal(wranglerArgs.filter((args) => args[0] === "secret" && args[1] === "put").length, 0);
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
    "result.mutation_count !== 2",
  ])
    assert.equal(coordinatorSource.includes(assertion), true, assertion);
  const journal = JSON.parse(readFileSync(value.configuration.journalPath, "utf8"));
  assert.equal(journal.state, "QUALIFIED_VERIFIED");
  assert.equal(journal.retained_r2_deleted, false);
});

test("V2-09 qualified deployment rejects no-bundle configuration before Cloudflare access", async () => {
  const value = fixture();
  const qualified = JSON.parse(readFileSync(value.configuration.qualifiedConfigPath, "utf8"));
  qualified.no_bundle = true;
  writeFileSync(value.configuration.qualifiedConfigPath, `${JSON.stringify(qualified, null, 2)}\n`);
  value.configSha256 = hash(readFileSync(value.configuration.qualifiedConfigPath));
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  await assert.rejects(
    operator.deployCloudflareDisabled.run({
      authority: authority(value),
      operationId: "deploy-cloudflare-disabled-bootstrap",
    }),
    /QUALIFIED_BUNDLE_MODE_DRIFT/u,
  );
  assert.deepEqual(mock.apiCalls, []);
  assert.deepEqual(mock.calls, []);
});

test("upload snapshot preserves the complete immutable Worker module graph and rejects symlinks", () => {
  const source = mkdtempSync(resolve(tmpdir(), "videoforge-v209-module-graph-test-"));
  const worker = resolve(source, "worker");
  const chunks = resolve(worker, "assets");
  const client = resolve(source, "client");
  mkdirSync(worker);
  mkdirSync(chunks);
  mkdirSync(client);
  writeFileSync(resolve(worker, "index.js"), 'import "./assets/chunk.js";\n');
  writeFileSync(resolve(chunks, "chunk.js"), "export const exact = true;\n");
  writeFileSync(resolve(client, "index.html"), "fixture client\n");
  const artifact = snapshotV209UploadArtifact(Buffer.from("{}\n"), {
    mainPath: resolve(worker, "index.js"),
    assetsSourcePath: client,
  });
  try {
    assert.equal(readFileSync(artifact.modulePath, "utf8"), 'import "./assets/chunk.js";\n');
    assert.equal(
      readFileSync(resolve(artifact.modulePath, "../assets/chunk.js"), "utf8"),
      "export const exact = true;\n",
    );
    assert.throws(
      () =>
        snapshotV209UploadArtifact(Buffer.from("{}\n"), {
          mainPath: resolve(worker, "index.js"),
          assetsSourcePath: client,
        }),
      /EEXIST/u,
    );
    assert.equal(readFileSync(artifact.modulePath, "utf8"), 'import "./assets/chunk.js";\n');
  } finally {
    artifact.cleanup();
  }
  symlinkSync(resolve(worker, "index.js"), resolve(chunks, "linked.js"));
  assert.throws(
    () =>
      snapshotV209UploadArtifact(Buffer.from("{}\n"), {
        mainPath: resolve(worker, "index.js"),
        assetsSourcePath: client,
      }),
    /UPLOAD_ARTIFACT_SYMLINK/u,
  );
  rmSync(source, { recursive: true, force: true });
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
    secretBulk: mock.secretBulk,
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
    secretInputSha256s: operator.uploadCloudflareSecrets.secret_input_sha256s,
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
    secretBulk: mock.secretBulk,
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
    secretBulk: mock.secretBulk,
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
    secretBulk: mock.secretBulk,
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

test("version readback requires the exact production CPU limit", async () => {
  const value = fixture();
  const mock = harness(value, {
    mutateVersionOnce: (version) => ({ ...version, limits: { cpu_ms: 10 } }),
  });
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  await assert.rejects(
    operator.deployCloudflareDisabled.run({
      authority: authority(value),
      operationId: "deploy-cloudflare-disabled-bootstrap",
    }),
    /ACTIVE_VERSION_CPU_LIMIT_DRIFT/u,
  );
  assert.equal(
    JSON.parse(readFileSync(value.configuration.journalPath, "utf8")).failure.operation_code,
    "V2_09_CLOUDFLARE_PRODUCTION_ACTIVE_VERSION_CPU_LIMIT_DRIFT",
  );
});

test("current version readback rejects an absent production CPU limit", async () => {
  const value = fixture();
  const mock = harness(value, {
    mutateVersionOnce: (version) => {
      const observed = { ...version };
      delete observed.limits;
      return observed;
    },
  });
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  await assert.rejects(
    operator.deployCloudflareDisabled.run({
      authority: authority(value),
      operationId: "deploy-cloudflare-disabled-bootstrap",
    }),
    /ACTIVE_VERSION_CPU_LIMIT_DRIFT/u,
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
    secretBulk: mock.secretBulk,
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
    secretBulk: mock.secretBulk,
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
    secretBulk: mock.secretBulk,
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
    secretInputSha256s: operator.uploadCloudflareSecrets.secret_input_sha256s,
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

test("secret upload uses the construction-sealed bytes after a pathname replacement", async () => {
  const value = fixture();
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  const approved = authority(value);
  await operator.deployCloudflareDisabled.run({
    authority: approved,
    operationId: "deploy-cloudflare-disabled-bootstrap",
  });
  const replacedName = SECRET_NAMES[3];
  writeFileSync(value.configuration.secretFiles[replacedName], "unapproved-replacement", {
    mode: 0o600,
  });
  await operator.uploadCloudflareSecrets.run({
    authority: approved,
    operationId: "upload-cloudflare-production-secrets",
    secretInputSha256s: operator.uploadCloudflareSecrets.secret_input_sha256s,
  });
  assert.equal(mock.bulkCalls.length, 1);
  for (const name of SECRET_NAMES) {
    assert.equal(
      Buffer.from(mock.bulkCalls[0].secretInputs[name].bytes).toString("utf8"),
      `fixture-${name}`,
    );
  }
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
    secretBulk: healthy.secretBulk,
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
    secretInputSha256s: operator.uploadCloudflareSecrets.secret_input_sha256s,
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
    secretBulk: healthy.secretBulk,
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
    /ROUTE_(VERSION_HEADER|TRANSPORT)_DRIFT/u,
  );
  assert.equal(healthy.activeTransport(), "DISABLED_UNQUALIFIED");
  assert.equal(healthy.secrets.size, 0);
  assert.equal(bad.calls.length, 0);
});

test("presecret disabled proof rejects arbitrary configuration errors and final missing configuration", async () => {
  for (const variant of [
    "wrong-code",
    "extra-key",
    "retryable",
    "missing-header",
    "after-all-secrets",
  ]) {
    const value = fixture();
    const mock = harness(value);
    const operator = createV209CloudflareProductionOperator(value.configuration, {
      testOnly: true,
      runChild: mock.runChild,
      oauthApiResponse: mock.oauthApiResponse,
      snapshotUploadArtifact: mock.snapshotUploadArtifact,
      secretBulk: mock.secretBulk,
      now: () => new Date("2026-09-06T22:00:00Z"),
      fetchImpl: async (...args) => {
        const response = await mock.fetchImpl(...args);
        if (variant === "after-all-secrets" && mock.secrets.size !== SECRET_NAMES.length)
          return response;
        const body = { error: { code: "HOSTED_CONFIGURATION_INVALID", retryable: false } };
        if (variant === "wrong-code") body.error.code = "OTHER_FAILURE";
        if (variant === "extra-key") body.error.detail = "unexpected";
        if (variant === "retryable") body.error.retryable = true;
        const headers = new Headers(response.headers);
        headers.set("cache-control", "no-store");
        headers.set("x-videoforge-runtime", "hosted-v2-06");
        if (variant === "missing-header") headers.delete("x-videoforge-runtime");
        return new Response(JSON.stringify(body), { status: 503, headers });
      },
    });
    await assert.rejects(
      executeThroughQualified(operator, authority(value)),
      /ROUTE_(MISSING_CONFIGURATION|HTTP_STATUS)_DRIFT|FAILURE_RECONCILIATION_REQUIRED/u,
      variant,
    );
    const recorded = JSON.parse(readFileSync(value.configuration.journalPath, "utf8"));
    assert.equal(
      recorded.failure.operation_code,
      variant === "after-all-secrets"
        ? "V2_09_CLOUDFLARE_PRODUCTION_ROUTE_HTTP_STATUS_DRIFT"
        : "V2_09_CLOUDFLARE_PRODUCTION_ROUTE_MISSING_CONFIGURATION_DRIFT",
    );
    if (variant !== "after-all-secrets")
      assert.equal(
        recorded.failure.cleanup_code,
        variant === "after-all-secrets"
          ? "V2_09_CLOUDFLARE_PRODUCTION_ROUTE_HTTP_STATUS_DRIFT"
          : "V2_09_CLOUDFLARE_PRODUCTION_ROUTE_MISSING_CONFIGURATION_DRIFT",
      );
  }
});

test("qualified config readback requires disabled before import and qualified after import", async () => {
  const value = fixture();
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  const result = await executeThroughQualified(operator, authority(value));
  assert.equal(result.readback.effective_gpu_transport, "DISABLED_UNQUALIFIED");
  const context = {
    authority: authority(value),
    operationId: "readback-qualified-production",
    activationImported: true,
  };
  await assert.rejects(
    operator.readbackCloudflareQualified.run(context),
    /ROUTE_(VERSION_HEADER|TRANSPORT)_DRIFT/u,
  );
  for (const activationImported of [undefined, null, "true", 1]) {
    const callsBefore = mock.calls.length;
    await assert.rejects(
      operator.readbackCloudflareQualified.run({ ...context, activationImported }),
      /ACTIVATION_PHASE_REQUIRED/u,
    );
    assert.equal(mock.calls.length, callsBefore);
  }
  mock.importActivation();
  assert.equal(
    (await operator.readbackCloudflareQualified.run(context)).effective_gpu_transport,
    "QUALIFIED_EXACT",
  );
  await assert.rejects(
    operator.readbackCloudflareQualified.run({ ...context, activationImported: false }),
    /ROUTE_(VERSION_HEADER|TRANSPORT)_DRIFT/u,
  );
});

test("R2 inventory rejects pagination, truncation, duplicates and unknown shapes before mutation", async () => {
  for (const variant of [
    "cursor",
    "result-info",
    "truncated",
    "array",
    "duplicate",
    "unknown-item",
    "workflow-unpaginated",
  ]) {
    const value = fixture();
    const mock = harness(value);
    const operator = createV209CloudflareProductionOperator(value.configuration, {
      testOnly: true,
      runChild: mock.runChild,
      fetchImpl: mock.fetchImpl,
      snapshotUploadArtifact: mock.snapshotUploadArtifact,
      secretBulk: mock.secretBulk,
      now: () => new Date("2026-09-06T22:00:00Z"),
      oauthApiResponse: async (input) => {
        const original = await mock.oauthApiResponse(input);
        const envelope = JSON.parse(original.bytes);
        if (variant === "workflow-unpaginated" && input.path.startsWith("/workflows"))
          delete envelope.body.result_info;
        if (input.path.startsWith("/r2/buckets")) {
          assert.equal(input.path, "/r2/buckets");
          const result = envelope.body.result;
          if (variant === "cursor") result.cursor = "next";
          if (variant === "result-info")
            envelope.body.result_info = { page: 1, total_pages: 1, total_count: 1 };
          if (variant === "truncated") result.truncated = true;
          if (variant === "array") envelope.body.result = result.buckets;
          if (variant === "duplicate") result.buckets.push(result.buckets[0]);
          if (variant === "unknown-item") result.buckets[0].cursor = "next";
        }
        return { bytes: JSON.stringify(envelope) };
      },
    });
    await assert.rejects(
      executeThroughQualified(operator, authority(value)),
      /R2_INVENTORY_(RESULT_INVALID|DUPLICATE)|WORKFLOW_INVENTORY_PAGINATION_INVALID/u,
      variant,
    );
    assert.equal(mock.calls.length, 0);
  }
});

test("failure journal redacts unknown original and cleanup exceptions", async () => {
  const value = fixture();
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: async () => {
      throw new Error("password=private-path-secret");
    },
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  await assert.rejects(
    executeThroughQualified(operator, authority(value)),
    /FAILURE_RECONCILIATION_REQUIRED/u,
  );
  const bytes = readFileSync(value.configuration.journalPath, "utf8");
  assert.deepEqual(JSON.parse(bytes).failure, {
    operation_code: "UNKNOWN_ERROR",
    cleanup_code: "UNKNOWN_ERROR",
  });
  assert.equal(bytes.includes("password"), false);
  assert.equal(bytes.includes("private-path-secret"), false);
});

test("committed secret bulk PATCH permits at most three strict readbacks without repeating mutation", async () => {
  for (const staleReads of [2, 3]) {
    const value = fixture();
    const mock = harness(value);
    let injected = 0;
    const operator = createV209CloudflareProductionOperator(value.configuration, {
      testOnly: true,
      fetchImpl: mock.fetchImpl,
      oauthApiResponse: mock.oauthApiResponse,
      snapshotUploadArtifact: mock.snapshotUploadArtifact,
      secretBulk: mock.secretBulk,
      now: () => new Date("2026-09-06T22:00:00Z"),
      runChild: async (input) => {
        const result = await mock.runChild(input);
        if (
          input.args[4] === "versions" &&
          mock.secrets.size === SECRET_NAMES.length &&
          injected < staleReads
        ) {
          injected += 1;
          const version = JSON.parse(result.stdout);
          version.secret_bindings = [];
          return { ...result, stdout: JSON.stringify(version) };
        }
        return result;
      },
    });
    if (staleReads === 2) await executeThroughQualified(operator, authority(value));
    else
      await assert.rejects(
        executeThroughQualified(operator, authority(value)),
        /ACTIVE_VERSION_CLOSED_WORLD_DRIFT/u,
      );
    assert.equal(injected, staleReads);
    const puts = mock.calls.filter(({ args }) => args[4] === "secret" && args[5] === "put");
    assert.equal(puts.length, 0);
    assert.equal(mock.bulkCalls.length, 1);
  }
});

test("cleanup waits for zero-secret inventory without repeating DELETE", async () => {
  const value = fixture();
  const mock = harness(value, { failQualifiedOnce: true });
  let deletes = 0;
  let stale = 0;
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
    runChild: async (input) => {
      const result = await mock.runChild(input);
      if (input.args[4] === "secret" && input.args[5] === "delete") deletes += 1;
      if (
        input.args[4] === "secret" &&
        input.args[5] === "list" &&
        deletes === SECRET_NAMES.length &&
        stale < 2
      ) {
        stale += 1;
        return {
          ...result,
          stdout: JSON.stringify([{ name: SECRET_NAMES[0], type: "secret_text" }]),
        };
      }
      return result;
    },
  });
  await assert.rejects(
    executeThroughQualified(operator, authority(value)),
    /fixture unknown qualified deploy outcome/u,
  );
  assert.equal(deletes, SECRET_NAMES.length);
  assert.equal(stale, 2);
  assert.equal(
    JSON.parse(readFileSync(value.configuration.journalPath)).state,
    "SAFE_DISABLED_CLEAN",
  );
});

test("only exact pinned disabled predecessor can be replaced; drift preserves it without cleanup mutation", async () => {
  for (const drift of [false, true]) {
    const value = fixture();
    const previous = structuredClone(value.qualified);
    delete previous.limits;
    previous.vars.VIDEOFORGE_GPU_TRANSPORT = "DISABLED_UNQUALIFIED";
    const oldConfig = resolve(value.directory, "predecessor.json");
    writeFileSync(oldConfig, JSON.stringify(previous), { mode: 0o600 });
    value.configuration.predecessorBaseline = {
      versionId: drift ? VERSION_IDS[4] : VERSION_IDS[0],
      sourceCommit: SOURCE,
      qualifiedConfigPath: oldConfig,
      qualifiedConfigSha256: hash(readFileSync(oldConfig)),
    };
    const mock = harness(value, { predecessor: previous });
    const operator = createV209CloudflareProductionOperator(value.configuration, {
      testOnly: true,
      runChild: mock.runChild,
      fetchImpl: mock.fetchImpl,
      snapshotUploadArtifact: mock.snapshotUploadArtifact,
      secretBulk: mock.secretBulk,
      now: () => new Date("2026-09-06T22:00:00Z"),
      oauthApiResponse: async (input) => {
        const response = await mock.oauthApiResponse(input);
        const envelope = JSON.parse(response.bytes);
        if (input.path.endsWith("/settings")) {
          envelope.status = 200;
          envelope.body.success = true;
          envelope.body.result = {};
        }
        if (input.path.startsWith("/workflows")) {
          envelope.body.result = value.qualified.workflows.map(({ name }) => ({ name }));
          envelope.body.result_info.total_count = 2;
        }
        return { bytes: JSON.stringify(envelope) };
      },
    });
    if (!drift) {
      await executeThroughQualified(operator, authority(value));
    } else {
      await assert.rejects(
        executeThroughQualified(operator, authority(value)),
        /PREDECESSOR_VERSION_DRIFT/u,
      );
      const cleanup = await operator.reconcileCloudflareSafety.run({
        authority: authority(value),
        operationId: "reconcile-v209-production-safety",
        cleanupOnly: true,
      });
      assert.equal(cleanup.gpu_transport, "UNTOUCHED_NO_MUTATIONS");
      assert.equal(
        mock.calls.some(
          ({ args }) => args[4] === "deploy" || (args[4] === "secret" && args[5] !== "list"),
        ),
        false,
      );
    }
  }
});

test("successful cleanup revalidates without repeating deployment or secret deletion", async () => {
  const value = fixture();
  const mock = harness(value, { failQualifiedOnce: true });
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  await assert.rejects(
    executeThroughQualified(operator, authority(value)),
    /fixture unknown qualified deploy outcome/u,
  );
  const mutationCount = () =>
    mock.calls.filter(
      ({ args }) => args[4] === "deploy" || (args[4] === "secret" && args[5] !== "list"),
    ).length;
  const before = mutationCount();
  const context = {
    authority: authority(value),
    operationId: "reconcile-v209-production-safety",
    cleanupOnly: true,
  };
  await operator.reconcileCloudflareSafety.run(context);
  await operator.reconcileCloudflareSafety.run(context);
  assert.equal(mutationCount(), before);
  const journal = JSON.parse(readFileSync(value.configuration.journalPath));
  journal.state = "DISABLED_VERIFIED";
  journal.introduced_secret_names = [];
  writeFileSync(value.configuration.journalPath, JSON.stringify(journal));
  await operator.reconcileCloudflareSafety.run(context);
  assert.equal(
    mock.calls.filter(({ args }) => args[4] === "secret" && args[5] === "delete").length,
    SECRET_NAMES.length,
  );
  const ambiguous = JSON.parse(readFileSync(value.configuration.journalPath));
  ambiguous.state = "DISABLED_VERIFIED";
  ambiguous.introduced_secret_names = [SECRET_NAMES[0]];
  mock.secrets.add(SECRET_NAMES[0]);
  writeFileSync(value.configuration.journalPath, JSON.stringify(ambiguous));
  await assert.rejects(
    operator.reconcileCloudflareSafety.run(context),
    /SECRET_DELETE_REPLAY_FORBIDDEN/u,
  );
  assert.equal(
    mock.calls.filter(({ args }) => args[4] === "secret" && args[5] === "delete").length,
    SECRET_NAMES.length,
  );
});

test("route diagnostics distinguish a stale version header from wrong source without exposing payload", async () => {
  const value = fixture();
  const mock = harness(value);
  let drift = null;
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
    fetchImpl: async (...args) => {
      const response = await mock.fetchImpl(...args);
      if (!drift) return response;
      const body = await response.json();
      const headers = new Headers(response.headers);
      if (drift === "version") headers.set("x-videoforge-worker-version", VERSION_IDS[0]);
      else body.commit = "private-payload-never-emitted";
      return new Response(JSON.stringify(body), { status: response.status, headers });
    },
  });
  await executeThroughQualified(operator, authority(value));
  const context = {
    authority: authority(value),
    operationId: "readback-qualified-production",
    activationImported: false,
  };
  drift = "version";
  await assert.rejects(
    operator.readbackCloudflareQualified.run(context),
    (error) => error.message === "V2_09_CLOUDFLARE_PRODUCTION_ROUTE_VERSION_HEADER_DRIFT",
  );
  drift = "source";
  await assert.rejects(
    operator.readbackCloudflareQualified.run(context),
    (error) => error.message === "V2_09_CLOUDFLARE_PRODUCTION_ROUTE_SOURCE_DRIFT",
  );
});

test("partial committed deletion resumes with live remaining projection and never redeletes", async () => {
  const value = fixture();
  const mock = harness(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    secretBulk: mock.secretBulk,
    now: () => new Date("2026-09-06T22:00:00Z"),
  });
  await executeThroughQualified(operator, authority(value));
  const deleted = SECRET_NAMES[0];
  mock.secrets.delete(deleted);
  const journal = JSON.parse(readFileSync(value.configuration.journalPath));
  journal.state = "RECONCILING_DISABLED";
  journal.events.push(
    { kind: "SECRET_DELETE", name: deleted, status: "INTENT" },
    { kind: "SECRET_DELETE", name: deleted, status: "COMMITTED" },
  );
  assert.ok(journal.introduced_secret_names.includes(deleted));
  writeFileSync(value.configuration.journalPath, JSON.stringify(journal));
  await operator.reconcileCloudflareSafety.run({
    authority: authority(value),
    operationId: "reconcile-v209-production-safety",
    cleanupOnly: true,
  });
  const deletions = mock.calls.filter(({ args }) => args[4] === "secret" && args[5] === "delete");
  assert.equal(deletions.length, SECRET_NAMES.length - 1);
  assert.equal(
    deletions.some(({ args }) => args[6] === deleted),
    false,
  );
  assert.equal(
    JSON.parse(readFileSync(value.configuration.journalPath)).state,
    "SAFE_DISABLED_CLEAN",
  );
});

test("unknown bulk outcome cleans only the observed attributable subset without replay", async () => {
  const value = fixture();
  const mock = harness(value);
  let bulkRequests = 0;
  const operator = createV209CloudflareProductionOperator(value.configuration, {
    testOnly: true,
    runChild: mock.runChild,
    fetchImpl: mock.fetchImpl,
    oauthApiResponse: mock.oauthApiResponse,
    snapshotUploadArtifact: mock.snapshotUploadArtifact,
    now: () => new Date("2026-09-06T22:00:00Z"),
    secretBulk: async (input) => {
      input.beforeDispatch();
      bulkRequests += 1;
      const journal = JSON.parse(readFileSync(value.configuration.journalPath));
      assert.equal(journal.events.at(-1).kind, "SECRET_BULK_PUT");
      assert.equal(journal.events.at(-1).status, "INTENT");
      for (const name of SECRET_NAMES.slice(0, 7)) mock.secrets.add(name);
      throw Error("sensitive transport detail must not escape");
    },
  });
  await assert.rejects(executeThroughQualified(operator, authority(value)), /SECRET_BULK_FAILED/u);
  assert.equal(bulkRequests, 1);
  assert.equal(mock.secrets.size, 0);
  const deletes = mock.calls.filter(({ args }) => args[4] === "secret" && args[5] === "delete");
  assert.equal(deletes.length, 7);
  const text = readFileSync(value.configuration.journalPath, "utf8");
  assert.equal(text.includes("sensitive transport"), false);
  assert.equal(JSON.parse(text).state, "SAFE_DISABLED_CLEAN");
  await assert.rejects(
    operator.uploadCloudflareSecrets.run({
      authority: authority(value),
      operationId: "upload-cloudflare-production-secrets",
      secretInputSha256s: operator.uploadCloudflareSecrets.secret_input_sha256s,
    }),
    /SECRET_BULK_REPLAY_FORBIDDEN/u,
  );
  assert.equal(bulkRequests, 1);
});

test("replacement built-in primitives verify inherited qualified secrets without disabled config or secret mutation", async () => {
  const value = fixture();
  const mock = harness(value);
  const dependencies = { ...mock, testOnly: true, now: () => new Date("2026-09-06T22:00:00.000Z") };
  const approved = authority(value);
  const operator = createV209CloudflareProductionOperator(value.configuration, dependencies);
  const done = await executeThroughQualified(operator, approved);
  unlinkSync(value.configuration.disabledConfigPath);
  const primitive = createV209CloudflareReplacementCapabilities(value.configuration, dependencies);
  const prior = {
    versionId: VERSION_IDS[3],
    sourceCommit: SOURCE,
    qualifiedConfigPath: value.configuration.qualifiedConfigPath,
    qualifiedConfigSha256: approved.production.config_sha256,
    workerBundleSha256: approved.production.worker_bundle_sha256,
  };
  const count = mock.calls.length;
  const observed = await primitive.predecessor(approved, prior);
  assert.equal(observed.versionIdSha256, done.deployed.deployment_id_sha256);
  assert.ok(
    mock.calls
      .slice(count)
      .every(
        (call) =>
          !call.args.includes("deploy") &&
          !call.args.includes("put") &&
          !call.args.includes("delete"),
      ),
  );
  assert.equal(mock.secrets.size, SECRET_NAMES.length);
});

test("replacement failure containment verifies disabled transport and preserves all inherited secrets", async () => {
  const value = fixture();
  const mock = harness(value);
  const dependencies = { ...mock, testOnly: true, now: () => new Date("2026-09-06T22:00:00.000Z") };
  const approved = authority(value);
  await executeThroughQualified(
    createV209CloudflareProductionOperator(value.configuration, dependencies),
    approved,
  );
  const primitive = createV209CloudflareReplacementCapabilities(value.configuration, dependencies);
  const offset = mock.calls.length;
  await primitive.disable(approved);
  assert.equal(mock.activeTransport(), "DISABLED_UNQUALIFIED");
  assert.equal(mock.secrets.size, SECRET_NAMES.length);
  const calls = mock.calls.slice(offset).map((call) => call.args.slice(4));
  assert.equal(calls.filter((args) => args[0] === "deploy").length, 1);
  for (const args of calls) {
    assert.ok(!args.includes("delete") && !args.includes("put"));
    if (args[0] === "deploy")
      assert.equal(args[args.indexOf("--config") + 1], value.configuration.disabledConfigPath);
  }
});

test("replacement validates a relocated prior artifact tree without rewriting pinned config", async () => {
  const value = fixture();
  const mock = harness(value);
  const dependencies = { ...mock, testOnly: true, now: () => new Date("2026-09-06T22:00:00.000Z") };
  const approved = authority(value);
  await executeThroughQualified(
    createV209CloudflareProductionOperator(value.configuration, dependencies),
    approved,
  );
  const oldConfig = JSON.parse(readFileSync(value.configuration.qualifiedConfigPath));
  const predecessorPath = resolve(value.directory, "prior-qualified.json");
  oldConfig.vars.VIDEOFORGE_COMMIT = "b".repeat(40);
  oldConfig.no_bundle = true;
  delete oldConfig.limits;
  const bytes = JSON.stringify(oldConfig);
  writeFileSync(predecessorPath, bytes, { mode: 0o600 });
  const artifactRootPath = resolve(value.directory, "prior-artifacts");
  mkdirSync(artifactRootPath);
  chmodSync(artifactRootPath, 0o700);
  let artifactDirectory = artifactRootPath;
  for (const segment of ["apps", "web", "dist-cloudflare"]) {
    mkdirSync((artifactDirectory = resolve(artifactDirectory, segment)));
    chmodSync(artifactDirectory, 0o700);
  }
  const workerDirectory = resolve(artifactDirectory, "videoforge_production_runtime");
  const assetDirectory = resolve(artifactDirectory, "client");
  mkdirSync(workerDirectory);
  mkdirSync(assetDirectory);
  chmodSync(workerDirectory, 0o700);
  chmodSync(assetDirectory, 0o700);
  const workerAssetDirectory = resolve(workerDirectory, "assets");
  mkdirSync(workerAssetDirectory);
  chmodSync(workerAssetDirectory, 0o700);
  const relocatedMain = resolve(workerDirectory, "index.js");
  const relocatedWorkerAsset = resolve(workerAssetDirectory, "runtime.js");
  writeFileSync(relocatedMain, "sealed predecessor worker", { mode: 0o600 });
  writeFileSync(relocatedWorkerAsset, "sealed predecessor worker asset", { mode: 0o600 });
  writeFileSync(resolve(assetDirectory, "index.html"), "sealed predecessor assets", {
    mode: 0o600,
  });
  const runChild = async (input) => {
    const result = await mock.runChild(input);
    if (input.args.includes("view")) {
      const v = JSON.parse(result.stdout);
      v.main = oldConfig.main;
      v.assets = oldConfig.assets;
      v.vars.VIDEOFORGE_COMMIT = oldConfig.vars.VIDEOFORGE_COMMIT;
      delete v.limits;
      return { ...result, stdout: JSON.stringify(v) };
    }
    return result;
  };
  const fetchImpl = async (...args) => {
    const response = await mock.fetchImpl(...args);
    const body = await response.json();
    body.commit = oldConfig.vars.VIDEOFORGE_COMMIT;
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers: response.headers,
    });
  };
  const primitive = createV209CloudflareReplacementCapabilities(value.configuration, {
    ...dependencies,
    runChild,
    fetchImpl,
  });
  const predecessor = {
    versionId: VERSION_IDS[3],
    sourceCommit: oldConfig.vars.VIDEOFORGE_COMMIT,
    artifactRootPath,
    qualifiedConfigPath: predecessorPath,
    qualifiedConfigSha256: hash(bytes),
    workerBundleSha256: approved.production.worker_bundle_sha256,
  };
  await primitive.predecessor(approved, predecessor);
  assert.equal(readFileSync(predecessorPath, "utf8"), bytes);
  unlinkSync(relocatedWorkerAsset);
  symlinkSync(ACTIVATED_MAIN_PATH, relocatedWorkerAsset);
  await assert.rejects(
    primitive.predecessor(approved, predecessor),
    /PREDECESSOR_ARTIFACT_PATH_DRIFT|PRIVATE_FILE_INVALID/,
  );
});

test("replacement verifies a bundled predecessor from relocated bytes before readback", async () => {
  const value = fixture();
  const mock = harness(value);
  const dependencies = { ...mock, testOnly: true, now: () => new Date("2026-09-06T22:00:00.000Z") };
  const approved = authority(value);
  await executeThroughQualified(
    createV209CloudflareProductionOperator(value.configuration, dependencies),
    approved,
  );
  const oldConfig = JSON.parse(readFileSync(value.configuration.qualifiedConfigPath));
  const predecessorPath = resolve(value.directory, "bundled-prior-qualified.json");
  oldConfig.vars.VIDEOFORGE_COMMIT = "b".repeat(40);
  delete oldConfig.limits;
  const bytes = JSON.stringify(oldConfig);
  writeFileSync(predecessorPath, bytes, { mode: 0o600 });
  const artifactRootPath = resolve(value.directory, "bundled-prior-artifacts");
  mkdirSync(artifactRootPath, { mode: 0o700 });
  let artifactDirectory = artifactRootPath;
  for (const segment of ["apps", "web", "dist-cloudflare"]) {
    artifactDirectory = resolve(artifactDirectory, segment);
    mkdirSync(artifactDirectory, { mode: 0o700 });
    chmodSync(artifactDirectory, 0o700);
  }
  const workerDirectory = resolve(artifactDirectory, "videoforge_production_runtime");
  const assetDirectory = resolve(artifactDirectory, "client");
  mkdirSync(workerDirectory, { mode: 0o700 });
  mkdirSync(assetDirectory, { mode: 0o700 });
  chmodSync(workerDirectory, 0o700);
  chmodSync(assetDirectory, 0o700);
  const relocatedMain = resolve(workerDirectory, "index.js");
  writeFileSync(relocatedMain, 'import "./assets/chunk.js";\n', { mode: 0o600 });
  const workerAssetDirectory = resolve(workerDirectory, "assets");
  mkdirSync(workerAssetDirectory, { mode: 0o700 });
  chmodSync(workerAssetDirectory, 0o700);
  writeFileSync(resolve(workerAssetDirectory, "chunk.js"), "export const exact = true;\n", {
    mode: 0o600,
  });
  writeFileSync(resolve(assetDirectory, "index.html"), "sealed predecessor assets", {
    mode: 0o600,
  });
  let historicalLimitShape = "absent";
  let observedDryConfig;
  const runChild = async (input) => {
    if (input.args.includes("--dry-run")) {
      const configPath = input.args[input.args.indexOf("--config") + 1];
      const modulePath = input.args[input.args.indexOf("deploy") + 1];
      const assetsPath = input.args[input.args.indexOf("--assets") + 1];
      observedDryConfig = JSON.parse(readFileSync(configPath, "utf8"));
      assert.equal(observedDryConfig.no_bundle, false);
      assert.equal(observedDryConfig.main, oldConfig.main);
      assert.equal(observedDryConfig.assets.directory, oldConfig.assets.directory);
      assert.equal(readFileSync(modulePath, "utf8"), readFileSync(relocatedMain, "utf8"));
      assert.equal(
        readFileSync(resolve(assetsPath, "index.html"), "utf8"),
        "sealed predecessor assets",
      );
    }
    const result = await mock.runChild(input);
    if (input.args.includes("view")) {
      const observed = JSON.parse(result.stdout);
      observed.main = oldConfig.main;
      observed.assets = oldConfig.assets;
      observed.vars.VIDEOFORGE_COMMIT = oldConfig.vars.VIDEOFORGE_COMMIT;
      if (historicalLimitShape === "absent") delete observed.limits;
      if (historicalLimitShape === "present") observed.limits = { cpu_ms: 30_000 };
      return { ...result, stdout: JSON.stringify(observed) };
    }
    return result;
  };
  const fetchImpl = async (...args) => {
    const response = await mock.fetchImpl(...args);
    const body = await response.json();
    body.commit = oldConfig.vars.VIDEOFORGE_COMMIT;
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers: response.headers,
    });
  };
  const primitive = createV209CloudflareReplacementCapabilities(value.configuration, {
    ...dependencies,
    runChild,
    fetchImpl,
  });
  const predecessor = {
    versionId: VERSION_IDS[3],
    sourceCommit: oldConfig.vars.VIDEOFORGE_COMMIT,
    artifactRootPath,
    qualifiedConfigPath: predecessorPath,
    qualifiedConfigSha256: hash(bytes),
    workerBundleSha256: approved.production.worker_bundle_sha256,
  };
  const dryRunsBefore = mock.calls.filter(({ args }) => args.includes("--dry-run")).length;
  const observed = await primitive.predecessor(approved, predecessor);
  assert.equal(observed.versionIdSha256, hash(predecessor.versionId));
  assert.deepEqual(JSON.parse(readFileSync(predecessorPath, "utf8")), oldConfig);
  assert.ok(observedDryConfig);
  assert.equal(
    mock.calls.filter(({ args }) => args.includes("--dry-run")).length - dryRunsBefore,
    1,
  );
  historicalLimitShape = "present";
  await assert.rejects(
    primitive.predecessor(approved, predecessor),
    /ACTIVE_VERSION_CPU_LIMIT_DRIFT/u,
  );
});
