import type { TransactionalSqlExecutor } from "@videoforge/control-plane";
import {
  canonicalizeJsonToUtf8,
  sha256CanonicalJson,
  validateAndHashContractDocument,
  type JsonValue,
  type ServerlessWorkerJobEnvelopeV3Document,
} from "@videoforge/contracts";

import { type HostedEnvelopePairSigner } from "./hosted-envelope-signer";
import {
  HostedPairRuntimeExecutor,
  type HostedPairExecutionResult,
  type HostedPairInspection,
  type HostedPairLane,
  type HostedPairRuntimeStore,
  type HostedSignedEnvelopeVerifier,
  type HostedSignedPairEnvelope,
} from "./hosted-pair-runtime-executor";
import { HostedDispatchCoordinationError } from "./hosted-serverless-dispatch-coordinator";

const SHA256 = /^sha256:[0-9a-f]{64}$/u;
const BINDING_ID = /^[A-Za-z][A-Za-z0-9._:-]{2,159}$/u;
const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED", "TIMED_OUT", "ABSENT"]);

export const HOSTED_PAIR_REQUIRED_MIGRATIONS = Object.freeze([
  [37, "sha256:e21a04350d2685f231bbfa8ac9a1109a22194ab0e227d49a9dfa4c68d84aa9ef"],
  [38, "sha256:de64f32ab2b07d9e3448e29f466ea6a26e48f507cab12800abc2efd7393afe00"],
  [39, "sha256:1b602747e8a5ed91c76d1a602d5b7be87a6139cdcf862dd7da10fd9f45238637"],
  [40, "sha256:9e7cbbecd515c8781f66a6888d1283abeb2e91baee4f61d6ad1857775a67c1a3"],
  [41, "sha256:24f161e5c441f7cfa6b7837d185e64b3eae182d729c8ef21ef6850aeec9bcf84"],
  [42, "sha256:d7168a4143a813df7b9114f76f1efe71aa287bec4b1f137ab414a98e65e6b967"],
  [43, "sha256:590386f350c606da0be673376d14a9609df5f221268b2a932d4e00d608b2b927"],
  [44, "sha256:8ab2a30c7df970531e521fac0662f666ef2689a908057fa4525a623c11622a6f"],
  [45, "sha256:352169e1e34e23bc36b2a3c1fb653747194fe0b560894bfdbfafb30d635561d7"],
] as const);

export interface HostedPairProductionBindingEnvironment {
  readonly VIDEOFORGE_GPU_TRANSPORT?: string;
  readonly DATABASE_URL?: string;
  readonly VIDEOFORGE_RECONCILER_DATABASE_URL?: string;
  readonly VIDEOFORGE_DISPATCH_TOKEN_KEY?: string;
  readonly VIDEOFORGE_DISPATCH_TOKEN_KEY_ID?: string;
  readonly VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX?: string;
  readonly VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID?: string;
  readonly VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY?: string;
  readonly VIDEOFORGE_PROVIDER_PROOF_KEY_ID?: string;
  readonly RUNPOD_API_KEY?: string;
  readonly RUNPOD_API_BASE_URL?: string;
  readonly VIDEOFORGE_MAGE_ENDPOINT_ID?: string;
  readonly VIDEOFORGE_MAGE_ENDPOINT_ID_SHA256?: string;
  readonly VIDEOFORGE_SOULX_ENDPOINT_ID?: string;
  readonly VIDEOFORGE_SOULX_ENDPOINT_ID_SHA256?: string;
  readonly VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN?: string;
}

/** The deployed production config is intentionally disabled, so this function returns before
 * touching any secret binding. It is the only current Worker/Workflow composition wiring. */
