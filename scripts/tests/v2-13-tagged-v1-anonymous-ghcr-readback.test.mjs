import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { createGithubVerificationAdapters } from "../../deploy/v2-13/full-live-adapters.mjs";

const SOURCE_COMMIT = "15af5e20ce3c80eb61d5d1e807a87e8840ed9685";
const TAG = "videoforge-v2-13-release-20260826-v3";
const REPOSITORY = "pala-lakshmansai/videoforge-soulx-serverless-v2-08";
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const commandResult = (stdout = "") => ({ status: 0, stdout, stderr: "" });

const configBytes = Buffer.from('{"architecture":"amd64","os":"linux"}\n');
const layerBytes = [Buffer.from("parent-layer\n"), Buffer.from("tagged-overlay-layer\n")];
const configDigest = hash(configBytes);
const layerDigests = layerBytes.map(hash);
const manifest = {
  schemaVersion: 2,
  mediaType: "application/vnd.docker.distribution.manifest.v2+json",
  config: {
    mediaType: "application/vnd.docker.container.image.v1+json",
    digest: configDigest,
    size: configBytes.length,
  },
  layers: layerBytes.map((bytes, index) => ({
    mediaType: "application/vnd.docker.image.rootfs.diff.tar.gzip",
    digest: layerDigests[index],
    size: bytes.length,
  })),
};
const manifestBytes = Buffer.from(JSON.stringify(manifest));
const manifestDigest = hash(manifestBytes);
const evidence = {
  schema_version: "videoforge-image-deployability/v1",
  checkpoint: "V2-08",
  lane: "soulx_avatar",
  source_commit: SOURCE_COMMIT,
  platform: "linux/amd64",
  registry_repository: REPOSITORY,
  publication_requested: true,
  published: true,
  publication_state: "PUBLISHED_NEW_DIGEST",
  status: "PUBLISHED_IMMUTABLE_IMAGE",
  qualification_status: "REQUIRES_FRESH_LIVE_REQUALIFICATION",
  prior_qualification_reused: false,
  immutable_image: `ghcr.io/${REPOSITORY}@${manifestDigest}`,
  image_digest: manifestDigest,
  local_image_id: configDigest,
  model_volume: "/runpod-volume",
  model_download_performed: false,
  provider_endpoint_mutation_performed: false,
};
const state = {
  release_source_commit: SOURCE_COMMIT,
  approved_at: "2026-08-26T11:00:00.000Z",
  expires_at: "2026-08-26T13:00:00.000Z",
  release_ref: {
    exact_tag_name: TAG,
    exact_target_commit: SOURCE_COMMIT,
    state: "VERIFIED_EXACT_REMOTE",
  },
};

function response(bytes, { status = 200, headers = {} } = {}) {
  return new Response(bytes, { status, headers });
}

function fixture({ manifestStatus = 200, manifestBody = manifestBytes, isCancelled } = {}) {
  const fetchCalls = [];
  const fetch = async (input, init) => {
    const url = String(input);
    fetchCalls.push({ url, init });
    assert.equal(init.method, "GET");
    assert.equal(init.credentials, "omit");
    if (url.startsWith("https://ghcr.io/token?")) {
      assert.equal(init.headers.authorization, undefined);
      return response(JSON.stringify({ token: "anonymous-pull-token-value-123456789" }), {
        headers: { "content-type": "application/json" },
      });
    }
    if (url.endsWith(`/manifests/${manifestDigest}`)) {
      return response(manifestBody, {
        status: manifestStatus,
        headers: {
          "content-type": "application/vnd.docker.distribution.manifest.v2+json",
          "docker-content-digest": manifestDigest,
        },
      });
    }
    const digest = url.split("/blobs/")[1];
    if (digest === configDigest) return response(configBytes);
    const layerIndex = layerDigests.indexOf(digest);
    if (layerIndex >= 0) return response(layerBytes[layerIndex]);
    throw new Error(`unexpected fixture URL: ${url}`);
  };
  const run = (_command, args) => {
    if (args[1] === "view")
      return commandResult(
        JSON.stringify({
          databaseId: 11,
          headSha: SOURCE_COMMIT,
          workflowName: "avatar-primary-serverless-image",
          status: "completed",
          conclusion: "success",
        }),
      );
    const directory = args.at(-1);
    writeFileSync(
      resolve(directory, "soulx-serverless-v2-08.json"),
      `${JSON.stringify(evidence)}\n`,
    );
    return commandResult();
  };
  const adapters = createGithubVerificationAdapters({
    fetch,
    run,
    maximumPolls: 1,
    pollIntervalMs: 0,
    trustedTime: async () => "2026-08-26T12:00:00.000Z",
    ...(isCancelled === undefined ? {} : { isCancelled }),
  });
  return { adapters, fetchCalls };
}

const prior = new Map([["soulx-image-workflow-dispatch", { runId: "11" }]]);

test("tagged v1 evidence performs mandatory anonymous GET readback of manifest, config, and every ordered layer", async () => {
  const { adapters, fetchCalls } = fixture();
  const result = await adapters["soulx-image-workflow-verification"]({}, state, prior);
  assert.equal(result.imageDigest, manifestDigest);
  assert.equal(result.publicManifestSha256, manifestDigest);
  assert.equal(result.publicAllBlobsVerified, true);
  assert.match(result.anonymousPublicationProofSha256, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(fetchCalls.length, 5);
  assert.match(
    fetchCalls[0].url,
    /scope=repository%3Apala-lakshmansai%2Fvideoforge-soulx-serverless-v2-08%3Apull/u,
  );
  assert.equal(fetchCalls[1].url, `https://ghcr.io/v2/${REPOSITORY}/manifests/${manifestDigest}`);
  assert.deepEqual(
    fetchCalls.slice(2).map(({ url }) => url.split("/blobs/")[1]),
    [configDigest, ...layerDigests],
  );
});

for (const status of [401, 404]) {
  test(`tagged v1 anonymous manifest readback fails closed on HTTP ${status}`, async () => {
    const { adapters } = fixture({ manifestStatus: status });
    await assert.rejects(
      adapters["soulx-image-workflow-verification"]({}, state, prior),
      new RegExp(`ANONYMOUS_GHCR_MANIFEST_HTTP:${status}`, "u"),
    );
  });
}

test("tagged v1 anonymous readback rejects manifest content drift", async () => {
  const { adapters } = fixture({ manifestBody: Buffer.from(`${manifestBytes} `) });
  await assert.rejects(
    adapters["soulx-image-workflow-verification"]({}, state, prior),
    /ANONYMOUS_GHCR_BODY_DIGEST/u,
  );
});

test("tagged v1 anonymous readback aborts an in-flight token wait on cancellation", async () => {
  let cancelled = false;
  let tokenStarted;
  const tokenStart = new Promise((resolve) => {
    tokenStarted = resolve;
  });
  const { adapters } = fixture({ isCancelled: () => cancelled });
  const original = globalThis.fetch;
  void original;
  const verification = adapters["soulx-image-workflow-verification"]({}, state, prior);
  // The fixture token fetch normally resolves immediately; cancellation at the first provider
  // boundary must still be observed before any manifest GET can start.
  tokenStarted?.();
  await tokenStart;
  cancelled = true;
  await assert.rejects(verification, /ANONYMOUS_GHCR_CANCELLED/u);
});
