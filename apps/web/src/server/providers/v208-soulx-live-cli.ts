import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { ProvenanceReceiptSigner } from "@videoforge/control-plane";
import { canonicalizeJson, type JsonValue } from "@videoforge/contracts";

import { loadSujalRunPodApiKeyFromKeychain } from "./keychain.js";
import { assertSujalRunPodAccount } from "./runpod-account.js";
import { RunPodControlClient, RunPodDrainGuard, RunPodServerlessJobClient } from "./runpod-control.js";
import { fetchCp07Catalog, findCp07Offering } from "./runpod-echo-cp07-preflight.js";
import { runV208SoulXWithV213Transport } from "./v208-soulx-orchestrator.js";
import {
  buildV208SoulXQualificationPlan,
  parseV208SoulXAuthority,
  V208_APPROVED_AUTHORITY_SHA256,
  V208_APPROVED_BILLING_BASELINE_USD,
  V208_APPROVED_CUMULATIVE_BILLING_STOP_THRESHOLD_USD,
  V208_APPROVED_FINITE_CAP_USD,
  V208_APPROVED_IMAGE,
  V208_APPROVED_IMAGE_SOURCE_COMMIT,
  V208_APPROVED_REQUIRED_AVAILABILITY,
  V208_APPROVED_RUNPOD_ACCOUNT_ID_SHA256,
  V208_EXECUTION_ENTRYPOINT,
  V208_PENDING_PROPOSAL_SHA256,
  V208_V207_ATTEMPT85_CLOSURE_SHA256,
  type V208SoulXQualificationResult,
} from "./v208-soulx-qualification.js";
import { createV208SoulXReceiptVerifier, probeV208Mp4Bytes } from "./v208-soulx-receipt-verifier.js";
import {
  V213_SERVERLESS_FLEX_RATE_SOURCE,
  readEndpointBilling,
  v213WorkerEnvironmentSecrets,
  validateV213ProductionInputShape,
  type V213ProductionSecrets,
} from "./v213-full-live-cli.js";
import {
  createV208FileDurableStageStore,
  type V208FileDurableStageStore,
} from "./v208-file-durable-stage-store.js";
import { createV208DirectWholeSpanQualificationAdapter } from "./v213-direct-qualification-materializer.js";
import type { V213DualLaneInput } from "./v213-dual-lane-live.js";
import {
  createV213RunPodDualLaneTransport,
  type V213CleanupStageRead,
  type V213RunPodDualLaneTransport,
} from "./v213-runpod-dual-lane-transport.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const COMMAND_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u;
const HEX_KEY = /^(?:[0-9a-f]{2}){32,}$/u;
const V208_REQUEST_SCHEMA = "videoforge.v2-08-soulx-live-request/v1" as const;
const V208_PROTECTED_INPUT_ENVIRONMENT = Object.freeze({
  journalDirectory: "V208_DURABLE_JOURNAL_DIRECTORY",
  requestFd: "V208_REQUEST_FD",
  productionSecretsFd: "V208_PRODUCTION_SECRETS_FD",
  r2AccountIdFd: "V208_R2_ACCOUNT_ID_FD",
  r2AccessKeyIdFd: "V208_R2_ACCESS_KEY_ID_FD",
  r2SecretAccessKeyFd: "V208_R2_SECRET_ACCESS_KEY_FD",
  r2BucketNameFd: "V208_R2_BUCKET_NAME_FD",
  avatarSourceFd: "V208_QUALIFICATION_AVATAR_SOURCE_FD",
  audio2sFd: "V208_QUALIFICATION_AUDIO_2S_FD",
  audio4sFd: "V208_QUALIFICATION_AUDIO_4S_FD",
  audio6sFd: "V208_QUALIFICATION_AUDIO_6S_FD",
  audio10sFd: "V208_QUALIFICATION_AUDIO_10S_FD",
} as const);
const V208_PROTECTED_INPUT_ENVIRONMENT_NAMES: Set<string> = new Set(
  Object.values(V208_PROTECTED_INPUT_ENVIRONMENT),
);
export const V208_SOULX_LIVE_CLI_CONFIRMATION = "EXECUTE_EXACT_V2_08_SOULX_QUALIFICATION";

