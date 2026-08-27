import type {
  ServerlessLane,
  ServerlessTransportPort,
  TransactionalSqlExecutor,
} from "@videoforge/control-plane";
import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";

import type {
  HostedProductionLengthAdmission,
  HostedProductionLengthAdmissionDocument,
  HostedProductionLengthKey,
  HostedProductionLengthRecord,
  HostedProductionLengthRepository,
  HostedProductionOutputVerifier,
  HostedProductionQualificationVerifier,
} from "../runtime/hosted-production-length-acceptance.js";
import { admitHostedProductionLength } from "../runtime/hosted-production-length-acceptance.js";
import type {
  HostedShortPilotAdmission,
  HostedShortPilotAdmissionInput,
  HostedShortPilotAdmissionDocument,
  HostedShortPilotDurableKey,
  HostedShortPilotDurableRecord,
  HostedShortPilotRepository,
  HostedShortPilotOutputVerifier,
  HostedShortPilotBarrierVerifier,
} from "../runtime/hosted-short-pilot.js";
import { admitHostedShortPilot } from "../runtime/hosted-short-pilot.js";
import type {
  HostedQualificationVerifier,
  HostedServerlessLaneBinding,
} from "../runtime/hosted-serverless-runtime.js";
import type { HostedV211EvidenceVerifier } from "../runtime/hosted-v211-acceptance-coordinator.js";
import {
  freezeV209ShortLiveAdmission,
  type V209ShortAdmissionObservation,
} from "../runtime/v209-short-live-cost.js";
import type {
  V213ChromeAcceptanceVerifier,
  V213CleanupVerification,
  V213CleanupVerifier,
  V213LiveAcceptanceAdapterDependencies,
  V213LiveAttemptStore,
  V213LiveConsumedClaim,
  V213LiveExecutionRequest,
  V213LiveReceiptVerifier,
  V213LiveVerifiedReceipt,
  V213VerifiedChromeAcceptance,
  V210LiveAcceptanceCall,
  V211LiveAcceptanceCall,
  V212LiveAcceptanceCall,
  V213FinalLiveAcceptanceCall,
} from "../runtime/v213-live-acceptance.js";
import {
  certifyV213ReleaseFromCurrentRun,
  createV213LiveAcceptanceAdapter,
} from "../runtime/v213-live-acceptance.js";
import type {
  V213ReleaseEvidenceFact,
  V213ReleaseIdentityFacts,
  V213ReleaseEvidenceArtifact,
  V213ReleaseEvidenceVerifier,
  V213ReleaseGate,
  V213VerifiedReleaseEvidence,
} from "../runtime/v213-release-certification.js";
import {
  buildV213ReleaseIdentity,
  buildV213ReleaseCertificationLedger,
  buildV213VerifiedReleaseEvidence,
  hashV213ReleaseIdentity,
  V213_RELEASE_GATES,
} from "../runtime/v213-release-certification.js";
import {
  buildV213ReleaseChromeRequest,
  produceV213ReleaseChromeAcceptance,
  type SpawnV213ReleaseChromeJourney,
  type V213ReleaseChromeChildReceipt,
} from "../providers/v213-release-real-chrome.js";
import type {
  V213FullLiveCommandHandler,
  V213FullLiveCommandRequest,
} from "../providers/v213-full-live-cli.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SIGNATURE = /^[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
type EvidenceKind =
  | "RECEIPT"
  | "CLEANUP"
  | "CHROME"
  | "RELEASE"
  | "V210_OUTPUT"
  | "V211_EVIDENCE"
  | "V212_OUTPUT";

interface JsonRow extends Record<string, unknown> {
  readonly value: unknown;
}

interface StoredEvidence {
  readonly kind: EvidenceKind;
  readonly artifactSha256: Sha256;
  readonly document: Readonly<Record<string, unknown>>;
  readonly keyId: string;
  readonly signatureHex: string;
}

export interface V213SignedEvidenceReference extends Record<string, unknown> {
  readonly artifactSha256: Sha256;
}

export function v213EvidenceKeyId(signingKey: Uint8Array): string {
  if (signingKey.byteLength < 32) throw new Error("V213_EVIDENCE_SIGNING_KEY_INVALID");
  return `v213-acceptance-evidence-${canonicalSha256([...signingKey]).slice(7, 39)}`;
}

function artifactReference(value: unknown): V213SignedEvidenceReference {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).join(",") !== "artifactSha256" ||
    !SHA256.test((value as Record<string, unknown>).artifactSha256 as string)
  )
    throw new Error("V213_SIGNED_EVIDENCE_REFERENCE_INVALID");
  return value as V213SignedEvidenceReference;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function hmac(keyBytes: Uint8Array, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(keyBytes).buffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}

function evidencePreimage(
  kind: EvidenceKind,
  artifactSha256: Sha256,
  document: Readonly<Record<string, unknown>>,
): string {
  return `${kind}\n${artifactSha256}\n${canonicalSha256(document)}`;
}

const VERIFIER_CANONICAL_FIELD = Object.freeze({
  V210_OUTPUT: "canonicalEvidenceSha256",
  V211_EVIDENCE: "canonicalEvidenceSha256",
  V212_OUTPUT: "canonicalEvidenceSha256",
  RECEIPT: "canonicalArtifactSha256",
  CLEANUP: "canonicalArtifactSha256",
} as const);

type VerifierEvidenceKind = keyof typeof VERIFIER_CANONICAL_FIELD;

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function verifierPreimage(
  kind: VerifierEvidenceKind,
  artifactSha256: Sha256,
  document: Readonly<Record<string, unknown>>,
): string {
  return `V213_VERIFIER/v1\n${kind}\n${artifactSha256}\n${canonicalSha256(document)}`;
}

async function queryValue(
  database: TransactionalSqlExecutor,
  sql: string,
  value: Readonly<Record<string, unknown>>,
): Promise<unknown> {
  return database.transaction(async (transaction) => {
    const result = await transaction.query<JsonRow>(sql, [JSON.stringify(value)]);
    if (result.rows.length !== 1) throw new Error("V213_DATABASE_RESULT_INVALID");
    return result.rows[0]?.value;
  });
}

export class V213SqlAttemptStore implements V213LiveAttemptStore {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async claimOnce(
    requestSha256: Sha256,
    request: V213LiveExecutionRequest,
  ): Promise<V213LiveConsumedClaim | null> {
    return (await queryValue(
      this.database,
      "SELECT public.videoforge_claim_v213_live_acceptance($1::jsonb) AS value",
      { requestSha256, request },
    )) as V213LiveConsumedClaim | null;
  }

  async complete(
    requestSha256: Sha256,
    completionSha256: Sha256,
    receiptEvidenceSha256: Sha256,
    result: Readonly<Record<string, unknown>>,
  ): Promise<boolean> {
    return (
      (await queryValue(
        this.database,
        "SELECT public.videoforge_complete_v213_live_acceptance($1::jsonb) AS value",
        { requestSha256, completionSha256, receiptEvidenceSha256, result },
      )) === true
    );
  }

  async recordTerminalFailure(requestSha256: Sha256, cleanupSha256: Sha256): Promise<boolean> {
    return (
      (await queryValue(
        this.database,
        "SELECT public.videoforge_fail_v213_live_acceptance($1::jsonb) AS value",
        { requestSha256, cleanupSha256 },
      )) === true
    );
  }
}

class V213SqlShortPilotRepository implements HostedShortPilotRepository {
  constructor(private readonly database: TransactionalSqlExecutor) {}
  private call(operation: string, payload: Readonly<Record<string, unknown>>) {
    return queryValue(
      this.database,
      "SELECT public.videoforge_v213_short_pilot_repository($1::jsonb) AS value",
      { operation, ...payload },
    );
  }
  async createOrReplay(
    key: HostedShortPilotDurableKey,
    admissionDocument: HostedShortPilotAdmissionDocument,
  ) {
    return (await this.call("CREATE", { key, admissionDocument })) as {
      readonly record: HostedShortPilotDurableRecord;
      readonly replayed: boolean;
    };
  }
  async claimSubmission(key: HostedShortPilotDurableKey, requestSha256: Sha256) {
    return (await this.call("CLAIM", {
      key,
      requestSha256,
    })) as HostedShortPilotDurableRecord | null;
  }
  async read(key: HostedShortPilotDurableKey) {
    return (await this.call("READ", { key })) as HostedShortPilotDurableRecord | null;
  }
  async accept(key: HostedShortPilotDurableKey, requestSha256: Sha256, acceptanceSha256: Sha256) {
    return (await this.call("ACCEPT", {
      key,
      requestSha256,
      acceptanceSha256,
    })) as HostedShortPilotDurableRecord | null;
  }
}

class V213SqlProductionLengthRepository implements HostedProductionLengthRepository {
  constructor(private readonly database: TransactionalSqlExecutor) {}
  private call(operation: string, payload: Readonly<Record<string, unknown>>) {
    return queryValue(
      this.database,
      "SELECT public.videoforge_v213_production_length_repository($1::jsonb) AS value",
      { operation, ...payload },
    );
  }
  async createOrReplay(document: HostedProductionLengthAdmissionDocument) {
    return (await this.call("CREATE", { document })) as {
      readonly record: HostedProductionLengthRecord;
      readonly replayed: boolean;
    };
  }
  async claimOnce(key: HostedProductionLengthKey, requestSha256: Sha256) {
    return (await this.call("CLAIM", {
      key,
      requestSha256,
    })) as HostedProductionLengthRecord | null;
  }
  async read(key: HostedProductionLengthKey) {
    return (await this.call("READ", { key })) as HostedProductionLengthRecord | null;
  }
  async accept(key: HostedProductionLengthKey, requestSha256: Sha256, acceptanceSha256: Sha256) {
    return (await this.call("ACCEPT", {
      key,
      requestSha256,
      acceptanceSha256,
    })) as HostedProductionLengthRecord | null;
  }
}

export class V213SqlSignedEvidenceStore {
  private readonly keyId: string;
  constructor(
    private readonly database: TransactionalSqlExecutor,
    private readonly signingKey: Uint8Array,
  ) {
    if (signingKey.byteLength < 32) throw new Error("V213_EVIDENCE_SIGNING_KEY_INVALID");
    this.keyId = v213EvidenceKeyId(signingKey);
  }

  async signAndStore(
    kind: EvidenceKind,
    document: Readonly<Record<string, unknown>>,
    artifactSha256: Sha256 = canonicalSha256(document),
  ): Promise<V213SignedEvidenceReference> {
    if (!SHA256.test(artifactSha256)) throw new Error("V213_EVIDENCE_ARTIFACT_ID_INVALID");
    const signatureHex = await hmac(
      this.signingKey,
      evidencePreimage(kind, artifactSha256, document),
    );
    const stored = await queryValue(
      this.database,
      "SELECT public.videoforge_record_v213_signed_evidence($1::jsonb) AS value",
      { kind, artifactSha256, document, keyId: this.keyId, signatureHex },
    );
    if (stored !== artifactSha256) throw new Error("V213_EVIDENCE_STORE_REJECTED");
    return Object.freeze({ artifactSha256 });
  }