export function hostedPairProductionBindingState(
  environment: HostedPairProductionBindingEnvironment,
): { readonly state: "DISABLED_UNQUALIFIED" } | { readonly state: "BINDINGS_PRESENT" } {
  if (environment.VIDEOFORGE_GPU_TRANSPORT !== "QUALIFIED_EXACT")
    return Object.freeze({ state: "DISABLED_UNQUALIFIED" as const });
  const present = [
    environment.DATABASE_URL,
    environment.VIDEOFORGE_RECONCILER_DATABASE_URL,
    environment.VIDEOFORGE_DISPATCH_TOKEN_KEY,
    environment.VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX,
    environment.VIDEOFORGE_ENVELOPE_SIGNING_KEY_ID,
    environment.VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY,
    environment.VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN,
  ].every((value) => typeof value === "string" && value.length >= 16);
  if (!present)
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_PRODUCTION_BINDINGS_MISSING");
  if (environment.DATABASE_URL === environment.VIDEOFORGE_RECONCILER_DATABASE_URL)
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_DATABASE_ROLES_NOT_SEPARATE");
  return Object.freeze({ state: "BINDINGS_PRESENT" as const });
}

export interface HostedPairProductionGateInput {
  readonly gpuTransport: "DISABLED_UNQUALIFIED" | "QUALIFIED_EXACT";
  readonly migrationLedger: readonly { readonly version: number; readonly sha256: string }[];
  readonly now: string;
  readonly qualifications: Readonly<
    Record<
      HostedPairLane,
      {
        readonly accepted: boolean;
        readonly verifiedAt: string;
        readonly expiresAt: string;
        readonly qualificationRecordSha256: string;
        readonly deploymentSnapshotSha256: string;
      }
    >
  >;
  readonly deployments: Readonly<
    Record<
      HostedPairLane,
      {
        readonly deploymentId: string;
        readonly endpointIdSha256: string;
        readonly endpointConfigSha256: string;
        readonly workerImageDigest: string;
        readonly modelManifestSha256: string;
        readonly volumeIdSha256: string;
        readonly volumeManifestSha256: string;
        readonly region: string;
        readonly gpuAllowlist: readonly string[];
        readonly deploymentSnapshotSha256: string;
        readonly authority: Readonly<Record<string, JsonValue>>;
      }
    >
  >;
  readonly paidApproval: {
    readonly approved: boolean;
    readonly exact: boolean;
    readonly expiresAt: string;
  };
  readonly cloudflare: {
    readonly sourceCommit: string;
    readonly versionIdSha256: string;
    readonly deployedConfigSha256: string;
    readonly readbackSha256: string;
    readonly observedAt: string;
  };
  /** These are public binding identities only. Raw credentials never enter this document. */
  readonly bindings: {
    readonly runtimeDatabase: string;
    readonly reconcilerDatabase: string;
    readonly dispatchTokenKey: string;
    readonly envelopeSignerKey: string;
    readonly providerProofVerifierKey: string;
    readonly workflowOperatorToken: string;
  };
}

