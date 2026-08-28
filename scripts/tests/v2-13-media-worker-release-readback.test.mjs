import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createMediaWorkerReleaseReadbackSubstep,
  MEDIA_WORKER_RELEASE_API_URL,
  MEDIA_WORKER_RELEASE_HTML_URL,
  MEDIA_WORKER_RELEASE_MANIFEST,
  MEDIA_WORKER_RELEASE_MANIFEST_NAME,
  MEDIA_WORKER_RELEASE_MANIFEST_SHA256,
  MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES,
  MEDIA_WORKER_RELEASE_MANIFEST_URL,
  MEDIA_WORKER_RELEASE_PUBLISHED_AT,
  MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID,
  MEDIA_WORKER_RELEASE_READBACK_SUBSTEP_ID,
  MEDIA_WORKER_RELEASE_REPOSITORY,
  MEDIA_WORKER_RELEASE_TAG,
  MEDIA_WORKER_RELEASE_TARGET_COMMIT,
  readMediaWorkerReleaseReadback,
} from "../../deploy/v2-13/media-worker-release-readback.mjs";

const outerStateSha256 = `sha256:${"a".repeat(64)}`;
const state = Object.freeze({
  state: "CONSUMED_SINGLE_EXECUTION_IN_PROGRESS",
  authority_id: "v2-13-media-readback-test-authority",
  release_source_commit: "b".repeat(40),
});

const sortObject = (value) => {
  if (Array.isArray(value)) return value.map(sortObject);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortObject(value[key])]),
    );
  return value;
};

const manifestBytes = () =>
  Buffer.from(`${JSON.stringify(sortObject(MEDIA_WORKER_RELEASE_MANIFEST), null, 2)}\n`, "utf8");

const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

const releaseFixture = () => ({
  tag_name: MEDIA_WORKER_RELEASE_TAG,
  target_commitish: MEDIA_WORKER_RELEASE_TARGET_COMMIT,
  html_url: MEDIA_WORKER_RELEASE_HTML_URL,
  draft: false,
  prerelease: false,
  immutable: true,
  published_at: MEDIA_WORKER_RELEASE_PUBLISHED_AT,
  assets: [
    {
      id: 1001,
      name: MEDIA_WORKER_RELEASE_MANIFEST_NAME,
      size: MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES,
      digest: MEDIA_WORKER_RELEASE_MANIFEST_SHA256,
      state: "uploaded",
      content_type: "application/json",
      browser_download_url: MEDIA_WORKER_RELEASE_MANIFEST_URL,
      url: "https://api.github.com/repos/Pala-LakshmanSai/videoforge/releases/assets/1001",
      download_count: 0,
    },
    {
      id: 1002,
      name: "VideoForge-Worker-0.1.11-Setup.exe",
      size: 225808954,
      digest: "sha256:ca9aa00f40f70680488f2735cddbd77bf03cc56d1f2d1683404e048d8ed2d3ce",
      state: "uploaded",
      content_type: "application/octet-stream",
      browser_download_url:
        "https://github.com/Pala-LakshmanSai/videoforge/releases/download/media-worker-v0.1.11/VideoForge-Worker-0.1.11-Setup.exe",
      url: "https://api.github.com/repos/Pala-LakshmanSai/videoforge/releases/assets/1002",
      download_count: 0,
    },
    {
      id: 1003,
      name: "VideoForge-Worker-0.1.11.dmg",
      size: 285620696,
      digest: "sha256:80d2b44f98b852cf79645efb345c221bfaa5f6f1022a5f62af560c110d948910",
      state: "uploaded",
      content_type: "application/octet-stream",
      browser_download_url:
        "https://github.com/Pala-LakshmanSai/videoforge/releases/download/media-worker-v0.1.11/VideoForge-Worker-0.1.11.dmg",
      url: "https://api.github.com/repos/Pala-LakshmanSai/videoforge/releases/assets/1003",
      download_count: 0,
    },
  ],
});

const response = (body, status = 200, headers = {}) =>
  new Response(body, { status, headers: { ...headers } });

