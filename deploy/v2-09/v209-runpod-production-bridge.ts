import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodServerlessJobClient,
} from "../../apps/web/src/server/providers/runpod-control.js";
import {
  createV213RunPodDualLaneTransport,
  type V213RunPodDualLaneOptions,
  type V213RunPodDualLaneTransport,
  type V213WorkerEnvironmentSecrets,
} from "../../apps/web/src/server/providers/v213-runpod-dual-lane-transport.js";
import type {
  V213InventoryRead,
  V213LaneDeployment,
} from "../../apps/web/src/server/providers/v213-dual-lane-live.js";

const SCHEMA = "videoforge.v2-09-runpod-production-bridge/v1";
const RESULT_SCHEMA = "videoforge.v2-09-runpod-production-bridge-result/v1";
const HASH = /^sha256:[0-9a-f]{64}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const AUTHORITY = /^v2-09-[a-z0-9][a-z0-9._-]{7,95}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const PUBLIC_IMAGES = Object.freeze({
  mage: "ghcr.io/pala-lakshmansai/videoforge-mage-v2-07@sha256:0f3203ceaedd8d570dcca301e32ca6d0ecb4d1136c32d5cd7d76fdc292a030cb",
  soulx:
    "ghcr.io/pala-lakshmansai/videoforge-soulx-serverless-v2-08@sha256:f3b1d1414308d0783fe006d33e6482c027e05b6029a07843af66e4a9e1c1380e",
});

type Lane = "mage" | "soulx";
type LaneBinding = Readonly<{
  lane: Lane;
  image_sha256: string;
  image_source_commit: string;
  image_config_sha256: string;
  anonymous_proof_sha256: string;
  acceptance_sha256: string;
  volume_id_sha256: string;
  volume_manifest_sha256: string;
}>;

type Request = Readonly<{
  schema_version: typeof SCHEMA;
  command: "CREATE_OR_READ_LANE";
  authority_id: string;
  source_commit: string;
  api_key: string;
  lane: Lane;
  lanes: readonly LaneBinding[];
  worker_environment: V213WorkerEnvironmentSecrets;
}>;

type ReconcileRequest = Readonly<{
  schema_version: typeof SCHEMA;
  command: "READ_INVENTORY" | "RECONCILE_TERMINAL_JOBS" | "DELETE_ATTRIBUTABLE_PAIR";
  authority_id: string;
  source_commit: string;
  api_key: string;
  lanes: readonly LaneBinding[];
  worker_environment: V213WorkerEnvironmentSecrets;
  deployments: readonly V213LaneDeployment[];
  jobs: readonly Readonly<{ lane: Lane; job_id: string; status: string | null }>[];
}>;

function fail(code: string): never {
  throw new Error(code);
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(item[key])}`)
    .join(",")}}`;
}

function sha256(value: string | Buffer): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function resourceName(resourceKey: string, suffix: "endpoint" | "template"): string {
  return `vf_v213_${createHash("sha256").update(resourceKey).digest("hex").slice(0, 24)}_${suffix}`;
}

function rawVolumeId(raw: Record<string, unknown>): string | null {
  const singular = raw.networkVolumeId;
  const plural = raw.networkVolumeIds;
  const single =
    singular === null || singular === undefined
      ? null
      : typeof singular === "string" && ID.test(singular)
        ? singular
        : undefined;
  const multiple =
    plural === null || plural === undefined
      ? null
      : Array.isArray(plural) &&
          plural.length === 1 &&
          typeof plural[0] === "string" &&
          ID.test(plural[0])
        ? plural[0]
        : undefined;
  if (single === undefined || multiple === undefined || (single && multiple && single !== multiple))
    return null;
  return single ?? multiple;
}

