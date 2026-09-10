#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseAuthenticatedRunPodServerlessAvailability,
  readOfficialRunPodServerlessFlexRate,
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
const MAX_RATE_USD_PER_SECOND = 0.00031;
const GHCR_ORIGIN = "https://ghcr.io";
const GHCR_BLOB_REDIRECT_HOST = "pkg-containers.githubusercontent.com";
const GHCR_HEADER_TIMEOUT_MILLISECONDS = 60_000;
const GHCR_BODY_IDLE_TIMEOUT_MILLISECONDS = 60_000;
const GHCR_BODY_MINIMUM_TIMEOUT_MILLISECONDS = 5 * 60_000;
const GHCR_BODY_MAXIMUM_TIMEOUT_MILLISECONDS = 2 * 60 * 60_000;
const GHCR_BODY_DEADLINE_GRACE_MILLISECONDS = 5 * 60_000;
const GHCR_BODY_MINIMUM_BYTES_PER_SECOND = 256 * 1024;
const MAX_TOKEN_BYTES = 64 * 1024;
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
    volumeManifestSha256: "sha256:ffaf47d13c92407a51d2aa78337612daf2733f5a5bb93e27336822a5389ba1c9",
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
    manifestDigest: "sha256:26680786552e7a40f88a312e97720dffa6944173eb83080a100989beac2216b0",
    configDigest: "sha256:9758825b923a26832570ff68fb841a95f24d9b0f5c684f67443039e6ebf36e34",
    sourceCommit: "737b59cf783ce4de24ac5beb1db760fb0b97b0a6",
    frozenAnonymousProofSha256:
      "sha256:92a8ca6f5736d3d5210c174cd49b1e9fd33a363a4de8b3fb6804747d76be3b61",
    labels: Object.freeze({
      "ai.videoforge.source-commit": "737b59cf783ce4de24ac5beb1db760fb0b97b0a6",
      "org.opencontainers.image.base.digest":
        "sha256:91ef608fbb15bc69213c73a598a8915fa4dfa938d02c619454e42319a6475f62",
      "org.opencontainers.image.base.name": "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07",
      "org.opencontainers.image.revision": "737b59cf783ce4de24ac5beb1db760fb0b97b0a6",
    }),
  }),
  Object.freeze({
    lane: "soulx_avatar",
    repository: "pala-lakshmansai/videoforge-soulx-serverless-v2-08",
    manifestDigest: "sha256:047881a3e85fcb98683c2851989ec064628fa803123588ac25929bd6ca6b243a",
    configDigest: "sha256:d08c7eba4c923db9e524974ff0590fde0f713eae74bec85b5614afc956bfa5cd",
    sourceCommit: "54c4b06bd524756ccf83e960ca4a18181de134ce",
    frozenAnonymousProofSha256:
      "sha256:16329b6cc8516f28ff4e18136204b2a602debae9ba01c5a432b574a7e18449cc",
    labels: Object.freeze({
      "ai.videoforge.lane": "soulx_avatar",
      "ai.videoforge.model-manifest":
        "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
      "ai.videoforge.model-revision": "59119b6c681230c3eeee157e224ae1941746711e",
      "ai.videoforge.runtime-profile": "videoforge_soulx_flashhead_pro_bf16_v1",
      "ai.videoforge.source-commit": "54c4b06bd524756ccf83e960ca4a18181de134ce",
      "ai.videoforge.source-revision": "9bc03de06bb0de82cd6bc477804512ae06144bf2",
      "org.opencontainers.image.base.digest":
        "sha256:0538d16199f04cac0a68ad4570b3fc260470b079200da025fe8f36640fb69a9b",
      "org.opencontainers.image.base.name":
        "ghcr.io/pala-lakshmansai/videoforge-soulx-flashhead-pro-vf924s",
      "org.opencontainers.image.revision": "54c4b06bd524756ccf83e960ca4a18181de134ce",
    }),
  }),
]);