function fakeFetch({
  release = releaseFixture(),
  manifest = manifestBytes(),
  manifestResponses,
} = {}) {
  const calls = [];
  const redirects = [...(manifestResponses ?? [])];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (url === MEDIA_WORKER_RELEASE_API_URL)
      return response(JSON.stringify(release), 200, { "content-type": "application/json" });
    if (url === MEDIA_WORKER_RELEASE_MANIFEST_URL && redirects.length > 0) return redirects.shift();
    if (url !== MEDIA_WORKER_RELEASE_MANIFEST_URL && redirects.length > 0) return redirects.shift();
    return response(manifest, 200, { "content-type": "application/json" });
  };
  return { calls, fetchImpl };
}

async function assertRejectsCode(promise, code) {
  await assert.rejects(promise, new RegExp(`V2-13 media-worker release readback: ${code}`, "u"));
}

test("media release readback verifies one immutable public release and never fetches binaries", async () => {
  const { calls, fetchImpl } = fakeFetch();
  const result = await readMediaWorkerReleaseReadback({
    parentOperationId: MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID,
    substepId: MEDIA_WORKER_RELEASE_READBACK_SUBSTEP_ID,
    state,
    outerStateSha256,
    priorResults: new Map([
      [
        "release-tag-readback",
        { tagName: "videoforge-v2-13-release-20260826-v3", targetCommit: "c".repeat(40) },
      ],
    ]),
    fetchImpl,
  });
  assert.equal(result.actualUsd, 0);
  assert.equal(result.state, "VERIFIED_EXACT_PUBLIC_GITHUB_RELEASE");
  assert.equal(result.authorityId, state.authority_id);
  assert.equal(result.outerStateSha256, outerStateSha256);
  assert.equal(result.repository, MEDIA_WORKER_RELEASE_REPOSITORY);
  assert.equal(result.tagName, MEDIA_WORKER_RELEASE_TAG);
  assert.equal(result.targetCommit, MEDIA_WORKER_RELEASE_TARGET_COMMIT);
  assert.equal(result.manifestSha256, MEDIA_WORKER_RELEASE_MANIFEST_SHA256);
  assert.equal(result.manifestSizeBytes, MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES);
  assert.equal(result.manifestAsset.name, MEDIA_WORKER_RELEASE_MANIFEST_NAME);
  assert.equal(result.binaryDownloads, 0);
  assert.equal(result.credentialsUsed, false);
  assert.equal(result.providerMutations, 0);
  assert.equal(result.gpuUse, false);
  assert.equal(result.externalSpendUsd, 0);
  assert.equal(result.redirectCount, 0);
  const { reconciliationSha256, ...unsigned } = result;
  assert.equal(reconciliationSha256, hash(Buffer.from(JSON.stringify(sortObject(unsigned)))));
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, MEDIA_WORKER_RELEASE_API_URL);
  assert.equal(calls[1].url, MEDIA_WORKER_RELEASE_MANIFEST_URL);
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[1].options.redirect, "manual");
  for (const call of calls) {
    assert.equal(call.options.method, "GET");
    assert.equal("authorization" in call.options.headers, false);
  }
});

test("readback follows one trusted release-assets redirect and records it", async () => {
  const redirectedUrl =
    "https://release-assets.githubusercontent.com/github-production-release-asset/1001/asset?token=volatile";
  const { calls, fetchImpl } = fakeFetch({
    manifestResponses: [
      response("", 302, { location: redirectedUrl }),
      response(manifestBytes(), 200),
    ],
  });
  const result = await readMediaWorkerReleaseReadback({
    state,
    outerStateSha256,
    fetchImpl,
  });
  assert.equal(result.redirectCount, 1);
  assert.equal(
    result.finalDownloadUrl,
    "https://release-assets.githubusercontent.com/github-production-release-asset/1001/asset",
  );
  assert.deepEqual(
    calls.map(({ url }) => url),
    [MEDIA_WORKER_RELEASE_API_URL, MEDIA_WORKER_RELEASE_MANIFEST_URL, redirectedUrl],
  );
});

