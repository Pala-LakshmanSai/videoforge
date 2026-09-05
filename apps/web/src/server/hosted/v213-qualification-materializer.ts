import { canonicalSha256, digestUtf8, type Sha256 } from "@videoforge/control-plane";
import {
  assertContract,
  canonicalizeJsonToUtf8,
  validateAndHashContractDocument,
  type JsonValue,
} from "@videoforge/contracts";

import {
  generateMageQualificationCase,
  MAGE_QUALIFICATION_ITEM_COUNT,
  validateMageQualificationCase,
} from "../../../../../deploy/v2-13/generate-mage-qualification-case.mjs";
import {
  generateSoulXQualificationCase,
  generateSoulXWholeSpanQualificationCase,
  validateSoulXQualificationCase,
  validateSoulXWholeSpanQualificationCase,
} from "../../../../../deploy/v2-13/generate-soulx-qualification-cases.mjs";
import type {
  V213LaneDeployment,
  V213QualificationCaseDescriptor,
  V213QualificationCaseMaterialization,
} from "../providers/v213-dual-lane-live.js";
import {
  signHostedEnvelopeBody,
  type HostedEnvelopeSigningBinding,
} from "./hosted-envelope-signer.js";
import type { HostedR2BucketBinding, HostedRuntimeConfiguration } from "./configuration.js";
import { HostedR2Signer, isExactHostedR2ObjectKey } from "./r2.js";

const HASH = /^sha256:[0-9a-f]{64}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const COMMIT = /^[0-9a-f]{40}$/u;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u;
const UTC = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]+)?Z$/u;
const CAPABILITY = /^[A-Za-z0-9._:-]{32,512}$/u;
const MAX_INPUT_BYTES = 16 * 1024 * 1024;
const PORT_LIFETIME_SECONDS = 900;
const CASE_SOURCE_PATH = "apps/web/src/server/providers/v213-dual-lane-live.ts";
const WORKER_REQUEST_KEYS = [
  "batch",
  "envelope",
  "generated_output_authorities",
  "input_get_urls",
  "output_put_urls",
  "ports",
] as const;
export const V213_SOULX_INVALID_OUTPUT_PROBE = "SOULX_INVALID_OUTPUT_CONTRACT_V1" as const;
export const V213_SOULX_TIMEOUT_PROBE = "RUNPOD_EXECUTION_TIMEOUT_V1" as const;
const CASES = Object.freeze({
  mage: Object.freeze({
    key: "mage",
    lane: "mage",
    id: "mage-cold-representative",
    seconds: 0,
    mode: "complete",
    cold: true,
  }),
  soulx2s: Object.freeze({
    key: "soulx2s",
    lane: "soulx",
    id: "soulx-cold-2s",
    seconds: 2,
    mode: "complete",
    cold: true,
  }),
  soulx4s: Object.freeze({
    key: "soulx4s",
    lane: "soulx",
    id: "soulx-warm-4s",
    seconds: 4,
    mode: "complete",
    cold: false,
  }),
  soulx6s: Object.freeze({
    key: "soulx6s",
    lane: "soulx",
    id: "soulx-warm-6s",
    seconds: 6,
    mode: "complete",
    cold: false,
  }),
  soulx10s: Object.freeze({
    key: "soulx10s",
    lane: "soulx",
    id: "soulx-warm-10s",
    seconds: 10,
    mode: "complete",
    cold: false,
  }),
  soulxCancel: Object.freeze({
    key: "soulxCancel",
    lane: "soulx",
    id: "soulx-cancel",
    seconds: 2,
    mode: "cancel",
    cold: false,
  }),
  soulxInvalidOutput: Object.freeze({
    key: "soulxInvalidOutput",
    lane: "soulx",
    id: "soulx-invalid-output",
    seconds: 2,
    mode: "invalid",
    cold: false,
  }),
  soulxTimeout: Object.freeze({
    key: "soulxTimeout",
    lane: "soulx",
    id: "soulx-timeout",
    seconds: 2,
    mode: "timeout",
    cold: false,
  }),
} as const);

export const V208_SOULX_WHOLE_SPAN_DESCRIPTORS = Object.freeze([
  Object.freeze({
    key: "soulxWholeSpanCold" as const,
    lane: "soulx" as const,
    id: "soulx-cold-whole-span-2-4-6-10s",
    seconds: 22,
    mode: "complete" as const,
    cold: true as const,
  }),
  Object.freeze({
    key: "soulxWholeSpanWarm" as const,
    lane: "soulx" as const,
    id: "soulx-warm-whole-span-2-4-6-10s",
    seconds: 22,
    mode: "complete" as const,
    cold: false as const,
  }),
] as const);

export type V208SoulXWholeSpanDescriptor = (typeof V208_SOULX_WHOLE_SPAN_DESCRIPTORS)[number];
type QualificationDescriptor = V213QualificationCaseDescriptor | V208SoulXWholeSpanDescriptor;
const isWholeSpanDescriptor = (
  descriptor: QualificationDescriptor | Record<string, unknown>,
): boolean => descriptor.key === "soulxWholeSpanCold" || descriptor.key === "soulxWholeSpanWarm";

export type V213QualificationOperation = "mage-live-qualification" | "soulx-live-qualification";

export interface V213QualificationSourceRef {
  readonly path: string;
  readonly sha256: Sha256;
}

export interface V213QualificationInputArtifact {
  readonly role: "avatar_source" | "audio";
  readonly assetId: string;
  readonly reservationId: string;
  readonly contentType: "image/png" | "audio/wav";
  readonly sha256: Sha256;
  readonly bodyBase64: string;
}

export interface V213QualificationMaterializationRequest {
  readonly schemaVersion: "videoforge.v213-qualification-materialization-request/v1";
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213QualificationOperation;
  readonly stageAuthorityId: string;
  readonly outerStateSha256: Sha256;
  readonly inputSha256: Sha256;
  readonly sourceCommit: string;
  readonly descriptor: QualificationDescriptor;
  readonly caseSourceRef: V213QualificationSourceRef;
  readonly generatorRef: V213QualificationSourceRef;
  readonly validatorRef: V213QualificationSourceRef;
  readonly deployment: V213LaneDeployment;
  readonly inputs: readonly V213QualificationInputArtifact[];
  readonly requestSha256: Sha256;
}

export interface V213QualificationMaterializationRouteResult {
  readonly schemaVersion: "videoforge.v213-qualification-materialization-result/v1";
  readonly fullLiveAuthorityId: string;
  readonly operationId: V213QualificationOperation;
  readonly stageAuthorityId: string;
  readonly outerStateSha256: Sha256;
  readonly requestSha256: Sha256;
  readonly sourceRefsSha256: Sha256;
  readonly materialization: V213QualificationCaseMaterialization;
  readonly resultSha256: Sha256;
}

export interface V213QualificationMaterializationStore {
  claim(
    request: V213QualificationMaterializationRequest,
  ): Promise<"EXECUTE" | "RECONCILE" | "EXISTING">;
  persist(
    request: V213QualificationMaterializationRequest,
    result: V213QualificationMaterializationRouteResult,
  ): Promise<V213QualificationMaterializationRouteResult>;
  read(
    request: V213QualificationMaterializationRequest,
  ): Promise<V213QualificationMaterializationRouteResult | null>;
}

export interface V213QualificationMaterializerDependencies {
  readonly bucket: HostedR2BucketBinding;
  readonly r2Signer: Pick<HostedR2Signer, "sign" | "signGenerated">;
  readonly signing: HostedEnvelopeSigningBinding;
  readonly store: V213QualificationMaterializationStore;
  readonly now?: () => Date;
  readonly randomHex?: (bytes: number) => string;
}

export interface V213QualificationInputCleanupEvidence {
  readonly schemaVersion: "videoforge.v213-qualification-input-cleanup/v1";
  readonly requestSha256: Sha256;
  readonly terminalOutcome: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  readonly deletedObjectKeySha256s: readonly Sha256[];
  readonly absenceVerified: true;
  readonly evidenceSha256: Sha256;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...keys].sort().join(",");
}

