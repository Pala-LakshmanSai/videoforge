import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createRunPodPerMutationAdmissionReader,
  parseAuthenticatedRunPodServerlessFlexRate,
  parseOfficialRunPodServerlessFlexRate,
  validateRunPodPerMutationRawComputeInventory,
} from "../../deploy/v2-13/full-live-adapters.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const executorPath = join(ROOT, "deploy/v2-13/full-live-executor.mjs");
// The repository is intentionally mid-reseal while several disjoint source lanes are landing.
// Import only the executor's pure admission helpers through a disposable sibling module; the
// canonical source-pin/closure suites remain responsible for the later root-owned hash cascade.
const sourcePinnedPaths = [
  "deploy/v2-13/full-live-adapters.mjs",
  "deploy/v2-13/promote-qualified-production.mjs",
  "deploy/v2-13/guarded-activation.mjs",
  "apps/web/src/server/providers/v213-full-live-cli.ts",
  "apps/web/src/server/providers/v213-runpod-dual-lane-transport.ts",
  "packages/control-plane/migrations/0045_hosted_full_live_activation.sql",
  "deploy/v2-13/neon-full-live-operator-grants.sql",
  "packages/control-plane/migrations/manifest.json",
  "deploy/v2-13/full-live-source-closure.json",
];
let executorSource = readFileSync(executorPath, "utf8");
for (const path of sourcePinnedPaths) {
  const currentSha256 = `sha256:${createHash("sha256")
    .update(readFileSync(join(ROOT, path)))
    .digest("hex")}`;
  executorSource = executorSource.replace(
    new RegExp(`("${path.replaceAll("/", "\\/")}":\\s*\\n\\s*)"sha256:[0-9a-f]{64}"`, "u"),
    `$1"${currentSha256}"`,
  );
}
executorSource = executorSource.replace(
  "validateFullLiveSourceClosure();",
  "// deferred hash cascade",
);
executorSource = executorSource.replace(
  `const CONCRETE_LIVE_ADAPTERS = createConcreteFullLiveAdapters({
  githubVerification: { isCancelled: productionCancellationSource },
});`,
  "const CONCRETE_LIVE_ADAPTERS = Object.freeze({});",
);
const temporaryExecutorPath = join(
  dirname(executorPath),
  `.v2-13-per-mutation-admission-${process.pid}.mjs`,
);
writeFileSync(temporaryExecutorPath, executorSource, { mode: 0o600 });
let executor;
try {
  executor = await import(`${pathToFileURL(temporaryExecutorPath).href}?test=${Date.now()}`);
} finally {
  unlinkSync(temporaryExecutorPath);
}
const { OPERATIONS, assertResult, readFreshRunPodMutationAdmission } = executor;

const HASH_A = `sha256:${"a".repeat(64)}`;
const HASH_B = `sha256:${"b".repeat(64)}`;
const OUTER = `sha256:${"c".repeat(64)}`;
const ACCOUNT = "sha256:ce23456f35fb79195520689203584405ad191e8461e87f413ede02f01168143c";
const MUTATIONS = [
  "mage-live-qualification",
  "soulx-live-qualification",
  "create-exact-max-one-endpoints",
  "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot",
  "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output",
  "v2-13-final-two-lane-smoke",
];
const VOLUMES = [
  {
    lane: "mage",
    volumeIdSha256: "sha256:eae4e1ecee86be5d8bed2f6814e06332bc8a97e9f35767771d28c10cfdecd619",
    volumeManifestSha256: "sha256:cebcd5c6233c2eae32f26ced7510acef8192f0d92d7ec3e9dd3ee881d66d205b",
    sizeGb: 50,
    region: "EU-RO-1",
  },
  {
    lane: "soulx",
    volumeIdSha256: "sha256:2a8633e14bbecab54f52e2ae7b5b06bfa562b09a6ac781fe0985eb28e70587be",
    volumeManifestSha256: "sha256:995a8e478b6a3265d5a116ca283229ad0d358a5348f16f851dc0fed564bf5626",
    sizeGb: 50,
    region: "EU-RO-1",
  },
];
const ENDPOINT_BINDINGS = [
  {
    lane: "mage",
    endpointIdSha256: HASH_A,
    templateIdSha256: `sha256:${"1".repeat(64)}`,
    imageSha256: `sha256:${"2".repeat(64)}`,
    deploymentSha256: `sha256:${"3".repeat(64)}`,
    volumeIdSha256: VOLUMES[0].volumeIdSha256,
    volumeManifestSha256: VOLUMES[0].volumeManifestSha256,
    region: "EU-RO-1",
    gpu: "NVIDIA GeForce RTX 4090",
    gpuCount: 1,
    workersMin: 0,
    workersMax: 1,
  },
  {
    lane: "soulx",
    endpointIdSha256: HASH_B,
    templateIdSha256: `sha256:${"4".repeat(64)}`,
    imageSha256: `sha256:${"5".repeat(64)}`,
    deploymentSha256: `sha256:${"6".repeat(64)}`,
    volumeIdSha256: VOLUMES[1].volumeIdSha256,
    volumeManifestSha256: VOLUMES[1].volumeManifestSha256,
    region: "EU-RO-1",
    gpu: "NVIDIA GeForce RTX 4090",
    gpuCount: 1,
    workersMin: 0,
    workersMax: 1,
  },
];

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

