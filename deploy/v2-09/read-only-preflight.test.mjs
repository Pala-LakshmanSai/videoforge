import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  readRunPodEvidence,
  runV209ReadOnlyPreflight,
  verifyFrozenImage,
  V209_RETAINED_VOLUMES,
} from "./read-only-preflight.mjs";

const hash = (value) =>
  `sha256:${createHash("sha256")
    .update(value instanceof Uint8Array ? value : Buffer.from(value))
    .digest("hex")}`;
const canonical = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
};
const canonicalHash = (value) => hash(canonical(value));

const response = (body, init = {}) =>
  new Response(body, {
    status: init.status ?? 200,
    headers: init.headers,
  });

test("RunPod preflight performs only bounded identity, billing, inventory, and Serverless reads", async () => {
  const apiKey = "runpod-test-key-that-is-never-returned";
  const accountId = "test-account-id";
  const rawVolumes = [
    { id: "test-mage-volume", size: 50, dataCenterId: "EU-RO-1" },
    { id: "test-soulx-volume", size: 50, dataCenterId: "EU-RO-1" },
  ];
  const volumePins = rawVolumes.map((volume, index) => ({
    lane: index === 0 ? "mage_image" : "soulx_avatar",
    volumeIdSha256: hash(volume.id),
    volumeManifestSha256: hash(`manifest-${index}`),
    sizeGb: 50,
    region: "EU-RO-1",
  }));
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({
      url: url.href,
      method: init.method ?? "GET",
      body: init.body,
      headers: init.headers,
    });
    if (url.href === "https://api.runpod.io/graphql")
      return response(JSON.stringify({ data: { myself: { id: accountId } } }), {
        headers: { "content-type": "application/json" },
      });
    if (url.pathname === "/v2/catalog/gpus")
      return response(
        JSON.stringify({
          gpus: [
            {
              id: "NVIDIA GeForce RTX 4090",
              name: "NVIDIA GeForce RTX 4090",
              manufacturer: "NVIDIA",
              price: { flex: 0.00031 },
              dataCenters: [{ id: "EU-RO-1", availability: "LOW" }],
            },
          ],
        }),
      );
    if (url.pathname === "/v1/networkvolumes") return response(JSON.stringify(rawVolumes));
    if (url.pathname === "/v1/billing/endpoints")
      return response(JSON.stringify([{ amount: "1.25" }, { amount: 2 }]));
    if (["/v1/pods", "/v1/endpoints", "/v1/templates"].includes(url.pathname))
      return response("[]");
    throw new Error(`unexpected URL ${url.href}`);
  };
  const proof = await readRunPodEvidence({
    apiKey,
    fetchImpl,
    checkedAt: "2026-09-06T12:00:00.000Z",
    expectedAccountIdSha256: hash(accountId),
    retainedVolumePins: volumePins,
  });
  assert.equal(proof.billing.cumulativeEndpointBillingUsd, 3.25);
  assert.equal(proof.offering.availability, "LOW");
  assert.equal(proof.offering.serverlessFlexRateUsdPerGpuHour, 1.116);
  assert.deepEqual(proof.inventory.retainedVolumes, volumePins);
  assert.equal(JSON.stringify(proof).includes(apiKey), false);
  assert.equal(calls.length, 7);
  for (const call of calls) {
    if (call.url === "https://api.runpod.io/graphql") {
      assert.equal(call.method, "POST");
      assert.deepEqual(JSON.parse(call.body), {
        query: "query VideoForgeAccountIdentity { myself { id } }",
      });
      assert.doesNotMatch(call.body, /mutation/iu);
    } else {
      assert.equal(call.method, "GET");
    }
  }
});

function imageFixture() {
  const labels = {
    "ai.videoforge.source-commit": "1".repeat(40),
    "org.opencontainers.image.revision": "1".repeat(40),
  };
  const configBytes = Buffer.from(
    JSON.stringify({ architecture: "amd64", os: "linux", config: { Labels: labels } }),
  );
  const layerBytes = Buffer.from("verified-layer-bytes");
  const configDigest = hash(configBytes);
  const layerDigest = hash(layerBytes);
  const manifestBytes = Buffer.from(
    JSON.stringify({
      schemaVersion: 2,
      mediaType: "application/vnd.oci.image.manifest.v1+json",
      config: {
        mediaType: "application/vnd.oci.image.config.v1+json",
        digest: configDigest,
        size: configBytes.length,
      },
      layers: [
        {
          mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
          digest: layerDigest,
          size: layerBytes.length,
        },
      ],
    }),
  );
  return {
    expected: {
      lane: "fixture",
      repository: "pala-lakshmansai/fixture",
      manifestDigest: hash(manifestBytes),
      configDigest,
      sourceCommit: "1".repeat(40),
      frozenAnonymousProofSha256: hash("prior-proof"),
      labels,
    },
    configBytes,
    layerBytes,
    layerDigest,
    manifestBytes,
  };
}