  async releaseVerifierSignatureSha256(
    artifactSha256: Sha256,
    value: Readonly<Record<string, unknown>>,
  ): Promise<Sha256> {
    if (!SHA256.test(artifactSha256)) throw new Error("V213_EVIDENCE_ARTIFACT_ID_INVALID");
    const signatureHex = await hmac(
      this.signingKey,
      `RELEASE_VERIFIER\n${artifactSha256}\n${canonicalSha256(value)}`,
    );
    return canonicalSha256({ keyId: this.keyId, signatureHex });
  }

  async finalizeVerifierDocument(
    kind: VerifierEvidenceKind,
    artifactSha256: Sha256,
    document: Readonly<Record<string, unknown>>,
  ): Promise<Readonly<Record<string, unknown>>> {
    if (
      !SHA256.test(artifactSha256) ||
      Object.hasOwn(document, "verifierSignatureSha256") ||
      Object.hasOwn(document, "signatureVerified")
    )
      throw new Error("V213_VERIFIER_DOCUMENT_INVALID");
    const canonicalField = VERIFIER_CANONICAL_FIELD[kind];
    if (Object.hasOwn(document, canonicalField)) throw new Error("V213_VERIFIER_DOCUMENT_INVALID");
    const unsigned = Object.freeze({
      ...document,
      [canonicalField]: canonicalSha256({ artifactSha256 }),
    });
    const signatureHex = await hmac(
      this.signingKey,
      verifierPreimage(kind, artifactSha256, unsigned),
    );
    const verifierSignatureSha256 = canonicalSha256({
      schemaVersion: "videoforge.v213-protected-verifier-signature/v1",
      kind,
      artifactSha256,
      keyId: this.keyId,
      signatureHex,
    });
    return Object.freeze({
      ...unsigned,
      verifierSignatureSha256,
      ...(["V211_EVIDENCE", "RECEIPT", "CLEANUP"].includes(kind)
        ? { signatureVerified: true as const }
        : {}),
    });
  }

  private async verifyVerifierDocument(
    kind: VerifierEvidenceKind,
    artifactSha256: Sha256,
    document: Readonly<Record<string, unknown>>,
  ): Promise<boolean> {
    const canonicalField = VERIFIER_CANONICAL_FIELD[kind];
    const requiresVerifiedFlag = ["V211_EVIDENCE", "RECEIPT", "CLEANUP"].includes(kind);
    if (
      document[canonicalField] !== canonicalSha256({ artifactSha256 }) ||
      typeof document.verifierSignatureSha256 !== "string" ||
      !SHA256.test(document.verifierSignatureSha256) ||
      (requiresVerifiedFlag && document.signatureVerified !== true) ||
      (!requiresVerifiedFlag && Object.hasOwn(document, "signatureVerified"))
    )
      return false;
    const unsigned = { ...document };
    delete unsigned.verifierSignatureSha256;
    delete unsigned.signatureVerified;
    const signatureHex = await hmac(
      this.signingKey,
      verifierPreimage(kind, artifactSha256, unsigned),
    );
    const expected = canonicalSha256({
      schemaVersion: "videoforge.v213-protected-verifier-signature/v1",
      kind,
      artifactSha256,
      keyId: this.keyId,
      signatureHex,
    });
    return constantTimeEqual(document.verifierSignatureSha256, expected);
  }

  async loadAndVerify(kind: EvidenceKind, reference: unknown): Promise<StoredEvidence> {
    const { artifactSha256 } = artifactReference(reference);
    const stored = (await queryValue(
      this.database,
      "SELECT public.videoforge_load_v213_signed_evidence($1::jsonb) AS value",
      { kind, artifactSha256 },
    )) as StoredEvidence | null;
    const expectedSignatureHex = stored
      ? await hmac(this.signingKey, evidencePreimage(kind, artifactSha256, stored.document))
      : "";
    if (
      !stored ||
      stored.kind !== kind ||
      stored.artifactSha256 !== artifactSha256 ||
      stored.keyId !== this.keyId ||
      !SIGNATURE.test(stored.signatureHex) ||
      !constantTimeEqual(stored.signatureHex, expectedSignatureHex) ||
      (Object.hasOwn(VERIFIER_CANONICAL_FIELD, kind) &&
        !(await this.verifyVerifierDocument(
          kind as VerifierEvidenceKind,
          artifactSha256,
          stored.document,
        )))
    )
      throw new Error("V213_SIGNED_EVIDENCE_INVALID");
    return stored;
  }
}

export function createV213HostedAcceptanceProductionFactory(input: {
  readonly database: TransactionalSqlExecutor;
  readonly evidenceSigningKey: Uint8Array;
  readonly transport: V213LiveAcceptanceAdapterDependencies["transport"];
  readonly now: () => Date;
}) {
  const durable = createV213SqlJitDependencies({
    database: input.database,
    evidenceSigningKey: input.evidenceSigningKey,
  });
  const store = new V213SqlAttemptStore(input.database);
  return Object.freeze({
    ...durable,
    acceptance: createV213LiveAcceptanceAdapter({
      store,
      transport: input.transport,
      receiptVerifier: durable.receiptVerifier,
      cleanupVerifier: durable.cleanupVerifier,
      now: input.now,
    }),
    store,
  });
}

/** DB-backed proof/repository composition shared by the operator-side JIT builder and worker. */
export function createV213SqlJitDependencies(input: {
  readonly database: TransactionalSqlExecutor;
  readonly evidenceSigningKey: Uint8Array;
}) {
  const evidence = new V213SqlSignedEvidenceStore(input.database, input.evidenceSigningKey);
  const receiptVerifier: V213LiveReceiptVerifier = {
    verify: async (reference) =>
      (await evidence.loadAndVerify("RECEIPT", reference))
        .document as unknown as V213LiveVerifiedReceipt,
  };
  const cleanupVerifier: V213CleanupVerifier = {
    verify: async (reference) =>
      (await evidence.loadAndVerify("CLEANUP", reference))
        .document as unknown as V213CleanupVerification,
  };
  const chromeVerifier: V213ChromeAcceptanceVerifier = {
    verify: async (reference) =>
      (await evidence.loadAndVerify("CHROME", reference))
        .document as unknown as V213VerifiedChromeAcceptance,
  };
  const releaseEvidenceVerifier: V213ReleaseEvidenceVerifier = {
    verify: async (artifact: V213ReleaseEvidenceArtifact) =>
      (await evidence.loadAndVerify("RELEASE", artifact.evidence))
        .document as unknown as V213VerifiedReleaseEvidence,
  };
  const shortPilotOutputVerifier: HostedShortPilotOutputVerifier = {
    verify: async (reference) =>
      (await evidence.loadAndVerify("V210_OUTPUT", reference)).document as never,
  };
  const v211EvidenceVerifier: HostedV211EvidenceVerifier = {
    verify: async (reference) =>
      (await evidence.loadAndVerify("V211_EVIDENCE", reference)).document as never,
  };
  const productionLengthOutputVerifier: HostedProductionOutputVerifier = {
    verify: async (reference) =>
      (await evidence.loadAndVerify("V212_OUTPUT", reference)).document as never,
  };
  const verifyJitArtifact = async (kind: string, artifact: Readonly<Record<string, unknown>>) =>
    queryValue(
      input.database,
      "SELECT public.videoforge_verify_v213_jit_artifact($1::jsonb) AS value",
      { kind, artifact },
    );
  const qualificationVerifier: HostedQualificationVerifier = {
    verify: async (artifact) =>
      (await verifyJitArtifact("QUALIFICATION", artifact)) as Awaited<
        ReturnType<HostedQualificationVerifier["verify"]>
      >,
  };
  const shortPilotBarrierVerifier: HostedShortPilotBarrierVerifier = {
    verify: async (artifact) =>
      (await verifyJitArtifact("SHORT_PILOT_BARRIER", artifact)) as Awaited<
        ReturnType<HostedShortPilotBarrierVerifier["verify"]>
      >,
  };
  const productionQualificationVerifier: HostedProductionQualificationVerifier = {
    verify: async (artifact) =>
      (await verifyJitArtifact("PRODUCTION_LENGTH_QUALIFICATION", artifact)) as Awaited<
        ReturnType<HostedProductionQualificationVerifier["verify"]>
      >,
  };
  return Object.freeze({
    evidence,
    receiptVerifier,
    cleanupVerifier,
    chromeVerifier,
    releaseEvidenceVerifier,
    shortPilotOutputVerifier,
    v211EvidenceVerifier,
    productionLengthOutputVerifier,
    qualificationVerifier,
    shortPilotBarrierVerifier,
    productionQualificationVerifier,
    shortPilotRepository: new V213SqlShortPilotRepository(input.database),
    productionLengthRepository: new V213SqlProductionLengthRepository(input.database),
  });
}

export const V213_JIT_OPERATIONS = Object.freeze([
  "v2-09-short-hosted-project",
  "v2-10-operator-free-ranga-pilot",
  "v2-11-two-concurrent-owned-projects",
  "v2-12-long-output",
  "v2-13-final-two-lane-smoke",
] as const);

export type V213JitOperation = (typeof V213_JIT_OPERATIONS)[number];
type V213JitCheckpoint = "V2-09" | "V2-10" | "V2-11" | "V2-12" | "V2-13";

const JIT_CHECKPOINT = Object.freeze({
  "v2-09-short-hosted-project": "V2-09",
  "v2-10-operator-free-ranga-pilot": "V2-10",
  "v2-11-two-concurrent-owned-projects": "V2-11",
  "v2-12-long-output": "V2-12",
  "v2-13-final-two-lane-smoke": "V2-13",
} as const satisfies Readonly<Record<V213JitOperation, V213JitCheckpoint>>);

const JIT_PREDECESSORS = Object.freeze({
  "v2-09-short-hosted-project": Object.freeze([]),
  "v2-10-operator-free-ranga-pilot": Object.freeze(["v2-09-short-hosted-project"]),
  "v2-11-two-concurrent-owned-projects": Object.freeze([
    "v2-09-short-hosted-project",
    "v2-10-operator-free-ranga-pilot",
  ]),
  "v2-12-long-output": Object.freeze([
    "v2-09-short-hosted-project",
    "v2-10-operator-free-ranga-pilot",
    "v2-11-two-concurrent-owned-projects",
  ]),
  "v2-13-final-two-lane-smoke": Object.freeze([
    "v2-09-short-hosted-project",
    "v2-10-operator-free-ranga-pilot",
    "v2-11-two-concurrent-owned-projects",
    "v2-12-long-output",
  ]),
} as const satisfies Readonly<Record<V213JitOperation, readonly string[]>>);

interface V213JitAuthorityBinding extends Record<string, unknown> {
  readonly directParentAuthorityId: string;
  readonly productionStageAuthorityId: string;
  readonly tokenSha256: Sha256;
  readonly issuedAt: string;
  readonly expiresAt: string;
}