test("internal substep requires the exact parent operation and outer state", async () => {
  const { fetchImpl } = fakeFetch();
  const substep = createMediaWorkerReleaseReadbackSubstep({ fetchImpl });
  await assertRejectsCode(
    substep({
      operationId: "release-tag-readback",
      state,
      priorResults: new Map(),
      outerStateSha256,
    }),
    "OPERATION_ID",
  );
  await assertRejectsCode(
    substep({
      operationId: MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID,
      state,
      priorResults: new Map(),
      outerStateSha256: undefined,
    }),
    "POST_CONSUMPTION_AUTHORITY_REQUIRED",
  );
  await assertRejectsCode(
    substep({
      operationId: MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID,
      state: { ...state, state: "AUTHORIZED_NOT_CONSUMED" },
      priorResults: new Map(),
      outerStateSha256,
    }),
    "POST_CONSUMPTION_AUTHORITY_REQUIRED",
  );
  await assertRejectsCode(
    substep({
      operationId: MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID,
      state,
      priorResults: new Map([["guarded-activation-once", { executedOnce: true }]]),
      outerStateSha256,
    }),
    "READBACK_AFTER_GUARDED_ACTIVATION",
  );
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({
      parentOperationId: MEDIA_WORKER_RELEASE_READBACK_PARENT_OPERATION_ID,
      substepId: "not-the-sealed-substep",
      state,
      outerStateSha256,
      fetchImpl,
    }),
    "OPERATION_ID",
  );
});

for (const [label, mutate, code] of [
  ["tag", (release) => (release.tag_name = "media-worker-v0.1.10"), "RELEASE_METADATA_IDENTITY"],
  ["target", (release) => (release.target_commitish = "c".repeat(40)), "RELEASE_METADATA_IDENTITY"],
  ["draft", (release) => (release.draft = true), "RELEASE_METADATA_IDENTITY"],
  ["prerelease", (release) => (release.prerelease = true), "RELEASE_METADATA_IDENTITY"],
  ["immutable state", (release) => (release.immutable = false), "RELEASE_METADATA_IDENTITY"],
  [
    "published timestamp",
    (release) => (release.published_at = "2026-08-19T04:07:30Z"),
    "RELEASE_METADATA_IDENTITY",
  ],
  [
    "release URL",
    (release) => (release.html_url = "https://github.com/other/release"),
    "RELEASE_METADATA_IDENTITY",
  ],
]) {
  test(`rejects ${label} metadata drift`, async () => {
    const release = releaseFixture();
    mutate(release);
    const { fetchImpl } = fakeFetch({ release });
    await assertRejectsCode(
      readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl }),
      code,
    );
  });
}

for (const [label, mutate] of [
  ["duplicate", (release) => release.assets.push({ ...release.assets[0], id: 2001 })],
  ["name", (release) => (release.assets[0].name = "manifest.json")],
  ["size", (release) => (release.assets[0].size = 915)],
  ["digest", (release) => (release.assets[0].digest = `sha256:${"f".repeat(64)}`)],
  ["state", (release) => (release.assets[0].state = "new")],
  ["content type", (release) => (release.assets[0].content_type = "text/plain")],
  ["download URL", (release) => (release.assets[0].browser_download_url += "?download=1")],
]) {
  test(`rejects manifest asset ${label} drift`, async () => {
    const release = releaseFixture();
    mutate(release);
    const { fetchImpl } = fakeFetch({ release });
    await assertRejectsCode(
      readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl }),
      label === "duplicate" || label === "name"
        ? "RELEASE_MANIFEST_ASSET_COUNT"
        : "RELEASE_MANIFEST_ASSET_METADATA",
    );
  });
}

test("rejects manifest size and hash drift before config activation", async () => {
  const { fetchImpl: oversizedFetch } = fakeFetch({
    manifest: Buffer.concat([manifestBytes(), Buffer.from("x")]),
  });
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl: oversizedFetch }),
    "MANIFEST_DOWNLOAD_SIZE",
  );

  const changed = Buffer.from(manifestBytes());
  changed[changed.length - 2] = changed[changed.length - 2] === 0x7d ? 0x20 : 0x7d;
  const { fetchImpl: changedFetch } = fakeFetch({ manifest: changed });
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl: changedFetch }),
    "MANIFEST_HASH",
  );
});