function sourceRef(value: unknown): value is V213QualificationSourceRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    exactKeys(item, ["path", "sha256"]) &&
    typeof item.path === "string" &&
    item.path.length >= 3 &&
    item.path.length <= 400 &&
    !item.path.startsWith("/") &&
    !item.path.split("/").includes("..") &&
    typeof item.sha256 === "string" &&
    HASH.test(item.sha256)
  );
}

function expectedOperation(lane: "mage" | "soulx"): V213QualificationOperation {
  return lane === "mage" ? "mage-live-qualification" : "soulx-live-qualification";
}

export function buildV213QualificationMaterializationRequest(
  value: Omit<V213QualificationMaterializationRequest, "requestSha256">,
): V213QualificationMaterializationRequest {
  const requestSha256 = canonicalSha256(value) as Sha256;
  return parseV213QualificationMaterializationRequest({ ...value, requestSha256 });
}

export function parseV213QualificationMaterializationRequest(
  value: unknown,
): V213QualificationMaterializationRequest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_REQUEST_INVALID");
  const item = value as Record<string, unknown>;
  const descriptor = item.descriptor as Record<string, unknown> | undefined;
  const deployment = item.deployment as Record<string, unknown> | undefined;
  const inputs = item.inputs;
  if (
    !exactKeys(item, [
      "caseSourceRef",
      "deployment",
      "descriptor",
      "fullLiveAuthorityId",
      "generatorRef",
      "inputSha256",
      "inputs",
      "operationId",
      "outerStateSha256",
      "requestSha256",
      "schemaVersion",
      "sourceCommit",
      "stageAuthorityId",
      "validatorRef",
    ]) ||
    item.schemaVersion !== "videoforge.v213-qualification-materialization-request/v1" ||
    typeof item.fullLiveAuthorityId !== "string" ||
    !UUID.test(item.fullLiveAuthorityId) ||
    (item.operationId !== "mage-live-qualification" &&
      item.operationId !== "soulx-live-qualification") ||
    typeof item.stageAuthorityId !== "string" ||
    !ID.test(item.stageAuthorityId) ||
    typeof item.outerStateSha256 !== "string" ||
    !HASH.test(item.outerStateSha256) ||
    typeof item.inputSha256 !== "string" ||
    !HASH.test(item.inputSha256) ||
    typeof item.requestSha256 !== "string" ||
    !HASH.test(item.requestSha256) ||
    typeof item.sourceCommit !== "string" ||
    !COMMIT.test(item.sourceCommit) ||
    !sourceRef(item.caseSourceRef) ||
    !sourceRef(item.generatorRef) ||
    !sourceRef(item.validatorRef) ||
    !descriptor ||
    !exactKeys(descriptor, ["cold", "id", "key", "lane", "mode", "seconds"]) ||
    !["mage", "soulx"].includes(String(descriptor.lane)) ||
    item.operationId !== expectedOperation(descriptor.lane as "mage" | "soulx") ||
    !ID.test(String(descriptor.id ?? "")) ||
    !deployment ||
    deployment.lane !== descriptor.lane ||
    deployment.purpose !== "qualification" ||
    deployment.region !== "EU-RO-1" ||
    deployment.gpu !== "NVIDIA GeForce RTX 4090" ||
    deployment.workersMin !== 0 ||
    deployment.workersMax !== 1 ||
    deployment.volumeMount !== "/runpod-volume" ||
    deployment.volumeSizeGb !== 50 ||
    deployment.gpuCount !== 1 ||
    deployment.handlerConcurrency !== 1 ||
    deployment.scalerType !== "REQUEST_COUNT" ||
    deployment.scalerValue !== 1 ||
    deployment.sourceCommit !== item.sourceCommit ||
    typeof deployment.image !== "string" ||
    !/@sha256:[0-9a-f]{64}$/u.test(deployment.image) ||
    typeof deployment.endpointId !== "string" ||
    digestUtf8(deployment.endpointId) !== deployment.endpointIdSha256 ||
    typeof deployment.templateId !== "string" ||
    digestUtf8(deployment.templateId) !== deployment.templateIdSha256 ||
    typeof deployment.deploymentSha256 !== "string" ||
    !HASH.test(deployment.deploymentSha256) ||
    typeof deployment.volumeIdSha256 !== "string" ||
    !HASH.test(deployment.volumeIdSha256) ||
    typeof deployment.volumeManifestSha256 !== "string" ||
    !HASH.test(deployment.volumeManifestSha256) ||
    !Array.isArray(inputs) ||
    (descriptor.lane === "mage" && inputs.length !== 0) ||
    (descriptor.lane === "soulx" && inputs.length !== (isWholeSpanDescriptor(descriptor) ? 5 : 2))
  )
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_REQUEST_INVALID");
  const expectedDescriptor = isWholeSpanDescriptor(descriptor)
    ? V208_SOULX_WHOLE_SPAN_DESCRIPTORS.find((item) => item.key === descriptor.key)
    : CASES[descriptor.key as keyof typeof CASES];
  const lane = descriptor.lane as "mage" | "soulx";
  if (
    !expectedDescriptor ||
    canonicalSha256(expectedDescriptor) !== canonicalSha256(descriptor) ||
    (item.caseSourceRef as V213QualificationSourceRef).path !== CASE_SOURCE_PATH ||
    (item.generatorRef as V213QualificationSourceRef).path !==
      (lane === "mage"
        ? "deploy/v2-13/generate-mage-qualification-case.mjs"
        : "deploy/v2-13/generate-soulx-qualification-cases.mjs") ||
    (item.validatorRef as V213QualificationSourceRef).path !==
      (lane === "mage"
        ? "workers/image-media/src/videoforge_image_media/mage_production.py"
        : "workers/avatar-primary/soulx_serverless.py")
  )
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_SOURCE_DRIFT");
  for (const input of inputs) {
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error("V213_QUALIFICATION_MATERIALIZATION_REQUEST_INVALID");
    const artifact = input as Record<string, unknown>;
    if (
      !exactKeys(artifact, [
        "assetId",
        "bodyBase64",
        "contentType",
        "reservationId",
        "role",
        "sha256",
      ]) ||
      (artifact.role !== "avatar_source" && artifact.role !== "audio") ||
      !ID.test(String(artifact.assetId ?? "")) ||
      !ID.test(String(artifact.reservationId ?? "")) ||
      (artifact.contentType !== "image/png" && artifact.contentType !== "audio/wav") ||
      typeof artifact.sha256 !== "string" ||
      !HASH.test(artifact.sha256) ||
      typeof artifact.bodyBase64 !== "string" ||
      !BASE64.test(artifact.bodyBase64)
    )
      throw new Error("V213_QUALIFICATION_MATERIALIZATION_REQUEST_INVALID");
    if (
      (artifact.role === "avatar_source" && artifact.contentType !== "image/png") ||
      (artifact.role === "audio" && artifact.contentType !== "audio/wav")
    )
      throw new Error("V213_QUALIFICATION_MATERIALIZATION_REQUEST_INVALID");
  }
  if (descriptor.lane === "soulx") {
    if ((inputs[0] as Record<string, unknown>).role !== "avatar_source")
      throw new Error("V213_QUALIFICATION_MATERIALIZATION_REQUEST_INVALID");
    if (inputs.slice(1).some((input) => (input as Record<string, unknown>).role !== "audio"))
      throw new Error("V213_QUALIFICATION_MATERIALIZATION_REQUEST_INVALID");
  }
  const { requestSha256: _hash, ...unsigned } = item;
  void _hash;
  if (canonicalSha256(unsigned) !== item.requestSha256)
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_REQUEST_HASH_DRIFT");
  return item as unknown as V213QualificationMaterializationRequest;
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function bytesSha256(bytes: Uint8Array<ArrayBuffer>): Promise<Sha256> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as Sha256;
}

function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}

function validUtc(value: unknown): value is string {
  return typeof value === "string" && UTC.test(value) && !Number.isNaN(Date.parse(value));
}

function safeUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 8_192) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.hostname.length > 0 &&
      parsed.username === "" &&
      parsed.password === "" &&
      parsed.hash === "" &&
      ![...value].some((character) => character.charCodeAt(0) < 32)
    );
  } catch {
    return false;
  }
}

function safeSignedHeaders(value: unknown): value is Readonly<Record<string, string>> {
  if (!record(value)) return false;
  for (const [name, headerValue] of Object.entries(value)) {
    if (
      !/^[\u0021-\u007e]+$/u.test(name) ||
      typeof headerValue !== "string" ||
      headerValue.length > 4_096 ||
      !/^[\u0020-\u007e]*$/u.test(headerValue) ||
      /authorization|cookie|credential|secret|token/i.test(name)
    )
      return false;
  }
  return true;
}

function expectedPortExpiry(now: Date): string {
  return new Date(now.getTime() + PORT_LIFETIME_SECONDS * 1_000).toISOString();
}

function outputMaxContentLength(descriptor: QualificationDescriptor): number {
  return descriptor.lane === "mage" ? 16 * 1024 * 1024 : 64 * 1024 * 1024;
}

function executionTimeoutSeconds(descriptor: QualificationDescriptor): number {
  if (descriptor.lane === "mage") return 2400;
  if (isWholeSpanDescriptor(descriptor)) return 800;
  if (descriptor.mode === "cancel" || descriptor.mode === "invalid") return 60;
  if (descriptor.mode === "timeout") return 5;
  return 1800;
}

function qualificationProbe(descriptor: QualificationDescriptor): string | null {
  if (descriptor.lane !== "soulx") return null;
  if (descriptor.mode === "invalid") return V213_SOULX_INVALID_OUTPUT_PROBE;
  if (descriptor.mode === "timeout") return V213_SOULX_TIMEOUT_PROBE;
  return null;
}

function signedUrlBindsObjectKey(url: string, objectKey: string): boolean {
  try {
    const pathname = decodeURIComponent(new URL(url).pathname);
    return pathname.endsWith(`/${objectKey}`);
  } catch {
    return false;
  }
}

function validateSignedInputPort(
  value: unknown,
  expected: {
    readonly objectKey: string;
    readonly contentType: string;
    readonly contentLength: number;
    readonly checksumSha256: Sha256;
    readonly expiresAt: string;
  },
): asserts value is {
  readonly method: "GET";
  readonly url: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
  readonly expiresAt: string;
  readonly contentType: string;
  readonly contentLength: number;
  readonly checksumSha256: string;
} {
  if (
    !record(value) ||
    !exactKeys(value, [
      "checksumSha256",
      "contentLength",
      "contentType",
      "expiresAt",
      "method",
      "requiredHeaders",
      "url",
    ]) ||
    value.method !== "GET" ||
    !safeUrl(value.url) ||
    !safeSignedHeaders(value.requiredHeaders) ||
    Object.keys(value.requiredHeaders).length !== 0 ||
    value.expiresAt !== expected.expiresAt ||
    !validUtc(value.expiresAt) ||
    value.contentType !== expected.contentType ||
    value.contentLength !== expected.contentLength ||
    value.checksumSha256 !== expected.checksumSha256
  )
    throw new Error("V213_QUALIFICATION_INPUT_PORT_INVALID");
  // A signer must bind the object key in the URL.  The concrete R2 hostname/query is provider
  // specific, but its path always contains the exact encoded object key and never credentials.
  if (!signedUrlBindsObjectKey(value.url, expected.objectKey))
    throw new Error("V213_QUALIFICATION_INPUT_PORT_SCOPE_INVALID");
}

function validateSignedGeneratedPort(
  value: unknown,
  expected: {
    readonly objectKey: string;
    readonly contentType: string;
    readonly maxLength: number;
    readonly expiresAt: string;
  },
): asserts value is {
  readonly method: "PUT";
  readonly url: string;
  readonly requiredHeaders: Readonly<Record<string, string>>;
  readonly expiresAt: string;
  readonly contentType: string;
  readonly maxContentLength: number;
} {
  if (
    !record(value) ||
    !exactKeys(value, [
      "contentType",
      "expiresAt",
      "maxContentLength",
      "method",
      "requiredHeaders",
      "url",
    ]) ||
    value.method !== "PUT" ||
    !safeUrl(value.url) ||
    !safeSignedHeaders(value.requiredHeaders) ||
    value.requiredHeaders["content-type"] !== expected.contentType ||
    value.expiresAt !== expected.expiresAt ||
    !validUtc(value.expiresAt) ||
    value.contentType !== expected.contentType ||
    value.maxContentLength !== expected.maxLength
  )
    throw new Error("V213_QUALIFICATION_OUTPUT_PORT_INVALID");
  if (!signedUrlBindsObjectKey(value.url, expected.objectKey))
    throw new Error("V213_QUALIFICATION_OUTPUT_PORT_SCOPE_INVALID");
}

function randomHexDefault(bytes: number): string {
  const value = crypto.getRandomValues(new Uint8Array(bytes));
  return [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function readU32(bytes: Uint8Array<ArrayBuffer>, offset: number, littleEndian = true): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    offset,
    littleEndian,
  );
}

function validatePng(bytes: Uint8Array<ArrayBuffer>): boolean {
  return (
    bytes.byteLength >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte) &&
    readU32(bytes, 8, false) === 13 &&
    new TextDecoder().decode(bytes.slice(12, 16)) === "IHDR" &&
    readU32(bytes, 16, false) >= 1 &&
    readU32(bytes, 16, false) <= 4096 &&
    readU32(bytes, 20, false) >= 1 &&
    readU32(bytes, 20, false) <= 4096
  );
}

function validateWav(bytes: Uint8Array<ArrayBuffer>, expectedFrames: number): boolean {
  if (
    bytes.byteLength < 44 ||
    new TextDecoder().decode(bytes.slice(0, 4)) !== "RIFF" ||
    new TextDecoder().decode(bytes.slice(8, 12)) !== "WAVE"
  )
    return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 12;
  let format = false;
  let frames = -1;
  while (offset + 8 <= bytes.byteLength) {
    const id = new TextDecoder().decode(bytes.slice(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.byteLength) return false;
    if (id === "fmt " && size >= 16) {
      format =
        view.getUint16(offset + 8, true) === 1 &&
        view.getUint16(offset + 10, true) === 1 &&
        view.getUint32(offset + 12, true) === 48_000 &&
        view.getUint16(offset + 20, true) === 2 &&
        view.getUint16(offset + 22, true) === 16;
    }
    if (id === "data") frames = size / 2;
    offset += 8 + size + (size % 2);
  }
  return format && Number.isInteger(frames) && frames === expectedFrames;
}

function artifactBytes(
  artifact: V213QualificationInputArtifact,
  descriptor?: QualificationDescriptor,
  audioOrdinal = 0,
): Uint8Array<ArrayBuffer> {
  const bytes = decodeBase64(artifact.bodyBase64);
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_INPUT_BYTES)
    throw new Error("V213_QUALIFICATION_INPUT_SIZE_INVALID");
  if (artifact.contentType === "image/png" && !validatePng(bytes))
    throw new Error("V213_QUALIFICATION_SOURCE_PNG_INVALID");
  if (
    artifact.contentType === "audio/wav" &&
    (!descriptor ||
      !validateWav(
        bytes,
        Math.max(
          144_000,
          (isWholeSpanDescriptor(descriptor)
            ? ([2, 4, 6, 10] as const)[audioOrdinal]
            : descriptor.seconds)! * 48_000,
        ),
      ))
  )
    throw new Error("V213_QUALIFICATION_AUDIO_WAV_INVALID");
  return bytes;
}

function checksumHex(value: ArrayBuffer | undefined): Sha256 | null {
  if (!value) return null;
  return `sha256:${[...new Uint8Array(value)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}` as Sha256;
}