const sha256 = (value) =>
  `sha256:${createHash("sha256")
    .update(Buffer.from(canonicalJson(value)))
    .digest("hex")}`;
const rawSha256 = (value) =>
  `sha256:${createHash("sha256").update(Buffer.from(value)).digest("hex")}`;

const state = {
  approved_at: "2026-08-29T00:00:00.000Z",
  expires_at: "2026-08-30T00:00:00.000Z",
};
const priorResults = new Map([
  [
    "create-exact-max-one-endpoints",
    {
      materialization: {
        production: {
          mage: ENDPOINT_BINDINGS[0],
          soulx: ENDPOINT_BINDINGS[1],
        },
      },
    },
  ],
]);

function operation(id) {
  const selected = OPERATIONS.find((item) => item.id === id);
  assert.ok(selected);
  return selected;
}

function admission(id, checkedAt, overrides = {}) {
  const unsigned = {
    schemaVersion: "videoforge.v213-runpod-per-mutation-admission/v2",
    operationId: id,
    outerStateSha256BeforeAuthorization: OUTER,
    checkedAt,
    authenticatedAccountSha256: ACCOUNT,
    exactGpu: "NVIDIA GeForce RTX 4090",
    region: "EU-RO-1",
    availability: "LOW",
    serverlessFlexRateUsdPerSecond: 0.00031,
    serverlessFlexRateUsdPerGpuHour: 1.116,
    serverlessFlexRateAuthenticatedCatalogSha256: `sha256:${"d".repeat(64)}`,
    serverlessFlexRateSource: "https://docs.runpod.io/serverless/endpoints/endpoint-configurations",
    serverlessFlexRateSourceCheckedAt: checkedAt,
    serverlessFlexRateSourceSha256: `sha256:${"e".repeat(64)}`,
    noFallback: true,
    activeWorkers: 0,
    runningPods: 0,
    endpointBindings: id.startsWith("v2-") ? ENDPOINT_BINDINGS : [],
    retainedVolumes: VOLUMES,
    serverlessCatalogSha256: `sha256:${"d".repeat(64)}`,
    ...overrides,
  };
  return { ...unsigned, proofSha256: sha256(unsigned) };
}

test("all eight RunPod mutation boundaries perform a fresh read on restart", async () => {
  const reads = new Map();
  const reader = async ({ operation: selected, trustedTime }) => {
    reads.set(selected.id, (reads.get(selected.id) ?? 0) + 1);
    return admission(selected.id, trustedTime);
  };
  for (let restart = 0; restart < 2; restart += 1) {
    for (const id of MUTATIONS) {
      const trustedTime = `2026-08-29T00:00:${String(restart).padStart(2, "0")}.000Z`;
      await readFreshRunPodMutationAdmission({
        readMutationAdmission: reader,
        operation: operation(id),
        state,
        results: priorResults,
        outerStateSha256: OUTER,
        trustedTime,
      });
    }
  }
  assert.deepEqual(Object.fromEntries(reads), Object.fromEntries(MUTATIONS.map((id) => [id, 2])));
});