export function evaluateHostedPairProductionGate(
  input: HostedPairProductionGateInput,
):
  | { readonly state: "READY" }
  | { readonly state: "DISABLED_UNQUALIFIED"; readonly reason: string } {
  const disabled = (reason: string) =>
    Object.freeze({ state: "DISABLED_UNQUALIFIED" as const, reason });
  if (input.gpuTransport !== "QUALIFIED_EXACT") return disabled("GPU_TRANSPORT_DISABLED");
  if (
    input.migrationLedger.length !== HOSTED_PAIR_REQUIRED_MIGRATIONS.length ||
    HOSTED_PAIR_REQUIRED_MIGRATIONS.some(
      ([version, sha256], index) =>
        input.migrationLedger[index]?.version !== version ||
        input.migrationLedger[index]?.sha256 !== sha256,
    )
  )
    return disabled("MIGRATION_LEDGER_0037_0045_INVALID");
  const now = Date.parse(input.now);
  if (!Number.isFinite(now)) return disabled("CLOCK_INVALID");
  for (const lane of ["mage_image", "soulx_avatar"] as const) {
    const qualification = input.qualifications[lane];
    const deployment = input.deployments[lane];
    const verifiedAt = Date.parse(qualification.verifiedAt);
    const expiresAt = Date.parse(qualification.expiresAt);
    const authority = deployment.authority;
    const authorityKeys = [
      "endpointConfigSha256",
      "endpointIdSha256",
      "gpuAllowlist",
      "modelManifestSha256",
      "region",
      "volumeIdSha256",
      "volumeManifestSha256",
      "workerImageDigest",
    ];
    if (
      !qualification.accepted ||
      !Number.isFinite(verifiedAt) ||
      !Number.isFinite(expiresAt) ||
      verifiedAt > now ||
      expiresAt <= now ||
      !SHA256.test(qualification.qualificationRecordSha256) ||
      qualification.deploymentSnapshotSha256 !== deployment.deploymentSnapshotSha256 ||
      ![
        deployment.endpointIdSha256,
        deployment.endpointConfigSha256,
        deployment.workerImageDigest,
        deployment.modelManifestSha256,
        deployment.volumeIdSha256,
        deployment.volumeManifestSha256,
        deployment.deploymentSnapshotSha256,
      ].every((value) => SHA256.test(value)) ||
      JSON.stringify(Object.keys(authority).sort()) !== JSON.stringify(authorityKeys) ||
      authority.endpointIdSha256 !== deployment.endpointIdSha256 ||
      authority.endpointConfigSha256 !== deployment.endpointConfigSha256 ||
      authority.workerImageDigest !== deployment.workerImageDigest ||
      authority.modelManifestSha256 !== deployment.modelManifestSha256 ||
      authority.volumeIdSha256 !== deployment.volumeIdSha256 ||
      authority.volumeManifestSha256 !== deployment.volumeManifestSha256 ||
      authority.region !== deployment.region ||
      JSON.stringify(authority.gpuAllowlist) !== JSON.stringify(deployment.gpuAllowlist) ||
      deployment.region !== "EU-RO-1" ||
      JSON.stringify(deployment.gpuAllowlist) !== JSON.stringify(["NVIDIA GeForce RTX 4090"])
    )
      return disabled(`QUALIFICATION_OR_DEPLOYMENT_INVALID:${lane}`);
  }
  const approvalExpiry = Date.parse(input.paidApproval.expiresAt);
  if (
    !input.paidApproval.approved ||
    !input.paidApproval.exact ||
    !Number.isFinite(approvalExpiry) ||
    approvalExpiry <= now
  )
    return disabled("PAID_APPROVAL_INVALID");
  if (
    !/^[0-9a-f]{40}$/u.test(input.cloudflare.sourceCommit) ||
    ![
      input.cloudflare.versionIdSha256,
      input.cloudflare.deployedConfigSha256,
      input.cloudflare.readbackSha256,
    ].every((value) => SHA256.test(value)) ||
    !Number.isFinite(Date.parse(input.cloudflare.observedAt)) ||
    Date.parse(input.cloudflare.observedAt) > now ||
    now - Date.parse(input.cloudflare.observedAt) > 5 * 60 * 1_000
  )
    return disabled("CLOUDFLARE_ACTIVATION_INVALID");
  const bindingIds = Object.values(input.bindings);
  if (bindingIds.some((value) => !BINDING_ID.test(value))) return disabled("BINDING_MISSING");
  if (input.bindings.runtimeDatabase === input.bindings.reconcilerDatabase)
    return disabled("DATABASE_ROLES_NOT_SEPARATE");
  if (
    new Set([
      input.bindings.dispatchTokenKey,
      input.bindings.envelopeSignerKey,
      input.bindings.providerProofVerifierKey,
      input.bindings.workflowOperatorToken,
    ]).size !== 4
  )
    return disabled("KEY_BINDINGS_NOT_SEPARATE");
  return Object.freeze({ state: "READY" as const });
}

export type HostedPairTrustedActivation = Omit<
  HostedPairProductionGateInput,
  "gpuTransport" | "bindings"
>;

export interface HostedPairActivationStore {
  load(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
  }): Promise<HostedPairTrustedActivation>;
}