interface V213JitProjection extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-jit-operation-projection/v2";
  readonly operationId: V213JitOperation;
  readonly checkpoint: V213JitCheckpoint;
  readonly fullLiveAuthorityId: string;
  readonly commandId: string;
  readonly stageAuthorityId: string;
  readonly outerStateSha256: Sha256;
  readonly workloadDeadlineAt: string;
  readonly predecessorEvidenceSha256s: Readonly<Record<string, Sha256>>;
  readonly candidateSha256: Sha256;
  readonly candidate: Readonly<Record<string, unknown>>;
  readonly authorityBinding: V213JitAuthorityBinding;
}

export interface V213JitMaterializationRequest {
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213JitOperation;
  readonly commandId: string;
  readonly stageAuthorityId: string;
  readonly outerStateSha256: Sha256;
}

export interface V213JitMaterialization {
  readonly operationId: V213JitOperation;
  readonly checkpoint: V213JitCheckpoint;
  readonly requestSha256: Sha256;
  readonly materializationSha256: Sha256;
  readonly requestDocument: Readonly<Record<string, unknown>>;
  readonly executionDocument: Readonly<Record<string, unknown>>;
  readonly callDocument: Readonly<Record<string, unknown>>;
}

export interface V213ReleaseFactMaterializationRequest extends Record<string, unknown> {
  readonly fullLiveAuthorityId: string;
  readonly completedOperationId: string;
  readonly completedEvidenceSha256: Sha256;
}

export interface V213ReleaseFactMaterializationResult extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-release-fact-materialization/v1";
  readonly fullLiveAuthorityId: string;
  readonly completedOperationId: string;
  readonly completedEvidenceSha256: Sha256;
  readonly releaseIdentitySha256: Sha256 | null;
  readonly gateFactSha256s: Readonly<Partial<Record<V213ReleaseGate, Sha256>>>;
  readonly materializationSha256: Sha256;
}

function exactReleaseFactMaterialization(
  value: unknown,
  request: V213ReleaseFactMaterializationRequest,
): V213ReleaseFactMaterializationResult {
  const result = record(value, "V213_RELEASE_FACT_MATERIALIZATION_INVALID");
  exactKeys(
    result,
    [
      "completedEvidenceSha256",
      "completedOperationId",
      "fullLiveAuthorityId",
      "gateFactSha256s",
      "materializationSha256",
      "releaseIdentitySha256",
      "schemaVersion",
    ],
    "V213_RELEASE_FACT_MATERIALIZATION_INVALID",
  );
  const rawGateFacts = record(result.gateFactSha256s, "V213_RELEASE_FACT_MATERIALIZATION_INVALID");
  if (
    Object.keys(rawGateFacts).some(
      (gate) =>
        !V213_RELEASE_GATES.includes(gate as V213ReleaseGate) ||
        typeof rawGateFacts[gate] !== "string" ||
        !SHA256.test(rawGateFacts[gate] as string),
    )
  )
    throw new Error("V213_RELEASE_FACT_MATERIALIZATION_INVALID");
  const unsigned = {
    schemaVersion: result.schemaVersion,
    fullLiveAuthorityId: result.fullLiveAuthorityId,
    completedOperationId: result.completedOperationId,
    completedEvidenceSha256: result.completedEvidenceSha256,
    releaseIdentitySha256: result.releaseIdentitySha256,
    gateFactSha256s: rawGateFacts,
  };
  if (
    result.schemaVersion !== "videoforge.v213-release-fact-materialization/v1" ||
    result.fullLiveAuthorityId !== request.fullLiveAuthorityId ||
    result.completedOperationId !== request.completedOperationId ||
    result.completedEvidenceSha256 !== request.completedEvidenceSha256 ||
    (result.releaseIdentitySha256 !== null &&
      (typeof result.releaseIdentitySha256 !== "string" ||
        !SHA256.test(result.releaseIdentitySha256))) ||
    result.materializationSha256 !== canonicalSha256(unsigned)
  )
    throw new Error("V213_RELEASE_FACT_MATERIALIZATION_INVALID");
  return Object.freeze({
    ...result,
    gateFactSha256s: Object.freeze({ ...rawGateFacts }),
  }) as unknown as V213ReleaseFactMaterializationResult;
}

/** Appends only DB-projected facts from a completed current-authority source operation. The caller
 * supplies no claims, metrics, identity values, timestamps, or pass booleans. */
export function createV213SqlReleaseFactMaterializer(database: TransactionalSqlExecutor) {
  return async (
    request: V213ReleaseFactMaterializationRequest,
  ): Promise<V213ReleaseFactMaterializationResult> => {
    if (
      !request.fullLiveAuthorityId ||
      !request.completedOperationId ||
      !SHA256.test(request.completedEvidenceSha256)
    )
      throw new Error("V213_RELEASE_FACT_MATERIALIZATION_REQUEST_INVALID");
    const persisted = exactReleaseFactMaterialization(
      await queryValue(
        database,
        "SELECT public.videoforge_materialize_v213_release_facts($1::jsonb) AS value",
        request,
      ),
      request,
    );
    const readback = exactReleaseFactMaterialization(
      await queryValue(
        database,
        "SELECT public.videoforge_read_v213_release_fact_materialization($1::jsonb) AS value",
        request,
      ),
      request,
    );
    if (canonicalSha256(readback) !== canonicalSha256(persisted))
      throw new Error("V213_RELEASE_FACT_MATERIALIZATION_READBACK_DRIFT");
    return readback;
  };
}

export const V213_CLEANUP_RECEIPT_OPERATIONS = Object.freeze([
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
] as const);

export type V213CleanupReceiptOperation = (typeof V213_CLEANUP_RECEIPT_OPERATIONS)[number];

export interface V213SqlCleanupReceiptFinalizationRequest extends Record<string, unknown> {
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213CleanupReceiptOperation;
  readonly outerStateSha256: Sha256;
  readonly providerCleanupEvidenceSha256: Sha256;
  readonly summary: Readonly<Record<string, unknown>>;
  readonly readbackOnly: boolean;
}

export interface V213SqlCleanupReceiptFinalizationResult extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-cleanup-receipt-finalization-result/v1";
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213CleanupReceiptOperation;
  readonly providerCleanupEvidenceSha256: Sha256;
  readonly receiptArtifactSha256: Sha256;
  readonly releaseFactMaterializationSha256: Sha256;
  readonly readbackOnly: boolean;
}

/** Finalizes a provider-cleanup journal result in a separate DB-only boundary. The recovery mode
 * performs exact readback only: it cannot create signed evidence, operation receipts, or facts. */
export function createV213SqlCleanupReceiptFinalizer(input: {
  readonly database: TransactionalSqlExecutor;
  readonly evidenceSigningKey: Uint8Array;
}) {
  const evidence = new V213SqlSignedEvidenceStore(input.database, input.evidenceSigningKey);
  const materializeReleaseFacts = createV213SqlReleaseFactMaterializer(input.database);
  return async (
    request: V213SqlCleanupReceiptFinalizationRequest,
  ): Promise<V213SqlCleanupReceiptFinalizationResult> => {
    const summary = record(request.summary, "V213_CLEANUP_RECEIPT_SUMMARY_INVALID");
    if (
      !UUID.test(request.fullLiveAuthorityId) ||
      !V213_CLEANUP_RECEIPT_OPERATIONS.includes(request.operationId) ||
      !SHA256.test(request.outerStateSha256) ||
      !SHA256.test(request.providerCleanupEvidenceSha256) ||
      request.providerCleanupEvidenceSha256 !== canonicalSha256(summary) ||
      typeof request.readbackOnly !== "boolean"
    )
      throw new Error("V213_CLEANUP_RECEIPT_FINALIZATION_REQUEST_INVALID");
    const document = Object.freeze({
      schemaVersion: "videoforge.v213-current-run-cleanup-receipt/v1",
      fullLiveAuthorityId: request.fullLiveAuthorityId,
      operationId: request.operationId,
      outerStateSha256: request.outerStateSha256,
      providerCleanupEvidenceSha256: request.providerCleanupEvidenceSha256,
      summary: Object.freeze({ ...summary }),
    });
    const receiptArtifactSha256 = canonicalSha256(document);
    const factRequest: V213ReleaseFactMaterializationRequest = {
      fullLiveAuthorityId: request.fullLiveAuthorityId,
      completedOperationId: request.operationId,
      completedEvidenceSha256: receiptArtifactSha256,
    };
    let materialization: V213ReleaseFactMaterializationResult;
    if (request.readbackOnly) {
      materialization = exactReleaseFactMaterialization(
        await queryValue(
          input.database,
          "SELECT public.videoforge_read_v213_release_fact_materialization($1::jsonb) AS value",
          factRequest,
        ),
        factRequest,
      );
    } else {
      const stored = await evidence.signAndStore("RELEASE", document, receiptArtifactSha256);
      if (stored.artifactSha256 !== receiptArtifactSha256)
        throw new Error("V213_CLEANUP_RECEIPT_STORE_INVALID");
      const recorded = await queryValue(
        input.database,
        "SELECT public.videoforge_record_v213_operation_receipt($1::jsonb) AS value",
        {
          fullLiveAuthorityId: request.fullLiveAuthorityId,
          operationId: request.operationId,
          artifactSha256: receiptArtifactSha256,
          document,
        },
      );
      if (recorded !== receiptArtifactSha256) throw new Error("V213_CLEANUP_RECEIPT_STORE_INVALID");
      materialization = await materializeReleaseFacts(factRequest);
    }
    const stored = await evidence.loadAndVerify("RELEASE", {
      artifactSha256: receiptArtifactSha256,
    });
    if (canonicalSha256(stored.document) !== canonicalSha256(document))
      throw new Error("V213_CLEANUP_RECEIPT_READBACK_DRIFT");
    const receiptReadback = record(
      await queryValue(
        input.database,
        "SELECT public.videoforge_read_v213_operation_receipt($1::jsonb) AS value",
        {
          fullLiveAuthorityId: request.fullLiveAuthorityId,
          operationId: request.operationId,
          artifactSha256: receiptArtifactSha256,
        },
      ),
      "V213_CLEANUP_RECEIPT_READBACK_INVALID",
    );
    exactKeys(
      receiptReadback,
      ["artifactSha256", "document", "operationId"],
      "V213_CLEANUP_RECEIPT_READBACK_INVALID",
    );
    if (
      receiptReadback.artifactSha256 !== receiptArtifactSha256 ||
      receiptReadback.operationId !== request.operationId ||
      canonicalSha256(record(receiptReadback.document, "V213_CLEANUP_RECEIPT_READBACK_INVALID")) !==
        canonicalSha256(document)
    )
      throw new Error("V213_CLEANUP_RECEIPT_READBACK_DRIFT");
    return Object.freeze({
      schemaVersion: "videoforge.v213-cleanup-receipt-finalization-result/v1",
      fullLiveAuthorityId: request.fullLiveAuthorityId,
      operationId: request.operationId,
      providerCleanupEvidenceSha256: request.providerCleanupEvidenceSha256,
      receiptArtifactSha256,
      releaseFactMaterializationSha256: materialization.materializationSha256,
      readbackOnly: request.readbackOnly,
    });
  };
}

