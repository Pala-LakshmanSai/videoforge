import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";

const CONFIG_SCHEMA = "videoforge.v2-09-chrome-bootstrap/v1";
const REQUEST_SCHEMA = "videoforge.v2-09-real-chrome-production-request/v1";
const OPERATOR_SCHEMA = "videoforge.v2-09-real-chrome-operator-request/v1";
const RECEIPT_SCHEMA = "videoforge.v2-09-chrome-bootstrap-receipt/v1";
const SCOPE_CONFIG_SCHEMA = "videoforge.v2-09-chrome-request-scope/v1";
const SCOPE_RECEIPT_SCHEMA = "videoforge.v2-09-chrome-request-scope-receipt/v1";
const AUTH_CONFIG_SCHEMA = "videoforge.v2-09-post-deploy-chrome-auth/v1";
const AUTH_RECEIPT_SCHEMA = "videoforge.v2-09-post-deploy-chrome-auth-receipt/v1";
const SOURCE = "HOSTED_V209_ORDINARY";
const SUCCESS_HORIZON_SECONDS = 1_660;
const MINIMUM_EXECUTION_WINDOW_MS = 800_000;
const MAX_VOICEOVER_BYTES = 1_073_741_824;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;
const CLOUDFLARE_ENVIRONMENT_KEYS = new Set([
  "CI",
  "HOME",
  "LANG",
  "LC_ALL",
  "NODE_ENV",
  "PATH",
  "TMPDIR",
  "WRANGLER_HOME",
  "WRANGLER_SEND_METRICS",
  "XDG_CONFIG_HOME",
]);

function fail(code) {
  throw new Error(code);
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

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function exactOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    fail("V2_09_CHROME_BOOTSTRAP_ORIGIN_INVALID");
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  )
    fail("V2_09_CHROME_BOOTSTRAP_ORIGIN_INVALID");
  return url.origin;
}

function exactInstant(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value))
    return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function privateParent(path) {
  if (typeof path !== "string" || !isAbsolute(path)) fail("V2_09_CHROME_BOOTSTRAP_PATH_INVALID");
  const absolute = resolve(path);
  let parent;
  try {
    parent = lstatSync(dirname(absolute));
  } catch {
    fail("V2_09_CHROME_BOOTSTRAP_PATH_INVALID");
  }
  if (
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (parent.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && parent.uid !== process.getuid())
  )
    fail("V2_09_CHROME_BOOTSTRAP_PATH_INVALID");
  return absolute;
}

function privateDirectory(path, code) {
  if (typeof path !== "string" || !isAbsolute(path)) fail(code);
  const absolute = resolve(path);
  let directory;
  try {
    directory = lstatSync(absolute);
  } catch {
    fail(code);
  }
  if (
    !directory.isDirectory() ||
    directory.isSymbolicLink() ||
    (directory.mode & 0o777) !== 0o700 ||
    (typeof process.getuid === "function" && directory.uid !== process.getuid())
  )
    fail(code);
  return absolute;
}