/** Loads approval, attestation, complete sealed-deployment lineage, DB time, and migration ledger
 * through one SECURITY DEFINER read projection. Callers cannot supply or override these facts. */
export class HostedSqlPairActivationStore implements HostedPairActivationStore {
  constructor(private readonly runtimeDatabase: TransactionalSqlExecutor) {}
  async load(input: Parameters<HostedPairActivationStore["load"]>[0]) {
    return this.runtimeDatabase.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      const result = await transaction.query<{ snapshot: unknown } & Record<string, unknown>>(
        "SELECT public.videoforge_load_hosted_pair_activation_v2($1,$2,$3) AS snapshot",
        [input.accountId, input.workspaceId, input.generationRequestId],
      );
      const snapshot = result.rows[0]?.snapshot;
      if (result.rows.length !== 1 || typeof snapshot !== "object" || snapshot === null)
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_ACTIVATION_SNAPSHOT_INVALID");
      const value = snapshot as Record<string, unknown>;
      const lanes = value.lanes as Record<HostedPairLane, Record<string, unknown>> | undefined;
      if (!lanes?.mage_image || !lanes.soulx_avatar)
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_ACTIVATION_SNAPSHOT_INVALID");
      return Object.freeze({
        now: value.databaseNow,
        migrationLedger: value.migrationLedger,
        paidApproval: value.paidApproval,
        qualifications: Object.freeze({
          mage_image: lanes.mage_image.qualification,
          soulx_avatar: lanes.soulx_avatar.qualification,
        }),
        deployments: Object.freeze({
          mage_image: {
            ...(lanes.mage_image.deployment as Record<string, JsonValue>),
            authority: lanes.mage_image.authority,
          },
          soulx_avatar: {
            ...(lanes.soulx_avatar.deployment as Record<string, JsonValue>),
            authority: lanes.soulx_avatar.authority,
          },
        }),
      }) as unknown as HostedPairTrustedActivation;
    });
  }
}

export interface HostedPairReconstructionStore {
  reconstruct(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly dispatchTokenKey: string;
  }): Promise<
    readonly [
      {
        readonly claim: Awaited<ReturnType<HostedPairRuntimeStore["prepare"]>>[0];
        readonly body: JsonValue;
      },
      {
        readonly claim: Awaited<ReturnType<HostedPairRuntimeStore["prepare"]>>[1];
        readonly body: JsonValue;
      },
    ]
  >;
}

type ReconstructionRow = {
  lane: HostedPairLane;
  attempt_id: string;
  dispatch_token: string;
  dispatch_token_sha256: `sha256:${string}`;
  endpoint_id_sha256: `sha256:${string}`;
  request_body_sha256: `sha256:${string}`;
  deployment_id: string;
  expected_envelope_sha256: `sha256:${string}`;
  attempt_state?: string;
  outbox_state?: string;
  provider_job_id?: string | null;
  envelope_template: JsonValue;
} & Record<string, unknown>;

/** Rebuilds the tokenized 0042 body from immutable 0041 payload plus the 0042 encrypted token.
 * The dedicated runtime DB role can read the tenant batch and invoke prepare, but cannot settle. */
export class HostedSqlPairReconstructionStore implements HostedPairReconstructionStore {
  constructor(private readonly database: TransactionalSqlExecutor) {}

