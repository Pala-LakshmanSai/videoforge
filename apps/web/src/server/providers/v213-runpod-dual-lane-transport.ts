import { createHash } from "node:crypto";

import type { JsonValue } from "@videoforge/contracts";

import type {
  RunPodControlClient,
  RunPodDrainGuard,
  RunPodInventory,
  RunPodJobResult,
  RunPodNamedResource,
  RunPodResourceIdentity,
  RunPodServerlessJobClient,
} from "./runpod-control.js";
import { RunPodDrainGuard as ConcreteDrainGuard } from "./runpod-control.js";
import type {
  V213AdmissionRead,
  V213DispatchAck,
  V213DualLaneInput,
  V213DualLaneTransport,
  V213InventoryRead,
  V213JobRead,
  V213LaneDeployment,
  V213QualificationCaseMaterialization,
  V213QualificationCaseDescriptor,
  V213SealedLane,
} from "./v213-dual-lane-live.js";
import type { V213WorkerReceiptDelivery } from "./v213-provenance-receipt.js";

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,190}$/u;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const HEX_KEY = /^(?:[0-9a-f]{2}){32,}$/u;

export interface V213RunPodControlPort {
  createServerlessTemplate(
    name: string,
    image: string,
    diskGb: number,
    environment: Readonly<Record<string, string>>,
    strict: boolean,
  ): Promise<RunPodResourceIdentity>;
  createScaleZeroEndpoint(
    name: string,
    templateId: string,
    gpus: readonly string[],
    policy: {
      readonly workersMin: 0;
      readonly workersMax: 1;
      readonly gpuCount: 1;
      readonly idleTimeout: number;
      readonly executionTimeoutMs: number;
    },
    placement: { readonly networkVolumeId: string; readonly dataCenterIds: readonly ["EU-RO-1"] },
    strict: boolean,
  ): Promise<RunPodResourceIdentity>;
  bindV207EndpointIdentity(
    endpointId: string,
    templateId: string,
    policy: {
      readonly workersMin: 0;
      readonly workersMax: 1;
      readonly gpuCount: 1;
      readonly idleTimeout: number;
      readonly executionTimeoutMs: number;
    },
    placement: { readonly networkVolumeId: string; readonly dataCenterIds: readonly ["EU-RO-1"] },
    environment: Readonly<Record<string, string>>,
    guard: RunPodDrainGuard,
  ): Promise<void>;
  inventory(now?: Date): Promise<RunPodInventory>;
  resolveExactNetworkVolumeId(input: {
    readonly volumeIdSha256: string;
    readonly sizeGb: 50;
    readonly region: "EU-RO-1";
  }): Promise<string>;
  inventoryDisposableResources(): Promise<{
    readonly endpoints: readonly RunPodNamedResource[];
    readonly templates: readonly RunPodNamedResource[];
  }>;
  deleteEndpoint(endpointId: string, guard: RunPodDrainGuard): Promise<void>;
  deleteTemplate(templateId: string): Promise<void>;
}

type JobPort = Pick<
  RunPodServerlessJobClient,
  "dispatch" | "status" | "cancel" | "confirmStartupQueueEmpty"
>;

export interface V213RunPodDualLaneOptions {
  readonly durable: V213DualLaneTransport["durable"];
  readonly input: V213DualLaneInput;
  /** Protected worker-only values. `null` is valid only for the non-creating cleanup transport. */
  readonly workerEnvironment: V213WorkerEnvironmentSecrets | null;
  readonly control: V213RunPodControlPort;
  readonly accountPreflight: () => Promise<{ readonly accountIdHash: string }>;
  readonly readAdmissionFacts: () => Promise<{
    readonly checkedAt: string;
    readonly availability: "LOW" | "MEDIUM" | "HIGH";
    readonly flexRateUsdPerGpuHour: number;
    readonly cumulativeBillingUsd: number;
  }>;
  readonly createJobClient: (endpointId: string) => JobPort;
  /** Independent artifact readback proof. COMPLETED alone is never sufficient. */
  readonly verifyOutputReadback: (
    result: RunPodJobResult,
    delivery: V213WorkerReceiptDelivery,
  ) => Promise<true>;
  /** Post-consumption DB/R2-owned request materializer. It cannot dispatch a provider job. */
  readonly materializeQualificationCase: (input: {
    readonly descriptor: V213QualificationCaseDescriptor;
    readonly deployment: V213LaneDeployment;
    readonly stageAuthorityId: string;
    readonly inputSha256: string;
  }) => Promise<V213QualificationCaseMaterialization>;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly now?: () => Date;
}

export interface V213WorkerEnvironmentSecrets {
  readonly envelopeSigningKeyId: string;
  readonly envelopeSigningKeyHex: string;
  readonly receiptKeyId: string;
  readonly receiptSigningKeyHex: string;
  readonly mageWorkerTokenHex: string;
}

export interface V213CleanupOperationRead {
  readonly kind: "create" | "readback" | "dispatch" | "status" | "cancel" | "delete";
  readonly resourceKey: string;
  readonly state: "IN_FLIGHT" | "ACK_UNKNOWN" | "ACKED" | "TERMINAL";
  readonly providerId: string | null;
  readonly evidence: unknown;
}

export interface V213CleanupStageRead {
  readonly stage: "mage" | "soulx" | "production";
  readonly stageAuthorityId: string;
  readonly operations: readonly V213CleanupOperationRead[];
}

/**
 * Cleanup leaves the exact production pair in place only when both lanes were fully read back.
 * A partial or missing pair is deleted and must be represented explicitly; an empty `production`
 * array alone cannot distinguish a proven absence from a failed/incomplete cleanup.
 */
export type V213ProductionCleanupState =
  | "EXACT_MAX_ONE_PAIR_RETAINED"
  | "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT";

export interface V213AttributableCleanupResult {
  readonly production: readonly V213LaneDeployment[];
  /** Present on concrete transport results; optional for compatibility with read-only test ports. */
  readonly productionCleanupState?: V213ProductionCleanupState;
  /** True only after deterministic-name readback proves no attributable production resources remain. */
  readonly productionResourcesAbsent?: boolean;
  readonly deletedEndpointIdSha256s: readonly string[];
  readonly deletedTemplateIdSha256s: readonly string[];
  readonly reconciliationReadback?: Readonly<{
    readonly providerMutationPerformed: false;
    readonly runningPods: 0;
    readonly activeWorkers: 0;
    readonly queuedJobs: 0;
    readonly observedJobs: readonly Readonly<{
      readonly jobIdSha256: string;
      readonly endpointIdSha256: string;
      readonly status: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
    }>[];
    readonly endpointIdSha256s: readonly string[];
    readonly templateIdSha256s: readonly string[];
    readonly volumeIdSha256s: readonly string[];
  }>;
}

