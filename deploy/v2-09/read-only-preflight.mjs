#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseAuthenticatedRunPodServerlessFlexRate,
  validateRunPodPerMutationRawComputeInventory,
} from "../v2-13/full-live-adapters.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const RUNPOD_ACCOUNT_ID_SHA256 =
  "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";
const RUNPOD_GRAPHQL_URL = "https://api.runpod.io/graphql";
const RUNPOD_CATALOG_URL =
  "https://api.runpod.io/v2/catalog/gpus?include=AVAILABILITY&product=SERVERLESS";
const RUNPOD_REST_ORIGIN = "https://rest.runpod.io";
const MAX_RATE_USD_PER_GPU_HOUR = 1.116;
const GHCR_ORIGIN = "https://ghcr.io";
const GHCR_BLOB_REDIRECT_HOST = "pkg-containers.githubusercontent.com";
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const MAX_CONFIG_BYTES = 8 * 1024 * 1024;
const MAX_DESCRIPTOR_BYTES = 8 * 1024 * 1024 * 1024;
const MANIFEST_MEDIA_TYPES = new Set([
  "application/vnd.docker.distribution.manifest.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
]);
const CONFIG_MEDIA_TYPES = new Set([
  "application/vnd.docker.container.image.v1+json",
  "application/vnd.oci.image.config.v1+json",
]);
const LAYER_MEDIA_TYPES = new Set([
  "application/vnd.docker.image.rootfs.diff.tar.gzip",
  "application/vnd.oci.image.layer.v1.tar",
  "application/vnd.oci.image.layer.v1.tar+gzip",
]);

export const V209_RETAINED_VOLUMES = Object.freeze([
  Object.freeze({
    lane: "mage_image",
    volumeIdSha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
    volumeManifestSha256: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
    sizeGb: 50,
    region: "EU-RO-1",
  }),
  Object.freeze({
    lane: "soulx_avatar",
    volumeIdSha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    volumeManifestSha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
    sizeGb: 50,
    region: "EU-RO-1",
  }),
]);

export const V209_FROZEN_IMAGES = Object.freeze([
  Object.freeze({
    lane: "mage_image",
    repository: "pala-lakshmansai/videoforge-mage-v2-07",
    manifestDigest: "sha256:0f3203ceaedd8d570dcca301e32ca6d0ecb4d1136c32d5cd7d76fdc292a030cb",
    configDigest: "sha256:fe08710bb809b702d8efe46b4d67d100b9f9630c8969f62efe7fd1b54d069897",
    sourceCommit: "aceef8e0d0d678468ea9560f1faa94aa562fc466",
    frozenAnonymousProofSha256:
      "sha256:eca6cfe6acec62ed63ec1f7c9d40e7fb14e908c6e594da3864f936fa53670704",
    labels: Object.freeze({
      "ai.videoforge.source-commit": "aceef8e0d0d678468ea9560f1faa94aa562fc466",
      "org.opencontainers.image.base.digest":
        "sha256:91ef608fbb15bc69213c73a598a8915fa4dfa938d02c619454e42319a6475f62",
      "org.opencontainers.image.base.name": "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07",
      "org.opencontainers.image.revision": "aceef8e0d0d678468ea9560f1faa94aa562fc466",
    }),
  }),
  Object.freeze({
    lane: "soulx_avatar",
    repository: "pala-lakshmansai/videoforge-soulx-serverless-v2-08",
    manifestDigest: "sha256:f3b1d1414308d0783fe006d33e6482c027e05b6029a07843af66e4a9e1c1380e",
    configDigest: "sha256:224b2a728490cf1c708b42e56702da2b71bd2374658f0c640dd39ef23e860935",
    sourceCommit: "73181707e49be61955af4f2891f4c7185a1c288f",
    frozenAnonymousProofSha256:
      "sha256:9929d19da89ab2c20e280ac45ad152bc325b8bf56ef1e9c21e83d473c3408bc4",
    labels: Object.freeze({
      "ai.videoforge.lane": "soulx_avatar",
      "ai.videoforge.model-manifest":
        "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
      "ai.videoforge.model-revision": "59119b6c681230c3eeee157e224ae1941746711e",
      "ai.videoforge.runtime-profile": "videoforge_soulx_flashhead_pro_bf16_v1",
      "ai.videoforge.source-commit": "73181707e49be61955af4f2891f4c7185a1c288f",
      "ai.videoforge.source-revision": "9bc03de06bb0de82cd6bc477804512ae06144bf2",
      "org.opencontainers.image.base.digest":
        "sha256:0538d16199f04cac0a68ad4570b3fc260470b079200da025fe8f36640fb69a9b",
      "org.opencontainers.image.base.name":
        "ghcr.io/pala-lakshmansai/videoforge-soulx-flashhead-pro-vf924s",
      "org.opencontainers.image.revision": "73181707e49be61955af4f2891f4c7185a1c288f",
    }),
  }),
]);

