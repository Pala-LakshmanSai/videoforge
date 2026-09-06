import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runCancellableChildProcess } from "../v2-13/full-live-adapters.mjs";
import { validateReleaseManifest } from "./validate-qualified-production-config.mjs";

export const V209_MEDIA_WORKER_VERSION = "0.1.15";
export const V209_MEDIA_WORKER_TAG = "media-worker-v0.1.15";
export const V209_MEDIA_WORKER_WORKFLOW = ".github/workflows/media-worker-release.yml";
export const V209_MEDIA_WORKER_REPOSITORY = "Pala-LakshmanSai/videoforge";
export const V209_MEDIA_WORKER_SERVICE = "com.videoforge.personal-media-worker";
export const V209_MEDIA_WORKER_CONFIRMATION_SCHEMA =
  "videoforge.v2-09-media-worker-user-confirmation/v1";

const SOURCE_PATH = fileURLToPath(import.meta.url);
const RUN_CANCELLABLE_SOURCE_PATH = fileURLToPath(
  new URL("../v2-13/full-live-adapters.mjs", import.meta.url),
);
const RELEASE_VALIDATOR_SOURCE_PATH = fileURLToPath(
  new URL("./validate-qualified-production-config.mjs", import.meta.url),
);
const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const RELEASE_ASSET_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const REDIRECT_HOSTS = new Set([
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const PRODUCTION_FETCH = globalThis.fetch;
const RELEASE_ASSET_NAMES = Object.freeze([
  "VideoForge-Worker-0.1.15-Setup.exe",
  "VideoForge-Worker-0.1.15.dmg",
  "media-worker-release.json",
]);
const WORKFLOW_TIMEOUT_MS = 90 * 60_000;
const DOWNLOAD_TIMEOUT_MS = 30 * 60_000;
const HEARTBEAT_TIMEOUT_MS = 3 * 60_000;
const MAX_JSON_BYTES = 1024 * 1024;
const DEFAULT_CHILD_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const REQUIRED_POSTGRES_ENVIRONMENT_KEYS = Object.freeze([
  "PGDATABASE",
  "PGHOST",
  "PGPASSWORD",
  "PGPORT",
  "PGSSLMODE",
  "PGUSER",
]);

function fail(code) {
  throw new Error(`V2_09_MEDIA_WORKER_${code}`);
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export const V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256 = sha256(
  canonical({
    bundle_identifier: "com.videoforge.personal-media-worker",
    signature: "adhoc",
    trust: "AD_HOC_BETA",
  }),
);

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function parseHttps(value, code, hosts) {
  if (typeof value !== "string" || value === "" || value.trim() !== value) fail(code);
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail(code);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== "" ||
    parsed.hash !== "" ||
    (hosts && !hosts.has(parsed.hostname))
  )
    fail(code);
  return parsed;
}

function nowDate(clock) {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) fail("CLOCK_INVALID");
  return value;
}

function parseTime(value, code) {
  if (typeof value !== "string") fail(code);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) fail(code);
  return parsed;
}

function assertAuthority(authority, sourceCommit, clock, { cleanup = false } = {}) {
  if (
    authority === null ||
    typeof authority !== "object" ||
    authority.source_commit !== sourceCommit ||
    !COMMIT.test(sourceCommit) ||
    authority.media_worker?.release !== V209_MEDIA_WORKER_VERSION ||
    !HASH.test(authority.media_worker?.execution_bundle_sha256 ?? "") ||
    !HASH.test(authority.media_worker?.whisper_model_sha256 ?? "") ||
    !HASH.test(authority.media_worker?.release_manifest_sha256 ?? "") ||
    !HASH.test(authority.media_worker?.installer_asset_sha256 ?? "") ||
    !HASH.test(authority.media_worker?.signing_identity_sha256 ?? "") ||
    authority.scope?.media_worker_release !== V209_MEDIA_WORKER_VERSION ||
    authority.scope?.allow_model_download !== false ||
    authority.scope?.allow_stage_6_or_7_qualification !== false ||
    authority.scope?.cleanup_only_recovery !== true
  )
    fail("AUTHORITY_INVALID");
  const issuedAt = parseTime(authority.issued_at, "AUTHORITY_TIME_INVALID");
  const expiresAt = parseTime(authority.expires_at, "AUTHORITY_TIME_INVALID");
  const observedAt = nowDate(clock).getTime();
  if (expiresAt <= issuedAt || observedAt < issuedAt || (!cleanup && observedAt >= expiresAt))
    fail("AUTHORITY_NOT_CURRENT");
  return authority.media_worker;
}

function assertEnvironmentValue(value, code, { maxBytes = 16 * 1024 } = {}) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.includes("\0") ||
    Buffer.byteLength(value) > maxBytes
  )
    fail(code);
  return value;
}

function sanitizedChildEnvironment(inputEnvironment, expectedHome) {
  if (
    inputEnvironment === null ||
    typeof inputEnvironment !== "object" ||
    Array.isArray(inputEnvironment)
  )
    fail("ENVIRONMENT_INVALID");
  const postgres = Object.fromEntries(
    REQUIRED_POSTGRES_ENVIRONMENT_KEYS.map((key) => [
      key,
      assertEnvironmentValue(inputEnvironment[key], "POSTGRES_ENVIRONMENT_INVALID"),
    ]),
  );
  const path = assertEnvironmentValue(
    inputEnvironment.PATH ?? DEFAULT_CHILD_PATH,
    "PATH_ENVIRONMENT_INVALID",
    { maxBytes: 8192 },
  );
  const githubConfigDirectory = resolve(
    inputEnvironment.GH_CONFIG_DIR ?? join(expectedHome, ".config", "gh"),
  );
  if (
    githubConfigDirectory === "/" ||
    !isAbsolute(githubConfigDirectory) ||
    (inputEnvironment.GH_CONFIG_DIR !== undefined && !isAbsolute(inputEnvironment.GH_CONFIG_DIR)) ||
    (inputEnvironment.GH_HOST !== undefined && inputEnvironment.GH_HOST !== "github.com")
  )
    fail("GITHUB_ENVIRONMENT_INVALID");
  return Object.freeze({
    HOME: expectedHome,
    LANG: "C",
    LC_ALL: "C",
    PATH: path,
    GH_CONFIG_DIR: githubConfigDirectory,
    GH_HOST: "github.com",
    ...postgres,
  });
}

function protectedCredentialIdentity(path, hostUid, code) {
  if (path === "/" || !isAbsolute(path) || !existsSync(path)) fail(code);
  const parent = lstatSync(dirname(path));
  const stat = lstatSync(path);
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (parent.mode & 0o022) !== 0 ||
    parent.uid !== hostUid ||
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    stat.uid !== hostUid ||
    stat.size <= 0 ||
    stat.size > MAX_JSON_BYTES
  )
    fail(code);
  return Object.freeze({
    path,
    device: stat.dev,
    inode: stat.ino,
    mode: stat.mode & 0o777,
    owner_uid: stat.uid,
    size_bytes: stat.size,
    modified_at_ms: stat.mtimeMs,
  });
}

function assertCredentialIdentity(current, expected, code) {
  if (current !== expected.path) fail(code);
  const observed = protectedCredentialIdentity(expected.path, expected.owner_uid, code);
  if (canonical(observed) !== canonical(expected)) fail(code);
}