export interface V208SoulXLiveRequest {
  readonly schema_version: typeof V208_REQUEST_SCHEMA;
  readonly command: "soulx-live-qualification";
  readonly request_id: string;
  readonly input: JsonValue;
  readonly r2: Readonly<{ readonly account_id: string; readonly bucket_name: string }>;
}

export interface V208ProtectedInputs {
  readonly request: V208SoulXLiveRequest;
  readonly runpodApiKey: string;
  readonly productionSecrets: V213ProductionSecrets;
  readonly productionSecretsRaw: string;
  readonly journalDirectory: string;
  readonly qualification: Readonly<{
    readonly r2: Readonly<{
      readonly accountId: string;
      readonly bucketName: string;
      readonly accessKeyId: string;
      readonly secretAccessKey: string;
    }>;
    readonly sourceBytes: Readonly<{
      readonly avatarSource: Uint8Array<ArrayBuffer>;
      readonly soulx2s: Uint8Array<ArrayBuffer>;
      readonly soulx4s: Uint8Array<ArrayBuffer>;
      readonly soulx6s: Uint8Array<ArrayBuffer>;
      readonly soulx10s: Uint8Array<ArrayBuffer>;
    }>;
  }>;
}

type ProductionInput = Readonly<{
  outerStateSha256: `sha256:${string}`;
  fullLiveAuthorityId: string;
  dualLaneInput: Omit<V213DualLaneInput, "receiptSigner" | "stageAuthorityPublicKeyPem">;
}>;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hashCanonical(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256")
    .update(canonicalizeJson(value as JsonValue), "utf8")
    .digest("hex")}`;
}

function localAuthorityUuid(request: V208SoulXLiveRequest, authoritySha256: string): string {
  const digest = createHash("sha256")
    .update(`${authoritySha256}:${request.request_id}:${canonicalizeJson(request.input)}`, "utf8")
    .digest("hex");
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-8${digest.slice(
    17,
    20,
  )}-${digest.slice(20, 32)}`;
}

function authorityEnvironment(environment: Readonly<Record<string, string | undefined>>) {
  return {
    ...environment,
    V208_EXECUTION_ENTRYPOINT: environment.V208_EXECUTION_ENTRYPOINT ?? V208_EXECUTION_ENTRYPOINT,
    V208_PROPOSAL_SHA256: environment.V208_PROPOSAL_SHA256 ?? V208_PENDING_PROPOSAL_SHA256 ?? "",
    V208_AUTHORITY_SHA256: environment.V208_AUTHORITY_SHA256 ?? V208_APPROVED_AUTHORITY_SHA256 ?? "",
    V208_IMAGE: environment.V208_IMAGE ?? V208_APPROVED_IMAGE ?? "",
    V208_IMAGE_SOURCE_COMMIT:
      environment.V208_IMAGE_SOURCE_COMMIT ?? V208_APPROVED_IMAGE_SOURCE_COMMIT ?? "",
    V208_RUNPOD_ACCOUNT_ID_SHA256:
      environment.V208_RUNPOD_ACCOUNT_ID_SHA256 ?? V208_APPROVED_RUNPOD_ACCOUNT_ID_SHA256 ?? "",
    V208_REQUIRED_AVAILABILITY:
      environment.V208_REQUIRED_AVAILABILITY ?? V208_APPROVED_REQUIRED_AVAILABILITY ?? "",
    V208_PREDECESSOR_CLOSURE_SHA256:
      environment.V208_PREDECESSOR_CLOSURE_SHA256 ?? V208_V207_ATTEMPT85_CLOSURE_SHA256,
    V208_FINITE_CAP_USD:
      environment.V208_FINITE_CAP_USD ??
      (V208_APPROVED_FINITE_CAP_USD === null ? "" : String(V208_APPROVED_FINITE_CAP_USD)),
    V208_BILLING_BASELINE_USD:
      environment.V208_BILLING_BASELINE_USD ??
      (V208_APPROVED_BILLING_BASELINE_USD === null ? "" : String(V208_APPROVED_BILLING_BASELINE_USD)),
    V208_CUMULATIVE_BILLING_STOP_THRESHOLD_USD:
      environment.V208_CUMULATIVE_BILLING_STOP_THRESHOLD_USD ??
      (V208_APPROVED_CUMULATIVE_BILLING_STOP_THRESHOLD_USD === null
        ? ""
        : String(V208_APPROVED_CUMULATIVE_BILLING_STOP_THRESHOLD_USD)),
  };
}