const hashId = (value: string) =>
  `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

function resourceName(resourceKey: string, suffix: "endpoint" | "template"): string {
  const digest = createHash("sha256").update(resourceKey).digest("hex").slice(0, 24);
  return `vf_v213_${digest}_${suffix}`;
}

/**
 * A template POST can fail after RunPod has accepted the mutation.  Only these provider errors
 * permit a same-name readback; a definitive input/auth/HTTP failure must remain a normal failure.
 * The structural `code` check keeps this transport usable with the small injected control port
 * used by tests and guarded activation without leaking provider error text into evidence.
 */
function isAmbiguousTemplateCreateError(error: unknown): boolean {
  const code =
    error !== null && typeof error === "object" && "code" in error
      ? (error as { readonly code?: unknown }).code
      : undefined;
  if (code === "RUNPOD_MUTATION_AMBIGUOUS" || code === "RUNPOD_RESPONSE_INVALID") return true;
  const message = error instanceof Error ? error.message : "";
  return /(?:ambiguous|tim(?:e|ed)[ -]?out|unknown response|network|connection|fetch|lost)/iu.test(
    message,
  );
}

/**
 * The resource-key marker is journal identity, not a provider-generated name.  Require it during
 * ambiguous template recovery so a pre-existing same-name template cannot be adopted merely
 * because its image happens to match.  Lane and purpose markers make the sealed input explicit in
 * the provider readback; endpoint binding later carries the same immutable environment forward.
 */
function templateIdentityMatches(
  candidate: RunPodNamedResource,
  expected: {
    readonly name: string;
    readonly image: string;
    readonly resourceKey: string;
    readonly lane: "mage" | "soulx";
    readonly purpose: "qualification" | "production";
    readonly environment: Readonly<Record<string, string>>;
  },
): boolean {
  if (candidate.name !== expected.name || !ID.test(candidate.id)) return false;
  const raw = candidate.raw as Record<string, unknown>;
  if (
    raw.imageName !== expected.image ||
    (raw.isServerless !== undefined && raw.isServerless !== true) ||
    (raw.containerDiskInGb !== undefined && raw.containerDiskInGb !== 120)
  )
    return false;
  const environment = raw.env;
  if (environment === null || typeof environment !== "object" || Array.isArray(environment))
    return false;
  return (
    (environment as Record<string, unknown>).VIDEOFORGE_V213_RESOURCE_KEY_SHA256 ===
      hashId(expected.resourceKey) && templateEnvironmentMatches(environment, expected.environment)
  );
}

function templateEnvironmentMatches(
  observed: unknown,
  expected: Readonly<Record<string, string>>,
): boolean {
  if (observed === null || typeof observed !== "object" || Array.isArray(observed)) return false;
  const value = observed as Record<string, unknown>;
  return (
    Object.keys(value).sort().join(",") === Object.keys(expected).sort().join(",") &&
    Object.entries(expected).every(([key, item]) => value[key] === item)
  );
}

function workerEnvironmentForLane(input: {
  readonly sealed: Pick<
    V213SealedLane,
    "lane" | "publicImage" | "volumeIdSha256" | "volumeManifestSha256"
  >;
  readonly purpose: "qualification" | "production";
  readonly resourceKeySha256: string;
  readonly secrets: V213WorkerEnvironmentSecrets | null;
  readonly endpointIdSha256?: string;
}): Readonly<Record<string, string>> {
  const secrets = input.secrets;
  const imageDigest = input.sealed.publicImage.split("@")[1];
  if (
    secrets === null ||
    !KEY_ID.test(secrets.envelopeSigningKeyId) ||
    !KEY_ID.test(secrets.receiptKeyId) ||
    !HEX_KEY.test(secrets.envelopeSigningKeyHex) ||
    !HEX_KEY.test(secrets.receiptSigningKeyHex) ||
    !HEX_KEY.test(secrets.mageWorkerTokenHex) ||
    new Set(
      [secrets.envelopeSigningKeyHex, secrets.receiptSigningKeyHex, secrets.mageWorkerTokenHex].map(
        (value) => createHash("sha256").update(Buffer.from(value, "hex")).digest("hex"),
      ),
    ).size !== 3 ||
    !SHA256.test(input.resourceKeySha256) ||
    !SHA256.test(input.sealed.volumeIdSha256) ||
    !SHA256.test(input.sealed.volumeManifestSha256) ||
    typeof imageDigest !== "string" ||
    !SHA256.test(imageDigest) ||
    (input.endpointIdSha256 !== undefined && !SHA256.test(input.endpointIdSha256))
  )
    throw new Error("V213_WORKER_ENVIRONMENT_INVALID");
  const common = {
    LOG_LEVEL: "INFO",
    RUNPOD_INIT_TIMEOUT: "800",
    VIDEOFORGE_V213_RESOURCE_KEY_SHA256: input.resourceKeySha256,
    VIDEOFORGE_V213_LANE: input.sealed.lane,
    VIDEOFORGE_V213_PURPOSE: input.purpose,
    VIDEOFORGE_ENVELOPE_KEY_ID: secrets.envelopeSigningKeyId,
    VIDEOFORGE_ENVELOPE_KEY_SHA256: `sha256:${createHash("sha256")
      .update(Buffer.from(secrets.envelopeSigningKeyHex, "hex"))
      .digest("hex")}`,
    VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX: secrets.envelopeSigningKeyHex,
    VIDEOFORGE_RECEIPT_KEY_ID: secrets.receiptKeyId,
    VIDEOFORGE_RECEIPT_SIGNING_KEY_HEX: secrets.receiptSigningKeyHex,
  } as const;
  if (input.sealed.lane === "mage")
    return Object.freeze({
      ...common,
      VIDEOFORGE_MAGE_GPU_OFFERING_ID: "NVIDIA GeForce RTX 4090",
      VIDEOFORGE_MAGE_MANIFEST_SHA256: input.sealed.volumeManifestSha256,
      VIDEOFORGE_MAGE_VOLUME_ID_HASH: input.sealed.volumeIdSha256,
      VIDEOFORGE_MAGE_WORKER_IMAGE_DIGEST: input.sealed.publicImage,
      VIDEOFORGE_MAGE_WORKER_TOKEN: secrets.mageWorkerTokenHex,
      ...(input.endpointIdSha256 === undefined
        ? {}
        : { VIDEOFORGE_MAGE_ENDPOINT_ID_HASH: input.endpointIdSha256 }),
    });
  return Object.freeze({
    ...common,
    VIDEOFORGE_SOULX_CONTAINER_DIGEST: imageDigest,
    VIDEOFORGE_SOULX_MODEL_MANIFEST_SHA256: input.sealed.volumeManifestSha256,
    VIDEOFORGE_SOULX_VOLUME_ID_SHA256: input.sealed.volumeIdSha256,
    ...(input.endpointIdSha256 === undefined
      ? {}
      : { VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256: input.endpointIdSha256 }),
  });
}

/**
 * Cleanup descriptors intentionally contain only volume hashes.  Provider endpoint readbacks
 * may contain the raw network-volume id, but that id must never leave this transport boundary.
 * A singular id and a plural id are accepted only when they describe the same one-volume
 * binding; malformed, missing, or multi-volume values fail closed.
 */
function providerNetworkVolumeId(raw: Record<string, unknown>): string | null {
  const singularValue = raw.networkVolumeId;
  const pluralValue = raw.networkVolumeIds;
  const singular =
    singularValue === undefined
      ? null
      : typeof singularValue === "string" && ID.test(singularValue)
        ? singularValue
        : undefined;
  const plural =
    pluralValue === undefined
      ? null
      : Array.isArray(pluralValue) &&
          pluralValue.length === 1 &&
          typeof pluralValue[0] === "string" &&
          ID.test(pluralValue[0])
        ? pluralValue[0]
        : undefined;
  if (singular === undefined || plural === undefined) return null;
  if (singular !== null && plural !== null && singular !== plural) return null;
  return singular ?? plural;
}

function providerVolumeMatches(
  raw: Record<string, unknown>,
  sealedVolumeIdSha256: string,
): boolean {
  const providerId = providerNetworkVolumeId(raw);
  return providerId !== null && hashId(providerId) === sealedVolumeIdSha256;
}

type V213CleanupLaneBinding = Readonly<{
  readonly lane: "mage" | "soulx";
  readonly publicImage: string;
  readonly sourceCommit: string;
  readonly deploymentSha256: string;
  readonly volumeIdSha256: string;
  readonly volumeManifestSha256: string;
  readonly endpointIdSha256?: string;
  readonly templateIdSha256?: string;
}>;

type V213JournaledResourceIdentity = Readonly<{
  readonly endpointIdSha256?: string;
  readonly templateIdSha256?: string;
}>;

/**
 * Parse exact image/config lineage from DB-owned operation evidence or an in-process deployment.
 * The cleanup input itself remains hash-only; these fields are never added to the protected
 * cleanup descriptor. Endpoint/template hashes are required for persisted operation evidence so
 * a same-name provider resource cannot be mistaken for the resource journaled by this authority.
 */
function parseCleanupLaneBinding(
  value: unknown,
  lane: "mage" | "soulx",
  requireResourceHashes = false,
  requireProductionPurpose = false,
): V213CleanupLaneBinding | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  const publicImage = item.publicImage ?? item.image;
  const endpointIdSha256 = item.endpointIdSha256;
  const templateIdSha256 = item.templateIdSha256;
  if (
    item.lane !== lane ||
    (requireProductionPurpose && item.purpose !== "production") ||
    typeof publicImage !== "string" ||
    !/^ghcr\.io\/.+@sha256:[0-9a-f]{64}$/u.test(publicImage) ||
    typeof item.sourceCommit !== "string" ||
    !/^[0-9a-f]{40}$/u.test(item.sourceCommit) ||
    typeof item.deploymentSha256 !== "string" ||
    !SHA256.test(item.deploymentSha256) ||
    typeof item.volumeIdSha256 !== "string" ||
    !SHA256.test(item.volumeIdSha256) ||
    typeof item.volumeManifestSha256 !== "string" ||
    !SHA256.test(item.volumeManifestSha256) ||
    (endpointIdSha256 !== undefined &&
      (typeof endpointIdSha256 !== "string" || !SHA256.test(endpointIdSha256))) ||
    (templateIdSha256 !== undefined &&
      (typeof templateIdSha256 !== "string" || !SHA256.test(templateIdSha256))) ||
    (requireResourceHashes &&
      (typeof endpointIdSha256 !== "string" ||
        !SHA256.test(endpointIdSha256) ||
        typeof templateIdSha256 !== "string" ||
        !SHA256.test(templateIdSha256)))
  )
    return null;
  return Object.freeze({
    lane,
    publicImage,
    sourceCommit: item.sourceCommit,
    deploymentSha256: item.deploymentSha256,
    volumeIdSha256: item.volumeIdSha256,
    volumeManifestSha256: item.volumeManifestSha256,
    ...(typeof endpointIdSha256 === "string" ? { endpointIdSha256 } : {}),
    ...(typeof templateIdSha256 === "string" ? { templateIdSha256 } : {}),
  });
}

const sameCleanupBinding = (left: V213CleanupLaneBinding, right: V213CleanupLaneBinding): boolean =>
  left.lane === right.lane &&
  left.publicImage === right.publicImage &&
  left.sourceCommit === right.sourceCommit &&
  left.deploymentSha256 === right.deploymentSha256 &&
  left.volumeIdSha256 === right.volumeIdSha256 &&
  left.volumeManifestSha256 === right.volumeManifestSha256 &&
  (left.endpointIdSha256 === undefined ||
    right.endpointIdSha256 === undefined ||
    left.endpointIdSha256 === right.endpointIdSha256) &&
  (left.templateIdSha256 === undefined ||
    right.templateIdSha256 === undefined ||
    left.templateIdSha256 === right.templateIdSha256);

/** Concrete production RunPod transport for the staged V2-13 qualification API. Mutation methods
 * are called exactly once. Ambiguous creates/dispatches only use deterministic readback and never
 * resend. A process restart relies on the durable operation evidence written by the coordinator. */
export class V213RunPodDualLaneTransport implements V213DualLaneTransport {
  readonly durable: V213DualLaneTransport["durable"];
  private readonly deployments = new Map<string, V213LaneDeployment>();
  private readonly jobs = new Map<
    string,
    { readonly endpointId: string; readonly client: JobPort }
  >();
  private billing = 0;

  constructor(private readonly options: V213RunPodDualLaneOptions) {
    this.durable = options.durable;
  }

  now = (): Date => (this.options.now ?? (() => new Date()))();
  sleep = (milliseconds: number): Promise<void> =>
    (this.options.sleep ?? ((delay) => new Promise((resolve) => setTimeout(resolve, delay))))(
      milliseconds,
    );

  materializeQualificationCase = (
    input: Parameters<V213DualLaneTransport["materializeQualificationCase"]>[0],
  ): Promise<V213QualificationCaseMaterialization> =>
    this.options.materializeQualificationCase(input);

  async freshAdmission(): Promise<V213AdmissionRead> {
    const [account, facts, inventory] = await Promise.all([
      this.options.accountPreflight(),
      this.options.readAdmissionFacts(),
      this.options.control.inventory(this.now()),
    ]);
    this.billing = facts.cumulativeBillingUsd;
    return Object.freeze({
      checkedAt: facts.checkedAt,
      accountIdSha256: account.accountIdHash,
      gpu: "NVIDIA GeForce RTX 4090",
      region: "EU-RO-1",
      availability: facts.availability,
      flexRateUsdPerGpuHour: facts.flexRateUsdPerGpuHour,
      cumulativeBillingUsd: facts.cumulativeBillingUsd,
      runningPods: inventory.runningPodCount,
      activeWorkers: inventory.activeServerlessWorkerCount,
      endpoints: inventory.endpoints.length,
      privateTemplates: inventory.privateTemplateCount,
      volumes: Object.freeze(
        inventory.networkVolumes.map((volume) => {
          const sealed = [this.options.input.mage, this.options.input.soulx].find(
            (lane) => lane.volumeIdSha256 === volume.idHash,
          );
          return Object.freeze({
            idSha256: volume.idHash,
            sizeGb: volume.sizeGb ?? -1,
            region: volume.dataCenterId as "EU-RO-1",
            manifestSha256: sealed?.volumeManifestSha256 ?? "sha256:unknown",
          });
        }),
      ),
    });
  }

  async createLane(input: {
    readonly sealed: V213SealedLane;
    readonly purpose: "qualification" | "production";
    readonly resourceKey: string;
    readonly workersMin: 0;
    readonly workersMax: 1;
  }) {
    const templateName = resourceName(input.resourceKey, "template");
    const endpointName = resourceName(input.resourceKey, "endpoint");
    if (
      this.options.workerEnvironment?.envelopeSigningKeyId !==
        this.options.input.envelopeSigningKeyId ||
      this.options.workerEnvironment?.receiptKeyId !== this.options.input.receiptSigner.keyId
    )
      throw new Error("V213_WORKER_ENVIRONMENT_AUTHORITY_MISMATCH");
    const environment = workerEnvironmentForLane({
      sealed: input.sealed,
      purpose: input.purpose,
      resourceKeySha256: hashId(input.resourceKey),
      secrets: this.options.workerEnvironment,
    });
    // Resolve and hash-bind the retained volume before the first provider mutation. A missing,
    // ambiguous, wrong-size, or wrong-region inventory entry must leave template creation at zero.
    const networkVolumeId = await this.options.control.resolveExactNetworkVolumeId({
      volumeIdSha256: input.sealed.volumeIdSha256,
      sizeGb: 50,
      region: "EU-RO-1",
    });
    const placement = {
      networkVolumeId,
      dataCenterIds: ["EU-RO-1"] as const,
    };
    let template: RunPodResourceIdentity;
    try {
      template = await this.options.control.createServerlessTemplate(
        templateName,
        input.sealed.publicImage,
        120,
        environment,
        false,
      );
    } catch (error) {
      if (!isAmbiguousTemplateCreateError(error)) throw error;
      // A timeout or malformed response may mean that the provider accepted the POST.  Reconcile
      // by the exact deterministic name before any endpoint POST.  This path never deletes: an
      // unknown or conflicting template is left for the durable cleanup authority to inspect.
      const resources = await this.findNamedResources(input.resourceKey);
      if (resources.endpoints.length !== 0)
        throw new Error("V213_TEMPLATE_CREATE_RECONCILIATION_UNEXPECTED_ENDPOINT");
      const candidate = resources.templates[0];
      if (!candidate) throw new Error("V213_TEMPLATE_CREATE_RECONCILIATION_UNCERTAIN");
      if (
        !templateIdentityMatches(candidate, {
          name: templateName,
          image: input.sealed.publicImage,
          resourceKey: input.resourceKey,
          lane: input.sealed.lane,
          purpose: input.purpose,
          environment,
        })
      )
        throw new Error("V213_TEMPLATE_CREATE_RECONCILIATION_IDENTITY_MISMATCH");
      template = Object.freeze({ id: candidate.id, idHash: hashId(candidate.id) });
    }
    let endpoint: RunPodResourceIdentity;
    try {
      const policy = {
        workersMin: 0 as const,
        workersMax: 1 as const,
        gpuCount: 1 as const,
        idleTimeout: 5,
        executionTimeoutMs: 2_400_000,
      };
      endpoint = await this.options.control.createScaleZeroEndpoint(
        endpointName,
        template.id,
        ["NVIDIA GeForce RTX 4090"],
        policy,
        placement,
        true,
      );
      const guard = new ConcreteDrainGuard();
      guard.confirmZero(0, 0);
      await this.options.control.bindV207EndpointIdentity(
        endpoint.id,
        template.id,
        policy,
        placement,
        environment,
        guard,
      );
    } catch {
      // The template mutation may have succeeded while endpoint creation is ambiguous. The caller
      // reconciles by deterministic names and never invokes createLane again for this operation.
      return {
        kind: "ACK_UNKNOWN" as const,
        partial: Object.freeze({
          templateId: template.id,
          templateIdSha256: hashId(template.id),
          resourceKey: input.resourceKey,
        }),
      };
    }
    const deployment: V213LaneDeployment = Object.freeze({
      lane: input.sealed.lane,
      purpose: input.purpose,
      endpointId: endpoint.id,
      endpointIdSha256: hashId(endpoint.id),
      templateId: template.id,
      templateIdSha256: hashId(template.id),
      image: input.sealed.publicImage,
      sourceCommit: input.sealed.sourceCommit,
      deploymentSha256: input.sealed.deploymentSha256,
      volumeIdSha256: input.sealed.volumeIdSha256,
      volumeManifestSha256: input.sealed.volumeManifestSha256,
      volumeSizeGb: 50,
      volumeMount: "/runpod-volume",
      region: "EU-RO-1",
      gpu: "NVIDIA GeForce RTX 4090",
      gpuCount: 1,
      workersMin: 0,
      workersMax: 1,
      handlerConcurrency: 1,
      scalerType: "REQUEST_COUNT",
      scalerValue: 1,
      initTimeoutSeconds: 800,
    });
    this.deployments.set(input.resourceKey, deployment);
    return { kind: "ACK" as const, deployment };
  }

  private async findNamedResources(resourceKey: string): Promise<{
    readonly endpoints: readonly RunPodNamedResource[];
    readonly templates: readonly RunPodNamedResource[];
  }> {
    const inventory = await this.options.control.inventoryDisposableResources();
    const endpointName = resourceName(resourceKey, "endpoint");
    const templateName = resourceName(resourceKey, "template");
    const endpoints = inventory.endpoints.filter((item) => item.name === endpointName);
    const templates = inventory.templates.filter((item) => item.name === templateName);
    if (endpoints.length > 1 || templates.length > 1)
      throw new Error("V213_DETERMINISTIC_RESOURCE_AMBIGUOUS");
    return Object.freeze({ endpoints, templates });
  }

  private bindingFromSealed(
    sealed: unknown,
    lane: "mage" | "soulx",
  ): V213CleanupLaneBinding | null {
    return parseCleanupLaneBinding(sealed, lane);
  }

  private bindingForResourceKey(
    resourceKey: string,
    operations: readonly V213CleanupOperationRead[] = [],
  ): V213CleanupLaneBinding | null {
    const identity = resourceKey.match(/-(mage|soulx)-(qualification|production)$/u);
    if (!identity) throw new Error("V213_RESOURCE_KEY_LINEAGE_INVALID");
    const lane = identity[1] as "mage" | "soulx";
    const sealedValue = (
      lane === "mage" ? this.options.input.mage : this.options.input.soulx
    ) as unknown;
    const sealedObject =
      sealedValue !== null && typeof sealedValue === "object" && !Array.isArray(sealedValue)
        ? (sealedValue as Record<string, unknown>)
        : null;
    if (
      typeof sealedObject?.volumeIdSha256 !== "string" ||
      !SHA256.test(sealedObject.volumeIdSha256) ||
      typeof sealedObject.volumeManifestSha256 !== "string" ||
      !SHA256.test(sealedObject.volumeManifestSha256)
    )
      throw new Error("V213_CLEANUP_VOLUME_BINDING_INVALID");
    let binding = this.bindingFromSealed(sealedValue, lane);
    const evidenceBindings = operations
      .filter(
        (operation) =>
          operation.resourceKey === resourceKey &&
          (operation.kind === "create" || operation.kind === "readback"),
      )
      .map((operation) => parseCleanupLaneBinding(operation.evidence, lane, true, true))
      .filter((value): value is V213CleanupLaneBinding => value !== null);
    for (const candidate of evidenceBindings) {
      if (
        candidate.volumeIdSha256 !== sealedObject.volumeIdSha256 ||
        candidate.volumeManifestSha256 !== sealedObject.volumeManifestSha256
      )
        throw new Error("V213_CLEANUP_PRODUCTION_BINDING_DRIFT");
      if (binding && !sameCleanupBinding(binding, candidate))
        throw new Error("V213_CLEANUP_PRODUCTION_BINDING_DRIFT");
      if (binding) {
        binding = Object.freeze({
          ...binding,
          endpointIdSha256: candidate.endpointIdSha256,
          templateIdSha256: candidate.templateIdSha256,
        });
      } else {
        binding = candidate;
      }
    }
    if (!binding) {
      const cached = this.deployments.get(resourceKey);
      if (cached) {
        binding = parseCleanupLaneBinding(cached, lane, true, true);
        if (
          binding &&
          (binding.volumeIdSha256 !== sealedObject.volumeIdSha256 ||
            binding.volumeManifestSha256 !== sealedObject.volumeManifestSha256)
        )
          throw new Error("V213_CLEANUP_PRODUCTION_BINDING_DRIFT");
      }
    }
    return binding;
  }

  private journaledResourceIdentity(
    resourceKey: string,
    operations: readonly V213CleanupOperationRead[],
  ): V213JournaledResourceIdentity | null {
    let endpointIdSha256: string | undefined;
    let templateIdSha256: string | undefined;
    for (const operation of operations.filter(
      (item) =>
        item.resourceKey === resourceKey && (item.kind === "create" || item.kind === "readback"),
    )) {
      if (
        operation.evidence === null ||
        typeof operation.evidence !== "object" ||
        Array.isArray(operation.evidence)
      )
        continue;
      const evidence = operation.evidence as Record<string, unknown>;
      const candidateEndpointHash = evidence.endpointIdSha256;
      const candidateTemplateHash = evidence.templateIdSha256;
      if (
        (candidateEndpointHash !== undefined &&
          (typeof candidateEndpointHash !== "string" || !SHA256.test(candidateEndpointHash))) ||
        (candidateTemplateHash !== undefined &&
          (typeof candidateTemplateHash !== "string" || !SHA256.test(candidateTemplateHash)))
      )
        throw new Error("V213_CLEANUP_RESOURCE_IDENTITY_INVALID");
      const rawEndpointId = evidence.endpointId;
      const rawTemplateId = evidence.templateId;
      if (
        (rawEndpointId !== undefined &&
          (typeof rawEndpointId !== "string" ||
            !ID.test(rawEndpointId) ||
            hashId(rawEndpointId) !== candidateEndpointHash)) ||
        (rawTemplateId !== undefined &&
          (typeof rawTemplateId !== "string" ||
            !ID.test(rawTemplateId) ||
            hashId(rawTemplateId) !== candidateTemplateHash))
      )
        throw new Error("V213_CLEANUP_RESOURCE_IDENTITY_DRIFT");
      if (
        operation.providerId !== null &&
        ((rawEndpointId !== undefined && rawEndpointId === operation.providerId) ||
          (rawTemplateId !== undefined && rawTemplateId === operation.providerId)) === false &&
        ((typeof candidateEndpointHash === "string" &&
          hashId(operation.providerId) === candidateEndpointHash) ||
          (typeof candidateTemplateHash === "string" &&
            hashId(operation.providerId) === candidateTemplateHash)) === false
      )
        throw new Error("V213_CLEANUP_RESOURCE_IDENTITY_DRIFT");
      if (
        (endpointIdSha256 !== undefined &&
          candidateEndpointHash !== undefined &&
          endpointIdSha256 !== candidateEndpointHash) ||
        (templateIdSha256 !== undefined &&
          candidateTemplateHash !== undefined &&
          templateIdSha256 !== candidateTemplateHash)
      )
        throw new Error("V213_CLEANUP_RESOURCE_IDENTITY_AMBIGUOUS");
      if (typeof candidateEndpointHash === "string") endpointIdSha256 = candidateEndpointHash;
      if (typeof candidateTemplateHash === "string") templateIdSha256 = candidateTemplateHash;
    }
    if (endpointIdSha256 === undefined && templateIdSha256 === undefined) return null;
    return Object.freeze({
      ...(endpointIdSha256 === undefined ? {} : { endpointIdSha256 }),
      ...(templateIdSha256 === undefined ? {} : { templateIdSha256 }),
    });
  }

  private assertPartialCleanupIdentity(
    resourceKey: string,
    operations: readonly V213CleanupOperationRead[],
    endpoint: RunPodNamedResource | undefined,
    template: RunPodNamedResource | undefined,
  ): void {
    if ((endpoint === undefined) === (template === undefined)) return;
    const identity = resourceKey.match(/-(mage|soulx)-(qualification|production)$/u);
    if (!identity) throw new Error("V213_RESOURCE_KEY_LINEAGE_INVALID");
    const lane = identity[1] as "mage" | "soulx";
    const journaled = this.journaledResourceIdentity(resourceKey, operations);
    const binding = this.bindingForResourceKey(resourceKey, operations);
    if (!journaled || !binding) throw new Error("V213_CLEANUP_PARTIAL_IDENTITY_UNAVAILABLE");
    if (endpoint) {
      const raw = endpoint.raw as Record<string, unknown>;
      if (
        journaled.endpointIdSha256 === undefined ||
        hashId(endpoint.id) !== journaled.endpointIdSha256 ||
        raw.workersMin !== 0 ||
        raw.workersMax !== 1 ||
        raw.gpuCount !== 1 ||
        JSON.stringify(raw.gpuTypeIds) !== JSON.stringify(["NVIDIA GeForce RTX 4090"]) ||
        !providerVolumeMatches(raw, binding.volumeIdSha256) ||
        (journaled.templateIdSha256 !== undefined &&
          (typeof raw.templateId !== "string" ||
            !ID.test(raw.templateId) ||
            hashId(raw.templateId) !== journaled.templateIdSha256))
      )
        throw new Error("V213_CLEANUP_PARTIAL_IDENTITY_DRIFT");
    }
    if (template) {
      const raw = template.raw as Record<string, unknown>;
      if (
        journaled.templateIdSha256 === undefined ||
        hashId(template.id) !== journaled.templateIdSha256 ||
        raw.imageName !== binding.publicImage ||
        binding.lane !== lane
      )
        throw new Error("V213_CLEANUP_PARTIAL_IDENTITY_DRIFT");
    }
  }

  async findLaneByResourceKey(
    resourceKey: string,
    expectedBinding?: V213CleanupLaneBinding,
  ): Promise<V213LaneDeployment | null> {
    const cached = this.deployments.get(resourceKey);
    if (cached && expectedBinding === undefined) return cached;
    const { endpoints, templates } = await this.findNamedResources(resourceKey);
    if (endpoints.length === 0 && templates.length === 0) return null;
    if (endpoints.length !== 1 || templates.length !== 1)
      throw new Error("V213_DETERMINISTIC_RESOURCE_PARTIAL");
    const identity = resourceKey.match(/-(mage|soulx)-(qualification|production)$/u);
    if (!identity) throw new Error("V213_RESOURCE_KEY_LINEAGE_INVALID");
    const lane = identity[1] as "mage" | "soulx";
    const purpose = identity[2] as "qualification" | "production";
    const sealed =
      expectedBinding ??
      this.bindingFromSealed(
        lane === "mage" ? this.options.input.mage : this.options.input.soulx,
        lane,
      );
    if (!sealed) throw new Error("V213_CLEANUP_LANE_BINDING_UNAVAILABLE");
    const endpoint = endpoints[0]!;
    const template = templates[0]!;
    const endpointRaw = endpoint.raw as Record<string, unknown>;
    const templateRaw = template.raw as Record<string, unknown>;
    const expectedTemplateEnvironment =
      this.options.workerEnvironment === null
        ? null
        : workerEnvironmentForLane({
            sealed,
            purpose,
            resourceKeySha256: hashId(resourceKey),
            secrets: this.options.workerEnvironment,
            endpointIdSha256: hashId(endpoint.id),
          });
    if (
      endpointRaw.templateId !== template.id ||
      endpointRaw.workersMin !== 0 ||
      endpointRaw.workersMax !== 1 ||
      endpointRaw.gpuCount !== 1 ||
      JSON.stringify(endpointRaw.gpuTypeIds) !== JSON.stringify(["NVIDIA GeForce RTX 4090"]) ||
      !providerVolumeMatches(endpointRaw, sealed.volumeIdSha256) ||
      (sealed.endpointIdSha256 !== undefined && hashId(endpoint.id) !== sealed.endpointIdSha256) ||
      (sealed.templateIdSha256 !== undefined && hashId(template.id) !== sealed.templateIdSha256) ||
      templateRaw.imageName !== sealed.publicImage ||
      (expectedTemplateEnvironment !== null &&
        !templateEnvironmentMatches(templateRaw.env, expectedTemplateEnvironment))
    )
      throw new Error("V213_DETERMINISTIC_RESOURCE_READBACK_INVALID");
    const deployment: V213LaneDeployment = Object.freeze({
      lane,
      purpose,
      endpointId: endpoint.id,
      endpointIdSha256: hashId(endpoint.id),
      templateId: template.id,
      templateIdSha256: hashId(template.id),
      image: sealed.publicImage,
      sourceCommit: sealed.sourceCommit,
      deploymentSha256: sealed.deploymentSha256,
      volumeIdSha256: sealed.volumeIdSha256,
      volumeManifestSha256: sealed.volumeManifestSha256,
      volumeSizeGb: 50,
      volumeMount: "/runpod-volume",
      region: "EU-RO-1",
      gpu: "NVIDIA GeForce RTX 4090",
      gpuCount: 1,
      workersMin: 0,
      workersMax: 1,
      handlerConcurrency: 1,
      scalerType: "REQUEST_COUNT",
      scalerValue: 1,
      initTimeoutSeconds: 800,
    });
    this.deployments.set(resourceKey, deployment);
    return deployment;
  }

  async readLane(
    deployment: V213LaneDeployment,
    expectedBinding?: V213CleanupLaneBinding,
  ): Promise<V213LaneDeployment> {
    const inventory = await this.options.control.inventoryDisposableResources();
    const endpoint = inventory.endpoints.filter((item) => item.id === deployment.endpointId);
    const template = inventory.templates.filter((item) => item.id === deployment.templateId);
    const endpointItem = endpoint[0];
    const templateItem = template[0];
    const endpointRaw = endpointItem?.raw as Record<string, unknown> | undefined;
    const templateRaw = templateItem?.raw as Record<string, unknown> | undefined;
    const binding =
      expectedBinding ??
      parseCleanupLaneBinding(
        {
          lane: deployment.lane,
          publicImage: deployment.image,
          sourceCommit: deployment.sourceCommit,
          deploymentSha256: deployment.deploymentSha256,
          volumeIdSha256: deployment.volumeIdSha256,
          volumeManifestSha256: deployment.volumeManifestSha256,
          endpointIdSha256: deployment.endpointIdSha256,
          templateIdSha256: deployment.templateIdSha256,
        },
        deployment.lane,
        true,
      );
    const observedResourceKeySha256 =
      templateRaw?.env !== null &&
      typeof templateRaw?.env === "object" &&
      !Array.isArray(templateRaw.env) &&
      typeof (templateRaw.env as Record<string, unknown>).VIDEOFORGE_V213_RESOURCE_KEY_SHA256 ===
        "string"
        ? ((templateRaw.env as Record<string, unknown>)
            .VIDEOFORGE_V213_RESOURCE_KEY_SHA256 as string)
        : null;
    const resourceNameDigest = templateItem?.name.match(/^vf_v213_([0-9a-f]{24})_template$/u)?.[1];
    const expectedTemplateEnvironment =
      binding &&
      observedResourceKeySha256 !== null &&
      SHA256.test(observedResourceKeySha256) &&
      resourceNameDigest === observedResourceKeySha256.slice(7, 31) &&
      this.options.workerEnvironment !== null
        ? workerEnvironmentForLane({
            sealed: binding,
            purpose: deployment.purpose,
            resourceKeySha256: observedResourceKeySha256,
            secrets: this.options.workerEnvironment,
            endpointIdSha256: deployment.endpointIdSha256,
          })
        : null;
    if (
      !binding ||
      endpoint.length !== 1 ||
      template.length !== 1 ||
      endpointRaw?.templateId !== deployment.templateId ||
      endpointRaw.workersMin !== 0 ||
      endpointRaw.workersMax !== 1 ||
      endpointRaw.gpuCount !== 1 ||
      JSON.stringify(endpointRaw.gpuTypeIds) !== JSON.stringify([deployment.gpu]) ||
      !providerVolumeMatches(endpointRaw, binding.volumeIdSha256) ||
      (binding.endpointIdSha256 !== undefined &&
        hashId(endpointItem!.id) !== binding.endpointIdSha256) ||
      (binding.templateIdSha256 !== undefined &&
        hashId(templateItem!.id) !== binding.templateIdSha256) ||
      templateRaw?.imageName !== binding.publicImage ||
      this.options.workerEnvironment === null ||
      expectedTemplateEnvironment === null ||
      !templateEnvironmentMatches(templateRaw.env, expectedTemplateEnvironment)
    )
      throw new Error("V213_DEPLOYMENT_READBACK_MISSING");
    return deployment;
  }

  async dispatch(input: {
    readonly deployment: V213LaneDeployment;
    readonly requestKey: string;
    readonly envelope: JsonValue;
  }): Promise<V213DispatchAck> {
    if (!ID.test(input.requestKey)) throw new Error("V213_REQUEST_KEY_INVALID");
    const client = this.options.createJobClient(input.deployment.endpointId);
    await client.confirmStartupQueueEmpty();
    try {
      const job = await client.dispatch(input.requestKey, input.envelope);
      this.jobs.set(job.id, { endpointId: input.deployment.endpointId, client });
      return { kind: "ACK", jobId: job.id };
    } catch {
      return { kind: "ACK_UNKNOWN" };
    }
  }

  async findJobByRequestKey(): Promise<null> {
    // RunPod has no provider-side request-key lookup. Returning null is the required fail-closed
    // outcome after an ambiguous POST; the durable coordinator forbids redispatch.
    return null;
  }

  private exactJob(endpointId: string, jobId: string) {
    const found = this.jobs.get(jobId);
    if (found && found.endpointId !== endpointId) throw new Error("V213_JOB_ENDPOINT_DRIFT");
    const client = found?.client ?? this.options.createJobClient(endpointId);
    if (!found) this.jobs.set(jobId, { endpointId, client });
    return client;
  }

  async status(endpointId: string, jobId: string): Promise<V213JobRead> {
    const result = await this.exactJob(endpointId, jobId).status(jobId);
    if (result.id !== jobId) throw new Error("V213_JOB_ID_READBACK_DRIFT");
    const output =
      result.output !== null && typeof result.output === "object" && !Array.isArray(result.output)
        ? (result.output as Record<string, unknown>)
        : null;
    const receipt = output?.provenance_receipt;
    const receiptBodyBase64 = output?.provenance_receipt_body_base64;
    const delivery =
      receipt !== null &&
      typeof receipt === "object" &&
      !Array.isArray(receipt) &&
      typeof receiptBodyBase64 === "string"
        ? ({ receipt, receiptBodyBase64 } as V213WorkerReceiptDelivery)
        : undefined;
    const outputReadbackVerified = delivery
      ? await this.options.verifyOutputReadback(result, delivery)
      : undefined;
    return Object.freeze({
      jobId: result.id,
      status: result.status as V213JobRead["status"],
      ...(delivery ? { receiptDelivery: delivery, outputReadbackVerified } : {}),
      ...(typeof result.error === "object" && result.error !== null
        ? {
            failureCode:
              typeof (result.error as Record<string, unknown>).code === "string"
                ? String((result.error as Record<string, unknown>).code)
                : undefined,
          }
        : {}),
    });
  }

  async cancel(endpointId: string, jobId: string): Promise<V213JobRead> {
    const result = await this.exactJob(endpointId, jobId).cancel(jobId);
    if (result.id !== jobId) throw new Error("V213_JOB_ID_READBACK_DRIFT");
    return Object.freeze({ jobId: result.id, status: result.status as V213JobRead["status"] });
  }

  async deleteLane(deployment: V213LaneDeployment): Promise<void> {
    const inventory = await this.options.control.inventory(this.now());
    if (inventory.runningPodCount !== 0 || inventory.activeServerlessWorkerCount !== 0)
      throw new Error("V213_DELETE_WITH_ACTIVE_WORKERS");
    // Worker counters alone do not prove that the endpoint queue is empty.  The queue proof must
    // happen before the first destructive endpoint/template mutation, including direct lane
    // deletion used by qualification cleanup.
    await this.options.createJobClient(deployment.endpointId).confirmStartupQueueEmpty();
    const guard = new ConcreteDrainGuard();
    guard.confirmZero(0, 0);
    await this.options.control.deleteEndpoint(deployment.endpointId, guard);
    await this.options.control.deleteTemplate(deployment.templateId);
    const remaining = await this.options.control.inventoryDisposableResources();
    if (
      remaining.endpoints.some((item) => item.id === deployment.endpointId) ||
      remaining.templates.some((item) => item.id === deployment.templateId)
    )
      throw new Error("V213_DELETE_ABSENCE_NOT_PROVEN");
    for (const [key, value] of this.deployments)
      if (value.endpointId === deployment.endpointId) this.deployments.delete(key);
  }

  /** Reconstructs every V2-13 resource from DB-owned stage IDs and deterministic provider names.
   * Qualification lanes and incomplete production pairs are removed. An exact two-lane production
   * pair is retained only after full max-one readback. Template-only lost creates are deleted too. */
  async cleanupAttributableResources(
    stages: readonly V213CleanupStageRead[],
  ): Promise<V213AttributableCleanupResult> {
    const stageByName = new Map(stages.map((stage) => [stage.stage, stage]));
    if (
      stageByName.size !== stages.length ||
      stages.some((stage) => !ID.test(stage.stageAuthorityId))
    )
      throw new Error("V213_CLEANUP_SCOPE_INVALID");

    const resourceKeys = stages.flatMap((stage) => {
      if (stage.stage === "mage") return [`v213-${stage.stageAuthorityId}-mage-qualification`];
      if (stage.stage === "soulx") return [`v213-${stage.stageAuthorityId}-soulx-qualification`];
      return [
        `v213-${stage.stageAuthorityId}-mage-production`,
        `v213-${stage.stageAuthorityId}-soulx-production`,
      ];
    });

    // Cancel only DB-journaled jobs belonging to the exact stage. Never infer or touch another job.
    for (const stage of stages) {
      const createEvidence = stage.operations
        .filter((operation) => operation.kind === "create")
        .map((operation) => operation.evidence)
        .find((value) => value && typeof value === "object") as
        | { readonly endpointId?: string }
        | undefined;
      const endpointId = createEvidence?.endpointId;
      if (!endpointId || !ID.test(endpointId)) continue;
      for (const operation of stage.operations.filter(
        (item) => item.kind === "dispatch" && item.providerId && ID.test(item.providerId),
      )) {
        const jobId = operation.providerId!;
        let observed = await this.status(endpointId, jobId);
        if (observed.status === "IN_QUEUE" || observed.status === "IN_PROGRESS") {
          try {
            observed = await this.cancel(endpointId, jobId);
          } catch {
            observed = await this.status(endpointId, jobId);
          }
          if (observed.status !== "CANCELLED") throw new Error("V213_CLEANUP_JOB_NOT_CANCELLED");
        }
      }
    }

    const productionKeys = resourceKeys.filter((key) => key.endsWith("-production"));
    const productionStageOperations = stageByName.get("production")?.operations ?? [];
    const production: V213LaneDeployment[] = [];
    let productionExact = productionKeys.length === 2;
    for (const key of productionKeys) {
      const expectedBinding = this.bindingForResourceKey(key, productionStageOperations);
      if (!expectedBinding) {
        // A hash-only cleanup descriptor cannot establish the source/image/config identity by
        // itself.  First prove that the deterministic resources are absent; if anything remains,
        // stop before deletion rather than allowing an unbound same-name resource to be removed.
        const resources = await this.findNamedResources(key);
        if (resources.endpoints.length === 0 && resources.templates.length === 0) continue;
        if (resources.endpoints.length === 1 && resources.templates.length === 0) {
          productionExact = false;
          continue;
        }
        if (resources.endpoints.length === 0 && resources.templates.length === 1) {
          productionExact = false;
          continue;
        }
        throw new Error("V213_CLEANUP_PRODUCTION_BINDING_UNAVAILABLE");
      }
      let deployment: V213LaneDeployment | null;
      try {
        deployment = await this.findLaneByResourceKey(key, expectedBinding);
      } catch (error) {
        // A deterministic one-sided resource is attributable and may be removed below.  Any
        // other error means the provider read was ambiguous, drifted, or unavailable; preserve
        // the resource and stop rather than converting uncertainty into destructive cleanup.
        if (error instanceof Error && error.message === "V213_DETERMINISTIC_RESOURCE_PARTIAL") {
          productionExact = false;
          continue;
        }
        throw error;
      }
      if (!deployment) continue;
      const readback = await this.readLane(deployment, expectedBinding);
      if (readback !== deployment) throw new Error("V213_CLEANUP_PRODUCTION_READBACK_DRIFT");
      production.push(deployment);
    }
    productionExact = productionExact && production.length === 2;

    // Drain is account-global and therefore must be zero before any destructive cleanup.
    const policy = {
      maxReads: this.options.input.maxStatusReads ?? 180,
      pollMs: this.options.input.pollIntervalMs ?? 2_000,
    };
    for (let read = 0; read < policy.maxReads; read += 1) {
      const inventory = await this.options.control.inventory(this.now());
      if (inventory.runningPodCount === 0 && inventory.activeServerlessWorkerCount === 0) break;
      if (read + 1 === policy.maxReads) throw new Error("V213_CLEANUP_DRAIN_UNCONFIRMED");
      await this.sleep(policy.pollMs);
    }

    const deleteKeys = resourceKeys.filter(
      (key) => key.endsWith("-qualification") || (!productionExact && key.endsWith("-production")),
    );
    const deletedEndpoints: string[] = [];
    const deletedTemplates: string[] = [];
    const deleteCandidates: {
      readonly key: string;
      readonly endpoint?: RunPodNamedResource;
      readonly template?: RunPodNamedResource;
    }[] = [];
    const allOperations = stages.flatMap((stage) => stage.operations);
    for (const key of deleteKeys.reverse()) {
      const inventory = await this.options.control.inventoryDisposableResources();
      const endpoints = inventory.endpoints.filter(
        (item) => item.name === resourceName(key, "endpoint"),
      );
      const templates = inventory.templates.filter(
        (item) => item.name === resourceName(key, "template"),
      );
      if (endpoints.length > 1 || templates.length > 1)
        throw new Error("V213_DETERMINISTIC_RESOURCE_AMBIGUOUS");
      this.assertPartialCleanupIdentity(key, allOperations, endpoints[0], templates[0]);
      deleteCandidates.push(Object.freeze({ key, endpoint: endpoints[0], template: templates[0] }));
    }
    // Prove every owned queue before deleting even a template.  This is deliberately a separate
    // pass so a non-empty later queue cannot leave earlier endpoint/template deletions behind.
    for (const candidate of deleteCandidates)
      if (candidate.endpoint)
        await this.options.createJobClient(candidate.endpoint.id).confirmStartupQueueEmpty();
    for (const candidate of deleteCandidates) {
      const { key, endpoint, template } = candidate;
      if (endpoint) {
        const guard = new ConcreteDrainGuard();
        guard.confirmZero(0, 0);
        await this.options.control.deleteEndpoint(endpoint.id, guard);
        deletedEndpoints.push(hashId(endpoint.id));
      }
      if (template) {
        await this.options.control.deleteTemplate(template.id);
        deletedTemplates.push(hashId(template.id));
      }
      const readback = await this.options.control.inventoryDisposableResources();
      if (
        readback.endpoints.some((item) => item.name === resourceName(key, "endpoint")) ||
        readback.templates.some((item) => item.name === resourceName(key, "template"))
      )
        throw new Error("V213_DELETE_ABSENCE_NOT_PROVEN");
    }

    // A partial production pair is a cleanup success only after a final deterministic-name
    // inventory proves that neither endpoint nor template remains for either attributable lane.
    // The per-candidate readbacks above protect each deletion; this final pass also closes races
    // where a provider read was stale or a second side appeared while the pair was being drained.
    if (!productionExact) {
      const remaining = await this.options.control.inventoryDisposableResources();
      const productionNames = new Set(
        productionKeys.flatMap((key) => [
          resourceName(key, "endpoint"),
          resourceName(key, "template"),
        ]),
      );
      if (
        remaining.endpoints.some((item) => productionNames.has(item.name)) ||
        remaining.templates.some((item) => productionNames.has(item.name))
      )
        throw new Error("V213_CLEANUP_PRODUCTION_ABSENCE_NOT_PROVEN");
    }

    return Object.freeze({
      production: Object.freeze(productionExact ? production : []),
      productionCleanupState: productionExact
        ? "EXACT_MAX_ONE_PAIR_RETAINED"
        : "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
      productionResourcesAbsent: !productionExact,
      deletedEndpointIdSha256s: Object.freeze(deletedEndpoints.sort()),
      deletedTemplateIdSha256s: Object.freeze(deletedTemplates.sort()),
    });
  }

  /**
   * ACK_UNKNOWN cleanup reconciliation is provider-read-only. It proves the terminal state left by
   * the original authorized cleanup call, but has no route to cancel jobs or create/update/delete
   * resources. Any still-active job, worker, partial lane, qualification resource, or incomplete
   * production pair remains unsettled and fails closed for the outer cleanup-only executor.
   */
  async reconcileAttributableCleanupReadback(
    stages: readonly V213CleanupStageRead[],
  ): Promise<V213AttributableCleanupResult> {
    const stageByName = new Map(stages.map((stage) => [stage.stage, stage]));
    if (
      stageByName.size !== stages.length ||
      stages.some((stage) => !ID.test(stage.stageAuthorityId))
    )
      throw new Error("V213_CLEANUP_SCOPE_INVALID");
    const resourceKeys = stages.flatMap((stage) => {
      if (stage.stage === "mage") return [`v213-${stage.stageAuthorityId}-mage-qualification`];
      if (stage.stage === "soulx") return [`v213-${stage.stageAuthorityId}-soulx-qualification`];
      return [
        `v213-${stage.stageAuthorityId}-mage-production`,
        `v213-${stage.stageAuthorityId}-soulx-production`,
      ];
    });
    const observedJobs: {
      jobIdSha256: string;
      endpointIdSha256: string;
      status: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
    }[] = [];
    for (const stage of stages) {
      const endpointBindings = stage.operations
        .filter((operation) => operation.kind === "create")
        .flatMap((operation) => {
          if (
            operation.evidence === null ||
            typeof operation.evidence !== "object" ||
            Array.isArray(operation.evidence)
          )
            return [];
          const evidence = operation.evidence as Record<string, unknown>;
          if (typeof evidence.endpointId !== "string" || !ID.test(evidence.endpointId)) return [];
          const endpointIdSha256 = hashId(evidence.endpointId);
          if (
            typeof evidence.endpointIdSha256 !== "string" ||
            evidence.endpointIdSha256 !== endpointIdSha256
          )
            throw new Error("V213_CLEANUP_READBACK_JOB_ENDPOINT_DRIFT");
          return [{ endpointId: evidence.endpointId, endpointIdSha256 }];
        });
      for (const operation of stage.operations.filter((item) => item.kind === "dispatch")) {
        if (!operation.providerId || !ID.test(operation.providerId))
          throw new Error("V213_CLEANUP_READBACK_JOB_ID_UNAVAILABLE");
        const endpointCandidates = endpointBindings.filter((binding) =>
          stage.operations.some(
            (candidate) =>
              (candidate.kind === "status" || candidate.kind === "cancel") &&
              candidate.providerId === operation.providerId &&
              (candidate.resourceKey === `${binding.endpointIdSha256}:${operation.providerId}` ||
                candidate.resourceKey.startsWith(
                  `${binding.endpointIdSha256}:${operation.providerId}:`,
                )),
          ),
        );
        const endpoint =
          endpointCandidates.length === 1
            ? endpointCandidates[0]
            : endpointBindings.length === 1
              ? endpointBindings[0]
              : undefined;
        if (!endpoint) throw new Error("V213_CLEANUP_READBACK_JOB_ENDPOINT_UNAVAILABLE");
        const observed = await this.status(endpoint.endpointId, operation.providerId);
        if (observed.status === "IN_QUEUE" || observed.status === "IN_PROGRESS")
          throw new Error("V213_CLEANUP_READBACK_JOB_ACTIVE");
        observedJobs.push({
          jobIdSha256: hashId(observed.jobId),
          endpointIdSha256: endpoint.endpointIdSha256,
          status: observed.status,
        });
      }
    }

    const productionKeys = resourceKeys.filter((key) => key.endsWith("-production"));
    const productionOperations = stageByName.get("production")?.operations ?? [];
    const production: V213LaneDeployment[] = [];
    for (const key of productionKeys) {
      const resources = await this.findNamedResources(key);
      if (resources.endpoints.length === 0 && resources.templates.length === 0) continue;
      if (resources.endpoints.length !== 1 || resources.templates.length !== 1)
        throw new Error("V213_CLEANUP_READBACK_PARTIAL_RESOURCE");
      const binding = this.bindingForResourceKey(key, productionOperations);
      if (!binding) throw new Error("V213_CLEANUP_READBACK_BINDING_UNAVAILABLE");
      const deployment = await this.findLaneByResourceKey(key, binding);
      if (!deployment) throw new Error("V213_CLEANUP_READBACK_RESOURCE_DRIFT");
      production.push(deployment);
    }
    for (const key of resourceKeys.filter((value) => value.endsWith("-qualification"))) {
      const resources = await this.findNamedResources(key);
      if (resources.endpoints.length !== 0 || resources.templates.length !== 0)
        throw new Error("V213_CLEANUP_READBACK_QUALIFICATION_REMAINS");
    }
    const productionExact =
      productionKeys.length === 2 &&
      production.length === 2 &&
      new Set(production.map((deployment) => deployment.lane)).size === 2;
    if (!productionExact && production.length !== 0)
      throw new Error("V213_CLEANUP_READBACK_PRODUCTION_PARTIAL");

    const inventory = await this.inventory();
    if (inventory.runningPods !== 0 || inventory.activeWorkers !== 0 || inventory.queuedJobs !== 0)
      throw new Error("V213_CLEANUP_READBACK_COMPUTE_ACTIVE");
    return Object.freeze({
      production: Object.freeze(productionExact ? production : []),
      productionCleanupState: productionExact
        ? "EXACT_MAX_ONE_PAIR_RETAINED"
        : "ALL_ATTRIBUTABLE_PRODUCTION_ABSENT",
      productionResourcesAbsent: !productionExact,
      deletedEndpointIdSha256s: Object.freeze([]),
      deletedTemplateIdSha256s: Object.freeze([]),
      reconciliationReadback: Object.freeze({
        providerMutationPerformed: false,
        runningPods: 0,
        activeWorkers: 0,
        queuedJobs: 0,
        observedJobs: Object.freeze(
          observedJobs.sort((left, right) => left.jobIdSha256.localeCompare(right.jobIdSha256)),
        ),
        endpointIdSha256s: Object.freeze([...inventory.endpointIdSha256s].sort()),
        templateIdSha256s: Object.freeze([...inventory.templateIdSha256s].sort()),
        volumeIdSha256s: Object.freeze(inventory.volumes.map((volume) => volume.idSha256).sort()),
      }),
    });
  }

  async inventory(): Promise<V213InventoryRead> {
    const [inventory, disposable] = await Promise.all([
      this.options.control.inventory(this.now()),
      this.options.control.inventoryDisposableResources(),
    ]);
    for (const endpoint of disposable.endpoints)
      await this.options.createJobClient(endpoint.id).confirmStartupQueueEmpty();
    return Object.freeze({
      checkedAt: inventory.checkedAt,
      runningPods: inventory.runningPodCount,
      activeWorkers: inventory.activeServerlessWorkerCount,
      queuedJobs: 0,
      endpointIdSha256s: Object.freeze(inventory.endpoints.map((item) => item.idHash)),
      templateIdSha256s: Object.freeze(disposable.templates.map((item) => hashId(item.id))),
      volumes: Object.freeze(
        inventory.networkVolumes.map((volume) => {
          const sealed = [this.options.input.mage, this.options.input.soulx].find(
            (lane) => lane.volumeIdSha256 === volume.idHash,
          );
          return {
            idSha256: volume.idHash,
            sizeGb: volume.sizeGb ?? -1,
            region: volume.dataCenterId as "EU-RO-1",
            manifestSha256: sealed?.volumeManifestSha256 ?? "sha256:unknown",
          };
        }),
      ),
    });
  }

  async billingAmount(): Promise<number> {
    const facts = await this.options.readAdmissionFacts();
    this.billing = facts.cumulativeBillingUsd;
    return this.billing;
  }
}

export function createV213RunPodDualLaneTransport(
  options: V213RunPodDualLaneOptions,
): V213RunPodDualLaneTransport {
  return new V213RunPodDualLaneTransport(options);
}

export type V213ConcreteRunPodControlClient = RunPodControlClient;
