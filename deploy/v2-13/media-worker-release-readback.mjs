import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";

import { validateMediaWorkerReleaseManifest } from "./validate-production-config.mjs";

/**
 * The personal worker release is deliberately verified through the public GitHub API after
 * full-live authority consumption.  This module has no token, provider, or mutation seam.  It
 * only reads the release metadata and the small JSON manifest; platform binaries are never
 * downloaded by the V2-13 executor.
 */

export const MEDIA_WORKER_RELEASE_READBACK_SCHEMA =
  "videoforge.v213-media-worker-release-readback/v1";
export const MEDIA_WORKER_RELEASE_READBACK_SUBSTEP_ID = "media-worker-release-readback";
export const MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID = "guarded-activation-once";
export const MEDIA_WORKER_RELEASE_REPOSITORY = "Pala-LakshmanSai/videoforge";
export const MEDIA_WORKER_RELEASE_TAG = "media-worker-v0.1.11";
export const MEDIA_WORKER_RELEASE_TARGET_COMMIT = "2740dd13c955a6d8705ee341f7a6d4a522d50862";
export const MEDIA_WORKER_RELEASE_PUBLISHED_AT = "2026-08-19T04:07:29Z";
export const MEDIA_WORKER_RELEASE_MANIFEST_NAME = "media-worker-release.json";
export const MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES = 916;
export const MEDIA_WORKER_RELEASE_MANIFEST_SHA256 =
  "sha256:b33292c0e88cc53246c0ec3a34cc43d74046840a409ee444473ab629cb06a9d9";

export const MEDIA_WORKER_RELEASE_MANIFEST = Object.freeze({
  schema_version: "videoforge-media-worker-release/v1",
  version: "0.1.11",
  minimum_protocol_version: 1,
  execution_bundle_sha256:
    "sha256:6955561b0e64b1c02ce68a8fd8918ba9a27e952ffb82062b6abae0b46827a55c",
  whisper_model_sha256: "sha256:a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002",
  windows: Object.freeze({
    url: "https://github.com/Pala-LakshmanSai/videoforge/releases/download/media-worker-v0.1.11/VideoForge-Worker-0.1.11-Setup.exe",
    sha256: "sha256:ca9aa00f40f70680488f2735cddbd77bf03cc56d1f2d1683404e048d8ed2d3ce",
    size_bytes: 225808954,
    trust: "UNSIGNED_BETA",
  }),
  macos: Object.freeze({
    url: "https://github.com/Pala-LakshmanSai/videoforge/releases/download/media-worker-v0.1.11/VideoForge-Worker-0.1.11.dmg",
    sha256: "sha256:80d2b44f98b852cf79645efb345c221bfaa5f6f1022a5f62af560c110d948910",
    size_bytes: 285620696,
    trust: "AD_HOC_BETA",
  }),
});

export const MEDIA_WORKER_RELEASE_API_URL = `https://api.github.com/repos/${MEDIA_WORKER_RELEASE_REPOSITORY}/releases/tags/${MEDIA_WORKER_RELEASE_TAG}`;
export const MEDIA_WORKER_RELEASE_HTML_URL = `https://github.com/${MEDIA_WORKER_RELEASE_REPOSITORY}/releases/tag/${MEDIA_WORKER_RELEASE_TAG}`;
export const MEDIA_WORKER_RELEASE_MANIFEST_URL = `https://github.com/${MEDIA_WORKER_RELEASE_REPOSITORY}/releases/download/${MEDIA_WORKER_RELEASE_TAG}/${MEDIA_WORKER_RELEASE_MANIFEST_NAME}`;

const HASH = /^sha256:[0-9a-f]{64}$/u;
const DOWNLOAD_HOSTS = new Set([
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const REDIRECT_DESTINATION_HOSTS = new Set([
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
]);
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;
const MAX_FETCH_TIMEOUT_MS = 30_000;
const MAX_RELEASE_API_BYTES = 256 * 1024;
const MAX_REDIRECTS = 1;

const fail = (code) => {
  throw new Error(`V2-13 media-worker release readback: ${code}`);
};

const canonicalJson = (value) => {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
};

const sha256 = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const canonicalSha256 = (value) => sha256(Buffer.from(canonicalJson(value), "utf8"));

function parseHttpsUrl(value, code, { hosts } = {}) {
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
    (hosts !== undefined && !hosts.has(parsed.hostname))
  )
    fail(code);
  return parsed;
}

function assertFetchFunction(fetchImpl) {
  if (typeof fetchImpl !== "function") fail("FETCH_UNAVAILABLE");
}

function parseContentLength(response, maxBytes, code) {
  const raw = response?.headers?.get?.("content-length");
  if (raw === null || raw === undefined || raw === "") return;
  if (!/^[0-9]+$/u.test(raw)) fail(`${code}_CONTENT_LENGTH`);
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length > maxBytes) fail(`${code}_SIZE`);
}