const fail = (code) => {
  throw new Error(`V2_09_READ_ONLY_PREFLIGHT_${code}`);
};

const canonicalJson = (value) => {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  fail("CANONICAL_JSON");
};

const sha256 = (value) =>
  `sha256:${createHash("sha256")
    .update(value instanceof Uint8Array ? value : Buffer.from(value))
    .digest("hex")}`;
const canonicalSha256 = (value) => sha256(canonicalJson(value));

const record = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value : null;

async function jsonResponse(response, code) {
  if (!response?.ok) fail(`${code}_HTTP`);
  try {
    return await response.json();
  } catch {
    fail(`${code}_JSON`);
  }
}

async function runpodJson(fetchImpl, apiKey, url, init = {}) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      ...init,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    fail("RUNPOD_READ_AMBIGUOUS");
  }
  return jsonResponse(response, "RUNPOD_READ");
}

function exactServerlessOffering(catalog) {
  const parsedRate = parseAuthenticatedRunPodServerlessFlexRate(catalog);
  const matches = Array.isArray(catalog?.gpus)
    ? catalog.gpus.filter(
        (gpu) =>
          gpu?.manufacturer === "NVIDIA" && [gpu.id, gpu.name].includes("NVIDIA GeForce RTX 4090"),
      )
    : [];
  const regions = Array.isArray(matches[0]?.dataCenters)
    ? matches[0].dataCenters.filter((region) => region?.id === "EU-RO-1")
    : [];
  const availability = regions[0]?.availability;
  if (
    matches.length !== 1 ||
    regions.length !== 1 ||
    !["LOW", "MEDIUM", "HIGH"].includes(availability) ||
    parsedRate.rateUsdPerGpuHour > MAX_RATE_USD_PER_GPU_HOUR ||
    Math.abs(parsedRate.rateUsdPerGpuHour - parsedRate.rateUsdPerSecond * 3600) >
      Number.EPSILON * 3600
  )
    fail("RUNPOD_EXACT_OFFERING");
  return Object.freeze({ ...parsedRate, availability });
}

