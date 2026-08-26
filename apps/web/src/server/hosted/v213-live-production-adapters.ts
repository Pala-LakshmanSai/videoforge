import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import { canonicalSha256, type Sha256 } from "@videoforge/control-plane";

import type {
  HostedProductionLengthAdmissionDocument,
  HostedProductionLengthKey,
  HostedProductionLengthRecord,
  HostedProductionLengthRepository,
  HostedProductionOutputVerifier,
} from "../runtime/hosted-production-length-acceptance.js";
import type {
  HostedShortPilotAdmissionDocument,
  HostedShortPilotDurableKey,
  HostedShortPilotDurableRecord,
  HostedShortPilotRepository,
  HostedShortPilotOutputVerifier,
} from "../runtime/hosted-short-pilot.js";
import type { HostedV211EvidenceVerifier } from "../runtime/hosted-v211-acceptance-coordinator.js";
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
import { createV213LiveAcceptanceAdapter } from "../runtime/v213-live-acceptance.js";
import type {
  V213ReleaseEvidenceArtifact,
  V213ReleaseEvidenceVerifier,
  V213VerifiedReleaseEvidence,
} from "../runtime/v213-release-certification.js";
import type {
  V213FullLiveCommandHandler,
  V213FullLiveCommandRequest,
} from "../providers/v213-full-live-cli.js";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const SIGNATURE = /^[0-9a-f]{64}$/u;
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

  async loadAndVerify(kind: EvidenceKind, reference: unknown): Promise<StoredEvidence> {
    const { artifactSha256 } = artifactReference(reference);
    const stored = (await queryValue(
      this.database,
      "SELECT public.videoforge_load_v213_signed_evidence($1::jsonb) AS value",
      { kind, artifactSha256 },
    )) as StoredEvidence | null;
    if (
      !stored ||
      stored.kind !== kind ||
      stored.artifactSha256 !== artifactSha256 ||
      stored.keyId !== this.keyId ||
      !SIGNATURE.test(stored.signatureHex) ||
      stored.signatureHex !==
        (await hmac(this.signingKey, evidencePreimage(kind, artifactSha256, stored.document)))
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
  const store = new V213SqlAttemptStore(input.database);
  return Object.freeze({
    acceptance: createV213LiveAcceptanceAdapter({
      store,
      transport: input.transport,
      receiptVerifier,
      cleanupVerifier,
      now: input.now,
    }),
    store,
    evidence,
    receiptVerifier,
    cleanupVerifier,
    chromeVerifier,
    releaseEvidenceVerifier,
    shortPilotOutputVerifier,
    v211EvidenceVerifier,
    productionLengthOutputVerifier,
    shortPilotRepository: new V213SqlShortPilotRepository(input.database),
    productionLengthRepository: new V213SqlProductionLengthRepository(input.database),
  });
}

export type V213DatabaseOwnedAcceptanceCall =
  | { readonly checkpoint: "V2-10"; readonly call: V210LiveAcceptanceCall }
  | { readonly checkpoint: "V2-11"; readonly call: V211LiveAcceptanceCall }
  | { readonly checkpoint: "V2-12"; readonly call: V212LiveAcceptanceCall }
  | { readonly checkpoint: "V2-13"; readonly call: V213FinalLiveAcceptanceCall };

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
      !value.call ||
      typeof value.call !== "object" ||
      Array.isArray(value.call)
    )
      throw new Error("V213_BRIDGE_ACCEPTANCE_CALL_UNAVAILABLE");
    return { checkpoint: value.checkpoint, call: value.call } as V213DatabaseOwnedAcceptanceCall;
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
          ? await input.factory.acceptance.executeV210(loaded.call)
          : loaded.checkpoint === "V2-11"
            ? await input.factory.acceptance.executeV211(loaded.call)
            : loaded.checkpoint === "V2-12"
              ? await input.factory.acceptance.executeV212(loaded.call)
              : await input.factory.acceptance.executeV213(loaded.call);
      return { evidenceSha256: result.summary.evidenceSha256, summary: result.summary as never };
    };
  return Object.freeze({
    "v2-10-operator-free-ranga-pilot": handler("V2-10"),
    "v2-11-two-concurrent-owned-projects": handler("V2-11"),
    "v2-12-long-output": handler("V2-12"),
    "v2-13-final-two-lane-smoke": handler("V2-13"),
  });
}