async function exactStoredObject(
  bucket: HostedR2BucketBinding,
  key: string,
  contentType: string,
  size: number,
  sha256: Sha256,
): Promise<"ABSENT" | "EXACT" | "DRIFT"> {
  const head = await bucket.head(key);
  if (head === null) return "ABSENT";
  if (
    head.size !== size ||
    head.httpMetadata?.contentType !== contentType ||
    (head.checksums?.sha256 !== undefined && checksumHex(head.checksums.sha256) !== sha256)
  )
    return "DRIFT";
  // HEAD metadata is not a sufficient content proof: an existing object may have stale or
  // provider-omitted checksum metadata.  Read at most the declared bounded input and compare the
  // bytes before reusing an existing bucket object or accepting a lost PUT acknowledgement.
  const object = await bucket.get(key);
  if (
    object === null ||
    object.size !== size ||
    object.httpMetadata?.contentType !== contentType ||
    size > MAX_INPUT_BYTES
  )
    return "DRIFT";
  const bytes = new Uint8Array(await object.arrayBuffer());
  if (bytes.byteLength !== size || (await bytesSha256(bytes)) !== sha256) return "DRIFT";
  return "EXACT";
}

interface StagedInput {
  readonly artifact: V213QualificationInputArtifact;
  readonly bytes: Uint8Array<ArrayBuffer>;
  readonly objectKey: string;
  readonly created: boolean;
}

function qualificationAttemptId(request: V213QualificationMaterializationRequest): string {
  return `v213-${request.descriptor.id}-${request.requestSha256.slice(7, 19)}`;
}

async function stageInputs(
  request: V213QualificationMaterializationRequest,
  bucket: HostedR2BucketBinding,
): Promise<readonly StagedInput[]> {
  const attemptId = qualificationAttemptId(request);
  const staged: StagedInput[] = [];
  let audioOrdinal = 0;
  try {
    for (const artifact of request.inputs) {
      const bytes = artifactBytes(artifact, request.descriptor, audioOrdinal);
      if (artifact.role === "audio") audioOrdinal += 1;
      if ((await bytesSha256(bytes)) !== artifact.sha256)
        throw new Error("V213_QUALIFICATION_INPUT_HASH_DRIFT");
      const objectKey =
        `tenant/${request.fullLiveAuthorityId}/workspace/${request.stageAuthorityId}/project/` +
        `v213-qualification/revision/${request.sourceCommit}/lane/input/job/${attemptId}/artifact/${artifact.assetId}`;
      if (!isExactHostedR2ObjectKey(objectKey))
        throw new Error("V213_QUALIFICATION_R2_KEY_INVALID");
      const before = await exactStoredObject(
        bucket,
        objectKey,
        artifact.contentType,
        bytes.byteLength,
        artifact.sha256,
      );
      if (before === "DRIFT") throw new Error("V213_QUALIFICATION_R2_OBJECT_DRIFT");
      let created = false;
      if (before === "ABSENT") {
        try {
          await bucket.put(objectKey, bytes.buffer, {
            httpMetadata: { contentType: artifact.contentType },
            sha256: artifact.sha256.slice(7),
          });
          created = true;
        } catch {
          const recovered = await exactStoredObject(
            bucket,
            objectKey,
            artifact.contentType,
            bytes.byteLength,
            artifact.sha256,
          );
          if (recovered !== "EXACT") throw new Error("V213_QUALIFICATION_R2_PUT_ACK_UNKNOWN");
          created = true;
        }
      }
      if (
        (await exactStoredObject(
          bucket,
          objectKey,
          artifact.contentType,
          bytes.byteLength,
          artifact.sha256,
        )) !== "EXACT"
      )
        throw new Error("V213_QUALIFICATION_R2_READBACK_DRIFT");
      staged.push(Object.freeze({ artifact, bytes, objectKey, created }));
    }
  } catch (error) {
    // stageInputs used to lose its local list when a later input failed.  Clean every object this
    // invocation can prove it created before propagating the failure.
    if (staged.length > 0) await cleanupCreatedInputs(bucket, staged);
    throw error;
  }
  return Object.freeze(staged);
}

async function cleanupCreatedInputs(bucket: HostedR2BucketBinding, staged: readonly StagedInput[]) {
  for (const item of staged.filter(({ created }) => created).reverse()) {
    await bucket.delete(item.objectKey);
    if ((await bucket.head(item.objectKey)) !== null)
      throw new Error("V213_QUALIFICATION_R2_CLEANUP_AMBIGUOUS");
  }
}

/** Delete every deterministic qualification input after its provider job reaches a terminal state.
 * These keys are unique to the request hash and therefore attributable even when materialization
 * reused an exact object left by an earlier interrupted invocation. */
export async function cleanupV213QualificationInputs(
  rawRequest: unknown,
  input: {
    readonly bucket: HostedR2BucketBinding;
    readonly terminalOutcome: "COMPLETED" | "FAILED" | "CANCELLED" | "TIMED_OUT";
  },
): Promise<V213QualificationInputCleanupEvidence> {
  const request = parseV213QualificationMaterializationRequest(rawRequest);
  const keys = request.inputs.map((artifact) => objectKeyForInput(request, artifact));
  for (const key of [...keys].reverse()) {
    try {
      await input.bucket.delete(key);
    } catch {
      // A lost delete acknowledgement is safe only when exact readback proves absence.
    }
    if ((await input.bucket.head(key)) !== null)
      throw new Error("V213_QUALIFICATION_TERMINAL_INPUT_CLEANUP_AMBIGUOUS");
  }
  const base = {
    schemaVersion: "videoforge.v213-qualification-input-cleanup/v1" as const,
    requestSha256: request.requestSha256,
    terminalOutcome: input.terminalOutcome,
    deletedObjectKeySha256s: Object.freeze(keys.map((key) => digestUtf8(key) as Sha256)),
    absenceVerified: true as const,
  };
  return Object.freeze({ ...base, evidenceSha256: canonicalSha256(base) as Sha256 });
}

function outputPrefix(request: V213QualificationMaterializationRequest, attemptId: string): string {
  const lane = request.descriptor.lane === "mage" ? "mage-image" : "soulx-avatar";
  return (
    `tenant/${request.fullLiveAuthorityId}/workspace/${request.stageAuthorityId}/project/` +
    `v213-qualification/revision/${request.sourceCommit}/lane/${lane}/job/${attemptId}`
  );
}