const V213_FINAL_CERTIFICATION_PREDECESSORS = Object.freeze([
  "v2-13-final-two-lane-smoke",
  "restore-endpoints-max-one",
  "prove-zero-workers",
  "read-settled-billing",
  "reconcile-exact-resources",
] as const);

export interface V213SqlReleaseCertificationRequest {
  readonly fullLiveAuthorityId: string;
  readonly workId: string;
  readonly outerStateSha256: Sha256;
  readonly predecessorEvidenceSha256s: Readonly<Record<string, Sha256>>;
  readonly resumed: boolean;
  readonly authorizedUnsettled: boolean;
  readonly reconciliationOnly: boolean;
  readonly persistenceForbidden: boolean;
  readonly dispatchForbidden: boolean;
  readonly providerDispatchForbidden: true;
}

export interface V213FinalReleaseCertificationResult extends Record<string, unknown> {
  readonly schemaVersion: "videoforge.v213-final-release-certification-result/v1";
  readonly actualUsd: 0;
  readonly externalSpendUsd: 0;
  readonly gpuUse: false;
  readonly providerMutationPerformed: false;
  readonly currentRunEvidence: true;
  readonly certified: true;
  readonly releaseStatus: "release_certified";
  readonly gateCount: 15;
  readonly missingGateCount: 0;
  readonly invalidGateCount: 0;
  readonly liveReleaseAuthorized: false;
  readonly requiresExplicitReleaseAuthority: true;
  readonly releaseIdentitySha256: Sha256;
  readonly ledgerSha256: Sha256;
  readonly evidenceSha256: Sha256;
  readonly predecessorEvidenceSha256s: Readonly<Record<string, Sha256>>;
}

type V213JitDependencies = ReturnType<typeof createV213SqlJitDependencies>;
type TransportlessLaneBinding = Omit<HostedServerlessLaneBinding, "transport">;

function record(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(code);
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[], code: string): void {
  if (Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) throw new Error(code);
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value
  );
}

function exactPredecessors(
  operationId: V213JitOperation,
  value: unknown,
): Readonly<Record<string, Sha256>> {
  const predecessors = record(value, "V213_JIT_PREDECESSOR_SET_INVALID");
  exactKeys(predecessors, JIT_PREDECESSORS[operationId], "V213_JIT_PREDECESSOR_SET_INVALID");
  if (Object.values(predecessors).some((hash) => typeof hash !== "string" || !SHA256.test(hash)))
    throw new Error("V213_JIT_PREDECESSOR_SET_INVALID");
  return predecessors as Readonly<Record<string, Sha256>>;
}

function exactProjection(value: unknown, request: V213JitMaterializationRequest, now: Date) {
  const projection = record(value, "V213_JIT_PROJECTION_INVALID");
  exactKeys(
    projection,
    [
      "authorityBinding",
      "candidate",
      "candidateSha256",
      "checkpoint",
      "commandId",
      "fullLiveAuthorityId",
      "operationId",
      "outerStateSha256",
      "predecessorEvidenceSha256s",
      "schemaVersion",
      "stageAuthorityId",
      "workloadDeadlineAt",
    ],
    "V213_JIT_PROJECTION_INVALID",
  );
  if (
    projection.schemaVersion !== "videoforge.v213-jit-operation-projection/v2" ||
    projection.operationId !== request.operationId ||
    projection.checkpoint !== JIT_CHECKPOINT[request.operationId] ||
    projection.fullLiveAuthorityId !== request.fullLiveAuthorityId ||
    projection.commandId !== request.commandId ||
    projection.stageAuthorityId !== request.stageAuthorityId ||
    projection.outerStateSha256 !== request.outerStateSha256 ||
    typeof projection.candidateSha256 !== "string" ||
    !SHA256.test(projection.candidateSha256) ||
    !validDate(projection.workloadDeadlineAt) ||
    Date.parse(projection.workloadDeadlineAt) <= now.getTime()
  )
    throw new Error("V213_JIT_PROJECTION_INVALID");
  const candidate = record(projection.candidate, "V213_JIT_CANDIDATE_INVALID");
  if (canonicalSha256(candidate) !== projection.candidateSha256)
    throw new Error("V213_JIT_CANDIDATE_HASH_INVALID");
  const authority = record(projection.authorityBinding, "V213_JIT_AUTHORITY_INVALID");
  exactKeys(
    authority,
    [
      "directParentAuthorityId",
      "expiresAt",
      "issuedAt",
      "productionStageAuthorityId",
      "tokenSha256",
    ],
    "V213_JIT_AUTHORITY_INVALID",
  );
  const issuedAt = Date.parse(String(authority.issuedAt));
  const expiresAt = Date.parse(String(authority.expiresAt));
  if (
    authority.directParentAuthorityId !== request.fullLiveAuthorityId ||
    authority.productionStageAuthorityId !== request.stageAuthorityId ||
    typeof authority.tokenSha256 !== "string" ||
    !SHA256.test(authority.tokenSha256) ||
    !validDate(authority.issuedAt) ||
    !validDate(authority.expiresAt) ||
    issuedAt > now.getTime() ||
    now.getTime() - issuedAt > 15 * 60_000 ||
    expiresAt <= now.getTime() ||
    expiresAt - issuedAt > 15 * 60_000
  )
    throw new Error("V213_JIT_AUTHORITY_INVALID");
  exactPredecessors(request.operationId, projection.predecessorEvidenceSha256s);
  return projection as unknown as V213JitProjection;
}

function laneBindings(
  raw: unknown,
  transports: Readonly<Record<ServerlessLane, ServerlessTransportPort>>,
): Readonly<Record<ServerlessLane, HostedServerlessLaneBinding>> {
  const qualifications = record(raw, "V213_JIT_QUALIFICATIONS_INVALID");
  exactKeys(qualifications, ["mage_image", "soulx_avatar"], "V213_JIT_QUALIFICATIONS_INVALID");
  return Object.freeze(
    Object.fromEntries(
      (["mage_image", "soulx_avatar"] as const).map((lane) => {
        const serialized = record(qualifications[lane], "V213_JIT_QUALIFICATIONS_INVALID");
        exactKeys(
          serialized,
          ["deployment", "qualificationArtifact", "transportEndpointIdSha256"],
          "V213_JIT_QUALIFICATIONS_INVALID",
        );
        return [
          lane,
          Object.freeze({
            ...(serialized as unknown as TransportlessLaneBinding),
            transport: transports[lane],
          }),
        ];
      }),
    ),
  ) as Readonly<Record<ServerlessLane, HostedServerlessLaneBinding>>;
}

async function loadPlan(
  referenceValue: unknown,
  projection: V213JitProjection,
  loader: (reference: V213ScopedRenderPlanReference) => Promise<unknown>,
) {
  const reference = record(referenceValue, "V213_JIT_RENDER_PLAN_REFERENCE_INVALID");
  exactKeys(
    reference,
    [
      "accountId",
      "artifactUri",
      "fullLiveAuthorityId",
      "issuedAt",
      "materializationRequestSha256",
      "nonce",
      "operationId",
      "outerStateSha256",
      "projectId",
      "projectRevisionId",
      "sha256",
      "workspaceId",
    ],
    "V213_JIT_RENDER_PLAN_REFERENCE_INVALID",
  );
  if (
    typeof reference.artifactUri !== "string" ||
    !reference.artifactUri.startsWith("vf-local://objects/") ||
    typeof reference.sha256 !== "string" ||
    !SHA256.test(reference.sha256) ||
    reference.fullLiveAuthorityId !== projection.fullLiveAuthorityId ||
    reference.operationId !== projection.operationId ||
    reference.outerStateSha256 !== projection.outerStateSha256 ||
    reference.materializationRequestSha256 !==
      canonicalSha256({
        fullLiveAuthorityId: projection.fullLiveAuthorityId,
        operationId: projection.operationId,
        commandId: projection.commandId,
        stageAuthorityId: projection.stageAuthorityId,
        outerStateSha256: projection.outerStateSha256,
      }) ||
    typeof reference.nonce !== "string" ||
    reference.nonce.length < 32 ||
    !validDate(reference.issuedAt) ||
    ![
      reference.accountId,
      reference.workspaceId,
      reference.projectId,
      reference.projectRevisionId,
    ].every((value) => typeof value === "string" && value.length > 0)
  )
    throw new Error("V213_JIT_RENDER_PLAN_REFERENCE_INVALID");
  const document = await loader(reference as unknown as V213ScopedRenderPlanReference);
  return Object.freeze({ document, sha256: reference.sha256 as Sha256 });
}

export interface V213ScopedRenderPlanReference extends Record<string, unknown> {
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213JitOperation;
  readonly outerStateSha256: Sha256;
  readonly materializationRequestSha256: Sha256;
  readonly accountId: string;
  readonly workspaceId: string;
  readonly projectId: string;
  readonly projectRevisionId: string;
  readonly artifactUri: string;
  readonly sha256: Sha256;
  readonly issuedAt: string;
  readonly nonce: string;
}

function scopeMatchesAdmission(
  request: V213LiveExecutionRequest,
  admission: HostedShortPilotAdmission | HostedProductionLengthAdmission,
): boolean {
  const scope = request.scopes[0];
  const short = "key" in admission;
  const key = short ? admission.key : admission.document.key;
  const requestSha256 = short ? admission.requestSha256 : admission.document.requestSha256;
  const attemptId = short ? admission.automaticAttemptId : admission.attemptId;
  return Boolean(
    scope &&
      request.scopes.length === 1 &&
      scope.accountId === key.accountId &&
      scope.workspaceId === key.workspaceId &&
      scope.projectId === key.projectId &&
      scope.projectRevisionId === key.projectRevisionId &&
      scope.requestSha256 === requestSha256 &&
      scope.attemptId === attemptId,
  );
}