function assertConfiguration(configuration, hostHome, hostUid) {
  if (
    configuration === null ||
    typeof configuration !== "object" ||
    configuration.repository !== V209_MEDIA_WORKER_REPOSITORY ||
    configuration.workflowPath !== V209_MEDIA_WORKER_WORKFLOW ||
    configuration.releaseTag !== V209_MEDIA_WORKER_TAG ||
    configuration.version !== V209_MEDIA_WORKER_VERSION ||
    !COMMIT.test(configuration.sourceCommit ?? "") ||
    configuration.branch !== "codex/serverless-v2-roadmap-v4" ||
    typeof configuration.root !== "string" ||
    !isAbsolute(configuration.root) ||
    typeof configuration.databaseCredentialPath !== "string" ||
    !isAbsolute(configuration.databaseCredentialPath) ||
    typeof configuration.controlPlaneOrigin !== "string"
  )
    fail("CONFIGURATION_INVALID");
  const origin = parseHttps(configuration.controlPlaneOrigin, "CONTROL_PLANE_ORIGIN_INVALID");
  if (origin.pathname !== "/" || origin.search !== "") fail("CONTROL_PLANE_ORIGIN_INVALID");
  const expectedHome = resolve(hostHome);
  const paths = {
    applicationPath: resolve(configuration.applicationPath),
    databaseCredentialPath: resolve(configuration.databaseCredentialPath),
    statePath: resolve(configuration.statePath),
    launchAgentPath: resolve(configuration.launchAgentPath),
    manifestPath: resolve(configuration.manifestPath),
    workRoot: resolve(configuration.workRoot),
  };
  const environment = sanitizedChildEnvironment(configuration.environment, expectedHome);
  const githubCredentialPath = resolve(environment.GH_CONFIG_DIR, "hosts.yml");
  if (
    paths.applicationPath !== join(expectedHome, "Applications", "VideoForge Worker.app") ||
    paths.statePath !==
      join(
        expectedHome,
        "Library",
        "Application Support",
        "VideoForge Worker",
        "installation.json",
      ) ||
    paths.launchAgentPath !==
      join(expectedHome, "Library", "LaunchAgents", `${V209_MEDIA_WORKER_SERVICE}.plist`) ||
    paths.databaseCredentialPath === "/" ||
    !isAbsolute(paths.databaseCredentialPath) ||
    paths.manifestPath === "/" ||
    paths.workRoot === "/" ||
    !paths.manifestPath.startsWith(`${expectedHome}/`) ||
    !paths.workRoot.startsWith(`${expectedHome}/`)
  )
    fail("PATH_CONFIGURATION_INVALID");
  const credentialIdentities = Object.freeze({
    database: protectedCredentialIdentity(
      paths.databaseCredentialPath,
      hostUid,
      "DATABASE_CREDENTIAL_PATH_INVALID",
    ),
    github: protectedCredentialIdentity(
      githubCredentialPath,
      hostUid,
      "GITHUB_CREDENTIAL_PATH_INVALID",
    ),
  });
  // Capture only validated scalar fields plus separately frozen records. No caller-owned object,
  // array, environment, or other nested reference survives factory construction.
  return Object.freeze({
    repository: configuration.repository,
    workflowPath: configuration.workflowPath,
    releaseTag: configuration.releaseTag,
    version: configuration.version,
    sourceCommit: configuration.sourceCommit,
    branch: configuration.branch,
    root: configuration.root,
    databaseCredentialPath: paths.databaseCredentialPath,
    applicationPath: paths.applicationPath,
    statePath: paths.statePath,
    launchAgentPath: paths.launchAgentPath,
    manifestPath: paths.manifestPath,
    workRoot: paths.workRoot,
    controlPlaneOrigin: origin.origin,
    environment,
    githubCredentialPath,
    credentialIdentities,
  });
}

function assertPrivateParent(path) {
  const parent = dirname(path);
  const stat = lstatSync(parent);
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("PRIVATE_PARENT_INVALID");
}

function writePrivateAtomic(path, bytes) {
  assertPrivateParent(path);
  const temporary = `${path}.v209-next`;
  if (existsSync(temporary)) fail("TEMPORARY_FILE_EXISTS");
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o600,
    );
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  renameSync(temporary, path);
  const directory = openSync(dirname(path), fsConstants.O_RDONLY);
  try {
    fsyncSync(directory);
  } finally {
    closeSync(directory);
  }
}

async function runExact(runChild, configuration, command, args, code, options = {}) {
  if (command === "gh")
    assertCredentialIdentity(
      configuration.githubCredentialPath,
      configuration.credentialIdentities.github,
      "GITHUB_CREDENTIAL_PATH_DRIFT",
    );
  if (command === "psql")
    assertCredentialIdentity(
      configuration.databaseCredentialPath,
      configuration.credentialIdentities.database,
      "DATABASE_CREDENTIAL_PATH_DRIFT",
    );
  const result = await runChild({
    command,
    args,
    timeoutMs: options.timeoutMs ?? 10 * 60_000,
    cancellationSignal: options.cancellationSignal,
    timeoutCode: `${code}_TIMEOUT`,
    cancellationCode: `${code}_CANCELLED`,
    executionCode: `${code}_FAILED`,
    options: {
      cwd: configuration.root,
      env: configuration.environment,
      input: options.input,
      maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    },
  });
  if (result.status !== 0 || result.signal !== null) fail(code);
  return (options.readStderr ? result.stderr : result.stdout).trim();
}

function parseJson(text, code) {
  try {
    return JSON.parse(text);
  } catch {
    fail(code);
  }
}

async function fetchBoundedJson(fetchImpl, url, code) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VideoForge-V2-09-media-worker-operator",
      },
    });
    if (!response || response.status !== 200) fail(`${code}_STATUS`);
    const length = response.headers?.get?.("content-length");
    if (length && (!/^\d+$/u.test(length) || Number(length) > MAX_JSON_BYTES)) fail(`${code}_SIZE`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_JSON_BYTES) fail(`${code}_SIZE`);
    return parseJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes), `${code}_JSON`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_09_MEDIA_WORKER_")) throw error;
    fail(code);
  } finally {
    clearTimeout(timer);
  }
}

async function releaseStatus(fetchImpl, url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VideoForge-V2-09-media-worker-operator",
      },
    });
    return response?.status;
  } finally {
    clearTimeout(timer);
  }
}

function releaseUrls(configuration) {
  const repository = configuration.repository;
  const tag = configuration.releaseTag;
  return Object.freeze({
    api: `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
    html: `https://github.com/${repository}/releases/tag/${tag}`,
    manifest: `https://github.com/${repository}/releases/download/${tag}/media-worker-release.json`,
  });
}

