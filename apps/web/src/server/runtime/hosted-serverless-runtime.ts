import {
  FairAdmissionRepository,
  ServerlessDispatchService,
  VideoRuntimeService,
  canonicalSha256,
  type CommitPredispatchInput,
  type EndpointDeploymentInput,
  type ProvenanceReceiptSigner,
  type ServerlessLane,
  type ServerlessTransportPort,
  type Sha256,
  type TransactionalSqlExecutor,
  type WorkspaceScope,
} from "@videoforge/control-plane";

const QUALIFICATION_CHECKPOINT = Object.freeze({
  mage_image: "V2-07",
  soulx_avatar: "V2-08",
} as const satisfies Readonly<Record<ServerlessLane, "V2-07" | "V2-08">>);
const VERIFIER_ID = "videoforge-independent-qualification-v1" as const;
const MAX_VERIFICATION_AGE_MS = 24 * 60 * 60 * 1_000;

export type HostedServerlessCompositionErrorCode =
  | "HOSTED_SERVERLESS_LANE_UNQUALIFIED"
  | "HOSTED_SERVERLESS_BINDING_INVALID"
  | "HOSTED_SERVERLESS_VERIFICATION_REJECTED"
  | "HOSTED_SERVERLESS_VERIFICATION_EXPIRED";

export class HostedServerlessCompositionError extends Error {
  constructor(readonly code: HostedServerlessCompositionErrorCode) {
    super(code);
    this.name = "HostedServerlessCompositionError";
  }
}

export interface HostedQualificationLineage {
  readonly endpointIdSha256: Sha256;
  readonly endpointTemplateIdSha256: Sha256;
  readonly endpointConfigSha256: Sha256;
  readonly workerImageDigest: Sha256;
  readonly modelManifestSha256: Sha256;
  readonly volumeIdSha256: Sha256;
  readonly volumeManifestSha256: Sha256;
  readonly imageSourceCommit: string;
  readonly qualificationSourceSha256: Sha256;
  readonly dependencyLockSha256: Sha256;
  readonly acceptanceContractSha256: Sha256;
  readonly region: "EU-RO-1";
  readonly gpu: "NVIDIA GeForce RTX 4090";
  readonly max1GateConfigSha256: Sha256;
  readonly max1EndpointProfileSha256: Sha256;
  readonly max2GateConfigSha256: Sha256;
  readonly max2EndpointProfileSha256: Sha256;
}

/** Trusted output of the separately injected independent-evidence verifier. */
export interface HostedQualificationVerification {
  readonly verifierId: typeof VERIFIER_ID;
  readonly accepted: true;
  readonly lane: ServerlessLane;
  readonly checkpointId: "V2-07" | "V2-08";
  readonly canonicalArtifactSha256: Sha256;
  readonly verifiedAt: string;
  readonly expiresAt: string;
  readonly lineage: HostedQualificationLineage;
}

export interface HostedQualificationVerifier {
  verify(artifact: Readonly<Record<string, unknown>>): Promise<HostedQualificationVerification>;
}

export interface HostedServerlessLaneBinding {
  readonly deployment: EndpointDeploymentInput;
  readonly transportEndpointIdSha256: Sha256;
  readonly transport: ServerlessTransportPort;
  /** Immutable evidence artifact. Its canonical hash is computed here, never accepted as input. */
  readonly qualificationArtifact: Readonly<Record<string, unknown>>;
}

export interface HostedVerifiedDeploymentSnapshot {
  readonly deployment: Readonly<EndpointDeploymentInput>;
  readonly sealedLineage: HostedQualificationLineage;
  readonly sealedLineageSha256: Sha256;
}

type DispatchOnceInput = Parameters<ServerlessDispatchService["dispatchOnce"]>[1];
type ReconcileInput = Parameters<ServerlessDispatchService["reconcile"]>[1];
type CancelInput = Parameters<ServerlessDispatchService["cancel"]>[1];