test("rejects schema and URL drift in a same-size manifest", async () => {
  const altered = sortObject({
    ...MEDIA_WORKER_RELEASE_MANIFEST,
    version: "0.1.10",
  });
  const alteredBytes = Buffer.from(`${JSON.stringify(altered, null, 2)}\n`, "utf8");
  const { fetchImpl, calls } = fakeFetch({ manifest: alteredBytes });
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl }),
    alteredBytes.byteLength === MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES
      ? "MANIFEST_HASH"
      : "MANIFEST_SIZE",
  );
  assert.equal(calls.length, 2);

  const urlAltered = sortObject({
    ...MEDIA_WORKER_RELEASE_MANIFEST,
    windows: {
      ...MEDIA_WORKER_RELEASE_MANIFEST.windows,
      url: "https://evil.example/worker.exe",
    },
  });
  const urlBytes = Buffer.from(`${JSON.stringify(urlAltered, null, 2)}\n`, "utf8");
  const { fetchImpl: urlFetch } = fakeFetch({ manifest: urlBytes });
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl: urlFetch }),
    urlBytes.byteLength === MEDIA_WORKER_RELEASE_MANIFEST_SIZE_BYTES
      ? "MANIFEST_HASH"
      : "MANIFEST_SIZE",
  );
});

test("rejects redirects outside the pinned GitHub asset domains and redirect chains", async () => {
  const { fetchImpl: hostileFetch } = fakeFetch({
    manifestResponses: [response("", 302, { location: "https://evil.example/manifest.json" })],
  });
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl: hostileFetch }),
    "MANIFEST_REDIRECT_DOMAIN",
  );

  const first = "https://release-assets.githubusercontent.com/asset-1";
  const second = "https://objects.githubusercontent.com/asset-2";
  const { fetchImpl: chainFetch } = fakeFetch({
    manifestResponses: [
      response("", 302, { location: first }),
      response("", 302, { location: second }),
    ],
  });
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl: chainFetch }),
    "MANIFEST_REDIRECT_LIMIT",
  );
});

test("rejects API status, manifest status, and bounded timeout", async () => {
  const { fetchImpl: apiFailure } = fakeFetch();
  const failedApi = async (url, options) =>
    url === MEDIA_WORKER_RELEASE_API_URL ? response("not found", 404) : apiFailure(url, options);
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl: failedApi }),
    "RELEASE_METADATA_STATUS",
  );

  const { fetchImpl: manifestFailure } = fakeFetch();
  const failedManifest = async (url, options) =>
    url === MEDIA_WORKER_RELEASE_MANIFEST_URL
      ? response("gone", 410)
      : manifestFailure(url, options);
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl: failedManifest }),
    "MANIFEST_DOWNLOAD_STATUS",
  );

  const never = async () => new Promise(() => {});
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl: never, timeoutMs: 5 }),
    "RELEASE_METADATA",
  );
});

test("uses one monotonic deadline across metadata and manifest reads", async () => {
  const releaseBytes = Buffer.from(JSON.stringify(releaseFixture()));
  const fetchImpl = async (url) => {
    if (url !== MEDIA_WORKER_RELEASE_API_URL) return response(manifestBytes());
    return {
      status: 200,
      headers: { get: () => String(releaseBytes.byteLength) },
      arrayBuffer: async () => releaseBytes,
    };
  };
  const samples = [0, 1, 2, 6];
  await assertRejectsCode(
    readMediaWorkerReleaseReadback({
      state,
      outerStateSha256,
      fetchImpl,
      timeoutMs: 5,
      monotonicNow: () => samples.shift() ?? 6,
    }),
    "MANIFEST_DOWNLOAD",
  );
});

test("readback evidence hash is stable and authority-bound", async () => {
  const first = fakeFetch();
  const second = fakeFetch();
  const third = fakeFetch();
  const fourth = fakeFetch();
  const [a, b, changedAuthority, changedOuterState] = await Promise.all([
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl: first.fetchImpl }),
    readMediaWorkerReleaseReadback({ state, outerStateSha256, fetchImpl: second.fetchImpl }),
    readMediaWorkerReleaseReadback({
      state: { ...state, authority_id: `${state.authority_id}-other` },
      outerStateSha256,
      fetchImpl: third.fetchImpl,
    }),
    readMediaWorkerReleaseReadback({
      state,
      outerStateSha256: `sha256:${"b".repeat(64)}`,
      fetchImpl: fourth.fetchImpl,
    }),
  ]);
  assert.equal(a.reconciliationSha256, b.reconciliationSha256);
  assert.notEqual(a.reconciliationSha256, changedAuthority.reconciliationSha256);
  assert.notEqual(a.reconciliationSha256, changedOuterState.reconciliationSha256);
  assert.equal(hash(manifestBytes()), MEDIA_WORKER_RELEASE_MANIFEST_SHA256);
});