function validateRelease(release, configuration, mediaWorker) {
  const urls = releaseUrls(configuration);
  if (
    release === null ||
    typeof release !== "object" ||
    release.tag_name !== configuration.releaseTag ||
    release.target_commitish !== configuration.sourceCommit ||
    release.html_url !== urls.html ||
    release.draft !== false ||
    release.prerelease !== false ||
    release.immutable !== true ||
    !Array.isArray(release.assets)
  )
    fail("RELEASE_METADATA_INVALID");
  const assets = new Map();
  for (const asset of release.assets) {
    if (
      asset === null ||
      typeof asset !== "object" ||
      typeof asset.name !== "string" ||
      assets.has(asset.name)
    )
      fail("RELEASE_ASSET_INVALID");
    assets.set(asset.name, asset);
  }
  if (
    assets.size !== RELEASE_ASSET_NAMES.length ||
    RELEASE_ASSET_NAMES.some((name) => !assets.has(name))
  )
    fail("RELEASE_ASSET_SET_INVALID");
  for (const name of RELEASE_ASSET_NAMES) {
    const asset = assets.get(name);
    const expectedUrl = `https://github.com/${configuration.repository}/releases/download/${configuration.releaseTag}/${name}`;
    if (
      asset.name !== name ||
      !Number.isSafeInteger(asset.size) ||
      asset.size <= 0 ||
      !HASH.test(asset.digest ?? "") ||
      asset.state !== "uploaded" ||
      asset.browser_download_url !== expectedUrl
    )
      fail("RELEASE_ASSET_INVALID");
  }
  const manifestAsset = assets.get("media-worker-release.json");
  const macosAsset = assets.get("VideoForge-Worker-0.1.15.dmg");
  if (
    manifestAsset.digest !== mediaWorker.release_manifest_sha256 ||
    macosAsset.digest !== mediaWorker.installer_asset_sha256
  )
    fail("RELEASE_AUTHORITY_DRIFT");
  return Object.freeze({ assets, manifestAsset, macosAsset, urls });
}

async function fetchSmallAsset(fetchImpl, url, expectedSize, expectedSha256) {
  let current = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    for (let redirects = 0; redirects <= 1; redirects += 1) {
      const parsed = parseHttps(current, "ASSET_URL_INVALID", RELEASE_ASSET_HOSTS);
      const response = await fetchImpl(parsed.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "VideoForge-V2-09-media-worker-operator" },
      });
      if (response && REDIRECT_STATUS.has(response.status)) {
        if (redirects === 1) fail("ASSET_REDIRECT_LIMIT");
        const location = response.headers?.get?.("location");
        const destination = new URL(location ?? "", parsed.href);
        if (
          destination.protocol !== "https:" ||
          destination.username !== "" ||
          destination.password !== "" ||
          destination.port !== "" ||
          !REDIRECT_HOSTS.has(destination.hostname)
        )
          fail("ASSET_REDIRECT_INVALID");
        current = destination.href;
        continue;
      }
      if (!response || response.status !== 200) fail("ASSET_DOWNLOAD_STATUS");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.byteLength !== expectedSize || sha256(bytes) !== expectedSha256)
        fail("ASSET_DOWNLOAD_IDENTITY_INVALID");
      return bytes;
    }
    fail("ASSET_REDIRECT_LIMIT");
  } finally {
    clearTimeout(timer);
  }
}

async function inspectRelease({ configuration, authority, fetchImpl, clock }) {
  const mediaWorker = assertAuthority(authority, configuration.sourceCommit, clock);
  const urls = releaseUrls(configuration);
  const release = await fetchBoundedJson(fetchImpl, urls.api, "RELEASE_READBACK");
  const validated = validateRelease(release, configuration, mediaWorker);
  const manifestBytes = await fetchSmallAsset(
    fetchImpl,
    urls.manifest,
    validated.manifestAsset.size,
    mediaWorker.release_manifest_sha256,
  );
  const manifest = validateReleaseManifest(manifestBytes, mediaWorker.release_manifest_sha256);
  if (
    manifest.version !== V209_MEDIA_WORKER_VERSION ||
    manifest.execution_bundle_sha256 !== mediaWorker.execution_bundle_sha256 ||
    manifest.whisper_model_sha256 !== mediaWorker.whisper_model_sha256 ||
    manifest.macos.sha256 !== mediaWorker.installer_asset_sha256
  )
    fail("MANIFEST_AUTHORITY_DRIFT");
  for (const [platform, name] of [
    ["windows", "VideoForge-Worker-0.1.15-Setup.exe"],
    ["macos", "VideoForge-Worker-0.1.15.dmg"],
  ]) {
    const asset = validated.assets.get(name);
    if (
      manifest[platform].sha256 !== asset.digest ||
      manifest[platform].size_bytes !== asset.size ||
      manifest[platform].url !== asset.browser_download_url
    )
      fail("MANIFEST_ASSET_DRIFT");
  }
  return Object.freeze({
    release,
    manifest,
    manifestBytes,
    assets: validated.assets,
    releaseAssetCount: validated.assets.size,
  });
}

async function workflowRuns(runChild, configuration, cancellationSignal) {
  const endpoint = `repos/${configuration.repository}/actions/workflows/media-worker-release.yml/runs?event=workflow_dispatch&head_sha=${configuration.sourceCommit}&per_page=100`;
  const text = await runExact(
    runChild,
    configuration,
    "gh",
    ["api", endpoint],
    "WORKFLOW_RUN_READ",
    { cancellationSignal },
  );
  const value = parseJson(text, "WORKFLOW_RUN_READ_JSON");
  if (!Array.isArray(value.workflow_runs)) fail("WORKFLOW_RUN_READ_INVALID");
  return value.workflow_runs.filter(
    (run) =>
      run?.head_sha === configuration.sourceCommit &&
      run?.head_branch === configuration.branch &&
      run?.event === "workflow_dispatch" &&
      run?.path === `${configuration.workflowPath}@refs/heads/${configuration.branch}`,
  );
}

async function publishMediaWorker(context, { configuration, runChild, fetchImpl, clock, sleep }) {
  if (context.operationId !== "publish-media-worker-0.1.15") fail("OPERATION_ID_INVALID");
  const mediaWorker = assertAuthority(context.authority, configuration.sourceCommit, clock);
  const urls = releaseUrls(configuration);
  const status = await releaseStatus(fetchImpl, urls.api);
  if (status === 200) {
    const exact = await inspectRelease({
      configuration,
      authority: context.authority,
      fetchImpl,
      clock,
    });
    return Object.freeze({
      schema_version: "videoforge.v2-09-media-worker-publication-result/v1",
      operation_id: context.operationId,
      mode: "REUSED_EXACT_EXISTING",
      release: V209_MEDIA_WORKER_VERSION,
      execution_bundle_sha256: mediaWorker.execution_bundle_sha256,
      whisper_model_sha256: mediaWorker.whisper_model_sha256,
      release_manifest_sha256: mediaWorker.release_manifest_sha256,
      installer_asset_sha256: mediaWorker.installer_asset_sha256,
      immutable_release: exact.release.immutable === true,
      publish_count: 0,
    });
  }
  if (status !== 404) fail("RELEASE_ABSENCE_UNCONFIRMED");
  const before = await workflowRuns(runChild, configuration, context.operation?.cancellationSignal);
  if (before.length !== 0) fail("WORKFLOW_SOURCE_ALREADY_DISPATCHED");
  assertAuthority(context.authority, configuration.sourceCommit, clock);
  const body = canonical({
    ref: configuration.branch,
    inputs: {
      control_plane_origin: configuration.controlPlaneOrigin,
      execution_bundle_sha256: mediaWorker.execution_bundle_sha256,
      whisper_model_sha256: mediaWorker.whisper_model_sha256,
      signed_release: "false",
      publish_release: "true",
      release_tag: configuration.releaseTag,
    },
  });
  await runExact(
    runChild,
    configuration,
    "gh",
    [
      "api",
      "--method",
      "POST",
      `repos/${configuration.repository}/actions/workflows/media-worker-release.yml/dispatches`,
      "--input",
      "-",
    ],
    "WORKFLOW_DISPATCH",
    { cancellationSignal: context.operation?.cancellationSignal, input: body },
  );
  const startedAt = nowDate(clock).getTime();
  let selected;
  for (;;) {
    const runs = await workflowRuns(runChild, configuration, context.operation?.cancellationSignal);
    if (runs.length > 1) fail("WORKFLOW_DISPATCH_AMBIGUOUS");
    selected = runs[0];
    if (selected) {
      const createdAt = parseTime(selected.created_at, "WORKFLOW_RUN_TIME_INVALID");
      if (createdAt > startedAt + 60_000 || createdAt < startedAt - 5 * 60_000)
        fail("WORKFLOW_RUN_TIME_INVALID");
      if (selected.status === "completed") {
        if (selected.conclusion !== "success") fail("WORKFLOW_RUN_FAILED");
        break;
      }
      if (!new Set(["queued", "in_progress", "pending", "waiting"]).has(selected.status))
        fail("WORKFLOW_RUN_STATUS_INVALID");
    }
    if (nowDate(clock).getTime() - startedAt >= WORKFLOW_TIMEOUT_MS) fail("WORKFLOW_TIMEOUT");
    await sleep(5_000);
  }
  const exact = await inspectRelease({
    configuration,
    authority: context.authority,
    fetchImpl,
    clock,
  });
  if (selected.head_sha !== configuration.sourceCommit || selected.run_attempt !== 1)
    fail("WORKFLOW_RUN_IDENTITY_INVALID");
  return Object.freeze({
    schema_version: "videoforge.v2-09-media-worker-publication-result/v1",
    operation_id: context.operationId,
    mode: "PUBLISHED_ONCE",
    release: V209_MEDIA_WORKER_VERSION,
    execution_bundle_sha256: mediaWorker.execution_bundle_sha256,
    whisper_model_sha256: mediaWorker.whisper_model_sha256,
    release_manifest_sha256: mediaWorker.release_manifest_sha256,
    installer_asset_sha256: mediaWorker.installer_asset_sha256,
    immutable_release: exact.release.immutable === true,
    publish_count: 1,
  });
}