function remainingDeadlineMs(deadlineAt, monotonicNow, code) {
  const remaining = deadlineAt - monotonicNow();
  if (!Number.isFinite(remaining) || remaining <= 0) fail(code);
  return Math.max(1, Math.ceil(remaining));
}

function timeoutPromise(deadlineAt, monotonicNow, controller, code) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(
      () => {
        controller.abort();
        reject(new Error(`V2-13 media-worker release readback: ${code}`));
      },
      remainingDeadlineMs(deadlineAt, monotonicNow, code),
    );
  });
  return Object.freeze({ promise, cancel: () => clearTimeout(timer) });
}

async function boundedFetch(fetchImpl, url, { redirect, deadlineAt, monotonicNow, code }) {
  const controller = new AbortController();
  const request = Promise.resolve().then(() =>
    fetchImpl(url, {
      method: "GET",
      redirect,
      signal: controller.signal,
      headers: Object.freeze({
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "VideoForge-V2-13-public-release-readback",
      }),
    }),
  );
  const timeout = timeoutPromise(deadlineAt, monotonicNow, controller, code);
  try {
    return await Promise.race([request, timeout.promise]);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2-13 media-worker release readback:"))
      throw error;
    fail(code);
  } finally {
    timeout.cancel();
  }
}

async function readBodyBytes(response, { maxBytes, deadlineAt, monotonicNow, code }) {
  parseContentLength(response, maxBytes, code);
  const body = response?.body;
  if (body?.getReader) {
    const reader = body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const controller = new AbortController();
      const timeout = timeoutPromise(deadlineAt, monotonicNow, controller, `${code}_TIMEOUT`);
      try {
        const next = await Promise.race([
          Promise.resolve().then(() => reader.read()),
          timeout.promise,
        ]);
        if (next.done) break;
        if (!(next.value instanceof Uint8Array)) fail(`${code}_BODY`);
        size += next.value.byteLength;
        if (!Number.isSafeInteger(size) || size > maxBytes) fail(`${code}_SIZE`);
        chunks.push(Buffer.from(next.value));
      } catch (error) {
        try {
          await reader.cancel();
        } catch {
          // The response is already unusable; preserve the original failure code.
        }
        if (
          error instanceof Error &&
          error.message.startsWith("V2-13 media-worker release readback:")
        )
          throw error;
        fail(code);
      } finally {
        timeout.cancel();
      }
    }
    return Buffer.concat(chunks);
  }
  if (typeof response?.arrayBuffer !== "function") fail(`${code}_BODY`);
  const controller = new AbortController();
  const timeout = timeoutPromise(deadlineAt, monotonicNow, controller, `${code}_TIMEOUT`);
  try {
    const bytes = Buffer.from(
      await Promise.race([Promise.resolve().then(() => response.arrayBuffer()), timeout.promise]),
    );
    if (bytes.byteLength > maxBytes) fail(`${code}_SIZE`);
    return bytes;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("V2-13 media-worker release readback:"))
      throw error;
    fail(code);
  } finally {
    timeout.cancel();
  }
}

async function fetchJson(fetchImpl, url, options) {
  const response = await boundedFetch(fetchImpl, url, {
    redirect: "error",
    deadlineAt: options.deadlineAt,
    monotonicNow: options.monotonicNow,
    code: options.code,
  });
  if (!response || response.status !== 200) fail(`${options.code}_STATUS`);
  const bytes = await readBodyBytes(response, {
    maxBytes: MAX_RELEASE_API_BYTES,
    deadlineAt: options.deadlineAt,
    monotonicNow: options.monotonicNow,
    code: options.code,
  });
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(`${options.code}_JSON`);
  }
  return value;
}