export interface HostedQualifiedLaneService {
  readonly lane: ServerlessLane;
  readonly deploymentId: string;
  /** Immutable exact deployment and independently verified sealed lineage for downstream binding. */
  readonly verifiedDeployment: HostedVerifiedDeploymentSnapshot;
  publishDeployment(): Promise<void>;
  commitPredispatch(
    scope: WorkspaceScope,
    input: Omit<CommitPredispatchInput, "lane">,
  ): ReturnType<ServerlessDispatchService["commitPredispatch"]>;
  dispatchOnce(
    scope: WorkspaceScope,
    input: Omit<DispatchOnceInput, "endpoint" | "endpointIdSha256">,
  ): ReturnType<ServerlessDispatchService["dispatchOnce"]>;
  reconcile(
    scope: WorkspaceScope,
    input: Omit<ReconcileInput, "endpoint">,
  ): ReturnType<ServerlessDispatchService["reconcile"]>;
  cancel(
    scope: WorkspaceScope,
    input: Omit<CancelInput, "endpoint">,
  ): ReturnType<ServerlessDispatchService["cancel"]>;
}

export interface HostedCleanupLaneService {
  readonly lane: ServerlessLane;
  readonly deploymentId: string;
  reconcile(
    scope: WorkspaceScope,
    input: Omit<ReconcileInput, "endpoint">,
  ): ReturnType<ServerlessDispatchService["reconcile"]>;
  cancel(
    scope: WorkspaceScope,
    input: Omit<CancelInput, "endpoint">,
  ): ReturnType<ServerlessDispatchService["cancel"]>;
}

export interface HostedServerlessRuntimeComposition {
  readonly fairAdmission: FairAdmissionRepository;
  readonly videoRuntime: VideoRuntimeService;
  /** Raw dispatch is never exposed; qualification yields a lane-bound facade only. */
  requireLane(lane: ServerlessLane): Promise<HostedQualifiedLaneService>;
  /** Expired evidence may recover existing liability, but can never authorize new work. */
  requireCleanupLane(lane: ServerlessLane): Promise<HostedCleanupLaneService>;
}

function exactSha256(value: string): value is Sha256 {
  return /^sha256:[0-9a-f]{64}$/u.test(value);
}

function exactDate(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value
    ? timestamp
    : null;
}