async function buildMaterialization(
  request: V213QualificationMaterializationRequest,
  staged: readonly StagedInput[],
  dependencies: V213QualificationMaterializerDependencies,
): Promise<V213QualificationMaterializationRouteResult> {
  const now = dependencies.now?.() ?? new Date();
  const expiresAt = expectedPortExpiry(now);
  const randomHex = dependencies.randomHex ?? randomHexDefault;
  const attemptId = qualificationAttemptId(request);
  const prefix = outputPrefix(request, attemptId);
  const generatedCount =
    request.descriptor.lane === "mage"
      ? MAGE_QUALIFICATION_ITEM_COUNT
      : isWholeSpanDescriptor(request.descriptor)
        ? 4
        : 1;
  const outputIds = Array.from({ length: generatedCount }, (_, index) =>
    request.descriptor.lane === "mage"
      ? `mage-output-${String(index + 1).padStart(2, "0")}`
      : `soulx-output-${
          isWholeSpanDescriptor(request.descriptor)
            ? ([2, 4, 6, 10] as const)[index]
            : request.descriptor.seconds
        }s`,
  );
  const generatedAuthorities = outputIds.map((reservationId, index) => ({
    schema_version: "artifact-generated-output-authority/v1",
    reservation_id: reservationId,
    account_id: request.fullLiveAuthorityId,
    workspace_id: request.stageAuthorityId,
    method: "PUT" as const,
    path: `/${prefix}/artifact/${
      request.descriptor.lane === "mage"
        ? `mage-qualification-${String(index + 1).padStart(2, "0")}`
        : `soulx-${
            isWholeSpanDescriptor(request.descriptor)
              ? ([2, 4, 6, 10] as const)[index]
              : request.descriptor.seconds
          }s`
    }`,
    content_type: request.descriptor.lane === "mage" ? "image/png" : "video/mp4",
    max_content_length: outputMaxContentLength(request.descriptor),
    expires_at: expiresAt,
    max_uses: 1 as const,
    capability_handle: randomHex(32),
  }));
  const outputUrls = await Promise.all(
    generatedAuthorities.map(async (authority) => {
      const objectKey = authority.path.slice(1);
      const port = await dependencies.r2Signer.signGenerated({
        objectKey,
        contentType: authority.content_type,
        maxContentLength: authority.max_content_length,
        lifetimeSeconds: PORT_LIFETIME_SECONDS,
        now,
      });
      validateSignedGeneratedPort(port, {
        objectKey,
        contentType: authority.content_type,
        maxLength: authority.max_content_length,
        expiresAt,
      });
      return port.url;
    }),
  );
  const inputPorts = await Promise.all(
    staged.map(async ({ artifact, bytes, objectKey }) => {
      const signed = await dependencies.r2Signer.sign({
        method: "GET",
        objectKey,
        contentType: artifact.contentType,
        contentLength: bytes.byteLength,
        checksumSha256: artifact.sha256,
        lifetimeSeconds: PORT_LIFETIME_SECONDS,
        now,
      });
      validateSignedInputPort(signed, {
        objectKey,
        contentType: artifact.contentType,
        contentLength: bytes.byteLength,
        checksumSha256: artifact.sha256,
        expiresAt,
      });
      return {
        authority: {
          schema_version: "artifact-transfer-port/v3",
          reservation_id: artifact.reservationId,
          account_id: request.fullLiveAuthorityId,
          workspace_id: request.stageAuthorityId,
          method: "GET" as const,
          path: `/${objectKey}`,
          content_type: artifact.contentType,
          content_length: bytes.byteLength,
          checksum_sha256: artifact.sha256,
          expires_at: expiresAt,
          max_uses: 1 as const,
          capability_handle: randomHex(32),
        },
        url: signed.url,
      };
    }),
  );
  const sha = (value: string) => digestUtf8(value) as Sha256;
  let batch: Readonly<Record<string, unknown>>;
  if (request.descriptor.lane === "mage") {
    batch = generateMageQualificationCase({ attemptId, outputUrls, sha256Utf8: sha });
    if (!validateMageQualificationCase(batch, sha))
      throw new Error("V213_MAGE_WORKER_CONTRACT_INVALID");
  } else if (isWholeSpanDescriptor(request.descriptor)) {
    const source = staged[0]!;
    const audios = staged.slice(1);
    batch = generateSoulXWholeSpanQualificationCase({
      attemptId,
      sourceAssetId: source.artifact.assetId,
      sourceSha256: source.artifact.sha256,
      sourceReservationId: source.artifact.reservationId,
      spans: audios.map(({ artifact }, index) => ({
        seconds: ([2, 4, 6, 10] as const)[index]!,
        audioAssetId: artifact.assetId,
        audioSha256: artifact.sha256,
        audioReservationId: artifact.reservationId,
        outputReservationId: outputIds[index]!,
      })),
    });
    if (!validateSoulXWholeSpanQualificationCase(batch))
      throw new Error("V208_SOULX_WHOLE_SPAN_WORKER_CONTRACT_INVALID");
  } else {
    const source = staged.find(({ artifact }) => artifact.role === "avatar_source")!;
    const audio = staged.find(({ artifact }) => artifact.role === "audio")!;
    batch = generateSoulXQualificationCase({
      attemptId,
      seconds: request.descriptor.seconds as 2 | 4 | 6 | 10,
      sourceAssetId: source.artifact.assetId,
      sourceSha256: source.artifact.sha256,
      sourceReservationId: source.artifact.reservationId,
      audioAssetId: audio.artifact.assetId,
      audioSha256: audio.artifact.sha256,
      audioReservationId: audio.artifact.reservationId,
      outputReservationId: outputIds[0]!,
    });
    if (!validateSoulXQualificationCase(batch, request.descriptor.seconds))
      throw new Error("V213_SOULX_WORKER_CONTRACT_INVALID");
  }
  const inputManifestSha256 = canonicalSha256(
    staged.map(({ artifact, bytes, objectKey }) => ({
      assetId: artifact.assetId,
      bytes: bytes.byteLength,
      contentType: artifact.contentType,
      objectKey,
      sha256: artifact.sha256,
    })),
  ) as Sha256;
  const transferIds = [
    ...inputPorts.map(({ authority }) => authority.reservation_id),
    ...generatedAuthorities.map(({ reservation_id }) => reservation_id),
  ];
  const unsignedEnvelope = {
    schema: "serverless-worker-job-envelope/v3",
    dispatch_token: `v213-${randomHex(32)}`,
    tenant: { account_id: request.fullLiveAuthorityId, workspace_id: request.stageAuthorityId },
    work: {
      project_revision_id: request.sourceCommit,
      generation_request_id: request.descriptor.id,
      task_id: request.operationId,
      attempt_id: attemptId,
      lane: request.descriptor.lane === "mage" ? "mage_image" : "soulx_avatar",
      items_manifest_sha256: canonicalSha256(batch) as Sha256,
      item_count: generatedCount,
    },
    runtime: {
      endpoint_profile_id:
        request.descriptor.lane === "mage" ? "mage-serverless-v1" : "soulx-serverless-v1",
      deployment_id: request.deployment.deploymentSha256,
      container_digest: request.deployment.image.slice(request.deployment.image.indexOf("sha256:")),
      model_manifest_sha256: request.deployment.volumeManifestSha256,
      volume_id_sha256: request.deployment.volumeIdSha256,
      volume_mount: "/runpod-volume",
      volume_write_policy: "APPLICATION_READ_ONLY",
      scratch_root_policy: "JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME",
      gpu_allowlist: ["NVIDIA GeForce RTX 4090"],
      region: "EU-RO-1",
    },
    artifacts: {
      input_manifest_sha256: inputManifestSha256,
      output_prefix: prefix,
      ...(request.descriptor.lane === "soulx"
        ? { plan_manifest_sha256: canonicalSha256(batch) as Sha256 }
        : {}),
      transfer_port_reservation_ids: transferIds,
    },
    limits: {
      issued_at: now.toISOString(),
      expires_at: expiresAt,
      max_items: generatedCount,
      max_input_bytes: Math.max(
        1,
        staged.reduce((sum, { bytes }) => sum + bytes.byteLength, 0),
      ),
      max_output_bytes: generatedAuthorities.reduce(
        (sum, authority) => sum + authority.max_content_length,
        0,
      ),
      execution_timeout_seconds: executionTimeoutSeconds(request.descriptor),
      init_timeout_seconds: request.deployment.initTimeoutSeconds,
    },
    policy: {
      model_download_permitted: false,
      volume_mutation_permitted: false,
      pod_lifecycle_permitted: false,
      queue_purge_permitted: false,
    },
  } as const;
  const signed = await signHostedEnvelopeBody(
    unsignedEnvelope as unknown as JsonValue,
    dependencies.signing,
  );
  const envelope = {
    ...unsignedEnvelope,
    authority_sha256: signed.authoritySha256,
    signature: signed.signature,
  };
  await validateAndHashContractDocument("serverlessWorkerJobEnvelopeV3", envelope);
  const workerRequest = {
    envelope,
    batch,
    ports: {
      inputs: inputPorts.map(({ authority }) => authority),
      ...(request.descriptor.lane === "mage" ? { outputs: [] } : {}),
    },
    input_get_urls: inputPorts.map(({ url }) => url),
    generated_output_authorities: generatedAuthorities,
    output_put_urls: outputUrls,
    ...(qualificationProbe(request.descriptor)
      ? { qualification_probe: qualificationProbe(request.descriptor)! }
      : {}),
  } as unknown as JsonValue;
  const caseDescriptorSha256 = canonicalSha256(request.descriptor) as Sha256;
  const materializationEvidenceSha256 = canonicalSha256({
    caseDescriptorSha256,
    deploymentSha256: canonicalSha256(request.deployment),
    requestSha256: canonicalSha256(workerRequest as object),
    stageAuthorityId: request.stageAuthorityId,
  }) as Sha256;
  const materialization: V213QualificationCaseMaterialization = Object.freeze({
    schemaVersion: "videoforge.v213-qualification-case-materialization/v1",
    caseDescriptorSha256,
    materializationEvidenceSha256,
    request: workerRequest,
  });
  const sourceRefsSha256 = canonicalSha256({
    caseSourceRef: request.caseSourceRef,
    generatorRef: request.generatorRef,
    validatorRef: request.validatorRef,
  }) as Sha256;
  const resultBase = {
    schemaVersion: "videoforge.v213-qualification-materialization-result/v1" as const,
    fullLiveAuthorityId: request.fullLiveAuthorityId,
    operationId: request.operationId,
    stageAuthorityId: request.stageAuthorityId,
    outerStateSha256: request.outerStateSha256,
    requestSha256: request.requestSha256,
    sourceRefsSha256,
    materialization,
  };
  return Object.freeze({ ...resultBase, resultSha256: canonicalSha256(resultBase) as Sha256 });
}