test("GHCR preflight anonymously hashes the manifest, config, and every ordered layer", async () => {
  const fixture = imageFixture();
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url: url.href, init });
    if (url.pathname === "/token")
      return response(JSON.stringify({ token: "anonymous-token-value-123456789" }));
    if (url.pathname.endsWith(`/manifests/${fixture.expected.manifestDigest}`))
      return response(fixture.manifestBytes, {
        headers: {
          "content-length": String(fixture.manifestBytes.length),
          "content-type": "application/vnd.oci.image.manifest.v1+json",
          "docker-content-digest": fixture.expected.manifestDigest,
        },
      });
    if (url.pathname.endsWith(`/blobs/${fixture.expected.configDigest}`))
      return response(fixture.configBytes, {
        headers: { "content-length": String(fixture.configBytes.length) },
      });
    if (url.hostname === "ghcr.io" && url.pathname.endsWith(`/blobs/${fixture.layerDigest}`))
      return response(null, {
        status: 307,
        headers: {
          location: `https://pkg-containers.githubusercontent.com/ghcrblobs1/blobs/${fixture.layerDigest}?signature=redacted`,
        },
      });
    if (
      url.hostname === "pkg-containers.githubusercontent.com" &&
      url.pathname.endsWith(`/blobs/${fixture.layerDigest}`)
    )
      return response(fixture.layerBytes, {
        headers: { "content-length": String(fixture.layerBytes.length) },
      });
    throw new Error(`unexpected URL ${url.href}`);
  };
  const proof = await verifyFrozenImage(fetchImpl, fixture.expected);
  assert.equal(proof.manifestDigest, fixture.expected.manifestDigest);
  assert.equal(proof.configDigest, fixture.expected.configDigest);
  assert.deepEqual(proof.layers, [
    { index: 0, digest: fixture.layerDigest, sizeBytes: fixture.layerBytes.length },
  ]);
  assert.equal(proof.sourceLabelsSha256, canonicalHash(fixture.expected.labels));
  const unsigned = { ...proof };
  delete unsigned.proofSha256;
  assert.equal(proof.proofSha256, canonicalHash(unsigned));
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => (call.init.method ?? "GET") === "GET"));
  assert.equal(calls[0].init.headers.authorization, undefined);
});

test("GHCR preflight accepts repeated ordered layer descriptors and verifies every occurrence", async () => {
  const fixture = imageFixture();
  const manifest = JSON.parse(fixture.manifestBytes.toString("utf8"));
  manifest.layers = [manifest.layers[0], manifest.layers[0], manifest.layers[0]];
  fixture.manifestBytes = Buffer.from(JSON.stringify(manifest));
  fixture.expected.manifestDigest = hash(fixture.manifestBytes);
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({ url: url.href, init });
    if (url.pathname === "/token")
      return response(JSON.stringify({ token: "anonymous-token-value-123456789" }));
    if (url.pathname.endsWith(`/manifests/${fixture.expected.manifestDigest}`))
      return response(fixture.manifestBytes, {
        headers: {
          "content-length": String(fixture.manifestBytes.length),
          "content-type": "application/vnd.oci.image.manifest.v1+json",
          "docker-content-digest": fixture.expected.manifestDigest,
        },
      });
    if (url.pathname.endsWith(`/blobs/${fixture.expected.configDigest}`))
      return response(fixture.configBytes, {
        headers: { "content-length": String(fixture.configBytes.length) },
      });
    if (url.hostname === "ghcr.io" && url.pathname.endsWith(`/blobs/${fixture.layerDigest}`))
      return response(null, {
        status: 307,
        headers: {
          location: `https://pkg-containers.githubusercontent.com/ghcrblobs1/blobs/${fixture.layerDigest}?signature=redacted`,
        },
      });
    if (
      url.hostname === "pkg-containers.githubusercontent.com" &&
      url.pathname.endsWith(`/blobs/${fixture.layerDigest}`)
    )
      return response(fixture.layerBytes, {
        headers: { "content-length": String(fixture.layerBytes.length) },
      });
    throw new Error(`unexpected URL ${url.href}`);
  };

  const proof = await verifyFrozenImage(fetchImpl, fixture.expected);
  assert.equal(proof.manifestDigest, fixture.expected.manifestDigest);
  assert.deepEqual(
    proof.layers,
    [0, 1, 2].map((index) => ({
      index,
      digest: fixture.layerDigest,
      sizeBytes: fixture.layerBytes.length,
    })),
  );
  assert.equal(
    calls.filter(
      ({ url }) =>
        new URL(url).hostname === "pkg-containers.githubusercontent.com" &&
        new URL(url).pathname.endsWith(`/blobs/${fixture.layerDigest}`),
    ).length,
    3,
  );
});