  async reconstruct(input: Parameters<HostedPairReconstructionStore["reconstruct"]>[0]) {
    return this.database.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.dispatch_token_key",
        input.dispatchTokenKey,
      ]);
      const result = await transaction.query<ReconstructionRow>(
        "SELECT * FROM public.videoforge_prepare_hosted_pair_send($1,$2,$3)",
        [input.accountId, input.workspaceId, input.generationRequestId],
      );
      if (
        result.rows.length !== 2 ||
        result.rows[0]?.lane !== "mage_image" ||
        result.rows[1]?.lane !== "soulx_avatar"
      )
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_RECONSTRUCTION_INVALID");
      const rebuilt = await Promise.all(
        result.rows.map(async (row) => {
          if (
            typeof row.envelope_template !== "object" ||
            row.envelope_template === null ||
            Array.isArray(row.envelope_template)
          )
            throw new HostedDispatchCoordinationError("HOSTED_PAIR_RECONSTRUCTION_INVALID");
          const body = Object.freeze({
            ...(row.envelope_template as Record<string, JsonValue>),
            dispatch_token: row.dispatch_token,
          });
          if ((await sha256CanonicalJson(body)) !== row.expected_envelope_sha256)
            throw new HostedDispatchCoordinationError("HOSTED_PAIR_RECONSTRUCTION_HASH_DRIFT");
          return Object.freeze({
            claim: Object.freeze({
              lane: row.lane,
              attemptId: row.attempt_id,
              dispatchToken: row.dispatch_token,
              dispatchTokenSha256: row.dispatch_token_sha256,
              endpointIdSha256: row.endpoint_id_sha256,
              requestBodySha256: row.request_body_sha256,
              deploymentId: row.deployment_id,
              phase: "PREPARED",
              expectedEnvelopeSha256: row.expected_envelope_sha256,
              attemptState: row.attempt_state,
              outboxState: row.outbox_state,
              providerJobId: row.provider_job_id,
            }),
            body,
          });
        }),
      );
      return rebuilt as unknown as Awaited<
        ReturnType<HostedPairReconstructionStore["reconstruct"]>
      >;
    });
  }
}

async function signReconstructedPair(
  reconstructed: Awaited<ReturnType<HostedPairReconstructionStore["reconstruct"]>>,
  signer: HostedEnvelopePairSigner,
): Promise<readonly [HostedSignedPairEnvelope, HostedSignedPairEnvelope]> {
  const bodies = reconstructed.map(({ claim, body }) => ({ lane: claim.lane, body }));
  const signatures = await signer.signPair(bodies);
  if (!(await signer.verifyPair(bodies, signatures)) || signatures.length !== 2)
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_RESTART_SIGNATURE_INVALID");
  const envelopes = await Promise.all(
    reconstructed.map(async ({ claim, body }, index) => {
      const signature = signatures[index];
      if (
        signature?.lane !== claim.lane ||
        signature.authoritySha256 !== claim.expectedEnvelopeSha256
      )
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_RESTART_SIGNATURE_INVALID");
      const document = (
        await validateAndHashContractDocument("serverlessWorkerJobEnvelopeV3", {
          ...(body as Record<string, JsonValue>),
          authority_sha256: signature.authoritySha256,
          signature: signature.signature,
        })
      ).value;
      return Object.freeze({ lane: claim.lane, document });
    }),
  );
  return envelopes as unknown as readonly [HostedSignedPairEnvelope, HostedSignedPairEnvelope];
}

export function hostedPairDocumentVerifier(
  signer: HostedEnvelopePairSigner,
): HostedSignedEnvelopeVerifier {
  return Object.freeze({
    async verifyPair(envelopes: readonly [HostedSignedPairEnvelope, HostedSignedPairEnvelope]) {
      const bodies: { lane: HostedPairLane; body: JsonValue }[] = [];
      const expected: {
        lane: HostedPairLane;
        authoritySha256: string;
        algorithm: string;
        keyId: string;
        value: string;
      }[] = [];
      for (const envelope of envelopes) {
        const document = envelope.document as ServerlessWorkerJobEnvelopeV3Document;
        const { authority_sha256, signature, ...body } = document;
        bodies.push({ lane: envelope.lane, body });
        expected.push({
          lane: envelope.lane,
          authoritySha256: authority_sha256,
          algorithm: signature.algorithm,
          keyId: signature.key_id,
          value: signature.value,
        });
      }
      // Verify exact body signatures by deterministic re-signing through the bound key. The raw
      // binding and its key hash never enter the envelope or any result.
      const resigned = await signer.signPair(bodies);
      return (
        (await signer.verifyPair(bodies, resigned)) &&
        resigned.every(
          (item, index) =>
            item.lane === expected[index]?.lane &&
            item.authoritySha256 === expected[index]?.authoritySha256 &&
            item.signature.algorithm === expected[index]?.algorithm &&
            item.signature.key_id === expected[index]?.keyId &&
            item.signature.value === expected[index]?.value,
        )
      );
    },
  });
}