function expectedWorkerEnvironment(
  binding: LaneBinding,
  resourceKey: string,
  secrets: V213WorkerEnvironmentSecrets,
  endpointId?: string,
): Readonly<Record<string, string>> {
  const common = {
    LOG_LEVEL: "INFO",
    RUNPOD_INIT_TIMEOUT: "800",
    VIDEOFORGE_V213_RESOURCE_KEY_SHA256: sha256(resourceKey),
    VIDEOFORGE_V213_LANE: binding.lane,
    VIDEOFORGE_V213_PURPOSE: "production",
    VIDEOFORGE_ENVELOPE_KEY_ID: secrets.envelopeSigningKeyId,
    VIDEOFORGE_ENVELOPE_KEY_SHA256: sha256(Buffer.from(secrets.envelopeSigningKeyHex, "hex")),
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: secrets.envelopeSigningKeyHex,
    VIDEOFORGE_RECEIPT_KEY_ID: secrets.receiptKeyId,
    VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: secrets.receiptSigningKeyHex,
  };
  if (binding.lane === "mage")
    return {
      ...common,
      VIDEOFORGE_MAGE_GPU_OFFERING_ID: "NVIDIA GeForce RTX 4090",
      VIDEOFORGE_MAGE_MANIFEST_SHA256: binding.volume_manifest_sha256,
      VIDEOFORGE_MAGE_VOLUME_ID_HASH: binding.volume_id_sha256,
      VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: PUBLIC_IMAGES.mage,
      VIDEOFORGE_MAGE_WORKER_TOKEN: secrets.mageWorkerTokenHex,
      ...(endpointId ? { VIDEOFORGE_MAGE_ENDPOINT_ID_HASH: sha256(endpointId) } : {}),
    };
  return {
    ...common,
    VIDEOFORGE_SOULX_CONTAINER_DIGEST: binding.image_sha256,
    VIDEOFORGE_SOULX_MODEL_MANIFEST_SHA256: binding.volume_manifest_sha256,
    VIDEOFORGE_SOULX_VOLUME_ID_SHA256: binding.volume_id_sha256,
    ...(endpointId ? { VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256: sha256(endpointId) } : {}),
  };
}

function exactEnvironment(observed: unknown, expected: Readonly<Record<string, string>>): boolean {
  if (observed === null || typeof observed !== "object" || Array.isArray(observed)) return false;
  const value = observed as Record<string, unknown>;
  return (
    Object.keys(value).sort().join(",") === Object.keys(expected).sort().join(",") &&
    Object.entries(expected).every(([key, item]) => value[key] === item)
  );
}

function assertAttributableResourceIdentity(
  binding: LaneBinding,
  resourceKey: string,
  secrets: V213WorkerEnvironmentSecrets,
  endpoint:
    | Readonly<{ id: string; name: string; raw: Readonly<Record<string, unknown>> }>
    | undefined,
  template:
    | Readonly<{ id: string; name: string; raw: Readonly<Record<string, unknown>> }>
    | undefined,
  deployment: V213LaneDeployment | undefined,
): void {
  if (endpoint && endpoint.name !== resourceName(resourceKey, "endpoint"))
    fail("V2_09_RUNPOD_BRIDGE_ATTRIBUTABLE_ENDPOINT_DRIFT");
  if (template && template.name !== resourceName(resourceKey, "template"))
    fail("V2_09_RUNPOD_BRIDGE_ATTRIBUTABLE_TEMPLATE_DRIFT");
  if (endpoint) {
    const raw = endpoint.raw;
    const volumeId = rawVolumeId(raw as Record<string, unknown>);
    if (
      !ID.test(endpoint.id) ||
      raw.workersMin !== 0 ||
      raw.workersMax !== 1 ||
      raw.gpuCount !== 1 ||
      (raw.idleTimeout !== 5 && raw.idleTimeout !== 60) ||
      JSON.stringify(raw.gpuTypeIds) !== JSON.stringify(["NVIDIA GeForce RTX 4090"]) ||
      volumeId === null ||
      sha256(volumeId) !== binding.volume_id_sha256 ||
      (raw.dataCenterIds !== undefined &&
        JSON.stringify(raw.dataCenterIds) !== JSON.stringify(["EU-RO-1"])) ||
      (template && raw.templateId !== template.id) ||
      (deployment &&
        (sha256(endpoint.id) !== deployment.endpointIdSha256 ||
          typeof raw.templateId !== "string" ||
          sha256(raw.templateId) !== deployment.templateIdSha256 ||
          (template && sha256(template.id) !== deployment.templateIdSha256)))
    )
      fail("V2_09_RUNPOD_BRIDGE_ATTRIBUTABLE_ENDPOINT_DRIFT");
  }
  if (template) {
    const raw = template.raw;
    const baseEnvironment = expectedWorkerEnvironment(binding, resourceKey, secrets);
    const boundEnvironment = expectedWorkerEnvironment(
      binding,
      resourceKey,
      secrets,
      endpoint?.id ?? deployment?.endpointId,
    );
    const environmentMatches =
      exactEnvironment(raw.env, boundEnvironment) ||
      (deployment === undefined && exactEnvironment(raw.env, baseEnvironment));
    if (
      !ID.test(template.id) ||
      raw.imageName !== PUBLIC_IMAGES[binding.lane] ||
      (raw.isServerless !== undefined && raw.isServerless !== true) ||
      (raw.containerDiskInGb !== undefined && raw.containerDiskInGb !== 120) ||
      !environmentMatches ||
      (deployment && sha256(template.id) !== deployment.templateIdSha256)
    )
      fail("V2_09_RUNPOD_BRIDGE_ATTRIBUTABLE_TEMPLATE_DRIFT");
  }
}

function exactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(",") === [...keys].sort().join(",")
  );
}

function laneBinding(value: unknown, expected: Lane): LaneBinding {
  const keys = [
    "acceptance_sha256",
    "anonymous_proof_sha256",
    "image_config_sha256",
    "image_sha256",
    "image_source_commit",
    "lane",
    "volume_id_sha256",
    "volume_manifest_sha256",
  ];
  if (
    !exactKeys(value, keys) ||
    value.lane !== expected ||
    !HASH.test(String(value.image_sha256)) ||
    !COMMIT.test(String(value.image_source_commit)) ||
    !HASH.test(String(value.image_config_sha256)) ||
    !HASH.test(String(value.anonymous_proof_sha256)) ||
    !HASH.test(String(value.acceptance_sha256)) ||
    !HASH.test(String(value.volume_id_sha256)) ||
    !HASH.test(String(value.volume_manifest_sha256)) ||
    !PUBLIC_IMAGES[expected].endsWith(String(value.image_sha256))
  )
    fail("V2_09_RUNPOD_BRIDGE_LANE_INVALID");
  return value as LaneBinding;
}

function request(value: unknown): Request | ReconcileRequest {
  const item = value as Record<string, unknown>;
  const common =
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    item.schema_version === SCHEMA &&
    AUTHORITY.test(String(item.authority_id)) &&
    COMMIT.test(String(item.source_commit)) &&
    typeof item.api_key === "string" &&
    item.api_key.trim() === item.api_key &&
    item.api_key.length >= 20 &&
    Array.isArray(item.lanes) &&
    item.lanes.length === 2;
  if (!common) fail("V2_09_RUNPOD_BRIDGE_REQUEST_INVALID");
  const rawLanes = item.lanes as unknown[];
  const lanes = [laneBinding(rawLanes[0], "mage"), laneBinding(rawLanes[1], "soulx")];
  if (
    item.command === "READ_INVENTORY" ||
    item.command === "RECONCILE_TERMINAL_JOBS" ||
    item.command === "DELETE_ATTRIBUTABLE_PAIR"
  ) {
    if (
      !exactKeys(value, [
        "api_key",
        "authority_id",
        "command",
        "deployments",
        "jobs",
        "lanes",
        "schema_version",
        "source_commit",
        "worker_environment",
      ]) ||
      !Array.isArray(item.deployments) ||
      item.deployments.length > 2 ||
      !Array.isArray(item.jobs) ||
      item.jobs.length > 2
    )
      fail("V2_09_RUNPOD_BRIDGE_RECONCILE_REQUEST_INVALID");
    const rawDeployments = item.deployments as unknown[];
    const deployments = rawDeployments.map((deploymentValue) => {
      const deployment = deploymentValue as Record<string, unknown>;
      const lane = deployment.lane;
      if (lane !== "mage" && lane !== "soulx") fail("V2_09_RUNPOD_BRIDGE_DEPLOYMENT_INVALID");
      const binding = lanes.find((candidate) => candidate.lane === lane)!;
      if (
        !exactKeys(deployment, [
          "deploymentSha256",
          "endpointId",
          "endpointIdSha256",
          "gpu",
          "gpuCount",
          "handlerConcurrency",
          "idleTimeoutSeconds",
          "image",
          "initTimeoutSeconds",
          "lane",
          "purpose",
          "region",
          "resourceKey",
          "scalerType",
          "scalerValue",
          "sourceCommit",
          "templateId",
          "templateIdSha256",
          "volumeIdSha256",
          "volumeManifestSha256",
          "volumeMount",
          "volumeSizeGb",
          "workersMax",
          "workersMin",
        ]) ||
        deployment.lane !== lane ||
        deployment.purpose !== "production" ||
        deployment.resourceKey !== `${String(item.authority_id)}-${lane}-production` ||
        deployment.endpointIdSha256 !== sha256(String(deployment.endpointId)) ||
        deployment.templateIdSha256 !== sha256(String(deployment.templateId)) ||
        deployment.image !== PUBLIC_IMAGES[lane as Lane] ||
        deployment.sourceCommit !== item.source_commit ||
        deployment.volumeIdSha256 !== binding.volume_id_sha256 ||
        deployment.volumeManifestSha256 !== binding.volume_manifest_sha256 ||
        deployment.volumeSizeGb !== 50 ||
        deployment.volumeMount !== "/runpod-volume" ||
        deployment.region !== "EU-RO-1" ||
        deployment.gpu !== "NVIDIA GeForce RTX 4090" ||
        deployment.gpuCount !== 1 ||
        deployment.workersMin !== 0 ||
        deployment.workersMax !== 1 ||
        deployment.handlerConcurrency !== 1 ||
        deployment.idleTimeoutSeconds !== 5 ||
        deployment.scalerType !== "REQUEST_COUNT" ||
        deployment.scalerValue !== 1 ||
        deployment.initTimeoutSeconds !== 800 ||
        !HASH.test(String(deployment.deploymentSha256))
      )
        fail("V2_09_RUNPOD_BRIDGE_DEPLOYMENT_INVALID");
      return deployment as unknown as V213LaneDeployment;
    });
    if (new Set(deployments.map(({ lane }) => lane)).size !== deployments.length)
      fail("V2_09_RUNPOD_BRIDGE_DEPLOYMENT_INVALID");
    const jobs = (item.jobs as unknown[]).map((jobValue) => {
      const job = jobValue as Record<string, unknown>;
      if (
        !exactKeys(job, ["job_id", "lane", "status"]) ||
        (job.lane !== "mage" && job.lane !== "soulx") ||
        typeof job.job_id !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(job.job_id) ||
        !(
          job.status === null ||
          ["IN_QUEUE", "IN_PROGRESS", "COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(
            String(job.status),
          )
        )
      )
        fail("V2_09_RUNPOD_BRIDGE_JOB_INVALID");
      return job as { lane: Lane; job_id: string; status: string | null };
    });
    if (new Set(jobs.map(({ lane }) => lane)).size !== jobs.length)
      fail("V2_09_RUNPOD_BRIDGE_JOB_INVALID");
    return { ...(value as unknown as ReconcileRequest), lanes, deployments, jobs };
  }
  if (
    !exactKeys(value, [
      "api_key",
      "authority_id",
      "command",
      "lane",
      "lanes",
      "schema_version",
      "source_commit",
      "worker_environment",
    ]) ||
    value.schema_version !== SCHEMA ||
    value.command !== "CREATE_OR_READ_LANE" ||
    !AUTHORITY.test(String(value.authority_id)) ||
    !COMMIT.test(String(value.source_commit)) ||
    (value.lane !== "mage" && value.lane !== "soulx") ||
    typeof value.api_key !== "string" ||
    value.api_key.trim() !== value.api_key ||
    value.api_key.length < 20 ||
    !Array.isArray(value.lanes) ||
    value.lanes.length !== 2
  )
    fail("V2_09_RUNPOD_BRIDGE_REQUEST_INVALID");
  return { ...(value as unknown as Request), lanes };
}