function requestDocument(
  projection: V213JitProjection,
  call: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  if (projection.operationId === "v2-09-short-hosted-project") {
    const pairInput = record(call.pairInput, "V213_JIT_V209_PAIR_INPUT_INVALID");
    const workflowId = `hosted-pair-${String(pairInput.generationRequestId)}`;
    const base = {
      schemaVersion: "videoforge.v213-hosted-v209-jit-command/v1",
      commandId: projection.commandId,
      stageAuthorityId: projection.stageAuthorityId,
      operationId: projection.operationId,
      workflowId,
      accountId: pairInput.accountId,
      workspaceId: pairInput.workspaceId,
      generationRequestId: pairInput.generationRequestId,
      outerStateSha256: projection.outerStateSha256,
    };
    if (
      ![base.accountId, base.workspaceId, base.generationRequestId].every(
        (value) => typeof value === "string" && value.length > 0,
      )
    )
      throw new Error("V213_JIT_V209_PAIR_INPUT_INVALID");
    return Object.freeze({ ...base, requestSha256: canonicalSha256(base) });
  }
  const request = record(call.request, "V213_JIT_CALL_REQUEST_INVALID");
  const scopes = Array.isArray(request.scopes) ? request.scopes : [];
  const primary = record(scopes[0], "V213_JIT_CALL_REQUEST_INVALID");
  if (typeof request.executionId !== "string" || request.executionId.length === 0)
    throw new Error("V213_JIT_CALL_REQUEST_INVALID");
  if (
    [
      primary.accountId,
      primary.workspaceId,
      primary.projectId,
      primary.projectRevisionId,
      primary.attemptId,
    ].some((value) => typeof value !== "string" || value.length === 0)
  )
    throw new Error("V213_JIT_CALL_REQUEST_INVALID");
  const workflowId = `v213-${projection.checkpoint.toLowerCase()}-${request.executionId}`;
  const base = {
    schemaVersion: "videoforge.v213-hosted-acceptance-command/v1",
    commandId: projection.commandId,
    stageAuthorityId: projection.stageAuthorityId,
    command: projection.operationId,
    checkpoint: projection.checkpoint,
    workflowId,
    attemptId: primary.attemptId,
    accountId: primary.accountId,
    workspaceId: primary.workspaceId,
    projectId: primary.projectId,
    projectRevisionId: primary.projectRevisionId,
    outerStateSha256: projection.outerStateSha256,
  };
  return Object.freeze({ ...base, requestSha256: canonicalSha256(base) });
}

/**
 * Builds one operation only after SQL has projected its exact current-run candidate. The builder
 * persists and reads back that same materialization before returning, so callers can dispatch only
 * a durable DB-owned `execution.call.request` and never a caller-authored placeholder.
 */
export function createV213SqlJitMaterializer(input: {
  readonly database: TransactionalSqlExecutor;
  readonly factory: V213JitDependencies;
  readonly laneTransports: Readonly<Record<ServerlessLane, ServerlessTransportPort>>;
  /** Trusted tenant-private object read. Implementations must GET, rehash, and enforce the exact
   * owner-bound URI+sha256 projection before returning parsed JSON. */
  loadResolvedRenderManifest(reference: V213ScopedRenderPlanReference): Promise<unknown>;
  /** Fresh read-only provider/rate/billing observation acquired immediately before V2-09. */
  readonly readV209Observation: () => Promise<V209ShortAdmissionObservation>;
  readonly now: () => Date;
}) {
  return async (request: V213JitMaterializationRequest): Promise<V213JitMaterialization> => {
    if (
      !V213_JIT_OPERATIONS.includes(request.operationId) ||
      !SHA256.test(request.outerStateSha256)
    )
      throw new Error("V213_JIT_REQUEST_INVALID");
    const projection = exactProjection(
      await queryValue(
        input.database,
        "SELECT public.videoforge_project_v213_jit_operation($1::jsonb) AS value",
        { ...request },
      ),
      request,
      input.now(),
    );
    const candidate = projection.candidate;
    let call: Readonly<Record<string, unknown>>;
    if (request.operationId === "v2-09-short-hosted-project") {
      exactKeys(
        candidate,
        ["laneItemIds", "pairInput", "renderPlanReference"],
        "V213_JIT_CANDIDATE_INVALID",
      );
      const plan = await loadPlan(
        candidate.renderPlanReference,
        projection,
        input.loadResolvedRenderManifest,
      );
      const admission = await freezeV209ShortLiveAdmission(
        plan.document,
        await input.readV209Observation(),
      );
      if (admission.planSha256 !== plan.sha256) throw new Error("V213_JIT_RENDER_PLAN_HASH_DRIFT");
      const laneItemIds = record(candidate.laneItemIds, "V213_JIT_V209_LANES_INVALID");
      exactKeys(laneItemIds, ["mage_image", "soulx_avatar"], "V213_JIT_V209_LANES_INVALID");
      if (
        !Array.isArray(laneItemIds.mage_image) ||
        laneItemIds.mage_image.length !== admission.work.mage_image.length ||
        !Array.isArray(laneItemIds.soulx_avatar) ||
        laneItemIds.soulx_avatar.length !== admission.work.soulx_avatar.length
      )
        throw new Error("V213_JIT_V209_LANES_INVALID");
      call = Object.freeze({
        pairInput: record(candidate.pairInput, "V213_JIT_V209_PAIR_INPUT_INVALID"),
        admission,
        laneItemIds,
      });
    } else if (request.operationId === "v2-10-operator-free-ranga-pilot") {
      exactKeys(
        candidate,
        ["admissionInput", "renderPlanReference", "request"],
        "V213_JIT_CANDIDATE_INVALID",
      );
      const admissionInput = record(candidate.admissionInput, "V213_JIT_CANDIDATE_INVALID");
      const plan = await loadPlan(
        candidate.renderPlanReference,
        projection,
        input.loadResolvedRenderManifest,
      );
      const admission = await admitHostedShortPilot({
        repository: input.factory.shortPilotRepository,
        verifier: input.factory.qualificationVerifier,
        barrierVerifier: input.factory.shortPilotBarrierVerifier,
        candidate: {
          ...(admissionInput as unknown as HostedShortPilotAdmissionInput),
          renderPlanDocument: plan.document as HostedShortPilotAdmissionInput["renderPlanDocument"],
          qualifications: laneBindings(admissionInput.qualifications, input.laneTransports),
        },
        now: input.now,
      });
      if (admission.key.renderPlanSha256 !== plan.sha256)
        throw new Error("V213_JIT_RENDER_PLAN_HASH_DRIFT");
      const executionRequest = candidate.request as unknown as V213LiveExecutionRequest;
      if (
        executionRequest.checkpoint !== "V2-10" ||
        !scopeMatchesAdmission(executionRequest, admission)
      )
        throw new Error("V213_JIT_SCOPE_ADMISSION_DRIFT");
      call = Object.freeze({ request: executionRequest, admission });
    } else if (request.operationId === "v2-11-two-concurrent-owned-projects") {
      exactKeys(candidate, ["request"], "V213_JIT_CANDIDATE_INVALID");
      const executionRequest = candidate.request as unknown as V213LiveExecutionRequest;
      if (
        executionRequest.checkpoint !== "V2-11" ||
        executionRequest.scopes?.length !== 2 ||
        new Set(executionRequest.scopes.map((scope) => `${scope.accountId}:${scope.workspaceId}`))
          .size !== 2
      )
        throw new Error("V213_JIT_V211_SCOPE_INVALID");
      call = Object.freeze({ request: executionRequest });
    } else if (request.operationId === "v2-12-long-output") {
      exactKeys(
        candidate,
        ["admissionInput", "renderPlanReference", "request"],
        "V213_JIT_CANDIDATE_INVALID",
      );
      const admissionInput = record(candidate.admissionInput, "V213_JIT_CANDIDATE_INVALID");
      const plan = await loadPlan(
        candidate.renderPlanReference,
        projection,
        input.loadResolvedRenderManifest,
      );
      const admission = await admitHostedProductionLength({
        repository: input.factory.productionLengthRepository,
        verifier: input.factory.productionQualificationVerifier,
        candidate: {
          ...(admissionInput as unknown as Parameters<
            typeof admitHostedProductionLength
          >[0]["candidate"]),
          renderPlanDocument: plan.document as Parameters<
            typeof admitHostedProductionLength
          >[0]["candidate"]["renderPlanDocument"],
        },
        now: input.now,
      });
      if (admission.document.key.renderPlanSha256 !== plan.sha256)
        throw new Error("V213_JIT_RENDER_PLAN_HASH_DRIFT");
      const executionRequest = candidate.request as unknown as V213LiveExecutionRequest;
      if (
        executionRequest.checkpoint !== "V2-12" ||
        !scopeMatchesAdmission(executionRequest, admission)
      )
        throw new Error("V213_JIT_SCOPE_ADMISSION_DRIFT");
      call = Object.freeze({ request: executionRequest, admission });
    } else {
      exactKeys(candidate, ["request"], "V213_JIT_CANDIDATE_INVALID");
      const executionRequest = candidate.request as unknown as V213LiveExecutionRequest;
      if (
        request.operationId === "v2-13-final-two-lane-smoke" &&
        (executionRequest.checkpoint !== "V2-13" || executionRequest.scopes?.length !== 1)
      )
        throw new Error("V213_JIT_V213_SMOKE_SCOPE_INVALID");
      call = Object.freeze({ request: executionRequest });
    }
    const document = requestDocument(projection, call);
    const execution =
      request.operationId === "v2-09-short-hosted-project"
        ? Object.freeze({
            schemaVersion: "videoforge.v213-v209-jit-execution/v1",
            operationId: projection.operationId,
            workflowId: document.workflowId,
            call,
          })
        : Object.freeze({
            schemaVersion: "videoforge.v213-database-acceptance-execution/v2",
            operationId: projection.operationId,
            checkpoint: projection.checkpoint,
            workflowId: document.workflowId,
            workflowParams: {
              schemaVersion: "videoforge.v213-acceptance-workflow-params/v1",
              kind: "V213_DATABASE_ACCEPTANCE",
              fullLiveAuthorityId: projection.fullLiveAuthorityId,
              operationId: projection.operationId,
              checkpoint: projection.checkpoint,
              workflowId: document.workflowId,
              requestSha256: document.requestSha256,
            },
            pollIntervalMs: 250,
            workloadDeadlineAt: projection.workloadDeadlineAt,
            call,
          });
    const base = Object.freeze({
      schemaVersion: "videoforge.v213-jit-materialization/v1",
      operationId: projection.operationId,
      checkpoint: projection.checkpoint,
      fullLiveAuthorityId: projection.fullLiveAuthorityId,
      candidateSha256: projection.candidateSha256,
      predecessorEvidenceSha256s: projection.predecessorEvidenceSha256s,
      authorityBinding: projection.authorityBinding,
      requestDocument: document,
      executionDocument: execution,
      callDocument: call,
    });
    const materializationSha256 = canonicalSha256(base);
    const persisted = await queryValue(
      input.database,
      "SELECT public.videoforge_persist_v213_jit_materialization($1::jsonb) AS value",
      { ...base, materializationSha256 },
    );
    if (persisted !== materializationSha256) throw new Error("V213_JIT_PERSIST_REJECTED");
    const readback = record(
      await queryValue(
        input.database,
        "SELECT public.videoforge_read_v213_jit_materialization($1::jsonb) AS value",
        {
          fullLiveAuthorityId: request.fullLiveAuthorityId,
          operationId: request.operationId,
          materializationSha256,
        },
      ),
      "V213_JIT_READBACK_INVALID",
    );
    exactKeys(
      readback,
      [
        "callDocument",
        "checkpoint",
        "materializationSha256",
        "operationId",
        "requestDocument",
        "executionDocument",
      ],
      "V213_JIT_READBACK_INVALID",
    );
    if (
      readback.operationId !== request.operationId ||
      readback.checkpoint !== projection.checkpoint ||
      readback.materializationSha256 !== materializationSha256 ||
      canonicalSha256(record(readback.requestDocument, "V213_JIT_READBACK_INVALID")) !==
        canonicalSha256(document) ||
      canonicalSha256(record(readback.executionDocument, "V213_JIT_READBACK_INVALID")) !==
        canonicalSha256(execution) ||
      canonicalSha256(record(readback.callDocument, "V213_JIT_READBACK_INVALID")) !==
        canonicalSha256(call)
    )
      throw new Error("V213_JIT_READBACK_INVALID");
    return Object.freeze({
      operationId: request.operationId,
      checkpoint: projection.checkpoint,
      requestSha256: document.requestSha256 as Sha256,
      materializationSha256,
      requestDocument: readback.requestDocument as Readonly<Record<string, unknown>>,
      executionDocument: readback.executionDocument as Readonly<Record<string, unknown>>,
      callDocument: readback.callDocument as Readonly<Record<string, unknown>>,
    });
  };
}