function productionInput(
  inputs: V208ProtectedInputs,
  authoritySha256: string,
): ProductionInput {
  if (inputs.request.command !== "soulx-live-qualification")
    throw new Error("V208_V213_COMMAND_INVALID");
  const raw = object(inputs.request.input);
  const dualLaneInput = object(raw?.dualLaneInput);
  const qualificationR2 = object(dualLaneInput?.qualificationR2);
  if (
    raw === null ||
    !["dualLaneInput", "commandPayload,dualLaneInput"].includes(Object.keys(raw).sort().join(",")) ||
    dualLaneInput === null ||
    qualificationR2 === null
  )
    throw new Error("V208_PRODUCTION_INPUT_INVALID");
  const commandPayload = raw.commandPayload === undefined ? {} : object(raw.commandPayload);
  if (commandPayload === null)
    throw new Error("V208_PRODUCTION_INPUT_INVALID");
  const fullLiveAuthorityId = localAuthorityUuid(inputs.request, authoritySha256);
  const outerStateSha256 = hashCanonical({
    schemaVersion: "videoforge.v208-soulx-local-outer-state/v1",
    authoritySha256,
    requestId: inputs.request.request_id,
    input: inputs.request.input,
  });
  const value = {
    schemaVersion: "videoforge.v213-full-live-production-input/v1",
    commandPayload,
    dualLaneInput,
    fullLiveAuthorityId,
    outerStateSha256,
  } as const;
  validateV213ProductionInputShape(value as unknown as JsonValue);
  if (
    qualificationR2.accountId !== inputs.qualification.r2.accountId ||
    qualificationR2.bucketName !== inputs.qualification.r2.bucketName
  )
    throw new Error("V208_QUALIFICATION_R2_BINDING_DRIFT");
  return value as unknown as ProductionInput;
}

/** Loads only the exact SoulX stage scope journaled by the local durable store. */
export function createV208CleanupAttributableResource(input: {
  readonly durable: Pick<V208FileDurableStageStore, "readSnapshot">;
  readonly transport: Pick<V213RunPodDualLaneTransport, "cleanupAttributableResources">;
}) {
  return async (resourceKey: string): Promise<true> => {
    const match = /^v213-([A-Za-z0-9][A-Za-z0-9_.:-]{0,190})-soulx-qualification$/u.exec(resourceKey);
    if (!match) throw new Error("V208_CLEANUP_RESOURCE_KEY_INVALID");
    const snapshot = input.durable.readSnapshot();
    const stageAuthority = snapshot.stageAuthority;
    if (stageAuthority === null || stageAuthority.authority.authorityId !== match[1])
      throw new Error("V208_CLEANUP_SCOPE_INVALID");
    const operations = snapshot.operations;
    if (
      operations.some((operation) => {
        const kind = operation.kind;
        const key = operation.resourceKey;
        if (operation.stageAuthorityId !== match[1]) return true;
        if (typeof key !== "string" || key.length < 1 || key.length > 512) return true;
        if (kind === "create" || kind === "readback" || kind === "delete")
          return key !== resourceKey;
        if (kind === "dispatch") return !/^v208-[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}$/u.test(key);
        if (kind === "status" || kind === "cancel")
          return !/^sha256:[a-f0-9]{64}:[A-Za-z0-9][A-Za-z0-9_.:-]{0,190}(?::-?[0-9]+)?$/u.test(
            key,
          );
        return true;
      })
    )
      throw new Error("V208_CLEANUP_OPERATION_SCOPE_INVALID");
    const stage: V213CleanupStageRead = {
      stage: "soulx",
      stageAuthorityId: match[1],
      operations,
    };
    await input.transport.cleanupAttributableResources([stage]);
    return true;
  };
}