async function readbackMediaWorker(context, { configuration, fetchImpl, clock }) {
  if (context.operationId !== "readback-media-worker-0.1.15") fail("OPERATION_ID_INVALID");
  const mediaWorker = assertAuthority(context.authority, configuration.sourceCommit, clock);
  const exact = await inspectRelease({
    configuration,
    authority: context.authority,
    fetchImpl,
    clock,
  });
  assertAuthority(context.authority, configuration.sourceCommit, clock);
  writePrivateAtomic(configuration.manifestPath, exact.manifestBytes);
  return Object.freeze({
    schema_version: "videoforge.v2-09-media-worker-readback-result/v1",
    operation_id: context.operationId,
    release: V209_MEDIA_WORKER_VERSION,
    execution_bundle_sha256: mediaWorker.execution_bundle_sha256,
    whisper_model_sha256: mediaWorker.whisper_model_sha256,
    release_manifest_sha256: mediaWorker.release_manifest_sha256,
    installer_asset_sha256: mediaWorker.installer_asset_sha256,
    immutable_readback: exact.release.immutable === true,
    release_asset_count: exact.releaseAssetCount,
  });
}

export class V209MediaWorkerUserConfirmationRequired extends Error {
  constructor(checkpoint) {
    super("V2_09_MEDIA_WORKER_USER_CONFIRMATION_REQUIRED");
    this.name = "V209MediaWorkerUserConfirmationRequired";
    this.checkpoint = Object.freeze(checkpoint);
  }
}

function readInstallationState(configuration) {
  if (!existsSync(configuration.statePath)) return null;
  const stat = lstatSync(configuration.statePath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("INSTALLATION_STATE_INVALID");
  const bytes = readFileSync(configuration.statePath);
  const value = parseJson(bytes.toString("utf8"), "INSTALLATION_STATE_JSON_INVALID");
  if (
    value === null ||
    typeof value !== "object" ||
    !UUID.test(value.installation_id ?? "") ||
    Object.entries(value).some(([key, item]) => typeof key !== "string" || typeof item !== "string")
  )
    fail("INSTALLATION_STATE_INVALID");
  return Object.freeze({ bytes, installationId: value.installation_id, sha256: sha256(bytes) });
}

async function keychainEntryExists(runChild, configuration, installationId, cancellationSignal) {
  const result = await runChild({
    command: "/usr/bin/security",
    args: ["find-generic-password", "-s", V209_MEDIA_WORKER_SERVICE, "-a", installationId],
    timeoutMs: 15_000,
    cancellationSignal,
    timeoutCode: "V2_09_MEDIA_WORKER_KEYCHAIN_TIMEOUT",
    cancellationCode: "V2_09_MEDIA_WORKER_KEYCHAIN_CANCELLED",
    executionCode: "V2_09_MEDIA_WORKER_KEYCHAIN_FAILED",
    options: {
      cwd: configuration.root,
      env: configuration.environment,
      maxBuffer: 64 * 1024,
    },
  });
  // Deliberately omit `-w`: the credential value is never read or returned.
  return result.status === 0 && result.signal === null;
}

function confirmationCheckpoint(configuration, authority, reason, identities) {
  return {
    schema_version: V209_MEDIA_WORKER_CONFIRMATION_SCHEMA,
    state: "USER_CONFIRMATION_REQUIRED",
    authority_id: authority.authority_id,
    source_commit: configuration.sourceCommit,
    configuration_sha256: identities.configurationSha256,
    install_port_source_sha256: identities.installMediaWorker,
    release: V209_MEDIA_WORKER_VERSION,
    reason,
    remote_mutations: 0,
    local_install_mutations: 0,
    credential_values_read: 0,
  };
}

function walkFiles(root) {
  const files = [];
  const visit = (path) => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name));
    } else if (stat.isFile()) files.push(path);
  };
  visit(root);
  return files;
}

async function verifyAppBundle(
  runChild,
  configuration,
  appPath,
  cancellationSignal,
  { allowStaging = false } = {},
) {
  const name = basename(appPath);
  if (
    resolve(appPath) !== appPath ||
    !(
      name === "VideoForge Worker.app" ||
      (allowStaging && /^\.VideoForge Worker\.app\.v2-09-[a-z0-9._-]+\.staging$/u.test(name))
    )
  )
    fail("APP_PATH_INVALID");
  const stat = lstatSync(appPath);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail("APP_PATH_INVALID");
  await runExact(
    runChild,
    configuration,
    "/usr/bin/codesign",
    ["--verify", "--deep", "--strict", "--verbose=2", appPath],
    "APP_CODE_SIGNATURE_INVALID",
    { cancellationSignal },
  );
  const signature = await runExact(
    runChild,
    configuration,
    "/usr/bin/codesign",
    ["-d", "--verbose=4", appPath],
    "APP_CODE_SIGNATURE_READ_INVALID",
    { cancellationSignal, readStderr: true },
  );
  if (
    !signature.includes("Signature=adhoc") ||
    !signature.includes("Identifier=com.videoforge.personal-media-worker")
  )
    fail("APP_CODE_SIGNATURE_IDENTITY_INVALID");
  const version = await runExact(
    runChild,
    configuration,
    "/usr/libexec/PlistBuddy",
    ["-c", "Print :CFBundleShortVersionString", join(appPath, "Contents", "Info.plist")],
    "APP_VERSION_INVALID",
    { cancellationSignal },
  );
  if (version !== V209_MEDIA_WORKER_VERSION) fail("APP_VERSION_INVALID");
  let machoCount = 0;
  for (const file of walkFiles(appPath)) {
    const output = await runExact(
      runChild,
      configuration,
      "/usr/bin/file",
      [file],
      "APP_FILE_INSPECTION_FAILED",
      { cancellationSignal },
    );
    if (!output.includes("Mach-O")) continue;
    machoCount += 1;
    await runExact(
      runChild,
      configuration,
      "/usr/bin/lipo",
      [file, "-verify_arch", "arm64", "x86_64"],
      "APP_NOT_UNIVERSAL2",
      { cancellationSignal },
    );
  }
  if (machoCount === 0) fail("APP_MACHO_MISSING");
  const signingIdentitySha256 = V209_MEDIA_WORKER_ADHOC_SIGNING_IDENTITY_SHA256;
  return Object.freeze({ machoCount, signingIdentitySha256, version });
}

