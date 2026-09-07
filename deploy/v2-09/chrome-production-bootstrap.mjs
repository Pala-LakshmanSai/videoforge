import { createHash } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
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
const SOURCE = "HOSTED_V209_ORDINARY";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/u;

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

function privateInput(path) {
  const absolute = privateParent(path);
  let stat;
  try {
    stat = lstatSync(absolute);
  } catch {
    fail("V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID");
  }
  if (
    !stat.isFile() ||
    stat.isSymbolicLink() ||
    stat.nlink !== 1 ||
    (stat.mode & 0o777) !== 0o600 ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid())
  )
    fail("V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID");
  return absolute;
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
  return bytes;
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

function defaultProbeVoiceover(path) {
  const result = spawnSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", path],
    { encoding: "utf8", shell: false, timeout: 30_000 },
  );
  const durationSeconds = Number(String(result.stdout).trim());
  if (result.status !== 0 || !Number.isFinite(durationSeconds))
    fail("V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID");
  return Math.round(durationSeconds * 1_000);
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

export async function materializeV209ChromeBootstrap(configuration, dependencies = {}) {
  if (
    !exactKeys(configuration, [
      "authStatePath",
      "chromeRequestPath",
      "loginTimeoutMs",
      "maxProgressReads",
      "pollIntervalMs",
      "productionOrigin",
      "schemaVersion",
      "spendCapUsd",
      "stopAt",
      "title",
      "verifiedOutputPath",
      "voiceoverPath",
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
    !Number.isFinite(configuration.spendCapUsd) ||
    configuration.spendCapUsd < 0.05 ||
    configuration.spendCapUsd > 2 ||
    !exactInstant(configuration.stopAt)
  )
    fail("V2_09_CHROME_BOOTSTRAP_CONFIGURATION_INVALID");

  const origin = exactOrigin(configuration.productionOrigin);
  const voiceoverPath = privateInput(configuration.voiceoverPath);
  const voiceover = readFileSync(voiceoverPath);
  const durationMs = await (dependencies.probeVoiceover ?? defaultProbeVoiceover)(voiceoverPath);
  const extension = extname(voiceoverPath).toLowerCase();
  const contentType =
    extension === ".wav" ? "audio/wav" : extension === ".mp3" ? "audio/mpeg" : null;
  if (
    !Number.isSafeInteger(durationMs) ||
    durationMs < 30_000 ||
    durationMs > 60_000 ||
    contentType === null ||
    voiceover.length < 1 ||
    voiceover.length > 1_073_741_824
  )
    fail("V2_09_CHROME_BOOTSTRAP_VOICEOVER_INVALID");

  privateParent(configuration.verifiedOutputPath);
  const auth = reservePrivate(configuration.authStatePath);
  let request;
  let browser;
  let context;
  let page;
  let succeeded = false;
  try {
    browser = await (dependencies.launch ?? defaultLaunch)();
    context = await browser.newContext({
      acceptDownloads: false,
      baseURL: origin,
      serviceWorkers: "block",
    });
    page = await context.newPage();
    await page.goto(`${origin}/projects/new`, { waitUntil: "domcontentloaded" });
    await page.waitForURL(
      new RegExp(
        `^${origin.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}/projects/new(?:[?#].*)?$`,
        "u",
      ),
      {
        timeout: configuration.loginTimeoutMs,
      },
    );
    const facts = await page.evaluate(async () => {
      const read = async (path) => {
        const response = await fetch(path, { headers: { accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      };
      return Promise.all([read("/api/v2/tenant"), read("/api/v2/hosted/project-catalog")]);
    });
    const [tenant, catalog] = facts;
    if (
      tenant?.schema_version !== "videoforge-hosted-tenant/v1" ||
      !UUID.test(String(tenant.account_id ?? "")) ||
      !UUID.test(String(tenant.workspace_id ?? ""))
    )
      fail("V2_09_CHROME_BOOTSTRAP_AUTH_UNAVAILABLE");
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
    await context.storageState({ path: auth.absolute });
    const authBytes = verifyReservedBrowserWrite(auth);
    request = reservePrivate(configuration.chromeRequestPath);
    const requestDocument = {
      schemaVersion: REQUEST_SCHEMA,
      authStatePath: auth.absolute,
      productionOrigin: origin,
      verifiedOutputPath: resolve(configuration.verifiedOutputPath),
      voiceoverPath,
      request: {
        schemaVersion: OPERATOR_SCHEMA,
        source: SOURCE,
        accountId: tenant.account_id,
        workspaceId: tenant.workspace_id,
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
          avatarProfileVersionId,
          imageStyleVersionId,
          spendCapUsd: configuration.spendCapUsd,
        },
      },
    };
    const requestBytes = writeReserved(request, requestDocument);
    succeeded = true;
    return Object.freeze({
      schema_version: RECEIPT_SCHEMA,
      auth_state_path: auth.absolute,
      auth_state_sha256: sha256(authBytes),
      chrome_request_path: request.absolute,
      chrome_request_sha256: sha256(requestBytes),
      account_id_sha256: sha256(tenant.account_id),
      workspace_id_sha256: sha256(tenant.workspace_id),
      avatar_profile_version_id_sha256: sha256(avatarProfileVersionId),
      image_style_version_id_sha256: sha256(imageStyleVersionId),
      voiceover_sha256: sha256(voiceover),
      duration_ms: durationMs,
      generate_clicks: 0,
      interactive_login_only: true,
    });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2_09_")) throw error;
    fail("V2_09_CHROME_BOOTSTRAP_AUTH_UNAVAILABLE");
  } finally {
    await Promise.allSettled([page?.close(), context?.close(), browser?.close()]);
    if (!succeeded) {
      releaseReservation(auth, true);
      if (request) releaseReservation(request, true);
    }
  }
}

export const V209_CHROME_BOOTSTRAP_SCHEMA = CONFIG_SCHEMA;
export const V209_CHROME_BOOTSTRAP_RECEIPT_SCHEMA = RECEIPT_SCHEMA;