export interface V213ReleaseChromeProductionResult {
  readonly smokeEvidenceSha256: Sha256;
  readonly chromeArtifactSha256: Sha256;
  readonly requestSha256: Sha256;
}

function releaseChromeSignaturePreimage(receipt: V213ReleaseChromeChildReceipt): string {
  return [
    "V213_RELEASE_CHROME",
    receipt.requestSha256,
    receipt.observationSha256,
    canonicalSha256(receipt.document),
  ].join("\n");
}

/** Produces the distinct release-bound Chrome artifact only after the signed smoke has been loaded
 * from the evidence store and matched to the DB projection. It never accepts scope/output data from
 * the bridge response. */
export function createV213SqlReleaseChromeProducer(input: {
  readonly database: TransactionalSqlExecutor;
  readonly evidenceSigningKey: Uint8Array;
  readonly childSigningKeyFd: number;
  readonly spawnJourney: SpawnV213ReleaseChromeJourney;
  readonly now: () => Date;
}) {
  const evidence = new V213SqlSignedEvidenceStore(input.database, input.evidenceSigningKey);
  return async (request: {
    readonly fullLiveAuthorityId: string;
    readonly smokeEvidenceSha256: Sha256;
    readonly outerStateSha256: Sha256;
    readonly signal?: AbortSignal;
  }): Promise<V213ReleaseChromeProductionResult> => {
    if (
      !request.fullLiveAuthorityId ||
      !SHA256.test(request.smokeEvidenceSha256) ||
      !SHA256.test(request.outerStateSha256)
    )
      throw new Error("V213_RELEASE_CHROME_PRODUCTION_REQUEST_INVALID");
    const projection = record(
      await queryValue(
        input.database,
        "SELECT public.videoforge_project_v213_release_chrome($1::jsonb) AS value",
        {
          fullLiveAuthorityId: request.fullLiveAuthorityId,
          smokeEvidenceSha256: request.smokeEvidenceSha256,
          outerStateSha256: request.outerStateSha256,
        },
      ),
      "V213_RELEASE_CHROME_PROJECTION_INVALID",
    );
    exactKeys(
      projection,
      [
        "fullLiveAuthorityId",
        "outerStateSha256",
        "projectionSha256",
        "requestInput",
        "schemaVersion",
        "smokeEvidenceSha256",
      ],
      "V213_RELEASE_CHROME_PROJECTION_INVALID",
    );
    const requestInput = record(projection.requestInput, "V213_RELEASE_CHROME_PROJECTION_INVALID");
    const unsignedProjection = {
      schemaVersion: projection.schemaVersion,
      fullLiveAuthorityId: projection.fullLiveAuthorityId,
      smokeEvidenceSha256: projection.smokeEvidenceSha256,
      outerStateSha256: projection.outerStateSha256,
      requestInput,
    };
    if (
      projection.schemaVersion !== "videoforge.v213-release-chrome-projection/v1" ||
      projection.fullLiveAuthorityId !== request.fullLiveAuthorityId ||
      projection.smokeEvidenceSha256 !== request.smokeEvidenceSha256 ||
      projection.outerStateSha256 !== request.outerStateSha256 ||
      typeof projection.projectionSha256 !== "string" ||
      projection.projectionSha256 !== canonicalSha256(unsignedProjection)
    )
      throw new Error("V213_RELEASE_CHROME_PROJECTION_INVALID");
    const chromeRequest = buildV213ReleaseChromeRequest(
      requestInput as unknown as Parameters<typeof buildV213ReleaseChromeRequest>[0],
      input.now(),
    );
    if (
      chromeRequest.fullLiveAuthorityId !== request.fullLiveAuthorityId ||
      chromeRequest.smokeEvidenceSha256 !== request.smokeEvidenceSha256
    )
      throw new Error("V213_RELEASE_CHROME_PROJECTION_INVALID");
    const produced = await produceV213ReleaseChromeAcceptance({
      request: chromeRequest,
      childSigningKeyFd: input.childSigningKeyFd,
      spawnJourney: input.spawnJourney,
      now: input.now,
      signal: request.signal,
      verifyPersistedSmokeTerminal: async (expected) => {
        const stored = await evidence.loadAndVerify("RELEASE", {
          artifactSha256: expected.smokeEvidenceSha256,
        });
        const smoke = record(stored.document, "V213_RELEASE_CHROME_SMOKE_INVALID");
        if (
          smoke.schemaVersion !== "videoforge.v213-fresh-two-lane-smoke-result/v1" ||
          smoke.smokeOnly !== true ||
          smoke.releaseCertified !== false ||
          smoke.twoLaneSmoke !== true ||
          smoke.fullLiveAuthorityId !== expected.fullLiveAuthorityId ||
          smoke.outputSha256 !== expected.outputSha256 ||
          smoke.finalOutputReceiptSha256 !== expected.finalOutputReceiptSha256 ||
          smoke.smokeTerminalAt !== expected.smokeTerminalAt ||
          canonicalSha256(record(smoke.scope, "V213_RELEASE_CHROME_SMOKE_INVALID")) !==
            canonicalSha256({
              accountId: expected.accountId,
              workspaceId: expected.workspaceId,
              projectId: expected.projectId,
              projectRevisionId: expected.projectRevisionId,
              attemptId: expected.attemptId,
            })
        )
          throw new Error("V213_RELEASE_CHROME_SMOKE_INVALID");
        return Object.freeze({
          verifierId: "videoforge-v213-persisted-smoke-terminal-verifier-v1" as const,
          accepted: true as const,
          canonicalEvidenceSha256: canonicalSha256({
            artifactSha256: expected.smokeEvidenceSha256,
          }),
          signatureVerified: true as const,
          fullLiveAuthorityId: expected.fullLiveAuthorityId,
          smokeEvidenceSha256: expected.smokeEvidenceSha256,
          smokeTerminalAt: expected.smokeTerminalAt,
        });
      },
      verifyChildReceipt: async (receipt, expected) => {
        if (
          receipt.requestSha256 !== expected.requestSha256 ||
          receipt.keyId !== v213EvidenceKeyId(input.evidenceSigningKey) ||
          receipt.signatureHex !==
            (await hmac(input.evidenceSigningKey, releaseChromeSignaturePreimage(receipt)))
        )
          throw new Error("V213_RELEASE_CHROME_CHILD_SIGNATURE_INVALID");
        return Object.freeze({
          verifierId: "videoforge-v213-release-chrome-child-receipt-verifier-v1" as const,
          accepted: true as const,
          canonicalReceiptSha256: canonicalSha256(receipt),
          signatureSha256: canonicalSha256({
            keyId: receipt.keyId,
            signatureHex: receipt.signatureHex,
          }),
          signatureVerified: true as const,
        });
      },
    });
    const stored = await evidence.signAndStore(
      "CHROME",
      produced.document as unknown as Readonly<Record<string, unknown>>,
      produced.artifact.artifactSha256,
    );
    if (stored.artifactSha256 !== produced.artifact.artifactSha256)
      throw new Error("V213_RELEASE_CHROME_STORE_INVALID");
    const association = {
      fullLiveAuthorityId: request.fullLiveAuthorityId,
      smokeEvidenceSha256: request.smokeEvidenceSha256,
      outerStateSha256: request.outerStateSha256,
      requestSha256: chromeRequest.requestSha256,
      projectionSha256: projection.projectionSha256,
      chromeArtifactSha256: stored.artifactSha256,
    };
    const persisted = await queryValue(
      input.database,
      "SELECT public.videoforge_persist_v213_release_chrome($1::jsonb) AS value",
      association,
    );
    if (persisted !== stored.artifactSha256)
      throw new Error("V213_RELEASE_CHROME_ASSOCIATION_REJECTED");
    const readback = record(
      await queryValue(
        input.database,
        "SELECT public.videoforge_read_v213_release_chrome($1::jsonb) AS value",
        association,
      ),
      "V213_RELEASE_CHROME_READBACK_INVALID",
    );
    exactKeys(
      readback,
      ["chromeArtifactSha256", "requestSha256", "smokeEvidenceSha256"],
      "V213_RELEASE_CHROME_READBACK_INVALID",
    );
    if (
      readback.chromeArtifactSha256 !== stored.artifactSha256 ||
      readback.requestSha256 !== chromeRequest.requestSha256 ||
      readback.smokeEvidenceSha256 !== request.smokeEvidenceSha256
    )
      throw new Error("V213_RELEASE_CHROME_READBACK_INVALID");
    return Object.freeze({
      smokeEvidenceSha256: request.smokeEvidenceSha256,
      chromeArtifactSha256: stored.artifactSha256,
      requestSha256: chromeRequest.requestSha256,
    });
  };
}

function exactCertificationPredecessors(value: unknown): Readonly<Record<string, Sha256>> {
  const predecessors = record(value, "V213_RELEASE_CERTIFICATION_PREDECESSORS_INVALID");
  exactKeys(
    predecessors,
    V213_FINAL_CERTIFICATION_PREDECESSORS,
    "V213_RELEASE_CERTIFICATION_PREDECESSORS_INVALID",
  );
  if (Object.values(predecessors).some((hash) => typeof hash !== "string" || !SHA256.test(hash)))
    throw new Error("V213_RELEASE_CERTIFICATION_PREDECESSORS_INVALID");
  return predecessors as Readonly<Record<string, Sha256>>;
}

function certificationIdentitySha256(request: V213SqlReleaseCertificationRequest): Sha256 {
  return canonicalSha256({
    fullLiveAuthorityId: request.fullLiveAuthorityId,
    workId: request.workId,
    outerStateSha256: request.outerStateSha256,
    predecessorEvidenceSha256s: exactCertificationPredecessors(request.predecessorEvidenceSha256s),
  });
}

const V213_FINAL_CERTIFICATION_RESULT_KEYS = Object.freeze([
  "actualUsd",
  "certified",
  "currentRunEvidence",
  "evidenceSha256",
  "externalSpendUsd",
  "gateCount",
  "gpuUse",
  "invalidGateCount",
  "ledgerSha256",
  "liveReleaseAuthorized",
  "missingGateCount",
  "predecessorEvidenceSha256s",
  "providerMutationPerformed",
  "releaseIdentitySha256",
  "releaseStatus",
  "requiresExplicitReleaseAuthority",
  "schemaVersion",
] as const);