async function downloadLargeAsset(fetchImpl, url, destination, expectedSize, expectedSha256) {
  let current = url;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    for (let redirects = 0; redirects <= 1; redirects += 1) {
      const parsed = parseHttps(current, "INSTALLER_URL_INVALID", RELEASE_ASSET_HOSTS);
      const response = await fetchImpl(parsed.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: { "User-Agent": "VideoForge-V2-09-media-worker-operator" },
      });
      if (response && REDIRECT_STATUS.has(response.status)) {
        if (redirects === 1) fail("INSTALLER_REDIRECT_LIMIT");
        const destinationUrl = new URL(response.headers?.get?.("location") ?? "", parsed.href);
        if (
          destinationUrl.protocol !== "https:" ||
          destinationUrl.username !== "" ||
          destinationUrl.password !== "" ||
          destinationUrl.port !== "" ||
          !REDIRECT_HOSTS.has(destinationUrl.hostname)
        )
          fail("INSTALLER_REDIRECT_INVALID");
        current = destinationUrl.href;
        continue;
      }
      if (!response || response.status !== 200 || !response.body?.getReader)
        fail("INSTALLER_DOWNLOAD_FAILED");
      let descriptor;
      const digest = createHash("sha256");
      let size = 0;
      try {
        descriptor = openSync(
          destination,
          fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
          0o600,
        );
        const reader = response.body.getReader();
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array)) fail("INSTALLER_DOWNLOAD_FAILED");
          size += chunk.value.byteLength;
          if (!Number.isSafeInteger(size) || size > expectedSize) fail("INSTALLER_SIZE_INVALID");
          digest.update(chunk.value);
          writeFileSync(descriptor, chunk.value);
        }
        fsyncSync(descriptor);
      } finally {
        if (descriptor !== undefined) closeSync(descriptor);
      }
      if (size !== expectedSize || `sha256:${digest.digest("hex")}` !== expectedSha256)
        fail("INSTALLER_IDENTITY_INVALID");
      return;
    }
    fail("INSTALLER_REDIRECT_LIMIT");
  } finally {
    clearTimeout(timer);
  }
}

async function readOnlineHeartbeat(
  runChild,
  configuration,
  installationId,
  executionBundleSha256,
  clock,
  sleep,
  cancellationSignal,
) {
  const started = nowDate(clock).getTime();
  const sql = `SELECT json_build_object('installation_id', installation_id, 'platform', platform, 'architecture', architecture, 'worker_version', worker_version, 'protocol_version', protocol_version, 'execution_bundle_sha256', execution_bundle_sha256, 'status', status, 'last_seen_at', to_char(last_seen_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))::text FROM media_worker_devices WHERE installation_id = '${installationId}' AND worker_version = '${V209_MEDIA_WORKER_VERSION}' AND execution_bundle_sha256 = '${executionBundleSha256}' AND status = 'ONLINE' AND last_seen_at >= now() - interval '90 seconds';`;
  for (;;) {
    const output = await runExact(
      runChild,
      configuration,
      "psql",
      ["--no-psqlrc", "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align", "--command", sql],
      "HEARTBEAT_READ_FAILED",
      { cancellationSignal },
    );
    if (output !== "") {
      const heartbeat = parseJson(output, "HEARTBEAT_JSON_INVALID");
      if (
        !exactKeys(heartbeat, [
          "architecture",
          "execution_bundle_sha256",
          "installation_id",
          "last_seen_at",
          "platform",
          "protocol_version",
          "status",
          "worker_version",
        ]) ||
        heartbeat.installation_id !== installationId ||
        heartbeat.platform !== "MACOS" ||
        !["AARCH64", "X86_64"].includes(heartbeat.architecture) ||
        heartbeat.worker_version !== V209_MEDIA_WORKER_VERSION ||
        heartbeat.protocol_version !== 1 ||
        heartbeat.execution_bundle_sha256 !== executionBundleSha256 ||
        heartbeat.status !== "ONLINE" ||
        Math.abs(
          nowDate(clock).getTime() - parseTime(heartbeat.last_seen_at, "HEARTBEAT_TIME_INVALID"),
        ) > 90_000
      )
        fail("HEARTBEAT_INVALID");
      return heartbeat;
    }
    if (nowDate(clock).getTime() - started >= HEARTBEAT_TIMEOUT_MS) fail("HEARTBEAT_TIMEOUT");
    await sleep(2_000);
  }
}

function safeRemoveExact(path, parent, suffix) {
  const resolved = resolve(path);
  if (dirname(resolved) !== resolve(parent) || !basename(resolved).endsWith(suffix))
    fail("CLEANUP_PATH_INVALID");
  rmSync(resolved, { force: true, recursive: true });
}