export async function readRunPodEvidence({
  apiKey,
  fetchImpl,
  checkedAt,
  expectedAccountIdSha256 = RUNPOD_ACCOUNT_ID_SHA256,
  retainedVolumePins = V209_RETAINED_VOLUMES,
}) {
  const billingUrl = new URL("/v1/billing/endpoints", RUNPOD_REST_ORIGIN);
  billingUrl.searchParams.set("bucketSize", "hour");
  billingUrl.searchParams.set("grouping", "endpointId");
  billingUrl.searchParams.set("startTime", "2026-08-20T00:00:00.000Z");
  billingUrl.searchParams.set("endTime", checkedAt);
  const accountQuery = JSON.stringify({
    query: "query VideoForgeAccountIdentity { myself { id } }",
  });
  const [account, catalog, pods, endpoints, templates, volumes, billingRows] = await Promise.all([
    runpodJson(fetchImpl, apiKey, RUNPOD_GRAPHQL_URL, {
      method: "POST",
      body: accountQuery,
    }),
    runpodJson(fetchImpl, apiKey, RUNPOD_CATALOG_URL),
    runpodJson(fetchImpl, apiKey, `${RUNPOD_REST_ORIGIN}/v1/pods?includeWorkers=true`),
    runpodJson(
      fetchImpl,
      apiKey,
      `${RUNPOD_REST_ORIGIN}/v1/endpoints?includeTemplate=true&includeWorkers=true`,
    ),
    runpodJson(
      fetchImpl,
      apiKey,
      `${RUNPOD_REST_ORIGIN}/v1/templates?includeEndpointBoundTemplates=true`,
    ),
    runpodJson(fetchImpl, apiKey, `${RUNPOD_REST_ORIGIN}/v1/networkvolumes`),
    runpodJson(fetchImpl, apiKey, billingUrl),
  ]);
  const accountId = account?.data?.myself?.id;
  if (
    typeof accountId !== "string" ||
    account.errors !== undefined ||
    sha256(accountId) !== expectedAccountIdSha256
  )
    fail("RUNPOD_ACCOUNT");
  validateRunPodPerMutationRawComputeInventory({
    pods,
    endpoints,
    templates,
    expectedEndpointBindings: [],
  });
  if (pods.length !== 0 || endpoints.length !== 0 || templates.length !== 0)
    fail("RUNPOD_COMPUTE_PRESENT");
  if (!Array.isArray(volumes) || volumes.length !== retainedVolumePins.length)
    fail("RUNPOD_VOLUME_DRIFT");
  const retainedVolumes = retainedVolumePins.map((expected) => {
    const matches = volumes.filter(
      (volume) => typeof volume?.id === "string" && sha256(volume.id) === expected.volumeIdSha256,
    );
    if (
      matches.length !== 1 ||
      Number(matches[0].size) !== expected.sizeGb ||
      matches[0].dataCenterId !== expected.region
    )
      fail("RUNPOD_VOLUME_DRIFT");
    return expected;
  });
  if (!Array.isArray(billingRows)) fail("RUNPOD_BILLING");
  const cumulativeBillingUsd = billingRows.reduce((sum, row) => {
    const amount = Number(record(row)?.amount);
    if (!Number.isFinite(amount) || amount < 0) fail("RUNPOD_BILLING");
    return sum + amount;
  }, 0);
  const offering = exactServerlessOffering(catalog);
  return Object.freeze({
    accountIdSha256: expectedAccountIdSha256,
    billing: Object.freeze({
      cumulativeEndpointBillingUsd: cumulativeBillingUsd,
      windowStart: "2026-08-20T00:00:00.000Z",
      windowEnd: checkedAt,
      rowsSha256: canonicalSha256(billingRows),
    }),
    inventory: Object.freeze({
      activeWorkers: 0,
      endpoints: 0,
      pods: 0,
      privateTemplates: 0,
      retainedVolumes,
    }),
    offering: Object.freeze({
      availability: offering.availability,
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      serverlessFlexRateUsdPerGpuHour: offering.rateUsdPerGpuHour,
      serverlessFlexRateUsdPerSecond: offering.rateUsdPerSecond,
      catalogSha256: canonicalSha256(catalog),
    }),
  });
}

function descriptor(value, mediaTypes, code) {
  if (
    !record(value) ||
    !HASH.test(value.digest ?? "") ||
    !Number.isSafeInteger(value.size) ||
    value.size <= 0 ||
    value.size > MAX_DESCRIPTOR_BYTES ||
    !mediaTypes.has(value.mediaType)
  )
    fail(code);
  return Object.freeze({ digest: value.digest, mediaType: value.mediaType, size: value.size });
}

async function readBoundedBody(response, { expectedDigest, expectedSize, maximumSize, collect }) {
  const headerLength = response.headers.get("content-length");
  if (headerLength !== null && expectedSize !== null && Number(headerLength) !== expectedSize)
    fail("GHCR_CONTENT_LENGTH");
  const hash = createHash("sha256");
  const chunks = [];
  let size = 0;
  if (response.body === null) fail("GHCR_BODY");
  const reader = response.body.getReader();
  for (;;) {
    const item = await reader.read();
    if (item.done) break;
    if (!(item.value instanceof Uint8Array)) fail("GHCR_BODY");
    size += item.value.byteLength;
    if (size > maximumSize || (expectedSize !== null && size > expectedSize))
      fail("GHCR_BODY_SIZE");
    hash.update(item.value);
    if (collect) chunks.push(Buffer.from(item.value));
  }
  const digest = `sha256:${hash.digest("hex")}`;
  if (digest !== expectedDigest || (expectedSize !== null && size !== expectedSize))
    fail("GHCR_BODY_DIGEST");
  return Object.freeze({ bytes: collect ? Buffer.concat(chunks) : null, digest, size });
}

async function anonymousGhcrFetch(fetchImpl, url, init) {
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    fail("GHCR_READ_AMBIGUOUS");
  }
  return response;
}