test("authenticated official Serverless catalog is parsed instead of synthesizing the rate", () => {
  const markdown = `| GPU type(s) | Memory | Cost per second | Description |
| --- | --- | --- | --- |
| 4090 PRO | 24 GB | $0.00031 | NVIDIA GeForce RTX 4090 |`;
  assert.deepEqual(parseOfficialRunPodServerlessFlexRate(markdown), {
    rateUsdPerSecond: 0.00031,
    rateUsdPerGpuHour: 1.116,
  });
  assert.throws(
    () => parseOfficialRunPodServerlessFlexRate(markdown.replace("$0.00031", "unavailable")),
    /RUNPOD_MUTATION_ADMISSION_RATE_SOURCE/u,
  );
  assert.deepEqual(
    parseAuthenticatedRunPodServerlessFlexRate({
      gpus: [
        {
          id: "NVIDIA GeForce RTX 4090",
          manufacturer: "NVIDIA",
          price: { flex: 0.00031 },
          dataCenters: [{ id: "EU-RO-1", availability: "LOW" }],
        },
      ],
    }),
    { rateUsdPerSecond: 0.00031, rateUsdPerGpuHour: 1.116 },
  );
  assert.throws(
    () =>
      parseAuthenticatedRunPodServerlessFlexRate({
        gpus: [
          {
            id: "NVIDIA GeForce RTX 4090",
            manufacturer: "NVIDIA",
            price: { flex: "unknown" },
            dataCenters: [{ id: "EU-RO-1", availability: "LOW" }],
          },
        ],
      }),
    /RUNPOD_MUTATION_ADMISSION_RATE_CATALOG/u,
  );
  assert.throws(
    () =>
      parseAuthenticatedRunPodServerlessFlexRate({
        gpus: [
          {
            id: "NVIDIA GeForce RTX 4090",
            manufacturer: "NVIDIA",
            price: { flex: 0.00031 },
            dataCenters: [{ id: "EU-RO-1", availability: "NONE" }],
          },
        ],
      }),
    /RUNPOD_MUTATION_ADMISSION_RATE_CATALOG/u,
  );
});

for (const [name, overrides] of [
  ["rate", { serverlessFlexRateUsdPerSecond: 0.00032 }],
  ["hourly rate", { serverlessFlexRateUsdPerGpuHour: 1.117 }],
  ["availability", { availability: "NONE" }],
  ["active worker", { activeWorkers: 1 }],
  ["stale official rate", { serverlessFlexRateSourceCheckedAt: "2026-08-28T23:00:00.000Z" }],
  ["volume", { retainedVolumes: VOLUMES.slice(0, 1) }],
  ["endpoint", { endpointBindings: ENDPOINT_BINDINGS.slice(0, 1) }],
]) {
  test(`${name} drift prevents the mutation`, async () => {
    let mutations = 0;
    const trustedTime = "2026-08-29T00:00:00.000Z";
    await assert.rejects(async () => {
      await readFreshRunPodMutationAdmission({
        readMutationAdmission: async () =>
          admission("v2-09-short-hosted-project", trustedTime, overrides),
        operation: operation("v2-09-short-hosted-project"),
        state,
        results: priorResults,
        outerStateSha256: OUTER,
        trustedTime,
      });
      mutations += 1;
    }, /V2_13_FULL_LIVE_EXECUTOR_PER_MUTATION_RUNPOD_ADMISSION/u);
    assert.equal(mutations, 0);
  });
}

test("raw inventory rejects every missing, unknown, active, or conflicting pod and worker state", () => {
  for (const pod of [
    {},
    { desiredStatus: "EXITED" },
    { desiredStatus: "UNKNOWN", status: "UNKNOWN" },
    { desiredStatus: "RUNNING", status: "RUNNING" },
    { desiredStatus: "EXITED", status: "RUNNING" },
  ])
    assert.throws(
      () =>
        validateRunPodPerMutationRawComputeInventory({
          pods: [pod],
          endpoints: [],
          templates: [],
          expectedEndpointBindings: [],
        }),
      /RUNPOD_MUTATION_ADMISSION_POD_STATE/u,
    );

  const endpointId = "endpoint-mage";
  const templateId = "template-mage";
  const volumeId = "volume-mage";
  const image = `ghcr.io/example/mage@sha256:${"7".repeat(64)}`;
  const expected = [
    {
      ...ENDPOINT_BINDINGS[0],
      endpointIdSha256: rawSha256(endpointId),
      templateIdSha256: rawSha256(templateId),
      imageSha256: rawSha256(image),
      volumeIdSha256: rawSha256(volumeId),
    },
  ];
  const endpoint = {
    id: endpointId,
    templateId,
    workersMin: 0,
    workersMax: 1,
    gpuCount: 1,
    gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
    dataCenterIds: ["EU-RO-1"],
    networkVolumeId: volumeId,
    networkVolumeIds: [volumeId],
    workers: [],
  };
  const templates = [{ id: templateId, imageName: image }];
  assert.deepEqual(
    validateRunPodPerMutationRawComputeInventory({
      pods: [{ desiredStatus: "EXITED", status: "TERMINATED" }],
      endpoints: [endpoint],
      templates,
      expectedEndpointBindings: expected,
    }),
    expected,
  );
  for (const workers of [
    undefined,
    [{}],
    [{ desiredStatus: "EXITED" }],
    [{ desiredStatus: "UNKNOWN", status: "UNKNOWN" }],
    [{ desiredStatus: "RUNNING", status: "RUNNING" }],
  ])
    assert.throws(
      () =>
        validateRunPodPerMutationRawComputeInventory({
          pods: [],
          endpoints: [{ ...endpoint, workers }],
          templates,
          expectedEndpointBindings: expected,
        }),
      /RUNPOD_MUTATION_ADMISSION_(ENDPOINTS|WORKER_STATE)/u,
    );
});