function exactFinalCertificationResult(
  value: unknown,
  predecessorEvidenceSha256s: Readonly<Record<string, Sha256>>,
): V213FinalReleaseCertificationResult {
  const result = record(value, "V213_RELEASE_CERTIFICATION_RESULT_INVALID");
  exactKeys(
    result,
    V213_FINAL_CERTIFICATION_RESULT_KEYS,
    "V213_RELEASE_CERTIFICATION_RESULT_INVALID",
  );
  const predecessors = exactCertificationPredecessors(result.predecessorEvidenceSha256s);
  if (
    result.schemaVersion !== "videoforge.v213-final-release-certification-result/v1" ||
    result.actualUsd !== 0 ||
    result.externalSpendUsd !== 0 ||
    result.gpuUse !== false ||
    result.providerMutationPerformed !== false ||
    result.currentRunEvidence !== true ||
    result.certified !== true ||
    result.releaseStatus !== "release_certified" ||
    result.gateCount !== V213_RELEASE_GATES.length ||
    result.missingGateCount !== 0 ||
    result.invalidGateCount !== 0 ||
    result.liveReleaseAuthorized !== false ||
    result.requiresExplicitReleaseAuthority !== true ||
    typeof result.releaseIdentitySha256 !== "string" ||
    !SHA256.test(result.releaseIdentitySha256) ||
    typeof result.ledgerSha256 !== "string" ||
    !SHA256.test(result.ledgerSha256) ||
    result.evidenceSha256 !== result.ledgerSha256 ||
    canonicalSha256(predecessors) !== canonicalSha256(predecessorEvidenceSha256s)
  )
    throw new Error("V213_RELEASE_CERTIFICATION_RESULT_INVALID");
  return result as unknown as V213FinalReleaseCertificationResult;
}

function exactReleaseCertificationProjection(
  value: unknown,
  request: V213SqlReleaseCertificationRequest,
  identitySha256: Sha256,
) {
  const projection = record(value, "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID");
  exactKeys(
    projection,
    [
      "certificationIdentitySha256",
      "chromeArtifact",
      "fullLiveAuthorityId",
      "gateFacts",
      "outerStateSha256",
      "predecessorEvidenceSha256s",
      "projectionSha256",
      "releaseIdentityFacts",
      "releaseIdentitySha256",
      "schemaVersion",
      "scope",
      "sourceCommit",
      "workId",
    ],
    "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID",
  );
  const predecessors = exactCertificationPredecessors(projection.predecessorEvidenceSha256s);
  const releaseIdentityFacts = record(
    projection.releaseIdentityFacts,
    "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID",
  );
  exactKeys(
    releaseIdentityFacts,
    [
      "contractBundleSha256",
      "deployedExecutableSha256",
      "deployedSourceCommit",
      "deploymentConfigSha256",
      "mageCertificationLedgerSha256",
      "mageEndpointConfigSha256",
      "mageImageDigest",
      "productionUrlSha256",
      "soulxCertificationLedgerSha256",
      "soulxEndpointConfigSha256",
      "soulxImageDigest",
      "v209AcceptanceSha256",
      "v210AcceptanceSha256",
      "v211AcceptanceSha256",
      "v212AcceptanceSha256",
    ],
    "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID",
  );
  const releaseIdentity = buildV213ReleaseIdentity({
    sourceCommit: String(projection.sourceCommit),
    facts: releaseIdentityFacts as unknown as V213ReleaseIdentityFacts,
  });
  const scope = record(projection.scope, "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID");
  exactKeys(
    scope,
    ["accountId", "attemptId", "projectId", "projectRevisionId", "requestSha256", "workspaceId"],
    "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID",
  );
  if (
    [
      scope.accountId,
      scope.workspaceId,
      scope.projectId,
      scope.projectRevisionId,
      scope.attemptId,
    ].some((item) => typeof item !== "string" || item.length === 0) ||
    typeof scope.requestSha256 !== "string" ||
    !SHA256.test(scope.requestSha256)
  )
    throw new Error("V213_RELEASE_CERTIFICATION_PROJECTION_INVALID");
  const chromeArtifact = record(
    projection.chromeArtifact,
    "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID",
  );
  const chromeReference = record(
    chromeArtifact.rawEvidence,
    "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID",
  );
  const rawGateFacts = record(
    projection.gateFacts,
    "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID",
  );
  exactKeys(rawGateFacts, V213_RELEASE_GATES, "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID");
  const gateFacts = {} as Record<V213ReleaseGate, V213ReleaseEvidenceFact>;
  const evidenceArtifacts = {} as Record<V213ReleaseGate, V213ReleaseEvidenceArtifact>;
  const validationDocuments = {} as Record<V213ReleaseGate, V213VerifiedReleaseEvidence>;
  for (const gate of V213_RELEASE_GATES) {
    const fact = record(rawGateFacts[gate], "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID");
    exactKeys(
      fact,
      [
        "claims",
        "evidenceClass",
        "evidencePath",
        "fixtureOrFakeTransportUsed",
        "gate",
        "metrics",
        "observedAt",
        "observerId",
        "sourceEvidenceSha256",
      ],
      "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID",
    );
    const metrics = record(fact.metrics, "V213_RELEASE_CERTIFICATION_PROJECTION_INVALID");
    if (
      fact.gate !== gate ||
      typeof fact.sourceEvidenceSha256 !== "string" ||
      !SHA256.test(fact.sourceEvidenceSha256) ||
      !Array.isArray(fact.claims) ||
      fact.claims.some((claim) => typeof claim !== "string") ||
      Object.values(metrics).some(
        (metric) => !["boolean", "number", "string"].includes(typeof metric),
      ) ||
      fact.fixtureOrFakeTransportUsed !== false ||
      !validDate(fact.observedAt)
    )
      throw new Error("V213_RELEASE_CERTIFICATION_PROJECTION_INVALID");
    const typedFact = Object.freeze({ ...fact, metrics }) as unknown as V213ReleaseEvidenceFact;
    const artifactSha256 = canonicalSha256({
      schemaVersion: "videoforge.v213-current-run-release-evidence-id/v1",
      fullLiveAuthorityId: request.fullLiveAuthorityId,
      certificationIdentitySha256: identitySha256,
      releaseIdentitySha256: hashV213ReleaseIdentity(releaseIdentity),
      gate,
      sourceEvidenceSha256: typedFact.sourceEvidenceSha256,
    });
    const artifact = Object.freeze({
      schemaVersion: "videoforge-v213-release-evidence-artifact/v1" as const,
      gate,
      evidence: Object.freeze({ artifactSha256 }),
    });
    gateFacts[gate] = typedFact;
    evidenceArtifacts[gate] = artifact;
    validationDocuments[gate] = buildV213VerifiedReleaseEvidence({
      releaseIdentity,
      artifact,
      fact: typedFact,
      verifierSignatureSha256: canonicalSha256({
        schemaVersion: "videoforge.v213-release-evidence-validation-signature/v1",
        artifactSha256,
      }),
    });
  }
  const unsigned = {
    schemaVersion: projection.schemaVersion,
    fullLiveAuthorityId: projection.fullLiveAuthorityId,
    workId: projection.workId,
    outerStateSha256: projection.outerStateSha256,
    certificationIdentitySha256: projection.certificationIdentitySha256,
    sourceCommit: projection.sourceCommit,
    predecessorEvidenceSha256s: predecessors,
    releaseIdentityFacts,
    releaseIdentitySha256: projection.releaseIdentitySha256,
    scope,
    gateFacts: rawGateFacts,
    chromeArtifact,
  };
  if (
    projection.schemaVersion !== "videoforge.v213-final-release-certification-projection/v2" ||
    projection.fullLiveAuthorityId !== request.fullLiveAuthorityId ||
    projection.workId !== request.workId ||
    projection.outerStateSha256 !== request.outerStateSha256 ||
    projection.certificationIdentitySha256 !== identitySha256 ||
    canonicalSha256(predecessors) !== canonicalSha256(request.predecessorEvidenceSha256s) ||
    typeof projection.sourceCommit !== "string" ||
    hashV213ReleaseIdentity(releaseIdentity) !== projection.releaseIdentitySha256 ||
    Object.keys(chromeArtifact).join(",") !== "rawEvidence" ||
    Object.keys(chromeReference).join(",") !== "artifactSha256" ||
    typeof chromeReference.artifactSha256 !== "string" ||
    !SHA256.test(chromeReference.artifactSha256) ||
    typeof projection.projectionSha256 !== "string" ||
    projection.projectionSha256 !== canonicalSha256(unsigned)
  )
    throw new Error("V213_RELEASE_CERTIFICATION_PROJECTION_INVALID");
  return Object.freeze({
    projection,
    releaseIdentity,
    scope,
    gateFacts: Object.freeze(gateFacts),
    evidenceArtifacts: Object.freeze(evidenceArtifacts),
    validationDocuments: Object.freeze(validationDocuments),
    chromeArtifact,
  });
}

/** Transport-free current-run certification. A resumed authorized-but-unsettled call executes the
 * single exact readback query below and cannot project, verify anew, persist, or dispatch. */