function objectKeyForInput(
  request: V213QualificationMaterializationRequest,
  artifact: V213QualificationInputArtifact,
): string {
  const attemptId = qualificationAttemptId(request);
  return (
    `tenant/${request.fullLiveAuthorityId}/workspace/${request.stageAuthorityId}/project/` +
    `v213-qualification/revision/${request.sourceCommit}/lane/input/job/${attemptId}/artifact/${artifact.assetId}`
  );
}

function outputAuthorityShape(
  value: unknown,
  request: V213QualificationMaterializationRequest,
  index: number,
  expiresAt: string,
): void {
  if (!record(value)) throw new Error("V213_QUALIFICATION_OUTPUT_AUTHORITY_INVALID");
  const lane = request.descriptor.lane;
  const soulxSeconds = isWholeSpanDescriptor(request.descriptor)
    ? ([2, 4, 6, 10] as const)[index]
    : request.descriptor.seconds;
  const outputId =
    lane === "mage"
      ? `mage-output-${String(index + 1).padStart(2, "0")}`
      : `soulx-output-${soulxSeconds}s`;
  const artifactId =
    lane === "mage"
      ? `mage-qualification-${String(index + 1).padStart(2, "0")}`
      : `soulx-${soulxSeconds}s`;
  const prefix = outputPrefix(request, qualificationAttemptId(request));
  const expected = {
    schema_version: "artifact-generated-output-authority/v1",
    reservation_id: outputId,
    account_id: request.fullLiveAuthorityId,
    workspace_id: request.stageAuthorityId,
    method: "PUT",
    path: `/${prefix}/artifact/${artifactId}`,
    content_type: lane === "mage" ? "image/png" : "video/mp4",
    max_content_length: outputMaxContentLength(request.descriptor),
    expires_at: expiresAt,
    max_uses: 1,
  } as const;
  if (
    !exactKeys(value, [
      "account_id",
      "capability_handle",
      "content_type",
      "expires_at",
      "max_content_length",
      "max_uses",
      "method",
      "path",
      "reservation_id",
      "schema_version",
      "workspace_id",
    ]) ||
    Object.entries(expected).some(([key, expectedValue]) => value[key] !== expectedValue) ||
    typeof value.capability_handle !== "string" ||
    !CAPABILITY.test(value.capability_handle)
  )
    throw new Error("V213_QUALIFICATION_OUTPUT_AUTHORITY_INVALID");
}