function readPrivate(path, code) {
  const absolute = privateParent(path);
  let descriptor;
  try {
    descriptor = openSync(absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = fstatSync(descriptor);
    const bytes = Buffer.from(readFileSync(descriptor));
    const after = fstatSync(descriptor);
    if (
      !before.isFile() ||
      before.nlink !== 1 ||
      (before.mode & 0o777) !== 0o600 ||
      (typeof process.getuid === "function" && before.uid !== process.getuid()) ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs ||
      before.uid !== after.uid ||
      before.size !== after.size ||
      before.size !== bytes.length ||
      bytes.length < 1
    )
      fail(code);
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_09_")) throw error;
    fail(code);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function reservePrivate(path) {
  const absolute = privateParent(path);
  let descriptor;
  try {
    descriptor = openSync(
      absolute,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW,
      0o600,
    );
    const stat = fstatSync(descriptor);
    return { absolute, descriptor, dev: stat.dev, ino: stat.ino };
  } catch {
    if (descriptor !== undefined) closeSync(descriptor);
    fail("V2_09_CHROME_BOOTSTRAP_OUTPUT_EXISTS");
  }
}

function releaseReservation(reservation, remove) {
  if (reservation.descriptor !== undefined) {
    closeSync(reservation.descriptor);
    reservation.descriptor = undefined;
  }
  if (!remove) return;
  try {
    const stat = lstatSync(reservation.absolute);
    if (
      stat.isFile() &&
      !stat.isSymbolicLink() &&
      stat.dev === reservation.dev &&
      stat.ino === reservation.ino
    )
      unlinkSync(reservation.absolute);
  } catch {
    // Cleanup is best effort; never unlink a replaced pathname.
  }
}

function fsyncParent(path) {
  let descriptor;
  try {
    descriptor = openSync(
      dirname(path),
      fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
    );
    fsyncSync(descriptor);
  } catch {
    fail("V2_09_CHROME_BOOTSTRAP_WRITE_FAILED");
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writeReserved(reservation, value) {
  const bytes = Buffer.from(`${canonical(value)}\n`, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const written = writeSync(reservation.descriptor, bytes, offset, bytes.length - offset);
    if (written <= 0) fail("V2_09_CHROME_BOOTSTRAP_WRITE_FAILED");
    offset += written;
  }
  fsyncSync(reservation.descriptor);
  releaseReservation(reservation, false);
  fsyncParent(reservation.absolute);
  return bytes;
}

function writeOrAdoptExactJson(path, value, code) {
  const absolute = privateParent(path);
  const expected = Buffer.from(`${canonical(value)}\n`, "utf8");
  if (existsSync(absolute)) {
    const observed = readPrivate(absolute, code);
    if (!observed.equals(expected)) fail(code);
    return { absolute, bytes: observed, adopted: true, reservation: null };
  }
  const reservation = reservePrivate(absolute);
  return {
    absolute,
    bytes: writeReserved(reservation, value),
    adopted: false,
    reservation,
  };
}

function verifyReservedBrowserWrite(reservation) {
  if (reservation.descriptor !== undefined) {
    closeSync(reservation.descriptor);
    reservation.descriptor = undefined;
  }
  const stat = lstatSync(reservation.absolute);
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.dev !== reservation.dev ||
    stat.ino !== reservation.ino ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    stat.size < 1
  )
    fail("V2_09_CHROME_BOOTSTRAP_AUTH_STATE_INVALID");
  return readFileSync(reservation.absolute);
}

function defaultProbeVoiceover(bytes) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", "pipe:0"],
    { encoding: "utf8", input: bytes, shell: false, timeout: 30_000 },
  );
  const durationSeconds = Number(String(result.stdout).trim());
  if (result.status !== 0 || !Number.isFinite(durationSeconds))
    fail("V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID");
  return Math.round(durationSeconds * 1_000);
}

function validateVoiceoverMedia(path, bytes, durationMs) {
  const extension = extname(path).toLowerCase();
  const contentType =
    extension === ".wav" ? "audio/wav" : extension === ".mp3" ? "audio/mpeg" : null;
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 30_000 ||
    durationMs > 60_000 ||
    contentType === null ||
    bytes === null ||
    typeof bytes !== "object" ||
    !Number.isSafeInteger(bytes.length) ||
    bytes.length < 1 ||
    bytes.length > MAX_VOICEOVER_BYTES
  )
    fail("V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID");
  return contentType;
}

function validateCloudflareEnvironment(productionConfiguration) {
  const environment = productionConfiguration?.cloudflare?.environment;
  if (
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment) ||
    !Object.hasOwn(environment, "WRANGLER_HOME") ||
    !Object.hasOwn(environment, "XDG_CONFIG_HOME") ||
    Object.keys(environment).some((key) => !CLOUDFLARE_ENVIRONMENT_KEYS.has(key)) ||
    Object.entries(environment).some(
      ([, value]) =>
        typeof value !== "string" || value.includes("\0") || value.length > 8_192,
    )
  )
    fail("V2_09_CHROME_BOOTSTRAP_WRANGLER_HOME_INVALID");
  return environment;
}

function validateFullBootstrapConfiguration(configuration) {
  if (
    !exactKeys(configuration, [
      "authStatePath",
      "chromeRequestPath",
      "loginTimeoutMs",
      "maxProgressReads",
      "pollIntervalMs",
      "productionOrigin",
      "schemaVersion",
      "successHorizonSeconds",
      "title",
      "verifiedOutputPath",
      "voiceoverDurationMs",
      "voiceoverPath",
      "voiceoverSha256",
    ]) ||
    configuration.schemaVersion !== CONFIG_SCHEMA ||
    typeof configuration.title !== "string" ||
    configuration.title.trim() !== configuration.title ||
    configuration.title.length < 1 ||
    configuration.title.length > 240 ||
    !Number.isSafeInteger(configuration.loginTimeoutMs) ||
    configuration.loginTimeoutMs < 10_000 ||
    configuration.loginTimeoutMs > 600_000 ||
    !Number.isSafeInteger(configuration.maxProgressReads) ||
    configuration.maxProgressReads < 1 ||
    configuration.maxProgressReads > 1_000 ||
    !Number.isSafeInteger(configuration.pollIntervalMs) ||
    configuration.pollIntervalMs < 0 ||
    configuration.pollIntervalMs > 60_000 ||
    configuration.successHorizonSeconds !== SUCCESS_HORIZON_SECONDS ||
    !HASH.test(configuration.voiceoverSha256 ?? "") ||
    !Number.isSafeInteger(configuration.voiceoverDurationMs) ||
    configuration.voiceoverDurationMs < 30_000 ||
    configuration.voiceoverDurationMs > 60_000
  )
    fail("V2_09_CHROME_BOOTSTRAP_CONFIGURATION_INVALID");
}