function deepFreeze<Value>(value: Value): Readonly<Value> {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Array.isArray(value) ? value : Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function verifiedDeploymentSnapshot(
  binding: HostedServerlessLaneBinding,
): HostedVerifiedDeploymentSnapshot {
  const sealedLineage = deepFreeze(
    structuredClone(
      binding.deployment.timeoutEvidence.sealed_lineage as unknown as HostedQualificationLineage,
    ),
  ) as HostedQualificationLineage;
  return deepFreeze({
    deployment: binding.deployment,
    sealedLineage,
    sealedLineageSha256: canonicalSha256(
      sealedLineage as unknown as Readonly<Record<string, unknown>>,
    ),
  }) as HostedVerifiedDeploymentSnapshot;
}

function sameLineage(
  binding: HostedServerlessLaneBinding,
  lineage: HostedQualificationLineage,
): boolean {
  const deployment = binding.deployment;
  const sealedLineage = deployment.timeoutEvidence.sealed_lineage;
  return (
    binding.transportEndpointIdSha256 === deployment.endpointIdSha256 &&
    lineage.endpointIdSha256 === deployment.endpointIdSha256 &&
    deployment.endpointProfileId === `template:${lineage.endpointTemplateIdSha256}` &&
    lineage.endpointConfigSha256 === deployment.endpointConfigSha256 &&
    lineage.workerImageDigest === deployment.workerImageDigest &&
    lineage.modelManifestSha256 === deployment.modelManifestSha256 &&
    lineage.volumeIdSha256 === deployment.volumeIdSha256 &&
    lineage.volumeManifestSha256 === deployment.volumeManifestSha256 &&
    typeof sealedLineage === "object" &&
    sealedLineage !== null &&
    !Array.isArray(sealedLineage) &&
    canonicalSha256(sealedLineage as Readonly<Record<string, unknown>>) ===
      canonicalSha256(lineage as unknown as Readonly<Record<string, unknown>>) &&
    /^[0-9a-f]{40}$/u.test(lineage.imageSourceCommit) &&
    [
      lineage.qualificationSourceSha256,
      lineage.dependencyLockSha256,
      lineage.acceptanceContractSha256,
      lineage.max1GateConfigSha256,
      lineage.max1EndpointProfileSha256,
      lineage.max2GateConfigSha256,
      lineage.max2EndpointProfileSha256,
    ].every(exactSha256) &&
    lineage.region === "EU-RO-1" &&
    lineage.gpu === "NVIDIA GeForce RTX 4090"
  );
}

async function verifyLaneBinding(input: {
  readonly lane: ServerlessLane;
  readonly binding: HostedServerlessLaneBinding;
  readonly verifier: HostedQualificationVerifier;
  readonly now: () => Date;
  readonly requireFreshness: boolean;
}): Promise<void> {
  const { binding, lane } = input;
  if (
    binding.deployment.lane !== lane ||
    !exactSha256(binding.deployment.endpointIdSha256) ||
    binding.deployment.deploymentVersion < 1 ||
    binding.deployment.maxReplacementAttempts < 0
  ) {
    throw new HostedServerlessCompositionError("HOSTED_SERVERLESS_BINDING_INVALID");
  }

  const canonicalArtifactSha256 = canonicalSha256(binding.qualificationArtifact);
  let verification: HostedQualificationVerification;
  try {
    verification = await input.verifier.verify(binding.qualificationArtifact);
  } catch {
    throw new HostedServerlessCompositionError("HOSTED_SERVERLESS_VERIFICATION_REJECTED");
  }
  if (
    verification.verifierId !== VERIFIER_ID ||
    verification.accepted !== true ||
    verification.lane !== lane ||
    verification.checkpointId !== QUALIFICATION_CHECKPOINT[lane] ||
    verification.canonicalArtifactSha256 !== canonicalArtifactSha256 ||
    !sameLineage(binding, verification.lineage)
  ) {
    throw new HostedServerlessCompositionError("HOSTED_SERVERLESS_VERIFICATION_REJECTED");
  }

  const verifiedAt = exactDate(verification.verifiedAt);
  const expiresAt = exactDate(verification.expiresAt);
  const now = input.now().getTime();
  const structurallyInvalid =
    verifiedAt === null ||
    expiresAt === null ||
    expiresAt <= verifiedAt ||
    expiresAt - verifiedAt > MAX_VERIFICATION_AGE_MS;
  const freshnessInvalid =
    input.requireFreshness &&
    (verifiedAt === null ||
      expiresAt === null ||
      verifiedAt > now ||
      expiresAt <= now ||
      now - verifiedAt > MAX_VERIFICATION_AGE_MS);
  if (structurallyInvalid || freshnessInvalid) {
    throw new HostedServerlessCompositionError("HOSTED_SERVERLESS_VERIFICATION_EXPIRED");
  }
}

/**
 * Provider-free hosted composition root. Construction is inert. Every lane operation re-runs the
 * injected independent verifier and lineage/freshness checks before durable or transport access.
 */
export function createHostedServerlessRuntimeComposition(input: {
  readonly database: TransactionalSqlExecutor;
  readonly signer: ProvenanceReceiptSigner;
  readonly qualificationVerifier: HostedQualificationVerifier;
  readonly now?: () => Date;
  readonly lanes?: Readonly<Partial<Record<ServerlessLane, HostedServerlessLaneBinding>>>;
}): HostedServerlessRuntimeComposition {
  const fairAdmission = new FairAdmissionRepository(input.database);
  const videoRuntime = new VideoRuntimeService(input.database);
  const dispatch = new ServerlessDispatchService(input.database, input.signer);
  const now = input.now ?? (() => new Date());
  const snapshot = (
    binding: HostedServerlessLaneBinding | undefined,
  ): HostedServerlessLaneBinding | undefined =>
    binding === undefined
      ? undefined
      : Object.freeze({
          deployment: deepFreeze({
            ...binding.deployment,
            timeoutEvidence: structuredClone(binding.deployment.timeoutEvidence),
          }),
          transportEndpointIdSha256: binding.transportEndpointIdSha256,
          transport: binding.transport,
          qualificationArtifact: Object.freeze(structuredClone(binding.qualificationArtifact)),
        });
  const lanes = Object.freeze({
    mage_image: snapshot(input.lanes?.mage_image),
    soulx_avatar: snapshot(input.lanes?.soulx_avatar),
  });

  const verified = async (
    lane: ServerlessLane,
    binding: HostedServerlessLaneBinding,
    requireFreshness: boolean,
  ): Promise<void> =>
    verifyLaneBinding({
      lane,
      binding,
      verifier: input.qualificationVerifier,
      now,
      requireFreshness,
    });

  return Object.freeze({
    fairAdmission,
    videoRuntime,
    async requireLane(lane: ServerlessLane): Promise<HostedQualifiedLaneService> {
      const binding = lanes[lane];
      if (!binding) {
        throw new HostedServerlessCompositionError("HOSTED_SERVERLESS_LANE_UNQUALIFIED");
      }
      await verified(lane, binding, true);
      const service: HostedQualifiedLaneService = Object.freeze({
        lane,
        deploymentId: binding.deployment.deploymentId,
        verifiedDeployment: verifiedDeploymentSnapshot(binding),
        async publishDeployment(): Promise<void> {
          await verified(lane, binding, true);
          await dispatch.publishEndpointDeployment(binding.deployment);
        },
        async commitPredispatch(
          scope: WorkspaceScope,
          operation: Omit<CommitPredispatchInput, "lane">,
        ) {
          await verified(lane, binding, true);
          return dispatch.commitPredispatch(scope, { ...operation, lane });
        },
        async dispatchOnce(
          scope: WorkspaceScope,
          operation: Omit<DispatchOnceInput, "endpoint" | "endpointIdSha256">,
        ) {
          await verified(lane, binding, true);
          return dispatch.dispatchOnce(scope, {
            ...operation,
            endpoint: binding.transport,
            endpointIdSha256: binding.deployment.endpointIdSha256,
          });
        },
        async reconcile(scope: WorkspaceScope, operation: Omit<ReconcileInput, "endpoint">) {
          // A previously verified exact lane may always observe/reconcile existing liability.
          return dispatch.reconcile(scope, { ...operation, endpoint: binding.transport });
        },
        async cancel(scope: WorkspaceScope, operation: Omit<CancelInput, "endpoint">) {
          // Qualification expiry must never prevent exact-job cancellation/cleanup.
          return dispatch.cancel(scope, { ...operation, endpoint: binding.transport });
        },
      });
      return service;
    },
    async requireCleanupLane(lane: ServerlessLane): Promise<HostedCleanupLaneService> {
      const binding = lanes[lane];
      if (!binding) {
        throw new HostedServerlessCompositionError("HOSTED_SERVERLESS_LANE_UNQUALIFIED");
      }
      await verified(lane, binding, false);
      const service: HostedCleanupLaneService = Object.freeze({
        lane,
        deploymentId: binding.deployment.deploymentId,
        async reconcile(scope: WorkspaceScope, operation: Omit<ReconcileInput, "endpoint">) {
          await verified(lane, binding, false);
          return dispatch.reconcile(scope, { ...operation, endpoint: binding.transport });
        },
        async cancel(scope: WorkspaceScope, operation: Omit<CancelInput, "endpoint">) {
          await verified(lane, binding, false);
          return dispatch.cancel(scope, { ...operation, endpoint: binding.transport });
        },
      });
      return service;
    },
  });
}