const fail = (code) => {
  throw new Error(`V2_09_READ_ONLY_PREFLIGHT_${code}`);
};
const abortAndFail = (controller, code) => {
  controller?.abort();
  fail(code);
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

export async function readRunPodEvidence({
  apiKey,
  fetchImpl,
  checkedAt,
  expectedAccountIdSha256 = RUNPOD_ACCOUNT_ID_SHA256,
  retainedVolumePins = V209_RETAINED_VOLUMES,
  onFailure = () => {},
}) {
  const billingUrl = new URL("/v1/billing/endpoints", RUNPOD_REST_ORIGIN);
  billingUrl.searchParams.set("bucketSize", "hour");
  billingUrl.searchParams.set("grouping", "endpointId");
  billingUrl.searchParams.set("startTime", "2026-08-20T00:00:00.000Z");
  billingUrl.searchParams.set("endTime", checkedAt);
  const accountQuery = JSON.stringify({
    query: "query VideoForgeAccountIdentity { myself { id } }",
  });
  const reads = [
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
    readOfficialRunPodServerlessFlexRate(fetchImpl, checkedAt),
  ];
  let firstFailure;
  let failed = false;
  const observedReads = reads.map((read) =>
    Promise.resolve(read).catch((error) => {
      if (!failed) {
        failed = true;
        firstFailure = error;
        onFailure(error);
      }
      throw error;
    }),
  );
  const settledReads = await Promise.allSettled(observedReads);
  if (failed) throw firstFailure;
  const [account, catalog, pods, endpoints, templates, volumes, billingRows, officialPricing] =
    settledReads.map((read) => read.value);
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
  const offering = parseAuthenticatedRunPodServerlessAvailability(catalog);
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
      serverlessFlexRateUsdPerGpuHour: officialPricing.rateUsdPerGpuHour,
      serverlessFlexRateUsdPerSecond: officialPricing.rateUsdPerSecond,
      serverlessFlexRateSource:
        "https://docs.runpod.io/serverless/endpoints/endpoint-configurations",
      serverlessFlexRateSourceCheckedAt: officialPricing.sourceCheckedAt,
      serverlessFlexRateSourceSha256: officialPricing.sourceSha256,
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

export const boundedBodyTimeoutMilliseconds = (expectedSize, maximumSize) =>
  Math.min(
    GHCR_BODY_MAXIMUM_TIMEOUT_MILLISECONDS,
    Math.max(
      GHCR_BODY_MINIMUM_TIMEOUT_MILLISECONDS,
      GHCR_BODY_DEADLINE_GRACE_MILLISECONDS +
        Math.ceil(((expectedSize ?? maximumSize) / GHCR_BODY_MINIMUM_BYTES_PER_SECOND) * 1000),
    ),
  );

export async function readBoundedBody(
  { response, controller },
  {
    expectedDigest,
    expectedSize,
    maximumSize,
    collect,
    idleTimeoutMilliseconds = GHCR_BODY_IDLE_TIMEOUT_MILLISECONDS,
    absoluteTimeoutMilliseconds = boundedBodyTimeoutMilliseconds(expectedSize, maximumSize),
  },
) {
  const headerLength = response.headers.get("content-length");
  if (headerLength !== null && expectedSize !== null && Number(headerLength) !== expectedSize)
    abortAndFail(controller, "GHCR_CONTENT_LENGTH");
  const hash = createHash("sha256");
  const chunks = [];
  let size = 0;
  if (response.body === null) abortAndFail(controller, "GHCR_BODY");
  if (
    !Number.isSafeInteger(idleTimeoutMilliseconds) ||
    idleTimeoutMilliseconds <= 0 ||
    !Number.isSafeInteger(absoluteTimeoutMilliseconds) ||
    absoluteTimeoutMilliseconds <= 0
  )
    abortAndFail(controller, "GHCR_READ_AMBIGUOUS");
  let reader;
  try {
    reader = response.body.getReader();
  } catch {
    abortAndFail(controller, "GHCR_READ_AMBIGUOUS");
  }
  const absoluteDeadline = Date.now() + absoluteTimeoutMilliseconds;
  try {
    for (;;) {
      const remaining = absoluteDeadline - Date.now();
      if (remaining <= 0) fail("GHCR_READ_AMBIGUOUS");
      let timer;
      let item;
      try {
        item = await Promise.race([
          reader.read(),
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("V2_09_GHCR_BODY_READ_TIMEOUT")),
              Math.min(idleTimeoutMilliseconds, remaining),
            );
          }),
        ]);
      } catch {
        fail("GHCR_READ_AMBIGUOUS");
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
      if (item.done) break;
      if (!(item.value instanceof Uint8Array)) fail("GHCR_BODY");
      size += item.value.byteLength;
      if (size > maximumSize || (expectedSize !== null && size > expectedSize))
        fail("GHCR_BODY_SIZE");
      hash.update(item.value);
      if (collect) chunks.push(Buffer.from(item.value));
    }
  } catch (error) {
    controller.abort();
    if (error instanceof Error && error.message.startsWith("V2_09_READ_ONLY_PREFLIGHT_"))
      throw error;
    fail("GHCR_READ_AMBIGUOUS");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The response is already bounded and the controller is owned by this read.
    }
  }
  const digest = `sha256:${hash.digest("hex")}`;
  if (
    (expectedDigest !== null && digest !== expectedDigest) ||
    (expectedSize !== null && size !== expectedSize)
  )
    fail("GHCR_BODY_DIGEST");
  return Object.freeze({ bytes: collect ? Buffer.concat(chunks) : null, digest, size });
}