async function validateVoiceoverBinding(configuration, dependencies = {}) {
  const voiceoverPath = privateParent(configuration.voiceoverPath);
  const voiceover = readPrivate(voiceoverPath, "V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID");
  const observedSha256 = sha256(voiceover);
  if (observedSha256 !== configuration.voiceoverSha256)
    fail("V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID");
  const durationMs = await (dependencies.probeVoiceover ?? defaultProbeVoiceover)(voiceover, {
    path: voiceoverPath,
    sha256: observedSha256,
  });
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 30_000 ||
    durationMs > 60_000 ||
    durationMs !== configuration.voiceoverDurationMs
  )
    fail("V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID");
  const contentType = validateVoiceoverMedia(voiceoverPath, voiceover, durationMs);
  return Object.freeze({
    path: voiceoverPath,
    bytes: voiceover,
    sha256: observedSha256,
    durationMs,
    contentType,
  });
}

function parseAuthState(bytes) {
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    return false;
  }
  return (
    exactKeys(value, ["cookies", "origins"]) &&
    Array.isArray(value.cookies) &&
    value.cookies.length > 0 &&
    value.cookies.every(
      (cookie) =>
        cookie !== null &&
        typeof cookie === "object" &&
        !Array.isArray(cookie) &&
        typeof cookie.name === "string" &&
        cookie.name.length > 0 &&
        typeof cookie.value === "string" &&
        cookie.value.length > 0,
    ) &&
    Array.isArray(value.origins)
  );
}

function authAttemptBinding(authStatePath, binding) {
  const target = privateParent(authStatePath);
  const bindingSha256 = sha256(canonical(binding));
  const claimPath = `${target}.v209-claim.json`;
  const stagePath = `${target}.v209-${bindingSha256.slice(7, 31)}.next`;
  const claim = {
    schema_version: "videoforge.v2-09-chrome-auth-adoption-claim/v1",
    auth_state_path_sha256: sha256(target),
    binding_sha256: bindingSha256,
    stage_path_sha256: sha256(stagePath),
  };
  const claimBytes = Buffer.from(`${canonical(claim)}\n`, "utf8");
  if (existsSync(claimPath)) {
    if (!readPrivate(claimPath, "V2_09_CHROME_BOOTSTRAP_AUTH_ADOPTION_INVALID").equals(claimBytes))
      fail("V2_09_CHROME_BOOTSTRAP_AUTH_ADOPTION_INVALID");
  } else {
    const reservation = reservePrivate(claimPath);
    writeReserved(reservation, claim);
  }
  return { target, claimPath, stagePath };
}

function adoptPrivateAuth(path, code) {
  const bytes = readPrivate(path, code);
  if (!parseAuthState(bytes)) fail(code);
  return bytes;
}

function beginOrAdoptAuth(authStatePath, binding) {
  const target = privateParent(authStatePath);
  const claimPath = `${target}.v209-claim.json`;
  if (existsSync(target) && !existsSync(claimPath)) fail("V2_09_CHROME_BOOTSTRAP_OUTPUT_EXISTS");
  const attempt = authAttemptBinding(authStatePath, binding);
  if (existsSync(attempt.target)) {
    if (existsSync(attempt.stagePath)) fail("V2_09_CHROME_BOOTSTRAP_AUTH_ADOPTION_AMBIGUOUS");
    return {
      ...attempt,
      adopted: adoptPrivateAuth(attempt.target, "V2_09_CHROME_BOOTSTRAP_AUTH_ADOPTION_INVALID"),
    };
  }
  if (existsSync(attempt.stagePath)) {
    const stat = lstatSync(attempt.stagePath);
    if (stat.size === 0 && stat.isFile() && !stat.isSymbolicLink()) unlinkSync(attempt.stagePath);
    else {
      const bytes = adoptPrivateAuth(
        attempt.stagePath,
        "V2_09_CHROME_BOOTSTRAP_AUTH_ADOPTION_AMBIGUOUS",
      );
      renameSync(attempt.stagePath, attempt.target);
      fsyncParent(attempt.target);
      return { ...attempt, adopted: bytes };
    }
  }
  return { ...attempt, reservation: reservePrivate(attempt.stagePath), adopted: null };
}

function completeAuthAttempt(attempt) {
  const bytes = verifyReservedBrowserWrite(attempt.reservation);
  if (!parseAuthState(bytes)) fail("V2_09_CHROME_BOOTSTRAP_AUTH_STATE_INVALID");
  if (existsSync(attempt.target)) fail("V2_09_CHROME_BOOTSTRAP_AUTH_ADOPTION_AMBIGUOUS");
  renameSync(attempt.stagePath, attempt.target);
  fsyncParent(attempt.target);
  return adoptPrivateAuth(attempt.target, "V2_09_CHROME_BOOTSTRAP_AUTH_STATE_INVALID");
}