function validateWorkerRequest(
  value: unknown,
  request: V213QualificationMaterializationRequest,
): Record<string, unknown> {
  const probe = qualificationProbe(request.descriptor);
  if (
    !record(value) ||
    !exactKeys(
      value,
      probe ? [...WORKER_REQUEST_KEYS, "qualification_probe"] : WORKER_REQUEST_KEYS,
    ) ||
    (probe !== null && value.qualification_probe !== probe)
  )
    throw new Error("V213_QUALIFICATION_WORKER_REQUEST_INVALID");
  const envelope = value.envelope;
  if (!record(envelope)) throw new Error("V213_QUALIFICATION_ENVELOPE_INVALID");
  try {
    assertContract("serverlessWorkerJobEnvelopeV3", envelope);
  } catch {
    throw new Error("V213_QUALIFICATION_ENVELOPE_INVALID");
  }
  const expectedAttemptId = qualificationAttemptId(request);
  const expectedLane = request.descriptor.lane === "mage" ? "mage_image" : "soulx_avatar";
  const envelopeTenant = envelope.tenant;
  const envelopeWork = envelope.work;
  const envelopeRuntime = envelope.runtime;
  const envelopeArtifacts = envelope.artifacts;
  const envelopeLimits = envelope.limits;
  if (
    !record(envelopeTenant) ||
    !record(envelopeWork) ||
    !record(envelopeRuntime) ||
    !record(envelopeArtifacts) ||
    !record(envelopeLimits) ||
    envelopeTenant.account_id !== request.fullLiveAuthorityId ||
    envelopeTenant.workspace_id !== request.stageAuthorityId ||
    envelopeWork.project_revision_id !== request.sourceCommit ||
    envelopeWork.generation_request_id !== request.descriptor.id ||
    envelopeWork.task_id !== request.operationId ||
    envelopeWork.attempt_id !== expectedAttemptId ||
    envelopeWork.lane !== expectedLane ||
    envelopeWork.item_count !==
      (request.descriptor.lane === "mage"
        ? 32
        : isWholeSpanDescriptor(request.descriptor)
          ? 4
          : 1) ||
    envelopeRuntime.endpoint_profile_id !==
      (request.descriptor.lane === "mage" ? "mage-serverless-v1" : "soulx-serverless-v1") ||
    envelopeRuntime.deployment_id !== request.deployment.deploymentSha256 ||
    envelopeRuntime.container_digest !==
      request.deployment.image.slice(request.deployment.image.indexOf("sha256:")) ||
    envelopeRuntime.model_manifest_sha256 !== request.deployment.volumeManifestSha256 ||
    envelopeRuntime.volume_id_sha256 !== request.deployment.volumeIdSha256 ||
    envelopeRuntime.volume_mount !== "/runpod-volume" ||
    envelopeRuntime.volume_write_policy !== "APPLICATION_READ_ONLY" ||
    envelopeRuntime.scratch_root_policy !== "JOB_LOCAL_SCRATCH_OUTSIDE_MODEL_VOLUME" ||
    JSON.stringify(envelopeRuntime.gpu_allowlist) !== JSON.stringify(["NVIDIA GeForce RTX 4090"]) ||
    envelopeRuntime.region !== "EU-RO-1" ||
    envelopeArtifacts.output_prefix !== outputPrefix(request, expectedAttemptId) ||
    envelopeArtifacts.transfer_port_reservation_ids === undefined ||
    !validUtc(envelopeLimits.issued_at) ||
    !validUtc(envelopeLimits.expires_at)
  )
    throw new Error("V213_QUALIFICATION_ENVELOPE_SCOPE_INVALID");
  const issuedAt = Date.parse(envelopeLimits.issued_at as string);
  const expiresAt = Date.parse(envelopeLimits.expires_at as string);
  if (
    !Number.isFinite(issuedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt - issuedAt !== PORT_LIFETIME_SECONDS * 1_000 ||
    envelopeLimits.max_items !==
      (request.descriptor.lane === "mage"
        ? 32
        : isWholeSpanDescriptor(request.descriptor)
          ? 4
          : 1) ||
    envelopeLimits.execution_timeout_seconds !== executionTimeoutSeconds(request.descriptor) ||
    envelopeLimits.init_timeout_seconds !== request.deployment.initTimeoutSeconds ||
    envelopeLimits.max_output_bytes !==
      (request.descriptor.lane === "mage"
        ? 32
        : isWholeSpanDescriptor(request.descriptor)
          ? 4
          : 1) *
        outputMaxContentLength(request.descriptor) ||
    !record(envelope.policy) ||
    envelope.policy.model_download_permitted !== false ||
    envelope.policy.volume_mutation_permitted !== false ||
    envelope.policy.pod_lifecycle_permitted !== false ||
    envelope.policy.queue_purge_permitted !== false
  )
    throw new Error("V213_QUALIFICATION_ENVELOPE_LIMIT_INVALID");

  const batch = value.batch;
  const inputUrls = value.input_get_urls;
  const outputUrls = value.output_put_urls;
  const generatedAuthorities = value.generated_output_authorities;
  const ports = value.ports;
  if (
    !Array.isArray(inputUrls) ||
    !inputUrls.every(safeUrl) ||
    !Array.isArray(outputUrls) ||
    !outputUrls.every(safeUrl) ||
    !Array.isArray(generatedAuthorities) ||
    !record(ports)
  )
    throw new Error("V213_QUALIFICATION_WORKER_PORTS_INVALID");
  const expectedInputPorts = request.inputs;
  if (
    inputUrls.length !== expectedInputPorts.length ||
    generatedAuthorities.length !==
      (request.descriptor.lane === "mage" ? 32 : isWholeSpanDescriptor(request.descriptor) ? 4 : 1)
  )
    throw new Error("V213_QUALIFICATION_WORKER_PORTS_INVALID");
  const expectedExpiry = envelopeLimits.expires_at as string;
  const inputAuthorities = ports.inputs;
  const expectedPortKeys = request.descriptor.lane === "mage" ? ["inputs", "outputs"] : ["inputs"];
  if (
    !exactKeys(ports, expectedPortKeys) ||
    !Array.isArray(inputAuthorities) ||
    (request.descriptor.lane === "mage" &&
      (!Array.isArray(ports.outputs) || ports.outputs.length !== 0))
  )
    throw new Error("V213_QUALIFICATION_WORKER_PORTS_INVALID");
  const inputManifest = [] as Record<string, unknown>[];
  let audioOrdinal = 0;
  for (const [index, artifact] of expectedInputPorts.entries()) {
    const inputPort = inputAuthorities[index];
    const bytes = artifactBytes(artifact, request.descriptor, audioOrdinal);
    if (artifact.role === "audio") audioOrdinal += 1;
    const expectedObjectKey = objectKeyForInput(request, artifact);
    if (
      !record(inputPort) ||
      !exactKeys(inputPort, [
        "account_id",
        "capability_handle",
        "checksum_sha256",
        "content_length",
        "content_type",
        "expires_at",
        "max_uses",
        "method",
        "path",
        "reservation_id",
        "schema_version",
        "workspace_id",
      ]) ||
      inputPort.schema_version !== "artifact-transfer-port/v3" ||
      inputPort.reservation_id !== artifact.reservationId ||
      inputPort.account_id !== request.fullLiveAuthorityId ||
      inputPort.workspace_id !== request.stageAuthorityId ||
      inputPort.method !== "GET" ||
      inputPort.path !== `/${expectedObjectKey}` ||
      inputPort.content_type !== artifact.contentType ||
      inputPort.content_length !== bytes.byteLength ||
      inputPort.checksum_sha256 !== artifact.sha256 ||
      inputPort.expires_at !== expectedExpiry ||
      inputPort.max_uses !== 1 ||
      typeof inputPort.capability_handle !== "string" ||
      !CAPABILITY.test(inputPort.capability_handle)
    )
      throw new Error("V213_QUALIFICATION_INPUT_PORT_INVALID");
    inputManifest.push({
      assetId: artifact.assetId,
      bytes: bytes.byteLength,
      contentType: artifact.contentType,
      objectKey: expectedObjectKey,
      sha256: artifact.sha256,
    });
    if (!signedUrlBindsObjectKey(inputUrls[index]!, expectedObjectKey))
      throw new Error("V213_QUALIFICATION_INPUT_PORT_SCOPE_INVALID");
  }
  if (canonicalSha256(inputManifest) !== envelopeArtifacts.input_manifest_sha256)
    throw new Error("V213_QUALIFICATION_INPUT_MANIFEST_INVALID");
  const expectedTransferIds = [
    ...expectedInputPorts.map(({ reservationId }) => reservationId),
    ...generatedAuthorities.map((authority) => (record(authority) ? authority.reservation_id : "")),
  ];
  if (
    JSON.stringify(envelopeArtifacts.transfer_port_reservation_ids) !==
    JSON.stringify(expectedTransferIds)
  )
    throw new Error("V213_QUALIFICATION_PORT_AUTHORITY_INVALID");
  generatedAuthorities.forEach((authority, index) =>
    outputAuthorityShape(authority, request, index, expectedExpiry),
  );
  generatedAuthorities.forEach((authority, index) => {
    const objectKey = String((authority as Record<string, unknown>).path).slice(1);
    if (!signedUrlBindsObjectKey(outputUrls[index]!, objectKey))
      throw new Error("V213_QUALIFICATION_OUTPUT_PORT_SCOPE_INVALID");
  });
  if (request.descriptor.lane === "mage") {
    if (!validateMageQualificationCase(batch, (value) => digestUtf8(value)))
      throw new Error("V213_MAGE_WORKER_CONTRACT_INVALID");
    const mageBatch = batch as Record<string, unknown>;
    const items = mageBatch.items as readonly Record<string, unknown>[];
    items.forEach((item, index) => {
      if (
        item.output_put_url !== outputUrls[index] ||
        digestUtf8(String(item.positive_prompt)) !== item.positive_prompt_sha256 ||
        digestUtf8(String(item.negative_prompt)) !== item.negative_prompt_sha256
      )
        throw new Error("V213_MAGE_WORKER_CONTRACT_INVALID");
    });
    if (envelopeWork.items_manifest_sha256 !== canonicalSha256(batch as object))
      throw new Error("V213_MAGE_WORKER_CONTRACT_INVALID");
  } else if (isWholeSpanDescriptor(request.descriptor)) {
    if (!validateSoulXWholeSpanQualificationCase(batch))
      throw new Error("V208_SOULX_WHOLE_SPAN_WORKER_CONTRACT_INVALID");
    const soulxBatch = batch as Record<string, unknown>;
    const batchSource = soulxBatch.avatar_source as Record<string, unknown>;
    const spans = soulxBatch.spans as readonly Record<string, unknown>[];
    if (
      batchSource.asset_id !== request.inputs[0]!.assetId ||
      batchSource.sha256 !== request.inputs[0]!.sha256 ||
      batchSource.port_reservation_id !== request.inputs[0]!.reservationId ||
      spans.some((span, index) => {
        const audio = request.inputs[index + 1]!;
        return (
          span.audio_asset_id !== audio.assetId ||
          span.audio_sha256 !== audio.sha256 ||
          span.audio_port_reservation_id !== audio.reservationId ||
          span.output_reservation_id !== generatedAuthorities[index]!.reservation_id
        );
      }) ||
      envelopeArtifacts.plan_manifest_sha256 !== canonicalSha256(batch as object) ||
      envelopeWork.items_manifest_sha256 !== canonicalSha256(batch as object)
    )
      throw new Error("V208_SOULX_WHOLE_SPAN_WORKER_CONTRACT_INVALID");
  } else {
    if (!validateSoulXQualificationCase(batch, request.descriptor.seconds))
      throw new Error("V213_SOULX_WORKER_CONTRACT_INVALID");
    const soulxBatch = batch as Record<string, unknown>;
    const source = request.inputs[0]!;
    const audio = request.inputs[1]!;
    const batchSource = soulxBatch.avatar_source as Record<string, unknown>;
    const span = (soulxBatch.spans as readonly Record<string, unknown>[])[0]!;
    if (
      batchSource.asset_id !== source.assetId ||
      batchSource.sha256 !== source.sha256 ||
      batchSource.port_reservation_id !== source.reservationId ||
      span.audio_asset_id !== audio.assetId ||
      span.audio_sha256 !== audio.sha256 ||
      span.audio_port_reservation_id !== audio.reservationId ||
      span.output_reservation_id !== generatedAuthorities[0]!.reservation_id ||
      envelopeArtifacts.plan_manifest_sha256 !== canonicalSha256(batch as object) ||
      envelopeWork.items_manifest_sha256 !== canonicalSha256(batch as object)
    )
      throw new Error("V213_SOULX_WORKER_CONTRACT_INVALID");
  }
  return envelope;
}

function decodeSecretHex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2}){32,}$/u.test(value))
    throw new Error("V213_QUALIFICATION_ENVELOPE_KEY_INVALID");
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16),
  );
}