async function fetchManifestBytes(fetchImpl, url, deadlineAt, monotonicNow) {
  let redirects = 0;
  let currentUrl = url;
  for (;;) {
    const parsed = parseHttpsUrl(currentUrl, "MANIFEST_DOWNLOAD_URL", {
      hosts: DOWNLOAD_HOSTS,
    });
    if (parsed.hostname === "github.com" && currentUrl !== MEDIA_WORKER_RELEASE_MANIFEST_URL)
      fail("MANIFEST_DOWNLOAD_URL");
    const response = await boundedFetch(fetchImpl, currentUrl, {
      redirect: "manual",
      deadlineAt,
      monotonicNow,
      code: "MANIFEST_DOWNLOAD",
    });
    if (response && REDIRECT_STATUSES.has(response.status)) {
      if (redirects >= MAX_REDIRECTS) fail("MANIFEST_REDIRECT_LIMIT");
      const location = response.headers?.get?.("location");
      if (typeof location !== "string" || location === "") fail("MANIFEST_REDIRECT_LOCATION");
      let destination;
      try {
        destination = new URL(location, currentUrl);
      } catch {
        fail("MANIFEST_REDIRECT_LOCATION");
      }
      if (
        destination.protocol !== "https:" ||
        destination.username !== "" ||
        destination.password !== "" ||
        destination.port !== "" ||
        !REDIRECT_DESTINATION_HOSTS.has(destination.hostname)
      )
        fail("MANIFEST_REDIRECT_DOMAIN");
      currentUrl = destination.href;
      redirects += 1;
      continue;
    }
    if (!response || response.status !== 200) fail("MANIFEST_DOWNLOAD_STATUS");
    const bytes = await readBodyBytes(response, {
      maxBytes: MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES,
      deadlineAt,
      monotonicNow,
      code: "MANIFEST_DOWNLOAD",
    });
    return { bytes, redirects, finalUrl: currentUrl };
  }
}

function stableDownloadUrl(value) {
  const parsed = parseHttpsUrl(value, "MANIFEST_REDIRECT_LOCATION", {
    hosts: DOWNLOAD_HOSTS,
  });
  // GitHub's signed release-assets URL has a short-lived query string.  Keep only the stable
  // origin/path in evidence so two exact readbacks reconcile to the same hash.
  return `${parsed.origin}${parsed.pathname}`;
}

function assertReleaseMetadata(release) {
  if (release === null || typeof release !== "object" || Array.isArray(release))
    fail("RELEASE_METADATA_SHAPE");
  if (
    release.tag_name !== MEDIA_WORKER_RELEASE_TAG ||
    release.target_commitish !== MEDIA_WORKER_RELEASE_TARGET_COMMIT ||
    release.html_url !== MEDIA_WORKER_RELEASE_HTML_URL ||
    release.draft !== false ||
    release.prerelease !== false ||
    release.immutable !== true ||
    release.published_at !== MEDIA_WORKER_RELEASE_PUBLISHED_AT ||
    !Array.isArray(release.assets)
  )
    fail("RELEASE_METADATA_IDENTITY");
  const assets = release.assets.filter(
    (asset) =>
      asset !== null &&
      typeof asset === "object" &&
      asset.name === MEDIA_WORKER_RELEASE_MANIFEST_NAME,
  );
  if (assets.length !== 1) fail("RELEASE_MANIFEST_ASSET_COUNT");
  const asset = assets[0];
  if (
    typeof asset.name !== "string" ||
    !Number.isSafeInteger(asset.size) ||
    typeof asset.digest !== "string" ||
    typeof asset.state !== "string" ||
    typeof asset.content_type !== "string" ||
    typeof asset.browser_download_url !== "string" ||
    asset.name !== MEDIA_WORKER_RELEASE_MANIFEST_NAME ||
    asset.size !== MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES ||
    asset.digest !== MEDIA_WORKER_RELEASE_MANIFEST_SHA256 ||
    asset.state !== "uploaded" ||
    asset.content_type !== "application/json" ||
    asset.browser_download_url !== MEDIA_WORKER_RELEASE_MANIFEST_URL
  )
    fail("RELEASE_MANIFEST_ASSET_METADATA");
  return asset;
}

function assertManifest(bytes) {
  if (bytes.byteLength !== MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES) fail("MANIFEST_SIZE");
  const digest = sha256(bytes);
  if (digest !== MEDIA_WORKER_RELEASE_MANIFEST_SHA256) fail("MANIFEST_HASH");
  let manifest;
  try {
    manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail("MANIFEST_JSON");
  }
  try {
    validateMediaWorkerReleaseManifest(manifest);
  } catch {
    fail("MANIFEST_SCHEMA");
  }
  if (canonicalJson(manifest) !== canonicalJson(MEDIA_WORKER_RELEASE_MANIFEST))
    fail("MANIFEST_IDENTITY");
  return Object.freeze(manifest);
}

function assertPostConsumptionBoundary({
  parentOperationId,
  substepId,
  state,
  priorResults,
  outerStateSha256,
}) {
  if (
    parentOperationId !== MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID ||
    substepId !== MEDIA_WORKER_RELEASE_READBACK_SUBSTEP_ID
  )
    fail("OPERATION_ID");
  if (
    state?.state !== "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS" ||
    typeof state.authority_id !== "string" ||
    state.authority_id === "" ||
    !HASH.test(outerStateSha256 ?? "")
  )
    fail("POST_CONSUMPTION_AUTHORITY_REQUIRED");
  if (priorResults?.has?.("guarded-activation-once")) fail("READBACK_AFTER_GUARDED_ACTIVATION");
}