function sealed(binding: LaneBinding, sourceCommit: string) {
  return Object.freeze({
    lane: binding.lane,
    publicImage: PUBLIC_IMAGES[binding.lane],
    sourceCommit,
    deploymentSha256: sha256(
      canonical({
        schema_version: "videoforge.v2-09-production-lane-configuration/v1",
        lane: binding,
        gpu: "NVIDIA GeForce RTX 4090",
        region: "EU-RO-1",
        workers_min: 0,
        workers_max: 1,
        handler_concurrency: 1,
        volume_mount: "/runpod-volume",
        volume_size_gb: 50,
      }),
    ),
    volumeIdSha256: binding.volume_id_sha256,
    volumeManifestSha256: binding.volume_manifest_sha256,
  });
}

export async function runV209RunPodProductionBridge(
  untrusted: unknown,
  ports: Readonly<{
    createControl?: (apiKey: string) => RunPodControlClient;
    createTransport?: typeof createV213RunPodDualLaneTransport;
    createJobClient?: V213RunPodDualLaneOptions["createJobClient"];
  }> = {},
): Promise<
  Readonly<{
    schema_version: typeof RESULT_SCHEMA;
    deployment?: V213LaneDeployment;
    command?: "READ_INVENTORY" | "RECONCILE_TERMINAL_JOBS" | "DELETE_ATTRIBUTABLE_PAIR";
    inventory?: V213InventoryRead;
    terminal_jobs?: readonly Readonly<{
      lane: Lane;
      job_id_sha256: string;
      status: string;
      execution_time_ms: number | null;
    }>[];
  }>