function isLoginTimeout(error) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || /(?:timed out|timeout)/iu.test(error.message))
  );
}

function awaitingLogin() {
  const error = new Error("V2_09_CHROME_BOOTSTRAP_AWAITING_INTERACTIVE_CHROME_LOGIN");
  error.code = error.message;
  error.resumable = true;
  return error;
}

function chooseCatalogVersion(catalog, key, ready) {
  const values = catalog?.[key];
  if (!Array.isArray(values)) fail("V2_09_CHROME_BOOTSTRAP_CATALOG_INVALID");
  const candidates = values
    .filter((value) => exactKeys(value, Object.keys(value)) && ready(value))
    .map((value) => String(value.version_id ?? ""))
    .filter((value) => IDENTIFIER.test(value))
    .sort();
  if (candidates.length < 1) fail("V2_09_CHROME_BOOTSTRAP_CATALOG_INVALID");
  return candidates[0];
}

async function defaultLaunch() {
  const requireFromWeb = createRequire(new URL("../../apps/web/package.json", import.meta.url));
  const { chromium } = requireFromWeb("@playwright/test");
  return chromium.launch({ channel: "chrome", headless: false });
}

function validateScopeConfiguration(configuration) {
  if (
    !exactKeys(configuration, [
      "accountId",
      "authStatePath",
      "avatarProfileVersionId",
      "chromeRequestPath",
      "imageStyleVersionId",
      "maxProgressReads",
      "pollIntervalMs",
      "productionOrigin",
      "schemaVersion",
      "stopAt",
      "title",
      "verifiedOutputPath",
      "voiceoverPath",
      "workspaceId",
    ]) ||
    configuration.schemaVersion !== SCOPE_CONFIG_SCHEMA ||
    !UUID.test(configuration.accountId ?? "") ||
    !UUID.test(configuration.workspaceId ?? "") ||
    !IDENTIFIER.test(configuration.avatarProfileVersionId ?? "") ||
    !IDENTIFIER.test(configuration.imageStyleVersionId ?? "") ||
    typeof configuration.title !== "string" ||
    configuration.title.trim() !== configuration.title ||
    configuration.title.length < 1 ||
    configuration.title.length > 240 ||
    !Number.isSafeInteger(configuration.maxProgressReads) ||
    configuration.maxProgressReads < 1 ||
    configuration.maxProgressReads > 1_000 ||
    !Number.isSafeInteger(configuration.pollIntervalMs) ||
    configuration.pollIntervalMs < 0 ||
    configuration.pollIntervalMs > 60_000 ||
    !exactInstant(configuration.stopAt)
  )
    fail("V2_09_CHROME_BOOTSTRAP_SCOPE_INVALID");
}

/**
 * Materialize the exact tenant/request scope before deployment without opening a browser or
 * creating authentication state. The caller binds the returned request hash before any mutation.
 */
export async function materializeV209ChromeRequestScope(configuration, dependencies = {}) {
  validateScopeConfiguration(configuration);
  const origin = exactOrigin(configuration.productionOrigin);
  const voiceoverPath = privateParent(configuration.voiceoverPath);
  const voiceover = readPrivate(voiceoverPath, "V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID");
  const durationMs = await (dependencies.probeVoiceover ?? defaultProbeVoiceover)(voiceover, {
    path: voiceoverPath,
    sha256: sha256(voiceover),
  });
  const contentType = validateVoiceoverMedia(voiceoverPath, voiceover, durationMs);
  const verifiedOutputPath = privateParent(configuration.verifiedOutputPath);
  const authStatePath = privateParent(configuration.authStatePath);
  const request = reservePrivate(configuration.chromeRequestPath);
  let succeeded = false;
  try {
    const requestDocument = {
      schemaVersion: REQUEST_SCHEMA,
      authStatePath,
      productionOrigin: origin,
      verifiedOutputPath,
      voiceoverPath,
      request: {
        schemaVersion: OPERATOR_SCHEMA,
        source: SOURCE,
        accountId: configuration.accountId,
        workspaceId: configuration.workspaceId,
        stopAt: configuration.stopAt,
        maxProgressReads: configuration.maxProgressReads,
        pollIntervalMs: configuration.pollIntervalMs,
        prepared: {
          title: configuration.title,
          voiceoverFilename: basename(voiceoverPath),
          voiceoverContentType: contentType,
          voiceoverContentLength: voiceover.length,
          voiceoverSha256: sha256(voiceover),
          voiceoverDurationMs: durationMs,
          avatarProfileVersionId: configuration.avatarProfileVersionId,
          imageStyleVersionId: configuration.imageStyleVersionId,
        },
      },
    };
    const requestBytes = writeReserved(request, requestDocument);
    succeeded = true;
    return Object.freeze({
      schema_version: SCOPE_RECEIPT_SCHEMA,
      status: "REQUEST_SCOPE_BOUND_AWAITING_POST_DEPLOY_AUTH",
      chrome_request_path: request.absolute,
      chrome_request_sha256: sha256(requestBytes),
      account_id_sha256: sha256(configuration.accountId),
      workspace_id_sha256: sha256(configuration.workspaceId),
      avatar_profile_version_id_sha256: sha256(configuration.avatarProfileVersionId),
      image_style_version_id_sha256: sha256(configuration.imageStyleVersionId),
      voiceover_sha256: sha256(voiceover),
      duration_ms: durationMs,
      auth_state_created: false,
      generate_clicks: 0,
    });
  } finally {
    if (!succeeded) releaseReservation(request, true);
  }
}