export async function anonymousGhcrFetch(
  fetchImpl,
  url,
  init,
  { headerTimeoutMilliseconds = GHCR_HEADER_TIMEOUT_MILLISECONDS } = {},
) {
  if (!Number.isSafeInteger(headerTimeoutMilliseconds) || headerTimeoutMilliseconds <= 0)
    fail("GHCR_READ_AMBIGUOUS");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), headerTimeoutMilliseconds);
  let response;
  try {
    response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
      signal: controller.signal,
    });
  } catch {
    controller.abort();
    fail("GHCR_READ_AMBIGUOUS");
  } finally {
    clearTimeout(timer);
  }
  if (controller.signal.aborted) fail("GHCR_READ_AMBIGUOUS");
  return Object.freeze({ response, controller });
}

async function readGhcrObject(
  fetchImpl,
  { repository, token, path, accept, kind, method = "GET" },
  fetchOptions,
) {
  const sourceUrl = `${GHCR_ORIGIN}/v2/${repository}/${path}`;
  let read = await anonymousGhcrFetch(
    fetchImpl,
    sourceUrl,
    {
      method,
      headers: { accept, authorization: `Bearer ${token}` },
    },
    fetchOptions,
  );
  let { response } = read;
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    if (kind !== "blob") abortAndFail(read.controller, "GHCR_REDIRECT");
    const location = response.headers.get("location");
    let target;
    try {
      target = new URL(location);
    } catch {
      abortAndFail(read.controller, "GHCR_BLOB_REDIRECT");
    }
    if (
      target.protocol !== "https:" ||
      target.hostname !== GHCR_BLOB_REDIRECT_HOST ||
      target.username !== "" ||
      target.password !== "" ||
      target.hash !== "" ||
      target.searchParams.getAll("se").length !== 1 ||
      target.searchParams.get("se") === "" ||
      target.searchParams.getAll("sig").length !== 1 ||
      target.searchParams.get("sig") === "" ||
      !new RegExp(
        `^/ghcr(?:blobs)?[A-Za-z0-9-]+/blobs/${path
          .slice("blobs/".length)
          .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}$`,
        "u",
      ).test(target.pathname)
    )
      abortAndFail(read.controller, "GHCR_BLOB_REDIRECT");
    read.controller.abort();
    read = await anonymousGhcrFetch(
      fetchImpl,
      target,
      {
        method,
        headers: { accept },
      },
      fetchOptions,
    );
    ({ response } = read);
  }
  if (!response?.ok) {
    read.controller.abort();
    fail("GHCR_HTTP");
  }
  return read;
}

function exactHeadContentLength(response, expectedSize) {
  const raw = response?.headers?.get("content-length");
  if (raw === null || !/^(0|[1-9][0-9]*)$/u.test(raw) || Number(raw) !== expectedSize)
    fail("GHCR_LAYER_CONTENT_LENGTH");
  return expectedSize;
}

function optionalHeadDigest(response, expectedDigest) {
  const observed = response?.headers?.get("docker-content-digest");
  if (observed !== null && observed !== undefined && observed !== expectedDigest)
    fail("GHCR_LAYER_DIGEST");
  return observed ?? null;
}