export function createV213SqlReleaseCertifier(input: {
  readonly database: TransactionalSqlExecutor;
  readonly evidenceSigningKey: Uint8Array;
  readonly now: () => Date;
  readonly certifyFromCurrentRun?: typeof certifyV213ReleaseFromCurrentRun;
}) {
  const dependencies = createV213SqlJitDependencies({
    database: input.database,
    evidenceSigningKey: input.evidenceSigningKey,
  });
  return async (
    request: V213SqlReleaseCertificationRequest,
  ): Promise<V213FinalReleaseCertificationResult> => {
    if (
      !request.fullLiveAuthorityId ||
      !request.workId ||
      !SHA256.test(request.outerStateSha256) ||
      request.providerDispatchForbidden !== true
    )
      throw new Error("V213_RELEASE_CERTIFICATION_REQUEST_INVALID");
    const predecessors = exactCertificationPredecessors(request.predecessorEvidenceSha256s);
    const identitySha256 = certificationIdentitySha256(request);
    const recovery =
      request.resumed === true &&
      request.authorizedUnsettled === true &&
      request.reconciliationOnly === true &&
      request.persistenceForbidden === true &&
      request.dispatchForbidden === true;
    const initial =
      request.resumed === false &&
      request.authorizedUnsettled === false &&
      request.reconciliationOnly === false &&
      request.persistenceForbidden === false &&
      request.dispatchForbidden === false;
    if (!initial && !recovery) throw new Error("V213_RELEASE_CERTIFICATION_MODE_INVALID");
    const readbackInput = {
      fullLiveAuthorityId: request.fullLiveAuthorityId,
      workId: request.workId,
      outerStateSha256: request.outerStateSha256,
      certificationIdentitySha256: identitySha256,
      predecessorEvidenceSha256s: predecessors,
    };
    if (recovery) {
      const existing = await queryValue(
        input.database,
        "SELECT public.videoforge_read_v213_release_certification($1::jsonb) AS value",
        readbackInput,
      );
      return exactFinalCertificationResult(existing, predecessors);
    }
    const projected = exactReleaseCertificationProjection(
      await queryValue(
        input.database,
        "SELECT public.videoforge_project_v213_release_certification($1::jsonb) AS value",
        readbackInput,
      ),
      request,
      identitySha256,
    );
    const evaluatedAt = input.now().toISOString();
    const preflightLedger = await buildV213ReleaseCertificationLedger({
      releaseIdentity: projected.releaseIdentity,
      evidenceArtifacts: projected.evidenceArtifacts,
      verifier: {
        verify: async (artifact) => projected.validationDocuments[artifact.gate],
      },
      evaluatedAt,
    });
    if (
      preflightLedger.releaseStatus !== "release_certified" ||
      preflightLedger.reusableGates.length !== V213_RELEASE_GATES.length ||
      preflightLedger.missingGates.length !== 0 ||
      preflightLedger.invalidGates.length !== 0
    )
      throw new Error("V213_RELEASE_CERTIFICATION_FACTS_INVALID");
    for (const gate of V213_RELEASE_GATES) {
      const artifact = projected.evidenceArtifacts[gate];
      const fact = projected.gateFacts[gate];
      const artifactSha256 = artifact.evidence.artifactSha256;
      if (typeof artifactSha256 !== "string" || !SHA256.test(artifactSha256))
        throw new Error("V213_RELEASE_CERTIFICATION_ARTIFACT_INVALID");
      const exactArtifactSha256 = artifactSha256 as Sha256;
      const verifierSignatureSha256 = await dependencies.evidence.releaseVerifierSignatureSha256(
        exactArtifactSha256,
        {
          schemaVersion: "videoforge.v213-release-evidence-verifier-signature/v1",
          fullLiveAuthorityId: request.fullLiveAuthorityId,
          certificationIdentitySha256: identitySha256,
          releaseIdentitySha256: hashV213ReleaseIdentity(projected.releaseIdentity),
          artifactSha256: exactArtifactSha256,
          fact,
        },
      );
      const document = buildV213VerifiedReleaseEvidence({
        releaseIdentity: projected.releaseIdentity,
        artifact,
        fact,
        verifierSignatureSha256,
      });
      const stored = await dependencies.evidence.signAndStore(
        "RELEASE",
        document as unknown as Readonly<Record<string, unknown>>,
        exactArtifactSha256,
      );
      if (stored.artifactSha256 !== exactArtifactSha256)
        throw new Error("V213_RELEASE_CERTIFICATION_EVIDENCE_STORE_INVALID");
    }
    const certification = await (input.certifyFromCurrentRun ?? certifyV213ReleaseFromCurrentRun)({
      releaseIdentity: projected.releaseIdentity,
      scope: projected.scope as unknown as Parameters<
        typeof certifyV213ReleaseFromCurrentRun
      >[0]["scope"],
      sourceCommit: projected.projection.sourceCommit as string,
      predecessorEvidenceSha256s: predecessors,
      evidenceArtifacts: projected.evidenceArtifacts,
      chromeArtifact: projected.chromeArtifact as unknown as Parameters<
        typeof certifyV213ReleaseFromCurrentRun
      >[0]["chromeArtifact"],
      releaseEvidenceVerifier: dependencies.releaseEvidenceVerifier,
      chromeVerifier: dependencies.chromeVerifier,
      now: input.now,
    });
    const result = exactFinalCertificationResult(
      {
        schemaVersion: "videoforge.v213-final-release-certification-result/v1",
        actualUsd: 0,
        externalSpendUsd: 0,
        gpuUse: false,
        providerMutationPerformed: false,
        currentRunEvidence: true,
        certified: true,
        releaseStatus: certification.ledger.releaseStatus,
        gateCount: certification.ledger.reusableGates.length,
        missingGateCount: certification.ledger.missingGates.length,
        invalidGateCount: certification.ledger.invalidGates.length,
        liveReleaseAuthorized: certification.ledger.liveReleaseAuthorized,
        requiresExplicitReleaseAuthority: certification.ledger.requiresExplicitReleaseAuthority,
        releaseIdentitySha256: certification.ledger.releaseIdentitySha256,
        ledgerSha256: certification.ledger.ledgerSha256,
        evidenceSha256: certification.ledger.ledgerSha256,
        predecessorEvidenceSha256s: predecessors,
      },
      predecessors,
    );
    const persisted = await queryValue(
      input.database,
      "SELECT public.videoforge_persist_v213_release_certification($1::jsonb) AS value",
      {
        ...readbackInput,
        projectionSha256: projected.projection.projectionSha256,
        resultSha256: canonicalSha256(result),
        result,
      },
    );
    if (persisted !== result.ledgerSha256)
      throw new Error("V213_RELEASE_CERTIFICATION_PERSIST_REJECTED");
    const readback = exactFinalCertificationResult(
      await queryValue(
        input.database,
        "SELECT public.videoforge_read_v213_release_certification($1::jsonb) AS value",
        readbackInput,
      ),
      predecessors,
    );
    if (canonicalSha256(readback) !== canonicalSha256(result))
      throw new Error("V213_RELEASE_CERTIFICATION_READBACK_DRIFT");
    return readback;
  };
}

export type V213DatabaseOwnedAcceptanceCall = Readonly<{
  readonly fullLiveAuthorityId: string;
}> &
  (
    | {
        readonly checkpoint: "V2-10";
        readonly call: Omit<V210LiveAcceptanceCall, "repository" | "outputVerifier">;
      }
    | {
        readonly checkpoint: "V2-11";
        readonly call: Omit<V211LiveAcceptanceCall, "evidenceVerifier">;
      }
    | {
        readonly checkpoint: "V2-12";
        readonly call: Omit<V212LiveAcceptanceCall, "repository" | "outputVerifier">;
      }
    | { readonly checkpoint: "V2-13"; readonly call: V213FinalLiveAcceptanceCall }
  );

export function createV213SqlBridgeCallLoader(database: TransactionalSqlExecutor) {
  return async (request: V213FullLiveCommandRequest): Promise<V213DatabaseOwnedAcceptanceCall> => {
    const bridgeInput = request.input;
    if (
      !bridgeInput ||
      typeof bridgeInput !== "object" ||
      Array.isArray(bridgeInput) ||
      Object.keys(bridgeInput).sort().join(",") !== "outerStateSha256,requestSha256" ||
      !("requestSha256" in bridgeInput) ||
      typeof bridgeInput.requestSha256 !== "string" ||
      !SHA256.test(bridgeInput.requestSha256) ||
      !("outerStateSha256" in bridgeInput) ||
      typeof bridgeInput.outerStateSha256 !== "string" ||
      !SHA256.test(bridgeInput.outerStateSha256)
    )
      throw new Error("V213_BRIDGE_ACCEPTANCE_IDENTITY_INVALID");
    const value = (await queryValue(
      database,
      "SELECT public.videoforge_load_v213_bridge_acceptance_call($1::jsonb) AS value",
      {
        commandId: request.commandId,
        stageAuthorityId: request.stageAuthorityId,
        command: request.command,
        requestSha256: bridgeInput.requestSha256,
        outerStateSha256: bridgeInput.outerStateSha256,
      },
    )) as Record<string, unknown> | null;
    if (
      !value ||
      !["V2-10", "V2-11", "V2-12", "V2-13"].includes(String(value.checkpoint)) ||
      typeof value.fullLiveAuthorityId !== "string" ||
      value.fullLiveAuthorityId.length === 0 ||
      !value.call ||
      typeof value.call !== "object" ||
      Array.isArray(value.call)
    )
      throw new Error("V213_BRIDGE_ACCEPTANCE_CALL_UNAVAILABLE");
    return {
      checkpoint: value.checkpoint,
      fullLiveAuthorityId: value.fullLiveAuthorityId,
      call: value.call,
    } as V213DatabaseOwnedAcceptanceCall;
  };
}

/** Builds the four exact bridge handlers. The loader must return a DB-owned call, never request.input. */
export function createV213AcceptanceBridgeHandlers(input: {
  readonly factory: ReturnType<typeof createV213HostedAcceptanceProductionFactory>;
  loadDatabaseCall(request: V213FullLiveCommandRequest): Promise<V213DatabaseOwnedAcceptanceCall>;
}) {
  const handler =
    (checkpoint: V213DatabaseOwnedAcceptanceCall["checkpoint"]): V213FullLiveCommandHandler =>
    async (request) => {
      const loaded = await input.loadDatabaseCall(request);
      if (loaded.checkpoint !== checkpoint) throw new Error("V213_DATABASE_ACCEPTANCE_CALL_DRIFT");
      const result =
        loaded.checkpoint === "V2-10"
          ? await input.factory.acceptance.executeV210({
              ...loaded.call,
              repository: input.factory.shortPilotRepository,
              outputVerifier: input.factory.shortPilotOutputVerifier,
            })
          : loaded.checkpoint === "V2-11"
            ? await input.factory.acceptance.executeV211({
                ...loaded.call,
                evidenceVerifier: input.factory.v211EvidenceVerifier,
              })
            : loaded.checkpoint === "V2-12"
              ? await input.factory.acceptance.executeV212({
                  ...loaded.call,
                  repository: input.factory.productionLengthRepository,
                  outputVerifier: input.factory.productionLengthOutputVerifier,
                })
              : await input.factory.acceptance.executeV213(loaded.call);
      if (loaded.checkpoint === "V2-13") {
        if (!("releaseChromeOutput" in result))
          throw new Error("V213_DATABASE_ACCEPTANCE_CALL_DRIFT");
        const releaseChromeOutput = result.releaseChromeOutput;
        const smoke = Object.freeze({
          schemaVersion: "videoforge.v213-fresh-two-lane-smoke-result/v1",
          smokeOnly: true,
          releaseCertified: false,
          twoLaneSmoke: true,
          fullLiveAuthorityId: loaded.fullLiveAuthorityId,
          scope: releaseChromeOutput.scope,
          outputSha256: releaseChromeOutput.outputSha256,
          finalOutputReceiptSha256: releaseChromeOutput.finalOutputReceiptSha256,
          smokeTerminalAt: releaseChromeOutput.smokeTerminalAt,
          summary: result.summary,
          completionSha256: result.completionSha256,
        });
        const signed = await input.factory.evidence.signAndStore("RELEASE", smoke);
        return {
          evidenceSha256: signed.artifactSha256,
          summary: {
            ...result.summary,
            schemaVersion: smoke.schemaVersion,
            smokeOnly: true,
            releaseCertified: false,
            twoLaneSmoke: true,
            evidenceSha256: signed.artifactSha256,
            signedSmokeEvidenceSha256: signed.artifactSha256,
          } as never,
        };
      }
      return { evidenceSha256: result.summary.evidenceSha256, summary: result.summary as never };
    };
  return Object.freeze({
    "v2-10-operator-free-ranga-pilot": handler("V2-10"),
    "v2-11-two-concurrent-owned-projects": handler("V2-11"),
    "v2-12-long-output": handler("V2-12"),
    "v2-13-final-two-lane-smoke": handler("V2-13"),
  });
}