test("production reader fetches authenticated Serverless availability and rejects account drift", async () => {
  const directory = mkdtempSync(join(tmpdir(), "v213-mutation-admission-reader-"));
  chmodSync(directory, 0o700);
  const apiKeyPath = join(directory, "runpod-api-key");
  writeFileSync(apiKeyPath, "x".repeat(32), { mode: 0o600 });
  const trustedTime = "2026-08-29T00:00:00.000Z";
  const markdown = `| GPU type(s) | Memory | Cost per second | Description |
| --- | --- | --- | --- |
| 4090 PRO | 24 GB | $0.00031 | NVIDIA GeForce RTX 4090 |`;
  const urls = [];
  const fetchImpl = async (url, init) => {
    urls.push(url);
    if (url === "https://docs.runpod.io/serverless/endpoints/endpoint-configurations")
      return {
        ok: true,
        url,
        headers: {
          get: (name) =>
            name.toLowerCase() === "content-type"
              ? "text/markdown; charset=utf-8"
              : name.toLowerCase() === "date"
                ? "Sat, 29 Aug 2026 00:00:00 GMT"
                : null,
        },
        text: async () => markdown,
      };
    assert.equal(init.headers.authorization, `Bearer ${"x".repeat(32)}`);
    const value =
      url === "https://api.runpod.io/graphql"
        ? { data: { myself: { id: "7tmzcqt0ttd0u0" } } }
        : url.includes("catalog/gpus")
          ? {
              gpus: [
                {
                  id: "NVIDIA GeForce RTX 4090",
                  manufacturer: "NVIDIA",
                  price: { flex: 0.00031 },
                  dataCenters: [{ id: "EU-RO-1", availability: "LOW" }],
                },
              ],
            }
          : url.includes("/pods")
            ? [{ desiredStatus: "UNKNOWN", status: "UNKNOWN" }]
            : [];
    return { ok: true, json: async () => value };
  };
  try {
    const reader = createRunPodPerMutationAdmissionReader({
      environment: { VIDEOFORGE_V2_13_RUNPOD_API_KEY_FILE: apiKeyPath },
      fetchImpl,
      now: () => new Date(trustedTime),
    });
    await assert.rejects(
      reader({
        operation: operation("mage-live-qualification"),
        state,
        priorResults,
        outerStateSha256: OUTER,
        trustedTime,
      }),
      /RUNPOD_MUTATION_ADMISSION_ACCOUNT/u,
    );
    assert.equal(
      urls.includes(
        "https://api.runpod.io/v2/catalog/gpus?include=AVAILABILITY&product=SERVERLESS",
      ),
      true,
    );
    assert.equal(
      urls.some((url) => url.includes("product=POD")),
      false,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

for (const [name, drift] of [
  ["template", { templateId: "template-other" }],
  ["GPU", { gpuTypeIds: ["NVIDIA L40S"] }],
  ["region", { dataCenterIds: ["US-KS-2"] }],
  ["volume", { networkVolumeId: "volume-other", networkVolumeIds: ["volume-other"] }],
]) {
  test(`raw endpoint ${name} drift fails before mutation`, () => {
    const endpointId = "endpoint-mage";
    const templateId = "template-mage";
    const volumeId = "volume-mage";
    const image = `ghcr.io/example/mage@sha256:${"7".repeat(64)}`;
    const expected = [
      {
        ...ENDPOINT_BINDINGS[0],
        endpointIdSha256: rawSha256(endpointId),
        templateIdSha256: rawSha256(templateId),
        imageSha256: rawSha256(image),
        volumeIdSha256: rawSha256(volumeId),
      },
    ];
    assert.throws(() =>
      validateRunPodPerMutationRawComputeInventory({
        pods: [],
        endpoints: [
          {
            id: endpointId,
            templateId,
            workersMin: 0,
            workersMax: 1,
            gpuCount: 1,
            gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
            dataCenterIds: ["EU-RO-1"],
            networkVolumeId: volumeId,
            networkVolumeIds: [volumeId],
            workers: [],
            ...drift,
          },
        ],
        templates: [{ id: templateId, imageName: image }],
        expectedEndpointBindings: expected,
      }),
    );
  });
}

test("raw template image drift fails before mutation", () => {
  const endpointId = "endpoint-mage";
  const templateId = "template-mage";
  const volumeId = "volume-mage";
  const image = `ghcr.io/example/mage@sha256:${"7".repeat(64)}`;
  const expected = [
    {
      ...ENDPOINT_BINDINGS[0],
      endpointIdSha256: rawSha256(endpointId),
      templateIdSha256: rawSha256(templateId),
      imageSha256: rawSha256(image),
      volumeIdSha256: rawSha256(volumeId),
    },
  ];
  assert.throws(
    () =>
      validateRunPodPerMutationRawComputeInventory({
        pods: [],
        endpoints: [
          {
            id: endpointId,
            templateId,
            workersMin: 0,
            workersMax: 1,
            gpuCount: 1,
            gpuTypeIds: ["NVIDIA GeForce RTX 4090"],
            dataCenterIds: ["EU-RO-1"],
            networkVolumeId: volumeId,
            workers: [],
          },
        ],
        templates: [{ id: templateId, imageName: image.replace("7", "8") }],
        expectedEndpointBindings: expected,
      }),
    /RUNPOD_MUTATION_ADMISSION_TEMPLATE_DRIFT/u,
  );
});

test("CAS-bound proof cannot authorize a later outer state", async () => {
  const trustedTime = "2026-08-29T00:00:00.000Z";
  await assert.rejects(
    readFreshRunPodMutationAdmission({
      readMutationAdmission: async () => admission("v2-09-short-hosted-project", trustedTime),
      operation: operation("v2-09-short-hosted-project"),
      state,
      results: priorResults,
      outerStateSha256: `sha256:${"9".repeat(64)}`,
      trustedTime,
    }),
    /PER_MUTATION_RUNPOD_ADMISSION/u,
  );
});

test("mutation result always requires the durable reserved-proof event", () => {
  const selected = operation("v2-09-short-hosted-project");
  const checkedAt = "2026-08-29T00:00:00.000Z";
  const proof = admission(selected.id, checkedAt);
  const workId = `authority:${selected.id}`;
  const result = {
    actualUsd: 0,
    mutationAdmission: proof,
    mutationAdmissionProofSha256: proof.proofSha256,
    mutationAdmissionCheckedAt: proof.checkedAt,
  };
  assert.throws(
    () =>
      assertResult(
        selected,
        result,
        {
          ...state,
          authority_id: "authority",
          phases: {
            [selected.phase]: {
              work: { [workId]: { authorization_event_id: `authority:${selected.id}:reserved` } },
            },
          },
        },
        priorResults,
      ),
    /PER_MUTATION_RUNPOD_ADMISSION_AUTHORIZATION_BINDING/u,
  );
});

test("durable reserved-proof event validates the result-contained proof without an executor argument", () => {
  const selected = operation("v2-09-short-hosted-project");
  const checkedAt = "2026-08-29T00:00:00.000Z";
  const proof = admission(selected.id, checkedAt);
  const workId = `authority:${selected.id}`;
  const result = {
    actualUsd: 0,
    mutationAdmission: proof,
    mutationAdmissionProofSha256: proof.proofSha256,
    mutationAdmissionCheckedAt: proof.checkedAt,
    accepted: true,
    terminal: true,
    evidenceSha256: `sha256:${"8".repeat(64)}`,
    zeroWorkersAfter: true,
    durationSeconds: 45,
  };
  const reserved = proof.proofSha256.slice("sha256:".length);
  assert.equal(
    assertResult(
      selected,
      result,
      {
        ...state,
        authority_id: "authority",
        phases: {
          [selected.phase]: {
            work: {
              [workId]: {
                authorization_event_id: `authority:${selected.id}:reserved-${reserved}`,
              },
            },
          },
        },
      },
      priorResults,
    ),
    result,
  );
});

test("cleanup proof validation remains admission-free", () => {
  const selected = operation("prove-zero-workers");
  const result = { actualUsd: 0 };
  assert.equal(assertResult(selected, result, {}, new Map()), result);
});