async function acquireAnonymousToken(fetchImpl, repository, readOptions) {
  const url = new URL("/token", GHCR_ORIGIN);
  url.searchParams.set("service", "ghcr.io");
  url.searchParams.set("scope", `repository:${repository}:pull`);
  const read = await anonymousGhcrFetch(
    fetchImpl,
    url,
    {
      method: "GET",
      headers: { accept: "application/json" },
    },
    readOptions,
  );
  if (!read.response?.ok) {
    read.controller.abort();
    fail("GHCR_TOKEN_HTTP");
  }
  const body = await readBoundedBody(read, {
    expectedDigest: null,
    expectedSize: null,
    maximumSize: MAX_TOKEN_BYTES,
    collect: true,
    ...readOptions,
  });
  let value;
  try {
    value = JSON.parse(body.bytes.toString("utf8"));
  } catch {
    fail("GHCR_TOKEN_JSON");
  }
  if (typeof value?.token !== "string" || value.token.length < 20 || value.token.includes("\0"))
    fail("GHCR_TOKEN");
  return value.token;
}

export async function verifyFrozenImage(fetchImpl, expected, readOptions = {}) {
  if (!HASH.test(expected?.frozenAnonymousProofSha256 ?? "")) fail("GHCR_PROOF_ANCHOR");
  const token = await acquireAnonymousToken(fetchImpl, expected.repository, readOptions);
  const manifestRead = await readGhcrObject(
    fetchImpl,
    {
      repository: expected.repository,
      token,
      path: `manifests/${expected.manifestDigest}`,
      accept: [...MANIFEST_MEDIA_TYPES].join(", "),
      kind: "manifest",
    },
    readOptions,
  );
  const manifestType = manifestRead.response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    manifestRead.response.headers.get("docker-content-digest") !== expected.manifestDigest ||
    !MANIFEST_MEDIA_TYPES.has(manifestType)
  )
    abortAndFail(manifestRead.controller, "GHCR_MANIFEST_IDENTITY");
  const manifestBody = await readBoundedBody(manifestRead, {
    expectedDigest: expected.manifestDigest,
    expectedSize: null,
    maximumSize: MAX_MANIFEST_BYTES,
    collect: true,
    ...readOptions,
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
  const configRead = await readGhcrObject(
    fetchImpl,
    {
      repository: expected.repository,
      token,
      path: `blobs/${config.digest}`,
      accept: config.mediaType,
      kind: "blob",
    },
    readOptions,
  );
  const configBody = await readBoundedBody(configRead, {
    expectedDigest: config.digest,
    expectedSize: config.size,
    maximumSize: MAX_CONFIG_BYTES,
    collect: true,
    ...readOptions,
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

  const uniqueDescriptors = [];
  const uniqueDescriptorByDigest = new Map();
  for (const layer of layers) {
    const existing = uniqueDescriptorByDigest.get(layer.digest);
    if (existing !== undefined) {
      if (existing.size !== layer.size || existing.mediaType !== layer.mediaType)
        fail("GHCR_LAYER_DESCRIPTOR_CONFLICT");
      continue;
    }
    uniqueDescriptorByDigest.set(layer.digest, layer);
    uniqueDescriptors.push(Object.freeze({ key: layer.digest, layer }));
  }
  const headResults = new Map();
  for (const { key, layer } of uniqueDescriptors) {
    const read = await readGhcrObject(
      fetchImpl,
      {
        repository: expected.repository,
        token,
        path: `blobs/${layer.digest}`,
        accept: layer.mediaType,
        kind: "blob",
        method: "HEAD",
      },
      readOptions,
    );
    try {
      if (read.response.status !== 200) fail("GHCR_LAYER_HEAD_HTTP");
      if (read.response.body !== null && read.response.body !== undefined)
        fail("GHCR_LAYER_HEAD_BODY");
      const contentLengthBytes = exactHeadContentLength(read.response, layer.size);
      const dockerContentDigest = optionalHeadDigest(read.response, layer.digest);
      headResults.set(key, Object.freeze({ contentLengthBytes, dockerContentDigest }));
    } finally {
      read.controller.abort();
    }
  }
  const layerProofs = [];
  for (const [index, layer] of layers.entries()) {
    const head = headResults.get(layer.digest);
    if (!head) fail("GHCR_LAYER_HEAD");
    layerProofs.push(
      Object.freeze({
        index,
        digest: layer.digest,
        mediaType: layer.mediaType,
        sizeBytes: layer.size,
        headContentLengthBytes: head.contentLengthBytes,
        headDockerContentDigest: head.dockerContentDigest,
      }),
    );
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
    uniqueLayerCount: uniqueDescriptors.length,
    verificationMode: "frozen-full-hash-plus-fresh-descriptor-head",
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
    !Number.isFinite(value.offering.serverlessFlexRateUsdPerSecond) ||
    value.offering.serverlessFlexRateUsdPerSecond <= 0 ||
    value.offering.serverlessFlexRateUsdPerSecond > MAX_RATE_USD_PER_SECOND ||
    value.offering.serverlessFlexRateSource !==
      "https://docs.runpod.io/serverless/endpoints/endpoint-configurations" ||
    !Number.isFinite(Date.parse(value.offering.serverlessFlexRateSourceCheckedAt ?? "")) ||
    Math.abs(
      Date.parse(value.offering.serverlessFlexRateSourceCheckedAt ?? "") -
        Date.parse(value.billing.windowEnd ?? ""),
    ) > 300_000 ||
    !HASH.test(value.offering.serverlessFlexRateSourceSha256 ?? "") ||
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
    const layers = value?.layers;
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
      value.verificationMode !== "frozen-full-hash-plus-fresh-descriptor-head" ||
      !Array.isArray(layers) ||
      layers.length !== value.descriptorCount - 1 ||
      !Number.isSafeInteger(value.uniqueLayerCount) ||
      value.uniqueLayerCount < 1 ||
      value.uniqueLayerCount > layers.length ||
      !Number.isSafeInteger(value.manifestSizeBytes) ||
      value.manifestSizeBytes < 1 ||
      !Number.isSafeInteger(value.configSizeBytes) ||
      value.configSizeBytes < 1 ||
      !Number.isSafeInteger(value.totalDescriptorBytes) ||
      value.totalDescriptorBytes < value.configSizeBytes ||
      !HASH.test(value.sourceLabelsSha256 ?? "") ||
      !HASH.test(value.proofSha256 ?? "")
    )
      fail("GHCR_EVIDENCE_DRIFT");
    const descriptorKeys = new Map();
    for (const [layerIndex, layer] of layers.entries()) {
      if (
        layer?.index !== layerIndex ||
        !HASH.test(layer.digest ?? "") ||
        !LAYER_MEDIA_TYPES.has(layer.mediaType) ||
        !Number.isSafeInteger(layer.sizeBytes) ||
        layer.sizeBytes < 1 ||
        layer.headContentLengthBytes !== layer.sizeBytes ||
        (layer.headDockerContentDigest !== null && layer.headDockerContentDigest !== layer.digest)
      )
        fail("GHCR_EVIDENCE_DRIFT");
      const descriptorKey = descriptorKeys.get(layer.digest);
      const metadata = `${layer.mediaType}:${layer.sizeBytes}`;
      if (descriptorKey !== undefined && descriptorKey !== metadata) fail("GHCR_EVIDENCE_DRIFT");
      descriptorKeys.set(layer.digest, metadata);
    }
    if (descriptorKeys.size !== value.uniqueLayerCount) fail("GHCR_EVIDENCE_DRIFT");
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
  const sharedController = new AbortController();
  let firstFailure;
  let firstFailureLatched = false;
  const latchFirstFailure = (error) => {
    if (!firstFailureLatched) {
      firstFailureLatched = true;
      firstFailure = error;
    }
    sharedController.abort();
  };
  const sharedFetch = (input, init = {}) =>
    fetchImpl(input, {
      ...init,
      signal:
        init.signal === undefined
          ? sharedController.signal
          : AbortSignal.any([sharedController.signal, init.signal]),
    });
  const trackRead = (factory) => {
    let read;
    try {
      read = factory();
    } catch (error) {
      latchFirstFailure(error);
      return Promise.reject(error);
    }
    return Promise.resolve(read).catch((error) => {
      latchFirstFailure(error);
      throw error;
    });
  };
  const reads = [
    trackRead(() =>
      readRunPod({
        apiKey,
        fetchImpl: sharedFetch,
        checkedAt,
        onFailure: latchFirstFailure,
      }),
    ),
    ...V209_FROZEN_IMAGES.map((image) => trackRead(() => verifyImage(sharedFetch, image))),
  ];
  let rawRunpod;
  let rawImages;
  try {
    [rawRunpod, ...rawImages] = await Promise.all(reads);
  } catch (error) {
    latchFirstFailure(error);
    await Promise.allSettled(reads);
    throw firstFailureLatched ? firstFailure : error;
  }
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
    metadata.nlink !== 1n ||
    metadata.size < 20n ||
    metadata.size > 4096n ||
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