export class HostedPairProductionComposition {
  constructor(
    private readonly activation: HostedPairActivationStore,
    private readonly reconstruction: HostedPairReconstructionStore,
    private readonly runtime: HostedPairRuntimeExecutor,
    private readonly signer: HostedEnvelopePairSigner,
    private readonly inspection?: Pick<HostedPairRuntimeStore, "inspect">,
  ) {}

  async resume(input: {
    readonly environment: HostedPairProductionBindingEnvironment;
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly dispatchTokenKey: string;
  }): Promise<
    HostedPairExecutionResult | { readonly state: "DISABLED_UNQUALIFIED"; readonly reason: string }
  > {
    const bindingState = hostedPairProductionBindingState(input.environment);
    if (bindingState.state === "DISABLED_UNQUALIFIED")
      return Object.freeze({ state: "DISABLED_UNQUALIFIED", reason: "GPU_TRANSPORT_DISABLED" });
    const trusted = await this.activation.load(input);
    const gate = evaluateHostedPairProductionGate({
      ...trusted,
      gpuTransport: "QUALIFIED_EXACT",
      bindings: {
        runtimeDatabase: "DATABASE_URL",
        reconcilerDatabase: "VIDEOFORGE_RECONCILER_DATABASE_URL",
        dispatchTokenKey: "VIDEOFORGE_DISPATCH_TOKEN_KEY",
        envelopeSignerKey: "VIDEOFORGE_ENVELOPE_SIGNING_KEY_HEX",
        providerProofVerifierKey: "VIDEOFORGE_PROVIDER_PROOF_VERIFY_KEY",
        workflowOperatorToken: "VIDEOFORGE_V213_WORKFLOW_OPERATOR_TOKEN",
      },
    });
    if (gate.state !== "READY") return gate;
    if (this.inspection) {
      const rows = await this.inspection.inspect(input);
      if (
        rows.every(
          (row) => row.recoveryAction === "RECONCILE_ASSIGNED" && row.providerJobId !== null,
        )
      ) {
        return Object.freeze({
          state: "BOTH_ASSIGNED" as const,
          providerJobIds: Object.freeze([
            rows[0]!.providerJobId!,
            rows[1]!.providerJobId!,
          ]) as readonly [string, string],
        });
      }
      const sendable = rows.some((row) =>
        ["SEND_MAGE_ONLY", "SEND_SOULX_ONLY"].includes(row.recoveryAction),
      );
      const blocked = rows.find((row) => row.recoveryAction === "CLEANUP_ONLY");
      if (!sendable && blocked)
        return Object.freeze({
          state: "CLEANUP_ONLY" as const,
          lane: blocked.lane,
          reason: "DISPATCH_ACK_UNKNOWN" as const,
        });
    }
    const rebuilt = await this.reconstruction.reconstruct(input);
    const envelopes = await signReconstructedPair(rebuilt, this.signer);
    return this.runtime.execute({ ...input, envelopes });
  }
}

export interface HostedPairSettlementStore {
  settle(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly observations: JsonValue;
    readonly zeroWorkerProofs: JsonValue;
    readonly settlementCostGuard: JsonValue;
  }): Promise<void>;
}