function parseBoundRequest(configuration) {
  const bytes = readPrivate(
    configuration.chromeRequestPath,
    "V2_09_CHROME_BOOTSTRAP_BOUND_REQUEST_INVALID",
  );
  let document;
  try {
    document = JSON.parse(bytes.toString("utf8"));
  } catch {
    fail("V2_09_CHROME_BOOTSTRAP_BOUND_REQUEST_INVALID");
  }
  if (
    document?.schemaVersion !== REQUEST_SCHEMA ||
    document.productionOrigin !== configuration.productionOrigin ||
    resolve(document.authStatePath ?? "") !== resolve(configuration.authStatePath) ||
    document.request?.schemaVersion !== OPERATOR_SCHEMA ||
    document.request?.source !== SOURCE ||
    !UUID.test(document.request?.accountId ?? "") ||
    !UUID.test(document.request?.workspaceId ?? "") ||
    !IDENTIFIER.test(document.request?.prepared?.avatarProfileVersionId ?? "") ||
    !IDENTIFIER.test(document.request?.prepared?.imageStyleVersionId ?? "")
  )
    fail("V2_09_CHROME_BOOTSTRAP_BOUND_REQUEST_INVALID");
  return { bytes, document };
}

/**
 * Run only after the new production authentication secret and qualified deployment are active.
 * A login timeout is a resumable pause, never permission to run Generate or replay deployment.
 */