async function readGhcrObject(fetchImpl, { repository, token, path, accept, kind }) {
  const sourceUrl = `${GHCR_ORIGIN}/v2/${repository}/${path}`;
  let response = await anonymousGhcrFetch(fetchImpl, sourceUrl, {
    method: "GET",
    headers: { accept, authorization: `Bearer ${token}` },
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (kind !== "blob") fail("GHCR_REDIRECT");
    const location = response.headers.get("location");
    let target;
    try {
      target = new URL(location);
    } catch {
      fail("GHCR_BLOB_REDIRECT");
    }
    if (
      target.protocol !== "https:" ||
      target.hostname !== GHCR_BLOB_REDIRECT_HOST ||
      target.username !== "" ||
      target.password !== "" ||
      !new RegExp(
        `^/ghcrblobs[^/]+/blobs/${path
          .slice("blobs/".length)
          .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
        "u",
      ).test(target.pathname)
    )
      fail("GHCR_BLOB_REDIRECT");
    response = await anonymousGhcrFetch(fetchImpl, target, {
      method: "GET",
      headers: { accept },
    });
  }
  if (!response.ok) fail("GHCR_HTTP");
  return response;
}

async function acquireAnonymousToken(fetchImpl, repository) {
  const url = new URL("/token", GHCR_ORIGIN);
  url.searchParams.set("service", "ghcr.io");
  url.searchParams.set("scope", `repository:${repository}:pull`);
  const response = await anonymousGhcrFetch(fetchImpl, url, {
    method: "GET",
    headers: { accept: "application/json" },
  });
  const value = await jsonResponse(response, "GHCR_TOKEN");
  if (typeof value?.token !== "string" || value.token.length < 20 || value.token.includes("\0"))
    fail("GHCR_TOKEN");
  return value.token;
}

export async function verifyFrozenImage(fetchImpl, expected) {
  const token = await acquireAnonymousToken(fetchImpl, expected.repository);
  const manifestResponse = await readGhcrObject(fetchImpl, {
    repository: expected.repository,
    token,
    path: `manifests/${expected.manifestDigest}`,
    accept: [...MANIFEST_MEDIA_TYPES].join(", "),
    kind: "manifest",
  });
  const manifestType = manifestResponse.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    manifestResponse.headers.get("docker-content-digest") !== expected.manifestDigest ||
    !MANIFEST_MEDIA_TYPES.has(manifestType)
  )
    fail("GHCR_MANIFEST_IDENTITY");
  const manifestBody = await readBoundedBody(manifestResponse, {
    expectedDigest: expected.manifestDigest,
    expectedSize: null,
    maximumSize: MAX_MANIFEST_BYTES,
    collect: true,
  });
  let manifest;
  try {
    manifest = JSON.parse(manifestBody.bytes.toString("utf8"));
  } catch {
    fail("GHCR_MANIFEST_JSON");
  }
  if (manifest?.schemaVersion !== 2 || manifest.mediaType !== manifestType)
    fail("GHCR_MANIFEST_CONTRACT");
  const config = descriptor(manifest.config, CONFIG_MEDIA_TYPES, "GHCR_CONFIG_DESCRIPTOR");
  const layers = Array.isArray(manifest.layers)
    ? manifest.layers.map((layer) => descriptor(layer, LAYER_MEDIA_TYPES, "GHCR_LAYER_DESCRIPTOR"))
    : [];
  if (config.digest !== expected.configDigest || layers.length < 1 || layers.length > 128)
    fail("GHCR_DESCRIPTOR_DRIFT");
  const configResponse = await readGhcrObject(fetchImpl, {
    repository: expected.repository,
    token,
    path: `blobs/${config.digest}`,
    accept: config.mediaType,
    kind: "blob",
  });
  const configBody = await readBoundedBody(configResponse, {
    expectedDigest: config.digest,
    expectedSize: config.size,
    maximumSize: MAX_CONFIG_BYTES,
    collect: true,
  });
  let configDocument;
  try {
    configDocument = JSON.parse(configBody.bytes.toString("utf8"));
  } catch {
    fail("GHCR_CONFIG_JSON");
  }
  const labels = record(configDocument?.config)?.Labels;
  if (configDocument?.architecture !== "amd64" || configDocument?.os !== "linux" || !record(labels))
    fail("GHCR_CONFIG_PLATFORM");
  for (const [name, value] of Object.entries(expected.labels))
    if (labels[name] !== value) fail("GHCR_SOURCE_LABELS");
  const layerProofs = [];
  for (const [index, layer] of layers.entries()) {
    const response = await readGhcrObject(fetchImpl, {
      repository: expected.repository,
      token,
      path: `blobs/${layer.digest}`,
      accept: layer.mediaType,
      kind: "blob",
    });
    const body = await readBoundedBody(response, {
      expectedDigest: layer.digest,
      expectedSize: layer.size,
      maximumSize: MAX_DESCRIPTOR_BYTES,
      collect: false,
    });
    layerProofs.push(Object.freeze({ index, digest: body.digest, sizeBytes: body.size }));
  }
  const unsigned = {
    anonymous: true,
    architecture: "amd64",
    configDigest: config.digest,
    configSizeBytes: config.size,
    descriptorCount: layers.length + 1,
    frozenAnonymousProofSha256: expected.frozenAnonymousProofSha256,
    lane: expected.lane,
    layers: layerProofs,
    manifestDigest: expected.manifestDigest,
    manifestSizeBytes: manifestBody.size,
    os: "linux",
    repository: expected.repository,
    sourceCommit: expected.sourceCommit,
    sourceLabelsSha256: canonicalSha256(expected.labels),
    totalDescriptorBytes: config.size + layers.reduce((sum, layer) => sum + layer.size, 0),
  };
  return Object.freeze({ ...unsigned, proofSha256: canonicalSha256(unsigned) });
}

function validateRunPodEvidence(value) {
  if (
    value?.accountIdSha256 !== RUNPOD_ACCOUNT_ID_SHA256 ||
    !Number.isFinite(value?.billing?.cumulativeEndpointBillingUsd) ||
    value.billing.cumulativeEndpointBillingUsd < 0 ||
    !HASH.test(value.billing.rowsSha256 ?? "") ||
    value?.inventory?.activeWorkers !== 0 ||
    value.inventory.endpoints !== 0 ||
    value.inventory.pods !== 0 ||
    value.inventory.privateTemplates !== 0 ||
    canonicalJson(value.inventory.retainedVolumes) !== canonicalJson(V209_RETAINED_VOLUMES) ||
    value?.offering?.gpu !== "NVIDIA GeForce RTX 4090" ||
    value.offering.region !== "EU-RO-1" ||
    !["LOW", "MEDIUM", "HIGH"].includes(value.offering.availability) ||
    !Number.isFinite(value.offering.serverlessFlexRateUsdPerGpuHour) ||
    value.offering.serverlessFlexRateUsdPerGpuHour <= 0 ||
    value.offering.serverlessFlexRateUsdPerGpuHour > MAX_RATE_USD_PER_GPU_HOUR ||
    !HASH.test(value.offering.catalogSha256 ?? "")
  )
    fail("RUNPOD_EVIDENCE_DRIFT");
  return value;
}

function validateImageEvidence(values) {
  if (!Array.isArray(values) || values.length !== V209_FROZEN_IMAGES.length)
    fail("GHCR_EVIDENCE_DRIFT");
  for (const [index, expected] of V209_FROZEN_IMAGES.entries()) {
    const value = values[index];
    if (
      value?.lane !== expected.lane ||
      value.repository !== expected.repository ||
      value.manifestDigest !== expected.manifestDigest ||
      value.configDigest !== expected.configDigest ||
      value.sourceCommit !== expected.sourceCommit ||
      value.frozenAnonymousProofSha256 !== expected.frozenAnonymousProofSha256 ||
      value.anonymous !== true ||
      value.architecture !== "amd64" ||
      value.os !== "linux" ||
      !Number.isSafeInteger(value.descriptorCount) ||
      value.descriptorCount < 2 ||
      !HASH.test(value.sourceLabelsSha256 ?? "") ||
      !HASH.test(value.proofSha256 ?? "")
    )
      fail("GHCR_EVIDENCE_DRIFT");
    const unsigned = { ...value };
    delete unsigned.proofSha256;
    if (canonicalSha256(unsigned) !== value.proofSha256) fail("GHCR_EVIDENCE_HASH");
  }
  return values;
}

export async function runV209ReadOnlyPreflight(
  { expectedSource, apiKey },
  {
    fetchImpl = fetch,
    now = () => new Date(),
    head = expectedSource,
    trackedClean = true,
    readRunPod = readRunPodEvidence,
    verifyImage = verifyFrozenImage,
  } = {},
) {
  if (
    !COMMIT.test(expectedSource ?? "") ||
    !COMMIT.test(head ?? "") ||
    expectedSource !== head ||
    trackedClean !== true ||
    typeof apiKey !== "string" ||
    apiKey.trim() !== apiKey ||
    apiKey.length < 20 ||
    typeof fetchImpl !== "function" ||
    typeof now !== "function" ||
    typeof readRunPod !== "function" ||
    typeof verifyImage !== "function"
  )
    fail("SOURCE_OR_INPUT_BINDING");
  const observed = now();
  if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) fail("CLOCK");
  const checkedAt = observed.toISOString();
  const [rawRunpod, rawImages] = await Promise.all([
    readRunPod({ apiKey, fetchImpl, checkedAt }),
    Promise.all(V209_FROZEN_IMAGES.map((image) => verifyImage(fetchImpl, image))),
  ]);
  const runpod = validateRunPodEvidence(rawRunpod);
  const images = validateImageEvidence(rawImages);
  const unsigned = {
    schemaVersion: "videoforge.v209-read-only-preflight/v1",
    checkpoint: "V2-09",
    checkedAt,
    expectedCleanSource: expectedSource,
    authority: Object.freeze({
      credentialReads: 1,
      databaseCalls: 0,
      externalSpendUsd: 0,
      gpuJobs: 0,
      providerMutations: 0,
      r2Calls: 0,
      runpodJobPosts: 0,
      stage6Reruns: 0,
      stage7Reruns: 0,
    }),
    images,
    runpod,
  };
  return Object.freeze({ ...unsigned, proofSha256: canonicalSha256(unsigned) });
}

const stableFileMetadata = (metadata) =>
  [
    metadata.dev,
    metadata.ino,
    metadata.mode,
    metadata.nlink,
    metadata.uid,
    metadata.gid,
    metadata.rdev,
    metadata.size,
    metadata.mtimeNs,
    metadata.ctimeNs,
  ].join(":");

const validateApiKeyFile = (metadata) => {
  if (
    !metadata.isFile() ||
    (metadata.mode & 0o777n) !== 0o600n ||
    (typeof process.getuid === "function" && metadata.uid !== BigInt(process.getuid()))
  )
    fail("API_KEY_FILE");
};

export async function secureApiKey(path, { lstatImpl = lstat, openImpl = open } = {}) {
  const resolved = resolve(path);
  let handle;
  try {
    const pathBefore = await lstatImpl(resolved, { bigint: true });
    if (pathBefore.isSymbolicLink()) fail("API_KEY_FILE");
    validateApiKeyFile(pathBefore);
    handle = await openImpl(resolved, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const openedBefore = await handle.stat({ bigint: true });
    validateApiKeyFile(openedBefore);
    if (stableFileMetadata(pathBefore) !== stableFileMetadata(openedBefore)) fail("API_KEY_FILE");
    const bytes = await handle.readFile();
    const openedAfter = await handle.stat({ bigint: true });
    const pathAfter = await lstatImpl(resolved, { bigint: true });
    if (pathAfter.isSymbolicLink()) fail("API_KEY_FILE");
    validateApiKeyFile(openedAfter);
    validateApiKeyFile(pathAfter);
    if (
      stableFileMetadata(openedBefore) !== stableFileMetadata(openedAfter) ||
      stableFileMetadata(openedAfter) !== stableFileMetadata(pathAfter)
    )
      fail("API_KEY_FILE");
    if (bytes.length < 20 || bytes.length > 4096 || bytes.includes(0)) fail("API_KEY_FILE");
    const value = bytes.toString("utf8");
    if (value.trim() !== value) fail("API_KEY_FILE");
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === "V2_09_READ_ONLY_PREFLIGHT_API_KEY_FILE")
      throw error;
    fail("API_KEY_FILE");
  } finally {
    try {
      await handle?.close();
    } catch {
      fail("API_KEY_FILE");
    }
  }
}

async function gitRead(args) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8", shell: false });
  if (result.error || result.status !== 0) fail("GIT_READ");
  return result.stdout.trim();
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--expected-source" || args[2] !== "--runpod-api-key-file")
    fail("USAGE");
  const expectedSource = args[1];
  const [apiKey, head, status] = await Promise.all([
    secureApiKey(args[3]),
    gitRead(["rev-parse", "HEAD"]),
    gitRead(["status", "--porcelain", "--untracked-files=no"]),
  ]);
  const evidence = await runV209ReadOnlyPreflight(
    { expectedSource, apiKey },
    { head, trackedClean: status === "" },
  );
  process.stdout.write(`${canonicalJson(evidence)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : "V2_09_READ_ONLY_PREFLIGHT_FAILED"}\n`,
    );
    process.exitCode = 1;
  }
}