function readbackSummary({
  authorityId,
  outerStateSha256,
  manifestAsset,
  manifest,
  bytes,
  redirects,
  finalUrl,
}) {
  const unsigned = {
    actualUsd: 0,
    schemaVersion: MEDIA_WORKER_RELEASE_READBACK_SCHEMA,
    state: "VERIFIED_EXACT_PUBLIC_GITHUB_RELEASE",
    authorityId,
    outerStateSha256,
    repository: MEDIA_WORKER_RELEASE_REPOSITORY,
    tagName: MEDIA_WORKER_RELEASE_TAG,
    targetCommit: MEDIA_WORKER_RELEASE_TARGET_COMMIT,
    releaseHtmlUrl: MEDIA_WORKER_RELEASE_HTML_URL,
    publishedAt: MEDIA_WORKER_RELEASE_PUBLISHED_AT,
    draft: false,
    prerelease: false,
    immutable: true,
    manifestAsset: {
      name: manifestAsset.name,
      sizeBytes: manifestAsset.size,
      digest: manifestAsset.digest,
      state: manifestAsset.state,
      contentType: manifestAsset.content_type,
      browserDownloadUrl: manifestAsset.browser_download_url,
    },
    manifestUrl: MEDIA_WORKER_RELEASE_MANIFEST_URL,
    finalDownloadUrl: stableDownloadUrl(finalUrl),
    redirectCount: redirects,
    manifestSizeBytes: bytes.byteLength,
    manifestSha256: sha256(bytes),
    manifest,
    binaryDownloads: 0,
    credentialsUsed: false,
    providerMutations: 0,
    gpuUse: false,
    externalSpendUsd: 0,
  };
  return Object.freeze({
    ...unsigned,
    reconciliationSha256: canonicalSha256(unsigned),
  });
}

/**
 * Execute one credential-free public release readback.  The caller must pass the executor's
 * post-consumption state hash; the function intentionally cannot be used as a pre-consumption
 * inventory helper or as a release publisher.
 */
export async function readMediaWorkerReleaseReadback({
  parentOperationId = MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID,
  substepId = MEDIA_WORKER_RELEASE_READBACK_SUBSTEP_ID,
  state,
  priorResults = new Map(),
  outerStateSha256,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  monotonicNow = () => performance.now(),
} = {}) {
  assertPostConsumptionBoundary({
    parentOperationId,
    substepId,
    state,
    priorResults,
    outerStateSha256,
  });
  assertFetchFunction(fetchImpl);
  if (typeof monotonicNow !== "function") fail("MONOTONIC_CLOCK");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_FETCH_TIMEOUT_MS)
    fail("FETCH_TIMEOUT_BOUND");
  const deadlineAt = monotonicNow() + timeoutMs;
  const release = await fetchJson(fetchImpl, MEDIA_WORKER_RELEASE_API_URL, {
    deadlineAt,
    monotonicNow,
    code: "RELEASE_METADATA",
  });
  const manifestAsset = assertReleaseMetadata(release);
  const downloaded = await fetchManifestBytes(
    fetchImpl,
    manifestAsset.browser_download_url,
    deadlineAt,
    monotonicNow,
  );
  const manifest = assertManifest(downloaded.bytes);
  const summary = readbackSummary({
    authorityId: state.authority_id,
    outerStateSha256,
    manifestAsset,
    manifest,
    bytes: downloaded.bytes,
    redirects: downloaded.redirects,
    finalUrl: downloaded.finalUrl,
  });
  return summary;
}

export function createMediaWorkerReleaseReadbackSubstep(options = {}) {
  return async ({ operationId, state, priorResults, outerStateSha256 }) =>
    readMediaWorkerReleaseReadback({
      ...options,
      parentOperationId: operationId,
      state,
      priorResults,
      outerStateSha256,
    });
}

export const MEDIA_WORKER_RELEASE_READBACK_LIMITS = Object.freeze({
  defaultFetchTimeoutMs: DEFAULT_FETCH_TIMEOUT_MS,
  maxFetchTimeoutMs: MAX_FETCH_TIMEOUT_MS,
  maxReleaseApiBytes: MAX_RELEASE_API_BYTES,
  maxManifestBytes: MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES,
  maxRedirects: MAX_REDIRECTS,
});