async function verifyExistingLaunchAgent(runChild, configuration, cancellationSignal) {
  if (!existsSync(configuration.launchAgentPath)) fail("LAUNCH_AGENT_MISSING");
  const stat = lstatSync(configuration.launchAgentPath);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    (stat.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("LAUNCH_AGENT_INVALID");
  const expected = [
    [":Label", V209_MEDIA_WORKER_SERVICE],
    [
      ":ProgramArguments:0",
      join(configuration.applicationPath, "Contents", "MacOS", "VideoForge Worker"),
    ],
    [":ProgramArguments:1", "--background"],
    [":RunAtLoad", "true"],
  ];
  for (const [key, value] of expected) {
    const actual = await runExact(
      runChild,
      configuration,
      "/usr/libexec/PlistBuddy",
      ["-c", `Print ${key}`, configuration.launchAgentPath],
      "LAUNCH_AGENT_INVALID",
      { cancellationSignal },
    );
    if (actual !== value) fail("LAUNCH_AGENT_INVALID");
  }
}

async function installMediaWorker(
  context,
  { configuration, runChild, fetchImpl, clock, sleep, hostPlatform, hostUid, movePath, identities },
) {
  if (context.operationId !== "install-media-worker-0.1.15") fail("OPERATION_ID_INVALID");
  const mediaWorker = assertAuthority(context.authority, configuration.sourceCommit, clock);
  if (hostPlatform !== "darwin" || !Number.isSafeInteger(hostUid) || hostUid < 0)
    fail("MACOS_REQUIRED");
  const installation = readInstallationState(configuration);
  if (!installation)
    throw new V209MediaWorkerUserConfirmationRequired(
      confirmationCheckpoint(
        configuration,
        context.authority,
        "INSTALLATION_STATE_MISSING",
        identities,
      ),
    );
  const keychainPresent = installation
    ? await keychainEntryExists(
        runChild,
        configuration,
        installation.installationId,
        context.operation?.cancellationSignal,
      )
    : false;
  if (!keychainPresent)
    throw new V209MediaWorkerUserConfirmationRequired(
      confirmationCheckpoint(
        configuration,
        context.authority,
        "PAIRED_KEYCHAIN_ENTRY_MISSING",
        identities,
      ),
    );
  if (!existsSync(configuration.launchAgentPath))
    throw new V209MediaWorkerUserConfirmationRequired(
      confirmationCheckpoint(configuration, context.authority, "LAUNCH_AGENT_MISSING", identities),
    );
  await verifyExistingLaunchAgent(runChild, configuration, context.operation?.cancellationSignal);
  const exact = await inspectRelease({
    configuration,
    authority: context.authority,
    fetchImpl,
    clock,
  });
  if (exact.manifest.macos.trust !== "AD_HOC_BETA") fail("MACOS_TRUST_INVALID");
  assertAuthority(context.authority, configuration.sourceCommit, clock);
  if (!existsSync(configuration.workRoot)) mkdirSync(configuration.workRoot, { mode: 0o700 });
  const rootStat = lstatSync(configuration.workRoot);
  if (
    !rootStat.isDirectory() ||
    rootStat.isSymbolicLink() ||
    (rootStat.mode & 0o077) !== 0 ||
    (typeof process.getuid === "function" && rootStat.uid !== process.getuid())
  )
    fail("WORK_ROOT_INVALID");
  const work = mkdtempSync(join(configuration.workRoot, "install-"));
  const dmg = join(work, "VideoForge-Worker-0.1.15.dmg");
  const mount = join(work, "mount");
  mkdirSync(mount, { mode: 0o700 });
  const targetParent = dirname(configuration.applicationPath);
  const suffix = `.${context.authority.authority_id}`;
  const staging = join(targetParent, `.VideoForge Worker.app${suffix}.staging`);
  const backup = join(targetParent, `.VideoForge Worker.app${suffix}.backup`);
  let mounted = false;
  let serviceWasLoaded = false;
  let serviceStopped = false;
  let backupRenamed = false;
  let newInstalled = false;
  let newServiceBootstrapAttempted = false;
  let hadExisting = false;
  try {
    await downloadLargeAsset(
      fetchImpl,
      exact.manifest.macos.url,
      dmg,
      exact.manifest.macos.size_bytes,
      mediaWorker.installer_asset_sha256,
    );
    await runExact(runChild, configuration, "/usr/bin/hdiutil", ["verify", dmg], "DMG_INVALID", {
      cancellationSignal: context.operation?.cancellationSignal,
    });
    assertAuthority(context.authority, configuration.sourceCommit, clock);
    await runExact(
      runChild,
      configuration,
      "/usr/bin/hdiutil",
      ["attach", "-nobrowse", "-readonly", "-mountpoint", mount, dmg],
      "DMG_ATTACH_FAILED",
      { cancellationSignal: context.operation?.cancellationSignal },
    );
    mounted = true;
    const sourceApp = join(mount, "VideoForge Worker.app");
    const verified = await verifyAppBundle(
      runChild,
      configuration,
      sourceApp,
      context.operation?.cancellationSignal,
    );
    if (verified.signingIdentitySha256 !== mediaWorker.signing_identity_sha256)
      fail("SIGNING_IDENTITY_DRIFT");
    if (existsSync(staging) || existsSync(backup)) fail("INSTALL_STAGING_EXISTS");
    assertAuthority(context.authority, configuration.sourceCommit, clock);
    await runExact(
      runChild,
      configuration,
      "/usr/bin/ditto",
      [sourceApp, staging],
      "APP_STAGE_FAILED",
      { cancellationSignal: context.operation?.cancellationSignal },
    );
    await verifyAppBundle(runChild, configuration, staging, context.operation?.cancellationSignal, {
      allowStaging: true,
    });
    const service = `gui/${hostUid}/${V209_MEDIA_WORKER_SERVICE}`;
    const print = await runChild({
      command: "/bin/launchctl",
      args: ["print", service],
      timeoutMs: 15_000,
      cancellationSignal: context.operation?.cancellationSignal,
      timeoutCode: "V2_09_MEDIA_WORKER_LAUNCHCTL_TIMEOUT",
      cancellationCode: "V2_09_MEDIA_WORKER_LAUNCHCTL_CANCELLED",
      executionCode: "V2_09_MEDIA_WORKER_LAUNCHCTL_FAILED",
      options: { cwd: configuration.root, env: configuration.environment },
    });
    if (print.status === 0) {
      serviceWasLoaded = true;
      assertAuthority(context.authority, configuration.sourceCommit, clock);
      await runExact(
        runChild,
        configuration,
        "/bin/launchctl",
        ["bootout", `gui/${hostUid}`, configuration.launchAgentPath],
        "LAUNCH_AGENT_STOP_FAILED",
        { cancellationSignal: context.operation?.cancellationSignal },
      );
      serviceStopped = true;
    }
    hadExisting = existsSync(configuration.applicationPath);
    if (hadExisting) {
      const existing = lstatSync(configuration.applicationPath);
      if (!existing.isDirectory() || existing.isSymbolicLink()) fail("EXISTING_APP_INVALID");
      assertAuthority(context.authority, configuration.sourceCommit, clock);
      movePath(configuration.applicationPath, backup);
      backupRenamed = true;
    }
    assertAuthority(context.authority, configuration.sourceCommit, clock);
    movePath(staging, configuration.applicationPath);
    newInstalled = true;
    await verifyAppBundle(
      runChild,
      configuration,
      configuration.applicationPath,
      context.operation?.cancellationSignal,
    );
    assertAuthority(context.authority, configuration.sourceCommit, clock);
    newServiceBootstrapAttempted = true;
    await runExact(
      runChild,
      configuration,
      "/bin/launchctl",
      ["bootstrap", `gui/${hostUid}`, configuration.launchAgentPath],
      "APP_LAUNCH_FAILED",
      { cancellationSignal: context.operation?.cancellationSignal },
    );
    const heartbeat = await readOnlineHeartbeat(
      runChild,
      configuration,
      installation.installationId,
      mediaWorker.execution_bundle_sha256,
      clock,
      sleep,
      context.operation?.cancellationSignal,
    );
    const afterState = readInstallationState(configuration);
    if (!afterState || afterState.sha256 !== installation.sha256) fail("INSTALLATION_STATE_DRIFT");
    if (
      !(await keychainEntryExists(
        runChild,
        configuration,
        installation.installationId,
        context.operation?.cancellationSignal,
      ))
    )
      fail("KEYCHAIN_ENTRY_LOST");
    assertAuthority(context.authority, configuration.sourceCommit, clock);
    if (hadExisting) {
      safeRemoveExact(backup, targetParent, ".backup");
      backupRenamed = false;
    }
    return Object.freeze({
      schema_version: "videoforge.v2-09-media-worker-install-result/v1",
      operation_id: context.operationId,
      release: V209_MEDIA_WORKER_VERSION,
      execution_bundle_sha256: mediaWorker.execution_bundle_sha256,
      installer_asset_sha256: mediaWorker.installer_asset_sha256,
      signing_identity_sha256: mediaWorker.signing_identity_sha256,
      installed_release_sha256: sha256(
        canonical({
          application_path: configuration.applicationPath,
          installer_asset_sha256: mediaWorker.installer_asset_sha256,
          release: V209_MEDIA_WORKER_VERSION,
          signing_identity_sha256: mediaWorker.signing_identity_sha256,
        }),
      ),
      code_signature_verified: true,
      online: true,
      online_heartbeat_sha256: sha256(canonical(heartbeat)),
    });
  } catch (error) {
    try {
      if (newServiceBootstrapAttempted) {
        await runChild({
          command: "/bin/launchctl",
          args: ["bootout", `gui/${hostUid}`, configuration.launchAgentPath],
          timeoutMs: 15_000,
          timeoutCode: "V2_09_MEDIA_WORKER_ROLLBACK_NEW_LAUNCH_AGENT_TIMEOUT",
          cancellationCode: "V2_09_MEDIA_WORKER_ROLLBACK_NEW_LAUNCH_AGENT_CANCELLED",
          executionCode: "V2_09_MEDIA_WORKER_ROLLBACK_NEW_LAUNCH_AGENT_FAILED",
          options: { cwd: configuration.root, env: configuration.environment },
        });
        const stillLoaded = await runChild({
          command: "/bin/launchctl",
          args: ["print", `gui/${hostUid}/${V209_MEDIA_WORKER_SERVICE}`],
          timeoutMs: 15_000,
          timeoutCode: "V2_09_MEDIA_WORKER_ROLLBACK_LAUNCH_AGENT_READ_TIMEOUT",
          cancellationCode: "V2_09_MEDIA_WORKER_ROLLBACK_LAUNCH_AGENT_READ_CANCELLED",
          executionCode: "V2_09_MEDIA_WORKER_ROLLBACK_LAUNCH_AGENT_READ_FAILED",
          options: { cwd: configuration.root, env: configuration.environment },
        });
        if (stillLoaded.status === 0) fail("ROLLBACK_NEW_LAUNCH_AGENT_STILL_LOADED");
        newServiceBootstrapAttempted = false;
      }
      if (newInstalled && existsSync(configuration.applicationPath)) {
        safeRemoveExact(configuration.applicationPath, targetParent, "VideoForge Worker.app");
        newInstalled = false;
      }
      if (backupRenamed && existsSync(backup)) {
        movePath(backup, configuration.applicationPath);
        backupRenamed = false;
      }
      if (serviceWasLoaded && serviceStopped && existsSync(configuration.launchAgentPath)) {
        await runExact(
          runChild,
          configuration,
          "/bin/launchctl",
          ["bootstrap", `gui/${hostUid}`, configuration.launchAgentPath],
          "ROLLBACK_LAUNCH_AGENT_FAILED",
        );
        serviceStopped = false;
      }
    } catch {
      fail("INSTALL_FAILED_ROLLBACK_UNCONFIRMED");
    }
    throw error;
  } finally {
    if (mounted) {
      try {
        await runExact(
          runChild,
          configuration,
          "/usr/bin/hdiutil",
          ["detach", mount],
          "DMG_DETACH_FAILED",
        );
        mounted = false;
      } catch {
        // Preserve the primary install result; the private mount is read-only and its work root is retained.
      }
    }
    if (existsSync(staging)) safeRemoveExact(staging, targetParent, ".staging");
    if (existsSync(dmg)) unlinkSync(dmg);
    if (!mounted && existsSync(work)) safeRemoveExact(work, configuration.workRoot, basename(work));
  }
}

function validateConfirmationCheckpoint(checkpoint, authority, clock, identities) {
  if (
    !exactKeys(checkpoint, [
      "authority_id",
      "configuration_sha256",
      "credential_values_read",
      "install_port_source_sha256",
      "local_install_mutations",
      "reason",
      "release",
      "remote_mutations",
      "schema_version",
      "source_commit",
      "state",
    ]) ||
    checkpoint.schema_version !== V209_MEDIA_WORKER_CONFIRMATION_SCHEMA ||
    checkpoint.state !== "USER_CONFIRMATION_REQUIRED" ||
    checkpoint.authority_id !== authority?.authority_id ||
    checkpoint.source_commit !== authority?.source_commit ||
    checkpoint.release !== V209_MEDIA_WORKER_VERSION ||
    checkpoint.configuration_sha256 !== identities.configurationSha256 ||
    checkpoint.install_port_source_sha256 !== identities.installMediaWorker ||
    checkpoint.remote_mutations !== 0 ||
    checkpoint.local_install_mutations !== 0 ||
    checkpoint.credential_values_read !== 0
  )
    fail("CONFIRMATION_CHECKPOINT_INVALID");
  assertAuthority(authority, checkpoint.source_commit, clock);
  return Object.freeze({
    schema_version: V209_MEDIA_WORKER_CONFIRMATION_SCHEMA,
    state: "USER_CONFIRMATION_ACKNOWLEDGED",
    authority_id: checkpoint.authority_id,
    source_commit: checkpoint.source_commit,
    release: checkpoint.release,
  });
}

async function resumeUserConfirmation(checkpoint, authority, inputConfiguration, dependencies) {
  const { runChild, clock, sleep, hostHome, hostUid } = dependencies;
  const configuration = assertConfiguration(inputConfiguration, hostHome, hostUid);
  const identities = buildPortIdentities(configuration, dependencies.identity);
  validateConfirmationCheckpoint(checkpoint, authority, clock, identities);
  if (configuration.sourceCommit !== checkpoint.source_commit) fail("CONFIRMATION_SOURCE_DRIFT");
  const installation = readInstallationState(configuration);
  if (!installation) fail("CONFIRMATION_NOT_COMPLETED");
  if (!(await keychainEntryExists(runChild, configuration, installation.installationId)))
    fail("CONFIRMATION_NOT_COMPLETED");
  const heartbeat = await readOnlineHeartbeat(
    runChild,
    configuration,
    installation.installationId,
    authority.media_worker.execution_bundle_sha256,
    clock,
    sleep,
  );
  assertAuthority(authority, checkpoint.source_commit, clock);
  return Object.freeze({
    schema_version: V209_MEDIA_WORKER_CONFIRMATION_SCHEMA,
    state: "USER_CONFIRMATION_VERIFIED",
    authority_id: checkpoint.authority_id,
    source_commit: checkpoint.source_commit,
    release: checkpoint.release,
    installation_state_sha256: installation.sha256,
    online_heartbeat_sha256: sha256(canonical(heartbeat)),
    credential_values_read: 0,
  });
}

function sanitizedEnvironmentSha256(environment) {
  if (environment === null || typeof environment !== "object" || Array.isArray(environment))
    fail("ENVIRONMENT_INVALID");
  return sha256(
    canonical(
      Object.fromEntries(
        Object.entries(environment)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, value]) => {
            if (typeof value !== "string") fail("ENVIRONMENT_INVALID");
            return [key, { bytes: Buffer.byteLength(value), value_sha256: sha256(value) }];
          }),
      ),
    ),
  );
}