async function verifyMaterializationEnvelope(
  workerRequest: Record<string, unknown>,
  signing: HostedEnvelopeSigningBinding,
): Promise<void> {
  const envelope = workerRequest.envelope;
  if (!record(envelope)) throw new Error("V213_QUALIFICATION_ENVELOPE_INVALID");
  const authority = envelope.authority_sha256;
  const signature = envelope.signature;
  if (
    typeof authority !== "string" ||
    !HASH.test(authority) ||
    !record(signature) ||
    !exactKeys(signature, ["algorithm", "key_id", "value"]) ||
    signature.algorithm !== "HMAC-SHA256" ||
    signature.key_id !== signing.keyId ||
    typeof signature.value !== "string" ||
    !/^[0-9a-f]{64}$/u.test(signature.value)
  )
    throw new Error("V213_QUALIFICATION_ENVELOPE_SIGNATURE_INVALID");
  const unsigned = Object.fromEntries(
    Object.entries(envelope).filter(([key]) => key !== "authority_sha256" && key !== "signature"),
  );
  if (canonicalSha256(unsigned) !== authority)
    throw new Error("V213_QUALIFICATION_ENVELOPE_BODY_HASH_INVALID");
  const key = await crypto.subtle.importKey(
    "raw",
    decodeSecretHex(signing.secretHex),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signatureBytes = Uint8Array.from(signature.value.match(/../gu)!, (pair) =>
    Number.parseInt(pair, 16),
  );
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes,
    canonicalizeJsonToUtf8({ authority_sha256: authority, key_id: signing.keyId }),
  );
  if (!valid) throw new Error("V213_QUALIFICATION_ENVELOPE_SIGNATURE_INVALID");
}

export function parseV213QualificationMaterializationResult(
  value: unknown,
  request: V213QualificationMaterializationRequest,
): V213QualificationMaterializationRouteResult {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_RESULT_INVALID");
  const item = value as Record<string, unknown>;
  if (
    !exactKeys(item, [
      "fullLiveAuthorityId",
      "materialization",
      "operationId",
      "outerStateSha256",
      "requestSha256",
      "resultSha256",
      "schemaVersion",
      "sourceRefsSha256",
      "stageAuthorityId",
    ]) ||
    item.schemaVersion !== "videoforge.v213-qualification-materialization-result/v1" ||
    item.fullLiveAuthorityId !== request.fullLiveAuthorityId ||
    item.operationId !== request.operationId ||
    item.stageAuthorityId !== request.stageAuthorityId ||
    item.outerStateSha256 !== request.outerStateSha256 ||
    item.requestSha256 !== request.requestSha256 ||
    typeof item.sourceRefsSha256 !== "string" ||
    !HASH.test(item.sourceRefsSha256) ||
    typeof item.resultSha256 !== "string" ||
    !HASH.test(item.resultSha256)
  )
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_RESULT_INVALID");
  const { resultSha256: _hash, ...base } = item;
  void _hash;
  if (canonicalSha256(base) !== item.resultSha256)
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_RESULT_HASH_DRIFT");
  const materialization = item.materialization as Record<string, unknown> | undefined;
  if (
    !materialization ||
    !exactKeys(materialization, [
      "caseDescriptorSha256",
      "materializationEvidenceSha256",
      "request",
      "schemaVersion",
    ]) ||
    materialization.schemaVersion !== "videoforge.v213-qualification-case-materialization/v1" ||
    typeof materialization.caseDescriptorSha256 !== "string" ||
    !HASH.test(materialization.caseDescriptorSha256) ||
    typeof materialization.materializationEvidenceSha256 !== "string" ||
    !HASH.test(materialization.materializationEvidenceSha256) ||
    !materialization.request
  )
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_RESULT_INVALID");
  if (materialization.caseDescriptorSha256 !== canonicalSha256(request.descriptor))
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_DESCRIPTOR_DRIFT");
  const workerRequest = materialization.request as Record<string, unknown>;
  validateWorkerRequest(workerRequest, request);
  const expectedEvidence = canonicalSha256({
    caseDescriptorSha256: materialization.caseDescriptorSha256,
    deploymentSha256: canonicalSha256(request.deployment),
    requestSha256: canonicalSha256(workerRequest),
    stageAuthorityId: request.stageAuthorityId,
  });
  if (materialization.materializationEvidenceSha256 !== expectedEvidence)
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_EVIDENCE_DRIFT");
  const expectedSourceRefs = canonicalSha256({
    caseSourceRef: request.caseSourceRef,
    generatorRef: request.generatorRef,
    validatorRef: request.validatorRef,
  });
  if (item.sourceRefsSha256 !== expectedSourceRefs)
    throw new Error("V213_QUALIFICATION_MATERIALIZATION_SOURCE_REFS_DRIFT");
  return item as unknown as V213QualificationMaterializationRouteResult;
}

export async function materializeV213QualificationCase(
  rawRequest: unknown,
  dependencies: V213QualificationMaterializerDependencies,
): Promise<V213QualificationMaterializationRouteResult> {
  const request = parseV213QualificationMaterializationRequest(rawRequest);
  const action = await dependencies.store.claim(request);
  const existing = await dependencies.store.read(request);
  if (existing) {
    const parsed = parseV213QualificationMaterializationResult(existing, request);
    await verifyMaterializationEnvelope(
      parsed.materialization.request as Record<string, unknown>,
      dependencies.signing,
    );
    return parsed;
  }
  if (action === "EXISTING") throw new Error("V213_QUALIFICATION_MATERIALIZATION_READBACK_MISSING");
  let staged: readonly StagedInput[] = [];
  let cleanupAllowed = true;
  try {
    staged = await stageInputs(request, dependencies.bucket);
    const result = await buildMaterialization(request, staged, dependencies);
    const built = parseV213QualificationMaterializationResult(result, request);
    await verifyMaterializationEnvelope(
      built.materialization.request as Record<string, unknown>,
      dependencies.signing,
    );
    try {
      const persisted = parseV213QualificationMaterializationResult(
        await dependencies.store.persist(request, built),
        request,
      );
      await verifyMaterializationEnvelope(
        persisted.materialization.request as Record<string, unknown>,
        dependencies.signing,
      );
      return persisted;
    } catch {
      let recovered: V213QualificationMaterializationRouteResult | null;
      try {
        recovered = await dependencies.store.read(request);
      } catch {
        cleanupAllowed = false;
        throw new Error("V213_QUALIFICATION_MATERIALIZATION_PERSISTENCE_READ_AMBIGUOUS");
      }
      if (recovered) {
        const parsed = parseV213QualificationMaterializationResult(recovered, request);
        await verifyMaterializationEnvelope(
          parsed.materialization.request as Record<string, unknown>,
          dependencies.signing,
        );
        return parsed;
      }
      throw new Error("V213_QUALIFICATION_MATERIALIZATION_PERSIST_ACK_UNKNOWN");
    }
  } catch (error) {
    if (cleanupAllowed && staged.length > 0)
      await cleanupCreatedInputs(dependencies.bucket, staged);
    throw error;
  }
}

export function createV213QualificationMaterializerDependencies(input: {
  readonly config: HostedRuntimeConfiguration;
  readonly bucket: HostedR2BucketBinding;
  readonly signing: HostedEnvelopeSigningBinding;
  readonly store: V213QualificationMaterializationStore;
}): V213QualificationMaterializerDependencies {
  return Object.freeze({
    bucket: input.bucket,
    r2Signer: new HostedR2Signer(input.config.r2),
    signing: input.signing,
    store: input.store,
  });
}