/** This class must be constructed only with the separate reconciler DB credential. */
export class HostedSqlPairSettlementStore implements HostedPairSettlementStore {
  constructor(private readonly reconcilerDatabase: TransactionalSqlExecutor) {}
  async settle(input: Parameters<HostedPairSettlementStore["settle"]>[0]) {
    await this.reconcilerDatabase.transaction(async (transaction) => {
      await transaction.query("SELECT set_config($1,$2,true)", [
        "videoforge.account_id",
        input.accountId,
      ]);
      const result = await transaction.query(
        "SELECT * FROM public.videoforge_settle_hosted_pair_cleanup_v2($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)",
        [
          input.accountId,
          input.workspaceId,
          input.generationRequestId,
          JSON.stringify(input.observations),
          JSON.stringify(input.zeroWorkerProofs),
          JSON.stringify(input.settlementCostGuard),
        ],
      );
      if (result.rows.length !== 1)
        throw new HostedDispatchCoordinationError("HOSTED_PAIR_SETTLEMENT_INVALID");
    });
  }
}

export interface HostedProviderProofDocument {
  readonly schema_version: "videoforge-hosted-provider-proof/v1";
  readonly account_id: string;
  readonly workspace_id: string;
  readonly generation_request_id: string;
  readonly lane: HostedPairLane;
  readonly attempt_id: string;
  readonly deployment_id: string;
  readonly dispatch_token_sha256: string;
  readonly provider_job_id: string | null;
  readonly provider_state: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT" | "ABSENT";
  readonly observed_at: string;
  readonly nonce: string;
  readonly signature: {
    readonly algorithm: "HMAC-SHA256";
    readonly key_id: string;
    readonly value: string;
  };
}

export interface HostedProviderProofPort {
  acquire(
    input: Omit<
      HostedProviderProofDocument,
      "schema_version" | "provider_state" | "observed_at" | "nonce" | "signature"
    >,
  ): Promise<HostedProviderProofDocument>;
}
export interface HostedProviderProofVerifier {
  verify(proof: HostedProviderProofDocument): Promise<boolean>;
}

export interface HostedProviderObservationSource {
  observe(
    input: Omit<
      HostedProviderProofDocument,
      "schema_version" | "provider_state" | "observed_at" | "nonce" | "signature"
    >,
  ): Promise<{
    readonly providerState: HostedProviderProofDocument["provider_state"];
    readonly observedAt: string;
    readonly nonce: string;
  }>;
}

function proofHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function proofKey(secretHex: string) {
  if (!/^(?:[0-9a-f]{2}){32,}$/u.test(secretHex))
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_PROVIDER_PROOF_KEY_INVALID");
  const bytes = Uint8Array.from({ length: secretHex.length / 2 }, (_, index) =>
    Number.parseInt(secretHex.slice(index * 2, index * 2 + 2), 16),
  );
  return crypto.subtle.importKey("raw", bytes, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function unsignedProof(proof: HostedProviderProofDocument) {
  const value = { ...proof } as Record<string, JsonValue>;
  delete value.signature;
  return value;
}

/** Concrete scope-bound proof authority. Its key is a dedicated server-only binding and never
 * enters the document; the observation source owns bounded status/cancel acquisition, never run. */
export function createHostedHmacProviderProofAuthority(
  source: HostedProviderObservationSource,
  binding: { readonly secretHex: string; readonly keyId: string },
): HostedProviderProofPort & HostedProviderProofVerifier {
  if (!BINDING_ID.test(binding.keyId))
    throw new HostedDispatchCoordinationError("HOSTED_PAIR_PROVIDER_PROOF_KEY_INVALID");
  return Object.freeze({
    async acquire(input: Parameters<HostedProviderProofPort["acquire"]>[0]) {
      const observation = await source.observe(input);
      const unsigned = {
        schema_version: "videoforge-hosted-provider-proof/v1" as const,
        ...input,
        provider_state: observation.providerState,
        observed_at: observation.observedAt,
        nonce: observation.nonce,
      };
      const key = await proofKey(binding.secretHex);
      const value = proofHex(
        await crypto.subtle.sign("HMAC", key, canonicalizeJsonToUtf8(unsigned)),
      );
      return Object.freeze({
        ...unsigned,
        signature: Object.freeze({
          algorithm: "HMAC-SHA256" as const,
          key_id: binding.keyId,
          value,
        }),
      });
    },
    async verify(proof: HostedProviderProofDocument) {
      if (
        proof.signature.algorithm !== "HMAC-SHA256" ||
        proof.signature.key_id !== binding.keyId ||
        !/^[0-9a-f]{64}$/u.test(proof.signature.value)
      )
        return false;
      const signature = Uint8Array.from({ length: 32 }, (_, index) =>
        Number.parseInt(proof.signature.value.slice(index * 2, index * 2 + 2), 16),
      );
      return crypto.subtle.verify(
        "HMAC",
        await proofKey(binding.secretHex),
        signature,
        canonicalizeJsonToUtf8(unsignedProof(proof)),
      );
    },
  });
}

/** Separately privileged cleanup boundary. It cannot call `/run`; it accepts only a
 * cryptographically verified proof bound to the exact tenant, attempt, deployment, token and job. */
export class HostedPairProductionReconciler {
  constructor(
    private readonly inspection: Pick<HostedPairRuntimeStore, "inspect">,
    private readonly proofs: HostedProviderProofPort,
    private readonly proofVerifier: HostedProviderProofVerifier,
    private readonly settlement: HostedPairSettlementStore,
  ) {}

  async reconcile(input: {
    readonly accountId: string;
    readonly workspaceId: string;
    readonly generationRequestId: string;
    readonly zeroWorkerProofs?: JsonValue;
    readonly settlementCostGuard: JsonValue;
  }) {
    const rows = await this.inspection.inspect(input);
    const observations: JsonValue[] = [];
    for (const row of rows) observations.push(await this.#proof(input, row));
    await this.settlement.settle({
      ...input,
      observations,
      zeroWorkerProofs: input.zeroWorkerProofs ?? [],
      settlementCostGuard: input.settlementCostGuard,
    });
    return Object.freeze({ state: "SETTLED" as const });
  }

  async #proof(
    scope: {
      readonly accountId: string;
      readonly workspaceId: string;
      readonly generationRequestId: string;
    },
    row: HostedPairInspection,
  ): Promise<JsonValue> {
    const proof = await this.proofs.acquire({
      account_id: scope.accountId,
      workspace_id: scope.workspaceId,
      generation_request_id: scope.generationRequestId,
      lane: row.lane,
      attempt_id: row.attemptId,
      deployment_id: row.deploymentId,
      dispatch_token_sha256: row.dispatchTokenSha256,
      provider_job_id: row.providerJobId,
    });
    const expected = {
      account_id: scope.accountId,
      workspace_id: scope.workspaceId,
      generation_request_id: scope.generationRequestId,
      lane: row.lane,
      attempt_id: row.attemptId,
      deployment_id: row.deploymentId,
      dispatch_token_sha256: row.dispatchTokenSha256,
      provider_job_id: row.providerJobId,
    };
    if (
      proof.schema_version !== "videoforge-hosted-provider-proof/v1" ||
      Object.entries(expected).some(([key, value]) => proof[key as keyof typeof proof] !== value) ||
      !TERMINAL.has(proof.provider_state) ||
      (row.providerJobId === null) !== (proof.provider_state === "ABSENT") ||
      !Number.isFinite(Date.parse(proof.observed_at)) ||
      !/^[A-Za-z0-9_-]{16,160}$/u.test(proof.nonce) ||
      !(await this.proofVerifier.verify(proof))
    )
      throw new HostedDispatchCoordinationError("HOSTED_PAIR_PROVIDER_PROOF_INVALID");
    const base = {
      lane: row.lane,
      attempt_id: row.attemptId,
      deployment_id: row.deploymentId,
      dispatch_token_sha256: row.dispatchTokenSha256,
      provider_job_id: row.providerJobId,
      provider_state: proof.provider_state,
    };
    return Object.freeze({
      ...base,
      provider_proof_sha256: await sha256CanonicalJson(base),
      observed_at: proof.observed_at,
    });
  }
}