export async function materializeV209PostDeployChromeAuth(configuration, dependencies = {}) {
  if (
    !exactKeys(configuration, [
      "authStatePath",
      "chromeRequestPath",
      "chromeRequestSha256",
      "loginTimeoutMs",
      "productionOrigin",
      "schemaVersion",
    ]) ||
    configuration.schemaVersion !== AUTH_CONFIG_SCHEMA ||
    !/^sha256:[0-9a-f]{64}$/u.test(configuration.chromeRequestSha256 ?? "") ||
    !Number.isSafeInteger(configuration.loginTimeoutMs) ||
    configuration.loginTimeoutMs < 10_000 ||
    configuration.loginTimeoutMs > 600_000
  )
    fail("V2_09_CHROME_BOOTSTRAP_AUTH_CONFIGURATION_INVALID");
  const origin = exactOrigin(configuration.productionOrigin);
  const bound = parseBoundRequest({ ...configuration, productionOrigin: origin });
  if (sha256(bound.bytes) !== configuration.chromeRequestSha256)
    fail("V2_09_CHROME_BOOTSTRAP_BOUND_REQUEST_INVALID");
  const auth = beginOrAdoptAuth(configuration.authStatePath, {
    mode: "BOUND_REQUEST_POST_DEPLOY",
    origin,
    chrome_request_sha256: configuration.chromeRequestSha256,
  });
  const request = bound.document.request;
  if (auth.adopted) {
    return Object.freeze({
      schema_version: AUTH_RECEIPT_SCHEMA,
      status: "AUTHENTICATED_READY_FOR_ONE_E2E",
      chrome_request_sha256: sha256(bound.bytes),
      auth_state_path: auth.target,
      auth_state_sha256: sha256(auth.adopted),
      account_id_sha256: sha256(request.accountId),
      workspace_id_sha256: sha256(request.workspaceId),
      generate_clicks: 0,
      post_deploy_authentication: true,
    });
  }
  let browser;
  let context;
  let page;
  let succeeded = false;
  try {
    try {
      browser = await (dependencies.launch ?? defaultLaunch)();
      context = await browser.newContext({
        acceptDownloads: false,
        baseURL: origin,
        serviceWorkers: "block",
      });
      page = await context.newPage();
      await page.goto(`${origin}/projects/new`, { waitUntil: "domcontentloaded" });
    } catch {
      fail("V2_09_CHROME_BOOTSTRAP_BROWSER_OPERATION_FAILED");
    }
    try {
      await page.waitForURL(
        new RegExp(
          `^${origin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/projects/new(?:[?#].*)?$`,
          "u",
        ),
        { timeout: configuration.loginTimeoutMs },
      );
    } catch (error) {
      if (isLoginTimeout(error)) throw awaitingLogin();
      fail("V2_09_CHROME_BOOTSTRAP_LOGIN_NAVIGATION_FAILED");
    }
    let tenant;
    let catalog;
    try {
      [tenant, catalog] = await page.evaluate(async () => {
        const read = async (path) => {
          const response = await fetch(path, { headers: { accept: "application/json" } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        };
        return Promise.all([read("/api/v2/tenant"), read("/api/v2/hosted/project-catalog")]);
      });
    } catch (error) {
      if (error instanceof Error && /HTTP (?:401|403)\b/u.test(error.message))
        throw awaitingLogin();
      fail("V2_09_CHROME_BOOTSTRAP_HOSTED_READ_FAILED");
    }
    const avatarId = request.prepared.avatarProfileVersionId;
    const styleId = request.prepared.imageStyleVersionId;
    if (
      tenant?.schema_version !== "videoforge-hosted-tenant/v1" ||
      !UUID.test(String(tenant.account_id ?? "")) ||
      !UUID.test(String(tenant.workspace_id ?? ""))
    )
      throw awaitingLogin();
    if (
      tenant.account_id !== request.accountId ||
      tenant.workspace_id !== request.workspaceId ||
      !Array.isArray(catalog?.avatars) ||
      !catalog.avatars.some(
        (value) =>
          value?.version_id === avatarId && value.state === "READY" && value.status === "ACTIVE",
      ) ||
      !Array.isArray(catalog?.styles) ||
      !catalog.styles.some(
        (value) =>
          value?.version_id === styleId && value.state === "PUBLISHED" && value.status === "ACTIVE",
      )
    )
      fail("V2_09_CHROME_BOOTSTRAP_POST_DEPLOY_SCOPE_MISMATCH");
    try {
      await context.storageState({ path: auth.stagePath });
    } catch {
      fail("V2_09_CHROME_BOOTSTRAP_AUTH_WRITE_FAILED");
    }
    const authBytes = completeAuthAttempt(auth);
    succeeded = true;
    return Object.freeze({
      schema_version: AUTH_RECEIPT_SCHEMA,
      status: "AUTHENTICATED_READY_FOR_ONE_E2E",
      chrome_request_sha256: sha256(bound.bytes),
      auth_state_path: auth.target,
      auth_state_sha256: sha256(authBytes),
      account_id_sha256: sha256(request.accountId),
      workspace_id_sha256: sha256(request.workspaceId),
      generate_clicks: 0,
      post_deploy_authentication: true,
    });
  } finally {
    await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
    if (!succeeded && auth.reservation) {
      releaseReservation(auth.reservation, false);
      try {
        const stat = lstatSync(auth.stagePath);
        if (stat.size === 0) unlinkSync(auth.stagePath);
      } catch {
        // A non-empty staged auth state is retained for exact claim-bound adoption.
      }
    }
  }
}

export function validateV209PostDeployChromeAuthReceipt(value, expected) {
  if (
    !exactKeys(value, [
      "account_id_sha256",
      "auth_state_path",
      "auth_state_sha256",
      "chrome_request_sha256",
      "generate_clicks",
      "post_deploy_authentication",
      "schema_version",
      "status",
      "workspace_id_sha256",
    ]) ||
    value.schema_version !== AUTH_RECEIPT_SCHEMA ||
    value.status !== "AUTHENTICATED_READY_FOR_ONE_E2E" ||
    value.generate_clicks !== 0 ||
    value.post_deploy_authentication !== true ||
    !HASH.test(value.account_id_sha256 ?? "") ||
    !HASH.test(value.workspace_id_sha256 ?? "") ||
    !HASH.test(value.auth_state_sha256 ?? "") ||
    !HASH.test(value.chrome_request_sha256 ?? "") ||
    resolve(value.auth_state_path ?? "") !== resolve(expected?.authStatePath ?? "") ||
    value.chrome_request_sha256 !== expected?.chromeRequestSha256
  )
    fail("V2_09_CHROME_BOOTSTRAP_AUTH_RECEIPT_INVALID");
  const auth = readPrivate(value.auth_state_path, "V2_09_CHROME_BOOTSTRAP_AUTH_RECEIPT_INVALID");
  if (sha256(auth) !== value.auth_state_sha256) fail("V2_09_CHROME_BOOTSTRAP_AUTH_RECEIPT_INVALID");
  return Object.freeze({ ...value });
}

/**
 * Validate only the local, authority-bound inputs needed before claiming a combined run.
 * This function never launches Chrome, writes state, reads credentials, or contacts a provider.
 */
export async function validateV209ChromePreclaimInputs(
  configuration,
  productionConfiguration,
  dependencies = {},
) {
  validateFullBootstrapConfiguration(configuration);
  const origin = exactOrigin(configuration.productionOrigin);
  const voiceover = await validateVoiceoverBinding(configuration, dependencies);
  const environment = validateCloudflareEnvironment(productionConfiguration);
  const wranglerHome = privateDirectory(
    environment.WRANGLER_HOME,
    "V2_09_CHROME_BOOTSTRAP_WRANGLER_HOME_INVALID",
  );
  const xdgConfigHome = privateDirectory(
    environment.XDG_CONFIG_HOME,
    "V2_09_CHROME_BOOTSTRAP_WRANGLER_HOME_INVALID",
  );
  if (wranglerHome !== xdgConfigHome)
    fail("V2_09_CHROME_BOOTSTRAP_WRANGLER_HOME_INVALID");
  return Object.freeze({
    schema_version: "videoforge.v2-09-chrome-preclaim-inputs/v1",
    production_origin: origin,
    voiceover_path: voiceover.path,
    voiceover_sha256: voiceover.sha256,
    voiceover_duration_ms: voiceover.durationMs,
    wrangler_home: wranglerHome,
    xdg_config_home: xdgConfigHome,
  });
}

export async function materializeV209ChromeBootstrap(configuration, dependencies = {}) {
  validateFullBootstrapConfiguration(configuration);

  const origin = exactOrigin(configuration.productionOrigin);
  const voiceoverBinding = await validateVoiceoverBinding(configuration, dependencies);
  const {
    path: voiceoverPath,
    bytes: voiceover,
    sha256: voiceoverSha256,
    durationMs,
    contentType,
  } =
    voiceoverBinding;

  privateParent(configuration.verifiedOutputPath);
  const auth = beginOrAdoptAuth(configuration.authStatePath, {
    mode: "FULL_POST_DEPLOY_BOOTSTRAP",
    origin,
    configuration_sha256: sha256(canonical(configuration)),
    voiceover_sha256: voiceoverSha256,
  });
  let request;
  let browser;
  let context;
  let page;
  let succeeded = false;
  try {
    try {
      browser = await (dependencies.launch ?? defaultLaunch)();
      context = await browser.newContext({
        ...(auth.adopted ? { storageState: auth.target } : {}),
        acceptDownloads: false,
        baseURL: origin,
        serviceWorkers: "block",
      });
      page = await context.newPage();
      await page.goto(`${origin}/projects/new`, { waitUntil: "domcontentloaded" });
    } catch {
      fail("V2_09_CHROME_BOOTSTRAP_BROWSER_OPERATION_FAILED");
    }
    try {
      await page.waitForURL(
        new RegExp(
          `^${origin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/projects/new(?:[?#].*)?$`,
          "u",
        ),
        { timeout: configuration.loginTimeoutMs },
      );
    } catch (error) {
      if (isLoginTimeout(error)) throw awaitingLogin();
      fail("V2_09_CHROME_BOOTSTRAP_LOGIN_NAVIGATION_FAILED");
    }
    let facts;
    try {
      facts = await page.evaluate(async () => {
        const read = async (path) => {
          const response = await fetch(path, { headers: { accept: "application/json" } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        };
        return Promise.all([read("/api/v2/tenant"), read("/api/v2/hosted/project-catalog")]);
      });
    } catch (error) {
      if (error instanceof Error && /HTTP (?:401|403)\b/u.test(error.message))
        throw awaitingLogin();
      fail("V2_09_CHROME_BOOTSTRAP_HOSTED_READ_FAILED");
    }
    const [tenant, catalog] = facts;
    if (
      tenant?.schema_version !== "videoforge-hosted-tenant/v1" ||
      !UUID.test(String(tenant.account_id ?? "")) ||
      !UUID.test(String(tenant.workspace_id ?? ""))
    )
      throw awaitingLogin();
    const avatarProfileVersionId = chooseCatalogVersion(
      catalog,
      "avatars",
      (value) => value?.state === "READY" && value?.status === "ACTIVE",
    );
    const imageStyleVersionId = chooseCatalogVersion(
      catalog,
      "styles",
      (value) => value?.state === "PUBLISHED" && value?.status === "ACTIVE",
    );
    const observed = (dependencies.now ?? (() => new Date()))();
    const authorityExpiresAt = dependencies.authorityExpiresAt;
    if (!(observed instanceof Date) || !Number.isFinite(observed.getTime()))
      fail("V2_09_CHROME_BOOTSTRAP_CLOCK_INVALID");
    if (!exactInstant(authorityExpiresAt) || observed.getTime() >= Date.parse(authorityExpiresAt))
      fail("V2_09_CHROME_BOOTSTRAP_AUTHORITY_EXPIRY_INVALID");
    const preferredStopAtMs = observed.getTime() + configuration.successHorizonSeconds * 1_000;
    if (Date.parse(authorityExpiresAt) < preferredStopAtMs)
      fail("V2_09_CHROME_BOOTSTRAP_AUTHORITY_EXPIRY_INVALID");
    let stopAtMs = preferredStopAtMs;
    if (existsSync(configuration.chromeRequestPath)) {
      let existing;
      try {
        existing = JSON.parse(
          readPrivate(
            configuration.chromeRequestPath,
            "V2_09_CHROME_BOOTSTRAP_REQUEST_ADOPTION_INVALID",
          ).toString("utf8"),
        );
      } catch {
        fail("V2_09_CHROME_BOOTSTRAP_REQUEST_ADOPTION_INVALID");
      }
      const existingStopAt = existing?.request?.stopAt;
      if (
        !exactInstant(existingStopAt) ||
        Date.parse(existingStopAt) > stopAtMs ||
        Date.parse(existingStopAt) > Date.parse(authorityExpiresAt)
      )
        fail("V2_09_CHROME_BOOTSTRAP_REQUEST_ADOPTION_INVALID");
      stopAtMs = Date.parse(existingStopAt);
    }
    if (stopAtMs - observed.getTime() < MINIMUM_EXECUTION_WINDOW_MS)
      fail("V2_09_CHROME_BOOTSTRAP_EXECUTION_WINDOW_INVALID");
    const stopAt = new Date(stopAtMs).toISOString();
    let authBytes = auth.adopted;
    if (!authBytes) {
      try {
        await context.storageState({ path: auth.stagePath });
      } catch {
        fail("V2_09_CHROME_BOOTSTRAP_AUTH_WRITE_FAILED");
      }
      authBytes = completeAuthAttempt(auth);
    }
    const requestDocument = {
      schemaVersion: REQUEST_SCHEMA,
      authStatePath: auth.target,
      productionOrigin: origin,
      verifiedOutputPath: resolve(configuration.verifiedOutputPath),
      voiceoverPath,
      request: {
        schemaVersion: OPERATOR_SCHEMA,
        source: SOURCE,
        accountId: tenant.account_id,
        workspaceId: tenant.workspace_id,
        stopAt,
        maxProgressReads: configuration.maxProgressReads,
        pollIntervalMs: configuration.pollIntervalMs,
        prepared: {
          title: configuration.title,
          voiceoverFilename: basename(voiceoverPath),
          voiceoverContentType: contentType,
          voiceoverContentLength: voiceover.length,
          voiceoverSha256,
          voiceoverDurationMs: durationMs,
          avatarProfileVersionId,
          imageStyleVersionId,
        },
      },
    };
    request = writeOrAdoptExactJson(
      configuration.chromeRequestPath,
      requestDocument,
      "V2_09_CHROME_BOOTSTRAP_REQUEST_ADOPTION_INVALID",
    );
    const requestBytes = request.bytes;
    succeeded = true;
    return Object.freeze({
      schema_version: RECEIPT_SCHEMA,
      status: "AUTHENTICATED_READY_FOR_ONE_E2E",
      auth_state_path: auth.target,
      auth_state_sha256: sha256(authBytes),
      chrome_request_path: request.absolute,
      chrome_request_sha256: sha256(requestBytes),
      account_id_sha256: sha256(tenant.account_id),
      workspace_id_sha256: sha256(tenant.workspace_id),
      avatar_profile_version_id_sha256: sha256(avatarProfileVersionId),
      image_style_version_id_sha256: sha256(imageStyleVersionId),
      voiceover_sha256: voiceoverSha256,
      duration_ms: durationMs,
      generate_clicks: 0,
      interactive_login_only: true,
      post_deploy_authentication: true,
    });
  } finally {
    await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
    if (!succeeded) {
      // Exact completed request bytes are safe to adopt on resume. Never remove them by pathname.
      if (auth.reservation) {
        releaseReservation(auth.reservation, false);
        try {
          const stat = lstatSync(auth.stagePath);
          if (stat.size === 0) unlinkSync(auth.stagePath);
        } catch {
          // Preserve non-empty claim-bound auth state for crash-safe adoption.
        }
      }
    }
  }
}

export const V209_CHROME_BOOTSTRAP_SCHEMA = CONFIG_SCHEMA;
export const V209_CHROME_BOOTSTRAP_RECEIPT_SCHEMA = RECEIPT_SCHEMA;
export const V209_CHROME_REQUEST_SCOPE_SCHEMA = SCOPE_CONFIG_SCHEMA;
export const V209_CHROME_REQUEST_SCOPE_RECEIPT_SCHEMA = SCOPE_RECEIPT_SCHEMA;
export const V209_POST_DEPLOY_CHROME_AUTH_SCHEMA = AUTH_CONFIG_SCHEMA;
export const V209_POST_DEPLOY_CHROME_AUTH_RECEIPT_SCHEMA = AUTH_RECEIPT_SCHEMA;
export const validateV209ChromeVoiceoverMedia = validateVoiceoverMedia;