function buildPortIdentities(
  configuration,
  { mode, testDependencyIdentitySha256, hostHome, hostPlatform, hostUid },
) {
  if (
    !["PRODUCTION_FIXED", "TEST_ONLY_INJECTED"].includes(mode) ||
    (mode === "TEST_ONLY_INJECTED" && !HASH.test(testDependencyIdentitySha256 ?? "")) ||
    (mode === "PRODUCTION_FIXED" && testDependencyIdentitySha256 !== undefined) ||
    typeof hostHome !== "string" ||
    typeof hostPlatform !== "string" ||
    !Number.isSafeInteger(hostUid)
  )
    fail("DEPENDENCY_INVALID");
  const configurationIdentity = {
    applicationPath: configuration.applicationPath,
    branch: configuration.branch,
    controlPlaneOrigin: configuration.controlPlaneOrigin,
    credential_paths: {
      database_credential_file: configuration.credentialIdentities.database,
      github_cli_hosts_file: configuration.credentialIdentities.github,
    },
    environment_sha256: sanitizedEnvironmentSha256(configuration.environment),
    launchAgentPath: configuration.launchAgentPath,
    manifestPath: configuration.manifestPath,
    releaseTag: configuration.releaseTag,
    repository: configuration.repository,
    root: configuration.root,
    sourceCommit: configuration.sourceCommit,
    statePath: configuration.statePath,
    version: configuration.version,
    workflowPath: configuration.workflowPath,
    workRoot: configuration.workRoot,
  };
  const dependencyIdentity = {
    mode,
    imported_run_cancellable_module_sha256: sha256(readFileSync(RUN_CANCELLABLE_SOURCE_PATH)),
    imported_release_validator_module_sha256: sha256(readFileSync(RELEASE_VALIDATOR_SOURCE_PATH)),
    ...(mode === "TEST_ONLY_INJECTED"
      ? { sealed_test_dependency_identity_sha256: testDependencyIdentitySha256 }
      : {
          node_executable_path_sha256: sha256(process.execPath),
          node_release_name: process.release.name,
          node_runtime_versions_sha256: sha256(canonical(process.versions)),
          node_version: process.version,
        }),
    host_home_sha256: sha256(resolve(hostHome)),
    host_platform: hostPlatform,
    host_uid: hostUid,
  };
  const source = readFileSync(SOURCE_PATH);
  const configurationSha256 = sha256(canonical(configurationIdentity));
  const identityFor = (name) =>
    sha256(
      Buffer.concat([
        source,
        Buffer.from(
          canonical({
            schema_version: "videoforge.v2-09-media-port/v2",
            name,
            configuration_sha256: configurationSha256,
            dependency_identity: dependencyIdentity,
          }),
        ),
      ]),
    );
  return Object.freeze({
    configurationSha256,
    publishMediaWorker: identityFor("publishMediaWorker"),
    readbackMediaWorker: identityFor("readbackMediaWorker"),
    installMediaWorker: identityFor("installMediaWorker"),
  });
}