export function createV208SoulXLiveComposition(input: {
  readonly protectedInputs: V208ProtectedInputs;
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly serializeEvidence?: (result: V208SoulXQualificationResult) => Promise<void>;
}) {
  const protectedInputs = input.protectedInputs;
  const executionEnvironment = authorityEnvironment(input.environment ?? process.env);
  const authority = parseV208SoulXAuthority(executionEnvironment);
  const plan = buildV208SoulXQualificationPlan(authority);
  const production = productionInput(protectedInputs, authority.authoritySha256);
  const fetchPort = input.fetch ?? globalThis.fetch;
  const now = input.now ?? (() => new Date());
  const sleep =
    input.sleep ??
    ((milliseconds) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const secrets = protectedInputs.productionSecrets;
  const signer = new ProvenanceReceiptSigner(
    secrets.provenanceReceiptKeyId,
    Buffer.from(secrets.provenanceReceiptHmacKeyBase64, "base64"),
  );
  const stagePrivateKey = createPrivateKey({
    key: Buffer.from(secrets.stageAuthoritySigningKeyBase64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const dualLaneInput = Object.freeze({
    ...production.dualLaneInput,
    receiptSigner: signer,
    stageAuthorityPublicKeyPem: createPublicKey(stagePrivateKey)
      .export({ type: "spki", format: "pem" })
      .toString(),
  }) as V213DualLaneInput;
  if (
    dualLaneInput.soulx.publicImage !== authority.image ||
    dualLaneInput.soulx.sourceCommit !== authority.imageSourceCommit
  )
    throw new Error("V208_SOULX_AUTHORITY_LANE_BINDING_INVALID");
  const durable = createV208FileDurableStageStore({
    journalDirectory: protectedInputs.journalDirectory,
    manifest: {
      schemaVersion: "videoforge.v208-file-authority-manifest/v1",
      checkpoint: "V2-08",
      stage: 7,
      proposalSha256: authority.proposalSha256 as `sha256:${string}`,
      authoritySha256: authority.authoritySha256 as `sha256:${string}`,
      image: authority.image,
      sourceCommit: authority.imageSourceCommit,
      planSha256: plan.planSha256 as `sha256:${string}`,
    },
    signAuthority: (unsigned) =>
      sign(null, Buffer.from(canonicalizeJson(unsigned as unknown as JsonValue), "utf8"), stagePrivateKey).toString(
        "base64",
      ),
    now,
  });
  const adapter = createV208DirectWholeSpanQualificationAdapter({
    fullLiveAuthorityId: production.fullLiveAuthorityId,
    operationId: "soulx-live-qualification",
    outerStateSha256: production.outerStateSha256,
    sourceCommit: dualLaneInput.soulx.sourceCommit,
    sourceRefs: dualLaneInput.qualificationSourceRefs,
    protectedInputDescriptors: dualLaneInput.qualificationProtectedInputDescriptors,
    protectedSourceBytes: protectedInputs.qualification.sourceBytes,
    r2: protectedInputs.qualification.r2,
    signing: {
      secretHex: secrets.pairEnvelopeSigningKeyHex,
      keyId: secrets.pairEnvelopeSigningKeyId,
    },
    materializationStore: durable.materializationStore,
    fetch: fetchPort,
    now,
  });
  const control = new RunPodControlClient({ apiKey: protectedInputs.runpodApiKey });
  const transport = createV213RunPodDualLaneTransport({
    durable,
    input: dualLaneInput,
    workerEnvironment: v213WorkerEnvironmentSecrets(secrets),
    control,
    accountPreflight: () => assertSujalRunPodAccount(protectedInputs.runpodApiKey),
    readAdmissionFacts: async () => {
      const candidates = await fetchCp07Catalog(protectedInputs.runpodApiKey, fetchPort);
      const exact = findCp07Offering(candidates, "NVIDIA GeForce RTX 4090", "EU-RO-1");
      if (!exact) throw new Error("V208_RUNPOD_EXACT_OFFERING_UNAVAILABLE");
      return {
        checkedAt: now().toISOString(),
        availability: exact.availability,
        flexRateUsdPerGpuHour: V213_SERVERLESS_FLEX_RATE_SOURCE.rateUsdPerGpuHour,
        cumulativeBillingUsd: await readEndpointBilling(protectedInputs.runpodApiKey, fetchPort),
      };
    },
    createJobClient: (endpointId) =>
      new RunPodServerlessJobClient({
        apiKey: protectedInputs.runpodApiKey,
        endpointId,
        guard: new RunPodDrainGuard(),
      }),
    materializeQualificationCase: adapter.materializeQualificationCase,
    sleep,
    now,
  });
  return Object.freeze({
    dependencies: Object.freeze({
      transport,
      soulx: dualLaneInput.soulx,
      materializeWholeSpan: adapter.materializeWholeSpan,
      verifySuccess: createV208SoulXReceiptVerifier({
        signer,
        readOutput: adapter.readOutput,
        probeMp4: probeV208Mp4Bytes,
      }),
      cleanupOutputKeys: adapter.cleanupOutputKeys,
      cleanupMaterializedInputs: adapter.cleanupMaterializedInputs,
      cleanupAmbiguousMaterializedInputs: adapter.cleanupAmbiguousMaterializedInputs,
      reconstructDeterministicQualificationKeys:
        adapter.reconstructDeterministicQualificationKeys,
      cleanupDeterministicQualificationKeys: adapter.cleanupDeterministicQualificationKeys,
      cleanupAttributableResource: createV208CleanupAttributableResource({
        durable,
        transport,
      }),
      serializeEvidence: async (result: V208SoulXQualificationResult) => {
        await input.serializeEvidence?.(result);
      },
      minimumStableReadSpacingMs: dualLaneInput.minimumStableReadSpacingMs,
      maxStatusReads: dualLaneInput.maxStatusReads,
      pollIntervalMs: dualLaneInput.pollIntervalMs,
    }),
  });
}

function readFd(value: string | undefined, code: string): Buffer {
  if (!/^[0-9]{1,3}$/u.test(value ?? "")) throw new Error(code);
  const fd = Number(value);
  if (!Number.isSafeInteger(fd) || fd < 3 || fd > 255) throw new Error(code);
  const bytes = readFileSync(fd);
  if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024 || bytes.includes(0))
    throw new Error(code);
  return bytes;
}

function readTextFd(value: string | undefined, code: string): string {
  const text = readFd(value, code).toString("utf8");
  if (text.trim() !== text || text.length === 0) throw new Error(code);
  return text;
}

function sha256Bytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function exactV208Request(value: unknown): V208SoulXLiveRequest {
  const item = object(value);
  const r2 = object(item?.r2);
  const requestInput = item?.input;
  if (
    item === null ||
    Object.keys(item).sort().join(",") !== "command,input,r2,request_id,schema_version" ||
    item.schema_version !== V208_REQUEST_SCHEMA ||
    item.command !== "soulx-live-qualification" ||
    typeof item.request_id !== "string" ||
    !COMMAND_ID.test(item.request_id) ||
    r2 === null ||
    Object.keys(r2).sort().join(",") !== "account_id,bucket_name" ||
    typeof r2.account_id !== "string" ||
    !/^[0-9a-f]{32}$/u.test(r2.account_id) ||
    typeof r2.bucket_name !== "string" ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u.test(r2.bucket_name) ||
    object(requestInput) === null
  )
    throw new Error("V208_REQUEST_INVALID");
  return Object.freeze({
    schema_version: V208_REQUEST_SCHEMA,
    command: "soulx-live-qualification",
    request_id: item.request_id,
    input: requestInput as JsonValue,
    r2: Object.freeze({ account_id: r2.account_id, bucket_name: r2.bucket_name }),
  });
}

function parseV208QualificationSecrets(value: unknown): V213ProductionSecrets {
  const record = object(value);
  const keys = [
    "acceptanceEvidenceSigningKeyBase64",
    "pairDispatchTokenKeyBase64",
    "pairDispatchTokenKeyId",
    "pairEnvelopeSigningKeyHex",
    "pairEnvelopeSigningKeyId",
    "pairProviderProofKeyHex",
    "pairProviderProofKeyId",
    "provenanceReceiptHmacKeyBase64",
    "provenanceReceiptKeyId",
    "schemaVersion",
    "stageAuthoritySigningKeyBase64",
  ].sort();
  if (
    record === null ||
    Object.keys(record).sort().join(",") !== keys.join(",") ||
    ![
      "videoforge.v2-08-soulx-qualification-secrets/v1",
      "videoforge.v213-full-live-pre-endpoint-secrets/v1",
    ].includes(record.schemaVersion as string)
  )
    throw new Error("V208_PRODUCTION_SECRETS_INVALID");
  const ids = [
    record.provenanceReceiptKeyId,
    record.pairDispatchTokenKeyId,
    record.pairEnvelopeSigningKeyId,
    record.pairProviderProofKeyId,
  ];
  if (
    ids.some((value) => typeof value !== "string" || !COMMAND_ID.test(value)) ||
    new Set(ids).size !== ids.length ||
    typeof record.pairEnvelopeSigningKeyHex !== "string" ||
    !HEX_KEY.test(record.pairEnvelopeSigningKeyHex) ||
    typeof record.pairProviderProofKeyHex !== "string" ||
    !HEX_KEY.test(record.pairProviderProofKeyHex)
  )
    throw new Error("V208_PRODUCTION_SECRETS_INVALID");
  const encoded = [
    record.stageAuthoritySigningKeyBase64,
    record.provenanceReceiptHmacKeyBase64,
    record.acceptanceEvidenceSigningKeyBase64,
    record.pairDispatchTokenKeyBase64,
  ];
  const decoded: Buffer[] = [];
  for (const value of encoded) {
    if (typeof value !== "string" || !BASE64.test(value))
      throw new Error("V208_PRODUCTION_SECRETS_INVALID");
    const bytes = Buffer.from(value, "base64");
    if (bytes.length < 32 || bytes.toString("base64") !== value)
      throw new Error("V208_PRODUCTION_SECRETS_INVALID");
    decoded.push(bytes);
  }
  const allKeyBytes = [
    ...decoded,
    Buffer.from(record.pairEnvelopeSigningKeyHex as string, "hex"),
    Buffer.from(record.pairProviderProofKeyHex as string, "hex"),
  ];
  if (
    new Set(allKeyBytes.map((bytes) => sha256Bytes(bytes))).size !== allKeyBytes.length
  )
    throw new Error("V208_PRODUCTION_SECRETS_REUSE");
  return Object.freeze(record) as unknown as V213ProductionSecrets;
}

function parseJsonFd(value: string | undefined, code: string): unknown {
  try {
    return JSON.parse(readTextFd(value, code));
  } catch (error) {
    if (error instanceof Error && error.message === code) throw error;
    throw new Error(code);
  }
}

function assertProtectedDescriptorMatches(
  descriptor: unknown,
  bytes: Uint8Array,
  contentType: "image/png" | "audio/wav",
  code: string,
): void {
  const value = object(descriptor);
  if (
    value === null ||
    Object.keys(value).sort().join(",") !== "contentType,path,sha256,sizeBytes" ||
    value.contentType !== contentType ||
    typeof value.path !== "string" ||
    !value.path.startsWith(".videoforge/private/") ||
    value.path.split("/").includes("..") ||
    typeof value.sha256 !== "string" ||
    !SHA256.test(value.sha256) ||
    !Number.isSafeInteger(value.sizeBytes) ||
    value.sizeBytes !== bytes.byteLength ||
    value.sha256 !== sha256Bytes(bytes)
  )
    throw new Error(code);
}

/** Reads only the V2-08 launcher FDs. No database URL, Worker credential or ambient secret is
 * accepted by this boundary; the RunPod key remains supplied by the local keychain port. */
export function readV208ProtectedInputs(
  environment: NodeJS.ProcessEnv,
  runpodApiKey: string,
): V208ProtectedInputs {
  const extras = Object.keys(environment).filter(
    (name) => name.startsWith("V208_") && !V208_PROTECTED_INPUT_ENVIRONMENT_NAMES.has(name),
  );
  if (extras.length > 0) throw new Error("V208_AMBIENT_BINDING_REJECTED");
  if (typeof runpodApiKey !== "string" || runpodApiKey.trim() !== runpodApiKey || runpodApiKey.length < 20)
    throw new Error("V208_RUNPOD_KEY_INVALID");
  const journalDirectory = environment[V208_PROTECTED_INPUT_ENVIRONMENT.journalDirectory];
  if (
    typeof journalDirectory !== "string" ||
    journalDirectory.length < 2 ||
    !journalDirectory.startsWith("/") ||
    resolve(journalDirectory) !== journalDirectory ||
    journalDirectory === "/"
  )
    throw new Error("V208_JOURNAL_DIRECTORY_INVALID");
  const request = exactV208Request(
    parseJsonFd(environment[V208_PROTECTED_INPUT_ENVIRONMENT.requestFd], "V208_REQUEST_FD_INVALID"),
  );
  const productionSecretsRaw = readTextFd(
    environment[V208_PROTECTED_INPUT_ENVIRONMENT.productionSecretsFd],
    "V208_PRODUCTION_SECRETS_FD_INVALID",
  );
  const productionSecrets = parseV208QualificationSecrets(
    (() => {
      try {
        return JSON.parse(productionSecretsRaw) as unknown;
      } catch {
        throw new Error("V208_PRODUCTION_SECRETS_JSON_INVALID");
      }
    })(),
  );
  const r2 = Object.freeze({
    accountId: readTextFd(
      environment[V208_PROTECTED_INPUT_ENVIRONMENT.r2AccountIdFd],
      "V208_R2_ACCOUNT_ID_FD_INVALID",
    ),
    accessKeyId: readTextFd(
      environment[V208_PROTECTED_INPUT_ENVIRONMENT.r2AccessKeyIdFd],
      "V208_R2_ACCESS_KEY_ID_FD_INVALID",
    ),
    secretAccessKey: readTextFd(
      environment[V208_PROTECTED_INPUT_ENVIRONMENT.r2SecretAccessKeyFd],
      "V208_R2_SECRET_ACCESS_KEY_FD_INVALID",
    ),
    bucketName: readTextFd(
      environment[V208_PROTECTED_INPUT_ENVIRONMENT.r2BucketNameFd],
      "V208_R2_BUCKET_NAME_FD_INVALID",
    ),
  });
  if (r2.accountId !== request.r2.account_id || r2.bucketName !== request.r2.bucket_name)
    throw new Error("V208_R2_BINDING_DRIFT");
  const sourceBytes = Object.freeze({
    avatarSource: Uint8Array.from(
      readFd(
        environment[V208_PROTECTED_INPUT_ENVIRONMENT.avatarSourceFd],
        "V208_AVATAR_SOURCE_FD_INVALID",
      ),
    ),
    soulx2s: Uint8Array.from(
      readFd(environment[V208_PROTECTED_INPUT_ENVIRONMENT.audio2sFd], "V208_AUDIO_2S_FD_INVALID"),
    ),
    soulx4s: Uint8Array.from(
      readFd(environment[V208_PROTECTED_INPUT_ENVIRONMENT.audio4sFd], "V208_AUDIO_4S_FD_INVALID"),
    ),
    soulx6s: Uint8Array.from(
      readFd(environment[V208_PROTECTED_INPUT_ENVIRONMENT.audio6sFd], "V208_AUDIO_6S_FD_INVALID"),
    ),
    soulx10s: Uint8Array.from(
      readFd(
        environment[V208_PROTECTED_INPUT_ENVIRONMENT.audio10sFd],
        "V208_AUDIO_10S_FD_INVALID",
      ),
    ),
  });
  const input = object(request.input);
  const dualLaneInput = object(input?.dualLaneInput);
  const descriptors = object(dualLaneInput?.qualificationProtectedInputDescriptors);
  if (dualLaneInput === null || descriptors === null)
    throw new Error("V208_PRODUCTION_INPUT_INVALID");
  assertProtectedDescriptorMatches(
    descriptors.avatarSource,
    sourceBytes.avatarSource,
    "image/png",
    "V208_AVATAR_SOURCE_BINDING_INVALID",
  );
  for (const [key, bytes, code] of [
    ["soulx2s", sourceBytes.soulx2s, "V208_AUDIO_2S_BINDING_INVALID"],
    ["soulx4s", sourceBytes.soulx4s, "V208_AUDIO_4S_BINDING_INVALID"],
    ["soulx6s", sourceBytes.soulx6s, "V208_AUDIO_6S_BINDING_INVALID"],
    ["soulx10s", sourceBytes.soulx10s, "V208_AUDIO_10S_BINDING_INVALID"],
  ] as const)
    assertProtectedDescriptorMatches(descriptors[key], bytes, "audio/wav", code);
  return Object.freeze({
    request,
    runpodApiKey,
    productionSecrets,
    productionSecretsRaw,
    journalDirectory,
    qualification: Object.freeze({ r2, sourceBytes }),
  });
}

export async function runV208SoulXLiveCli(
  environment: NodeJS.ProcessEnv = process.env,
  ports: Readonly<{
    loadRunPodKey?: () => Promise<string>;
    readInputs?: (environment: NodeJS.ProcessEnv, runpodKey: string) => V208ProtectedInputs;
    createComposition?: typeof createV208SoulXLiveComposition;
    writeOutput?: (value: string) => void;
  }> = {},
) {
  const key = await (ports.loadRunPodKey ?? loadSujalRunPodApiKeyFromKeychain)();
  const inputs = (ports.readInputs ?? ((source, runpodKey) =>
    readV208ProtectedInputs(source, runpodKey)))(environment, key);
  const composition = (ports.createComposition ?? createV208SoulXLiveComposition)({
    protectedInputs: inputs,
    environment,
  });
  const result = await runV208SoulXWithV213Transport(
    composition.dependencies,
    authorityEnvironment(environment),
  );
  (ports.writeOutput ?? ((value) => process.stdout.write(`${value}\n`)))(
    canonicalizeJson(result as unknown as JsonValue),
  );
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] !== V208_SOULX_LIVE_CLI_CONFIRMATION)
    throw new Error("V208_CLI_CONFIRMATION_REQUIRED");
  await runV208SoulXLiveCli();
}