test("GHCR preflight rejects a blob redirect outside the exact anonymous registry host", async () => {
  const fixture = imageFixture();
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname === "/token")
      return response(JSON.stringify({ token: "anonymous-token-value-123456789" }));
    if (url.pathname.endsWith(`/manifests/${fixture.expected.manifestDigest}`))
      return response(fixture.manifestBytes, {
        headers: {
          "content-type": "application/vnd.oci.image.manifest.v1+json",
          "docker-content-digest": fixture.expected.manifestDigest,
        },
      });
    if (url.pathname.endsWith(`/blobs/${fixture.expected.configDigest}`))
      return response(fixture.configBytes);
    if (url.pathname.endsWith(`/blobs/${fixture.layerDigest}`))
      return response(null, {
        status: 307,
        headers: { location: `https://example.invalid/blobs/${fixture.layerDigest}` },
      });
    throw new Error(`unexpected URL ${url.href}`);
  };
  await assert.rejects(verifyFrozenImage(fetchImpl, fixture.expected), /GHCR_BLOB_REDIRECT/u);
});

function frozenImageProof(expected) {
  const unsigned = {
    anonymous: true,
    architecture: "amd64",
    configDigest: expected.configDigest,
    configSizeBytes: 100,
    descriptorCount: 2,
    frozenAnonymousProofSha256: expected.frozenAnonymousProofSha256,
    lane: expected.lane,
    layers: [{ index: 0, digest: hash(`${expected.lane}-layer`), sizeBytes: 10 }],
    manifestDigest: expected.manifestDigest,
    manifestSizeBytes: 200,
    os: "linux",
    repository: expected.repository,
    sourceCommit: expected.sourceCommit,
    sourceLabelsSha256: canonicalHash(expected.labels),
    totalDescriptorBytes: 110,
  };
  return { ...unsigned, proofSha256: canonicalHash(unsigned) };
}

function runpodProof() {
  return {
    accountIdSha256: "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c",
    billing: {
      cumulativeEndpointBillingUsd: 3.5,
      windowStart: "2026-08-20T00:00:00.000Z",
      windowEnd: "2026-09-06T12:00:00.000Z",
      rowsSha256: hash("billing"),
    },
    inventory: {
      activeWorkers: 0,
      endpoints: 0,
      pods: 0,
      privateTemplates: 0,
      retainedVolumes: V209_RETAINED_VOLUMES,
    },
    offering: {
      availability: "LOW",
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      serverlessFlexRateUsdPerGpuHour: 1.116,
      serverlessFlexRateUsdPerSecond: 0.00031,
      catalogSha256: hash("catalog"),
    },
  };
}

test("entrypoint binds clean source and emits only redacted canonical zero-mutation evidence", async () => {
  const source = "2".repeat(40);
  const apiKey = "runpod-test-key-that-is-never-returned";
  const proof = await runV209ReadOnlyPreflight(
    { expectedSource: source, apiKey },
    {
      head: source,
      trackedClean: true,
      now: () => new Date("2026-09-06T12:00:00.000Z"),
      fetchImpl: async () => {
        throw new Error("injected ports must own reads");
      },
      readRunPod: async () => runpodProof(),
      verifyImage: async (_fetch, expected) => frozenImageProof(expected),
    },
  );
  assert.equal(proof.expectedCleanSource, source);
  assert.equal(proof.authority.providerMutations, 0);
  assert.equal(proof.authority.runpodJobPosts, 0);
  assert.equal(proof.authority.r2Calls, 0);
  assert.equal(proof.images.length, 2);
  assert.equal(JSON.stringify(proof).includes(apiKey), false);
  const unsigned = { ...proof };
  delete unsigned.proofSha256;
  assert.equal(proof.proofSha256, canonicalHash(unsigned));

  await assert.rejects(
    runV209ReadOnlyPreflight(
      { expectedSource: source, apiKey },
      {
        head: "3".repeat(40),
        trackedClean: true,
        readRunPod: async () => assert.fail("must fail before reads"),
        verifyImage: async () => assert.fail("must fail before reads"),
      },
    ),
    /SOURCE_OR_INPUT_BINDING/u,
  );
});

test("entrypoint rejects rate, retained-volume, and frozen-image proof drift", async () => {
  const source = "2".repeat(40);
  const apiKey = "runpod-test-key-that-is-never-returned";
  const baseOptions = {
    head: source,
    trackedClean: true,
    now: () => new Date("2026-09-06T12:00:00.000Z"),
    fetchImpl: async () => response("{}"),
    verifyImage: async (_fetch, expected) => frozenImageProof(expected),
  };
  await assert.rejects(
    runV209ReadOnlyPreflight(
      { expectedSource: source, apiKey },
      {
        ...baseOptions,
        readRunPod: async () => ({
          ...runpodProof(),
          offering: { ...runpodProof().offering, serverlessFlexRateUsdPerGpuHour: 1.117 },
        }),
      },
    ),
    /RUNPOD_EVIDENCE_DRIFT/u,
  );
  await assert.rejects(
    runV209ReadOnlyPreflight(
      { expectedSource: source, apiKey },
      {
        ...baseOptions,
        readRunPod: async () => runpodProof(),
        verifyImage: async (_fetch, expected) => ({
          ...frozenImageProof(expected),
          manifestDigest: hash("drift"),
        }),
      },
    ),
    /GHCR_EVIDENCE_DRIFT/u,
  );
});