function productionClock() {
  return new Date();
}

function productionSleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}

function rejectProductionDependencyInjection(options) {
  if (
    options !== undefined &&
    (options === null ||
      typeof options !== "object" ||
      Array.isArray(options) ||
      Object.keys(options).length !== 0)
  )
    fail("PRODUCTION_DEPENDENCY_INJECTION_FORBIDDEN");
}

function productionDependencies() {
  if (typeof PRODUCTION_FETCH !== "function") fail("PRODUCTION_RUNTIME_INVALID");
  const hostHome = homedir();
  const hostPlatform = process.platform;
  const hostUid = typeof process.getuid === "function" ? process.getuid() : -1;
  return Object.freeze({
    runChild: runCancellableChildProcess,
    fetchImpl: PRODUCTION_FETCH,
    clock: productionClock,
    sleep: productionSleep,
    hostHome,
    hostPlatform,
    hostUid,
    movePath: renameSync,
    identity: Object.freeze({ mode: "PRODUCTION_FIXED", hostHome, hostPlatform, hostUid }),
  });
}

function testOnlyDependencies(options) {
  if (options === null || typeof options !== "object" || Array.isArray(options))
    fail("TEST_DEPENDENCY_INVALID");
  const {
    runChild = runCancellableChildProcess,
    fetchImpl = fetch,
    clock = productionClock,
    sleep = productionSleep,
    hostHome = homedir(),
    hostPlatform = process.platform,
    hostUid = typeof process.getuid === "function" ? process.getuid() : -1,
    movePath = renameSync,
    testDependencyIdentitySha256,
  } = options;
  if (
    typeof runChild !== "function" ||
    typeof fetchImpl !== "function" ||
    typeof clock !== "function" ||
    typeof sleep !== "function" ||
    typeof hostHome !== "string" ||
    typeof hostPlatform !== "string" ||
    !Number.isSafeInteger(hostUid) ||
    typeof movePath !== "function" ||
    !HASH.test(testDependencyIdentitySha256 ?? "")
  )
    fail("TEST_DEPENDENCY_INVALID");
  const allowed = new Set([
    "clock",
    "fetchImpl",
    "hostHome",
    "hostPlatform",
    "hostUid",
    "movePath",
    "runChild",
    "sleep",
    "testDependencyIdentitySha256",
  ]);
  if (Object.keys(options).some((key) => !allowed.has(key))) fail("TEST_DEPENDENCY_INVALID");
  return Object.freeze({
    runChild,
    fetchImpl,
    clock,
    sleep,
    hostHome,
    hostPlatform,
    hostUid,
    movePath,
    identity: Object.freeze({
      mode: "TEST_ONLY_INJECTED",
      testDependencyIdentitySha256,
      hostHome,
      hostPlatform,
      hostUid,
    }),
  });
}

function createPorts(inputConfiguration, dependencies) {
  const { runChild, fetchImpl, clock, sleep, hostHome, hostPlatform, hostUid, movePath } =
    dependencies;
  const configuration = assertConfiguration(inputConfiguration, hostHome, hostUid);
  const identities = buildPortIdentities(configuration, dependencies.identity);
  const descriptor = (name, run) =>
    Object.freeze({
      source_sha256: identities[name],
      run,
    });
  const composedDependencies = Object.freeze({
    configuration,
    runChild,
    fetchImpl,
    clock,
    sleep,
    hostPlatform,
    hostUid,
    movePath,
    identities,
  });
  return Object.freeze({
    publishMediaWorker: descriptor("publishMediaWorker", (context) =>
      publishMediaWorker(context, composedDependencies),
    ),
    readbackMediaWorker: descriptor("readbackMediaWorker", (context) =>
      readbackMediaWorker(context, composedDependencies),
    ),
    installMediaWorker: descriptor("installMediaWorker", (context) =>
      installMediaWorker(context, composedDependencies),
    ),
  });
}

export function createV209MediaWorkerProductionPorts(inputConfiguration, options) {
  rejectProductionDependencyInjection(options);
  return createPorts(inputConfiguration, productionDependencies());
}

/** Test-only seam. Production composition must never call this export. */
export function createV209MediaWorkerProductionPortsForTest(inputConfiguration, options) {
  return createPorts(inputConfiguration, testOnlyDependencies(options));
}

export async function resumeV209MediaWorkerUserConfirmation(
  checkpoint,
  authority,
  inputConfiguration,
  options,
) {
  rejectProductionDependencyInjection(options);
  return resumeUserConfirmation(
    checkpoint,
    authority,
    inputConfiguration,
    productionDependencies(),
  );
}

/** Test-only seam. Production composition must never call this export. */
export async function resumeV209MediaWorkerUserConfirmationForTest(
  checkpoint,
  authority,
  inputConfiguration,
  options,
) {
  return resumeUserConfirmation(
    checkpoint,
    authority,
    inputConfiguration,
    testOnlyDependencies(options),
  );
}