> {
  const input = request(untrusted);
  const bindings = Object.fromEntries(
    input.lanes.map((item) => [item.lane, sealed(item, input.source_commit)]),
  );
  const control = (ports.createControl ?? ((apiKey) => new RunPodControlClient({ apiKey })))(
    input.api_key,
  );
  const createJobClient =
    ports.createJobClient ??
    ((endpointId: string) =>
      new RunPodServerlessJobClient({
        apiKey: input.api_key,
        endpointId,
        guard: new RunPodDrainGuard(),
      }));
  const transport: V213RunPodDualLaneTransport = (
    ports.createTransport ?? createV213RunPodDualLaneTransport
  )({
    durable: {} as never,
    input: {
      mage: bindings.mage,
      soulx: bindings.soulx,
      envelopeSigningKeyId: input.worker_environment.envelopeSigningKeyId,
      receiptSigner: { keyId: input.worker_environment.receiptKeyId },
    } as never,
    workerEnvironment: input.worker_environment,
    control,
    accountPreflight: async () => fail("V2_09_RUNPOD_BRIDGE_ADMISSION_FORBIDDEN"),
    readAdmissionFacts: async () => fail("V2_09_RUNPOD_BRIDGE_ADMISSION_FORBIDDEN"),
    createJobClient,
    materializeQualificationCase: async () => fail("V2_09_RUNPOD_BRIDGE_QUALIFICATION_FORBIDDEN"),
  });
  if (
    input.command === "READ_INVENTORY" ||
    input.command === "RECONCILE_TERMINAL_JOBS" ||
    input.command === "DELETE_ATTRIBUTABLE_PAIR"
  ) {
    const candidates = new Map<
      Lane,
      Readonly<{
        endpoint?: Readonly<{ id: string; name: string; raw: Readonly<Record<string, unknown>> }>;
        template?: Readonly<{ id: string; name: string; raw: Readonly<Record<string, unknown>> }>;
      }>
    >();
    if (input.command === "DELETE_ATTRIBUTABLE_PAIR") {
      const disposable = await control.inventoryDisposableResources();
      for (const lane of ["mage", "soulx"] as const) {
        const resourceKey = `${input.authority_id}-${lane}-production`;
        const endpoints = disposable.endpoints.filter(
          ({ name }) => name === resourceName(resourceKey, "endpoint"),
        );
        const templates = disposable.templates.filter(
          ({ name }) => name === resourceName(resourceKey, "template"),
        );
        if (endpoints.length > 1 || templates.length > 1)
          fail("V2_09_RUNPOD_BRIDGE_ATTRIBUTABLE_RESOURCE_AMBIGUOUS");
        const deployment = input.deployments.find((item) => item.lane === lane);
        assertAttributableResourceIdentity(
          input.lanes.find((item) => item.lane === lane)!,
          resourceKey,
          input.worker_environment,
          endpoints[0],
          templates[0],
          deployment,
        );
        candidates.set(lane, Object.freeze({ endpoint: endpoints[0], template: templates[0] }));
      }
    }
    const terminalJobs = [];
    for (const job of input.jobs) {
      const deployment = input.deployments.find(({ lane }) => lane === job.lane);
      const endpointId =
        input.command === "DELETE_ATTRIBUTABLE_PAIR"
          ? candidates.get(job.lane)?.endpoint?.id
          : deployment?.endpointId;
      if (endpointId === undefined) {
        if (!["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(job.status ?? ""))
          fail("V2_09_RUNPOD_BRIDGE_JOB_TERMINAL_PROOF_MISSING");
        terminalJobs.push({
          lane: job.lane,
          job_id_sha256: sha256(job.job_id),
          status: job.status!,
          execution_time_ms: null,
        });
        continue;
      }
      const client = createJobClient(endpointId);
      let observed = await client.status(job.job_id);
      if (!["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(observed.status)) {
        if (input.command === "READ_INVENTORY") fail("V2_09_RUNPOD_BRIDGE_JOB_NOT_TERMINAL");
        try {
          observed = await client.cancel(job.job_id);
        } catch {
          observed = await client.status(job.job_id);
          if (!["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT"].includes(observed.status))
            fail("V2_09_RUNPOD_BRIDGE_JOB_CANCEL_UNCONFIRMED");
        }
      }
      terminalJobs.push({
        lane: job.lane,
        job_id_sha256: sha256(job.job_id),
        status: observed.status,
        execution_time_ms: observed.executionTimeMs,
      });
    }
    if (input.command === "DELETE_ATTRIBUTABLE_PAIR") {
      const accountInventory = await control.inventory(new Date());
      if (
        accountInventory.runningPodCount !== 0 ||
        accountInventory.activeServerlessWorkerCount !== 0
      )
        fail("V2_09_RUNPOD_BRIDGE_DELETE_WITH_ACTIVE_COMPUTE");
      for (const lane of ["mage", "soulx"] as const) {
        const endpoint = candidates.get(lane)?.endpoint;
        if (endpoint) {
          await createJobClient(endpoint.id).confirmStartupQueueEmpty();
        }
      }
      for (const lane of ["soulx", "mage"] as const) {
        const candidate = candidates.get(lane)!;
        if (candidate.endpoint) {
          const guard = new RunPodDrainGuard();
          guard.confirmZero(0, 0);
          await control.deleteEndpoint(candidate.endpoint.id, guard);
        }
        if (candidate.template) await control.deleteTemplate(candidate.template.id);
      }
      const remaining = await control.inventoryDisposableResources();
      const attributableNames = new Set(
        ["mage", "soulx"].flatMap((lane) => {
          const key = `${input.authority_id}-${lane}-production`;
          return [resourceName(key, "endpoint"), resourceName(key, "template")];
        }),
      );
      if (
        remaining.endpoints.some(({ name }) => attributableNames.has(name)) ||
        remaining.templates.some(({ name }) => attributableNames.has(name))
      )
        fail("V2_09_RUNPOD_BRIDGE_DELETE_ABSENCE_UNPROVEN");
    }
    const inventory = await transport.inventory();
    return Object.freeze({
      schema_version: RESULT_SCHEMA,
      command: input.command,
      inventory,
      terminal_jobs: Object.freeze(terminalJobs),
    });
  }
  const createInput = input as Request;
  const binding = bindings[createInput.lane];
  const resourceKey = `${createInput.authority_id}-${createInput.lane}-production`;
  const created = await transport.createLane({
    sealed: binding as never,
    purpose: "production",
    resourceKey,
    workersMin: 0,
    workersMax: 1,
    idleTimeoutSeconds: 5,
  });
  const deployment =
    created.kind === "ACK"
      ? created.deployment
      : await transport.findLaneByResourceKey(resourceKey, binding as never);
  if (!deployment) fail("V2_09_RUNPOD_BRIDGE_CREATE_ACK_UNKNOWN");
  const readback = await transport.readLane(deployment, {
    ...binding,
    endpointIdSha256: deployment.endpointIdSha256,
    templateIdSha256: deployment.templateIdSha256,
  } as never);
  return Object.freeze({ schema_version: RESULT_SCHEMA, deployment: readback });
}

async function main(): Promise<void> {
  const bytes = readFileSync(0, "utf8");
  const output = await runV209RunPodProductionBridge(JSON.parse(bytes));
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : "V2_09_RUNPOD_BRIDGE_FAILED"}\n`,
    );
    process.exitCode = 1;
  });
}
